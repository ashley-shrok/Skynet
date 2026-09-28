#!/usr/bin/env bash
# args.sh — hook file for the ranking-terminal-on-submit template
#
# This file is sourced by create-widget.sh's dispatcher for the ranking template.
# Do not execute this file directly.
#
# Contract: template_parse_args + template_substitute + TEMPLATE_ARGS + TEMPLATE_CONFIG_JSON
#
# template_parse_args "$@"
#   Accepts remaining argv after the dispatcher's global-arg parse.
#   Populates: TEMPLATE_ARGS[prompt], TEMPLATE_ARGS[items], TEMPLATE_ARGS[submit_label]
#   Dies on invalid input.
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
    local prompt="" items="" submit_label="Submit order"

    while [ $# -gt 0 ]; do
        case "$1" in
            --prompt)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--prompt requires a value" >&2; exit 1; }
                prompt="$2"; shift 2 ;;
            --items)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--items requires a value" >&2; exit 1; }
                items="$2"; shift 2 ;;
            --submit-label)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--submit-label requires a value" >&2; exit 1; }
                submit_label="$2"; shift 2 ;;
            # Tolerate global flags in case they leak through (robustness)
            --message-id|--conversation-id)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "$1 requires a value" >&2; exit 1; }
                shift 2 ;;
            *)
                printf '[create-widget] ERROR: unknown flag: %s\n' "$1" >&2; exit 1 ;;
        esac
    done

    [ -n "$prompt" ] || { printf '[create-widget] ERROR: --prompt is required\n' >&2; exit 1; }
    [ -n "$items" ]  || { printf '[create-widget] ERROR: --items is required\n' >&2; exit 1; }

    # Validate items — must have at least 2 comma-separated non-empty items.
    IFS=',' read -ra ITEM_ARRAY <<< "$items"
    local item_count="${#ITEM_ARRAY[@]}"
    if [ "$item_count" -lt 2 ]; then
        printf '[create-widget] ERROR: --items must contain at least 2 comma-separated items (got %s: '"'"'%s'"'"')\n' \
            "$item_count" "$items" >&2
        exit 1
    fi
    for item in "${ITEM_ARRAY[@]}"; do
        if [ -z "$item" ]; then
            printf '[create-widget] ERROR: --items contains an empty item in '"'"'%s'"'"'\n' "$items" >&2
            exit 1
        fi
    done

    TEMPLATE_ARGS[prompt]="$prompt"
    TEMPLATE_ARGS[items]="$items"
    TEMPLATE_ARGS[submit_label]="$submit_label"
}

template_substitute() {
    local widget_html="$WIDGET_DIR/widget.html"

    # Apply five substitutions via python3 for correct encoding:
    #   __PROMPT_JSON__       → JSON-encoded prompt string (safe for inline JS)
    #   __ITEMS_JSON__        → JSON array of item label strings
    #   __WIDGET_ID__         → widget slug (plain string)
    #   __PANE_BASE__         → widget pane URL path (plain string)
    #   __SUBMIT_LABEL_JSON__ → JSON-encoded submit button label string
    python3 - "$widget_html" "$SLUG" "${TEMPLATE_ARGS[prompt]}" "${TEMPLATE_ARGS[items]}" "$PANE_BASE" "${TEMPLATE_ARGS[submit_label]}" <<'PYEOF'
import sys, pathlib, json

html_path    = pathlib.Path(sys.argv[1])
slug         = sys.argv[2]
prompt       = sys.argv[3]
items_s      = sys.argv[4]
pane_base    = sys.argv[5]
submit_label = sys.argv[6]

items = [i for i in items_s.split(",") if i]

html = html_path.read_text()

# Substitute __PROMPT_JSON__ with the JSON-encoded string (safe for inline JS)
html = html.replace("__PROMPT_JSON__", json.dumps(prompt))
# Substitute __ITEMS_JSON__ with the JSON array of items
html = html.replace("__ITEMS_JSON__", json.dumps(items))
# Substitute __WIDGET_ID__ with the slug
html = html.replace("__WIDGET_ID__", slug)
# Substitute __PANE_BASE__ with the widget's pane base path
html = html.replace("__PANE_BASE__", pane_base)
# Substitute __SUBMIT_LABEL_JSON__ with the JSON-encoded submit label
html = html.replace("__SUBMIT_LABEL_JSON__", json.dumps(submit_label))

html_path.write_text(html)
PYEOF

    # Produce TEMPLATE_CONFIG_JSON via python3 for correct escaping
    TEMPLATE_CONFIG_JSON=$(python3 - "${TEMPLATE_ARGS[prompt]}" "${TEMPLATE_ARGS[items]}" "${TEMPLATE_ARGS[submit_label]}" <<'PYEOF'
import sys, json

prompt       = sys.argv[1]
items_s      = sys.argv[2]
submit_label = sys.argv[3]
items        = [i for i in items_s.split(",") if i]

print(json.dumps({"prompt": prompt, "items": items, "submit_label": submit_label}), end="")
PYEOF
)
    export TEMPLATE_CONFIG_JSON
}
