#!/usr/bin/env python3
"""pv-context-pct-sweep.py — server-side batch emitter for the Skynet PrettyView
context-pct poller (Phase 95 Part C).

Replaces up to 4 `tail -c` SSH exec calls per identity per 3-second tick with
ONE exec per WebSocket-connection per tick that emits ALL per-identity context_pct
state as a JSONL blob on stdout.  See:
    .planning/phases/95-pv-context-pct-batch-sweep-drop-capture-pane-phase-92-sibling/
        95-CONTEXT.md   — locked design decisions
        95-RESEARCH.md  — TAIL_EXPANSION_STEPS + reverseScanForAssistantUsageSum port
        95-04-PLAN.md   — THIS script's spec

Wire contract (canonical): src/backend/claude-session/pv-sweep-schema.ts.
    - schema_version == 1 lives on every emitted line.
    - line_kind is always "identity" (single-tier; no PID axis — PV is identity-keyed).
    - Field names + types must be BYTE-IDENTICAL to the TypeScript interface PvSweepLine.

Invocation (production, per-WS per 3s from the contextPctTimer callback):
    ~/.local/bin/pv-context-pct-sweep --identities tiffany,ashley,zoeysephilya

Arguments:
    --identities <comma-separated>   identities to sweep (may be a single identity).
                                     If missing or empty → exit 0 with empty stdout.

Distribution: git-committed with execute bit set (mode 100755).  The Skynet
distributor bundles substrate/scripts/*.py into the container at
/app/fleet-substrate/scripts/ and the startup sweep pushes it to
~/.local/bin/pv-context-pct-sweep on every runsFleetSubstrate:true host once
the Phase 95 Part C-3 catalog row lands.  `computeInstallMode` mirrors
`fs.statSync().mode & 0o777` — a mode-drift bug that strips the execute bit
on this file would ship a non-executable script to every peer and permanently
pin the fleet on the legacy fallback path.

Stdout contract — VERY LOAD-BEARING:
    * stdout is JSONL emission ONLY.  One JSON object per line, compact
      (no whitespace via json.dumps(..., separators=(",",":"))).
    * ANY unhandled exception at the top level logs to stderr and returns
      exit 0 with empty stdout (or any already-emitted lines).  The Skynet
      caller treats `channel.exec` returning null OR schema-version-mismatch
      as "fall back to legacy per-tail this tick".  A stderr diag + exit 0 +
      empty stdout is a clean, non-noisy fallback signal.  Never emit
      tracebacks or error strings on stdout.

Port ledger (behavioral parity required — Plan 05 has a regression test):
    * TAIL_EXPANSION_STEPS = [10_000, 50_000, 200_000, 512_000]
                         — context-pct-from-jsonl.ts L83
    * reverseScanForAssistantUsageSum predicate
                         — context-pct-from-jsonl.ts L99-L132
    * context_pct normalization (AUTO_COMPACT_BUFFER_PCT=16.5, MODEL_CONTEXT_WINDOW=1_000_000)
                         — context-pct-from-jsonl.ts L54-L57
    * Phase 32 JSONL discovery predicate
                         — discover-identity-session-file.ts L134-L158
      Load-bearing: partial-match rejection (tiff must NOT match tiffany —
      delimiter check is correctness-critical).

Constraints:
    * Python 3.6+ stdlib ONLY (no pip installs).
    * Exit 0 ALWAYS.  Never nonzero.  `channel.exec` returning null must
      indicate SSH transport failure, not our own failure.
    * G6 safe-char guard on identity names (^[a-zA-Z0-9_-]+$, belt-and-suspenders;
      caller re-applies in Plan 05).
    * Concurrency: ThreadPoolExecutor(max_workers=8) for discovery + context_pct
      computation when >1 identity requested — cold-cache 512KB reads on a fleet
      box with 10+ identities could otherwise take 8s+ per tick, blowing the 3s loop.
"""

import argparse
import json
import os
import re
import sys
import traceback
from concurrent.futures import ThreadPoolExecutor, as_completed

# ---------------------------------------------------------------------------
# Schema version — MUST match PV_SWEEP_SCHEMA_VERSION in pv-sweep-schema.ts.
# ---------------------------------------------------------------------------

SCHEMA_VERSION = 1

# ---------------------------------------------------------------------------
# G6 safe-char regex — mirrors Plan 05 caller's /^[a-zA-Z0-9_-]+$/ guard.
# ---------------------------------------------------------------------------

SAFE_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]+$")

# ---------------------------------------------------------------------------
# TAIL_EXPANSION_STEPS — port of context-pct-from-jsonl.ts L83.
# Start small (cheap common case), expand when no assistant usage turn found.
# ---------------------------------------------------------------------------

TAIL_EXPANSION_STEPS = [10_000, 50_000, 200_000, 512_000]

# ---------------------------------------------------------------------------
# context_pct normalization constants — port of context-pct-from-jsonl.ts L54-L57.
# ---------------------------------------------------------------------------

# Mirrors ~/.claude/hooks/gsd-statusline.js:312-314.
AUTO_COMPACT_BUFFER_PCT = 16.5

# 2026-08-08 fleet lock: every model in the harness is 1M-token window.
MODEL_CONTEXT_WINDOW = 1_000_000

# ---------------------------------------------------------------------------
# Phase 32 discovery — DELIMITER_SET and DISCOVERY_HEAD_BYTES.
# Mirrors discover-identity-session-file.ts L109 + L129.
# ---------------------------------------------------------------------------

# Four delimiter chars that MAY appear immediately after the identity name inside
# <command-args>. Load-bearing: partial-name matches like "tiff" against "tiffany"
# are REJECTED because the char at nameEnd is "a" (not in this set and not end-of-line).
DISCOVERY_DELIMITER_SET = frozenset(("<", " ", "\r"))

# Bound the head-read at 4096 (same as the shell version's `head -c 4096`).
DISCOVERY_HEAD_BYTES = 4096

# ---------------------------------------------------------------------------
# Small logging helper — stderr only.  Every op is grep-able.
# ---------------------------------------------------------------------------


def _log(op, **fields):
    """Emit one stderr line in a grep-able loose-JSON shape.

    Uses stderr because stdout is JSONL wire and must remain silent when there
    is nothing to emit.  Never raise — if json.dumps chokes, fall back to repr.
    """
    try:
        parts = [f"op={op}"]
        for k, v in fields.items():
            parts.append(f"{k}={json.dumps(v)}")
        sys.stderr.write("[pv-context-pct-sweep] " + " ".join(parts) + "\n")
    except Exception:
        sys.stderr.write(f"[pv-context-pct-sweep] op={op} fields={fields!r}\n")


# ---------------------------------------------------------------------------
# Section — Phase 32 discovery (port of _matches_identity_first_turn in
# fleet-status-sweep.py which mirrors discover-identity-session-file.ts L134-L158).
# ---------------------------------------------------------------------------


def _matches_identity_first_turn(line, identity_name):
    """Byte-pattern predicate: is `line` a real /id <identity_name> first turn?

    Verbatim port of discover-identity-session-file.ts __matchesIdentityFirstTurnForTests.
    Load-bearing checks (in order):
      1. Line contains '"type":"user"' AND does NOT contain '"tool_result"'.
      2. Line contains '<command-name>/id</command-name>' (literal).
      3. Line contains '<command-args><identity_name>' where the char immediately
         after identity_name is in DISCOVERY_DELIMITER_SET or is end-of-line.

    Partial-match rejection is the correctness-critical property: given
    identity_name="tiff", a line with '<command-args>tiffany<...' MUST return False
    (char at nameEnd is "a", not in the delimiter set and not end-of-line).
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


def discover_identity_jsonl_path(identity_name, home):
    """Walk ~/.claude/projects/*/ mtime-desc, return first JSONL whose first
    user-role line matches `/id <identity_name>` (with the strict delimiter guard).
    Returns absolute path str or None.

    Mirrors the shell buildDiscoveryScript in discover-identity-session-file.ts.
    Fail-safe: any OSError under a candidate file is silently swallowed.
    ENOENT on the projects dir returns None.
    """
    projects_root = os.path.join(home, ".claude", "projects")
    try:
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
            # Emulate `grep -m 1 '"role":"user"'` — first line with that substring.
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
        _log("discovery_unexpected_error", identity=identity_name,
             err=traceback.format_exc(limit=1).strip())
        return None


# ---------------------------------------------------------------------------
# Section — context_pct computation.
# Port of readContextPctFromJsonl + reverseScanForAssistantUsageSum
# in context-pct-from-jsonl.ts.
# ---------------------------------------------------------------------------


def _reverse_scan_for_assistant_usage_sum(tail_output):
    """Reverse-scan a tail buffer for the last assistant turn with usage.

    Returns the summed input+cache_creation+cache_read token count, or None
    if no such turn is present in the buffer.

    Verbatim port of reverseScanForAssistantUsageSum in context-pct-from-jsonl.ts
    L99-L132.  Field path: obj.type == "assistant" AND obj.message.usage.input_tokens
    (+ cache_creation_input_tokens + cache_read_input_tokens).
    """
    lines = tail_output.split("\n")
    for i in range(len(lines) - 1, -1, -1):
        line = lines[i]
        if not line or line.strip() == "":
            continue
        try:
            parsed = json.loads(line)
        except Exception:
            # Malformed line — skip and continue scanning.
            continue
        if not isinstance(parsed, dict):
            continue
        if parsed.get("type") != "assistant":
            continue
        message = parsed.get("message")
        if not isinstance(message, dict):
            continue
        usage = message.get("usage")
        if not isinstance(usage, dict):
            continue
        input_tokens = usage.get("input_tokens", 0) or 0
        cache_creation = usage.get("cache_creation_input_tokens", 0) or 0
        cache_read = usage.get("cache_read_input_tokens", 0) or 0
        token_sum = (
            (int(input_tokens) if isinstance(input_tokens, (int, float)) else 0)
            + (int(cache_creation) if isinstance(cache_creation, (int, float)) else 0)
            + (int(cache_read) if isinstance(cache_read, (int, float)) else 0)
        )
        return token_sum
    return None


def _compute_context_pct(jsonl_path):
    """Port of readContextPctFromJsonl in context-pct-from-jsonl.ts.

    Iterates TAIL_EXPANSION_STEPS until an assistant usage turn is found,
    applies the same 16.5% autocompact normalization, returns 0-100 int or None.

    Returns None on any file read error, empty tail, or exhausted expansion steps.
    The caller emits context_pct: null in that case (loading placeholder on frontend).

    NEVER throws.
    """
    try:
        for step_bytes in TAIL_EXPANSION_STEPS:
            try:
                with open(jsonl_path, "rb") as fh:
                    fh.seek(0, os.SEEK_END)
                    size = fh.tell()
                    start = max(0, size - step_bytes)
                    fh.seek(start, os.SEEK_SET)
                    data = fh.read()
            except OSError:
                # File read failure — bail out entirely (retrying wider won't help).
                return None

            try:
                tail_output = data.decode("utf-8", errors="replace")
            except Exception:
                return None

            if tail_output.strip() == "":
                # Empty or whitespace-only tail — bail (file is genuinely empty).
                return None

            token_sum = _reverse_scan_for_assistant_usage_sum(tail_output)
            if token_sum is not None:
                # Found a usage turn — compute the normalized pct.
                # Mirrors context-pct-from-jsonl.ts L247-L257 exactly.
                remaining_pct = 100 - (token_sum / MODEL_CONTEXT_WINDOW) * 100
                usable_remaining = max(
                    0,
                    ((remaining_pct - AUTO_COMPACT_BUFFER_PCT)
                     / (100 - AUTO_COMPACT_BUFFER_PCT))
                    * 100,
                )
                displayed = round(100 - usable_remaining)
                # Defensive range clamp against float edge cases.
                return max(0, min(100, displayed))
            # No usage turn in this window — try the next larger step.

        # Exhausted all expansion steps without finding an assistant usage turn.
        _log("no_asst_usage", jsonl_path=jsonl_path)
        return None
    except Exception:
        _log("compute_context_pct_error", jsonl_path=jsonl_path,
             err=traceback.format_exc(limit=1).strip())
        return None


# ---------------------------------------------------------------------------
# Per-identity sweep — discovery + computation, packaged for thread pool.
# ---------------------------------------------------------------------------


def _sweep_one_identity(identity_name, home):
    """Run Phase 32 discovery + context_pct computation for one identity.

    Returns a dict matching PvSweepLine in pv-sweep-schema.ts:
        {
            "line_kind": "identity",
            "schema_version": 1,
            "identity": "<name>",
            "context_pct": <int 0-100 or null>,
            "jsonl_path": "<path or null>",
        }

    Never throws — any exception produces a line with context_pct: null.
    """
    try:
        jsonl_path = discover_identity_jsonl_path(identity_name, home)
        context_pct = None
        if jsonl_path is not None:
            context_pct = _compute_context_pct(jsonl_path)
        return {
            "line_kind": "identity",
            "schema_version": SCHEMA_VERSION,
            "identity": identity_name,
            "context_pct": context_pct,
            "jsonl_path": jsonl_path,
        }
    except Exception:
        _log("sweep_one_identity_error", identity=identity_name,
             err=traceback.format_exc(limit=1).strip())
        return {
            "line_kind": "identity",
            "schema_version": SCHEMA_VERSION,
            "identity": identity_name,
            "context_pct": None,
            "jsonl_path": None,
        }


# ---------------------------------------------------------------------------
# Emission helper.
# ---------------------------------------------------------------------------


def _emit(record):
    """Write one compact JSON line to stdout, terminated with \\n."""
    sys.stdout.write(json.dumps(record, separators=(",", ":")))
    sys.stdout.write("\n")


# ---------------------------------------------------------------------------
# main() — parse argv, validate identities, dispatch sweep, emit results.
# ---------------------------------------------------------------------------


def main():
    parser = argparse.ArgumentParser(
        description="pv-context-pct-sweep: batch context_pct emitter for Skynet PV.",
        add_help=True,
    )
    parser.add_argument(
        "--identities",
        metavar="NAME[,NAME...]",
        default="",
        help="Comma-separated list of identity names to sweep.",
    )
    args = parser.parse_args()

    if not args.identities or not args.identities.strip():
        # Empty subscriber list — sweep is a no-op; exit cleanly with empty stdout.
        return 0

    # Parse + G6 safe-char guard on each identity name.
    raw_names = [n.strip() for n in args.identities.split(",") if n.strip()]
    valid_names = []
    for name in raw_names:
        if SAFE_NAME_RE.match(name):
            valid_names.append(name)
        else:
            _log("identity_name_skipped", name=name[:80])

    if not valid_names:
        return 0

    home = os.environ.get("HOME")
    if not home:
        _log("no_home_env")
        return 0

    # Sweep identities — parallelize when more than one requested.
    # Order of emitted lines preserves argv order (valid_names order).
    results_by_name = {}
    if len(valid_names) == 1:
        # No thread pool overhead for the common single-identity case.
        name = valid_names[0]
        results_by_name[name] = _sweep_one_identity(name, home)
    else:
        max_workers = min(8, len(valid_names))
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            future_to_name = {
                pool.submit(_sweep_one_identity, name, home): name
                for name in valid_names
            }
            for future in as_completed(future_to_name):
                name = future_to_name[future]
                try:
                    results_by_name[name] = future.result()
                except Exception:
                    _log("future_result_error", identity=name,
                         err=traceback.format_exc(limit=1).strip())
                    results_by_name[name] = {
                        "line_kind": "identity",
                        "schema_version": SCHEMA_VERSION,
                        "identity": name,
                        "context_pct": None,
                        "jsonl_path": None,
                    }

    # Emit in argv order so the caller can correlate by position if desired.
    for name in valid_names:
        if name in results_by_name:
            _emit(results_by_name[name])

    sys.stdout.flush()
    return 0


if __name__ == "__main__":
    try:
        rc = main()
    except Exception:
        # LOAD-BEARING: any unhandled exception → stderr diag + exit 0.
        # The Skynet caller's parser silently discards non-schema-v1 lines;
        # a traceback on stdout would be parsed as unknown JSON and discarded
        # (which is harmless) but is still wrong protocol. Use stderr always.
        sys.stderr.write("[pv-context-pct-sweep] op=unhandled_top_level_error\n")
        traceback.print_exc(file=sys.stderr)
        rc = 0
    sys.exit(rc if isinstance(rc, int) else 0)
