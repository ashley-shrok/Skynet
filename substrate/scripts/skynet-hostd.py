#!/usr/bin/env python3
"""skynet-hostd — runs Skynet's routine commands over one long-lived SSH channel.

Why: over Tailscale SSH every exec channel is a fresh login (a logind session
per command). Skynet's pollers send several commands a second per host, which
churns logins and, on some hosts, sets off a polkitd leak. Skynet starts this
helper ONCE per long-lived connection and sends every routine command through
it, so the whole stream of commands costs one login.

Backend side: src/backend/ssh/hostd-channel.ts (protocol mirror lives there).

Protocol — one compact JSON object per line, both directions:
    helper -> Skynet, on start:  {"t":"hello","v":1,"pid":N}
    Skynet -> helper:            {"t":"exec","id":S,"cmd":S,"timeout_ms":N,"stdin":B64?}
    helper -> Skynet:            {"t":"result","id":S,"code":N|null,"out":B64,"err":B64,
                                  "ms":N,"timeout":bool,"truncated":bool}
    Skynet -> helper:            {"t":"ping","id":S}
    helper -> Skynet:            {"t":"pong","id":S}
    helper -> Skynet, on a bad request line: {"t":"error","id":S|null,"msg":S}

Behavior:
    * Each command runs as `<login shell> -c <cmd>` in $HOME, in its own
      process group — the same shape an SSH exec gives it.
    * Up to MAX_RUNNING commands run at once; the rest queue. The time limit
      counts from when the request arrives, so a queued command that runs out
      of time is reported as a timeout without being started.
    * On timeout the command's whole process group gets SIGTERM, then SIGKILL
      after KILL_GRACE_S. A command is never killed for finishing normally, so
      things it deliberately detaches (tmux new-session -d, setsid) survive.
    * Output past OUTPUT_CAP bytes (stdout + stderr together) kills the
      command and reports truncated=true.
    * When stdin closes (Skynet hung up or the channel dropped) every running
      command's process group is killed and the helper exits — nothing is
      left behind on the host.

Distribution: not installed anywhere. The backend reads this file from the
image and starts it as `python3 -c '<this source>'` on each channel open, so
the helper always matches the running Skynet. Stdlib only; Python 3.8+.
"""
import base64
import json
import os
import pwd
import queue
import signal
import subprocess
import sys
import threading
import time

PROTOCOL_VERSION = 1
MAX_RUNNING = 32
OUTPUT_CAP = 8 * 1024 * 1024
KILL_GRACE_S = 2.0
DEFAULT_TIMEOUT_MS = 30 * 60 * 1000
READ_CHUNK = 65536

_out_lock = threading.Lock()
_running_lock = threading.Lock()
_running = {}  # id -> Popen
_shutting_down = threading.Event()


def _login_shell():
    try:
        shell = pwd.getpwuid(os.getuid()).pw_shell
        if shell and os.path.isfile(shell) and os.access(shell, os.X_OK):
            return shell
    except KeyError:
        pass
    return "/bin/sh"


SHELL = _login_shell()
HOME = os.environ.get("HOME") or os.path.expanduser("~")


def emit(obj):
    line = json.dumps(obj, separators=(",", ":")) + "\n"
    with _out_lock:
        try:
            sys.stdout.write(line)
            sys.stdout.flush()
        except (BrokenPipeError, OSError):
            # Skynet is gone; stdin EOF will drive the shutdown.
            _shutting_down.set()


def b64(data):
    return base64.b64encode(data).decode("ascii")


def kill_group(proc, sig):
    try:
        os.killpg(proc.pid, sig)
    except (ProcessLookupError, PermissionError, OSError):
        pass


def terminate_group(proc):
    """SIGTERM the group, then SIGKILL whatever is left after the grace."""
    kill_group(proc, signal.SIGTERM)
    deadline = time.monotonic() + KILL_GRACE_S
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            break
        time.sleep(0.05)
    # The leader may have exited while children in its group linger.
    kill_group(proc, signal.SIGKILL)


def run_command(req, received_at):
    req_id = req["id"]
    timeout_ms = req.get("timeout_ms") or DEFAULT_TIMEOUT_MS
    deadline = received_at + timeout_ms / 1000.0
    stdin_b64 = req.get("stdin")
    stdin_bytes = base64.b64decode(stdin_b64) if stdin_b64 else None

    if time.monotonic() >= deadline:
        emit({"t": "result", "id": req_id, "code": None, "out": "", "err": "",
              "ms": int((time.monotonic() - received_at) * 1000),
              "timeout": True, "truncated": False})
        return

    try:
        proc = subprocess.Popen(
            [SHELL, "-c", req["cmd"]],
            stdin=subprocess.PIPE if stdin_bytes is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=HOME if os.path.isdir(HOME) else "/",
            start_new_session=True,
        )
    except OSError as e:
        emit({"t": "result", "id": req_id, "code": 127, "out": "",
              "err": b64(("skynet-hostd: spawn failed: %s\n" % e).encode()),
              "ms": int((time.monotonic() - received_at) * 1000),
              "timeout": False, "truncated": False})
        return

    with _running_lock:
        _running[req_id] = proc

    out_chunks, err_chunks = [], []
    total = [0]
    truncated = [False]
    size_lock = threading.Lock()

    def pump(stream, sink):
        while True:
            try:
                chunk = stream.read1(READ_CHUNK) if hasattr(stream, "read1") else stream.read(READ_CHUNK)
            except (OSError, ValueError):
                break
            if not chunk:
                break
            with size_lock:
                room = OUTPUT_CAP - total[0]
                over = len(chunk) > room
                if over:
                    chunk = chunk[:max(0, room)]
                    truncated[0] = True
                total[0] += len(chunk)
            if chunk:
                sink.append(chunk)
            if over:
                # Keep draining (so the command can't block on a full pipe)
                # but stop it now.
                kill_group(proc, signal.SIGKILL)

    readers = [
        threading.Thread(target=pump, args=(proc.stdout, out_chunks), daemon=True),
        threading.Thread(target=pump, args=(proc.stderr, err_chunks), daemon=True),
    ]
    for t in readers:
        t.start()

    if stdin_bytes is not None:
        def feed():
            try:
                proc.stdin.write(stdin_bytes)
            except (BrokenPipeError, OSError):
                pass
            finally:
                try:
                    proc.stdin.close()
                except OSError:
                    pass
        threading.Thread(target=feed, daemon=True).start()

    timed_out = False
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            terminate_group(proc)
            break
        try:
            proc.wait(timeout=min(remaining, 0.5))
            break
        except subprocess.TimeoutExpired:
            if _shutting_down.is_set():
                break

    # Wait for output to drain. A background child that inherited stdout keeps
    # the pipe open past the leader's exit — the same wait an SSH exec has —
    # so the drain is bounded by the command's deadline too.
    for t in readers:
        t.join(timeout=max(0.0, deadline - time.monotonic()))
    if any(t.is_alive() for t in readers):
        if not timed_out:
            timed_out = True
            terminate_group(proc)
        # Anything still holding the pipe after the group kill left the
        # group (setsid). Give it a moment, then stop waiting on it.
        for t in readers:
            t.join(timeout=1.0)

    with _running_lock:
        _running.pop(req_id, None)

    code = proc.poll()
    emit({
        "t": "result",
        "id": req_id,
        "code": None if timed_out else code,
        "out": b64(b"".join(out_chunks)),
        "err": b64(b"".join(err_chunks)),
        "ms": int((time.monotonic() - received_at) * 1000),
        "timeout": timed_out,
        "truncated": truncated[0],
    })


def worker(jobs):
    while True:
        item = jobs.get()
        if item is None:
            return
        req, received_at = item
        try:
            run_command(req, received_at)
        except Exception as e:  # never let one command take the helper down
            emit({"t": "result", "id": req.get("id"), "code": 1, "out": "",
                  "err": b64(("skynet-hostd: internal error: %s\n" % e).encode()),
                  "ms": int((time.monotonic() - received_at) * 1000),
                  "timeout": False, "truncated": False})


def shutdown():
    _shutting_down.set()
    with _running_lock:
        procs = list(_running.values())
    for p in procs:
        kill_group(p, signal.SIGTERM)
    deadline = time.monotonic() + KILL_GRACE_S
    for p in procs:
        while p.poll() is None and time.monotonic() < deadline:
            time.sleep(0.05)
    for p in procs:
        kill_group(p, signal.SIGKILL)


def main():
    # A dropped channel can deliver SIGHUP/SIGPIPE before stdin EOF; handle
    # both the same way as EOF.
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    signal.signal(signal.SIGHUP, lambda *_: (shutdown(), os._exit(0)))
    signal.signal(signal.SIGTERM, lambda *_: (shutdown(), os._exit(0)))

    jobs = queue.Queue()
    for _ in range(MAX_RUNNING):
        threading.Thread(target=worker, args=(jobs,), daemon=True).start()

    emit({"t": "hello", "v": PROTOCOL_VERSION, "pid": os.getpid()})

    stdin = sys.stdin.buffer
    while True:
        line = stdin.readline()
        if not line:
            break
        received_at = time.monotonic()
        try:
            req = json.loads(line)
        except ValueError:
            emit({"t": "error", "id": None, "msg": "bad json"})
            continue
        if not isinstance(req, dict):
            emit({"t": "error", "id": None, "msg": "not an object"})
            continue
        kind = req.get("t")
        if kind == "ping":
            emit({"t": "pong", "id": req.get("id")})
        elif kind == "exec" and isinstance(req.get("cmd"), str) and req.get("id") is not None:
            jobs.put((req, received_at))
        else:
            emit({"t": "error", "id": req.get("id"), "msg": "unknown request"})

    shutdown()
    os._exit(0)


if __name__ == "__main__":
    main()
