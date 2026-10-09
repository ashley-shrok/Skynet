/**
 * instance-wide/store.ts — the master copy, on the app's data volume.
 *
 * Layout under <DATA_DIR>/instance-wide/:
 *   items/skill/<name>/...   whole skill folders
 *   items/role/<name>/...    whole role folders
 *   state.json               per-item metadata, removal tombstones, and the
 *                            per-machine sync baselines/status (SyncState)
 *
 * Plain files rather than DB rows: items are folders, and the DB is an
 * in-memory SQLite that only persists on explicit save triggers. The store is
 * not internally locked — callers serialize through the engine's lock.
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import {
  type ItemKind,
  type ItemKey,
  type Manifest,
  ITEM_KINDS,
  isIgnoredPath,
  isSafeRelPath,
  isValidItemName,
  itemKey,
} from "./model.js";

export interface MachineItemState {
  /** Manifest the machine and master agreed on at the last successful sync. */
  base: Manifest;
  syncedAt: number;
  /** Conflict copies currently sitting in the machine's folder. */
  conflicts: string[];
  /** Last per-item failure on this machine, cleared on success. */
  error?: string;
}

export interface MachineState {
  hostName: string;
  lastContactAt?: number;
  lastAttemptAt?: number;
  lastError?: string;
  items: Record<ItemKey, MachineItemState>;
}

export interface SyncState {
  items: Record<ItemKey, { createdAt: number; updatedAt: number }>;
  /** Removed items still to be deleted from machines that had them. */
  tombstones: Record<ItemKey, { removedAt: number; pending: string[] }>;
  machines: Record<string, MachineState>;
}

function emptyState(): SyncState {
  return { items: {}, tombstones: {}, machines: {} };
}

export function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

export function defaultStoreRoot(): string {
  return path.join(process.env.DATA_DIR || "./db/data", "instance-wide");
}

export class InstanceWideStore {
  constructor(private readonly root: string = defaultStoreRoot()) {}

  private itemDir(kind: ItemKind, name: string): string {
    if (!isValidItemName(name)) throw new Error(`invalid item name: ${name}`);
    return path.join(this.root, "items", kind, name);
  }

  private filePath(kind: ItemKind, name: string, rel: string): string {
    if (!isSafeRelPath(rel)) throw new Error(`invalid path: ${rel}`);
    const dir = this.itemDir(kind, name);
    const abs = path.join(dir, rel);
    if (!abs.startsWith(dir + path.sep)) throw new Error(`path escape: ${rel}`);
    return abs;
  }

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  async loadState(): Promise<SyncState> {
    try {
      const raw = await fs.readFile(path.join(this.root, "state.json"), "utf-8");
      const parsed = JSON.parse(raw) as Partial<SyncState>;
      return {
        items: parsed.items ?? {},
        tombstones: parsed.tombstones ?? {},
        machines: parsed.machines ?? {},
      };
    } catch {
      return emptyState();
    }
  }

  async saveState(state: SyncState): Promise<void> {
    await fs.mkdir(this.root, { recursive: true });
    const final = path.join(this.root, "state.json");
    const tmp = `${final}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state), "utf-8");
    await fs.rename(tmp, final);
  }

  // -------------------------------------------------------------------------
  // Items
  // -------------------------------------------------------------------------

  async listItems(): Promise<Array<{ kind: ItemKind; name: string }>> {
    const out: Array<{ kind: ItemKind; name: string }> = [];
    for (const kind of ITEM_KINDS) {
      let names: string[] = [];
      try {
        const entries = await fs.readdir(path.join(this.root, "items", kind), {
          withFileTypes: true,
        });
        names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
      } catch {
        names = [];
      }
      for (const name of names.sort()) {
        if (isValidItemName(name)) out.push({ kind, name });
      }
    }
    return out;
  }

  async hasItem(kind: ItemKind, name: string): Promise<boolean> {
    try {
      return (await fs.stat(this.itemDir(kind, name))).isDirectory();
    } catch {
      return false;
    }
  }

  /** Every file in the item, relative paths, ignored files excluded, sorted. */
  async listFiles(kind: ItemKind, name: string): Promise<string[]> {
    const dir = this.itemDir(kind, name);
    const out: string[] = [];
    async function walk(abs: string, rel: string): Promise<void> {
      let entries;
      try {
        entries = await fs.readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(path.join(abs, e.name), childRel);
        else if (e.isFile() && !isIgnoredPath(childRel)) out.push(childRel);
      }
    }
    await walk(dir, "");
    return out.sort();
  }

  async manifest(kind: ItemKind, name: string): Promise<Manifest> {
    const m: Manifest = {};
    for (const rel of await this.listFiles(kind, name)) {
      m[rel] = sha256(await fs.readFile(this.filePath(kind, name, rel)));
    }
    return m;
  }

  async readFile(kind: ItemKind, name: string, rel: string): Promise<Buffer> {
    return fs.readFile(this.filePath(kind, name, rel));
  }

  async statFile(
    kind: ItemKind,
    name: string,
    rel: string,
  ): Promise<{ mtime: number; size: number } | null> {
    try {
      const st = await fs.stat(this.filePath(kind, name, rel));
      if (!st.isFile()) return null;
      return { mtime: Math.floor(st.mtimeMs / 1000), size: st.size };
    } catch {
      return null;
    }
  }

  async writeFile(kind: ItemKind, name: string, rel: string, bytes: Buffer): Promise<void> {
    const abs = this.filePath(kind, name, rel);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.iw-tmp`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, abs);
  }

  async deleteFile(kind: ItemKind, name: string, rel: string): Promise<void> {
    const abs = this.filePath(kind, name, rel);
    await fs.rm(abs, { force: true });
    // Prune now-empty parent folders up to (not including) the item root.
    const root = this.itemDir(kind, name);
    let dir = path.dirname(abs);
    while (dir.startsWith(root + path.sep)) {
      try {
        await fs.rmdir(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }

  /** Create (or wholly replace) an item from a set of files. */
  async putItem(kind: ItemKind, name: string, files: Map<string, Buffer>): Promise<void> {
    const dir = this.itemDir(kind, name);
    const staging = `${dir}.staging-${process.pid}-${Date.now()}`;
    await fs.rm(staging, { recursive: true, force: true });
    await fs.mkdir(staging, { recursive: true });
    for (const [rel, bytes] of files) {
      if (!isSafeRelPath(rel)) throw new Error(`invalid path: ${rel}`);
      const abs = path.join(staging, rel);
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, bytes);
    }
    await fs.mkdir(path.dirname(dir), { recursive: true });
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rename(staging, dir);
  }

  async removeItem(kind: ItemKind, name: string): Promise<void> {
    await fs.rm(this.itemDir(kind, name), { recursive: true, force: true });
  }

  key(kind: ItemKind, name: string): ItemKey {
    return itemKey(kind, name);
  }
}
