/**
 * image-gen-requests/worker.ts
 *
 * TYPE-ONLY STUB (Task 1 of Plan 116-03). The full runtime implementation
 * lands in Task 2 — see the plan for the 7-step processImageGen flow.
 *
 * This stub exists so queue.ts (Task 1) can import the WorkerDeps type by
 * name without a forward-reference / circular-import problem. Task 2 fills
 * in processImageGen, buildProductionDeps, writeResponseFile, and the
 * writeBinaryResponseFile helper.
 *
 * The interface fields declared here are STABLE — Task 2 will not remove
 * any of these fields, only add implementation code that consumes them.
 */

import type { Client as SSHClientType } from "ssh2";
import type { connectOneShot } from "../ssh/ssh-one-shot.js";
import type { execCommand } from "../ssh/tmux-helper.js";
import type {
  isLocalHostId,
  writeMarkdownFileAtomic,
  writeBinaryFileAtomic,
} from "../claude-session/identity-artifact-reader.js";
import type { resolveHostById } from "../ssh/host-resolver.js";
import type { callOpenAiImageGen } from "./adapter.js";
import type { TokenBucket } from "./token-bucket.js";

/**
 * All external side-effecting dependencies for processImageGen.
 * Tests override every field via a buildTestDeps() factory; production wires
 * via buildProductionDeps() (defined in Task 2).
 *
 * Fields:
 *   - connectOneShot / execCommand — SSH primitives for the REMOTE
 *     response-file drop path.
 *   - writeMarkdownFileAtomic — atomic tmp+rename for JSON drop
 *     (.success.json / .failure.json). Both LOCAL (conn===null) and REMOTE
 *     (conn is SSHClientType) branches per identity-artifact-reader helper.
 *   - writeBinaryFileAtomic — atomic tmp+rename for PNG drop (Task 1 exports
 *     this from identity-artifact-reader.ts alongside its markdown twin).
 *   - isLocalHostId — LOCAL-vs-REMOTE routing per item.hostIdNum.
 *   - resolveHostById — REMOTE branch host-details lookup.
 *   - callOpenAiImageGen — the adapter from Plan 01. Never throws in
 *     normal operation (returns AdapterResult discriminated union).
 *   - tokenBucket — the boot-time-singleton token bucket (D-21). The worker
 *     awaits acquire() before every adapter call.
 *   - now — injectable clock for test determinism of the D-22 TTL check.
 */
export interface WorkerDeps {
  connectOneShot: typeof connectOneShot;
  execCommand: typeof execCommand;
  writeMarkdownFileAtomic: typeof writeMarkdownFileAtomic;
  writeBinaryFileAtomic: typeof writeBinaryFileAtomic;
  isLocalHostId: typeof isLocalHostId;
  resolveHostById: typeof resolveHostById;
  callOpenAiImageGen: typeof callOpenAiImageGen;
  tokenBucket: TokenBucket;
  now: () => number;
}

/**
 * Convenience alias so Task 2's public export list can name the ssh2 Client
 * type without a fresh import. Not strictly needed by queue.ts.
 */
export type WorkerSshClient = SSHClientType;
