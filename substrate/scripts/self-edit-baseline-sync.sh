#!/bin/bash
#
# Self-edit baseline sync hook — dropped onto each identity-hosting box by the
# fleet-substrate distributor and wired via ~/.claude/settings.json PostToolUse.
#
# Purpose: prevent the role-file-watch ambient watcher from waking the agent
# with the agent's OWN edits. After every Write / Edit / MultiEdit /
# NotebookEdit / Bash tool call, this hook walks the watcher's state directory,
# refreshes any baseline whose real file has drifted, and records a fingerprint
# marker the watcher then checks at event time to distinguish "the agent wrote
# this" from "someone else did".
#
# Shape file (design + rationale):
#   .planning/shapes/shape-stop-self-edit-events.md
#
# Mechanism:
#   1. Read FLEET_IDENTITY from env (set by agent-supervisor.sh when it spawns
#      the Claude harness). Absent → nothing to do, exit 0.
#   2. Walk ~/fleet/identities/$FLEET_IDENTITY/role-file-watch/last-snapshot.*
#      — the state dir the watcher already keeps one baseline per watched file
#      in. That directory listing IS the list of watched surfaces; no separate
#      config needed on this side.
#   3. For each baseline, derive the corresponding real file from the filename
#      convention role-file-watch.py uses:
#          last-snapshot.role         → ~/fleet/roles/<role>/<role>.md
#          last-snapshot.identity     → ~/fleet/identities/<name>/<name>.md
#          last-snapshot.runbook.<X>  → ~/fleet/roles/<role>/runbooks/<X>/runbook.md
#      where <role> is parsed from the identity file's YAML frontmatter.
#   4. If real file != baseline, atomically overwrite the baseline (tmp +
#      rename) and write sha256(real) into <baseline>.self-edit-hash (also
#      atomic). The watcher, at event time, will see the marker + matching
#      current hash and stay silent.
#
# Failure semantics — graceful degradation to today's behavior:
#   * Never exits non-zero. The tool call must not be interrupted.
#   * Every filesystem op is best-effort; missing files, unreadable dirs, and
#     partial state all short-circuit past that baseline without failing the
#     whole run.
#   * If the sync doesn't happen for any reason, the watcher's normal diff
#     finds a real change and emits — exactly today's noise, never worse.
#
# Timeout: wrapped in `timeout 2` (same pattern as skynet-fleet-status-*.sh)
# so a full disk or unreachable FS cannot hang the harness turn indefinitely.
#
# stdin: harness pipes a JSON payload; consumed but ignored (this hook is
# event-payload-agnostic — the fact that a PostToolUse hook fired is the
# entire signal).
#
set -eu

# Consume stdin so the harness's pipe doesn't back-pressure on us. Content
# irrelevant.
cat > /dev/null 2>&1 || true

IDENT="${FLEET_IDENTITY:-}"
[ -z "$IDENT" ] && exit 0

STATE_DIR="$HOME/fleet/identities/$IDENT/role-file-watch"
[ -d "$STATE_DIR" ] || exit 0

IDENTITY_FILE="$HOME/fleet/identities/$IDENT/$IDENT.md"

# Resolve <role> from the identity file's YAML frontmatter. Falls back to
# empty (no role-file / runbook baselines get synced) if unreadable — the
# identity baseline still syncs since it doesn't need the role name.
ROLE=""
if [ -r "$IDENTITY_FILE" ]; then
    # Extract first `role: <value>` line inside the frontmatter block (before
    # the second `---` fence). awk stops at the second fence to avoid matching
    # a stray `role:` in the body.
    ROLE=$(awk '
        /^---[[:space:]]*$/ { fence++; if (fence == 2) exit; next }
        fence == 1 && /^role:[[:space:]]/ { sub(/^role:[[:space:]]*/, ""); sub(/[[:space:]].*$/, ""); print; exit }
    ' "$IDENTITY_FILE" 2>/dev/null || true)
fi

# Bounded work. Wrapped in timeout so a hung FS cannot hang the harness turn.
# NB: we pass STATE_DIR/IDENT/ROLE/IDENTITY_FILE to the child bash via `export`
# rather than by splicing them into the single-quoted script body. The prior
# `'"$X"'` splicing pattern would let a value containing a single-quote break
# out of the quoting and inject shell — and ROLE is parsed from the identity
# file's YAML frontmatter, which is agent-writable. Export-inherit keeps
# untrusted values as data, never re-parsed by the child shell.
export STATE_DIR IDENT ROLE IDENTITY_FILE
timeout 2 bash -c '
    sync_one() {
        baseline="$1"
        real="$2"
        [ -f "$baseline" ] || return 0
        [ -f "$real" ] || return 0

        if ! cmp -s "$real" "$baseline" 2>/dev/null; then
            bname=$(basename "$baseline")
            tmp_baseline="$STATE_DIR/.$bname.sync.tmp.$$"
            # Copy content atomically. If cp fails (permissions, disk full),
            # skip past — better to have watcher fire spuriously than corrupt.
            if cp "$real" "$tmp_baseline" 2>/dev/null; then
                # Compute the fingerprint from $real BEFORE the mv, not from
                # $baseline AFTER. A racing concurrent sync-hook could overwrite
                # $baseline between our mv and sha256sum, and we would end up
                # recording the OTHER invocation'"'"'s content-hash. Hashing $real
                # captures what THIS invocation actually observed.
                hash=$(sha256sum "$real" 2>/dev/null | awk "{print \$1}")
                mv "$tmp_baseline" "$baseline" 2>/dev/null || {
                    rm -f "$tmp_baseline" 2>/dev/null || true
                    return 0
                }
                if [ -n "$hash" ]; then
                    marker="$STATE_DIR/$bname.self-edit-hash"
                    tmp_marker="$STATE_DIR/.$bname.self-edit-hash.tmp.$$"
                    # `A && B || C` shape is intentional: if printf OR mv fails,
                    # rm cleans up the tmp file. Do not "fix" the precedence.
                    printf "%s\n" "$hash" > "$tmp_marker" 2>/dev/null && \
                        mv "$tmp_marker" "$marker" 2>/dev/null || \
                        rm -f "$tmp_marker" 2>/dev/null || true
                fi
            fi
        fi
    }

    # (a) identity baseline — always syncable, no role needed.
    sync_one "$STATE_DIR/last-snapshot.identity" "$IDENTITY_FILE"

    # (b) role + runbook baselines — need <role>. Skip if unresolved.
    if [ -n "$ROLE" ]; then
        role_file="$HOME/fleet/roles/$ROLE/$ROLE.md"
        sync_one "$STATE_DIR/last-snapshot.role" "$role_file"

        # Runbooks: last-snapshot.runbook.<slug> → runbooks/<slug>/runbook.md.
        # nullglob keeps the loop silent when no runbook baselines exist.
        shopt -s nullglob
        for baseline in "$STATE_DIR"/last-snapshot.runbook.*; do
            bname=$(basename "$baseline")
            slug="${bname#last-snapshot.runbook.}"
            # Defensive slug validation: kebab-case, matches role-file-watch.py.
            # Anything else — silently skip.
            case "$slug" in
                *[!a-z0-9-]*|-*|"") continue ;;
            esac
            runbook="$HOME/fleet/roles/$ROLE/runbooks/$slug/runbook.md"
            sync_one "$baseline" "$runbook"
        done
        shopt -u nullglob
    fi
' 2>/dev/null || true

exit 0
