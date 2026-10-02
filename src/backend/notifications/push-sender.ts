/**
 * Phase 144 — this module is a thin re-export shim preserving the Phase 128
 * import surface. Real implementation lives in ntfy-sender.ts. Deletion of
 * the shim is deferred to plan 04 after we confirm the trigger loop import
 * line can be rewritten in one touch.
 *
 * push-trigger-loop.ts imports `sendPushToUser` from "./push-sender.js" —
 * that import line is UNCHANGED per CONTEXT.md trigger-is-unchanged decision.
 * This shim routes it to the ntfy-based implementation without editing the
 * trigger loop.
 *
 * buildClickUrl is also re-exported so any code that imports it from
 * push-sender.js (e.g., future route handlers) continues to work.
 */

export { sendPushToUser, buildClickUrl } from "./ntfy-sender.js";
export type { PushPayload } from "./ntfy-sender.js";
