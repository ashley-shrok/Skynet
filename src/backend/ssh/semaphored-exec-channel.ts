/**
 * semaphored-exec-channel.ts — the one SshChannel adapter shape every
 * long-lived per-host producer (fleet-status poll, substrate distributor,
 * spawn-scan, agent-services scan) wraps around a cached ssh2 Client.
 *
 * Each exec:
 *   - takes a slot from the shared per-host semaphore (host-semaphore-registry),
 *   - runs execCommand / execCommandWithStdin with a timeout PASSED INTO the
 *     exec, so on expiry the channel is closed and the semaphore slot frees.
 *     Callers that merely Promise.race the exec against their own budget
 *     abandon the promise but leave the exec (and its slot) running until
 *     execCommand's own 30-min default ceiling — that leak is what this
 *     adapter closes off.
 *   - resolves null on any failure (SSH error, non-zero exit with empty
 *     stdout, timeout) — the historical SshChannel contract.
 *
 * The per-call `opts.timeoutMs` wins over the subsystem default
 * (`defaultTimeoutMs`), so a caller with a tight race budget passes it through
 * and a caller with a long legitimate exec (harness install) passes a longer
 * one explicitly.
 */
import type { Client } from "ssh2";
import { systemLogger } from "../utils/logger.js";
import { getHostSemaphore, type HostSemaphore } from "./host-semaphore-registry.js";
import {
  ExecTimeoutError,
  execCommand as defaultExecCommand,
  execCommandWithStdin as defaultExecCommandWithStdin,
  type ExecOptions,
} from "./tmux-helper.js";

export interface ChannelExecOptions {
  /** Ceiling for this exec, closing the channel (and freeing the slot) on
   *  expiry. Defaults to the adapter's subsystem default. */
  timeoutMs?: number;
}

export interface SemaphoredExecChannel {
  exec(command: string, stdinBody?: Buffer, opts?: ChannelExecOptions): Promise<string | null>;
  peer?: string;
}

export interface SemaphoredExecChannelParams {
  client: Client;
  hostId: string | number;
  /** Log tag for the producer ("fleet_status", "substrate", ...). */
  subsystem: string;
  /** Exec ceiling when the caller passes no opts.timeoutMs. */
  defaultTimeoutMs: number;
  peer?: string;
  /** Injection points (tests). Default to the shared registry / tmux-helper. */
  semaphore?: HostSemaphore;
  execCommand?: (conn: Client, command: string, opts?: ExecOptions) => Promise<string>;
  execCommandWithStdin?: (
    conn: Client,
    command: string,
    stdinBody: Buffer,
    opts?: ExecOptions,
  ) => Promise<string>;
}

export function createSemaphoredExecChannel(
  params: SemaphoredExecChannelParams,
): SemaphoredExecChannel {
  const sem = params.semaphore ?? getHostSemaphore(params.hostId);
  const run = params.execCommand ?? defaultExecCommand;
  const runStdin = params.execCommandWithStdin ?? defaultExecCommandWithStdin;
  const { client, hostId, subsystem, defaultTimeoutMs } = params;
  const channel: SemaphoredExecChannel = {
    exec: async (command, stdinBody, opts) => {
      const timeoutMs = opts?.timeoutMs ?? defaultTimeoutMs;
      try {
        return await sem.run(() =>
          stdinBody === undefined
            ? run(client, command, { timeoutMs })
            : runStdin(client, command, stdinBody, { timeoutMs }),
        );
      } catch (err) {
        if (err instanceof ExecTimeoutError) {
          systemLogger.warn(`${subsystem}: SSH exec hit its timeout — channel closed, slot freed`, {
            operation: "ssh_channel_exec_timeout",
            subsystem,
            fleetHostId: String(hostId),
            timeoutMs,
            phase: err.phase,
            timeoutSource: opts?.timeoutMs !== undefined ? "caller" : "subsystem_default",
            command: command.slice(0, 80),
          });
        }
        return null;
      }
    },
  };
  if (params.peer !== undefined) channel.peer = params.peer;
  return channel;
}
