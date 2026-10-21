#!/usr/bin/env bash
# make-icon.sh — produce an app icon in the house style: one white, logo-like
# symbol centered on a flat, full-bleed palette color.
#
#   make-icon.sh colors <slug>
#       Print the palette and which colors the OTHER apps' icons already use.
#   make-icon.sh draft <slug> <color> "<symbol>"
#       Generate a draft. <color> is a palette name or a #RRGGBB hex;
#       <symbol> is a few words naming the thing to draw ("a shopping basket").
#       Prints the draft path and a preview path — look at the preview.
#   make-icon.sh accept <slug>
#       Install the latest draft as ~/fleet/apps/<slug>/icon.webp, link it as
#       the favicon, rebuild and restart the app.
#
# Only the symbol comes from the image generator (white on black). Turning it
# into a mask, sizing, centering and the background color are done here, so
# every icon comes out with the same proportions and an exact color whatever
# the generator returns.

set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

log() { printf '[make-icon] %s\n' "$*"; }
die() { printf '[make-icon] ERROR: %s\n' "$*" >&2; exit 1; }

APPS_DIR="$HOME/fleet/apps"
DRAFTS_ROOT="$HOME/fleet/image-gen-outputs/app-icons"

# Icon geometry: 512px canvas, symbol fit inside a 300px box (~58%).
CANVAS=512
SYMBOL_BOX=300

# The palette — order is display order only.
PALETTE_NAMES=(red orange gold green teal blue indigo purple magenta pink brown slate)
declare -A PALETTE=(
    [red]='#E03E3E'     [orange]='#F06A1D' [gold]='#D99A1E'   [green]='#2F9E44'
    [teal]='#0C8599'    [blue]='#1C7ED6'   [indigo]='#4C5FD5' [purple]='#7048E8'
    [magenta]='#AE3EC9' [pink]='#D6336C'   [brown]='#8D5A3B'  [slate]='#495057'
)

command -v convert >/dev/null || die "ImageMagick 'convert' is not on PATH"

usage() {
    die "usage: make-icon.sh colors <slug> | draft <slug> <color> \"<symbol>\" | accept <slug>"
}

check_slug() {
    [[ "$1" =~ ^[a-z][a-z0-9-]*$ ]] || die "bad slug: '$1'"
}

# Palette name for an icon file's background, or nothing if it isn't one of
# ours. Samples a pixel just inside the top-left corner (always background in
# the house style) and matches the nearest palette color within a tolerance
# that absorbs WebP compression.
icon_palette_color() {
    local rgb r g b best="" bestd=999999 name hex hr hg hb d
    # A see-through corner means an older icon with no background color.
    [ "$(convert "$1" -format '%[fx:p{6,6}.a>0.9]' info: 2>/dev/null)" = 1 ] || return 0
    rgb=$(convert "$1" -alpha off -format '%[fx:int(255*p{6,6}.r)] %[fx:int(255*p{6,6}.g)] %[fx:int(255*p{6,6}.b)]' info: 2>/dev/null) || return 0
    read -r r g b <<<"$rgb"
    for name in "${PALETTE_NAMES[@]}"; do
        hex=${PALETTE[$name]#\#}
        hr=$((16#${hex:0:2})); hg=$((16#${hex:2:2})); hb=$((16#${hex:4:2}))
        d=$(( (r-hr)*(r-hr) + (g-hg)*(g-hg) + (b-hb)*(b-hb) ))
        if [ "$d" -lt "$bestd" ]; then bestd=$d; best=$name; fi
    done
    # 30 per channel, squared and summed.
    [ "$bestd" -le 2700 ] && printf '%s' "$best"
    return 0
}

cmd_colors() {
    local slug="$1" name dir other c own=""
    declare -A used=()
    [ -f "$APPS_DIR/$slug/icon.webp" ] && own=$(icon_palette_color "$APPS_DIR/$slug/icon.webp")
    for dir in "$APPS_DIR"/*/; do
        other=$(basename "$dir")
        [ "$other" = "$slug" ] && continue
        [ -f "$dir/icon.webp" ] || continue
        c=$(icon_palette_color "$dir/icon.webp")
        [ -n "$c" ] && used[$c]="${used[$c]:+${used[$c]}, }$other"
    done
    for name in "${PALETTE_NAMES[@]}"; do
        if [ "$name" = "$own" ]; then
            printf '%-8s %s  current color of this app%s\n' "$name" "${PALETTE[$name]}" "${used[$name]:+ (also: ${used[$name]})}"
        elif [ -n "${used[$name]:-}" ]; then
            printf '%-8s %s  used by: %s\n' "$name" "${PALETTE[$name]}" "${used[$name]}"
        else
            printf '%-8s %s  free\n' "$name" "${PALETTE[$name]}"
        fi
    done
}

cmd_draft() {
    local slug="$1" color="$2" symbol="$3" hex dir raw mask draft preview corner
    if [[ "$color" =~ ^#[0-9A-Fa-f]{6}$ ]]; then
        hex="$color"
    elif [ -n "${PALETTE[$color]:-}" ]; then
        hex="${PALETTE[$color]}"
    else
        die "unknown color '$color' — use a palette name (${PALETTE_NAMES[*]}) or #RRGGBB"
    fi
    [ -n "$symbol" ] || die "symbol description is empty"

    dir="$DRAFTS_ROOT/$slug"
    mkdir -p "$dir"
    raw="$dir/symbol.png"
    mask="$dir/mask.png"
    draft="$dir/draft.webp"
    preview="$dir/preview.png"
    rm -f "$raw" "$mask" "$draft" "$preview"

    log "generating symbol: $symbol"
    image-gen "a single bold, simple, pure white symbol of ${symbol}, drawn as a flat icon-font glyph, logo-like, centered, on a pure black background. Thick, clean shapes that stay readable when tiny; a flat white silhouette with any interior detail cut out in black. No text, no letters, no other colors, no gradient, no shading, no glow, no border, no frame, only one object." \
        --size 1024x1024 --quality high --out "$raw" >/dev/null \
        || die "image-gen failed (see its error above)"

    # A clean symbol is near-pure white on near-pure black; grey only on its
    # anti-aliased edges. Lots of grey means a glow, haze or shading the
    # generator added anyway, which can't be cleanly cut out.
    if [ "$(convert "$raw" -alpha off -colorspace gray -fx '(u>0.15&&u<0.85)?1:0' -format '%[fx:mean>0.03]' info:)" = 1 ]; then
        die "the generated symbol has a glow or shading — draft again (this counts as one of the tries)"
    fi

    # Luminance → mask. If the generator inverted the request (dark symbol on
    # a light background), flip it so the symbol is always the opaque part.
    corner=$(convert "$raw" -alpha off -colorspace gray -format '%[fx:p{4,4}.r>0.5]' info:) \
        || die "the generated image could not be read — draft again"
    convert "$raw" -alpha off -colorspace gray $([ "$corner" = 1 ] && echo -negate) \
        -level 15%,90% -trim +repage \
        -resize "${SYMBOL_BOX}x${SYMBOL_BOX}" "$mask"
    if [ "$(convert "$mask" -format '%[fx:mean>0.02]' info:)" != 1 ]; then
        die "the generated image has no visible symbol — draft again with a reworded symbol"
    fi

    convert -size "${CANVAS}x${CANVAS}" "xc:$hex" \
        \( "$mask" -background white -alpha shape \) \
        -gravity center -compose over -composite \
        -quality 92 "$draft"

    # Preview: the icon large, then at sidebar size with the sidebar's
    # rounded corners on its dark background.
    convert -size 96x96 xc:none -fill white -draw "roundrectangle 0,0,95,95,22,22" "$dir/corners.png"
    convert "$draft" -resize 96x96 "$dir/corners.png" -alpha off -compose CopyOpacity -composite "$dir/small.png"
    convert "$dir/small.png" -resize 48x48 "$dir/tiny.png"
    convert -size 400x300 'xc:#1a1d24' \
        \( "$draft" -resize 256x256 \) -geometry +16+22 -compose over -composite \
        "$dir/small.png" -geometry +288+60 -compose over -composite \
        "$dir/tiny.png" -geometry +312+190 -compose over -composite \
        "$preview"
    rm -f "$dir/corners.png" "$dir/small.png" "$dir/tiny.png"

    printf 'draft:   %s\n' "$draft"
    printf 'preview: %s\n' "$preview"
}

cmd_accept() {
    local slug="$1" app="$APPS_DIR/$1" draft="$DRAFTS_ROOT/$1/draft.webp"
    [ -d "$app" ] || die "no app at $app"
    [ -f "$draft" ] || die "no draft for '$slug' — run: make-icon.sh draft $slug <color> \"<symbol>\""
    rm -f "$app/icon.webp"
    cp "$draft" "$app/icon.webp"
    rm -f "$draft"
    mkdir -p "$app/static"
    ln -sfn ../icon.webp "$app/static/icon.webp"
    log "installed $app/icon.webp"
    if [ -f "$app/package.json" ]; then
        (cd "$app" && bun run build >/dev/null) || die "build failed — run 'bun run build' in $app to see why"
        log "rebuilt"
    fi
    if systemctl --user is-active --quiet "app-$slug"; then
        systemctl --user restart "app-$slug" || die "app-$slug failed to restart"
        log "restarted app-$slug"
    else
        log "app-$slug isn't running — left stopped; the tab icon updates on its next start"
    fi
}

[ $# -ge 1 ] || usage
case "$1" in
    colors) [ $# -eq 2 ] || usage; check_slug "$2"; cmd_colors "$2" ;;
    draft)  [ $# -eq 4 ] || usage; check_slug "$2"; cmd_draft "$2" "$3" "$4" ;;
    accept) [ $# -eq 2 ] || usage; check_slug "$2"; cmd_accept "$2" ;;
    *) usage ;;
esac
