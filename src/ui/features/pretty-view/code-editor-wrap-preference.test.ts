import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  readSavedWrap,
  writeSavedWrap,
  WRAP_STORAGE_KEY,
} from "./code-editor-wrap-preference";

describe("code-editor-wrap-preference", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  describe("readSavedWrap", () => {
    it("returns false when no value is set (default off)", () => {
      expect(readSavedWrap()).toBe(false);
    });

    it("returns true when 'true' is stored", () => {
      window.localStorage.setItem(WRAP_STORAGE_KEY, "true");
      expect(readSavedWrap()).toBe(true);
    });

    it("returns false when 'false' is stored", () => {
      window.localStorage.setItem(WRAP_STORAGE_KEY, "false");
      expect(readSavedWrap()).toBe(false);
    });

    it("returns false for any non-'true' value (strict comparison)", () => {
      window.localStorage.setItem(WRAP_STORAGE_KEY, "yes");
      expect(readSavedWrap()).toBe(false);
      window.localStorage.setItem(WRAP_STORAGE_KEY, "1");
      expect(readSavedWrap()).toBe(false);
      window.localStorage.setItem(WRAP_STORAGE_KEY, "");
      expect(readSavedWrap()).toBe(false);
    });

    it("returns false when localStorage.getItem throws (private mode)", () => {
      vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
        throw new Error("localStorage disabled");
      });
      expect(readSavedWrap()).toBe(false);
    });
  });

  describe("writeSavedWrap", () => {
    it("writes 'true' when passed true", () => {
      writeSavedWrap(true);
      expect(window.localStorage.getItem(WRAP_STORAGE_KEY)).toBe("true");
    });

    it("writes 'false' when passed false", () => {
      writeSavedWrap(false);
      expect(window.localStorage.getItem(WRAP_STORAGE_KEY)).toBe("false");
    });

    it("silently swallows write failures (private mode)", () => {
      vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
        throw new Error("localStorage disabled");
      });
      expect(() => writeSavedWrap(true)).not.toThrow();
    });
  });

  describe("read → write → read round-trip", () => {
    it("persists a toggle across successive reads", () => {
      expect(readSavedWrap()).toBe(false);
      writeSavedWrap(true);
      expect(readSavedWrap()).toBe(true);
      writeSavedWrap(false);
      expect(readSavedWrap()).toBe(false);
    });
  });
});
