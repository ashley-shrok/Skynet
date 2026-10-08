/**
 * agent-services/engine/host-io.ts — reading requests off a host and writing
 * answers back, over SSH or (for the host Skynet itself runs on) through the
 * /host-home bind mount, since SSH-to-self hangs inside the container.
 *
 * Every function here is never-throw: failures are logged and surface as an
 * empty claim, a "missing" attachment, or a dropped response (the agent's
 * helper then times out).
 */

import path from "path";
import fs from "fs/promises";
import type { Client as SSHClientType } from "ssh2";
import { systemLogger } from "../../utils/logger.js";
import {
  getLocalFleetRoot,
  scanLocalFleetFolder,
} from "../../utils/local-fleet-scan.js";
import {
  REQUESTS_DIR,
  REQUESTS_FOLDER,
  SCAN_CMD,
  STALE_FILE_MINUTES,
  UUID_RE,
  attachmentReadCmd,
  parseScanOutput,
  type ClaimedFile,
} from "./protocol.js";

/** SSH exec channel, as the boot wiring provides it. Returns null on error. */
export interface SshChannel {
  exec(command: string): Promise<string | null>;
}

type AttachmentRead = Buffer | "missing" | "too_large";

/** Request-side access to one host's service-requests folder. */
export interface HostRequestIo {
  claim(): Promise<ClaimedFile[]>;
  readAttachment(filename: string, maxBytes: number): Promise<AttachmentRead>;
}

// ---------------------------------------------------------------------------
// SSH
// ---------------------------------------------------------------------------

export function sshRequestIo(
  hostId: string,
  channel: SshChannel,
): HostRequestIo {
  return {
    async claim() {
      const stdout = await channel.exec(SCAN_CMD);
      if (stdout === null) {
        systemLogger.warn("agent-services scan: exec failed", {
          operation: "agent_services_scan_exec_failed",
          fleetHostId: hostId,
        });
        return [];
      }
      return parseScanOutput(stdout);
    },
    async readAttachment(filename, maxBytes) {
      const stdout = await channel.exec(attachmentReadCmd(filename, maxBytes));
      if (stdout === null) return "missing";
      const bytes = Buffer.from(stdout.trim(), "base64");
      if (bytes.byteLength === 0) return "missing";
      if (bytes.byteLength > maxBytes) return "too_large";
      return bytes;
    },
  };
}

// ---------------------------------------------------------------------------
// Local (bind mount)
// ---------------------------------------------------------------------------

function localRequestsDir(): string {
  return path.join(getLocalFleetRoot(), REQUESTS_FOLDER);
}

/** Local twin of the `find -mmin -delete` step in SCAN_CMD. */
async function sweepStaleLocalFiles(dir: string, now: number): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(dir);
  } catch {
    return;
  }
  const cutoff = now - STALE_FILE_MINUTES * 60_000;
  for (const name of names) {
    if (!UUID_RE.test(name.slice(0, 36)) || name[36] !== ".") continue;
    const p = path.join(dir, name);
    try {
      const st = await fs.stat(p);
      if (st.isFile() && st.mtimeMs < cutoff) await fs.unlink(p);
    } catch {
      // raced with the helper's own cleanup — fine
    }
  }
}

export function localRequestIo(now: () => number = Date.now): HostRequestIo {
  return {
    async claim() {
      await sweepStaleLocalFiles(localRequestsDir(), now());
      const items = await scanLocalFleetFolder(REQUESTS_FOLDER, {
        preserveClaimed: true,
      });
      return items.map((i) => ({
        uuid: i.filename.slice(0, -".json".length),
        body: i.contents,
      }));
    },
    async readAttachment(filename, maxBytes) {
      const p = path.join(localRequestsDir(), filename);
      try {
        const st = await fs.stat(p);
        if (st.size > maxBytes) return "too_large";
        const bytes = await fs.readFile(p);
        return bytes.byteLength === 0 ? "missing" : bytes;
      } catch {
        return "missing";
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Response writer
// ---------------------------------------------------------------------------

export interface ResponseWriterDeps {
  isLocalHostId(hostIdNum: number): boolean;
  getHostOwnerUserId(hostIdNum: number): Promise<string | null>;
  resolveHostById(hostIdNum: number, userId: string): Promise<unknown>;
  connect(hostDetails: unknown): Promise<SSHClientType>;
  writeTextAtomic(
    conn: SSHClientType | null,
    targetPath: string,
    contents: string,
  ): Promise<void>;
  writeBinaryAtomic(
    conn: SSHClientType | null,
    targetPath: string,
    bytes: Buffer,
  ): Promise<void>;
}

export interface OutgoingFile {
  filename: string;
  bytes: Buffer;
}

export type ResponseWriter = (
  hostIdNum: number,
  uuid: string,
  files: OutgoingFile[],
  responseFilename: string,
  responseJson: string,
) => Promise<void>;

/**
 * Write output files first, then the response JSON last, all atomically, over
 * one SSH connection. The agent polls for the response file, so it never sees
 * a response whose files are not there yet.
 */
export function createResponseWriter(deps: ResponseWriterDeps): ResponseWriter {
  return async (hostIdNum, uuid, files, responseFilename, responseJson) => {
    const write = async (conn: SSHClientType | null) => {
      for (const f of files) {
        await deps.writeBinaryAtomic(
          conn,
          `${REQUESTS_DIR}/${f.filename}`,
          f.bytes,
        );
      }
      await deps.writeTextAtomic(
        conn,
        `${REQUESTS_DIR}/${responseFilename}`,
        responseJson,
      );
    };
    try {
      if (deps.isLocalHostId(hostIdNum)) {
        await write(null);
        return;
      }
      const ownerUserId = await deps.getHostOwnerUserId(hostIdNum);
      const hostDetails = ownerUserId
        ? await deps.resolveHostById(hostIdNum, ownerUserId)
        : null;
      if (!hostDetails) {
        systemLogger.warn("agent-services: host not found for response write", {
          operation: "agent_services_response_host_not_found",
          uuid,
          hostIdNum,
        });
        return;
      }
      const conn = await deps.connect(hostDetails);
      try {
        await write(conn);
      } finally {
        conn.end();
      }
    } catch (err) {
      systemLogger.warn("agent-services: response write failed", {
        operation: "agent_services_response_write_failed",
        uuid,
        hostIdNum,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
}
