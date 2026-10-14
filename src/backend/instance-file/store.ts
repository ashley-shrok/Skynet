/**
 * instance-file/store.ts — the instance file: one CLAUDE.md whose contents the
 * fleet-substrate distributor installs at /etc/claude-code/CLAUDE.md on every
 * root-SSH host, so it loads into every Claude session across the instance.
 *
 * Stored as a plain file at <DATA_DIR>/instance-file/CLAUDE.md (same volume as
 * the instance-wide master copies). Edited through /instance-file (admin UI or
 * API); empty content means "no instance file" and the distributor removes it
 * from hosts.
 */
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

export const MAX_INSTANCE_FILE_BYTES = 256 * 1024;

export class InstanceFileTooLargeError extends Error {
  constructor(bytes: number) {
    super(`instance file is ${bytes} bytes (max ${MAX_INSTANCE_FILE_BYTES})`);
  }
}

export function instanceFilePath(): string {
  return path.join(process.env.DATA_DIR || "./db/data", "instance-file", "CLAUDE.md");
}

/** Current contents; "" when nothing has been saved. Throws on read errors other than ENOENT. */
export async function readInstanceFile(filePath: string = instanceFilePath()): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw err;
  }
}

/** Atomic replace (tmp + rename). Empty content deletes the file. */
export async function writeInstanceFile(
  content: string,
  filePath: string = instanceFilePath(),
): Promise<void> {
  const bytes = Buffer.byteLength(content, "utf-8");
  if (bytes > MAX_INSTANCE_FILE_BYTES) throw new InstanceFileTooLargeError(bytes);
  if (content.trim() === "") {
    await fs.rm(filePath, { force: true });
    return;
  }
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  await fs.writeFile(tmp, content, "utf-8");
  await fs.rename(tmp, filePath);
}

/**
 * Bytes for the distributor's "instance-policy" runtime row. Null (= remove
 * from hosts) when unset or blank. Throws on read errors other than ENOENT so
 * the caller can keep its previous bytes instead of treating a failed read as
 * "unset".
 */
export async function readInstanceFileBytes(filePath: string = instanceFilePath()): Promise<Buffer | null> {
  const text = await readInstanceFile(filePath);
  return text.trim() === "" ? null : Buffer.from(text, "utf-8");
}
