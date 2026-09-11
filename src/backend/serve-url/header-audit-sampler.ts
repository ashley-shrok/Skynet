/**
 * Phase 103 Plan 03b — Runtime header-audit sampler for serve-URL proxy.
 *
 * The "second layer of defense" behind Plan 03b's proxy-factory
 * `stripToAllowlist` (per 103-CONTEXT.md D-06). Called from proxy-factory's
 * `on.proxyReq` and `on.proxyReqWs` hooks AFTER the allowlist-strip has
 * already run, so any header present in `proxyReq.getHeaderNames()` at
 * emit-time that ISN'T in HEADER_ALLOWLIST is a strip-bug — the anomaly
 * warn fires to surface it.
 *
 * Sample rate strategy (time-decaying, per D-06):
 * - First hour post-deploy: 100% (`Date.now() < DEPLOY_EPOCH + 3600000`).
 *   Gives Alice + downstream dashboards a full look at every outbound
 *   fingerprint right after ship, catching any pattern drift immediately.
 * - After first hour: 1% (`Math.random() < 0.01`). Keeps ongoing forensic
 *   coverage without flooding the log firehose.
 *
 * DEPLOY_EPOCH captured at MODULE LOAD (not import) — process restart
 * resets the first-hour window, which is the correct behavior: a container
 * restart is the moment where fingerprint anomalies from a shipped change
 * become observable. Every restart earns a fresh hour of 100% sampling.
 *
 * Anomaly detection (ALWAYS runs — not sample-gated, per D-06):
 * - `getHeaderNames()` returns lowercase per Node http spec.
 * - HEADER_ALLOWLIST is lowercase (see types.ts docblock).
 * - Any header appearing on outbound that isn't in the allowlist gets
 *   emitted at warn with `operation: "serve_url_header_anomaly"` — this is
 *   the second-layer-of-defense signal Alice will watch.
 *
 * Info-leak invariant (T-40-05): headers array only carries NAMES
 * (`proxyReq.getHeaderNames()`), never VALUES. Cookie values, Authorization
 * bearer tokens, X-Skynet-* payloads are never logged even in the anomaly
 * branch. This is deliberate: the anomaly signal proves the strip missed;
 * the value doesn't need to be logged to know that.
 */

import type * as http from "node:http";
import { systemLogger } from "../utils/logger.js";
import { HEADER_ALLOWLIST } from "./types.js";
import type { ServeTarget } from "./types.js";

/* ------------------------------------------------------------------------ */
/*  Constants                                                               */
/* ------------------------------------------------------------------------ */

/**
 * Module-load epoch. Approximates deploy time — process restart is our
 * atomic ship boundary (D-24 single-deploy motion), so restart == deploy
 * for the purpose of the first-hour high-sample window.
 */
const DEPLOY_EPOCH = Date.now();

/** One hour in ms. First-hour = 100% sample window. */
const FIRST_HOUR_MS = 3_600_000;

/** Ongoing sample rate after the first hour. 1% keeps forensic coverage
 *  without flooding. */
const ONGOING_SAMPLE_RATE = 0.01;

/**
 * Fast lookup for the allowlist. `.includes()` on the tuple works too but
 * the plan explicitly calls out `HEADER_ALLOWLIST.includes(h.toLowerCase())`
 * so we mirror that shape via a Set for O(1) membership check.
 * (Set is initialized once at module load.)
 */
const ALLOWLIST_SET = new Set<string>(HEADER_ALLOWLIST);

/* ------------------------------------------------------------------------ */
/*  Public API                                                              */
/* ------------------------------------------------------------------------ */

/**
 * Phase — HTTP request hook vs WebSocket upgrade hook. Recorded in
 * structured logs so Alice can filter anomalies by which surface caught
 * them.
 */
export type AuditPhase = "req" | "ws";

/**
 * Emit a header-audit signal for one outbound request that has already
 * passed through Plan 03b proxy-factory's `stripToAllowlist`. Two
 * independent signals:
 *
 * 1. `serve_url_header_audit` (info) — sample-gated fingerprint of the
 *    outbound header names. 100% first hour, 1% after.
 * 2. `serve_url_header_anomaly` (warn) — ALWAYS fires if any header outside
 *    HEADER_ALLOWLIST is present. This is the second-layer defense per
 *    D-06 — a signal only appears here if the strip missed one.
 *
 * Called from Plan 03b's proxy-factory `on.proxyReq(proxyReq)` and
 * `on.proxyReqWs(proxyReq)` hooks, always AFTER the strip runs.
 */
export function emitHeaderAudit(
  target: ServeTarget,
  phase: AuditPhase,
  proxyReq: http.ClientRequest,
): void {
  const targetKey = `${target.hostname}:${target.port}`;
  const headerNames = proxyReq.getHeaderNames();

  // Signal 1: sample-gated fingerprint of the outbound header set.
  const shouldSample =
    Date.now() < DEPLOY_EPOCH + FIRST_HOUR_MS ||
    Math.random() < ONGOING_SAMPLE_RATE;

  if (shouldSample) {
    systemLogger.info("serve-url header audit", {
      operation: "serve_url_header_audit",
      target: targetKey,
      phase,
      headers: headerNames,
    });
  }

  // Signal 2: anomaly detection — always runs. Any header not in the
  // allowlist reaching this point means Plan 03b's stripToAllowlist missed
  // it. Warn-level so it surfaces on Alice's dashboard via the standard
  // console-forward pipeline.
  const outOfAllowlist = headerNames.filter(
    (h) => !ALLOWLIST_SET.has(h.toLowerCase()),
  );
  if (outOfAllowlist.length > 0) {
    systemLogger.warn("serve-url header anomaly", {
      operation: "serve_url_header_anomaly",
      target: targetKey,
      phase,
      outOfAllowlist,
    });
  }
}
