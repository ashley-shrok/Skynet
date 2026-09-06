/**
 * substrate-orchestrator-singleton.ts — Module-level accessor for the server-substrate orchestrator.
 *
 * ROLE:
 *   Populated ONCE by starter.ts's boot IIFE (Phase 75-05 wire-in).
 *   Consumed by host.ts's on-add trigger (Phase 75-06) to fire per-host sweeps on demand.
 *
 * WHY A SEPARATE MODULE:
 *   host.ts is imported by starter.ts transitively. If the orchestrator reference lived
 *   inside starter.ts, importing it from host.ts would create a host.ts ↔ starter.ts
 *   circular import. This tiny module breaks the cycle — it has no transitive deps on
 *   either starter.ts or host.ts. Mirrors how authManager/permissionManager are shared
 *   in host.ts:78-81 (singleton pattern).
 *
 * NULLABILITY:
 *   The accessor returns null until the boot IIFE runs setSubstrateOrchestrator().
 *   Unit tests, migrations, and code paths that run outside the boot IIFE MUST check
 *   for null before calling any orchestrator method.
 *
 * THREAD SAFETY:
 *   Node.js is single-threaded. Module-level state is safe for this pattern.
 *   Production has exactly one writer (starter.ts). See SG4 in the test file —
 *   last-write-wins is documented behavior; the module does NOT throw on double-set.
 */
import type { ServerSubstrateOrchestrator } from "./server-substrate-orchestrator.js";

let instance: ServerSubstrateOrchestrator | null = null;

/**
 * Store the orchestrator instance created by starter.ts's boot IIFE.
 * Call once at container boot. Last-write-wins (see SG4 test).
 */
export function setSubstrateOrchestrator(o: ServerSubstrateOrchestrator): void {
  instance = o;
}

/**
 * Retrieve the orchestrator instance, or null if the boot IIFE has not run yet.
 * Callers must handle null — it is the expected state during unit tests and migrations.
 */
export function getSubstrateOrchestrator(): ServerSubstrateOrchestrator | null {
  return instance;
}

/**
 * Reset the singleton to null.
 *
 * @remarks TEST-ONLY — DO NOT CALL FROM PRODUCTION CODE.
 * Used in beforeEach() blocks to prevent module-level state from leaking
 * between test files. Production paths use setSubstrateOrchestrator / getSubstrateOrchestrator.
 */
export function __resetSubstrateOrchestrator(): void {
  instance = null;
}
