#!/usr/bin/env bash
# iterate-widget.sh — rekey an existing interactive widget to a new slug + URL,
# preserving the widget's edited files.
#
# Purpose: agents that need to iterate on a widget (fixed a bug in widget.html,
# tweaked a prompt, etc.) should NOT edit files in place — the frontend iframe
# is keyed on the URL, and the URL only changes when the slug changes. This
# script does one atomic rekey: snapshots the current widget's files, tears
# down the old slug (old URL 404s, old bubble goes to expired), scaffolds a
# fresh slug at a new URL with the SAME files, and prints the new URL for the
# agent to paste in their next message. The user sees the old bubble collapse
# to expired and a fresh widget appear at the bottom of the chat — no scrolling
# back to the original.
#
# ── Invocation ────────────────────────────────────────────────────────────────
#
#   iterate-widget.sh <old-slug> --message-id <new-msg-id> [--new-slug <s>]
#
#   iterate-widget.sh --slug <old-slug> --message-id <new-msg-id> [--new-slug <s>]
#
# Required:
#   --message-id <m>   The message-id of the NEW message the agent is about to
#                      send containing the new widget URL. Written into the
#                      new widget's metadata.json.
#
# Optional:
#   --new-slug <s>     Explicit new slug. If omitted, auto-suffix:
#                      - If old-slug matches "<base>-i<n>", increment n.
#                      - Otherwise, append "-i2".
#
# ── Steps ─────────────────────────────────────────────────────────────────────
#
#   1. Parse argv (Form A positional or Form B flag).
#   2. Validate old-slug exists at ~/fleet/interactive-messages/<old-slug>/.
#   3. Read old widget's metadata.json (template name, conversation-id).
#   4. Read old widget's systemd unit for the current port (for the port
#      substitution in the new server.py's standalone-dev fallback).
#   5. Resolve new-slug (explicit or auto-suffix); validate; ensure free.
#   6. Snapshot widget.html + server.py to a temp dir.
#   7. Run teardown-widget.sh on old-slug (old URL dies).
#   8. Claim a new port under exclusive lock (same range/logic as create-widget).
#   9. Write new widget dir: snapshotted files, then re-substitute __PORT__ /
#      old-port in server.py so its fallback matches the new port.
#  10. Write new metadata.json (new widget_id, new message_id, same template +
#      config + conversation_id).
#  11. Write new systemd unit at im-<new-slug>.service.
#  12. daemon-reload + enable --now + poll for active state.
#  13. Print NEW_SLUG=, OLD_SLUG=, URL= to stdout.
#
# ── SKIP_SYSTEMCTL escape hatch ───────────────────────────────────────────────
#
#   Set SKIP_SYSTEMCTL=1 to bypass all `systemctl --user` calls. Filesystem
#   moves still run. Used by the test harness. Mirrors create/teardown.

set -euo pipefail

log() { printf '[iterate-widget] %s\n' "$*" >&2; }
die() { printf '[iterate-widget] ERROR: %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# ── Arg parsing ───────────────────────────────────────────────────────────────

if [ $# -lt 1 ]; then
    die "usage: iterate-widget.sh <old-slug> --message-id <m> [--new-slug <s>]"
fi

OLD_SLUG=""
NEW_SLUG=""
MESSAGE_ID=""

if [[ "$1" == "--"* ]]; then
    # Form B: flag-based
    while [ $# -gt 0 ]; do
        case "$1" in
            --slug)
                [ $# -ge 2 ] || die "--slug requires a value"
                OLD_SLUG="$2"; shift 2 ;;
            --new-slug)
                [ $# -ge 2 ] || die "--new-slug requires a value"
                NEW_SLUG="$2"; shift 2 ;;
            --message-id)
                [ $# -ge 2 ] || die "--message-id requires a value"
                MESSAGE_ID="$2"; shift 2 ;;
            --*)
                die "unknown flag '$1'" ;;
            *)
                die "unexpected argument '$1'" ;;
        esac
    done
else
    # Form A: positional old-slug first
    OLD_SLUG="$1"
    shift
    while [ $# -gt 0 ]; do
        case "$1" in
            --new-slug)
                [ $# -ge 2 ] || die "--new-slug requires a value"
                NEW_SLUG="$2"; shift 2 ;;
            --message-id)
                [ $# -ge 2 ] || die "--message-id requires a value"
                MESSAGE_ID="$2"; shift 2 ;;
            --*)
                die "unknown flag '$1'" ;;
            *)
                die "unexpected argument '$1'" ;;
        esac
    done
fi

# ── Validate old-slug ─────────────────────────────────────────────────────────

[ -n "$OLD_SLUG" ] || die "old-slug is required"

if ! [[ "$OLD_SLUG" =~ ^[a-z][a-z0-9-]*$ ]]; then
    die "old-slug must be kebab-case: got '$OLD_SLUG'"
fi
if [ "${#OLD_SLUG}" -gt 40 ]; then
    die "old-slug too long (max 40 chars): '$OLD_SLUG'"
fi

[ -n "$MESSAGE_ID" ] || die "--message-id is required"

OLD_WIDGET_DIR="$HOME/fleet/interactive-messages/$OLD_SLUG"
OLD_UNIT_FILE="$HOME/.config/systemd/user/im-$OLD_SLUG.service"

[ -d "$OLD_WIDGET_DIR" ] || die "no widget directory at $OLD_WIDGET_DIR — nothing to iterate"
[ -f "$OLD_WIDGET_DIR/widget.html" ] || die "$OLD_WIDGET_DIR/widget.html missing — cannot snapshot"
[ -f "$OLD_WIDGET_DIR/server.py" ] || die "$OLD_WIDGET_DIR/server.py missing — cannot snapshot"
[ -f "$OLD_WIDGET_DIR/metadata.json" ] || die "$OLD_WIDGET_DIR/metadata.json missing — cannot read config"

# ── Read old metadata (template + conversation-id + config) ──────────────────

OLD_META=$(cat "$OLD_WIDGET_DIR/metadata.json")

TEMPLATE=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['template'])" "$OLD_META") \
    || die "failed to parse template from old metadata.json"
CONVERSATION_ID=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['conversation_id'])" "$OLD_META") \
    || die "failed to parse conversation_id from old metadata.json"

log "old-slug:        $OLD_SLUG"
log "template:        $TEMPLATE (preserved)"
log "conversation-id: $CONVERSATION_ID (preserved)"

# ── Read old port from systemd unit ───────────────────────────────────────────

OLD_PORT=""
if [ -f "$OLD_UNIT_FILE" ]; then
    OLD_PORT=$(grep -h '^Environment=PORT=' "$OLD_UNIT_FILE" 2>/dev/null | sed 's/^Environment=PORT=//' | head -1 || true)
fi
[ -n "$OLD_PORT" ] || die "could not read old port from $OLD_UNIT_FILE — cannot re-substitute server.py fallback"

log "old-port:        $OLD_PORT"

# ── Resolve NEW_SLUG ──────────────────────────────────────────────────────────

if [ -z "$NEW_SLUG" ]; then
    # Auto-suffix: if old ends in -i<n>, increment; else append -i2
    if [[ "$OLD_SLUG" =~ ^(.+)-i([0-9]+)$ ]]; then
        base="${BASH_REMATCH[1]}"
        n="${BASH_REMATCH[2]}"
        next=$((n + 1))
        NEW_SLUG="${base}-i${next}"
    else
        NEW_SLUG="${OLD_SLUG}-i2"
    fi
    log "new-slug:        $NEW_SLUG (auto-suffix)"
else
    log "new-slug:        $NEW_SLUG (explicit)"
fi

if ! [[ "$NEW_SLUG" =~ ^[a-z][a-z0-9-]*$ ]]; then
    die "new-slug must be kebab-case: got '$NEW_SLUG'"
fi
if [ "${#NEW_SLUG}" -gt 40 ]; then
    die "new-slug too long (max 40 chars): '$NEW_SLUG'"
fi
if [ "$NEW_SLUG" = "$OLD_SLUG" ]; then
    die "new-slug must differ from old-slug (both are '$OLD_SLUG')"
fi

NEW_WIDGET_DIR="$HOME/fleet/interactive-messages/$NEW_SLUG"
NEW_UNIT_FILE="$HOME/.config/systemd/user/im-$NEW_SLUG.service"
LOCK_FILE="$HOME/fleet/.create-widget-lock"

[ ! -e "$NEW_WIDGET_DIR" ] || die "new-slug already exists at $NEW_WIDGET_DIR — pick a different --new-slug"
[ ! -e "$NEW_UNIT_FILE" ] || die "systemd unit already exists at $NEW_UNIT_FILE"

# ── Read hostId for URL construction ──────────────────────────────────────────

HOSTID_FILE="$HOME/fleet/host/id"
[ -f "$HOSTID_FILE" ] || die "$HOSTID_FILE missing — the fleet-substrate distributor hasn't swept this box yet"
HOSTID=$(cat "$HOSTID_FILE" | tr -d '[:space:]')
[[ "$HOSTID" =~ ^[1-9][0-9]{0,9}$ ]] || die "$HOSTID_FILE contains invalid hostId ('$HOSTID')"

HOST_PARENT_FILE="$HOME/fleet/host/parent"
[ -s "$HOST_PARENT_FILE" ] || die "$HOST_PARENT_FILE is missing or empty — cannot emit an absolute widget URL"
HOST_PARENT=$(cat "$HOST_PARENT_FILE")

# ── Snapshot files to a temp dir ──────────────────────────────────────────────
# Snapshot BEFORE teardown so a partial teardown can't lose the agent's edits.

SNAPSHOT_DIR=$(mktemp -d "$HOME/.iterate-widget-snapshot.XXXXXX")
trap 'rm -rf "$SNAPSHOT_DIR"' EXIT

cp "$OLD_WIDGET_DIR/widget.html" "$SNAPSHOT_DIR/widget.html"
cp "$OLD_WIDGET_DIR/server.py"   "$SNAPSHOT_DIR/server.py"

log "snapshotted widget.html + server.py to $SNAPSHOT_DIR"

# ── Teardown old slug ─────────────────────────────────────────────────────────
# Uses the substrate teardown script — same one create-widget's inverse uses.

TEARDOWN_SH="$SCRIPT_DIR/teardown-widget.sh"
[ -x "$TEARDOWN_SH" ] || TEARDOWN_SH="bash $SCRIPT_DIR/teardown-widget.sh"

log "tearing down old slug: $OLD_SLUG"
$TEARDOWN_SH "$OLD_SLUG" >&2 || die "teardown-widget failed for '$OLD_SLUG'"

# ── Claim a new port under exclusive lock ─────────────────────────────────────
# Same logic as create-widget.sh's claim_port(): scan 9601-9699, pick first free.

mkdir -p "$HOME/.config/systemd/user"

claim_port() {
    exec 200>"$LOCK_FILE"
    flock -x 200

    USED_PORTS=""
    if compgen -G "$HOME/.config/systemd/user/im-*.service" > /dev/null 2>&1; then
        USED_PORTS=$(grep -h '^Environment=PORT=' "$HOME"/.config/systemd/user/im-*.service 2>/dev/null \
                     | sed 's/^Environment=PORT=//')
    fi
    if compgen -G "$HOME/fleet/interactive-messages-archive/*/im-*.service.archived" > /dev/null 2>&1; then
        ARCHIVED_PORTS=$(grep -h '^Environment=PORT=' \
                         "$HOME"/fleet/interactive-messages-archive/*/im-*.service.archived 2>/dev/null \
                         | sed 's/^Environment=PORT=//')
        USED_PORTS=$(printf '%s\n%s' "$USED_PORTS" "$ARCHIVED_PORTS")
    fi
    USED_PORTS=$(printf '%s\n' "$USED_PORTS" | sort -u)

    picked=""
    for candidate in $(seq 9601 9699); do
        if ! printf '%s\n' "$USED_PORTS" | grep -qx "$candidate"; then
            picked=$candidate
            break
        fi
    done

    if [ -z "$picked" ]; then
        echo "no free port in 9601-9699 — archive or delete some widgets first" >&2
        exit 1
    fi

    printf '%s' "$picked"
}

NEW_PORT=$(claim_port)
[ -n "$NEW_PORT" ] || die "port claim failed"

log "new-port:        $NEW_PORT (claimed atomically)"

# ── Cleanup trap for post-teardown failure ────────────────────────────────────
# From here on, failure must not leave a half-created new widget behind.
CLEANUP_ON_FAIL=0
cleanup_new() {
    if [ "$CLEANUP_ON_FAIL" = "1" ]; then
        log "cleaning up partial new widget..."
        if [ "${SKIP_SYSTEMCTL:-0}" != "1" ]; then
            systemctl --user disable "im-$NEW_SLUG.service" 2>/dev/null || true
            systemctl --user stop    "im-$NEW_SLUG.service" 2>/dev/null || true
            systemctl --user daemon-reload 2>/dev/null || true
        fi
        rm -f  "$NEW_UNIT_FILE"
        rm -rf "$NEW_WIDGET_DIR"
    fi
    rm -rf "$SNAPSHOT_DIR"
}
trap cleanup_new EXIT

# ── Create new widget dir from snapshot ───────────────────────────────────────

mkdir -p "$NEW_WIDGET_DIR"
cp "$SNAPSHOT_DIR/widget.html" "$NEW_WIDGET_DIR/widget.html"
cp "$SNAPSHOT_DIR/server.py"   "$NEW_WIDGET_DIR/server.py"
chmod 0755 "$NEW_WIDGET_DIR/server.py"

CLEANUP_ON_FAIL=1

# Re-substitute the old-port literal in server.py with the new port so the
# standalone-dev fallback matches. Runtime binding is controlled by systemd
# Environment=PORT= regardless, so this is cosmetic but keeps files consistent.
python3 - "$NEW_WIDGET_DIR/server.py" "$OLD_PORT" "$NEW_PORT" <<'PYEOF'
import sys, pathlib
py_path  = pathlib.Path(sys.argv[1])
old_port = sys.argv[2]
new_port = sys.argv[3]
content  = py_path.read_text()
# Match the exact literal produced by create-widget.sh's __PORT__ substitution
old_literal = f'os.environ.get("PORT", "{old_port}")'
new_literal = f'os.environ.get("PORT", "{new_port}")'
if old_literal in content:
    content = content.replace(old_literal, new_literal)
    py_path.write_text(content)
PYEOF

log "wrote widget dir from snapshot: $NEW_WIDGET_DIR"

# ── Write new metadata.json (preserve template + config, update ids) ─────────

python3 - "$NEW_WIDGET_DIR/metadata.json" "$OLD_META" "$NEW_SLUG" "$MESSAGE_ID" <<'PYEOF'
import json, sys, pathlib, datetime

out_path   = pathlib.Path(sys.argv[1])
old_meta   = json.loads(sys.argv[2])
new_slug   = sys.argv[3]
message_id = sys.argv[4]

new_meta = {
    "template":        old_meta.get("template"),
    "widget_id":       new_slug,
    "message_id":      message_id,
    "conversation_id": old_meta.get("conversation_id"),
    "config":          old_meta.get("config", {}),
    "created_at":      datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "iterated_from":   old_meta.get("widget_id"),
}

out_path.write_text(json.dumps(new_meta, indent=2) + "\n")
PYEOF

log "wrote metadata.json (iterated_from: $OLD_SLUG)"

# ── Write new systemd unit ────────────────────────────────────────────────────
# Reuse the template's im-SLUG.service.template shape by reading from the
# substrate templates dir. This mirrors create-widget.sh's approach.

TEMPLATE_DIR="$SCRIPT_DIR/templates/$TEMPLATE-terminal-on-submit"
if [ ! -d "$TEMPLATE_DIR" ]; then
    # Try other mode dirs if terminal-on-submit isn't the one
    for candidate_mode in terminal-on-click non-terminal terminal-on-submit; do
        if [ -d "$SCRIPT_DIR/templates/$TEMPLATE-$candidate_mode" ]; then
            TEMPLATE_DIR="$SCRIPT_DIR/templates/$TEMPLATE-$candidate_mode"
            break
        fi
    done
fi
[ -d "$TEMPLATE_DIR" ] || die "cannot find substrate template dir for '$TEMPLATE'"

UNIT_TEMPLATE="$TEMPLATE_DIR/im-SLUG.service.template"
[ -f "$UNIT_TEMPLATE" ] || die "$UNIT_TEMPLATE not found — substrate may be incomplete"

tmp_unit=$(mktemp "$HOME/.config/systemd/user/.im-$NEW_SLUG.XXXXXX")
sed \
    -e "s|__SLUG__|$NEW_SLUG|g" \
    -e "s|__WIDGET_DIR__|$NEW_WIDGET_DIR|g" \
    -e "s|__PORT__|$NEW_PORT|g" \
    "$UNIT_TEMPLATE" > "$tmp_unit"
mv "$tmp_unit" "$NEW_UNIT_FILE"

log "wrote systemd unit: $NEW_UNIT_FILE"

# ── daemon-reload + enable ────────────────────────────────────────────────────

if [ "${SKIP_SYSTEMCTL:-0}" = "1" ]; then
    log "SKIP_SYSTEMCTL=1 — skipping systemd enable/start (test mode)"
else
    systemctl --user daemon-reload
    systemctl --user enable --now "im-$NEW_SLUG.service"

    active=0
    for i in $(seq 1 10); do
        if systemctl --user is-active --quiet "im-$NEW_SLUG.service" 2>/dev/null; then
            active=1
            break
        fi
        sleep 0.2
    done

    if [ "$active" = "1" ]; then
        log "im-$NEW_SLUG is active (running)"
    else
        log "WARNING: im-$NEW_SLUG did not reach active state within ~2s"
        log "  check: journalctl --user -u im-$NEW_SLUG -n 50 --no-pager"
    fi
fi

CLEANUP_ON_FAIL=0

# ── Success output ────────────────────────────────────────────────────────────

printf 'OLD_SLUG=%s\n' "$OLD_SLUG"
printf 'NEW_SLUG=%s\n' "$NEW_SLUG"
printf 'URL=%s/interactive/%s/%s/pane/\n' "$HOST_PARENT" "$HOSTID" "$NEW_SLUG"

log "done"
log "  old-slug: $OLD_SLUG (torn down)"
log "  new-slug: $NEW_SLUG"
log "  new-port: $NEW_PORT (bound to 127.0.0.1)"
log "  new-url:  $HOST_PARENT/interactive/$HOSTID/$NEW_SLUG/pane/"
