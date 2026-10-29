/**
 * DM marks in the sidebar snapshot: an agent DM'd this user.
 *
 * Drives the stores the way the live app does: DMs arrive as dm-state-changed
 * frames or in the loaded read state, finished turns as lastFinishAt, the
 * seen tracker reports what's on screen and marks it seen.
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
  applyRemoteDm,
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

function dm(name: string, at: number, seenAt = 0) {
  act(() => applyRemoteDm({ hostId: "1", identityName: name, lastDmAt: at, seenDmAt: seenAt }));
}

describe("DM marks", () => {
  it("a DM marks the row DM'd and puts it above unread rows", () => {
    setup(["ash", "birch", "cedar"]);
    finish("ash", 1_900); // unread, newest activity
    finish("birch", 1_500);
    dm("birch", 1_400);
    finish("cedar", 1_200);
    const { result } = renderHook(() => useConversations());
    expect(ids(result.current.middle)).toEqual(["t-birch", "t-ash", "t-cedar"]);
    expect(result.current.middle[0].dm).toBe(true);
    expect(result.current.middle[0].dmAt).toBe(1_400);
    expect(result.current.middle[1].dm).toBeUndefined();
  });

  it("within the DM'd tier the most recent DM comes first", () => {
    setup(["ash", "birch"]);
    dm("ash", 1_100);
    dm("birch", 1_300);
    const { result } = renderHook(() => useConversations());
    expect(ids(result.current.middle)).toEqual(["t-birch", "t-ash"]);
    // Another DM from ash moves it back to the top of the tier.
    dm("ash", 1_500);
    expect(ids(result.current.middle)).toEqual(["t-ash", "t-birch"]);
  });

  it("DMs loaded with the read state count; ones already seen don't", () => {
    setup(["ash", "birch"]);
    act(() =>
      applyReadState({
        baselineAt: BASELINE,
        seen: [],
        dms: [
          { hostId: "1", identityName: "ash", lastDmAt: 1_200, seenDmAt: 0 },
          { hostId: "1", identityName: "birch", lastDmAt: 1_300, seenDmAt: 1_300 },
        ],
      }),
    );
    const { result } = renderHook(() => useConversations());
    expect(result.current.middle.find((r) => r.id === "t-ash")?.dm).toBe(true);
    expect(result.current.middle.find((r) => r.id === "t-birch")?.dm).toBeUndefined();
  });

  it("seeing the conversation clears the DM and the unread mark, and tells the server", () => {
    setup(["ash"]);
    finish("ash", 2_000);
    dm("ash", 1_950);
    const { result } = renderHook(() => useConversations());
    act(() => markSeen("1", "ash"));
    expect(result.current.middle[0].dm).toBeUndefined();
    expect(result.current.middle[0].unread).toBeUndefined();
    expect(post).toHaveBeenCalledWith("/attention/dm-seen", {
      hostId: "1",
      identityName: "ash",
      seenDmAt: 1_950,
    });
    expect(post).toHaveBeenCalledWith("/attention/seen", {
      hostId: "1",
      identityName: "ash",
      seenFinishAt: 2_000,
    });
  });

  it("seeing it on another device clears the DM here", () => {
    setup(["ash"]);
    dm("ash", 1_500);
    const { result } = renderHook(() => useConversations());
    expect(result.current.middle[0].dm).toBe(true);
    dm("ash", 1_500, 1_500);
    expect(result.current.middle[0].dm).toBeUndefined();
  });

  it("a newer DM after being seen marks it again", () => {
    setup(["ash"]);
    dm("ash", 1_500);
    act(() => markSeen("1", "ash"));
    dm("ash", 1_800, 1_500);
    const { result } = renderHook(() => useConversations());
    expect(result.current.middle[0].dm).toBe(true);
  });

  it("a DM shows even before the read state has loaded (DMs need no baseline)", () => {
    const tree: HostFolder = { name: "root", children: [host] };
    act(() => {
      updateHostTree(tree);
      updateHostsFlat(new Map([[1, host]]));
      updateIdentitiesByKey(new Map([["ash", identity("ash")]]));
      updateOpenTabs([tab("t-ash", "ash")]);
    });
    dm("ash", 1_500);
    const { result } = renderHook(() => useConversations());
    expect(result.current.middle[0].dm).toBe(true);
    act(() => markSeen("1", "ash"));
    expect(result.current.middle[0].dm).toBeUndefined();
  });

  it("inside a project DM'd rows lead too", () => {
    setup(["ash", "birch", "cedar"], { project: ["ash", "birch", "cedar"] });
    finish("cedar", 1_500);
    dm("ash", 1_100);
    const { result } = renderHook(() => useConversations());
    expect(ids(result.current.projectSections[0].rows)).toEqual(["t-ash", "t-cedar", "t-birch"]);
  });

  it("pinned keeps its fixed order but still shows the DM mark", () => {
    setup(["ash", "birch"]);
    act(() => {
      pinConversation("t-ash");
      pinConversation("t-birch");
    });
    dm("birch", 1_500);
    const { result } = renderHook(() => useConversations());
    expect(ids(result.current.pinned)).toEqual(["t-ash", "t-birch"]);
    expect(result.current.pinned[1].dm).toBe(true);
  });

  it("a DM'd row opened stays put after its marks clear, until something else is opened", () => {
    setup(["ash", "birch", "cedar"]);
    finish("ash", 1_300);
    dm("ash", 1_250);
    finish("birch", 1_400);
    finish("cedar", 1_350);
    const { result } = renderHook(() => useConversations());
    expect(ids(result.current.middle)).toEqual(["t-ash", "t-birch", "t-cedar"]);
    act(() => {
      setVisibleConversationIds(["t-ash"]);
      markSeen("1", "ash");
    });
    expect(ids(result.current.middle)).toEqual(["t-ash", "t-birch", "t-cedar"]);
    expect(result.current.middle[0].dm).toBeUndefined();
    act(() => {
      setVisibleConversationIds(["t-cedar"]);
      markSeen("1", "cedar");
    });
    // ash is a read row now; cedar is held in its unread spot below birch.
    expect(ids(result.current.middle)).toEqual(["t-birch", "t-cedar", "t-ash"]);
  });

  it("a new DM to a held unread row lifts it into the DM'd tier at once", () => {
    setup(["ash", "birch"]);
    finish("ash", 1_300);
    dm("birch", 1_200);
    const { result } = renderHook(() => useConversations());
    act(() => {
      setVisibleConversationIds(["t-ash"]);
      markSeen("1", "ash");
    });
    act(() => setVisibleConversationIds([])); // stepped away, still held
    expect(ids(result.current.middle)).toEqual(["t-birch", "t-ash"]);
    dm("ash", 1_400); // mid-turn DM, no new finished turn yet
    expect(ids(result.current.middle)).toEqual(["t-ash", "t-birch"]);
    expect(result.current.middle[0].dm).toBe(true);
  });

  it("a new DM to a held DM'd row moves it back to the top of the DM'd tier", () => {
    setup(["ash", "birch"]);
    dm("ash", 1_300);
    dm("birch", 1_200);
    const { result } = renderHook(() => useConversations());
    act(() => {
      setVisibleConversationIds(["t-birch"]);
      markSeen("1", "birch");
    });
    act(() => setVisibleConversationIds([]));
    // birch is held in the DM'd tier with its old DM time, below ash.
    expect(ids(result.current.middle)).toEqual(["t-ash", "t-birch"]);
    dm("birch", 1_500, 1_200);
    expect(ids(result.current.middle)).toEqual(["t-birch", "t-ash"]);
  });
});
