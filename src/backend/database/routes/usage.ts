/**
 * WEEKLY-METER-02: /api/usage — same-origin proxy to the Anthropic usage collector
 * at http://100.113.23.63:9421/ (tailnet-only, IP-gated).
 *
 * This route surfaces per-window rate-limit burn (5h + 7-day) to the frontend
 * WeeklyUsageMeter component without CORS/mixed-content issues.
 *
 * No auth required — the collector only returns publicly-observable usage data
 * (the same Ashley sees in her statusLine); the backend machine (skynet-ec2) is
 * on the tailnet and is the only node with reachability to 100.113.23.63:9421.
 *
 * Per CLAUDE.md nginx caveat: matching location /api/usage blocks MUST exist in
 * BOTH docker/nginx.conf AND docker/nginx-https.conf (done alongside this file
 * in Task 1 of plan 260729-1vd).
 *
 * Mounted at: app.use("/api/usage", usageRoutes) in database.ts
 */

import express from "express";

const router = express.Router();

const COLLECTOR_URL = "http://100.113.23.63:9421/";
const TIMEOUT_MS = 5000;

/**
 * GET / — proxy the collector JSON verbatim on 200; 503 on any failure.
 *
 * Success shape (from collector):
 *   { five_hour: { used_percentage, resets_at }, seven_day: { used_percentage, resets_at },
 *     updated_at, source_box }
 *
 * Failure shape:
 *   { error: "usage collector unreachable" } — 503
 */
router.get("/", async (_req, res) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(COLLECTOR_URL, { signal: controller.signal });
    clearTimeout(timer);

    if (!upstream.ok) {
      return res
        .status(503)
        .json({ error: "usage collector unreachable" });
    }

    const json = await upstream.json();
    return res.status(200).json(json);
  } catch {
    clearTimeout(timer);
    return res.status(503).json({ error: "usage collector unreachable" });
  }
});

export default router;
