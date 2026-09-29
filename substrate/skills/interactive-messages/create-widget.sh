#!/usr/bin/env bash
# create-widget.sh — scaffold a new interactive widget
# under ~/fleet/interactive-messages/<slug>.
#
# ── Invocation forms ──────────────────────────────────────────────────────────
#
# Form A (positional — Phase 137 back-compat):
#   create-widget.sh <slug> <template> [template-specific flags...]
#
# Form B (flag-based — Phase 138 new):
#   create-widget.sh --slug <s> --template <name> [template-specific flags...]
#
# Global flags (all templates):
#   --message-id      <m>   (required)
#   --conversation-id <c>   (required)
#   --mode            <mode> (optional — see below)
#
# Template-specific flags are forwarded to the template's args.sh hook.
#
# ── Mode selection ────────────────────────────────────────────────────────────
#
# --mode <terminal-on-click|terminal-on-submit|non-terminal>
#
#   Selects which mode variant of the template to use. Each template has a
#   canonical default mode (used when --mode is omitted) and a curated set of
#   supported modes. The dispatcher resolves TEMPLATE_DIR as:
#
#     templates/<template>-<mode>/
#
#   Per-template defaults (Phase 137/138 back-compat — omitting --mode produces
#   the same behavior as before Phase 139):
#     poll, color-picker          → terminal-on-click
#     checklist, form, ranking,
#     list-actions, draft         → terminal-on-submit
#
#   Supported (template, mode) combinations:
#     poll:          terminal-on-click, non-terminal
#     color-picker:  terminal-on-click, non-terminal
#     checklist:     terminal-on-submit, non-terminal
#     form:          terminal-on-submit, non-terminal
#     ranking:       terminal-on-submit, non-terminal
#     list-actions:  terminal-on-submit, non-terminal
#     draft:         terminal-on-submit
#
#   --mode is a dispatcher-owned flag and is NEVER forwarded to template args.sh.
#
# ── Dispatcher contract for per-template args.sh hooks ───────────────────────
#
#   Each template dir (templates/<name>-<mode>/) must contain args.sh.
#   The dispatcher sources it, then calls:
#
#   template_parse_args "$@"
#       Accepts remaining argv after global-arg parse.
#       Populates: declare -gA TEMPLATE_ARGS[key]=value
#       Dies on invalid input.
#
#   template_substitute
#       Called after template files are copied into $WIDGET_DIR.
#       Given:  $WIDGET_DIR  (widget files already copied in)
#               $TEMPLATE_ARGS[...]
#               $PANE_BASE   (/interactive/<hostid>/<slug>/pane)
#               $SLUG
#       Side-effects: writes substituted widget.html in place
#       Exports:  TEMPLATE_CONFIG_JSON  (a JSON object literal string that
#                 becomes the "config" field in metadata.json)
#
# ── Steps ─────────────────────────────────────────────────────────────────────
#   1.  Parse args (two-pass: detect positional vs flag form).
#   2.  Validate slug (kebab-case, max 40 chars).
#   3.  Validate template against allowlist of six supported names.
#   4.  Resolve MODE (explicit --mode or per-template default); validate combo.
#   5.  Resolve TEMPLATE_DIR as templates/<template>-<mode>/ (no glob).
#   6.  Validate --message-id and --conversation-id are set.
#   7.  Pre-flight paths + read HOSTID.
#   8.  Source $TEMPLATE_DIR/args.sh; verify hook functions are defined.
#   9.  Call template_parse_args with remaining template-specific argv.
#   10. claim_port() under exclusive flock on ~/fleet/.create-widget-lock.
#   11. Copy $TEMPLATE_DIR/. into $WIDGET_DIR/; remove substrate-only files.
#   12. Substitute __PORT__ in server.py.
#   13. Call template_substitute (writes widget.html; sets TEMPLATE_CONFIG_JSON).
#   14. Write metadata.json from TEMPLATE_CONFIG_JSON.
#   15. daemon-reload + enable --now + poll for active state.
#   16. Print SLUG= and URL= to stdout.
#
# The lock file is ~/fleet/.create-widget-lock — DISTINCT from create-app.sh's
# ~/fleet/.create-lock so concurrent create-app and create-widget invocations
# never contend with each other.
#
# On any failure after the port claim the cleanup trap removes the partial
# systemd unit, the widget folder, and runs daemon-reload to release the
# port claim.

set -euo pipefail

log() { printf '[create-widget] %s\n' "$*" >&2; }
die() { printf '[create-widget] ERROR: %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# ── Arg parsing ───────────────────────────────────────────────────────────────
# Two-pass: detect whether argv starts with a bareword (positional form A)
# or --slug / --template (flag form B).

if [ $# -lt 2 ]; then
    die "usage: create-widget.sh <slug> <template> --message-id <m> --conversation-id <c> [--mode <terminal-on-click|terminal-on-submit|non-terminal>] [template-flags...]"
fi

SLUG=""
TEMPLATE=""
MESSAGE_ID=""
CONVERSATION_ID=""
MODE_ARG=""
TEMPLATE_ARGV=()

# Detect invocation form
if [[ "$1" == "--"* ]]; then
    # Form B: flag-based
    while [ $# -gt 0 ]; do
        case "$1" in
            --slug)
                [ $# -ge 2 ] || die "--slug requires a value"
                SLUG="$2"; shift 2 ;;
            --template)
                [ $# -ge 2 ] || die "--template requires a value"
                TEMPLATE="$2"; shift 2 ;;
            --message-id)
                [ $# -ge 2 ] || die "--message-id requires a value"
                MESSAGE_ID="$2"; shift 2 ;;
            --conversation-id)
                [ $# -ge 2 ] || die "--conversation-id requires a value"
                CONVERSATION_ID="$2"; shift 2 ;;
            --mode)
                [ $# -ge 2 ] || die "--mode requires a value"
                MODE_ARG="$2"; shift 2 ;;
            *)
                # Remaining flags are template-specific; collect for args.sh
                TEMPLATE_ARGV+=("$1"); shift ;;
        esac
    done
else
    # Form A: positional back-compat
    SLUG="$1"
    TEMPLATE="$2"
    shift 2
    # Remaining argv: global + template flags mixed — parse out globals now
    while [ $# -gt 0 ]; do
        case "$1" in
            --message-id)
                [ $# -ge 2 ] || die "--message-id requires a value"
                MESSAGE_ID="$2"; shift 2 ;;
            --conversation-id)
                [ $# -ge 2 ] || die "--conversation-id requires a value"
                CONVERSATION_ID="$2"; shift 2 ;;
            --mode)
                [ $# -ge 2 ] || die "--mode requires a value"
                MODE_ARG="$2"; shift 2 ;;
            *)
                # Remaining flags are template-specific; collect for args.sh
                TEMPLATE_ARGV+=("$1"); shift ;;
        esac
    done
fi

# ── Validate slug ─────────────────────────────────────────────────────────────

[ -n "$SLUG" ] || die "slug is required"

if ! [[ "$SLUG" =~ ^[a-z][a-z0-9-]*$ ]]; then
    die "slug must be kebab-case (lowercase letter start, then letters/digits/hyphens): got '$SLUG'"
fi
if [ "${#SLUG}" -gt 40 ]; then
    die "slug too long (max 40 chars): '$SLUG'"
fi

# ── Validate template (allowlist) ─────────────────────────────────────────────

[ -n "$TEMPLATE" ] || die "template is required"

case "$TEMPLATE" in
    poll|checklist|form|ranking|list-actions|color-picker|draft)
        ;;
    *)
        die "unknown template '$TEMPLATE' — supported: poll, checklist, form, ranking, list-actions, color-picker, draft" ;;
esac

# ── Per-template default mode + supported-combo helpers ──────────────────────

# default_mode_for_template <template>
# Echoes the canonical default mode for the given template.
# Returns 1 (and echoes nothing) if the template is unknown — defense-in-depth
# for callers outside the allowlist check.
default_mode_for_template() {
    case "$1" in
        poll|color-picker)                          echo "terminal-on-click" ;;
        checklist|form|ranking|list-actions|draft)  echo "terminal-on-submit" ;;
        *)                                          return 1 ;;
    esac
}

# is_supported_combo <template> <mode>
# Returns 0 for a supported (template, mode) pair, 1 otherwise.
is_supported_combo() {
    local t="$1" m="$2"
    case "$t:$m" in
        poll:terminal-on-click|poll:non-terminal)                   return 0 ;;
        checklist:terminal-on-submit|checklist:non-terminal)        return 0 ;;
        form:terminal-on-submit|form:non-terminal)                  return 0 ;;
        ranking:terminal-on-submit|ranking:non-terminal)            return 0 ;;
        list-actions:terminal-on-submit|list-actions:non-terminal)  return 0 ;;
        color-picker:terminal-on-click|color-picker:non-terminal)   return 0 ;;
        draft:terminal-on-submit)                                    return 0 ;;
        *)                                                           return 1 ;;
    esac
}

# ── Resolve MODE ──────────────────────────────────────────────────────────────

if [ -z "$MODE_ARG" ]; then
    # No --mode supplied: fall back to per-template canonical default.
    MODE=$(default_mode_for_template "$TEMPLATE") \
        || die "internal: default_mode_for_template failed for '$TEMPLATE'"
    log "mode: $MODE (default for $TEMPLATE)"
else
    # --mode supplied: validate the literal value first.
    case "$MODE_ARG" in
        terminal-on-click|terminal-on-submit|non-terminal)
            ;;
        *)
            die "unknown mode '$MODE_ARG' — supported: terminal-on-click, terminal-on-submit, non-terminal" ;;
    esac

    # Then verify this (template, mode) pair is in the curated supported set.
    if ! is_supported_combo "$TEMPLATE" "$MODE_ARG"; then
        # Build the list of modes this template DOES support for the error message.
        supported_list=""
        for candidate in terminal-on-click terminal-on-submit non-terminal; do
            if is_supported_combo "$TEMPLATE" "$candidate"; then
                if [ -n "$supported_list" ]; then
                    supported_list="$supported_list, $candidate"
                else
                    supported_list="$candidate"
                fi
            fi
        done
        die "template '$TEMPLATE' does not support mode '$MODE_ARG' — supported modes for '$TEMPLATE': $supported_list"
    fi

    MODE="$MODE_ARG"
    log "mode: $MODE (explicit)"
fi

# ── Resolve TEMPLATE_DIR ──────────────────────────────────────────────────────
# Explicit path resolution — never glob. The directory name is always
# <template>-<mode> (e.g. poll-terminal-on-click).

TEMPLATE_DIR="$SCRIPT_DIR/templates/$TEMPLATE-$MODE"
[ -d "$TEMPLATE_DIR" ] \
    || die "template dir not found at $TEMPLATE_DIR — the ($TEMPLATE, $MODE) combination has no substrate implementation (Phase 139 has not shipped this combo yet)"

# ── Validate global required flags ───────────────────────────────────────────

[ -n "$MESSAGE_ID" ]      || die "--message-id is required"
[ -n "$CONVERSATION_ID" ] || die "--conversation-id is required"

# ── Paths ─────────────────────────────────────────────────────────────────────

WIDGET_DIR="$HOME/fleet/interactive-messages/$SLUG"
UNIT_FILE="$HOME/.config/systemd/user/im-$SLUG.service"
LOCK_FILE="$HOME/fleet/.create-widget-lock"

# ── Pre-flight ────────────────────────────────────────────────────────────────

[ -d "$HOME/fleet/interactive-messages" ] \
    || die "~/fleet/interactive-messages does not exist — run \`mkdir -p ~/fleet/interactive-messages\` first"

[ ! -e "$WIDGET_DIR" ] \
    || die "widget already exists at $WIDGET_DIR — choose a different slug or remove the existing widget"

[ ! -e "$UNIT_FILE" ] \
    || die "systemd unit already exists at $UNIT_FILE"

# Read the numeric fleet-DB hostId from the distributor-written file so we
# can bake PANE_BASE = '/interactive/<HOSTID>/<SLUG>/pane' into the widget.
# The distributor writes this on every fleet-substrate sweep. If the file is
# missing, this box hasn't been swept yet — surface the failure rather than
# scaffolding a widget with a bogus prefix.
HOSTID_FILE="$HOME/fleet/host/id"
if [ ! -f "$HOSTID_FILE" ]; then
    die "$HOSTID_FILE missing — the fleet-substrate distributor hasn't swept this box yet. Wait a minute and retry, or ask the box-maintainer role to check the distributor. Do NOT scaffold without a real hostId; the widget URL would be wrong."
fi
HOSTID=$(cat "$HOSTID_FILE" | tr -d '[:space:]')
if ! [[ "$HOSTID" =~ ^[1-9][0-9]{0,9}$ ]]; then
    die "$HOSTID_FILE contains an invalid hostId ('$HOSTID') — expected a positive integer. Ask the box-maintainer role to check the distributor sweep."
fi

# Ensure systemd user directory exists (daemon-reload will need it)
mkdir -p "$HOME/.config/systemd/user"

# ── Source template hook (args.sh) ────────────────────────────────────────────

[ -f "$TEMPLATE_DIR/args.sh" ] \
    || die "args.sh not found at $TEMPLATE_DIR/args.sh — substrate may be incomplete"

# Source the hook file — defines template_parse_args and template_substitute
# shellcheck disable=SC1090
source "$TEMPLATE_DIR/args.sh"

# Verify both required hook functions are defined
declare -f template_parse_args > /dev/null 2>&1 \
    || die "args.sh at $ARGS_SH does not define template_parse_args"
declare -f template_substitute > /dev/null 2>&1 \
    || die "args.sh at $ARGS_SH does not define template_substitute"

# ── Parse template-specific args via hook ────────────────────────────────────

template_parse_args "${TEMPLATE_ARGV[@]+"${TEMPLATE_ARGV[@]}"}"

# ── Log ───────────────────────────────────────────────────────────────────────

log "slug:            $SLUG"
log "template:        $TEMPLATE"
log "mode:            $MODE"
log "template-dir:    $TEMPLATE_DIR"
log "message-id:      $MESSAGE_ID"
log "conversation-id: $CONVERSATION_ID"
log "dir:             $WIDGET_DIR"

# ── Cleanup trap (armed BEFORE any state mutation) ────────────────────────────
# The trap fires on EXIT (success or failure). CLEANUP_ON_FAIL controls whether
# it actually rolls back — it stays 0 until we've committed enough state to need
# cleanup, then flips to 1. Armed early so a failure inside the port-claim
# subshell doesn't leave an orphan unit file.

CLEANUP_ON_FAIL=0
cleanup() {
    if [ "$CLEANUP_ON_FAIL" = "1" ]; then
        log "cleaning up partial create (rolling back port claim)..."
        # Skip systemctl in test environments where it's not available
        if [ "${SKIP_SYSTEMCTL:-0}" != "1" ]; then
            systemctl --user disable "im-$SLUG.service" 2>/dev/null || true
            systemctl --user stop    "im-$SLUG.service" 2>/dev/null || true
            systemctl --user daemon-reload 2>/dev/null || true
        fi
        rm -f  "$UNIT_FILE"
        rm -rf "$WIDGET_DIR"
    fi
}
trap cleanup EXIT

# ── Port claim (under exclusive lock on the widget lock file) ─────────────────
# Extracted into claim_port() for reuse across all templates.
# Command substitution runs in a subshell; fd 200 opens there, flock holds the
# exclusive lock, port is picked, unit file is written, subshell exits (closing
# fd, releasing lock), and the picked port is captured via stdout.

claim_port() {
    exec 200>"$LOCK_FILE"
    flock -x 200

    # Collect ports already claimed by installed widget systemd units.
    USED_PORTS=""
    if compgen -G "$HOME/.config/systemd/user/im-*.service" > /dev/null 2>&1; then
        USED_PORTS=$(grep -h '^Environment=PORT=' "$HOME"/.config/systemd/user/im-*.service 2>/dev/null \
                     | sed 's/^Environment=PORT=//')
    fi

    # Phase 137: no archive mechanism yet, but the port reservation defends
    # against future archive→restore correctness — a widget that ships in Phase 3
    # will need this to reclaim its old port without colliding with newly-minted
    # widgets that claimed the freed slot.
    if compgen -G "$HOME/fleet/interactive-messages-archive/*/im-*.service.archived" > /dev/null 2>&1; then
        ARCHIVED_PORTS=$(grep -h '^Environment=PORT=' \
                         "$HOME"/fleet/interactive-messages-archive/*/im-*.service.archived 2>/dev/null \
                         | sed 's/^Environment=PORT=//')
        USED_PORTS=$(printf '%s\n%s' "$USED_PORTS" "$ARCHIVED_PORTS")
    fi
    USED_PORTS=$(printf '%s\n' "$USED_PORTS" | sort -u)

    # Widget port range: 9601-9699.
    # This range is distinct from apps' 9501-9599 — the two lanes never contend.
    # Do NOT check the apps' port range; the disjoint design is intentional.
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

    # Write via a temp file + atomic rename so a mid-write failure can't
    # leave a partial unit on disk (parity with create-app.sh atomic pattern).
    tmp_unit=$(mktemp "$HOME/.config/systemd/user/.im-$SLUG.XXXXXX")
    sed \
        -e "s|__SLUG__|$SLUG|g" \
        -e "s|__WIDGET_DIR__|$WIDGET_DIR|g" \
        -e "s|__PORT__|$picked|g" \
        "$TEMPLATE_DIR/im-SLUG.service.template" > "$tmp_unit"
    mv "$tmp_unit" "$UNIT_FILE"

    printf '%s' "$picked"
}

PORT=$(claim_port)
[ -n "$PORT" ] || die "port claim failed"

log "port:  $PORT (claimed atomically)"
log "wrote systemd unit: $UNIT_FILE"

# Port is now claimed on disk — any failure past this point needs rollback.
CLEANUP_ON_FAIL=1

# ── Scaffold the widget folder ────────────────────────────────────────────────

cp -r "$TEMPLATE_DIR/." "$WIDGET_DIR/"
log "scaffolded template into $WIDGET_DIR"

# Remove substrate-only files from the widget folder — they're not runtime files:
# - im-SLUG.service.template: already rendered into ~/.config/systemd/user/
# - metadata.json.template: shape reference only — actual metadata written below
# - args.sh: dispatcher hook, not needed at runtime
rm -f "$WIDGET_DIR/im-SLUG.service.template"
rm -f "$WIDGET_DIR/metadata.json.template"
rm -f "$WIDGET_DIR/args.sh"

# Make server.py executable (it has a shebang line for standalone dev use)
chmod 0755 "$WIDGET_DIR/server.py"

# ── Substitutions in server.py ────────────────────────────────────────────────

# Replace __PORT__ in server.py with the claimed port (standalone-dev fallback)
python3 - "$WIDGET_DIR/server.py" "$PORT" <<'PYEOF'
import sys, pathlib

py_path = pathlib.Path(sys.argv[1])
port    = sys.argv[2]

content = py_path.read_text()
content = content.replace("__PORT__", port)
py_path.write_text(content)
PYEOF

log "substituted PORT=$PORT in server.py"

# ── Template-specific substitution via hook ───────────────────────────────────

PANE_BASE="/interactive/$HOSTID/$SLUG/pane"

# The hook reads WIDGET_DIR, TEMPLATE_ARGS[*], PANE_BASE, SLUG;
# writes substituted widget.html; sets TEMPLATE_CONFIG_JSON.
TEMPLATE_CONFIG_JSON=""
template_substitute

log "template_substitute complete (hook applied widget.html substitutions)"

# ── Write metadata.json ───────────────────────────────────────────────────────

python3 - "$WIDGET_DIR/metadata.json" "$TEMPLATE" "$SLUG" "$MESSAGE_ID" "$CONVERSATION_ID" "$TEMPLATE_CONFIG_JSON" <<'PYEOF'
import json, sys, pathlib, datetime

out_path        = pathlib.Path(sys.argv[1])
template_name   = sys.argv[2]
widget_id       = sys.argv[3]
message_id      = sys.argv[4]
conversation_id = sys.argv[5]
config_json_str = sys.argv[6]

# Parse the config JSON string produced by the template hook
config = json.loads(config_json_str) if config_json_str else {}

out_path.write_text(
    json.dumps(
        {
            "template":        template_name,
            "widget_id":       widget_id,
            "message_id":      message_id,
            "conversation_id": conversation_id,
            "config":          config,
            "created_at":      datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        indent=2,
    )
    + "\n"
)
PYEOF

log "wrote metadata.json"

# ── Enable + start ────────────────────────────────────────────────────────────

if [ "${SKIP_SYSTEMCTL:-0}" = "1" ]; then
    log "SKIP_SYSTEMCTL=1 — skipping systemd enable/start (test mode)"
else
    systemctl --user daemon-reload
    systemctl --user enable --now "im-$SLUG.service"
    log "systemd unit enabled and started"

    # Poll for active state — max 10 iterations * 200ms = ~2s
    active=0
    for i in $(seq 1 10); do
        if systemctl --user is-active --quiet "im-$SLUG.service" 2>/dev/null; then
            active=1
            break
        fi
        sleep 0.2
    done

    if [ "$active" = "1" ]; then
        log "im-$SLUG is active (running)"
    else
        log "WARNING: im-$SLUG did not reach active state within ~2s"
        log "  check: journalctl --user -u im-$SLUG -n 50 --no-pager"
        # Don't die here — leave the widget in place so the agent can debug it.
        # The port claim stays valid.
    fi
fi

# ── Success ───────────────────────────────────────────────────────────────────

CLEANUP_ON_FAIL=0

# Read the host parent-URL so we can emit an absolute HTTPS URL. The
# frontend's in-bubble widget detector regex (INTERACTIVE_MSG_URL_RE_CLIENT)
# requires https:// — a relative path won't render as an inline widget bubble.
# The distributor writes ~/fleet/host/parent to every managed box; if it's
# missing, surface a clean error rather than emitting an unrenderable URL.
HOST_PARENT_FILE="$HOME/fleet/host/parent"
if [ ! -s "$HOST_PARENT_FILE" ]; then
    log "ERROR: $HOST_PARENT_FILE is missing or empty — cannot emit an absolute widget URL."
    log "       The frontend URL detector requires https://<domain>/..., not a relative path."
    log "       Ask the box-maintainer role to check the distributor sweep."
    exit 1
fi
HOST_PARENT=$(cat "$HOST_PARENT_FILE")

# Print machine-parseable output to stdout (the agent's harness reads these).
printf 'SLUG=%s\n' "$SLUG"
printf 'URL=%s/interactive/%s/%s/pane/\n' "$HOST_PARENT" "$HOSTID" "$SLUG"

log "done"
log "  port:   $PORT (bound to 127.0.0.1)"
log "  folder: $WIDGET_DIR"
log "  url:    $HOST_PARENT/interactive/$HOSTID/$SLUG/pane/"
log "  logs:   journalctl --user -u im-$SLUG -f"
log "  status: systemctl --user status im-$SLUG"
