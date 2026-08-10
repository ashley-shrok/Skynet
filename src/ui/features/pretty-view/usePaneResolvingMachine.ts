// phase-30: usePaneResolvingMachine — trivial 2-input derivation (PS30-04)
/**
 * Trivial derivation hook wrapping the pure `resolveRenderedState` reducer.
 *
 * Phase 30's rewrite reduces this file to a thin wrapper around the pure
 * reducer in ./resolve-phase.ts. The hook exists as a named seam so callers
 * have a stable named point for the derivation and the contract stays
 * testable in isolation with renderHook.
 *
 * ZERO INTERNAL STATE. Every call reduces to a single pure function
 * evaluation. The caller (PrettyView.tsx) owns the paneState React state
 * slot and resets it on cold-mount. Both inputs are controlled parameters
 * — no WS subscriptions, no store subscriptions inside the hook.
 */

import {
  resolveRenderedState,
  type WsTransportState,
  type PaneState,
  type RenderedState,
} from "./resolve-phase";

/**
 * Controlled inputs — the two-input signature per PS30-04. wsTransportState
 * is the client-observed WS lifecycle; paneState is the last received
 * backend `pane_state.state` value, or null if none received yet.
 */
export interface UsePaneResolvingMachineDeps {
  wsTransportState: WsTransportState;
  paneState: PaneState | null;
}

/**
 * Result shape. renderedState drives every overlay mount gate in
 * PrettyView.tsx (renderedState === "holding" etc.); paneState is echoed
 * for consumer convenience.
 */
export interface UsePaneResolvingMachineResult {
  renderedState: RenderedState;
  paneState: PaneState | null;
}

/**
 * Hook body — a single pure function evaluation per render.
 */
export function usePaneResolvingMachine(
  deps: UsePaneResolvingMachineDeps,
): UsePaneResolvingMachineResult {
  const renderedState = resolveRenderedState(deps.wsTransportState, deps.paneState);
  return { renderedState, paneState: deps.paneState };
}
