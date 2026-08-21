// ─── delete-phantom-hosts.mjs ────────────────────────────────────────────────
// quick-260821-m36 — one-shot ops artifact for purging phantom hosts.id 14 + 15.
//
// WARNING: run INSIDE the currently-running skynet container BEFORE
// `docker compose up -d --force-recreate skynet`, so the AES-encrypted DB is
// open with its live decryption key. A recreate cycles the process and
// re-opens the DB — the encryption key bootstrap is identical, but the
// FK-safety check + atomic delete must succeed before any downtime window.
//
// DO NOT commit this script to src/. It lives in .planning/quick/... as a
// one-shot ops artifact; the plan SUMMARY documents its use. The plan dir
// IS under git (traceable), but no production code path references this file.
//
// If the FK-safety preflight aborts, do NOT proceed with the recreate.
// Escalate to Tina (workflow owner) for schema-aware review.
//
// ─── Runtime layout ──────────────────────────────────────────────────────────
// Absolute `/app/dist/...` import paths match the container's WORKDIR (/app)
// and mirror the paths the running server uses when it bootstrapped its own
// db + schema modules. If the container layout ever changes (Dockerfile
// WORKDIR, dist output shape, or the backend build tsconfig `outDir` layout),
// these paths must be updated.
//
// Invocation from the host (per SUMMARY deploy sequence):
//   docker cp .planning/quick/260821-m36-sessions-list-unstick/delete-phantom-hosts.mjs skynet:/tmp/
//   docker exec skynet node /tmp/delete-phantom-hosts.mjs 2>&1 | tee /tmp/delete-phantom-hosts.log
//
// The `tee` capture is the audit trail — persist the log alongside the
// SUMMARY.md deploy record.
// ────────────────────────────────────────────────────────────────────────────

import { initializeDatabase, db } from "/app/dist/backend/backend/database/db/index.js";
import {
  hosts,
  fileManagerRecent,
  fileManagerPinned,
  fileManagerShortcuts,
  transferRecent,
  sshCredentialUsage,
  recentActivity,
  commandHistory,
  hostAccess,
  sessionRecordings,
  opksshTokens,
  messageQueueItems,
  composeDrafts,
  userOpenTabs,
} from "/app/dist/backend/backend/database/db/schema.js";
import { inArray, sql } from "drizzle-orm";

const TARGET_IDS = [14, 15];

async function main() {
  await initializeDatabase();

  // ── Preflight PROVENANCE dump (log-before-mutate audit trail) ────────────
  const preRows = await db.select().from(hosts).where(inArray(hosts.id, TARGET_IDS));
  console.log("=== PROVENANCE — hosts targeted for delete (pre-mutate) ===");
  if (preRows.length === 0) {
    console.log("(no rows found for id in [14, 15] — idempotent re-run path)");
  } else {
    for (const row of preRows) {
      console.log(JSON.stringify(row, null, 2));
    }
  }

  const preCountRes = await db
    .select({ count: sql`count(*)` })
    .from(hosts);
  const preTotalCount = Number(preCountRes[0]?.count ?? 0);
  console.log(`=== hosts total row count (pre-mutate): ${preTotalCount} ===`);

  // ── Idempotency short-circuit ────────────────────────────────────────────
  if (preRows.length === 0) {
    console.log("OK: 0 rows to delete, phantoms already gone");
    return;
  }

  // ── FK-safety preflight ──────────────────────────────────────────────────
  // Every table with a hostId (or sourceHostId / destHostId) FK reference to
  // hosts.id is queried for non-null rows pointing at [14, 15]. If ANY table
  // has one or more matching references, we log the table + count + a loud
  // banner and exit non-zero WITHOUT DELETING — the deploy sequence checks
  // exit code before proceeding to force-recreate.
  //
  // Order matches schema.ts (line numbers in comments cross-reference the
  // schema module for grep-navigability).
  const fkChecks = [
    { name: "fileManagerRecent", table: fileManagerRecent, col: fileManagerRecent.hostId }, // schema.ts:189
    { name: "fileManagerPinned", table: fileManagerPinned, col: fileManagerPinned.hostId }, // schema.ts:204
    { name: "fileManagerShortcuts", table: fileManagerShortcuts, col: fileManagerShortcuts.hostId }, // schema.ts:219
    { name: "transferRecent.sourceHostId", table: transferRecent, col: transferRecent.sourceHostId }, // schema.ts:234
    { name: "transferRecent.destHostId", table: transferRecent, col: transferRecent.destHostId }, // schema.ts:237
    { name: "sshCredentialUsage", table: sshCredentialUsage, col: sshCredentialUsage.hostId }, // schema.ts:298
    { name: "recentActivity", table: recentActivity, col: recentActivity.hostId }, // schema.ts:407
    { name: "commandHistory", table: commandHistory, col: commandHistory.hostId }, // schema.ts:421
    { name: "hostAccess", table: hostAccess, col: hostAccess.hostId }, // schema.ts:461
    { name: "sessionRecordings", table: sessionRecordings, col: sessionRecordings.hostId }, // schema.ts:590
    { name: "opksshTokens", table: opksshTokens, col: opksshTokens.hostId }, // schema.ts:621
    { name: "messageQueueItems", table: messageQueueItems, col: messageQueueItems.hostId }, // schema.ts:680
    { name: "composeDrafts", table: composeDrafts, col: composeDrafts.hostId }, // schema.ts:707
    { name: "userOpenTabs", table: userOpenTabs, col: userOpenTabs.hostId }, // schema.ts:724 — hostId is NULLABLE
  ];

  console.log("=== FK-safety preflight ===");
  const violations = [];
  for (const check of fkChecks) {
    const res = await db
      .select({ count: sql`count(*)` })
      .from(check.table)
      .where(inArray(check.col, TARGET_IDS));
    const count = Number(res[0]?.count ?? 0);
    console.log(`  ${check.name}: ${count} rows referencing hosts.id in [14, 15]`);
    if (count > 0) {
      violations.push({ table: check.name, count });
    }
  }

  if (violations.length > 0) {
    console.error("");
    console.error("!!! FK-SAFETY ABORT !!!");
    console.error("One or more tables reference hosts.id 14 or 15. Cascade-delete NOT performed.");
    console.error("Violations:");
    for (const v of violations) {
      console.error(`  - ${v.table}: ${v.count} row(s)`);
    }
    console.error("");
    console.error("Escalate to Tina (workflow owner) for schema-aware review.");
    console.error("DO NOT proceed with `docker compose up -d --force-recreate skynet`.");
    process.exit(1);
  }

  // ── Atomic delete ────────────────────────────────────────────────────────
  console.log("=== FK preflight clean — proceeding with delete ===");
  const deleteResult = await db.delete(hosts).where(inArray(hosts.id, TARGET_IDS));
  // better-sqlite3 driver returns { changes: N, lastInsertRowid: ... };
  // log the whole object so any adapter shape shift is visible in the log.
  console.log(`delete result: ${JSON.stringify(deleteResult)}`);

  // ── Post-delete verification ─────────────────────────────────────────────
  const postRows = await db.select().from(hosts).where(inArray(hosts.id, TARGET_IDS));
  if (postRows.length !== 0) {
    console.error("!!! POST-DELETE VERIFICATION FAILED !!!");
    console.error(`Expected 0 rows for id in [14, 15], found ${postRows.length}:`);
    console.error(JSON.stringify(postRows, null, 2));
    process.exit(1);
  }

  const postCountRes = await db
    .select({ count: sql`count(*)` })
    .from(hosts);
  const postTotalCount = Number(postCountRes[0]?.count ?? 0);

  const deletedN = preRows.length;
  console.log(
    `OK: deleted ${deletedN} rows, phantoms gone, DB row count = ${postTotalCount} (was ${preTotalCount})`,
  );
}

try {
  await main();
  process.exit(0);
} catch (e) {
  console.error("!!! delete-phantom-hosts.mjs FAILED !!!");
  console.error(e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
}
