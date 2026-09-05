#!/usr/bin/env python3
"""
Render the WipBubble voxel-cube animation as an animated WebP.

Ports the exact math from src/ui/features/pretty-view/WipBubble.tsx.
Only diff from iter-7: ROT_X_RATE 0.7 -> 0.75, PULSE_RATE 5.5 -> 6.0
(variant B — Ashley greenlit 2026-09-05). Yields a seamless loop at
T = 2π seconds because all three cycles complete integer revolutions.

Alpha compositing done via per-dot Image.alpha_composite so overlapping
translucent dots accumulate correctly (Pillow's ImageDraw would otherwise
overwrite instead of blending).
"""

import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw

# --- constants (variant B) ---
SCALE = 1.5
CANVAS_PX = 52
SPACING = 5.5 * SCALE            # 8.25
ROT_Y_RATE = 1.0
ROT_X_RATE = 0.75                # was 0.7 in iter-7
PULSE_RATE = 6.0                 # was 5.5 in iter-7
PULSE_DELAY = 1.2
MAX_D = SPACING * 1.8

# --- render params ---
DPR = 2                          # target retina-native raster
SS  = 2                          # supersample factor for AA
INTERNAL = CANVAS_PX * DPR * SS  # 208
OUTPUT   = CANVAS_PX * DPR       # 104
SCALE_INTERNAL = DPR * SS
HALF_INTERNAL = INTERNAL / 2

# --- voxel grid ---
VOXELS = [(x - 1.5, y - 1.5, z - 1.5)
          for x in range(4) for y in range(4) for z in range(4)]
VOXEL_DIST = [math.sqrt(v[0]**2 + v[1]**2 + v[2]**2) for v in VOXELS]


def rot3d(x, y, z, ay, ax):
    cy = math.cos(ay); sy = math.sin(ay)
    x1 = x * cy + z * sy
    z1 = -x * sy + z * cy
    cx = math.cos(ax); sx = math.sin(ax)
    y2 = y * cx - z1 * sx
    z2 = y * sx + z1 * cx
    return x1, y2, z2


def render_frame(t: float) -> Image.Image:
    img = Image.new("RGBA", (INTERNAL, INTERNAL), (0, 0, 0, 0))
    gy = t * ROT_Y_RATE
    gx = t * ROT_X_RATE

    items = []
    for i, v in enumerate(VOXELS):
        p = rot3d(v[0] * SPACING, v[1] * SPACING, v[2] * SPACING, gy, gx)
        depth_raw = (p[2] + MAX_D) / (2 * MAX_D)
        depth = max(0.0, min(1.0, depth_raw))
        pulse = 0.5 + 0.5 * math.sin(t * PULSE_RATE - VOXEL_DIST[i] * PULSE_DELAY)
        alpha = (0.3 + depth * 0.5) * (0.6 + pulse * 0.4)
        size  = (0.8 + depth * 0.8 + pulse * 0.2) * SCALE
        items.append((p[2], p[0], p[1], alpha, size))

    items.sort(key=lambda it: it[0])  # back-to-front

    for _z, x, y, alpha, size in items:
        px = HALF_INTERNAL + x * SCALE_INTERNAL
        py = HALF_INTERNAL + y * SCALE_INTERNAL
        pr = max(0.0, size) * SCALE_INTERNAL
        a = int(round(alpha * 255))
        if a <= 0 or pr <= 0:
            continue

        pad = 2
        sz = int(math.ceil(2 * pr)) + pad * 2
        dot = Image.new("RGBA", (sz, sz), (0, 0, 0, 0))
        d = ImageDraw.Draw(dot)
        c = sz / 2
        d.ellipse((c - pr, c - pr, c + pr, c + pr), fill=(200, 230, 255, a))

        paste_x = int(round(px - sz / 2))
        paste_y = int(round(py - sz / 2))
        img.alpha_composite(dot, dest=(paste_x, paste_y))

    return img.resize((OUTPUT, OUTPUT), Image.LANCZOS)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("wip-cube.webp")
    N = 180                          # 30fps effective at 35ms/frame
    T = 2 * math.pi                  # 6.283185... — one Y revolution
    per_frame_ms = 35                # 180 * 35 = 6300ms (+0.27% vs exact T — imperceptible)

    print(f"Rendering {N} frames (T={T:.4f}s, {per_frame_ms}ms/frame → total {N*per_frame_ms}ms)")
    frames = []
    for i in range(N):
        t = (i / N) * T
        frames.append(render_frame(t))
        if (i + 1) % 30 == 0:
            print(f"  {i+1}/{N}")

    print(f"Encoding animated WebP → {out}")
    frames[0].save(
        out,
        format="WEBP",
        save_all=True,
        append_images=frames[1:],
        duration=per_frame_ms,
        loop=0,
        lossless=False,
        quality=90,
        method=6,
    )
    size = out.stat().st_size
    print(f"Done. {size:,} bytes ({size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
