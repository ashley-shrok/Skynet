#!/usr/bin/env bash
# Phase 101 CI grep guard — D-07 decision.
#
# Bounty b31a5c8e-7f2d-4c91-a4b6-8e9f1c3b7d24 (Phase 101):
#   The wilma-incident failure mode: uncapped SSH exec channels pile up past
#   OpenSSH's default MaxSessions=10. Waves 1-3 (Plans 101-02..101-05) wrapped
#   the primary producers. This script ensures a future patch that adds
#   connectOneShot / session.client.exec / tailSessionFile in a new file either:
#     (a) imports host-semaphore-registry and uses getHostSemaphore / acquireTailSlot, OR
#     (b) is explicitly allow-listed here with a comment explaining why.
#
# D-07 chose grep over an ESLint plugin — zero new dependencies, deterministic,
# integrates as a simple npm script (verify:ssh-cap).
#
# Exit 0 = all producers covered or allow-listed.
# Exit 1 = at least one uncovered file detected (per-file failure list printed).
#
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

# ---------------------------------------------------------------------------
# ALLOW_LIST — files that match the producer patterns but are exempt.
# Each entry must have a trailing comment explaining why.
# ---------------------------------------------------------------------------
ALLOW_LIST=(
  # ssh-one-shot.ts DEFINES connectOneShot; it is not a consumer.
  "src/backend/ssh/ssh-one-shot.ts"

  # session-file-tail.ts has no hostId parameter — coverage provided externally
  # via acquireTailSlot(hostId) at all 3 caller sites in claude-session-server.ts
  # (Plan 101-04 D-06-adjacent). Wrapping internally would require a signature
  # change that is out of scope for Phase 101.
  "src/backend/claude-session/session-file-tail.ts"

  # host-transfer.ts calls openDedicatedTransferSession (file-manager.ts) which
  # is already wrapped with getHostSemaphore (Plan 101-05 D-06). All 10 caller
  # sites inherit coverage transitively — host-transfer.ts itself needs no import.
  "src/backend/ssh/host-transfer.ts"

  # docker.ts / docker-console.ts use session.client.exec for Docker-specific
  # console sessions. These are RDP/Docker sessions, not standard SSH exec
  # channels competing for MaxSessions=10 on managed fleet hosts. The session
  # objects here do not carry a hostId from the fleet registry. Phase 101 scoped
  # to fleet SSH channels only. Future work if Docker exec channels need capping.
  "src/backend/ssh/docker.ts"
  "src/backend/ssh/docker-console.ts"

  # The following route files are known pre-existing uncapped producers that were
  # out of scope for Plans 101-02..101-05. They are allow-listed so the CI guard
  # exits 0 for the current codebase state. Future patches that add NEW connectOneShot
  # call sites in NEW files (not in this list) will still fail the guard.
  #
  # To wrap one of these files, remove it from the allow-list AND add the semaphore
  # wrap — the guard will then enforce coverage on any future edits.

  # sessions.ts — tmux list-sessions discovery; low-frequency, low-risk route.
  "src/backend/database/routes/sessions.ts"

  # agent-reset.ts — one-shot exec for agent reset command.
  "src/backend/database/routes/agent-reset.ts"

  # identities.ts — multiple connectOneShot call sites for identity management.
  "src/backend/database/routes/identities.ts"

  # roles-list-for-host.ts — lists roles via SSH exec.
  "src/backend/database/routes/roles-list-for-host.ts"

  # roles.ts — role CRUD via SSH exec (separate from roles-create.ts which IS wrapped).
  "src/backend/database/routes/roles.ts"

  # runbooks-editor.ts — multiple connectOneShot call sites for runbook execution.
  "src/backend/database/routes/runbooks-editor.ts"

  # identity-exists-on-host.ts — SSH probe to check identity existence.
  "src/backend/database/routes/identity-exists-on-host.ts"

  # identity-no-dormancy.ts — SSH keep-alive / anti-dormancy check.
  "src/backend/database/routes/identity-no-dormancy.ts"

  # pretty-view-fetch-host-file.ts — SFTP file fetch via withConnection pool.
  "src/backend/database/routes/pretty-view-fetch-host-file.ts"

  # host.ts — host management route with one connectOneShot call site.
  "src/backend/database/routes/host.ts"

  # identity-birth.ts — complex identity provisioning; connectOneShot injected via deps.
  "src/backend/database/routes/identity-birth.ts"

  # identity-birth-orchestrator.ts — deps-injection pattern; connectOneShot is a param.
  "src/backend/database/routes/identity-birth-orchestrator.ts"

  # skills-editor.ts — multiple connectOneShot call sites for skill management SSH exec.
  "src/backend/database/routes/skills-editor.ts"
)

# ---------------------------------------------------------------------------
# Patterns to detect (SSH producers that must be capped)
# ---------------------------------------------------------------------------
PRODUCER_PATTERNS='connectOneShot\(|session\.client\.exec\(|tailSessionFile\('

# ---------------------------------------------------------------------------
# Patterns that confirm coverage (any of these means the file is capped)
# ---------------------------------------------------------------------------
COVERAGE_PATTERNS='host-semaphore-registry|getHostSemaphore\(|acquireTailSlot\('

# ---------------------------------------------------------------------------
# Scan
# ---------------------------------------------------------------------------
FAILURES=()
SCANNED=0
ALLOW_LISTED=0

while IFS= read -r -d '' file; do
  # Skip if file is in the allow-list
  in_allow_list=false
  for allowed in "${ALLOW_LIST[@]}"; do
    if [[ "$file" == "$allowed" ]]; then
      in_allow_list=true
      break
    fi
  done

  if $in_allow_list; then
    ALLOW_LISTED=$((ALLOW_LISTED + 1))
    continue
  fi

  SCANNED=$((SCANNED + 1))

  # Check for producer patterns, filtering out comment-only lines.
  # A comment-only line starts with optional whitespace followed by //, /*, or #.
  # We filter those out so a file that only MENTIONS connectOneShot in a doc comment
  # does not trigger the guard.
  producer_hits=$(
    grep -nE "$PRODUCER_PATTERNS" "$file" 2>/dev/null \
      | grep -vE '^[0-9]+:[[:space:]]*//' \
      | grep -vE '^[0-9]+:[[:space:]]*/\*' \
      | grep -vE '^[0-9]+:[[:space:]]*\*' \
      | grep -vE '^[0-9]+:[[:space:]]*#' \
      || true
  )

  if [[ -z "$producer_hits" ]]; then
    # No non-comment producer hits — file is clean.
    continue
  fi

  # File has at least one non-comment producer hit. Check for coverage.
  if grep -qE "$COVERAGE_PATTERNS" "$file" 2>/dev/null; then
    # File imports or uses the semaphore registry — covered.
    continue
  fi

  # Uncovered producer found.
  FAILURES+=("$file")
  echo "FAIL (uncovered SSH producer): $file" >&2
  echo "$producer_hits" | while IFS= read -r hit; do
    echo "  $hit" >&2
  done
done < <(find src/backend -name '*.ts' -not -name '*.test.ts' -not -name '*.d.ts' -print0)

# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------
if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo "" >&2
  echo "SSH semaphore coverage FAILED: ${#FAILURES[@]} uncovered producer(s) detected." >&2
  echo "Each file above uses connectOneShot / session.client.exec / tailSessionFile" >&2
  echo "without importing host-semaphore-registry or calling getHostSemaphore / acquireTailSlot." >&2
  echo "" >&2
  echo "To fix: wrap the SSH motion inside getHostSemaphore(hostId).run(async () => { ... })" >&2
  echo "OR add the file to ALLOW_LIST in scripts/ci/check-ssh-semaphore-coverage.sh" >&2
  echo "with a comment explaining why it is exempt." >&2
  exit 1
fi

echo "SSH semaphore coverage OK: ${SCANNED} files scanned, ${ALLOW_LISTED} allow-listed, 0 uncovered producers."
exit 0
