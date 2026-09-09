/**
 * Phase 91 Plan 01 — form-state hook for the new-conversation modal.
 *
 * Owns: picked participant set, room name, search query, submitting flag,
 * error string, gate evaluation. All state is client-side derivation — no
 * fetch calls. The modal (Plan 05) fetches humans + agents and passes them
 * in; this hook derives available lists, filtering, sorting, and gate.
 */

import { useState, useMemo, useCallback } from "react";
import type { PickedParticipant, GateState } from "./participant-types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UseNewConversationFormOpts {
  /** All human participants (BasicUser → PickedParticipant shaped by the modal).
   *  Null-mxid users must be filtered BEFORE being passed in (Plan 05 enforcement). */
  humans: PickedParticipant[];

  /** All agent participants (Identity → PickedParticipant shaped by the modal).
   *  Agents whose mxid cannot be derived are filtered out by the modal. */
  agents: PickedParticipant[];

  /** The viewing user's Matrix ID. Used for self-exclusion from the humans list.
   *  null disables self-exclusion (hook returns all humans unfiltered). */
  viewingUserMxid: string | null;
}

export interface UseNewConversationFormReturn {
  roomName: string;
  setRoomName: (s: string) => void;
  searchQuery: string;
  setSearchQuery: (s: string) => void;
  /** Currently-picked participants (humans first, then agents), derived from pickedMxids. */
  picked: PickedParticipant[];
  /** Humans filtered by self-exclusion + search + sorted by displayName.localeCompare. */
  availableHumans: PickedParticipant[];
  /** Agents filtered by search + sorted by displayName.localeCompare. */
  availableAgents: PickedParticipant[];
  /** Toggle a participant in/out of the picked set by mxid. */
  toggle: (mxid: string) => void;
  /** Remove a participant from the picked set by mxid (idempotent). */
  remove: (mxid: string) => void;
  /** Gate evaluation — drives Create button enabled/disabled + hint text. */
  gate: GateState;
  submitting: boolean;
  setSubmitting: (b: boolean) => void;
  error: string | null;
  setError: (s: string | null) => void;
  /**
   * Reset all form state to initial values.
   * Called by the modal when open transitions to false (M1 fix: prevents stale
   * state across re-open cycles — roomName, pickedMxids, searchQuery, error all
   * reset to empty so the next open sees a clean slate).
   */
  reset: () => void;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/**
 * Form-state hook for the new-conversation modal.
 *
 * Signature conforms to the shape locked in 91-PATTERNS.md § useNewConversationForm.ts.
 * All state is pure client-side derivation — no API calls are made here.
 * The modal (Plan 05) calls the API on submit.
 */
export function useNewConversationForm(
  opts: UseNewConversationFormOpts,
): UseNewConversationFormReturn {
  const { humans, agents, viewingUserMxid } = opts;

  // ─── Raw state ─────────────────────────────────────────────────────────────
  const [roomName, setRoomName] = useState<string>("");
  const [pickedMxids, setPickedMxids] = useState<Set<string>>(new Set<string>());
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // ─── Derived: availableHumans ───────────────────────────────────────────────
  // (a) self-exclude (skip when viewingUserMxid is null)
  // (b) case-insensitive substring filter by displayName
  // (c) alphabetical sort by displayName.localeCompare
  const availableHumans = useMemo<PickedParticipant[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    return humans
      .filter((h) => viewingUserMxid === null || h.mxid !== viewingUserMxid)
      .filter((h) => q === "" || h.displayName.toLowerCase().includes(q))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [humans, viewingUserMxid, searchQuery]);

  // ─── Derived: availableAgents ───────────────────────────────────────────────
  // No self-exclusion for agents (agents are never the viewing user).
  // (a) case-insensitive substring filter by displayName
  // (b) alphabetical sort by displayName.localeCompare
  const availableAgents = useMemo<PickedParticipant[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    return agents
      .filter((a) => q === "" || a.displayName.toLowerCase().includes(q))
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [agents, searchQuery]);

  // ─── Derived: picked ──────────────────────────────────────────────────────
  // Humans-first then agents order mirrors the chips-strip visual expectation
  // (PATTERNS.md §ParticipantChipStrip — humans picked before agents in the set).
  const picked = useMemo<PickedParticipant[]>(() => {
    const h = humans.filter((p) => pickedMxids.has(p.mxid));
    const a = agents.filter((p) => pickedMxids.has(p.mxid));
    return [...h, ...a];
  }, [humans, agents, pickedMxids]);

  // ─── Derived: gate ────────────────────────────────────────────────────────
  // Priority order per shape §Shape "disabled until three conditions hold"
  // plus the submitting debounce lock (T-91-FE-01, shape §What would make
  // it wrong "Two rapid clicks on Create produce two rooms").
  const gate = useMemo<GateState>(() => {
    if (submitting) {
      return { ok: false, reason: 'submitting' };
    }
    if (roomName.trim() === "") {
      return { ok: false, reason: 'no-room-name' };
    }
    if (pickedMxids.size === 0) {
      return { ok: false, reason: 'no-participants' };
    }
    if (picked.length === 1 && picked[0].role === 'agent') {
      // Single-agent-alone disallowed — UX coherence guard (shape §Philosophy).
      return { ok: false, reason: 'single-agent-only' };
    }
    return { ok: true };
  }, [submitting, roomName, pickedMxids, picked]);

  // ─── Callbacks ────────────────────────────────────────────────────────────

  /** Toggle a participant in/out of the picked set by mxid. */
  const toggle = useCallback((mxid: string) => {
    setPickedMxids((prev) => {
      const next = new Set(prev);
      if (next.has(mxid)) {
        next.delete(mxid);
      } else {
        next.add(mxid);
      }
      return next;
    });
  }, []);

  /** Remove a participant from the picked set by mxid (idempotent — unknown mxid is no-op). */
  const remove = useCallback((mxid: string) => {
    setPickedMxids((prev) => {
      const next = new Set(prev);
      next.delete(mxid);
      return next;
    });
  }, []);

  /**
   * Reset all form state to initial values (M1 fix).
   * Called by the modal when open transitions to false so the next open
   * sees a clean slate (no stale roomName, picks, searchQuery, or error).
   */
  const reset = useCallback(() => {
    setRoomName("");
    setPickedMxids(new Set<string>());
    setSearchQuery("");
    setSubmitting(false);
    setError(null);
  }, []);

  return {
    roomName,
    setRoomName,
    searchQuery,
    setSearchQuery,
    picked,
    availableHumans,
    availableAgents,
    toggle,
    remove,
    gate,
    submitting,
    setSubmitting,
    error,
    setError,
    reset,
  };
}
