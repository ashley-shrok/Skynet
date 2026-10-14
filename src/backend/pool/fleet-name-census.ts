/**
 * Fleet-wide name census — which pool-name bases are live on which machines,
 * and when each base was last archived anywhere in this Skynet instance's
 * fleet. Read by both name pickers (pool-routes /pick + spawn-request worker)
 * so a name just retired or currently live on ANOTHER box is de-prioritized,
 * not just names on the target host.
 *
 * FED BY:
 *   - The always-on spawn-request scanner (spawn-requests/scan-orchestrator.ts)
 *     piggybacks a per-machine refresh on its existing per-host visit, at most
 *     once per REFRESH_INTERVAL_MS per machine (sooner retry after a failure).
 *     A machine never refreshed is due immediately, so the first refresh lands
 *     on the scanner's first tick after boot.
 *   - recordBirth(), called by both birth paths on a successful birth, so two
 *     births minutes apart on different machines don't both see a name as
 *     fresh before the next refresh. Recent births expire after
 *     RECENT_BIRTH_TTL_MS — by then a refresh has seen the folder.
 *
 * MACHINE IDENTITY: keyed by the host row's machineId (shared across every
 * user's row for the same box), so a box registered under several users
 * counts once. Host rows map to machines as the scanner sees them.
 *
 * STALENESS: a machine that stops answering keeps its last known picture. A
 * machine is forgotten only after it has been absent from the substrate host
 * list for FORGET_AFTER_MS (i.e. removed from Skynet, not just unreachable).
 *
 * In-memory only; empty after a restart until the first refresh lands.
 * Readers treat "no data" as "no fleet-wide preference" — naming then
 * behaves exactly as the target-host-only picker did.
 */

import { deriveBaseFromFolderName } from "./rank-pool-candidates.js";

export const REFRESH_INTERVAL_MS = 5 * 60_000;
export const RETRY_AFTER_FAILURE_MS = 60_000;
export const RECENT_BIRTH_TTL_MS = 2 * REFRESH_INTERVAL_MS;
export const FORGET_AFTER_MS = 60 * 60_000;

interface MachinePicture {
  /** Pool bases with a live identity folder on this machine. */
  live: Set<string>;
  /** Pool base → newest archive-folder mtime on this machine. */
  archived: Map<string, number>;
  refreshedAt: number;
}

interface MachineState {
  picture: MachinePicture | null;
  lastAttemptAt: number;
  lastAttemptFailed: boolean;
  lastSeenInHostListAt: number;
}

interface RecentBirth {
  base: string;
  machineKey: string | null;
  hostRowId: string;
  at: number;
}

export interface CensusSnapshot {
  /** True once at least one machine picture has landed. */
  ready: boolean;
  /** Bases live on the target's machine per the census. */
  liveOnTarget: Set<string>;
  /** Bases live on any OTHER machine. */
  liveElsewhere: Set<string>;
  /** Base → most recent archive time anywhere in the fleet. */
  lastArchivedMs: Map<string, number>;
}

export class FleetNameCensus {
  private machines = new Map<string, MachineState>();
  private hostRowToMachine = new Map<string, string>();
  private recentBirths: RecentBirth[] = [];

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** Register a host row → machine mapping and mark the machine present. */
  noteHost(hostRowId: string, machineKey: string): void {
    this.hostRowToMachine.set(hostRowId, machineKey);
    const st = this.ensure(machineKey);
    st.lastSeenInHostListAt = this.now();
  }

  /**
   * Is this machine due for a refresh? If yes, marks the attempt as started
   * (so a second host row for the same machine on the same tick is not due).
   */
  claimRefresh(machineKey: string): boolean {
    const st = this.ensure(machineKey);
    const now = this.now();
    if (st.lastAttemptAt !== 0) {
      const wait = st.lastAttemptFailed
        ? RETRY_AFTER_FAILURE_MS
        : REFRESH_INTERVAL_MS;
      if (now - st.lastAttemptAt < wait) return false;
    }
    st.lastAttemptAt = now;
    return true;
  }

  /** Replace a machine's picture with a fresh read (full folder names in). */
  recordMachine(
    machineKey: string,
    liveFolders: readonly string[],
    archivedFolders: readonly { name: string; mtimeMs: number }[],
  ): void {
    const st = this.ensure(machineKey);
    const live = new Set(liveFolders.map(deriveBaseFromFolderName));
    const archived = new Map<string, number>();
    for (const e of archivedFolders) {
      const base = deriveBaseFromFolderName(e.name);
      const prev = archived.get(base);
      if (prev === undefined || e.mtimeMs > prev) archived.set(base, e.mtimeMs);
    }
    st.picture = { live, archived, refreshedAt: this.now() };
    st.lastAttemptFailed = false;
  }

  /** A refresh attempt failed — keep the last known picture, retry sooner. */
  recordRefreshFailure(machineKey: string): void {
    this.ensure(machineKey).lastAttemptFailed = true;
  }

  /** A birth just succeeded on this host row — count the name as live now. */
  recordBirth(hostRowId: string | number, identityFolderName: string): void {
    const row = String(hostRowId);
    this.recentBirths.push({
      base: deriveBaseFromFolderName(identityFolderName),
      machineKey: this.hostRowToMachine.get(row) ?? null,
      hostRowId: row,
      at: this.now(),
    });
  }

  /** Forget machines absent from the substrate host list for a long time. */
  prune(): void {
    const now = this.now();
    for (const [key, st] of this.machines) {
      if (now - st.lastSeenInHostListAt > FORGET_AFTER_MS) {
        this.machines.delete(key);
        for (const [row, m] of this.hostRowToMachine) {
          if (m === key) this.hostRowToMachine.delete(row);
        }
      }
    }
    this.recentBirths = this.recentBirths.filter(
      (b) => now - b.at <= RECENT_BIRTH_TTL_MS,
    );
  }

  /** Fleet-wide view relative to the target host row. */
  snapshot(targetHostRowId: string | number): CensusSnapshot {
    const row = String(targetHostRowId);
    const targetMachine = this.hostRowToMachine.get(row) ?? null;
    const liveOnTarget = new Set<string>();
    const liveElsewhere = new Set<string>();
    const lastArchivedMs = new Map<string, number>();
    let ready = false;

    for (const [key, st] of this.machines) {
      if (!st.picture) continue;
      ready = true;
      const liveSet = key === targetMachine ? liveOnTarget : liveElsewhere;
      for (const b of st.picture.live) liveSet.add(b);
      for (const [b, ms] of st.picture.archived) {
        const prev = lastArchivedMs.get(b);
        if (prev === undefined || ms > prev) lastArchivedMs.set(b, ms);
      }
    }

    const now = this.now();
    for (const b of this.recentBirths) {
      if (now - b.at > RECENT_BIRTH_TTL_MS) continue;
      const onTarget =
        b.hostRowId === row ||
        (targetMachine !== null && b.machineKey === targetMachine);
      (onTarget ? liveOnTarget : liveElsewhere).add(b.base);
    }

    return { ready, liveOnTarget, liveElsewhere, lastArchivedMs };
  }

  private ensure(machineKey: string): MachineState {
    let st = this.machines.get(machineKey);
    if (!st) {
      st = {
        picture: null,
        lastAttemptAt: 0,
        lastAttemptFailed: false,
        lastSeenInHostListAt: this.now(),
      };
      this.machines.set(machineKey, st);
    }
    return st;
  }
}

let instance = new FleetNameCensus();

/** Process-wide census shared by the scanner and both name pickers. */
export function getFleetNameCensus(): FleetNameCensus {
  return instance;
}

/** Test-only: swap in a fresh census. */
export function __resetFleetNameCensusForTests(
  census: FleetNameCensus = new FleetNameCensus(),
): void {
  instance = census;
}

/**
 * One SSH exec that lists both live and archived identity folders. Lines:
 *   L<TAB><folder>
 *   A<TAB><folder><TAB><epoch-seconds-float>
 * terminated by a lone END line so a truncated read is detectable.
 */
export const CENSUS_REMOTE_CMD =
  `find "$HOME/fleet/identities" -mindepth 1 -maxdepth 1 -type d -printf 'L\\t%f\\n' 2>/dev/null; ` +
  `find "$HOME/fleet/identities-archive" -mindepth 1 -maxdepth 1 -type d -printf 'A\\t%f\\t%T@\\n' 2>/dev/null; ` +
  `echo END`;

/** Parse CENSUS_REMOTE_CMD output; null when the END marker is missing. */
export function parseCensusOutput(
  stdout: string,
  isValidFolder: (name: string) => boolean,
): { live: string[]; archived: { name: string; mtimeMs: number }[] } | null {
  const lines = stdout.split("\n").map((l) => l.trim());
  if (!lines.includes("END")) return null;
  const live: string[] = [];
  const archived: { name: string; mtimeMs: number }[] = [];
  for (const line of lines) {
    const parts = line.split("\t");
    if (parts[0] === "L" && parts.length === 2 && isValidFolder(parts[1])) {
      live.push(parts[1]);
    } else if (
      parts[0] === "A" &&
      parts.length === 3 &&
      isValidFolder(parts[1])
    ) {
      const sec = Number(parts[2]);
      if (Number.isFinite(sec)) archived.push({ name: parts[1], mtimeMs: sec * 1000 });
    }
  }
  return { live, archived };
}

/**
 * Fold the census into the target-host view both name pickers already build.
 * Target-host live names = live enumeration ∪ census live-on-target (the
 * census keeps the target covered when the live read failed). Archive times
 * are the newest seen anywhere. Names live on other machines feed the
 * ranker's live-elsewhere tier. Inputs are pool BASES (already reduced).
 */
export function mergeCensusIntoRankInput(
  target: {
    activeNames: Set<string>;
    archivedEntries: readonly { name: string; mtimeMs: number }[];
  },
  snapshot: CensusSnapshot,
): {
  activeNames: Set<string>;
  archivedEntries: { name: string; mtimeMs: number }[];
  liveElsewhere: Set<string>;
} {
  const activeNames = new Set([...target.activeNames, ...snapshot.liveOnTarget]);
  const newest = new Map(snapshot.lastArchivedMs);
  for (const e of target.archivedEntries) {
    const prev = newest.get(e.name);
    if (prev === undefined || e.mtimeMs > prev) newest.set(e.name, e.mtimeMs);
  }
  return {
    activeNames,
    archivedEntries: [...newest].map(([name, mtimeMs]) => ({ name, mtimeMs })),
    liveElsewhere: new Set(snapshot.liveElsewhere),
  };
}
