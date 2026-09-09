// Phase 92 Slice 1 (D-08, D-09, Pitfall 2): useChatSurfaceAdapter.
//
// Unified adapter hook. Given a `ChatSurfaceSource` + isVisible flag, calls
// BOTH `useHarnessAdapter` and `useRelayAdapter` unconditionally (in stable
// order, satisfying React's rules-of-hooks) and returns whichever adapter's
// state matches `source.kind`.
//
// Two-arg signature `(source, isVisible)`:
//   - `source`: D-07 discriminated union — describes WHAT to render.
//   - `isVisible`: runtime observation state — Slice 3's real `useRelayAdapter`
//     threads this into the WebSocket visibility gate (close the WS when the
//     pane is hidden). Kept at the unified-hook level so the source shape
//     stays minimal per D-07 (source describes WHAT, not runtime state).
//
// Slice 3 replaces the inline `useRelayAdapter` stub below with the real
// ported hook (absorbed from `src/ui/features/relay-room-pane/use-relay-
// room-stream.ts` per D-10). The stub's file location, signature, and
// initial state shape all match what Slice 3 publishes — Slice 3 is a
// drop-in replacement.

import type {
  ChatSurfaceSource,
  ChatSurfaceAdapterState,
} from "./chat-surface-source";
import { useHarnessAdapter } from "./use-harness-adapter";

// Slice 1 STUB — Slice 3 replaces with the real ported hook. Kept inline here
// (not a separate file) so the unstubbing diff is a single-file change in
// Slice 3. Signature MUST match Slice 3's target: `(source, isVisible)` with
// nullable source input + isVisible boolean.
//
// Initial state per PATTERNS.md § "Warning 2": `participants: { humans: [],
// agents: [] }` (NOT null) so downstream MultiBadgeAnchor rendering matches
// Slice 3's initial-mount shape. `isReady: false` — the stubbed adapter is
// never ready; nothing routes to it yet (Slice 4 rewires the dispatcher).
const RELAY_STUB_STATE: ChatSurfaceAdapterState = {
  messages: [],
  participants: { humans: [], agents: [] },
  sendMessage: async () => false,
  error: null,
  isReady: false,
};

function useRelayAdapter(
  _source: Extract<ChatSurfaceSource, { kind: "relay" }> | null,
  _isVisible: boolean,
): ChatSurfaceAdapterState {
  // Slice 1 stub. Slice 3 replaces this with the real relay adapter (~488
  // lines ported from use-relay-room-stream.ts per D-10). Do NOT add hook
  // calls here that depend on `_source` being non-null — Pitfall 2 requires
  // hook-call order stability across kind flips.
  return RELAY_STUB_STATE;
}

export function useChatSurfaceAdapter(
  source: ChatSurfaceSource,
  isVisible: boolean,
): ChatSurfaceAdapterState {
  // Pitfall 2 resolution: call BOTH underlying adapter hooks unconditionally,
  // in stable order, regardless of `source.kind`. Each adapter accepts a
  // nullable narrowed source and returns an empty-state result when passed
  // null. The active source's state is returned; the inactive source's state
  // is ignored (but its hook was still called, satisfying rules-of-hooks).
  const harnessState = useHarnessAdapter(
    source.kind === "harness" ? source : null,
    isVisible,
  );
  const relayState = useRelayAdapter(
    source.kind === "relay" ? source : null,
    isVisible,
  );

  // D-08: `source.kind` is the ONE hard case-discriminator.
  return source.kind === "relay" ? relayState : harnessState;
}
