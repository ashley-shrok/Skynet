#!/usr/bin/env python3
# Regenerate every Skynet public/ icon asset (+ src/ui/assets/skynet-logo.svg)
# from the source files in scripts/brand-source/. Run any time the brand mark
# changes so all favicon / apple-touch-icon / PWA / Electron icon variants stay
# in sync from a single source.
#
# Requirements: Pillow (`pip install pillow`).
# Usage: run from repo root — `python3 scripts/regen-brand-icons.py`.
from PIL import Image
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SRC = REPO / "scripts" / "brand-source"
LOGO = Image.open(SRC / "logo-v2.png").convert("RGBA")          # 600x600 transparent
WORDMARK = Image.open(SRC / "skynet-wordmark.png").convert("RGBA")  # 1271x143 transparent
SVG_SRC = SRC / "logo-v2.svg"

PUBLIC = REPO / "public"

# Skynet base color (theme_color, --color-pv-base-end).
DARK = (0x0a, 0x0b, 0x12, 255)


def resize_transparent(size):
    return LOGO.resize((size, size), Image.LANCZOS)


def resize_on_dark(size, pad_frac=0.08):
    # Composite logo (scaled to (1 - 2*pad_frac) of size) onto solid dark bg.
    # Padding keeps the triangle away from the iOS mask's rounded-corner clip.
    bg = Image.new("RGBA", (size, size), DARK)
    inner = max(1, int(size * (1 - 2 * pad_frac)))
    logo_scaled = LOGO.resize((inner, inner), Image.LANCZOS)
    offset = ((size - inner) // 2, (size - inner) // 2)
    bg.alpha_composite(logo_scaled, dest=offset)
    return bg


# Transparent variants: favicon (browser paints bg), PWA manifest icons
# (Android uses manifest.background_color), Electron.
TRANSPARENT_SIZES = {
    "favicon-16.png": 16,
    "favicon-32.png": 32,
    "apple-touch-icon-192.png": 192,
    "apple-touch-icon-512.png": 512,
    "icon.png": 600,
    "icon-mac.png": 600,
    "full-icon.png": 600,
}

# iOS apple-touch-icon variants: iOS paints WHITE behind transparent PNGs
# (and masks to a rounded square), so bake the Skynet dark base into the
# background here so it composites cleanly against the app theme.
DARK_BG_SIZES = {
    "apple-touch-icon-60.png": 60,
    "apple-touch-icon-76.png": 76,
    "apple-touch-icon-120.png": 120,
    "apple-touch-icon-152.png": 152,
    "apple-touch-icon-180.png": 180,
}

for name, size in TRANSPARENT_SIZES.items():
    resize_transparent(size).save(PUBLIC / name, "PNG", optimize=True)
    print(f"wrote public/{name} ({size}x{size}, transparent)")

for name, size in DARK_BG_SIZES.items():
    resize_on_dark(size).save(PUBLIC / name, "PNG", optimize=True)
    print(f"wrote public/{name} ({size}x{size}, dark bg)")

# Multi-size ICO for browser-tab favicon fallback.
ico_sizes = [(16, 16), (32, 32), (48, 48)]
ico_frames = [resize_transparent(s[0]) for s in ico_sizes]
ico_frames[0].save(PUBLIC / "favicon.ico", format="ICO", sizes=ico_sizes)
print("wrote public/favicon.ico (16 + 32 + 48 transparent)")

# Copy the vector SVG into public/ (browser-fetchable fallback). Note: the
# panel-header inline SVG lives in a hand-transcribed React component at
# src/ui/features/pretty-conversations/SkynetLogo.tsx — if you edit the source
# SVG's shape, update SkynetLogo.tsx to match.
(PUBLIC / "icon.svg").write_bytes(SVG_SRC.read_bytes())
print("wrote public/icon.svg")

# Wordmark for the panel-header lockup.
WORDMARK.save(PUBLIC / "skynet-wordmark.png", "PNG", optimize=True)
print(f"wrote public/skynet-wordmark.png ({WORDMARK.size[0]}x{WORDMARK.size[1]}, transparent)")

print("\nAll brand assets regenerated.")
