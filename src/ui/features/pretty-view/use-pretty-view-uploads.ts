/**
 * usePrettyViewUploads — client-side orchestrator hook for pretty-view file
 * uploads.
 *
 * Owns:
 *   - Staged-attachment React state (tempId, file ref, status, bytesUploaded, error)
 *   - The chunk pump: reads File slices, base64-encodes, emits upload_chunk
 *   - Concurrency gating (MAX_CONCURRENT_UPLOADS_PER_BATCH per batch)
 *   - Backpressure via WS.bufferedAmount polling (>4MB pauses, <1MB resumes)
 *   - Batch atomicity + the caller-provided onUploadReadyToInject callback
 *   - Retry API (returns new batch id by default; reuseIdOnRetry=true reuses)
 *   - WS disconnect / reconnect resume semantics
 *   - Folder-drop refusal (auto-clears after 3s)
 *
 * Does NOT own:
 *   - The WebSocket itself (caller passes it in; hook attaches a message
 *     listener that filters to upload_* server events)
 *   - The caption text (caller manages it via ComposeBox; hook captures a
 *     snapshot at startBatch time)
 *   - Persistence — the entire state model is React-only. No browser
 *     storage primitives of any kind are touched here. Attachment bytes
 *     MUST NOT survive tab close (UPLOAD-08 HARD LOCK).
 *
 * Wire protocol contract: `src/ui/api/pretty-view-upload-protocol.ts` is
 * the single source of truth for payload/event shapes and constants. This
 * hook imports every type from there — do NOT redeclare shapes locally.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CHUNK_SIZE_BYTES,
  MAX_CONCURRENT_UPLOADS_PER_BATCH,
  type PrettyViewUploadServerEvent,
  type UploadStartFileDescriptor,
  type UploadChunkPayload,
  type UploadStartPayload,
  type UploadAbortPayload,
  type UploadReadyToInjectFileSummary,
} from "@/api/pretty-view-upload-protocol";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StagedAttachmentStatus =
  | "staged"
  | "uploading"
  | "complete"
  | "error";

export interface StagedAttachment {
  tempId: string;
  file: File;
  status: StagedAttachmentStatus;
  bytesUploaded: number;
  error: string | null;
}

// ---------------------------------------------------------------------------
// Quick 260823-8ji: per-batch outcome contract.
//
// Every startBatch / retryBatch invocation returns an `outcome` Promise
// alongside `messageQueueItemId`. The Promise resolves exactly ONCE:
//
//   upload_ready_to_inject arrives  → { ok: true }
//   upload_failed arrives           → { ok: false, reason: "upload_failed",
//                                        message: `${event.reason}: ${event.message}` }
//   No terminal event within 30s    → { ok: false, reason: "timeout" }
//   startBatch(ws=null)             → { ok: false, reason: "ws_not_open" }
//   ws.send throws                  → { ok: false, reason: "ws_send_threw" }
//   resetBatch / reused-id retry    → OLD outcome { ok: false, reason: "superseded" }
//
// ComposeBox awaits `outcome` on the attachment path to decide whether to
// clear the compose textarea + attachment chips (ok) or preserve them and
// surface an inline error (!ok). Previously the attachment path was fire-
// and-forget, silently clearing the compose state even on WS drop / upload
// backend never emitting upload_ready_to_inject (Ashley hit this four times
// on 2026-08-23 across wanda + nelly — bug directive quick-260823-8ji).
// ---------------------------------------------------------------------------

export type BatchFailureReason =
  | "upload_failed"
  | "timeout"
  | "ws_not_open"
  | "ws_send_threw"
  | "superseded";

export type BatchOutcome =
  | { ok: true }
  | { ok: false; reason: BatchFailureReason; message?: string };

export interface UsePrettyViewUploadsDeps {
  /** Live WebSocket for the pane, or null if not yet connected. */
  ws: WebSocket | null;
  /**
   * Fires exactly once per batch after upload_ready_to_inject arrives from
   * the server. Caller wires this to Terminal.tsx's sendInput seam so the
   * injected user turn flows through the existing patch #100 split-and-delay
   * path with the SAME messageQueueItemId (patch #60 atomic delete-on-send).
   */
  onUploadReadyToInject: (input: {
    messageQueueItemId: string;
    files: UploadReadyToInjectFileSummary[];
    caption: string;
  }) => void;
  /**
   * Optional accessor for WebSocket.bufferedAmount. When it exceeds
   * BACKPRESSURE_HIGH_WATER_BYTES, chunk emission pauses; when it falls
   * below BACKPRESSURE_LOW_WATER_BYTES, it resumes. Callers pass
   * `() => ws.bufferedAmount` in production; tests can inject a stub.
   */
  getBufferedAmount?: () => number;
  /**
   * If true, retryBatch reuses the failed batch's messageQueueItemId.
   * If false (default), retryBatch generates a new id — matches the Plan
   * 01 assumption (no upload_reset message; retry looks like a fresh batch
   * server-side). The frontend surfaces retry as "starting over with the
   * same files + same caption" regardless of which mode is chosen.
   */
  reuseIdOnRetry?: boolean;
}

// Quick 260802-wxy: staged attachments are keyed by a string `target` so multiple
// consumers (primary composebox, per-queued-slot textareas — Quick B) can each
// own an independent chip strip without cross-contamination. The convention is
// a bare string (no enum enforcement) — "primary" is the only producer in
// Quick A. Quick B will introduce additional target strings (e.g., queueSlot
// ids). The legacy `stagedAttachments` return field always mirrors the
// "primary" target so existing consumers (ComposeBox) see NO behavior change.
export interface UsePrettyViewUploadsReturn {
  stagedAttachments: StagedAttachment[];
  folderDropRejected: boolean;
  batchInFlight: boolean;
  pendingSendWaitingForWs: boolean;
  stageAttachments: (
    target: string,
    items: File[] | DataTransferItemList | FileList,
  ) => void;
  getStagedAttachments: (target: string) => StagedAttachment[];
  removeAttachment: (tempId: string) => void;
  // Quick 260803-05i: clear ONE target's staged attachments (aborts any
  // in-flight pump loops for that target's tempIds; leaves other targets
  // untouched). Used by ComposeBox when a queued slot is deleted — slot
  // removal must also purge its per-slot staging so a re-added slot with
  // the same id doesn't inherit stale entries (defense-in-depth; slot ids
  // are UUIDs so collision is effectively impossible, but the invariant
  // matters for correctness).
  clearStagedForTarget: (target: string) => void;
  // Quick 260823-8ji: return shape widened to include a per-batch outcome
  // Promise (see BatchOutcome docblock above). Existing callers that only
  // read `.messageQueueItemId` see NO behavior change (extra property is
  // ignored on destructure).
  startBatch: (
    caption: string,
  ) => Promise<{
    messageQueueItemId: string;
    outcome: Promise<BatchOutcome>;
  } | null>;
  retryBatch: () => Promise<{
    messageQueueItemId: string;
    outcome: Promise<BatchOutcome>;
  } | null>;
  resetBatch: () => void;
  onWsReconnect: () => void;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BACKPRESSURE_HIGH_WATER_BYTES = 4 * 1024 * 1024; // 4 MB — pause above
const BACKPRESSURE_LOW_WATER_BYTES = 1 * 1024 * 1024; // 1 MB — resume below
const BACKPRESSURE_POLL_MS = 50;
const BACKPRESSURE_HARD_TIMEOUT_ITERATIONS = 60; // ~3 s stuck → give up
const FOLDER_REJECTION_MS = 3000;
// Quick 260823-8ji: per-batch outcome timeout. If no terminal event
// (upload_ready_to_inject | upload_failed) arrives within this window
// after upload_start dispatch, the outcome resolves { ok:false,
// reason:"timeout" } so the compose surface can flag the send as failed
// and preserve the textarea + attachment chips. 30s is empirically
// generous — a healthy paste_send round-trip is single-digit seconds;
// anything beyond 30s is either a WS disruption or a backend hang.
// Backend has no matching PASTE_SEND_TIMEOUT_MS constant to align with
// (verified 2026-08-23), so 30_000 is authoritative on the client side.
const BATCH_OUTCOME_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePrettyViewUploads(
  deps: UsePrettyViewUploadsDeps,
): UsePrettyViewUploadsReturn {
  // Quick 260802-wxy: per-target staging state. Map<target, StagedAttachment[]>
  // where target is a bare string (no enum enforcement). "primary" is the only
  // producer in Quick A; Quick B will introduce additional targets. The state
  // Map is treated immutably (each update constructs a NEW Map) so React's
  // reference-equality bail-out fires re-renders reliably.
  const [stagedAttachmentsByTarget, setStagedAttachmentsByTarget] = useState<
    Map<string, StagedAttachment[]>
  >(() => new Map());
  const [folderDropRejected, setFolderDropRejected] = useState(false);
  const [batchInFlight, setBatchInFlight] = useState(false);
  const [pendingSendWaitingForWs, setPendingSendWaitingForWs] = useState(false);

  // Mirror stagedAttachmentsByTarget in a ref so the chunk pump (async loop)
  // can read the freshest state per-target without stale-closure surprises.
  // Every setAttachments call also updates the ref synchronously with a fresh
  // Map clone.
  const attachmentsRefByTarget = useRef<Map<string, StagedAttachment[]>>(
    new Map(),
  );
  const setAttachments = useCallback(
    (
      target: string,
      updater:
        | StagedAttachment[]
        | ((prev: StagedAttachment[]) => StagedAttachment[]),
    ) => {
      setStagedAttachmentsByTarget((prevMap) => {
        const prev = prevMap.get(target) ?? [];
        const next =
          typeof updater === "function"
            ? (updater as (p: StagedAttachment[]) => StagedAttachment[])(prev)
            : updater;
        // Construct a NEW Map so reference-equality changes and React
        // re-renders consumers of stagedAttachmentsByTarget.
        const nextMap = new Map(prevMap);
        nextMap.set(target, next);
        // Keep the ref in lockstep: clone (so callers holding a reference
        // don't see mutations under them) then set the same target key.
        const nextRefMap = new Map(attachmentsRefByTarget.current);
        nextRefMap.set(target, next);
        attachmentsRefByTarget.current = nextRefMap;
        return nextMap;
      });
    },
    [],
  );

  // Batch identity: preserved across retries when reuseIdOnRetry=true; also
  // reused when retryBatch is called and the id survives (see retry logic).
  const batchIdRef = useRef<string | null>(null);
  // Caption captured at startBatch time — snapshot, so caller can mutate
  // its own text state without affecting what the injected turn carries.
  const capturedCaptionRef = useRef<string>("");
  // Per-tempId last-sent offset — used by the pump so removeAttachment can
  // stop mid-file and retryBatch can (in the reuseId path) know where each
  // file left off.
  const lastOffsetSentRef = useRef<Map<string, number>>(new Map());
  // Per-tempId AbortController-like flag; the pump checks between chunks.
  const abortFlagsRef = useRef<Map<string, boolean>>(new Map());
  // Guard so multiple onUploadReadyToInject firings don't double-invoke.
  const readyFiredRef = useRef<boolean>(false);
  // Folder-rejection timer so remounts can clear it.
  const folderRejectionTimerRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  // Quick 260823-8ji: per-batch outcome resolver + 30s timeout handle.
  // Both keyed on batchId so a retryBatch that mints a new id gets a fresh
  // resolver + fresh timer without stomping the old one. Refs (not state)
  // because these are internal plumbing that must NOT drive re-renders.
  const outcomeResolversByBatchIdRef = useRef<
    Map<string, (o: BatchOutcome) => void>
  >(new Map());
  const batchTimeoutHandlesByBatchIdRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());

  // Quick 260823-8ji: disarm the 30s outcome timer for a batchId — idempotent.
  const clearBatchTimeout = useCallback((batchId: string) => {
    const handle = batchTimeoutHandlesByBatchIdRef.current.get(batchId);
    if (handle !== undefined) {
      clearTimeout(handle);
      batchTimeoutHandlesByBatchIdRef.current.delete(batchId);
    }
  }, []);

  // Quick 260823-8ji: pull the resolver, call it once, delete from the map,
  // clear the timeout. Safe to call multiple times — the second call is a
  // no-op because the resolver is gone from the map.
  const resolveOutcome = useCallback(
    (batchId: string, outcome: BatchOutcome) => {
      const resolver = outcomeResolversByBatchIdRef.current.get(batchId);
      if (resolver === undefined) return;
      outcomeResolversByBatchIdRef.current.delete(batchId);
      clearBatchTimeout(batchId);
      resolver(outcome);
    },
    [clearBatchTimeout],
  );

  // Quick 260823-8ji: arm the 30s "no terminal event" timer for a batch.
  // Fires resolveOutcome(batchId, { ok:false, reason:"timeout" }) which
  // also disarms itself via clearBatchTimeout (idempotent-safe).
  const armBatchTimeout = useCallback(
    (batchId: string) => {
      // Belt-and-suspenders: if a prior timer for this id exists (shouldn't
      // happen — startBatch/retryBatch always mint fresh ids or supersede
      // via resolveOutcome first), clear it before arming a new one.
      clearBatchTimeout(batchId);
      const handle = setTimeout(() => {
        resolveOutcome(batchId, { ok: false, reason: "timeout" });
      }, BATCH_OUTCOME_TIMEOUT_MS);
      batchTimeoutHandlesByBatchIdRef.current.set(batchId, handle);
    },
    [clearBatchTimeout, resolveOutcome],
  );

  const wsRef = useRef<WebSocket | null>(deps.ws);
  useEffect(() => {
    wsRef.current = deps.ws;
  }, [deps.ws]);

  const onReadyRef = useRef(deps.onUploadReadyToInject);
  useEffect(() => {
    onReadyRef.current = deps.onUploadReadyToInject;
  }, [deps.onUploadReadyToInject]);

  const getBufferedAmountRef = useRef(deps.getBufferedAmount);
  useEffect(() => {
    getBufferedAmountRef.current = deps.getBufferedAmount;
  }, [deps.getBufferedAmount]);

  const reuseIdOnRetry = !!deps.reuseIdOnRetry;

  // -------------------------------------------------------------------------
  // WS message handler — filter to upload_* server events, update state
  // -------------------------------------------------------------------------
  useEffect(() => {
    const ws = deps.ws;
    if (!ws) return;
    const handler = (event: MessageEvent | { data: string }) => {
      let parsed: PrettyViewUploadServerEvent | null = null;
      try {
        parsed = JSON.parse(
          (event as { data: string }).data,
        ) as PrettyViewUploadServerEvent;
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object" || !("type" in parsed)) return;
      // Ignore events for other batches (defense: same WS carries many
      // message types; the pane-level handler in Terminal.tsx or PrettyView
      // may or may not forward these to us).
      if (!isUploadEvent(parsed)) return;
      handleServerEvent(parsed);
    };
    // Use addEventListener to avoid trampling any onmessage the caller set.
    if (typeof (ws as unknown as { addEventListener?: unknown }).addEventListener === "function") {
      (ws as unknown as {
        addEventListener: (t: string, h: unknown) => void;
      }).addEventListener("message", handler);
    }
    return () => {
      if (typeof (ws as unknown as { removeEventListener?: unknown }).removeEventListener === "function") {
        (ws as unknown as {
          removeEventListener: (t: string, h: unknown) => void;
        }).removeEventListener("message", handler);
      }
    };
    // handleServerEvent is stable via useCallback below; only re-attach on
    // WS instance change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.ws]);

  const handleServerEvent = useCallback(
    (event: PrettyViewUploadServerEvent) => {
      // Only accept events for our current batch. If batchIdRef is null
      // (no batch has been started or we've reset), silently drop — some
      // other pane's events could be arriving on a shared WS.
      const ourBatch = batchIdRef.current;
      if (!ourBatch || event.messageQueueItemId !== ourBatch) return;

      switch (event.type) {
        case "upload_progress": {
          // Quick 260802-wxy: primary target — only the primary composebox
          // is a producer in Quick A. Server events for batches started
          // from Quick B's per-slot producers will still land here on the
          // "primary" branch until Quick B introduces per-target batch
          // identity (out of scope for this quick).
          setAttachments("primary", (prev) =>
            prev.map((a) =>
              a.tempId === event.tempId
                ? {
                    ...a,
                    status: "uploading",
                    bytesUploaded: event.bytesReceived,
                  }
                : a,
            ),
          );
          break;
        }
        case "upload_complete": {
          setAttachments("primary", (prev) =>
            prev.map((a) =>
              a.tempId === event.tempId
                ? {
                    ...a,
                    status: "complete",
                    bytesUploaded: a.file.size,
                  }
                : a,
            ),
          );
          break;
        }
        case "upload_failed": {
          // Quick 260823-8ji: resolve the batch outcome BEFORE mutating chip
          // state so any awaiter (ComposeBox attachment-path) sees the
          // failure signal on the same microtask as the chip flip. Per-file
          // upload_failed events (tempId present) still resolve the batch
          // outcome: atomicity semantics mean a per-file failure short-
          // circuits the whole batch (backend will not emit ready_to_inject),
          // so from ComposeBox's perspective the batch failed regardless.
          resolveOutcome(ourBatch, {
            ok: false,
            reason: "upload_failed",
            message: `${event.reason}: ${event.message}`,
          });
          setAttachments("primary", (prev) =>
            prev.map((a) => {
              if (event.tempId && a.tempId !== event.tempId) return a;
              // Batch-level failure (no tempId) → mark all in-flight/staged
              // as errored.
              if (!event.tempId && a.status === "complete") return a;
              return {
                ...a,
                status: "error",
                error: `${event.reason}: ${event.message}`,
              };
            }),
          );
          setBatchInFlight(false);
          break;
        }
        case "upload_ready_to_inject": {
          if (readyFiredRef.current) return;
          readyFiredRef.current = true;
          // Quick 260823-8ji: resolve the batch outcome with success BEFORE
          // firing the caller-supplied onUploadReadyToInject callback.
          // ComposeBox awaits this outcome before clearing the compose
          // textarea + attachment chips; resolving first keeps the ordering
          // "outcome → caller callback → compose clear" natural.
          resolveOutcome(ourBatch, { ok: true });
          const caption = capturedCaptionRef.current;
          const cb = onReadyRef.current;
          setBatchInFlight(false);
          if (cb) {
            cb({
              messageQueueItemId: event.messageQueueItemId,
              files: event.files,
              caption,
            });
          }
          break;
        }
      }
    },
    [setAttachments, resolveOutcome],
  );

  // -------------------------------------------------------------------------
  // Stage attachments (drag/drop/paste/paperclip all land here)
  // -------------------------------------------------------------------------
  const stageAttachments = useCallback(
    (
      target: string,
      items: File[] | DataTransferItemList | FileList,
    ) => {
      const { files, sawFolder } = normalizeToFiles(items);
      if (sawFolder) {
        // UPLOAD-12: folder drops refused all-or-nothing. Show the nudge for
        // ~3 s, do NOT stage any files even if the drop mixed files and a
        // folder.
        setFolderDropRejected(true);
        if (folderRejectionTimerRef.current) {
          clearTimeout(folderRejectionTimerRef.current);
        }
        folderRejectionTimerRef.current = setTimeout(() => {
          setFolderDropRejected(false);
          folderRejectionTimerRef.current = null;
        }, FOLDER_REJECTION_MS);
        return;
      }
      if (files.length === 0) return;
      const newlyStaged: StagedAttachment[] = files.map((f) => ({
        tempId: makeId(),
        file: f,
        status: "staged",
        bytesUploaded: 0,
        error: null,
      }));
      setAttachments(target, (prev) => [...prev, ...newlyStaged]);
    },
    [setAttachments],
  );

  // -------------------------------------------------------------------------
  // Remove attachment — emits upload_abort if the file was in flight
  // -------------------------------------------------------------------------
  const removeAttachment = useCallback(
    (tempId: string) => {
      // Quick 260802-wxy: tempIds are UUIDs — unique across all targets. Walk
      // every target to find which one owns the tempId, then remove from that
      // target only. (In Quick A only "primary" is a producer so the search
      // is trivial; the walk is future-proofing for Quick B's per-slot targets
      // without needing another refactor.)
      let owningTarget: string | null = null;
      let existing: StagedAttachment | undefined;
      for (const [tgt, list] of attachmentsRefByTarget.current) {
        const found = list.find((a) => a.tempId === tempId);
        if (found) {
          owningTarget = tgt;
          existing = found;
          break;
        }
      }
      if (!existing || owningTarget === null) return;

      // If in flight (or already complete but the batch hasn't fully wrapped),
      // signal the pump and tell the server to abort this file.
      if (existing.status === "uploading" || existing.status === "staged") {
        abortFlagsRef.current.set(tempId, true);
        const ws = wsRef.current;
        const batchId = batchIdRef.current;
        if (ws && batchId && batchInFlight) {
          const payload: UploadAbortPayload = {
            type: "upload_abort",
            messageQueueItemId: batchId,
            tempId,
          };
          try {
            ws.send(JSON.stringify(payload));
          } catch {
            // WS may be down — pump will bail anyway; caller has other UI.
          }
        }
      }
      setAttachments(owningTarget, (prev) =>
        prev.filter((a) => a.tempId !== tempId),
      );
    },
    [batchInFlight, setAttachments],
  );

  // -------------------------------------------------------------------------
  // startBatch — issue upload_start and kick the chunk pump
  // -------------------------------------------------------------------------
  const startBatch = useCallback(
    async (
      caption: string,
    ): Promise<{
      messageQueueItemId: string;
      outcome: Promise<BatchOutcome>;
    } | null> => {
      // Quick 260802-wxy: startBatch operates on the primary target for
      // Quick A. Quick B will parameterize target when queued slots produce
      // their own batches; leaving that migration explicit for now so this
      // quick's diff stays scoped to the state-model refactor.
      const currentAttachments =
        attachmentsRefByTarget.current.get("primary") ?? [];
      if (currentAttachments.length === 0) return null;

      // Fresh batch id (unless we're mid-retry and reuseIdOnRetry is set —
      // retryBatch handles that separately).
      const batchId = makeId();
      batchIdRef.current = batchId;
      capturedCaptionRef.current = caption;
      readyFiredRef.current = false;
      lastOffsetSentRef.current = new Map();
      abortFlagsRef.current = new Map();
      setBatchInFlight(true);
      setPendingSendWaitingForWs(false);

      // Quick 260823-8ji: mint the outcome Promise + stash its resolver.
      // If a prior resolver for THIS batchId somehow still exists (would
      // only happen if two startBatch calls used the same id, which
      // makeId() prevents — but defensive), supersede it first so no
      // dangling awaiter lingers.
      const priorResolver =
        outcomeResolversByBatchIdRef.current.get(batchId);
      if (priorResolver) {
        outcomeResolversByBatchIdRef.current.delete(batchId);
        clearBatchTimeout(batchId);
        priorResolver({ ok: false, reason: "superseded" });
      }
      let outcomeResolver!: (o: BatchOutcome) => void;
      const outcomePromise = new Promise<BatchOutcome>((res) => {
        outcomeResolver = res;
      });
      outcomeResolversByBatchIdRef.current.set(batchId, outcomeResolver);

      const startPayload: UploadStartPayload = {
        type: "upload_start",
        messageQueueItemId: batchId,
        files: currentAttachments.map<UploadStartFileDescriptor>((a) => ({
          tempId: a.tempId,
          filename: a.file.name,
          size: a.file.size,
          mimetype: a.file.type || "application/octet-stream",
        })),
      };

      const ws = wsRef.current;
      if (!ws) {
        setPendingSendWaitingForWs(true);
        // Quick 260823-8ji: WS is null → the send cannot fly at all. The
        // hook still latches pendingSendWaitingForWs so onWsReconnect can
        // pick this up when the WS returns, but the immediate outcome is
        // a failure so ComposeBox can surface an inline "not connected"
        // error and preserve compose state for retry.
        resolveOutcome(batchId, { ok: false, reason: "ws_not_open" });
        return { messageQueueItemId: batchId, outcome: outcomePromise };
      }
      try {
        ws.send(JSON.stringify(startPayload));
      } catch {
        setPendingSendWaitingForWs(true);
        // Quick 260823-8ji: ws.send() threw → same posture as ws=null case.
        resolveOutcome(batchId, { ok: false, reason: "ws_send_threw" });
        return { messageQueueItemId: batchId, outcome: outcomePromise };
      }

      // Quick 260823-8ji: WS accepted upload_start — arm the 30s "no
      // terminal event" timer. Cleared by resolveOutcome on any terminal
      // path (ready_to_inject | upload_failed | supersede | reset).
      armBatchTimeout(batchId);
      // Kick the pump (fire and forget — the promise we return resolves
      // as soon as upload_start has been issued, not when uploads finish).
      void pumpBatch(batchId);
      return { messageQueueItemId: batchId, outcome: outcomePromise };
    },
    // pumpBatch is defined inside the hook body below via useCallback but
    // we intentionally omit it from deps to avoid infinite re-creation
    // (its own closure reads refs, not state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [armBatchTimeout, clearBatchTimeout, resolveOutcome],
  );

  // -------------------------------------------------------------------------
  // retryBatch — restart from the currently-staged attachments
  // -------------------------------------------------------------------------
  const retryBatch = useCallback(
    async (): Promise<{
      messageQueueItemId: string;
      outcome: Promise<BatchOutcome>;
    } | null> => {
      // Quick 260802-wxy: retryBatch operates on the primary target (Quick A).
      // Symmetric with startBatch — will be parameterized in Quick B.
      const currentAttachments =
        attachmentsRefByTarget.current.get("primary") ?? [];
      if (currentAttachments.length === 0) return null;

      // Files to re-upload: errored + still-staged. Completed files are
      // left in place (their landing paths persist server-side on the
      // reuseIdOnRetry path, and in the fresh-id path Plan 01 treats the
      // retry as a new batch so completes will re-fire).
      const filesToRetry = currentAttachments.filter(
        (a) => a.status !== "complete",
      );
      if (filesToRetry.length === 0) return null;

      const batchId = reuseIdOnRetry && batchIdRef.current
        ? batchIdRef.current
        : makeId();
      batchIdRef.current = batchId;
      readyFiredRef.current = false;
      lastOffsetSentRef.current = new Map();
      abortFlagsRef.current = new Map();
      // Reset per-file state on the retried files (primary target).
      setAttachments("primary", (prev) =>
        prev.map((a) =>
          a.status === "complete"
            ? a
            : { ...a, status: "staged", bytesUploaded: 0, error: null },
        ),
      );
      setBatchInFlight(true);
      setPendingSendWaitingForWs(false);

      // Quick 260823-8ji: mint the outcome Promise for this retry. If we
      // reused the id (reuseIdOnRetry=true) and a prior resolver is still
      // pending, supersede it FIRST so the caller of the initial batch
      // doesn't await forever. Fresh-id path never collides.
      const priorResolver =
        outcomeResolversByBatchIdRef.current.get(batchId);
      if (priorResolver) {
        outcomeResolversByBatchIdRef.current.delete(batchId);
        clearBatchTimeout(batchId);
        priorResolver({ ok: false, reason: "superseded" });
      }
      let outcomeResolver!: (o: BatchOutcome) => void;
      const outcomePromise = new Promise<BatchOutcome>((res) => {
        outcomeResolver = res;
      });
      outcomeResolversByBatchIdRef.current.set(batchId, outcomeResolver);

      const startPayload: UploadStartPayload = {
        type: "upload_start",
        messageQueueItemId: batchId,
        files: filesToRetry.map<UploadStartFileDescriptor>((a) => ({
          tempId: a.tempId,
          filename: a.file.name,
          size: a.file.size,
          mimetype: a.file.type || "application/octet-stream",
        })),
      };

      const ws = wsRef.current;
      if (!ws) {
        setPendingSendWaitingForWs(true);
        // Quick 260823-8ji: mirror startBatch's ws-null posture.
        resolveOutcome(batchId, { ok: false, reason: "ws_not_open" });
        return { messageQueueItemId: batchId, outcome: outcomePromise };
      }
      try {
        ws.send(JSON.stringify(startPayload));
      } catch {
        setPendingSendWaitingForWs(true);
        resolveOutcome(batchId, { ok: false, reason: "ws_send_threw" });
        return { messageQueueItemId: batchId, outcome: outcomePromise };
      }
      // Quick 260823-8ji: arm the 30s timer after a successful WS accept.
      armBatchTimeout(batchId);
      void pumpBatch(batchId);
      return { messageQueueItemId: batchId, outcome: outcomePromise };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      reuseIdOnRetry,
      setAttachments,
      armBatchTimeout,
      clearBatchTimeout,
      resolveOutcome,
    ],
  );

  // -------------------------------------------------------------------------
  // Quick 260803-05i: clearStagedForTarget — empties ONE target's staged
  // list AND flips abort-flags for its in-flight tempIds so the pump bails at
  // the next chunk check. Mirrors removeAttachment's abort-flag pattern per
  // tempId. Does NOT touch batchIdRef, capturedCaptionRef, readyFiredRef, or
  // batchInFlight — those are primary-batch-scoped lifecycle, not per-target
  // (queued targets stage without a batch in this Quick; queued-slot send
  // does not yet wire startBatch — noted as follow-up in the plan).
  // -------------------------------------------------------------------------
  const clearStagedForTarget = useCallback(
    (target: string) => {
      const current = attachmentsRefByTarget.current.get(target) ?? [];
      for (const att of current) {
        abortFlagsRef.current.set(att.tempId, true);
        lastOffsetSentRef.current.delete(att.tempId);
      }
      setAttachments(target, []);
    },
    [setAttachments],
  );

  // -------------------------------------------------------------------------
  // resetBatch — caller invokes AFTER onUploadReadyToInject fires (or on
  // any explicit "clear staging" gesture).
  // -------------------------------------------------------------------------
  const resetBatch = useCallback(() => {
    // Quick 260802-wxy: resetBatch clears PRIMARY only. Other targets
    // (Quick B's per-slot producers) manage their own clear semantics
    // — the primary chunk pump has no authority over them.
    // Quick 260823-8ji: if an outstanding batch has an unresolved outcome
    // Promise, resolve it with `superseded` so any awaiter doesn't linger
    // forever (dangling awaits leak resources + can never be surfaced).
    const priorBatchId = batchIdRef.current;
    if (priorBatchId) {
      resolveOutcome(priorBatchId, { ok: false, reason: "superseded" });
    }
    batchIdRef.current = null;
    capturedCaptionRef.current = "";
    readyFiredRef.current = false;
    lastOffsetSentRef.current = new Map();
    abortFlagsRef.current = new Map();
    setBatchInFlight(false);
    setPendingSendWaitingForWs(false);
    setAttachments("primary", []);
  }, [setAttachments, resolveOutcome]);

  // -------------------------------------------------------------------------
  // onWsReconnect — caller invokes when the WS transitions from down to up
  // mid-batch. Simplest correct thing: retry from scratch under a new (or
  // reused) id.
  // -------------------------------------------------------------------------
  const onWsReconnect = useCallback(() => {
    if (!pendingSendWaitingForWs) return;
    void retryBatch();
  }, [pendingSendWaitingForWs, retryBatch]);

  // -------------------------------------------------------------------------
  // Chunk pump — reads File slices, base64-encodes, emits upload_chunk with
  // concurrency + backpressure.
  //
  // Defined as an inline async function so it can capture the batchId via
  // parameter (avoiding a stale-closure race if two batches ever overlap;
  // in practice they shouldn't, but defense in depth is cheap).
  // -------------------------------------------------------------------------
  const pumpBatch = useCallback(async (batchId: string) => {
    // Quick 260802-wxy: pump all targets FLATLY. Batch/status/progress
    // logic keys off tempId (not target), so the pump can treat cross-
    // target attachments identically. In Quick A only "primary" produces,
    // so this Array.from is effectively unchanged in behavior; the
    // structural refactor preserves the semantics for Quick B without
    // needing another pump rewrite.
    const initialAttachments = Array.from(
      attachmentsRefByTarget.current.values(),
    ).flat();
    const targets = initialAttachments.filter(
      (a) => a.status !== "complete",
    );

    // A simple semaphore: at any time at most MAX_CONCURRENT_UPLOADS_PER_BATCH
    // per-file loops run in parallel.
    const queue = [...targets];
    let inFlight = 0;
    let resolveDone: (() => void) | null = null;
    const donePromise = new Promise<void>((res) => {
      resolveDone = res;
    });

    const startNext = () => {
      // If the batchId has been replaced (retry, reset) — bail.
      if (batchIdRef.current !== batchId) {
        if (inFlight === 0 && resolveDone) resolveDone();
        return;
      }
      while (
        inFlight < MAX_CONCURRENT_UPLOADS_PER_BATCH &&
        queue.length > 0
      ) {
        const att = queue.shift()!;
        inFlight += 1;
        void pumpFile(att, batchId).finally(() => {
          inFlight -= 1;
          if (queue.length === 0 && inFlight === 0) {
            if (resolveDone) resolveDone();
          } else {
            startNext();
          }
        });
      }
      if (queue.length === 0 && inFlight === 0 && resolveDone) {
        resolveDone();
      }
    };
    startNext();
    await donePromise;
  }, []);

  const pumpFile = useCallback(
    async (att: StagedAttachment, batchId: string) => {
      // Quick 260802-wxy: find which target owns this attachment so per-
      // file state updates go to the right map key. In Quick A this is
      // always "primary" (only producer); the walk future-proofs Quick B.
      // Fallback to "primary" if the attachment somehow can't be located
      // (defensive — should not occur in normal flow).
      const findOwningTarget = (tempId: string): string => {
        for (const [tgt, list] of attachmentsRefByTarget.current) {
          if (list.some((a) => a.tempId === tempId)) return tgt;
        }
        return "primary";
      };
      const owningTarget = findOwningTarget(att.tempId);

      // Mark this file as uploading (so chips can transition into progress-
      // ring rendering).
      setAttachments(owningTarget, (prev) =>
        prev.map((a) =>
          a.tempId === att.tempId && a.status === "staged"
            ? { ...a, status: "uploading" }
            : a,
        ),
      );

      const totalSize = att.file.size;
      let offset = lastOffsetSentRef.current.get(att.tempId) ?? 0;

      while (offset < totalSize) {
        // Abort check (removeAttachment sets the flag).
        if (abortFlagsRef.current.get(att.tempId)) return;
        // Batch superseded (retry/reset) — bail.
        if (batchIdRef.current !== batchId) return;

        // Backpressure gate.
        const getAmt = getBufferedAmountRef.current;
        if (getAmt) {
          let iterations = 0;
          while (getAmt() > BACKPRESSURE_HIGH_WATER_BYTES) {
            if (iterations++ > BACKPRESSURE_HARD_TIMEOUT_ITERATIONS) {
              // Give up — mark this file as errored and bail. Server will
              // never see the rest of the chunks.
              setAttachments(owningTarget, (prev) =>
                prev.map((a) =>
                  a.tempId === att.tempId
                    ? {
                        ...a,
                        status: "error",
                        error: "sftp_error: WS buffer stuck",
                      }
                    : a,
                ),
              );
              setBatchInFlight(false);
              return;
            }
            await sleep(BACKPRESSURE_POLL_MS);
            // Also loop until it drains BELOW low-water so we don't
            // ping-pong right around the threshold.
            if (getAmt() < BACKPRESSURE_LOW_WATER_BYTES) break;
          }
        }

        const end = Math.min(offset + CHUNK_SIZE_BYTES, totalSize);
        const blob = att.file.slice(offset, end);
        let buffer: ArrayBuffer;
        try {
          buffer = await blob.arrayBuffer();
        } catch {
          setAttachments(owningTarget, (prev) =>
            prev.map((a) =>
              a.tempId === att.tempId
                ? {
                    ...a,
                    status: "error",
                    error: "sftp_error: file read failed",
                  }
                : a,
            ),
          );
          setBatchInFlight(false);
          return;
        }
        const b64 = arrayBufferToBase64(buffer);

        const payload: UploadChunkPayload = {
          type: "upload_chunk",
          messageQueueItemId: batchId,
          tempId: att.tempId,
          offset,
          bytes: b64,
        };
        const ws = wsRef.current;
        if (!ws) {
          setPendingSendWaitingForWs(true);
          return;
        }
        try {
          ws.send(JSON.stringify(payload));
        } catch {
          setPendingSendWaitingForWs(true);
          return;
        }
        lastOffsetSentRef.current.set(att.tempId, end);
        offset = end;
        // Yield to the event loop between chunks so state updates flush
        // and the UI can breathe.
        await Promise.resolve();
      }
    },
    [setAttachments],
  );

  // -------------------------------------------------------------------------
  // Cleanup any pending folder-rejection timer on unmount.
  // -------------------------------------------------------------------------
  useEffect(() => {
    return () => {
      if (folderRejectionTimerRef.current) {
        clearTimeout(folderRejectionTimerRef.current);
        folderRejectionTimerRef.current = null;
      }
    };
  }, []);

  // -------------------------------------------------------------------------
  // Public target-aware read API (Quick 260802-wxy).
  // -------------------------------------------------------------------------
  const getStagedAttachments = useCallback(
    (target: string): StagedAttachment[] => {
      return stagedAttachmentsByTarget.get(target) ?? [];
    },
    [stagedAttachmentsByTarget],
  );

  // -------------------------------------------------------------------------
  // Stable return object
  // -------------------------------------------------------------------------
  // Legacy `stagedAttachments` field: mirrors the "primary" target so
  // existing consumers (ComposeBox) see NO behavior change. Derived once
  // per re-render of the state map.
  const stagedAttachments =
    stagedAttachmentsByTarget.get("primary") ?? EMPTY_ATTACHMENTS;
  return useMemo(
    () => ({
      stagedAttachments,
      folderDropRejected,
      batchInFlight,
      pendingSendWaitingForWs,
      stageAttachments,
      getStagedAttachments,
      removeAttachment,
      clearStagedForTarget,
      startBatch,
      retryBatch,
      resetBatch,
      onWsReconnect,
    }),
    [
      stagedAttachments,
      folderDropRejected,
      batchInFlight,
      pendingSendWaitingForWs,
      stageAttachments,
      getStagedAttachments,
      removeAttachment,
      clearStagedForTarget,
      startBatch,
      retryBatch,
      resetBatch,
      onWsReconnect,
    ],
  );
}

// Stable empty-array reference so the legacy `stagedAttachments` mirror does
// not construct a new [] on every render when the primary target is empty
// (avoids waking up React.memo boundaries downstream that depend on
// reference equality for the empty case).
const EMPTY_ATTACHMENTS: StagedAttachment[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeId(): string {
  // crypto.randomUUID is universally available in modern browsers and Node
  // 18+; guard defensively in case a test env is missing it.
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // Fallback — sufficient for tests, never hit in production.
  return `id-${Math.random().toString(36).slice(2)}-${Date.now()}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isUploadEvent(
  e: { type?: string } | PrettyViewUploadServerEvent,
): e is PrettyViewUploadServerEvent {
  const t = (e as { type?: string }).type;
  return (
    t === "upload_progress" ||
    t === "upload_complete" ||
    t === "upload_failed" ||
    t === "upload_ready_to_inject"
  );
}

/**
 * Normalize the many possible drop/paste/picker inputs into a File[] +
 * folder-detection flag. DataTransferItemList supports webkitGetAsEntry
 * (Chrome/Firefox/Safari all implement it despite the "webkit" prefix);
 * fall back to the File-based `size===0 && type===""` heuristic for
 * environments where items aren't available.
 */
function normalizeToFiles(
  input: File[] | DataTransferItemList | FileList,
): { files: File[]; sawFolder: boolean } {
  // DataTransferItemList path — has webkitGetAsEntry per item.
  if (isDataTransferItemList(input)) {
    const files: File[] = [];
    let sawFolder = false;
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const entry =
        typeof (item as unknown as { webkitGetAsEntry?: () => unknown })
          .webkitGetAsEntry === "function"
          ? (item as unknown as {
              webkitGetAsEntry: () => { isDirectory?: boolean } | null;
            }).webkitGetAsEntry()
          : null;
      if (entry && entry.isDirectory) {
        sawFolder = true;
        continue;
      }
      const f =
        typeof (item as unknown as { getAsFile?: () => File | null })
          .getAsFile === "function"
          ? (item as unknown as { getAsFile: () => File | null }).getAsFile()
          : null;
      if (f) files.push(f);
    }
    return { files, sawFolder };
  }

  // File[] / FileList path.
  const asArray = Array.from(input as ArrayLike<File>);
  let sawFolder = false;
  const files: File[] = [];
  for (const f of asArray) {
    // Heuristic: browsers report empty type + size 0 for folder drops that
    // slip through the items path (e.g. Firefox in some versions). Not
    // perfect (some legitimate empty files also match), but the primary
    // detection lives in the items path above; this is a fallback that
    // errs toward refusing on the ambiguous case.
    if (f.size === 0 && (f.type === "" || !f.type)) {
      sawFolder = true;
      continue;
    }
    files.push(f);
  }
  return { files, sawFolder };
}

function isDataTransferItemList(x: unknown): x is DataTransferItemList {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as { length?: unknown }).length === "number" &&
    // DataTransferItem has kind and getAsFile; File does not.
    ((x as unknown as { [k: number]: unknown })[0] === undefined ||
      typeof (
        (x as unknown as { [k: number]: { kind?: unknown } })[0] as {
          kind?: unknown;
        }
      ).kind === "string")
  );
}

/**
 * Convert an ArrayBuffer to a base64 string. For 64KB chunks this is fine
 * on the main thread; if CHUNK_SIZE_BYTES were bumped significantly, this
 * should move to a worker.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Chunked conversion to avoid arg-count limits on String.fromCharCode.
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(
      null,
      Array.from(slice) as unknown as number[],
    );
  }
  return typeof btoa === "function" ? btoa(binary) : nodeBase64(binary);
}

function nodeBase64(binary: string): string {
  // Node fallback for environments without btoa (Vitest node projects would
  // hit this; the frontend project uses jsdom which provides btoa).
  return Buffer.from(binary, "binary").toString("base64");
}
