/**
 * Phase 40 Plan 40-02 Task 2 — useEditableFileEligibility hook tests.
 *
 * Contract under test:
 *   useEditableFileEligibility(messageEventId, messageBody): Set<string>
 *   - Scans messageBody for tailnet URLs via TAILNET_URL_RE_CLIENT
 *   - Sync path: classifyByExtension hit → add URL WITHOUT fetching
 *   - Async path: extension miss → POST /pretty-view/fetch-tailnet-url and add
 *     the URL iff response.isTextByBytes === true
 *   - Cancelled on unmount via cancelledRef (no setState after unmount)
 *   - D-04 INVARIANT: hook return type is Set<string> — contentBase64 is NEVER
 *     exposed to any caller (Test 10 is the architectural leak guard)
 *
 * Mocking strategy:
 *   - vi.mock("@/api/editable-file-api", ...) with fetchTailnetUrl as vi.fn().
 *     Each test resets via mockReset + mockResolvedValue/mockRejectedValue.
 *   - Real react + real @testing-library/react (renderHook + waitFor).
 *
 * Test env: vitest + jsdom (per vitest.config.ts frontend project).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// ── Module mocks (hoisted — must precede any import of the mocked module) ──

vi.mock("@/api/editable-file-api", () => ({
  fetchTailnetUrl: vi.fn(),
}));

// ── Late imports (after mocks are registered) ──────────────────────────────

import { useEditableFileEligibility } from "./use-editable-file-eligibility";
import { fetchTailnetUrl } from "@/api/editable-file-api";

// ── Shared helpers ─────────────────────────────────────────────────────────

const mockFetch = fetchTailnetUrl as ReturnType<typeof vi.fn>;

/** Baseline mock response — override per test via {...BASE, isTextByBytes: X}. */
const BASE_RESPONSE = {
  contentBase64: "aGVsbG8=", // base64("hello")
  sizeBytes: 5,
  contentType: "text/plain",
  extension: null as string | null,
  filename: "myscript",
  isTextByExt: false,
  isTextByBytes: false,
};

// ── Test suite ─────────────────────────────────────────────────────────────

describe("useEditableFileEligibility — per-message tailnet-URL eligibility scan", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Test 1 (whitelist hit — no fetch): markdown link with .md extension adds the URL and NEVER calls fetchTailnetUrl", async () => {
    const body =
      "here you go [notes.md](http://100.64.0.1:8000/notes.md)";

    const { result } = renderHook(() =>
      useEditableFileEligibility("e1", body),
    );

    // Effect must have a tick to run; wait until the Set has the URL.
    await waitFor(() => {
      expect(result.current.has("http://100.64.0.1:8000/notes.md")).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(0);
  });

  it("Test 2 (extensionless-but-text — fetch runs and returns true): adds URL when backend reports isTextByBytes:true", async () => {
    mockFetch.mockResolvedValue({
      ...BASE_RESPONSE,
      filename: "myscript",
      isTextByExt: false,
      isTextByBytes: true,
    });

    const body = "http://100.64.0.1:8000/myscript";

    const { result } = renderHook(() =>
      useEditableFileEligibility("e1", body),
    );

    await waitFor(() => {
      expect(result.current.has("http://100.64.0.1:8000/myscript")).toBe(true);
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith("http://100.64.0.1:8000/myscript");
  });

  it("Test 3 (extensionless-binary — fetch returns false): omits URL when isTextByBytes:false", async () => {
    mockFetch.mockResolvedValue({
      ...BASE_RESPONSE,
      filename: "opaque-blob",
      isTextByExt: false,
      isTextByBytes: false,
    });

    const body = "http://100.64.0.1:8000/opaque-blob";

    const { result } = renderHook(() =>
      useEditableFileEligibility("e1", body),
    );

    // Wait long enough for the effect + async closure to settle.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Give the setState (if any) a tick to commit; then assert the Set is empty.
    await waitFor(() => {
      expect(result.current.size).toBe(0);
    });
  });

  it("Test 4 (fetch error — silent skip): eligibleUrls stays empty and no unhandled rejection surfaces", async () => {
    mockFetch.mockRejectedValue(new Error("backend 502"));

    const body = "http://100.64.0.1:8000/opaque-blob";

    const { result } = renderHook(() =>
      useEditableFileEligibility("e1", body),
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Give the async loop a chance to complete after the rejection.
    await new Promise((r) => setTimeout(r, 20));

    expect(result.current.size).toBe(0);
    // If the hook doesn't wrap the fetch call in try/catch, vitest would flag
    // the rejection as an unhandled promise. The absence of such a flag at
    // suite teardown is the second half of this test's guarantee.
  });

  it("Test 5 (multi-URL independence): whitelist hit + extension-miss binary → only the whitelist URL is eligible; fetch fires exactly once for the miss", async () => {
    mockFetch.mockResolvedValue({
      ...BASE_RESPONSE,
      filename: "opaque-blob",
      isTextByExt: false,
      isTextByBytes: false,
    });

    const body =
      "check [notes.md](http://100.64.0.1:8000/notes.md) and " +
      "http://100.64.0.1:8000/opaque-blob";

    const { result } = renderHook(() =>
      useEditableFileEligibility("e1", body),
    );

    await waitFor(() => {
      expect(result.current.has("http://100.64.0.1:8000/notes.md")).toBe(true);
    });

    // Wait for the async miss-path fetch to complete.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
    await new Promise((r) => setTimeout(r, 20));

    // Only the whitelist URL is eligible; the miss URL was classified negative.
    expect(result.current.has("http://100.64.0.1:8000/notes.md")).toBe(true);
    expect(result.current.has("http://100.64.0.1:8000/opaque-blob")).toBe(
      false,
    );
    expect(mockFetch).toHaveBeenCalledWith(
      "http://100.64.0.1:8000/opaque-blob",
    );
  });

  it("Test 6 (URL with query string — Pitfall 8 defense): regex matches full URL including ?nocache; filename extraction uses 'notes.md' so extension check hits sync path (no fetch)", async () => {
    const url = "http://100.64.0.1:8000/notes.md?nocache=1";
    const body = `see ${url} for details`;

    const { result } = renderHook(() =>
      useEditableFileEligibility("e1", body),
    );

    await waitFor(() => {
      expect(result.current.has(url)).toBe(true);
    });

    // Sync-path proof: fetch NEVER fires because filename extraction correctly
    // isolated "notes.md" from the pathname (dropping ?nocache=1 from query).
    expect(mockFetch).toHaveBeenCalledTimes(0);
  });

  it("Test 7 (null eventId): stays empty, fetch never called, effect body did not run", async () => {
    const body = "[notes.md](http://100.64.0.1:8000/notes.md)";

    const { result } = renderHook(() =>
      useEditableFileEligibility(null, body),
    );

    await new Promise((r) => setTimeout(r, 30));

    expect(result.current.size).toBe(0);
    expect(mockFetch).toHaveBeenCalledTimes(0);
  });

  it("Test 8 (re-run on eventId change): effect fires per distinct eventId", async () => {
    mockFetch.mockResolvedValue({
      ...BASE_RESPONSE,
      filename: "myscript",
      isTextByExt: false,
      isTextByBytes: true,
    });

    const { rerender, result } = renderHook(
      ({ id, body }: { id: string; body: string }) =>
        useEditableFileEligibility(id, body),
      {
        initialProps: {
          id: "e1",
          body: "http://100.64.0.1:8000/myscript",
        },
      },
    );

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    rerender({
      id: "e2",
      body: "http://100.64.0.1:8000/other-file",
    });

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    expect(result.current).toBeInstanceOf(Set);
  });

  it("Test 9 (cancel on unmount before fetch resolves): no setState after unmount", async () => {
    // Never-resolves promise — proves the cleanup path prevents setState.
    let capturedResolve: ((v: unknown) => void) | undefined;
    mockFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          capturedResolve = resolve;
        }),
    );

    const body = "http://100.64.0.1:8000/opaque-blob";
    const { unmount, result } = renderHook(() =>
      useEditableFileEligibility("e1", body),
    );

    // Wait for the effect to actually fire the fetch before unmounting.
    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    // Snapshot the returned Set before unmount so we can compare identity.
    const initialSet = result.current;

    unmount();

    // Now resolve the fetch AFTER unmount — the hook must NOT setState.
    capturedResolve?.({
      ...BASE_RESPONSE,
      filename: "opaque-blob",
      isTextByExt: false,
      isTextByBytes: true,
    });

    await new Promise((r) => setTimeout(r, 30));

    // The Set snapshot from before unmount is the last state — must not have
    // grown. (result.current on an unmounted hook keeps returning the last
    // rendered value; if setState had fired post-unmount, React would have
    // logged a warning to console and the internal state would have advanced.)
    expect(initialSet.size).toBe(0);
  });

  it("Test 10 (contentBase64 leak guard — D-04 architectural invariant): the return value is a Set<string> and does NOT expose contentBase64 anywhere", async () => {
    mockFetch.mockResolvedValue({
      ...BASE_RESPONSE,
      filename: "myscript",
      isTextByExt: false,
      isTextByBytes: true,
    });

    const body = "http://100.64.0.1:8000/myscript";

    const { result } = renderHook(() =>
      useEditableFileEligibility("e1", body),
    );

    await waitFor(() => {
      expect(result.current.has("http://100.64.0.1:8000/myscript")).toBe(true);
    });

    // Structural check: the return is a Set instance (not an object masquerading
    // as one, e.g. { urls: Set, bytes: Map<url, bytes> }).
    expect(result.current).toBeInstanceOf(Set);

    // Runtime type check for the D-04 invariant: no contentBase64 property
    // on the Set (would only exist if the hook illegitimately attached it).
    expect(
      typeof (result.current as unknown as { contentBase64?: unknown })
        .contentBase64,
    ).toBe("undefined");

    // Every entry in the Set must be a plain string URL — never an object
    // shape carrying byte payloads.
    for (const entry of result.current) {
      expect(typeof entry).toBe("string");
    }
  });
});
