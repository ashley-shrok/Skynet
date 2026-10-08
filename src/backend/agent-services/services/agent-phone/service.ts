/**
 * agent-phone — place a one-turn voice call to a Skynet user (via Bland.ai)
 * and return the transcript.
 *
 * Agent side: substrate/scripts/agent-phone (wrapper over skynet-service)
 * and substrate/skills/agent-phone/SKILL.md.
 *
 * Rules:
 *   - The caller may only ring people who registered the host it runs on.
 *   - One call per recipient at a time (serializeBy to_user); different
 *     recipients can be called in parallel.
 *   - Requests older than 8 minutes are dropped as `expired`, so a caller
 *     whose helper (9-minute wait) already gave up never rings anyone.
 */

import { z } from "zod";
import { defineService, fail, ok } from "../../engine/types.js";
import { placeCallAndAwait } from "./adapter.js";
import { getUserByUsername, userHasRegisteredHost } from "./lookup.js";
import {
  buildBlandFirstSentence,
  buildBlandTaskPrompt,
} from "./prompt-template.js";

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
      "Ring a Skynet user's phone, speak a message, return their reply",
    input: agentPhoneInput,
    secrets: ["BLAND_API_KEY"],
    // Under the helper's 9-minute wait; see the header.
    ttlMs: 8 * 60 * 1000,
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
        return fail("unknown_user", `no Skynet user named "${input.to_user}"`);

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
          `user "${input.to_user}" has not registered this host in Skynet`,
        );
      }

      if (!target.phoneE164) {
        return fail(
          "no_phone_on_file",
          `user "${input.to_user}" has no phone number set`,
        );
      }

      ctx.log.info("placing call", {
        toUser: input.to_user,
        callerName: input.caller_name,
      });
      const call = await deps.placeCallAndAwait(
        target.phoneE164,
        buildBlandTaskPrompt(input.caller_name, input.message),
        buildBlandFirstSentence(input.caller_name, input.message),
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
      return fail(
        call.outcome,
        call.message,
        call.call_length_seconds !== undefined
          ? { call_length_seconds: call.call_length_seconds }
          : undefined,
      );
    },
  });
}

export default createAgentPhoneService();
