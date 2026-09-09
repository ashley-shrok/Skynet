// Phase 92 Slice 1 (D-08, D-09, Pitfall 2): useChatSurfaceAdapter.
//
// Unified adapter hook. Given a `ChatSurfaceSource` + isVisible flag, calls
// BOTH `useHarnessAdapter` and `useRelayAdapter` unconditionally (in stable
// order, satisfying React's rules-of-hooks) and returns whichever adapter's
// state matches `source.kind`.
//
// Two-arg signature `(source, isVisible)`:
//   - `source`: D-07 discriminated union — describes WHAT to render.
//   - `isVisible`: runtime observation state — the real `useRelayAdapter`
//     threads this into the WebSocket visibility gate (close the WS when the
//     pane is hidden). Kept at the unified-hook level so the source shape
//     stays minimal per D-07 (source describes WHAT, not runtime state).
//
// Phase 93 Slice 3: the inline Slice 1 stub is REMOVED. `useRelayAdapter` is
// now imported from `./use-relay-adapter` (real hook ported from the
// retired Slice D relay-source stream hook per D-10; Slice 4 deleted the
// standalone source). The hook signature, nullable source input, initial
// state, and return shape all match what Slice 1 stubbed — this is a
// drop-in replacement.

import type {
  ChatSurfaceSource,
  ChatSurfaceAdapterState,
} from "./chat-surface-source";
import { useHarnessAdapter } from "./use-harness-adapter";
import { useRelayAdapter } from "./use-relay-adapter";

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
