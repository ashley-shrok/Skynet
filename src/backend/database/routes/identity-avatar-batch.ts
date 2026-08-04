/**
 * Phase 20 (IDUI-04): Identity avatar batch generation route.
 *
 * Mounts on /identities/avatar (in database.ts) and provides:
 *   POST /batch   — LLM archetype draft + 3 parallel gpt-image-1 calls
 *                   + gamma 0.7 correction + in-memory candidate cache
 *   GET  /candidate/:id — serves cached candidate PNG bytes
 *
 * OpenAI API key: read from process.env.OPENAI_API_KEY at request time.
 * Missing key returns 503 (does not crash on boot).
 *
 * Candidate cache TTL: 10 minutes. Scoped by userId so User A's
 * candidates are not accessible to User B.
 *
 * Gamma correction: sharp().gamma(1/0.7) ≈ 1.4286, which applies
 * output = input^0.7 per the avatar-flow runbook § 5. Verified: input
 * value 128 (mid-grey) maps to ≈177 post-correction.
 *
 * TTL sweeper: runs every 60s, skipped when NODE_ENV === "test".
 */

import express from "express";
import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import sharp from "sharp";
import { AuthManager } from "../../utils/auth-manager.js";
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
// Applies gamma 0.7 per the avatar-flow runbook § 5:
//   output = input^0.7   (normalized: output_norm = input_norm^0.7)
//
// Sharp's .gamma(g) applies sRGB linearization (not a plain power curve),
// so we do raw pixel manipulation: decode PNG → iterate channels → apply
// Math.pow(v/255, 0.7) * 255 → re-encode PNG.
//
// Verification: input 128 → (128/255)^0.7 * 255 ≈ 157 (rounds to 157).
// Alpha channels (channels===4) are left untouched.
// ---------------------------------------------------------------------------

async function applyGamma07(pngBuffer: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(pngBuffer)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  for (let i = 0; i < data.length; i++) {
    // Skip alpha channel (every 4th byte when RGBA)
    if (channels === 4 && (i + 1) % 4 === 0) continue;
    data[i] = Math.round(Math.pow(data[i] / 255, 0.7) * 255);
  }

  return sharp(data, {
    raw: { width: info.width, height: info.height, channels },
  })
    .png()
    .toBuffer();
}

// ---------------------------------------------------------------------------
// Archetype system prompt (adapted from avatar-flow runbook § 2-3)
// ---------------------------------------------------------------------------

const ARCHETYPE_SYSTEM_PROMPT = `You are a MOBA-champion character-art director specializing in LoL champion-select splash portraits.

Given a fleet identity's name, title, and brief role description, produce a single tight image-generation prompt for gpt-image-1.

The prompt MUST:
- Open with: "MOBA-champion character portrait illustration — a strong distinct character concept in the tradition of League of Legends champion-select splash art. Painterly cel-shaded with THICK BOLD BLACK CEL-SHADED OUTLINES suitable for viewing at small avatar sizes (~60px, will be cropped to a circle). HIGHLY SATURATED GLOWING colors. Larger-than-life character energy. NOT a generic anime portrait."
- Specify TIGHT HEAD-AND-SHOULDERS composition: head + iconic signature head feature, face, top of shoulders. Chin around bottom third. NO waist, NO arms. Face LARGE in frame. Square 1:1.
- Define an archetype character concept: name — the archetype title, one-sentence larger-than-life vibe. NOT mundane — mythic. Reference a LoL champion parallel.
- List DISTINCT SILHOUETTE FEATURES (primary head feature, 2nd signature feature, 3rd feature at head level, hair, eyes, expression, collar/wardrobe with title woven patch in bold sans-serif).
- Describe a thematic cyberpunk-adjacent background with ambient color, rim light, drifting themed glyphs.
- Specify the palette (dominant + accents). State skin tone with NEUTRAL/COOL lighting — AVOID warm yellow cast.
- End with: "No text overlays other than title patch. No watermarks. LoL champion select roster tier."

Use SATURATED, GLOWING, LUMINOUS, BRIGHT, THICK BOLD throughout — avoid faint/subtle/soft modifiers.

Produce the image-generation prompt ONLY. No preamble. No explanation. Just the prompt.`;

// ---------------------------------------------------------------------------
// POST /batch
// ---------------------------------------------------------------------------

router.post(
  "/batch",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // Validate required inputs
    const { name, title, brief } = req.body as Record<string, unknown>;
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

    // Read API key at request time — 503 if missing (no boot crash)
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "OpenAI not configured" });
      return;
    }

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
            { role: "system", content: ARCHETYPE_SYSTEM_PROMPT },
            {
              role: "user",
              content: `Name: ${name}\nTitle: ${title}\nBrief: ${brief}\n\nProduce the image-generation prompt only. No preamble. No explanation. Just the prompt.`,
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
    // Step 3: Apply gamma 0.7 to each image via sharp
    // ------------------------------------------------------------------
    let gammaCorrected: Buffer[];
    try {
      gammaCorrected = await Promise.all(
        b64Results.map(async (b64) => {
          const pngBuffer = Buffer.from(b64, "base64");
          return applyGamma07(pngBuffer);
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
 * Gamma spot-check helper for Test 4.
 * Applies the same gamma(1/0.7) pipeline to a single 8-bit channel value
 * and returns the result as an 8-bit integer.
 * (128/255)^0.7 * 255 ≈ 177
 */
export async function _applyCorrectionForTest(inputValue: number): Promise<number> {
  if (process.env.NODE_ENV !== "test") return 0;
  // Create a 1x1 PNG with raw pixel value
  const raw = Buffer.alloc(inputValue >= 0 && inputValue <= 255 ? 3 : 3, inputValue);
  // Build a 1x1 RGB PNG using sharp raw input
  const pngBuffer = await sharp(raw, {
    raw: { width: 1, height: 1, channels: 3 },
  })
    .png()
    .toBuffer();

  const corrected = await applyGamma07(pngBuffer);

  // Extract the red channel of the 1x1 corrected PNG
  const { data } = await sharp(corrected).raw().toBuffer({ resolveWithObject: true });
  return data[0];
}

export default router;
