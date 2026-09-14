#!/usr/bin/env python3
"""ambient-monitor — the single launcher that runs the four ambient watchers.

Usage:
  ambient-monitor <identity_dir>                                  # stdout mode (legacy)
  ambient-monitor <identity_dir> --inject-to <tmux-session> \\
                                 --harness-pid <pid>              # inject mode

What this replaces: the four separate on-wake Monitor invocations (relay receiver,
wake-up scheduler, context-watch, role-file-watch). This launcher spawns the four
pieces as subprocesses, delivers each wake line to the agent, and forwards
SIGTERM/SIGINT/SIGHUP to the children on shutdown so each piece — most importantly
the relay receiver's message-cursor flush — gets its graceful-shutdown behavior.

TWO DELIVERY MODES (see shape-supervisor-owns-ambient-monitor.md):

  stdout mode (no --inject-to) — the original arrangement. The launcher is itself a
  harness-started Monitor; wake lines go to stdout and the harness turns each line
  into an async wake. Retained because it still works and because the four pieces
  are unchanged, but no longer how the fleet runs.

  inject mode (--inject-to + --harness-pid) — the launcher runs OUTSIDE the harness,
  started by the agent-supervisor alongside the session it brought up. There is no
  harness-owned Monitor to raise events through, so each wake line is DELIVERED INTO
  the session by pasting it as a <task-notification> envelope. Why this exists at all:
  one Skynet instance is barred from having the Monitor tool present in harnesses, so
  its identities cannot receive real monitor events. Real monitor events are strictly
  more reliable and would be preferred if they were available anywhere we need them —
  injection is a constraint, never a preference.

INJECTED EVENTS ARE HONESTLY SYNTHETIC. They use the <task-notification> envelope
because that shape is already recognized, but they do NOT impersonate a real harness
task: no forged task id (real ones are `b`+8 base36 for background tasks, `a`+16 hex
for subagents), and no `[ambient]` prefix (that marker exists solely so Skynet's
ambient-filter can hide a REAL background task from its isWorking count — with no
background task present, claiming it would state something false). The summary names
what the event actually is. Identities are primed for this at load time by the id
skill, which is what makes honesty work where disguise would otherwise be needed:
an agent told at load time that the supervisor runs its watchers externally treats
these as legitimate, where the same thing arriving cold would invite suspicion.

Design rules (see shape-mega-monitor.md in the box-maintainer role's bounty folder):
  - Dumb dispatch on WHAT the children do. The launcher never interprets what
    any child emits; it only forwards output lines and manages child processes.
    No policy about content, no config surface, no per-message logic.
  - The launcher OWNS one narrow bit of identity-type-based applicability: it
    reads the identity's frontmatter for `coordinator: true` at startup, and
    that ONE bit drives two spawn-time decisions — skip the role-file-watch
    piece (coordinators don't hold role or identity file in context), and
    spawn a SECOND wakeup-scheduler pointed at the role folder (so role-general
    schedules fire on the coord). Actors: 4 children. Coordinators: 4 children
    also (recv, identity-scoped scheduler, role-scoped scheduler, context-watch —
    no file-watch). The bit lives here so the four pieces themselves stay
    100% pristine on the coord axis.
  - On child death or failed start: emit a wake line naming which piece and why,
    keep the surviving children running. NEVER auto-restart — silent recovery
    would mask bugs and rot the debugging trail.
  - On our own shutdown: forward the signal to all children BEFORE dying, and
    give them a bounded grace window to shut down cleanly (cursor flushes, etc.).
    After the grace window, escalate to SIGKILL so we don't hang forever if a
    child ignores the signal.
  - The relay receiver is CRITICAL: its death emits an unmistakably-loud wake
    line, because losing it means the identity is fully deaf to inbound messages.
    (Not a separate policy — a note about how the death-wake line is formatted.)

Vendored into Skynet's substrate and distributed to every host running agent
substrate. Stdlib only.
"""

import json
import os
import re
import sys
import signal
import subprocess
import tempfile
import threading
import time
import pathlib

GRACE_SECONDS = 10  # window we give children to shut down cleanly on our own shutdown
REAP_POLL_SECONDS = 1  # how often the reap loop checks for dead children

# ---------------------------------------------------------------- args + paths
def _usage(msg=None):
    if msg:
        print("ambient-monitor: %s" % msg, file=sys.stderr)
    print("usage: ambient-monitor <identity_dir> "
          "[--inject-to <tmux-session> --harness-pid <pid>]", file=sys.stderr)
    sys.exit(2)


_argv = sys.argv[1:]
if not _argv:
    _usage()

_positional = []
INJECT_SESSION = None
INJECT_HARNESS_PID = None
_i = 0
while _i < len(_argv):
    a = _argv[_i]
    if a == "--inject-to":
        if _i + 1 >= len(_argv):
            _usage("--inject-to requires a tmux session name")
        INJECT_SESSION = _argv[_i + 1]
        _i += 2
    elif a == "--harness-pid":
        if _i + 1 >= len(_argv):
            _usage("--harness-pid requires a pid")
        try:
            INJECT_HARNESS_PID = int(_argv[_i + 1])
        except ValueError:
            _usage("--harness-pid must be an integer, got %r" % _argv[_i + 1])
        _i += 2
    elif a.startswith("-"):
        _usage("unknown flag %r" % a)
    else:
        _positional.append(a)
        _i += 1

if len(_positional) != 1:
    _usage("expected exactly one identity_dir, got %d" % len(_positional))

# Inject mode requires BOTH flags. Accepting --inject-to alone would leave us with no
# harness to watch, so the launcher could outlive the session it serves — the exact
# orphan-watcher failure the shape names as unacceptable. Fail loud at startup instead.
if (INJECT_SESSION is None) != (INJECT_HARNESS_PID is None):
    _usage("--inject-to and --harness-pid must be given together")

INJECT_MODE = INJECT_SESSION is not None

IDENTITY_DIR = pathlib.Path(_positional[0]).expanduser().resolve()
if not IDENTITY_DIR.is_dir():
    print("ambient-monitor: identity_dir does not exist or is not a directory: %s"
          % IDENTITY_DIR, file=sys.stderr)
    sys.exit(2)

IDENTITY_NAME = IDENTITY_DIR.name
HOME = pathlib.Path.home()

# ---------------------------------------------------------- harness-pid capture
# Orphan-monitor guard, defense-in-depth. We (the launcher) walk up TWO PPid
# levels to find the harness (Claude Code) process: our direct parent is the
# bash-c wrapper the Monitor tool spawns, and its parent is Claude. The wrapper
# stays alive as a waiter even after Claude dies, so a bare $PPID check would
# never fire. We watch Claude ourselves in _harness_watch() below, AND we
# propagate the captured PID to every child via AMBIENT_MONITOR_HARNESS_PID so
# they can honor it too (each of the four watchers has env-override logic).
# Belt-and-suspenders: launcher-side check triggers _do_shutdown so children get
# cursor-flush grace; child-side check is a safety net for the case where the
# launcher itself is force-killed without a chance to shut down cleanly.
# See bounty orphan-monitor-self-suicide-check for original context.
#
# In INJECT MODE the grandparent walk is meaningless — our parent is the supervisor, not
# the harness — so the supervisor tells us the harness PID explicitly via --harness-pid
# and we use that verbatim. The self-termination property is identical either way: we
# watch the harness process and shut down cleanly when it goes, so a watcher can never
# outlive the session it serves.
HARNESS_PID = None
if INJECT_MODE:
    HARNESS_PID = INJECT_HARNESS_PID
else:
    try:
        with open("/proc/%d/status" % os.getppid()) as f:
            for line in f:
                if line.startswith("PPid:"):
                    p = int(line.split()[1])
                    if p > 1:
                        HARNESS_PID = p
                    break
    except (OSError, ValueError):
        pass

# --------------------------------------------------- relay account discovery
# Enumerate relay accounts BY CONTENT, not filename. Any *.json file at
# <idroot>/ or <idroot>/*/ that contains base + user_id + password keys is
# treated as a Matrix relay account. State dir = same folder as the cred file,
# named after the filename stem + "-state" (so relay.json → relay-state/,
# relay-aithercloud.json → relay-aithercloud-state/, aithercloud/relay.json →
# aithercloud/relay-state/).
#
# Why content-based instead of a narrower filename glob: agents self-registering
# on secondary homeservers name their cred files however feels natural at the
# time (george/relay-aithercloud.json, etc.). A wider glob + a strict content
# filter picks up whatever they choose without prescribing a naming convention.
# The old exactly-relay.json / <subdir>/relay.json layout is a strict subset —
# every previous identity keeps working because "relay" + "-state" = the
# existing "relay-state" folder.
#
# recv.sh needs STATE_DIR to exist before it launches. Its cred resolver walks
# `$(dirname $STATE_DIR)/relay.json` by default, so we ALSO set RELAY_CREDS
# explicitly to the exact file (recv.sh L19 honors this env var) — that way the
# resolver doesn't have to guess when the filename is anything other than
# relay.json.
RELAY_REQUIRED_KEYS = ("base", "user_id", "password")


def _looks_like_relay_creds(path):
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        return False
    if not isinstance(data, dict):
        return False
    return all(isinstance(data.get(k), str) and data[k] for k in RELAY_REQUIRED_KEYS)


def _discover_relay_accounts(idroot):
    """Return list of (cred_path, state_dir, label) for every relay account.
    Enumerates one level deep. Deterministic (sorted) so wake lines + metric
    labels stay stable across launches.
    """
    accounts = []
    candidates = sorted(idroot.glob("*.json")) + sorted(idroot.glob("*/*.json"))
    for c in candidates:
        if not c.is_file() or not _looks_like_relay_creds(c):
            continue
        state_dir = c.parent / (c.stem + "-state")
        # Label mirrors the supervisor's matrix_peek account naming: filename
        # stem at top level; "<subdir>/<stem>" when nested one deep.
        if c.parent == idroot:
            label = c.stem
        else:
            label = "%s/%s" % (c.parent.name, c.stem)
        accounts.append((c, state_dir, label))
    return accounts


RELAY_ACCOUNTS = _discover_relay_accounts(IDENTITY_DIR)
for _, _sd, _ in RELAY_ACCOUNTS:
    _sd.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------- coord detection
_ROLE_NAME_OK = re.compile(r"^[a-z0-9][a-z0-9_-]*$")


def _read_frontmatter(identity_file):
    """Return (role, is_coordinator) parsed from the identity file's YAML frontmatter.
    Frontmatter is the block between the FIRST two `---` fence lines. Missing file /
    missing frontmatter / missing role → (None, False), and the caller decides how
    loudly to complain (role-file-watch already surfaces its own SETUP FAILED wake
    when it can't resolve; the launcher stays quiet and lets pieces surface their
    own diagnostics).

    The role value is stripped of surrounding YAML quotes and whitespace, then
    validated against a strict identifier pattern (kebab-case, lowercase alphanumeric
    with hyphens/underscores). A quoted role like `role: "box-maintainer"` yields
    `box-maintainer`; a malformed role like `role: ../../tmp` returns (None, ...)
    so the caller falls through to the unresolved-role branch rather than doing a
    path-traversal makedirs. Encoding is `utf-8-sig` so a UTF-8 BOM (Windows
    notepad-style) doesn't silently mask the first fence line.
    """
    try:
        with open(identity_file, encoding="utf-8-sig") as f:
            lines = f.readlines()
    except OSError:
        return None, False
    fences = [i for i, ln in enumerate(lines) if ln.strip() == "---"]
    if len(fences) < 2:
        return None, False
    role = None
    is_coord = False
    for line in lines[fences[0] + 1: fences[1]]:
        stripped = line.lstrip()
        if stripped.startswith("#"):
            continue
        m_role = re.match(r"^role:\s*(.+?)\s*(#.*)?$", line.rstrip("\n"))
        if m_role and role is None:
            raw = m_role.group(1).strip().strip('"').strip("'").strip()
            if _ROLE_NAME_OK.match(raw):
                role = raw
            continue
        # Strict coordinator detection: top-level YAML key (col 0), unquoted bare
        # `true`, optionally followed by a trailing YAML comment. Matches the id
        # skill body's coordinator-mode strict-detection rule verbatim.
        if re.match(r"^coordinator:\s*true\s*(#.*)?$", line.rstrip("\n")):
            is_coord = True
    return role, is_coord


IDENTITY_FILE = IDENTITY_DIR / ("%s.md" % IDENTITY_NAME)
ROLE_NAME, IS_COORDINATOR = _read_frontmatter(IDENTITY_FILE)

# --------------------------------------------------------------- child specs
# Build the child list based on identity type. The launcher owns exactly ONE bit
# of policy — coordinator-vs-actor — and uses it here at spawn time. From this
# point on, dispatch is dumb: each entry in CHILDREN just gets spawned and
# forwarded.
CHILDREN = []
for _cred_path, _state_dir, _label in RELAY_ACCOUNTS:
    CHILDREN.append({
        "name": "relay-receiver:%s" % _label,
        "cmd": ["bash", str(HOME / ".claude/skills/agent-relay/recv.sh")],
        "env_extra": {
            "STATE_DIR": str(_state_dir),
            "SINCE_FILE": str(_state_dir / "since"),
            "RELAY_CREDS": str(_cred_path),
        },
        "critical": True,
    })
CHILDREN.append({
    "name": "wakeup-scheduler",
    "cmd": ["python3", str(HOME / ".local/bin/wakeup-scheduler"), str(IDENTITY_DIR)],
    "env_extra": {},
    "critical": False,
})
CHILDREN.append({
    "name": "context-watch",
    "cmd": ["python3", str(HOME / ".local/bin/context-watch"), str(IDENTITY_DIR)],
    "env_extra": {},
    "critical": False,
})

if IS_COORDINATOR:
    # Coordinators: no file-watch (they don't hold role or identity file in
    # context the same way actors do), PLUS an extra scheduler pointed at the
    # role folder so role-general schedules still fire. Requires a resolvable
    # AND existing role folder; if either check fails, fall back to spawning
    # role-file-watch so its own SETUP FAILED wake surfaces the underlying
    # misconfig (rather than silently pointing a scheduler at a nonexistent
    # path — the scheduler would makedirs a phantom role folder and never
    # find any specs).
    role_folder = None
    if ROLE_NAME is not None:
        candidate = HOME / "fleet" / "roles" / ROLE_NAME
        if candidate.is_dir():
            role_folder = candidate
    if role_folder is not None:
        CHILDREN.append({
            "name": "wakeup-scheduler-role",
            "cmd": ["python3", str(HOME / ".local/bin/wakeup-scheduler"), str(role_folder)],
            "env_extra": {},
            "critical": False,
        })
    else:
        # Couldn't resolve or find the role folder — spawn file-watch so its
        # own SETUP FAILED wake surfaces the underlying misconfig loudly.
        CHILDREN.append({
            "name": "role-file-watch",
            "cmd": ["python3", str(HOME / ".local/bin/role-file-watch"), str(IDENTITY_DIR)],
            "env_extra": {},
            "critical": False,
        })
else:
    CHILDREN.append({
        "name": "role-file-watch",
        "cmd": ["python3", str(HOME / ".local/bin/role-file-watch"), str(IDENTITY_DIR)],
        "env_extra": {},
        "critical": False,
    })

# ---------------------------------------------------------------------- I/O
# stdout is the wake stream: every line becomes an async wake to the agent.
# stderr is the harness's output file for this Monitor: readable via the Read
# tool, but NOT a wake stream. Children's stderr routes to our stderr; our own
# diagnostics also go there. Wake lines go to stdout ONLY.
_stdout_lock = threading.Lock()
_stderr_lock = threading.Lock()


def emit_diag(msg):
    with _stderr_lock:
        sys.stderr.write("ambient-monitor: " + msg.rstrip("\n") + "\n")
        sys.stderr.flush()


# ------------------------------------------------------- injection (inject mode)
# Deliver a wake line INTO the harness by pasting a <task-notification> envelope into
# its tmux pane. Reuses the paste discipline the supervisor's resume-nudge arrived at
# after a series of real observed failures (see agent-supervisor.sh submit_resume_nudge):
#
#   * load-buffer + paste-buffer -p (bracketed paste) rather than send-keys -l. Ink
#     drops plain typed bytes when it is mid-render; bracketed paste survives that.
#   * Enter as a SEPARATE call after a short settle, because the paste can land while
#     the keystroke that commits it does not.
#   * Enter-only retries — never a re-paste. A leading C-c or a second paste would wipe
#     or double a paste that actually succeeded, which is precisely the bug that made
#     the nudge's original retry loop unable to converge.
#
# Deliberately NOT here (shape § Scope OUT — "making delivery robust"): transcript
# verification, acknowledgement, queueing of undelivered events. We reuse what is proven
# and ship; hardening is a later pass driven by real observed problems. What we do NOT
# trade away is visibility — a delivery that fails is recorded loudly on stderr, because
# an unreliable mechanism whose failures are invisible is a system that quietly stops
# working and nobody notices.
ENVELOPE_SUMMARY = "Ambient watcher event (%s) — delivered by agent-supervisor" % IDENTITY_NAME
INJECT_SETTLE_SECONDS = 0.5
INJECT_ENTER_RETRIES = 3
INJECT_ENTER_SPACING_SECONDS = 2
_inject_lock = threading.Lock()


def _tmux(*args, timeout=10):
    """Run a tmux command with a bounded timeout. Returns True on clean exit.
    Bounded because a wedged tmux server would otherwise hang the delivery thread
    indefinitely and stall every subsequent event behind it.
    """
    try:
        r = subprocess.run(("tmux",) + args, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL, timeout=timeout)
        return r.returncode == 0
    except (subprocess.TimeoutExpired, OSError):
        return False


def _envelope(event_text):
    return (
        "<task-notification>\n"
        "<summary>%s</summary>\n"
        "<event>%s</event>\n"
        "</task-notification>"
    ) % (ENVELOPE_SUMMARY, event_text.rstrip("\n"))


def _harness_alive():
    """True if the harness we were told to inject into is still running.

    Restores a safety property the old stdout channel had implicitly. Under stdout
    delivery the pipe was OWNED by the harness's Monitor, so it became undeliverable
    at the exact moment the harness died — you could not write into a dead session
    because the channel died first. A tmux pane has the opposite property: it OUTLIVES
    the harness. Pasting into it after the harness is gone hands the text to whatever
    now owns the pane — a bash prompt — which then executes it. Since wake lines
    embed arbitrary text (relay message bodies verbatim), that is a shell-execution
    hazard, not just cosmetic noise.
    """
    if HARNESS_PID is None:
        return False
    try:
        os.kill(HARNESS_PID, 0)
        return True
    except OSError:
        return False


def _inject(event_text):
    """Paste one wake line into the harness pane. Serialized: two concurrent pastes
    would interleave in the tmux paste buffer and produce one corrupt turn instead of
    two clean ones.
    """
    payload = _envelope(event_text)
    with _inject_lock:
        # Checked inside the lock and as late as possible: shutdown races mean a
        # queued event can reach here after the harness has already gone (children
        # emitting final lines, the reap loop noticing deaths it caused). A residual
        # TOCTOU window remains -- the pane-command guard below is the backstop.
        if not _harness_alive():
            emit_diag("harness (pid=%s) gone — event NOT injected, logged instead: %s"
                      % (HARNESS_PID, event_text[:200]))
            return False
        # Backstop for the residual race: refuse to paste when the pane is sitting at
        # a shell. Denylisting shells is more robust than trying to guess every name
        # the harness process might present as.
        try:
            r = subprocess.run(
                ("tmux", "display-message", "-p", "-t", INJECT_SESSION,
                 "#{pane_current_command}"),
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                timeout=10, text=True)
            pane_cmd = (r.stdout or "").strip()
        except (subprocess.TimeoutExpired, OSError):
            pane_cmd = ""
        if pane_cmd in ("bash", "sh", "zsh", "dash", "fish"):
            emit_diag("pane %s is at a shell (%s) — event NOT injected, logged "
                      "instead: %s" % (INJECT_SESSION, pane_cmd, event_text[:200]))
            return False
        tmp = None
        try:
            fd, tmp = tempfile.mkstemp(prefix="ambient-inject-")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write(payload)
            if not _tmux("load-buffer", "-t", INJECT_SESSION, tmp):
                emit_diag("INJECTION FAILED (load-buffer) for session %s — event NOT delivered: %s"
                          % (INJECT_SESSION, event_text[:200]))
                return False
            if not _tmux("paste-buffer", "-p", "-t", INJECT_SESSION):
                emit_diag("INJECTION FAILED (paste-buffer) for session %s — event NOT delivered: %s"
                          % (INJECT_SESSION, event_text[:200]))
                return False
        finally:
            if tmp:
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
        time.sleep(INJECT_SETTLE_SECONDS)
        committed = _tmux("send-keys", "-t", INJECT_SESSION, "Enter")
        # Enter-only retries: if the paste landed but its Enter didn't commit, an extra
        # Enter commits it. At an already-empty compose an extra Enter is a harmless no-op.
        for _ in range(INJECT_ENTER_RETRIES):
            if committed:
                break
            time.sleep(INJECT_ENTER_SPACING_SECONDS)
            committed = _tmux("send-keys", "-t", INJECT_SESSION, "Enter")
        if not committed:
            emit_diag("INJECTION FAILED (Enter never committed after %d retries) for session %s "
                      "— event may be sitting uncommitted in compose: %s"
                      % (INJECT_ENTER_RETRIES, INJECT_SESSION, event_text[:200]))
            return False
        return True


def emit_wake(msg):
    """Deliver one wake line to the agent — stdout in legacy mode, injection in inject mode."""
    line = msg.rstrip("\n")
    if not line:
        return
    if INJECT_MODE:
        _inject(line)
        return
    with _stdout_lock:
        sys.stdout.write(line + "\n")
        sys.stdout.flush()


# ---------------------------------------------------------------- pumps
def _pump_stdout(name, stream):
    try:
        for line in stream:
            emit_wake(line)
    except Exception as e:
        emit_diag("stdout pump for %s ended: %r" % (name, e))


def _pump_stderr(name, stream):
    try:
        for line in stream:
            with _stderr_lock:
                sys.stderr.write("[%s] %s" % (name, line if line.endswith("\n") else line + "\n"))
                sys.stderr.flush()
    except Exception as e:
        emit_diag("stderr pump for %s ended: %r" % (name, e))


# ---------------------------------------------------------------- child mgmt
running = []  # list of dicts: {spec, popen, threads, death_announced}


def start_child(spec):
    env = os.environ.copy()
    env.update(spec["env_extra"])
    # Propagate the captured harness PID so each child can install its own
    # orphan-check that watches Claude directly (not their own parent = us).
    # See § harness-pid capture near the top of the file. Absent when we
    # couldn't resolve Claude ourselves; the four watchers fall back to their
    # standalone grandparent-walk when this env var is unset.
    if HARNESS_PID is not None:
        env["AMBIENT_MONITOR_HARNESS_PID"] = str(HARNESS_PID)
    try:
        p = subprocess.Popen(
            spec["cmd"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            bufsize=1,
            text=True,
            env=env,
            start_new_session=True,  # own process group -> we can signal the subtree
        )
    except FileNotFoundError as e:
        emit_wake("⚠️ [ambient-monitor: %s] %s FAILED TO START: executable not found — %s"
                  % (IDENTITY_NAME, spec["name"], e))
        return None
    except Exception as e:
        emit_wake("⚠️ [ambient-monitor: %s] %s FAILED TO START: %r"
                  % (IDENTITY_NAME, spec["name"], e))
        return None
    t_out = threading.Thread(target=_pump_stdout, args=(spec["name"], p.stdout), daemon=True)
    t_err = threading.Thread(target=_pump_stderr, args=(spec["name"], p.stderr), daemon=True)
    t_out.start()
    t_err.start()
    return {"spec": spec, "popen": p, "threads": [t_out, t_err], "death_announced": False}


# ---------------------------------------------------------------- shutdown
shutting_down = threading.Event()
_exit_code = [0]


def _shutdown_handler(sig, _frame):
    if not shutting_down.is_set():
        emit_diag("shutdown signal received (sig=%d)" % sig)
    shutting_down.set()


signal.signal(signal.SIGTERM, _shutdown_handler)
signal.signal(signal.SIGINT, _shutdown_handler)
try:
    signal.signal(signal.SIGHUP, _shutdown_handler)
except (AttributeError, ValueError):
    pass


def _do_shutdown():
    live = [e for e in running if e["popen"].poll() is None]
    emit_diag("forwarding SIGTERM to %d live child(ren)" % len(live))
    for entry in live:
        p = entry["popen"]
        try:
            os.killpg(os.getpgid(p.pid), signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError) as e:
            emit_diag("could not SIGTERM %s: %r" % (entry["spec"]["name"], e))
    # Grace window — receiver especially needs this to flush its message cursor.
    deadline = time.time() + GRACE_SECONDS
    for entry in live:
        p = entry["popen"]
        remaining = max(0.1, deadline - time.time())
        try:
            p.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            emit_diag("%s did not exit within %ds grace; escalating to SIGKILL"
                      % (entry["spec"]["name"], GRACE_SECONDS))
            try:
                os.killpg(os.getpgid(p.pid), signal.SIGKILL)
            except (ProcessLookupError, PermissionError, OSError):
                pass


# ---------------------------------------------------------------- reap
def _death_wake(entry, rc):
    spec = entry["spec"]
    if spec["critical"]:
        emit_wake(
            "⚠️⚠️⚠️ [ambient-monitor: %s] CRITICAL: %s EXITED (rc=%d) — the identity "
            "is no longer receiving relay messages. The ambient-monitor is still "
            "running the other watchers; check stderr for %s's last diagnostics, "
            "then restart the ambient-monitor to recover message reception."
            % (IDENTITY_NAME, spec["name"], rc, spec["name"])
        )
    else:
        emit_wake(
            "⚠️ [ambient-monitor: %s] %s exited (rc=%d); other watchers still running. "
            "Check stderr for its last diagnostics."
            % (IDENTITY_NAME, spec["name"], rc)
        )


def _reap_loop():
    while not shutting_down.is_set():
        alive_count = 0
        for entry in running:
            p = entry["popen"]
            rc = p.poll()
            if rc is None:
                alive_count += 1
                continue
            if not entry["death_announced"]:
                # Give stderr pump a beat to drain the last diagnostics before
                # the wake lands, so the wake follows the diagnostic in time.
                time.sleep(0.3)
                _death_wake(entry, rc)
                entry["death_announced"] = True
        if alive_count == 0:
            emit_wake(
                "⚠️⚠️⚠️ [ambient-monitor: %s] ALL WATCHERS HAVE DIED — the ambient "
                "monitor has nothing left to supervise and is exiting. The identity "
                "is fully deaf until the ambient-monitor is relaunched."
                % IDENTITY_NAME
            )
            _exit_code[0] = 1
            shutting_down.set()
            return
        time.sleep(REAP_POLL_SECONDS)


# ---------------------------------------------------------------- go
if not RELAY_ACCOUNTS:
    emit_wake(
        "⚠️ [ambient-monitor: %s] NO RELAY ACCOUNTS DISCOVERED — no *.json file in "
        "%s or its immediate subdirectories has base+user_id+password keys. Identity "
        "is deaf to inbound DMs until creds are provisioned. Other watchers still "
        "starting." % (IDENTITY_NAME, IDENTITY_DIR)
    )
else:
    emit_diag("discovered %d relay account(s): %s"
              % (len(RELAY_ACCOUNTS), ", ".join(a[2] for a in RELAY_ACCOUNTS)))
emit_diag("starting %d child(ren) for identity %s (role=%s, coordinator=%s, harness_pid=%s, "
          "delivery=%s)"
          % (len(CHILDREN), IDENTITY_NAME, ROLE_NAME, IS_COORDINATOR, HARNESS_PID,
             ("inject->tmux:%s" % INJECT_SESSION) if INJECT_MODE else "stdout"))

# In inject mode a missing harness PID is fatal, not a degraded mode: without it the
# harness-watch below is disabled, so we would keep running — and keep pasting into a
# pane — after the session died. That is the orphan-watcher failure the shape forbids.
# (Unreachable via CLI parsing, which requires both flags; guards a future caller.)
if INJECT_MODE and HARNESS_PID is None:
    emit_diag("FATAL: inject mode with no harness PID — refusing to start (would orphan)")
    sys.exit(2)
for spec in CHILDREN:
    entry = start_child(spec)
    if entry is not None:
        running.append(entry)

if not running:
    emit_wake(
        "⚠️⚠️⚠️ [ambient-monitor: %s] NO CHILDREN STARTED — nothing to supervise. Exiting."
        % IDENTITY_NAME
    )
    sys.exit(1)

reap_thread = threading.Thread(target=_reap_loop, daemon=True)
reap_thread.start()


def _harness_watch():
    """Poll the captured harness PID once per second; on death, trigger a clean
    shutdown (so children — the receiver especially — get their SIGTERM-with-grace
    and can flush cursors before exiting). This is the launcher-side half of the
    defense-in-depth orphan check; the four children have their own child-side
    half via AMBIENT_MONITOR_HARNESS_PID (see § harness-pid capture).
    """
    if HARNESS_PID is None:
        emit_diag("harness-watch disabled (couldn't resolve harness PID)")
        return
    while not shutting_down.is_set():
        try:
            os.kill(HARNESS_PID, 0)
        except OSError:
            # Log, never wake: this fires BECAUSE the harness died, so there is no
            # agent left to tell. Under stdout delivery the write went into a broken
            # pipe and vanished; under injection the pane outlives the harness, so a
            # wake here pastes into whatever now owns it (a bash prompt) and gets
            # executed as shell.
            emit_diag("harness process (pid=%d) exited; shutting down cleanly so "
                      "children can flush state." % HARNESS_PID)
            shutting_down.set()
            return
        time.sleep(1)


harness_watch_thread = threading.Thread(target=_harness_watch, daemon=True)
harness_watch_thread.start()

# Main thread waits on shutdown signal (either external or all-dead self-trigger).
while not shutting_down.is_set():
    time.sleep(1)

_do_shutdown()
sys.exit(_exit_code[0])
