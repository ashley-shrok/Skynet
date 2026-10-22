/**
 * agent-phone — place a one-turn voice call to a Skynet user (via Twilio)
 * and return the transcript.
 *
 * Agent side: substrate/scripts/agent-phone (wrapper over fleet-service)
 * and substrate/skills/agent-phone/SKILL.md.
 *
 * Rules:
 *   - The caller may only ring people who registered the host it runs on.
 *   - One call per recipient at a time (serializeBy to_user); different
 *     recipients can be called in parallel.
 *   - Requests older than 2 minutes are dropped as `expired`, so a call
 *     queued behind another call to the same person still fits the time
 *     budget in adapter.ts and never rings after the helper gave up.
 */

import { z } from "zod";
import { defineService, fail, ok } from "../../engine/types.js";
import { placeCallAndAwait } from "./adapter.js";
import { getUserByUsername, userHasRegisteredHost } from "./lookup.js";
import {
  buildCallTwiml,
  buildOpeningLine,
  buildReceiptLine,
  TWIML_MAX_CHARS,
} from "./call-script.js";

const nonEmpty = (max: number) =>
  z
    .string()
    .max(max, `must be at most ${max} characters`)
    .refine((s) => s.trim().length > 0, "must not be empty");

export const agentPhoneInput = z.strictObject({
  /** TTS-friendly caller identity, e.g. "Clipper the Box Maintainer". */
  caller_name: nonEmpty(200),
  /** Skynet username of the person to call. */
  to_user: nonEmpty(200),
  /** What to say. Capped so a runaway agent can't start a 30-minute monologue. */
  message: nonEmpty(2000),
});

export interface AgentPhoneDeps {
  getUserByUsername: typeof getUserByUsername;
  userHasRegisteredHost: typeof userHasRegisteredHost;
  placeCallAndAwait: typeof placeCallAndAwait;
  sleep(ms: number): Promise<void>;
}

const productionDeps: AgentPhoneDeps = {
  getUserByUsername,
  userHasRegisteredHost,
  placeCallAndAwait,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

export function createAgentPhoneService(deps: AgentPhoneDeps = productionDeps) {
  return defineService({
    name: "agent-phone",
    description:
      "Ring a user's phone, speak a message, return their reply",
    input: agentPhoneInput,
    // TWILIO_FROM_NUMBER is the instance's one Twilio number (E.164).
    secrets: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM_NUMBER"],
    // Part of the time budget in adapter.ts; see the header.
    ttlMs: 2 * 60 * 1000,
    concurrency: 10,
    serializeBy: (input) => input.to_user,

    async handle(input, ctx) {
      const errorMessage = (err: unknown) =>
        err instanceof Error ? err.message : String(err);

      let target: Awaited<ReturnType<typeof deps.getUserByUsername>>;
      try {
        target = await deps.getUserByUsername(input.to_user);
      } catch (err) {
        return fail("unknown", `user lookup failed: ${errorMessage(err)}`);
      }
      if (!target)
        return fail("unknown_user", `no user named "${input.to_user}"`);

      let permitted: boolean;
      try {
        permitted = await deps.userHasRegisteredHost(target.id, ctx.host.idNum);
      } catch (err) {
        return fail(
          "unknown",
          `host registration lookup failed: ${errorMessage(err)}`,
        );
      }
      if (!permitted) {
        return fail(
          "not_permitted",
          `user "${input.to_user}" has not registered this host`,
        );
      }

      if (!target.phoneE164) {
        return fail(
          "no_phone_on_file",
          `user "${input.to_user}" has no phone number set`,
        );
      }

      const openingLine = buildOpeningLine(input.caller_name, input.message);
      const receiptLine = buildReceiptLine();
      const twimlChars = buildCallTwiml(openingLine, receiptLine).length;
      if (twimlChars > TWIML_MAX_CHARS) {
        return fail(
          "malformed",
          `message is too long for one call (${twimlChars - TWIML_MAX_CHARS} characters over the limit; "&", "<" and ">" count extra); shorten it`,
        );
      }

      ctx.log.info("placing call", {
        toUser: input.to_user,
        callerName: input.caller_name,
      });
      const call = await deps.placeCallAndAwait(
        { to: target.phoneE164, openingLine, receiptLine },
        {
          accountSid: ctx.secrets.TWILIO_ACCOUNT_SID,
          authToken: ctx.secrets.TWILIO_AUTH_TOKEN,
          fromNumber: ctx.secrets.TWILIO_FROM_NUMBER,
        },
        { now: ctx.now, sleep: deps.sleep },
      );
      ctx.log.info("call finished", {
        outcome: call.outcome,
        seconds: call.call_length_seconds,
      });

      if (call.outcome === "completed" || call.outcome === "no_response") {
        return ok({
          outcome: call.outcome,
          transcript: call.transcript ?? "",
          ...(call.call_length_seconds !== undefined
            ? { call_length_seconds: call.call_length_seconds }
            : {}),
        });
      }
      const details = {
        ...(call.call_length_seconds !== undefined
          ? { call_length_seconds: call.call_length_seconds }
          : {}),
        // no_answer from voicemail detection can still carry a recorded
        // reply — detection misfires on some humans.
        ...(call.transcript ? { transcript: call.transcript } : {}),
      };
      return fail(
        call.outcome,
        call.message,
        Object.keys(details).length > 0 ? details : undefined,
      );
    },
  });
}

export default createAgentPhoneService();
