/**
 * agent-services/services/agent-phone/call-script.ts
 *
 * What the call says, as TwiML for Twilio's POST /Calls `Twiml` field.
 *
 * The call is scripted, not conversational: speak the opener + message,
 * record the callee's reply, speak the receipt line, hang up. The
 * bracketing lines — "Hi, this is X." on pickup and "Your reply has been
 * delivered." before the call hangs itself up — are what tell the callee
 * which agent is calling and that her words landed. They are NOT optional.
 *
 * The reply window is a <Gather> used only to tell when she has finished:
 * its speech recognizer ends the turn after a pause in *speech*, so road
 * or room noise doesn't hold it open the way <Record>'s volume-based
 * silence detection did, and any keypad press ends it too. Its own result
 * is discarded — a <Start><Recording> around it captures the reply, which
 * the adapter fetches, transcribes with the instance STT provider and
 * deletes. <Gather> has no `action`; with inline TwiML Twilio carries on
 * to the next verb (verified on live calls), so no webhook is needed.
 *
 * Twilio stops a speech <Gather> after 60s even mid-sentence (the
 * undocumented `maxSpeechTime` can't raise it — tested live). A second
 * <Gather> right behind it picks the callee up if she is still talking,
 * so a reply can run to two minutes. When she has finished, that second
 * <Gather> hears nothing and gives up after REPLY_CONTINUE_TIMEOUT_SEC,
 * so a finished reply ends about one second later than with one Gather.
 * Inline TwiML can't branch, so every extra <Gather> would add another
 * such second of dead air; more than two needs a webhook.
 */

/** Twilio <Say> voice: a Google Chirp3-HD generative voice. */
export const CALL_VOICE = "Google.en-US-Chirp3-HD-Aoede";

/** Seconds of pause after speech that end the callee's reply. */
export const REPLY_PAUSE_SEC = 3;

/** Seconds to wait for her to start replying before moving on. */
export const REPLY_START_TIMEOUT_SEC = 10;

/** Seconds the follow-on <Gather> waits for her to keep talking. */
export const REPLY_CONTINUE_TIMEOUT_SEC = 1;

/** <Start><Recording> name, so <Stop> can end it. */
const REPLY_RECORDING_NAME = "reply";

/** Twilio's limit on the POST /Calls `Twiml` parameter. */
export const TWIML_MAX_CHARS = 4000;

/**
 * Flatten whitespace so a caller-supplied string reads as one spoken line.
 */
function flatten(raw: string): string {
  return raw
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Escape text for an XML text node. Caller-supplied strings land inside
 * <Say>; unescaped, a message could close the tag and inject verbs
 * (<Dial>, <Redirect>) into the call. Quotes need no escaping in a text
 * node, and leaving them keeps the TwiML under TWIML_MAX_CHARS.
 */
export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** "Hi, this is <caller>. <message>" — spoken on pickup. */
export function buildOpeningLine(callerName: string, message: string): string {
  return `Hi, this is ${flatten(callerName)}. ${flatten(message)}`;
}

/** Spoken after the reply, right before hanging up. */
export function buildReceiptLine(): string {
  return "Your reply has been delivered.";
}

/** One reply window: ends after a pause in speech or any keypad press. */
function replyGather(startTimeoutSec: number): string {
  return `<Gather input="speech dtmf" numDigits="1" speechTimeout="${REPLY_PAUSE_SEC}" timeout="${startTimeoutSec}" speechModel="googlev2_telephony" language="en-US"/>`;
}

/** The whole call as TwiML. */
export function buildCallTwiml(openingLine: string, receiptLine: string): string {
  return [
    "<Response>",
    `<Say voice="${CALL_VOICE}">${escapeXml(openingLine)}</Say>`,
    `<Start><Recording name="${REPLY_RECORDING_NAME}" channels="mono" trim="trim-silence"/></Start>`,
    replyGather(REPLY_START_TIMEOUT_SEC),
    replyGather(REPLY_CONTINUE_TIMEOUT_SEC),
    `<Stop><Recording name="${REPLY_RECORDING_NAME}"/></Stop>`,
    `<Say voice="${CALL_VOICE}">${escapeXml(receiptLine)}</Say>`,
    "<Hangup/>",
    "</Response>",
  ].join("");
}
