/**
 * Shared wire-protocol types + injected-turn formatter for pretty-view file
 * uploads (Phase 05).
 *
 * Runs unchanged in both the browser (Plans 02/03 frontend) and Node
 * (Plan 01's backend orchestrator + `terminal.ts` new WS cases). Zero
 * runtime dependencies — no React, no axios, no ssh2, no fs/path/process.
 *
 * The shape is designed to layer onto the existing per-pane SSH WebSocket
 * (`src/backend/ssh/terminal.ts`), keyed on the SAME `messageQueueItemId`
 * that patch #60 threads through the atomic delete-on-send path. One
 * lifecycle key per staged batch; upload_start → upload_chunk × N →
 * upload_ready_to_inject → the existing `case "input":` fires (via patch
 * #100 split-and-delay) with the same id, and patch #60 deletes the
 * queue row.
 *
 * See `.planning/phases/05-pretty-view-file-upload-support/05-CONTEXT.md`
 * for the LOCKED decisions this file encodes. Do NOT reshape without a
 * coordinated Plan-02/03/04 migration.
 */

/* ----------------------------- Constants ------------------------------- */

/** Reject any single file bigger than this at `upload_start` (T-05-03). */
export const MAX_PER_FILE_BYTES = 500 * 1024 * 1024; // 500 MB

/** Reject any batch whose declared total exceeds this at `upload_start` (T-05-03). */
export const MAX_PER_BATCH_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

/** Client's per-chunk read/send granularity — balances WS frame overhead vs latency. */
export const CHUNK_SIZE_BYTES = 64 * 1024; // 64 KB

/** Files in a batch upload in parallel up to this many; extras wait. */
export const MAX_CONCURRENT_UPLOADS_PER_BATCH = 3;

/**
 * The delimiter separating the caption from the metadata block in the
 * injected user turn. LOCKED — filenames matching this substring are
 * rejected at `upload_start` (T-05-05) so the delimiter's line-3
 * anchoring is a hard machine-parseable guarantee.
 */
export const INJECTED_DELIMITER = "--- attached files ---";

/* -------------------------- Failure reasons ---------------------------- */

export type UploadFailureReason =
  | "invalid_filename"
  | "delimiter_collision"
  | "size_overflow"
  | "batch_size_overflow"
  | "per_file_size_overflow"
  | "chunk_out_of_order"
  | "sftp_error"
  | "unknown_temp_id"
  | "batch_already_active"
  | "aborted"
  | "collision_max_retries";

/* ------------------------ Client → server types ------------------------ */

export interface UploadStartFileDescriptor {
  tempId: string;
  filename: string;
  size: number;
  mimetype: string;
}

export interface UploadStartPayload {
  type: "upload_start";
  messageQueueItemId: string;
  files: UploadStartFileDescriptor[];
}

export interface UploadChunkPayload {
  type: "upload_chunk";
  messageQueueItemId: string;
  tempId: string;
  offset: number;
  /** Base64-encoded bytes for this chunk. */
  bytes: string;
}

export interface UploadAbortPayload {
  type: "upload_abort";
  messageQueueItemId: string;
  /** Omit to abort the entire batch; include to abort one file. */
  tempId?: string;
}

export type PrettyViewUploadClientPayload =
  | UploadStartPayload
  | UploadChunkPayload
  | UploadAbortPayload;

/* ------------------------ Server → client types ------------------------ */

export interface UploadProgressEvent {
  type: "upload_progress";
  messageQueueItemId: string;
  tempId: string;
  bytesReceived: number;
  total: number;
}

export interface UploadCompleteEvent {
  type: "upload_complete";
  messageQueueItemId: string;
  tempId: string;
  landingPath: string;
  /** Box-local `YYYY-MM-DDTHH:mm:ss`. Not ISO-Z. */
  uploadTimestamp: string;
}

export interface UploadFailedEvent {
  type: "upload_failed";
  messageQueueItemId: string;
  /** Omitted for batch-level failures (e.g. duplicate `upload_start`). */
  tempId?: string;
  reason: UploadFailureReason;
  message: string;
}

export interface UploadReadyToInjectFileSummary {
  tempId: string;
  filename: string;
  size: number;
  mimetype: string;
  landingPath: string;
  uploadTimestamp: string;
}

export interface UploadReadyToInjectEvent {
  type: "upload_ready_to_inject";
  messageQueueItemId: string;
  files: UploadReadyToInjectFileSummary[];
}

export type PrettyViewUploadServerEvent =
  | UploadProgressEvent
  | UploadCompleteEvent
  | UploadFailedEvent
  | UploadReadyToInjectEvent;

/* --------------------------- Sanitization ----------------------------- */

const MAX_FILENAME_LEN = 200;

/**
 * Path-traversal, delimiter-collision, and null-byte defense for
 * client-supplied filenames. Runs at `upload_start` on the backend AND
 * on the frontend before adding to the chip strip (defense in depth).
 *
 * Returns the sanitized name if safe; returns `null` for ANY rejection
 * reason. Callers that need to differentiate (e.g. to emit a specific
 * `UploadFailureReason`) should call `classifyFilenameRejection` first.
 */
export function sanitizeFilenameForUpload(name: string): string | null {
  const classification = classifyFilenameRejection(name);
  if (classification === "ok") return name;
  return null;
}

export type FilenameRejection =
  | "ok"
  | "invalid_filename"
  | "delimiter_collision";

/**
 * Same rules as `sanitizeFilenameForUpload` but returns a discriminator
 * so the backend can emit the specific `UploadFailureReason`.
 */
export function classifyFilenameRejection(name: string): FilenameRejection {
  // Delimiter collision — check BEFORE structural rules so the specific
  // reason surfaces to the client. We check the RAW name (not a stripped
  // version) so null-byte injection cannot smuggle the delimiter past
  // this check; the null-byte reject below closes the other side.
  if (name.includes(INJECTED_DELIMITER)) return "delimiter_collision";
  if (/^---\s/m.test(name)) return "delimiter_collision";

  // Structural rules — the null-byte check REJECTS rather than strips,
  // because a filename that arrived with an embedded NUL was tampered
  // with in transit (no legitimate OS filename picker produces one) and
  // stripping would risk collapsing "bad\x00.exe" onto an existing
  // "bad.exe" landing spot (T-05-01).
  if (name.includes("\x00")) return "invalid_filename";
  if (name.length === 0) return "invalid_filename";
  if (name === "." || name === "..") return "invalid_filename";
  if (name.startsWith(".")) return "invalid_filename";
  if (name.includes("/")) return "invalid_filename";
  if (name.includes("\\")) return "invalid_filename";
  if (name.includes("\n")) return "invalid_filename";
  if (name.includes("\r")) return "invalid_filename";
  if (name.length > MAX_FILENAME_LEN) return "invalid_filename";

  return "ok";
}

/* --------------------------- Size formatting -------------------------- */

/**
 * Human-readable size formatter used in:
 * - the injected metadata block's per-file line (`(12.1 KB, text/plain)`)
 * - the sender-side chip render bubble (Plan 02)
 * - the compose-area chip strip staging component (Plan 02)
 *
 * <1024 bytes: `N B` (no decimals).
 * ≥1024 bytes: exactly one decimal place, KB / MB / GB / TB units.
 */
export function formatHumanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

/* --------------------- Injected user turn formatter -------------------- */

export interface InjectedTurnInput {
  /** May be empty; internal newlines preserved verbatim. */
  caption: string;
  files: Array<{
    filename: string;
    size: number;
    mimetype: string;
    /** Box-local `YYYY-MM-DDTHH:mm:ss`. */
    uploadTimestamp: string;
    landingPath: string;
  }>;
}

/**
 * LOCKED format (do NOT deviate without coordinated Plan 02/03/04
 * migration). Plan 03's sender-side chip render parses this exact
 * layout back out for chip layout, and the agent on the receiving box
 * relies on the delimiter always sitting on line 3 for stable
 * machine-parsing.
 *
 * Layout:
 *
 *   {caption, may be empty, may span multiple lines}
 *   {blank}
 *   --- attached files ---
 *   1. {filename} ({human-size}, {mimetype}) → {landingPath}
 *      uploaded {uploadTimestamp}
 *   2. ...
 *
 * When caption is empty, line 1 is blank (empty string before `\n`),
 * keeping the delimiter anchored at line 3. Always ends with `\n`.
 */
export function formatInjectedUserTurn(input: InjectedTurnInput): string {
  const lines: string[] = [];
  lines.push(input.caption);
  lines.push("");
  lines.push(INJECTED_DELIMITER);
  input.files.forEach((f, idx) => {
    lines.push(
      `${idx + 1}. ${f.filename} (${formatHumanSize(f.size)}, ${f.mimetype}) → ${f.landingPath}`,
    );
    lines.push(`   uploaded ${f.uploadTimestamp}`);
  });
  return lines.join("\n") + "\n";
}

/* -------------------- Injected user turn parser ----------------------- */

export interface ParsedInjectedTurn {
  caption: string;
  files: Array<{
    filename: string;
    size: number;
    mimetype: string;
    uploadTimestamp: string;
    landingPath: string;
  }>;
}

/**
 * Reverse of `formatInjectedUserTurn`. Used by Plan 02's sender-side
 * chip render helper to extract chip data from the just-sent message
 * bubble's text payload. Returns `null` if the text doesn't contain
 * the locked delimiter (i.e. it's not an injected-with-attachments
 * turn — the message is plain text and should render as usual).
 */
/** Hard length bound for parseInjectedUserTurn (T-05-11 DoS mitigation).
 *  A legitimate injected turn with 32 files at reasonable filename+path
 *  lengths is well under 100KB; anything larger is not a legitimate
 *  injected turn and should not consume parser cycles. */
const PARSE_MAX_INPUT_BYTES = 1024 * 1024; // 1 MB

export function parseInjectedUserTurn(
  raw: string,
): ParsedInjectedTurn | null {
  // T-05-11: bail out on pathologically large input BEFORE any parsing.
  if (raw.length > PARSE_MAX_INPUT_BYTES) return null;

  const delimIdx = raw.indexOf(`\n${INJECTED_DELIMITER}\n`);
  if (delimIdx < 0) return null;

  // caption is everything before the delimiter, minus the trailing "\n\n"
  // (one \n belongs to the last caption line, one blank line separates
  // caption from delimiter). If caption is empty, the raw string starts
  // with "\n" + delimiter + "\n"; strip a single leading blank line.
  let captionRaw = raw.slice(0, delimIdx);
  if (captionRaw.endsWith("\n")) captionRaw = captionRaw.slice(0, -1);
  const caption = captionRaw;

  const afterDelim = raw.slice(delimIdx + `\n${INJECTED_DELIMITER}\n`.length);
  const fileLines = afterDelim.split("\n").filter((l) => l.length > 0);

  const files: ParsedInjectedTurn["files"] = [];
  // Each file is two lines: header + "   uploaded ..." indented block.
  // T-05-09 false-match resistance: require EVERY pair to be a well-formed
  // (header, indented-timestamp) tuple. A single non-matching pair at any
  // position bails the whole parse — the user is composing plain text that
  // just happens to mention the delimiter.
  for (let i = 0; i < fileLines.length; i += 2) {
    const header = fileLines[i];
    const indented = fileLines[i + 1] ?? "";
    const parsed = parseFileHeaderLine(header);
    if (!parsed) return null;
    const tsMatch = /^\s*uploaded (.+)$/.exec(indented);
    if (!tsMatch) return null;
    parsed.uploadTimestamp = tsMatch[1];
    files.push(parsed);
  }
  // T-05-09: require AT LEAST one valid file line for the parse to succeed.
  // A delimiter-with-no-files is not an injected turn (it may be a user
  // typing the delimiter substring in a message that has zero attachments).
  if (files.length === 0) return null;
  return { caption, files };
}

function parseFileHeaderLine(
  line: string,
): ParsedInjectedTurn["files"][number] | null {
  // Format: "N. {filename} ({size-str}, {mimetype}) → {landingPath}"
  // filename may contain spaces + parens + non-ascii. We parse right-to-left:
  // split on the last " → ", then on the last " (" before that.
  const arrowSplit = line.split(" → ");
  if (arrowSplit.length < 2) return null;
  const landingPath = arrowSplit.slice(1).join(" → ");
  const left = arrowSplit[0];

  // strip leading "N. "
  const numMatch = /^(\d+)\.\s(.+)$/s.exec(left);
  if (!numMatch) return null;
  const rest = numMatch[2];

  const lastOpen = rest.lastIndexOf(" (");
  if (lastOpen < 0) return null;
  const filename = rest.slice(0, lastOpen);
  const metaBlock = rest.slice(lastOpen + 2, -1); // drop trailing ')'
  // "12.1 KB, text/plain"
  const commaIdx = metaBlock.indexOf(", ");
  if (commaIdx < 0) return null;
  const sizeStr = metaBlock.slice(0, commaIdx);
  const mimetype = metaBlock.slice(commaIdx + 2);
  const size = parseHumanSize(sizeStr);
  return {
    filename,
    size,
    mimetype,
    landingPath,
    uploadTimestamp: "",
  };
}

/**
 * Inverse of `formatHumanSize` — best-effort. Used only by the client-side
 * `parseInjectedUserTurn` to reconstruct approximate byte counts for chip
 * rendering; the authoritative size lives on the batch state, not in the
 * injected text. Returns 0 if unparseable.
 */
function parseHumanSize(s: string): number {
  const m = /^([\d.]+)\s*(B|KB|MB|GB|TB)$/.exec(s.trim());
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const unit = m[2];
  const mult =
    unit === "B"
      ? 1
      : unit === "KB"
        ? 1024
        : unit === "MB"
          ? 1024 * 1024
          : unit === "GB"
            ? 1024 * 1024 * 1024
            : 1024 * 1024 * 1024 * 1024;
  return Math.round(n * mult);
}
