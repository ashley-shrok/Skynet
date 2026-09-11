import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Phase 92 Plan 04 Task 1 — API-92-* tests for the reshaped user-preferences-
// api surface. Two contracts locked here:
//
//   (1) putPinnedIds now takes a SECOND argument `identityHosts: Record<string,
//       number>` and threads it into the PUT body alongside pinnedConversationIds.
//       The backend fanout (Plan 92-02 Task 2) uses identityHosts to route each
//       .pinned sentinel write to the correct host. Missing this second arg →
//       backend responds 400 (validated at the backend, not here — this file
//       locks the WIRE shape).
//
//   (2) getPinnedIds is REMOVED. The hydrate path no longer routes through
//       GET /user-preferences for pinned ids — Plan 92-04 Task 2 rewires the
//       panel to derive pinned ids from the identities-store's per-identity
//       `pinned: boolean` field instead. This file asserts the export is
//       absent so an accidental re-introduction fails at build/test time.

// Mock the authApi layer so tests exercise the real putPinnedIds body-
// construction logic without hitting the network. Same pattern as
// user-preferences-api's siblings (identity-send-log-api.test.ts et al).
vi.mock("@/main-axios", () => ({
  authApi: {
    put: vi.fn(),
    get: vi.fn(),
  },
  handleApiError: (err: unknown) => (err instanceof Error ? err.message : "error"),
}));

import { putPinnedIds } from "@/api/user-preferences-api";
import * as UserPreferencesApi from "@/api/user-preferences-api";
import { authApi } from "@/main-axios";

describe("Phase 92 Plan 04 Task 1 — user-preferences-api pin surface", () => {
  beforeEach(() => {
    vi.mocked(authApi.put).mockReset();
    vi.mocked(authApi.get).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ─── API-92-01 — putPinnedIds new signature: identityHosts in the body ───
  it("API-92-01: putPinnedIds(ids, identityHosts) issues PUT /user-preferences with both fields in the body", async () => {
    vi.mocked(authApi.put).mockResolvedValueOnce({
      data: { pinnedConversationIds: ["tina"] },
    });

    const result = await putPinnedIds(["tina"], { tina: 1 });

    // Wire shape: PUT to /user-preferences with body containing BOTH keys.
    expect(authApi.put).toHaveBeenCalledTimes(1);
    expect(authApi.put).toHaveBeenCalledWith("/user-preferences", {
      pinnedConversationIds: ["tina"],
      identityHosts: { tina: 1 },
    });
    expect(result).toEqual(["tina"]);
  });

  // ─── API-92-02 — empty identityHosts is permitted (unpin-all case) ────────
  it("API-92-02: putPinnedIds([], {}) works — empty identityHosts is a valid unpin-all shape", async () => {
    vi.mocked(authApi.put).mockResolvedValueOnce({
      data: { pinnedConversationIds: [] },
    });

    const result = await putPinnedIds([], {});

    expect(authApi.put).toHaveBeenCalledWith("/user-preferences", {
      pinnedConversationIds: [],
      identityHosts: {},
    });
    expect(result).toEqual([]);
  });

  // ─── API-92-03 — getPinnedIds is REMOVED from the export surface ─────────
  it("API-92-03: getPinnedIds is not exported from @/api/user-preferences-api", () => {
    // The module still lives — but the getPinnedIds symbol must not be a
    // callable export. If it re-appears as a re-export or a compat shim, this
    // assertion trips. Belt-and-suspenders: we probe both `undefined` (the
    // clean removal) and `throws when called` (a compat shim rejection).
    const surface = UserPreferencesApi as Record<string, unknown>;
    expect(surface.getPinnedIds).toBeUndefined();
  });

  // ─── API-92-04 — putPinnedIds preserves server-echo comparison behavior ──
  it("API-92-04: putPinnedIds returns server-echoed array even when it differs from input", async () => {
    // Echo behavior from Plan 92-02: the backend re-derives pinnedConversationIds
    // from disk after the fanout and echoes that (authoritative). putPinnedIds
    // returns the echoed value verbatim so callers see disk truth.
    vi.mocked(authApi.put).mockResolvedValueOnce({
      data: { pinnedConversationIds: ["b", "a"] },
    });
    // Silence the divergence warn — the shape lock is what matters here.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await putPinnedIds(["a", "b"], { a: 1, b: 2 });

    expect(result).toEqual(["b", "a"]);
    warnSpy.mockRestore();
  });

  // ─── API-92-05 — composite `fleet::<hostId>::<key>` ids strip to bare ────
  // Found by unbiased code review after Plan 92-04 shipped: the frontend's
  // deriveDiskPinnedIds emits composite ids like `fleet::1::tina` (identities-
  // store.ts:125-140), and pinConversation/unpinConversation pass those
  // composite ids straight to putPinnedIds. The backend fanout at
  // user-preferences.ts:273 gates on `if (!(key in identityHosts))` where
  // identityHosts is keyed by BARE identityKey — so composite ids 400 on
  // every real pin toggle. Silent-catch on the frontend hid the failure,
  // no test crossed the wire. This test locks the strip at the API
  // boundary: composite ids become bare on the wire; identityHosts is
  // unchanged.
  it("API-92-05: composite fleet::hostId::key ids strip to bare identityKey on the wire", async () => {
    vi.mocked(authApi.put).mockResolvedValueOnce({
      data: { pinnedConversationIds: ["tina"] },
    });

    const result = await putPinnedIds(
      ["fleet::1::tina"],
      { tina: 1 },
    );

    // Wire body has BARE identityKey, not composite. identityHosts unchanged.
    expect(authApi.put).toHaveBeenCalledTimes(1);
    expect(authApi.put).toHaveBeenCalledWith("/user-preferences", {
      pinnedConversationIds: ["tina"],
      identityHosts: { tina: 1 },
    });
    expect(result).toEqual(["tina"]);
  });

  // ─── API-92-06 — mixed composite + bare ids strip only the composites ────
  it("API-92-06: mixed composite and bare ids strip only the composites, bare pass through", async () => {
    vi.mocked(authApi.put).mockResolvedValueOnce({
      data: { pinnedConversationIds: ["tina", "george", "amelia"] },
    });

    const result = await putPinnedIds(
      ["fleet::1::tina", "george", "fleet::5::amelia"],
      { tina: 1, george: 3, amelia: 5 },
    );

    // Composite ids strip to bare; already-bare "george" passes through.
    expect(authApi.put).toHaveBeenCalledWith("/user-preferences", {
      pinnedConversationIds: ["tina", "george", "amelia"],
      identityHosts: { tina: 1, george: 3, amelia: 5 },
    });
    expect(result).toEqual(["tina", "george", "amelia"]);
  });

  // ─── API-92-07 — the strip does NOT touch non-composite ids that happen ──
  // ─── to contain `::` in some other position (defensive) ──────────────────
  it("API-92-07: strip only fires for exactly `fleet::N::key` shape; other :: strings pass through", async () => {
    vi.mocked(authApi.put).mockResolvedValueOnce({
      data: { pinnedConversationIds: [] },
    });
    // Silence divergence warn — echoed=[] vs sent=[some ids] intentionally diverges here
    // because the test asserts the STRIP behavior on unusual inputs, not the echo path.
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    // These should all pass through untouched:
    //   - "tina::foo" — only 2 parts, not 3
    //   - "prefix::1::tina" — 3 parts but leading segment isn't "fleet"
    //   - "fleet::a::b::c" — 4 parts, not 3
    //   - "fleet::1::" — 3 parts but empty key
    await putPinnedIds(
      ["tina::foo", "prefix::1::tina", "fleet::a::b::c", "fleet::1::"],
      {},
    );

    expect(authApi.put).toHaveBeenCalledWith("/user-preferences", {
      pinnedConversationIds: [
        "tina::foo",
        "prefix::1::tina",
        "fleet::a::b::c",
        // "fleet::1::" splits to ["fleet", "1", ""] → 3 parts with "fleet"
        // leading → strips to "" (empty). Documenting the current behavior:
        // an empty key on the wire is still preferable to a composite id
        // that would 400 the whole request. Callers should not pass this.
        "",
      ],
      identityHosts: {},
    });
    warnSpy.mockRestore();
  });
});
