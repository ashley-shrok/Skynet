/**
 * Phase 122 Plan 122-03 Task 1 — API-client smoke tests.
 *
 * Small — mocks `@/main-axios` (authApi.post + handleApiError) and asserts:
 *   T-A  happy path: authApi.post is called with the right body, response.data
 *        is returned
 *   T-B  backend-error-class path: axios error with { error: "query_too_long" }
 *        is re-thrown as Error whose .message === "query_too_long" and
 *        .name === "ConversationSearchError"
 *   T-C  non-classed axios error / network error: falls through to
 *        handleApiError with the operation label "search conversations"
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import axios, { AxiosError } from "axios";

const postMock = vi.fn();
const handleApiErrorMock = vi.fn((_err: unknown, _ctx: string) => {
  throw new Error("handled_by_handleApiError");
});

vi.mock("@/main-axios", () => ({
  authApi: {
    post: (url: string, body: unknown) => postMock(url, body),
  },
  handleApiError: (err: unknown, ctx: string) => handleApiErrorMock(err, ctx),
}));

// Import AFTER the mock is registered
import {
  searchConversations,
  type ConversationSearchResponse,
} from "./conversation-search-api";

beforeEach(() => {
  postMock.mockReset();
  handleApiErrorMock.mockClear();
  handleApiErrorMock.mockImplementation((_err: unknown, _ctx: string) => {
    throw new Error("handled_by_handleApiError");
  });
});

describe("conversation-search-api: searchConversations", () => {
  it("T-A: calls authApi.post(\"/conversation-search\", { query, offset, limit }) and returns response.data", async () => {
    const payload: ConversationSearchResponse = {
      results: [
        {
          transcriptPath: "/x/y.jsonl",
          transcriptMtime: 1_700_000_000_000,
          identityKey: "alice",
          hostId: 1,
          hostName: "host-a",
          aiTitle: null,
          snippet: "hello",
          hitStart: 0,
          hitLength: 5,
          isArchived: false,
          tmuxSessionName: "alice",
        },
      ],
      hasMore: false,
    };
    postMock.mockResolvedValueOnce({ data: payload });

    const out = await searchConversations("hello", 0, 20);

    expect(postMock).toHaveBeenCalledTimes(1);
    expect(postMock).toHaveBeenCalledWith("/conversation-search", {
      query: "hello",
      offset: 0,
      limit: 20,
    });
    expect(out).toBe(payload);
  });

  it("T-B: re-throws a rich Error when backend returns { error: \"query_too_long\" }", async () => {
    // Fabricate a shape that axios.isAxiosError recognizes
    const err = new AxiosError(
      "Request failed with status code 400",
      "ERR_BAD_REQUEST",
    );
    err.response = {
      data: { error: "query_too_long" },
      status: 400,
      statusText: "Bad Request",
      headers: {},
      config: {} as never,
    };
    // Confirm the axios helper agrees
    expect(axios.isAxiosError(err)).toBe(true);

    postMock.mockRejectedValueOnce(err);

    let caught: unknown = null;
    try {
      await searchConversations("foo", 0, 20);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe("query_too_long");
    expect((caught as Error).name).toBe("ConversationSearchError");
    // handleApiError NOT invoked when the rich error path fires
    expect(handleApiErrorMock).not.toHaveBeenCalled();
  });

  it("T-C: falls through to handleApiError on non-classed axios/network errors", async () => {
    const err = new AxiosError("Network Error", "ERR_NETWORK");
    // no .response.data.error — the fall-through path
    err.response = undefined;
    expect(axios.isAxiosError(err)).toBe(true);

    postMock.mockRejectedValueOnce(err);

    let caught: unknown = null;
    try {
      await searchConversations("foo", 0, 20);
    } catch (e) {
      caught = e;
    }
    expect(handleApiErrorMock).toHaveBeenCalledTimes(1);
    expect(handleApiErrorMock).toHaveBeenCalledWith(err, "search conversations");
    // handleApiErrorMock (mocked above) throws its own sentinel; the fact
    // that we caught it proves the fall-through fired.
    expect((caught as Error).message).toBe("handled_by_handleApiError");
  });
});
