/**
 * Phase 40 Plan 40-04 Task 2 — PrettyView wiring tests for the editable-file
 * modal + save-deposit callback.
 *
 * Scope: strictly the wiring seam this plan introduces —
 *   - onOpenEditor callback (from the affordance in ChatMessage) opens the
 *     EditableFileModal.
 *   - Closing the modal clears the open state.
 *   - Save flow deposits a File into uploads.stageAttachments("primary", ...)
 *     — LOCKED D-06 (save → fresh attachment in the composebox strip).
 *   - agentIdentityName passthrough sources from pvIdentity?.displayName.
 *   - Multiple opens for different URLs replace the modal state cleanly.
 *
 * Mock strategy mirrors PrettyView.aside.test.tsx / PrettyView.compose-send.test.tsx:
 *   - claude-session WS stub keyed to a per-test getCurrentWs().
 *   - session-hue mock — controllable identity for the passthrough test.
 *   - IdentityBadge + useIsTouchDevice — minimal stubs.
 *   - use-editable-file-eligibility — controllable Set per test so the ChatMessage
 *     affordance renders for the URL we exercise.
 *   - editable-file-api — controllable fetchTailnetUrl for the modal fetch-at-open
 *     path (Plan 40-03 EditableFileModal wiring).
 *   - use-pretty-view-uploads — spy on stageAttachments to verify the save-deposit
 *     path without exercising the full upload orchestrator.
 *   - sonner — no-op toast so save-flow doesn't error out on missing sonner root.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, fireEvent, waitFor, screen } from "@testing-library/react";
import { useEditableFileEligibility } from "./use-editable-file-eligibility";
import { fetchTailnetUrl } from "@/api/editable-file-api";

type WsStub = {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
const wsStubs: WsStub[] = [];
function getCurrentWs(): WsStub {
  return wsStubs[wsStubs.length - 1];
}

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
    const ws: WsStub = {
      readyState: 1,
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onopen: null,
      onerror: null,
      onclose: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    wsStubs.push(ws);
    return ws;
  }),
}));

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

const useSessionIdentityMock = vi.fn(() => ({
  identity: null as unknown,
  identityHue: null as number | null,
}));
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: vi.fn(() => null),
  useSessionIdentity: (name: string | null | undefined) =>
    useSessionIdentityMock(name as unknown as never),
}));

vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: () => null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

vi.mock("./use-editable-file-eligibility", () => ({
  useEditableFileEligibility: vi.fn(() => new Set()),
}));

vi.mock("@/api/editable-file-api", () => ({
  fetchTailnetUrl: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// Spy on stageAttachments while preserving the rest of the hook. We only need
// to observe calls; the batch/pump machinery is not exercised here.
const stageAttachmentsSpy = vi.fn();
vi.mock("./use-pretty-view-uploads", async () => {
  const actual =
    await vi.importActual<typeof import("./use-pretty-view-uploads")>(
      "./use-pretty-view-uploads",
    );
  return {
    ...actual,
    usePrettyViewUploads: (
      deps: Parameters<typeof actual.usePrettyViewUploads>[0],
    ) => {
      const real = actual.usePrettyViewUploads(deps);
      return {
        ...real,
        stageAttachments: (target: string, items: unknown) => {
          stageAttachmentsSpy(target, items);
          // Do NOT forward to the real orchestrator — the pump would try to
          // send WS frames and clutter these tests. Wiring is what we're
          // asserting; the real hook is exercised by its own tests.
        },
      };
    },
  };
});

import { PrettyView } from "./PrettyView";

const mockedHook = vi.mocked(useEditableFileEligibility);
const mockedFetch = vi.mocked(fetchTailnetUrl);

const URL_A = "http://100.64.0.1:8000/notes.md";
const URL_B = "http://100.64.0.1:8000/report.md";

function flipToStreaming(ws: WsStub) {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
      }),
    );
  });
}

function fireAssistantMessage(ws: WsStub, eventId: string, content: string) {
  act(() => {
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({
          type: "message",
          role: "assistant",
          eventId,
          content,
          ts: Date.now(),
        }),
      }),
    );
  });
}

describe("PrettyView — editable-file modal wiring (Plan 40-04)", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    stageAttachmentsSpy.mockClear();
    useSessionIdentityMock.mockReturnValue({
      identity: null,
      identityHue: null,
    });
    mockedHook.mockReturnValue(new Set());
    mockedFetch.mockReset();
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("Test 1: affordance click opens the EditableFileModal", async () => {
    mockedHook.mockReturnValue(new Set([URL_A]));
    // Fetch resolves so the modal's fetch-at-open effect settles cleanly.
    mockedFetch.mockResolvedValue({
      filename: "notes.md",
      contentBase64: btoa("hello"),
      isTextByBytes: true,
    });

    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );
    flipToStreaming(getCurrentWs());
    fireAssistantMessage(getCurrentWs(), "e1", `see [notes.md](${URL_A})`);

    // Find the affordance button (rendered inside the ChatMessage `<a>`
    // override).
    const button = await waitFor(() =>
      screen.getByRole("button", { name: /edit notes\.md/i }),
    );

    fireEvent.click(button);

    // Modal opens — the sr-only DialogTitle text "Edit notes.md" appears in
    // document.body (portal target).
    await waitFor(() => {
      expect(
        document.body.querySelector('[role="dialog"]'),
      ).not.toBeNull();
    });
  });

  it("Test 2: close button clears the modal open state", async () => {
    mockedHook.mockReturnValue(new Set([URL_A]));
    mockedFetch.mockResolvedValue({
      filename: "notes.md",
      contentBase64: btoa("hello"),
      isTextByBytes: true,
    });

    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );
    flipToStreaming(getCurrentWs());
    fireAssistantMessage(getCurrentWs(), "e2", `see [notes.md](${URL_A})`);

    const button = await waitFor(() =>
      screen.getByRole("button", { name: /edit notes\.md/i }),
    );
    fireEvent.click(button);

    await waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    });

    // Click the modal's Close (aria-label="Close" X button).
    const closeButton = document.body.querySelector(
      'button[aria-label="Close"]',
    ) as HTMLButtonElement | null;
    expect(closeButton).not.toBeNull();
    fireEvent.click(closeButton!);

    await waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });
  });

  it("Test 3: save deposits a File into uploads.stageAttachments('primary', ...)", async () => {
    mockedHook.mockReturnValue(new Set([URL_A]));
    mockedFetch.mockResolvedValue({
      filename: "notes.md",
      contentBase64: btoa("original"),
      isTextByBytes: true,
    });

    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );
    flipToStreaming(getCurrentWs());
    fireAssistantMessage(getCurrentWs(), "e3", `see [notes.md](${URL_A})`);

    fireEvent.click(
      await waitFor(() =>
        screen.getByRole("button", { name: /edit notes\.md/i }),
      ),
    );

    // Wait for the textarea to appear (fetch resolved → ready branch).
    const textarea = await waitFor(() =>
      document.body.querySelector("textarea"),
    );
    expect(textarea).not.toBeNull();

    // Type new content.
    fireEvent.change(textarea as HTMLTextAreaElement, {
      target: { value: "edited content" },
    });

    // Click Save.
    const saveButton = await waitFor(() =>
      screen.getByRole("button", { name: /^save$/i }),
    );
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(stageAttachmentsSpy).toHaveBeenCalledTimes(1);
    });
    const [target, files] = stageAttachmentsSpy.mock.calls[0];
    expect(target).toBe("primary");
    expect(Array.isArray(files)).toBe(true);
    expect(files).toHaveLength(1);
    const file = files[0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("notes.md");
    expect(await file.text()).toBe("edited content");
    // md → text/markdown per guessMimeFromFilename helper.
    expect(file.type).toBe("text/markdown");
  });

  it("Test 4: agentIdentityName passthrough — sub-header renders when pvIdentity has displayName", async () => {
    useSessionIdentityMock.mockReturnValue({
      identity: {
        key: "tanya",
        displayName: "tanya",
        colorHue: 200,
      } as unknown,
      identityHue: 200,
    });
    mockedHook.mockReturnValue(new Set([URL_A]));
    mockedFetch.mockResolvedValue({
      filename: "notes.md",
      contentBase64: btoa("x"),
      isTextByBytes: true,
    });

    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );
    flipToStreaming(getCurrentWs());
    fireAssistantMessage(getCurrentWs(), "e4", `see [notes.md](${URL_A})`);

    fireEvent.click(
      await waitFor(() =>
        screen.getByRole("button", { name: /edit notes\.md/i }),
      ),
    );

    // Sub-header "from tanya" should appear in the modal header (portal to
    // document.body).
    await waitFor(() => {
      expect(document.body.textContent).toContain("from tanya");
    });
  });

  it("Test 5: multiple opens — second open uses the new URL, not stale state", async () => {
    mockedHook.mockReturnValue(new Set([URL_A, URL_B]));
    // Sequence of fetch responses per URL.
    mockedFetch.mockImplementation(async (u: string) => ({
      filename: u.endsWith("notes.md") ? "notes.md" : "report.md",
      contentBase64: btoa(u.endsWith("notes.md") ? "A" : "B"),
      isTextByBytes: true,
    }));

    render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
      />,
    );
    flipToStreaming(getCurrentWs());
    fireAssistantMessage(
      getCurrentWs(),
      "e5",
      `one [notes.md](${URL_A}) two [report.md](${URL_B})`,
    );

    // Open A.
    fireEvent.click(
      await waitFor(() =>
        screen.getByRole("button", { name: /edit notes\.md/i }),
      ),
    );
    await waitFor(() => {
      expect(document.body.textContent).toContain("Edit notes.md");
    });

    // Close A via X.
    const closeButton = document.body.querySelector(
      'button[aria-label="Close"]',
    ) as HTMLButtonElement;
    fireEvent.click(closeButton);
    await waitFor(() => {
      expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    });

    // Open B.
    fireEvent.click(
      await waitFor(() =>
        screen.getByRole("button", { name: /edit report\.md/i }),
      ),
    );

    await waitFor(() => {
      expect(document.body.textContent).toContain("Edit report.md");
    });
    // The stale A title should NOT be present anywhere in the open modal.
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Edit report.md");
    expect(dialog?.textContent).not.toContain("Edit notes.md");
  });
});
