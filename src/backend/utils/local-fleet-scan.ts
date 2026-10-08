/**
 * local-fleet-scan.ts — Shared helper for local-FS scan of fleet request folders.
 *
 * ## Why this exists
 *
 * The always-on scan orchestrators (`agent-services/engine/scan-orchestrator.ts` +
 * `spawn-requests/scan-orchestrator.ts`) enumerate every substrate-eligible
 * host and SSH into each to atomically claim request-file drops. When the
 * substrate host is the container's OWN host (i.e. the host whose numeric id
 * appears in `IDENTITIES_LOCAL_HOST_IDS`, e.g. Skynet), SSH-to-self from
 * inside the container HANGS INDEFINITELY: acquireChannel's exec never
 * returns, the per-host in-flight guard stays held forever, and every
 * subsequent tick logs `"skipping host with in-flight scan (per-host guard)"`.
 *
 * Bypassing SSH entirely for the local host removes that failure mode: the
 * container has the host's `~/` bind-mounted at `/host-home` (via
 * HOME_HOST_DIR), and IDENTITIES_HOST_DIR points inside it at
 * `/host-home/fleet/identities`. The parent (`/host-home/fleet`) is where
 * `~/fleet/spawn-requests/` and `~/fleet/service-requests/` live on the
 * local host. Reading from the bind-mount is byte-identical to what an SSH
 * scan would have seen.
 *
 * ## Semantics (must match the SSH scan commands byte-for-byte)
 *
 * The SSH scan commands (agent-services `SCAN_CMD` + `SPAWN_REQUESTS_SCAN_CMD`)
 * implement an atomic-claim primitive (both use the preserveClaimed variant
 * described on scanLocalFleetFolder below):
 *   1. `cd <folder> 2>/dev/null || exit 0` — missing folder is not an error.
 *   2. `for f in *.json` — list JSON files.
 *   3. `[ ${#base} -eq 36 ] || continue` — filter to 36-char basenames (only
 *      canonical `<uuid>.json` request files pass; `<uuid>.success.json`,
 *      `<uuid>.failure.json`, `<uuid>.tmp` and companion `<uuid>.ref.<ext>`
 *      files all have basenames longer than 36 chars and are auto-filtered).
 *   4. `mv "$f" "$tmp"` where `tmp="$f.$$"` — atomic-rename to `.<pid>` suffix.
 *      Concurrent racers see the rename fail and `continue`, so exactly one
 *      caller wins per file per tick.
 *   5. `cat "$tmp"; rm -f "$tmp"` — read then delete the temp.
 *
 * This module re-implements steps 1-5 in Node fs/promises with the SAME
 * semantics: `fs.rename` is atomic on POSIX; concurrent racers see ENOENT
 * on the loser's rename and are skipped; the read+unlink pair completes
 * or the item is silently dropped (same fail-open contract).
 *
 * ## Never-throw contract
 *
 * All helpers in this module return empty arrays on any error. They
 * NEVER throw — the scan orchestrators depend on this to keep the per-host
 * in-flight guard behavior predictable. Errors are warn-logged with a
 * structured `operation: local_fleet_scan_*` field so a forensic trail
 * exists for real fs-side breakage.
 */

import path from "path";
import fs from "fs/promises";
import { systemLogger } from "./logger.js";
import { getLocalIdentitiesRoot } from "../claude-session/identity-artifact-reader.js";

/**
 * Returns the local fleet root directory — the parent of `IDENTITIES_HOST_DIR`.
 *
 * In production (container), `IDENTITIES_HOST_DIR=/host-home/fleet/identities`,
 * so this returns `/host-home/fleet` (= `~/fleet` on host). Request folders
 * sit alongside identities:
 *   - `/host-home/fleet/spawn-requests/`
 *   - `/host-home/fleet/service-requests/`
 *
 * In dev (no env var), `getLocalIdentitiesRoot()` returns `~/fleet/identities`,
 * so this returns `~/fleet` — matches the SSH scan command's `~/fleet/...` root.
 *
 * Distinct from local-fleet-install.ts's `getLocalHomeRoot()`, which returns
 * the user-home root (`~/`, a parent of this one).
 */
export function getLocalFleetRoot(): string {
  return path.dirname(getLocalIdentitiesRoot());
}

/**
 * A claimed request-file: filename + raw JSON contents.
 * Same shape callers get from parsing the tab-separated SSH scan stdout.
 */
export interface LocalFleetScanItem {
  filename: string;
  contents: string;
}

/**
 * Scan the given fleet subfolder (e.g. `"spawn-requests"` or
 * `"service-requests"`) and atomically claim every 36-char-basename
 * `<uuid>.json` file present. For each claimed file, returns `{filename,
 * contents}` — the filename is the ORIGINAL (`<uuid>.json`), the contents
 * are the raw JSON body read from the claimed file.
 *
 * Never throws. Missing folder / any FS error → returns `[]` (with warn-log
 * for genuine errors, but silent on ENOENT to match the SSH `cd || exit 0`
 * pattern).
 *
 * @param subfolder — subfolder name under the local fleet root
 *                    (e.g. `"spawn-requests"`, `"service-requests"`)
 * @param opts.preserveClaimed — when true, the atomic claim renames to
 *                    `<uuid>.claimed.json` and LEAVES it on disk (durable
 *                    in-flight marker; mirrors the SSH SPAWN_REQUESTS_SCAN_CMD
 *                    change). When false/absent, uses the historical
 *                    `<uuid>.json.<pid>` tmp + unlink flow. Spawn-requests
 *                    opts in for restart-durability + operator queue-state
 *                    visibility; agent services opt in so the agent's
 *                    helper can see its request was accepted.
 */
export async function scanLocalFleetFolder(
  subfolder: string,
  opts?: { preserveClaimed?: boolean },
): Promise<LocalFleetScanItem[]> {
  const preserveClaimed = opts?.preserveClaimed === true;
  const folderPath = path.join(getLocalFleetRoot(), subfolder);

  // Step 1: list directory entries. ENOENT is not an error — silent [].
  let entries: string[];
  try {
    entries = await fs.readdir(folderPath);
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      (err as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return [];
    }
    systemLogger.warn("local-fleet-scan: readdir failed", {
      operation: "local_fleet_scan_error",
      site: "readdir",
      subfolder,
      folderPath,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  // Step 2: filter to `<basename>.json` where basename is exactly 36 chars.
  // Same guard as the shell `[ ${#base} -eq 36 ] || continue` — auto-filters
  // `<uuid>.success.json`, `<uuid>.failure.json`, `<uuid>.tmp`, ref files, etc.
  const candidates = entries.filter((name) => {
    if (!name.endsWith(".json")) return false;
    const base = name.slice(0, -".json".length);
    return base.length === 36;
  });

  const results: LocalFleetScanItem[] = [];
  for (const filename of candidates) {
    // Step 3: atomic-claim.
    //   - preserveClaimed=false: rename `<filename>` → `<filename>.<pid>` (tmp),
    //     read, unlink. Historical behavior.
    //   - preserveClaimed=true:  rename `<filename>` → `<uuid>.claimed.json`.
    //     Read; do NOT unlink. The .claimed.json is a durable in-flight
    //     marker (survives container restart mid-birth; gives operators queue
    //     state via `ls`). Both success/failure completion writes land as
    //     separate <uuid>.success.json / <uuid>.failure.json files alongside
    //     it — the 36-char base guard above filters .claimed.json out of
    //     re-scans automatically (base is `<uuid>.claimed`, 44 chars).
    // Concurrent racers lose on the second rename attempt (ENOENT) and are
    // silently skipped. Mirrors the shell atomic-claim.
    const srcPath = path.join(folderPath, filename);
    const uuid = filename.slice(0, -".json".length);
    const claimedPath = preserveClaimed
      ? path.join(folderPath, `${uuid}.claimed.json`)
      : `${srcPath}.${process.pid}`;
    try {
      await fs.rename(srcPath, claimedPath);
    } catch {
      // Losing racer OR file vanished between readdir and rename. Silent skip
      // — matches the shell scan's `|| continue`.
      continue;
    }

    // Step 4: read the claimed file's contents.
    let contents: string;
    try {
      contents = await fs.readFile(claimedPath, "utf-8");
    } catch (err) {
      systemLogger.warn("local-fleet-scan: readFile of claimed file failed", {
        operation: "local_fleet_scan_error",
        site: "readFile",
        subfolder,
        filename,
        claimedPath,
        error: err instanceof Error ? err.message : String(err),
      });
      // In tmp mode, try to clean up the orphaned tmp — best-effort.
      // In preserve mode, leave the .claimed.json for operator visibility.
      if (!preserveClaimed) {
        try {
          await fs.unlink(claimedPath);
        } catch {
          // Nothing more we can do — log-and-move-on.
        }
      }
      continue;
    }

    // Step 5: only unlink in tmp mode. In preserve mode the .claimed.json
    // stays on disk until the worker writes .success.json / .failure.json.
    if (!preserveClaimed) {
      try {
        await fs.unlink(claimedPath);
      } catch (err) {
        systemLogger.warn("local-fleet-scan: unlink of claimed tmp failed (item still enqueued)", {
          operation: "local_fleet_scan_error",
          site: "unlink",
          subfolder,
          filename,
          claimedPath,
          error: err instanceof Error ? err.message : String(err),
        });
        // Fall through — the item's contents are already captured.
      }
    }

    results.push({ filename, contents });
  }

  return results;
}
