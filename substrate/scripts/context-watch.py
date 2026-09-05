"""context-watch.py — keep a long-running /id agent from silently drifting through
context compaction, by recycling it into a fresh session BEFORE the window fills.

The third on-wake Monitor, sibling of the relay receiver and the wake-up scheduler.
The receiver wakes on a MESSAGE, the scheduler wakes on the CLOCK, this one wakes on
CONTEXT PRESSURE. Same primitive: launched once on wake as a persistent `Monitor`,
it prints a line when a threshold is crossed and that line is an async wake.

Why this exists: repeated auto-compaction is a lossy summary-of-a-summary, and it does
NOT reliably reset instruction/persona drift. The authoritative identity lives on disk;
the running context is just a cache of it. So rather than preserve a degrading cache,
we recycle it at a controlled moment — a fresh `/id <name>` load is perfectly faithful.

How it measures (2026-09-01 rewrite — Tanya-informed): reads the harness's own context
number from the statusline bridge file at `/tmp/claude-ctx-<CLAUDE_CODE_SESSION_ID>.json`.
The gsd-statusline hook writes this file on every statusline invocation with
`{session_id, remaining_percentage, used_pct, timestamp}`; `used_pct` is pre-normalized
against the 16.5% autocompact buffer, so we consume it verbatim.

The previous approach scraped the pct from tmux `capture-pane -p` output (the hook wrote
the pct as the first 2 chars of the visible statusline). That worked but coupled us to
pane width, ANSI rendering, and the leading-digits convention. The bridge file is the
harness's authoritative value with none of those hops.

Load-bearing rules from Tanya's Skynet experience:
  - Re-resolve `CLAUDE_CODE_SESSION_ID` from env EVERY poll — a `--resume` produces a
    fresh session id + fresh bridge file, and caching the path silently reads the stale
    file forever after resume.
  - Skip-tick on bridge-file ENOENT — first-boot before the hook has fired once is a
    normal state that resolves within a turn; do not treat as error.
  - Do NOT gate on bridge-file mtime — an idle claude has an old mtime but the value
    is still accurate (context doesn't move without turns).
  - If the statusline hook isn't installed at all, no bridge file will ever appear —
    log that once on startup so the operator sees why the watch is silent.

The loop (thresholds are % of the context window USED; higher = fuller):
  - can't read a pct (bridge file missing or malformed) -> skip this poll, try next.
  - below the nudge threshold -> clear the fired-flags (RE-ARM). A fresh recycled
    session starts here, so this is how the flags reset with zero coupling to the
    recycle mechanism.
  - >= nudge (default 80), once -> print a SOFT nudge: at your next stopping point run
    `/id reset` (it saves, then drops the recycle sentinel). Finish current work first.
  - >= ping (default 95), once -> print a LOUD wake: recycle overdue, ping @ashley on
    the relay now + run `/id reset` immediately. (Shouldn't fire — agents comply on the
    nudge well before here; this is the human backstop.)

The recycle itself is the agent-supervisor's job: when the agent runs `/id reset` (which
touches `<identity_dir>/.recycle-requested`), the supervisor kills the current claude and
re-drives a fresh `claude + /id <name>` into the same tmux session. The SINCE_FILE relay
cursor means the fresh session catches any messages from the ~seconds of restart.

Vendored into Skynet's substrate and distributed to every host running agent substrate
via the Skynet distributor (see feature 02). Stdlib only.

Usage:  python3 context-watch.py <identity_dir>
Env:    CTXWATCH_POLL_SEC   (default 180)  loop granularity; context climbs slowly.
        CTXWATCH_NUDGE_PCT  (default 80)   soft "save + sentinel at next stop" threshold.
        CTXWATCH_PING_PCT   (default 95)   loud "recycle overdue, ping Ashley" threshold.
        CTXWATCH_BRIDGE_DIR (override)     dir to look for bridge files; default = tempdir.
"""

import glob
import json
import os
import sys
import tempfile
import time

POLL = int(os.environ.get("CTXWATCH_POLL_SEC", "180"))
NUDGE = int(os.environ.get("CTXWATCH_NUDGE_PCT", "80"))
PING = int(os.environ.get("CTXWATCH_PING_PCT", "95"))
BRIDGE_DIR = os.environ.get("CTXWATCH_BRIDGE_DIR") or tempfile.gettempdir()


def _bridge_path():
    """Resolve the bridge file path FRESH from env each call — never cache.

    Rationale: `claude --resume` produces a fresh CLAUDE_CODE_SESSION_ID and a fresh
    bridge file. If we cached the path at startup we would silently read the stale
    pre-resume file forever. Env is dirt-cheap to re-read; do it every tick.
    """
    sid = os.environ.get("CLAUDE_CODE_SESSION_ID")
    if not sid:
        return None
    return os.path.join(BRIDGE_DIR, f"claude-ctx-{sid}.json")


def _read_pct():
    """Return the context-usage % (int 0-100) from the bridge file, or None if the
    file doesn't exist yet, or if it's malformed. mtime is intentionally NOT checked —
    an idle claude has an old mtime but the value is still accurate."""
    path = _bridge_path()
    if not path:
        return None
    try:
        with open(path) as f:
            data = json.load(f)
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError):
        return None
    try:
        pct = int(data["used_pct"])
    except (KeyError, TypeError, ValueError):
        return None
    return max(0, min(100, pct))


def _hook_installed_check():
    """Startup defensive check: is the statusline hook writing bridge files at all?
    If BRIDGE_DIR has never seen a `claude-ctx-*.json`, the hook isn't installed
    on this box and this watch will be silent forever. Log once so the operator sees
    why. Does NOT gate startup — the hook may be installed and just haven't fired
    yet on a fresh box."""
    any_bridge = glob.glob(os.path.join(BRIDGE_DIR, "claude-ctx-*.json"))
    if not any_bridge:
        print(
            "ℹ️ [context-watch startup] no bridge files in %s — "
            "statusline hook may not be installed. Watch will remain silent "
            "until the hook writes its first bridge file. This is fine on a "
            "brand-new box before the first agent turn." % BRIDGE_DIR,
            flush=True,
        )


def _single_instance(state_dir, ident_dir):
    """Newest-wins guard: kill any prior context-watch for THIS identity, claim the pidfile."""
    pf = os.path.join(state_dir, "ctxwatch.pid")
    try:
        old = int(open(pf).read().strip())
        if old != os.getpid():
            try:
                cmd = open("/proc/%d/cmdline" % old).read()
            except Exception:
                cmd = os.popen("ps -p %d -o command= 2>/dev/null" % old).read()
            if "context-watch" in cmd and ident_dir in cmd:
                os.kill(old, 15)
    except Exception:
        pass
    open(pf, "w").write(str(os.getpid()))


def main():
    if len(sys.argv) < 2:
        print("usage: python3 context-watch.py <identity_dir>", file=sys.stderr)
        sys.exit(2)
    ident_dir = os.path.abspath(os.path.expanduser(sys.argv[1]))
    name = os.path.basename(ident_dir)
    state_dir = os.path.join(ident_dir, "ctxwatch", ".state")
    os.makedirs(state_dir, exist_ok=True)
    _single_instance(state_dir, ident_dir)
    _hook_installed_check()

    nudged_f = os.path.join(state_dir, "nudged")
    pinged_f = os.path.join(state_dir, "pinged")

    def fired(f):
        return os.path.exists(f)

    def mark(f):
        open(f, "w").write(str(int(time.time())))

    def clear():
        for f in (nudged_f, pinged_f):
            try:
                os.remove(f)
            except OSError:
                pass

    # Orphan-monitor guard (added 2026-09-05 after Noelle ate a Nelly dispatch).
    # Capture harness (Claude Code) PID at startup — our GRANDPARENT, not $PPID (which is
    # the bash-c wrapper the Monitor tool spawns; the wrapper stays alive as a waiter even
    # when Claude dies). Check per iteration below; if Claude is gone, exit(0) — matches
    # the fix in recv.sh + wakeup-scheduler.py. See bounty orphan-monitor-self-suicide-check.
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
        print("context-watch: orphan-check disabled (couldn't resolve grandparent)",
              file=sys.stderr, flush=True)

    while True:
        if harness_pid is not None:
            try:
                os.kill(harness_pid, 0)  # signal 0: existence check only, sends nothing
            except OSError:
                sys.exit(0)              # harness gone — self-exit before any nudge
        pct = _read_pct()
        if pct is None:
            time.sleep(POLL)
            continue
        if pct < NUDGE:
            # below threshold (incl. a just-recycled fresh session) -> re-arm.
            if fired(nudged_f) or fired(pinged_f):
                clear()
        else:
            if pct >= NUDGE and not fired(nudged_f):
                print(
                    "⚠️ [context-watch: %s] context at %d%% — at your NEXT "
                    "stopping point run `/id reset` (it saves, then recycles you into a "
                    "fresh session with your identity + bounties reloaded clean; the relay "
                    "cursor means no messages are missed). Finish what you're doing first — "
                    "this is not urgent." % (name, pct),
                    flush=True,
                )
                mark(nudged_f)
            if pct >= PING and not fired(pinged_f):
                print(
                    "\U0001f6a8 [context-watch: %s] context at %d%% — recycle OVERDUE. "
                    "Right now: message @ashley on the relay that you're at the context "
                    "limit, then run `/id reset` immediately." % (name, pct),
                    flush=True,
                )
                mark(pinged_f)
        time.sleep(POLL)


if __name__ == "__main__":
    main()
