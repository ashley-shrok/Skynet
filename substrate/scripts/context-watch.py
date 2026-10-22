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

How it measures: runs `~/.local/bin/pv-context-pct-sweep --identities <name>` — the
same distributor-shipped script the app's context meter uses — and reads its
`context_pct`. That script finds this identity's session JSONL (the newest one whose
first turn is `/id <name>`, so a recycled or resumed session is picked up on the next
poll) and divides the last assistant turn's input + cache tokens by the 1M window. The
fleet runs with DISABLE_AUTO_COMPACT=1, so no autocompact buffer is subtracted. One
formula, one place: the nudge fires at exactly the % the user sees on the meter.

Load-bearing rules from earlier experience running this:
  - Re-run discovery EVERY poll — a recycle or `--resume` writes a fresh JSONL, and
    caching the path silently reads the stale file forever after.
  - Skip-tick when there is no pct yet (no JSONL, or no assistant turn yet) — first
    boot is a normal state that resolves within a turn; do not treat as error.
  - Do NOT gate on JSONL mtime — an idle claude has an old mtime but the value is
    still accurate (context doesn't move without turns).

The loop (thresholds are % of the context window USED; higher = fuller):
  - can't read a pct (no session JSONL / no usage turn yet / sweep failed) -> skip
    this poll, try next.
  - below the nudge threshold -> clear the fired-flags (RE-ARM). A fresh recycled
    session starts here, so this is how the flags reset with zero coupling to the
    recycle mechanism.
  - >= nudge (default 90), once -> print a SOFT nudge: at your next stopping point run
    `/id reset` (it saves, then drops the recycle sentinel). Finish current work first.
  - >= ping (default 95), once -> print a LOUD wake: recycle overdue, ping @user on
    the relay now + run `/id reset` immediately. (Shouldn't fire — agents comply on the
    nudge well before here; this is the human backstop.)

The recycle itself is the agent-supervisor's job: when the agent runs `/id reset` (which
touches `<identity_dir>/.recycle-requested`), the supervisor kills the current claude and
re-drives a fresh `claude + /id <name>` into the same tmux session. The SINCE_FILE relay
cursor means the fresh session catches any messages from the ~seconds of restart.

Vendored into the app's substrate and distributed to every host running agent substrate
via the substrate distributor (see feature 02). Stdlib only.

Usage:  python3 context-watch.py <identity_dir>
Env:    CTXWATCH_POLL_SEC   (default 180)  loop granularity; context climbs slowly.
        CTXWATCH_NUDGE_PCT  (default 90)   soft "save + sentinel at next stop" threshold.
        CTXWATCH_PING_PCT   (default 95)   loud "recycle overdue, ping user" threshold.
        CTXWATCH_SWEEP      (override)     pct script; default ~/.local/bin/pv-context-pct-sweep.
"""

import json
import os
import subprocess
import sys
import time

POLL = int(os.environ.get("CTXWATCH_POLL_SEC", "180"))
NUDGE = int(os.environ.get("CTXWATCH_NUDGE_PCT", "90"))
PING = int(os.environ.get("CTXWATCH_PING_PCT", "95"))
SWEEP = os.environ.get("CTXWATCH_SWEEP") or os.path.expanduser(
    "~/.local/bin/pv-context-pct-sweep")
SWEEP_TIMEOUT_SEC = 30


def _read_pct(name):
    """Return the context-usage % (int 0-100) for identity `name`, or None if there is
    no pct yet or the sweep script failed. Diagnostics go to STDERR: ambient-monitor
    treats every stdout line as a wake to the agent."""
    try:
        out = subprocess.run(
            [SWEEP, "--identities", name],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            timeout=SWEEP_TIMEOUT_SEC, check=False,
        ).stdout.decode("utf-8", errors="replace")
    except (OSError, subprocess.SubprocessError) as e:
        print("context-watch: sweep failed (%s): %s" % (SWEEP, e),
              file=sys.stderr, flush=True)
        return None
    for line in out.splitlines():
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if isinstance(rec, dict) and rec.get("identity") == name:
            pct = rec.get("context_pct")
            if isinstance(pct, (int, float)):
                return max(0, min(100, int(pct)))
    return None


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

    # Orphan-monitor guard (added 2026-09-05 after Noelle ate a Nelly dispatch;
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
        print("context-watch: orphan-check disabled (couldn't resolve grandparent)",
              file=sys.stderr, flush=True)

    while True:
        if harness_pid is not None:
            try:
                os.kill(harness_pid, 0)  # signal 0: existence check only, sends nothing
            except OSError:
                sys.exit(0)              # harness gone — self-exit before any nudge
        pct = _read_pct(name)
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
                    "Right now: message @user on the relay that you're at the context "
                    "limit, then run `/id reset` immediately." % (name, pct),
                    flush=True,
                )
                mark(pinged_f)
        time.sleep(POLL)


if __name__ == "__main__":
    main()
