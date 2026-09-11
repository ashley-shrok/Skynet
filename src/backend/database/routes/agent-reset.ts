/**
 * agent-reset.ts — Phase 90 Plan 00 Wave 0 Task 3.
 *
 * POST /agent-reset/:hostId/:tmuxSessionName
 *
 * Dispatches the same `/id reset` input the existing PrettyView reset button
 * dispatches today (ComposeBox.tsx L1867-1888 `dispatchResetPayload`), but
 * SERVER-SIDE via a one-shot SSH connection + tmux send-keys. This lets:
 *
 *   1. PrettyView's existing reset button (Task 3 mechanical rewire) hit
 *      this endpoint instead of routing through the pretty-view WS.
 *   2. The future Plan 06 relay-pane badge appendage call the SAME endpoint
 *      as a first-class caller — same behavior, same seam.
 *
 * The endpoint is the SINGLE seam both surfaces dispatch through. Reset
 * behaves identically regardless of which surface fires it.
 *
 * ## Access-control gate (T-90-00-E1 mitigation)
 *
 * JWT-authenticated (authenticateJWT middleware). `resolveHostById(hostId,
 * userId)` is the ownership check — it filters by hostId AND userId, so if
 * the caller doesn't own the host it returns null → 404 (no oracle per
 * Security V8: same status for 'not owner' and 'not found').
 *
 * ## Body-passthrough shape (matches ComposeBox verbatim)
 *
 * If the request payload includes an optional `body: string`, the endpoint
 * constructs `/id reset (<body>)` — matching the ComposeBox convention at
 * L1867-1876. Empty body → just `/id reset`. Newlines in body are collapsed
 * to spaces (D-50 policy) mirroring ComposeBox's `collapseNewlinesForSend`.
 *
 * ## Dispatch mechanism
 *
 * Body-then-Enter split-send via two tmux send-keys execs on a one-shot SSH
 * connection. Mirrors the primary claude-session-server pv-input path
 * (L2735-2767) — body first (`-l` literal flag), 1000ms delay, then Enter.
 * The 1000ms delay is a bracketed-paste-drain window Alice + tina tuned in
 * (patch #111 → 250ms → 1000ms 2026-08-21 by tina). Same discipline here so
 * the endpoint reset behaves byte-parallel to the WS reset.
 *
 * ## Structured logging
 *
 * Every outcome emits an operation-tagged log via `databaseLogger`:
 *   - `agent_reset_ok` — dispatch succeeded (200).
 *   - `agent_reset_denied` — host not owned by caller (404, no oracle).
 *   - `agent_reset_dispatch_failed` — SSH connect / tmux send-keys threw.
 *
 * NEVER logs the body content (privacy — body may contain user-typed
 * context). Standard fleet-wide directive Alice 2026-08-11 (structured
 * logging at boundaries).
 *
 * ## NOT applicable
 *
 * NO user-row DB write → DatabaseSaveTrigger.forceSave invariant does NOT
 * apply. NO new secrets introduced.
 */

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { sshLogger, databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// Match the CONNECT_TIMEOUT_MS from sessions.ts (5s cap — fast fail on
// unreachable hosts to keep the endpoint's latency bounded).
const CONNECT_TIMEOUT_MS = 5_000;

// tmux session name grammar — alphanumeric + dash + underscore, 1..64.
// Tmux itself rejects most metacharacters; single-quote-wrap in shellQuote
// below is defense-in-depth for the exec command construction.
const TMUX_SESSION_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// Same shellQuote as terminal.ts:114 — single-quote wrap, escape embedded
// single quotes as `'\''`. Local copy (no new module for a one-liner).
const shellQuote = (s: string): string =>
  `'${s.replace(/'/g, `'\\''`)}'`;

// D-50 newline-collapse mirror (matches ComposeBox.tsx:1472).
function collapseNewlinesForSend(s: string): string {
  return s.replace(/\r?\n/g, " ");
}

/**
 * @openapi
 * /agent-reset/{hostId}/{tmuxSessionName}:
 *   post:
 *     summary: Dispatch /id reset to the target agent's tmux session
 *     tags:
 *       - Sessions
 *     parameters:
 *       - name: hostId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *       - name: tmuxSessionName
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               body:
 *                 type: string
 *                 description: Optional context appended as "/id reset (<body>)"
 *     responses:
 *       200:
 *         description: Reset dispatched
 *       400:
 *         description: Invalid path arg (hostId non-numeric OR tmuxSession fails grammar)
 *       404:
 *         description: Host not owned by caller OR not found (same status — no oracle)
 *       502:
 *         description: SSH connect or tmux send-keys failed
 */
router.post(
  "/:hostId/:tmuxSessionName",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // ─── Validate path args ────────────────────────────────────────────────
    // Express typings widen path params to `string | string[]`. Express
    // itself only returns strings for :param captures (not [...splat]), so
    // narrow at the boundary — reject anything unexpected as invalid.
    const rawHostId = req.params.hostId;
    const rawTmuxSession = req.params.tmuxSessionName;
    if (typeof rawHostId !== "string" || typeof rawTmuxSession !== "string") {
      return res
        .status(400)
        .json({ ok: false, error: "invalid_host_id" });
    }
    const hostIdNum = parseInt(rawHostId, 10);
    if (!Number.isInteger(hostIdNum) || hostIdNum <= 0) {
      return res
        .status(400)
        .json({ ok: false, error: "invalid_host_id" });
    }
    const tmuxSession = rawTmuxSession;
    if (!TMUX_SESSION_RE.test(tmuxSession)) {
      return res
        .status(400)
        .json({ ok: false, error: "invalid_tmux_session" });
    }

    // ─── Access-control gate ───────────────────────────────────────────────
    // resolveHostById filters by (hostId AND userId) — returns null if the
    // host doesn't belong to the caller. Same status for 'not owner' and
    // 'not found' (Security V8 — no existence oracle).
    let resolvedHost: Awaited<ReturnType<typeof resolveHostById>>;
    try {
      resolvedHost = await resolveHostById(hostIdNum, userId);
    } catch (err) {
      databaseLogger.warn("agent-reset ownership check threw", {
        operation: "agent_reset_denied",
        userId,
        hostId: hostIdNum,
        tmuxSession,
        error: err instanceof Error ? err.message : "unknown",
      });
      return res.status(404).json({ ok: false, error: "not_found" });
    }
    if (!resolvedHost) {
      databaseLogger.warn("agent-reset denied — host not owned or not found", {
        operation: "agent_reset_denied",
        userId,
        hostId: hostIdNum,
        tmuxSession,
      });
      return res.status(404).json({ ok: false, error: "not_found" });
    }

    // ─── Payload construction ──────────────────────────────────────────────
    // Mirror ComposeBox.tsx L1867-1876 shape verbatim.
    const rawBody =
      typeof req.body?.body === "string" ? req.body.body : "";
    const trimmed = rawBody.trim();
    const payload = trimmed
      ? `/id reset (${collapseNewlinesForSend(trimmed)})`
      : "/id reset";

    // ─── Dispatch via one-shot SSH + tmux send-keys ────────────────────────
    // Mirrors the primary pv-input split-send at claude-session-server.ts
    // L2735-2767: body first (`-l` literal flag), 1000ms bracketed-paste-
    // drain delay, then Enter. The 1000ms delay is load-bearing (patch #111
    // history: 50ms produced paste-detection-still-active symptom; 250ms was
    // sometimes inside the drain window; 1000ms adds headroom).
    try {
      // Runtime type narrows — the SSHHost shape is what connectOneShot
      // expects; cast to satisfy its Parameters<> without loosening safety.
      const conn = await connectOneShot(
        resolvedHost as unknown as Parameters<typeof connectOneShot>[0],
        CONNECT_TIMEOUT_MS,
      );
      try {
        // Body write. `-l` sends payload as literal text (no key interp).
        await execCommand(
          conn,
          `tmux send-keys -l -t ${shellQuote(tmuxSession)} ${shellQuote(payload)}`,
        );
        // Bracketed-paste-drain window — matches pv-input split-send at
        // claude-session-server.ts:2755. DO NOT lower without repro on
        // real hardware.
        await new Promise((resolve) => setTimeout(resolve, 1000));
        // Enter (submits the /id reset command).
        await execCommand(
          conn,
          `tmux send-keys -t ${shellQuote(tmuxSession)} Enter`,
        );
      } finally {
        // Best-effort close. connectOneShot connections are one-shot; failing
        // to close is a leak but not a correctness issue for the dispatch.
        try {
          (conn as unknown as { end?: () => void }).end?.();
        } catch {
          /* swallow — best-effort close */
        }
      }

      databaseLogger.info("agent-reset dispatched", {
        operation: "agent_reset_ok",
        userId,
        hostId: hostIdNum,
        tmuxSession,
        // Log payload SHAPE, not content — indicate whether an optional body
        // was appended so ops can grep for the two shapes.
        hasBody: trimmed.length > 0,
      });
      return res.status(200).json({ ok: true });
    } catch (err) {
      // SSH connect failed OR tmux send-keys threw.
      const errMsg = err instanceof Error ? err.message : "unknown";
      databaseLogger.error(
        "agent-reset dispatch failed",
        err instanceof Error ? err : new Error(String(err)),
        {
          operation: "agent_reset_dispatch_failed",
          userId,
          hostId: hostIdNum,
          tmuxSession,
          error: errMsg,
        },
      );
      // Also log via sshLogger for grep symmetry with the pv-input path.
      sshLogger.warn("agent-reset ssh dispatch threw", {
        operation: "agent_reset_dispatch_failed",
        userId,
        hostId: hostIdNum,
        tmuxSession,
        error: errMsg,
      });
      return res
        .status(502)
        .json({ ok: false, error: "dispatch_failed" });
    }
  },
);

export default router;
