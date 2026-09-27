/**
 * phone-call-requests/worker.test.ts
 *
 * Tests for processPhoneCall — covers every branch of the main flow
 * (malformed short-circuit, TTL expired, unknown user, no phone on file,
 * happy call). All external side effects (DB, SSH, adapter) are injected
 * via WorkerDeps.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const { stubLogger } = vi.hoisted(() => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  };
  return { stubLogger: stub };
});
vi.mock("../utils/logger.js", () => ({
  systemLogger: stubLogger,
  databaseLogger: stubLogger,
  sshLogger: stubLogger,
  tunnelLogger: stubLogger,
  fileLogger: stubLogger,
  statsLogger: stubLogger,
  apiLogger: stubLogger,
  authLogger: stubLogger,
  versionLogger: stubLogger,
  dashboardLogger: stubLogger,
  guacLogger: stubLogger,
  logger: stubLogger,
  setGlobalLogLevel: vi.fn(),
  getGlobalLogLevel: () => "info",
}));

import { processPhoneCall, PHONE_CALL_TTL_MS } from "./worker.js";
import type { WorkerDeps } from "./worker.js";
import type { PendingPhoneCall, PhoneCallResponse } from "./types.js";

function makeItem(overrides: Partial<PendingPhoneCall> = {}): PendingPhoneCall {
  return {
    hostId: "1",
    hostIdNum: 1,
    uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    body: {
      caller_name: "Clipper the Box Maintainer",
      to_user: "ashley",
      message: "Your CI failed",
      requested_at: new Date().toISOString(),
    },
    ...overrides,
  };
}

interface WrittenResponse {
  path: string;
  body: PhoneCallResponse;
}

function makeDeps(overrides: Partial<WorkerDeps> = {}): {
  deps: WorkerDeps;
  written: WrittenResponse[];
} {
  const written: WrittenResponse[] = [];
  const deps: WorkerDeps = {
    isLocalHostId: () => true, // LOCAL branch keeps tests simple
    writeMarkdownFileAtomic: (async (
      _conn: unknown,
      path: string,
      body: string,
    ) => {
      written.push({ path, body: JSON.parse(body) as PhoneCallResponse });
    }) as unknown as WorkerDeps["writeMarkdownFileAtomic"],
    connectOneShot: vi.fn() as unknown as WorkerDeps["connectOneShot"],
    execCommand: vi.fn() as unknown as WorkerDeps["execCommand"],
    resolveHostById: vi.fn() as unknown as WorkerDeps["resolveHostById"],
    getHostOwnerUserId: vi.fn(async () => "user-1"),
    getUserByUsername: vi.fn(async (username: string) =>
      username === "ashley"
        ? { id: "user-1", phoneE164: "+15551234567" }
        : null,
    ),
    placeCallAndAwait: vi.fn(async () => ({
      outcome: "completed" as const,
      transcript: "assistant: hi\nuser: yes",
      call_length_seconds: 30,
    })) as unknown as WorkerDeps["placeCallAndAwait"],
    now: () => Date.now(),
    sleep: async () => {},
    ...overrides,
  };
  return { deps, written };
}

describe("processPhoneCall — happy path", () => {
  it("resolves user, calls adapter, writes completed response", async () => {
    const { deps, written } = makeDeps();
    const item = makeItem();
    await processPhoneCall(item, deps);

    expect(written).toHaveLength(1);
    expect(written[0].path).toContain("phone-call-requests/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.response.json");
    expect(written[0].body.outcome).toBe("completed");
    expect(written[0].body.transcript).toBe("assistant: hi\nuser: yes");
    expect(written[0].body.call_length_seconds).toBe(30);
    expect(deps.getUserByUsername).toHaveBeenCalledWith("ashley");
    expect(deps.placeCallAndAwait).toHaveBeenCalled();
  });

  it("interpolates caller_name into the Bland prompt/first_sentence handoff", async () => {
    const placeSpy = vi.fn(async () => ({
      outcome: "completed" as const,
      transcript: "hi",
      call_length_seconds: 10,
    }));
    const { deps } = makeDeps({
      placeCallAndAwait: placeSpy as unknown as WorkerDeps["placeCallAndAwait"],
    });
    await processPhoneCall(
      makeItem({
        body: {
          caller_name: "Clipper the Box Maintainer",
          to_user: "ashley",
          message: "Your CI failed",
          requested_at: new Date().toISOString(),
        },
      }),
      deps,
    );

    // Adapter was called with the resolved phone number, a prompt that
    // interpolates caller_name, and a first_sentence that starts with
    // "Hi, this is <caller_name>".
    const [phone, taskPrompt, firstSentence] = placeSpy.mock.calls[0];
    expect(phone).toBe("+15551234567");
    expect(taskPrompt).toContain("Clipper the Box Maintainer");
    expect(firstSentence).toBe(
      "Hi, this is Clipper the Box Maintainer, with a message for you: Your CI failed",
    );
  });
});

describe("processPhoneCall — pre-call failure branches", () => {
  it("shortcircuits on malformedReason (no DB lookup, no adapter call)", async () => {
    const { deps, written } = makeDeps();
    await processPhoneCall(
      makeItem({ malformedReason: "unrecognized field: extra" }),
      deps,
    );

    expect(written).toHaveLength(1);
    expect(written[0].body.outcome).toBe("malformed");
    expect(written[0].body.message).toBe("unrecognized field: extra");
    expect(deps.getUserByUsername).not.toHaveBeenCalled();
    expect(deps.placeCallAndAwait).not.toHaveBeenCalled();
  });

  it("returns timeout when requested_at is older than PHONE_CALL_TTL_MS", async () => {
    const nowMs = 1_000_000_000_000;
    const requestedAt = new Date(nowMs - PHONE_CALL_TTL_MS - 1000).toISOString();
    const { deps, written } = makeDeps({ now: () => nowMs });
    await processPhoneCall(
      makeItem({
        body: {
          caller_name: "X",
          to_user: "ashley",
          message: "m",
          requested_at: requestedAt,
        },
      }),
      deps,
    );

    expect(written).toHaveLength(1);
    expect(written[0].body.outcome).toBe("timeout");
    expect(deps.getUserByUsername).not.toHaveBeenCalled();
    expect(deps.placeCallAndAwait).not.toHaveBeenCalled();
  });

  it("returns unknown_user when the target username is not found", async () => {
    const { deps, written } = makeDeps({
      getUserByUsername: vi.fn(async () => null),
    });
    await processPhoneCall(
      makeItem({
        body: {
          caller_name: "X",
          to_user: "nobody",
          message: "m",
          requested_at: new Date().toISOString(),
        },
      }),
      deps,
    );

    expect(written).toHaveLength(1);
    expect(written[0].body.outcome).toBe("unknown_user");
    expect(written[0].body.message).toContain("nobody");
    expect(deps.placeCallAndAwait).not.toHaveBeenCalled();
  });

  it("returns no_phone_on_file when target user has no phoneE164", async () => {
    const { deps, written } = makeDeps({
      getUserByUsername: vi.fn(async () => ({ id: "user-1", phoneE164: null })),
    });
    await processPhoneCall(makeItem(), deps);

    expect(written).toHaveLength(1);
    expect(written[0].body.outcome).toBe("no_phone_on_file");
    expect(deps.placeCallAndAwait).not.toHaveBeenCalled();
  });
});

describe("processPhoneCall — adapter outcome passthrough", () => {
  const outcomes = [
    { adapter: "placement_error" as const, expectTranscript: false },
    { adapter: "busy" as const, expectTranscript: false },
    { adapter: "no_answer" as const, expectTranscript: false },
    { adapter: "no_response" as const, expectTranscript: true },
    { adapter: "canceled" as const, expectTranscript: false },
    { adapter: "queue_error" as const, expectTranscript: false },
    { adapter: "timeout" as const, expectTranscript: false },
    { adapter: "unknown" as const, expectTranscript: false },
  ];

  for (const { adapter } of outcomes) {
    it(`passes adapter outcome '${adapter}' through verbatim`, async () => {
      const { deps, written } = makeDeps({
        placeCallAndAwait: vi.fn(async () => ({
          outcome: adapter,
          message: `${adapter} details`,
        })) as unknown as WorkerDeps["placeCallAndAwait"],
      });
      await processPhoneCall(makeItem(), deps);
      expect(written).toHaveLength(1);
      expect(written[0].body.outcome).toBe(adapter);
      expect(written[0].body.message).toBe(`${adapter} details`);
    });
  }
});
