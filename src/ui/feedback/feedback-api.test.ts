/**
 * Phase 121 Plan 02 Task 2 — feedback-api tests.
 *
 * Verifies postFeedback() wraps authApi.post("/feedback", payload) and
 * honors D-27: user-facing behavior is unchanged regardless of send outcome
 * — postFeedback resolves normally and NEVER rethrows so the caller (Plan 04
 * dev-trigger + future modal) can await it safely then always fire the
 * "Thanks — feedback sent" toast.
 *
 * Payload contract per D-24:
 *   { kind: "general" | "thumbs_up" | "thumbs_down",
 *     userNote: string,
 *     messageRef?: string,
 *     exchangeText?: string }
 *
 * D-26 lock: exchangeText travels on the wire whenever the caller supplies
 * it; content-inclusion gating is server-side in Plan 03, not client-side.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock only the surface we use; the axios interceptor plumbing in main-axios
// is not exercised here.
vi.mock("@/main-axios", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    authApi: {
      post: vi.fn(),
    },
    handleApiError: vi.fn((_error: unknown, _op: string) => {
      // Real handleApiError has return type `never` — throws an ApiError.
      // The mock preserves that throwing contract so postFeedback's outer
      // swallow can be verified.
      throw new Error("mocked handleApiError rethrow");
    }),
  };
});

import { authApi, handleApiError } from "@/main-axios";
import { postFeedback, type FeedbackPayload } from "./feedback-api";

type PostFn = { post: ReturnType<typeof vi.fn> };
const mockedPost = (authApi as unknown as PostFn).post;
const mockedHandle = handleApiError as unknown as ReturnType<typeof vi.fn>;

describe("feedback-api (Phase 121 Plan 02 Task 2)", () => {
  beforeEach(() => {
    mockedPost.mockReset();
    mockedHandle.mockReset();
    mockedHandle.mockImplementation(() => {
      throw new Error("mocked handleApiError rethrow");
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("postFeedback POSTs to /feedback with the full D-24 payload", async () => {
    mockedPost.mockResolvedValueOnce({ status: 202, data: undefined });

    const payload: FeedbackPayload = {
      kind: "general",
      userNote: "the migration binary doesn't exist",
    };

    await postFeedback(payload);

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockedPost.mock.calls[0] as [string, FeedbackPayload];
    expect(url).toBe("/feedback");
    expect(body).toEqual(payload);
  });

  it("postFeedback carries messageRef + exchangeText on the wire (D-24/D-26 client-forwards-content)", async () => {
    mockedPost.mockResolvedValueOnce({ status: 202, data: undefined });

    const payload: FeedbackPayload = {
      kind: "thumbs_down",
      userNote: "wrong answer",
      messageRef: "conv-123::msg-456",
      exchangeText:
        "User asked:\n> How do I run the migration?\n\nAssistant replied:\n> Sure — you can run the migration...",
    };

    await postFeedback(payload);

    expect(mockedPost).toHaveBeenCalledTimes(1);
    const [, body] = mockedPost.mock.calls[0] as [string, FeedbackPayload];
    expect(body).toEqual(payload);
    // Explicit assertion: exchangeText MUST be present on the wire (D-26).
    // Server-side (Plan 03) decides whether to include it in the email body.
    expect((body as FeedbackPayload).exchangeText).toBeDefined();
    expect((body as FeedbackPayload).messageRef).toBeDefined();
  });

  it("thumbs_up payload works (kind discriminated union)", async () => {
    mockedPost.mockResolvedValueOnce({ status: 202, data: undefined });

    const payload: FeedbackPayload = {
      kind: "thumbs_up",
      userNote: "",
      messageRef: "conv-1::msg-7",
      exchangeText: "some markdown",
    };

    await expect(postFeedback(payload)).resolves.toBeUndefined();
    expect(mockedPost).toHaveBeenCalledWith("/feedback", payload);
  });

  it("D-27: postFeedback does NOT rethrow when authApi.post rejects", async () => {
    mockedPost.mockRejectedValueOnce(new Error("network down"));

    // Caller awaits and expects clean resolution — the toast always fires
    // downstream regardless of send outcome.
    await expect(
      postFeedback({ kind: "general", userNote: "hi" }),
    ).resolves.toBeUndefined();

    expect(mockedHandle).toHaveBeenCalledTimes(1);
    expect(mockedHandle).toHaveBeenCalledWith(
      expect.any(Error),
      "submit feedback",
    );
  });

  it("D-27: postFeedback does NOT rethrow even when handleApiError itself throws (ApiError propagates from real impl)", async () => {
    mockedPost.mockRejectedValueOnce(new Error("500 server error"));
    // Confirm the mock's throwing behavior is still in place.
    expect(() => mockedHandle(new Error("x"), "op")).toThrow();
    // Reset call count after the sanity check.
    mockedHandle.mockClear();
    mockedPost.mockRejectedValueOnce(new Error("500 server error"));

    // postFeedback must still resolve cleanly for D-27 to hold in the wild
    // where handleApiError has `never` return type.
    await expect(
      postFeedback({
        kind: "thumbs_down",
        userNote: "",
        messageRef: "m",
        exchangeText: "e",
      }),
    ).resolves.toBeUndefined();
  });
});
