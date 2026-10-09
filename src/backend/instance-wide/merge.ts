/**
 * instance-wide/merge.ts — the per-file decision between a machine's copy of an
 * item and the master copy. Pure: no I/O.
 *
 * Inputs per item:
 *   base   — what the machine and the master agreed on at the last successful
 *            sync (null = never synced this machine for this item)
 *   master — the master copy now
 *   host   — the machine's copy now (null = the whole folder is missing)
 *   adminHost — the machine is owned by an admin, so its changes may flow back
 *
 * Rules (per path):
 *   - folder missing            → restore every master file; never a removal
 *   - never synced before       → master wins, no conflicts (initial install)
 *   - host == master            → nothing
 *   - host unchanged since base → host takes the master's version
 *   - master unchanged, host changed:
 *       admin host → the host's version becomes the master
 *       otherwise  → host is put back to the master
 *   - both changed differently:
 *       admin host → master keeps its version (first arrival wins); the host's
 *                    version is set aside as a conflict copy before overwrite
 *       otherwise  → host is put back to the master
 */
import type { Manifest } from "./model.js";

export interface MergePlan {
  /** Copy the host's file up into the master. */
  masterWrites: string[];
  /** Delete from the master (the admin host deleted it). */
  masterDeletes: string[];
  /** Copy the master's file down to the host. */
  hostWrites: string[];
  /** Delete from the host. */
  hostDeletes: string[];
  /** Save the host's current file aside as a conflict copy (before hostWrites). */
  conflicts: string[];
  /** The master manifest after masterWrites/masterDeletes are applied. */
  nextMaster: Manifest;
}

export function planMerge(
  base: Manifest | null,
  master: Manifest,
  host: Manifest | null,
  adminHost: boolean,
): MergePlan {
  const plan: MergePlan = {
    masterWrites: [],
    masterDeletes: [],
    hostWrites: [],
    hostDeletes: [],
    conflicts: [],
    nextMaster: { ...master },
  };

  if (host === null) {
    plan.hostWrites = Object.keys(master).sort();
    return plan;
  }

  const paths = new Set<string>([
    ...Object.keys(master),
    ...Object.keys(host),
    ...(base ? Object.keys(base) : []),
  ]);

  const hostTakesMaster = (p: string, m: string | undefined) => {
    if (m === undefined) plan.hostDeletes.push(p);
    else plan.hostWrites.push(p);
  };

  for (const p of [...paths].sort()) {
    const m = master[p];
    const h = host[p];
    if (h === m) continue;

    if (base === null) {
      hostTakesMaster(p, m);
      continue;
    }

    const b = base[p];
    if (h === b) {
      hostTakesMaster(p, m);
    } else if (m === b) {
      if (adminHost) {
        if (h === undefined) {
          plan.masterDeletes.push(p);
          delete plan.nextMaster[p];
        } else {
          plan.masterWrites.push(p);
          plan.nextMaster[p] = h;
        }
      } else {
        hostTakesMaster(p, m);
      }
    } else {
      if (adminHost && h !== undefined) plan.conflicts.push(p);
      hostTakesMaster(p, m);
    }
  }

  return plan;
}

export function planIsNoop(plan: MergePlan): boolean {
  return (
    plan.masterWrites.length === 0 &&
    plan.masterDeletes.length === 0 &&
    plan.hostWrites.length === 0 &&
    plan.hostDeletes.length === 0 &&
    plan.conflicts.length === 0
  );
}
