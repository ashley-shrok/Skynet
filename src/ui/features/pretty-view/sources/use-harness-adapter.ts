// Phase 92 Slice 1 (D-09, Pitfall 2): useHarnessAdapter — inert shim.
//
// This shim exists PURELY to keep hook-call order stable across both
// ChatSurfaceSource variants (React rules-of-hooks + Pitfall 2 resolution).
// It is intentionally inert. The harness case continues to read messages
// from PrettyView's local `messages` reducer — the harness ingestion
// effect at PrettyView.tsx:1852-2770 remains the source of truth for
// harness messages. Do NOT expand this hook to own state; doing so would
// double-write and break Pitfall 2.
//
// Signature symmetry: `isVisible` is accepted so this shim has the same
// call shape as `useRelayAdapter` (which threads isVisible into the WS
// visibility gate in Slice 3). The parameter is IGNORED here — harness
// ingestion lives in PrettyView, not in this hook.
//
// The `source` argument is nullable — `useChatSurfaceAdapter` passes `null`
// when the active source is relay (so both underlying adapter hooks are
// always called unconditionally in the same order, satisfying rules-of-
// hooks). This shim ignores that too, since the return value is constant.

import type {
  ChatSurfaceSource,
  ChatSurfaceAdapterState,
} from "./chat-surface-source";

const INERT_STATE: ChatSurfaceAdapterState = {
  messages: [],
  participants: null,
  sendMessage: async () => false,
  error: null,
  isReady: true,
  // Phase 97 Finding 1: the harness case's veil is driven off pane-state
  // (renderedState === "resolving"), NOT this field. Setting `true` here
  // is the "no-op" default — the harness veil consumer gates on
  // source.kind === "harness" and never reads this field. Keeping it
  // `true` (rather than `undefined`) codifies "adapter reports
  // messages-loaded" for the inert shim.
  isMessagesLoaded: true,
};

export function useHarnessAdapter(
  _source: Extract<ChatSurfaceSource, { kind: "harness" }> | null,
  _isVisible: boolean,
): ChatSurfaceAdapterState {
  // Intentionally does NOT call any React hooks — but even if a future
  // maintainer adds a hook here, they MUST call it unconditionally (never
  // gated on `_source` being non-null). Pitfall 2 hook-call order stability
  // is the invariant that lets `useChatSurfaceAdapter` always call both
  // underlying adapters regardless of the active source variant.
  return INERT_STATE;
}
