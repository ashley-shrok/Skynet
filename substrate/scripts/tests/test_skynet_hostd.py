#!/usr/bin/env python3
"""skynet-hostd against its real protocol.

Starts substrate/scripts/skynet-hostd.py as a subprocess and drives it over
stdin/stdout the way the backend's hostd-channel.ts does. Run from the repo root:

    python3 substrate/scripts/tests/test_skynet_hostd.py

Prints PASS/FAIL per test and a `PASS: n  FAIL: m` summary; exits non-zero on failure.
"""
import base64
import json
import os
import queue
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
HOSTD = os.path.join(HERE, "..", "skynet-hostd.py")


class Hostd:
    def __init__(self):
        self.proc = subprocess.Popen(
            [sys.executable, HOSTD],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        self.lines = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()
        self.hello = self.next(5)

    def _read(self):
        for line in self.proc.stdout:
            self.lines.put(json.loads(line))
        self.lines.put(None)

    def send(self, obj):
        self.proc.stdin.write((json.dumps(obj) + "\n").encode())
        self.proc.stdin.flush()

    def next(self, timeout=10):
        return self.lines.get(timeout=timeout)

    def exec(self, req_id, cmd, timeout_ms=10000, stdin=None):
        req = {"t": "exec", "id": req_id, "cmd": cmd, "timeout_ms": timeout_ms}
        if stdin is not None:
            req["stdin"] = base64.b64encode(stdin).decode()
        self.send(req)

    def results(self, n, timeout=15):
        got = {}
        end = time.monotonic() + timeout
        while len(got) < n:
            msg = self.next(max(0.1, end - time.monotonic()))
            if msg is None:
                break
            if msg.get("t") == "result":
                got[msg["id"]] = msg
        return got

    def close(self):
        try:
            self.proc.stdin.close()
        except OSError:
            pass
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()


def out(msg):
    return base64.b64decode(msg["out"]).decode()


def err(msg):
    return base64.b64decode(msg["err"]).decode()


def pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # A zombie still answers kill(0); check state.
    try:
        with open("/proc/%d/stat" % pid) as f:
            return f.read().split(")")[-1].split()[0] != "Z"
    except OSError:
        return False


TESTS = []


def test(fn):
    TESTS.append(fn)
    return fn


@test
def hello_reports_version():
    h = Hostd()
    try:
        assert h.hello["t"] == "hello" and h.hello["v"] == 1, h.hello
    finally:
        h.close()


@test
def exec_returns_stdout_stderr_and_code():
    h = Hostd()
    try:
        h.exec("a", "echo hi; echo oops >&2; exit 3")
        r = h.results(1)["a"]
        assert out(r) == "hi\n", r
        assert err(r) == "oops\n", r
        assert r["code"] == 3 and r["timeout"] is False, r
    finally:
        h.close()


@test
def runs_in_home_with_login_shell():
    h = Hostd()
    try:
        h.exec("a", "pwd")
        r = h.results(1)["a"]
        assert out(r).strip() == os.path.realpath(os.path.expanduser("~")), out(r)
    finally:
        h.close()


@test
def stdin_is_fed_to_the_command():
    h = Hostd()
    try:
        body = os.urandom(300000)
        h.exec("a", "wc -c", stdin=body)
        r = h.results(1)["a"]
        assert out(r).strip() == str(len(body)), out(r)
    finally:
        h.close()


@test
def commands_run_concurrently():
    h = Hostd()
    try:
        t0 = time.monotonic()
        for i in range(5):
            h.exec("s%d" % i, "sleep 1")
        got = h.results(5)
        elapsed = time.monotonic() - t0
        assert len(got) == 5, got
        assert elapsed < 3, "5 x sleep 1 took %.1fs — not concurrent" % elapsed
    finally:
        h.close()


@test
def slow_command_does_not_block_fast_one():
    h = Hostd()
    try:
        h.exec("slow", "sleep 3")
        h.exec("fast", "echo quick")
        first = None
        while first is None:
            msg = h.next(10)
            if msg and msg.get("t") == "result":
                first = msg
        assert first["id"] == "fast", first
        h.results(1)
    finally:
        h.close()


@test
def timeout_kills_the_whole_process_group():
    h = Hostd()
    try:
        tmp = tempfile.mktemp()
        # The child sleeps in the background inside the same group and
        # writes its pid so we can check it died with the leader.
        h.exec("a", "sleep 60 & echo $! > %s; wait" % tmp, timeout_ms=700)
        r = h.results(1)["a"]
        assert r["timeout"] is True and r["code"] is None, r
        time.sleep(0.3)
        child = int(open(tmp).read().strip())
        os.unlink(tmp)
        assert not pid_alive(child), "background child %d survived the timeout" % child
    finally:
        h.close()


@test
def detached_processes_survive_normal_completion():
    h = Hostd()
    try:
        tmp = tempfile.mktemp()
        h.exec("a", "setsid sleep 30 >/dev/null 2>&1 < /dev/null & echo $! > %s" % tmp)
        r = h.results(1)["a"]
        assert r["timeout"] is False and r["code"] == 0, r
        time.sleep(0.3)
        child = int(open(tmp).read().strip())
        os.unlink(tmp)
        assert pid_alive(child), "detached process was killed"
        os.kill(child, 9)
    finally:
        h.close()


@test
def output_cap_truncates_and_kills():
    h = Hostd()
    try:
        h.exec("a", "head -c 20000000 /dev/zero; sleep 30", timeout_ms=20000)
        r = h.results(1, timeout=25)["a"]
        assert r["truncated"] is True, {k: v for k, v in r.items() if k != "out"}
        assert len(base64.b64decode(r["out"])) <= 8 * 1024 * 1024
        assert r["ms"] < 15000, "capped command was not killed promptly: %dms" % r["ms"]
    finally:
        h.close()


@test
def ping_gets_pong():
    h = Hostd()
    try:
        h.send({"t": "ping", "id": "p1"})
        msg = h.next(5)
        assert msg == {"t": "pong", "id": "p1"}, msg
    finally:
        h.close()


@test
def bad_lines_get_errors_and_do_not_kill_helper():
    h = Hostd()
    try:
        h.proc.stdin.write(b"not json\n")
        h.proc.stdin.flush()
        msg = h.next(5)
        assert msg["t"] == "error", msg
        h.send({"t": "nope", "id": "x"})
        msg = h.next(5)
        assert msg["t"] == "error" and msg["id"] == "x", msg
        h.exec("a", "echo still here")
        assert out(h.results(1)["a"]) == "still here\n"
    finally:
        h.close()


@test
def stdin_close_kills_running_commands_and_exits():
    h = Hostd()
    tmp = tempfile.mktemp()
    h.exec("a", "sleep 60 & echo $! > %s; wait" % tmp, timeout_ms=120000)
    deadline = time.monotonic() + 5
    while not (os.path.exists(tmp) and open(tmp).read().strip()):
        assert time.monotonic() < deadline, "command never started"
        time.sleep(0.05)
    child = int(open(tmp).read().strip())
    os.unlink(tmp)
    h.proc.stdin.close()
    h.proc.wait(timeout=10)
    time.sleep(0.3)
    assert not pid_alive(child), "running command survived helper shutdown"


@test
def queued_command_past_its_deadline_is_not_run():
    h = Hostd()
    try:
        tmp = tempfile.mktemp()
        # Fill every worker, then queue one with a short limit.
        for i in range(32):
            h.exec("busy%d" % i, "sleep 2")
        h.exec("late", "touch %s" % tmp, timeout_ms=300)
        got = h.results(33, timeout=20)
        assert got["late"]["timeout"] is True, got["late"]
        assert not os.path.exists(tmp), "expired queued command still ran"
    finally:
        h.close()


def main():
    passed = failed = 0
    for fn in TESTS:
        try:
            fn()
            print("PASS", fn.__name__)
            passed += 1
        except Exception as e:
            print("FAIL", fn.__name__, "-", repr(e))
            failed += 1
    print("PASS: %d  FAIL: %d" % (passed, failed))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
