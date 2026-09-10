import { describe, it, expect } from "vitest";

/**
 * Phase 98 plan 04 — polly-adapter REAL-AWS integration test.
 *
 * Env-gated: only runs when AWS_INTEGRATION_TESTS=1. Skips (not fails) in
 * every other environment (CI, dev laptops without AWS creds, offline
 * runs). Rationale: mocked tests in `polly-adapter.test.ts` cover the
 * client-construction + command-shape + error-path contracts; this file
 * verifies the actual AWS network path from an EC2 instance with an
 * attached SkynetPollyTranscribeAccess policy.
 *
 * Cost ~$0.0002 per run — 6 characters of generative synthesis. Gated
 * behind AWS_INTEGRATION_TESTS=1 (98-RESEARCH.md § Test Strategy) so
 * accidental CI runs never bill.
 *
 * ⚠ The adapter under test is loaded via DYNAMIC IMPORT inside the test
 * body, NOT via a top-level `import` statement. Reason: polly-adapter.js
 * transitively imports `@aws-sdk/client-polly`, which is only present in
 * trees that have run `npm install` since Phase 98's chore commit. A
 * top-level import fires at module-load time regardless of describe.skipIf,
 * so trees rebased without `npm install` fail to LOAD this test file at
 * all (taylor flagged this 2026-09-10 during her ship). Dynamic import
 * defers the load to when shouldRun is true, so the AWS SDK is only
 * required in the environment that actually runs the test.
 *
 * Prerequisite for local runs on t1000:
 *   - `termix-ssm-role/SkynetPollyTranscribeAccess` attached to the instance.
 *   - `AWS_INTEGRATION_TESTS=1 npx vitest run src/backend/voice/polly-adapter.integration.test.ts`
 */

const shouldRun = process.env.AWS_INTEGRATION_TESTS === "1";

describe.skipIf(!shouldRun)(
  "polly-adapter integration (real AWS Polly, env-gated)",
  () => {
    it("synthesizeToPcm('Hello.', 'Joanna') returns a Readable yielding > 0 bytes", async () => {
      const { synthesizeToPcm } = await import("./polly-adapter.js");
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
