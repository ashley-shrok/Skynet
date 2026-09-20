/**
 * Phase 121 (feedback-routes): Express router with the two feedback
 * surfaces the frontend consumes.
 *
 *   - GET  /api/feedback/enabled  → auth-gated; returns {enabled:boolean}
 *                                    with Cache-Control:no-store (D-08).
 *   - POST /feedback              → auth-gated; validates the payload,
 *                                    composes the plaintext body per
 *                                    D-19, and kicks a fire-and-forget
 *                                    nodemailer send. Always returns 202
 *                                    on the config-present path (D-27),
 *                                    or 503 when disabled (defense-in-
 *                                    depth against a stale client per
 *                                    RESEARCH § Security Domain).
 *
 * Trust boundaries:
 *   - `authenticateJWT` middleware populates `req.userId`; a JWT is
 *     required for BOTH routes (unlike branding, which is intentionally
 *     unauthenticated pre-login).
 *   - Payload validation is inline (matches
 *     branding-config-loader.ts::isValidBrandingShape house style).
 *   - `express.json({limit:"512kb"})` is applied inline on the POST
 *     route (T-121-11 — the global bodyParser at database.ts:350 allows
 *     1gb which is too permissive for feedback).
 *
 * Server-side content gate (D-22 + D-23):
 *   The route computes `serverExchangeText = cfg.includeContent &&
 *   kind !== "general" ? exchangeText : undefined` BEFORE calling
 *   composeBody. That single expression enforces both:
 *     - D-23: kind=general NEVER carries the exchange section, even if
 *       the caller sent exchangeText on the wire.
 *     - D-22: content-flag-off drops the exchange section for thumb-
 *       attached feedback.
 *
 * D-27 log-before-send:
 *   The FULL payload (userNote + exchangeText) is written to
 *   sshLogger.info(operation="feedback_submit") BEFORE
 *   `void sendFeedbackEmail(...)` fires. If the SMTP send later fails,
 *   nothing a user typed is lost — the pre-send log line is the audit
 *   trail (T-121-17 mitigation).
 *
 * Fire-and-forget contract:
 *   `void sendFeedbackEmail(...)` prefix ensures the HTTP response
 *   returns 202 immediately, without awaiting the SMTP round-trip. The
 *   transport module owns its own try/catch (never rethrows — D-27).
 *
 * Nginx dual-file rule (CLAUDE.md caveat + Pitfall 2):
 *   Matching `location = /api/feedback/enabled` AND `location = /feedback`
 *   blocks MUST exist in BOTH docker/nginx.conf AND
 *   docker/nginx-https.conf. Missing either half → 404 at nginx before
 *   Express is reached. Nginx plumbing lands in Task 6 of this plan.
 */

import express, {
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import { eq } from "drizzle-orm";
import { AuthManager } from "../utils/auth-manager.js";
import { db } from "../database/db/index.js";
import { users } from "../database/db/schema.js";
import { getFeedbackConfig } from "./feedback-config.js";
import { composeSubject, composeBody } from "./feedback-email.js";
import { sendFeedbackEmail } from "./feedback-transport.js";
import { loadBrandingConfig } from "../branding/branding-config-loader.js";
import { sshLogger } from "../utils/logger.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware() as RequestHandler;

const NO_STORE_CACHE =
  "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0";

// ---------------------------------------------------------------------------
// GET /api/feedback/enabled — auth-gated, returns {enabled: boolean}.
// ---------------------------------------------------------------------------

router.get(
  "/api/feedback/enabled",
  authenticateJWT,
  (_req: Request, res: Response) => {
    const cfg = getFeedbackConfig();
    res.setHeader("Cache-Control", NO_STORE_CACHE);
    return res.status(200).json({ enabled: cfg.enabled });
  },
);

// ---------------------------------------------------------------------------
// POST /feedback — auth-gated, payload-validated, fire-and-forget send.
// ---------------------------------------------------------------------------

router.post(
  "/feedback",
  authenticateJWT,
  // Inline size cap (T-121-11). The global bodyParser at
  // database.ts:355 allows 1gb — too permissive for feedback. NOTE: this
  // inline parser is defense-in-depth only; in production the global
  // parser runs first and sets req._body, making this a no-op for the
  // actual limit enforcement. The content-length check below is what
  // actually enforces the 512kb cap in production wiring.
  express.json({ limit: "512kb" }),
  async (req: Request, res: Response) => {
    // T-121-11: request-time body cap. Content-Length header check
    // enforces the 512kb cap regardless of which body parser ran first
    // (the global bodyParser.json({limit:"1gb"}) at database.ts:355 would
    // otherwise pre-parse the body and neuter the inline express.json cap
    // above).
    const contentLength = Number(req.headers["content-length"] ?? "0");
    if (Number.isFinite(contentLength) && contentLength > 512 * 1024) {
      return res.status(413).json({ error: "payload too large" });
    }

    const cfg = getFeedbackConfig();

    // Defense-in-depth against a stale client that cached
    // {enabled:true} before the operator disabled the feature (RESEARCH
    // § Security Domain last note + D-29).
    if (!cfg.enabled) {
      return res.status(503).json({ error: "feedback disabled" });
    }

    const authReq = req as Request & { userId?: string };
    const userId = authReq.userId;
    if (typeof userId !== "string" || userId === "") {
      return res.status(401).json({ error: "auth required" });
    }

    // Payload shape guard (D-24) — inline typeof, house style. The kind
    // discriminant admits exactly three literals:
    //   body.kind !== "general" && body.kind !== "thumbs_up" && body.kind !== "thumbs_down"
    // → 400 {error:"invalid kind"}.
    const body = req.body as {
      kind?: string;
      userNote?: string;
      messageRef?: string;
      exchangeText?: string;
    };
    if (
      body.kind !== "general" &&
      body.kind !== "thumbs_up" &&
      body.kind !== "thumbs_down"
    ) {
      return res.status(400).json({ error: "invalid kind" });
    }
    const kind = body.kind;
    const userNote = typeof body.userNote === "string" ? body.userNote : "";
    // LOW-3: cap messageRef at 256 chars and strip CRLF at the route
    // boundary. messageRef flows into the log payload and (in future
    // shapes) may flow into email subjects; keeping it small + newline-
    // free eliminates the log-injection surface.
    const messageRef =
      typeof body.messageRef === "string"
        ? body.messageRef.slice(0, 256).replace(/[\r\n]+/g, " ")
        : undefined;
    const exchangeText =
      typeof body.exchangeText === "string" ? body.exchangeText : undefined;

    // Drizzle userId → username lookup (mirror of
    // relay-room-participants.ts L78-99). Fallback to "unknown" when the
    // row is missing (defensive — the auth middleware ordinarily
    // guarantees a valid userId, but the users row could be gone in
    // rare admin-delete-during-session cases).
    let submitter = "unknown";
    try {
      const rows = (await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1)) as Array<{ username?: string | null }>;
      const row = rows[0];
      if (
        row !== undefined &&
        typeof row.username === "string" &&
        row.username !== ""
      ) {
        submitter = row.username;
      }
    } catch (err) {
      // Never fail the send just because a lookup blipped. Log + fall
      // back to "unknown" submitter.
      sshLogger.error("feedback-routes: submitter lookup failed", err, {
        operation: "feedback_submitter_lookup_failed",
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Instance name comes from BrandingConfig.appName (D-03).
    const branding = await loadBrandingConfig();
    const timestamp = Date.now();

    // D-16 human-readable type: `general` / `thumbs up` / `thumbs down`.
    const type =
      kind === "general"
        ? "general"
        : kind === "thumbs_up"
          ? "thumbs up"
          : "thumbs down";

    // Server-side content gate (D-22 + D-23):
    //   - D-23: kind=general drops exchange unconditionally
    //   - D-22: content-flag-off drops exchange for thumbs
    const serverExchangeText =
      cfg.includeContent && kind !== "general" ? exchangeText : undefined;

    const subject = composeSubject({ appName: branding.appName, type });
    const emailBody = composeBody({
      submitter,
      appName: branding.appName,
      timestamp,
      type,
      userNote,
      exchangeText: serverExchangeText,
    });

    // D-27 log-before-send: full payload persisted BEFORE the SMTP call
    // so a failed send doesn't lose anything the user typed. The
    // pre-send log line is the audit trail (T-121-17 mitigation).
    //
    // MED-5 + LOW-3: per-field truncation with an oversize flag +
    // CRLF-strip on the LOG strings only. The email body carries
    // untouched text (D-21). The full body still lives in the email;
    // only the log truncates + normalizes newlines to keep
    // log-forwarders healthy under abuse and to prevent log-injection.
    const LOG_CAP = 8 * 1024;
    const truncateForLog = (s: string): string =>
      (s.length > LOG_CAP ? s.slice(0, LOG_CAP) : s).replace(/[\r\n]+/g, " ");
    const userNoteForLog = truncateForLog(userNote);
    const exchangeTextForLog =
      exchangeText !== undefined ? truncateForLog(exchangeText) : undefined;
    sshLogger.info("feedback-submit: attempting send", {
      operation: "feedback_submit",
      submitter,
      type,
      hasNote: userNote.trim() !== "",
      hasExchange: exchangeText !== undefined,
      messageRef,
      // Full body captured so failure recovery is possible from logs
      // alone (D-27 nothing-lost) — capped at 8KB for log-forwarder
      // hygiene per MED-5. Oversize flags below signal that the log copy
      // is truncated (the email still carries the full text).
      userNote: userNoteForLog,
      userNoteTruncated: userNote.length > LOG_CAP,
      exchangeText: exchangeTextForLog,
      exchangeTextTruncated: (exchangeText?.length ?? 0) > LOG_CAP,
    });

    // Fire-and-forget — the response returns before the SMTP round-trip
    // completes. sendFeedbackEmail owns its own try/catch (D-27 —
    // never rethrows).
    void sendFeedbackEmail({
      subject,
      body: emailBody,
      submitter,
      type,
      hasNote: userNote.trim() !== "",
      hasExchange: serverExchangeText !== undefined,
    });

    return res.status(202).json({ ok: true });
  },
);

export default router;
