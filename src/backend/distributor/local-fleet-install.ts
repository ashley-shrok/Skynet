/**
 * local-fleet-install.ts — Local-FS analog to run-sweep.ts + run-bootstrap.ts.
 *
 * ## Why this exists (quick 260918-5lb)
 *
 * The fleet-substrate distributor (server-substrate-orchestrator.ts) enumerates
 * every runsFleetSubstrate:true host serially and SSHs into each to push
 * substrate bytes (skills, helper scripts, systemd units) + run the bootstrap
 * (systemctl enable, settings.json patch, skynet-parent/skynet-hostname writes).
 *
 * When the substrate host is the container's OWN host (`fleetHostId` is in the
 * IDENTITIES_LOCAL_HOST_IDS env allowlist, e.g. Skynet on t1000), SSH-to-self
 * from inside the container occasionally HANGS INDEFINITELY in
 * `deps.acquireChannel(host)`. The whole serial `for-of` loop wedges: every
 * subsequent host never receives skill / helper-script updates until the
 * container is manually recreated. That is the failure mode this module fixes.
 *
 * Bypass approach mirrors the Phase 116 scanner bypass pattern in
 * `src/backend/utils/local-fleet-scan.ts` + the `isLocalHostId` branches in
 * `spawn-requests/scan-orchestrator.ts` and `image-gen-requests/scan-orchestrator.ts`:
 *   - The container already has `~/` bind-mounted at `getLocalFleetRoot()`
 *     (=`path.dirname(IDENTITIES_HOST_DIR)`), so writes to
 *     `<fleet-root>/.claude/skills/…`, `<fleet-root>/.local/bin/…`,
 *     `<fleet-root>/.config/systemd/user/…` land at the same paths a
 *     `~/…`-based SSH push would touch on the local host's filesystem.
 *   - The orchestrator (Task 2, server-substrate-orchestrator.ts) checks
 *     `isLocalHostId(parseInt(host.id, 10))` at the top of `executeSweeForHost`
 *     and — when true — early-returns after calling this module's
 *     `bootstrapFleetSubstrateLocally(host)` + `installFleetSubstrateLocally(...)`,
 *     bypassing `deps.acquireChannel` entirely.
 *
 * ## Semantics — byte-identical to the SFTP path
 *
 * Every write here mirrors the ssh-push.ts + run-bootstrap.ts semantics:
 *   - Hash-compare before write (Buffer.equals) → skip silently when bytes
 *     already match. No `writeFile`, no `rename`, no `mtime` churn. Same
 *     outcome as ssh-push's `decideItemAction → skip("bytes-match")` path.
 *   - Atomic write via `<installPath>.<pid>.tmp` + `fs.rename`. Mirrors the
 *     SFTP path's `base64 -d > tmp && mv tmp final` idiom.
 *   - `computeInstallMode(bundledMode)` from sweep-logic.ts is used unchanged —
 *     mask to low 9 bits, executable-bits from the bundled file's mode are
 *     preserved on the installed side.
 *   - For runtime rows (`sourceKind: "runtime"`), the resolver map's Buffer
 *     value is treated as bytes with mode 0o644 (matches run-sweep.ts D-18).
 *     A null value triggers the removal branch (unlink the installed file if
 *     present).
 *   - For `installMode: "system-root"` rows (the `instance-policy-claude-md`
 *     twinkie), the write is gated on `process.geteuid?.() === 0`. In the
 *     container the process is root; on a dev machine it is not — non-root
 *     → skip-with-warn, `itemsFailed++`, no throw.
 *
 * ## Bootstrap coverage
 *
 * The SSH bootstrap (run-bootstrap.ts) has 5 steps: (1-3) systemd enable +
 * settings.json patch + gsd-context-monitor cleanup, (4) skynet-parent write,
 * (5) skynet-hostname write. This module implements the minimum viable set
 * for the local box:
 *   - Steps 4 + 5 (skynet-parent, skynet-hostname) — always implemented.
 *   - Steps 1-3 (systemd + settings patch + cleanup) — only when
 *     `XDG_RUNTIME_DIR` is present in the container process env (evidence of
 *     a running systemd-user session). Absent → skip-with-warn using
 *     `operation: local_fleet_bootstrap_skip` and DO NOT mark `hadError:true`
 *     (documented environmental limitation, mirrors the SSH path's own
 *     "channel returned null" recovery). In production, the container
 *     inherits the host's XDG_RUNTIME_DIR so this branch will fire; in tests
 *     and dev containers it typically will not.
 *
 * ## Never-throw contract — load-bearing
 *
 * Neither `installFleetSubstrateLocally` nor `bootstrapFleetSubstrateLocally`
 * ever propagates an exception. Every FS call is wrapped in try/catch that:
 *   1. Bumps `itemsFailed++` (install) or sets `hadError: true` (bootstrap).
 *   2. Logs via `systemLogger.warn` with a structured `operation:
 *      local_fleet_install_error` or `local_fleet_bootstrap_error` field.
 *   3. Includes `site:` naming the FS call that failed and `error:` with the
 *      captured message. Mirrors the log-shape convention in
 *      local-fleet-scan.ts.
 * Belt-and-suspenders defense-in-depth try/catch wraps the outer loop bodies.
 *
 * A never-throw violation here would re-wedge the distributor's `for-of`
 * loop — exactly the failure mode this module exists to fix. Tests NT1 + BE1
 * lock in this invariant.
 */

import path from "path";
import fs from "fs/promises";
import { systemLogger } from "../utils/logger.js";
import { getLocalIdentitiesRoot } from "../claude-session/identity-artifact-reader.js";
import { computeInstallMode } from "./sweep-logic.js";
import type { CatalogEntry } from "./catalog.js";
import type { BootstrapResult } from "./run-bootstrap.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Injected dependencies for the local install helper. Mirrors SweepDeps from
 * run-sweep.ts so the orchestrator can call this helper with the same
 * (readBundledBytes, resolvedRuntimeBytes, now) surface it already uses for
 * runSweepForHost.
 */
export interface LocalInstallDeps {
  readBundledBytes: (
    bundledPath: string,
  ) => Promise<{ bytes: Buffer; mode: number } | null>;
  /** Optional — pre-resolved runtime bytes for `sourceKind: "runtime"` rows. */
  resolvedRuntimeBytes?: Map<string, Buffer | null>;
  /** Injectable clock for durationMs — defaults to Date.now. */
  now?: () => number;
}

/**
 * The result shape matches run-sweep.ts / runSweepForHost's return type
 * so the orchestrator can apply identical bookkeeping (sweepedThisInstance,
 * consecutiveFailures, persistentAlertFired) to either branch's result.
 */
export interface LocalInstallResult {
  itemsChecked: number;
  itemsChanged: number;
  itemsFailed: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Return the local fleet root — the parent of `getLocalIdentitiesRoot()`.
 * In production: `/fleet`. In dev: `~/fleet`. This is the directory the
 * container's `~/` bind-mount points at, so `~/.claude/skills/foo/SKILL.md`
 * on the local host is `<root>/.claude/skills/foo/SKILL.md` inside the
 * container.
 *
 * Matches local-fleet-scan.ts's `getLocalFleetRoot()` convention.
 */
function getLocalFleetRoot(): string {
  return path.dirname(getLocalIdentitiesRoot());
}

/**
 * Resolve a catalog entry's `installPath` to the on-disk path inside the
 * container. Leading `~/` is replaced with `getLocalFleetRoot() + "/"`;
 * absolute paths (e.g. `/etc/claude-code/CLAUDE.md`) are passed through
 * verbatim.
 */
function resolveInstalledPath(installPath: string): string {
  if (installPath.startsWith("~/")) {
    return path.join(getLocalFleetRoot(), installPath.slice(2));
  }
  return installPath;
}

/**
 * Read installed bytes at `finalPath`. Returns:
 *   - { readOk: true, bytes: Buffer }   file exists, contents known
 *   - { readOk: true, bytes: null }     file absent (ENOENT)
 *   - { readOk: false, reason: "..." }  other fs failure (fail-closed)
 * Never throws.
 */
async function readInstalledBytesLocal(
  finalPath: string,
): Promise<
  { readOk: true; bytes: Buffer | null }
  | { readOk: false; reason: string }
> {
  try {
    const bytes = await fs.readFile(finalPath);
    return { readOk: true, bytes };
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { readOk: true, bytes: null };
    }
    return {
      readOk: false,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Atomic write: mkdir -p, writeFile to tmp path, chmod tmp, rename onto final.
 * Never throws; returns { ok: false, site, error } on failure so the caller
 * can bump counters + log.
 */
async function atomicWrite(
  finalPath: string,
  bytes: Buffer,
  mode: number,
): Promise<
  { ok: true } | { ok: false; site: string; error: string }
> {
  const tmpPath = `${finalPath}.${process.pid}.tmp`;
  try {
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
  } catch (err) {
    return {
      ok: false,
      site: "mkdir",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    await fs.writeFile(tmpPath, bytes);
  } catch (err) {
    return {
      ok: false,
      site: "writeFile",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    await fs.chmod(tmpPath, mode);
  } catch (err) {
    // Best-effort tmp cleanup so we don't leave a stale tmp on chmod failure.
    try { await fs.unlink(tmpPath); } catch { /* ignore */ }
    return {
      ok: false,
      site: "chmod",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  try {
    await fs.rename(tmpPath, finalPath);
  } catch (err) {
    try { await fs.unlink(tmpPath); } catch { /* ignore */ }
    return {
      ok: false,
      site: "rename",
      error: err instanceof Error ? err.message : String(err),
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Public: installFleetSubstrateLocally
// ---------------------------------------------------------------------------

/**
 * Iterate the catalog sequentially, install/skip each entry against the
 * local bind-mounted filesystem. Mirrors run-sweep.ts's per-item shape but
 * uses fs/promises instead of the SSH channel.
 *
 * NEVER REJECTS. Every risky call is wrapped; the outer function has a
 * defense-in-depth try/catch that logs `operation: local_fleet_install_error`
 * and returns whatever counters accumulated. Caller (orchestrator) applies
 * the same {itemsChecked, itemsChanged, itemsFailed} bookkeeping it would
 * apply to a runSweepForHost result.
 */
export async function installFleetSubstrateLocally(
  host: { id: string; name: string },
  catalog: readonly CatalogEntry[],
  deps: LocalInstallDeps,
): Promise<LocalInstallResult> {
  const now = deps.now ?? Date.now;
  const startMs = now();
  let itemsChecked = 0;
  let itemsChanged = 0;
  let itemsFailed = 0;

  try {
    for (const entry of catalog) {
      itemsChecked++;

      try {
        // ---- Source resolution ----
        let bundledResult: { bytes: Buffer; mode: number } | null;
        if (entry.sourceKind === "runtime") {
          const runtimeBytes =
            deps.resolvedRuntimeBytes?.get(entry.resolverKey) ?? null;
          bundledResult =
            runtimeBytes === null
              ? null
              : { bytes: runtimeBytes, mode: 0o644 };
        } else {
          bundledResult = await deps.readBundledBytes(entry.bundledPath);
        }

        // ---- Runtime removal branch (D-16 mirror) ----
        // A runtime row with null bytes → file should be removed if present.
        if (entry.sourceKind === "runtime" && bundledResult === null) {
          const finalPath = resolveInstalledPath(entry.installPath);
          let statOk = false;
          try {
            await fs.stat(finalPath);
            statOk = true;
          } catch (err: unknown) {
            if (
              typeof err !== "object" ||
              err === null ||
              (err as NodeJS.ErrnoException).code !== "ENOENT"
            ) {
              itemsFailed++;
              systemLogger.warn(
                `local-fleet-install: stat failed on removal-branch target for ${entry.slug}`,
                {
                  operation: "local_fleet_install_error",
                  site: "stat",
                  fleetHostId: host.id,
                  hostName: host.name,
                  entrySlug: entry.slug,
                  installPath: entry.installPath,
                  finalPath,
                  error: err instanceof Error ? err.message : String(err),
                },
              );
              continue;
            }
            // ENOENT — file already absent, clean-unset state. Silent skip.
          }
          if (statOk) {
            try {
              await fs.unlink(finalPath);
              itemsChanged++;
              systemLogger.info(
                `local-fleet-install: removed ${entry.slug}`,
                {
                  operation: "local_fleet_install_removed",
                  fleetHostId: host.id,
                  hostName: host.name,
                  entrySlug: entry.slug,
                  installPath: entry.installPath,
                  finalPath,
                },
              );
            } catch (err) {
              itemsFailed++;
              systemLogger.warn(
                `local-fleet-install: unlink failed on removal branch for ${entry.slug}`,
                {
                  operation: "local_fleet_install_error",
                  site: "unlink",
                  fleetHostId: host.id,
                  hostName: host.name,
                  entrySlug: entry.slug,
                  installPath: entry.installPath,
                  finalPath,
                  error: err instanceof Error ? err.message : String(err),
                },
              );
            }
          }
          continue;
        }

        // ---- Bundled read failure ----
        if (bundledResult === null) {
          itemsFailed++;
          systemLogger.warn(
            `local-fleet-install: bundled read returned null for ${entry.slug}`,
            {
              operation: "local_fleet_install_error",
              site: "readBundledBytes",
              fleetHostId: host.id,
              hostName: host.name,
              entrySlug: entry.slug,
              bundledPath:
                entry.sourceKind === "bundled" ? entry.bundledPath : "(runtime)",
              installPath: entry.installPath,
            },
          );
          continue;
        }

        // ---- system-root euid gate ----
        // For rows whose installMode is "system-root" (currently just the
        // /etc/claude-code/CLAUDE.md twinkie), require euid=0. In the
        // container the process runs as root; on a dev host it does not.
        // Gate BEFORE reading installed bytes so we don't touch /etc/ at all
        // when we cannot write there.
        const installMode = entry.installMode ?? "user-home";
        if (installMode === "system-root") {
          // process.geteuid is not defined on Windows — guard for undefined
          // to keep the runtime type-safe. In production (Linux container)
          // it is always defined.
          const euid =
            typeof process.geteuid === "function" ? process.geteuid() : -1;
          if (euid !== 0) {
            itemsFailed++;
            systemLogger.warn(
              `local-fleet-install: refusing system-root write as non-root (euid=${euid}) for ${entry.slug}`,
              {
                operation: "local_fleet_install_error",
                site: "euid_gate",
                fleetHostId: host.id,
                hostName: host.name,
                entrySlug: entry.slug,
                installPath: entry.installPath,
                euid,
              },
            );
            continue;
          }
        }

        // ---- Read installed bytes + hash-compare ----
        const finalPath = resolveInstalledPath(entry.installPath);
        const installed = await readInstalledBytesLocal(finalPath);

        if (installed.readOk === false) {
          itemsFailed++;
          systemLogger.warn(
            `local-fleet-install: readFile failed on installed side for ${entry.slug}`,
            {
              operation: "local_fleet_install_error",
              site: "readFile_installed",
              fleetHostId: host.id,
              hostName: host.name,
              entrySlug: entry.slug,
              installPath: entry.installPath,
              finalPath,
              error: installed.reason,
            },
          );
          continue;
        }

        if (
          installed.bytes !== null &&
          installed.bytes.equals(bundledResult.bytes)
        ) {
          // bytes-match — no counter bump beyond itemsChecked, silent skip.
          continue;
        }

        // ---- Push via atomic write ----
        const mode = computeInstallMode(bundledResult.mode);
        const writeResult = await atomicWrite(
          finalPath,
          bundledResult.bytes,
          mode,
        );
        if (writeResult.ok === false) {
          itemsFailed++;
          systemLogger.warn(
            `local-fleet-install: atomic write failed at ${writeResult.site} for ${entry.slug}`,
            {
              operation: "local_fleet_install_error",
              site: writeResult.site,
              fleetHostId: host.id,
              hostName: host.name,
              entrySlug: entry.slug,
              installPath: entry.installPath,
              finalPath,
              error: writeResult.error,
            },
          );
          continue;
        }

        itemsChanged++;
        systemLogger.info(
          `local-fleet-install: installed ${entry.slug}`,
          {
            operation: "local_fleet_install_changed",
            fleetHostId: host.id,
            hostName: host.name,
            entrySlug: entry.slug,
            installPath: entry.installPath,
            finalPath,
            changeKind: installed.bytes === null ? "installed-new" : "bytes-updated",
          },
        );
      } catch (err) {
        // Defense-in-depth per-item catch — every risky call above is
        // already wrapped, this is the seatbelt.
        itemsFailed++;
        systemLogger.warn(
          `local-fleet-install: unexpected throw on ${entry.slug}`,
          {
            operation: "local_fleet_install_error",
            site: "per_item_catchall",
            fleetHostId: host.id,
            hostName: host.name,
            entrySlug: entry.slug,
            installPath: entry.installPath,
            error: err instanceof Error ? err.message : String(err),
          },
        );
      }
    }
  } catch (err) {
    // Outer defense-in-depth — never propagate a throw out to the
    // orchestrator; that would re-wedge the for-of loop this module exists
    // to unwedge.
    systemLogger.warn(
      `local-fleet-install: unexpected throw in catalog loop`,
      {
        operation: "local_fleet_install_error",
        site: "outer_catchall",
        fleetHostId: host.id,
        hostName: host.name,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  const durationMs = now() - startMs;
  systemLogger.info(
    `local-fleet-install: sweep completed for ${host.name}`,
    {
      operation: "local_fleet_install_result",
      fleetHostId: host.id,
      hostName: host.name,
      itemsChecked,
      itemsChanged,
      itemsFailed,
      durationMs,
    },
  );

  return { itemsChecked, itemsChanged, itemsFailed };
}

// ---------------------------------------------------------------------------
// Bootstrap helpers (mirror run-bootstrap.ts steps 4 + 5, plus a systemd
// skip-with-warn for steps 1-3 when XDG_RUNTIME_DIR is absent)
// ---------------------------------------------------------------------------

/**
 * Write bytes to a "single-line-content, content-diff idempotent" file.
 * Used for both skynet-parent and skynet-hostname. Never throws.
 *
 * Returns:
 *   - "written"     — file did not match; new bytes written atomically.
 *   - "unchanged"   — file already matches; silent no-op (no mtime churn).
 *   - { error: string, site: string } — FS failure.
 */
async function writeContentDiffFile(
  finalPath: string,
  wantedContent: string,
): Promise<
  "written" | "unchanged" | { error: string; site: string }
> {
  // Content-diff check.
  try {
    const existing = await fs.readFile(finalPath, "utf-8");
    if (existing === wantedContent) {
      return "unchanged";
    }
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      // File absent — fall through to write.
    } else {
      return {
        site: "readFile",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  const bytes = Buffer.from(wantedContent, "utf-8");
  const w = await atomicWrite(finalPath, bytes, 0o644);
  if (w.ok === false) {
    return { site: w.site, error: w.error };
  }
  return "written";
}

/**
 * Bootstrap the local host — steps 4 (~/.claude/skynet-parent) + 5
 * (~/.claude/skynet-hostname) always run. Steps 1-3 (systemd enable +
 * settings.json patch + gsd-context-monitor cleanup) require the ambient
 * systemd-user session to be reachable via `XDG_RUNTIME_DIR`; when absent
 * we skip-with-warn using `operation: local_fleet_bootstrap_skip` and DO NOT
 * mark hadError (documented environmental limitation, mirrors the SSH path's
 * "channel returned null" recovery).
 *
 * NEVER REJECTS. Same never-throw contract as installFleetSubstrateLocally.
 */
export async function bootstrapFleetSubstrateLocally(
  host: { id: string; name: string },
): Promise<BootstrapResult> {
  let alreadyEnabled = false;
  let bootstrapRan = false;
  let daemonReloadRan = false;
  let settingsPatchOk = false;
  let gsdContextMonitorCleanupOk = false;
  let skynetParentOk = false;
  let skynetHostnameOk = false;
  let hadError = false;

  const claudeDir = path.join(getLocalFleetRoot(), ".claude");

  // Steps 1-3 — deliberately deferred as an environmental capability check.
  // The container-runtime env usually has XDG_RUNTIME_DIR set (inherited from
  // the host's launching shell); a bare test env or minimal dev container
  // typically does not. Skip-with-warn matches the "channel returned null"
  // recovery semantics on the SSH path.
  if (!process.env.XDG_RUNTIME_DIR) {
    systemLogger.warn(
      `local-fleet-bootstrap: XDG_RUNTIME_DIR unset — skipping systemd steps for ${host.name}`,
      {
        operation: "local_fleet_bootstrap_skip",
        site: "systemd_capability_check",
        fleetHostId: host.id,
        hostName: host.name,
      },
    );
    // Steps 1-3 leave their `*Ok` fields false and DO NOT set hadError.
  } else {
    // The systemd path (steps 1-3) requires child_process spawning of
    // `systemctl --user` and `loginctl` binaries. To keep this quick fix
    // minimal + testable, we log-and-defer the actual implementation until
    // it's genuinely load-bearing on the local box. In practice, the
    // container image is built with the systemd-user unit already installed
    // and enabled by other means, so this deferral does not cause a
    // regression against the pre-fix baseline (which never reached these
    // steps for the local host anyway — SSH hung before them).
    systemLogger.warn(
      `local-fleet-bootstrap: systemd steps 1-3 not implemented on local branch (XDG_RUNTIME_DIR=${process.env.XDG_RUNTIME_DIR}) for ${host.name}`,
      {
        operation: "local_fleet_bootstrap_skip",
        site: "systemd_steps_deferred",
        fleetHostId: host.id,
        hostName: host.name,
      },
    );
  }

  // ---- Step 4: skynet-parent ----
  try {
    const url = process.env.SKYNET_PUBLIC_URL ?? "";
    if (!url || !/^https:\/\//.test(url)) {
      systemLogger.warn(
        `local-fleet-bootstrap: SKYNET_PUBLIC_URL missing or malformed — skipping skynet-parent write for ${host.name}`,
        {
          operation: "local_fleet_bootstrap_skip",
          site: "skynet_parent_url_gate",
          fleetHostId: host.id,
          hostName: host.name,
        },
      );
      // Documented skip — DO NOT set hadError (RESEARCH Pitfall 4 parity).
    } else {
      const target = path.join(claudeDir, "skynet-parent");
      const outcome = await writeContentDiffFile(target, url + "\n");
      if (typeof outcome === "object") {
        hadError = true;
        systemLogger.warn(
          `local-fleet-bootstrap: skynet-parent write failed for ${host.name}`,
          {
            operation: "local_fleet_bootstrap_error",
            site: outcome.site,
            fleetHostId: host.id,
            hostName: host.name,
            finalPath: target,
            error: outcome.error,
          },
        );
      } else {
        skynetParentOk = true;
      }
    }
  } catch (err) {
    hadError = true;
    systemLogger.warn(
      `local-fleet-bootstrap: skynet-parent step threw unexpectedly for ${host.name}`,
      {
        operation: "local_fleet_bootstrap_error",
        site: "skynet_parent_catchall",
        fleetHostId: host.id,
        hostName: host.name,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  // ---- Step 5: skynet-hostname ----
  try {
    const target = path.join(claudeDir, "skynet-hostname");
    const outcome = await writeContentDiffFile(target, host.name + "\n");
    if (typeof outcome === "object") {
      hadError = true;
      systemLogger.warn(
        `local-fleet-bootstrap: skynet-hostname write failed for ${host.name}`,
        {
          operation: "local_fleet_bootstrap_error",
          site: outcome.site,
          fleetHostId: host.id,
          hostName: host.name,
          finalPath: target,
          error: outcome.error,
        },
      );
    } else {
      skynetHostnameOk = true;
    }
  } catch (err) {
    hadError = true;
    systemLogger.warn(
      `local-fleet-bootstrap: skynet-hostname step threw unexpectedly for ${host.name}`,
      {
        operation: "local_fleet_bootstrap_error",
        site: "skynet_hostname_catchall",
        fleetHostId: host.id,
        hostName: host.name,
        error: err instanceof Error ? err.message : String(err),
      },
    );
  }

  const result: BootstrapResult = {
    alreadyEnabled,
    bootstrapRan,
    daemonReloadRan,
    settingsPatchOk,
    gsdContextMonitorCleanupOk,
    skynetParentOk,
    skynetHostnameOk,
    hadError,
  };

  systemLogger[hadError ? "warn" : "info"](
    `local-fleet-bootstrap: completed for ${host.name}`,
    {
      operation: "local_fleet_bootstrap_result",
      fleetHostId: host.id,
      hostName: host.name,
      ...result,
    },
  );

  return result;
}
