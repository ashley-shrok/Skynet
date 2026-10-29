/**
 * machine-people.test.ts — the people file written to every managed host.
 *
 * The db is a queue-based select chain (same pattern as
 * host-user-counter.test.ts): each awaited query pops the next queued
 * result-set, in the order listMachinePeople issues them:
 *   1. hosts (seed row)  2. hosts (every row for the box)
 *   3. hostAccess        4. userRoles (only when a group share exists)
 *   5. users
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const resultQueue: unknown[][] = [];
let failNext = false;

function makeChain() {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn(() => chain);
  chain.from = vi.fn(() => chain);
  chain.where = vi.fn(() => chain);
  chain.limit = vi.fn(() => chain);
  chain.then = (
    onFulfilled: (value: unknown[]) => unknown,
    onRejected?: (reason: unknown) => unknown,
  ) => {
    if (failNext) {
      failNext = false;
      return Promise.reject(new Error("db down")).then(onFulfilled, onRejected);
    }
    return Promise.resolve(resultQueue.shift() ?? []).then(onFulfilled, onRejected);
  };
  return chain;
}

vi.mock("../database/db/index.js", () => ({ db: makeChain() }));
vi.mock("../database/db/schema.js", () => ({
  hosts: {},
  hostAccess: {},
  userRoles: {},
  users: {},
}));
vi.mock("drizzle-orm", () => ({
  and: vi.fn(() => ({})),
  eq: vi.fn(() => ({})),
  inArray: vi.fn(() => ({})),
  or: vi.fn(() => ({})),
}));
vi.mock("../utils/logger.js", () => ({
  systemLogger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  MACHINE_PEOPLE_HEADING,
  listMachinePeople,
  machinePeopleFileFor,
  renderMachinePeopleFile,
} from "./machine-people.js";

const SEED = [{ machineId: 7, ip: "10.0.0.1", port: 22, username: "agent" }];

beforeEach(() => {
  resultQueue.length = 0;
  failNext = false;
});

describe("renderMachinePeopleFile", () => {
  it("lists each person with their relay ID, sorted, under the heading", () => {
    const text = renderMachinePeopleFile([
      { username: "zed", mxid: "@zed_human:example.org" },
      { username: "amy", mxid: "@amy:example.org" },
    ]);
    expect(text).toBe(
      `${MACHINE_PEOPLE_HEADING}\n\n- amy · relay ID @amy:example.org\n- zed · relay ID @zed_human:example.org\n`,
    );
  });

  it("marks someone with no relay account", () => {
    expect(renderMachinePeopleFile([{ username: "old", mxid: null }])).toContain(
      "- old · no relay ID",
    );
  });

  it("never names the product", () => {
    expect(renderMachinePeopleFile([]).toLowerCase()).not.toContain("skynet");
  });
});

describe("listMachinePeople", () => {
  it("returns null for an unknown host", async () => {
    resultQueue.push([]);
    expect(await listMachinePeople(99)).toBeNull();
  });

  it("collects owners of every row for the box, direct shares and group members", async () => {
    resultQueue.push(
      SEED,
      [
        { id: 1, userId: "u-owner" },
        { id: 2, userId: "u-second-owner" },
      ],
      [
        { userId: "u-direct", roleId: null, expiresAt: null },
        { userId: null, roleId: 5, expiresAt: null },
      ],
      [{ userId: "u-group" }],
      [
        { username: "owner", mxid: "@owner:x" },
        { username: "second", mxid: "@second_human:x" },
        { username: "direct", mxid: null },
        { username: "group", mxid: "@group_human:x" },
      ],
    );
    const people = await listMachinePeople(1);
    expect(people).toEqual([
      { username: "owner", mxid: "@owner:x" },
      { username: "second", mxid: "@second_human:x" },
      { username: "direct", mxid: null },
      { username: "group", mxid: "@group_human:x" },
    ]);
  });

  it("ignores expired shares and skips the group lookup when none remain", async () => {
    const now = Date.parse("2026-10-29T00:00:00Z");
    resultQueue.push(
      SEED,
      [{ id: 1, userId: "u-owner" }],
      [
        { userId: "u-expired", roleId: null, expiresAt: "2026-10-01T00:00:00Z" },
        { userId: null, roleId: 9, expiresAt: "2026-10-01T00:00:00Z" },
        { userId: "u-future", roleId: null, expiresAt: "2027-01-01T00:00:00Z" },
      ],
      // no userRoles query: the only group share expired
      [
        { username: "owner", mxid: "@owner:x" },
        { username: "future", mxid: "@future_human:x" },
      ],
    );
    const people = await listMachinePeople(1, now);
    expect(people?.map((p) => p.username)).toEqual(["owner", "future"]);
    expect(resultQueue.length).toBe(0);
  });
});

describe("machinePeopleFileFor", () => {
  it("returns the rendered file", async () => {
    resultQueue.push(SEED, [{ id: 1, userId: "u1" }], [], [{ username: "amy", mxid: "@amy:x" }]);
    expect(await machinePeopleFileFor("1")).toBe(
      renderMachinePeopleFile([{ username: "amy", mxid: "@amy:x" }]),
    );
  });

  it("returns null (leave the file alone) when the lookup fails", async () => {
    failNext = true;
    expect(await machinePeopleFileFor("1")).toBeNull();
  });

  it("returns null for a non-numeric host id", async () => {
    expect(await machinePeopleFileFor("abc")).toBeNull();
  });
});
