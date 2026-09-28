/**
 * Phase 137 Plan 04 Task 1 — useEditableFileEligibility: Map<string, "file" | "interactive-message"> tests.
 *
 * Contract under test (Phase 137 additions on top of Phase 40/75):
 *   useEditableFileEligibility(messageEventId, messageBody): Map<string, "file" | "interactive-message">
 *   - Returns Map (not Set) — values are "file" or "interactive-message"
 *   - Widget URLs (/interactive/) classify synchronously by shape — NO backend fetch
 *   - File URLs still classify via existing sync/async paths (values "file")
 *   - Identity stability preserved: equivalent Maps return same reference
 *
 * Tests 1-10 cover the Phase 137 additions.
 *
 * Mocking strategy:
 *   - vi.mock("@/api/editable-file-api", ...) with fetchTailnetUrl + fetchHostFileUrl as vi.fn()
 *   - Real react + real @testing-library/react (renderHook + waitFor)
 *
 * Test env: vitest + jsdom
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

// ── Module mocks (hoisted — must precede any import of the mocked module) ──

vi.mock("@/api/editable-file-api", () => ({
  fetchTailnetUrl: vi.fn(),
  fetchHostFileUrl: vi.fn(),
}));

// ── Late imports (after mocks are registered) ──────────────────────────────

import { useEditableFileEligibility } from "./use-editable-file-eligibility";
import {
  fetchTailnetUrl,
  fetchHostFileUrl,
} from "@/api/editable-file-api";
import { INTERACTIVE_MSG_URL_RE_CLIENT } from "./editable-file-whitelist";

// ── Shared helpers ─────────────────────────────────────────────────────────

const mockFetch = fetchTailnetUrl as ReturnType<typeof vi.fn>;
const mockFetchHostFile = fetchHostFileUrl as ReturnType<typeof vi.fn>;

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

const WIDGET_URL = "https://term.example.com/interactive/3/poll-abc/pane/";
const FILE_URL = "https://term.example.com/file/thenasty/home/ubuntu/note.md";
const TAILNET_URL = "http://100.64.0.1:8000/notes.md";

// ── Test suite (Phase 137 additions) ──────────────────────────────────────

describe("useEditableFileEligibility — Phase 137 Map return type + widget classification", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetchHostFile.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("Test 1 (regex: INTERACTIVE_MSG_URL_RE_CLIENT.test on fresh non-global regex): widget URL matches", () => {
    // The exported regex has /g flag — we test using a fresh non-global form
    // (the plan spec says: use .match(), not .test() on the /g regex).
    // Here we verify the regex pattern itself is correct by using String.match.
    const body = WIDGET_URL;
    const matches = body.match(INTERACTIVE_MSG_URL_RE_CLIENT);
    expect(matches).not.toBeNull();
    expect(matches![0]).toBe(WIDGET_URL);
  });

  it("Test 2 (regex multi-match): /g regex extracts widget URL from a mixed body via .match()", () => {
    const body = `Check ${FILE_URL} and also ${WIDGET_URL} for the poll.`;
    const matches = body.match(INTERACTIVE_MSG_URL_RE_CLIENT) ?? [];
    // Should match the widget URL (INTERACTIVE_MSG_URL_RE_CLIENT only matches /interactive/ paths)
    expect(matches).toContain(WIDGET_URL);
  });

  it("Test 3 (return type is Map): hook returns a Map<string, 'file' | 'interactive-message'>", async () => {
    const { result } = renderHook(() =>
      useEditableFileEligibility("e1", "plain prose no URLs"),
    );

    // The return value must be a Map instance
    expect(result.current).toBeInstanceOf(Map);
  });

  it("Test 4 (widget URL only — sync, no fetch): returns Map with one entry 'interactive-message'; fetchTailnetUrl and fetchHostFileUrl NOT called", async () => {
    const body = `Click here: ${WIDGET_URL}`;

    const { result } = renderHook(() =>
      useEditableFileEligibility("e4", body),
    );

    await waitFor(() => {
      expect(result.current.get(WIDGET_URL)).toBe("interactive-message");
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockFetchHostFile).not.toHaveBeenCalled();
  });

  it("Test 5 (file URL sync path — extension hit): Map has one entry with value 'file'; NO fetch fires", async () => {
    const body = `See ${FILE_URL}`;

    const { result } = renderHook(() =>
      useEditableFileEligibility("e5", body),
    );

    await waitFor(() => {
      expect(result.current.get(FILE_URL)).toBe("file");
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockFetchHostFile).not.toHaveBeenCalled();
  });

  it("Test 6 (file URL async path — extension miss, fetch resolves textish): Map gains 'file' entry", async () => {
    const extensionlessFileUrl = "https://term.example.com/file/thenasty/home/ubuntu/myscript";
    mockFetchHostFile.mockResolvedValue({
      ...BASE_RESPONSE,
      filename: "myscript",
      isTextByExt: false,
      isTextByBytes: true,
    });

    const body = extensionlessFileUrl;

    const { result } = renderHook(() =>
      useEditableFileEligibility("e6", body),
    );

    await waitFor(() => {
      expect(result.current.get(extensionlessFileUrl)).toBe("file");
    });

    expect(mockFetchHostFile).toHaveBeenCalledWith(extensionlessFileUrl);
  });

  it("Test 7 (mixed widget + file URL): Map has TWO entries — widget URL 'interactive-message' + file URL 'file'", async () => {
    const body = `Here is the file: ${FILE_URL} and the widget: ${WIDGET_URL}`;

    const { result } = renderHook(() =>
      useEditableFileEligibility("e7", body),
    );

    await waitFor(() => {
      expect(result.current.get(WIDGET_URL)).toBe("interactive-message");
      expect(result.current.get(FILE_URL)).toBe("file");
    });

    // Widget URL must NOT trigger any fetch
    expect(mockFetch).not.toHaveBeenCalledWith(WIDGET_URL);
    expect(mockFetchHostFile).not.toHaveBeenCalledWith(WIDGET_URL);
  });

  it("Test 8 (widget URL NOT included in fetch calls): widget URL skips the async fetch loop entirely", async () => {
    const body = WIDGET_URL;

    renderHook(() => useEditableFileEligibility("e8", body));

    // Allow effects to settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    // Neither fetch helper should be called for a widget URL
    const allFetchCalls = [
      ...mockFetch.mock.calls.flat(),
      ...mockFetchHostFile.mock.calls.flat(),
    ];
    expect(allFetchCalls).not.toContain(WIDGET_URL);
  });

  it("Test 9 (dedup — same widget URL twice in body): single Map entry", async () => {
    const body = `First: ${WIDGET_URL} Second: ${WIDGET_URL}`;

    const { result } = renderHook(() =>
      useEditableFileEligibility("e9", body),
    );

    await waitFor(() => {
      expect(result.current.get(WIDGET_URL)).toBe("interactive-message");
    });

    // Only one entry for the widget URL (dedup by Set-of-URLs before classification)
    let widgetCount = 0;
    for (const [, v] of result.current) {
      if (v === "interactive-message") widgetCount++;
    }
    expect(widgetCount).toBe(1);
    expect(result.current.size).toBe(1);
  });

  it("Test 10 (identity stability): two renders with same widget URL return SAME Map reference", async () => {
    const body = WIDGET_URL;

    const { result, rerender } = renderHook(
      ({ b }: { b: string }) => useEditableFileEligibility("e10", b),
      { initialProps: { b: body } },
    );

    await waitFor(() => {
      expect(result.current.get(WIDGET_URL)).toBe("interactive-message");
    });

    const firstMap = result.current;

    // Rerender with identical body — should not produce a new Map reference
    rerender({ b: body });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });

    // Identity stable: same Map reference
    expect(result.current).toBe(firstMap);
  });
});
