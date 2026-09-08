/**
 * matrix-admin-client unit tests.
 *
 * Coverage: happy path + every documented failure mode for each of the five
 * Synapse admin primitives, plus the pure buildRelayJsonBody helper.
 *
 * Mocking strategy:
 *   - global `fetch` stubbed per test via `vi.stubGlobal("fetch", vi.fn())`
 *     (matches voice.test.ts precedent).
 *   - `getMatrixAdminCreds` mocked via `vi.mock("./matrix-admin-creds-store.js", ...)`
 *     — its return value is configured per test.
 *   - `databaseLogger` mocked so `.error()` calls don't spam stderr.
 *
 * NO real Synapse is hit here. Integration tests against the live thenasty
 * Synapse are gated behind an env flag in Plan 75-05.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./matrix-admin-creds-store.js", () => ({
  getMatrixAdminCreds: vi.fn(),
}));

vi.mock("../utils/logger.js", () => ({
  databaseLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  },
}));

import {
  createOrUpdateUser,
  loginAsUser,
  joinRoom,
  makeRoomAdmin,
  listRooms,
  buildRelayJsonBody,
  countUsersMatching,
  getSharedDMRoom,
  deactivateUser,
  createRoom,
  getUserJoinedRooms,
  getRoomLatestEventTs,
  getRoomJoinedMembers,
  getRoomName,
  getRoomMessages,
  sendMessageAsUser,
} from "./matrix-admin-client.js";
import { getMatrixAdminCreds } from "./matrix-admin-creds-store.js";
import { databaseLogger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const HAPPY_CREDS = {
  homeserverBase: "http://100.113.23.63:8008",
  userId: "@skynet-admin:thenasty.taild9b663.ts.net",
  accessToken: "syt_admin_token_abcdefg",
  password: "admin-plaintext-password",
};

/** Build a fake Response-shaped object with `.ok`, `.status`, `.json()`. */
function mockFetchResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** Convenience: stub fetch to return a single canned response. */
function stubFetchOk(status: number, body: unknown): void {
  const mock = vi.fn(async () => mockFetchResponse(status, body));
  vi.stubGlobal("fetch", mock);
}

/** Convenience: stub fetch to throw an AbortError (simulated 30s timeout). */
function stubFetchAbort(): void {
  const mock = vi.fn(async () => {
    throw new DOMException("The user aborted a request.", "AbortError");
  });
  vi.stubGlobal("fetch", mock);
}

/** Convenience: stub fetch to throw a network TypeError. */
function stubFetchNetworkError(): void {
  const mock = vi.fn(async () => {
    throw new TypeError("network dropped");
  });
  vi.stubGlobal("fetch", mock);
}

beforeEach(() => {
  vi.mocked(getMatrixAdminCreds).mockReset();
  vi.mocked(getMatrixAdminCreds).mockResolvedValue(HAPPY_CREDS);
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// createOrUpdateUser
// ---------------------------------------------------------------------------

describe("createOrUpdateUser", () => {
  it("happy path 201 → {ok:true, mxid, password, status:201}", async () => {
    stubFetchOk(201, {
      name: "@bob:thenasty.taild9b663.ts.net",
      admin: false,
    });
    const result = await createOrUpdateUser(
      "@bob:thenasty.taild9b663.ts.net",
      "bob-pw",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.mxid).toBe("@bob:thenasty.taild9b663.ts.net");
      expect(result.password).toBe("bob-pw");
      expect(result.status).toBe(201);
    }
  });

  it("happy path 200 (update-existing) → {ok:true, mxid, password, status:200} (Pitfall 5)", async () => {
    stubFetchOk(200, { name: "@bob:thenasty.taild9b663.ts.net" });
    const result = await createOrUpdateUser(
      "@bob:thenasty.taild9b663.ts.net",
      "bob-pw-2",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.password).toBe("bob-pw-2");
    }
  });

  it("non-2xx 403 → {ok:false, status:403, error:'admin_api_non_2xx'} — no upstream body leak", async () => {
    stubFetchOk(403, { errcode: "M_FORBIDDEN", error: "server-secret-detail" });
    const result = await createOrUpdateUser("@bob:host", "pw");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe("admin_api_non_2xx");
      // Explicit non-leak assertion: upstream body must NOT surface.
      expect(JSON.stringify(result)).not.toContain("server-secret-detail");
      expect(JSON.stringify(result)).not.toContain("M_FORBIDDEN");
    }
  });

  it("AbortError (timeout) → {ok:false, status:504, error:'admin_api_timeout'}", async () => {
    stubFetchAbort();
    const result = await createOrUpdateUser("@bob:host", "pw");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(504);
      expect(result.error).toBe("admin_api_timeout");
    }
  });

  it("network error → {ok:false, status:502, error:'admin_api_proxy_error'}", async () => {
    stubFetchNetworkError();
    const result = await createOrUpdateUser("@bob:host", "pw");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toBe("admin_api_proxy_error");
    }
  });

  it("no creds available → {ok:false, status:500, error:'matrix_admin_creds_missing'}", async () => {
    vi.mocked(getMatrixAdminCreds).mockResolvedValue(null);
    // fetch should NOT be called; stub throws if it is.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch must not be called when creds are missing");
      }),
    );
    const result = await createOrUpdateUser("@bob:host", "pw");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("matrix_admin_creds_missing");
    }
  });

  it("passes displayname through when caller supplies it", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse(201, {}));
    vi.stubGlobal("fetch", fetchMock);
    await createOrUpdateUser("@bob:host", "pw", "Bob The Human");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const opts = call[1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body.displayname).toBe("Bob The Human");
    expect(body.password).toBe("pw");
    expect(body.admin).toBe(false);
    expect(body.deactivated).toBe(false);
  });

  it("does NOT include displayname in body when caller omits it", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse(201, {}));
    vi.stubGlobal("fetch", fetchMock);
    await createOrUpdateUser("@bob:host", "pw");
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(opts.body as string);
    expect(body).not.toHaveProperty("displayname");
  });

  it("mxid with special chars is encodeURIComponent'd in the URL", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse(201, {}));
    vi.stubGlobal("fetch", fetchMock);
    await createOrUpdateUser("@bob+test:host", "pw");
    const url = fetchMock.mock.calls[0][0] as string;
    // '@' → %40, '+' → %2B, ':' → %3A
    expect(url).toContain("%40bob%2Btest%3Ahost");
    expect(url).not.toContain("@bob+test:host");
  });

  it("sends Authorization: Bearer <accessToken> header", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse(201, {}));
    vi.stubGlobal("fetch", fetchMock);
    await createOrUpdateUser("@bob:host", "pw");
    const headers = (fetchMock.mock.calls[0][1] as RequestInit).headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${HAPPY_CREDS.accessToken}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// loginAsUser
// ---------------------------------------------------------------------------

describe("loginAsUser", () => {
  it("happy path returns {ok:true, accessToken:'syt_xxxx'}", async () => {
    stubFetchOk(200, {
      access_token: "syt_freshly_minted_xxxx",
      user_id: "@bob:host",
    });
    const result = await loginAsUser("@bob:host");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.accessToken).toBe("syt_freshly_minted_xxxx");
    }
  });

  it("response missing access_token → {ok:false, status:500, error:'admin_api_no_token'}", async () => {
    stubFetchOk(200, { user_id: "@bob:host" });
    const result = await loginAsUser("@bob:host");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("admin_api_no_token");
    }
  });

  it("non-2xx 401 → {ok:false, status:401, error:'admin_api_non_2xx'}", async () => {
    stubFetchOk(401, { errcode: "M_UNAUTHORIZED" });
    const result = await loginAsUser("@bob:host");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.error).toBe("admin_api_non_2xx");
    }
  });

  it("passes valid_until_ms in body when supplied", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, { access_token: "syt_x" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await loginAsUser("@bob:host", 1_800_000);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.valid_until_ms).toBe(1_800_000);
  });
});

// ---------------------------------------------------------------------------
// joinRoom
// ---------------------------------------------------------------------------

describe("joinRoom", () => {
  it("happy path returns {ok:true, roomId:'!abc:host'} and posts user_id defaulting to creds.userId", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, { room_id: "!abc:host" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await joinRoom("!abc:host");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.roomId).toBe("!abc:host");
    }
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.user_id).toBe(HAPPY_CREDS.userId);
  });

  it("explicit userId override sends that value", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, { room_id: "!abc:host" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await joinRoom("!abc:host", "@someone-else:host");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.user_id).toBe("@someone-else:host");
  });

  it("non-2xx propagates status", async () => {
    stubFetchOk(404, { errcode: "M_NOT_FOUND" });
    const result = await joinRoom("!missing:host");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe("admin_api_non_2xx");
    }
  });
});

// ---------------------------------------------------------------------------
// makeRoomAdmin
// ---------------------------------------------------------------------------

describe("makeRoomAdmin", () => {
  it("happy path returns {ok:true}", async () => {
    stubFetchOk(200, {});
    const result = await makeRoomAdmin("!abc:host");
    expect(result.ok).toBe(true);
  });

  it("non-2xx propagates status", async () => {
    stubFetchOk(403, { errcode: "M_FORBIDDEN" });
    const result = await makeRoomAdmin("!abc:host");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe("admin_api_non_2xx");
    }
  });

  it("posts user_id defaulting to creds.userId", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await makeRoomAdmin("!abc:host");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.user_id).toBe(HAPPY_CREDS.userId);
  });
});

// ---------------------------------------------------------------------------
// listRooms
// ---------------------------------------------------------------------------

describe("listRooms", () => {
  it("happy path returns {ok:true, rooms:[...], nextBatch:<number>}", async () => {
    stubFetchOk(200, {
      rooms: [{ room_id: "!a:host" }, { room_id: "!b:host" }],
      next_batch: 42,
    });
    const result = await listRooms();
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.rooms).toHaveLength(2);
      expect(result.nextBatch).toBe(42);
    }
  });

  it("default limit=200 appears in URL query string", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, { rooms: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await listRooms();
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("limit=200");
    expect(url).toContain("from=0");
  });

  it("caller-supplied limit + from appear in URL", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, { rooms: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await listRooms(50, 100);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("limit=50");
    expect(url).toContain("from=100");
  });
});

// ---------------------------------------------------------------------------
// countUsersMatching (Phase 80-02) — GET /_synapse/admin/v2/users?user_id=<prefix>&deactivated=true&limit=1
// ---------------------------------------------------------------------------

describe("countUsersMatching", () => {
  it("happy path 200 with {total:5} → {ok:true, total:5}", async () => {
    stubFetchOk(200, { total: 5, users: [{ name: "@willow-x:host" }] });
    const result = await countUsersMatching("@Willow-");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.total).toBe(5);
    }
  });

  it("happy path 200 with body missing total → {ok:true, total:0} (safe default)", async () => {
    stubFetchOk(200, { users: [] });
    const result = await countUsersMatching("@Nobody-");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.total).toBe(0);
    }
  });

  it("no creds available → {ok:false, status:500, error:'matrix_admin_creds_missing'}", async () => {
    vi.mocked(getMatrixAdminCreds).mockResolvedValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("fetch must not be called when creds are missing");
      }),
    );
    const result = await countUsersMatching("@Willow-");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("matrix_admin_creds_missing");
    }
  });

  it("non-2xx 403 → {ok:false, status:403, error:'admin_api_non_2xx'} — no upstream body leak", async () => {
    stubFetchOk(403, {
      errcode: "M_FORBIDDEN",
      error: "server-secret-detail",
    });
    const result = await countUsersMatching("@Willow-");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe("admin_api_non_2xx");
      expect(JSON.stringify(result)).not.toContain("server-secret-detail");
      expect(JSON.stringify(result)).not.toContain("M_FORBIDDEN");
    }
  });

  it("AbortError (timeout) → {ok:false, status:504, error:'admin_api_timeout'}", async () => {
    stubFetchAbort();
    const result = await countUsersMatching("@Willow-");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(504);
      expect(result.error).toBe("admin_api_timeout");
    }
  });

  it("network error → {ok:false, status:502, error:'admin_api_proxy_error'}", async () => {
    stubFetchNetworkError();
    const result = await countUsersMatching("@Willow-");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toBe("admin_api_proxy_error");
    }
  });

  it("URL contains user_id, deactivated=true, and limit=1 query params", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse(200, { total: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    await countUsersMatching("@Willow-");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/_synapse/admin/v2/users");
    expect(url).toContain("user_id=");
    expect(url).toContain("deactivated=true");
    expect(url).toContain("limit=1");
  });

  it("prefix with special chars is encodeURIComponent'd in the URL", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse(200, { total: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    await countUsersMatching("@Willow+test:host");
    const url = fetchMock.mock.calls[0][0] as string;
    // '@' → %40, '+' → %2B, ':' → %3A
    expect(url).toContain("%40Willow%2Btest%3Ahost");
    expect(url).not.toContain("@Willow+test:host");
  });

  it("sends GET method with Authorization: Bearer <accessToken> header", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse(200, { total: 0 }));
    vi.stubGlobal("fetch", fetchMock);
    await countUsersMatching("@Willow-");
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe("GET");
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${HAPPY_CREDS.accessToken}`);
    expect(headers["Content-Type"]).toBe("application/json");
  });
});

// ---------------------------------------------------------------------------
// buildRelayJsonBody (pure helper — no fetch, no creds)
// ---------------------------------------------------------------------------

describe("buildRelayJsonBody", () => {
  const BUILD_OPTS = {
    mxid: "@bob:thenasty.taild9b663.ts.net",
    password: "bob-pw",
    accessToken: "syt_bob_token",
    homeserverBase: "http://100.113.23.63:8008",
  };

  it("base ends in /_matrix/client/v3 (recv.sh strips this to derive MROOT)", async () => {
    const json = buildRelayJsonBody(BUILD_OPTS);
    const parsed = JSON.parse(json);
    expect(parsed.base.endsWith("/_matrix/client/v3")).toBe(true);
    expect(parsed.base).toBe("http://100.113.23.63:8008/_matrix/client/v3");
  });

  it("both token and access_token keys are present with the same value", async () => {
    const parsed = JSON.parse(buildRelayJsonBody(BUILD_OPTS));
    expect(parsed.token).toBe("syt_bob_token");
    expect(parsed.access_token).toBe("syt_bob_token");
    expect(parsed.token).toBe(parsed.access_token);
  });

  it("emits exactly five keys — base, user_id, password, token, access_token", async () => {
    const parsed = JSON.parse(buildRelayJsonBody(BUILD_OPTS));
    const keys = Object.keys(parsed).sort();
    expect(keys).toEqual([
      "access_token",
      "base",
      "password",
      "token",
      "user_id",
    ]);
  });

  it("user_id and password round-trip verbatim from opts", async () => {
    const parsed = JSON.parse(buildRelayJsonBody(BUILD_OPTS));
    expect(parsed.user_id).toBe(BUILD_OPTS.mxid);
    expect(parsed.password).toBe(BUILD_OPTS.password);
  });
});
// getSharedDMRoom (Plan 83-02 — FIXB-03)
// ---------------------------------------------------------------------------

describe("getSharedDMRoom", () => {
  const AGENT = "@alexander:server";
  const HUMAN = "@ashley:server";

  it("G-01 happy path 2-member shared room resolves to that room_id", async () => {
    // Sequenced fetch: (1) agent joined_rooms, (2) human joined_rooms,
    // (3) members lookup for the intersecting room.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          joined_rooms: ["!roomA:server", "!roomB:server"],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          joined_rooms: ["!roomB:server", "!roomC:server"],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          members: ["@alexander:server", "@ashley:server"],
          total: 2,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSharedDMRoom(AGENT, HUMAN);
    expect(result).toBe("!roomB:server");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Verify encodeURIComponent applied to mxids in first two calls.
    const call0Url = fetchMock.mock.calls[0][0] as string;
    const call1Url = fetchMock.mock.calls[1][0] as string;
    expect(call0Url).toContain(encodeURIComponent(AGENT));
    expect(call0Url).toContain("/joined_rooms");
    expect(call1Url).toContain(encodeURIComponent(HUMAN));
    expect(call1Url).toContain("/joined_rooms");
    // Verify encodeURIComponent applied to room_id in third call.
    const call2Url = fetchMock.mock.calls[2][0] as string;
    expect(call2Url).toContain(encodeURIComponent("!roomB:server"));
    expect(call2Url).toContain("/members");
  });

  it("G-02 no shared room returns null without members lookup", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse(200, { joined_rooms: ["!roomA:server"] }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, { joined_rooms: ["!roomC:server"] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSharedDMRoom(AGENT, HUMAN);
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("G-03 3-member shared room filtered out (returns null)", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse(200, { joined_rooms: ["!bigroom:server"] }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, { joined_rooms: ["!bigroom:server"] }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          members: [
            "@alexander:server",
            "@ashley:server",
            "@somebody-else:server",
          ],
          total: 3,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSharedDMRoom(AGENT, HUMAN);
    expect(result).toBeNull();
    // Members endpoint IS called for the shared room; result filtered.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("G-04 joined_rooms 500 returns null (short-circuits)", async () => {
    // Both calls fire in Promise.all — the second one succeeding is fine;
    // implementation short-circuits AFTER the pair resolves when either
    // is null. So we expect exactly 2 calls (no members lookup).
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(mockFetchResponse(500, {}))
      .mockResolvedValueOnce(
        mockFetchResponse(200, { joined_rooms: ["!roomX:server"] }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSharedDMRoom(AGENT, HUMAN);
    expect(result).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("G-05 missing creds returns null without fetch call", async () => {
    vi.mocked(getMatrixAdminCreds).mockResolvedValue(null);
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch must not be called when creds are missing");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await getSharedDMRoom(AGENT, HUMAN);
    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("G-06 AbortError on first fetch returns null", async () => {
    stubFetchAbort();
    const result = await getSharedDMRoom(AGENT, HUMAN);
    expect(result).toBeNull();
    // No unhandled rejection: if clearTimeout weren't called, the test
    // process would emit warnings — vitest surfaces those. Absence is
    // the (indirect) proof.
  });

  it("G-07 encodeURIComponent applied to mxids and room_id (path-traversal defense)", async () => {
    // mxid already contains a %2f — encodeURIComponent double-encodes to %252f.
    const traversalMxid = "@alex%2fetc:server";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse(200, { joined_rooms: ["!weird/room:server"] }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, { joined_rooms: ["!weird/room:server"] }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          members: [traversalMxid, HUMAN],
          total: 2,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    await getSharedDMRoom(traversalMxid, HUMAN);
    // Agent mxid URL: %40alex%252fetc%3Aserver (double-encoded slash).
    const agentUrl = fetchMock.mock.calls[0][0] as string;
    expect(agentUrl).toContain("%40alex%252fetc%3Aserver");
    expect(agentUrl).not.toContain("%2fetc"); // raw %2f must not survive
    // Room_id URL must encodeURIComponent the '/' in the room name.
    const roomUrl = fetchMock.mock.calls[2][0] as string;
    expect(roomUrl).toContain(encodeURIComponent("!weird/room:server"));
    expect(roomUrl).not.toContain("!weird/room:server");
  });
});

// ---------------------------------------------------------------------------
// deactivateUser (Phase 88-02)
// ---------------------------------------------------------------------------

describe("deactivateUser", () => {
  it("happy path 200 returns {ok:true}", async () => {
    stubFetchOk(200, {});
    const result = await deactivateUser("@bob:thenasty.taild9b663.ts.net");
    expect(result.ok).toBe(true);
  });

  it("non-2xx 403 propagates status, upstream body NOT leaked", async () => {
    stubFetchOk(403, { errcode: "M_FORBIDDEN", error: "Cannot deactivate" });
    const result = await deactivateUser("@bob:thenasty.taild9b663.ts.net");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe("admin_api_non_2xx");
    }
    // Explicit non-leak assertion: upstream body must NOT surface in the result.
    expect(JSON.stringify(result)).not.toContain("M_FORBIDDEN");
    expect(JSON.stringify(result)).not.toContain("Cannot deactivate");
  });

  it("AbortError (timeout) → {ok:false, status:504, error:'admin_api_timeout'}", async () => {
    stubFetchAbort();
    const result = await deactivateUser("@bob:host");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(504);
      expect(result.error).toBe("admin_api_timeout");
    }
  });

  it("network error → {ok:false, status:502, error:'admin_api_proxy_error'}", async () => {
    stubFetchNetworkError();
    const result = await deactivateUser("@bob:host");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toBe("admin_api_proxy_error");
    }
  });

  it("no creds available → {ok:false, status:500, error:'matrix_admin_creds_missing'}, fetch never called", async () => {
    vi.mocked(getMatrixAdminCreds).mockResolvedValueOnce(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await deactivateUser("@bob:host");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("matrix_admin_creds_missing");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mxid is encodeURIComponent'd in URL (T-88-05 path-traversal defense)", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await deactivateUser("@bob:host with space");
    const calledUrl = fetchMock.mock.calls[0][0] as string;
    // '@' → %40, ':' → %3A, ' ' → %20
    expect(calledUrl).toContain("%40bob%3Ahost%20with%20space");
    expect(calledUrl).toContain("/_synapse/admin/v1/deactivate/");
  });

  it("request body contains {erase:false} (Assumption A3 — defensive default)", async () => {
    const fetchMock = vi.fn(async () => mockFetchResponse(200, {}));
    vi.stubGlobal("fetch", fetchMock);
    await deactivateUser("@bob:host");
    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const parsedBody = JSON.parse(requestInit.body as string);
    expect(parsedBody.erase).toBe(false);
    expect(requestInit.method).toBe("POST");
  });
});

// ---------------------------------------------------------------------------
// createRoom (Phase 89-02 Task 1) — POST /_matrix/client/v3/createRoom
// ---------------------------------------------------------------------------
//
// Client-server API (NOT the admin API — there is no admin createRoom); admin
// credential is a normal Matrix access_token that works on both APIs.

describe("createRoom", () => {
  it("Test 1: happy path 200 returns {ok:true, roomId}; POST to /_matrix/client/v3/createRoom with Bearer auth and body includes name+preset+visibility", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, {
        room_id: "!agentsRegistry:thenasty.taild9b663.ts.net",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await createRoom({
      name: "agents-registry",
      preset: "private_chat",
      visibility: "private",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.roomId).toBe(
        "!agentsRegistry:thenasty.taild9b663.ts.net",
      );
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    expect(url).toBe(
      `${HAPPY_CREDS.homeserverBase}/_matrix/client/v3/createRoom`,
    );
    const opts = call[1] as RequestInit;
    expect(opts.method).toBe("POST");
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(
      `Bearer ${HAPPY_CREDS.accessToken}`,
    );
    expect(headers["Content-Type"]).toBe("application/json");
    const body = JSON.parse(opts.body as string);
    expect(body.name).toBe("agents-registry");
    expect(body.preset).toBe("private_chat");
    expect(body.visibility).toBe("private");
  });

  it("Test 2: non-2xx 400 (invalid room state) → {ok:false, status:400, error:'admin_api_non_2xx'}", async () => {
    stubFetchOk(400, {
      errcode: "M_INVALID_PARAM",
      error: "some-server-secret-detail",
    });
    const result = await createRoom({ name: "bad-room" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toBe("admin_api_non_2xx");
      expect(JSON.stringify(result)).not.toContain("some-server-secret-detail");
      expect(JSON.stringify(result)).not.toContain("M_INVALID_PARAM");
    }
  });

  it("Test 3: no creds available → {ok:false, status:500, error:'matrix_admin_creds_missing'}, fetch never called", async () => {
    vi.mocked(getMatrixAdminCreds).mockResolvedValueOnce(null);
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch must not be called when creds are missing");
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await createRoom({ name: "any-room" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("matrix_admin_creds_missing");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Test 4: AbortError (timeout) → {ok:false, status:504, error:'admin_api_timeout'}", async () => {
    stubFetchAbort();
    const result = await createRoom({ name: "any-room" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(504);
      expect(result.error).toBe("admin_api_timeout");
    }
  });

  it("Test 5: network throw → {ok:false, status:502, error:'admin_api_proxy_error'}; admin token NEVER logged", async () => {
    stubFetchNetworkError();
    const errorSpy = vi.mocked(databaseLogger.error);
    errorSpy.mockClear();
    const result = await createRoom({ name: "any-room" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toBe("admin_api_proxy_error");
    }
    // Verify databaseLogger.error was called (proxy path), but the admin
    // access_token substring appears in NONE of its arguments.
    expect(errorSpy).toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) {
      for (const arg of call) {
        expect(JSON.stringify(arg)).not.toContain(HAPPY_CREDS.accessToken);
      }
    }
  });

  it("Test 5b: response missing room_id → {ok:false, status:500, error:'admin_api_missing_field'} (fixup N-3: semantic clarifier renamed from admin_api_no_token)", async () => {
    stubFetchOk(200, { alt_field: "no room id here" });
    const result = await createRoom({ name: "any-room" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("admin_api_missing_field");
    }
  });

  it("Test 5c: room_alias_name is passed through in body when supplied", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, {
        room_id: "!x:host",
        room_alias: "#myalias:host",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await createRoom({
      name: "aliased-room",
      roomAliasName: "myalias",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.roomId).toBe("!x:host");
      expect(result.roomAlias).toBe("#myalias:host");
    }
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.room_alias_name).toBe("myalias");
  });
});

// ---------------------------------------------------------------------------
// getUserJoinedRooms (Phase 89-03 Task 1) — top-level primitive extracted
// from getSharedDMRoom's internal helper at L473. Discriminated-union return
// so the observation loop can drive per-user backoff on failure reasons.
// ---------------------------------------------------------------------------

describe("getUserJoinedRooms", () => {
  it("Test 1: happy path 200 with joined_rooms → {ok:true, roomIds}; GET /_synapse/admin/v1/users/{mxid}/joined_rooms with Bearer auth", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, {
        joined_rooms: ["!r1:server", "!r2:server"],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await getUserJoinedRooms("@user:server");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.roomIds).toEqual(["!r1:server", "!r2:server"]);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    const url = call[0] as string;
    expect(url).toBe(
      `${HAPPY_CREDS.homeserverBase}/_synapse/admin/v1/users/${encodeURIComponent("@user:server")}/joined_rooms`,
    );
    const opts = call[1] as RequestInit;
    expect(opts.method).toBe("GET");
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(
      `Bearer ${HAPPY_CREDS.accessToken}`,
    );
  });

  it("Test 2: 404 user not found → {ok:false, status:404, error:'admin_api_non_2xx'}", async () => {
    stubFetchOk(404, { errcode: "M_NOT_FOUND", error: "user not found" });
    const result = await getUserJoinedRooms("@ghost:server");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe("admin_api_non_2xx");
    }
  });

  it("Test 3: creds missing → {ok:false, status:500, error:'matrix_admin_creds_missing'}, fetch never called", async () => {
    vi.mocked(getMatrixAdminCreds).mockResolvedValueOnce(null);
    const fetchMock = vi.fn(async () => {
      throw new Error("fetch must not be called when creds are missing");
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await getUserJoinedRooms("@user:server");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("matrix_admin_creds_missing");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Test 4: AbortError (timeout) → {ok:false, status:504, error:'admin_api_timeout'}", async () => {
    stubFetchAbort();
    const result = await getUserJoinedRooms("@user:server");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(504);
      expect(result.error).toBe("admin_api_timeout");
    }
  });

  it("Test 5: getSharedDMRoom's happy path still works after extraction refactor (regression)", async () => {
    const AGENT = "@alexander:server";
    const HUMAN = "@ashley:server";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          joined_rooms: ["!roomA:server", "!roomB:server"],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          joined_rooms: ["!roomB:server", "!roomC:server"],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchResponse(200, {
          members: ["@alexander:server", "@ashley:server"],
          total: 2,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const result = await getSharedDMRoom(AGENT, HUMAN);
    expect(result).toBe("!roomB:server");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// getRoomLatestEventTs (Phase 89-03 Task 1) — GET Synapse admin messages
// endpoint with dir=b&limit=1; returns the newest event's origin_server_ts.
// ---------------------------------------------------------------------------

describe("getRoomLatestEventTs", () => {
  it("Test 6: happy path 200 with chunk containing origin_server_ts → {ok:true, ts:number}", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, {
        chunk: [{ origin_server_ts: 1725840000000 }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await getRoomLatestEventTs("!r1:server");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ts).toBe(1725840000000);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(
      `${HAPPY_CREDS.homeserverBase}/_synapse/admin/v1/rooms/${encodeURIComponent("!r1:server")}/messages?dir=b&limit=1`,
    );
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe("GET");
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(
      `Bearer ${HAPPY_CREDS.accessToken}`,
    );
  });

  it("Test 7: empty chunk (no events yet) → {ok:true, ts:null} — D-05 tolerance for brand-new room", async () => {
    stubFetchOk(200, { chunk: [] });
    const result = await getRoomLatestEventTs("!newroom:server");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ts).toBeNull();
    }
  });

  it("Test 9a: getRoomLatestEventTs proxy-error path NEVER logs admin access_token", async () => {
    stubFetchNetworkError();
    const errorSpy = vi.mocked(databaseLogger.error);
    errorSpy.mockClear();
    const result = await getRoomLatestEventTs("!r1:server");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toBe("admin_api_proxy_error");
    }
    expect(errorSpy).toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) {
      for (const arg of call) {
        expect(JSON.stringify(arg)).not.toContain(HAPPY_CREDS.accessToken);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getRoomJoinedMembers (Phase 89-03 Task 1) — GET /_synapse/admin/v1/rooms/
// {roomId}/members — top-level primitive using the same endpoint that lives
// inside getSharedDMRoom's L511 members-count loop.
// ---------------------------------------------------------------------------

describe("getRoomJoinedMembers", () => {
  it("Test 8: happy path 200 with members+total → {ok:true, memberMxids, total}", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, {
        members: ["@a:s", "@b:s"],
        total: 2,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await getRoomJoinedMembers("!r1:server");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.memberMxids).toEqual(["@a:s", "@b:s"]);
      expect(result.total).toBe(2);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe(
      `${HAPPY_CREDS.homeserverBase}/_synapse/admin/v1/rooms/${encodeURIComponent("!r1:server")}/members`,
    );
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe("GET");
  });

  it("Test 8b: members missing / wrong-type → fallback to empty array; total = memberMxids.length", async () => {
    stubFetchOk(200, {});
    const result = await getRoomJoinedMembers("!r1:server");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.memberMxids).toEqual([]);
      expect(result.total).toBe(0);
    }
  });

  it("Test 9b: getRoomJoinedMembers proxy-error path NEVER logs admin access_token", async () => {
    stubFetchNetworkError();
    const errorSpy = vi.mocked(databaseLogger.error);
    errorSpy.mockClear();
    const result = await getRoomJoinedMembers("!r1:server");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toBe("admin_api_proxy_error");
    }
    expect(errorSpy).toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) {
      for (const arg of call) {
        expect(JSON.stringify(arg)).not.toContain(HAPPY_CREDS.accessToken);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getRoomName (Phase 89 fixup M-1) — GET /_matrix/client/v3/rooms/{roomId}/
// state/m.room.name — reads the room's canonical display name via the
// client-server API (admin credential works on both APIs). Used by the
// observation loop to populate relay_room_sessions.room_title (D-02) so
// slice D can render a sensible sidebar label.
// ---------------------------------------------------------------------------

describe("getRoomName", () => {
  it("M-1 happy path: 200 with {name: 'Team Sync'} → {ok:true, name:'Team Sync'}", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, { name: "Team Sync" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await getRoomName("!r1:server");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBe("Team Sync");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    // Client-server API (not admin API — m.room.name state event is a
    // client-server concept, and the admin credential works on both).
    expect(url).toBe(
      `${HAPPY_CREDS.homeserverBase}/_matrix/client/v3/rooms/${encodeURIComponent("!r1:server")}/state/m.room.name`,
    );
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    expect(opts.method).toBe("GET");
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(
      `Bearer ${HAPPY_CREDS.accessToken}`,
    );
  });

  it("M-1: 404 (no m.room.name state event set) → {ok:true, name:null} — graceful null for rooms without a name", async () => {
    // Matrix returns 404 when the state event doesn't exist. This is the
    // common case for DMs and freshly-created rooms — a null name is
    // valid data, not an error.
    stubFetchOk(404, { errcode: "M_NOT_FOUND" });
    const result = await getRoomName("!nameless:server");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBeNull();
    }
  });

  it("M-1: 200 with missing/wrong-type name field → {ok:true, name:null}", async () => {
    stubFetchOk(200, {});
    const result = await getRoomName("!r1:server");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBeNull();
    }
  });

  it("M-1: 200 with empty-string name → {ok:true, name:null} (treat empty as absent)", async () => {
    stubFetchOk(200, { name: "" });
    const result = await getRoomName("!r1:server");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.name).toBeNull();
    }
  });

  it("M-1: non-2xx (non-404) → {ok:false, status, error:'admin_api_non_2xx'}", async () => {
    stubFetchOk(500, { errcode: "M_UNKNOWN" });
    const result = await getRoomName("!r1:server");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("admin_api_non_2xx");
    }
  });

  it("M-1: creds missing → {ok:false, status:500, error:'matrix_admin_creds_missing'} without fetch", async () => {
    vi.mocked(getMatrixAdminCreds).mockResolvedValueOnce(null);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await getRoomName("!r1:server");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("matrix_admin_creds_missing");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("M-1: proxy-error path NEVER logs admin access_token", async () => {
    stubFetchNetworkError();
    const errorSpy = vi.mocked(databaseLogger.error);
    errorSpy.mockClear();
    const result = await getRoomName("!r1:server");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toBe("admin_api_proxy_error");
    }
    expect(errorSpy).toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) {
      for (const arg of call) {
        expect(JSON.stringify(arg)).not.toContain(HAPPY_CREDS.accessToken);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// getRoomMessages (Phase 90 Plan 03 Task 1) — GET /_matrix/client/v3/rooms/
// {roomId}/messages?dir=b&from=<eventId>&limit=20 — event-id cursor pagination
// (Pitfall 5) for the relay-room pane's message-history + scroll-back load.
// Admin-mediated read; response contains parsed event array + cursors.
// ---------------------------------------------------------------------------

describe("getRoomMessages (Phase 90 Plan 03 Task 1)", () => {
  it("Test 1: happy path 200 with chunk+end+start → {ok:true, events, end, start}", async () => {
    const ev1 = {
      event_id: "$ev1:server",
      type: "m.room.message",
      sender: "@ashley:server",
      origin_server_ts: 1725840000000,
      content: { msgtype: "m.text", body: "hello" },
    };
    const ev2 = {
      event_id: "$ev2:server",
      type: "m.room.message",
      sender: "@bob:server",
      origin_server_ts: 1725840001000,
      content: { msgtype: "m.text", body: "world" },
      unsigned: { transaction_id: "mqid-abc" },
    };
    stubFetchOk(200, {
      chunk: [ev1, ev2],
      end: "t1_cursor",
      start: "t2_cursor",
    });
    const result = await getRoomMessages("!abc:server", { dir: "b" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events).toHaveLength(2);
      expect(result.events[0].event_id).toBe("$ev1:server");
      expect(result.events[1].event_id).toBe("$ev2:server");
      expect(result.events[1].unsigned?.transaction_id).toBe("mqid-abc");
      expect(result.end).toBe("t1_cursor");
      expect(result.start).toBe("t2_cursor");
    }
  });

  it("Test 2: URL construction — encodeURIComponent on roomId + dir/from/limit query params", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, { chunk: [], end: "e", start: "s" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await getRoomMessages("!abc:server", {
      dir: "b",
      from: "t99_cursor",
      limit: 20,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = fetchMock.mock.calls[0][0] as string;
    // encodeURIComponent("!abc:server") = "!abc%3Aserver" — `!` is in RFC
    // 3986 unreserved set so encodeURIComponent leaves it, but `:` becomes
    // %3A. The load-bearing defense is that `:` (path separator in Matrix
    // mxid/roomId grammar) is encoded — prevents path traversal per T-90-03-T1.
    // Also assert the string is not the raw ":" form (encoding actually happened).
    expect(url).toContain("!abc%3Aserver");
    expect(url).not.toContain("!abc:server");
    expect(url).toContain("dir=b");
    expect(url).toContain("from=t99_cursor");
    expect(url).toContain("limit=20");
    // Client-server API endpoint shape
    expect(url).toContain("/_matrix/client/v3/rooms/");
    expect(url).toContain("/messages?");
  });

  it("Test 3: dir='f' + no from + no limit → no from/limit query params", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, { chunk: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await getRoomMessages("!r1:server", { dir: "f" });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("dir=f");
    expect(url).not.toContain("from=");
    expect(url).not.toContain("limit=");
  });

  it("Test 4: creds missing → {ok:false, status:500, error:'matrix_admin_creds_missing'}", async () => {
    vi.mocked(getMatrixAdminCreds).mockResolvedValueOnce(null);
    const result = await getRoomMessages("!r1:server", { dir: "b" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("matrix_admin_creds_missing");
    }
  });

  it("Test 5a: 404 → {ok:false, status:404, error:'admin_api_non_2xx'}", async () => {
    stubFetchOk(404, { errcode: "M_NOT_FOUND" });
    const result = await getRoomMessages("!r1:server", { dir: "b" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.error).toBe("admin_api_non_2xx");
    }
  });

  it("Test 5b: 403 → {ok:false, status:403, error:'admin_api_non_2xx'}", async () => {
    stubFetchOk(403, { errcode: "M_FORBIDDEN" });
    const result = await getRoomMessages("!r1:server", { dir: "b" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.error).toBe("admin_api_non_2xx");
    }
  });

  it("Test 6: AbortError → {ok:false, status:504, error:'admin_api_timeout'}", async () => {
    stubFetchAbort();
    const result = await getRoomMessages("!r1:server", { dir: "b" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(504);
      expect(result.error).toBe("admin_api_timeout");
    }
  });

  it("Test 7: other fetch error → {ok:false, status:502, error:'admin_api_proxy_error'}; databaseLogger.error called with operation:'matrix_admin_get_room_messages'", async () => {
    stubFetchNetworkError();
    const errorSpy = vi.mocked(databaseLogger.error);
    errorSpy.mockClear();
    const result = await getRoomMessages("!r1:server", { dir: "b" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toBe("admin_api_proxy_error");
    }
    expect(errorSpy).toHaveBeenCalled();
    // Assert one of the calls contained the expected operation label.
    const anyCallHasOp = errorSpy.mock.calls.some((call) =>
      call.some(
        (arg) =>
          typeof arg === "object" &&
          arg !== null &&
          (arg as { operation?: string }).operation ===
            "matrix_admin_get_room_messages",
      ),
    );
    expect(anyCallHasOp).toBe(true);
    // T-90-BE-01 defense: proxy-error path NEVER logs admin access_token.
    for (const call of errorSpy.mock.calls) {
      for (const arg of call) {
        expect(JSON.stringify(arg)).not.toContain(HAPPY_CREDS.accessToken);
      }
    }
  });

  it("Test 8: response missing chunk field → {ok:false, status:500, error:'admin_api_missing_field'}", async () => {
    stubFetchOk(200, { end: "e", start: "s" });
    const result = await getRoomMessages("!r1:server", { dir: "b" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("admin_api_missing_field");
    }
  });

  it("Test 9: Authorization header uses admin creds.accessToken (reads are admin-mediated)", async () => {
    const fetchMock = vi.fn(async () =>
      mockFetchResponse(200, { chunk: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await getRoomMessages("!r1:server", { dir: "b" });
    const opts = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe(`Bearer ${HAPPY_CREDS.accessToken}`);
  });

  it("Test 10: clearTimeout called in BOTH success and error paths (no leaked timers)", async () => {
    const clearSpy = vi.spyOn(global, "clearTimeout");
    // Success path
    stubFetchOk(200, { chunk: [] });
    clearSpy.mockClear();
    await getRoomMessages("!r1:server", { dir: "b" });
    const clearedOnSuccess = clearSpy.mock.calls.length;
    expect(clearedOnSuccess).toBeGreaterThanOrEqual(1);
    // Error path — AbortError
    stubFetchAbort();
    clearSpy.mockClear();
    await getRoomMessages("!r1:server", { dir: "b" });
    const clearedOnError = clearSpy.mock.calls.length;
    expect(clearedOnError).toBeGreaterThanOrEqual(1);
    clearSpy.mockRestore();
  });

  it("Test 11: defensive parse — non-array chunk (e.g. object) → {ok:false, status:500, error:'admin_api_missing_field'}", async () => {
    stubFetchOk(200, { chunk: { not: "an array" } });
    const result = await getRoomMessages("!r1:server", { dir: "b" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      expect(result.error).toBe("admin_api_missing_field");
    }
  });

  it("Test 12: defensive parse — chunk entry missing event_id is skipped, valid entries returned", async () => {
    const goodEv = {
      event_id: "$ok:server",
      type: "m.room.message",
      sender: "@a:s",
      origin_server_ts: 1,
      content: { body: "hi" },
    };
    stubFetchOk(200, {
      chunk: [{ type: "m.room.message" /* no event_id */ }, goodEv],
    });
    const result = await getRoomMessages("!r1:server", { dir: "b" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.events).toHaveLength(1);
      expect(result.events[0].event_id).toBe("$ok:server");
    }
  });
});
