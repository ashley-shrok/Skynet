/**
 * instance-wide/engine.ts — keeps every fleet machine's copies of instance-wide
 * skills and roles in step with the master copy.
 *
 * Distribution is two-way:
 *   - every change made through the app is pushed out immediately
 *     (requestSync), and a catch-up pass runs every five minutes;
 *   - per machine and per item, merge.ts decides who wins: changes on a
 *     machine owned by an admin flow back into the master (and from there to
 *     everyone), changes anywhere else are put back;
 *   - a whole folder going missing is restored, never treated as a removal —
 *     removal only happens through removeItem(), which leaves tombstones so
 *     machines that were offline delete their copy when they return.
 *
 * Machines are physical boxes (hosts rows grouped by machineId), so a box that
 * several users have registered is synced once.
 *
 * Every store mutation and every per-machine sync runs under one lock, so
 * app edits interleave with a pass between machines but never mid-machine.
 */
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import {
  type ItemKind,
  type ItemKey,
  type Manifest,
  CATCH_UP_INTERVAL_MS,
  MAX_ITEM_BYTES,
  MAX_ITEM_FILES,
  OFFLINE_AFTER_MS,
  CONFLICT_MARKER,
  hostRelDir,
  isConflictCopy,
  isIgnoredPath,
  itemKey,
  manifestsEqual,
  parseItemKey,
} from "./model.js";
import { planMerge, planIsNoop } from "./merge.js";
import { InstanceWideStore, type SyncState, type MachineState } from "./store.js";
import * as hostOps from "./host-ops.js";
import { systemLogger } from "../utils/logger.js";

export interface SyncMachine {
  /** Physical-machine id (hosts.machine_id). */
  machineId: string;
  hostName: string;
  /** The machine's primary owner is an admin — its changes flow back. */
  adminOwned: boolean;
  /** Every hosts row id that points at this machine (any user). */
  hostRowIds: string[];
}

export interface EngineDeps {
  store: InstanceWideStore;
  listMachines(): Promise<SyncMachine[]>;
  acquireChannel(machine: SyncMachine): Promise<SshChannel | null>;
  releaseChannel?(machine: SyncMachine, channel: SshChannel): void;
  now?(): number;
  setInterval?(fn: () => void, ms: number): ReturnType<typeof setInterval>;
  clearInterval?(h: ReturnType<typeof setInterval>): void;
  /** Debounce before an immediate sync starts (coalesces bursts of edits). */
  immediateDelayMs?: number;
}

export type HostSyncState = "current" | "behind" | "conflict" | "offline";

export interface ItemHostStatus {
  machineId: string;
  hostName: string;
  state: HostSyncState;
  detail?: string;
  lastContactAt?: number;
  conflicts?: string[];
}

export interface ItemStatus {
  kind: ItemKind;
  name: string;
  updatedAt: number;
  behind: number;
  conflicts: number;
  hosts: ItemHostStatus[];
}

export class PromoteError extends Error {
  constructor(
    public readonly code: "not_found" | "too_large" | "unreachable" | "exists",
    message: string,
  ) {
    super(message);
    this.name = "PromoteError";
  }
}

function conflictStamp(now: number): string {
  return new Date(now).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}

function safeHostTag(hostName: string): string {
  return hostName.replace(/[^a-zA-Z0-9_-]+/g, "-").slice(0, 40) || "host";
}

export class InstanceWideEngine {
  private readonly store: InstanceWideStore;
  private readonly now: () => number;
  private lock: Promise<unknown> = Promise.resolve();
  private timer: ReturnType<typeof setInterval> | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<void> | null = null;
  private rerun = false;
  /** Machines whose next sync should treat their changes as admin changes. */
  private adminSourced = new Set<string>();
  private stopped = false;

  constructor(private readonly deps: EngineDeps) {
    this.store = deps.store;
    this.now = deps.now ?? (() => Date.now());
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  start(): void {
    const si = this.deps.setInterval ?? setInterval;
    this.timer = si(() => {
      this.requestSync();
    }, CATCH_UP_INTERVAL_MS);
    this.requestSync();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) (this.deps.clearInterval ?? clearInterval)(this.timer);
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.timer = null;
    this.pendingTimer = null;
  }

  /** Serialize a unit of work against every other store/sync operation. */
  withLock<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.lock.then(fn, fn);
    this.lock = next.catch(() => undefined);
    return next;
  }

  /**
   * Ask for a sync pass soon. Bursts coalesce; a request during a pass makes
   * the pass run once more when it ends. `adminSourcedMachineId` marks a
   * machine whose pending changes were made by an admin through the app, so
   * they flow back even if the machine itself is not admin-owned.
   */
  requestSync(opts: { adminSourcedMachineId?: string } = {}): void {
    if (this.stopped) return;
    if (opts.adminSourcedMachineId) this.adminSourced.add(opts.adminSourcedMachineId);
    if (this.running) {
      this.rerun = true;
      return;
    }
    if (this.pendingTimer) return;
    this.pendingTimer = setTimeout(() => {
      this.pendingTimer = null;
      void this.syncNow();
    }, this.deps.immediateDelayMs ?? 1000);
  }

  /** Run a full pass now (or join the one already running). */
  syncNow(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return this.running;
    }
    this.running = (async () => {
      try {
        do {
          this.rerun = false;
          await this.passOverMachines();
        } while (this.rerun && !this.stopped);
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  // -------------------------------------------------------------------------
  // Sync pass
  // -------------------------------------------------------------------------

  private async passOverMachines(): Promise<void> {
    let machines: SyncMachine[];
    try {
      machines = await this.deps.listMachines();
    } catch (err) {
      systemLogger.warn("Instance-wide: machine list failed", {
        operation: "instance_wide_machines_failed",
        error: err instanceof Error ? err.message : "unknown",
      });
      return;
    }
    let masterChanged = false;
    for (const machine of machines) {
      if (this.stopped) return;
      // Connect outside the lock: an unreachable machine can take seconds to
      // time out, and app edits should not wait on it.
      let channel: SshChannel | null = null;
      try {
        channel = await this.deps.acquireChannel(machine);
      } catch {
        channel = null;
      }
      const changed = await this.withLock(() => this.syncMachine(machine, channel));
      if (changed) masterChanged = true;
    }
    // A write-back changed the master: carry it to the machines visited earlier.
    if (masterChanged) this.rerun = true;
  }

  /** Returns true when the master copy changed (write-back). */
  private async syncMachine(machine: SyncMachine, channel: SshChannel | null): Promise<boolean> {
    const state = await this.store.loadState();
    const ms = this.machineState(state, machine);
    const now = this.now();
    ms.lastAttemptAt = now;

    const adminSourced = this.adminSourced.has(machine.machineId);
    if (!channel) {
      ms.lastError = "unreachable";
      await this.store.saveState(state);
      systemLogger.info("Instance-wide: machine unreachable", {
        operation: "instance_wide_machine_unreachable",
        machineId: machine.machineId,
        hostName: machine.hostName,
      });
      return false;
    }

    let masterChanged = false;
    try {
      const items = await this.store.listItems();
      const removals = Object.entries(state.tombstones)
        .filter(([, t]) => t.pending.includes(machine.machineId))
        .map(([key]) => key);

      const dirs = [
        ...items.map((i) => hostRelDir(i.kind, i.name)),
        ...removals.map((k) => {
          const parsed = parseItemKey(k);
          return parsed ? hostRelDir(parsed.kind, parsed.name) : "";
        }).filter(Boolean),
      ];
      const probes = await hostOps.probeFolders(channel, dirs);
      ms.lastContactAt = now;
      delete ms.lastError;
      this.adminSourced.delete(machine.machineId);

      for (const key of removals) {
        const parsed = parseItemKey(key);
        if (!parsed) continue;
        await hostOps.removeFolder(channel, hostRelDir(parsed.kind, parsed.name));
        const t = state.tombstones[key];
        t.pending = t.pending.filter((id) => id !== machine.machineId);
        if (t.pending.length === 0) delete state.tombstones[key];
        systemLogger.info("Instance-wide: removed item from machine", {
          operation: "instance_wide_item_removed_from_machine",
          machineId: machine.machineId,
          hostName: machine.hostName,
          item: key,
        });
      }

      for (const item of items) {
        const key = itemKey(item.kind, item.name);
        const dir = hostRelDir(item.kind, item.name);
        const probe = probes.get(dir);
        if (!probe) continue;
        try {
          const changed = await this.syncItem(
            channel,
            machine,
            ms,
            state,
            item.kind,
            item.name,
            probe,
            machine.adminOwned || adminSourced,
          );
          if (changed) masterChanged = true;
        } catch (err) {
          const prev = ms.items[key];
          ms.items[key] = {
            base: prev?.base ?? {},
            syncedAt: prev?.syncedAt ?? 0,
            conflicts: prev?.conflicts ?? [],
            error: err instanceof Error ? err.message : "sync failed",
          };
          systemLogger.warn("Instance-wide: item sync failed", {
            operation: "instance_wide_item_failed",
            machineId: machine.machineId,
            hostName: machine.hostName,
            item: key,
            error: err instanceof Error ? err.message : "unknown",
          });
        }
      }

      // Forget items that are gone from the master (tombstones handled above).
      for (const key of Object.keys(ms.items)) {
        const parsed = parseItemKey(key);
        if (!parsed || !items.some((i) => i.kind === parsed.kind && i.name === parsed.name)) {
          delete ms.items[key];
        }
      }
    } catch (err) {
      ms.lastError = err instanceof Error ? err.message : "sync failed";
      systemLogger.warn("Instance-wide: machine sync failed", {
        operation: "instance_wide_machine_failed",
        machineId: machine.machineId,
        hostName: machine.hostName,
        error: ms.lastError,
      });
    } finally {
      if (this.deps.releaseChannel) {
        try {
          this.deps.releaseChannel(machine, channel);
        } catch {
          /* best-effort */
        }
      }
      await this.store.saveState(state);
    }
    return masterChanged;
  }

  private async syncItem(
    ch: SshChannel,
    machine: SyncMachine,
    ms: MachineState,
    state: SyncState,
    kind: ItemKind,
    name: string,
    probe: hostOps.HostFolderProbe,
    mayWriteBack: boolean,
  ): Promise<boolean> {
    const key = itemKey(kind, name);
    const dir = hostRelDir(kind, name);
    const master = await this.store.manifest(kind, name);

    let host: Manifest | null = null;
    const conflictCopies: string[] = [];
    if (probe.manifest) {
      host = {};
      for (const [p, h] of Object.entries(probe.manifest)) {
        if (isConflictCopy(p)) conflictCopies.push(p);
        else if (!isIgnoredPath(p)) host[p] = h;
      }
    }

    const prev = ms.items[key];
    const base = prev && prev.base && prev.syncedAt > 0 ? prev.base : null;
    const plan = planMerge(base, master, host, mayWriteBack);

    if (planIsNoop(plan)) {
      ms.items[key] = { base: master, syncedAt: this.now(), conflicts: conflictCopies.sort() };
      return false;
    }

    // Write-back must not grow the item past the promotion limits.
    if (plan.masterWrites.length > 0) {
      const files = Object.keys(plan.nextMaster);
      let bytes = 0;
      for (const p of files) {
        bytes += plan.masterWrites.includes(p)
          ? probe.sizes[p] ?? 0
          : (await this.store.statFile(kind, name, p))?.size ?? 0;
      }
      if (files.length > MAX_ITEM_FILES || bytes > MAX_ITEM_BYTES) {
        throw new Error(
          `changes on ${machine.hostName} would make it larger than ${MAX_ITEM_FILES} files / ${Math.round(MAX_ITEM_BYTES / 1024 / 1024)} MB`,
        );
      }
    }

    // 1. Changes flowing back into the master.
    if (plan.masterWrites.length > 0) {
      const bytes = await hostOps.readFiles(ch, dir, plan.masterWrites);
      for (const [p, buf] of bytes) await this.store.writeFile(kind, name, p, buf);
    }
    for (const p of plan.masterDeletes) await this.store.deleteFile(kind, name, p);
    const masterChanged = plan.masterWrites.length > 0 || plan.masterDeletes.length > 0;
    if (masterChanged) {
      const meta = state.items[key] ?? { createdAt: this.now(), updatedAt: this.now() };
      meta.updatedAt = this.now();
      state.items[key] = meta;
    }

    // 2. Conflicting host versions are set aside before they are overwritten.
    const stamp = conflictStamp(this.now());
    for (const p of plan.conflicts) {
      const aside = `${p}${CONFLICT_MARKER}${safeHostTag(machine.hostName)}-${stamp}`;
      await hostOps.setAside(ch, dir, p, aside);
      conflictCopies.push(aside);
    }

    // 3. The master flowing down to the host.
    for (const p of plan.hostWrites) {
      await hostOps.writeFile(ch, dir, p, await this.store.readFile(kind, name, p));
    }
    if (plan.hostDeletes.length > 0) await hostOps.deleteFiles(ch, dir, plan.hostDeletes);
    if (plan.hostWrites.length > 0 || plan.conflicts.length > 0) {
      await hostOps.fixOwnership(ch, dir);
    }

    ms.items[key] = {
      base: plan.nextMaster,
      syncedAt: this.now(),
      conflicts: conflictCopies.sort(),
    };

    systemLogger.info("Instance-wide: item synced", {
      operation: "instance_wide_item_synced",
      machineId: machine.machineId,
      hostName: machine.hostName,
      item: key,
      restored: host === null,
      toHost: plan.hostWrites.length,
      deletedOnHost: plan.hostDeletes.length,
      toMaster: plan.masterWrites.length,
      deletedFromMaster: plan.masterDeletes.length,
      conflicts: plan.conflicts.length,
    });
    return masterChanged;
  }

  private machineState(state: SyncState, machine: SyncMachine): MachineState {
    const existing = state.machines[machine.machineId];
    if (existing) {
      existing.hostName = machine.hostName;
      return existing;
    }
    const fresh: MachineState = { hostName: machine.hostName, items: {} };
    state.machines[machine.machineId] = fresh;
    return fresh;
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  async status(): Promise<ItemStatus[]> {
    const machines = await this.deps.listMachines().catch(() => [] as SyncMachine[]);
    const state = await this.store.loadState();
    const now = this.now();
    const out: ItemStatus[] = [];
    for (const item of await this.store.listItems()) {
      const key = itemKey(item.kind, item.name);
      const master = await this.store.manifest(item.kind, item.name);
      const hosts: ItemHostStatus[] = machines.map((m) => {
        const ms = state.machines[m.machineId];
        const its = ms?.items[key];
        const base: ItemHostStatus = {
          machineId: m.machineId,
          hostName: m.hostName,
          state: "current",
          lastContactAt: ms?.lastContactAt,
        };
        if (!ms?.lastContactAt || now - ms.lastContactAt > OFFLINE_AFTER_MS) {
          return { ...base, state: "offline", detail: "not heard from recently" };
        }
        if (its?.conflicts && its.conflicts.length > 0) {
          return { ...base, state: "conflict", conflicts: its.conflicts, detail: `${its.conflicts.length} conflict copy(ies) on host` };
        }
        if (its?.error) return { ...base, state: "behind", detail: its.error };
        if (!its || its.syncedAt === 0 || !manifestsEqual(its.base, master)) {
          const detail =
            ms.lastError === "unreachable"
              ? `unreachable since ${new Date(ms.lastContactAt).toISOString()}`
              : ms.lastError ?? "waiting for next sync";
          return { ...base, state: "behind", detail };
        }
        return base;
      });
      out.push({
        kind: item.kind,
        name: item.name,
        updatedAt: state.items[key]?.updatedAt ?? 0,
        behind: hosts.filter((h) => h.state === "behind").length,
        conflicts: hosts.filter((h) => h.state === "conflict").length,
        hosts,
      });
    }
    return out;
  }

  async isInstanceWide(kind: ItemKind, name: string): Promise<boolean> {
    return this.store.hasItem(kind, name);
  }

  async listNames(kind: ItemKind): Promise<string[]> {
    return (await this.store.listItems()).filter((i) => i.kind === kind).map((i) => i.name);
  }

  // -------------------------------------------------------------------------
  // App-side mutations
  // -------------------------------------------------------------------------

  /** Edit the master copy (skills editor on the instance-wide section). */
  async editMaster<T>(kind: ItemKind, name: string, fn: (store: InstanceWideStore) => Promise<T>): Promise<T> {
    const result = await this.withLock(async () => {
      const r = await fn(this.store);
      const state = await this.store.loadState();
      const key = itemKey(kind, name);
      const meta = state.items[key] ?? { createdAt: this.now(), updatedAt: this.now() };
      meta.updatedAt = this.now();
      state.items[key] = meta;
      delete state.tombstones[key];
      await this.store.saveState(state);
      return r;
    });
    this.requestSync();
    return result;
  }

  /** Create a brand-new item from files (e.g. "new skill" in the instance-wide section). */
  async createItem(kind: ItemKind, name: string, files: Map<string, Buffer>): Promise<void> {
    await this.withLock(async () => {
      if (await this.store.hasItem(kind, name)) {
        throw new PromoteError("exists", `${kind} "${name}" is already instance-wide`);
      }
      await this.store.putItem(kind, name, files);
      const state = await this.store.loadState();
      const key = itemKey(kind, name);
      state.items[key] = { createdAt: this.now(), updatedAt: this.now() };
      delete state.tombstones[key];
      await this.store.saveState(state);
    });
    this.requestSync();
  }

  /** Machines (other than `exceptMachineId`) that already have a folder with this name. */
  async findClashes(
    kind: ItemKind,
    name: string,
    exceptMachineId?: string,
  ): Promise<{ clashes: string[]; unreachable: string[] }> {
    const clashes: string[] = [];
    const unreachable: string[] = [];
    const dir = hostRelDir(kind, name);
    for (const m of await this.deps.listMachines()) {
      if (m.machineId === exceptMachineId) continue;
      let ch: SshChannel | null = null;
      try {
        ch = await this.deps.acquireChannel(m);
        if (!ch) {
          unreachable.push(m.hostName);
          continue;
        }
        if ((await hostOps.existingFolders(ch, [dir])).has(dir)) clashes.push(m.hostName);
      } catch {
        unreachable.push(m.hostName);
      } finally {
        if (ch && this.deps.releaseChannel) this.deps.releaseChannel(m, ch);
      }
    }
    return { clashes, unreachable };
  }

  /** Size of a machine's folder, for the promote preview. */
  async inspectSource(
    kind: ItemKind,
    name: string,
    machine: SyncMachine,
  ): Promise<{ files: number; bytes: number; tooLarge: boolean }> {
    const ch = await this.deps.acquireChannel(machine);
    if (!ch) throw new PromoteError("unreachable", `${machine.hostName} is unreachable`);
    try {
      const dir = hostRelDir(kind, name);
      const probe = (await hostOps.probeFolders(ch, [dir])).get(dir);
      if (!probe?.manifest) throw new PromoteError("not_found", `${kind} "${name}" not found on ${machine.hostName}`);
      const paths = Object.keys(probe.manifest).filter((p) => !isIgnoredPath(p));
      const bytes = paths.reduce((n, p) => n + (probe.sizes[p] ?? 0), 0);
      return {
        files: paths.length,
        bytes,
        tooLarge: paths.length > MAX_ITEM_FILES || bytes > MAX_ITEM_BYTES,
      };
    } finally {
      if (this.deps.releaseChannel) this.deps.releaseChannel(machine, ch);
    }
  }

  /**
   * Make a machine's skill or role folder instance-wide. The whole folder
   * becomes the master copy; the source machine's copy IS that master, so it is
   * recorded as already in step. Same-name folders elsewhere are replaced on
   * the next sync (the caller has confirmed the clash list).
   */
  async promote(kind: ItemKind, name: string, machine: SyncMachine): Promise<{ files: number; bytes: number }> {
    const result = await this.withLock(async () => {
      if (await this.store.hasItem(kind, name)) {
        throw new PromoteError("exists", `${kind} "${name}" is already instance-wide`);
      }
      const ch = await this.deps.acquireChannel(machine);
      if (!ch) throw new PromoteError("unreachable", `${machine.hostName} is unreachable`);
      try {
        const dir = hostRelDir(kind, name);
        const probe = (await hostOps.probeFolders(ch, [dir])).get(dir);
        if (!probe?.manifest) {
          throw new PromoteError("not_found", `${kind} "${name}" not found on ${machine.hostName}`);
        }
        const paths = Object.keys(probe.manifest).filter((p) => !isIgnoredPath(p)).sort();
        const bytes = paths.reduce((n, p) => n + (probe.sizes[p] ?? 0), 0);
        if (paths.length > MAX_ITEM_FILES || bytes > MAX_ITEM_BYTES) {
          throw new PromoteError(
            "too_large",
            `the folder has ${paths.length} files / ${(bytes / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_ITEM_FILES} files / ${Math.round(MAX_ITEM_BYTES / 1024 / 1024)} MB — clean it up first`,
          );
        }
        const files = await hostOps.readFiles(ch, dir, paths);
        await this.store.putItem(kind, name, files);
        const master = await this.store.manifest(kind, name);

        const state = await this.store.loadState();
        const key = itemKey(kind, name);
        const now = this.now();
        state.items[key] = { createdAt: now, updatedAt: now };
        delete state.tombstones[key];
        const ms = this.machineState(state, machine);
        ms.lastContactAt = now;
        const conflicts = Object.keys(probe.manifest).filter(isConflictCopy).sort();
        ms.items[key] = { base: master, syncedAt: now, conflicts };
        await this.store.saveState(state);

        systemLogger.info("Instance-wide: item promoted", {
          operation: "instance_wide_item_promoted",
          item: key,
          sourceMachineId: machine.machineId,
          sourceHostName: machine.hostName,
          files: paths.length,
          bytes,
        });
        return { files: paths.length, bytes };
      } finally {
        if (this.deps.releaseChannel) this.deps.releaseChannel(machine, ch);
      }
    });
    this.requestSync();
    return result;
  }

  /**
   * Remove an item everywhere. Returns how many machines it is coming off.
   * Machines that had it but are offline delete it when they return.
   */
  async removeItem(kind: ItemKind, name: string): Promise<{ hostCount: number }> {
    const result = await this.withLock(async () => {
      const key = itemKey(kind, name);
      if (!(await this.store.hasItem(kind, name))) {
        throw new PromoteError("not_found", `${kind} "${name}" is not instance-wide`);
      }
      const state = await this.store.loadState();
      const pending = Object.entries(state.machines)
        .filter(([, ms]) => key in ms.items)
        .map(([id]) => id);
      await this.store.removeItem(kind, name);
      delete state.items[key];
      for (const ms of Object.values(state.machines)) delete ms.items[key];
      if (pending.length > 0) state.tombstones[key] = { removedAt: this.now(), pending };
      await this.store.saveState(state);
      systemLogger.info("Instance-wide: item removed", {
        operation: "instance_wide_item_removed",
        item: key,
        machines: pending.length,
      });
      return { hostCount: pending.length };
    });
    this.requestSync();
    return result;
  }

  /** Machines the item currently sits on (for the remove confirmation). */
  async hostCount(kind: ItemKind, name: string): Promise<number> {
    const state = await this.store.loadState();
    const key = itemKey(kind, name);
    return Object.values(state.machines).filter((ms) => key in ms.items).length;
  }
}

export type { ItemKey };
