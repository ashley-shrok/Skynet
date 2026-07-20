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

export interface UsePrettyViewUploadsReturn {
  stagedAttachments: StagedAttachment[];
  folderDropRejected: boolean;
  batchInFlight: boolean;
  pendingSendWaitingForWs: boolean;
  stageAttachments: (
    items: File[] | DataTransferItemList | FileList,
  ) => void;
  removeAttachment: (tempId: string) => void;
  startBatch: (
    caption: string,
  ) => Promise<{ messageQueueItemId: string } | null>;
  retryBatch: () => Promise<{ messageQueueItemId: string } | null>;
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

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function usePrettyViewUploads(
  deps: UsePrettyViewUploadsDeps,
): UsePrettyViewUploadsReturn {
  const [stagedAttachments, setStagedAttachments] = useState<
    StagedAttachment[]
  >([]);
  const [folderDropRejected, setFolderDropRejected] = useState(false);
  const [batchInFlight, setBatchInFlight] = useState(false);
  const [pendingSendWaitingForWs, setPendingSendWaitingForWs] = useState(false);

  // Mirror stagedAttachments in a ref so the chunk pump (async loop) can
  // read the freshest state without stale-closure surprises. Every setState
  // call also updates the ref synchronously.
  const attachmentsRef = useRef<StagedAttachment[]>([]);
  const setAttachments = useCallback(
    (
      updater:
        | StagedAttachment[]
        | ((prev: StagedAttachment[]) => StagedAttachment[]),
    ) => {
      setStagedAttachments((prev) => {
        const next =
          typeof updater === "function"
            ? (updater as (p: StagedAttachment[]) => StagedAttachment[])(prev)
            : updater;
        attachmentsRef.current = next;
        return next;
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
          setAttachments((prev) =>
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
          setAttachments((prev) =>
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
          setAttachments((prev) =>
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
    [setAttachments],
  );

  // -------------------------------------------------------------------------
  // Stage attachments (drag/drop/paste/paperclip all land here)
  // -------------------------------------------------------------------------
  const stageAttachments = useCallback(
    (items: File[] | DataTransferItemList | FileList) => {
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
      setAttachments((prev) => [...prev, ...newlyStaged]);
    },
    [setAttachments],
  );

  // -------------------------------------------------------------------------
  // Remove attachment — emits upload_abort if the file was in flight
  // -------------------------------------------------------------------------
  const removeAttachment = useCallback(
    (tempId: string) => {
      const existing = attachmentsRef.current.find((a) => a.tempId === tempId);
      if (!existing) return;

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
      setAttachments((prev) => prev.filter((a) => a.tempId !== tempId));
    },
    [batchInFlight, setAttachments],
  );

  // -------------------------------------------------------------------------
  // startBatch — issue upload_start and kick the chunk pump
  // -------------------------------------------------------------------------
  const startBatch = useCallback(
    async (
      caption: string,
    ): Promise<{ messageQueueItemId: string } | null> => {
      const currentAttachments = attachmentsRef.current;
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
        return { messageQueueItemId: batchId };
      }
      try {
        ws.send(JSON.stringify(startPayload));
      } catch {
        setPendingSendWaitingForWs(true);
        return { messageQueueItemId: batchId };
      }

      // Kick the pump (fire and forget — the promise we return resolves
      // as soon as upload_start has been issued, not when uploads finish).
      void pumpBatch(batchId);
      return { messageQueueItemId: batchId };
    },
    // pumpBatch is defined inside the hook body below via useCallback but
    // we intentionally omit it from deps to avoid infinite re-creation
    // (its own closure reads refs, not state).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // -------------------------------------------------------------------------
  // retryBatch — restart from the currently-staged attachments
  // -------------------------------------------------------------------------
  const retryBatch = useCallback(
    async (): Promise<{ messageQueueItemId: string } | null> => {
      const currentAttachments = attachmentsRef.current;
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
      // Reset per-file state on the retried files.
      setAttachments((prev) =>
        prev.map((a) =>
          a.status === "complete"
            ? a
            : { ...a, status: "staged", bytesUploaded: 0, error: null },
        ),
      );
      setBatchInFlight(true);
      setPendingSendWaitingForWs(false);

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
        return { messageQueueItemId: batchId };
      }
      try {
        ws.send(JSON.stringify(startPayload));
      } catch {
        setPendingSendWaitingForWs(true);
        return { messageQueueItemId: batchId };
      }
      void pumpBatch(batchId);
      return { messageQueueItemId: batchId };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reuseIdOnRetry, setAttachments],
  );

  // -------------------------------------------------------------------------
  // resetBatch — caller invokes AFTER onUploadReadyToInject fires (or on
  // any explicit "clear staging" gesture).
  // -------------------------------------------------------------------------
  const resetBatch = useCallback(() => {
    batchIdRef.current = null;
    capturedCaptionRef.current = "";
    readyFiredRef.current = false;
    lastOffsetSentRef.current = new Map();
    abortFlagsRef.current = new Map();
    setBatchInFlight(false);
    setPendingSendWaitingForWs(false);
    setAttachments([]);
  }, [setAttachments]);

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
    const initialAttachments = attachmentsRef.current;
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
      // Mark this file as uploading (so chips can transition into progress-
      // ring rendering).
      setAttachments((prev) =>
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
              setAttachments((prev) =>
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
          setAttachments((prev) =>
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
  // Stable return object
  // -------------------------------------------------------------------------
  return useMemo(
    () => ({
      stagedAttachments,
      folderDropRejected,
      batchInFlight,
      pendingSendWaitingForWs,
      stageAttachments,
      removeAttachment,
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
      removeAttachment,
      startBatch,
      retryBatch,
      resetBatch,
      onWsReconnect,
    ],
  );
}

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
