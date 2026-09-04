/**
 * sweep-logic.ts — Pure decision layer for the fleet-substrate per-host sweep.
 *
 * SHAPE SOURCE OF TRUTH:
 *   .planning/phases/72-feature-02-slice-2-reconcile-loop/72-CONTEXT.md
 *   § Shape (four conceptual parts) — the sweep decomposes into (1) a per-host
 *   walk of the catalog, (2) a byte-compare gate, (3) a mode-mirroring push,
 *   (4) a catalog-declared restart hook. This file is (2) + the mode/hook
 *   selection primitives; the walk (1) and the push (3) belong to Plan 04.
 *
 * PURE-LIB DISCIPLINE:
 *   Mirrors the pattern from src/backend/fleet-status/liveness-check.ts. NO
 *   filesystem access, NO SSH, NO child process, NO logger. Every function
 *   here takes already-fetched bytes / already-computed inputs and returns a
 *   decision. Plan 04 feeds these decisions to real SshChannel.exec calls
 *   inside src/backend/distributor/sweep-runner.ts (or wherever the hook
 *   composer lives). That split makes every outcome branch fully testable
 *   without a real host, real /app/, or real SSH.
 *
 * BYTE-COMPARE IS THE SOLE PUSH GATE:
 *   Buffer.equals(bundledBytes, installedBytes) is the primitive. It mirrors
 *   `cmp -s` semantics from the feature-02 doc's Nicole-battle-tested pattern.
 *   Match → skip. Mismatch → push. There is no other input to the gate.
 *
 * FAIL-CLOSED ON TRANSPORT ERROR IS A DESIGN CHOICE:
 *   When we cannot read the installed side (readOk: false), we do NOT push.
 *   The shape doc's "sweep runs when flag is off" failure mode and "bundled
 *   bytes reach the wrong host" concerns both point to fail-closed on unknown
 *   installed state. Fail-open would risk pushing over a broken/unexpected
 *   installed file (e.g. a symlink to /etc/passwd on a rooted host).
 *
 *   The readOk-sentinel discriminated union distinguishes:
 *     - { readOk: true, bytes: Buffer } — file read, contents known
 *     - { readOk: true, bytes: null }   — file genuinely absent (ENOENT)
 *     - { readOk: false, reason: ... }  — transport / unknown failure
 *   Mirroring the readStatWithSentinel pattern at
 *   ssh-poll-orchestrator.ts:107–178.
 *
 * MODE MIRRORING:
 *   Git IS the mode source of truth per the shape doc's mode-preservation
 *   invariant. computeInstallMode takes the bundled file's fs.statSync().mode,
 *   masks off the S_IFREG / S_IFDIR high bits, and returns the 12-bit
 *   permission value to apply on the installed side. The catalog does NOT
 *   declare per-entry modes — that would create a second, drift-prone source.
 */
import type { CatalogEntry } from "./catalog.js";

/**
 * All the inputs decideItemAction needs to produce a decision for a single
 * catalog entry. `installedRead` is a discriminated union so callers can
 * unambiguously signal three states:
 *   - readOk:true + bytes:Buffer  → file exists, contents known
 *   - readOk:true + bytes:null    → file absent on target (ENOENT / first
 *                                    install — a REAL change, not an error)
 *   - readOk:false                 → transport / unknown error reading the
 *                                    installed side (fail-closed → skip)
 */
export interface ItemInputs {
  entry: CatalogEntry;
  bundledBytes: Buffer | null;
  installedRead:
    | { readOk: true; bytes: Buffer | null }
    | { readOk: false; reason: "transport" | "unknown" };
}

/**
 * The decision Plan 04's hook code will act on. Two shapes:
 *   - action:"push" — bundled bytes differ from installed (or installed is
 *     absent); Plan 04 writes bundledBytes to entry.installPath, chmods to
 *     computeInstallMode(bundledStat.mode), and — if restartHookToFire is
 *     non-null — fires `systemctl --user restart <hook>`.
 *   - action:"skip" — no push. `reason` names why (see the three variants
 *     for the fail-closed / bytes-match / bundled-missing branches).
 *
 * NOTE: restartHookToFire is redundant with chooseRestartHook(decision,
 * entry); we expose both because the push-decision struct is what feeds the
 * execute path, whereas chooseRestartHook is the log-line-friendly resolver
 * that keeps the log tag call sites explicit.
 */
export type ItemDecision =
  | { action: "push"; restartHookToFire: string | null }
  | {
      action: "skip";
      reason: "bytes-match" | "installed-read-failed" | "bundled-read-failed";
    };

/**
 * The core sweep decision for a single catalog entry.
 *
 * Precedence (evaluated top-to-bottom, first match wins):
 *   1. bundledBytes === null    → skip("bundled-read-failed") — defensive;
 *      bundled is a local /app/ file so this should never happen in practice.
 *   2. installedRead.readOk===false → skip("installed-read-failed") —
 *      fail-closed on transport error (see file docblock).
 *   3. installedRead.bytes === null → push(restartHookToFire = entry.restartHook)
 *      — first-time install; treat as a real change so the restart hook fires
 *      for items that need it (agent-supervisor).
 *   4. installedRead.bytes.equals(bundledBytes) → skip("bytes-match") — the
 *      byte-compare gate; the whole point of the sweep is not to push here.
 *   5. else → push(restartHookToFire = entry.restartHook) — real mismatch.
 */
export function decideItemAction(inputs: ItemInputs): ItemDecision {
  const { entry, bundledBytes, installedRead } = inputs;

  if (bundledBytes === null) {
    return { action: "skip", reason: "bundled-read-failed" };
  }

  if (installedRead.readOk === false) {
    return { action: "skip", reason: "installed-read-failed" };
  }

  // installedRead.readOk === true from here on
  if (installedRead.bytes === null) {
    // ENOENT — file absent on the target host, first-time install. Treat as
    // a real change: fire the restart hook if the catalog names one.
    return { action: "push", restartHookToFire: entry.restartHook };
  }

  if (installedRead.bytes.equals(bundledBytes)) {
    return { action: "skip", reason: "bytes-match" };
  }

  return { action: "push", restartHookToFire: entry.restartHook };
}

/**
 * Given a bundled file's fs.statSync().mode value, return the 12-bit
 * permission mode to apply on the installed side.
 *
 * fs.statSync().mode includes the S_IFREG (0o100000) or S_IFDIR (0o040000)
 * file-type high bits. Passing that raw to `chmod` on the target host would
 * be nonsense; mask to the low 12 bits (0o7777) which covers user/group/other
 * rwx plus setuid/setgid/sticky.
 *
 * We deliberately use 0o777 (not 0o7777) here because none of the current
 * catalog entries need setuid/setgid/sticky bits — this narrower mask makes
 * the intent obvious. Widen to 0o7777 if a future entry legitimately needs
 * setuid/setgid.
 */
export function computeInstallMode(bundledStatMode: number): number {
  return bundledStatMode & 0o777;
}

/**
 * Resolve the systemd --user unit name that Plan 04's hook code should fire
 * for a given decision + catalog entry pair.
 *
 * Contract:
 *   - action==="push"  AND entry.restartHook!==null → return entry.restartHook
 *   - action==="push"  AND entry.restartHook===null → return null
 *   - action==="skip"  (any reason)                 → return null
 *
 * This is redundant with the restartHookToFire field on push decisions but
 * keeps the log-tag call sites explicit — Plan 04's log line emits the
 * resolved hook name and this fn is what produces it.
 */
export function chooseRestartHook(
  decision: ItemDecision,
  entry: CatalogEntry,
): string | null {
  if (decision.action !== "push") {
    return null;
  }
  return entry.restartHook;
}
