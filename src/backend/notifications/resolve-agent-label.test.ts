import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../utils/logger.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/logger.js")>()),
  systemLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { systemLogger } from "../utils/logger.js";
import {
  buildAgentLabel,
  createAgentLabelResolver,
  LABEL_TTL_MS,
  type AgentCosmetics,
  type AgentLabelDeps,
} from "./resolve-agent-label.js";

const MXID = "@mitzi:harbor.example";

function makeDeps(overrides: Partial<AgentLabelDeps> = {}) {
  let clock = 1_000_000;
  const deps = {
    readCached: vi.fn<AgentLabelDeps["readCached"]>(() => null),
    readFiles: vi.fn<AgentLabelDeps["readFiles"]>(async () => ({
      identity: { displayName: "Mitzi" },
      roles: [{ slug: "general-purpose", cosmetics: { displayName: "General Assistant" } }],
    })),
    now: () => clock,
    ...overrides,
  };
  return { deps, advance: (ms: number) => (clock += ms) };
}

describe("buildAgentLabel", () => {
  it("joins identity and role display names", () => {
    const c: AgentCosmetics = {
      identity: { displayName: "Meridian" },
      roles: [
        { slug: "orchestrator", cosmetics: { displayName: "Orchestrator" } },
        { slug: "box-maintainer", cosmetics: { displayName: "Skynet" } },
      ],
    };
    expect(buildAgentLabel("meridian-orchestrator", c)).toEqual({
      name: "Meridian",
      roles: "Orchestrator, Skynet",
    });
  });

  it("falls back to the capitalized key and de-slugged role names", () => {
    const c: AgentCosmetics = {
      identity: null,
      roles: [{ slug: "news-watcher", cosmetics: {} }],
    };
    expect(buildAgentLabel("rowan-news-watcher", c)).toEqual({
      name: "Rowan-news-watcher",
      roles: "News watcher",
    });
  });

  it("has null roles when the identity holds none", () => {
    expect(buildAgentLabel("x", { identity: { displayName: "X" }, roles: [] }).roles).toBeNull();
  });

  it("caps long names with an ellipsis", () => {
    const label = buildAgentLabel("x", {
      identity: { displayName: "N".repeat(80) },
      roles: [{ slug: "r", cosmetics: { displayName: "R".repeat(100) } }],
    });
    expect(label.name).toHaveLength(40);
    expect(label.name.endsWith("…")).toBe(true);
    expect(label.roles).toHaveLength(60);
  });
});

describe("createAgentLabelResolver", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses the sweep cache when it has the identity, without reading files", async () => {
    const { deps } = makeDeps({
      readCached: vi.fn(() => ({ identity: { displayName: "Cached" }, roles: [] })),
    });
    const label = await createAgentLabelResolver(deps)(MXID, "u1", 7);
    expect(label).toEqual({ name: "Cached", roles: null });
    expect(deps.readCached).toHaveBeenCalledWith("u1", 7, "mitzi");
    expect(deps.readFiles).not.toHaveBeenCalled();
  });

  it("reads files from the agent's host on a cache miss", async () => {
    const { deps } = makeDeps();
    const label = await createAgentLabelResolver(deps)(MXID, "u1", 7);
    expect(label).toEqual({ name: "Mitzi", roles: "General Assistant" });
    expect(deps.readFiles).toHaveBeenCalledWith("u1", 7, "mitzi");
  });

  it("remembers a file read until the TTL lapses", async () => {
    const { deps, advance } = makeDeps();
    const resolve = createAgentLabelResolver(deps);
    await resolve(MXID, "u1", 7);
    await resolve(MXID, "u1", 7);
    expect(deps.readFiles).toHaveBeenCalledTimes(1);
    advance(LABEL_TTL_MS + 1);
    await resolve(MXID, "u1", 7);
    expect(deps.readFiles).toHaveBeenCalledTimes(2);
  });

  it("falls back to the local-part when the host is unreachable", async () => {
    const { deps } = makeDeps({ readFiles: vi.fn(async () => null) });
    expect(await createAgentLabelResolver(deps)(MXID, "u1", 7)).toEqual({
      name: "Mitzi",
      roles: null,
    });
  });

  it("falls back and warns when the read throws", async () => {
    const { deps } = makeDeps({
      readFiles: vi.fn(async () => {
        throw new Error("ssh down");
      }),
    });
    expect(await createAgentLabelResolver(deps)(MXID, "u1", 7)).toEqual({
      name: "Mitzi",
      roles: null,
    });
    expect(systemLogger.warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ operation: "resolve_agent_label_failed", mxid: MXID }),
    );
  });

  it("returns the local-part for a malformed mxid without any lookup", async () => {
    const { deps } = makeDeps();
    expect(await createAgentLabelResolver(deps)("no-colon", "u1", 7)).toEqual({
      name: "No-colon",
      roles: null,
    });
    expect(deps.readCached).not.toHaveBeenCalled();
    expect(deps.readFiles).not.toHaveBeenCalled();
  });

  it("lowercases the local-part to find the identity folder", async () => {
    const { deps } = makeDeps();
    await createAgentLabelResolver(deps)("@Mitzi:harbor.example", "u1", 7);
    expect(deps.readFiles).toHaveBeenCalledWith("u1", 7, "mitzi");
  });
});
