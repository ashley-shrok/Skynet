#!/usr/bin/env python3
"""desktop-mcp — MCP server that lets an identity see and drive its own desktop.

Canonical copy lives in the app's source repo at substrate/scripts/desktop-mcp.py and
is distributed to every managed host by the fleet-substrate distributor (see
src/backend/distributor/catalog.ts). Installed per-box at ~/.local/bin/desktop-mcp.
Do NOT hand-edit the installed copy.

Registered with every supervised claude launch via --mcp-config (see
agent-supervisor.sh § desktop MCP), so the agent sees tools named
mcp__desktop__<tool>. stdio transport, newline-delimited JSON-RPC 2.0, stdlib
only — no pip dependencies on managed hosts.

The action set mirrors Anthropic's computer-use tool (screenshot, click, type,
key, scroll, drag, ...) so the model is already fluent in it. Input goes through
xdotool and screenshots through ImageMagick's `import`, both against the
identity's own X display, which `agent-desktop up` allocates and starts. The
desktop is started lazily on the first tool call.

Identity: $FLEET_IDENTITY (exported by agent-supervisor into every claude
launch, and inherited by this server). The display is resolved from the
identity's state, never from $DISPLAY — a claude process started before the
desktop existed has no DISPLAY in its environment.

Browser tools (browser_*): Playwright MCP (@playwright/mcp, pinned below) runs
as a child of this server, HEADED on the identity's desktop, so web work gets
reliable DOM-level actions (accessibility-snapshot refs instead of pixels) and
the user can still watch it in the Desktop tab. The child is spawned lazily on
the first browser_* call (after the desktop is up, with DISPLAY set), so agents
that never browse pay nothing. Its tool list is cached under
~/.cache/agent-desktop/; on a cold cache the list is fetched in the background
and announced with notifications/tools/list_changed, so MCP startup never waits
on an npm download. Each identity keeps a persistent browser profile in its
desktop state dir, so sign-ins survive restarts. If Chromium isn't installed,
the first failing call triggers one best-effort `playwright install`.

Human control: while ~/fleet/identities/<name>/desktop/control-lock is a live
lease (renewed within CONTROL_LEASE_SECONDS; see agent-desktop control), input actions are refused with a "user has control" message; screenshot,
cursor_position and the read-only browser tools (snapshot, screenshot, console,
network) still work so the agent can watch.
"""

import base64
import json
import os
import re
import queue
import shlex
import shutil
import subprocess
import sys
import tempfile
import threading
import time

SERVER_NAME = "desktop"
SERVER_VERSION = "0.1.0"
SUPPORTED_PROTOCOLS = ("2025-06-18", "2025-03-26", "2024-11-05")
SETTLE_SECONDS = float(os.environ.get("DESKTOP_MCP_SETTLE_SECONDS", "0.5"))
AGENT_DESKTOP = shutil.which("agent-desktop") or os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "agent-desktop"
)

# Pinned: tool names/shapes are part of the agent's contract (see the desktop
# skill). Bump deliberately, together with a run of the browser tests.
PLAYWRIGHT_MCP_PKG = os.environ.get("DESKTOP_MCP_PLAYWRIGHT_PKG", "@playwright/mcp@0.0.83")
# Tests swap in a fake MCP server here; the real thing is `npx -y <pkg>`.
PLAYWRIGHT_CMD_OVERRIDE = os.environ.get("DESKTOP_MCP_PLAYWRIGHT_CMD", "")
# Optional: a browser binary to use instead of Playwright's own download.
BROWSER_EXECUTABLE = os.environ.get("DESKTOP_BROWSER_EXECUTABLE", "")
TOOLS_CACHE_DIR = os.path.join(os.path.expanduser("~"), ".cache", "agent-desktop")
BROWSER_CALL_TIMEOUT = 180
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


class ToolError(Exception):
    pass


class Desktop:
    def __init__(self):
        self.identity = os.environ.get("FLEET_IDENTITY", "")
        self.display = None
        self.width = None
        self.height = None

    @property
    def state_dir(self):
        return os.path.join(os.path.expanduser("~"), "fleet", "identities", self.identity, "desktop")

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

    def _env(self):
        env = dict(os.environ)
        env["DISPLAY"] = self.display or ""
        return env

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


desktop = Desktop()


# ---- Playwright MCP child -----------------------------------------------------


def _playwright_argv(extra):
    base = shlex.split(PLAYWRIGHT_CMD_OVERRIDE) if PLAYWRIGHT_CMD_OVERRIDE else ["npx", "-y", PLAYWRIGHT_MCP_PKG]
    return base + extra


class McpChild:
    """A stdio MCP server we talk to as a client. Responses are matched by id;
    notifications and stale responses (from timed-out calls) are dropped."""

    def __init__(self, argv, env=None, cwd=None, log_path=None):
        self._log = open(log_path, "a") if log_path else subprocess.DEVNULL
        self.proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=self._log,
            text=True,
            env=env,
            cwd=cwd,
            start_new_session=True,  # so close() can take the browser down with it
        )
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

    def alive(self):
        return self.proc.poll() is None

    def close(self):
        if self.alive():
            try:
                os.killpg(self.proc.pid, 15)
            except OSError:
                pass
            try:
                self.proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                try:
                    os.killpg(self.proc.pid, 9)
                except OSError:
                    pass
        if self._log is not subprocess.DEVNULL:
            self._log.close()


class BrowserBridge:
    def __init__(self):
        self.child = None
        self.child_display = None
        self._tool_defs = None
        self._install_tried = False
        self._warming = False

    @property
    def _cache_path(self):
        slug = re.sub(r"[^A-Za-z0-9._-]+", "_", PLAYWRIGHT_MCP_PKG + ("-" + PLAYWRIGHT_CMD_OVERRIDE if PLAYWRIGHT_CMD_OVERRIDE else ""))
        return os.path.join(TOOLS_CACHE_DIR, slug[:150] + "-tools.json")

    def tool_defs(self):
        if self._tool_defs is None:
            try:
                with open(self._cache_path) as f:
                    defs = json.load(f)
                if isinstance(defs, list):
                    self._tool_defs = [t for t in defs if str(t.get("name", "")).startswith("browser_")]
            except (OSError, ValueError):
                pass
        return self._tool_defs or []

    def warm(self, on_ready):
        """Fetch + cache the tool list in the background if we don't have it."""
        if self.tool_defs() or self._warming:
            return
        self._warming = True

        def run():
            child = None
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
                    self._tool_defs = defs
                    on_ready()
            except Exception:
                pass  # no browser tools this session; desktop tools still work
            finally:
                if child:
                    child.close()
                self._warming = False

        threading.Thread(target=run, daemon=True).start()

    def _start_child(self):
        self.stop()
        state = desktop.state_dir
        argv = _playwright_argv(
            [
                "--browser",
                "chromium",
                "--user-data-dir",
                os.path.join(state, "browser-profile"),
                "--output-dir",
                os.path.join(state, "browser-output"),
            ]
            + (["--executable-path", BROWSER_EXECUTABLE] if BROWSER_EXECUTABLE else [])
        )
        env = dict(os.environ)
        env["DISPLAY"] = desktop.display
        workspace = os.path.join(os.path.expanduser("~"), "fleet", "identities", desktop.identity, "workspace")
        self.child = McpChild(
            argv,
            env=env,
            cwd=workspace if os.path.isdir(workspace) else state,
            log_path=os.path.join(state, "browser.log"),
        )
        self.child_display = desktop.display
        self.child.handshake(timeout=300)

    def stop(self):
        if self.child:
            self.child.close()
        self.child = None
        self.child_display = None

    def _install_browser(self):
        """One best-effort Chromium (+ system libraries, if we can be root) install."""
        if PLAYWRIGHT_CMD_OVERRIDE:
            return
        log = os.path.join(desktop.state_dir, "browser.log")
        pw = ["npx", "-y", "-p", PLAYWRIGHT_MCP_PKG, "playwright"]
        with open(log, "a") as out:
            deps = pw + ["install-deps", "chromium"]
            if os.geteuid() == 0:
                subprocess.run(deps, stdout=out, stderr=out, timeout=900)
            elif subprocess.run(["sudo", "-n", "true"], capture_output=True).returncode == 0:
                subprocess.run(["sudo", "-n", "env", "PATH=" + os.environ.get("PATH", "")] + deps, stdout=out, stderr=out, timeout=900)
            subprocess.run(pw + ["install", "chromium"], stdout=out, stderr=out, timeout=900)

    def call(self, name, args):
        desktop.ensure_up()
        if name not in BROWSER_READ_ONLY and desktop.user_has_control():
            return {"content": [{"type": "text", "text": USER_HAS_CONTROL}], "isError": False}
        if not (self.child and self.child.alive() and self.child_display == desktop.display):
            self._start_child()
        result = self.child.request("tools/call", {"name": name, "arguments": args}, BROWSER_CALL_TIMEOUT)
        if result.get("isError") and not self._install_tried and BROWSER_MISSING_RE.search(_result_text(result)):
            self._install_tried = True
            self.stop()
            self._install_browser()
            self._start_child()
            result = self.child.request("tools/call", {"name": name, "arguments": args}, BROWSER_CALL_TIMEOUT)
        return result


def _result_text(result):
    return " ".join(c.get("text", "") for c in result.get("content", []) if isinstance(c, dict))


browser = BrowserBridge()


def _image_block():
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


def call_tool(name, args):
    """Run one tool; returns a list of MCP content blocks."""
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
            _image_block(),
        ]

    if name == "cursor_position":
        x, y = desktop.cursor()
        return [{"type": "text", "text": "Cursor at (%d, %d)." % (x, y)}]

    if name == "wait":
        secs = float(args.get("seconds", 2))
        time.sleep(max(0.0, min(secs, 30.0)))
        return [{"type": "text", "text": "Waited %gs." % secs}, _image_block()]

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
        workspace = os.path.join(os.path.expanduser("~"), "fleet", "identities", desktop.identity, "workspace")
        proc = subprocess.run(
            [AGENT_DESKTOP, "run", "--identity", desktop.identity, "--", "sh", "-c", command],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=workspace if os.path.isdir(workspace) else None,
        )
        if proc.returncode != 0:
            raise ToolError("launch failed: " + proc.stderr.strip())
        wait = float(args.get("wait_seconds", 3))
        time.sleep(max(0.0, min(wait, 30.0)))
        note = "Launched: %s (output goes to %s/apps.log)." % (command, desktop.state_dir)
        if want_shot:
            return [{"type": "text", "text": note}, _image_block()]
        return [{"type": "text", "text": note}]

    if not want_shot:
        return [{"type": "text", "text": note}]
    time.sleep(SETTLE_SECONDS)
    return [{"type": "text", "text": note}, _image_block()]


# ---- JSON-RPC over stdio ------------------------------------------------------


_send_lock = threading.Lock()


def _send(msg):
    with _send_lock:
        sys.stdout.write(json.dumps(msg) + "\n")
        sys.stdout.flush()


def _announce_tools_changed():
    _send({"jsonrpc": "2.0", "method": "notifications/tools/list_changed"})


def handle(req):
    method = req.get("method")
    rid = req.get("id")
    is_request = "id" in req

    if method == "initialize":
        requested = (req.get("params") or {}).get("protocolVersion")
        version = requested if requested in SUPPORTED_PROTOCOLS else SUPPORTED_PROTOCOLS[0]
        return {
            "jsonrpc": "2.0",
            "id": rid,
            "result": {
                "protocolVersion": version,
                "capabilities": {"tools": {"listChanged": True}},
                "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                "instructions": (
                    "Your own virtual desktop (a Linux X display only you use). Take a screenshot to see it; "
                    "coordinates are pixels in that screenshot. The user may be watching it live."
                ),
            },
        }
    if method == "ping":
        return {"jsonrpc": "2.0", "id": rid, "result": {}}
    if method == "notifications/initialized":
        browser.warm(_announce_tools_changed)
        return None
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": rid, "result": {"tools": TOOLS + browser.tool_defs()}}
    if method == "tools/call":
        params = req.get("params") or {}
        name = params.get("name")
        try:
            if isinstance(name, str) and any(t["name"] == name for t in browser.tool_defs()):
                result = browser.call(name, params.get("arguments") or {})
            else:
                content = call_tool(name, params.get("arguments") or {})
                result = {"content": content, "isError": False}
        except ToolError as e:
            result = {"content": [{"type": "text", "text": str(e)}], "isError": True}
        except subprocess.TimeoutExpired as e:
            result = {"content": [{"type": "text", "text": "timed out: %s" % e}], "isError": True}
        return {"jsonrpc": "2.0", "id": rid, "result": result}
    if not is_request:
        return None  # notifications (initialized, cancelled, ...) need no reply
    return {"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "method not found: %s" % method}}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError:
            _send({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "parse error"}})
            continue
        try:
            resp = handle(req)
        except Exception as e:  # never let one bad call kill the server
            resp = {"jsonrpc": "2.0", "id": req.get("id"), "error": {"code": -32603, "message": str(e)}}
        if resp is not None:
            _send(resp)
    browser.stop()  # client went away: take the browser down with us


if __name__ == "__main__":
    main()
