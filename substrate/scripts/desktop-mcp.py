#!/usr/bin/env python3
"""desktop-mcp — one MCP server per host that lets every identity see and drive its own desktop.

Canonical copy lives in the app's source repo at substrate/scripts/desktop-mcp.py and
is distributed to every managed host by the fleet-substrate distributor (see
src/backend/distributor/catalog.ts). Installed per-box at ~/.local/bin/desktop-mcp and
run by desktop-mcp.service (a user unit, `desktop-mcp serve`). Do NOT hand-edit the
installed copy.

Why one per host: an MCP server registered as stdio is spawned once per claude session,
used or not, so every session paid for a desktop server it mostly never touched. This
one speaks MCP over HTTP on 127.0.0.1, so a session costs nothing until it calls a
tool. agent-supervisor passes each launch a shared config (~/.claude/desktop-mcp.json)
whose X-Fleet-Identity header is filled from $FLEET_IDENTITY, so the server knows whose
desktop to drive. The agent sees tools named mcp__desktop__<tool>.

Trust: a tool call must carry X-Fleet-Desktop-Key, an HMAC of the identity name under a
host key (~/.config/desktop-mcp/key, mode 0600, created on first use). The supervisor
gets each identity's value from `desktop-mcp secret <name>` and puts it in the launch
env as $DESKTOP_MCP_SECRET, which the shared config expands. Requests carrying an Origin
header are refused, and only 127.0.0.1 is bound.

Transport: MCP Streamable HTTP, JSON responses, stateless — a restart is invisible to idle
sessions (a call in flight at that moment fails). The only server-initiated message is the
one-time tools/list_changed on a session's event stream while the browser tool list is
still being fetched. stdlib only. Run with no arguments it is instead a
stdio MCP server for $FLEET_IDENTITY alone (what older supervisors launch).

The action set mirrors Anthropic's computer-use tool (screenshot, click, type, key,
scroll, drag, ...) so the model is already fluent in it. Input goes through xdotool and
screenshots through ImageMagick's `import`, both against the identity's own X display,
which `agent-desktop up` allocates and starts. The desktop is started lazily on the
first tool call. Calls for one identity run one at a time; identities run in parallel.

Browser tools (browser_*): Playwright MCP (@playwright/mcp, pinned in agent-desktop) runs
HEADED on the identity's desktop under its own browser host (`desktop-mcp browser-host`,
started by `agent-desktop browser up` on the first browser_* call and stopped with the
desktop), which keeps one session with it and listens on a Unix socket in the identity's
desktop state dir. It lives outside this process so a restart here never closes anyone's
tabs; this server forwards each browser_* call over that socket. Its tool list is cached
under ~/.cache/agent-desktop/; on a cold cache `serve` fetches it in the background at
startup (retrying until it works) and announces it to sessions launched before then.
Each identity keeps a persistent browser profile in its desktop state dir, so sign-ins
survive restarts. If Chromium isn't installed, the first failing call triggers one
best-effort `playwright install`.

Human control: while ~/fleet/identities/<name>/desktop/control-lock is a live lease
(renewed within CONTROL_LEASE_SECONDS; see agent-desktop control), input actions are
refused with a "user has control" message; screenshot, cursor_position and the
read-only browser tools (snapshot, screenshot, console, network) still work so the agent
can watch.
"""

import base64
import hashlib
import hmac
import json
import os
import re
import queue
import secrets
import shlex
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

SERVER_NAME = "desktop"
SERVER_VERSION = "0.2.0"
SUPPORTED_PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")
INSTRUCTIONS = (
    "Your own virtual desktop (a Linux X display only you use). Take a screenshot to see it; "
    "coordinates are pixels in that screenshot. The user may be watching it live."
)
SETTLE_SECONDS = float(os.environ.get("DESKTOP_MCP_SETTLE_SECONDS", "0.5"))
AGENT_DESKTOP = shutil.which("agent-desktop") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "agent-desktop"
)
PORT = int(os.environ.get("DESKTOP_MCP_PORT", "7794"))
KEY_FILE = os.path.expanduser(os.environ.get("DESKTOP_MCP_KEY_FILE", "~/.config/desktop-mcp/key"))
# Tool calls run at once across identities; more wait their turn. Health checks and
# handshakes never wait.
MAX_CALLS = int(os.environ.get("DESKTOP_MCP_MAX_HANDLERS", "32"))
MAX_BODY = 4 * 1024 * 1024
# How long a session's event stream is held waiting for the browser tool list; it
# reconnects after, and is held again while the fetch is still going.
LIST_CHANGED_WAIT = 600
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
# Absolute directories separated by ':', printable characters only.
PATH_RE = re.compile(r"^/[^\x00-\x1f\x7f]*$")

# Must match PLAYWRIGHT_MCP_PKG in agent-desktop (which runs the browser); used here
# only to fetch the tool list.
PLAYWRIGHT_MCP_PKG = os.environ.get("DESKTOP_MCP_PLAYWRIGHT_PKG", "@playwright/mcp@0.0.83")
# Tests swap in a fake MCP server here; the real thing is `npx -y <pkg>`.
PLAYWRIGHT_CMD_OVERRIDE = os.environ.get("DESKTOP_MCP_PLAYWRIGHT_CMD", "")
TOOLS_CACHE_DIR = os.path.join(os.path.expanduser("~"), ".cache", "agent-desktop")
BROWSER_CALL_TIMEOUT = 180
# `agent-desktop browser up`: desktop start (agent-desktop's 20s) + browser host start
# (agent-desktop waits up to 300s — the host's own handshake limit, for a first download).
BROWSER_UP_TIMEOUT = 360
# Must match CONTROL_LEASE_SECONDS in agent-desktop: a control lock not renewed
# for this long is stale (the user's tab closed) and no longer pauses the agent.
CONTROL_LEASE_SECONDS = 90
# Browser tools that only observe; allowed while the user has control.
BROWSER_READ_ONLY = {
    "browser_snapshot",
    "browser_take_screenshot",
    "browser_console_messages",
    "browser_network_requests",
    "browser_network_request",
}
BROWSER_MISSING_RE = re.compile(r"not installed|Executable doesn't exist|playwright install", re.I)

SCREENSHOT_PROP = {
    "screenshot": {
        "type": "boolean",
        "description": "Return a screenshot after the action (default true).",
    }
}


def log(msg):
    print("%s %s" % (time.strftime("%Y-%m-%dT%H:%M:%S"), msg), file=sys.stderr, flush=True)


def _xy(desc_x="X coordinate in screen pixels", desc_y="Y coordinate in screen pixels"):
    return {"x": {"type": "integer", "description": desc_x}, "y": {"type": "integer", "description": desc_y}}


TOOLS = [
    {
        "name": "screenshot",
        "description": (
            "Capture your desktop's screen. Coordinates in every other tool are pixels in this image "
            "(origin top-left). Starts your desktop if it is not running yet."
        ),
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "click",
        "description": "Move the mouse to (x, y) and click. Use clicks=2 for a double-click.",
        "inputSchema": {
            "type": "object",
            "properties": {
                **_xy(),
                "button": {"type": "string", "enum": ["left", "right", "middle"], "description": "Default left."},
                "clicks": {"type": "integer", "minimum": 1, "maximum": 3, "description": "Default 1."},
                **SCREENSHOT_PROP,
            },
            "required": ["x", "y"],
        },
    },
    {
        "name": "move",
        "description": "Move the mouse to (x, y) without clicking (e.g. to reveal a hover menu).",
        "inputSchema": {"type": "object", "properties": {**_xy(), **SCREENSHOT_PROP}, "required": ["x", "y"]},
    },
    {
        "name": "drag",
        "description": "Press the left button at (from_x, from_y), drag to (to_x, to_y), and release.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "from_x": {"type": "integer"},
                "from_y": {"type": "integer"},
                "to_x": {"type": "integer"},
                "to_y": {"type": "integer"},
                **SCREENSHOT_PROP,
            },
            "required": ["from_x", "from_y", "to_x", "to_y"],
        },
    },
    {
        "name": "scroll",
        "description": "Scroll at (x, y) in a direction by a number of wheel clicks.",
        "inputSchema": {
            "type": "object",
            "properties": {
                **_xy(),
                "direction": {"type": "string", "enum": ["up", "down", "left", "right"]},
                "amount": {"type": "integer", "minimum": 1, "maximum": 50, "description": "Wheel clicks (default 3)."},
                **SCREENSHOT_PROP,
            },
            "required": ["x", "y", "direction"],
        },
    },
    {
        "name": "type",
        "description": "Type text into the focused window, as if on a keyboard. Use `key` for shortcuts and Enter.",
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string"}, **SCREENSHOT_PROP},
            "required": ["text"],
        },
    },
    {
        "name": "key",
        "description": (
            "Press a key or key combination, xdotool syntax: 'Return', 'Escape', 'Tab', 'ctrl+s', "
            "'ctrl+shift+t', 'alt+F4', 'Page_Down'. Several space-separated keys are pressed in order."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"keys": {"type": "string"}, **SCREENSHOT_PROP},
            "required": ["keys"],
        },
    },
    {
        "name": "cursor_position",
        "description": "Report the current mouse position.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "wait",
        "description": "Wait for the screen to settle (e.g. a page loading), then take a screenshot.",
        "inputSchema": {
            "type": "object",
            "properties": {"seconds": {"type": "number", "minimum": 0, "maximum": 30, "description": "Default 2."}},
        },
    },
    {
        "name": "launch",
        "description": (
            "Start a GUI application on your desktop, detached (e.g. 'firefox https://example.com', "
            "'libreoffice --calc report.xlsx', 'xterm'). Runs through sh -c in your workspace directory."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "command": {"type": "string"},
                "wait_seconds": {
                    "type": "number",
                    "minimum": 0,
                    "maximum": 30,
                    "description": "Seconds to wait before the screenshot (default 3).",
                },
                **SCREENSHOT_PROP,
            },
            "required": ["command"],
        },
    },
]

INPUT_TOOLS = {"click", "move", "drag", "scroll", "type", "key", "launch"}
USER_HAS_CONTROL = (
    "The user has taken control of your desktop, so input is paused. "
    "Wait, then try again; screenshot still works if you want to watch."
)


def x11_env(display):
    """Environment for anything that must draw on the agent's desktop.

    A session started from a host's graphical login inherits its Wayland
    environment, and toolkits that prefer Wayland (Chromium, GTK, Qt, Firefox,
    Electron, SDL) would open on the host's real screen instead of the agent's
    Xvnc display. Without WAYLAND_DISPLAY, libwayland still falls back to the
    wayland-0 socket in XDG_RUNTIME_DIR, so each toolkit is pinned to X11 too.
    Mirrors X11_ENV in agent-desktop.
    """
    env = dict(os.environ)
    for k in ("WAYLAND_DISPLAY", "ELECTRON_OZONE_PLATFORM_HINT"):
        env.pop(k, None)
    env.update(
        XDG_SESSION_TYPE="x11",
        GDK_BACKEND="x11",
        QT_QPA_PLATFORM="xcb",
        MOZ_ENABLE_WAYLAND="0",
        SDL_VIDEODRIVER="x11",
        DISPLAY=display,
    )
    return env


class ToolError(Exception):
    pass


# ---- per-identity keys ----------------------------------------------------------


def _host_key():
    """The host key, created (0600, atomically) on first use."""
    try:
        with open(KEY_FILE, "rb") as f:
            key = f.read().strip()
        if key:
            return key
    except FileNotFoundError:
        pass
    os.makedirs(os.path.dirname(KEY_FILE), mode=0o700, exist_ok=True)
    tmp = "%s.%d.%s" % (KEY_FILE, os.getpid(), secrets.token_hex(4))
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(secrets.token_hex(32).encode())
    try:
        os.link(tmp, KEY_FILE)  # fails if another process won the race; use theirs
    except FileExistsError:
        pass
    finally:
        os.unlink(tmp)
    with open(KEY_FILE, "rb") as f:
        return f.read().strip()


def secret_for(identity):
    return hmac.new(_host_key(), identity.encode(), hashlib.sha256).hexdigest()


def key_ok(identity, presented):
    return bool(presented) and hmac.compare_digest(secret_for(identity), presented)


# ---- the desktop ------------------------------------------------------------------


class Desktop:
    def __init__(self, identity):
        self.identity = identity
        self.display = None
        self.width = None
        self.height = None

    @property
    def state_dir(self):
        return os.path.join(os.path.expanduser("~"), "fleet", "identities", self.identity, "desktop")

    @property
    def workspace(self):
        return os.path.join(os.path.expanduser("~"), "fleet", "identities", self.identity, "workspace")

    def ensure_up(self):
        if not self.identity:
            raise ToolError("FLEET_IDENTITY is not set; the desktop is only available to supervised identities.")
        if self.display and self._xdotool("getdisplaygeometry", check=False).returncode == 0:
            return
        proc = subprocess.run(
            [AGENT_DESKTOP, "up", "--identity", self.identity, "--quiet"],
            capture_output=True,
            text=True,
            timeout=180,
        )
        m = re.search(r"DISPLAY=(:\d+)", proc.stdout)
        if proc.returncode != 0 or not m:
            raise ToolError("Could not start the desktop: " + (proc.stderr.strip() or proc.stdout.strip()))
        self.display = m.group(1)
        geo = self._xdotool("getdisplaygeometry").stdout.split()
        self.width, self.height = int(geo[0]), int(geo[1])
        log("[desktop-mcp] desktop-up identity=%s display=%s" % (self.identity, self.display))

    def _env(self):
        return x11_env(self.display or "")

    def _xdotool(self, *args, check=True):
        proc = subprocess.run(
            ["xdotool", *[str(a) for a in args]], capture_output=True, text=True, env=self._env(), timeout=60
        )
        if check and proc.returncode != 0:
            raise ToolError("xdotool %s failed: %s" % (args[0], proc.stderr.strip()))
        return proc

    def user_has_control(self):
        try:
            age = time.time() - os.path.getmtime(os.path.join(self.state_dir, "control-lock"))
        except OSError:
            return False
        return age < CONTROL_LEASE_SECONDS

    def check_point(self, x, y):
        if not (0 <= x < self.width and 0 <= y < self.height):
            raise ToolError(
                "(%d, %d) is off-screen; the screen is %dx%d." % (x, y, self.width, self.height)
            )

    def screenshot_png(self):
        proc = subprocess.run(
            ["import", "-display", self.display, "-window", "root", "png:-"],
            capture_output=True,
            timeout=30,
        )
        if proc.returncode != 0 or not proc.stdout:
            raise ToolError("screenshot failed: " + proc.stderr.decode(errors="replace").strip())
        return proc.stdout

    def cursor(self):
        out = self._xdotool("getmouselocation", "--shell").stdout
        vals = dict(line.split("=", 1) for line in out.split() if "=" in line)
        return int(vals.get("X", 0)), int(vals.get("Y", 0))


# ---- browser tool list (cached) ---------------------------------------------------


def _playwright_argv(extra):
    base = shlex.split(PLAYWRIGHT_CMD_OVERRIDE) if PLAYWRIGHT_CMD_OVERRIDE else ["npx", "-y", PLAYWRIGHT_MCP_PKG]
    return base + extra


class McpChild:
    """A stdio MCP server we talk to as a client: Playwright MCP, to fetch its tool list
    and inside the browser host. Responses are matched by id; notifications and stale
    responses (from timed-out calls) are dropped."""

    def __init__(self, argv, cwd=None, stderr=subprocess.DEVNULL, new_session=True):
        self.proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=stderr,
            text=True,
            cwd=cwd,
            start_new_session=new_session,  # so close() can take any browser down with it
        )
        self._group = new_session
        self._responses = queue.Queue()
        self._next_id = 0
        threading.Thread(target=self._read, daemon=True).start()

    def _read(self):
        for line in self.proc.stdout:
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(msg, dict) and "id" in msg and ("result" in msg or "error" in msg):
                self._responses.put(msg)
        self._responses.put(None)  # EOF

    def _write(self, msg):
        try:
            self.proc.stdin.write(json.dumps(msg) + "\n")
            self.proc.stdin.flush()
        except (BrokenPipeError, ValueError):
            raise ToolError("the browser process exited")

    def request(self, method, params, timeout):
        self._next_id += 1
        rid = self._next_id
        self._write({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        deadline = time.monotonic() + timeout
        while True:
            left = deadline - time.monotonic()
            if left <= 0:
                raise ToolError("the browser didn't answer within %ds" % timeout)
            try:
                msg = self._responses.get(timeout=left)
            except queue.Empty:
                continue
            if msg is None:
                raise ToolError("the browser process exited")
            if msg.get("id") != rid:
                continue
            if "error" in msg:
                raise ToolError("browser error: %s" % (msg["error"].get("message") or msg["error"]))
            return msg["result"]

    def handshake(self, timeout):
        self.request(
            "initialize",
            {
                "protocolVersion": SUPPORTED_PROTOCOLS[0],
                "capabilities": {},
                "clientInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            },
            timeout,
        )
        self._write({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def close(self):
        if self.proc.poll() is None:
            try:
                os.killpg(self.proc.pid, 15) if self._group else self.proc.terminate()
            except OSError:
                pass
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(self.proc.pid, 9) if self._group else self.proc.kill()
                except OSError:
                    pass


class BrowserTools:
    def __init__(self):
        self._defs = None
        self._warming = False
        self._lock = threading.Lock()
        self.ready = threading.Event()  # set once the list is known

    @property
    def _cache_path(self):
        slug = re.sub(r"[^A-Za-z0-9._-]+", "_", PLAYWRIGHT_MCP_PKG + ("-" + PLAYWRIGHT_CMD_OVERRIDE if PLAYWRIGHT_CMD_OVERRIDE else ""))
        return os.path.join(TOOLS_CACHE_DIR, slug[:150] + "-tools.json")

    def defs(self):
        if self._defs is None:
            try:
                with open(self._cache_path) as f:
                    defs = json.load(f)
                if isinstance(defs, list):
                    self._defs = [t for t in defs if str(t.get("name", "")).startswith("browser_")]
            except (OSError, ValueError):
                pass
        if self._defs:
            self.ready.set()
        return self._defs or []

    @property
    def warming(self):
        return self._warming

    def has(self, name):
        return isinstance(name, str) and any(t["name"] == name for t in self.defs())

    def warm(self, on_ready=None, retry_every=0):
        """Fetch + cache the tool list in the background if we don't have it. With
        retry_every, a failed fetch is tried again that many seconds later until it works."""
        with self._lock:
            if self.defs() or self._warming:
                return
            self._warming = True

        def run():
            child = None
            retry = True
            try:
                child = McpChild(_playwright_argv([]), cwd=tempfile.gettempdir())
                child.handshake(timeout=300)  # first run downloads the npm package
                defs = child.request("tools/list", {}, timeout=60).get("tools", [])
                defs = [t for t in defs if str(t.get("name", "")).startswith("browser_")]
                if defs:
                    os.makedirs(TOOLS_CACHE_DIR, exist_ok=True)
                    tmp = self._cache_path + ".tmp"
                    with open(tmp, "w") as f:
                        json.dump(defs, f)
                    os.replace(tmp, self._cache_path)
                    self._defs = defs
                    self.ready.set()
                    log("[desktop-mcp] browser-tools cached count=%d" % len(defs))
                    if on_ready:
                        on_ready()
            except FileNotFoundError as e:
                log("[desktop-mcp] browser-tools warm: %s — no browser tools on this box" % e)
                retry = False
            except Exception as e:
                log("[desktop-mcp] browser-tools warm failed: %s" % e)  # desktop tools still work
            finally:
                if child:
                    child.close()
                self._warming = False
            if retry and retry_every and not self._defs:
                log("[desktop-mcp] browser-tools warm: retrying in %ds" % retry_every)
                threading.Timer(retry_every, self.warm, kwargs={"on_ready": on_ready, "retry_every": retry_every}).start()

        threading.Thread(target=run, daemon=True).start()


browser_tools = BrowserTools()


# ---- browser bridge (one per identity) -------------------------------------------


class _Gone(Exception):
    """The browser host isn't there (no socket, or nobody listening): safe to retry,
    since the request was never sent."""


class Browser:
    def __init__(self, desktop):
        self.desktop = desktop
        self.socket_path = None
        self._install_tried = False
        self._next_id = 0

    def _start(self):
        proc = subprocess.run(
            [AGENT_DESKTOP, "browser", "up", "--identity", self.desktop.identity, "--quiet"],
            capture_output=True,
            text=True,
            timeout=BROWSER_UP_TIMEOUT,
        )
        m = re.search(r"^BROWSER_SOCKET=(.+)$", proc.stdout, re.M)
        if proc.returncode != 0 or not m:
            raise ToolError("Could not start the browser: " + (proc.stderr.strip() or proc.stdout.strip()))
        self.socket_path = m.group(1)

    def _request(self, method, params):
        """One request over the browser host's socket; returns its result."""
        self._next_id += 1
        rid = self._next_id
        conn = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        try:
            conn.settimeout(10)
            try:
                conn.connect(self.socket_path)
            except (FileNotFoundError, ConnectionRefusedError) as e:
                raise _Gone(str(e))
            conn.settimeout(BROWSER_CALL_TIMEOUT + 30)
            try:
                conn.sendall((json.dumps({"id": rid, "method": method, "params": params}) + "\n").encode())
                line = conn.makefile("rb").readline()
            except TimeoutError:
                raise ToolError("the browser didn't answer within %ds" % (BROWSER_CALL_TIMEOUT + 30))
            except (ConnectionResetError, BrokenPipeError):
                line = b""
            if not line:
                # Not retried: the call may already have acted. The next call reconnects.
                raise ToolError("the browser connection dropped mid-call; check the page before retrying")
        finally:
            conn.close()
        msg = json.loads(line)
        if "error" in msg:
            raise ToolError(str(msg["error"]))
        return msg["result"]

    def _call_once(self, name, args):
        for attempt in range(3):
            try:
                if self.socket_path is None:
                    self._start()
                return self._request("tools/call", {"name": name, "arguments": args})
            except _Gone as e:
                log("[desktop-mcp] browser-reconnect identity=%s attempt=%d reason=%s" % (self.desktop.identity, attempt + 1, e))
                self.socket_path = None
        raise ToolError("the browser kept disconnecting; try again")

    def call(self, name, args):
        result = self._call_once(name, args)
        if result.get("isError") and not self._install_tried and BROWSER_MISSING_RE.search(_result_text(result)):
            self._install_tried = True
            self.stop()
            self._install_browser()
            result = self._call_once(name, args)
        return result

    def stop(self):
        subprocess.run(
            [AGENT_DESKTOP, "browser", "down", "--identity", self.desktop.identity],
            capture_output=True,
            timeout=60,
        )
        self.socket_path = None

    def _install_browser(self):
        """One best-effort Chromium (+ system libraries, if we can be root) install."""
        if PLAYWRIGHT_CMD_OVERRIDE:
            return
        log("[desktop-mcp] browser-install identity=%s" % self.desktop.identity)
        out_path = os.path.join(self.desktop.state_dir, "browser.log")
        pw = ["npx", "-y", "-p", PLAYWRIGHT_MCP_PKG, "playwright"]
        with open(out_path, "a") as out:
            deps = pw + ["install-deps", "chromium"]
            if os.geteuid() == 0:
                subprocess.run(deps, stdout=out, stderr=out, timeout=900)
            elif subprocess.run(["sudo", "-n", "true"], capture_output=True).returncode == 0:
                subprocess.run(["sudo", "-n", "env", "PATH=" + os.environ.get("PATH", "")] + deps, stdout=out, stderr=out, timeout=900)
            subprocess.run(pw + ["install", "chromium"], stdout=out, stderr=out, timeout=900)


def _result_text(result):
    return " ".join(c.get("text", "") for c in result.get("content", []) if isinstance(c, dict))


# ---- per-identity state ------------------------------------------------------------


class Agent:
    def __init__(self, identity):
        self.desktop = Desktop(identity)
        self.browser = Browser(self.desktop)
        self.lock = threading.Lock()


_agents = {}
_agents_lock = threading.Lock()
# Tool calls running at once, box-wide. Handshakes and health never wait on it.
_call_slots = threading.BoundedSemaphore(MAX_CALLS)


def agent_for(identity):
    with _agents_lock:
        a = _agents.get(identity)
        if a is None:
            a = _agents[identity] = Agent(identity)
        return a


# ---- tools ------------------------------------------------------------------------


def _image_block(desktop):
    return {
        "type": "image",
        "data": base64.b64encode(desktop.screenshot_png()).decode(),
        "mimeType": "image/png",
    }


def _int(args, key, default=None):
    if key not in args:
        if default is None:
            raise ToolError("missing argument: %s" % key)
        return default
    try:
        return int(args[key])
    except (TypeError, ValueError):
        raise ToolError("%s must be an integer" % key)


def call_tool(desktop, name, args, path=None):
    """Run one desktop tool; returns a list of MCP content blocks. `path`, when given, is
    the calling session's PATH, for apps started with `launch`."""
    if name not in {t["name"] for t in TOOLS}:
        raise ToolError("unknown tool: %s" % name)
    desktop.ensure_up()

    if name in INPUT_TOOLS and desktop.user_has_control():
        return [{"type": "text", "text": USER_HAS_CONTROL}]

    want_shot = args.get("screenshot", True) is not False
    note = "done"

    if name == "screenshot":
        return [
            {"type": "text", "text": "Screen is %dx%d." % (desktop.width, desktop.height)},
            _image_block(desktop),
        ]

    if name == "cursor_position":
        x, y = desktop.cursor()
        return [{"type": "text", "text": "Cursor at (%d, %d)." % (x, y)}]

    if name == "wait":
        secs = float(args.get("seconds", 2))
        time.sleep(max(0.0, min(secs, 30.0)))
        return [{"type": "text", "text": "Waited %gs." % secs}, _image_block(desktop)]

    if name == "click":
        x, y = _int(args, "x"), _int(args, "y")
        desktop.check_point(x, y)
        button = {"left": 1, "middle": 2, "right": 3}.get(args.get("button", "left"))
        if button is None:
            raise ToolError("button must be left, right, or middle")
        clicks = max(1, min(_int(args, "clicks", 1), 3))
        desktop._xdotool("mousemove", "--sync", x, y, "click", "--repeat", clicks, "--delay", 80, button)
        note = "Clicked %s%s at (%d, %d)." % (args.get("button", "left"), " x%d" % clicks if clicks > 1 else "", x, y)

    elif name == "move":
        x, y = _int(args, "x"), _int(args, "y")
        desktop.check_point(x, y)
        desktop._xdotool("mousemove", "--sync", x, y)
        note = "Moved to (%d, %d)." % (x, y)

    elif name == "drag":
        fx, fy, tx, ty = (_int(args, k) for k in ("from_x", "from_y", "to_x", "to_y"))
        desktop.check_point(fx, fy)
        desktop.check_point(tx, ty)
        desktop._xdotool("mousemove", "--sync", fx, fy, "mousedown", 1)
        time.sleep(0.1)
        # Move in a few steps so apps that need intermediate motion events see a drag.
        for i in range(1, 6):
            desktop._xdotool("mousemove", "--sync", fx + (tx - fx) * i // 5, fy + (ty - fy) * i // 5)
            time.sleep(0.03)
        desktop._xdotool("mouseup", 1)
        note = "Dragged (%d, %d) -> (%d, %d)." % (fx, fy, tx, ty)

    elif name == "scroll":
        x, y = _int(args, "x"), _int(args, "y")
        desktop.check_point(x, y)
        button = {"up": 4, "down": 5, "left": 6, "right": 7}.get(args.get("direction"))
        if button is None:
            raise ToolError("direction must be up, down, left, or right")
        amount = max(1, min(_int(args, "amount", 3), 50))
        desktop._xdotool("mousemove", "--sync", x, y, "click", "--repeat", amount, "--delay", 30, button)
        note = "Scrolled %s %d at (%d, %d)." % (args["direction"], amount, x, y)

    elif name == "type":
        text = args.get("text")
        if not isinstance(text, str) or not text:
            raise ToolError("text must be a non-empty string")
        # Type line by line: xdotool's handling of embedded newlines varies by app.
        lines = text.split("\n")
        for i, line in enumerate(lines):
            if line:
                desktop._xdotool("type", "--delay", 12, "--", line)
            if i < len(lines) - 1:
                desktop._xdotool("key", "Return")
        note = "Typed %d characters." % len(text)

    elif name == "key":
        keys = str(args.get("keys", "")).split()
        if not keys:
            raise ToolError("keys must be a non-empty string")
        desktop._xdotool("key", "--delay", 50, "--", *keys)
        note = "Pressed %s." % " ".join(keys)

    elif name == "launch":
        command = args.get("command")
        if not isinstance(command, str) or not command.strip():
            raise ToolError("command must be a non-empty string")
        env = None
        if path:
            # The session's own PATH first, as when each session ran its own server; ours
            # after it so agent-desktop's helpers still resolve.
            env = dict(os.environ, PATH=path + os.pathsep + os.environ.get("PATH", ""))
        proc = subprocess.run(
            [AGENT_DESKTOP, "run", "--identity", desktop.identity, "--", "sh", "-c", command],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=desktop.workspace if os.path.isdir(desktop.workspace) else None,
            env=env,
        )
        if proc.returncode != 0:
            raise ToolError("launch failed: " + proc.stderr.strip())
        wait = float(args.get("wait_seconds", 3))
        time.sleep(max(0.0, min(wait, 30.0)))
        note = "Launched: %s (output goes to %s/apps.log)." % (command, desktop.state_dir)
        if want_shot:
            return [{"type": "text", "text": note}, _image_block(desktop)]
        return [{"type": "text", "text": note}]

    if not want_shot:
        return [{"type": "text", "text": note}]
    time.sleep(SETTLE_SECONDS)
    return [{"type": "text", "text": note}, _image_block(desktop)]


def run_tool(identity, name, args, path=None):
    """One tools/call for one identity; returns the MCP result. Never raises."""
    if not identity:
        return {"content": [{"type": "text", "text": "FLEET_IDENTITY is not set; the desktop is only available to supervised identities."}], "isError": True}
    agent = agent_for(identity)
    started = time.monotonic()
    # One call at a time per desktop, as with a stdio server; the box-wide slot is taken
    # only once it's this call's turn, so one agent's queue can't starve the others.
    with agent.lock, _call_slots:
        try:
            if browser_tools.has(name):
                agent.desktop.ensure_up()
                if name not in BROWSER_READ_ONLY and agent.desktop.user_has_control():
                    result = {"content": [{"type": "text", "text": USER_HAS_CONTROL}], "isError": False}
                else:
                    result = agent.browser.call(name, args)
            else:
                result = {"content": call_tool(agent.desktop, name, args, path), "isError": False}
        except ToolError as e:
            result = {"content": [{"type": "text", "text": str(e)}], "isError": True}
        except subprocess.TimeoutExpired as e:
            result = {"content": [{"type": "text", "text": "timed out: %s" % e}], "isError": True}
        except Exception as e:  # never let one bad call take the server down
            log("[desktop-mcp] call identity=%s tool=%s crash=%s: %s" % (identity, name, type(e).__name__, e))
            result = {"content": [{"type": "text", "text": "desktop error: internal %s: %s" % (type(e).__name__, e)}], "isError": True}
    log("[desktop-mcp] call identity=%s tool=%s ok=%s ms=%d" % (
        identity, name, str(not result.get("isError")).lower(), int((time.monotonic() - started) * 1000)))
    return result


# ---- JSON-RPC ---------------------------------------------------------------------


def handle_rpc(identity, msg, authorize=None, path=None):
    """One JSON-RPC message in, one response dict out (None for notifications).
    `authorize`, when given, is checked before a tools/call and returns an error text or None.
    `path` is the calling session's PATH (see call_tool)."""
    if not isinstance(msg, dict):
        return {"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "invalid request"}}
    method = msg.get("method")
    rid = msg.get("id")
    if "id" not in msg:
        return None  # notifications (initialized, cancelled, ...) need no reply
    params = msg.get("params") or {}
    if not isinstance(params, dict):
        return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32602, "message": "params must be an object"}}

    if method == "initialize":
        requested = params.get("protocolVersion")
        result = {
            "protocolVersion": requested if requested in SUPPORTED_PROTOCOLS else SUPPORTED_PROTOCOLS[0],
            "capabilities": {"tools": {"listChanged": True}},
            "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
            "instructions": INSTRUCTIONS,
        }
    elif method == "ping":
        result = {}
    elif method == "tools/list":
        result = {"tools": TOOLS + browser_tools.defs()}
    elif method == "tools/call":
        args = params.get("arguments") or {}
        denied = authorize() if authorize else None
        if denied:
            result = {"content": [{"type": "text", "text": denied}], "isError": True}
        elif not isinstance(args, dict):
            result = {"content": [{"type": "text", "text": "arguments must be an object"}], "isError": True}
        else:
            result = run_tool(identity, params.get("name"), args, path)
    else:
        return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "method not found: %s" % method}}
    return {"jsonrpc": "2.0", "id": rid, "result": result}


# ---- MCP over HTTP (desktop-mcp serve) --------------------------------------------


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "desktop-mcp"
    # A connection that sends nothing is dropped after this many seconds, so it
    # can't hold a handler thread.
    timeout = float(os.environ.get("DESKTOP_MCP_IDLE_TIMEOUT", "10"))

    def log_message(self, *a):
        pass

    def _reply(self, code, payload=None):
        body = b"" if payload is None else json.dumps(payload).encode("utf-8")
        # One request per connection: an idle keep-alive connection would pin a
        # handler thread per connected session.
        self.close_connection = True
        self.send_response(code)
        self.send_header("Connection", "close")
        if payload is not None:
            self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if body:
            self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self._reply(200, {"ok": True, "browserTools": bool(browser_tools.defs())})
            return
        if self.path.split("?")[0] != "/mcp" or browser_tools.defs() or not browser_tools.warming:
            self._reply(405)  # nothing to announce
            return
        # The browser tool list is still being fetched (cold cache): hold the session's
        # event stream open and announce the list once it's in, so sessions launched in the
        # meantime still get browser tools. A held stream costs a thread, only until then.
        self.close_connection = True
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "close")
        self.end_headers()
        try:
            self.wfile.flush()
            if browser_tools.ready.wait(LIST_CHANGED_WAIT):
                self.wfile.write(b'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/tools/list_changed"}\n\n')
                self.wfile.flush()
                log("[desktop-mcp] list-changed sent")
        except OSError:
            pass  # session went away

    def do_DELETE(self):
        self._reply(200)  # stateless: nothing to tear down

    def do_POST(self):
        if self.headers.get("Origin"):
            self._reply(403, {"error": "browser requests are not accepted"})
            return
        if self.path.split("?")[0] != "/mcp":
            self._reply(404)
            return
        ctype = (self.headers.get("Content-Type") or "").split(";")[0].strip().lower()
        if ctype != "application/json":
            self._reply(415, {"error": "Content-Type must be application/json"})
            return
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n < 0 or n > MAX_BODY:
            self._reply(413)
            return
        try:
            raw = self.rfile.read(n)
        except OSError:  # incl. timeout: body shorter than its Content-Length
            self.close_connection = True
            return
        try:
            msg = json.loads(raw or b"null")
        except ValueError:
            self._reply(400, {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
            return
        identity = (self.headers.get("X-Fleet-Identity") or "").strip().lower()
        if identity and not NAME_RE.match(identity):
            identity = ""
        key = (self.headers.get("X-Fleet-Desktop-Key") or "").strip()
        # The session's PATH (from its launch env), used only for `launch`, and only once the
        # key has checked out. Ignored unless it looks like one.
        path = (self.headers.get("X-Fleet-Path") or "").strip()
        if len(path) > 8192 or not PATH_RE.match(path):
            path = ""

        def authorize():
            if not identity:
                return "this session has no FLEET_IDENTITY, so the desktop doesn't know whose it is"
            if not key_ok(identity, key):
                log("[desktop-mcp] auth-refused identity=%s keyPresent=%s" % (identity, bool(key)))
                return "this session's desktop key is missing or wrong (it is set when the supervisor launches the session)"
            return None

        if isinstance(msg, list):
            out = [r for r in (handle_rpc(identity, m, authorize, path) for m in msg) if r is not None]
            self._reply(200, out) if out else self._reply(202)
            return
        if isinstance(msg, dict) and msg.get("method") == "initialize":
            log("[desktop-mcp] session-init identity=%s client=%s" % (
                identity or "<none>", json.dumps((msg.get("params") or {}).get("clientInfo"))))
        res = handle_rpc(identity, msg, authorize, path)
        self._reply(202) if res is None else self._reply(200, res)


class Server(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def serve():
    _host_key()
    browser_tools.warm(retry_every=300)
    srv = Server(("127.0.0.1", PORT), Handler)
    log("[desktop-mcp] listening 127.0.0.1:%d browserTools=%d" % (PORT, len(browser_tools.defs())))
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


# ---- browser host (desktop-mcp browser-host SOCKET -- ARGV...) -----------------------
#
# Run by `agent-desktop browser up` as the identity's browser server: starts Playwright MCP
# over stdio as its child, holds ONE MCP session with it for its whole life, and serves
# requests on a Unix socket in the identity's desktop state dir (mode 0700), one JSON line
# each way: {"id", "method", "params"} -> {"id", "result"} or {"id", "error"}. A socket, not
# a TCP port: Playwright MCP has no authentication, and a file permission keeps other users
# on the box out. It lives outside the desktop-mcp server, so a server restart keeps the
# browser (and its tabs). Exits when Playwright does; the browser unit restarts it.


def browser_host(sock_path, argv):
    child = McpChild(argv, stderr=None, new_session=False)  # stderr -> browser.log; one process group
    try:
        child.handshake(timeout=300)  # first run may download the npm package
    except ToolError as e:
        log("[desktop-mcp] browser-host handshake failed: %s" % e)
        child.close()
        return 1
    lock = threading.Lock()  # one request at a time to Playwright

    def serve_conn(conn):
        with conn:
            f = conn.makefile("rwb")
            for line in f:
                try:
                    msg = json.loads(line)
                    rid = msg.get("id")
                except (ValueError, AttributeError):
                    continue
                try:
                    with lock:
                        out = {"id": rid, "result": child.request(msg.get("method"), msg.get("params") or {}, BROWSER_CALL_TIMEOUT)}
                except ToolError as e:
                    out = {"id": rid, "error": str(e)}
                try:
                    f.write((json.dumps(out) + "\n").encode())
                    f.flush()
                except OSError:
                    return  # caller went away (desktop-mcp restarted mid-call)

    try:
        os.unlink(sock_path)
    except FileNotFoundError:
        pass
    srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    old = os.umask(0o177)
    try:
        srv.bind(sock_path)
    finally:
        os.umask(old)
    srv.listen(8)
    log("[desktop-mcp] browser-host ready socket=%s pid=%d" % (sock_path, child.proc.pid))

    def accept_loop():
        while True:
            conn, _ = srv.accept()
            threading.Thread(target=serve_conn, args=(conn,), daemon=True).start()

    threading.Thread(target=accept_loop, daemon=True).start()
    rc = child.proc.wait()
    log("[desktop-mcp] browser-host: Playwright exited rc=%s" % rc)
    try:
        os.unlink(sock_path)
    except OSError:
        pass
    return 1


# ---- MCP over stdio (no arguments: one identity, older supervisors) ----------------

_send_lock = threading.Lock()


def _send(msg):
    with _send_lock:
        sys.stdout.write(json.dumps(msg) + "\n")
        sys.stdout.flush()


def stdio():
    identity = os.environ.get("FLEET_IDENTITY", "")
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            _send({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
            continue
        if isinstance(req, dict) and req.get("method") == "notifications/initialized":
            browser_tools.warm(lambda: _send({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"}))
        try:
            resp = handle_rpc(identity, req)
        except Exception as e:  # never let one bad call kill the server
            resp = {"jsonrpc": "2.0", "id": req.get("id") if isinstance(req, dict) else None,
                    "error": {"code": -32603, "message": str(e)}}
        if resp is not None:
            _send(resp)


def main():
    if sys.argv[1:2] == ["secret"]:
        # For agent-supervisor: this identity's X-Fleet-Desktop-Key value.
        name = (sys.argv[2] if len(sys.argv) > 2 else "").strip().lower()
        if not NAME_RE.match(name):
            print("usage: desktop-mcp secret <identity>", file=sys.stderr)
            return 2
        print(secret_for(name))
        return 0
    if sys.argv[1:2] == ["serve"]:
        serve()
        return 0
    if sys.argv[1:2] == ["browser-host"] and len(sys.argv) > 4 and sys.argv[3] == "--":
        return browser_host(sys.argv[2], sys.argv[4:])
    if sys.argv[1:]:
        print("usage: desktop-mcp [serve | secret <identity> | browser-host <socket> -- <argv>...]", file=sys.stderr)
        return 2
    stdio()
    return 0


if __name__ == "__main__":
    sys.exit(main())
