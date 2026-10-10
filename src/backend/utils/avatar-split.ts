/**
 * Split avatar for multi-role identities.
 *
 * An identity holding several roles inherits no single role's avatar (it
 * would misstate what the identity is), so when it has no avatar of its own
 * GET /identities/:key/avatar serves this composite instead: one slice per
 * role, in frontmatter order, each role's avatar shifted into its slice so the
 * face sits inside it, with gold dividers (multi-role identities are gold
 * everywhere else in the app).
 *
 *   - 2 roles: diagonal cut top-right → bottom-left; first role upper-left.
 *   - 3+ roles: pie slices, first cut at 12 o'clock, clockwise.
 *   - A role with no avatar gets a flat hue-from-name slice with its initial.
 *
 * Output is a square image; the frontend rounds it with border-radius, so the
 * slices extend past the inscribed circle to fill the corners.
 */
import sharp from "sharp";

export const SPLIT_AVATAR_PX = 256;
const DIVIDER_PX = 5;
const DIVIDER_COLOR = "hsl(45, 85%, 60%)";
const MAX_INPUT_PIXELS = 4096 * 4096;

export interface SplitAvatarPart {
  role: string;
  image: { bytes: Buffer; mime: string } | null;
}

/** Angle (radians, canvas convention: 0 = 3 o'clock, clockwise) of the first cut. */
export function splitStartAngle(n: number): number {
  return n === 2 ? (3 * Math.PI) / 4 : -Math.PI / 2;
}

/** Deterministic hue for a role without an avatar. */
export function hueForRole(role: string): number {
  let h = 7;
  for (const ch of role) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function wedgePath(size: number, a0: number, a1: number): string {
  // Radius well past the corners so the slice fills the square, not just the
  // inscribed circle. Polygon points sampled along the arc keep it exact for
  // any slice width without SVG arc-flag bookkeeping.
  const c = size / 2;
  const r = size * 1.5;
  const steps = Math.max(2, Math.ceil(((a1 - a0) / (2 * Math.PI)) * 32));
  const pts = [`${c},${c}`];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    pts.push(`${(c + Math.cos(a) * r).toFixed(2)},${(c + Math.sin(a) * r).toFixed(2)}`);
  }
  return pts.join(" ");
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

async function renderSliceSource(
  part: SplitAvatarPart,
  size: number,
  dx: number,
  dy: number,
  fontPx: number,
): Promise<Buffer> {
  if (part.image) {
    try {
      const pad = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)));
      // Two passes: sharp runs extend AFTER extract within one pipeline
      // regardless of call order, so the shift needs the padded image first.
      const padded = await sharp(part.image.bytes, { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize(size, size, { fit: "cover" })
        .ensureAlpha()
        .extend({
          top: pad,
          bottom: pad,
          left: pad,
          right: pad,
          // Repeat edge pixels so the shift never exposes a transparent
          // notch at the slice's outer rim.
          extendWith: "copy",
        })
        .png()
        .toBuffer();
      return await sharp(padded)
        .extract({
          left: Math.round(pad - dx),
          top: Math.round(pad - dy),
          width: size,
          height: size,
        })
        .png()
        .toBuffer();
    } catch {
      // Undecodable role avatar → fall through to the placeholder.
    }
  }
  const hue = hueForRole(part.role);
  const initial = escapeXml((part.role[0] ?? "?").toUpperCase());
  const cx = size / 2 + dx;
  const cy = size / 2 + dy;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
    `<rect width="100%" height="100%" fill="hsl(${hue}, 45%, 38%)"/>` +
    `<text x="${cx}" y="${cy}" font-family="sans-serif" font-weight="600" font-size="${fontPx}" ` +
    `fill="rgba(255,255,255,0.92)" text-anchor="middle" dominant-baseline="central">${initial}</text>` +
    `</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/**
 * Compose the split avatar. `parts` must hold at least two entries; the caller
 * only reaches here for multi-role identities.
 */
export async function composeSplitAvatar(
  parts: SplitAvatarPart[],
  size: number = SPLIT_AVATAR_PX,
): Promise<{ bytes: Buffer; mime: string }> {
  const n = parts.length;
  if (n < 2) throw new Error("composeSplitAvatar needs at least two parts");
  const c = size / 2;
  const start = splitStartAngle(n);
  const step = (2 * Math.PI) / n;
  const shift = c * (n === 2 ? 0.5 : 0.42);
  const fontPx = Math.round(size * (n === 2 ? 0.35 : 0.27));

  const layers: sharp.OverlayOptions[] = [];
  for (let i = 0; i < n; i++) {
    const a0 = start + i * step;
    const a1 = a0 + step;
    const mid = (a0 + a1) / 2;
    const dx = Math.cos(mid) * shift;
    const dy = Math.sin(mid) * shift;
    const src = await renderSliceSource(parts[i], size, dx, dy, fontPx);
    const mask = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
        `<polygon points="${wedgePath(size, a0, a1)}" fill="#fff"/></svg>`,
    );
    const slice = await sharp(src)
      .ensureAlpha()
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
    layers.push({ input: slice, left: 0, top: 0 });
  }

  const lines: string[] = [];
  for (let i = 0; i < n; i++) {
    const a = start + i * step;
    // 2 slices: the two cuts are collinear, drawn as one line through center.
    const x2 = c + Math.cos(a) * size;
    const y2 = c + Math.sin(a) * size;
    lines.push(
      `<line x1="${c}" y1="${c}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" ` +
        `stroke="${DIVIDER_COLOR}" stroke-width="${DIVIDER_PX}" stroke-linecap="round"/>`,
    );
  }
  layers.push({
    input: Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${lines.join("")}</svg>`,
    ),
    left: 0,
    top: 0,
  });

  const bytes = await sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite(layers)
    .webp({ quality: 85 })
    .toBuffer();
  return { bytes, mime: "image/webp" };
}
