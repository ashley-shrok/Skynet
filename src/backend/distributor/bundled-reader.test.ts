/**
 * bundled-reader.test.ts — Unit tests for the bundledReaderFromDisk pure fs adapter.
 *
 * Covers:
 *   Test 1 (success): reader returns { bytes, mode } where bytes equals file contents
 *                     and mode equals the stat.mode.
 *   Test 2 (ENOENT):  reader returns null for a non-existent path (never throws).
 *   Test 3 (EACCES):  reader returns null for an unreadable path (never throws).
 *                     Skipped when process runs as root (chmod 0o000 doesn't block root).
 *   Test 4 (never-throw): belt-and-suspenders — resolves without throwing for all paths.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledReaderFromDisk } from "./bundled-reader.js";

// ---------------------------------------------------------------------------
// Scratch-dir lifecycle
// ---------------------------------------------------------------------------

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await mkdtemp(join(tmpdir(), "bundled-reader-test-"));
});

afterEach(async () => {
  await rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("bundledReaderFromDisk", () => {
  it("Test 1 (success): returns { bytes, mode } matching file contents and stat.mode", async () => {
    const filePath = join(tmpDir, "hello.txt");
    await writeFile(filePath, "hello", { mode: 0o644 });
    await chmod(filePath, 0o600);

    const result = await bundledReaderFromDisk(filePath);

    expect(result).not.toBeNull();
    expect(result?.bytes.equals(Buffer.from("hello"))).toBe(true);
    expect(result?.mode & 0o777).toBe(0o600);
  });

  it("Test 2 (ENOENT): returns null for a non-existent path", async () => {
    const result = await bundledReaderFromDisk("/nonexistent/definitely-not-here");
    expect(result).toBeNull();
  });

  it("Test 3 (EACCES): returns null for an unreadable file (skipped as root)", async () => {
    if (process.getuid && process.getuid() === 0) return;

    const filePath = join(tmpDir, "locked.txt");
    await writeFile(filePath, "secret");
    await chmod(filePath, 0o000);

    const result = await bundledReaderFromDisk(filePath);
    expect(result).toBeNull();
  });

  it("Test 4 (never-throw): resolves without throwing for a non-existent path", async () => {
    await expect(bundledReaderFromDisk("/nope")).resolves.not.toThrow();
  });
});
