#!/bin/bash
#
# Self-edit baseline sync hook — dropped onto each identity-hosting box by the
# fleet-substrate distributor and wired via ~/.claude/settings.json on three
# events: PreToolUse (claim), PostToolUse + PostToolUseFailure (sync + release).
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
#          last-snapshot.identity         → ~/fleet/identities/<name>/<name>.md
#          last-snapshot.id-skill         → ~/.claude/skills/id/SKILL.md
#          last-snapshot.user-claudemd    → ~/.claude/CLAUDE.md
#          last-snapshot.role.<role>      → ~/fleet/roles/<role>/<role>.md
#          last-snapshot.runbook.<role>.<slug>
#                                         → ~/fleet/roles/<role>/runbooks/<slug>/runbook.md
#      Role + runbook baselines encode <role> in the filename (watcher's
#      per-role scheme), so no frontmatter parsing is needed to route them.
#   4. If real file != baseline, atomically overwrite the baseline (tmp +
#      rename) and write sha256(real) into <baseline>.self-edit-hash (also
#      atomic). The watcher, at event time, will see the marker + matching
#      current hash and stay silent.
#
# Claims (PreToolUse) — closes the "edit early in a long tool call" leak:
#   PostToolUse only fires when the WHOLE tool call returns, but the watcher
#   sees the write the moment it lands. A `sed -i <file> && <slow command>`
#   Bash call outlived the watcher's 200ms settle window, so the self-edit
#   emitted before this hook ever ran. Now, before the tool runs, this hook
#   drops a claim at  <state-dir>/claims/<baseline-name>.<tool_use_id>  for
#   every watched file the call looks like it will touch:
#     * Write / Edit / MultiEdit / NotebookEdit — the exact target path.
#     * Bash — the command text names the file: its full path, its ~/ or
#       $HOME/ form, its last two path components (`id/SKILL.md`,
#       `.claude/CLAUDE.md`, `<slug>/runbook.md`), or — for identity and role
#       files, whose basenames are already unique — the bare basename.
#   The watcher holds a changed, claimed file until the claim is released
#   (or goes stale — ROLE_WATCH_CLAIM_MAX_SEC, default 600s, covers calls
#   interrupted before any Post* hook), then runs its normal hash-guard check.
#   PostToolUse / PostToolUseFailure syncs first, then releases this call's
#   claims. Unclaimed files are never held. A Bash call that writes a file
#   without naming it (a script that edits it) still emits — fails toward
#   noise, never toward hiding a peer's edit.
#
# Failure semantics — graceful degradation to today's behavior:
#   * Never exits non-zero. The tool call must not be interrupted.
#   * Every filesystem op is best-effort; missing files, unreadable dirs, and
#     partial state all short-circuit past that baseline without failing the
#     whole run.
#   * If the sync doesn't happen for any reason, the watcher's normal diff
#     finds a real change and emits — exactly today's noise, never worse.
#
# Timeout: wrapped in `timeout 2` (same pattern as fleet-status-*.sh)
# so a full disk or unreachable FS cannot hang the harness turn indefinitely.
#
# stdin: harness JSON payload. `hook_event_name` picks the mode (PreToolUse →
# claim; anything else, including an empty/unparseable payload → sync +
# release); `tool_use_id` keys the claims; `tool_input` drives claim matching.
#
set -eu

PAYLOAD=$(cat 2>/dev/null || true)

IDENT="${FLEET_IDENTITY:-}"
[ -z "$IDENT" ] && exit 0

STATE_DIR="$HOME/fleet/identities/$IDENT/role-file-watch"
[ -d "$STATE_DIR" ] || exit 0

IDENTITY_FILE="$HOME/fleet/identities/$IDENT/$IDENT.md"
CLAIM_DIR="$STATE_DIR/claims"
CLAIM_MAX_SEC="${ROLE_WATCH_CLAIM_MAX_SEC:-600}"

# Pull the payload fields we need. Missing jq or bad JSON → empty fields →
# sync+release mode with no tool id, i.e. exactly the pre-claims behavior.
EVENT=""; TOOL_ID=""; TARGET_PATH=""; BASH_CMD=""
if [ -n "$PAYLOAD" ] && command -v jq >/dev/null 2>&1; then
    EVENT=$(printf '%s' "$PAYLOAD" | jq -r '.hook_event_name // ""' 2>/dev/null || true)
    TOOL_ID=$(printf '%s' "$PAYLOAD" | jq -r '.tool_use_id // ""' 2>/dev/null || true)
    TARGET_PATH=$(printf '%s' "$PAYLOAD" | jq -r '.tool_input.file_path // .tool_input.notebook_path // ""' 2>/dev/null || true)
    BASH_CMD=$(printf '%s' "$PAYLOAD" | jq -r 'if .tool_name == "Bash" then (.tool_input.command // "") else "" end' 2>/dev/null || true)
fi
# tool_use_id lands in a filename — keep it to a safe charset.
TOOL_ID=$(printf '%s' "$TOOL_ID" | tr -cd 'A-Za-z0-9_-')

# Bounded work. Wrapped in timeout so a hung FS cannot hang the harness turn.
# NB: values reach the child bash via `export`, never by splicing them into
# the single-quoted script body. Splicing would let a value containing a
# single-quote break out of the quoting and inject shell — role names come
# from agent-writable baseline filenames and the tool input is whatever the
# agent sent. Export-inherit keeps untrusted values as data.
export STATE_DIR IDENT IDENTITY_FILE CLAIM_DIR CLAIM_MAX_SEC EVENT TOOL_ID TARGET_PATH BASH_CMD
timeout 2 bash -c '
    TAB="$(printf "\t")"

    # One "<baseline>\t<real file>\t<distinctive basename 0|1>" line per
    # watched surface.
    list_targets() {
        printf "%s\t%s\t1\n" "$STATE_DIR/last-snapshot.identity" "$IDENTITY_FILE"
        # id skill + user-wide CLAUDE.md. A missing target file (fresh box
        # pre-distributor-sweep, a user with no CLAUDE.md, a hermetic test
        # env) short-circuits via sync_one'"'"'s `[ -f "$real" ]` guard.
        printf "%s\t%s\t0\n" "$STATE_DIR/last-snapshot.id-skill" "$HOME/.claude/skills/id/SKILL.md"
        printf "%s\t%s\t0\n" "$STATE_DIR/last-snapshot.user-claudemd" "$HOME/.claude/CLAUDE.md"

        # Role baselines — `last-snapshot.role.<role>` (role-file-watch.py
        # per-role scheme), so multi-role identities are covered. The slug IS
        # the role name. The kebab-case validator also rejects any stray
        # `.self-edit-hash` marker the glob would otherwise swallow.
        shopt -s nullglob
        for baseline in "$STATE_DIR"/last-snapshot.role.*; do
            bname=$(basename "$baseline")
            slug="${bname#last-snapshot.role.}"
            case "$slug" in
                *[!a-z0-9-]*|-*|"") continue ;;
            esac
            printf "%s\t%s\t1\n" "$baseline" "$HOME/fleet/roles/$slug/$slug.md"
        done

        # Runbook baselines — `last-snapshot.runbook.<role>.<slug>`. Role AND
        # slug come from the filename; both halves must be kebab-case. A slug
        # containing a further `.` (a `.self-edit-hash` marker, or a legacy
        # un-roled baseline where slug == suffix) fails and skips.
        for baseline in "$STATE_DIR"/last-snapshot.runbook.*; do
            bname=$(basename "$baseline")
            suffix="${bname#last-snapshot.runbook.}"
            role_part="${suffix%%.*}"
            slug="${suffix#*.}"
            case "$role_part" in
                *[!a-z0-9-]*|-*|"") continue ;;
            esac
            case "$slug" in
                *[!a-z0-9-]*|-*|""|"$suffix") continue ;;
            esac
            printf "%s\t%s\t0\n" "$baseline" "$HOME/fleet/roles/$role_part/runbooks/$slug/runbook.md"
        done
        shopt -u nullglob
    }

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

    # Does this tool call look like it will write <real>? See header § Claims.
    targets_file() {
        real="$1"
        distinctive="$2"
        if [ -n "$TARGET_PATH" ]; then
            a=$(readlink -m -- "$TARGET_PATH" 2>/dev/null || printf "%s" "$TARGET_PATH")
            b=$(readlink -m -- "$real" 2>/dev/null || printf "%s" "$real")
            [ "$a" = "$b" ] && return 0
        fi
        [ -n "$BASH_CMD" ] || return 1
        rel="${real#"$HOME"/}"
        tail2="$(basename "$(dirname "$real")")/$(basename "$real")"
        case "$BASH_CMD" in
            *"$real"*|*"~/$rel"*|*"\$HOME/$rel"*|*"\${HOME}/$rel"*|*"$tail2"*) return 0 ;;
        esac
        if [ "$distinctive" = "1" ]; then
            case "$BASH_CMD" in
                *"$(basename "$real")"*) return 0 ;;
            esac
        fi
        return 1
    }

    if [ "$EVENT" = "PreToolUse" ]; then
        [ -n "$TOOL_ID" ] || exit 0
        [ -n "$TARGET_PATH$BASH_CMD" ] || exit 0
        mkdir -p "$CLAIM_DIR" 2>/dev/null || exit 0
        list_targets | while IFS="$TAB" read -r baseline real distinctive; do
            [ -f "$baseline" ] || continue
            if targets_file "$real" "$distinctive"; then
                : > "$CLAIM_DIR/$(basename "$baseline").$TOOL_ID" 2>/dev/null || true
            fi
        done
        exit 0
    fi

    # PostToolUse / PostToolUseFailure / unknown: sync first, THEN release —
    # the watcher re-checks as soon as the claim disappears, so the baseline
    # and marker must already be in place.
    list_targets | while IFS="$TAB" read -r baseline real distinctive; do
        sync_one "$baseline" "$real"
    done
    if [ -d "$CLAIM_DIR" ]; then
        if [ -n "$TOOL_ID" ]; then
            find "$CLAIM_DIR" -maxdepth 1 -type f -name "*.$TOOL_ID" -delete 2>/dev/null || true
        fi
        # Sweep claims orphaned by interrupted calls (no Post* hook ever ran).
        find "$CLAIM_DIR" -maxdepth 1 -type f -mmin "+$(( (CLAIM_MAX_SEC + 59) / 60 ))" -delete 2>/dev/null || true
    fi
' 2>/dev/null || true

exit 0
