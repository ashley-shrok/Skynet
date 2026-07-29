/**
 * Pretty-view file upload orchestrator (Phase 05, Plan 05-01).
 *
 * Owns per-batch state, SFTP writeStream lifecycle, temp-file→rename
 * atomicity, sanitization + limits enforcement, and event emission for
 * the three new WS cases wired into `src/backend/ssh/terminal.ts`:
 *
 *   Client → server:  upload_start  →  upload_chunk × N  →  upload_abort?
 *   Server → client:  upload_progress  |  upload_complete  |
 *                     upload_failed    |  upload_ready_to_inject
 *
 * Every event is keyed on the SAME `messageQueueItemId` patch #60 threads
 * through the existing atomic delete-on-send path. On `upload_ready_to_inject`
 * the client is expected to send the injected user turn via the EXISTING
 * `case "input":` — patch #100's split-and-delay Enter and patch #60's
 * delete-on-send both apply for free.
 *
 * Zero new npm dependencies — `ssh2` is already loaded by `terminal.ts`
 * and every fork route under `file-manager-*.ts`.
 *
 * Threat mitigations wired here (see 05-01-PLAN.md threat_model):
 *   T-05-01  path traversal        — sanitize at upload_start
 *   T-05-02  symlink write         — createWriteStream { flags: 'wx' }
 *   T-05-03  disk-fill             — MAX_PER_FILE / MAX_PER_BATCH gate
 *   T-05-05  delimiter collision   — sanitize at upload_start
 *   T-05-07  unauth upload         — silent no-op if sshConn missing
 *   T-05-08  chunk out-of-order    — bytesReceived === offset check
 */

import type { Client as SSHClientType } from "ssh2";
import type { WebSocket } from "ws";
import {
  MAX_PER_BATCH_BYTES,
  MAX_PER_FILE_BYTES,
  classifyFilenameRejection,
  type PrettyViewUploadServerEvent,
  type UploadAbortPayload,
  type UploadChunkPayload,
  type UploadFailedEvent,
  type UploadFailureReason,
  type UploadStartPayload,
} from "../../ui/api/pretty-view-upload-protocol.js";
import { sshLogger } from "../utils/logger.js";

// ssh2's SFTPWrapper types don't include the callback-shaped WriteStream
// event API we need, so we treat the concrete stream as a minimal duck.
type WriteStreamLike = {
  write(chunk: Buffer, cb?: (err?: Error | null) => void): boolean;
  end(cb?: () => void): void;
  destroy(): void;
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  on(event: string, listener: (...args: unknown[]) => void): unknown;
};

type SftpLike = {
  realpath(
    p: string,
    cb: (err: Error | null, resolved: string) => void,
  ): void;
  stat(
    p: string,
    cb: (err: (Error & { code?: number }) | null, stats?: unknown) => void,
  ): void;
  mkdir(p: string, cb: (err: Error | null) => void): void;
  createWriteStream(
    p: string,
    opts: { flags?: string; mode?: number } & Record<string, unknown>,
  ): WriteStreamLike;
  rename(from: string, to: string, cb: (err: Error | null) => void): void;
  unlink(p: string, cb: (err: Error | null) => void): void;
};

interface FileWriteState {
  tempId: string;
  filename: string;
  sanitizedFilename: string;
  size: number;
  mimetype: string;
  tempPath: string;
  finalPath: string;
  writeStream: WriteStreamLike | null;
  bytesReceived: number;
  nextExpectedOffset: number;
  completed: boolean;
  uploadTimestamp: string;
  lastProgressEmitAt: number;
}

interface BatchState {
  messageQueueItemId: string;
  sftp: SftpLike | null;
  homeDir: string;
  landingDir: string;
  files: Map<string, FileWriteState>;
  totalDeclaredBytes: number;
  startedAt: number;
  aborted: boolean;
  ws: WebSocket;
}

const activeBatches: Map<string, BatchState> = new Map();

/* ------------------------ Clock (test-injectable) ---------------------- */

type ClockFn = () => Date;
let clockFn: ClockFn | null = null;

function now(): Date {
  return clockFn ? clockFn() : new Date();
}

/** Test-only clock injection. */
export function __setClockForTest(fn: ClockFn | null): void {
  clockFn = fn;
}

/** Test-only handle to the batch map for assertions. */
export function __getActiveBatchesForTest(): Map<string, BatchState> {
  return activeBatches;
}

/** Test-only reset of the batch map between test cases. */
export function __resetActiveBatchesForTest(): void {
  activeBatches.clear();
}

/* --------------------------------- Deps -------------------------------- */

export interface UploadDeps {
  sshConn: SSHClientType | null;
  ws: WebSocket;
  userId: string | undefined;
  currentSessionId: string | null;
}

/* ------------------------------- Helpers ------------------------------- */

const PROGRESS_THROTTLE_MS = 100;

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
function boxLocalDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function boxLocalTime(d: Date): string {
  return `${pad2(d.getHours())}${pad2(d.getMinutes())}${pad2(d.getSeconds())}`;
}
function boxLocalIso(d: Date): string {
  return `${boxLocalDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

export function emitEvent(
  ws: WebSocket,
  event: PrettyViewUploadServerEvent,
): void {
  if ((ws as { readyState?: number }).readyState !== 1 /* OPEN */) return;
  try {
    ws.send(JSON.stringify(event));
  } catch (err) {
    sshLogger.warn("pretty-view-upload: emit failed", {
      operation: "pv_upload_emit_fail",
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function emitFailed(
  ws: WebSocket,
  messageQueueItemId: string,
  reason: UploadFailureReason,
  message: string,
  tempId?: string,
): void {
  const evt: UploadFailedEvent = {
    type: "upload_failed",
    messageQueueItemId,
    reason,
    message,
  };
  if (tempId) evt.tempId = tempId;
  emitEvent(ws, evt);
}

/* --------------- SFTP promise wrappers around callback API ------------- */

function openSftp(sshConn: SSHClientType): Promise<SftpLike> {
  return new Promise((resolve, reject) => {
    (
      sshConn as unknown as {
        sftp: (cb: (err: Error | null, sftp: SftpLike) => void) => void;
      }
    ).sftp((err, sftp) => {
      if (err) return reject(err);
      resolve(sftp);
    });
  });
}

function sftpRealpath(sftp: SftpLike, p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.realpath(p, (err, resolved) => {
      if (err) return reject(err);
      resolve(resolved);
    });
  });
}

function sftpStat(
  sftp: SftpLike,
  p: string,
): Promise<{ exists: boolean; err?: Error }> {
  return new Promise((resolve) => {
    sftp.stat(p, (err) => {
      if (err) {
        // ssh2 SFTP returns ENOENT-shaped errors for missing paths
        return resolve({ exists: false });
      }
      resolve({ exists: true });
    });
  });
}

function sftpMkdir(sftp: SftpLike, p: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(p, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function sftpRename(
  sftp: SftpLike,
  from: string,
  to: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(from, to, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

function sftpUnlink(sftp: SftpLike, p: string): Promise<void> {
  return new Promise((resolve) => {
    sftp.unlink(p, () => resolve()); // best-effort — never throws
  });
}

/* ------------------------- Directory bootstrap ------------------------- */

async function ensureLandingDir(sftp: SftpLike, homeDir: string, d: Date) {
  const base = `${homeDir}/pretty-view-uploads`;
  const dateDir = `${base}/${boxLocalDate(d)}`;
  const baseStat = await sftpStat(sftp, base);
  if (!baseStat.exists) {
    try {
      await sftpMkdir(sftp, base);
    } catch (err) {
      // race — another concurrent upload may have created it; if the
      // stat now succeeds we're fine, else rethrow.
      const recheck = await sftpStat(sftp, base);
      if (!recheck.exists) throw err;
    }
  }
  const dateStat = await sftpStat(sftp, dateDir);
  if (!dateStat.exists) {
    try {
      await sftpMkdir(sftp, dateDir);
    } catch (err) {
      const recheck = await sftpStat(sftp, dateDir);
      if (!recheck.exists) throw err;
    }
  }
  return dateDir;
}

/** Insert a `-2` / `-3` / … suffix before the last `.ext`. */
function suffixCandidate(finalPath: string, n: number): string {
  const lastSlash = finalPath.lastIndexOf("/");
  const dir = finalPath.slice(0, lastSlash + 1);
  const base = finalPath.slice(lastSlash + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return `${dir}${base}-${n}`;
  return `${dir}${base.slice(0, dot)}-${n}${base.slice(dot)}`;
}

async function resolveNonCollidingFinal(
  sftp: SftpLike,
  candidate: string,
  reserved: Set<string>,
): Promise<string | null> {
  const first = await sftpStat(sftp, candidate);
  if (!first.exists && !reserved.has(candidate)) return candidate;
  for (let n = 2; n <= 10; n++) {
    const c = suffixCandidate(candidate, n);
    const s = await sftpStat(sftp, c);
    if (!s.exists && !reserved.has(c)) return c;
  }
  return null;
}

/* ---------------------------- handleUploadStart ------------------------ */

export async function handleUploadStart(
  deps: UploadDeps,
  payload: UploadStartPayload,
): Promise<void> {
  const { sshConn, ws, userId, currentSessionId } = deps;
  const mqid = payload.messageQueueItemId;

  // T-05-07 — silent no-op if unauthenticated pane (matches existing
  // `case "input":` posture). No reply frame.
  if (!sshConn || !userId || !currentSessionId) {
    sshLogger.debug?.("pretty-view-upload: upload_start on unauth WS", {
      operation: "pv_upload_start_unauth",
      hasSshConn: !!sshConn,
      hasUserId: !!userId,
      hasSessionId: !!currentSessionId,
    });
    return;
  }

  if (typeof mqid !== "string" || mqid.length === 0) {
    emitFailed(
      ws,
      mqid ?? "",
      "invalid_filename",
      "messageQueueItemId is required",
    );
    return;
  }

  if (activeBatches.has(mqid)) {
    emitFailed(
      ws,
      mqid,
      "batch_already_active",
      "an upload batch is already active for this messageQueueItemId",
    );
    return;
  }

  if (
    !Array.isArray(payload.files) ||
    payload.files.length < 1 ||
    payload.files.length > 32
  ) {
    emitFailed(ws, mqid, "invalid_filename", "files array must be 1-32");
    return;
  }

  // Validate filenames + per-file sizes BEFORE any SFTP work.
  let sanitizedFilenames: Record<string, string> = {};
  for (const f of payload.files) {
    if (
      typeof f.tempId !== "string" ||
      typeof f.filename !== "string" ||
      typeof f.size !== "number" ||
      typeof f.mimetype !== "string"
    ) {
      emitFailed(ws, mqid, "invalid_filename", "malformed file descriptor", f.tempId);
      return;
    }
    const classification = classifyFilenameRejection(f.filename);
    if (classification !== "ok") {
      emitFailed(
        ws,
        mqid,
        classification, // "invalid_filename" | "delimiter_collision"
        `filename rejected: ${classification}`,
        f.tempId,
      );
      return;
    }
    sanitizedFilenames[f.tempId] = f.filename;
    if (f.size < 0 || !Number.isFinite(f.size)) {
      emitFailed(ws, mqid, "per_file_size_overflow", "invalid size", f.tempId);
      return;
    }
    if (f.size > MAX_PER_FILE_BYTES) {
      emitFailed(
        ws,
        mqid,
        "per_file_size_overflow",
        `file exceeds per-file limit (${MAX_PER_FILE_BYTES} bytes)`,
        f.tempId,
      );
      return;
    }
  }

  const totalBytes = payload.files.reduce((s, f) => s + f.size, 0);
  if (totalBytes > MAX_PER_BATCH_BYTES) {
    emitFailed(
      ws,
      mqid,
      "batch_size_overflow",
      `batch exceeds total limit (${MAX_PER_BATCH_BYTES} bytes)`,
    );
    return;
  }

  // Open SFTP + resolve HOME. Any failure short-circuits to sftp_error.
  let sftp: SftpLike;
  try {
    sftp = await openSftp(sshConn);
  } catch (err) {
    emitFailed(
      ws,
      mqid,
      "sftp_error",
      `sftp open failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  let homeDir: string;
  try {
    homeDir = await sftpRealpath(sftp, ".");
  } catch (err) {
    emitFailed(
      ws,
      mqid,
      "sftp_error",
      `realpath failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  const clock = now();
  let landingDir: string;
  try {
    landingDir = await ensureLandingDir(sftp, homeDir, clock);
  } catch (err) {
    emitFailed(
      ws,
      mqid,
      "sftp_error",
      `landing dir setup failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return;
  }

  // Register the batch state up-front, so a concurrent duplicate
  // upload_start hits the "batch_already_active" gate.
  const batch: BatchState = {
    messageQueueItemId: mqid,
    sftp,
    homeDir,
    landingDir,
    files: new Map(),
    totalDeclaredBytes: totalBytes,
    startedAt: Date.now(),
    aborted: false,
    ws,
  };
  activeBatches.set(mqid, batch);

  const hhmmss = boxLocalTime(clock);
  const uploadTimestamp = boxLocalIso(clock);

  // Batch-local reservation set: tracks finalPaths already claimed within
  // this upload_start call so two same-named files in one batch don't both
  // resolve to the same candidate (disk-stat returns "not exists" for both
  // until the first sftpRename completes at chunk completion time).
  const reservedFinalPaths = new Set<string>();

  // Per-file: open the writeStream after resolving collision-free finalPath.
  for (const f of payload.files) {
    const sanitized = sanitizedFilenames[f.tempId];
    const candidate = `${landingDir}/${hhmmss}-${sanitized}`;
    const finalPath = await resolveNonCollidingFinal(sftp, candidate, reservedFinalPaths);
    if (!finalPath) {
      emitFailed(
        ws,
        mqid,
        "collision_max_retries",
        `filename collides after 10 suffix retries`,
        f.tempId,
      );
      await teardownBatch(batch);
      return;
    }
    // Claim this finalPath so subsequent iterations in the same batch don't
    // resolve to the same path before the first file's sftpRename fires.
    reservedFinalPaths.add(finalPath);
    // Temp path: hidden + `.partial` suffix; random suffix component
    // prevents pre-planted symlink collision (T-05-02 belt-and-suspenders
    // on top of `flags: 'wx'`).
    const randSuffix = Math.random().toString(36).slice(2, 10);
    const tempPath = `${landingDir}/.${hhmmss}-${sanitized}.${randSuffix}.partial`;

    let writeStream: WriteStreamLike;
    try {
      writeStream = sftp.createWriteStream(tempPath, { flags: "wx" });
    } catch (err) {
      emitFailed(
        ws,
        mqid,
        "sftp_error",
        `createWriteStream failed: ${err instanceof Error ? err.message : String(err)}`,
        f.tempId,
      );
      await teardownBatch(batch);
      return;
    }
    // Wire an error handler so an SFTP-layer error surfaces as upload_failed.
    writeStream.on("error", (...args: unknown[]) => {
      const err = args[0] as Error | undefined;
      const state = batch.files.get(f.tempId);
      if (!state || state.completed) return;
      emitFailed(
        ws,
        mqid,
        "sftp_error",
        `stream error: ${err?.message ?? "unknown"}`,
        f.tempId,
      );
      // best-effort unlink and remove the file from the batch
      sftpUnlink(sftp, state.tempPath).catch(() => {});
      batch.files.delete(f.tempId);
    });

    batch.files.set(f.tempId, {
      tempId: f.tempId,
      filename: f.filename,
      sanitizedFilename: sanitized,
      size: f.size,
      mimetype: f.mimetype,
      tempPath,
      finalPath,
      writeStream,
      bytesReceived: 0,
      nextExpectedOffset: 0,
      completed: false,
      uploadTimestamp,
      lastProgressEmitAt: 0,
    });
  }
}

/* --------------------------- handleUploadChunk ------------------------- */

export function handleUploadChunk(
  deps: UploadDeps,
  payload: UploadChunkPayload,
): void {
  const { sshConn, ws, userId, currentSessionId } = deps;
  const mqid = payload.messageQueueItemId;

  if (!sshConn || !userId || !currentSessionId) return; // T-05-07

  const batch = activeBatches.get(mqid);
  if (!batch) {
    emitFailed(ws, mqid, "unknown_temp_id", "no active batch", payload.tempId);
    return;
  }

  const fileState = batch.files.get(payload.tempId);
  if (!fileState) {
    emitFailed(ws, mqid, "unknown_temp_id", "unknown tempId", payload.tempId);
    return;
  }
  if (fileState.completed) return; // late chunk on a finished file — ignore

  if (payload.offset !== fileState.nextExpectedOffset) {
    emitFailed(
      ws,
      mqid,
      "chunk_out_of_order",
      `expected offset ${fileState.nextExpectedOffset}, got ${payload.offset}`,
      payload.tempId,
    );
    cleanupFile(batch, fileState);
    return;
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(payload.bytes, "base64");
  } catch (err) {
    emitFailed(
      ws,
      mqid,
      "sftp_error",
      `base64 decode failed: ${err instanceof Error ? err.message : String(err)}`,
      payload.tempId,
    );
    cleanupFile(batch, fileState);
    return;
  }

  if (fileState.bytesReceived + buf.length > fileState.size) {
    emitFailed(
      ws,
      mqid,
      "size_overflow",
      `chunk pushes total past declared size ${fileState.size}`,
      payload.tempId,
    );
    cleanupFile(batch, fileState);
    return;
  }

  if (!fileState.writeStream) {
    emitFailed(
      ws,
      mqid,
      "sftp_error",
      "write stream unavailable",
      payload.tempId,
    );
    cleanupFile(batch, fileState);
    return;
  }

  // Best-effort backpressure — pause the WS while the stream drains.
  const acceptedMore = fileState.writeStream.write(buf);
  if (!acceptedMore) {
    const wsAny = ws as unknown as {
      pause?: () => void;
      resume?: () => void;
    };
    if (typeof wsAny.pause === "function" && typeof wsAny.resume === "function") {
      wsAny.pause();
      fileState.writeStream.once("drain", () => wsAny.resume?.());
    }
  }

  fileState.bytesReceived += buf.length;
  fileState.nextExpectedOffset = fileState.bytesReceived;

  // Progress — throttle to ≤1 emit per 100ms per tempId.
  const nowMs = Date.now();
  if (
    fileState.bytesReceived === fileState.size ||
    nowMs - fileState.lastProgressEmitAt >= PROGRESS_THROTTLE_MS
  ) {
    fileState.lastProgressEmitAt = nowMs;
    emitEvent(ws, {
      type: "upload_progress",
      messageQueueItemId: mqid,
      tempId: fileState.tempId,
      bytesReceived: fileState.bytesReceived,
      total: fileState.size,
    });
  }

  if (fileState.bytesReceived === fileState.size) {
    finalizeFile(batch, fileState).catch((err) => {
      emitFailed(
        ws,
        mqid,
        "sftp_error",
        `finalize failed: ${err instanceof Error ? err.message : String(err)}`,
        fileState.tempId,
      );
      cleanupFile(batch, fileState);
    });
  }
}

async function finalizeFile(
  batch: BatchState,
  fileState: FileWriteState,
): Promise<void> {
  const sftp = batch.sftp;
  if (!sftp || !fileState.writeStream) return;
  // Wait for the stream to flush + close, then atomic-rename.
  await new Promise<void>((resolve, reject) => {
    fileState.writeStream!.once("close", () => resolve());
    fileState.writeStream!.once("error", (...args: unknown[]) => {
      const err = args[0] as Error | undefined;
      reject(err ?? new Error("stream error"));
    });
    fileState.writeStream!.end();
  });
  await sftpRename(sftp, fileState.tempPath, fileState.finalPath);
  fileState.completed = true;
  emitEvent(batch.ws, {
    type: "upload_complete",
    messageQueueItemId: batch.messageQueueItemId,
    tempId: fileState.tempId,
    landingPath: fileState.finalPath,
    uploadTimestamp: fileState.uploadTimestamp,
  });
  // If every file has landed, emit ready_to_inject and free the batch.
  const allDone = Array.from(batch.files.values()).every((f) => f.completed);
  if (allDone) {
    emitEvent(batch.ws, {
      type: "upload_ready_to_inject",
      messageQueueItemId: batch.messageQueueItemId,
      files: Array.from(batch.files.values()).map((f) => ({
        tempId: f.tempId,
        filename: f.filename,
        size: f.size,
        mimetype: f.mimetype,
        landingPath: f.finalPath,
        uploadTimestamp: f.uploadTimestamp,
      })),
    });
    activeBatches.delete(batch.messageQueueItemId);
  }
}

/** Tear down one file's temp resources without failing the whole batch. */
function cleanupFile(batch: BatchState, fileState: FileWriteState): void {
  try {
    fileState.writeStream?.destroy();
  } catch {
    // ignore — destroy is best-effort
  }
  if (batch.sftp) {
    sftpUnlink(batch.sftp, fileState.tempPath).catch(() => {});
  }
  batch.files.delete(fileState.tempId);
  // If this cleanup empties an aborted or exhausted batch, drop it.
  if (batch.files.size === 0) {
    activeBatches.delete(batch.messageQueueItemId);
  }
}

async function teardownBatch(batch: BatchState): Promise<void> {
  batch.aborted = true;
  for (const f of Array.from(batch.files.values())) {
    try {
      f.writeStream?.destroy();
    } catch {
      // ignore
    }
    if (batch.sftp) {
      await sftpUnlink(batch.sftp, f.tempPath).catch(() => {});
    }
  }
  batch.files.clear();
  activeBatches.delete(batch.messageQueueItemId);
}

/* --------------------------- handleUploadAbort ------------------------- */

export function handleUploadAbort(
  deps: UploadDeps,
  payload: UploadAbortPayload,
): void {
  const { sshConn, userId, currentSessionId, ws } = deps;
  const mqid = payload.messageQueueItemId;
  if (!sshConn || !userId || !currentSessionId) return; // T-05-07

  const batch = activeBatches.get(mqid);
  if (!batch) return; // nothing to abort — silently ok

  if (payload.tempId) {
    const fileState = batch.files.get(payload.tempId);
    if (!fileState) return;
    emitFailed(ws, mqid, "aborted", "upload aborted by client", payload.tempId);
    cleanupFile(batch, fileState);
    return;
  }

  // Batch-wide abort — emit upload_failed for every remaining file, teardown.
  const remaining = Array.from(batch.files.values());
  for (const f of remaining) {
    emitFailed(ws, mqid, "aborted", "batch aborted by client", f.tempId);
  }
  void teardownBatch(batch);
}

/* --------------- Called on WS close/error in terminal.ts --------------- */

export function cleanupBatchesForConnection(messageQueueItemIds: string[]): void {
  for (const mqid of messageQueueItemIds) {
    const batch = activeBatches.get(mqid);
    if (!batch) continue;
    void teardownBatch(batch);
  }
}
