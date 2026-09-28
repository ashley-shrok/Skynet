#!/usr/bin/env bash
# args.sh — hook file for the form-terminal-on-submit template
#
# This file is sourced by create-widget.sh's dispatcher for the form template.
# Do not execute this file directly.
#
# Contract: template_parse_args + template_substitute + TEMPLATE_ARGS + TEMPLATE_CONFIG_JSON
#
# template_parse_args "$@"
#   Accepts remaining argv after the dispatcher's global-arg parse.
#   Populates: TEMPLATE_ARGS[prompt], TEMPLATE_ARGS[submit_label]
#              TEMPLATE_FIELDS_LIST (indexed array of JSON-encoded field descriptors)
#   Dies on invalid input.
#
# template_substitute
#   Given: $WIDGET_DIR (widget files already copied in),
#          $TEMPLATE_ARGS[...], $TEMPLATE_FIELDS_LIST, $PANE_BASE, $SLUG
#   Side-effects: writes substituted widget.html in place
#   Exports: TEMPLATE_CONFIG_JSON (a JSON object literal string that becomes
#            the "config" field in metadata.json)

# Template args storage — populated by template_parse_args
declare -gA TEMPLATE_ARGS

# Ordered list of JSON-encoded field descriptors, one per --field flag.
declare -ga TEMPLATE_FIELDS_LIST=()

template_parse_args() {
    local prompt="" submit_label="Submit"

    while [ $# -gt 0 ]; do
        case "$1" in
            --prompt)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--prompt requires a value" >&2; exit 1; }
                prompt="$2"; shift 2 ;;
            --field)
                [ $# -ge 2 ] || { printf '[create-widget] ERROR: %s\n' "--field requires a value" >&2; exit 1; }
                local spec="$2"; shift 2

                # Split spec on ':' (max 3 parts: name, type, options)
                local name type opts_raw
                name=""
                type=""
                opts_raw=""

                # Use parameter expansion to extract parts safely
                # Part 1: everything before first ':'
                name="${spec%%:*}"
                local rest="${spec#*:}"

                # If no ':' was found, rest == spec (no colon at all)
                if [ "$rest" = "$spec" ]; then
                    printf '[create-widget] ERROR: --field spec must be name:type[:options], got '"'"'%s'"'"'\n' "$spec" >&2
                    exit 1
                fi

                # Part 2: type — everything before next ':' in rest
                type="${rest%%:*}"
                local rest2="${rest#*:}"

                # If rest2 == rest, there was no second colon (no options part)
                if [ "$rest2" = "$rest" ]; then
                    opts_raw=""
                else
                    opts_raw="$rest2"
                fi

                # Validate field name: must match ^[a-z_][a-z0-9_]*$ and length <= 40
                if ! printf '%s' "$name" | grep -qE '^[a-z_][a-z0-9_]*$'; then
                    printf '[create-widget] ERROR: --field name must be lowercase snake_case: got '"'"'%s'"'"'\n' "$name" >&2
                    exit 1
                fi
                if [ "${#name}" -gt 40 ]; then
                    printf '[create-widget] ERROR: --field name too long (max 40): '"'"'%s'"'"'\n' "$name" >&2
                    exit 1
                fi

                # Validate field type: must be text, number, or select
                case "$type" in
                    text|number|select) ;;
                    *)
                        printf '[create-widget] ERROR: --field type must be one of text|number|select: got '"'"'%s'"'"'\n' "$type" >&2
                        exit 1 ;;
                esac

                # Type-specific options validation
                if [ "$type" = "select" ]; then
                    # select requires a non-empty options string with >= 2 items
                    if [ -z "$opts_raw" ]; then
                        printf '[create-widget] ERROR: --field select requires >=2 comma-separated options: got '"'"'%s'"'"'\n' "$spec" >&2
                        exit 1
                    fi
                    # Count comma-separated items
                    local opt_count
                    opt_count=$(printf '%s' "$opts_raw" | tr ',' '\n' | grep -c .)
                    if [ "$opt_count" -lt 2 ]; then
                        printf '[create-widget] ERROR: --field select requires >=2 comma-separated options: got '"'"'%s'"'"'\n' "$spec" >&2
                        exit 1
                    fi
                    # Produce JSON-encoded field descriptor with options array via python3
                    local field_json
                    field_json=$(python3 -c "
import json, sys
name = sys.argv[1]
opts_raw = sys.argv[2]
options = [o for o in opts_raw.split(',') if o]
print(json.dumps({'name': name, 'type': 'select', 'options': options}), end='')
" "$name" "$opts_raw")
                    TEMPLATE_FIELDS_LIST+=("$field_json")
                else
                    # text or number: third part must be absent
                    if [ -n "$opts_raw" ]; then
                        printf '[create-widget] ERROR: --field type '"'"'%s'"'"' does not accept options: '"'"'%s'"'"'\n' "$type" "$spec" >&2
                        exit 1
                    fi
                    # Produce JSON-encoded field descriptor (no options) via python3
                    local field_json
                    field_json=$(python3 -c "
import json, sys
name = sys.argv[1]
ftype = sys.argv[2]
print(json.dumps({'name': name, 'type': ftype}), end='')
" "$name" "$type")
                    TEMPLATE_FIELDS_LIST+=("$field_json")
                fi
                ;;
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

    # At least one --field is required
    if [ "${#TEMPLATE_FIELDS_LIST[@]}" -eq 0 ]; then
        printf '[create-widget] ERROR: at least one --field is required\n' >&2
        exit 1
    fi

    TEMPLATE_ARGS[prompt]="$prompt"
    TEMPLATE_ARGS[submit_label]="$submit_label"
}

template_substitute() {
    local widget_html="$WIDGET_DIR/widget.html"

    # Build a single JSON array of field descriptors from TEMPLATE_FIELDS_LIST via python3.
    # Each element of TEMPLATE_FIELDS_LIST is already a JSON object string.
    local fields_json
    fields_json=$(python3 - "${TEMPLATE_FIELDS_LIST[@]}" <<'PYEOF'
import json, sys

# Each argv[1..] is a JSON-encoded field descriptor object
field_items = [json.loads(a) for a in sys.argv[1:]]
print(json.dumps(field_items), end="")
PYEOF
)

    # Apply substitutions via python3 for correct encoding:
    #   __PROMPT_JSON__       → JSON-encoded prompt string (safe for inline JS)
    #   __FIELDS_JSON__       → JSON array of field descriptors
    #   __WIDGET_ID__         → widget slug (plain string)
    #   __PANE_BASE__         → widget pane URL path (plain string)
    #   __SUBMIT_LABEL_JSON__ → JSON-encoded submit button label
    python3 - "$widget_html" "$SLUG" "${TEMPLATE_ARGS[prompt]}" "$fields_json" "$PANE_BASE" "${TEMPLATE_ARGS[submit_label]}" <<'PYEOF'
import sys, pathlib, json

html_path    = pathlib.Path(sys.argv[1])
slug         = sys.argv[2]
prompt       = sys.argv[3]
fields_json  = sys.argv[4]
pane_base    = sys.argv[5]
submit_label = sys.argv[6]

html = html_path.read_text()

# Substitute __PROMPT_JSON__ with the JSON-encoded prompt string
html = html.replace("__PROMPT_JSON__", json.dumps(prompt))
# Substitute __FIELDS_JSON__ with the JSON array of field descriptors
html = html.replace("__FIELDS_JSON__", fields_json)
# Substitute __WIDGET_ID__ with the slug
html = html.replace("__WIDGET_ID__", slug)
# Substitute __PANE_BASE__ with the widget's pane base path
html = html.replace("__PANE_BASE__", pane_base)
# Substitute __SUBMIT_LABEL_JSON__ with the JSON-encoded submit label
html = html.replace("__SUBMIT_LABEL_JSON__", json.dumps(submit_label))

html_path.write_text(html)
PYEOF

    # Produce TEMPLATE_CONFIG_JSON via python3 for correct escaping
    TEMPLATE_CONFIG_JSON=$(python3 - "${TEMPLATE_ARGS[prompt]}" "$fields_json" "${TEMPLATE_ARGS[submit_label]}" <<'PYEOF'
import sys, json

prompt       = sys.argv[1]
fields_json  = sys.argv[2]
submit_label = sys.argv[3]

fields = json.loads(fields_json)

print(json.dumps({"prompt": prompt, "fields": fields, "submit_label": submit_label}), end="")
PYEOF
)
    export TEMPLATE_CONFIG_JSON
}
