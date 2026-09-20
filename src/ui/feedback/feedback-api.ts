// ─── Feedback POST wrapper (Phase 121 Plan 02) ───────────────────────────────
// Thin authApi.post wrapper for the feedback intake endpoint. Mirrors the
// canonical registerUser() shape in src/ui/main-axios.ts L1652-1665: use
// authApi (JWT-cookie-attached axios instance), let handleApiError() log
// through the existing error-classification path, and — crucially for
// feedback — SWALLOW any propagation so the user always sees the "Thanks —
// feedback sent" toast (D-27).
//
// D-24 payload contract:
//   kind:         "general" | "thumbs_up" | "thumbs_down"
//   userNote:     string (may be empty — e.g. thumbs-down close-X without note)
//   messageRef?:  opaque caller-chosen identifier for thumbs
//   exchangeText?: markdown source of the exchange being thumbed
//
// D-26 lock: exchangeText travels client-to-server on the wire whenever the
// caller supplies it. The backend (Plan 03) decides whether to include it
// in the email body based on the operator's FEEDBACK_INCLUDE_CONTENT env
// var. DO NOT filter exchangeText here client-side — the client always
// forwards what it has.
//
// D-27 (no re-raise): the outer try/catch AROUND handleApiError() is
// intentional. `handleApiError` has return type `never` — it always
// propagates an ApiError. Without the inner swallow, that ApiError would
// escape to postFeedback's caller, defeating the "user always sees toast
// regardless" contract. We could avoid handleApiError entirely and log
// inline, but using it preserves the codebase's uniform error-classification
// path (401/403/422/5xx get their canonical structured logs) for operator
// visibility per D-27's "console log carries the full attempted payload so
// nothing a user typed is lost" clause. See threat T-121-08 (accepted repudiation).
//
// Threat model (from 121-02-PLAN.md):
//   T-121-08 (Repudiation) — user always sees "thanks" toast; failure is
//     invisible client-side. Accepted per D-27 shape agreement. Backend
//     console log via handleApiError's structured error path is the
//     operator-side visibility fallback.

import { authApi, handleApiError } from "@/main-axios";

// ─── Public types ────────────────────────────────────────────────────────────

export type FeedbackKind = "general" | "thumbs_up" | "thumbs_down";

export type FeedbackPayload = {
  kind: FeedbackKind;
  userNote: string;
  messageRef?: string;
  exchangeText?: string;
};

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * POST /feedback with the D-24 payload. Never re-raises errors (D-27).
 *
 * Resolves cleanly whether the request succeeds, fails with a 4xx, fails
 * with a 5xx, or the network is unreachable. The caller (Plan 04 dev-trigger,
 * Plan 121-shape-2 general button, Plan 121-shape-3 thumbs affordance) can
 * unconditionally fire the "Thanks — feedback sent" toast after `await
 * postFeedback(payload)` resolves.
 *
 * Backend contract: Plan 03's POST /feedback returns 202 Accepted on
 * successful intake; response body is not consumed here.
 */
export async function postFeedback(payload: FeedbackPayload): Promise<void> {
  try {
    await authApi.post("/feedback", payload);
    // 202 accepted — no response body needed.
  } catch (error) {
    // handleApiError has return type `never` — it always propagates an
    // ApiError via the canonical error-classification path (401/403/422/5xx
    // get structured logs). We call it for the log side-effect, then
    // swallow the propagation so postFeedback honors D-27's no-re-raise
    // contract.
    try {
      handleApiError(error, "submit feedback");
    } catch {
      // D-27: user always sees the "thanks" toast regardless of send outcome.
      // Deliberately swallow — operator visibility comes from handleApiError's
      // structured logger call above (Plan 03's backend console log is the
      // primary operator-visibility channel per D-27).
    }
  }
}
