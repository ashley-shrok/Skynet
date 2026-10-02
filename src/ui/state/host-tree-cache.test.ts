// Coverage for the host-tree localStorage cache helpers
// (readHostTreeCache / writeHostTreeCache). The cache exists so a page
// refresh seeds hostsFlat immediately, which is what projectForRow() in
// conversation-store depends on to bucket identity rows into project
// sections at first paint. Without it, every pinned-in-project row
// briefly leaks into the top-level pinned zone and the RDP synthetic
// rows at the sidebar bottom don't paint until getSSHHosts() lands.
//
// Scope: the two exported cache helpers in isolation. The AppShell wire
// (useState-init seed + write-on-success) is a small change exercised
// by the existing AppShell mount-effect coverage.

import { describe, it, expect, beforeEach } from "vitest";
import { readHostTreeCache, writeHostTreeCache } from "./host-tree-cache";
import type { SSHHostWithStatus } from "@/main-axios";

// Cross-user leak fix: bumped v1 → v2 for owner-tag wrapper.
const CACHE_KEY = "skynet:host-tree-cache:v2";
const TEST_USERNAME = "test-user";

function seedAuth(username: string = TEST_USERNAME): void {
  localStorage.setItem(
    "skynet_auth",
    JSON.stringify({ loggedIn: true, username }),
  );
}

function wrap<T>(payload: T, owner: string = TEST_USERNAME): string {
  return JSON.stringify({ owner, payload });
}

// Minimal SSHHostWithStatus sample. sshHostToHost tolerates missing
// optional fields via its per-field defaults; the cache only demands id
// + name to survive round-trip.
const SAMPLE_A: SSHHostWithStatus = {
  id: 1,
  name: "thenasty",
  ip: "100.113.23.63",
  port: 22,
  username: "root",
  status: "online",
} as SSHHostWithStatus;

const SAMPLE_B: SSHHostWithStatus = {
  id: 2,
  name: "workstation",
  ip: "100.99.149.9",
  port: 22,
  username: "operator",
  status: "offline",
} as SSHHostWithStatus;

describe("host-tree-cache", () => {
  beforeEach(() => {
    localStorage.clear();
    seedAuth();
  });

  it("read: empty cache → []", () => {
    expect(readHostTreeCache()).toEqual([]);
  });

  it("read: missing key → []", () => {
    // No write has happened; getItem returns null.
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
    expect(readHostTreeCache()).toEqual([]);
  });

  it("write + read: round-trip preserves the host list", () => {
    writeHostTreeCache([SAMPLE_A, SAMPLE_B]);
    const out = readHostTreeCache();
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe("thenasty");
    expect(out[0].id).toBe(1);
    expect(out[0].status).toBe("online");
    expect(out[1].name).toBe("workstation");
    expect(out[1].id).toBe(2);
    expect(out[1].status).toBe("offline");
  });

  it("read: malformed JSON → []", () => {
    localStorage.setItem(CACHE_KEY, "not-json-{{{");
    expect(readHostTreeCache()).toEqual([]);
  });

  it("read: non-array top level → []", () => {
    localStorage.setItem(CACHE_KEY, wrap({ hosts: [SAMPLE_A] }));
    expect(readHostTreeCache()).toEqual([]);
  });

  it("read: filters out entries failing the minimal shape check", () => {
    // Mix of valid + invalid entries. Only the valid one survives.
    const mixed = [
      SAMPLE_A,
      { id: 3 }, // missing name
      { name: "no-id" }, // missing id
      { id: 4, name: "" }, // empty name
      null,
      "string",
      SAMPLE_B,
    ];
    localStorage.setItem(CACHE_KEY, wrap(mixed));
    const out = readHostTreeCache();
    expect(out).toHaveLength(2);
    expect(out.map((h) => h.name)).toEqual(["thenasty", "workstation"]);
  });

  it("read: id as numeric string is accepted", () => {
    // Some wire paths stringify ids. buildHostTree/sshHostToHost handle
    // both shapes; the cache should not reject either.
    const stringId = { ...SAMPLE_A, id: "1" as unknown as number };
    localStorage.setItem(CACHE_KEY, wrap([stringId]));
    const out = readHostTreeCache();
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("thenasty");
  });

  it("read: owner-mismatch → [] + clears the key", () => {
    localStorage.setItem(CACHE_KEY, wrap([SAMPLE_A, SAMPLE_B], "someone-else"));
    expect(readHostTreeCache()).toEqual([]);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it("read: legacy un-tagged payload (pre-v2) → [] + clears the key", () => {
    localStorage.setItem(CACHE_KEY, JSON.stringify([SAMPLE_A, SAMPLE_B]));
    expect(readHostTreeCache()).toEqual([]);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it("read: no logged-in user → [] + clears the key", () => {
    writeHostTreeCache([SAMPLE_A]);
    localStorage.removeItem("skynet_auth");
    expect(readHostTreeCache()).toEqual([]);
    expect(localStorage.getItem(CACHE_KEY)).toBeNull();
  });

  it("write: overwrite semantics — second write replaces first", () => {
    writeHostTreeCache([SAMPLE_A]);
    writeHostTreeCache([SAMPLE_B]);
    const out = readHostTreeCache();
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("workstation");
  });

  it("write: empty array is valid — represents 'zero managed hosts'", () => {
    writeHostTreeCache([SAMPLE_A]);
    writeHostTreeCache([]);
    expect(readHostTreeCache()).toEqual([]);
  });
});
