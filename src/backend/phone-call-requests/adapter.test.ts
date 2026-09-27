/**
 * phone-call-requests/adapter.test.ts
 *
 * Tests for the Bland adapter. Focus areas:
 *   - classifyBlandDetails mapping table (every enum branch)
 *   - placeCallAndAwait — placement failures, poll loop, deadline, secret redaction
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  classifyBlandDetails,
  placeCallAndAwait,
  BLAND_POLL_DEADLINE_MS,
  BLAND_POLL_INTERVAL_MS,
  BLAND_INTERRUPTIBILITY,
} from "./adapter.js";

// Silence the module logger — the adapter warns on every failure branch.
vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("classifyBlandDetails", () => {
  it("maps status:busy → busy", () => {
    expect(classifyBlandDetails({ status: "busy" })).toBe("busy");
  });

  it("maps status:canceled → canceled", () => {
    expect(classifyBlandDetails({ status: "canceled" })).toBe("canceled");
  });

  it("maps status:failed → queue_error", () => {
    expect(classifyBlandDetails({ status: "failed" })).toBe("queue_error");
  });

  it("maps status:no-answer → no_answer", () => {
    expect(classifyBlandDetails({ status: "no-answer" })).toBe("no_answer");
  });

  it("maps status:completed + voicemail pickup → no_answer", () => {
    expect(
      classifyBlandDetails({ status: "completed", answered_by: "voicemail" }),
    ).toBe("no_answer");
  });

  it("maps status:completed + no-answer pickup → no_answer", () => {
    expect(
      classifyBlandDetails({ status: "completed", answered_by: "no-answer" }),
    ).toBe("no_answer");
  });

  it("maps status:completed + human + empty transcript → no_response", () => {
    expect(
      classifyBlandDetails({
        status: "completed",
        answered_by: "human",
        transcripts: [{ user: "assistant", text: "Hi" }],
      }),
    ).toBe("no_response");
  });

  it("maps status:completed + human + user turn present → completed", () => {
    expect(
      classifyBlandDetails({
        status: "completed",
        answered_by: "human",
        transcripts: [
          { user: "assistant", text: "Hi" },
          { user: "user", text: "Hello back" },
        ],
      }),
    ).toBe("completed");
  });

  it("matches the user-role label case-insensitively (defensive against Bland schema drift)", () => {
    // If Bland ever emits capitalized role labels, we should still count
    // the user turn — otherwise every completed human-answered call would
    // silently misclassify to no_response.
    expect(
      classifyBlandDetails({
        status: "completed",
        answered_by: "human",
        transcripts: [
          { user: "Assistant", text: "Hi" },
          { user: "User", text: "Hello back" },
        ],
      }),
    ).toBe("completed");
    expect(
      classifyBlandDetails({
        status: "completed",
        answered_by: "human",
        transcripts: [{ user: "USER", text: "yes" }],
      }),
    ).toBe("completed");
  });

  it("maps queue_status:pre_queue_error → queue_error", () => {
    expect(classifyBlandDetails({ queue_status: "pre_queue_error" })).toBe(
      "queue_error",
    );
  });

  it("maps queue_status:queue_error → queue_error", () => {
    expect(classifyBlandDetails({ queue_status: "queue_error" })).toBe(
      "queue_error",
    );
  });

  it("maps status:unknown → unknown", () => {
    expect(classifyBlandDetails({ status: "unknown" })).toBe("unknown");
  });

  it("returns null (keep polling) for in-flight statuses", () => {
    expect(classifyBlandDetails({ status: "queued" })).toBeNull();
    expect(classifyBlandDetails({ status: "started" })).toBeNull();
    expect(classifyBlandDetails({})).toBeNull();
  });
});

describe("placeCallAndAwait — placement failures", () => {
  let originalKey: string | undefined;

  beforeEach(() => {
    originalKey = process.env.BLAND_API_KEY;
    process.env.BLAND_API_KEY = "test-key";
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.BLAND_API_KEY;
    else process.env.BLAND_API_KEY = originalKey;
  });

  it("returns placement_error immediately when BLAND_API_KEY is missing", async () => {
    delete process.env.BLAND_API_KEY;
    const result = await placeCallAndAwait("+15551234567", "task", "first", {
      now: () => 0,
      sleep: () => Promise.resolve(),
      fetchFn: vi.fn() as unknown as typeof fetch,
    });
    expect(result.outcome).toBe("placement_error");
    expect(result.message).toContain("BLAND_API_KEY not configured");
  });

  it("uses raw Authorization header (no Bearer prefix)", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ call_id: "abc" }),
    }) as unknown as typeof fetch;

    // Immediately resolve with a terminal state on the very first poll.
    (fetchFn as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ status: "completed", answered_by: "human", transcripts: [{ user: "assistant", text: "hi msg" }, { user: "user", text: "yes" }], concatenated_transcript: "assistant: hi msg \n user: yes", call_length: 0.5 }),
    });

    const startTime = 0;
    let clock = startTime;
    await placeCallAndAwait("+15551234567", "TASK-PROMPT", "FIRST-SENTENCE", {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetchFn,
    });

    // Placement call — inspect headers
    const placementCall = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(placementCall[0]).toContain("/v1/calls");
    const placementInit = placementCall[1] as { headers: Record<string, string>; body: string };
    expect(placementInit.headers.Authorization).toBe("test-key");
    expect(placementInit.headers.Authorization).not.toContain("Bearer");
    // Body carries the task + first_sentence + phone + record:false + interruptibility
    const body = JSON.parse(placementInit.body);
    expect(body.task).toBe("TASK-PROMPT");
    expect(body.first_sentence).toBe("FIRST-SENTENCE");
    expect(body.phone_number).toBe("+15551234567");
    expect(body.record).toBe(false);
    expect(body.interruptibility).toBe(BLAND_INTERRUPTIBILITY);
    expect(body.interruptibility).toBe(0);
  });

  it("returns placement_error when the POST returns no call_id", async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({ error_message: "bad phone number" }),
    }) as unknown as typeof fetch;
    const result = await placeCallAndAwait("+bad", "t", "f", {
      now: () => 0,
      sleep: () => Promise.resolve(),
      fetchFn,
    });
    expect(result.outcome).toBe("placement_error");
    expect(result.message).toBe("bad phone number");
  });

  it("returns placement_error when the placement call throws", async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("network down")) as unknown as typeof fetch;
    const result = await placeCallAndAwait("+15551234567", "t", "f", {
      now: () => 0,
      sleep: () => Promise.resolve(),
      fetchFn,
    });
    expect(result.outcome).toBe("placement_error");
    expect(result.message).toBe("network down");
  });
});

describe("placeCallAndAwait — poll loop", () => {
  beforeEach(() => {
    process.env.BLAND_API_KEY = "test-key";
  });

  it("returns completed with transcript when Bland reports success", async () => {
    const fetchFn = vi.fn()
      // Placement
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ call_id: "abc-123" }),
      })
      // First poll: still queued
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "queued" }),
      })
      // Second poll: completed with transcript
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "completed",
          answered_by: "human",
          transcripts: [
            { user: "assistant", text: "hello with a message for you: standup at nine" },
            { user: "user", text: "ok, thanks" },
          ],
          concatenated_transcript: "assistant: hello with a message for you: standup at nine \n user: ok, thanks",
          call_length: 0.35, // minutes
        }),
      }) as unknown as typeof fetch;

    let clock = 0;
    const result = await placeCallAndAwait("+15551234567", "t", "f", {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetchFn,
    });

    expect(result.outcome).toBe("completed");
    expect(result.transcript).toContain("user: ok, thanks");
    // `assistant:` gets relabeled to `voice:` on the way out (item-2 fix
    // for the caller-agent double-meaning); the raw Bland label MUST NOT
    // survive into the returned transcript.
    expect(result.transcript).toContain("voice: hello with a message for you");
    expect(result.transcript).not.toContain("assistant:");
    expect(result.call_length_seconds).toBe(21); // Math.round(0.35 * 60)
    // Second poll = 2 sleep intervals
    expect(clock).toBe(BLAND_POLL_INTERVAL_MS * 2);
  });

  it("returns timeout when deadline hits before a terminal state", async () => {
    // Placement OK, but every poll returns queued.
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ call_id: "abc-123" }),
      })
      .mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: "queued", call_length: 5 }), // 5 min
      }) as unknown as typeof fetch;

    let clock = 0;
    const result = await placeCallAndAwait("+15551234567", "t", "f", {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetchFn,
    });

    expect(result.outcome).toBe("timeout");
    expect(result.message).toContain(`${BLAND_POLL_DEADLINE_MS / 1000}s`);
    // Includes call_length from last observed poll
    expect(result.call_length_seconds).toBe(300);
    // Deadline actually passed
    expect(clock).toBeGreaterThanOrEqual(BLAND_POLL_DEADLINE_MS);
  });

  it("silently retries on transient poll errors", async () => {
    const fetchFn = vi.fn()
      // Placement
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ call_id: "abc-123" }),
      })
      // First poll: 500 (non-2xx) — continue
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: async () => ({}),
      })
      // Second poll: fetch throws — continue
      .mockRejectedValueOnce(new Error("temporary network glitch"))
      // Third poll: terminal completed
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "completed",
          answered_by: "human",
          transcripts: [
            { user: "assistant", text: "hi go home now" },
            { user: "user", text: "bye" },
          ],
          concatenated_transcript: "assistant: hi go home now \n user: bye",
          call_length: 0.1,
        }),
      }) as unknown as typeof fetch;

    let clock = 0;
    const result = await placeCallAndAwait("+15551234567", "t", "f", {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetchFn,
    });

    expect(result.outcome).toBe("completed");
    expect(result.transcript).toContain("bye");
    // 3 polls = 3 sleep intervals
    expect(clock).toBe(BLAND_POLL_INTERVAL_MS * 3);
  });

  it("relabels `Assistant:` case-insensitively so Bland schema-drift doesn't leak the raw role", async () => {
    // Bland's concatenated_transcript uses lowercase `assistant:` today,
    // but the /i regex flag guards against a version bump to `Assistant:`
    // or `ASSISTANT:`. Without /i the raw role label leaks through to the
    // calling agent — the whole point of the relabel is defeated.
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ call_id: "abc-123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          status: "completed",
          answered_by: "human",
          transcripts: [
            { user: "Assistant", text: "Hi there" },
            { user: "User", text: "hello back" },
          ],
          concatenated_transcript: "Assistant: Hi there \n User: hello back",
          call_length: 0.2,
        }),
      }) as unknown as typeof fetch;

    let clock = 0;
    const result = await placeCallAndAwait("+15551234567", "t", "f", {
      now: () => clock,
      sleep: async (ms) => { clock += ms; },
      fetchFn,
    });

    expect(result.outcome).toBe("completed");
    // `Assistant:` line-prefix (capitalized) got relabeled to `voice:`.
    expect(result.transcript).toContain("voice: Hi there");
    // No raw assistant-role label survives regardless of casing.
    expect(result.transcript).not.toMatch(/assistant:/i);
  });
});
