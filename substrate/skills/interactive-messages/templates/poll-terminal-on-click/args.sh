#!/usr/bin/env bash
# args.sh — hook file for the poll-terminal-on-click template
#
# This file is sourced by create-widget.sh's dispatcher for the poll template.
# Do not execute this file directly.
#
# Contract: template_parse_args + template_substitute + TEMPLATE_ARGS + TEMPLATE_CONFIG_JSON
#
# template_parse_args "$@"
#   Accepts remaining argv after the dispatcher's global-arg parse.
#   Populates: TEMPLATE_ARGS[prompt] and TEMPLATE_ARGS[options]
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
    local prompt="" options=""

    while [ $# -gt 0 ]; do
        case "$1" in
            --prompt)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--prompt requires a value" >&2; exit 1; }
                prompt="$2"; shift 2 ;;
            --options)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--options requires a value" >&2; exit 1; }
                options="$2"; shift 2 ;;
            # Tolerate global flags in case they leak through (robustness)
            --message-id|--conversation-id)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "$1 requires a value" >&2; exit 1; }
                shift 2 ;;
            *)
                printf '[create-widget] ERROR: unknown flag: %s\n' "$1" >&2; exit 1 ;;
        esac
    done

    [ -n "$prompt" ]  || { printf '[create-widget] ERROR: --prompt is required\n' >&2; exit 1; }
    [ -n "$options" ] || { printf '[create-widget] ERROR: --options is required\n' >&2; exit 1; }

    # Validate options — must have at least 2 comma-separated non-empty items.
    IFS=',' read -ra OPT_ARRAY <<< "$options"
    local opt_count="${#OPT_ARRAY[@]}"
    if [ "$opt_count" -lt 2 ]; then
        printf '[create-widget] ERROR: --options must contain at least 2 comma-separated items (got %s: '"'"'%s'"'"')\n' \
            "$opt_count" "$options" >&2
        exit 1
    fi
    for opt in "${OPT_ARRAY[@]}"; do
        if [ -z "$opt" ]; then
            printf '[create-widget] ERROR: --options contains an empty item in '"'"'%s'"'"'\n' "$options" >&2
            exit 1
        fi
    done

    TEMPLATE_ARGS[prompt]="$prompt"
    TEMPLATE_ARGS[options]="$options"
}

template_substitute() {
    local widget_html="$WIDGET_DIR/widget.html"

    # Apply four substitutions via python3 for correct encoding:
    #   __PROMPT_JSON__  → JSON-encoded prompt string (safe for inline JS)
    #   __OPTIONS_JSON__ → JSON array of option label strings
    #   __WIDGET_ID__    → widget slug (plain string)
    #   __PANE_BASE__    → widget pane URL path (plain string)
    python3 - "$widget_html" "$SLUG" "${TEMPLATE_ARGS[prompt]}" "${TEMPLATE_ARGS[options]}" "$PANE_BASE" <<'PYEOF'
import sys, pathlib, json

html_path = pathlib.Path(sys.argv[1])
slug      = sys.argv[2]
prompt    = sys.argv[3]
options_s = sys.argv[4]
pane_base = sys.argv[5]

options = [o for o in options_s.split(",") if o]

html = html_path.read_text()

# Substitute __PROMPT_JSON__ with the JSON-encoded string (safe for inline JS)
html = html.replace("__PROMPT_JSON__", json.dumps(prompt))
# Substitute __OPTIONS_JSON__ with the JSON array of options
html = html.replace("__OPTIONS_JSON__", json.dumps(options))
# Substitute __WIDGET_ID__ with the slug
html = html.replace("__WIDGET_ID__", slug)
# Substitute __PANE_BASE__ with the widget's pane base path
html = html.replace("__PANE_BASE__", pane_base)

html_path.write_text(html)
PYEOF

    # Produce TEMPLATE_CONFIG_JSON via python3 for correct escaping
    TEMPLATE_CONFIG_JSON=$(python3 - "${TEMPLATE_ARGS[prompt]}" "${TEMPLATE_ARGS[options]}" <<'PYEOF'
import sys, json

prompt    = sys.argv[1]
options_s = sys.argv[2]
options   = [o for o in options_s.split(",") if o]

print(json.dumps({"prompt": prompt, "options": options}), end="")
PYEOF
)
    export TEMPLATE_CONFIG_JSON
}
