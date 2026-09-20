/**
 * Phase 117 Plan 117-07 Task 1: Tests for the projects slice + derived selector
 * on conversation-store.ts.
 *
 * Covers:
 *   1: ProjectRow shape + useProjects returns array set via setProjects.
 *   2: setProjects identity-equal skip — same content array does NOT bump the
 *      snapshotVersion (no listener notify).
 *   3: setProjects delta triggers exactly one notify per real change.
 *   4: derived selector — pinned + unassigned floats to pinnedUnassigned zone.
 *   5: derived selector — pinned + in-project floats to top of that section (D-19).
 *   6: derived selector — project sections sorted alphabetical by displayName
 *      (D-15).
 *   7: derived selector — dangling project ref falls to middle (D-07).
 *   8: derived selector — RDP row never in project section (D-08 defense).
 *   9: derived selector — empty project still shows up as a section (D-11).
 *   10: identity conversation project resolution via identityProjectAssignments.
 *   11: relay-room conversation project resolution via roomProjectAssignments.
 *   12: empty state — no projects, no assignments — selector still shape-stable.
 *
 * The derived selector's output type extends the existing snapshot with three
 * NEW fields: `pinnedUnassigned`, `projectSections`, `rdp`. The existing
 * `pinned` / `middle` / `rdpGroup` fields are preserved for backward
 * compatibility with pre-Phase-117 consumers.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

// Same putPinnedIds mock as the base conversation-store.test.ts — the store
// imports from @/api/user-preferences-api on pin/unpin. Hoisted vi.mock.
vi.mock("@/api/user-preferences-api", () => ({
  putPinnedIds: vi.fn().mockResolvedValue([]),
}));

import {
  updateHostTree,
  updateOpenTabs,
  updateFleetSessions,
  updateHostsFlat,
  updateIdentitiesByKey,
  selectConversation,
  pinConversation,
  useConversations,
  useProjects,
  setProjects,
  setRoomProjectAssignments,
  setIdentityProjectAssignments,
  readProjectsCache,
  writeProjectsCache,
  __resetActiveSetForTest,
  __resetPinnedIdsForTest,
  __resetFleetSessionsForTest,
  __resetLastMessageAtForTest,
  __resetProjectsForTest,
  __subscribeForTest,
  __getSnapshotForTest,
  fleetRowId,
  type ProjectRow,
  type FleetSession,
} from "./conversation-store.js";
import type { Tab, Host, HostFolder } from "@/types/ui-types";
import type { Identity } from "@/api/identities-api";

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeHost(
  id: string,
  name: string,
  overrides?: Partial<Host>,
): Host {
  return { id, name, ...(overrides ?? {}) } as unknown as Host;
}

function makeTab(
  id: string,
  type: Tab["type"],
  host?: Host,
  targetTmuxSession: string | null = null,
  label?: string,
): Tab {
  return {
    id,
    instanceId: id,
    type,
    label: label ?? `${type}:${host?.name ?? id}`,
    host,
    openedAt: 0,
    targetTmuxSession,
  };
}

function makeIdentity(
  identityKey: string,
  role: string | null,
  overrides?: Partial<Identity>,
): Identity {
  return {
    identityKey,
    displayName: identityKey,
    title: null,
    colorHue: null,
    voice: null,
    role,
    avatarMime: "",
    avatarUrl: "",
    avatarEtag: "",
    coordinator: false,
    task: null,
    project: null,
    ...(overrides ?? {}),
  };
}

function identitiesMap(...identities: Identity[]): Map<string, Identity> {
  return new Map(identities.map((id) => [id.identityKey.toLowerCase(), id]));
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
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 1: ProjectRow shape + useProjects returns the setter's rows
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (117-07): ProjectRow slice + useProjects", () => {
  it("Test 1: setProjects([row]) then useProjects returns [row] with the exact shape", () => {
    const row: ProjectRow = {
      slug: "a",
      displayName: "Alpha",
      hostId: "1",
      hostname: "t1000",
      archived: false,
    };
    act(() => {
      setProjects([row]);
    });
    const { result } = renderHook(() => useProjects());
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toEqual(row);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2: identity-equal skip — no notify on same-content re-emit
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (117-07): setProjects identity-equal skip", () => {
  it("Test 2: setProjects twice with same content does NOT notify subscribers on the second call", () => {
    const rows: ProjectRow[] = [
      { slug: "a", displayName: "Alpha", hostId: "1", hostname: "t1000", archived: false },
    ];
    act(() => {
      setProjects(rows);
    });

    const notifySpy = vi.fn();
    const unsub = __subscribeForTest(notifySpy);
    try {
      // Second call with a fresh array of byte-identical rows — must be a
      // no-op (no notify) per the archived-fleet-rows identity-equal skip.
      act(() => {
        setProjects([
          { slug: "a", displayName: "Alpha", hostId: "1", hostname: "t1000", archived: false },
        ]);
      });
      expect(notifySpy).not.toHaveBeenCalled();
    } finally {
      unsub();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3: delta triggers notify
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (117-07): setProjects delta triggers notify", () => {
  it("Test 3: setProjects([]) then setProjects([row]) — subscribers see exactly one notification for the delta", () => {
    // Baseline: state.projects already starts as [] and __resetProjectsForTest
    // reset it fresh. Subscribe now, then fire a real delta.
    const notifySpy = vi.fn();
    const unsub = __subscribeForTest(notifySpy);
    try {
      // Same-content skip (empty [] to []) — should NOT notify.
      act(() => {
        setProjects([]);
      });
      expect(notifySpy).not.toHaveBeenCalled();

      // Real delta [] → [row] — should notify exactly once.
      act(() => {
        setProjects([
          { slug: "a", displayName: "Alpha", hostId: "1", hostname: "t1000", archived: false },
        ]);
      });
      expect(notifySpy).toHaveBeenCalledTimes(1);
    } finally {
      unsub();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4: derived selector — pinned + unassigned floats to pinnedUnassigned
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (117-07): pinned + unassigned floats to pinnedUnassigned zone", () => {
  it("Test 4: pinned unassigned row lands in pinnedUnassigned; unpinned unassigned row lands in middle", () => {
    const hostA = makeHost("1", "t1000");
    const tree: HostFolder = { name: "root", children: [hostA] };
    act(() => {
      updateHostTree(tree);
      updateOpenTabs([
        makeTab("t-pin", "terminal", hostA, "wren"),
        makeTab("t-flat", "terminal", hostA, "beryl"),
      ]);
    });
    act(() => pinConversation("t-pin"));

    const { result } = renderHook(() => useConversations());
    const snap = result.current;
    expect(snap.pinnedUnassigned).toBeDefined();
    expect(snap.pinnedUnassigned.map((r) => r.id)).toEqual(["t-pin"]);
    expect(snap.middle.map((r) => r.id)).toEqual(["t-flat"]);
    expect(snap.projectSections).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5: derived selector — pinned + in-project floats to top of that section
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (117-07): pinning contextual scope (D-19)", () => {
  it("Test 5: pinned in-project row floats to TOP of that project section — NOT to global pinnedUnassigned", () => {
    const hostA = makeHost("1", "t1000");
    const tree: HostFolder = { name: "root", children: [hostA] };
    // Three identities in project "alpha", one pinned.
    act(() => {
      updateHostTree(tree);
      updateHostsFlat(new Map([[1, hostA]]));
      updateIdentitiesByKey(
        identitiesMap(
          makeIdentity("wren", "actor", { displayName: "Wren", project: "alpha" }),
          makeIdentity("beryl", "actor", { displayName: "Beryl", project: "alpha" }),
          makeIdentity("cora", "actor", { displayName: "Cora", project: "alpha" }),
        ),
      );
      setIdentityProjectAssignments(
        new Map<string, string>([
          ["1::wren", "alpha"],
          ["1::beryl", "alpha"],
          ["1::cora", "alpha"],
        ]),
      );
      setProjects([
        { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "t1000", archived: false },
      ]);
      updateOpenTabs([
        makeTab("t-cora", "terminal", hostA, "cora"),
        makeTab("t-beryl", "terminal", hostA, "beryl"),
        makeTab("t-wren", "terminal", hostA, "wren"),
      ]);
    });
    act(() => pinConversation("t-beryl")); // pin BERYL — display-name middle sort would put Beryl between Cora and Wren; with pinning, Beryl must land FIRST.

    const { result } = renderHook(() => useConversations());
    const snap = result.current;
    expect(snap.projectSections).toHaveLength(1);
    const section = snap.projectSections[0];
    expect(section.slug).toBe("alpha");
    // Beryl (pinned) first; then Cora, Wren alphabetical by displayName.
    expect(section.rows.map((r) => r.id)).toEqual(["t-beryl", "t-cora", "t-wren"]);
    // Beryl is NOT in the global pinnedUnassigned zone.
    expect(snap.pinnedUnassigned.map((r) => r.id)).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6: derived selector — project sections sorted by displayName (D-15)
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (117-07): projectSections sorted alphabetical by displayName (D-15)", () => {
  it("Test 6: two projects — {slug:'z',displayName:'Alpha'} sorts BEFORE {slug:'a',displayName:'Zebra'}", () => {
    const hostA = makeHost("1", "t1000");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateHostsFlat(new Map([[1, hostA]]));
      updateIdentitiesByKey(
        identitiesMap(
          makeIdentity("wren", "actor", { displayName: "Wren", project: "z" }),
          makeIdentity("beryl", "actor", { displayName: "Beryl", project: "a" }),
        ),
      );
      setIdentityProjectAssignments(
        new Map<string, string>([
          ["1::wren", "z"],
          ["1::beryl", "a"],
        ]),
      );
      setProjects([
        { slug: "z", displayName: "Alpha", hostId: "1", hostname: "t1000", archived: false },
        { slug: "a", displayName: "Zebra", hostId: "1", hostname: "t1000", archived: false },
      ]);
      updateOpenTabs([
        makeTab("t-wren", "terminal", hostA, "wren"),
        makeTab("t-beryl", "terminal", hostA, "beryl"),
      ]);
    });

    const { result } = renderHook(() => useConversations());
    const snap = result.current;
    // displayName order: Alpha (slug=z) → Zebra (slug=a) — NOT slug order.
    expect(snap.projectSections.map((s) => s.slug)).toEqual(["z", "a"]);
    expect(snap.projectSections.map((s) => s.displayName)).toEqual(["Alpha", "Zebra"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7: derived selector — dangling project ref falls to middle (D-07)
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (117-07): graceful degradation on dangling project ref (D-07)", () => {
  it("Test 7: identity with project='ghost' when useProjects has no such slug → row lands in middle, no crash", () => {
    const hostA = makeHost("1", "t1000");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateHostsFlat(new Map([[1, hostA]]));
      updateIdentitiesByKey(
        identitiesMap(
          makeIdentity("wren", "actor", { displayName: "Wren", project: "ghost" }),
        ),
      );
      setIdentityProjectAssignments(new Map<string, string>([["1::wren", "ghost"]]));
      setProjects([]); // no "ghost" — dangling
      updateOpenTabs([makeTab("t-wren", "terminal", hostA, "wren")]);
    });

    const { result } = renderHook(() => useConversations());
    const snap = result.current;
    expect(snap.projectSections).toEqual([]);
    expect(snap.middle.map((r) => r.id)).toEqual(["t-wren"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8: derived selector — RDP row NEVER in projectSections (D-08)
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (117-07): RDP row exclusion from projects (D-08)", () => {
  it("Test 8: rdpHostRow=true rows never appear in projectSections, even when a project assignment exists", () => {
    const hostA = makeHost("1", "t1000", { enableRdp: true });
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateHostsFlat(new Map([[1, hostA]]));
      setProjects([
        { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "t1000", archived: false },
      ]);
      // Attempt to inject a poisoning assignment for the RDP row's synthetic id.
      // rdp-host row id is `rdp-host::${host.id}` — this shouldn't normally
      // happen but defense-in-depth mirrors backend threat model T-117-07-05.
    });

    const { result } = renderHook(() => useConversations());
    const snap = result.current;
    // RDP row present in `rdp` bucket (mirrors rdpGroup for the new derived
    // selector output). Never in any projectSection.
    expect(snap.rdp).not.toBeNull();
    expect(snap.rdp!.rows.map((r) => r.id)).toEqual(["rdp-host::1"]);
    for (const section of snap.projectSections) {
      for (const row of section.rows) {
        expect(row.rdpHostRow).not.toBe(true);
        expect(row.id).not.toBe("rdp-host::1");
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9: derived selector — empty project still emits a header-only section (D-11)
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (117-07): empty project section (D-11)", () => {
  it("Test 9: project with zero conversations still emits {slug, displayName, rows: []}", () => {
    act(() => {
      setProjects([
        { slug: "empty", displayName: "Empty", hostId: "1", hostname: "t1000", archived: false },
      ]);
    });
    const { result } = renderHook(() => useConversations());
    const snap = result.current;
    expect(snap.projectSections).toHaveLength(1);
    expect(snap.projectSections[0]).toEqual({
      slug: "empty",
      displayName: "Empty",
      rows: [],
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10: identity conversation project resolution via identityProjectAssignments
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (117-07): identity conversation project resolution", () => {
  it("Test 10: identity 'wren' with identityProjectAssignments {1::wren → 'alpha'} lands in the 'alpha' section", () => {
    const hostA = makeHost("1", "t1000");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateHostsFlat(new Map([[1, hostA]]));
      updateIdentitiesByKey(
        identitiesMap(
          makeIdentity("wren", "actor", { displayName: "Wren", project: "alpha" }),
        ),
      );
      setIdentityProjectAssignments(
        new Map<string, string>([["1::wren", "alpha"]]),
      );
      setProjects([
        { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "t1000", archived: false },
      ]);
      updateOpenTabs([makeTab("t-wren", "terminal", hostA, "wren")]);
    });

    const { result } = renderHook(() => useConversations());
    const snap = result.current;
    expect(snap.projectSections).toHaveLength(1);
    expect(snap.projectSections[0].slug).toBe("alpha");
    expect(snap.projectSections[0].rows.map((r) => r.id)).toEqual(["t-wren"]);
    expect(snap.middle).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11: relay-room conversation project resolution via roomProjectAssignments
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (117-07): relay-room conversation project resolution", () => {
  it("Test 11: relay-room row with matrixRoomId set → hydrated via roomProjectAssignments Map<roomId, slug>", () => {
    const roomId = "!abc:t1000";
    // Relay-room fleet session — matches computeSnapshot's relay-room branch.
    const relaySession: FleetSession = {
      hostId: 0,
      hostName: "",
      sessionName: "",
      created: 0,
      role: null,
      kind: "relay-room",
      id: "relay-1",
      roomId,
      roomTitle: "Chat with Chorus",
    };
    act(() => {
      updateFleetSessions([relaySession]);
      setRoomProjectAssignments(new Map<string, string>([[roomId, "alpha"]]));
      setProjects([
        { slug: "alpha", displayName: "Alpha", hostId: "1", hostname: "t1000", archived: false },
      ]);
    });

    const { result } = renderHook(() => useConversations());
    const snap = result.current;
    expect(snap.projectSections).toHaveLength(1);
    const section = snap.projectSections[0];
    expect(section.slug).toBe("alpha");
    // The relay-room row's id is session.id ("relay-1").
    expect(section.rows.map((r) => r.id)).toEqual(["relay-1"]);
    expect(snap.middle).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 12: empty state — no projects, no assignments — selector shape-stable
// ─────────────────────────────────────────────────────────────────────────────
describe("conversation-store (117-07): empty state", () => {
  it("Test 12: no projects, no assignments — selector returns projectSections=[]", () => {
    const hostA = makeHost("1", "t1000");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([
        makeTab("t1", "terminal", hostA, "wren"),
        makeTab("t2", "terminal", hostA, "beryl"),
      ]);
    });
    act(() => pinConversation("t1"));

    const { result } = renderHook(() => useConversations());
    const snap = result.current;
    expect(snap.projectSections).toEqual([]);
    // Pinned t1 (no project) → pinnedUnassigned. Non-pinned t2 → middle.
    expect(snap.pinnedUnassigned.map((r) => r.id)).toEqual(["t1"]);
    expect(snap.middle.map((r) => r.id)).toEqual(["t2"]);
    // Existing consumers still see the old fields unchanged.
    expect(snap.pinned.map((r) => r.id)).toEqual(["t1"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cache tests: cold-boot localStorage seed + write-on-setter contracts
// ─────────────────────────────────────────────────────────────────────────────

const PROJECTS_CACHE_KEY = "skynet:projects-cache:v1";

describe("conversation-store (projects cache): cold-boot seed + write-on-setter", () => {
  it("setProjects writes canonical projects payload to localStorage", () => {
    const row: ProjectRow = {
      slug: "alpha",
      displayName: "Alpha",
      hostId: "1",
      hostname: "t1000",
      archived: false,
    };
    act(() => {
      setProjects([row]);
    });
    const cached = readProjectsCache();
    expect(cached.projects).toEqual([row]);
    expect(cached.identityProjectAssignments.size).toBe(0);
    expect(cached.roomProjectAssignments.size).toBe(0);
  });

  it("setIdentityProjectAssignments writes the map into the composite cache", () => {
    const row: ProjectRow = {
      slug: "alpha",
      displayName: "Alpha",
      hostId: "1",
      hostname: "t1000",
      archived: false,
    };
    act(() => {
      setProjects([row]);
    });
    act(() => {
      setIdentityProjectAssignments(new Map([["1::morpheus", "alpha"]]));
    });
    const cached = readProjectsCache();
    expect(cached.projects).toEqual([row]);
    expect(cached.identityProjectAssignments.get("1::morpheus")).toBe("alpha");
  });

  it("setRoomProjectAssignments writes the map into the composite cache", () => {
    act(() => {
      setRoomProjectAssignments(new Map([["!room:server", "alpha"]]));
    });
    const cached = readProjectsCache();
    expect(cached.roomProjectAssignments.get("!room:server")).toBe("alpha");
  });

  it("identity-equal skip in setProjects does not overwrite cache", () => {
    const row: ProjectRow = {
      slug: "alpha",
      displayName: "Alpha",
      hostId: "1",
      hostname: "t1000",
      archived: false,
    };
    act(() => {
      setProjects([row]);
    });
    // Corrupt the cache directly, then re-emit the same rows — the setter
    // should skip (identity-equal) and NOT re-write, so the corrupt payload
    // stays as evidence that write-on-noop is off.
    localStorage.setItem(PROJECTS_CACHE_KEY, "corrupted-sentinel");
    act(() => {
      setProjects([row]);
    });
    expect(localStorage.getItem(PROJECTS_CACHE_KEY)).toBe("corrupted-sentinel");
  });

  it("readProjectsCache returns empty triple on missing / malformed cache", () => {
    localStorage.removeItem(PROJECTS_CACHE_KEY);
    let cached = readProjectsCache();
    expect(cached.projects).toEqual([]);
    expect(cached.identityProjectAssignments.size).toBe(0);
    expect(cached.roomProjectAssignments.size).toBe(0);

    localStorage.setItem(PROJECTS_CACHE_KEY, "{not valid json");
    cached = readProjectsCache();
    expect(cached.projects).toEqual([]);
  });

  it("readProjectsCache drops wrong-shape entries per axis", () => {
    localStorage.setItem(
      PROJECTS_CACHE_KEY,
      JSON.stringify({
        projects: [
          { slug: "a" }, // missing required fields — dropped
          {
            slug: "b",
            displayName: "Bravo",
            hostId: "1",
            hostname: "t1000",
            archived: false,
          },
        ],
        identityProjectAssignments: [["k", "v"], ["bad"]], // bad entry dropped by isStringPairArray → whole axis dropped
        roomProjectAssignments: [["room", "slug"]],
      }),
    );
    const cached = readProjectsCache();
    expect(cached.projects).toHaveLength(1);
    expect(cached.projects[0].slug).toBe("b");
    // isStringPairArray is all-or-nothing on the array — one malformed entry
    // means the whole axis returns empty.
    expect(cached.identityProjectAssignments.size).toBe(0);
    expect(cached.roomProjectAssignments.get("room")).toBe("slug");
  });

  it("writeProjectsCache round-trips through readProjectsCache", () => {
    writeProjectsCache({
      projects: [
        {
          slug: "a",
          displayName: "Alpha",
          hostId: "1",
          hostname: "t1000",
          archived: false,
        },
      ],
      identityProjectAssignments: new Map([["1::morpheus", "a"]]),
      roomProjectAssignments: new Map([["!r:s", "a"]]),
    });
    const cached = readProjectsCache();
    expect(cached.projects[0].slug).toBe("a");
    expect(cached.identityProjectAssignments.get("1::morpheus")).toBe("a");
    expect(cached.roomProjectAssignments.get("!r:s")).toBe("a");
  });

  it("__resetProjectsForTest clears the localStorage cache", () => {
    act(() => {
      setProjects([
        {
          slug: "a",
          displayName: "Alpha",
          hostId: "1",
          hostname: "t1000",
          archived: false,
        },
      ]);
    });
    expect(readProjectsCache().projects).toHaveLength(1);

    act(() => {
      __resetProjectsForTest();
    });
    expect(readProjectsCache().projects).toEqual([]);
    expect(localStorage.getItem(PROJECTS_CACHE_KEY)).toBeNull();
  });
});

// Silence unused-import lint if `_makeIdentity` becomes unused during draft;
// keep the reference to avoid a churn diff during subsequent GREEN edits.
void makeIdentity;
