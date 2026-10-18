/**
 * database-save-trigger.test.ts — a save asked for while another is writing
 * is not dropped: one more save runs after the in-flight one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("./logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { DatabaseSaveTrigger } from "./database-save-trigger.js";

function deferredSave() {
  const releases: Array<() => void> = [];
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        releases.push(resolve);
      }),
  );
  return { save, releaseNext: () => releases.shift()?.() };
}

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  DatabaseSaveTrigger.cleanup();
});
afterEach(() => {
  vi.useRealTimers();
  DatabaseSaveTrigger.cleanup();
});

describe("DatabaseSaveTrigger overlap", () => {
  it("a force save during an in-flight save runs once more after it", async () => {
    const { save, releaseNext } = deferredSave();
    DatabaseSaveTrigger.initialize(save);
    const first = DatabaseSaveTrigger.forceSave("a");
    await DatabaseSaveTrigger.forceSave("b"); // overlaps: returns at once
    expect(save).toHaveBeenCalledTimes(1);
    releaseNext();
    await first;
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
    releaseNext();
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("several overlapping requests collapse into one rerun", async () => {
    const { save, releaseNext } = deferredSave();
    DatabaseSaveTrigger.initialize(save);
    const first = DatabaseSaveTrigger.forceSave("a");
    await DatabaseSaveTrigger.forceSave("b");
    await DatabaseSaveTrigger.forceSave("c");
    releaseNext();
    await first;
    await flush();
    releaseNext();
    await flush();
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("a debounced save that fires during an in-flight save reruns after it", async () => {
    vi.useFakeTimers();
    const { save, releaseNext } = deferredSave();
    DatabaseSaveTrigger.initialize(save);
    const first = DatabaseSaveTrigger.forceSave("a");
    await DatabaseSaveTrigger.triggerSave("b");
    await vi.advanceTimersByTimeAsync(2000);
    expect(save).toHaveBeenCalledTimes(1);
    releaseNext();
    await first;
    await vi.advanceTimersByTimeAsync(0);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("no overlap, no rerun", async () => {
    const save = vi.fn(async () => {});
    DatabaseSaveTrigger.initialize(save);
    await DatabaseSaveTrigger.forceSave("a");
    await flush();
    expect(save).toHaveBeenCalledTimes(1);
  });
});
