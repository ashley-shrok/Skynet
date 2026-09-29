// Phase 135 Plan 135-02 Task 3 — scheduled-agents-api.test.ts
//
// Six unit tests, one per helper + one error-propagation test, mocking the
// authApi + handleApiError module at the module level BEFORE importing
// scheduled-agents-api. Follows the vi.mock-before-import convention documented in
// PATTERNS.md § test structure and mirrored from
// ConversationSearchModal.test.tsx / CreateProjectModal.test.tsx.
//
// Key gates:
//   - T-05 (DELETE-with-body): asserts the axios.delete call passes
//     `{data: {host}}` as its config arg — RESEARCH Pitfall #4 gate.
//   - T-03 (URL-encoding): includes a slug with a space to prove
//     encodeURIComponent is applied on the URL path.
//   - T-06 (error propagation): a status-carrying error thrown from
//     authApi is propagated through the helper via handleApiError so
//     downstream banners can read `.status`.

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Module-level mocks (BEFORE the scheduled-agents-api import) ─────────────────────

const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();
const deleteMock = vi.fn();

vi.mock("@/main-axios", () => ({
  authApi: {
    get: (...args: unknown[]) => getMock(...args),
    post: (...args: unknown[]) => postMock(...args),
    patch: (...args: unknown[]) => patchMock(...args),
    delete: (...args: unknown[]) => deleteMock(...args),
  },
  handleApiError: (err: unknown, verb: string): never => {
    // Mirror the real handleApiError semantics closely enough for tests:
    // wrap the error, attach `.status` from response.status if present,
    // and throw. Downstream `statusOf` in modal code ducks on `.status`.
    const inner = err instanceof Error ? err.message : String(err);
    const wrapped = new Error(`Failed to ${verb}: ${inner}`);
    (wrapped as Error & { status?: number }).status = (
      err as { response?: { status?: number }; status?: number }
    )?.response?.status ?? (err as { status?: number })?.status;
    throw wrapped;
  },
}));

// Import AFTER the mock so scheduled-agents-api picks up the stubbed authApi.
import {
  listScheduledAgents,
  createScheduledAgent,
  updateScheduledAgent,
  toggleScheduledAgentEnabled,
  deleteScheduledAgent,
  type ScheduledAgentSpecWire,
  type ScheduledAgentListItem,
} from "./scheduled-agents-api";

// ─── Fixtures ───────────────────────────────────────────────────────────────

function makeItem(overrides: Partial<ScheduledAgentListItem> = {}): ScheduledAgentListItem {
  return {
    slug: "morning-triage",
    host: "host-a",
    hostId: 1,
    name: "Morning triage",
    enabled: true,
    schedule: { type: "daily", at: "09:00" },
    scheduleHuman: "Daily at 9:00",
    prompt: "check inbox",
    roles: ["assistant"],
    skills: [],
    colorHue: null,
    ...overrides,
  };
}

function makeSpec(overrides: Partial<ScheduledAgentSpecWire> = {}): ScheduledAgentSpecWire {
  return {
    name: "morning-triage",
    prompt: "check inbox",
    schedule: { type: "daily", at: "09:00", timezone: "America/New_York" },
    roles: ["assistant"],
    skills: [],
    enabled: true,
    ...overrides,
  };
}

// ─── Setup ──────────────────────────────────────────────────────────────────

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  patchMock.mockReset();
  deleteMock.mockReset();
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("scheduled-agents-api", () => {
  it("T-01: listScheduledAgents() calls GET /scheduled-agents and unwraps {items}", async () => {
    const rows = [makeItem({ slug: "a" }), makeItem({ slug: "b" })];
    getMock.mockResolvedValueOnce({ data: { items: rows } });

    const result = await listScheduledAgents();

    expect(getMock).toHaveBeenCalledTimes(1);
    expect(getMock).toHaveBeenCalledWith("/scheduled-agents");
    expect(result).toEqual(rows);
  });

  it("T-02: createScheduledAgent(host, spec) POSTs /scheduled-agents with {host, spec} body", async () => {
    const spec = makeSpec();
    postMock.mockResolvedValueOnce({
      data: { slug: "morning-triage", host: 1, spec },
    });

    const result = await createScheduledAgent(1, spec);

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith("/scheduled-agents", { host: 1, spec });
    expect(result).toEqual({ slug: "morning-triage", host: 1, spec });
  });

  it("T-03: updateScheduledAgent(slug, host, spec) PATCHes /scheduled-agents/:slug with URL-encoded slug", async () => {
    const spec = makeSpec({ name: "morning triage" });
    // Slug containing a space — encodeURIComponent should escape it as %20.
    const slug = "morning triage";
    patchMock.mockResolvedValueOnce({
      data: { slug, host: 1, spec },
    });

    await updateScheduledAgent(slug, 1, spec);

    expect(patchMock).toHaveBeenCalledTimes(1);
    // Assert the URL was URL-encoded (space → %20).
    expect(patchMock).toHaveBeenCalledWith(
      "/scheduled-agents/morning%20triage",
      { host: 1, spec },
    );
  });

  it("T-04: toggleScheduledAgentEnabled(slug, host, enabled) PATCHes /scheduled-agents/:slug/toggle-enabled with {host, enabled} body", async () => {
    patchMock.mockResolvedValueOnce({
      data: { slug: "morning-triage", host: 1, enabled: false },
    });

    const result = await toggleScheduledAgentEnabled("morning-triage", 1, false);

    expect(patchMock).toHaveBeenCalledTimes(1);
    expect(patchMock).toHaveBeenCalledWith(
      "/scheduled-agents/morning-triage/toggle-enabled",
      { host: 1, enabled: false },
    );
    expect(result).toEqual({
      slug: "morning-triage",
      host: 1,
      enabled: false,
    });
  });

  it("T-05: deleteScheduledAgent(slug, host) uses axios data:{} config for the body (DELETE-with-body per RESEARCH Pitfall #4)", async () => {
    deleteMock.mockResolvedValueOnce({ data: undefined });

    await deleteScheduledAgent("morning-triage", 1);

    expect(deleteMock).toHaveBeenCalledTimes(1);
    // The critical gate: the config object's `data` key carries the body.
    expect(deleteMock).toHaveBeenCalledWith(
      "/scheduled-agents/morning-triage",
      { data: { host: 1 } },
    );
  });

  it("T-06: error propagation — handleApiError wrap preserves .status for downstream banner mapping", async () => {
    // Simulate an axios-style 409 rejection.
    const raw = Object.assign(new Error("Conflict"), {
      response: { status: 409 },
    });
    postMock.mockRejectedValueOnce(raw);

    let caught: unknown = null;
    try {
      await createScheduledAgent(1, makeSpec());
    } catch (err) {
      caught = err;
    }

    // Ensure it threw + carries `.status` = 409 so statusOf() picks it up.
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error & { status?: number }).status).toBe(409);
  });
});
