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
set -eu
PAYLOAD_DIR="${HOME}/.claude/fleet-status"
PAYLOAD_FILE="${PAYLOAD_DIR}/last-stop-payload.json"
TMP_FILE="${PAYLOAD_FILE}.$$.tmp"
mkdir -p "${PAYLOAD_DIR}"
# Belt-and-braces: wrap the write in a timeout so a full disk cannot hang
# the hook indefinitely. Fire-and-forget beyond this point.
timeout 2 sh -c "cat > '${TMP_FILE}' && mv '${TMP_FILE}' '${PAYLOAD_FILE}'" || true
exit 0
