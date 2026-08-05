/**
 * Phase 23 (GEFM-02): Config-file schema + loader for the global-files feature.
 *
 * Reads `/app/data/global-files.json` (backed by the `skynet-data` docker volume)
 * and returns a typed config describing which files are configured for each host.
 *
 * Host-key format decision (planner-locked):
 *   Operator-authored JSON should use human-readable host NAMES (e.g. "thenasty",
 *   "workstation", "ashley-beelink") because Ashley SSH-edits the config by hand for
 *   MVP (GEFM-02 non-negotiable) and staring at numeric IDs is user-hostile.
 *
 *   However, to survive a host rename without silent config loss, this loader
 *   accepts EITHER format when looking up a host:
 *     - A non-numeric key is matched by host.name (most common case for human-edited JSON).
 *     - A numeric-string key (e.g. "42") is matched by String(host.id).
 *     - If BOTH a name-key and an id-key exist, the name-key wins (name is the
 *       operator intent; the numeric fallback is a survival heuristic only).
 *
 * Error handling:
 *   - Missing file (ENOENT) → { hosts: {} } (empty state, not an error — per GEFM-02).
 *   - JSON parse error → log + { hosts: {} } (Ashley loses the feature until the JSON
 *     is fixed, but Skynet stays up).
 *   - Unexpected shape (missing/invalid `hosts`) → log + { hosts: {} } (same safe fallback).
 *   - File size >256KB → log + { hosts: {} } (config should be tiny; anything larger
 *     is a mistake or attack).
 *   - This function never throws; all failure modes return the empty-state default.
 *
 * Pure I/O: no Express, no SSH — safe to import in any context.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { sshLogger } from "../../utils/logger.js";

// ---------------------------------------------------------------------------
// Types (GEFM-02 schema)
// ---------------------------------------------------------------------------

export type GlobalFileEntry = { path: string; label?: string };

export type GlobalFilesConfig = { hosts: Record<string, GlobalFileEntry[]> };

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const GLOBAL_FILES_CONFIG_FILENAME = "global-files.json";

/** Byte cap: reject files >256KB — config file should be tiny. */
const MAX_CONFIG_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// Path helper
// ---------------------------------------------------------------------------

/**
 * Returns the absolute filesystem path to global-files.json.
 * Mirrors the DATA_DIR fallback idiom used in database.ts L84:
 *   `process.env.DATA_DIR || "./db/data"`
 * so the same config file is found in both the Docker container (/app/data)
 * and local development (./db/data).
 */
export function getGlobalFilesConfigPath(dataDir?: string): string {
  return path.join(
    dataDir ?? process.env.DATA_DIR ?? "./db/data",
    GLOBAL_FILES_CONFIG_FILENAME,
  );
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

/**
 * Reads and parses global-files.json. Returns { hosts: {} } on any error
 * (ENOENT, parse failure, unexpected shape, oversized file) — never throws.
 */
export async function loadGlobalFilesConfig(
  dataDir?: string,
): Promise<GlobalFilesConfig> {
  const configPath = getGlobalFilesConfigPath(dataDir);

  let raw: string;
  try {
    // Check size before reading full content to guard against large files.
    const stat = await fs.stat(configPath);
    if (stat.size > MAX_CONFIG_BYTES) {
      sshLogger.error({
        operation: "global_files_config_size",
        error: `Config file is ${stat.size} bytes (max ${MAX_CONFIG_BYTES}) — returning empty state`,
        path: configPath,
      });
      return { hosts: {} };
    }
    raw = await fs.readFile(configPath, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      // Missing file is normal for hosts that haven't been configured yet.
      return { hosts: {} };
    }
    sshLogger.error({
      operation: "global_files_config_read",
      error: err instanceof Error ? err.message : String(err),
      path: configPath,
    });
    return { hosts: {} };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    sshLogger.error({
      operation: "global_files_config_parse",
      error: err instanceof Error ? err.message : String(err),
      path: configPath,
    });
    return { hosts: {} };
  }

  // Validate shape: must be { hosts: Record<string, ...> }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("hosts" in parsed) ||
    typeof (parsed as Record<string, unknown>).hosts !== "object" ||
    (parsed as Record<string, unknown>).hosts === null ||
    Array.isArray((parsed as Record<string, unknown>).hosts)
  ) {
    sshLogger.error({
      operation: "global_files_config_parse",
      error: "Config does not have expected shape { hosts: {...} }",
      path: configPath,
    });
    return { hosts: {} };
  }

  return { hosts: (parsed as GlobalFilesConfig).hosts };
}

// ---------------------------------------------------------------------------
// Host-entry resolver
// ---------------------------------------------------------------------------

/**
 * Returns the GlobalFileEntry[] for a specific host from the loaded config.
 *
 * Lookup strategy (name-first, id-fallback, name-wins-if-both):
 *   1. Try config.hosts[host.name] first (human-readable key, most common).
 *   2. Try config.hosts[String(host.id)] as numeric-string fallback.
 *   3. If both exist, the name-keyed entry wins (operator intent).
 *   4. If neither exists, return [].
 *
 * Each returned entry is validated to have a string `path`; entries missing
 * `path` are dropped with a log line (bad JSON → partial config, not crash).
 */
export function getFilesForHost(
  config: GlobalFilesConfig,
  host: { id: number; name: string },
): GlobalFileEntry[] {
  const byName = config.hosts[host.name];
  const byId = config.hosts[String(host.id)];

  // Name wins if both present (see host-key format decision in module header).
  const raw: unknown = byName !== undefined ? byName : byId;

  if (!Array.isArray(raw)) {
    return [];
  }

  const entries: GlobalFileEntry[] = [];
  for (const item of raw as unknown[]) {
    if (
      typeof item !== "object" ||
      item === null ||
      typeof (item as Record<string, unknown>).path !== "string"
    ) {
      sshLogger.error({
        operation: "global_files_config_entry",
        error: "Entry missing required `path` string — skipping",
        entry: JSON.stringify(item),
        host: host.name,
      });
      continue;
    }
    const entry: GlobalFileEntry = {
      path: (item as Record<string, unknown>).path as string,
    };
    const label = (item as Record<string, unknown>).label;
    if (typeof label === "string") {
      entry.label = label;
    }
    entries.push(entry);
  }

  return entries;
}
