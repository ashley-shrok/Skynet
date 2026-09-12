#!/usr/bin/env python3
"""role-file-watch.py — fourth ambient monitor: watch for edits to an identity's role AND identity files.

The sibling of the relay receiver, the wake-up scheduler, and the context-watch.
The receiver wakes on a MESSAGE, the scheduler on the CLOCK, the context-watch on
CONTEXT PRESSURE — this fourth monitor wakes on a ROLE-FILE OR IDENTITY-FILE CHANGE,
so mid-session edits to either file become visible to a running identity without
needing a full recycle.

Why this exists: closes the mid-session gap where an agent's in-context copy of its
role file or its own identity file has diverged from disk. For the role file, that's
a peer identity of the same role editing it in another session. For the identity
file, that's almost always Alice editing it directly (cosmetic frontmatter changes,
an identity-scope `remember`) — peer sessions of the SAME identity are essentially
impossible. Every fresh /id load STILL reads both files from scratch; this is purely
additive.

The watch is diff-first and dumb on purpose: it fires the unified diff of what
changed (inline when small, spilled to a file pointer when large), and lets the AGENT
decide whether the change is its own echo, a peer's, or Alice's. See the design
rationale in:
  .planning/shapes/shape-role-file-watch.md (in the box-maintainer role's Skynet repo)

Vendored into Skynet's substrate and distributed to every host running agent substrate
via the Skynet distributor. Stdlib + inotifywait subprocess only.

Usage:  python3 role-file-watch.py <identity_dir>
Env:    ROLE_WATCH_POLL_SEC (default 2) — fallback polling loop granularity (only
        engaged when inotifywait is not on PATH).
"""

import datetime
import os
import shutil
import signal
import subprocess
import sys
import time
import traceback

# spill threshold matches recv.sh:152 — INLINE_MAX=460 keeps the whole event line
# comfortably under the ~500-char harness cap (recv.sh:137)
INLINE_MAX = 460
POLL = int(os.environ.get("ROLE_WATCH_POLL_SEC", "2"))

# Module-level inotifywait subprocess handle so signal handlers can clean it up.
_inotify_proc = None


def _parse_role_from_frontmatter(identity_file_path):
    """Parse the `role:` key from YAML frontmatter in the identity pointer file.

    Frontmatter is the block between the FIRST two `---` lines. Returns (role, None)
    on success; (None, err_msg) if file missing, no frontmatter, or no role key.
    """
    try:
        with open(identity_file_path) as f:
            lines = f.readlines()
    except FileNotFoundError:
        return None, "identity file not found: %s" % identity_file_path
    except OSError as e:
        return None, "could not read identity file %s: %s" % (identity_file_path, e)

    # Find the two '---' fence lines.
    fence_indices = [i for i, ln in enumerate(lines) if ln.strip() == "---"]
    if len(fence_indices) < 2:
        return None, "no YAML frontmatter block found in %s" % identity_file_path

    start, end = fence_indices[0] + 1, fence_indices[1]
    for line in lines[start:end]:
        import re
        m = re.match(r"^role:\s*(\S+)", line)
        if m:
            return m.group(1), None

    return None, "no `role:` key found in frontmatter of %s" % identity_file_path


def _single_instance(state_dir, ident_dir):
    """Newest-wins guard: kill any prior role-file-watch for THIS identity, claim the pidfile."""
    pf = os.path.join(state_dir, "role-file-watch.pid")
    try:
        old = int(open(pf).read().strip())
        if old != os.getpid():
            try:
                cmd = open("/proc/%d/cmdline" % old).read()
            except Exception:
                cmd = os.popen("ps -p %d -o command= 2>/dev/null" % old).read()
            if "role-file-watch" in cmd and ident_dir in cmd:
                os.kill(old, 15)
    except Exception:
        pass
    open(pf, "w").write(str(os.getpid()))


def _read_bytes(path):
    """Read file bytes, return None on any error."""
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def _atomic_write_baseline(baseline_dir, last_snapshot_path, data):
    """Atomically write `data` bytes to last_snapshot_path via a temp file."""
    tmp_path = os.path.join(baseline_dir, "last-snapshot.tmp")
    with open(tmp_path, "wb") as f:
        f.write(data)
    os.replace(tmp_path, last_snapshot_path)


def _run_diff(baseline_path, role_file_path):
    """Run unified diff between baseline and current role file. Returns stdout str.
    diff exits 1 when files differ — that is the normal/expected case; capture anyway.

    --label flags replace the file paths in the `---`/`+++` header lines so the event
    doesn't leak the internal snapshot path (~150-250 chars of noise per event) into
    every wake. The agent only cares that the two sides are baseline vs current.
    """
    result = subprocess.run(
        [
            "diff", "-u",
            "--label", "baseline",
            "--label", "current",
            str(baseline_path),
            str(role_file_path),
        ],
        capture_output=True,
        text=True,
    )
    return result.stdout


def _emit_event(kind, label, diff_stdout, spill_dir):
    """Emit one event line (or spill to file if over INLINE_MAX).

    `kind` is "role-file" or "identity-file"; `label` is the role name or identity
    name respectively — the two together form the event tag the agent sees.

    INLINE_MAX is a BYTE cap (the harness measures the emitted line in UTF-8 bytes),
    so we check `len(line.encode("utf-8"))` — not `len(line)`, which counts code points.
    Role/identity files routinely contain multi-byte chars (curly quotes, em-dashes,
    emoji in directives); a line at len==460 code points can be well over 460 bytes
    and get truncated by the harness — exactly the failure mode the spill exists to
    prevent.
    """
    line = "📝 [%s: %s] %s" % (kind, label, diff_stdout)
    if len(line.encode("utf-8")) <= INLINE_MAX:
        print(line, flush=True)
    else:
        # Spill: create spill_dir lazily, write full diff, emit pointer-only line.
        # Spill filenames include the kind so role + identity spills at the same
        # timestamp don't collide.
        os.makedirs(spill_dir, exist_ok=True)
        ts = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H-%M-%SZ")
        spill_path = os.path.join(spill_dir, "%s.%s.diff" % (ts, kind))
        with open(spill_path, "w") as f:
            f.write(diff_stdout)
        print(
            "📝 [%s: %s] diff too large to inline — read %s IMMEDIATELY "
            "(the change may be important to your continued operation)"
            % (kind, label, spill_path),
            flush=True,
        )


def _diff_and_emit(kind, label, target_path, baseline_dir, baseline_path, spill_dir):
    """Compare current target file against its baseline; if different, emit event
    and update baseline. Returns True if target file is gone (caller should exit)."""
    current = _read_bytes(target_path)
    if current is None:
        print(
            "⚠️ [role-file-watch] %s file disappeared: %s" % (kind, target_path),
            file=sys.stderr,
            flush=True,
        )
        return True  # signal caller to exit

    baseline = _read_bytes(baseline_path)
    if baseline is None:
        # Baseline missing mid-run (unusual) — re-snapshot silently.
        _atomic_write_baseline(baseline_dir, baseline_path, current)
        return False

    if current != baseline:
        diff_stdout = _run_diff(baseline_path, target_path)
        _emit_event(kind, label, diff_stdout, spill_dir)
        _atomic_write_baseline(baseline_dir, baseline_path, current)

    return False


def _diff_and_emit_all(targets, baseline_dir, spill_dir):
    """Run _diff_and_emit for every target. Returns True if ANY target is gone."""
    for kind, label, target_path, baseline_path in targets:
        gone = _diff_and_emit(kind, label, target_path, baseline_dir, baseline_path, spill_dir)
        if gone:
            return True
    return False


def _make_signal_handler(role_file_path):
    """Return a SIGTERM/SIGINT handler that cleans up the inotifywait subprocess."""
    def _handler(signum, frame):
        global _inotify_proc
        if _inotify_proc is not None:
            try:
                _inotify_proc.terminate()
            except Exception:
                pass
        sys.exit(0)
    return _handler


def main():
    if len(sys.argv) < 2:
        print("usage: python3 role-file-watch.py <identity_dir>", file=sys.stderr)
        sys.exit(2)

    ident_dir = os.path.abspath(os.path.expanduser(sys.argv[1]))
    name = os.path.basename(ident_dir)

    # --- Resolve role name from identity frontmatter ---
    identity_file_path = os.path.join(ident_dir, "%s.md" % name)
    role, err = _parse_role_from_frontmatter(identity_file_path)
    if err:
        # Setup-failure diagnostics go to BOTH stdout and stderr. Stdout so the AGENT
        # gets woken with the diagnostic — a stderr-only failure produces a
        # silent-deaf watch the agent never learns about (mirrors recv.sh's
        # HARD-FAIL PREAMBLE convention against silent-deaf receivers).
        print("📝 [role-file-watch] SETUP FAILED: %s" % err, flush=True)
        print("⚠️ [role-file-watch] %s" % err, file=sys.stderr, flush=True)
        sys.exit(1)

    # --- Resolve role file path ---
    role_file_path = os.path.expanduser("~/fleet/roles/%s/%s.md" % (role, role))
    if not os.path.exists(role_file_path):
        msg = "role file not found: %s" % role_file_path
        print("📝 [role-file-watch] SETUP FAILED: %s" % msg, flush=True)
        print("⚠️ [role-file-watch] %s" % msg, file=sys.stderr, flush=True)
        sys.exit(1)

    # Identity file path already resolved above (identity_file_path).
    # Both targets: (kind, label-for-emit, source-file, per-file-baseline).
    baseline_dir = os.path.join(ident_dir, "role-file-watch")
    role_baseline_path = os.path.join(baseline_dir, "last-snapshot.role")
    identity_baseline_path = os.path.join(baseline_dir, "last-snapshot.identity")
    targets = [
        ("role-file", role, role_file_path, role_baseline_path),
        ("identity-file", name, identity_file_path, identity_baseline_path),
    ]

    # --- State dirs ---
    spill_dir = os.path.join(baseline_dir, "spilled")
    state_dir = os.path.join(baseline_dir, ".state")
    os.makedirs(state_dir, exist_ok=True)

    # --- One-time migration: legacy single-baseline `last-snapshot` → `last-snapshot.role`.
    # Older versions of this script wrote a single `last-snapshot` file at
    # `<ident>/role-file-watch/last-snapshot`. On first run of the two-target version we
    # promote it to the role baseline (identity baseline cold-starts silently below).
    legacy_baseline_path = os.path.join(baseline_dir, "last-snapshot")
    if os.path.exists(legacy_baseline_path) and not os.path.exists(role_baseline_path):
        try:
            os.replace(legacy_baseline_path, role_baseline_path)
        except OSError as e:
            # Non-fatal — if the migration fails we just cold-start the role baseline
            # below, which means one silent snapshot instead of continuity. Log it.
            print(
                "⚠️ [role-file-watch] legacy baseline migration failed: %s" % e,
                file=sys.stderr,
                flush=True,
            )

    # --- Single-instance guard ---
    _single_instance(state_dir, ident_dir)

    # --- Signal handlers (register early) ---
    handler = _make_signal_handler(role_file_path)
    signal.signal(signal.SIGTERM, handler)
    signal.signal(signal.SIGINT, handler)

    # --- Orphan-monitor guard (added 2026-09-05 after Noelle ate a Nelly dispatch).
    # Capture harness (Claude Code) PID at startup — our GRANDPARENT, not $PPID (which is
    # the bash-c wrapper the Monitor tool spawns; the wrapper stays alive as a waiter even
    # when Claude dies). Check per iteration below; if Claude is gone, exit(0) — matches
    # the fix in recv.sh + wakeup-scheduler.py + context-watch.py.
    # See bounty orphan-monitor-self-suicide-check.
    harness_pid = None
    try:
        with open("/proc/%d/status" % os.getppid()) as f:
            for line in f:
                if line.startswith("PPid:"):
                    p = int(line.split()[1])
                    if p > 1:
                        harness_pid = p
                    break
    except (OSError, ValueError):
        pass
    if harness_pid is None:
        print(
            "role-file-watch: orphan-check disabled (couldn't resolve grandparent)",
            file=sys.stderr,
            flush=True,
        )

    # --- Cold-start rule: for each target, if no baseline, snapshot silently.
    # Otherwise diff at startup and emit if the file changed while we were down.
    # Cold start remains silent per shape invariant. This runs per-target
    # independently so a legacy install (role baseline exists, identity does not) does
    # the right thing: the role gets a startup diff, the identity gets a silent cold
    # snapshot.
    for kind, label, target_path, baseline_path in targets:
        if not os.path.exists(baseline_path):
            current = _read_bytes(target_path)
            if current is None:
                msg = "%s file unreadable at startup: %s" % (kind, target_path)
                print("📝 [role-file-watch] SETUP FAILED: %s" % msg, flush=True)
                print("⚠️ [role-file-watch] %s" % msg, file=sys.stderr, flush=True)
                sys.exit(1)
            _atomic_write_baseline(baseline_dir, baseline_path, current)
            # Emit NOTHING to stdout on cold start (shape file "silent on cold start" invariant)
        else:
            gone = _diff_and_emit(kind, label, target_path, baseline_dir, baseline_path, spill_dir)
            if gone:
                sys.exit(1)

    # --- Watch loop ---
    use_inotify = shutil.which("inotifywait") is not None
    if not use_inotify:
        print(
            "⚠️ [role-file-watch] inotifywait not found — falling back to %ds polling "
            "(set ROLE_WATCH_POLL_SEC to adjust)" % POLL,
            file=sys.stderr,
            flush=True,
        )

    global _inotify_proc

    if use_inotify:
        # inotifywait-based watch loop. Both target files are passed to a single
        # inotifywait invocation; on any event, we diff BOTH baselines (the target
        # whose file didn't change is a no-op). This avoids parsing inotifywait's
        # per-event filename output.
        watched_paths = [t[2] for t in targets]  # role_file_path, identity_file_path
        while True:
            # Orphan check
            if harness_pid is not None:
                try:
                    os.kill(harness_pid, 0)
                except OSError:
                    sys.exit(0)

            try:
                _inotify_proc = subprocess.Popen(
                    [
                        "inotifywait", "-m",
                        "-e", "close_write,move_self,moved_to",
                    ] + watched_paths,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.DEVNULL,
                    text=True,
                )
                for event_line in _inotify_proc.stdout:
                    # Orphan check inside inner loop
                    if harness_pid is not None:
                        try:
                            os.kill(harness_pid, 0)
                        except OSError:
                            if _inotify_proc is not None:
                                try:
                                    _inotify_proc.terminate()
                                except Exception:
                                    pass
                            sys.exit(0)

                    event_line = event_line.strip()
                    if not event_line:
                        continue

                    # move_self: a watched file's inode was replaced (e.g. mv new old).
                    # Kill + respawn inotifywait to re-arm on the new inode(s).
                    if "MOVE_SELF" in event_line.upper():
                        if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                            sys.exit(1)
                        # Break inner loop to respawn inotifywait on new inode.
                        try:
                            _inotify_proc.terminate()
                        except Exception:
                            pass
                        _inotify_proc = None
                        break

                    # DELETE (rare)
                    if "DELETE_SELF" in event_line.upper():
                        print(
                            "⚠️ [role-file-watch] a watched file was deleted: %s"
                            % event_line,
                            file=sys.stderr,
                            flush=True,
                        )
                        sys.exit(1)

                    if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                        sys.exit(1)

            except Exception:
                traceback.print_exc(file=sys.stderr)
                sys.exit(1)

    else:
        # Fallback: mtime polling loop over both targets.
        try:
            last_mtimes = {t[2]: os.path.getmtime(t[2]) for t in targets}
        except OSError as e:
            print(
                "⚠️ [role-file-watch] target unreadable in polling loop: %s" % e,
                file=sys.stderr,
                flush=True,
            )
            sys.exit(1)

        while True:
            # Orphan check
            if harness_pid is not None:
                try:
                    os.kill(harness_pid, 0)
                except OSError:
                    sys.exit(0)

            time.sleep(POLL)
            changed = False
            for kind, label, target_path, baseline_path in targets:
                try:
                    cur_mtime = os.path.getmtime(target_path)
                except OSError:
                    print(
                        "⚠️ [role-file-watch] %s file disappeared: %s"
                        % (kind, target_path),
                        file=sys.stderr,
                        flush=True,
                    )
                    sys.exit(1)
                if cur_mtime != last_mtimes[target_path]:
                    last_mtimes[target_path] = cur_mtime
                    changed = True

            if changed:
                if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                    sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
