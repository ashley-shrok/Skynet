// Coverage for the user-scoped-cache helper. Verifies owner-tagging and the
// read-time owner-check close the "User A logs out (or auth expires), User B
// logs in on the same browser, sees User A's cached sidebar/apps/etc" leak.
//
// The six cache call-sites (fleet-sessions, projects, pinned-ids, host-tree,
// app-tiles, identities-appearance) all go through readUserScopedCache /
// writeUserScopedCache, so verifying the contract once covers them all.
// Call-site-specific tests (shape validation, canonical-field pick, legacy-row
// filters) continue to live alongside each cache in its own test file.

import { describe, it, expect, beforeEach } from "vitest";
import {
  getCurrentUser,
  readUserScopedCache,
  writeUserScopedCache,
  clearUserScopedCache,
  hasUserScopedCache,
} from "./user-scoped-cache";

const KEY = "skynet:test-cache";

function seedAuth(username: string): void {
  localStorage.setItem(
    "skynet_auth",
    JSON.stringify({ loggedIn: true, username }),
  );
}

describe("user-scoped-cache", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  describe("getCurrentUser", () => {
    it("returns null when skynet_auth is missing", () => {
      expect(getCurrentUser()).toBeNull();
    });

    it("returns the username from the canonical JSON shape", () => {
      seedAuth("alice");
      expect(getCurrentUser()).toBe("alice");
    });

    it("returns null when skynet_auth is malformed JSON", () => {
      localStorage.setItem("skynet_auth", "{not valid");
      expect(getCurrentUser()).toBeNull();
    });

    it("returns null when the stored shape lacks a username field", () => {
      localStorage.setItem(
        "skynet_auth",
        JSON.stringify({ loggedIn: true }),
      );
      expect(getCurrentUser()).toBeNull();
    });

    it("returns null when username is empty string", () => {
      localStorage.setItem(
        "skynet_auth",
        JSON.stringify({ loggedIn: true, username: "" }),
      );
      expect(getCurrentUser()).toBeNull();
    });
  });

  describe("writeUserScopedCache", () => {
    it("writes an owner-tagged wrapper around the payload", () => {
      seedAuth("alice");
      writeUserScopedCache(KEY, { foo: 1 });
      const raw = localStorage.getItem(KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string)).toEqual({
        owner: "alice",
        payload: { foo: 1 },
      });
    });

    it("is a no-op when no user is logged in", () => {
      writeUserScopedCache(KEY, { foo: 1 });
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("overwrites previous payload for the same user", () => {
      seedAuth("alice");
      writeUserScopedCache(KEY, { v: 1 });
      writeUserScopedCache(KEY, { v: 2 });
      expect(JSON.parse(localStorage.getItem(KEY) as string)).toEqual({
        owner: "alice",
        payload: { v: 2 },
      });
    });
  });

  describe("readUserScopedCache — happy path", () => {
    it("returns the payload when owner matches current user", () => {
      seedAuth("alice");
      writeUserScopedCache(KEY, { foo: 1 });
      expect(readUserScopedCache<{ foo: number }>(KEY)).toEqual({ foo: 1 });
    });
  });

  describe("readUserScopedCache — the leak-closers", () => {
    it("returns null + clears the key when owner !== current user (the core leak)", () => {
      // Simulate: User A writes cache
      seedAuth("alice");
      writeUserScopedCache(KEY, { secret: "alice-only" });
      // User B logs in on same browser
      seedAuth("bob");
      // Bob reads → gets null, cache is cleared
      expect(readUserScopedCache(KEY)).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("returns null + clears the key when payload is legacy un-tagged (bare array)", () => {
      seedAuth("alice");
      // Simulate pre-upgrade payload (bare array, no wrapper)
      localStorage.setItem(KEY, JSON.stringify([1, 2, 3]));
      expect(readUserScopedCache(KEY)).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("returns null + clears the key when payload is missing the owner field", () => {
      seedAuth("alice");
      localStorage.setItem(KEY, JSON.stringify({ payload: { foo: 1 } }));
      expect(readUserScopedCache(KEY)).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("returns null + clears the key when owner is not a string", () => {
      seedAuth("alice");
      localStorage.setItem(
        KEY,
        JSON.stringify({ owner: 42, payload: { foo: 1 } }),
      );
      expect(readUserScopedCache(KEY)).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("returns null + clears the key when no user is logged in", () => {
      // Write while logged in as alice
      seedAuth("alice");
      writeUserScopedCache(KEY, { foo: 1 });
      // Now simulate logged-out state
      localStorage.removeItem("skynet_auth");
      expect(readUserScopedCache(KEY)).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    });

    it("returns null on cache-miss (key never written) — no throw, no side effects", () => {
      seedAuth("alice");
      expect(readUserScopedCache(KEY)).toBeNull();
    });

    it("returns null on malformed JSON — defensively clears the key", () => {
      seedAuth("alice");
      localStorage.setItem(KEY, "{not valid json");
      expect(readUserScopedCache(KEY)).toBeNull();
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });

  describe("readUserScopedCache — legacy keys sweep", () => {
    it("removes every passed legacy key on first read, even on cache-miss", () => {
      seedAuth("alice");
      localStorage.setItem("skynet:test-cache:v1", "legacy-v1");
      localStorage.setItem("skynet:test-cache:v2", "legacy-v2");
      readUserScopedCache(KEY, [
        "skynet:test-cache:v1",
        "skynet:test-cache:v2",
      ]);
      expect(localStorage.getItem("skynet:test-cache:v1")).toBeNull();
      expect(localStorage.getItem("skynet:test-cache:v2")).toBeNull();
    });

    it("removes legacy keys even when owner mismatch clears current key", () => {
      // Alice writes cache
      seedAuth("alice");
      writeUserScopedCache(KEY, { foo: 1 });
      localStorage.setItem("skynet:test-cache:v1", "stale");
      // Bob reads
      seedAuth("bob");
      readUserScopedCache(KEY, ["skynet:test-cache:v1"]);
      expect(localStorage.getItem(KEY)).toBeNull();
      expect(localStorage.getItem("skynet:test-cache:v1")).toBeNull();
    });
  });

  describe("round-trip", () => {
    it("supports strings, numbers, booleans, arrays, nested objects", () => {
      seedAuth("alice");
      const payload = {
        s: "hello",
        n: 42,
        b: true,
        arr: [1, 2, 3],
        nested: { k: "v" },
      };
      writeUserScopedCache(KEY, payload);
      expect(readUserScopedCache<typeof payload>(KEY)).toEqual(payload);
    });

    it("different users can both have caches at the same key without crosstalk", () => {
      seedAuth("alice");
      writeUserScopedCache(KEY, { who: "alice" });
      // Alice's cache is at KEY
      // Bob logs in and reads → mismatch, cache cleared
      seedAuth("bob");
      expect(readUserScopedCache(KEY)).toBeNull();
      // Bob writes his own
      writeUserScopedCache(KEY, { who: "bob" });
      expect(readUserScopedCache<{ who: string }>(KEY)).toEqual({ who: "bob" });
      // Alice logs back in — Bob's cache clears on her read
      seedAuth("alice");
      expect(readUserScopedCache(KEY)).toBeNull();
    });
  });

  describe("clearUserScopedCache", () => {
    it("removes the key regardless of owner", () => {
      seedAuth("alice");
      writeUserScopedCache(KEY, { foo: 1 });
      clearUserScopedCache(KEY);
      expect(localStorage.getItem(KEY)).toBeNull();
    });
  });

  describe("hasUserScopedCache", () => {
    it("returns true when payload exists and owner matches current user", () => {
      seedAuth("alice");
      writeUserScopedCache(KEY, { foo: 1 });
      expect(hasUserScopedCache(KEY)).toBe(true);
    });

    it("returns false when owner differs (no side effects — doesn't clear)", () => {
      seedAuth("alice");
      writeUserScopedCache(KEY, { foo: 1 });
      seedAuth("bob");
      expect(hasUserScopedCache(KEY)).toBe(false);
      // Key is NOT cleared (distinct from read)
      expect(localStorage.getItem(KEY)).not.toBeNull();
    });

    it("returns false when key is absent", () => {
      seedAuth("alice");
      expect(hasUserScopedCache(KEY)).toBe(false);
    });

    it("returns false when no user is logged in", () => {
      seedAuth("alice");
      writeUserScopedCache(KEY, { foo: 1 });
      localStorage.removeItem("skynet_auth");
      expect(hasUserScopedCache(KEY)).toBe(false);
    });
  });
});
