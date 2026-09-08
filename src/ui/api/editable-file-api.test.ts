/**
 * Phase 40 Plan 40-02 Task 1 — editable-file-api tests.
 *
 * Contract under test:
 *   fetchTailnetUrl(url: string): Promise<TailnetFetchResult>
 *   - Thin axios wrapper around POST /pretty-view/fetch-tailnet-url
 *   - Uses `authApi.post` from `@/main-axios` (JWT auto-attached by interceptor)
 *   - On error, calls `handleApiError(error, "fetch tailnet URL")` which throws
 *     an ApiError; the helper rethrows to satisfy the return type.
 *
 * Mocking strategy: mock `@/main-axios` at module scope so we can drive
 * `authApi.post` per test via `mockResolvedValue` / `mockRejectedValue`.
 * `handleApiError` remains the real implementation — asserting that its
 * error-reshape flow fires end-to-end (as opposed to a shallow stub) gives
 * us confidence that consumers of `fetchTailnetUrl` see the same error taxonomy
 * every other fleet API helper produces.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Module mocks (hoisted — must precede any import of the mocked module) ──

vi.mock("@/main-axios", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    authApi: {
      post: vi.fn(),
    },
  };
});

// ── Late imports (after mocks are registered) ──────────────────────────────

import {
  fetchTailnetUrl,
  fetchHostFileUrl,
  type TailnetFetchResult,
} from "./editable-file-api";
import { authApi } from "@/main-axios";

// ── Shared fixture ─────────────────────────────────────────────────────────

// Realistic response body from the backend proxy (Plan 40-01 Task 2 step 9).
// contentBase64 is base64("hello") — canonical 5-byte text sample.
const FIXTURE_RESULT: TailnetFetchResult = {
  contentBase64: "aGVsbG8=",
  sizeBytes: 5,
  contentType: "text/plain",
  extension: "md",
  filename: "notes.md",
  isTextByExt: true,
  // isTextByBytes intentionally omitted — backend only sets it on ext-miss
};

const SAMPLE_URL = "http://100.64.0.1:8000/notes.md";

describe("fetchTailnetUrl — POST /pretty-view/fetch-tailnet-url wrapper", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 1 (happy path): resolves to the exact TailnetFetchResult shape returned by the backend", async () => {
    (authApi.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: FIXTURE_RESULT,
    });

    const result = await fetchTailnetUrl(SAMPLE_URL);

    expect(result).toEqual(FIXTURE_RESULT);
    expect(authApi.post).toHaveBeenCalledTimes(1);
    expect(authApi.post).toHaveBeenCalledWith(
      "/pretty-view/fetch-tailnet-url",
      { url: SAMPLE_URL },
    );
  });

  it("Test 2 (502 upstream): rejects when the backend returns 502", async () => {
    (authApi.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 502,
        data: { error: "upstream 503" },
      },
      config: { url: "/pretty-view/fetch-tailnet-url", method: "post" },
      message: "Request failed with status code 502",
    });

    await expect(fetchTailnetUrl(SAMPLE_URL)).rejects.toBeTruthy();
  });

  it("Test 3 (504 timeout): rejects when the backend times out fetching upstream", async () => {
    (authApi.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 504,
        data: { error: "fetch timeout" },
      },
      config: { url: "/pretty-view/fetch-tailnet-url", method: "post" },
      message: "Request failed with status code 504",
    });

    await expect(fetchTailnetUrl(SAMPLE_URL)).rejects.toBeTruthy();
  });

  it("Test 4 (413 oversized): rejects when the upstream file exceeds the size cap", async () => {
    (authApi.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 413,
        data: { error: "file exceeds max size" },
      },
      config: { url: "/pretty-view/fetch-tailnet-url", method: "post" },
      message: "Request failed with status code 413",
    });

    await expect(fetchTailnetUrl(SAMPLE_URL)).rejects.toBeTruthy();
  });

  it("Test 5 (400 invalid URL): rejects when the URL fails backend SSRF validation", async () => {
    (authApi.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 400,
        data: { error: "invalid tailnet URL" },
      },
      config: { url: "/pretty-view/fetch-tailnet-url", method: "post" },
      message: "Request failed with status code 400",
    });

    await expect(
      fetchTailnetUrl("http://192.168.1.1:8000/x.md"),
    ).rejects.toBeTruthy();
  });
});

/* ─────────────────────────────────────────────────────────────────────────
 * Phase 75 Plan 75-02 Task 2 — fetchHostFileUrl helper tests (5 tests).
 *
 * Contract under test:
 *   fetchHostFileUrl(url: string): Promise<TailnetFetchResult>
 *     - Parses url with /^https:\/\/[^/]+\/file\/([a-zA-Z0-9._-]+)\/(.*)$/
 *     - On no match, throws Error("invalid file URL") synchronously (no
 *       network call attempted)
 *     - Extracts hostname = match[1], absolutePath = "/" + match[2] (D-01
 *       re-add-leading-slash rule)
 *     - POSTs {hostname, absolutePath} to /pretty-view/fetch-host-file via
 *       authApi.post
 *     - On axios error, extracts the backend {error: <class>} string from
 *       response.data.error and throws Error(class) so the modal can render
 *       human-readable copy per class (D-02, Rule 2 deviation — see
 *       75-02-SUMMARY for justification; the plain handleApiError path
 *       would collapse 404/5xx classes into generic ApiError.code strings,
 *       destroying the taxonomy the modal needs to distinguish unknown_host
 *       vs not_found vs host_unreachable vs ssh_timeout)
 *     - Returns response.data as TailnetFetchResult on 200
 * ───────────────────────────────────────────────────────────────────────── */

describe("fetchHostFileUrl — POST /pretty-view/fetch-host-file wrapper (Phase 75 D-01)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("Test 1 (URL parsing): parses hostname + absolutePath and POSTs to /pretty-view/fetch-host-file", async () => {
    (authApi.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        contentBase64: "aGVsbG8=",
        sizeBytes: 5,
        contentType: null,
        extension: "md",
        filename: "note.md",
        isTextByExt: true,
      },
    });

    await fetchHostFileUrl(
      "https://term.gigaashley.click/file/thenasty/home/ubuntu/note.md",
    );

    expect(authApi.post).toHaveBeenCalledTimes(1);
    expect(authApi.post).toHaveBeenCalledWith(
      "/pretty-view/fetch-host-file",
      { hostname: "thenasty", absolutePath: "/home/ubuntu/note.md" },
    );
  });

  it("Test 2 (URL with port on Skynet domain): parses hostname + absolutePath ignoring the Skynet-side port", async () => {
    (authApi.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        contentBase64: "ZmxlZXQ=",
        sizeBytes: 5,
        contentType: null,
        extension: null,
        filename: "hostname",
        isTextByExt: false,
        isTextByBytes: true,
      },
    });

    await fetchHostFileUrl(
      "https://term.gigaashley.click:8080/file/thenasty/etc/hostname",
    );

    expect(authApi.post).toHaveBeenCalledWith(
      "/pretty-view/fetch-host-file",
      { hostname: "thenasty", absolutePath: "/etc/hostname" },
    );
  });

  it("Test 3 (unparseable URL): throws Error(\"invalid file URL\") synchronously without any network call", async () => {
    await expect(fetchHostFileUrl("garbage")).rejects.toThrow(
      "invalid file URL",
    );
    expect(authApi.post).not.toHaveBeenCalled();
  });

  it("Test 4 (axios error carrying backend error class): throws with the classified error string as .message", async () => {
    (authApi.post as ReturnType<typeof vi.fn>).mockRejectedValueOnce({
      isAxiosError: true,
      response: {
        status: 404,
        data: { error: "not_found" },
      },
      config: { url: "/pretty-view/fetch-host-file", method: "post" },
      message: "Request failed with status code 404",
    });

    // The rejection carries the classified error class as .message so the
    // modal can render distinct copy per class (D-02 human-readable-copy
    // contract; the plan-mandated behavior in Test 13-16 of the modal
    // suite requires this).
    await expect(
      fetchHostFileUrl(
        "https://term.gigaashley.click/file/thenasty/nope.md",
      ),
    ).rejects.toThrow("not_found");
  });

  it("Test 5 (happy path): returns the exact TailnetFetchResult envelope from response.data", async () => {
    const fixture: TailnetFetchResult = {
      contentBase64: "aGVsbG8gd29ybGQ=",
      sizeBytes: 11,
      contentType: null,
      extension: "md",
      filename: "greeting.md",
      isTextByExt: true,
      isTextByBytes: undefined,
    };
    (authApi.post as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: fixture,
    });

    const result = await fetchHostFileUrl(
      "https://term.gigaashley.click/file/thenasty/tmp/greeting.md",
    );

    expect(result).toEqual(fixture);
  });
});
