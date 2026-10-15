/**
 * agent-services/services/agent-phone/call-script.ts
 *
 * What the call says, as TwiML for Twilio's POST /Calls `Twiml` field.
 *
 * The call is scripted, not conversational: speak the opener + message,
 * record the callee's reply, speak the receipt line, hang up. The
 * bracketing lines — "Hi, this is X." on pickup and "Your reply has been
 * sent back to X. You may hang up." at the end — are what let the callee
 * hang up confident her words landed with the right agent. They are NOT
 * optional.
 *
 * <Record> has no `action`. Twilio's docs say it then re-requests the
 * document URL, but an inline-TwiML call has none, and in practice Twilio
 * carries on to the next verb (verified on a live call: the receipt line
 * plays after the reply). So no webhook is needed. The trailing <Hangup/>
 * makes the end of the call explicit. The recording stays on the Twilio
 * account; the adapter fetches, transcribes and deletes it.
 */

/** Twilio <Say> voice. Amazon Polly neural voices are built into Twilio. */
export const CALL_VOICE = "Polly.Joanna-Neural";

/** Seconds of silence that end the callee's reply. */
export const REPLY_SILENCE_TIMEOUT_SEC = 5;

/** Longest reply recorded, in seconds. */
export const REPLY_MAX_LENGTH_SEC = 90;

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
export function buildReceiptLine(callerName: string): string {
  return `Your reply has been sent back to ${flatten(callerName)}. You may hang up.`;
}

/** The whole call as TwiML. */
export function buildCallTwiml(openingLine: string, receiptLine: string): string {
  return [
    "<Response>",
    `<Say voice="${CALL_VOICE}">${escapeXml(openingLine)}</Say>`,
    `<Record timeout="${REPLY_SILENCE_TIMEOUT_SEC}" maxLength="${REPLY_MAX_LENGTH_SEC}" playBeep="false" trim="trim-silence"/>`,
    `<Say voice="${CALL_VOICE}">${escapeXml(receiptLine)}</Say>`,
    "<Hangup/>",
    "</Response>",
  ].join("");
}
