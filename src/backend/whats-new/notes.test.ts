// Guards the hand-maintained notes list: seen records refer to note ids, so
// a duplicate id would hide a note from everyone who saw the other one.
import { describe, it, expect } from "vitest";
import { WHATS_NEW_NOTES, RETIRED_NOTE_IDS } from "./notes.js";

describe("WHATS_NEW_NOTES", () => {
  it("ids are unique", () => {
    const ids = WHATS_NEW_NOTES.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no note reuses a retired id", () => {
    const retired = new Set(RETIRED_NOTE_IDS);
    for (const n of WHATS_NEW_NOTES) {
      expect(retired.has(n.id), n.id).toBe(false);
    }
  });

  it("ids are short lowercase slugs", () => {
    for (const n of WHATS_NEW_NOTES) {
      expect(n.id, n.id).toMatch(/^[a-z0-9][a-z0-9-]{0,99}$/);
    }
  });

  it("text is present and short (one or two sentences)", () => {
    for (const n of WHATS_NEW_NOTES) {
      expect(n.text.trim().length, n.id).toBeGreaterThan(0);
      expect(n.text.length, n.id).toBeLessThanOrEqual(300);
    }
  });
});
