#!/usr/bin/env python3
"""inbox-watcher — fifth ambient-watcher child, delivery substrate for inbox messages.

Usage:
  inbox-watcher <identity_dir>

What this is (see shape-agent-supervisor-inbox.md):

  Watches `<identity_dir>/inbox/` for message files dropped by any process on
  this box. When a complete, correctly-named file lands, surfaces its path up to
  the ambient-monitor parent via a stdout line of the form

      RAW-PASTE-FILE:<absolute path>

  The parent reads the file bytes, pastes them bare (no envelope — this is user
  speech, not a watcher event), and removes the file from the inbox folder,
  regardless of paste outcome. The parent owns the delete so (a) the raw bytes
  never need to travel through the line-oriented child-to-parent IPC channel
  and (b) a parent crash between surface and paste leaves the file in the inbox
  for the next startup's catch-up sweep.

The dropper's contract:
  1. compute filename:  YYYYMMDDTHHMMSSmmm + "-" + 8 random hex chars + ".msg"
  2. mkdir -p <identity_dir>/inbox
  3. write payload bytes to <name>.tmp (any name not matching the final shape)
  4. atomically mv <name>.tmp → <name>
  5. done — no sentinel drop, no wake probe, no response wait

This child enforces step 4's load-bearing semantics by filtering events on the
final filename shape — mid-write temp files, operator notes, and other stray
artifacts in the inbox are ignored.

Catch-up on startup: any valid-shape file already in the inbox when this child
launches is surfaced in lexical (= arrival) order before entering the watch
loop. This covers the dormancy case where the agent-supervisor woke the
harness because the inbox was non-empty — the fresh ambient-monitor spawns
this child, which drains the pending files on startup.

Vendored into Skynet's substrate and distributed to every host running agent
substrate. Stdlib + inotifywait subprocess only.
"""

import os
import pathlib
import re
import shutil
import signal
import subprocess
import sys
import threading

# ---------- argv
if len(sys.argv) != 2:
    print("usage: inbox-watcher <identity_dir>", file=sys.stderr)
    sys.exit(2)

IDENTITY_DIR = pathlib.Path(sys.argv[1]).expanduser().resolve()
if not IDENTITY_DIR.is_dir():
    print("inbox-watcher: identity_dir does not exist: %s" % IDENTITY_DIR,
          file=sys.stderr)
    sys.exit(2)

IDENTITY_NAME = IDENTITY_DIR.name
INBOX_DIR = IDENTITY_DIR / "inbox"

# Final-filename shape — same regex the parent would use if it were double-
# checking. Timestamp = YYYYMMDDTHHMMSSmmm (18 chars, year starts with "20").
# Hex suffix = 8 lowercase hex chars (openssl rand -hex 4 output).
FINAL_NAME_RE = re.compile(r"^20[0-9]{6}T[0-9]{9}-[0-9a-f]{8}\.msg$")

RAW_PASTE_PREFIX = "RAW-PASTE-FILE:"

# ---------- diag
_stderr_lock = threading.Lock()
_stdout_lock = threading.Lock()


def diag(msg):
    with _stderr_lock:
        sys.stderr.write("inbox-watcher: " + msg.rstrip("\n") + "\n")
        sys.stderr.flush()


def surface(abs_path):
    """Emit one RAW-PASTE-FILE: line to the parent. Serialized."""
    line = RAW_PASTE_PREFIX + abs_path + "\n"
    with _stdout_lock:
        sys.stdout.write(line)
        sys.stdout.flush()


# ---------- signal handlers (register early)
_inotify_proc = None
_shutting_down = threading.Event()


def _shutdown_handler(sig, _frame):
    _shutting_down.set()
    global _inotify_proc
    if _inotify_proc is not None:
        try:
            _inotify_proc.terminate()
        except Exception:
            pass


signal.signal(signal.SIGTERM, _shutdown_handler)
signal.signal(signal.SIGINT, _shutdown_handler)
try:
    signal.signal(signal.SIGHUP, _shutdown_handler)
except (AttributeError, ValueError):
    pass

# ---------- orphan-monitor guard (mirrors role-file-watch.py pattern).
# AMBIENT_MONITOR_HARNESS_PID is set by the launcher; absent means standalone
# launch (grandparent walk fallback). Absent in both cases means no orphan
# check — logged, continues.
HARNESS_PID = None
_env_override = os.environ.get("AMBIENT_MONITOR_HARNESS_PID")
if _env_override:
    try:
        _p = int(_env_override)
        if _p > 1:
            HARNESS_PID = _p
    except ValueError:
        pass
if HARNESS_PID is None:
    try:
        with open("/proc/%d/status" % os.getppid()) as _f:
            for _line in _f:
                if _line.startswith("PPid:"):
                    _p = int(_line.split()[1])
                    if _p > 1:
                        HARNESS_PID = _p
                    break
    except (OSError, ValueError):
        pass
if HARNESS_PID is None:
    diag("orphan-check disabled (couldn't resolve harness PID)")


def _harness_alive():
    if HARNESS_PID is None:
        return True  # no PID known → don't self-terminate on indeterminate state
    try:
        os.kill(HARNESS_PID, 0)
        return True
    except OSError:
        return False


# ---------- inbox folder setup
# Create on-demand if absent. The dropper is CONTRACTUALLY required to mkdir -p
# as part of its own atomic responsibility (per the shape's dropper contract),
# but creating here too is harmless and means inotify has something to watch
# from the moment this child starts — avoiding a startup race where the first
# dropper arrives before anyone else has created the folder.
try:
    INBOX_DIR.mkdir(parents=True, exist_ok=True)
except OSError as e:
    diag("FATAL: cannot create inbox folder %s: %r" % (INBOX_DIR, e))
    sys.exit(1)

diag("started on %s (harness_pid=%s)" % (INBOX_DIR, HARNESS_PID))

# ---------- catch-up sweep (startup)
# Any valid-shape file already in the inbox when we start is surfaced in
# lexical order BEFORE the inotify watch arms. Covers:
#   - dormancy wake: supervisor woke the harness because files were waiting;
#     we drain them on first start.
#   - crash recovery: a prior ambient-monitor crashed with unprocessed files;
#     next spawn picks them up.
#   - startup-delay catch-up: a dropper landed a file during the parent's
#     5-second startup delay; it's already in the inbox when we start.
try:
    _existing = sorted(
        p for p in INBOX_DIR.iterdir()
        if p.is_file() and FINAL_NAME_RE.match(p.name)
    )
except OSError as e:
    diag("catch-up sweep failed to list %s: %r" % (INBOX_DIR, e))
    _existing = []

if _existing:
    diag("catch-up: %d pending file(s) found at startup" % len(_existing))
    for _f in _existing:
        if _shutting_down.is_set():
            break
        surface(str(_f))
else:
    diag("catch-up: no pending files")


# ---------- inotify watch loop
# Watch for:
#   moved_to    — the canonical write-and-rename landing event
#   close_write — direct writes (cp, echo >, redirect) that don't go through
#                 the rename. Still filtered by name-shape, so a dropper that
#                 skipped the write-and-rename step but used the right final
#                 name still works. Operator convenience; not the contract.
#
# Format: `%w|%f|%e` where %w = watched dir, %f = filename, %e = comma-
# separated event flags.
#
# inotifywait is a hard requirement — the fleet guarantees its presence via
# agent-supervisor.sh's ensure_inotifywait at supervisor startup, and the
# shape names "watches the inbox via inotify" as the mechanism. If
# inotifywait is unexpectedly absent (startup) or vanishes mid-flight
# (would be a very strange event), the child hard-exits with a loud stderr
# line so ambient-monitor's launcher surfaces the death wake. No polling
# fallback — defending against a condition the fleet guarantees doesn't
# happen is scope creep that complicates the semantics for no real benefit.
INOTIFY_EVENTS = "moved_to,close_write"
INOTIFY_BACKOFF_MIN = 1
INOTIFY_BACKOFF_MAX = 60

# Startup check: fail loud if inotifywait is missing.
if shutil.which("inotifywait") is None:
    diag("FATAL: inotifywait not found on PATH — this box is misconfigured "
         "(agent-supervisor.sh's ensure_inotifywait should have installed it); "
         "the inbox-watcher cannot operate without inotify and will exit now. "
         "Install inotify-tools and restart the harness to recover.")
    sys.exit(1)


def _inotify_loop():
    global _inotify_proc
    backoff = 0
    while not _shutting_down.is_set():
        if not _harness_alive():
            diag("harness gone — exiting inotify loop")
            return
        if backoff > 0:
            if _shutting_down.wait(backoff):
                return
        try:
            _inotify_proc = subprocess.Popen(
                [
                    "inotifywait", "-m",
                    "-e", INOTIFY_EVENTS,
                    "--format", "%w|%f|%e",
                    str(INBOX_DIR),
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except FileNotFoundError as e:
            # inotifywait disappeared mid-flight (passed the startup check,
            # now gone). This is pathological — package removed under us,
            # someone yanked PATH, etc. Not retriable; die loud so the
            # launcher's death-wake surfaces it.
            diag("FATAL: inotifywait vanished after startup check (%r) — "
                 "exiting; restart the harness after fixing the install" % e)
            sys.exit(1)
        except OSError as e:
            # Transient: EMFILE (fd table exhausted), ENOMEM, etc. Back off
            # and retry — the condition may clear.
            diag("inotifywait failed to start: %r — backing off %ds"
                 % (e, max(backoff, INOTIFY_BACKOFF_MIN)))
            backoff = min(max(backoff * 2, INOTIFY_BACKOFF_MIN), INOTIFY_BACKOFF_MAX)
            continue
        try:
            for event_line in _inotify_proc.stdout:
                # Any event = healthy inotifywait. Reset backoff.
                backoff = 0
                if _shutting_down.is_set():
                    return
                if not _harness_alive():
                    diag("harness gone (mid-event) — exiting")
                    return
                event_line = event_line.rstrip("\n").rstrip("\r")
                if not event_line:
                    continue
                parts = event_line.split("|", 2)
                if len(parts) != 3:
                    continue
                watched, fname, _events = parts
                if not FINAL_NAME_RE.match(fname):
                    continue
                full = os.path.join(watched.rstrip("/"), fname)
                # Belt-and-suspenders: confirm on disk before surfacing.
                # inotify can fire moved_to for a file that's immediately
                # moved out again (unlikely but legal).
                if not os.path.isfile(full):
                    continue
                surface(full)
        except Exception as e:
            diag("inotify read ended: %r" % e)
        finally:
            if _inotify_proc is not None:
                try:
                    _inotify_proc.terminate()
                    _inotify_proc.wait(timeout=5)
                except Exception:
                    try:
                        _inotify_proc.kill()
                    except Exception:
                        pass
                _inotify_proc = None
        # If we fell out of the for-loop without shutdown, inotifywait died.
        # Loop and respawn with backoff.
        if not _shutting_down.is_set():
            diag("inotifywait exited unexpectedly — will respawn")
            backoff = min(max(backoff * 2, INOTIFY_BACKOFF_MIN), INOTIFY_BACKOFF_MAX)


_inotify_loop()

diag("exiting cleanly")
sys.exit(0)
