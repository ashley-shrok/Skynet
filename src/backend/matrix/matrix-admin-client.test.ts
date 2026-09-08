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
} from "./matrix-admin-client.js";
import { getMatrixAdminCreds } from "./matrix-admin-creds-store.js";

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
