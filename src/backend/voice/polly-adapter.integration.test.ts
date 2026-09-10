import { describe, it, expect } from "vitest";
import { synthesizeToPcm } from "./polly-adapter.js";

/**
 * Phase 98 plan 04 — polly-adapter REAL-AWS integration test.
 *
 * Env-gated: only runs when AWS_INTEGRATION_TESTS=1. Skips (not fails) in
 * every other environment (CI, dev laptops without AWS creds, offline
 * runs). Rationale: mocked tests in `polly-adapter.test.ts` cover the
 * client-construction + command-shape + error-path contracts; this file
 * verifies the actual AWS network path from an EC2 instance with an
 * attached PollyTranscribeExploratory policy.
 *
 * Cost ~$0.0002 per run — 6 characters of generative synthesis. Gated
 * behind AWS_INTEGRATION_TESTS=1 (98-RESEARCH.md § Test Strategy) so
 * accidental CI runs never bill.
 *
 * Prerequisite for local runs on t1000:
 *   - `termix-ssm-role/PollyTranscribeExploratory` attached to the instance.
 *   - `AWS_INTEGRATION_TESTS=1 npx vitest run src/backend/voice/polly-adapter.integration.test.ts`
 */

const shouldRun = process.env.AWS_INTEGRATION_TESTS === "1";

describe.skipIf(!shouldRun)(
  "polly-adapter integration (real AWS Polly, env-gated)",
  () => {
    it("synthesizeToPcm('Hello.', 'Joanna') returns a Readable yielding > 0 bytes", async () => {
      const stream = await synthesizeToPcm("Hello.", "Joanna");
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk as Buffer);
      }
      const totalBytes = Buffer.concat(chunks).length;
      expect(totalBytes).toBeGreaterThan(0);
    }, 30_000);
  },
);
