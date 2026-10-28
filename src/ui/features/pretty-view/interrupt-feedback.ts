// Stop (interrupt) — what the working orb shows after a press, and the
// client-side double-tap window. The press itself lives in PrettyView; the
// orb that takes it is WipBubble.

/** What the Stop orb shows after a press (see PrettyView). */
export type InterruptFeedback = "stopping" | "stopped" | "cancelled" | "nothing" | "failed";

// Short so the line fits beside the orb on a phone.
export const INTERRUPT_FEEDBACK_LABEL: Record<InterruptFeedback, string> = {
  stopping: "Stopping",
  stopped: "Stopped",
  cancelled: "Cancelled",
  nothing: "Nothing to stop",
  failed: "Failed",
};

// Interrupt fast-path throttle window. Matches the server-side
// INTERRUPT_THROTTLE_MS (2500ms) so this client guard never lets through a
// tap the server would only drop anyway — measured basis: Claude Code's
// exit-confirm window is ~0.8s (v2.1.150, 2026-09-16); two Ctrl-C presses
// inside it terminate the harness; 2500ms is ~3× that for margin.
//
// The client guard is only a cheap fast-path and cannot be the guarantee:
//   1. Per-view, not per-pane: phone + desktop on the same conversation are
//      two independent guards that can still land two Ctrl-Cs ~200ms apart.
//   2. It times the click, not the arrival: send jitter can compress a
//      compliant pair below the harness-death threshold in flight.
//   3. A stale bundle enforces whatever constant it shipped with.
// The AUTHORITATIVE guard is the server-side per-pane throttle in
// claude-session-server.ts, keyed by (hostId, tmuxSession).
export const INTERRUPT_THROTTLE_MS = 2500;
