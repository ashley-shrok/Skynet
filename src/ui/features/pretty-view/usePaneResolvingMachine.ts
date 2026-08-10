// phase-29: usePaneResolvingMachine — single authoritative pane-entry state machine (SPEC req 1, 3)
/**
 * Single authoritative pane-entry state machine for pretty-view panes —
 * the phase-29 replacement for the ~6 racing local useStates in
 * PrettyView.tsx (isBooting, isHolding, showOverlay, holdingTimeoutError,
 * dormant, waking) whose independent arm/dismiss cycles produced Ashley's
 * 2026-08-10 flicker report (black-screen "Connecting…" on active panes,
 * "Connection lost" half-screen boxes, stale "Waking up…" on awake
 * sessions).
 *
 * WHY THIS EXISTS (Ashley's 2026-08-10 diagnosis, tiffany's follow-up):
 *
 * The pre-phase-29 PrettyView hosted ~5 independent overlay-driving
 * state machines. On every pane-entry edge (cold mount, warm hidden→
 * visible re-focus, PWA foreground), each of those machines began its
 * own arm/dismiss cycle simultaneously and raced to paint. There was
 * no single source of truth for "what state is this pane in right
 * now"; the visible UI was whichever overlay's setTimeout fired first.
 *
 * This hook consolidates all pane-entry state into ONE deterministic
 * machine driven by exactly two resolution inputs (SPEC req 3):
 * `wsState` (from the pretty-view WS layer's retry ladder) and
 * `backendFirstFrame` (the first observation the backend reports after
 * `connectToPane` is sent). Every input combination maps to exactly
 * one terminal `Phase` via the pure `resolvePhase()` reducer from
 * plan 29-01 — no race, no timing heuristic.
 *
 * The three entry-trigger edges (cold mount via paneKey change, warm
 * hidden→visible re-focus via isVisible edge, PWA foreground via
 * document.visibilitychange) all re-arm the machine's internal
 * `resolving` state through ONE shared code path — a single sentinel
 * ref flip (`hasResolvedThisPaneRef.current = false`) + one setState
 * call (`setIsResolving(true)`). This is the SPEC req 1 "single shared
 * entry code path" invariant.
 *
 * TWO-MODE SEMANTIC (D-10 / D-11 / D-12):
 *
 * The machine has two operating modes:
 *
 *   1. Initial-resolving mode — entered on any of the three entry
 *      triggers. `phase` is forced to "resolving" (via `isResolving`
 *      local state) regardless of `resolvePhase()`'s output until the
 *      inputs settle (i.e. `resolvePhase()` returns something other
 *      than "resolving"). At that moment, `hasResolvedThisPaneRef`
 *      flips true and `isResolving` flips false.
 *
 *   2. Post-resolve steady state — `phase` mirrors `resolvePhase(wsState,
 *      backendFirstFrame)` directly on every render. A backend re-emit
 *      that flips backendFirstFrame from "active" to "dormant" produces
 *      `phase === "dormant"` on the next render WITHOUT going through
 *      "resolving" (D-11 clean swap). Only the three named entry
 *      triggers can re-arm resolving mode (D-10).
 *
 * NOTE on wsState regressions post-resolve: if wsState regresses to
 * "opening" (transient WS drop) after resolution, `resolvePhase()`
 * deterministically returns "resolving" and `phase` visibly transitions
 * back to "resolving" on the render. This is NOT a violation of D-10;
 * D-10 governs whether the machine re-arms its INTERNAL resolving-mode
 * flag, not whether the derived phase can visibly display "resolving"
 * when inputs regress. The internal `hasResolvedThisPaneRef` stays
 * true; only the three entry triggers can re-arm it.
 *
 * SETTIMEOUT INVARIANT (SPEC req 5):
 *
 * This file contains EXACTLY ONE setTimeout — the 150ms spinner
 * delay-arm effect (D-04). NO watchdog timers, NO resolve-to-error
 * deadlines, NO wall-clock heuristics. Only the WS layer's own
 * `failed-permanently` terminal signal can transition `phase` to
 * "error". Enforced by grep gate in plan 29-04.
 *
 * NO WS / SESSION-RECYCLING-STORE SUBSCRIPTIONS INSIDE THIS HOOK:
 *
 * `wsState` and `backendFirstFrame` are passed in as controlled
 * parameters by the caller (plan 29-04's PrettyView rewire). This is
 * what makes the hook testable without mocking WS or backend
 * infrastructure — plan 29-01's `resolve-phase.test.ts` covers the
 * truth-table exhaustively, and this hook's tests exercise only the
 * hook-behavior concerns: entry-trigger edges, spinner delay-arm,
 * post-resolve steady state, requestRetry callback.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  resolvePhase,
  type WsState,
  type BackendFirstFrame,
  type Phase,
} from "./resolve-phase";

// phase-29: resolution inputs — wsState + backendFirstFrame ONLY (SPEC req 3; no third axis)
/**
 * Controlled inputs to the pane-entry state machine.
 *
 * `hostId` + `tmuxSession` together form the paneKey sentinel used by
 * the cold-mount entry trigger — a change to either resets the
 * machine's `hasResolvedThisPaneRef` and re-arms resolving.
 *
 * `isVisible` is an entry TRIGGER (its false→true edge re-arms
 * resolving), not a resolution input. It is intentionally NOT passed
 * to `resolvePhase()`.
 *
 * `wsState` and `backendFirstFrame` are the two resolution inputs
 * per SPEC req 3. No third axis. The two names appear in both the
 * deps interface AND the result interface for symmetry, and the
 * anchor comment above is the structural-grep anchor plan 29-04
 * uses to enforce "exactly two resolution inputs".
 */
export interface UsePaneResolvingMachineDeps {
  hostId: number | null;
  tmuxSession: string | null;
  isVisible: boolean;
  wsState: WsState;
  backendFirstFrame: BackendFirstFrame;
}

/**
 * Result shape returned by the hook.
 *
 *   - `wsState` / `backendFirstFrame` — echoed through from inputs for
 *     consumer convenience (e.g. plan 29-04's PrettyView passing them
 *     to child overlay props without needing to thread them separately).
 *   - `phase` — the derived terminal phase. Exactly one of the six
 *     values from the `Phase` union in resolve-phase.ts.
 *   - `showSpinner` — the delay-armed spinner-mount flag. False during
 *     the first ~150ms of the resolving phase; flips true only if the
 *     resolving phase is still active at 150ms. Flips false immediately
 *     when the resolving phase ends (or the hook unmounts).
 *   - `requestRetry` — user-gesture callback for the D-09 retry button
 *     inside PrettyViewErrorOverlay. Same shape as DormancyOverlay's
 *     Wake button. Fires a synthetic entry-trigger edge.
 */
export interface UsePaneResolvingMachineResult {
  wsState: WsState;
  backendFirstFrame: BackendFirstFrame;
  phase: Phase;
  showSpinner: boolean;
  requestRetry: () => void;
}

/**
 * Hook implementation — composes four sub-patterns from PATTERNS.md §2:
 *
 *   (a) Ref-mirror for stale-closure protection (isVisibleRef)
 *   (b) prevIsVisibleRef edge detector for the warm re-focus trigger
 *   (c) paneKeyRef sentinel for the cold-mount trigger
 *   (d) Delay-arm useEffect for the 150ms spinner mount (patch #74 template)
 *
 * All three entry-trigger edges converge on the shared code path:
 *   `hasResolvedThisPaneRef.current = false; setIsResolving(true);`
 * This is the SPEC req 1 "one shared code path" invariant. Grep-gate
 * in plan 29-04 verifies exactly three call sites for this pair.
 */
export function usePaneResolvingMachine(
  deps: UsePaneResolvingMachineDeps,
): UsePaneResolvingMachineResult {
  const { hostId, tmuxSession, isVisible, wsState, backendFirstFrame } = deps;

  // paneKey — the cold-mount sentinel. Change in either hostId or
  // tmuxSession is a fresh pane; reset resolution state.
  const paneKey = `${hostId}:${tmuxSession ?? ""}`;

  // Per-pane resolution sentinel. Flips true the moment inputs first
  // settle (derivedTerminalPhase leaves "resolving"). Reset to false by
  // any of the three entry-trigger edges (cold mount, warm re-focus,
  // PWA foreground) or by requestRetry().
  const paneKeyRef = useRef<string>(paneKey);
  const hasResolvedThisPaneRef = useRef<boolean>(false);

  // Input snapshot captured at re-arm time. When the machine has
  // ALREADY resolved once on this pane (hasResolvedThisPaneRef=true at
  // the moment an entry trigger fires), the resolution detector below
  // only fires the "leave resolving" transition when the current inputs
  // DIFFER from this snapshot — i.e. after the caller has observably
  // changed either wsState or backendFirstFrame since the most recent
  // entry-trigger edge. This is what makes the three entry triggers
  // observable in the "already resolved" case: a re-arm with already-
  // settled inputs keeps the machine in "resolving" until the next
  // input change, matching the real-world lifecycle where any entry
  // trigger in production is immediately followed by a WS close+reopen
  // cycle that flips inputs through the "opening" / "not-yet" transient
  // before re-settling.
  //
  // On the INITIAL mount (hasResolvedThisPaneRef=false), no snapshot
  // gating applies — the machine resolves as soon as inputs settle
  // (the caller-provided inputs at mount time ARE the initial verdict).
  const rearmSnapshotRef = useRef<{
    wsState: WsState;
    backendFirstFrame: BackendFirstFrame;
  } | null>(null);

  // Initial mount is always in the resolving phase until inputs settle
  // (SPEC req 1 — every entry-trigger enters resolving).
  const [isResolving, setIsResolving] = useState<boolean>(true);

  // Derive terminal phase from the pure reducer every render. When
  // isResolving is true we force "resolving" regardless; when false
  // (post-resolve steady state per D-10/D-11) the derived value is
  // what the caller sees, so a backend re-emit that flips
  // backendFirstFrame from "active" to "dormant" produces
  // phase="dormant" on the next render without going through
  // "resolving" (D-11 clean swap).
  const derivedTerminalPhase = resolvePhase(wsState, backendFirstFrame);
  const phase: Phase = isResolving ? "resolving" : derivedTerminalPhase;

  // ── Ref mirror for stale-closure protection in the document
  // visibilitychange handler (PATTERNS.md §2a). The handler reads
  // isVisibleRef.current so pane-visibility gating is fresh without
  // re-registering the listener on every isVisible change.
  const isVisibleRef = useRef<boolean>(isVisible);
  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  // ── Cold-mount trigger (paneKey change). Fresh pane resets the
  // per-pane resolution sentinel and re-arms resolving. This is entry
  // trigger #1 of 3. Captures an input snapshot IF the pane has
  // already resolved once on the prior paneKey — so a re-mount into
  // pre-settled inputs still observably enters "resolving" until the
  // next input change (matches real-world WS close+reopen cycle).
  useEffect(() => {
    if (paneKey !== paneKeyRef.current) {
      if (hasResolvedThisPaneRef.current) {
        rearmSnapshotRef.current = { wsState, backendFirstFrame };
      }
      paneKeyRef.current = paneKey;
      hasResolvedThisPaneRef.current = false;
      setIsResolving(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneKey]);

  // ── Warm re-focus trigger (isVisible false→true edge). Uses the
  // prevIsVisibleRef pattern from quick-260809-cnx (PrettyView.tsx
  // L1367-1389). Initial ref value = current isVisible is LOAD-BEARING
  // — prevents the initial mount from tripping a false-positive edge
  // when isVisible=true from the start. This is entry trigger #2 of 3.
  const prevIsVisibleRef = useRef<boolean>(isVisible);
  useEffect(() => {
    const prev = prevIsVisibleRef.current;
    prevIsVisibleRef.current = isVisible;
    if (!prev && isVisible) {
      if (hasResolvedThisPaneRef.current) {
        rearmSnapshotRef.current = { wsState, backendFirstFrame };
      }
      hasResolvedThisPaneRef.current = false;
      setIsResolving(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isVisible]);

  // ── PWA foreground trigger (document.visibilitychange visible edge).
  // Mirrors PrettyView.tsx:1315-1343 handler shape. Only re-arms if
  // the pane itself is currently visible; if the pane is hidden, the
  // warm re-focus trigger above will handle re-arming when isVisible
  // next flips true (avoids double-arming during the transient window
  // where document is visible but pane hasn't yet been shown). This is
  // entry trigger #3 of 3. deps: [] — mount-once; reads isVisibleRef +
  // wsStateRef + backendFirstFrameRef to avoid re-registering on every
  // input change.
  const wsStateRef = useRef<WsState>(wsState);
  const backendFirstFrameRef = useRef<BackendFirstFrame>(backendFirstFrame);
  useEffect(() => {
    wsStateRef.current = wsState;
  }, [wsState]);
  useEffect(() => {
    backendFirstFrameRef.current = backendFirstFrame;
  }, [backendFirstFrame]);
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (!isVisibleRef.current) return;
      if (hasResolvedThisPaneRef.current) {
        rearmSnapshotRef.current = {
          wsState: wsStateRef.current,
          backendFirstFrame: backendFirstFrameRef.current,
        };
      }
      hasResolvedThisPaneRef.current = false;
      setIsResolving(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  // ── Resolution detector. Runs whenever inputs change while
  // isResolving is true. Two-mode gating:
  //
  //   - No re-arm snapshot (initial mount OR post-resolve requestRetry
  //     with no snapshot): resolve as soon as derivedTerminalPhase
  //     leaves "resolving".
  //   - Re-arm snapshot present (one of the three entry triggers fired
  //     on an already-resolved pane): resolve only when the CURRENT
  //     inputs differ from the snapshot AND derivedTerminalPhase !==
  //     "resolving". This is what makes an entry-trigger on a pre-
  //     settled pane observably enter "resolving" until the next input
  //     change (matches real-world WS close+reopen cycle).
  //
  // On successful resolution, the snapshot is cleared so subsequent
  // input flips in post-resolve steady state don't re-trigger.
  useEffect(() => {
    if (!isResolving) return;
    if (derivedTerminalPhase === "resolving") return;
    const snapshot = rearmSnapshotRef.current;
    if (
      snapshot !== null &&
      snapshot.wsState === wsState &&
      snapshot.backendFirstFrame === backendFirstFrame
    ) {
      // Inputs are still identical to the snapshot captured at re-arm
      // — the caller has not yet advanced the WS lifecycle. Wait.
      return;
    }
    rearmSnapshotRef.current = null;
    hasResolvedThisPaneRef.current = true;
    setIsResolving(false);
  }, [isResolving, derivedTerminalPhase, wsState, backendFirstFrame]);

  // ── Spinner delay-arm (D-04 — the ONLY setTimeout in this file).
  // Mirrors patch #74's showOverlay delay-arm at PrettyView.tsx:
  // 1416-1436, retargeted from isHolding to phase === "resolving" and
  // from 350ms to 150ms (D-06). Genuinely-instant resolutions where
  // inputs settle in <150ms never mount the spinner — the phase leaves
  // "resolving" before the timer fires, the cleanup clears the timer,
  // and showSpinner stays false throughout.
  const [showSpinner, setShowSpinner] = useState<boolean>(false);
  useEffect(() => {
    if (phase !== "resolving") {
      setShowSpinner(false);
      return;
    }
    const t = setTimeout(() => { // phase-29: spinner delay-arm (D-04, D-05, D-06) — 150ms; ONLY setTimeout in this file
      setShowSpinner(true);
    }, 150);
    return () => {
      clearTimeout(t);
    };
  }, [phase]);

  // ── requestRetry (D-09). User-gesture callback fired from the
  // PrettyViewErrorOverlay Retry button (same UX shape as
  // DormancyOverlay's Wake button). Enters resolving via the SAME
  // shared code path as the three entry triggers. If the pane has
  // already resolved once, capture an input snapshot so the retry
  // observably enters "resolving" until the caller advances the WS
  // lifecycle in response — matching the D-09 UX contract where the
  // Retry button starts a fresh reconnect cycle.
  const requestRetry = useCallback(() => {
    if (hasResolvedThisPaneRef.current) {
      rearmSnapshotRef.current = {
        wsState: wsStateRef.current,
        backendFirstFrame: backendFirstFrameRef.current,
      };
    }
    hasResolvedThisPaneRef.current = false;
    setIsResolving(true);
  }, []);

  return { wsState, backendFirstFrame, phase, showSpinner, requestRetry };
}
