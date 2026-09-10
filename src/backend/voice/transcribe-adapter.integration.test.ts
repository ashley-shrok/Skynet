import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { transcribeBuffer } from "./transcribe-adapter.js";

/**
 * Phase 98 plan 04 — transcribe-adapter REAL-AWS integration test.
 *
 * Env-gated: only runs when AWS_INTEGRATION_TESTS=1. Skips (not fails) in
 * every other environment (CI, dev laptops without AWS creds, offline
 * runs). Mocked tests in `transcribe-adapter.test.ts` cover the client
 * construction + command shape + IsPartial filter contracts; this file
 * verifies the actual AWS network path against a real voice clip from
 * the exploration bounty's samples.
 *
 * Cost ~$0.001 per run — one Transcribe streaming call on the shortest
 * available FLAC sample (~4.9s of audio, 16kHz mono). Gated behind
 * AWS_INTEGRATION_TESTS=1 (98-RESEARCH.md § Test Strategy) so accidental
 * CI runs never bill.
 *
 * Sample source: `~/.claude/roles/box-maintainer/bounties/
 * more-versatile-stt-tts-support/samples/clips/clip-01-short-77KB.flac`
 * (16kHz mono FLAC — matches the transcodeForTranscribe fallback shape
 * that Plan 06 will produce via webmToFlac).
 *
 * Prerequisite for local runs on t1000:
 *   - `termix-ssm-role/PollyTranscribeExploratory` attached to the instance.
 *   - Bounty samples present at the path above.
 *   - `AWS_INTEGRATION_TESTS=1 npx vitest run \
 *      src/backend/voice/transcribe-adapter.integration.test.ts`
 */

const shouldRun = process.env.AWS_INTEGRATION_TESTS === "1";
const clipPath = path.join(
  os.homedir(),
  ".claude",
  "roles",
  "box-maintainer",
  "bounties",
  "more-versatile-stt-tts-support",
  "samples",
  "clips",
  "clip-01-short-77KB.flac",
);
const clipExists = fs.existsSync(clipPath);

describe.skipIf(!shouldRun || !clipExists)(
  "transcribe-adapter integration (real AWS Transcribe streaming, env-gated)",
  () => {
    it("transcribeBuffer on shortest bounty FLAC clip returns a non-empty transcript", async () => {
      const audioBuffer = fs.readFileSync(clipPath);
      const transcript = await transcribeBuffer(audioBuffer, "flac", 16000);
      expect(transcript.length).toBeGreaterThan(0);
    }, 60_000);
  },
);
