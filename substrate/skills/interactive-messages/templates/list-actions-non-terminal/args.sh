#!/usr/bin/env bash
# args.sh — hook file for the list-actions-non-terminal template
#
# This file is sourced by create-widget.sh's dispatcher for the list-actions template
# in non-terminal mode. Do not execute this file directly.
#
# Contract: template_parse_args + template_substitute + TEMPLATE_ARGS + TEMPLATE_CONFIG_JSON
#
# template_parse_args "$@"
#   Accepts remaining argv after the dispatcher's global-arg parse.
#   Populates: TEMPLATE_ARGS[prompt], TEMPLATE_ARGS[items_json],
#              TEMPLATE_ARGS[actions]
#   Dies on invalid input.
#   NOTE: --done-label is rejected — non-terminal mode has no Done button.
#
# template_substitute
#   Given: $WIDGET_DIR (widget files already copied in),
#          $TEMPLATE_ARGS[...], $PANE_BASE, $SLUG
#   Side-effects: writes substituted widget.html in place
#   Exports: TEMPLATE_CONFIG_JSON (a JSON object literal string that becomes
#            the "config" field in metadata.json)

# Template args storage — populated by template_parse_args
declare -gA TEMPLATE_ARGS

template_parse_args() {
    local prompt="" items_json="" actions=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --prompt)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--prompt requires a value" >&2; exit 1; }
                prompt="$2"; shift 2 ;;
            --items)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--items requires a value" >&2; exit 1; }
                items_json="$2"; shift 2 ;;
            --actions)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--actions requires a value" >&2; exit 1; }
                actions="$2"; shift 2 ;;
            --done-label)
                printf '[create-widget] ERROR: --done-label is not accepted by list-actions-non-terminal (non-terminal mode has no Done button)\n' >&2; exit 1 ;;
            --submit-label)
                printf '[create-widget] ERROR: --submit-label is not accepted by list-actions-non-terminal (non-terminal mode has no Done button)\n' >&2; exit 1 ;;
            # Tolerate global flags in case they leak through (robustness)
            --message-id|--conversation-id)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "$1 requires a value" >&2; exit 1; }
                shift 2 ;;
            *)
                printf '[create-widget] ERROR: unknown flag: %s\n' "$1" >&2; exit 1 ;;
        esac
    done

    [ -n "$prompt" ]     || { printf '[create-widget] ERROR: --prompt is required\n' >&2; exit 1; }
    [ -n "$items_json" ] || { printf '[create-widget] ERROR: --items is required\n' >&2; exit 1; }
    [ -n "$actions" ]    || { printf '[create-widget] ERROR: --actions is required\n' >&2; exit 1; }

    # Validate --items: must be a valid JSON array with at least 1 item,
    # where each item is either a string or a {label: string} object.
    local validation_error
    validation_error=$(python3 - "$items_json" <<'PYEOF'
import sys, json

raw = sys.argv[1]

# Parse JSON
try:
    items = json.loads(raw)
except Exception as exc:
    print(f"--items must be a valid JSON array: got '{raw}'")
    sys.exit(0)

# Must be an array
if not isinstance(items, list):
    print(f"--items must be a valid JSON array: got '{raw}'")
    sys.exit(0)

# Must have at least 1 item
if len(items) == 0:
    print("--items must contain at least 1 item")
    sys.exit(0)

# Each item must be a string or an object with a non-empty 'label' string field
for item in items:
    if isinstance(item, str):
        pass  # valid
    elif isinstance(item, dict):
        label = item.get("label")
        if not isinstance(label, str) or label == "":
            print("--items entries must be strings or {label: string} objects")
            sys.exit(0)
    else:
        print("--items entries must be strings or {label: string} objects")
        sys.exit(0)

# All valid — print nothing
PYEOF
)
    if [ -n "$validation_error" ]; then
        printf '[create-widget] ERROR: %s\n' "$validation_error" >&2
        exit 1
    fi

    # Validate --actions: comma-separated, at least 2 non-empty action names
    if [ -z "$actions" ]; then
        printf '[create-widget] ERROR: --actions is required\n' >&2
        exit 1
    fi
    IFS=',' read -ra ACTIONS_ARRAY <<< "$actions"
    local action_count=0
    for act in "${ACTIONS_ARRAY[@]}"; do
        if [ -n "$act" ]; then
            action_count=$((action_count + 1))
        fi
    done
    if [ "$action_count" -lt 2 ]; then
        printf '[create-widget] ERROR: --actions must contain at least 2 non-empty comma-separated items\n' >&2
        exit 1
    fi

    TEMPLATE_ARGS[prompt]="$prompt"
    TEMPLATE_ARGS[items_json]="$items_json"
    TEMPLATE_ARGS[actions]="$actions"
}

template_substitute() {
    local widget_html="$WIDGET_DIR/widget.html"

    # Apply substitutions via python3 for correct JSON encoding:
    #   __PROMPT_JSON__    → JSON-encoded prompt string
    #   __ITEMS_JSON__     → validated JSON array of items (pass through)
    #   __ACTIONS_JSON__   → JSON array of action name strings (from comma-split)
    #   __WIDGET_ID__      → widget slug (plain string)
    #   __PANE_BASE__      → widget pane URL path (plain string)
    python3 - "$widget_html" "$SLUG" "${TEMPLATE_ARGS[prompt]}" \
              "${TEMPLATE_ARGS[items_json]}" "${TEMPLATE_ARGS[actions]}" \
              "$PANE_BASE" <<'PYEOF'
import sys, pathlib, json

html_path  = pathlib.Path(sys.argv[1])
slug       = sys.argv[2]
prompt     = sys.argv[3]
items_json = sys.argv[4]
actions_s  = sys.argv[5]
pane_base  = sys.argv[6]

# items_json is already a validated JSON array string
items = json.loads(items_json)

# Parse actions from comma-separated string
actions = [a for a in actions_s.split(",") if a]

html = html_path.read_text()

html = html.replace("__PROMPT_JSON__",  json.dumps(prompt))
html = html.replace("__ITEMS_JSON__",   json.dumps(items))
html = html.replace("__ACTIONS_JSON__", json.dumps(actions))
html = html.replace("__WIDGET_ID__",    slug)
html = html.replace("__PANE_BASE__",    pane_base)

html_path.write_text(html)
PYEOF

    # Produce TEMPLATE_CONFIG_JSON via python3 for correct escaping
    TEMPLATE_CONFIG_JSON=$(python3 - "${TEMPLATE_ARGS[prompt]}" \
                           "${TEMPLATE_ARGS[items_json]}" \
                           "${TEMPLATE_ARGS[actions]}" <<'PYEOF'
import sys, json

prompt     = sys.argv[1]
items_json = sys.argv[2]
actions_s  = sys.argv[3]

items   = json.loads(items_json)
actions = [a for a in actions_s.split(",") if a]

print(json.dumps({
    "prompt": prompt,
    "items": items,
    "actions": actions,
    "mode": "non-terminal",
}), end="")
PYEOF
)
    export TEMPLATE_CONFIG_JSON
}
