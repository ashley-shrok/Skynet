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
    B5  tail-scan + isRealUserTurn + detectIdReset
                                                 → SweepIdentityLine.layer1_recycling

Ports verbatim (behavioral parity required — Plan 05 has a regression test):
    * isRealUserTurn        — ssh-poll-orchestrator.ts L432–L472 (7 steps).
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
import socket
import subprocess
import sys
import time
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

# Role name validation — mirrors ambient-monitor.py's _ROLE_NAME_OK and the
# path-traversal guard in src/backend/claude-session/identity-artifact-reader.ts.
# A valid role name is all-lowercase alphanumeric with hyphens/underscores.
# This regex is applied BEFORE any os.path.join using the role name so a
# malformed role like `../../tmp` is rejected rather than becoming a path
# traversal (T-111-01).
ROLE_NAME_OK = re.compile(r"^[a-z0-9][a-z0-9_-]*$")

# Project slug validation — mirrors PROJECT_SLUG_RE at
# src/backend/claude-session/identity-artifact-reader.ts:193
# (Phase 117 D-05 identity carrier). Applied BEFORE emitting a `project`
# frontmatter value so a malformed slug never reaches identity_cosmetics.
PROJECT_SLUG_RE = re.compile(r"^[a-z0-9-]{1,64}$")

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

# Cap for frontmatter head-reads. Identity files are ~5-7 KB but role files
# reach 44,642 bytes (box-maintainer.md) while containing only ~4 lines of
# frontmatter. Reading at most this many characters (text-mode, NOT bytes)
# avoids buffering whole files. A file whose closing `---` fence falls beyond
# 4096 chars is treated as having no frontmatter → None → plain row. That
# fail-closed behaviour is intentional, not a bug (T-111-03).
FRONTMATTER_HEAD_BYTES = 4096

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
# Phase 118 — app enumeration constants (source C: ~/fleet/apps/*).
# ---------------------------------------------------------------------------

# App slug regex — mirrors the kebab-case pattern in substrate/skills/app-
# development/create-app.sh:32. Applied when reading the on-disk unit filename
# to reject anything that would traverse or otherwise not correspond to a
# legitimate app-<slug>.service filename.
APP_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]*$")

# Maximum slug length. Mirrors the [:40] clamps used in _log calls elsewhere;
# rejects abusively-long folder names before they reach the filesystem layer
# or a systemd unit name.
APP_SLUG_MAX_LEN = 40

# TCP loopback probe timeout for app health. A listening socket on 127.0.0.1
# = "app is up." 300 ms is enough for the local kernel accept path (no
# handshake beyond SYN/SYN-ACK) and comfortably inside the 8s exec budget
# even with APP_ENUM_CAP=50 apps × 300 ms serial = 15 s worst-case — but in
# practice healthy apps accept synchronously, and unhealthy ones ECONNREFUSE
# immediately, so total wall-time hovers under 1 s for realistic app counts.
APP_PORT_PROBE_TIMEOUT_SEC = 0.3

# `Environment=PORT=<n>` extractor for the user's systemd unit body. Anchored
# to a whole-word PORT= so we don't collide with `HTTP_PORT=` or similar.
APP_UNIT_ENV_PORT_RE = re.compile(r"^\s*Environment\s*=.*?\bPORT=(\d+)\b", re.MULTILINE)

# Phase 118 code-review MEDIUM-4 (fix pass 2026-09-18): DoS-hardening caps on
# the source-C app enumeration in _enumerate_apps. Prior shape iterated
# os.scandir(~/fleet/apps) with no upper bound; a malicious folder-creator or
# a bug spawning 100+ directories could each incur a ~1.5s systemctl call and
# dwarf the 8s exec ceiling. the user's design ceiling is ~10 apps per box
# (D-15 discussion, RESEARCH § Q6); 50 leaves 5× headroom.
APP_ENUM_CAP = 50
# Cumulative wall-clock budget for _enumerate_apps. If the app loop passes
# this threshold, bail with a structured warn and keep whatever we've built
# so far — the sweep still emits its identity + pid lines and the caller
# still gets a valid (partial) JSONL blob for this tick.
APP_ENUM_WALLCLOCK_BUDGET_SEC = 3.0


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


def _extract_id_name_from_first_turn(line):
    """Extract the identity name from a user-role JSONL line's `<command-name>
    /id</command-name><command-args>NAME<delim|EOL>` shape. Returns str or None.

    Inverse of `_matches_identity_first_turn`: instead of asking "does this
    line's args match a given identity_name?", this returns whatever name
    appears at the args position (bounded by DISCOVERY_DELIMITER_SET or EOL).
    Used by `discover_all_identity_jsonl_paths` to attribute each JSONL to at
    most one identity in a single pass.

    Correctness parity with the per-identity predicate:
      * Same delimiter set — a name terminated by `<`, ` `, `\\r`, or EOL is
        accepted verbatim; anything else means we're reading past the boundary
        into the rest of the args content, so we truncate at the delimiter.
      * Same guard against tool-result rows (`"tool_result"` present) and
        non-user turns (`"type":"user"` absent).
      * Extracted name must pass SAFE_NAME_RE — belt-and-suspenders against
        oddball args content that happened to contain the tag literals.
    """
    if '"type":"user"' not in line:
        return None
    if '"tool_result"' in line:
        return None
    if "<command-name>/id</command-name>" not in line:
        return None
    args_tag = "<command-args>"
    args_idx = line.find(args_tag)
    if args_idx == -1:
        return None
    name_start = args_idx + len(args_tag)
    i = name_start
    while i < len(line) and line[i] not in DISCOVERY_DELIMITER_SET:
        i += 1
    name = line[name_start:i]
    if not name:
        return None
    if not SAFE_NAME_RE.match(name):
        return None
    return name


def discover_all_identity_jsonl_paths(identity_names, home):
    """Single-pass inverted discovery — walks ~/.claude/projects/*/*.jsonl ONCE
    and returns a dict {name: path_or_None} covering every name in
    identity_names.

    Replaces the pre-2026-09-25 per-identity call pattern where each identity
    triggered an independent full walk of the projects tree (O(identities ×
    jsonls) worst-case for identities with no matching JSONL — the pathological
    shape on workstation-sized boxes with 100+ mostly-dormant identities).

    Algorithm:
      1. Enumerate every JSONL under ~/.claude/projects/*/ once.
      2. Sort mtime-desc (same order as the per-identity path used).
      3. For each JSONL in order: read its head (bounded by DISCOVERY_HEAD_BYTES),
         find the first `"role":"user"` line, extract whatever identity name
         appears in `<command-args>` at that position.
      4. If the extracted name is in identity_names AND we haven't already
         mapped it (i.e. an even more recent JSONL didn't beat this one), map it.
      5. Early-out once every requested identity has been mapped.

    First-hit-per-identity wins under mtime-desc = MOST RECENT session wins,
    matching the semantics of the pre-inversion per-identity walk.

    Correctness parity with the pre-inversion path:
      * Delimiter guard — `tiff` will NOT match a JSONL whose `<command-args>`
        starts with `tiffany` (that JSONL attributes to `tiffany`, not `tiff`,
        because the extractor walks forward to a delimiter).
      * Fail-safe — any OSError on a candidate file skips that file only;
        FileNotFoundError on the projects dir returns the {name: None} map
        as-is.

    Fallback: the single-identity `discover_identity_jsonl_path` below stays
    for `_build_pid_line` to handle the rare case where a live PID belongs
    to an identity whose folder does not exist under ~/fleet/identities/ and
    was not passed into this bulk call.
    """
    result = {name: None for name in identity_names}
    if not result:
        return result
    identity_set = set(identity_names)
    remaining = set(identity_names)

    projects_root = os.path.join(home, ".claude", "projects")
    candidates = []
    try:
        slug_entries = os.listdir(projects_root)
    except FileNotFoundError:
        return result
    except OSError:
        return result
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
    candidates.sort(key=lambda t: (-t[0], t[1]))

    for _mtime, fpath in candidates:
        if not remaining:
            break
        try:
            with open(fpath, "rb") as fh:
                head = fh.read(DISCOVERY_HEAD_BYTES)
        except OSError:
            continue
        try:
            text = head.decode("utf-8", errors="replace")
        except Exception:
            continue
        first_user_role_line = None
        for candidate_line in text.split("\n"):
            if '"role":"user"' in candidate_line:
                first_user_role_line = candidate_line
                break
        if first_user_role_line is None:
            continue
        name = _extract_id_name_from_first_turn(first_user_role_line)
        if name is None:
            continue
        if name not in identity_set:
            continue
        if result[name] is not None:
            continue
        result[name] = fpath
        remaining.discard(name)
    return result


def discover_identity_jsonl_path(identity_name, home):
    """Walk ~/.claude/projects/*/, mtime-desc, return first JSONL whose first
    user-role line matches `/id <identity_name>` (with the strict delimiter
    guard). Returns absolute path str or None.

    Legacy single-identity path — retained for `_build_pid_line`'s fallback
    lookup when a live PID belongs to an identity that was not enumerated in
    the initial ~/fleet/identities/ scan. The main sweep loop uses the batch
    inversion above (`discover_all_identity_jsonl_paths`).

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
# Section — port of isRealUserTurn (ssh-poll-orchestrator.ts L432–L472).
# ---------------------------------------------------------------------------

_CONTROL_CHAR_RE = re.compile(r"[\x00-\x1F]")


def _is_real_user_turn(raw_line):
    """Return (True, ts_ms) if raw_line is a real user user turn, else (False, None).

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

    Mirrors JS Date.parse semantics closely enough for the timestamp parser
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
      * pre-filter with isRealUserTurn (skip harness-synthetic user
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
        ok, _ts = _is_real_user_turn(line)
        if not ok:
            continue
        try:
            parsed = json.loads(line)
        except Exception:
            # Belt-and-suspenders — _is_real_user_turn would already have failed here.
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
# Phase 118 (revised 2026-09-19) — filesystem-only app inspection helpers.
#
# Prior shape (Phase 118 ship): a `systemctl --user show app-<slug>.service`
# call gave existence (LoadState=loaded), health (ActiveState=active), and
# port (Environment=PORT=<n>) in one round-trip. That broke on the Skynet
# self-poll (hostId 6) once peer's isLocalHostId acquireLocalChannel fix
# ran the sweep from inside the container: the container is uid 0 with no
# /run/user/1000 mount and no dbus session, so every `systemctl --user`
# call transport-failed → sweep dropped every t1000 app-line silently.
#
# Fix: the source of truth for existence + port is the unit file on disk
# under ~/.config/systemd/user/app-<slug>.service — the same file systemd
# itself reads. Health becomes a TCP loopback probe on 127.0.0.1:<port>.
# Filesystem-only, matches the identities path (which also reads sentinels
# rather than asking systemd), works uniformly across every host including
# the container self-poll.
#
# The port-probe health signal is weaker than ActiveState=active (a wedged
# app returning 500s still probes green), but the sidebar tile only needs
# "is this reachable" — the full-app view surfaces detail. The old signal
# was also imperfect (systemd-active with a hung request loop probes green
# the same way).
# ---------------------------------------------------------------------------


def _read_app_unit_file(slug, home):
    """Return unit-file text or None if the file doesn't exist / can't be read.

    Existence of ~/.config/systemd/user/app-<slug>.service is the source of
    truth for "this app is registered on this box" — same file `systemctl
    --user daemon-reload` reads, no systemd round-trip required.
    """
    path = os.path.join(home, ".config", "systemd", "user", f"app-{slug}.service")
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return fh.read()
    except (FileNotFoundError, PermissionError, OSError):
        return None


def _probe_app_port(port):
    """Return True if 127.0.0.1:<port> accepts a TCP connect within the timeout.

    A listening socket on loopback = "the app is up." Not a full HTTP health
    check — an app returning 500s or wedged mid-request would still pass, and
    an app that binds only to a non-loopback interface would falsely fail.
    For the sidebar tile that's a reasonable tradeoff; the frontend surfaces
    a probe-fail as "not running" and the user can drill into the full-app
    view for detail.
    """
    if not isinstance(port, int) or port <= 0 or port > 65535:
        return False
    try:
        with socket.create_connection(
            ("127.0.0.1", port), timeout=APP_PORT_PROBE_TIMEOUT_SEC
        ):
            return True
    except (OSError, socket.timeout):
        return False


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


def _read_frontmatter_cosmetics(path, allowed_keys):
    """Return (cosmetics_dict_or_None, role_or_None) from a markdown file's YAML frontmatter.

    Reads at most FRONTMATTER_HEAD_BYTES characters (text-mode, utf-8-sig to
    strip BOM) and scans line-by-line between the first two `---` fence lines.
    Returns (None, None) on any read error or if no valid frontmatter block is
    found. Returns ({}, None) if frontmatter was found but no cosmetic keys or
    role line were present — the caller can distinguish "file missing / no
    frontmatter" from "file read, frontmatter present but empty".

    Security: `role:` is extracted and validated against ROLE_NAME_OK BEFORE
    it is ever used in an os.path.join. A malformed role like `../../tmp` is
    rejected here, never reaching path construction (T-111-01).

    Encoding: text mode with `utf-8-sig` so a UTF-8 BOM (Windows-style) does
    not silently prevent the first `---` fence from matching (mirrors
    ambient-monitor.py:257).

    Cap behaviour: if the closing `---` fence falls beyond FRONTMATTER_HEAD_BYTES
    characters, the capped read produces fewer than two fences → returns
    (None, None). This is the intended fail-closed behaviour, not a bug: the
    cap bounds the read of large role files (44 KB measured) and frontmatter
    that does not fit in 4096 chars is assumed absent.

    `task` values are free-form user prose and are the single most likely field
    to contain a `:` or a `#`. Because this is a line-oriented fence scan, not
    a YAML parser, `task` takes everything after the FIRST `:` and strips only
    trailing whitespace. Trailing `#...` comments are NOT stripped from `task`
    since a `#` inside prose is legitimate. All other fields DO have trailing
    YAML comments stripped. This asymmetry is intentional and documented here
    so it is not "fixed" by a future reader.

    `allowed_keys` governs which cosmetic keys are extracted (e.g. identity
    files allow `task` and `coordinator`; role files do not). `role:` is always
    extracted regardless of `allowed_keys`.
    """
    try:
        with open(path, encoding="utf-8-sig") as fh:
            raw = fh.read(FRONTMATTER_HEAD_BYTES)
    except OSError:
        return None, None
    except UnicodeDecodeError:
        # A binary file in an identity folder must not raise.
        return None, None

    lines = raw.split("\n")
    fences = [i for i, ln in enumerate(lines) if ln.strip() == "---"]
    if len(fences) < 2:
        return None, None

    cosmetics = {}
    role = None

    for line in lines[fences[0] + 1: fences[1]]:
        # Skip full-line comments (col-0-anchored check via lstrip).
        if line.lstrip().startswith("#"):
            continue

        # --- role: (always extracted; validated before any path use) ---
        m_role = re.match(r"^role:\s*(.+?)\s*(#.*)?$", line.rstrip("\n"))
        if m_role and role is None:
            raw_role = m_role.group(1).strip().strip('"').strip("'").strip()
            if ROLE_NAME_OK.match(raw_role):
                role = raw_role
            continue

        # --- coordinator: true (only true is ever emitted; absence = false) ---
        if "coordinator" in allowed_keys:
            if re.match(r"^coordinator:\s*true\s*(#.*)?$", line.rstrip("\n")):
                cosmetics["coordinator"] = True
                continue

        # --- task: free-form prose (no trailing comment strip; # is legitimate) ---
        if "task" in allowed_keys:
            m_task = re.match(r"^task:\s*(.+)$", line.rstrip("\n"))
            if m_task:
                val = m_task.group(1).rstrip()
                if val:
                    cosmetics["task"] = val
                continue

        # --- project: kebab-case slug, validated against PROJECT_SLUG_RE
        # (Phase 117 D-05 identity carrier). Per-identity, same discipline as
        # `task` — a role file's project: is NOT extracted (allowed_keys gate
        # controls that). Strip surrounding matching quotes so both bare
        # (`project: trip-planning`) and quoted (`project: "trip-planning"`)
        # forms survive. Malformed slugs are silently dropped — a garbage
        # frontmatter value must not paint the identity into a bogus section.
        if "project" in allowed_keys:
            m_proj = re.match(
                r"^project:\s*(.+?)\s*(#.*)?$", line.rstrip("\n")
            )
            if m_proj:
                raw_proj = m_proj.group(1).strip().strip('"').strip("'").strip()
                if PROJECT_SLUG_RE.match(raw_proj):
                    cosmetics["project"] = raw_proj
                continue

        # --- colorHue: int, must be in 0..359 (mirrors identity-artifact-reader.ts) ---
        # Accept bare (`324`) OR single/double-quoted (`'324'` / `"324"`) forms.
        # MDXEditor's frontmatter dialog emits the quoted form on save, and
        # Skynet's writers now standardize on it too, so both shapes appear
        # on disk. Strip surrounding matching quotes before int() so the
        # sweeper doesn't silently drop the field on a quoted value.
        if "colorHue" in allowed_keys:
            m_hue = re.match(r"^colorHue:\s*([^\s#]+)\s*(#.*)?$", line.rstrip("\n"))
            if m_hue:
                raw_hue = m_hue.group(1)
                if len(raw_hue) >= 2 and raw_hue[0] == raw_hue[-1] and raw_hue[0] in ("'", '"'):
                    raw_hue = raw_hue[1:-1]
                try:
                    hue_val = int(raw_hue)
                    if 0 <= hue_val <= 359:
                        cosmetics["colorHue"] = hue_val
                except ValueError:
                    pass
                continue

        # --- string fields: displayName, title, voice, avatar ---
        for key in ("displayName", "title", "voice", "avatar"):
            if key not in allowed_keys:
                continue
            m_str = re.match(
                r"^" + re.escape(key) + r":\s*(.+?)\s*(#.*)?$",
                line.rstrip("\n"),
            )
            if m_str:
                val = m_str.group(1).strip().strip('"').strip("'").strip()
                if val:
                    cosmetics[key] = val
                break

    return cosmetics, role


def _read_role_cosmetics(role, home, role_memo):
    """Return role cosmetics dict or None for `role`, memoizing the result.

    Returns None immediately when `role` is None (nothing to resolve).

    Uses `in role_memo` membership test (not .get()) so a memoized None is a
    cache HIT that prevents a second read — the "at most once per host per
    tick" requirement (D-02) must hold for missing role files just as strictly
    as for files that read fine.

    Builds the role file path as ~/fleet/roles/<role>/<role>.md. `role` has
    already passed ROLE_NAME_OK validation in _read_frontmatter_cosmetics, so
    no path traversal is possible.

    Logs a single _log line to stderr when the role file cannot be read — a
    role file that does not exist is a real configuration fact, not a silent
    no-op.
    """
    if role is None:
        return None
    if role in role_memo:
        return role_memo[role]
    role_path = os.path.join(home, "fleet", "roles", role, role + ".md")
    cosmetics, _ignored_role = _read_frontmatter_cosmetics(
        role_path, ("title", "displayName", "colorHue", "voice", "avatar"),
    )
    if cosmetics is None:
        _log("role_cosmetics_unreadable", role=role[:40])
    role_memo[role] = cosmetics
    return cosmetics


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


def _build_identity_line(name, home, sentinels, jsonl_path, jsonl_tail_cache, role_cosmetics_memo):
    """Assemble a SweepIdentityLine dict.

    Runs discovery lazily via `jsonl_path` (already computed and passed in
    to allow sharing with per-PID emission — A11 folded into B4). Caches the
    tail read result in `jsonl_tail_cache` keyed by identity name so the
    per-PID emission below can reuse it without a second read.

    New parameter `role_cosmetics_memo` (Phase 111-01): a per-tick dict shared
    across all identity lines so each role file is read at most once per tick
    (D-02). Pass {} for first call; the same dict must be reused across all
    _build_identity_line calls in a single tick.

    Fail-closed appearance contract: an unreadable identity or role file yields
    null cosmetics and the identity line is STILL emitted. Membership (the line
    being present) must never depend on appearance reads succeeding (T-111-04).
    """
    layer1 = None
    tail_str = None
    if jsonl_path is not None:
        tail_str = _read_tail_bytes(jsonl_path)
        if tail_str is not None:
            layer1 = scan_tail_for_layer1_recycling_signal(tail_str)
    jsonl_tail_cache[name] = tail_str

    # ---- Phase 111-01: appearance block. ----
    # Outer try/except is a belt: the helpers already swallow OSError, but this
    # guarantees that no unforeseen path error inside the appearance block can
    # prevent the identity line from being emitted (T-111-04).
    identity_cosmetics = None
    role = None
    role_cosmetics = None
    try:
        identity_path = os.path.join(home, "fleet", "identities", name, name + ".md")
        identity_cosmetics, role = _read_frontmatter_cosmetics(
            identity_path,
            # Phase 117 M6 follow-up: `project` extracted so DnD assignments
            # written by /identities/:key/project (session-project-write.ts)
            # propagate through the fleet-status pulse's identity_cosmetics
            # channel. Same discipline as `task` — per-identity, NOT
            # inherited from the role.
            ("displayName", "title", "colorHue", "voice", "task", "coordinator", "project"),
        )
        if identity_cosmetics is None:
            _log("identity_cosmetics_unreadable", identity=name[:40])
        role_cosmetics = _read_role_cosmetics(role, home, role_cosmetics_memo)
    except OSError:
        identity_cosmetics = None
        role = None
        role_cosmetics = None

    return {
        "line_kind": "identity",
        "schema_version": SCHEMA_VERSION,
        "identity": name,
        "dormant": sentinels["dormant"],
        "recycled_at": sentinels["recycled_at"],
        "recycle_requested": sentinels["recycle_requested"],
        "jsonl_path": jsonl_path,
        "layer1_recycling": layer1,
        "role": role,
        "identity_cosmetics": identity_cosmetics,
        "role_cosmetics": role_cosmetics,
        "pinned": sentinels["pinned"],
        # Phase 115 Plan 115-05 archived axis retired in the Phase 122 shape
        # follow-up. Field kept in the emit so peers running older sweep
        # schemas still see the expected key (always False now — the archive
        # tree is no longer walked).
        "archived": sentinels.get("archived", False),
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
            home, "fleet", "identities", identity, ".dormant",
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
        # not exist under ~/fleet/identities/). Attempt discovery just for
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
    """Return list of dicts {name, dormant, recycled_at, recycle_requested, pinned, archived}.

    Walks ~/fleet/identities/ only. Skips entries whose name fails the
    safe-char regex (G6 server-side belt). On FileNotFoundError, returns [] —
    a fresh host with no live tree yet is a valid fail-open shape.

    (Phase 115 Plan 115-02 removed the `.hidden` probe alongside the schema-
    side retirement per D-21. Phase 115 Plan 115-05 added an archive-tree
    walk emitting `archived: true` for archive-tree rows; the walk retired in
    the Phase 122 shape follow-up alongside the sidebar Archived section +
    wire pump. `archived` is still emitted for wire-shape stability with
    peer hosts still running older sweep schemas — always False now.)

    This function is a pure sentinel walk — it does NOT read frontmatter.
    Per-identity frontmatter reads happen inside _build_identity_line where
    the per-identity try/except can contain any read failure without aborting
    the whole host sweep.
    """
    out = []
    root = os.path.join(home, "fleet", "identities")
    try:
        with os.scandir(root) as it:
            for entry in it:
                if not entry.is_dir(follow_symlinks=False):
                    continue
                name = entry.name
                if not SAFE_NAME_RE.match(name):
                    _log("identity_name_skipped", name=name[:40])
                    continue
                dormant = os.path.exists(os.path.join(entry.path, ".dormant"))
                recycled_at = os.path.exists(
                    os.path.join(entry.path, ".recycled-at"),
                )
                recycle_requested = os.path.exists(
                    os.path.join(entry.path, ".recycle-requested"),
                )
                pinned = os.path.exists(os.path.join(entry.path, ".pinned"))
                out.append({
                    "name": name,
                    "dormant": dormant,
                    "recycled_at": recycled_at,
                    "recycle_requested": recycle_requested,
                    "pinned": pinned,
                    "archived": False,
                })
    except FileNotFoundError:
        # Live tree may not exist yet on a fresh host — return empty.
        pass
    except OSError as e:
        _log("identities_scandir_failed", errno=e.errno, root=root)
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


# ---------------------------------------------------------------------------
# Phase 118 — source C: ~/fleet/apps/* enumeration + line builder.
# ---------------------------------------------------------------------------


def _build_app_line(slug, folder_path, home):
    """Assemble a SweepAppLine dict, or return None if D-01 excludes it.

    D-01 checks (both must pass for inclusion):
      (a) folder contains a readable app.json that parses as JSON
      (b) a corresponding systemd --user unit FILE exists on disk at
          ~/.config/systemd/user/app-<slug>.service

    D-02 carve-out: if (a) + (b) pass but the port probe fails (or no PORT is
    declared in the unit body), still emit with is_healthy=false +
    health_message. Silent removal of a definitely-was-an-app is worse than
    surfacing the diagnostic.

    Returns a dict with the D-05 emit shape (line_kind, schema_version, slug,
    title, description, port, has_icon, created_at_ms, is_healthy,
    health_message) or None when D-01 (a) or (b) fails.
    """
    # (a) app.json parses. MEMBERSHIP gate per RESEARCH § Q8 — a bad card
    # means the app is NOT in the picture; return None, do NOT emit with
    # null title.
    app_json_path = os.path.join(folder_path, "app.json")
    try:
        with open(app_json_path, "r", encoding="utf-8") as fh:
            metadata = json.loads(fh.read())
    except (OSError, json.JSONDecodeError):
        _log("app_json_missing_or_malformed", slug=slug[:APP_SLUG_MAX_LEN])
        return None

    title = metadata.get("title") if isinstance(metadata, dict) else None
    description = (
        metadata.get("description") if isinstance(metadata, dict) else None
    )
    if not isinstance(title, str) or not isinstance(description, str):
        _log("app_json_bad_shape", slug=slug[:APP_SLUG_MAX_LEN])
        return None

    # Phase 130: users list for the per-user visibility gate. Optional key on
    # app.json; the substrate/skills/app-development README (added Phase 130)
    # tells agents on multi-user boxes (thenasty, ZoeyBattlestation) to add
    # this list when creating an app. Missing / non-list / mixed-type values
    # fall back to None (falls open per D-3 — every user with host access
    # sees the app; zero-migration invariant for existing app.json files
    # across the fleet).
    raw_users = metadata.get("users") if isinstance(metadata, dict) else None
    if isinstance(raw_users, list) and all(
        isinstance(u, str) for u in raw_users
    ):
        users = raw_users
    else:
        users = None

    # (b) unit file exists on disk. Reading the file directly replaces the
    # pre-2026-09-19 `systemctl --user show LoadState` check — see the
    # module docblock above _read_app_unit_file for why.
    unit_text = _read_app_unit_file(slug, home)
    if unit_text is None:
        # D-01 check (b) fails — no unit file for this slug. Silent (not a
        # transport error, not a bad card; just "no unit registered").
        return None

    # Port from Environment=PORT=<n> in the unit body (D-07). None if the
    # unit doesn't declare a PORT — D-05 allows nullable port.
    m = APP_UNIT_ENV_PORT_RE.search(unit_text)
    port = int(m.group(1)) if m else None

    # Health via loopback probe (D-02 carve-out). Two special cases:
    #
    #   1. No PORT declaration → can't probe. Emit as unhealthy with a
    #      diagnostic so the frontend surfaces the misconfiguration.
    #
    #   2. Running inside the Skynet container's constrained namespace (the
    #      isLocalHostId acquireLocalChannel path — see starter.ts). The
    #      container's 127.0.0.1 is not the host's 127.0.0.1 (network
    #      namespaces don't share loopback) so the probe would always fail
    #      even for a healthy host-loopback-bound app. Same gotcha the
    #      app-pane proxy tunnels through — see pane-target-resolver.ts D-10
    #      resolution. In this path, trust the unit-file presence as the
    #      health signal: the sweep runs against the same host that owns
    #      the file, and the click-through path uses the SSH tunnel which
    #      IS namespace-crossing. Signal: `HOME_HOST_DIR` env is set only
    #      by the Skynet compose config, so this branch is not reachable
    #      on peer hosts (where the sweep runs in the user's real shell).
    if port is None:
        is_healthy = False
        health_message = (
            "port not declared in systemd unit — ask an agent to fix "
            "app-" + slug[:APP_SLUG_MAX_LEN] + ".service"
        )
    elif os.environ.get("HOME_HOST_DIR"):
        is_healthy = True
        health_message = None
    else:
        is_healthy = _probe_app_port(port)
        if is_healthy:
            health_message = None
        else:
            # D-03: backend authors the ready-to-render string. Literal
            # phrasing matches the user's steer during the /open grill
            # 2026-09-18.
            health_message = "not running — ask an agent to check on it"

    # D-06: has_icon is a boolean, not a URL. Shape 4 owns the serving path.
    has_icon = os.path.exists(os.path.join(folder_path, "icon.webp"))

    # D-08: createdAt is folder mtime, not a stored field.
    try:
        folder_mtime_ms = int(os.stat(folder_path).st_mtime * 1000)
    except OSError:
        # Improbable — the scandir just succeeded. Fall back to 0 rather
        # than raising so the per-app try/except in the enumerator doesn't
        # trip on a stat race.
        folder_mtime_ms = 0

    # D-05 emit shape — exactly these keys, in this order. Byte-name parity
    # with the TS SweepAppLine interface (snake_case on the wire; the wire-
    # protocol frontend-facing shape does camelCase remapping).
    #
    # Phase 130: `users` added as an OPTIONAL emit field. Older TS parsers
    # (pre-130) simply ignore unknown fields on the incoming object — the
    # SweepAppLine widening is additive per RESEARCH.md § Pitfall 6 (same
    # discipline that added `has_icon` etc.). Rolling-deploy safe.
    return {
        "line_kind": "app",
        "schema_version": SCHEMA_VERSION,
        "slug": slug,
        "title": title,
        "description": description,
        "port": port,
        "has_icon": has_icon,
        "created_at_ms": folder_mtime_ms,
        "is_healthy": is_healthy,
        "health_message": health_message,
        "users": users,
    }


def _enumerate_apps(home):
    """Return list of SweepAppLine dicts for ~/fleet/apps/*/.

    Fail-open per D-18: an absent ~/fleet/apps/ dir yields []; a broken
    per-app entry is skipped (with a stderr log) but does not affect other
    apps or the identity/pid enumeration.

    Slug validation via APP_SLUG_RE + APP_SLUG_MAX_LEN happens BEFORE any
    subprocess call (T-118-01-SL defense-in-depth). Symlinks are rejected
    at scandir time (follow_symlinks=False) to prevent path-traversal
    outside ~/fleet/apps/ (T-118-01-PT).

    Phase 118 code-review MEDIUM-4 (fix pass 2026-09-18): TWO DoS caps
    apply before any subprocess call:
      1. APP_ENUM_CAP folder-count cap: after APP_ENUM_CAP valid slugs
         have been processed, stop enumerating. Emit fleet_status_apps_
         cap_hit with the observed folder count so operators see the
         signal.
      2. APP_ENUM_WALLCLOCK_BUDGET_SEC cumulative wall-clock cap: if the
         time spent inside the loop crosses this threshold, bail and
         return whatever we've built. Same warn shape (kind: "wallclock").
    Both caps preserve fail-open discipline — the sweep still emits its
    identity + pid lines, and the caller gets a valid partial JSONL blob.
    """
    root = os.path.join(home, "fleet", "apps")
    out = []
    total_seen = 0
    started = time.monotonic()
    try:
        with os.scandir(root) as it:
            for entry in it:
                if not entry.is_dir(follow_symlinks=False):
                    continue
                total_seen += 1
                # MEDIUM-4 folder-count cap. Count BEFORE slug validation so
                # `total_seen` reflects folders actually present on disk (not
                # just the ones that passed the regex). The cap fires on the
                # (N+1)th valid folder, so `out` may hold up to APP_ENUM_CAP
                # entries when we break here.
                if len(out) >= APP_ENUM_CAP:
                    _log(
                        "fleet_status_apps_cap_hit",
                        kind="count",
                        cap=APP_ENUM_CAP,
                        observed=total_seen,
                    )
                    break
                # MEDIUM-4 wall-clock budget. Check BEFORE each iteration's
                # subprocess call so we bail before eating another 1.5s.
                elapsed = time.monotonic() - started
                if elapsed > APP_ENUM_WALLCLOCK_BUDGET_SEC:
                    _log(
                        "fleet_status_apps_cap_hit",
                        kind="wallclock",
                        budget_sec=APP_ENUM_WALLCLOCK_BUDGET_SEC,
                        elapsed_sec=round(elapsed, 3),
                        observed=total_seen,
                        emitted=len(out),
                    )
                    break
                slug = entry.name
                if (
                    not APP_SLUG_RE.match(slug)
                    or len(slug) > APP_SLUG_MAX_LEN
                ):
                    _log("app_slug_skipped", slug=slug[:APP_SLUG_MAX_LEN])
                    continue
                try:
                    line = _build_app_line(slug, entry.path, home)
                except Exception:
                    # Belt-and-braces per RESEARCH § Q8: any unexpected raise
                    # inside _build_app_line is contained here so other apps
                    # (and identities/pids) still emit this tick.
                    _log("app_build_failed", slug=slug[:APP_SLUG_MAX_LEN],
                         err=traceback.format_exc(limit=1).strip())
                    continue
                if line is not None:
                    out.append(line)
    except FileNotFoundError:
        # ~/fleet/apps/ absent is a valid empty state (fresh box, no apps
        # provisioned yet) — D-19 fail-open, not an error worth logging.
        return out
    except OSError as e:
        _log("apps_scandir_failed", errno=e.errno)
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

    # ---- Phase 118: enumerate ~/fleet/apps/*/ (source C). Sequential per
    #      RESEARCH § Q6 — the user's ~10-app ceiling makes threading complexity
    #      unnecessary at 1.5s/call and <10ms typical systemctl latency. ----
    app_records = _enumerate_apps(home)

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
            "pinned": False,
            # Synthetic records (identity known only via /proc/<pid>/environ)
            # are always LIVE — a PID cannot be running for an identity whose
            # folder is under identities-archive/ (retire always kills the
            # harness before moving the folder). archived: false is correct.
            "archived": False,
        })
        known_names.add(identity)

    # ---- Discovery: walk ~/.claude/projects/ ONCE, build identity → jsonl_path map.
    #      Inverts the pre-2026-09-25 per-identity call pattern that walked the
    #      full projects tree per identity — pathological on workstation-sized
    #      boxes with 100+ mostly-dormant identities. First-hit-per-identity
    #      wins under mtime-desc, same semantics as the legacy path. ----
    identity_jsonl_paths = discover_all_identity_jsonl_paths(
        [rec["name"] for rec in identity_records], home,
    )

    # ---- Emit identity lines first (all Layer-1 tail scans run here). ----
    jsonl_tail_cache = {}  # name -> str | None (populated by _build_identity_line)
    role_cosmetics_memo = {}  # role -> dict | None (at most one read per role per tick)
    for rec in identity_records:
        line = _build_identity_line(
            rec["name"],
            home,
            {
                "dormant": rec["dormant"],
                "recycled_at": rec["recycled_at"],
                "recycle_requested": rec["recycle_requested"],
                "pinned": rec["pinned"],
                "archived": rec["archived"],
            },
            identity_jsonl_paths.get(rec["name"]),
            jsonl_tail_cache,
            role_cosmetics_memo,
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

    # ---- Phase 118: emit app lines LAST so the newest source is easy to
    #      find on future reads. Additive per D-14; each line has already
    #      been through the D-01/D-02 filter inside _build_app_line. ----
    for line in app_records:
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
