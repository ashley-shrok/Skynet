/**
 * agent-services/services/agent-phone/adapter.ts
 *
 * Twilio Programmable Voice adapter for agent-phone. Raw `fetch`, no SDK,
 * matching agent-services/services/image-gen/adapter.ts.
 *
 * Flow:
 *   1. POST /Calls with inline TwiML (call-script.ts) from the instance's
 *      one Twilio number, so every call shows the same caller ID and the
 *      callee can allow it through Do Not Disturb. Answering-machine
 *      detection is on so voicemail comes back as `no_answer`.
 *   2. Poll GET /Calls/:sid until a terminal status or the deadline. On the
 *      deadline the call is hung up, so it can never ring late.
 *   3. On `completed`, fetch the <Record> recording of the callee's reply,
 *      transcribe it with the instance's STT provider (the same one voice
 *      input and the `stt` service use), then delete it from Twilio —
 *      always, whether or not transcription worked.
 *
 * Time budget (the agent's helper waits 570s from the request):
 *   queue TTL 2 min (service.ts) + call deadline 5.5 min + recording wait
 *   20s + transcription ≤ 2 × 30s ≈ 8.9 min. So a call never starts or
 *   keeps ringing after the agent has been told it timed out.
 *
 * Contract:
 *   - NEVER throws in normal operation. Every failure maps to an
 *     AdapterResult outcome; an unexpected throw becomes `unknown`.
 *   - NEVER logs the auth token or the message text (only a short head).
 */

import { systemLogger } from "../../../utils/logger.js";
import {
  resolveSttProvider,
  transcribeWithRetries,
} from "../../../voice/stt-provider.js";
import { buildCallTwiml } from "./call-script.js";
import type { PhoneCallOutcome } from "./types.js";

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

/** Per-request fetch timeout for every Twilio API call. */
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Backend wait for one call — 5.5 minutes; see the time budget above. The
 * longest legitimate call is about 4.7 minutes: 45s ring, 5s machine
 * detection, ~2.2 min to read a 2000-character message, a 90s reply plus
 * 5s of silence, and the receipt line.
 */
export const CALL_DEADLINE_MS = 5.5 * 60 * 1000;

/** Interval between GET /Calls/:sid checks. */
export const CALL_POLL_INTERVAL_MS = 3_000;

/** How long to wait for the reply recording to show up after the call ends. */
export const RECORDING_WAIT_MS = 20_000;

/** Per-attempt STT timeout for the reply; two attempts at most. */
export const TRANSCRIBE_TIMEOUT_MS = 30_000;
export const TRANSCRIBE_MAX_ATTEMPTS = 2;

/** Ring time before Twilio gives up with `no-answer`. */
export const RING_TIMEOUT_SEC = 45;

/** Answering-machine detection gives up (answered_by "unknown") after this. */
export const MACHINE_DETECTION_TIMEOUT_SEC = 5;

const TERMINAL_STATUSES = new Set([
  "completed",
  "busy",
  "no-answer",
  "canceled",
  "failed",
]);

export interface TwilioCredentials {
  accountSid: string;
  authToken: string;
  /** The instance's Twilio number, E.164. Every call comes from it. */
  fromNumber: string;
}

export interface CallRequest {
  /** Callee, E.164. */
  to: string;
  openingLine: string;
  receiptLine: string;
}

/**
 * On completed / no_response, `transcript` holds `voice:` / `user:` lines.
 * `call_length_seconds` is set whenever Twilio reported a duration.
 */
export type AdapterResult = {
  outcome: PhoneCallOutcome;
  transcript?: string;
  message?: string;
  call_length_seconds?: number;
};

export interface AdapterDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
  /** Speech-to-text for the reply recording. Defaults to the instance provider. */
  transcribe?(audio: Buffer): Promise<string>;
}

/** Subset of the Twilio Call resource we read. */
interface TwilioCall {
  sid?: string;
  status?: string;
  duration?: string | null;
  answered_by?: string | null;
}

interface TwilioRecording {
  sid?: string;
  status?: string;
  source?: string;
  duration?: string | null;
}

/** Twilio's REST error body. */
interface TwilioError {
  code?: number;
  message?: string;
}

function preview(text: string): string {
  return `${text.slice(0, 40)}${text.length > 40 ? "…" : ""} [${text.length} chars]`;
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function defaultTranscribe(audio: Buffer): Promise<string> {
  const provider = resolveSttProvider();
  return transcribeWithRetries(
    provider,
    { audio, mimetype: "audio/mpeg", ext: "mp3", timeoutMs: TRANSCRIBE_TIMEOUT_MS },
    TRANSCRIBE_MAX_ATTEMPTS,
  );
}

/**
 * Place the call and wait for it to finish. Returns a discriminated union;
 * never throws in normal operation.
 */
export async function placeCallAndAwait(
  call: CallRequest,
  creds: TwilioCredentials,
  deps: AdapterDeps,
): Promise<AdapterResult> {
  const fetchFn = deps.fetchFn ?? fetch;
  const transcribe = deps.transcribe ?? defaultTranscribe;
  const accountUrl = `${TWILIO_API_BASE}/Accounts/${encodeURIComponent(creds.accountSid)}`;
  const authHeader = `Basic ${Buffer.from(`${creds.accountSid}:${creds.authToken}`).toString("base64")}`;

  async function twilio(
    method: "GET" | "POST" | "DELETE",
    url: string,
    form?: Record<string, string>,
  ): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetchFn(url, {
        method,
        headers: {
          Authorization: authHeader,
          ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
        },
        ...(form ? { body: new URLSearchParams(form).toString() } : {}),
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  // -------------------------------------------------------------------
  // Step 1 — place the call.
  // -------------------------------------------------------------------
  let callSid: string;
  try {
    systemLogger.info("phone adapter: placement start", {
      operation: "phone_twilio_place_start",
      messagePreview: preview(call.openingLine),
    });
    const res = await twilio("POST", `${accountUrl}/Calls.json`, {
      To: call.to,
      From: creds.fromNumber,
      Twiml: buildCallTwiml(call.openingLine, call.receiptLine),
      Timeout: String(RING_TIMEOUT_SEC),
      MachineDetection: "Enable",
      MachineDetectionTimeout: String(MACHINE_DETECTION_TIMEOUT_SEC),
    });
    let body: TwilioCall & TwilioError = {};
    try {
      body = (await res.json()) as TwilioCall & TwilioError;
    } catch {
      // Treated as a placement failure below.
    }
    if (!res.ok || typeof body.sid !== "string" || body.sid.length === 0) {
      const errMsg =
        body.message !== undefined
          ? `${body.message}${body.code !== undefined ? ` (Twilio ${body.code})` : ""}`
          : `HTTP ${res.status}`;
      systemLogger.warn("phone adapter: placement failed", {
        operation: "phone_twilio_place_failed",
        status: res.status,
        twilioCode: body.code,
        errMsg,
      });
      return { outcome: "placement_error", message: errMsg };
    }
    callSid = body.sid;
    systemLogger.info("phone adapter: placement ok", {
      operation: "phone_twilio_place_ok",
      callSid,
      status: body.status,
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "AbortError";
    systemLogger.warn("phone adapter: placement threw", {
      operation: "phone_twilio_place_threw",
      timedOut,
      error: errorText(err),
    });
    return {
      outcome: "placement_error",
      message: timedOut ? "placement request timed out" : errorText(err),
    };
  }

  // -------------------------------------------------------------------
  // Step 2 — poll until terminal or deadline.
  // -------------------------------------------------------------------
  const deadlineAt = deps.now() + CALL_DEADLINE_MS;
  let last: TwilioCall = {};
  let terminal = false;
  while (deps.now() < deadlineAt) {
    await deps.sleep(CALL_POLL_INTERVAL_MS);
    try {
      const res = await twilio("GET", `${accountUrl}/Calls/${callSid}.json`);
      if (!res.ok) {
        systemLogger.info("phone adapter: poll non-2xx (continuing)", {
          operation: "phone_twilio_poll_non_2xx",
          status: res.status,
          callSid,
        });
        continue;
      }
      const prevStatus = last.status;
      last = (await res.json()) as TwilioCall;
      if (last.status !== prevStatus) {
        systemLogger.info("phone adapter: call status", {
          operation: "phone_twilio_status",
          callSid,
          status: last.status,
          answeredBy: last.answered_by,
        });
      }
    } catch (err) {
      systemLogger.info("phone adapter: poll threw (continuing)", {
        operation: "phone_twilio_poll_threw",
        callSid,
        error: errorText(err),
      });
      continue;
    }
    if (last.status !== undefined && TERMINAL_STATUSES.has(last.status)) {
      terminal = true;
      break;
    }
  }

  const callLength = parseDuration(last.duration);
  const withLength = <T extends AdapterResult>(r: T): T =>
    callLength !== undefined ? { ...r, call_length_seconds: callLength } : r;

  if (!terminal) {
    // Hang up so a stuck call can't ring or keep talking after we've told
    // the agent it timed out. Status=completed ends the call whatever
    // state it's in; "canceled" would leave an answered call running, and
    // our last poll may be stale.
    let hungUp = false;
    try {
      const res = await twilio("POST", `${accountUrl}/Calls/${callSid}.json`, {
        Status: "completed",
      });
      hungUp = res.ok;
      if (!res.ok) {
        systemLogger.warn("phone adapter: hang-up after deadline refused", {
          operation: "phone_twilio_deadline_hangup_refused",
          callSid,
          status: res.status,
        });
      }
    } catch (err) {
      systemLogger.warn("phone adapter: hang-up after deadline threw", {
        operation: "phone_twilio_deadline_hangup_threw",
        callSid,
        error: errorText(err),
      });
    }
    systemLogger.warn("phone adapter: call deadline hit", {
      operation: "phone_twilio_deadline",
      callSid,
      lastStatus: last.status,
      hungUp,
    });
    return withLength({
      outcome: "timeout",
      message: `call did not finish within ${CALL_DEADLINE_MS / 1000}s (last status: ${last.status ?? "unknown"}); ${hungUp ? "the backend hung it up" : "the backend could not confirm it hung up"}`,
    });
  }

  switch (last.status) {
    case "busy":
      return withLength({ outcome: "busy" });
    case "no-answer":
      return withLength({ outcome: "no_answer", message: "rang out" });
    case "canceled":
      return withLength({ outcome: "canceled" });
    case "failed":
      return withLength({
        outcome: "queue_error",
        message: "Twilio could not connect the call",
      });
  }

  // -------------------------------------------------------------------
  // Step 3 — completed: fetch, transcribe and delete the reply recording.
  // -------------------------------------------------------------------
  const answeredBy = last.answered_by ?? null;
  const machine =
    typeof answeredBy === "string" &&
    (answeredBy.startsWith("machine") || answeredBy === "fax");

  // Transcribe even when machine detection said voicemail: detection can
  // misfire on a human with a long greeting, and her reply must not be
  // thrown away unheard.
  const recording = await waitForReplyRecording(callSid);
  let reply = "";
  let transcribeFailed = false;
  if (recording?.sid) {
    try {
      const media = await twilio(
        "GET",
        `${accountUrl}/Recordings/${recording.sid}.mp3`,
      );
      if (!media.ok) throw new Error(`recording download HTTP ${media.status}`);
      const audio = Buffer.from(await media.arrayBuffer());
      reply = (await transcribe(audio)).trim();
      systemLogger.info("phone adapter: reply transcribed", {
        operation: "phone_twilio_reply_transcribed",
        callSid,
        recordingSid: recording.sid,
        audioBytes: audio.length,
        replyChars: reply.length,
      });
    } catch (err) {
      // The provider error can carry a response body; it goes to the log,
      // not to the agent.
      transcribeFailed = true;
      systemLogger.warn("phone adapter: reply transcription failed", {
        operation: "phone_twilio_reply_transcribe_failed",
        callSid,
        recordingSid: recording.sid,
        error: errorText(err),
      });
    }
    await deleteRecording(recording.sid);
  }

  if (machine) {
    return withLength({
      outcome: "no_answer",
      message: `voicemail picked up (answered_by: ${answeredBy}); the message was likely left on voicemail`,
      ...(reply !== ""
        ? { transcript: `voice: ${call.openingLine}\nuser: ${reply}` }
        : {}),
    });
  }
  if (transcribeFailed) {
    return withLength({
      outcome: "completed",
      transcript: [
        `voice: ${call.openingLine}`,
        "user: [the reply was recorded but could not be transcribed]",
        `voice: ${call.receiptLine}`,
      ].join("\n"),
    });
  }
  if (reply === "") {
    return withLength({
      outcome: "no_response",
      transcript: `voice: ${call.openingLine}`,
    });
  }
  return withLength({
    outcome: "completed",
    transcript: [
      `voice: ${call.openingLine}`,
      `user: ${reply}`,
      `voice: ${call.receiptLine}`,
    ].join("\n"),
  });

  /** The <Record> recording once Twilio has finished processing it, or null. */
  async function waitForReplyRecording(sid: string): Promise<TwilioRecording | null> {
    const until = deps.now() + RECORDING_WAIT_MS;
    let seen: TwilioRecording | null = null;
    do {
      try {
        const res = await twilio("GET", `${accountUrl}/Calls/${sid}/Recordings.json`);
        if (res.ok) {
          const body = (await res.json()) as { recordings?: TwilioRecording[] };
          seen =
            (body.recordings ?? []).find(
              (r) => r.source === undefined || r.source === "RecordVerb",
            ) ?? null;
          if (seen?.status === "completed") return seen;
          if (seen?.status === "failed" || seen?.status === "absent") return null;
        }
      } catch (err) {
        systemLogger.info("phone adapter: recording lookup threw (continuing)", {
          operation: "phone_twilio_recording_lookup_threw",
          callSid: sid,
          error: errorText(err),
        });
      }
      await deps.sleep(CALL_POLL_INTERVAL_MS);
    } while (deps.now() < until);
    systemLogger.info("phone adapter: no finished reply recording", {
      operation: "phone_twilio_no_recording",
      callSid: sid,
      lastRecordingStatus: seen?.status,
    });
    return null;
  }

  async function deleteRecording(recordingSid: string): Promise<void> {
    try {
      const res = await twilio("DELETE", `${accountUrl}/Recordings/${recordingSid}.json`);
      if (!res.ok && res.status !== 404) {
        systemLogger.warn("phone adapter: recording delete failed", {
          operation: "phone_twilio_recording_delete_failed",
          recordingSid,
          status: res.status,
        });
      }
    } catch (err) {
      systemLogger.warn("phone adapter: recording delete threw", {
        operation: "phone_twilio_recording_delete_threw",
        recordingSid,
        error: errorText(err),
      });
    }
  }
}

function parseDuration(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}
