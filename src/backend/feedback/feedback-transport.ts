/**
 * Phase 121 (feedback-transport): nodemailer SMTP wrapper for the feedback
 * pipeline. Owns the transporter singleton and the fire-and-forget
 * sendFeedbackEmail() call site.
 *
 * Contract:
 *   - Lazy singleton: the nodemailer Transporter is created on first send,
 *     never at boot (D-07).
 *   - No SMTP handshake pre-check at boot OR at first send (D-07
 *     anti-pattern lock — the `transporter dot verify` call is forbidden
 *     here). Bad-but-present SMTP creds surface at real send time —
 *     logged, dropped, never re-raised.
 *   - Plaintext only: sendMail is called with the text body field only.
 *     NEVER the multipart/HTML body field (D-15 anti-pattern lock).
 *   - Fire-and-forget from the caller's POV: sendFeedbackEmail() catches
 *     every error internally and NEVER rethrows (D-27 anti-pattern lock).
 *   - Sender = cfg.smtp.fromAddress (D-17 — env-configured, never
 *     synthesized).
 *   - Recipient = cfg.toAddress (D-18 — env-configured, single address).
 *   - Log operations use the sshLogger `operation:` key convention:
 *       feedback_submit         — successful send
 *       feedback_send_failed    — send failed
 *       feedback_send_skipped   — feature disabled at send time
 */

import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import { sshLogger } from "../utils/logger.js";
import { getFeedbackConfig } from "./feedback-config.js";

// ---------------------------------------------------------------------------
// Module-scope singleton (created lazily on first send)
// ---------------------------------------------------------------------------

let transporter: Transporter | null = null;

/**
 * Lazily create + cache the nodemailer Transporter. Returns null when the
 * feedback feature is disabled (missing/invalid env). Does NOT perform the
 * SMTP handshake pre-check — D-07.
 */
function getTransporter(): Transporter | null {
  const cfg = getFeedbackConfig();
  if (!cfg.enabled) return null;
  if (transporter !== null) return transporter;

  // secure=true → implicit TLS (port 465). Otherwise nodemailer uses STARTTLS
  // upgrade on the underlying plaintext connection (typical for port 587).
  // auth is undefined for anonymous relays (D-04 pairing rule: USER +
  // PASSWORD are both set or both absent — enforced upstream in
  // feedback-config.ts).
  transporter = nodemailer.createTransport({
    host: cfg.smtp.host,
    port: cfg.smtp.port,
    secure: cfg.smtp.port === 465,
    auth:
      cfg.smtp.user !== ""
        ? { user: cfg.smtp.user, pass: cfg.smtp.password }
        : undefined,
    // MED-2: explicit conservative timeouts. nodemailer defaults are 2min
    // handshake / 30s greeting / 10min socket. Combined with the fire-and-
    // forget contract in the route (`void sendFeedbackEmail(...)`), a
    // hostile/hanging SMTP server would hold file descriptors and pending
    // promises for up to 10 minutes per submission. Under submission
    // volume, that can exhaust socket handles.
    connectionTimeout: 10_000, // 10s — SMTP TCP handshake
    greetingTimeout: 10_000, // 10s — SMTP banner
    socketTimeout: 30_000, // 30s — total send window
    // NOTE: intentionally NO SMTP handshake pre-check call anywhere — D-07.
  });
  return transporter;
}

// ---------------------------------------------------------------------------
// sendFeedbackEmail (fire-and-forget wrapper)
// ---------------------------------------------------------------------------

/**
 * Sends one feedback email via the cached nodemailer transporter.
 *
 * Contract:
 *   - Returns void (never rejects) — D-27 lock. All errors caught +
 *     surfaced via sshLogger.error(operation: "feedback_send_failed").
 *   - Callers use `void sendFeedbackEmail(...)` in route handlers so the
 *     HTTP response returns before this promise settles.
 *   - `subject`, `body`, `submitter`, `type`, `hasNote`, `hasExchange`
 *     are treated as already-composed values from feedback-routes.ts /
 *     feedback-email.ts. No composition or validation happens here.
 */
export async function sendFeedbackEmail(args: {
  subject: string;
  body: string;
  submitter: string;
  type: string;
  hasNote: boolean;
  hasExchange: boolean;
}): Promise<void> {
  const t = getTransporter();
  const cfg = getFeedbackConfig();
  if (t === null || !cfg.enabled) {
    // Feature is disabled — legitimate no-op. Log so the operator can
    // trace intent even when the wire never carries anything.
    sshLogger.info("feedback-transport: skip send (feature disabled)", {
      operation: "feedback_send_skipped",
      submitter: args.submitter,
      type: args.type,
    });
    return;
  }

  try {
    await t.sendMail({
      from: cfg.smtp.fromAddress,
      to: cfg.toAddress,
      subject: args.subject,
      // D-15 anti-pattern lock: plaintext ONLY. NEVER pass a rich-body
      // field; NEVER pass multipart alternatives. The text field below is
      // the sole body carrier.
      text: args.body,
    });
    sshLogger.info("feedback-transport: send succeeded", {
      operation: "feedback_submit",
      submitter: args.submitter,
      type: args.type,
      hasNote: args.hasNote,
      hasExchange: args.hasExchange,
    });
  } catch (err) {
    // D-27 anti-pattern lock: log to console + drop. NEVER rethrow. The
    // full payload was already written to sshLogger.info by the route
    // handler BEFORE this call, so nothing a user typed is lost even on
    // a failed send.
    sshLogger.error("feedback-transport: send failed", err, {
      operation: "feedback_send_failed",
      submitter: args.submitter,
      type: args.type,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
