#!/usr/bin/env python3
"""role-file-watch.py — fourth ambient monitor: watch for edits to an identity's role file, identity file, AND runbooks.

The sibling of the relay receiver, the wake-up scheduler, and the context-watch.
The receiver wakes on a MESSAGE, the scheduler on the CLOCK, the context-watch on
CONTEXT PRESSURE — this fourth monitor wakes on a ROLE-FILE, IDENTITY-FILE, OR
RUNBOOK CHANGE, so mid-session edits become visible to a running identity without
needing a full recycle.

Why this exists: closes the mid-session gap where an agent's in-context copy of its
role file, its own identity file, or a role-scope runbook has diverged from disk.
For the role file, that's a peer identity of the same role editing it in another
session. For the identity file, that's almost always user editing it directly
(cosmetic frontmatter changes, an identity-scope `remember`) — peer sessions of the
SAME identity are essentially impossible. For runbooks, the driver was the
2026-09-19 canonical-deploy-command update: vision edited the skynet-ship runbook to
include a load-bearing `-f` flag, and a peer identity deployed with the OLD command
minutes later because the runbook edit fired no ambient event and stale memory of
the command outweighed re-reading the updated runbook. Every fresh /id load STILL
reads role + identity + enumerates runbooks; this is purely additive.

Runbook coverage extends to the sentinel file only — `~/fleet/roles/<role>/runbooks/<slug>/runbook.md`
per the id skill's runbook convention. Companion files in the same subfolder
(checklists, prompt archives, scripts) are IGNORED — their churn is not a signal
that the canonical procedure changed. Three runbook events fire:
  - `📝 [runbook: <role>/<slug>] <diff>`   — edit (same shape as role/identity)
  - `📝 [runbook: <role>/<slug>] added — Read <path>` — new runbook appeared
  - `📝 [runbook: <role>/<slug>] deleted`  — runbook.md OR its parent slug folder removed

The watch is diff-first and dumb on purpose: it fires the unified diff of what
changed (inline when small, spilled to a file pointer when large), and lets the AGENT
decide whether the change is its own echo, a peer's, or user's. See the design
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
import re
import shutil
import signal
import subprocess
import sys
import time
import traceback

# spill threshold matches recv.sh:152 — INLINE_MAX=460 keeps the whole event line
# comfortably under the ~500-char harness cap (recv.sh:137)
INLINE_MAX = 460

# ⚠ Every event MUST leave this script as exactly ONE line. ambient-monitor reads child
# stdout line-by-line and injects each line as a SEPARATE wake, so an N-line payload
# becomes N wakes, each costing the agent a full turn. A single `task:` field edit
# produced ~10 wakes in the field (2026-09-14, first VM-born agent on T800) because a
# unified diff is inherently multi-line and went out through one print(). Byte-capping
# does not prevent this on its own — a small multi-line diff sits well under INLINE_MAX
# and still fans out. See _flatten_diff.
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


def _flatten_diff(diff_stdout):
    """Collapse a unified diff into ONE line suitable for a single wake.

    Drops the `---` / `+++` / `@@` header lines (no value to the agent — the file and
    identity are already named in the event tag) and joins the remaining content lines
    with a visible separator so the +/- structure survives the flattening.

    Returns "(no textual change)" for an empty/whitespace-only diff rather than an
    empty string, so the emitted event is never a bare tag with nothing after it.
    """
    kept = []
    for raw in diff_stdout.splitlines():
        if raw.startswith(("---", "+++", "@@")):
            continue
        stripped = raw.rstrip()
        if not stripped:
            continue
        kept.append(stripped)
    if not kept:
        return "(no textual change)"
    return " ⏎ ".join(kept)


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

    A unified diff is ALWAYS multi-line, so we cannot simply spill on line count —
    that would spill every event and force a file Read for even a one-word change,
    losing the whole point of inlining. Instead we FLATTEN the diff to a single line
    (newlines → ' ⏎ ') and inline it when the flattened form fits the byte budget.
    Only a genuinely large diff spills.

    Flattening also drops the `---`/`+++`/`@@` header lines: they carry no information
    the agent wants (the labels are already in the event tag, and hunk offsets are
    meaningless for a file it can just read) and they are most of the line budget on
    a small change.
    """
    flat = _flatten_diff(diff_stdout)
    line = "📝 [%s: %s] %s" % (kind, label, flat)
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
        # PATH before PREVIEW, matching recv.sh's long-message idiom: if anything
        # gets truncated it must be the preview, never the path.
        print(
            "📝 [%s: %s] large change — full diff at %s — Read it «%s…»"
            % (kind, label, spill_path, flat[:160]),
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


# ---------------------------------------------------------------------------
# Runbook helpers (added 2026-09-19 alongside runbook coverage).
# ---------------------------------------------------------------------------

# Slug regex — kebab-case per the id skill's slug rule (shared with bounties +
# apps). Applied when reading subfolder names off disk to reject anything that
# would traverse or otherwise not correspond to a legitimate runbook slug (a
# subfolder named "..", spaces, or garbage). Defence in depth on top of "the
# folder exists and contains a runbook.md" — we simply skip anything the regex
# rejects, matching the sweep script's slug-injection defence.
_RUNBOOK_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]*$")
_RUNBOOK_SLUG_MAX_LEN = 64  # generous vs 40-char app cap; runbook names skew descriptive


def _enumerate_runbook_slugs(runbooks_dir):
    """Return sorted list of slugs whose `<slug>/runbook.md` exists on disk.

    Slugs failing `_RUNBOOK_SLUG_RE` or exceeding `_RUNBOOK_SLUG_MAX_LEN` are
    skipped silently — a peer identity might have half-created a folder or
    dropped something oddly-named. The watch is deliberately conservative:
    ambiguous state means don't-watch, not surface-an-error.
    """
    if not os.path.isdir(runbooks_dir):
        return []
    slugs = []
    try:
        entries = sorted(os.listdir(runbooks_dir))
    except OSError:
        return []
    for entry in entries:
        if not _RUNBOOK_SLUG_RE.match(entry):
            continue
        if len(entry) > _RUNBOOK_SLUG_MAX_LEN:
            continue
        rb_path = os.path.join(runbooks_dir, entry, "runbook.md")
        if not os.path.isfile(rb_path):
            continue
        slugs.append(entry)
    return slugs


def _runbook_paths(runbooks_dir, baseline_dir, slug):
    """Return the (runbook.md path, per-slug baseline path) tuple for a slug."""
    rb_path = os.path.join(runbooks_dir, slug, "runbook.md")
    base_path = os.path.join(baseline_dir, "last-snapshot.runbook.%s" % slug)
    return rb_path, base_path


def _existing_baseline_slugs(baseline_dir):
    """Return the set of slugs for which a runbook baseline currently exists.

    Used at startup to detect runbooks that were deleted while we were down —
    baseline files with no matching on-disk runbook.
    """
    prefix = "last-snapshot.runbook."
    slugs = set()
    try:
        for name in os.listdir(baseline_dir):
            if name.startswith(prefix):
                slugs.add(name[len(prefix):])
    except OSError:
        pass
    return slugs


def _emit_runbook_added(role, slug, rb_path):
    """New-runbook event — points at the file rather than emitting a diff.

    Runbooks are documents meant to be read in full; a diff-from-empty would
    be either large + spilled (equivalent to the pointer) or small and still
    not useful as a `+`-prefixed diff. Match the recv.sh long-message idiom
    of PATH-before-preview so the agent has an obvious next step.
    """
    print(
        "📝 [runbook: %s/%s] added — Read %s" % (role, slug, rb_path),
        flush=True,
    )


def _emit_runbook_deleted(role, slug):
    """Runbook-deleted event — no diff possible, one honest line."""
    print("📝 [runbook: %s/%s] deleted" % (role, slug), flush=True)


def _slug_from_event(w_path, f_name, runbooks_dir):
    """Given an inotify event's `%w` (watched dir) and `%f` (filename), return
    the runbook slug involved, or None if the event is not on a runbook.md /
    slug-subfolder we care about.

    Two shapes we want to match:
      1. `%w = runbooks_dir/<slug>`, `%f = runbook.md`  → returns <slug>
         (the sentinel file itself changed / was created / deleted)
      2. `%w = runbooks_dir`, `%f = <slug>` with ISDIR event
         → returns <slug> (the whole slug subfolder was created or removed)
    Everything else — companion files inside a slug folder, nested subdirs,
    events on unrelated paths — returns None.
    """
    # Normalize trailing slash on runbooks_dir for comparison (inotifywait
    # sometimes emits with trailing slash on the %w for -r-watched dirs).
    rb_root = runbooks_dir.rstrip("/")
    w_norm = w_path.rstrip("/")

    # Shape 1: event on <runbooks>/<slug>/runbook.md
    if f_name == "runbook.md":
        parent = os.path.dirname(w_norm)
        if parent == rb_root:
            slug = os.path.basename(w_norm)
            if _RUNBOOK_SLUG_RE.match(slug) and len(slug) <= _RUNBOOK_SLUG_MAX_LEN:
                return slug
    # Shape 2: event on <runbooks>/<slug> directly (create/delete of the folder)
    if w_norm == rb_root and f_name:
        if _RUNBOOK_SLUG_RE.match(f_name) and len(f_name) <= _RUNBOOK_SLUG_MAX_LEN:
            return f_name
    return None


def _handle_runbook_event(
    role, slug, events, tracked_slugs, runbooks_dir, baseline_dir, spill_dir,
):
    """Route a runbook event to add / edit / delete emission.

    `tracked_slugs` is a mutable set — the set of runbook slugs whose baseline
    exists in the state directory. This function mutates it in place:
      - Add: slug goes from untracked → tracked; write baseline, emit "added".
      - Edit: slug already tracked; diff baseline vs current, emit if changed.
      - Delete: slug goes from tracked → untracked; remove baseline, emit "deleted".

    Events we care about (uppercased set, matching inotifywait --format %e output):
      - CLOSE_WRITE / MODIFY / MOVED_TO on a runbook.md → edit or add depending
        on whether the slug was already tracked.
      - CREATE on a runbook.md (or MOVED_TO landing runbook.md into the folder)
        → same handling; the CLOSE_WRITE case covers the write-then-close path.
      - DELETE / MOVED_FROM on a runbook.md or on the slug subfolder → delete.
    """
    rb_path, base_path = _runbook_paths(runbooks_dir, baseline_dir, slug)

    is_delete = bool(events & {"DELETE", "MOVED_FROM"})
    is_write = bool(events & {"CLOSE_WRITE", "CREATE", "MOVED_TO", "MODIFY"})

    if is_delete:
        # Confirm on disk — inotifywait can fire DELETE on transient files that
        # were briefly present (editor swap files). If runbook.md is still
        # readable, treat as no-op.
        if os.path.isfile(rb_path):
            return
        if slug in tracked_slugs:
            try:
                os.remove(base_path)
            except OSError:
                pass
            tracked_slugs.discard(slug)
            _emit_runbook_deleted(role, slug)
        return

    if is_write:
        current = _read_bytes(rb_path)
        if current is None:
            # File vanished between event fire and our read — likely an editor
            # swap-file interaction. Skip silently; a real delete will fire
            # its own event.
            return
        baseline = _read_bytes(base_path) if slug in tracked_slugs else None
        if baseline is None:
            # New runbook (either we've never seen it, or the baseline was
            # cleaned up). Snapshot + emit added.
            _atomic_write_baseline(baseline_dir, base_path, current)
            tracked_slugs.add(slug)
            _emit_runbook_added(role, slug, rb_path)
            return
        if current != baseline:
            diff_stdout = _run_diff(base_path, rb_path)
            _emit_event("runbook", "%s/%s" % (role, slug), diff_stdout, spill_dir)
            _atomic_write_baseline(baseline_dir, base_path, current)


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

    # --- Runbooks tree — role-scope; empty or nonexistent is fine ---
    runbooks_dir = os.path.expanduser("~/fleet/roles/%s/runbooks" % role)
    runbooks_watched = os.path.isdir(runbooks_dir)

    # --- State dirs ---
    spill_dir = os.path.join(baseline_dir, "spilled")
    state_dir = os.path.join(baseline_dir, ".state")
    os.makedirs(state_dir, exist_ok=True)
    # `baseline_dir` may not exist yet on very first run (before role/identity
    # cold-start writes any baseline). Ensure it exists so runbook baselines
    # can be written even if the role/identity ones haven't landed yet.
    os.makedirs(baseline_dir, exist_ok=True)

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

    # --- Orphan-monitor guard (added 2026-09-05 after Noelle ate a Nelly dispatch;
    # env-override added 2026-09-13 for the ambient-monitor launcher).
    # See wakeup-scheduler.py for the full comment; short version:
    #   1) if AMBIENT_MONITOR_HARNESS_PID is set (parent is the launcher), honor it.
    #   2) else fall back to the grandparent walk (standalone launch case).
    harness_pid = None
    env_override = os.environ.get("AMBIENT_MONITOR_HARNESS_PID")
    if env_override:
        try:
            p = int(env_override)
            if p > 1:
                harness_pid = p
        except ValueError:
            pass
    if harness_pid is None:
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

    # --- Runbook cold-start / resume pass ---
    # Enumerate on-disk runbooks. For each: if no baseline → snapshot silently
    # (cold start); if baseline + file changed → emit edit diff (resume); if
    # baseline exists but file gone → emit "deleted" (resume-delete). Runs BEFORE
    # the inotifywait watch loop starts so events landing during the watch's
    # arming don't compete with cold-start baseline writes.
    tracked_runbook_slugs = _existing_baseline_slugs(baseline_dir)
    on_disk_slugs = set(_enumerate_runbook_slugs(runbooks_dir))

    # (a) On-disk runbooks — diff or cold-snapshot.
    for slug in sorted(on_disk_slugs):
        rb_path, base_path = _runbook_paths(runbooks_dir, baseline_dir, slug)
        if slug not in tracked_runbook_slugs:
            current = _read_bytes(rb_path)
            if current is None:
                # Runbook file vanished between listdir and read — race with a
                # peer identity's delete. Skip silently; the delete-side pass
                # below cleans up any dangling baseline.
                continue
            _atomic_write_baseline(baseline_dir, base_path, current)
            tracked_runbook_slugs.add(slug)
            # Silent cold-start — no emit (shape invariant).
        else:
            # Baseline exists → treat as resume. Diff if changed.
            current = _read_bytes(rb_path)
            if current is None:
                continue  # will be handled by (b) below
            baseline = _read_bytes(base_path)
            if baseline is None:
                _atomic_write_baseline(baseline_dir, base_path, current)
                continue
            if current != baseline:
                diff_stdout = _run_diff(base_path, rb_path)
                _emit_event(
                    "runbook", "%s/%s" % (role, slug), diff_stdout, spill_dir,
                )
                _atomic_write_baseline(baseline_dir, base_path, current)

    # (b) Baselines for slugs no longer on disk — the runbook was deleted while
    # we were down. Emit deletion + remove the baseline.
    for slug in sorted(tracked_runbook_slugs - on_disk_slugs):
        _, base_path = _runbook_paths(runbooks_dir, baseline_dir, slug)
        try:
            os.remove(base_path)
        except OSError:
            pass
        tracked_runbook_slugs.discard(slug)
        _emit_runbook_deleted(role, slug)

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
        # inotifywait-based watch loop with `--format` output so we can route
        # events by path. Three watched surfaces:
        #   1. role.md + identity.md — passed as explicit file arguments. Events
        #      on these are dispatched to _diff_and_emit_all(targets, …); we
        #      re-diff both fixed targets on any of their events (matches the
        #      pre-runbook behavior — cheap, no per-file bookkeeping needed).
        #   2. runbooks/ (if it exists) — passed with `-r` so newly-created
        #      slug subfolders get their inotify watches added automatically.
        #      Per-event routing via _slug_from_event isolates runbook.md
        #      events + slug-subfolder create/delete from companion churn.
        #
        # Event set — union of what fixed targets and the runbook tree need:
        #   close_write: normal file save
        #   move_self:   fixed-target inode itself renamed away → respawn
        #   delete_self: fixed-target inode unlinked (backend atomic tmp+rename over
        #                the watched file unlinks the old inode; kernel fires
        #                DELETE_SELF on the OLD inode's watch, then IN_IGNORED
        #                auto-removes it). MOVE_SELF does NOT fire here — that's
        #                only for the watched inode being the SOURCE of a rename,
        #                whereas an atomic-rename-over makes it the DISPLACED
        #                target. Without delete_self + respawn, the watch dies
        #                silently and every subsequent edit is invisible.
        #   moved_to:    fixed-target replaced OR new file landed in runbooks/
        #   delete:      runbook.md removed OR slug subfolder removed
        #   create:      slug subfolder created OR runbook.md created
        #   moved_from:  runbook.md renamed out OR slug subfolder renamed out
        role_id_paths = [t[2] for t in targets]
        watched_args = list(role_id_paths)
        if runbooks_watched:
            watched_args.append(runbooks_dir)
        inotify_events = "close_write,move_self,delete_self,moved_to,delete,create,moved_from"
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
                    ] + (["-r"] if runbooks_watched else []) + [
                        "-e", inotify_events,
                        "--format", "%w|%f|%e",
                    ] + watched_args,
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

                    event_line = event_line.rstrip("\n").rstrip("\r")
                    if not event_line:
                        continue

                    # Parse `%w|%f|%e`. inotifywait guarantees these three
                    # fields separated by `|`; on rare malformed lines (e.g.
                    # rotated stderr leaking in), skip silently.
                    parts = event_line.split("|", 2)
                    if len(parts) != 3:
                        continue
                    w_path, f_name, e_str = parts
                    events = set(e_str.split(","))

                    # (A) Route fixed-target events (role.md / identity.md).
                    # inotifywait emits `%w = <full file path>`, `%f = ""` when
                    # the watched target is a file argument (not a directory).
                    if not f_name and w_path in role_id_paths:
                        # MOVE_SELF: watched inode itself was renamed AWAY. New
                        # content may already be at the path (atomic-rename
                        # patterns overwriting the file), so emit any diff then
                        # respawn to re-arm on whatever inode now sits at the
                        # path.
                        #
                        # DELETE_SELF: watched inode was unlinked. Fires in two
                        # cases: (1) backend atomic tmp+rename over the file —
                        # a new inode is already at the path with new content;
                        # (2) genuine deletion (no replacement). If a file
                        # exists at the path shortly after the event, treat as
                        # case 1 (emit diff + respawn); otherwise treat as
                        # case 2 (fatal — the target is gone). This mirrors
                        # MOVE_SELF's respawn semantics: never silently deaf.
                        if "MOVE_SELF" in events or "DELETE_SELF" in events:
                            if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                                # Target actually gone — fatal exit (same as
                                # pre-fix DELETE_SELF behavior). _diff_and_emit
                                # returns True when the file is unreadable.
                                sys.exit(1)
                            # Respawn to re-arm on new inode.
                            try:
                                _inotify_proc.terminate()
                            except Exception:
                                pass
                            _inotify_proc = None
                            break
                        if _diff_and_emit_all(targets, baseline_dir, spill_dir):
                            sys.exit(1)
                        continue

                    # (B) Route runbook-tree events. Only fires when we're
                    # actually watching runbooks_dir (guarded by runbooks_watched).
                    if runbooks_watched:
                        slug = _slug_from_event(w_path, f_name, runbooks_dir)
                        if slug is not None:
                            _handle_runbook_event(
                                role, slug, events, tracked_runbook_slugs,
                                runbooks_dir, baseline_dir, spill_dir,
                            )
                            continue

                    # Anything else is companion churn or events on an
                    # unrelated path — ignore.

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
