/**
 * A fresh page opens the sidebar in the order last seen: the sort inputs
 * (finished turns, seen marks, DMs) are saved per user and stand in until the
 * fleet snapshot and the read state arrive. They decide order only — the
 * unread / DM marks still wait for the server.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

vi.mock("@/api/user-preferences-api", () => ({
  putPinnedIds: vi.fn().mockResolvedValue([]),
  setIdentityPinned: vi.fn().mockResolvedValue(undefined),
}));
const post = vi.fn().mockResolvedValue({});
vi.mock("@/main-axios", () => ({
  authApi: { get: vi.fn(), post: (...a: unknown[]) => post(...a) },
}));

import {
  updateHostTree,
  updateOpenTabs,
  updateHostsFlat,
  updateIdentitiesByKey,
  selectConversation,
  pinConversation,
  useConversations,
  setProjects,
  setIdentityProjectAssignments,
  setVisibleConversationIds,
  __resetActiveSetForTest,
  __resetPinnedIdsForTest,
  __resetFleetSessionsForTest,
  __resetLastMessageAtForTest,
  __resetProjectsForTest,
  __resetRowHoldsForTest,
  __setLastMessageAtForTest,
} from "./conversation-store.js";
import {
  applyReadState,
  applyRemoteSeen,
  markSeen,
  publishLastFinishAt,
  __resetAttentionForTest,
} from "./attention-store.js";
import type { Tab, Host, HostFolder } from "@/types/ui-types";
import type { Identity } from "@/api/identities-api";

const host = { id: "1", name: "harbor" } as unknown as Host;

function tab(id: string, tmux: string): Tab {
  return { id, instanceId: id, type: "terminal", label: tmux, host, openedAt: 0, targetTmuxSession: tmux };
}

function identity(key: string, extra?: Partial<Identity>): Identity {
  return {
    identityKey: key,
    displayName: key[0].toUpperCase() + key.slice(1),
    title: null,
    colorHue: null,
    voice: null,
    role: "actor",
    avatarMime: "",
    avatarUrl: "",
    avatarEtag: "",
    coordinator: false,
    task: null,
    project: null,
    ...(extra ?? {}),
  };
}

const BASELINE = 1_000;

function setup(names: string[], opts?: { project?: string[] }) {
  const tree: HostFolder = { name: "root", children: [host] };
  act(() => {
    updateHostTree(tree);
    updateHostsFlat(new Map([[1, host]]));
    updateIdentitiesByKey(new Map(names.map((n) => [n, identity(n)])));
    if (opts?.project) {
      setProjects([{ slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "harbor", archived: false }]);
      setIdentityProjectAssignments(new Map(opts.project.map((n) => [`1::${n}`, "alpha"])));
    }
    updateOpenTabs(names.map((n) => tab(`t-${n}`, n)));
    applyReadState({ baselineAt: BASELINE, seen: [] });
  });
}

function finish(name: string, at: number) {
  act(() => publishLastFinishAt("1", name, at));
}

function ids(rows: { id: string }[]) {
  return rows.map((r) => r.id);
}

function loginAs(user: string) {
  localStorage.setItem("skynet_auth", JSON.stringify({ loggedIn: true, username: user }));
}

/** What a page reload does to the in-memory stores (localStorage survives). */
function reloadPage(names: string[]) {
  act(() => {
    __resetAttentionForTest();
    __resetRowHoldsForTest();
    const tree: HostFolder = { name: "root", children: [host] };
    updateHostTree(tree);
    updateHostsFlat(new Map([[1, host]]));
    updateIdentitiesByKey(new Map(names.map((n) => [n, identity(n)])));
    updateOpenTabs(names.map((n) => tab(`t-${n}`, n)));
  });
}

const NAMES = ["ash", "birch", "cedar", "dune", "elm"];

/** Last visit: elm DM'd, cedar unread, the rest by their latest turn. */
function lastVisit() {
  setup(NAMES);
  act(() => {
    publishLastFinishAt("1", "ash", BASELINE + 50);
    publishLastFinishAt("1", "birch", BASELINE + 40);
    publishLastFinishAt("1", "cedar", BASELINE + 30);
    publishLastFinishAt("1", "dune", BASELINE + 60);
    publishLastFinishAt("1", "elm", BASELINE + 5);
    applyReadState({
      baselineAt: BASELINE,
      seen: [
        { hostId: "1", identityName: "ash", seenFinishAt: BASELINE + 50 },
        { hostId: "1", identityName: "birch", seenFinishAt: BASELINE + 40 },
        { hostId: "1", identityName: "dune", seenFinishAt: BASELINE + 60 },
        { hostId: "1", identityName: "elm", seenFinishAt: BASELINE + 5 },
      ],
      dms: [{ hostId: "1", identityName: "elm", lastDmAt: BASELINE + 5, seenDmAt: 0 }],
    });
  });
  act(() => {
    vi.advanceTimersByTime(1_500);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  localStorage.clear();
  loginAs("alice");
  sessionStorage.clear();
  __resetActiveSetForTest();
  __resetPinnedIdsForTest();
  updateOpenTabs([]);
  selectConversation(null);
  updateHostTree(null);
  __resetFleetSessionsForTest();
  updateHostsFlat(new Map());
  updateIdentitiesByKey(new Map());
  __resetLastMessageAtForTest();
  __resetProjectsForTest();
  __resetAttentionForTest();
  __resetRowHoldsForTest();
  post.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sidebar order on a fresh page", () => {
  it("opens in the order last seen, before the server has answered", () => {
    lastVisit();
    const before = renderHook(() => useConversations());
    const lastSeenOrder = ids(before.result.current.middle);
    expect(lastSeenOrder).toEqual(["t-elm", "t-cedar", "t-dune", "t-ash", "t-birch"]);
    before.unmount();

    reloadPage(NAMES);
    const { result } = renderHook(() => useConversations());
    expect(ids(result.current.middle)).toEqual(lastSeenOrder);
  });

  it("shows no unread dots or DM marks until the server confirms them", () => {
    lastVisit();
    reloadPage(NAMES);
    const { result } = renderHook(() => useConversations());
    for (const row of result.current.middle) {
      expect(row.unread).toBeUndefined();
      expect(row.dm).toBeUndefined();
    }

    act(() => {
      publishLastFinishAt("1", "cedar", BASELINE + 30);
      publishLastFinishAt("1", "elm", BASELINE + 5);
      applyReadState({
        baselineAt: BASELINE,
        seen: [],
        dms: [{ hostId: "1", identityName: "elm", lastDmAt: BASELINE + 5, seenDmAt: 0 }],
      });
    });
    const byId = new Map(result.current.middle.map((r) => [r.id, r]));
    expect(byId.get("t-cedar")?.unread).toBe(true);
    expect(byId.get("t-elm")?.dm).toBe(true);
  });

  it("moves only what changed once the server answers (read on another device, a new turn)", () => {
    lastVisit();
    reloadPage(NAMES);
    const { result } = renderHook(() => useConversations());
    act(() => {
      // Live data: cedar was read on another device; birch finished a new turn.
      publishLastFinishAt("1", "ash", BASELINE + 50);
      publishLastFinishAt("1", "birch", BASELINE + 70);
      publishLastFinishAt("1", "cedar", BASELINE + 30);
      publishLastFinishAt("1", "dune", BASELINE + 60);
      publishLastFinishAt("1", "elm", BASELINE + 5);
      applyReadState({
        baselineAt: BASELINE,
        seen: [
          { hostId: "1", identityName: "ash", seenFinishAt: BASELINE + 50 },
          { hostId: "1", identityName: "birch", seenFinishAt: BASELINE + 40 },
          { hostId: "1", identityName: "cedar", seenFinishAt: BASELINE + 30 },
          { hostId: "1", identityName: "dune", seenFinishAt: BASELINE + 60 },
          { hostId: "1", identityName: "elm", seenFinishAt: BASELINE + 5 },
        ],
        dms: [{ hostId: "1", identityName: "elm", lastDmAt: BASELINE + 5, seenDmAt: 0 }],
      });
    });
    expect(ids(result.current.middle)).toEqual(["t-elm", "t-birch", "t-dune", "t-ash", "t-cedar"]);
  });

  it("never uses another user's saved order", () => {
    lastVisit();
    loginAs("someone-else");
    reloadPage(NAMES);
    const { result } = renderHook(() => useConversations());
    // No saved picture for this user: every row ties, so the stable fallback
    // (open order) applies — not the previous user's DM'd / unread tiers.
    expect(ids(result.current.middle)).toEqual(["t-ash", "t-birch", "t-cedar", "t-dune", "t-elm"]);
  });

  it("does not save a half-loaded picture before the read state arrives", () => {
    setup([]);
    act(() => {
      __resetAttentionForTest();
      publishLastFinishAt("1", "ash", BASELINE + 50);
      vi.advanceTimersByTime(1_500);
    });
    expect(localStorage.getItem("skynet:attention-sort-cache:v1")).toBeNull();
  });
});
