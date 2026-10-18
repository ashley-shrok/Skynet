/**
 * Unread marks + attention ordering in the sidebar snapshot.
 *
 * Drives the stores the way the live app does: finished turns arrive as
 * lastFinishAt (attention-store), the user's read state loads from the
 * server, the seen tracker reports what's on screen and marks it seen.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
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

const host = { id: "1", name: "t1000" } as unknown as Host;

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
      setProjects([{ slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "t1000", archived: false }]);
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

beforeEach(() => {
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

describe("unread marks", () => {
  it("a turn finished after the baseline marks the row unread and floats it to the top", () => {
    setup(["ash", "birch", "cedar"]);
    finish("cedar", BASELINE + 10);
    const { result } = renderHook(() => useConversations());
    expect(ids(result.current.middle)[0]).toBe("t-cedar");
    expect(result.current.middle[0].unread).toBe(true);
    expect(result.current.middle.slice(1).every((r) => r.unread !== true)).toBe(true);
  });

  it("launch day: turns that finished before the baseline are read", () => {
    setup(["ash"]);
    finish("ash", BASELINE - 1);
    const { result } = renderHook(() => useConversations());
    expect(result.current.middle[0].unread).toBeUndefined();
  });

  it("nothing is unread until the read state has loaded", () => {
    const tree: HostFolder = { name: "root", children: [host] };
    act(() => {
      updateHostTree(tree);
      updateHostsFlat(new Map([[1, host]]));
      updateOpenTabs([tab("t-ash", "ash")]);
      publishLastFinishAt("1", "ash", 5_000);
    });
    const { result } = renderHook(() => useConversations());
    expect(result.current.middle[0].unread).toBeUndefined();
    act(() => applyReadState({ baselineAt: BASELINE, seen: [] }));
    expect(result.current.middle[0].unread).toBe(true);
  });

  it("marking seen clears the mark and tells the server the turn that was seen", () => {
    setup(["ash"]);
    finish("ash", 2_000);
    const { result } = renderHook(() => useConversations());
    expect(result.current.middle[0].unread).toBe(true);
    act(() => markSeen("1", "ash"));
    expect(result.current.middle[0].unread).toBeUndefined();
    expect(post).toHaveBeenCalledWith("/attention/seen", {
      hostId: "1",
      identityName: "ash",
      seenFinishAt: 2_000,
    });
  });

  it("reading on another device clears the mark here", () => {
    setup(["ash"]);
    finish("ash", 2_000);
    const { result } = renderHook(() => useConversations());
    act(() => applyRemoteSeen("1", "ash", 2_000));
    expect(result.current.middle[0].unread).toBeUndefined();
  });

  it("a newer turn after being seen makes it unread again", () => {
    setup(["ash"]);
    finish("ash", 2_000);
    act(() => markSeen("1", "ash"));
    finish("ash", 3_000);
    const { result } = renderHook(() => useConversations());
    expect(result.current.middle[0].unread).toBe(true);
  });
});

describe("ordering", () => {
  it("within each tier, most recent activity from either side first", () => {
    setup(["ash", "birch", "cedar", "dogwood"]);
    act(() => {
      __setLastMessageAtForTest("t-ash", 500); // user sent long ago
      __setLastMessageAtForTest("t-birch", 900);
    });
    finish("ash", 950); // read: ash's agent finished at 950 (before baseline)
    finish("cedar", 1_500); // unread
    finish("dogwood", 1_800); // unread, newer
    const { result } = renderHook(() => useConversations());
    // Unread: dogwood (1800), cedar (1500). Read: ash (950 > birch's 900), birch.
    expect(ids(result.current.middle)).toEqual(["t-dogwood", "t-cedar", "t-ash", "t-birch"]);
  });

  it("rows inside a project follow the same rules; alphabetical only breaks ties", () => {
    setup(["ash", "birch", "cedar"], { project: ["ash", "birch", "cedar"] });
    finish("cedar", 1_500);
    act(() => __setLastMessageAtForTest("t-birch", 900));
    const { result } = renderHook(() => useConversations());
    const rows = result.current.projectSections[0].rows;
    // cedar unread first; birch has activity; ash has none.
    expect(ids(rows)).toEqual(["t-cedar", "t-birch", "t-ash"]);
    expect(rows[0].unread).toBe(true);
  });

  it("pinned keeps its fixed order but still shows the mark", () => {
    setup(["ash", "birch"]);
    act(() => {
      pinConversation("t-ash");
      pinConversation("t-birch");
    });
    finish("birch", 1_500);
    const { result } = renderHook(() => useConversations());
    expect(ids(result.current.pinned)).toEqual(["t-ash", "t-birch"]);
    expect(result.current.pinned[1].unread).toBe(true);
  });
});

describe("holding an opened row in place", () => {
  it("an unread row opened stays put after its mark clears, until it leaves the screen", () => {
    setup(["ash", "birch", "cedar"]);
    finish("ash", 1_300);
    finish("birch", 1_200);
    finish("cedar", 1_100);
    const { result } = renderHook(() => useConversations());
    expect(ids(result.current.middle)).toEqual(["t-ash", "t-birch", "t-cedar"]);

    // Open ash (top). Seen tracker order: report on-screen, then mark seen.
    act(() => {
      setVisibleConversationIds(["t-ash"]);
      markSeen("1", "ash");
    });
    expect(result.current.middle[0].id).toBe("t-ash");
    expect(result.current.middle[0].unread).toBeUndefined();

    // Open something else: ash drops below the still-unread rows.
    act(() => {
      setVisibleConversationIds(["t-cedar"]);
      markSeen("1", "cedar");
    });
    expect(ids(result.current.middle)).toEqual(["t-birch", "t-cedar", "t-ash"]);
  });

  it("the hold ends when the agent finishes another turn", () => {
    setup(["ash", "birch"]);
    finish("ash", 1_300);
    finish("birch", 1_400);
    const { result } = renderHook(() => useConversations());
    act(() => {
      setVisibleConversationIds(["t-ash"]);
      markSeen("1", "ash");
    });
    // Held as unread with its old activity: birch (1400) still above ash (1300).
    expect(ids(result.current.middle)).toEqual(["t-birch", "t-ash"]);
    // Ash finishes again while on screen and is seen at once: hold released,
    // it sorts as read — below unread birch.
    act(() => {
      publishLastFinishAt("1", "ash", 2_000);
      markSeen("1", "ash");
    });
    expect(ids(result.current.middle)).toEqual(["t-birch", "t-ash"]);
    expect(result.current.middle[1].unread).toBeUndefined();
    // Birch read too: now pure recency, ash (2000) first.
    act(() => applyRemoteSeen("1", "birch", 1_400));
    expect(ids(result.current.middle)).toEqual(["t-ash", "t-birch"]);
  });

  it("opening a row that was already read does not hold it", () => {
    setup(["ash", "birch"]);
    finish("ash", 1_300);
    act(() => markSeen("1", "ash"));
    act(() => setVisibleConversationIds(["t-ash"]));
    finish("birch", 1_200);
    const { result } = renderHook(() => useConversations());
    expect(ids(result.current.middle)).toEqual(["t-birch", "t-ash"]);
  });
});
