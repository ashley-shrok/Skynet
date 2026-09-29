#!/usr/bin/env bash
# args.sh — hook file for the draft-terminal-on-submit template
#
# This file is sourced by create-widget.sh's dispatcher for the draft template.
# Do not execute this file directly.
#
# Contract: template_parse_args + template_substitute + TEMPLATE_ARGS + TEMPLATE_CONFIG_JSON
#
# template_parse_args "$@"
#   Accepts remaining argv after the dispatcher's global-arg parse.
#   Populates: TEMPLATE_ARGS[prompt], TEMPLATE_ARGS[draft], TEMPLATE_ARGS[submit_label]
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
    local prompt="" draft="" submit_label="Send"
    local draft_seen=0

    while [ $# -gt 0 ]; do
        case "$1" in
            --prompt)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--prompt requires a value" >&2; exit 1; }
                prompt="$2"; shift 2 ;;
            --draft)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--draft requires a value" >&2; exit 1; }
                draft="$2"; draft_seen=1; shift 2 ;;
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

    [ "$draft_seen" = "1" ] || { printf '[create-widget] ERROR: --draft is required\n' >&2; exit 1; }

    TEMPLATE_ARGS[prompt]="$prompt"
    TEMPLATE_ARGS[draft]="$draft"
    TEMPLATE_ARGS[submit_label]="$submit_label"
}

template_substitute() {
    local widget_html="$WIDGET_DIR/widget.html"

    # Apply substitutions via python3 for correct encoding:
    #   __PROMPT_JSON__       → JSON-encoded prompt string (safe for inline JS)
    #   __DRAFT_JSON__        → JSON-encoded draft text (safe for inline JS)
    #   __WIDGET_ID__         → widget slug (plain string)
    #   __PANE_BASE__         → widget pane URL path (plain string)
    #   __SUBMIT_LABEL_JSON__ → JSON-encoded submit button label
    python3 - "$widget_html" "$SLUG" "${TEMPLATE_ARGS[prompt]}" "${TEMPLATE_ARGS[draft]}" "$PANE_BASE" "${TEMPLATE_ARGS[submit_label]}" <<'PYEOF'
import sys, pathlib, json

html_path    = pathlib.Path(sys.argv[1])
slug         = sys.argv[2]
prompt       = sys.argv[3]
draft        = sys.argv[4]
pane_base    = sys.argv[5]
submit_label = sys.argv[6]

html = html_path.read_text()

html = html.replace("__PROMPT_JSON__", json.dumps(prompt))
html = html.replace("__DRAFT_JSON__", json.dumps(draft))
html = html.replace("__WIDGET_ID__", slug)
html = html.replace("__PANE_BASE__", pane_base)
html = html.replace("__SUBMIT_LABEL_JSON__", json.dumps(submit_label))

html_path.write_text(html)
PYEOF

    # Produce TEMPLATE_CONFIG_JSON via python3 for correct escaping
    TEMPLATE_CONFIG_JSON=$(python3 - "${TEMPLATE_ARGS[prompt]}" "${TEMPLATE_ARGS[draft]}" "${TEMPLATE_ARGS[submit_label]}" <<'PYEOF'
import sys, json

prompt       = sys.argv[1]
draft        = sys.argv[2]
submit_label = sys.argv[3]

print(json.dumps({"prompt": prompt, "draft": draft, "submit_label": submit_label}), end="")
PYEOF
)
    export TEMPLATE_CONFIG_JSON
}
