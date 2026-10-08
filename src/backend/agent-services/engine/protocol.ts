/**
 * agent-services/engine/protocol.ts — the host-side file-drop wire protocol.
 *
 * Everything lives in one folder per host, `~/fleet/service-requests/`:
 *
 *   <uuid>.json              request envelope, written atomically by the agent:
 *                            {service, requested_at, input, attachments?, as_user?}
 *   <uuid>.in.<slot>.<ext>   optional attachments, written BEFORE the envelope
 *   <uuid>.claimed.json      the envelope after the backend claims it; its
 *                            appearance tells the agent "accepted"
 *   <uuid>.out.<i>.<ext>     output files, written before the response
 *   <uuid>.response.json     the answer, written atomically and last
 *
 * The agent-side helper (substrate/scripts/fleet-service) removes every
 * `<uuid>.*` file when it finishes. Anything a vanished helper leaves behind
 * is swept by the scan after a day.
 *
 * Pure module: no I/O, no logger. Shared by the SSH and local scanners.
 */

import type { EngineErrorCode, ServiceResult } from "./types.js";

/** Folder name under `~/fleet/` on every managed host. */
export const REQUESTS_FOLDER = "service-requests";

/** `$HOME`-relative folder path, for the response writer. */
export const REQUESTS_DIR = `$HOME/fleet/${REQUESTS_FOLDER}`;

/** Leftover wire files older than this are deleted by the scan. */
export const STALE_FILE_MINUTES = 24 * 60;

/** Canonical lower/upper-case dashed UUID. */
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SERVICE_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
const SLOT_NAME_RE = /^[a-z][a-z0-9_]{0,31}$/;
const EXT_RE = /^[a-z0-9]{1,8}$/;

/**
 * Scan-and-claim command, run over SSH on each host every tick.
 *
 *   1. Missing folder is not an error (`cd || exit 0`).
 *   2. Sweep wire files older than a day, left by helpers that died.
 *   3. For each `<uuid>.json` (36-char basename, so `.claimed.json`,
 *      `.response.json`, attachments and `.tmp` files are skipped), claim it
 *      with an atomic rename to `<uuid>.claimed.json`. A losing racer's mv
 *      fails and it moves on.
 *   4. Emit `<uuid>\t<base64 body>\n`. Base64 keeps the line protocol intact
 *      whatever the body contains, including pretty-printed JSON.
 *
 * The claimed file is left in place so the agent can see the request was
 * accepted.
 */
export const SCAN_CMD = [
  `cd ~/fleet/${REQUESTS_FOLDER} 2>/dev/null || exit 0;`,
  `find . -maxdepth 1 -type f -name '????????-????-????-????-????????????.*' -mmin +${STALE_FILE_MINUTES} -delete 2>/dev/null;`,
  "for f in *.json; do",
  '[ -f "$f" ] || continue;',
  'base="${f%.json}";',
  "[ ${#base} -eq 36 ] || continue;",
  'mv "$f" "$base.claimed.json" 2>/dev/null || continue;',
  "printf '%s\\t' \"$base\"; base64 -w0 \"$base.claimed.json\"; printf '\\n';",
  "done",
].join(" ");

export interface ClaimedFile {
  uuid: string;
  body: string;
}

/** Parse SCAN_CMD stdout. Lines that don't fit the shape are dropped. */
export function parseScanOutput(stdout: string): ClaimedFile[] {
  const out: ClaimedFile[] = [];
  for (const line of stdout.split("\n")) {
    const tab = line.indexOf("\t");
    if (tab === -1) continue;
    const uuid = line.slice(0, tab).trim();
    if (!UUID_RE.test(uuid)) continue;
    const body = Buffer.from(line.slice(tab + 1).trim(), "base64").toString(
      "utf-8",
    );
    out.push({ uuid, body });
  }
  return out;
}

/** Shell command printing an attachment as base64, capped at `maxBytes + 1`. */
export function attachmentReadCmd(filename: string, maxBytes: number): string {
  // `filename` has already passed attachmentFilenameError(), so it is
  // `<uuid>.in.<slot>.<ext>` with no shell metacharacters.
  return `head -c ${maxBytes + 1} "$HOME/fleet/${REQUESTS_FOLDER}/${filename}" | base64 -w0`;
}

// ---------------------------------------------------------------------------
// Request envelope
// ---------------------------------------------------------------------------

interface RequestEnvelope {
  service: string;
  requested_at: string;
  input: unknown;
  /** slot name → wire filename */
  attachments: Record<string, string>;
  /** Skynet username the request acts for (services with userSecrets). */
  as_user?: string;
}

const ENVELOPE_KEYS = new Set([
  "service",
  "requested_at",
  "input",
  "attachments",
  "as_user",
]);

export type EnvelopeParse =
  | { ok: true; envelope: RequestEnvelope }
  | { ok: false; message: string; service?: string };

export function parseEnvelope(body: string): EnvelopeParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return {
      ok: false,
      message: `invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, message: "request must be a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  const service = typeof obj.service === "string" ? obj.service : undefined;
  const fail = (message: string): EnvelopeParse => ({
    ok: false,
    message,
    service,
  });

  for (const k of Object.keys(obj)) {
    if (!ENVELOPE_KEYS.has(k)) return fail(`unrecognized envelope field: ${k}`);
  }
  if (service === undefined || !SERVICE_NAME_RE.test(service)) {
    return fail("service must be a kebab-case service name");
  }
  if (
    typeof obj.requested_at !== "string" ||
    !Number.isFinite(Date.parse(obj.requested_at))
  ) {
    return fail("requested_at must be an ISO-8601 timestamp");
  }
  if (!("input" in obj)) return fail("input is required");

  const attachments: Record<string, string> = {};
  if (obj.attachments !== undefined) {
    const a = obj.attachments;
    if (a === null || typeof a !== "object" || Array.isArray(a)) {
      return fail("attachments must be an object of slot name to filename");
    }
    for (const [slot, filename] of Object.entries(a)) {
      if (!SLOT_NAME_RE.test(slot))
        return fail(`bad attachment slot name: ${slot}`);
      if (typeof filename !== "string")
        return fail(`attachment ${slot} must be a filename`);
      attachments[slot] = filename;
    }
  }

  if (
    obj.as_user !== undefined &&
    (typeof obj.as_user !== "string" ||
      obj.as_user.length === 0 ||
      obj.as_user.length > 200)
  ) {
    return fail("as_user must be a username");
  }

  return {
    ok: true,
    envelope: {
      service,
      requested_at: obj.requested_at,
      input: obj.input,
      attachments,
      ...(obj.as_user !== undefined ? { as_user: obj.as_user as string } : {}),
    },
  };
}

/**
 * Check an attachment filename is exactly `<uuid>.in.<slot>.<ext>` for this
 * request, with an allowed extension. Returns an error message, or null when
 * it is fine. Tying the name to the request uuid stops one request from
 * reading another request's attachment.
 */
export function attachmentFilenameError(
  uuid: string,
  slot: string,
  filename: string,
  allowedExtensions: readonly string[],
): string | null {
  const prefix = `${uuid}.in.${slot}.`;
  if (!filename.startsWith(prefix)) {
    return `attachment ${slot} must be named ${prefix}<ext>`;
  }
  const ext = filename.slice(prefix.length);
  if (!EXT_RE.test(ext)) return `attachment ${slot} has a bad extension`;
  if (!allowedExtensions.includes(ext)) {
    return `attachment ${slot} must be one of: ${allowedExtensions.join(", ")}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export function responseFilename(uuid: string): string {
  return `${uuid}.response.json`;
}

export function outputFilename(
  uuid: string,
  index: number,
  ext: string,
): string {
  return `${uuid}.out.${index}.${ext}`;
}

export type WireResponse =
  | { ok: true; service: string; result: unknown; files: string[] }
  | {
      ok: false;
      service: string | null;
      error: { code: string; message?: string; [k: string]: unknown };
    };

/** Build the response JSON from a service result and the output filenames. */
export function buildResponse(
  service: string | null,
  result: ServiceResult | EngineFailure,
  outputFilenames: string[] = [],
): WireResponse {
  if (result.ok === true) {
    return {
      ok: true,
      service: service ?? "",
      result: result.result,
      files: outputFilenames,
    };
  }
  const error: { code: string; message?: string; [k: string]: unknown } = {
    ...(result.details ?? {}),
    code: result.code,
  };
  if (result.message !== undefined) error.message = result.message;
  return { ok: false, service, error };
}

export interface EngineFailure {
  ok: false;
  code: EngineErrorCode;
  message?: string;
  details?: Record<string, unknown>;
}

export function engineFailure(
  code: EngineErrorCode,
  message?: string,
): EngineFailure {
  return message === undefined
    ? { ok: false, code }
    : { ok: false, code, message };
}
