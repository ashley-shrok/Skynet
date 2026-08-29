#!/bin/bash
#
# Skynet fleet-status Stop hook — dropped onto each identity-hosting box by
# remote-hook-install.ts. Reads the Stop hook payload from stdin and writes
# it atomically to the well-known payload file, which the Skynet backend
# polls over SSH every 2s.
#
# MUST NOT block Claude Code — the hook fires synchronously during turn
# completion, so we do the minimum work possible: read stdin, atomic-write
# to disk, exit 0.
#
# Phase 59 Plan 01 (2026-08-29): additive per-session file write. In addition
# to the existing box-wide payload file (which continues to carry
# background-tasks for the box-wide consumer path), we also atomic-write a
# per-session file keyed on the session identifier extracted from the piped
# stdin JSON. The per-session file's mtime becomes the backend's lastStopAt
# signal for the WIP-shell-idle-gate predicate.
#
# The session identifier is extracted via a strict bash regex whose character
# class rejects any path-traversal metacharacter. Extraction failure is
# fail-open: the box-wide write still fires unconditionally, and the hook
# still exits 0. This is a Tampering defense (T-59-01-01): an attacker-
# controlled session identifier cannot escape to arbitrary paths.
#
# The interpreter of the inner block is bash (not sh) because the regex
# operator is bash-specific (not POSIX-portable to dash/ash). The outer
# script's shebang already guarantees bash is available on every managed
# box (per remote-hook-install.ts install path).
#
set -eu
PAYLOAD_DIR="${HOME}/.claude/fleet-status"
PAYLOAD_FILE="${PAYLOAD_DIR}/last-stop-payload.json"
BOX_TMP_FILE="${PAYLOAD_FILE}.$$.tmp"
mkdir -p "${PAYLOAD_DIR}"
# Belt-and-braces: wrap the write in a timeout so a full disk cannot hang
# the hook indefinitely. Fire-and-forget beyond this point.
timeout 2 bash -c '
  payload="$(cat)"
  # Box-wide write (unchanged behavior — carries background-tasks for the
  # existing box-wide consumer path). MUST fire unconditionally, before the
  # per-session extraction, so a malformed/missing session identifier never
  # blocks the box-wide file.
  printf "%s" "$payload" > "'"${BOX_TMP_FILE}"'" && mv "'"${BOX_TMP_FILE}"'" "'"${PAYLOAD_FILE}"'"
  # Phase 59: extract session identifier via strict bash regex. The character
  # class is the Tampering defense — any other character fails the match and
  # skips the per-session write.
  if [[ "$payload" =~ \"session_id\"[[:space:]]*:[[:space:]]*\"([a-zA-Z0-9_-]+)\" ]]; then
    sid="${BASH_REMATCH[1]}"
    per_session_file="'"${PAYLOAD_DIR}"'/stop-${sid}.json"
    per_session_tmp="${per_session_file}.$$.tmp"
    printf "%s" "$payload" > "$per_session_tmp" && mv "$per_session_tmp" "$per_session_file"
  fi
' || true
exit 0
