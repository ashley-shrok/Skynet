/**
 * instance-file/store.test.ts — the instance file's on-disk store
 * (<DATA_DIR>/instance-file/CLAUDE.md). Real filesystem in a temp dir.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

vi.mock("../utils/logger.js", () => ({
  systemLogger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  InstanceFileTooLargeError,
  MAX_INSTANCE_FILE_BYTES,
  instanceFilePath,
  readInstanceFile,
  readInstanceFileBytes,
  writeInstanceFile,
} from "./store.js";

let dataDir: string;
const prevDataDir = process.env.DATA_DIR;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "instance-file-"));
  process.env.DATA_DIR = dataDir;
});

afterEach(async () => {
  if (prevDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prevDataDir;
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("instance-file store", () => {
  it("lives at <DATA_DIR>/instance-file/CLAUDE.md", () => {
    expect(instanceFilePath()).toBe(path.join(dataDir, "instance-file", "CLAUDE.md"));
  });

  it("missing file reads as empty string and null bytes", async () => {
    expect(await readInstanceFile()).toBe("");
    expect(await readInstanceFileBytes()).toBeNull();
  });

  it("round-trips write → read (creating the directory) and serves the bytes", async () => {
    const content = "# Instance rules\n\nBe kind. ✓\n";
    await writeInstanceFile(content);

    expect(await fs.readFile(instanceFilePath(), "utf-8")).toBe(content);
    expect(await readInstanceFile()).toBe(content);
    const bytes = await readInstanceFileBytes();
    expect(bytes).toBeInstanceOf(Buffer);
    expect(bytes?.toString("utf-8")).toBe(content);
    // Atomic replace leaves no tmp files behind.
    expect(await fs.readdir(path.dirname(instanceFilePath()))).toEqual(["CLAUDE.md"]);
  });

  it("blank content deletes the file and readInstanceFileBytes yields null", async () => {
    await writeInstanceFile("something");
    await writeInstanceFile("  \n\t ");

    await expect(fs.stat(instanceFilePath())).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readInstanceFile()).toBe("");
    expect(await readInstanceFileBytes()).toBeNull();
  });

  it("blank content with nothing saved is a no-op", async () => {
    await expect(writeInstanceFile("")).resolves.toBeUndefined();
    expect(await readInstanceFileBytes()).toBeNull();
  });

  it("over-cap content throws InstanceFileTooLargeError and leaves the existing file alone", async () => {
    await writeInstanceFile("keep me");
    const huge = "x".repeat(MAX_INSTANCE_FILE_BYTES + 1);

    await expect(writeInstanceFile(huge)).rejects.toBeInstanceOf(InstanceFileTooLargeError);
    expect(await readInstanceFile()).toBe("keep me");
  });

  it("cap counts UTF-8 bytes, not characters", async () => {
    // 3-byte char × (cap/3 + 1) chars > cap bytes even though chars < cap.
    const multibyte = "€".repeat(Math.floor(MAX_INSTANCE_FILE_BYTES / 3) + 1);
    await expect(writeInstanceFile(multibyte)).rejects.toBeInstanceOf(InstanceFileTooLargeError);
    await expect(writeInstanceFile("x".repeat(MAX_INSTANCE_FILE_BYTES))).resolves.toBeUndefined();
  });

  it("readInstanceFileBytes throws on a read error (not ENOENT) instead of reporting 'unset'", async () => {
    // A directory where the file should be → EISDIR on read.
    await fs.mkdir(instanceFilePath(), { recursive: true });
    await expect(readInstanceFile()).rejects.toBeTruthy();
    await expect(readInstanceFileBytes()).rejects.toBeTruthy();
  });
});
