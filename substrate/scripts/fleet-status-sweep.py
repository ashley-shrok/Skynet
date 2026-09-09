#!/usr/bin/env python3
"""fleet-status-sweep.py — server-side batch emitter for the Skynet fleet-status poller.

Phase 92 Plan 02. Replaces the O(hosts × identities × sentinels) per-poll SSH
exec fan-out (~200+ `channel.exec` calls per cycle on a t1000-sized box) with
ONE exec-per-host-per-cycle that emits all per-identity + per-live-PID state
as a JSONL blob on stdout. See:
    .planning/phases/92-fleet-status-poller-batch-sweep-one-exec-per-host-not-one-pe/
        92-CONTEXT.md   — locked design decisions
        92-RESEARCH.md  — full exec inventory (A0..A12, B0..B5)
        92-01-PLAN.md   — schema module (parser + version constant)
        92-02-PLAN.md   — THIS script's spec

Wire contract (canonical): src/backend/fleet-status/sweep-schema.ts.
    - SWEEP_SCHEMA_VERSION == 1 lives on every emitted line.
    - `line_kind` discriminator is either "identity" or "pid".
    - Field names + types below must be BYTE-IDENTICAL to the TypeScript.
    - Every field described in SWEEP_FIELD_PARITY on the schema module is
      accounted for below with the same key name.

Invocation (production):
    ~/.local/bin/fleet-status-sweep      # no args, no stdin, reads env $HOME

Distribution: this file is git-committed with the execute bit set. The Skynet
distributor bundles substrate/scripts/*.* into the container at
/app/fleet-substrate/scripts/, and the Phase 75 startup-sweep pushes it to
~/.local/bin/fleet-status-sweep on every runs_fleet_substrate:true host once
the Plan 03 catalog row lands. The distributor's computeInstallMode mirrors
`fs.statSync().mode & 0o777` — a mode-drift bug that stripped the execute bit
on THIS file would ship a non-executable script to every managed box and
permanently pin the fleet on the legacy fallback path.

Stdout contract — VERY LOAD-BEARING:
    * stdout is JSONL emission ONLY. One JSON object per line, compact
      (no whitespace via json.dumps(..., separators=(",", ":"))).
    * ANY unhandled exception at the top level logs to stderr and returns
      exit 0 with empty stdout. The Skynet caller (Plan 04) treats
      `channel.exec` returning `null` OR schema-version-mismatch as
      "fall back to legacy per-identity plumbing this cycle". A stderr diag
      + exit 0 + empty stdout is a clean, non-noisy signal that means the
      SAME thing (parser sees zero lines → falls back). Never emit tracebacks
      or error strings on stdout — the caller's parser would attempt JSON on
      them and, worse, on a schema-1-looking substring they might parse.

Exec-site → emission mapping (parity with RESEARCH.md § "Current per-identity
/ per-host exec inventory"):

    A0  ls sessions/*.json                       → PID enumeration (this script)
    A1  cat sessions/<pid>.json                  → SweepPidLine.session_json
    A2  cat /proc/<pid>/stat                     → SweepPidLine.stat_result
    A3  cat last-stop-payload.json               → NOT emitted (legacy, RESEARCH G9)
    A4  cat /proc/<pid>/environ                  → folded → SweepPidLine.identity
    A5  tmux display-message                     → folded → SweepPidLine.identity
    A6  stat -c %Y stop-<sid>.json               → SweepPidLine.per_session_stop_mtime_ms
    A7  stat -c %Y hooks/<sid>/activity          → SweepPidLine.activity_mtime_ms
    A8  stat -c %Y hooks/<sid>/stopped           → SweepPidLine.stopped_mtime_ms
    A9  cat stop-<sid>.json                      → SweepPidLine.per_session_stop_payload
    A10 stat identities/<name>/.dormant  (A)     → SweepPidLine.dormant_a
    A11 discover JSONL path per PID              → folded (reused from B4)
    A12 tail -c 262144 <jsonlPath>               → SweepPidLine.jsonl_tail
    B0  find identities/                         → identity enumeration (this script)
    B1  stat identities/<name>/.dormant  (B)     → SweepIdentityLine.dormant
    B2  stat identities/<name>/.recycled-at      → SweepIdentityLine.recycled_at
    B3  test -f identities/<name>/.recycle-requested → SweepIdentityLine.recycle_requested
    B4  Phase 32 discovery script                → SweepIdentityLine.jsonl_path
    B5  tail-scan + isAshleyRealUserTurn + detectIdReset
                                                 → SweepIdentityLine.layer1_recycling

Ports verbatim (behavioral parity required — Plan 05 has a regression test):
    * isAshleyRealUserTurn        — ssh-poll-orchestrator.ts L432–L472 (7 steps).
    * scanTailForLayer1RecyclingSignal — ssh-poll-orchestrator.ts L636 (reducer).
    * detectIdReset               — claude-session/session-file-parser.ts L883.
    * __matchesIdentityFirstTurnForTests + delimiter guard
                                  — claude-session/discover-identity-session-file.ts
                                    L109 (DELIMITER_SET) + L134–L158 (predicate).
                                    Load-bearing: partial-match rejection ("tiff"
                                    must NOT match "tiffany" — the delimiter check
                                    is the load-bearing correctness property).

Constraints:
    * Python 3.6+ stdlib ONLY (no pip installs). Mirrors context-watch.py +
      wakeup-scheduler.py precedent — every managed box already has Python 3.
    * Exit 0 ALWAYS. Never nonzero. `channel.exec` returning null must indicate
      SSH transport failure, never our own failure.
    * G6 safe-char guard on identity names + sessionIds (defense-in-depth;
      caller re-applies in Plan 04 belt-and-suspenders).
"""

import glob
import json
import os
import re
import subprocess
import sys
import traceback
from datetime import datetime

# ---------------------------------------------------------------------------
# Schema version — MUST match SWEEP_SCHEMA_VERSION in sweep-schema.ts.
# ---------------------------------------------------------------------------

SCHEMA_VERSION = 1

# ---------------------------------------------------------------------------
# G6 safe-char regex — mirrors ssh-poll-orchestrator.ts L1333 et al.
# ---------------------------------------------------------------------------

# Matches ssh-poll-orchestrator.ts's /^[a-zA-Z0-9_-]+$/ character class. Applied
# server-side to (a) identity folder names before per-identity emission, and
# (b) sessionId strings before any per-session stat/cat under
# ~/.claude/fleet-status/**. Both loci reject non-safe values by emitting
# nulls (or skipping) — this matches the caller's fail-open contract for
# path-traversal defense.
SAFE_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")

# ---------------------------------------------------------------------------
# Phase 32 discovery — mirrors discover-identity-session-file.ts.
# ---------------------------------------------------------------------------

# The four delimiter characters that MAY appear immediately after the identity
# name inside `<command-args>` (see DELIMITER_SET in discover-identity-session-
# file.ts:109 + the end-of-line case at :155). Load-bearing: partial-name
# matches like "tiff" against "tiffany" are REJECTED because the char at
# nameEnd is "a" (not in this set and not end-of-line).
DISCOVERY_DELIMITER_SET = frozenset(("<", " ", "\r"))

# Bound the head-read at the same 4096 the shell version uses so the Python
# port produces the same candidate set (see buildDiscoveryScript's
# `head -c 4096` in discover-identity-session-file.ts:209).
DISCOVERY_HEAD_BYTES = 4096

# ---------------------------------------------------------------------------
# JSONL tail width — mirrors A12 / B5 exec sites in ssh-poll-orchestrator.ts.
# ---------------------------------------------------------------------------

TAIL_BYTES = 262144  # 256 KB — same window as `tail -c 262144`.

# ---------------------------------------------------------------------------
# Subprocess timeout for the tmux display-message call.
# ---------------------------------------------------------------------------

# The TS side has no explicit timeout on the tmux exec (it runs inside the
# semaphore-bounded exec wrapper). We add a short local timeout so a hung
# `tmux display-message` on a wedged tmux server can't block the entire sweep.
# 1.5s is well above the local IPC round-trip (~<10ms typical) but small enough
# that a single bad PID can't push us anywhere near the sweep-script-caller's
# ~5s Promise.race wrapper on the Skynet side.
TMUX_TIMEOUT_SEC = 1.5


# ---------------------------------------------------------------------------
# Small logging helper — stderr only. Every op is grep-able.
# ---------------------------------------------------------------------------


def _log(op, **fields):
    """Emit ONE stderr line in a rough loose-JSON-with-op shape.

    Uses stderr because stdout is the JSONL wire and MUST remain silent when
    there is nothing to emit. Never raise from here — if json.dumps chokes
    (should not, we only feed it primitives), we fall back to a repr line.
    """
    try:
        parts = [f"op={op}"]
        for k, v in fields.items():
            parts.append(f"{k}={json.dumps(v)}")
        sys.stderr.write("[fleet-status-sweep] " + " ".join(parts) + "\n")
    except Exception:
        sys.stderr.write(f"[fleet-status-sweep] op={op} fields={fields!r}\n")


# ---------------------------------------------------------------------------
# Section — port of __matchesIdentityFirstTurnForTests (discover-identity-
# session-file.ts L134–L158).
# ---------------------------------------------------------------------------


def _matches_identity_first_turn(line, identity_name):
    """Byte-pattern predicate: is `line` a real /id <identity_name> first turn?

    Verbatim port of `__matchesIdentityFirstTurnForTests` in
    discover-identity-session-file.ts. Load-bearing checks (in order):
      1. Line contains `"type":"user"` AND does NOT contain `"tool_result"`.
      2. Line contains `<command-name>/id</command-name>` (literal).
      3. Line contains `<command-args><identity_name>` where the char
         immediately after identity_name is in DISCOVERY_DELIMITER_SET or is
         end-of-line.

    Partial-match rejection is the load-bearing correctness property: given
    identity_name="tiff", a line with `<command-args>tiffany<...` MUST return
    False (char at nameEnd is "a", not in the delimiter set).
    """
    if '"type":"user"' not in line:
        return False
    if '"tool_result"' in line:
        return False
    if "<command-name>/id</command-name>" not in line:
        return False
    args_tag = "<command-args>"
    args_idx = line.find(args_tag)
    if args_idx == -1:
        return False
    name_start = args_idx + len(args_tag)
    name_end = name_start + len(identity_name)
    if line[name_start:name_end] != identity_name:
        return False
    # end-of-line case: nothing exists at position name_end
    if name_end >= len(line):
        return True
    return line[name_end] in DISCOVERY_DELIMITER_SET


# ---------------------------------------------------------------------------
# Section — Phase 32 discovery, server-side (answers open question #3).
# ---------------------------------------------------------------------------


def discover_identity_jsonl_path(identity_name, home):
    """Walk ~/.claude/projects/*/, mtime-desc, return first JSONL whose first
    user-role line matches `/id <identity_name>` (with the strict delimiter
    guard). Returns absolute path str or None.

    Mirrors the shell `buildDiscoveryScript` in discover-identity-session-file.ts:
      1. find ~/.claude/projects/ -maxdepth 2 -type f -name '*.jsonl'
      2. sort by mtime descending
      3. for each: read up to DISCOVERY_HEAD_BYTES, find the FIRST line
         containing `"role":"user"` (matches the shell's
         `grep -m 1 '"role":"user"'`), then apply the predicate to that line.
      4. Return the first path whose predicate hit.

    Fail-safe: any OSError under a candidate file is silently swallowed and
    the file is skipped (we would rather miss one discovery than crash the
    sweep). ENOENT on the projects dir → return None.
    """
    projects_root = os.path.join(home, ".claude", "projects")
    try:
        # find -maxdepth 2 == projects_root/<slug>/<file>. Enumerate slug dirs
        # first, then JSONLs under each.
        candidates = []
        try:
            slug_entries = os.listdir(projects_root)
        except FileNotFoundError:
            return None
        except OSError:
            return None
        for slug in slug_entries:
            slug_dir = os.path.join(projects_root, slug)
            try:
                if not os.path.isdir(slug_dir):
                    continue
                for fname in os.listdir(slug_dir):
                    if not fname.endswith(".jsonl"):
                        continue
                    fpath = os.path.join(slug_dir, fname)
                    try:
                        st = os.stat(fpath)
                    except OSError:
                        continue
                    candidates.append((st.st_mtime, fpath))
            except OSError:
                continue
        # Sort mtime descending. Ties broken by path (stable, deterministic).
        candidates.sort(key=lambda t: (-t[0], t[1]))
        for _mtime, fpath in candidates:
            try:
                with open(fpath, "rb") as fh:
                    head = fh.read(DISCOVERY_HEAD_BYTES)
            except OSError:
                continue
            try:
                text = head.decode("utf-8", errors="replace")
            except Exception:
                continue
            # Emulate `grep -m 1 '"role":"user"'`: find the first line
            # containing that substring. If none, skip file.
            first_user_role_line = None
            for candidate_line in text.split("\n"):
                if '"role":"user"' in candidate_line:
                    first_user_role_line = candidate_line
                    break
            if first_user_role_line is None:
                continue
            if _matches_identity_first_turn(first_user_role_line, identity_name):
                return fpath
        return None
    except Exception:
        # Defensive top-level catch — never propagate up out of discovery.
        _log("discovery_unexpected_error", identity=identity_name,
             err=traceback.format_exc(limit=1).strip())
        return None


# ---------------------------------------------------------------------------
# Section — port of detectIdReset (session-file-parser.ts L883).
# ---------------------------------------------------------------------------


def _detect_id_reset(obj):
    """Return True iff obj is a real `/id reset` user turn.

    Port of detectIdReset in session-file-parser.ts. Four conditions:
      1. obj["type"] == "user"
      2. obj.get("isMeta") is not True
      3. message.content is a plain string (not a list — tool_result lives
         in array-shaped content).
      4. content contains BOTH `<command-name>/id</command-name>`
         AND `<command-args>reset` (prefix match — freeform explanations
         like `<command-args>reset because I want to switch roles</command-args>`
         still qualify).

    NB: the pattern is `<command-args>reset`, NOT `<command-args><identity_name>`
    — the plan's narrative was a summary; the load-bearing predicate is on the
    literal token "reset". See detectIdReset docblock for the full history.
    """
    if not isinstance(obj, dict):
        return False
    if obj.get("type") != "user":
        return False
    if obj.get("isMeta") is True:
        return False
    msg = obj.get("message")
    if not isinstance(msg, dict):
        return False
    content = msg.get("content")
    if isinstance(content, list):
        return False
    if not isinstance(content, str):
        return False
    if "<command-name>/id</command-name>" not in content:
        return False
    if "<command-args>reset" not in content:
        return False
    return True


# ---------------------------------------------------------------------------
# Section — port of isAshleyRealUserTurn (ssh-poll-orchestrator.ts L432–L472).
# ---------------------------------------------------------------------------

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1F]")


def _is_ashley_real_user_turn(raw_line):
    """Return (True, ts_ms) if raw_line is a real Ashley user turn, else (False, None).

    Verbatim port of the 7-step predicate in ssh-poll-orchestrator.ts
    L432–L472. Numbering below matches the TS steps 1..7 (plus the timestamp
    parse at the end).
    """
    trimmed = raw_line.strip()
    if trimmed == "":
        return False, None
    try:
        obj = json.loads(trimmed)
    except Exception:
        return False, None
    if not isinstance(obj, dict):
        return False, None
    # Step 2 (numbering per TS docblock): top.type must be "user".
    if obj.get("type") != "user":
        return False, None
    # Step 3: message.content must be a plain string.
    msg = obj.get("message")
    if not isinstance(msg, dict):
        return False, None
    content = msg.get("content")
    if not isinstance(content, str):
        return False, None
    # Step 4: XML-wrapper exclusion — reject "<...>" content UNLESS it's a
    # <command-...> slash-command.
    t = content.strip()
    is_xml_wrapper = t.startswith("<") and t.endswith(">")
    is_command = t.startswith("<command-")
    if not is_command and is_xml_wrapper:
        return False, None
    # Step 5: drop /exit slash-command injected by agent-supervisor.
    if "<command-name>/exit</command-name>" in content:
        return False, None
    # Step 6: drop control-chars-only content (e.g. "\x03\x03" Ctrl-C).
    if _CONTROL_CHAR_RE.sub("", t) == "":
        return False, None
    # Step 7: drop agent-supervisor resumed-injection sentinel.
    if content.startswith("Your session was just resumed by the agent-supervisor"):
        return False, None
    # Timestamp: must be ISO-8601 parseable → unix ms.
    raw_ts = obj.get("timestamp")
    if not isinstance(raw_ts, str):
        return False, None
    ts_ms = _parse_iso_to_unix_ms(raw_ts)
    if ts_ms is None:
        return False, None
    return True, ts_ms


def _parse_iso_to_unix_ms(iso_str):
    """Parse an ISO-8601 timestamp string to unix ms int, or None on failure.

    Mirrors JS Date.parse semantics closely enough for the isAshley predicate
    (we only use the truthy/falsy return, not the exact ms value — the JS
    return is used for lastMessageAt elsewhere but here it's just a gate).
    Handles the `Z` suffix and `±HH:MM` offsets, plus fractional seconds.
    """
    try:
        s = iso_str
        # Python 3.6 doesn't accept 'Z' in fromisoformat; normalize.
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        # datetime.fromisoformat is 3.7+; use a manual parse fallback for 3.6.
        try:
            dt = datetime.fromisoformat(s)
        except (AttributeError, ValueError):
            # Fallback: strip fractional seconds, use strptime.
            fmt = "%Y-%m-%dT%H:%M:%S"
            main = s
            if "." in main:
                # Preserve tz suffix if present after the fractional part.
                head, tail = main.split(".", 1)
                # tail may contain "digits[+offset]"; find the first non-digit.
                i = 0
                while i < len(tail) and tail[i].isdigit():
                    i += 1
                main = head + tail[i:]
            try:
                dt = datetime.strptime(main, fmt + "%z")
            except ValueError:
                try:
                    dt = datetime.strptime(main, fmt)
                except ValueError:
                    return None
        ts = dt.timestamp()
        return int(ts * 1000)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Section — port of scanTailForLayer1RecyclingSignal (ssh-poll-orchestrator.ts L636).
# ---------------------------------------------------------------------------


def scan_tail_for_layer1_recycling_signal(tail_contents):
    """Return True/False/None per the reducer at L636.

    Walks lines in order (chronological on JSONL append). For each line:
      * skip empty lines.
      * pre-filter with isAshleyRealUserTurn (skip harness-synthetic user
        turns per inline-260830-layer1-skip-harness-synthetic-user-turns).
      * JSON.parse and apply detectIdReset; remember the result.

    Return the LAST remembered result (last real user turn wins). None if
    no real user turn was seen (caller preserves cached value — fail-open).
    """
    last_result = None
    if not tail_contents:
        return None
    for line in tail_contents.split("\n"):
        if line.strip() == "":
            continue
        ok, _ts = _is_ashley_real_user_turn(line)
        if not ok:
            continue
        try:
            parsed = json.loads(line)
        except Exception:
            # Belt-and-suspenders — isAshley would already have failed here.
            continue
        last_result = _detect_id_reset(parsed)
    return last_result


# ---------------------------------------------------------------------------
# Section — helper: read the last TAIL_BYTES of a file safely.
# ---------------------------------------------------------------------------


def _read_tail_bytes(path):
    """Read the last TAIL_BYTES bytes of `path` (or the whole file if smaller).

    Returns a str (decoded utf-8 with errors="replace"), or None on any
    OSError. Deliberately mirrors `tail -c 262144 <path> 2>/dev/null`.
    """
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            start = max(0, size - TAIL_BYTES)
            fh.seek(start, os.SEEK_SET)
            data = fh.read()
        return data.decode("utf-8", errors="replace")
    except OSError:
        return None


# ---------------------------------------------------------------------------
# Section — helper: extract TMUX_PANE + TMUX from /proc/<pid>/environ.
# ---------------------------------------------------------------------------


# Mirrors isValidTmuxPaneId in pid-to-tmux.ts:82 — must be % followed by digits.
_PANE_ID_RE = re.compile(r"^%\d+$")


def _read_pid_environ(pid):
    """Read /proc/<pid>/environ. Returns bytes or None."""
    try:
        with open(f"/proc/{pid}/environ", "rb") as fh:
            return fh.read()
    except OSError:
        return None


def _extract_env_from_environ(environ_bytes, key):
    """Extract the value of KEY from NUL-separated environ bytes.

    Returns str or None. Mirrors extractTmuxPaneFromEnviron in pid-to-tmux.ts —
    strict startsWith so "TMUX_PANE_SOMETHING=" does not match "TMUX_PANE=".
    """
    if environ_bytes is None:
        return None
    try:
        text = environ_bytes.decode("utf-8", errors="replace")
    except Exception:
        return None
    prefix = key + "="
    for entry in text.split("\0"):
        if entry.startswith(prefix):
            value = entry[len(prefix):]
            return value if len(value) > 0 else None
    return None


def _resolve_pid_to_tmux_session(pid):
    """PID → tmux session name (identity name on this fleet). None on failure.

    Server-side port of resolvePidToTmuxSession (pid-to-tmux.ts). Steps:
      1. Read /proc/<pid>/environ. Missing → None.
      2. Extract TMUX_PANE. Missing → None.
      3. Validate pane id against ^%\\d+$ (SECURITY GATE — defense-in-depth
         against garbage environ writes even though we do NOT interpolate
         the pane into a shell string here; subprocess.run's arg list is
         inherently safe from shell metacharacters).
      4. Extract TMUX socket path (defensive: sets TMUX env for the tmux call
         so we hit the right server if the box runs multiple tmux sockets).
      5. Run `tmux display-message -p -t %N '#{session_name}'`. On non-zero
         exit / timeout → None. On success → stripped stdout.
    """
    environ = _read_pid_environ(pid)
    if environ is None:
        return None
    pane = _extract_env_from_environ(environ, "TMUX_PANE")
    if pane is None:
        return None
    if not _PANE_ID_RE.match(pane):
        _log("tmux_pane_invalid", pid=pid, pane=pane[:40])
        return None
    tmux_env = _extract_env_from_environ(environ, "TMUX")
    # Build a minimal env for the subprocess. Preserve PATH and HOME so tmux
    # itself resolves; set TMUX if we found one (harmless if absent — tmux
    # will fall back to the default socket at /tmp/tmux-<uid>/default).
    child_env = dict(os.environ)
    if tmux_env:
        child_env["TMUX"] = tmux_env
    try:
        result = subprocess.run(
            ["tmux", "display-message", "-p", "-t", pane, "#{session_name}"],
            capture_output=True,
            text=True,
            timeout=TMUX_TIMEOUT_SEC,
            env=child_env,
        )
    except subprocess.TimeoutExpired:
        _log("tmux_timeout", pid=pid, pane=pane)
        return None
    except Exception:
        _log("tmux_exec_failed", pid=pid, pane=pane,
             err=traceback.format_exc(limit=1).strip())
        return None
    if result.returncode != 0:
        return None
    name = result.stdout.strip()
    return name if name else None


# ---------------------------------------------------------------------------
# Section — helper: mtime → ms int (or None on ENOENT).
# ---------------------------------------------------------------------------


def _mtime_ms(path):
    """Return int(st_mtime * 1000) or None on ENOENT / OSError."""
    try:
        st = os.stat(path)
    except OSError:
        return None
    return int(st.st_mtime * 1000)


def _read_text_file(path):
    """Read whole file as decoded str (errors=replace) or None on OSError."""
    try:
        with open(path, "rb") as fh:
            data = fh.read()
    except OSError:
        return None
    return data.decode("utf-8", errors="replace")


# ---------------------------------------------------------------------------
# Section — helper: per-PID /proc/<pid>/stat read producing SweepStatResult.
# ---------------------------------------------------------------------------


def _read_proc_stat(pid):
    """Return SweepStatResult dict shape for /proc/<pid>/stat.

    Discriminated union matching SweepStatResult in sweep-schema.ts:
        { "ok": True,  "content": str }
        { "ok": False, "reason": "enoent" }
        { "ok": False, "reason": "transport" }

    /proc/<pid>/stat is virtual and can vanish between checks; we use
    os.open + os.read (not `with open()`) so a race where the PID dies mid-
    read is surfaced deterministically as ENOENT rather than as a partial
    read of stale content. Any OSError that is NOT ENOENT is classified as
    "transport" to keep the caller's fail-open path (Bounty 9c8d4a72) intact.
    """
    path = f"/proc/{pid}/stat"
    fd = None
    try:
        fd = os.open(path, os.O_RDONLY)
        chunks = []
        while True:
            chunk = os.read(fd, 4096)
            if not chunk:
                break
            chunks.append(chunk)
        raw = b"".join(chunks).decode("utf-8", errors="replace")
        return {"ok": True, "content": raw}
    except FileNotFoundError:
        return {"ok": False, "reason": "enoent"}
    except OSError as e:
        # Any non-ENOENT OSError → transport. Near-zero probability in-process,
        # but keep the shape so the caller's isStaleFromStat code path is
        # untouched.
        _log("proc_stat_transport_error", pid=pid, errno=e.errno)
        return {"ok": False, "reason": "transport"}
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass


# ---------------------------------------------------------------------------
# Emission phase — build SweepIdentityLine and SweepPidLine dicts.
# ---------------------------------------------------------------------------


def _build_identity_line(name, home, sentinels, jsonl_path, jsonl_tail_cache):
    """Assemble a SweepIdentityLine dict.

    Runs discovery lazily via `jsonl_path` (already computed and passed in
    to allow sharing with per-PID emission — A11 folded into B4). Caches the
    tail read result in `jsonl_tail_cache` keyed by identity name so the
    per-PID emission below can reuse it without a second read.
    """
    layer1 = None
    tail_str = None
    if jsonl_path is not None:
        tail_str = _read_tail_bytes(jsonl_path)
        if tail_str is not None:
            layer1 = scan_tail_for_layer1_recycling_signal(tail_str)
    jsonl_tail_cache[name] = tail_str
    return {
        "line_kind": "identity",
        "schema_version": SCHEMA_VERSION,
        "identity": name,
        "dormant": sentinels["dormant"],
        "recycled_at": sentinels["recycled_at"],
        "recycle_requested": sentinels["recycle_requested"],
        "jsonl_path": jsonl_path,
        "layer1_recycling": layer1,
    }


def _build_pid_line(pid, identity, home, identity_jsonl_paths, jsonl_tail_cache):
    """Assemble a SweepPidLine dict.

    Fields match SweepPidLine in sweep-schema.ts. Per G6, if the sessionId
    fails the safe-char regex, the four per-session reads emit null.
    """
    session_json_path = os.path.join(home, ".claude", "sessions", f"{pid}.json")
    session_json = _read_text_file(session_json_path)

    stat_result = _read_proc_stat(pid)

    # Extract sessionId from session JSON — the sole server-side JSON parse
    # of per-PID payload we need to gate per-session reads.
    session_id = None
    if session_json is not None:
        try:
            sj_obj = json.loads(session_json)
            if isinstance(sj_obj, dict):
                candidate = sj_obj.get("sessionId")
                if isinstance(candidate, str) and SAFE_NAME_RE.match(candidate):
                    session_id = candidate
        except Exception:
            session_id = None

    if session_id is not None:
        stop_mtime_ms = _mtime_ms(os.path.join(
            home, ".claude", "fleet-status", f"stop-{session_id}.json",
        ))
        activity_mtime_ms = _mtime_ms(os.path.join(
            home, ".claude", "fleet-status", "hooks", session_id, "activity",
        ))
        stopped_mtime_ms = _mtime_ms(os.path.join(
            home, ".claude", "fleet-status", "hooks", session_id, "stopped",
        ))
        per_session_stop_payload = _read_text_file(os.path.join(
            home, ".claude", "fleet-status", f"stop-{session_id}.json",
        ))
    else:
        # G6 defense-in-depth — null out the four per-session reads.
        stop_mtime_ms = None
        activity_mtime_ms = None
        stopped_mtime_ms = None
        per_session_stop_payload = None

    # A10: dormant-A read for this identity. Even though it's byte-identical
    # to SweepIdentityLine.dormant in the common case (RESEARCH G7), the
    # caller's dual-frame code path in Plan 04 consumes them as distinct
    # fields, so we emit both.
    if identity is not None and SAFE_NAME_RE.match(identity):
        dormant_a = os.path.exists(os.path.join(
            home, ".claude", "identities", identity, ".dormant",
        ))
    else:
        dormant_a = False

    # A12: jsonl_tail — reuse the cache populated during identity emission.
    # If the identity had no discovered path OR the tail read failed, the
    # cached value is None; emit None.
    jsonl_tail = None
    if identity is not None:
        # Cache miss (identity not in the identity-set — should be rare;
        # can happen if a live PID exists for an identity whose folder does
        # not exist under ~/.claude/identities/). Attempt discovery just for
        # this PID's identity so ai-title scan still has fresh input.
        if identity not in jsonl_tail_cache:
            fallback_path = identity_jsonl_paths.get(identity)
            if fallback_path is None:
                fallback_path = discover_identity_jsonl_path(identity, home)
                identity_jsonl_paths[identity] = fallback_path
            if fallback_path is not None:
                jsonl_tail_cache[identity] = _read_tail_bytes(fallback_path)
            else:
                jsonl_tail_cache[identity] = None
        jsonl_tail = jsonl_tail_cache[identity]

    return {
        "line_kind": "pid",
        "schema_version": SCHEMA_VERSION,
        "identity": identity if identity is not None else "",
        "pid": pid,
        "session_json": session_json,
        "stat_result": stat_result,
        "per_session_stop_mtime_ms": stop_mtime_ms,
        "activity_mtime_ms": activity_mtime_ms,
        "stopped_mtime_ms": stopped_mtime_ms,
        "per_session_stop_payload": per_session_stop_payload,
        "dormant_a": dormant_a,
        "jsonl_tail": jsonl_tail,
    }


# ---------------------------------------------------------------------------
# Enumeration + orchestration.
# ---------------------------------------------------------------------------


def _enumerate_identities(home):
    """Return list of dicts {name, dormant, recycled_at, recycle_requested}.

    Iterates ~/.claude/identities/*/. On FileNotFoundError, returns []. Skips
    entries whose name fails the safe-char regex (G6 server-side belt).
    """
    identities_root = os.path.join(home, ".claude", "identities")
    out = []
    try:
        with os.scandir(identities_root) as it:
            for entry in it:
                if not entry.is_dir(follow_symlinks=False):
                    continue
                name = entry.name
                if not SAFE_NAME_RE.match(name):
                    _log("identity_name_skipped", name=name[:40])
                    continue
                dormant = os.path.exists(os.path.join(entry.path, ".dormant"))
                recycled_at = os.path.exists(os.path.join(entry.path, ".recycled-at"))
                recycle_requested = os.path.exists(
                    os.path.join(entry.path, ".recycle-requested"),
                )
                out.append({
                    "name": name,
                    "dormant": dormant,
                    "recycled_at": recycled_at,
                    "recycle_requested": recycle_requested,
                })
    except FileNotFoundError:
        return []
    except OSError as e:
        _log("identities_scandir_failed", errno=e.errno)
        return []
    return out


def _enumerate_pids(home):
    """Return list of (pid_int, session_json_path_str) tuples.

    Iterates ~/.claude/sessions/*.json. On non-numeric basename, skip. On no
    matches, return [].
    """
    sessions_glob = os.path.join(home, ".claude", "sessions", "*.json")
    out = []
    for path in glob.glob(sessions_glob):
        base = os.path.basename(path)
        stem = base[:-len(".json")] if base.endswith(".json") else base
        try:
            pid = int(stem)
        except ValueError:
            continue
        out.append((pid, path))
    return out


def _emit(record):
    """Write one JSON line to stdout — compact, terminated with \\n."""
    sys.stdout.write(json.dumps(record, separators=(",", ":")))
    sys.stdout.write("\n")


def main():
    home = os.environ.get("HOME")
    if not home:
        _log("no_home_env")
        return 0

    # ---- Enumerate identities from folder + PIDs from sessions dir. ----
    identity_records = _enumerate_identities(home)
    pid_records = _enumerate_pids(home)

    # ---- Resolve PID → identity via /proc/<pid>/environ + tmux. ----
    resolved_pids = []  # list of (pid, identity_or_None)
    for pid, _path in pid_records:
        identity = _resolve_pid_to_tmux_session(pid)
        resolved_pids.append((pid, identity))

    # ---- Union: any resolved identity NOT in the folder scan gets a synthetic
    #      identity record with sentinels false (RESEARCH.md G7 corner —
    #      defensive; should not happen but the caller's dual-frame path
    #      relies on IdentityLine existing for every identity that has a
    #      PidLine). ----
    known_names = {r["name"] for r in identity_records}
    for _pid, identity in resolved_pids:
        if identity is None:
            continue
        if identity in known_names:
            continue
        if not SAFE_NAME_RE.match(identity):
            _log("resolved_identity_name_unsafe", name=identity[:40])
            continue
        identity_records.append({
            "name": identity,
            "dormant": False,
            "recycled_at": False,
            "recycle_requested": False,
        })
        known_names.add(identity)

    # ---- Per-identity discovery (Phase 32 port, server-side). ----
    identity_jsonl_paths = {}  # name -> str | None
    for rec in identity_records:
        identity_jsonl_paths[rec["name"]] = discover_identity_jsonl_path(
            rec["name"], home,
        )

    # ---- Emit identity lines first (all Layer-1 tail scans run here). ----
    jsonl_tail_cache = {}  # name -> str | None (populated by _build_identity_line)
    for rec in identity_records:
        line = _build_identity_line(
            rec["name"],
            home,
            {
                "dormant": rec["dormant"],
                "recycled_at": rec["recycled_at"],
                "recycle_requested": rec["recycle_requested"],
            },
            identity_jsonl_paths.get(rec["name"]),
            jsonl_tail_cache,
        )
        _emit(line)

    # ---- Emit pid lines. Skip PIDs with no resolved identity — matches
    #      today's "no tmuxSession → no source-A frame" path. ----
    for pid, identity in resolved_pids:
        if identity is None:
            continue
        line = _build_pid_line(
            pid, identity, home, identity_jsonl_paths, jsonl_tail_cache,
        )
        _emit(line)

    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    try:
        rc = main()
    except Exception:
        # LOAD-BEARING: any unhandled exception → stderr diag + exit 0 with
        # (possibly partial, possibly empty) stdout. The Skynet caller's
        # parser will silently discard anything that's not a valid schema-v1
        # JSONL line, so a truncated final line is harmless. What is NOT
        # acceptable is a nonzero exit or a traceback on stdout.
        sys.stderr.write("[fleet-status-sweep] op=unhandled_top_level_error\n")
        traceback.print_exc(file=sys.stderr)
        rc = 0
    sys.exit(rc if isinstance(rc, int) else 0)
