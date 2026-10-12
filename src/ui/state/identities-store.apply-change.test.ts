import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/api/identities-api", () => ({
  listIdentities: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/api/user-preferences-api", () => ({
  putPinnedIds: vi.fn().mockResolvedValue([]),
  setIdentityPinned: vi.fn().mockResolvedValue(undefined),
}));

import {
  applyIdentityChange,
  __resetIdentitiesStoreForTest,
  __getIdentitiesStoreSnapshotForTest,
} from "./identities-store.js";
import type { Identity } from "@/api/identities-api";

function makeIdentity(overrides: Partial<Identity> = {}): Identity {
  return {
    identityKey: "wren",
    hostId: 7,
    displayName: "Wren",
    title: null,
    colorHue: 210,
    voice: null,
    role: null,
    task: null,
    project: null,
    avatarMime: "image/png",
    avatarUrl: "",
    avatarEtag: "",
    coordinator: false,
    ...overrides,
  } as Identity;
}

beforeEach(() => {
  __resetIdentitiesStoreForTest();
});

describe("applyIdentityChange: pin state on update", () => {
  it("an update without `pinned` (updateIdentity's echo) keeps the row's pin", () => {
    applyIdentityChange(makeIdentity({ pinned: true }));
    const echo = makeIdentity({ task: "Renamed" });
    delete (echo as Partial<Identity>).pinned;
    applyIdentityChange(echo);
    const row = __getIdentitiesStoreSnapshotForTest().byHostKey.get("7::wren");
    expect(row?.task).toBe("Renamed");
    expect(row?.pinned).toBe(true);
  });

  it("an update that carries `pinned` still wins", () => {
    applyIdentityChange(makeIdentity({ pinned: true }));
    applyIdentityChange(makeIdentity({ pinned: false }));
    expect(__getIdentitiesStoreSnapshotForTest().byHostKey.get("7::wren")?.pinned).toBe(false);
  });
});
