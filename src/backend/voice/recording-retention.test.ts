import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pruneOldRecordings, recordingsMaxAgeMs } from "./recording-retention.js";

const DAY = 24 * 60 * 60 * 1000;

describe("pruneOldRecordings", () => {
  let dir: string;
  const now = Date.UTC(2026, 9, 16);

  const touch = (rel: string, ageDays: number) => {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "x");
    const t = new Date(now - ageDays * DAY);
    fs.utimesSync(p, t, t);
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rec-retention-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("deletes files older than the max age, top level and one subdir deep", async () => {
    touch("old.webm", 20);
    touch("new.webm", 3);
    touch("tts-bank/old.wav", 15);
    touch("tts-bank/new.wav", 1);
    touch("tts-bank/deeper/old.wav", 30);

    const removed = await pruneOldRecordings(dir, 14 * DAY, now);

    expect(removed).toBe(2);
    expect(fs.existsSync(path.join(dir, "old.webm"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "new.webm"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "tts-bank/old.wav"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "tts-bank/new.wav"))).toBe(true);
    // Only one level of subdirectories is swept.
    expect(fs.existsSync(path.join(dir, "tts-bank/deeper/old.wav"))).toBe(true);
  });

  it("returns 0 for a missing directory", async () => {
    expect(await pruneOldRecordings(path.join(dir, "nope"), 14 * DAY, now)).toBe(0);
  });
});

describe("recordingsMaxAgeMs", () => {
  const saved = process.env.STT_RECORDINGS_MAX_AGE_DAYS;
  afterEach(() => {
    if (saved === undefined) delete process.env.STT_RECORDINGS_MAX_AGE_DAYS;
    else process.env.STT_RECORDINGS_MAX_AGE_DAYS = saved;
  });

  it("defaults to 14 days and honors a valid override", () => {
    delete process.env.STT_RECORDINGS_MAX_AGE_DAYS;
    expect(recordingsMaxAgeMs()).toBe(14 * DAY);
    process.env.STT_RECORDINGS_MAX_AGE_DAYS = "7";
    expect(recordingsMaxAgeMs()).toBe(7 * DAY);
    process.env.STT_RECORDINGS_MAX_AGE_DAYS = "garbage";
    expect(recordingsMaxAgeMs()).toBe(14 * DAY);
  });
});
