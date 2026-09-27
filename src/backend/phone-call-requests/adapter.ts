/**
 * phone-call-requests/adapter.ts
 *
 * Bland.ai HTTP adapter for the agent-phone file-drop broker.
 * Wraps raw `fetch` — no third-party SDK, matching image-gen-requests/adapter.ts.
 *
 * Contract:
 *   - NEVER throws in normal operation. All failure modes return a
 *     discriminated union via AdapterResult; a truly unexpected throw is
 *     caught and mapped to `outcome: "unknown"` so the worker sees a
 *     response payload rather than a crash.
 *   - Missing `BLAND_API_KEY` returns `outcome: "placement_error"` +
 *     `message: "BLAND_API_KEY not configured"` BEFORE any fetch. Same
 *     "check env first" discipline as image-gen's not_configured.
 *   - Bland auth uses raw key ("Authorization: <key>") — NOT bearer.
 *     George's POC + Bland's docs both confirm this. Do NOT prefix "Bearer".
 *   - AbortController on the placement call (60s timeout).
 *   - Poll deadline is 12 minutes wall-clock; caller passes `nowMs` +
 *     `deadlineMs` so tests can control the clock.
 *   - Poll cadence: 5s intervals matching George's POC. Fast enough to catch
 *     terminal state within 5s of Bland's state transition, slow enough to
 *     not hammer the API for a call that's most-of-a-minute long.
 *   - NEVER logs BLAND_API_KEY. Message content is redacted from log
 *     objects — only length + a truncated head are logged for debug.
 *
 * Field mapping (locked from docs + George's POC):
 *   - POST /v1/calls → { call_id, status? } | { errors[], status: "error" }
 *   - GET /v1/calls/:id →
 *       status: completed | failed | busy | no-answer | canceled | unknown
 *       call_ended_by: USER | ASSISTANT
 *       answered_by: human | voicemail | unknown | no-answer | null
 *       queue_status: new | queued | allocated | started | complete |
 *                     pre_queue_error | queue_error | call_error | complete_error
 *       concatenated_transcript: string
 *       transcripts: [{ user: "assistant" | "user", text: string, ... }]
 *       call_length: number (minutes, fractional)
 */

import { systemLogger } from "../utils/logger.js";
import type { PhoneCallOutcome } from "./types.js";

/** Placement-call fetch timeout (POST /v1/calls). Short — the API responds fast. */
const PLACEMENT_TIMEOUT_MS = 60_000;

/** Per-poll fetch timeout (GET /v1/calls/:id). Short — poll responses are small. */
const POLL_TIMEOUT_MS = 30_000;

/** Bland API base URL. */
const BLAND_BASE_URL = "https://api.bland.ai";

/**
 * Backend poll deadline for a single call — 12 min matches the shape doc's
 * timeout (12-min backend poll vs 15-min agent-side skill wait).
 */
export const BLAND_POLL_DEADLINE_MS = 12 * 60 * 1000;

/** Poll interval between GET /v1/calls/:id checks. */
export const BLAND_POLL_INTERVAL_MS = 5_000;

/**
 * `max_duration` (minutes) passed to Bland at placement time. Bland ends
 * the call itself when this limit hits (with `call_ended_by: ASSISTANT`).
 * Matches George's POC.
 */
export const BLAND_MAX_DURATION_MIN = 10;

/**
 * `interruptibility` passed to Bland at placement time. Values (per Bland
 * docs):
 *   0 = block interruptions (AI holds the turn through callee speech)
 *   1 = difficult to interrupt
 *   2 = balanced (Bland default)
 *   3 = easy to interrupt
 *
 * We use 0 because single-turn deliver-listen-hang-up semantics REQUIRE
 * the opener + message payload to play atomically. A fresh-agent UAT
 * turned up the failure mode: Bland's default (2) let the callee's "hello?"
 * cut off the opener mid-word ("with a message f-"), and the message
 * payload was never spoken. `interruptibility` only applies while the AI
 * is speaking — it doesn't affect the listen phase — so setting 0 locks
 * the opener + receipt phrase without dulling the AI's response to the
 * callee's actual reply.
 */
export const BLAND_INTERRUPTIBILITY = 0;

/**
 * Discriminated-union return type for the adapter.
 *
 * On terminal outcomes carrying a transcript (completed, no_response),
 * `transcript` is populated with the concatenated transcript. On other
 * outcomes it's absent.
 *
 * `call_length_seconds` is populated whenever Bland reported a completed
 * call (regardless of whether the human spoke). Absent when the call was
 * never placed (placement_error), never connected (queue_error), or the
 * backend gave up polling before a terminal state (timeout).
 */
export type AdapterResult = {
  outcome: PhoneCallOutcome;
  transcript?: string;
  message?: string;
  call_length_seconds?: number;
};

/**
 * Shape of the POST /v1/calls response body. Success form has `call_id`
 * + `status: "success"`; error form omits `call_id` and populates
 * `errors[]` (Bland uses `errors` array, not `message`, in some versions —
 * we accept either).
 */
interface BlandPlacementResponse {
  call_id?: string;
  status?: string;
  message?: string;
  errors?: unknown;
  error_message?: string;
}

/**
 * Subset of the GET /v1/calls/:id response body we consume.
 * Every field is optional in Bland's response schema; we defensively
 * treat any unexpected shape as "not yet terminal, keep polling".
 */
interface BlandCallDetails {
  call_id?: string;
  status?: string;
  call_ended_by?: string;
  answered_by?: string | null;
  queue_status?: string;
  completed?: boolean;
  concatenated_transcript?: string;
  transcripts?: Array<{ user?: string; text?: string }>;
  call_length?: number;
  error_message?: string;
}

/**
 * Redact a message for logging — return length + a short head so debug logs
 * are useful without leaking the full content.
 */
function redactMessage(msg: string): string {
  const head = msg.slice(0, 40);
  return `${head}${msg.length > 40 ? "…" : ""} [${msg.length} chars]`;
}

/**
 * Injected clock + sleep for testability. Production passes real timers;
 * tests use vi.useFakeTimers() + a controllable sleep to walk the poll loop
 * deterministically.
 */
export interface AdapterDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Optional fetch injection for tests. Defaults to globalThis.fetch. */
  fetchFn?: typeof fetch;
}

/**
 * Place a call and poll for the transcript. Returns a discriminated union —
 * NEVER throws in normal operation.
 *
 * `messageForVerification` is the raw message body (before opener
 * interpolation). Used post-poll to detect the interrupted-before-message
 * failure mode: if a nominally-completed call's transcript doesn't
 * contain the message text, we downgrade the outcome to
 * `interrupted_before_message` so the caller sees a delivery failure
 * rather than a false-positive success. Belt-and-braces net for
 * `interruptibility: 0` — if Bland ever lets an interruption slip
 * through, the caller isn't misled.
 */
export async function placeCallAndAwait(
  phoneNumber: string,
  taskPrompt: string,
  firstSentence: string,
  messageForVerification: string,
  deps: AdapterDeps,
): Promise<AdapterResult> {
  const apiKey = process.env.BLAND_API_KEY;
  if (!apiKey) {
    systemLogger.warn("phone adapter: BLAND_API_KEY not configured", {
      operation: "phone_bland_not_configured",
    });
    return {
      outcome: "placement_error",
      message: "BLAND_API_KEY not configured",
    };
  }

  const fetchFn = deps.fetchFn ?? fetch;

  // -----------------------------------------------------------------------
  // Step 1 — POST /v1/calls to queue the call.
  // -----------------------------------------------------------------------
  const placementCtrl = new AbortController();
  const placementTimer = setTimeout(() => placementCtrl.abort(), PLACEMENT_TIMEOUT_MS);
  let callId: string | null = null;
  try {
    systemLogger.info("phone adapter: placement call start", {
      operation: "phone_bland_place_start",
      messagePreview: redactMessage(firstSentence),
    });

    const placeRes = await fetchFn(`${BLAND_BASE_URL}/v1/calls`, {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone_number: phoneNumber,
        task: taskPrompt,
        first_sentence: firstSentence,
        wait_for_greeting: false,
        max_duration: BLAND_MAX_DURATION_MIN,
        interruptibility: BLAND_INTERRUPTIBILITY,
        record: false,
      }),
      signal: placementCtrl.signal,
    });

    let placeBody: BlandPlacementResponse = {};
    try {
      placeBody = (await placeRes.json()) as BlandPlacementResponse;
    } catch {
      // Ignore JSON parse errors — treat as placement failure below.
    }

    if (!placeRes.ok || typeof placeBody.call_id !== "string" || placeBody.call_id.length === 0) {
      const errMsg =
        placeBody.error_message ??
        placeBody.message ??
        (Array.isArray(placeBody.errors) && placeBody.errors.length > 0
          ? JSON.stringify(placeBody.errors[0]).slice(0, 200)
          : undefined) ??
        `HTTP ${placeRes.status}`;
      systemLogger.warn("phone adapter: placement failed", {
        operation: "phone_bland_place_failed",
        status: placeRes.status,
        errMsg,
      });
      return {
        outcome: "placement_error",
        message: errMsg,
      };
    }

    callId = placeBody.call_id;
    systemLogger.info("phone adapter: placement ok", {
      operation: "phone_bland_place_ok",
      callId,
    });
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      systemLogger.warn("phone adapter: placement timeout", {
        operation: "phone_bland_place_timeout",
        timeoutMs: PLACEMENT_TIMEOUT_MS,
      });
      return { outcome: "placement_error", message: "placement request timed out" };
    }
    systemLogger.warn("phone adapter: placement threw", {
      operation: "phone_bland_place_threw",
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      outcome: "placement_error",
      message: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(placementTimer);
  }

  // -----------------------------------------------------------------------
  // Step 2 — poll GET /v1/calls/:id until terminal state or deadline.
  // -----------------------------------------------------------------------
  const deadlineAt = deps.now() + BLAND_POLL_DEADLINE_MS;
  let lastDetails: BlandCallDetails = {};
  while (deps.now() < deadlineAt) {
    await deps.sleep(BLAND_POLL_INTERVAL_MS);

    const pollCtrl = new AbortController();
    const pollTimer = setTimeout(() => pollCtrl.abort(), POLL_TIMEOUT_MS);
    try {
      const pollRes = await fetchFn(`${BLAND_BASE_URL}/v1/calls/${callId}`, {
        method: "GET",
        headers: { Authorization: apiKey },
        signal: pollCtrl.signal,
      });
      if (!pollRes.ok) {
        systemLogger.info("phone adapter: poll non-2xx (continuing)", {
          operation: "phone_bland_poll_non_2xx",
          status: pollRes.status,
          callId,
        });
        continue;
      }
      try {
        lastDetails = (await pollRes.json()) as BlandCallDetails;
      } catch {
        continue;
      }
    } catch (err) {
      // AbortError on poll — try again next tick; not fatal.
      systemLogger.info("phone adapter: poll threw (continuing)", {
        operation: "phone_bland_poll_threw",
        callId,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    } finally {
      clearTimeout(pollTimer);
    }

    // -------------------------------------------------------------------
    // Terminal-state detection. Trust `status` string, NOT the `completed`
    // boolean (Bland's own quirk — they can disagree). See shape doc's
    // "Bland-side outcomes" note.
    // -------------------------------------------------------------------
    const outcome = classifyBlandDetails(lastDetails);
    if (outcome !== null) {
      return buildResultFromDetails(outcome, lastDetails, messageForVerification);
    }
  }

  // Deadline hit before terminal state — timeout outcome.
  systemLogger.warn("phone adapter: poll deadline hit", {
    operation: "phone_bland_poll_deadline",
    callId,
    lastStatus: lastDetails.status,
    lastQueueStatus: lastDetails.queue_status,
  });
  return {
    outcome: "timeout",
    message: `no terminal state within ${BLAND_POLL_DEADLINE_MS / 1000}s`,
    ...(typeof lastDetails.call_length === "number"
      ? { call_length_seconds: Math.round(lastDetails.call_length * 60) }
      : {}),
  };
}

/**
 * Classify a single Bland GET /v1/calls/:id response.
 * Returns a terminal outcome, or null if the call is still in progress.
 *
 * Exported for direct unit-testing of the mapping table.
 */
export function classifyBlandDetails(d: BlandCallDetails): PhoneCallOutcome | null {
  const queueStatus = d.queue_status;
  const status = d.status;
  const answeredBy = d.answered_by;

  // Queue-level terminal errors — the call never actually made it to a
  // ringing phone. Distinguishable from placement_error because the initial
  // POST returned a call_id.
  if (
    queueStatus === "pre_queue_error" ||
    queueStatus === "queue_error" ||
    queueStatus === "call_error" ||
    queueStatus === "complete_error"
  ) {
    return "queue_error";
  }

  // Call-level status enum from Bland docs:
  //   completed | failed | busy | no-answer | canceled | unknown | ...
  if (status === "busy") return "busy";
  if (status === "canceled") return "canceled";
  if (status === "failed") return "queue_error";
  if (status === "no-answer") return "no_answer";

  if (status === "completed") {
    // Distinguish "human answered and spoke" from "picked up but said
    // nothing." `answered_by === "voicemail"` or `"no-answer"` after
    // status:completed happens when Bland picks up but classifies the
    // pickup as non-human — treat as no_answer.
    if (answeredBy === "voicemail" || answeredBy === "no-answer") {
      return "no_answer";
    }
    // For status:completed + answered_by human/unknown/null, decide
    // completed vs no_response by whether the human contributed any turn
    // to the transcript.
    const transcripts = d.transcripts ?? [];
    const userTurns = transcripts.filter((t) => t.user === "user");
    return userTurns.length > 0 ? "completed" : "no_response";
  }

  // status "unknown" from Bland is different from our "unknown" fallback —
  // Bland's "unknown" is a documented terminal state; we surface it as
  // "unknown" outcome too (defensive fallback for the caller).
  if (status === "unknown") return "unknown";

  // Non-terminal statuses (queued, allocated, started, etc.) — keep polling.
  return null;
}

/**
 * Normalize a string for fuzzy substring comparison — lowercase, strip
 * every character that isn't a letter, digit, or whitespace, then
 * collapse runs of whitespace to a single space. Both the assistant
 * turn text and the caller-supplied message run through this before
 * the `.includes()` check so the heuristic tolerates Bland's ASR
 * dropping/adding punctuation (which it commonly does — "Hey Ashley,"
 * routinely transcribes as "hey ashley").
 */
function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the message text appears in the AI's spoken turns — the
 * heuristic that gates `interrupted_before_message`. Concatenates every
 * `assistant`-labeled turn from Bland's `transcripts[]`, normalizes both
 * sides, and substring-matches the whole normalized message. False when
 * the message can't be located, indicating the opener was cut off before
 * the payload finished (or never started).
 *
 * Exported for direct unit-testing.
 */
export function messageWasDeliveredHeuristic(
  d: BlandCallDetails,
  message: string,
): boolean {
  const nMsg = normalizeForMatch(message);
  if (nMsg.length === 0) {
    // Empty/whitespace-only message — nothing to verify, don't downgrade.
    return true;
  }
  const assistantSpoken = (d.transcripts ?? [])
    .filter((t) => t.user === "assistant" && typeof t.text === "string")
    .map((t) => t.text as string)
    .join(" ");
  if (assistantSpoken.length === 0) {
    // Bland reported completed with no assistant turns — treat as not
    // delivered so the caller sees the anomaly rather than a silent
    // success.
    return false;
  }
  return normalizeForMatch(assistantSpoken).includes(nMsg);
}

/**
 * Build the AdapterResult from a Bland details payload + classified
 * outcome. Attaches transcript on completed/no_response/
 * interrupted_before_message, call_length on any outcome where Bland
 * reported one. Downgrades `completed`/`no_response` to
 * `interrupted_before_message` when the transcript heuristic says the
 * message payload never made it through.
 */
function buildResultFromDetails(
  outcome: PhoneCallOutcome,
  d: BlandCallDetails,
  messageForVerification: string,
): AdapterResult {
  let effectiveOutcome: PhoneCallOutcome = outcome;
  if (
    (outcome === "completed" || outcome === "no_response") &&
    !messageWasDeliveredHeuristic(d, messageForVerification)
  ) {
    effectiveOutcome = "interrupted_before_message";
    systemLogger.warn("phone adapter: message not found in assistant turns — downgrading outcome", {
      operation: "phone_bland_message_not_delivered",
      originalOutcome: outcome,
      downgradedOutcome: effectiveOutcome,
      messageLen: messageForVerification.length,
    });
  }

  const result: AdapterResult = { outcome: effectiveOutcome };

  const transcript = d.concatenated_transcript;
  if (
    (effectiveOutcome === "completed" ||
      effectiveOutcome === "no_response" ||
      effectiveOutcome === "interrupted_before_message") &&
    typeof transcript === "string" &&
    transcript.length > 0
  ) {
    result.transcript = transcript;
  }

  if (typeof d.call_length === "number" && Number.isFinite(d.call_length)) {
    result.call_length_seconds = Math.round(d.call_length * 60);
  }

  if (effectiveOutcome === "queue_error") {
    const msg = d.error_message;
    if (typeof msg === "string" && msg.length > 0) {
      result.message = msg;
    } else if (d.queue_status !== undefined) {
      result.message = `queue_status: ${d.queue_status}`;
    }
  }

  if (effectiveOutcome === "interrupted_before_message") {
    result.message =
      "AI opener was interrupted before the message body finished delivering; callee did not hear the message";
  }

  return result;
}
