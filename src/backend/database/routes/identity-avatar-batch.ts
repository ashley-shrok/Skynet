/**
 * Phase 20 (IDUI-04): Identity avatar batch generation route.
 * Phase 74 Plan 03: config-driven aesthetic director spec + gamma.
 *
 * Mounts on /identities/avatar (in database.ts) and provides:
 *   POST /batch   — LLM archetype draft + 3 parallel gpt-image-1 calls
 *                   + gamma correction + in-memory candidate cache
 *   GET  /candidate/:id — serves cached candidate PNG bytes
 *
 * OpenAI API key: read from process.env.OPENAI_API_KEY at request time.
 * Missing key returns 503 (does not crash on boot).
 *
 * Candidate cache TTL: 10 minutes. Scoped by userId so User A's
 * candidates are not accessible to User B.
 *
 * Gamma correction: sharp().gamma(1/gamma), which applies
 * output = input^gamma per the operator's avatarGammaDefault (from
 * branding config). Verified: input value 128 (mid-grey) with the
 * shipped default gamma=0.7 maps to ≈157 post-correction.
 *
 * Aesthetic director system prompt: read at request time from
 * branding config's avatarDirectorSpec. The app owns zero aesthetic
 * content — a differently-branded instance produces entirely different
 * avatars purely by editing branding.json.
 *
 * TTL sweeper: runs every 60s, skipped when NODE_ENV === "test".
 */

import express from "express";
import type { Request, Response, NextFunction } from "express";
import multer from "multer";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { AuthManager } from "../../utils/auth-manager.js";
import { loadBrandingConfig } from "../../branding/branding-config-loader.js";
import type { AuthenticatedRequest } from "../../../types/index.js";

const router = express.Router();

// JSON body parser scoped to this router (no multer — incoming POST /batch
// is application/json, not multipart)
router.use(express.json());

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CANDIDATE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const ARCHETYPE_TIMEOUT_MS = 30_000; // 30s for chat/completions
const IMAGE_GEN_TIMEOUT_MS = 60_000; // 60s per image generation
const BATCH_SIZE = 3;

/** Absolute cap on total cache entries across all users. Prevents unbounded memory growth (CR-06). */
const GLOBAL_CACHE_MAX = 100;
/** Per-user cap on cache entries. Prevents a single user from monopolizing the global budget (CR-06). */
const PER_USER_CACHE_MAX = 15;

// ---------------------------------------------------------------------------
// In-memory candidate cache
// ---------------------------------------------------------------------------

interface CandidateEntry {
  userId: string;
  bytes: Buffer;
  createdAt: number;
  mime: string;
}

const candidateCache = new Map<string, CandidateEntry>();

// ---------------------------------------------------------------------------
// TTL sweeper — skipped in test environment so fake timers work cleanly
// ---------------------------------------------------------------------------

if (process.env.NODE_ENV !== "test") {
  setInterval(() => {
    const now = Date.now();
    for (const [id, entry] of candidateCache) {
      if (now - entry.createdAt > CANDIDATE_TTL_MS) {
        candidateCache.delete(id);
      }
    }
  }, 60_000);
}

// ---------------------------------------------------------------------------
// Cache eviction helper (CR-06)
// Called before every candidateCache.set() to enforce two-tier size caps.
// Uses Map insertion order (guaranteed by JS spec) as a proxy for age:
//   - Per-user eviction: iterate forward and pick the FIRST entry owned by userId
//   - Global eviction: delete candidateCache.keys().next().value (oldest global)
// ---------------------------------------------------------------------------

function evictIfNeeded(userId: string): void {
  // Per-user cap: evict oldest entry for this user if at limit
  let userCount = 0;
  let oldestUserKey: string | undefined;
  for (const [key, entry] of candidateCache) {
    if (entry.userId === userId) {
      userCount++;
      if (oldestUserKey === undefined) {
        oldestUserKey = key; // first encountered = oldest (insertion order)
      }
    }
  }
  if (userCount >= PER_USER_CACHE_MAX && oldestUserKey !== undefined) {
    console.warn(
      `[identity-avatar-batch] cache eviction: evicting ${oldestUserKey} to make room (per-user cap ${PER_USER_CACHE_MAX} reached for user ${userId})`,
    );
    candidateCache.delete(oldestUserKey);
  }

  // Global cap: evict oldest overall entry if at limit
  if (candidateCache.size >= GLOBAL_CACHE_MAX) {
    const oldestGlobalKey = candidateCache.keys().next().value as string | undefined;
    if (oldestGlobalKey !== undefined) {
      console.warn(
        `[identity-avatar-batch] cache eviction: evicting ${oldestGlobalKey} to make room (global cap ${GLOBAL_CACHE_MAX} reached)`,
      );
      candidateCache.delete(oldestGlobalKey);
    }
  }
}

// ---------------------------------------------------------------------------
// Gamma correction helper
// Applies operator-configured gamma per branding config's avatarGammaDefault:
//   output = input^gamma   (normalized: output_norm = input_norm^gamma)
//
// Sharp's .gamma(g) applies sRGB linearization (not a plain power curve),
// so we do raw pixel manipulation: decode PNG → iterate channels → apply
// Math.pow(v/255, gamma) * 255 → re-encode PNG. That reasoning is
// independent of the gamma value chosen.
//
// Verification with the shipped default (gamma=0.7): input 128 →
// (128/255)^0.7 * 255 ≈ 157 (rounds to 157). Alpha channels (channels===4)
// are left untouched.
// ---------------------------------------------------------------------------

async function applyGamma(pngBuffer: Buffer, gamma: number): Promise<Buffer> {
  const { data, info } = await sharp(pngBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  for (let i = 0; i < data.length; i++) {
    // Skip alpha channel (every 4th byte when RGBA)
    if (channels === 4 && (i + 1) % 4 === 0) continue;
    data[i] = Math.round(Math.pow(data[i] / 255, gamma) * 255);
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels },
  })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Palette-hue mechanics (Phase 74 Plan 03 split):
//   - hueName() is the mechanical HSL-degree → color-name mapping. App-owned
//     per 74-CONTEXT.md Philosophy ("The app owns mechanics.").
//   - paletteHueLine() emits ONLY the mechanical fact ("hue X° reads as Y")
//     when the identity has a chosen colorHue. It's appended to the user
//     message so the drafter knows which hue to center on.
//   - The AESTHETIC instruction language for how to use that hue (e.g. "±30
//     degrees", "don't default to blue/cyan just because the background reads
//     cyberpunk-adjacent") lives in the operator-authored avatarDirectorSpec
//     in branding.json — NOT in this file. Per 74-CONTEXT.md Philosophy
//     ("The config owns instructions.") and 74-CONTEXT.md D-06.
//   - hue===null → return "" so the drafter falls back to freewheel palette.
// ---------------------------------------------------------------------------

function hueName(hue: number): string {
  if (hue < 15) return "red";
  if (hue < 40) return "orange";
  if (hue < 70) return "yellow / amber";
  if (hue < 160) return "green";
  if (hue < 200) return "teal / cyan";
  if (hue < 250) return "blue";
  if (hue < 290) return "purple / violet";
  if (hue < 340) return "magenta / pink";
  return "red-pink";
}

function paletteHueLine(hue: number | null): string {
  if (hue === null) return "";
  return `\n\nIdentity color hue: ${hue}° (reads as ${hueName(hue)}).`;
}

// ---------------------------------------------------------------------------
// POST /batch
// ---------------------------------------------------------------------------

router.post(
  "/batch",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // Validate required inputs
    const { name, title, brief, colorHue } = req.body as Record<string, unknown>;
    if (
      typeof name !== "string" ||
      !name.trim() ||
      typeof title !== "string" ||
      !title.trim() ||
      typeof brief !== "string" ||
      !brief.trim()
    ) {
      res.status(400).json({ error: "name, title, and brief are required non-empty strings" });
      return;
    }
    // Optional colorHue: number in [0, 360) OR null (unset, LLM picks palette
    // freely). Any other type = 400. NaN/Infinity/out-of-range rejected too.
    let paletteHue: number | null = null;
    if (colorHue !== undefined && colorHue !== null) {
      if (
        typeof colorHue !== "number" ||
        !Number.isFinite(colorHue) ||
        colorHue < 0 ||
        colorHue >= 360
      ) {
        res
          .status(400)
          .json({ error: "colorHue must be a number in [0, 360) or null" });
        return;
      }
      paletteHue = colorHue;
    }

    // Read API key at request time — 503 if missing (no boot crash)
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "OpenAI not configured" });
      return;
    }

    // Phase 74 Plan 03: read branding-config for the aesthetic director spec
    // and gamma value. Fresh per-request read preserves the Phase 70 hot-swap
    // property. Request-time defense-in-depth per 74-RESEARCH.md § Pitfall 2:
    // even though Plan 02's boot gate catches missing spec at startup, an
    // operator runtime edit that introduces a shape violation silently reverts
    // to bundled defaults (empty spec). Guard here mirrors the OPENAI_API_KEY
    // 503 pattern above so the route either has a real spec or short-circuits
    // before ever calling OpenAI. NO fallback to a hardcoded constant — that
    // would defeat the whole point of moving the aesthetic into the config
    // (74-CONTEXT.md § "What would make it wrong" §5).
    const branding = await loadBrandingConfig();
    const directorSpec = (branding.avatarDirectorSpec ?? "").trim();
    if (directorSpec.length === 0) {
      res.status(503).json({ error: "avatar generation misconfigured" });
      return;
    }
    const gammaValue = branding.avatarGammaDefault;

    // ------------------------------------------------------------------
    // Step 1: LLM archetype draft (called ONCE per request)
    // ------------------------------------------------------------------
    let draftedPrompt: string;
    try {
      const archController = new AbortController();
      const archTimeout = setTimeout(() => archController.abort(), ARCHETYPE_TIMEOUT_MS);

      const archRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: directorSpec },
            {
              role: "user",
              content: `Name: ${name}\nTitle: ${title}\nBrief: ${brief}${paletteHueLine(paletteHue)}\n\nProduce the image-generation prompt only. No preamble. No explanation. Just the prompt.`,
            },
          ],
        }),
        signal: archController.signal,
      });

      clearTimeout(archTimeout);

      if (!archRes.ok) {
        res.status(502).json({ error: "avatar generation failed" });
        return;
      }

      const archData = (await archRes.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      draftedPrompt = archData.choices[0].message.content.trim();
    } catch (err) {
      const isAbort =
        err instanceof Error && err.name === "AbortError";
      if (isAbort) {
        res.status(502).json({ error: "avatar generation failed" });
      } else {
        res.status(502).json({ error: "avatar generation failed" });
      }
      return;
    }

    // ------------------------------------------------------------------
    // Step 2: 3 parallel gpt-image-1 calls with the drafted prompt
    // ------------------------------------------------------------------
    let b64Results: string[];
    try {
      const imageGenResults = await Promise.all(
        Array.from({ length: BATCH_SIZE }, async () => {
          const imgController = new AbortController();
          const imgTimeout = setTimeout(() => imgController.abort(), IMAGE_GEN_TIMEOUT_MS);

          const imgRes = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
              model: "gpt-image-1",
              prompt: draftedPrompt,
              n: 1,
              size: "1024x1024",
              quality: "high",
            }),
            signal: imgController.signal,
          });

          clearTimeout(imgTimeout);

          if (!imgRes.ok) {
            throw new Error(`image-gen non-2xx: ${imgRes.status}`);
          }

          const imgData = (await imgRes.json()) as { data: Array<{ b64_json: string }> };
          return imgData.data[0].b64_json;
        }),
      );
      b64Results = imageGenResults;
    } catch {
      res.status(502).json({ error: "avatar generation failed" });
      return;
    }

    // ------------------------------------------------------------------
    // Step 3: Apply operator-configured gamma to each image via sharp.
    // Phase 74 Plan 03: gamma value threaded from branding config's
    // avatarGammaDefault, not hardcoded 0.7. The shipped bundled default
    // still carries 0.7 for backwards compatibility with the pre-Phase-74
    // aesthetic; operators can override per-branding.
    // ------------------------------------------------------------------
    let gammaCorrected: Buffer[];
    try {
      gammaCorrected = await Promise.all(
        b64Results.map(async (b64) => {
          const pngBuffer = Buffer.from(b64, "base64");
          return applyGamma(pngBuffer, gammaValue);
        }),
      );
    } catch {
      res.status(502).json({ error: "avatar generation failed" });
      return;
    }

    // ------------------------------------------------------------------
    // Step 4: Store in candidate cache, generate IDs
    // CR-06: evictIfNeeded is called before each set to enforce global + per-user caps.
    // ------------------------------------------------------------------
    const candidates = gammaCorrected.map((bytes) => {
      const id = nanoid();
      evictIfNeeded(userId);
      candidateCache.set(id, {
        userId,
        bytes,
        createdAt: Date.now(),
        mime: "image/png",
      });
      return { id, url: `/identities/avatar/candidate/${id}` };
    });

    // ------------------------------------------------------------------
    // Step 5: Return candidate list
    // ------------------------------------------------------------------
    res.status(200).json({ candidates });
  },
);

// ---------------------------------------------------------------------------
// POST /candidate/manual
// Manual avatar upload — stores an uploaded image in the existing candidateCache
// and returns { id } so birth/clone endpoints remain UNCHANGED.
//
// Security:
//   T-QUICK-04: authenticateJWT wired BEFORE multer (body never parsed on 401)
//   T-QUICK-01: 5 MB fileSize cap
//   T-QUICK-02: fileFilter restricts to PNG/JPEG/WebP only
//   T-QUICK-05: evictIfNeeded enforces per-user + global cache caps
// ---------------------------------------------------------------------------

const ALLOWED_MANUAL_AVATAR_MIMES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

const manualUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MANUAL_AVATAR_MIMES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Avatar must be PNG, JPEG, or WebP"));
    }
  },
});

router.post(
  "/candidate/manual",
  authenticateJWT,
  manualUpload.single("avatar"),
  (req: Request, res: Response): void => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!req.file) {
      res.status(400).json({ error: "missing avatar field" });
      return;
    }

    const id = nanoid();
    evictIfNeeded(userId);
    candidateCache.set(id, {
      userId,
      bytes: req.file.buffer,
      createdAt: Date.now(),
      mime: req.file.mimetype,
    });

    res.status(200).json({ id });
  },
);

// Express error handler for /candidate/manual multer errors.
// Turns LIMIT_FILE_SIZE into 413, mime-rejection errors into 400,
// LIMIT_UNEXPECTED_FILE into 400 "missing avatar field".
// Placed after the route so it only catches errors from this router.
router.use(
  "/candidate/manual",
  (
    err: Error & { code?: string },
    _req: Request,
    res: Response,
    _next: NextFunction,
  ): void => {
    if (err?.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({ error: "file too large (max 5 MB)" });
      return;
    }
    if (err?.code === "LIMIT_UNEXPECTED_FILE") {
      res.status(400).json({ error: "missing avatar field" });
      return;
    }
    if (
      err instanceof Error &&
      err.message.includes("Avatar must be PNG, JPEG, or WebP")
    ) {
      res.status(400).json({ error: err.message });
      return;
    }
    res.status(500).json({ error: "upload failed" });
  },
);

// ---------------------------------------------------------------------------
// GET /candidate/:id
// ---------------------------------------------------------------------------

router.get(
  "/candidate/:id",
  authenticateJWT,
  (req: Request, res: Response): void => {
    const userId = (req as AuthenticatedRequest).userId;
    const id = String(req.params.id);

    const entry = candidateCache.get(id);

    if (!entry) {
      res.status(404).json({ error: "candidate expired" });
      return;
    }

    // TTL check
    if (Date.now() - entry.createdAt > CANDIDATE_TTL_MS) {
      candidateCache.delete(id);
      res.status(404).json({ error: "candidate expired" });
      return;
    }

    // Scope guard — only the requesting user can access their candidates
    if (entry.userId !== userId) {
      res.status(404).json({ error: "candidate expired" });
      return;
    }

    res.setHeader("Content-Type", entry.mime);
    res.send(entry.bytes);
  },
);

// ---------------------------------------------------------------------------
// Phase 20 (IDUI-06): Birth helpers — used by identity-birth.ts orchestrator wiring.
// These are production exports (not test-only).
// ---------------------------------------------------------------------------

/**
 * Fetch avatar candidate bytes for birth flow.
 *
 * Returns null when:
 *   - id not found in cache
 *   - TTL exceeded
 *   - userId does not match the candidate's owner (cross-user guard)
 *
 * Does NOT delete the entry — call consumeCandidateForBirth() after
 * successful use to prevent re-use (accidental double-clicks).
 */
export function getCandidateForBirth(
  userId: string,
  id: string,
): { bytes: Buffer; mime: string } | null {
  const entry = candidateCache.get(id);
  if (!entry) return null;

  // TTL check
  if (Date.now() - entry.createdAt > CANDIDATE_TTL_MS) {
    candidateCache.delete(id);
    return null;
  }

  // userId scope guard (mirrors GET /candidate/:id pattern)
  // Patch #316: userId is a STRING (users.id is text() in schema, not integer)
  // — direct compare, no String() coercion. Previous `number` typing produced
  // NaN via parseInt upstream and blocked every birth attempt at step 1.
  if (entry.userId !== userId) return null;

  return { bytes: entry.bytes, mime: entry.mime };
}

/**
 * Delete an avatar candidate from the cache after successful pickup.
 * Prevents re-use for accidental double-clicks.
 * Safe to call even if the entry has already expired — it's a no-op.
 */
export function consumeCandidateForBirth(userId: string, id: string): void {
  const entry = candidateCache.get(id);
  if (entry && entry.userId === userId) {
    candidateCache.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Test helpers (only exported in test environment)
// ---------------------------------------------------------------------------

export function _getCandidateCacheForTest(): Map<string, CandidateEntry> | undefined {
  if (process.env.NODE_ENV === "test") return candidateCache;
  return undefined;
}

export function _clearCandidateCacheForTest(): void {
  if (process.env.NODE_ENV === "test") {
    candidateCache.clear();
  }
}

export function _evictIfNeededForTest(userId: string): void {
  if (process.env.NODE_ENV === "test") {
    evictIfNeeded(userId);
  }
}

/**
 * Gamma spot-check helper for Test 4 + Phase 74 Plan 03 Test 11.
 * Applies the same gamma pipeline to a single 8-bit channel value and
 * returns the result as an 8-bit integer. The gamma parameter defaults
 * to 0.7 to preserve backwards compatibility with Test 4's
 * `_applyCorrectionForTest(128)` signature; Phase 74 tests pass an
 * explicit gamma to assert the parameter is actually threaded through
 * the pipeline (not silently ignored).
 * Spot check: (128/255)^0.7 * 255 ≈ 157; (128/255)^0.5 * 255 ≈ 181.
 */
export async function _applyCorrectionForTest(
  inputValue: number,
  gamma: number = 0.7,
): Promise<number> {
  if (process.env.NODE_ENV !== "test") return 0;
  // Create a 1x1 PNG with raw pixel value
  const raw = Buffer.alloc(inputValue >= 0 && inputValue <= 255 ? 3 : 3, inputValue);
  // Build a 1x1 RGB PNG using sharp raw input
  const pngBuffer = await sharp(raw, {
    raw: { width: 1, height: 1, channels: 3 },
  })
    .png()
    .toBuffer();

  const corrected = await applyGamma(pngBuffer, gamma);

  // Extract the red channel of the 1x1 corrected PNG
  const { data } = await sharp(corrected).raw().toBuffer({ resolveWithObject: true });
  return data[0];
}

export default router;
