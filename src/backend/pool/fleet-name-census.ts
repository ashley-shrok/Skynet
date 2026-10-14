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
 *   - recordBirth(), called by both birth paths when a birth succeeds (or may
 *     have succeeded). A recorded birth counts as live until a refresh of its
 *     machine that STARTED after the birth has landed — so an unreachable
 *     machine can't let a just-born name look fresh.
 *   - reserve(), called when a pool name is picked or suggested, so two
 *     births in flight at once on different machines don't take the same
 *     head-of-list name. Reservations simply expire after RESERVATION_TTL_MS.
 *
 * MACHINE IDENTITY: a machine is the host row's machineId (shared across
 * every user's row for the same box) plus the SSH login, since different
 * logins on one box have different fleet folders. A box registered by several
 * users under the same login counts once. Host rows map to machines as the
 * scanner sees them.
 *
 * STALENESS: a machine that stops answering keeps its last known picture. A
 * read that suddenly shows NO live agents where the last one showed some is
 * only believed once a second read agrees (a broken mount or home dir looks
 * exactly like an empty fleet). A machine is forgotten only after it has been
 * absent from the substrate host list for FORGET_AFTER_MS.
 *
 * In-memory only; empty after a restart until the first refresh lands.
 * Readers treat "no data" as "no fleet-wide preference" — naming then
 * behaves exactly as the target-host-only picker did.
 */

import { deriveBaseFromFolderName } from "./rank-pool-candidates.js";

export const REFRESH_INTERVAL_MS = 5 * 60_000;
export const RETRY_AFTER_FAILURE_MS = 60_000;
/** Lifetime of a birth whose host row isn't mapped to a machine yet. */
export const RECENT_BIRTH_TTL_MS = 2 * REFRESH_INTERVAL_MS;
export const RESERVATION_TTL_MS = 10 * 60_000;
export const FORGET_AFTER_MS = 60 * 60_000;

/** Census key for one fleet: the box plus the SSH login that reads it. */
export function censusMachineKey(
  machineId: string,
  username: unknown,
): string {
  return typeof username === "string" && username.length > 0
    ? `${machineId}|${username}`
    : machineId;
}

interface MachinePicture {
  /** Pool bases with a live identity folder on this machine. */
  live: Set<string>;
  /** Pool base → newest archive-folder mtime on this machine. */
  archived: Map<string, number>;
  /** When the read that produced this picture started. */
  readStartedAt: number;
}

interface MachineState {
  picture: MachinePicture | null;
  lastAttemptAt: number;
  lastAttemptFailed: boolean;
  lastSeenInHostListAt: number;
  /** A read showed zero live agents over a non-empty picture; awaiting a second. */
  pendingEmpty: boolean;
}

interface NameHold {
  kind: "birth" | "reservation";
  base: string;
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
  private holds: NameHold[] = [];

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

  /**
   * Replace a machine's picture with a fresh read (full folder names in).
   * Returns false when the read was held back pending confirmation (it shows
   * no live agents where the last picture had some) — treated like a failed
   * read: last picture kept, sooner retry.
   */
  recordMachine(
    machineKey: string,
    liveFolders: readonly string[],
    archivedFolders: readonly { name: string; mtimeMs: number }[],
  ): boolean {
    const st = this.ensure(machineKey);
    if (
      liveFolders.length === 0 &&
      st.picture !== null &&
      st.picture.live.size > 0 &&
      !st.pendingEmpty
    ) {
      st.pendingEmpty = true;
      st.lastAttemptFailed = true;
      return false;
    }
    st.pendingEmpty = false;
    const live = new Set(liveFolders.map(deriveBaseFromFolderName));
    const archived = new Map<string, number>();
    for (const e of archivedFolders) {
      const base = deriveBaseFromFolderName(e.name);
      const prev = archived.get(base);
      if (prev === undefined || e.mtimeMs > prev) archived.set(base, e.mtimeMs);
    }
    st.picture = {
      live,
      archived,
      readStartedAt: st.lastAttemptAt || this.now(),
    };
    st.lastAttemptFailed = false;
    return true;
  }

  /** A refresh attempt failed — keep the last known picture, retry sooner. */
  recordRefreshFailure(machineKey: string): void {
    this.ensure(machineKey).lastAttemptFailed = true;
  }

  /**
   * A birth succeeded (or may have) on this host row — count the name as live
   * until a refresh of that machine started after now has landed.
   */
  recordBirth(hostRowId: string | number, identityFolderName: string): void {
    this.hold("birth", hostRowId, identityFolderName);
  }

  /** A pool name was just picked/suggested for this host row — hold it briefly. */
  reserve(hostRowId: string | number, name: string): void {
    this.hold("reservation", hostRowId, name);
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
    this.holds = this.holds.filter((h) => this.holdActive(h, now));
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
    for (const h of this.holds) {
      if (!this.holdActive(h, now)) continue;
      const holdMachine = this.hostRowToMachine.get(h.hostRowId) ?? null;
      const onTarget =
        h.hostRowId === row ||
        (targetMachine !== null && holdMachine === targetMachine);
      (onTarget ? liveOnTarget : liveElsewhere).add(h.base);
    }

    return { ready, liveOnTarget, liveElsewhere, lastArchivedMs };
  }

  private hold(
    kind: NameHold["kind"],
    hostRowId: string | number,
    name: string,
  ): void {
    this.holds.push({
      kind,
      base: deriveBaseFromFolderName(name),
      hostRowId: String(hostRowId),
      at: this.now(),
    });
  }

  private holdActive(h: NameHold, now: number): boolean {
    if (h.kind === "reservation") return now - h.at <= RESERVATION_TTL_MS;
    const key = this.hostRowToMachine.get(h.hostRowId);
    if (key === undefined) return now - h.at <= RECENT_BIRTH_TTL_MS;
    const picture = this.machines.get(key)?.picture;
    // Strictly after: a read that started in the same instant may have
    // listed the folder before the birth created it.
    return !(picture && picture.readStartedAt > h.at);
  }

  private ensure(machineKey: string): MachineState {
    let st = this.machines.get(machineKey);
    if (!st) {
      st = {
        picture: null,
        lastAttemptAt: 0,
        lastAttemptFailed: false,
        lastSeenInHostListAt: this.now(),
        pendingEmpty: false,
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
 *   ERR      — a folder exists but couldn't be fully listed
 * terminated by a lone END line so a truncated read is detectable. A missing
 * folder is a legitimate empty list (a box that never archived anyone).
 */
export const CENSUS_REMOTE_CMD =
  `d="$HOME/fleet/identities"; if [ -d "$d" ]; then find "$d" -mindepth 1 -maxdepth 1 -type d -printf 'L\\t%f\\n' 2>/dev/null || echo ERR; fi; ` +
  `d="$HOME/fleet/identities-archive"; if [ -d "$d" ]; then find "$d" -mindepth 1 -maxdepth 1 -type d -printf 'A\\t%f\\t%T@\\n' 2>/dev/null || echo ERR; fi; ` +
  `echo END`;

/** Parse CENSUS_REMOTE_CMD output; null when truncated or a listing failed. */
export function parseCensusOutput(
  stdout: string,
  isValidFolder: (name: string) => boolean,
): { live: string[]; archived: { name: string; mtimeMs: number }[] } | null {
  const lines = stdout.split("\n").map((l) => l.trim());
  if (!lines.includes("END") || lines.includes("ERR")) return null;
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
