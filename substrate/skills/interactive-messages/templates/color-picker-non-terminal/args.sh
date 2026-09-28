#!/usr/bin/env bash
# args.sh — hook file for the color-picker-non-terminal template
#
# Sibling: color-picker-terminal-on-click/args.sh
# The template_parse_args function below is BYTE-IDENTICAL to the terminal sibling.
# Mode-specific behavior lives entirely in widget.html (no postMessage, /update
# instead of /submit, radio-group-like selection, no disable) and server.py
# (/update endpoint, non-terminal discriminator comment).
#
# This file is sourced by create-widget.sh's dispatcher for the color-picker template
# in non-terminal mode. Do not execute this file directly.
#
# Contract: template_parse_args + template_substitute + TEMPLATE_ARGS + TEMPLATE_CONFIG_JSON
#
# template_parse_args "$@"
#   Accepts remaining argv after the dispatcher's global-arg parse.
#   Populates: TEMPLATE_ARGS[prompt] (may be empty) and TEMPLATE_ARGS[palette]
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

# Default 12-color curated palette (from phase 138 shape-file tasting decision).
# Spread across the hue wheel: red, orange, amber, yellow, lime, green, teal,
# sky-blue, indigo, purple, pink, slate (neutral).
DEFAULT_PALETTE_HEX="#ef4444,#f97316,#f59e0b,#eab308,#84cc16,#22c55e,#14b8a6,#0ea5e9,#6366f1,#a855f7,#ec4899,#64748b"

template_parse_args() {
    local prompt="" palette="" palette_set="0"

    while [ $# -gt 0 ]; do
        case "$1" in
            --prompt)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--prompt requires a value" >&2; exit 1; }
                prompt="$2"; shift 2 ;;
            --palette)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--palette requires a value" >&2; exit 1; }
                palette="$2"; palette_set="1"; shift 2 ;;
            # Tolerate global flags in case they leak through (robustness)
            --message-id|--conversation-id)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "$1 requires a value" >&2; exit 1; }
                shift 2 ;;
            *)
                printf '[create-widget] ERROR: unknown flag: %s\n' "$1" >&2; exit 1 ;;
        esac
    done

    # --prompt is optional for color-picker (the swatch grid can stand alone).
    # --palette defaults to the curated 12-color set when OMITTED (flag not passed).
    # If --palette is explicitly passed (even as empty string), validate it strictly.
    if [ "$palette_set" = "0" ]; then
        palette="$DEFAULT_PALETTE_HEX"
    fi

    # Validate palette entries — each must be a 6-digit hex color (#rrggbb).
    IFS=',' read -ra PALETTE_ARRAY <<< "$palette"
    local palette_count="${#PALETTE_ARRAY[@]}"

    if [ "$palette_count" -lt 2 ]; then
        printf '[create-widget] ERROR: --palette must contain at least 2 colors (got %s)\n' "$palette_count" >&2
        exit 1
    fi

    for color in "${PALETTE_ARRAY[@]}"; do
        # Strict validation: 6-digit hex only — ^#[0-9a-fA-F]{6}|0-9a-fA-F{3} not accepted; must be exactly 6
        if [[ ! "$color" =~ ^#[0-9a-fA-F]{6}$ ]]; then
            printf '[create-widget] ERROR: --palette entries must be 6-digit hex like #ef4444: got '"'"'%s'"'"'\n' "$color" >&2
            exit 1
        fi
    done

    TEMPLATE_ARGS[prompt]="$prompt"
    TEMPLATE_ARGS[palette]="$palette"
}

template_substitute() {
    local widget_html="$WIDGET_DIR/widget.html"

    # Apply four substitutions via python3 for correct encoding:
    #   __PROMPT_JSON__  → JSON-encoded prompt string or null (safe for inline JS)
    #   __PALETTE_JSON__ → JSON array of hex color strings
    #   __WIDGET_ID__    → widget slug (plain string)
    #   __PANE_BASE__    → widget pane URL path (plain string)
    python3 - "$widget_html" "$SLUG" "${TEMPLATE_ARGS[prompt]}" "${TEMPLATE_ARGS[palette]}" "$PANE_BASE" <<'PYEOF'
import sys, pathlib, json

html_path = pathlib.Path(sys.argv[1])
slug      = sys.argv[2]
prompt    = sys.argv[3]
palette_s = sys.argv[4]
pane_base = sys.argv[5]

palette = [c for c in palette_s.split(",") if c]

html = html_path.read_text()

# Substitute __PROMPT_JSON__ with the JSON-encoded string or null
html = html.replace("__PROMPT_JSON__", json.dumps(prompt) if prompt else "null")
# Substitute __PALETTE_JSON__ with the JSON array of hex colors
html = html.replace("__PALETTE_JSON__", json.dumps(palette))
# Substitute __WIDGET_ID__ with the slug
html = html.replace("__WIDGET_ID__", slug)
# Substitute __PANE_BASE__ with the widget's pane base path
html = html.replace("__PANE_BASE__", pane_base)

html_path.write_text(html)
PYEOF

    # Produce TEMPLATE_CONFIG_JSON via python3 for correct escaping
    TEMPLATE_CONFIG_JSON=$(python3 - "${TEMPLATE_ARGS[prompt]}" "${TEMPLATE_ARGS[palette]}" <<'PYEOF'
import sys, json

prompt    = sys.argv[1]
palette_s = sys.argv[2]
palette   = [c for c in palette_s.split(",") if c]

config = {"palette": palette, "mode": "non-terminal"}
if prompt:
    config["prompt"] = prompt

print(json.dumps(config), end="")
PYEOF
)
    export TEMPLATE_CONFIG_JSON
}
