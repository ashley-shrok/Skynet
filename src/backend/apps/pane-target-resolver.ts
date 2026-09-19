/**
 * Phase 120 Plan 02 Task 2 — pane-target-resolver.
 *
 * Turn a (hostId, host, port) triple into a `ResolvedTarget` — the tuple
 * Wave 3's app-pane-router will feed into the app-pane proxy factory.
 *
 * ---
 *
 * D-10 AS AMENDED BY RESEARCH.md Open Question 1 RESOLVED:
 *
 * This resolver uses the SSH tunnel UNCONDITIONALLY. The local Skynet
 * host reaches its own apps through the tunnel just like any other host.
 * There is NO direct-loopback bypass — one code path, safer, sidesteps
 * the Docker-container loopback gotcha (loopback in the container is
 * NOT loopback on the host; direct `127.0.0.1:port` from inside the
 * container cannot reach an app bound to the host's loopback).
 *
 * The `hostId` parameter is retained in the signature for symmetry with
 * callers (they use it for logging + audit tags) but the resolver itself
 * does not branch on it.
 *
 * NOTE (LOW-13 cleanup, 2026-09-19): the return interface previously
 * carried a `usedTunnel: boolean` field, always `true`, retained "for
 * interface stability if a future phase revisits Q1". No consumer read
 * it — grep-confirmed zero read sites outside tests that asserted the
 * literal. Dropped. If a future phase revisits Q1 and needs a branch
 * toggle, add the field back at that time — the interface change is
 * cheap and localized (one caller, `app-pane-router.ts`, would need to
 * begin destructuring it).
 *
 * ---
 *
 * Error propagation:
 *
 * Rejections from the tunnel cache propagate to the caller unchanged.
 * There is no try/wrap here. Wave 3's router surface handles the
 * rejection: classifies via the shared error classifier, and renders
 * the shared interstitial (D-17).
 */

import type { Host } from "../../types/index.js";
import { tunnelCache } from "../serve-url/tunnel-cache.js";
import type { ServeTarget } from "../serve-url/types.js";

/**
 * The resolver's return shape. See LOW-13 cleanup note above for why
 * `usedTunnel` was dropped — no consumer read it, and the "Q1 revisit"
 * interface-stability argument was speculative.
 */
export interface ResolvedTarget {
  target: ServeTarget;
  tunnelPort: number;
}

/**
 * Resolve a pane target by building the ServeTarget and opening (or
 * reusing) the SSH tunnel through the shared tunnel cache.
 *
 * @param hostId Positive integer identifying the app's home box. Passed
 *               for signature symmetry with callers (they carry it in
 *               logs) — the resolver itself does not branch on it.
 * @param host   Fully-resolved DB host row for the target box.
 * @param port   Positive integer TCP port on the target box where the
 *               app process listens.
 * @returns      { target, tunnelPort }
 */
export async function resolvePaneTarget(
  hostId: number,
  host: Host,
  port: number,
): Promise<ResolvedTarget> {
  // hostId is retained on the signature for caller-side logging symmetry.
  // Explicit reference here keeps linters + strict-noUnusedParameters
  // happy while making the "unused by design" fact locally visible.
  void hostId;

  const target: ServeTarget = { hostname: host.name, port, host };
  const instance = await tunnelCache.getOrCreate(target);
  return { target, tunnelPort: instance.tunnelPort };
}
