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
  messageWasDeliveredHeuristic,
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
    const result = await placeCallAndAwait("+15551234567", "task", "first", "msg", {
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
      json: async () => ({ status: "completed", answered_by: "human", transcripts: [{ user: "assistant", text: "hi msg" }, { user: "user", text: "yes" }], concatenated_transcript: "assistant: hi msg\nuser: yes", call_length: 0.5 }),
    });

    const startTime = 0;
    let clock = startTime;
    await placeCallAndAwait("+15551234567", "TASK-PROMPT", "FIRST-SENTENCE", "msg", {
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
    const result = await placeCallAndAwait("+bad", "t", "f", "msg", {
      now: () => 0,
      sleep: () => Promise.resolve(),
      fetchFn,
    });
    expect(result.outcome).toBe("placement_error");
    expect(result.message).toBe("bad phone number");
  });

  it("returns placement_error when the placement call throws", async () => {
    const fetchFn = vi.fn().mockRejectedValueOnce(new Error("network down")) as unknown as typeof fetch;
    const result = await placeCallAndAwait("+15551234567", "t", "f", "msg", {
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
          concatenated_transcript: "assistant: hello with a message for you: standup at nine\nuser: ok, thanks",
          call_length: 0.35, // minutes
        }),
      }) as unknown as typeof fetch;

    let clock = 0;
    const result = await placeCallAndAwait("+15551234567", "t", "f", "standup at nine", {
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
      },
      fetchFn,
    });

    expect(result.outcome).toBe("completed");
    expect(result.transcript).toContain("user: ok, thanks");
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
    const result = await placeCallAndAwait("+15551234567", "t", "f", "msg", {
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
          concatenated_transcript: "assistant: hi go home now\nuser: bye",
          call_length: 0.1,
        }),
      }) as unknown as typeof fetch;

    let clock = 0;
    const result = await placeCallAndAwait("+15551234567", "t", "f", "go home now", {
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
});

describe("messageWasDeliveredHeuristic", () => {
  it("returns true when the message appears verbatim in an assistant turn", () => {
    expect(
      messageWasDeliveredHeuristic(
        {
          transcripts: [
            { user: "assistant", text: "Hi, this is Clipper, with a message for you: standup at nine tomorrow" },
            { user: "user", text: "got it" },
          ],
        },
        "standup at nine tomorrow",
      ),
    ).toBe(true);
  });

  it("returns true across punctuation/case differences (fuzzy match)", () => {
    expect(
      messageWasDeliveredHeuristic(
        {
          transcripts: [
            // ASR-flattened — Bland often strips punctuation from the transcript
            { user: "assistant", text: "hi this is clipper with a message for you hey ashley this is a test" },
          ],
        },
        "Hey Ashley, this is a test",
      ),
    ).toBe(true);
  });

  it("returns false when the message is not in the assistant turns", () => {
    expect(
      messageWasDeliveredHeuristic(
        {
          transcripts: [
            // Opener cut off mid-word: "with a message f-"
            { user: "assistant", text: "Hi, this is Clipper, with a message f" },
            { user: "user", text: "hello? who is this" },
          ],
        },
        "standup at nine tomorrow",
      ),
    ).toBe(false);
  });

  it("returns false when there are no assistant turns at all", () => {
    expect(
      messageWasDeliveredHeuristic(
        { transcripts: [{ user: "user", text: "hello?" }] },
        "standup at nine",
      ),
    ).toBe(false);
  });

  it("returns true for an empty message (nothing to verify)", () => {
    expect(messageWasDeliveredHeuristic({ transcripts: [] }, "")).toBe(true);
    expect(messageWasDeliveredHeuristic({ transcripts: [] }, "   ")).toBe(true);
  });

  it("concatenates multiple assistant turns before matching", () => {
    // Message spans across the opener turn and the receipt-phrase turn —
    // unlikely in practice but shouldn't cause a false negative.
    expect(
      messageWasDeliveredHeuristic(
        {
          transcripts: [
            { user: "assistant", text: "hi this is clipper with a message for you standup at" },
            { user: "user", text: "hmm" },
            { user: "assistant", text: "nine tomorrow. your reply's going back to clipper" },
          ],
        },
        "standup at nine tomorrow",
      ),
    ).toBe(true);
  });
});

describe("placeCallAndAwait — interrupted_before_message heuristic downgrade", () => {
  beforeEach(() => {
    process.env.BLAND_API_KEY = "test-key";
  });

  it("downgrades completed → interrupted_before_message when opener was cut off", async () => {
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
            // Opener cut off before payload
            { user: "assistant", text: "Hi, this is Clipper, with a message f" },
            { user: "user", text: "hello? who is this" },
          ],
          concatenated_transcript: "assistant: Hi, this is Clipper, with a message f\nuser: hello? who is this",
          call_length: 0.1,
        }),
      }) as unknown as typeof fetch;

    let clock = 0;
    const result = await placeCallAndAwait(
      "+15551234567",
      "t",
      "f",
      "Hey Ashley, this is a test call",
      {
        now: () => clock,
        sleep: async (ms) => { clock += ms; },
        fetchFn,
      },
    );

    expect(result.outcome).toBe("interrupted_before_message");
    // Transcript still populated so the caller can see what DID get spoken.
    expect(result.transcript).toContain("with a message f");
    // Human-readable amplifier explaining the outcome.
    expect(result.message).toContain("interrupted");
    // Call actually happened, so call_length_seconds is populated.
    expect(result.call_length_seconds).toBe(6);
  });

  it("downgrades no_response → interrupted_before_message when message never spoken", async () => {
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
          // Assistant spoke but message not present; no user turns.
          transcripts: [
            { user: "assistant", text: "Hi, this is Clipper, with a message f" },
          ],
          concatenated_transcript: "assistant: Hi, this is Clipper, with a message f",
          call_length: 0.05,
        }),
      }) as unknown as typeof fetch;

    let clock = 0;
    const result = await placeCallAndAwait(
      "+15551234567",
      "t",
      "f",
      "Hey Ashley, this is a test call",
      {
        now: () => clock,
        sleep: async (ms) => { clock += ms; },
        fetchFn,
      },
    );

    expect(result.outcome).toBe("interrupted_before_message");
  });

  it("does NOT downgrade completed when the message is present in the transcript", async () => {
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
            { user: "assistant", text: "hi this is clipper with a message for you hey ashley this is a test call" },
            { user: "user", text: "ok noted" },
          ],
          concatenated_transcript: "assistant: hi this is clipper with a message for you hey ashley this is a test call\nuser: ok noted",
          call_length: 0.2,
        }),
      }) as unknown as typeof fetch;

    let clock = 0;
    const result = await placeCallAndAwait(
      "+15551234567",
      "t",
      "f",
      "Hey Ashley, this is a test call",
      {
        now: () => clock,
        sleep: async (ms) => { clock += ms; },
        fetchFn,
      },
    );

    expect(result.outcome).toBe("completed");
    expect(result.transcript).toContain("ok noted");
  });

  it("does NOT downgrade non-completed outcomes (busy, no_answer, timeout, etc.)", async () => {
    const fetchFn = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ call_id: "abc-123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ status: "busy", call_length: 0 }),
      }) as unknown as typeof fetch;

    let clock = 0;
    const result = await placeCallAndAwait(
      "+15551234567",
      "t",
      "f",
      "any message",
      {
        now: () => clock,
        sleep: async (ms) => { clock += ms; },
        fetchFn,
      },
    );

    expect(result.outcome).toBe("busy");
  });
});
