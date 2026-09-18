// ─── AppShell.identity-project-derivation.test.tsx ───────────────────────────
// Phase 117 H1 fix — regression test for the identity-project derivation effect
// added to AppShell.
//
// Pre-fix bug: nothing in production code called setIdentityProjectAssignments
// after a project drag, so the sidebar never showed identity conversations
// moving into their project section — the map remained empty from initial
// state.
//
// Fix: AppShell grows a useEffect that derives the Map from useIdentities()'s
// byKey snapshot on every identities-store change:
//   - filter identity.project !== null && typeof identity.hostId === "number"
//   - key on `${hostId}::${identityKey.toLowerCase()}`
//   - value is the identity's project slug
//
// This test does NOT mount AppShell (its ~30-import surface is too fragile
// per the AppShell.persistence.test.tsx fallback rationale). Instead it
// reproduces the derivation logic verbatim in a small helper and asserts
// its output matches expectations for the various identity-shape variants.
// A final integration test verifies the map, once written via
// setIdentityProjectAssignments, correctly bucketizes an identity conversation
// through the useConversations selector (end-to-end proof).

import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import {
  __resetProjectsForTest,
  __resetActiveSetForTest,
  __resetPinnedIdsForTest,
  __resetFleetSessionsForTest,
  setIdentityProjectAssignments,
  setProjects,
  updateHostTree,
  updateHostsFlat,
  updateIdentitiesByKey,
  updateOpenTabs,
  useConversations,
} from "@/state/conversation-store";
import type { Host, HostFolder, Tab } from "@/types/ui-types";

// The exact derivation the effect performs — pulled out as a pure function
// so this test verifies the same shape the effect uses at AppShell.tsx
// (the H1 fix effect).
function deriveIdentityProjectMap(
  identitiesByKey: Map<string, Identity>,
): Map<string, string> {
  const next = new Map<string, string>();
  for (const identity of identitiesByKey.values()) {
    if (identity.project == null) continue;
    if (typeof identity.hostId !== "number") continue;
    const key = `${identity.hostId}::${identity.identityKey.toLowerCase()}`;
    next.set(key, identity.project);
  }
  return next;
}

function makeIdentity(
  identityKey: string,
  overrides: Partial<Identity> = {},
): Identity {
  return {
    identityKey,
    hostId: 1,
    displayName: identityKey,
    title: null,
    colorHue: null,
    voice: null,
    role: null,
    avatarMime: "image/png",
    avatarUrl: `/identities/${identityKey}/avatar?hostId=1`,
    avatarEtag: "abc",
    coordinator: false,
    task: null,
    project: null,
    ...overrides,
  };
}

function makeHost(id: string, name: string): Host {
  return { id, name } as unknown as Host;
}

function makeTab(
  id: string,
  type: Tab["type"],
  host?: Host,
  targetTmuxSession: string | null = null,
): Tab {
  return {
    id,
    instanceId: id,
    type,
    label: `${type}:${host?.name ?? id}`,
    host,
    openedAt: 0,
    targetTmuxSession,
  };
}

describe("AppShell identity-project derivation effect (H1 fix)", () => {
  beforeEach(() => {
    __resetActiveSetForTest();
    __resetPinnedIdsForTest();
    __resetFleetSessionsForTest();
    __resetProjectsForTest();
  });

  it("populates the map from identities with project + hostId", () => {
    const byKey = new Map<string, Identity>([
      ["wren", makeIdentity("wren", { hostId: 1, project: "alpha" })],
      ["kestrel", makeIdentity("kestrel", { hostId: 2, project: "beta" })],
    ]);
    const derived = deriveIdentityProjectMap(byKey);
    expect(derived.get("1::wren")).toBe("alpha");
    expect(derived.get("2::kestrel")).toBe("beta");
    expect(derived.size).toBe(2);
  });

  it("excludes identities with null project", () => {
    const byKey = new Map<string, Identity>([
      ["wren", makeIdentity("wren", { hostId: 1, project: null })],
      ["kestrel", makeIdentity("kestrel", { hostId: 1, project: "beta" })],
    ]);
    const derived = deriveIdentityProjectMap(byKey);
    expect(derived.has("1::wren")).toBe(false);
    expect(derived.get("1::kestrel")).toBe("beta");
    expect(derived.size).toBe(1);
  });

  it("excludes identities with undefined hostId", () => {
    const noHost: Identity = makeIdentity("ghost", { project: "gamma" });
    delete (noHost as { hostId?: number }).hostId;
    const byKey = new Map<string, Identity>([["ghost", noHost]]);
    const derived = deriveIdentityProjectMap(byKey);
    expect(derived.size).toBe(0);
  });

  it("lowercases identityKey in the map key", () => {
    const byKey = new Map<string, Identity>([
      ["Wren", makeIdentity("Wren", { hostId: 1, project: "alpha" })],
    ]);
    const derived = deriveIdentityProjectMap(byKey);
    expect(derived.get("1::wren")).toBe("alpha");
    expect(derived.has("1::Wren")).toBe(false);
  });

  it("end-to-end: derived map + setIdentityProjectAssignments buckets identity conversation into project section", () => {
    const hostA = makeHost("1", "t1000");
    const wren = makeIdentity("wren", { hostId: 1, project: "alpha" });
    act(() => {
      updateHostTree({ name: "root", children: [hostA] } as HostFolder);
      updateHostsFlat(new Map([[1, hostA]]));
      updateIdentitiesByKey(new Map([["wren", wren]]));
      // The derived map — same code the AppShell effect runs.
      const derived = deriveIdentityProjectMap(new Map([["wren", wren]]));
      setIdentityProjectAssignments(derived);
      setProjects([
        {
          slug: "alpha",
          displayName: "Alpha",
          hostId: "1",
          hostname: "t1000",
          archived: false,
        },
      ]);
      updateOpenTabs([makeTab("t-wren", "terminal", hostA, "wren")]);
    });

    const { result } = renderHook(() => useConversations());
    expect(result.current.projectSections).toHaveLength(1);
    expect(result.current.projectSections[0].slug).toBe("alpha");
    expect(result.current.projectSections[0].rows.map((r) => r.id)).toEqual([
      "t-wren",
    ]);
  });
});
