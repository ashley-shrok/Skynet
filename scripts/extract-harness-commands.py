#!/usr/bin/env python3
"""Regenerate the list of Claude Code commands the compose box refuses.

Skynet's compose box only carries Skynet's own commands. Every Claude Code
built-in slash command (names and aliases) and every skill bundled with
Claude Code is refused when typed, plus the extra names in EXTRA_BLOCKED.

Three sources, unioned:
  1. The installed Claude Code binary, read for its command definitions
     (objects carrying type "local" / "local-jsx" / "prompt" and a name) and
     their aliases. This is the only place aliases and the interactive-only
     commands show up.
  2. The same binary, read for the bundled skills it registers (each carries
     a prompt builder), so ones switched off for this account still count.
  3. A throwaway headless session's init message (slash_commands + skills),
     which is where Claude Code's bundled skills show up. It runs a local
     command, so no model call is made, and keeps no session on disk.

Skills and custom commands that live in the user's or the project's folders,
and plugin (namespaced) commands, aren't Claude Code's own, so they're
dropped from source 3. The session runs with hooks disabled. The script
refuses to run unless the installed Claude Code is the fleet's pinned
version (HARNESS_PIN). (A Skynet skill whose
name is ALSO a built-in, like `desktop`, still comes in through source 1.)

Usage:
  python3 scripts/extract-harness-commands.py          # rewrite the list
  python3 scripts/extract-harness-commands.py --check  # exit 1 if it would change

Prints what was added and removed against the current list; review that
before committing.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
OUT = REPO / "src" / "types" / "blocked-commands.generated.ts"
PIN = REPO / "src" / "backend" / "distributor" / "harness-pin.ts"

# Skynet's own commands that the composer must not carry either.
EXTRA_BLOCKED = ["id"]

# A typeable command name. Double underscores mark internal or tool-shaped
# names (e.g. an MCP tool prefix), never something a user types.
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9:_-]*$")
TYPE_RE = re.compile(r'type:"(?:local|local-jsx|prompt)"')
# Bundled skills register through a helper rather than a typed definition;
# every one carries its prompt builder, so that's what marks them.
SKILL_RE = re.compile(r"getPromptForCommand\(")


def find_binary() -> Path:
    claude = shutil.which("claude")
    if not claude:
        sys.exit("claude is not on PATH")
    return Path(os.path.realpath(claude))


def claude_version(binary: Path) -> str:
    out = subprocess.run([str(binary), "--version"], capture_output=True, text=True, check=True).stdout
    m = re.match(r"\s*([0-9][0-9.]*)", out)
    if not m:
        sys.exit(f"couldn't read the Claude Code version from {out!r}")
    return m.group(1)


def enclosing_object(text: str, start: int, end: int, reach: int = 3000) -> str:
    """The `{...}` literal around text[start:end], found by brace depth."""
    i, depth = start, 0
    while i > 0 and start - i < reach:
        c = text[i]
        if c == "}":
            depth += 1
        elif c == "{":
            if depth == 0:
                break
            depth -= 1
        i -= 1
    j, depth = end, 0
    while j < len(text) and j - end < reach:
        c = text[j]
        if c == "{":
            depth += 1
        elif c == "}":
            if depth == 0:
                break
            depth -= 1
        j += 1
    return text[i : j + 1]


def from_binary(binary: Path) -> set[str]:
    text = binary.read_bytes().decode("latin-1")
    names: set[str] = set()
    for m in TYPE_RE.finditer(text):
        obj = enclosing_object(text, m.start(), m.end())
        # Lazy loaders sit at the end of a definition and can hold other
        # objects' text; cut there.
        obj = obj.split("load:()=>", 1)[0]
        nm = re.search(r'(?<![\w$])name:"([^"]+)"', obj)
        if not nm:
            continue
        names.add(nm.group(1))
        al = re.search(r"aliases:\[([^\]]*)\]", obj)
        if al:
            names.update(re.findall(r'"([^"]+)"', al.group(1)))
    for m in SKILL_RE.finditer(text):
        obj = enclosing_object(text, m.start(), m.end())
        nm = re.search(r'(?<![\w$])name:"([^"]+)"', obj)
        if nm:
            names.add(nm.group(1))
    return names


def pinned_version() -> str:
    m = re.search(r'HARNESS_PIN\s*=\s*"([^"]+)"', PIN.read_text())
    if not m:
        sys.exit(f"couldn't read HARNESS_PIN from {PIN}")
    return m.group(1)


def local_names(cwd: Path) -> set[str]:
    """Skills and custom commands that live on this machine, not in Claude Code."""
    names: set[str] = set()
    for base in (Path.home() / ".claude", cwd / ".claude"):
        skills, commands = base / "skills", base / "commands"
        if skills.is_dir():
            names.update(p.name for p in skills.iterdir() if p.is_dir())
        if commands.is_dir():
            names.update(p.stem for p in commands.rglob("*.md"))
    return names


def from_headless(binary: Path) -> set[str]:
    with tempfile.TemporaryDirectory(prefix="harness-commands-") as tmp:
        proc = subprocess.run(
            [
                str(binary), "-p", "/context", "--no-session-persistence",
                "--output-format", "stream-json", "--verbose",
                # Keep this machine's hooks out of a throwaway session.
                "--settings", json.dumps({"disableAllHooks": True}),
            ],
            cwd=tmp,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=180,
        )
        init = None
        for line in proc.stdout.splitlines():
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("type") == "system" and msg.get("subtype") == "init":
                init = msg
                break
        if init is None:
            sys.exit(f"headless session never sent its init message (exit {proc.returncode}): {proc.stderr[-500:]}")
        names = set(init.get("slash_commands") or []) | set(init.get("skills") or [])
        # Namespaced names come from installed plugins, not Claude Code itself.
        names = {n for n in names if ":" not in n}
        return names - local_names(Path(tmp))


def current_list() -> set[str]:
    if not OUT.exists():
        return set()
    return set(re.findall(r'^\s*"([^"]+)",$', OUT.read_text(), re.M))


def render(version: str, names: list[str]) -> str:
    body = "\n".join(f'  "{n}",' for n in names)
    return f"""// GENERATED by scripts/extract-harness-commands.py — do not edit by hand.
// Re-run the script after the fleet moves to a new Claude Code version.

/** The Claude Code version this list was read from. */
export const BLOCKED_COMMANDS_HARNESS_VERSION = "{version}";

/**
 * Command names (without the slash, lowercase) that the compose box's text
 * area refuses: every Claude Code built-in and alias, every skill bundled with
 * Claude Code, and Skynet's own identity-loading command.
 */
export const BLOCKED_COMMAND_NAMES: readonly string[] = [
{body}
];
"""


def main() -> None:
    check = "--check" in sys.argv[1:]
    binary = find_binary()
    version = claude_version(binary)
    if version != pinned_version():
        sys.exit(f"installed Claude Code is {version} but the fleet pin is {pinned_version()} — run this on a box at the pin")
    names = from_binary(binary) | from_headless(binary) | set(EXTRA_BLOCKED)
    names = {n.lower() for n in names if NAME_RE.match(n.lower()) and "__" not in n}
    ordered = sorted(names)

    before = current_list()
    added, removed = sorted(names - before), sorted(before - names)
    print(f"Claude Code {version}: {len(ordered)} blocked names")
    if added:
        print("  added:   " + " ".join(added))
    if removed:
        print("  removed: " + " ".join(removed))

    rendered = render(version, ordered)
    if check:
        sys.exit(0 if OUT.exists() and OUT.read_text() == rendered else 1)
    OUT.write_text(rendered)
    print(f"wrote {OUT.relative_to(REPO)}")


if __name__ == "__main__":
    main()
