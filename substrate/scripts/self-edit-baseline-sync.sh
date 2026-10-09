#!/bin/bash
#
# Self-edit baseline sync hook — dropped onto each identity-hosting box by the
# fleet-substrate distributor and wired via ~/.claude/settings.json on four
# events: PreToolUse (claim), PostToolUse + PostToolUseFailure (sync +
# release), UserPromptSubmit (clear every claim).
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
#     * Bash — the command text names the file as a whole path token: its
#       full path, its ~/ or $HOME/ form, its last two path components
#       (`id/SKILL.md`, `.claude/CLAUDE.md`, `<slug>/runbook.md`), or — for
#       identity and role files, whose basenames are already unique — the
#       bare basename. "Whole token" = not glued to a longer path or name, so
#       `repo/.claude/CLAUDE.md` does not claim ~/.claude/CLAUDE.md and
#       `old-dev.md` does not claim role `dev`.
#   The watcher holds a changed, claimed file until the claim is released,
#   then runs its normal hash-guard check.
#
#   Release (PostToolUse / PostToolUseFailure) syncs ONLY the files this call
#   claimed, then deletes its claims. While the watcher is held its event
#   loop is stalled, so any other drifted file may be a peer edit queued
#   behind the hold — syncing it would record the peer's content as ours and
#   swallow the wake. The legacy sync-every-drifted-file pass runs only when
#   this call claimed nothing AND no other claim is live (nothing can be
#   held, so the watcher has already seen anything older than its settle).
#
#   Stale claims: UserPromptSubmit clears every claim (no tool call of this
#   session can be in flight when a prompt lands — covers interrupts), and
#   the watcher ignores claims older than ROLE_WATCH_CLAIM_MAX_SEC (600s).
#
#   Known limits (all fail toward noise or a delayed wake, except the first):
#     * A peer edit to a file the in-flight call itself claimed is
#       indistinguishable from the agent's own and is absorbed.
#     * A Bash call that writes a file without naming it (a script that
#       edits it) still emits.
#     * run_in_background Bash: PostToolUse fires at launch, so the claim is
#       released before the background job writes — its edits still emit.
#     * While the watcher holds a claimed file, wakes for other watched files
#       queue behind it until the call ends — delayed, never dropped.
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
# claim; UserPromptSubmit → clear claims; anything else, including an
# empty/unparseable payload → sync + release); `tool_use_id` keys the claims;
# `tool_input` drives claim matching.
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

# Bash claim matcher. stdin: list_targets lines; stdout: the baselines whose
# real file $BASH_CMD names as a whole token. A match must not be glued to a
# longer path/name on the left (no preceding path or name character) or the
# right (no following name character). Forms tried: full path, ~/rel,
# $HOME/rel, ${HOME}/rel, last two components, and — for distinctive
# basenames — the bare basename (also allowed right after "./"). One python
# start for all targets; Bash calls whose text has no ".md" skip it entirely.
NAMES_FILE_PY='
import os, re, sys
cmd = os.environ.get("BASH_CMD", "")
home = os.environ.get("HOME", "")
left = r"(?<![\w./~$}-])"
right = r"(?![\w.-])"
def names(real, distinctive):
    rel = real[len(home) + 1:] if home and real.startswith(home + "/") else None
    forms = [real]
    if rel:
        forms += ["~/" + rel, "$HOME/" + rel, "${HOME}/" + rel]
    forms.append(os.path.basename(os.path.dirname(real)) + "/" + os.path.basename(real))
    for f in forms:
        if re.search(left + re.escape(f) + right, cmd):
            return True
    if distinctive == "1":
        b = re.escape(os.path.basename(real))
        if re.search(r"(?:" + left + r"|(?<![\w.~$}/-])\./)" + b + right, cmd):
            return True
    return False
for line in sys.stdin:
    parts = line.rstrip("\n").split("\t")
    if len(parts) == 3 and names(parts[1], parts[2]):
        print(parts[0])
'

# Bounded work. Wrapped in timeout so a hung FS cannot hang the harness turn.
# NB: values reach the child bash via `export`, never by splicing them into
# the single-quoted script body. Splicing would let a value containing a
# single-quote break out of the quoting and inject shell — role names come
# from agent-writable baseline filenames and the tool input is whatever the
# agent sent. Export-inherit keeps untrusted values as data.
export STATE_DIR IDENT IDENTITY_FILE CLAIM_DIR CLAIM_MAX_SEC EVENT TOOL_ID TARGET_PATH BASH_CMD NAMES_FILE_PY
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

    if [ "$EVENT" = "UserPromptSubmit" ]; then
        [ -d "$CLAIM_DIR" ] && find "$CLAIM_DIR" -maxdepth 1 -type f -delete 2>/dev/null
        exit 0
    fi

    if [ "$EVENT" = "PreToolUse" ]; then
        [ -n "$TOOL_ID" ] || exit 0
        [ -n "$TARGET_PATH$BASH_CMD" ] || exit 0
        if [ -n "$TARGET_PATH" ]; then
            want=$(readlink -m -- "$TARGET_PATH" 2>/dev/null || printf "%s" "$TARGET_PATH")
            claimed=$(list_targets | while IFS="$TAB" read -r baseline real distinctive; do
                [ "$(readlink -m -- "$real" 2>/dev/null)" = "$want" ] && printf "%s\n" "$baseline"
            done)
        else
            case "$BASH_CMD" in *.md*) ;; *) exit 0 ;; esac
            claimed=$(list_targets | python3 -c "$NAMES_FILE_PY" 2>/dev/null)
        fi
        [ -n "$claimed" ] || exit 0
        mkdir -p "$CLAIM_DIR" 2>/dev/null || exit 0
        printf "%s\n" "$claimed" | while read -r baseline; do
            [ -f "$baseline" ] || continue
            : > "$CLAIM_DIR/$(basename "$baseline").$TOOL_ID" 2>/dev/null || true
        done
        exit 0
    fi

    # PostToolUse / PostToolUseFailure / unknown. Sync first, THEN release —
    # the watcher re-checks as soon as the claim disappears, so the baseline
    # and marker must already be in place. See header § Release for why only
    # claimed files are synced while anything could be held.
    mine=""
    if [ -n "$TOOL_ID" ] && [ -d "$CLAIM_DIR" ]; then
        mine=$(find "$CLAIM_DIR" -maxdepth 1 -type f -name "*.$TOOL_ID" -printf "%f\n" 2>/dev/null)
    fi
    if [ -n "$mine" ]; then
        list_targets | while IFS="$TAB" read -r baseline real distinctive; do
            if printf "%s\n" "$mine" | grep -qxF "$(basename "$baseline").$TOOL_ID"; then
                sync_one "$baseline" "$real"
            fi
        done
        find "$CLAIM_DIR" -maxdepth 1 -type f -name "*.$TOOL_ID" -delete 2>/dev/null || true
    else
        live=""
        if [ -d "$CLAIM_DIR" ]; then
            live=$(find "$CLAIM_DIR" -maxdepth 1 -type f -mmin "-$(( (CLAIM_MAX_SEC + 59) / 60 ))" -print -quit 2>/dev/null)
        fi
        if [ -z "$live" ]; then
            list_targets | while IFS="$TAB" read -r baseline real distinctive; do
                sync_one "$baseline" "$real"
            done
        fi
    fi
    if [ -d "$CLAIM_DIR" ]; then
        # Sweep claims orphaned by calls that never reached a Post* hook.
        find "$CLAIM_DIR" -maxdepth 1 -type f -mmin "+$(( (CLAIM_MAX_SEC + 59) / 60 ))" -delete 2>/dev/null || true
    fi
' 2>/dev/null || true

exit 0
