/**
 * TaskPill — the agent memory pie (shape-memory-pie-in-pill).
 *
 * The pie sits inside the pill just before the ⋯, on every agent that isn't
 * archived. Tapping it opens its pop-over (never the agent window). Condense
 * asks first, then posts the request with no guidance; the pie reads
 * Compacting… until the fleet-status poll says it's done (or a 2-minute
 * upper bound passes with no word). A failed request says why in a toast.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import type { Identity } from "@/api/identities-api";
import {
  autoAnswerKitDialogs,
  __resetKitDialogsForTests,
  type KitConfirmOptions,
} from "@/components/kit";

const FIXTURE: Identity = {
  identityKey: "willow",
  hostId: 1,
  displayName: "Willow",
  title: null,
  colorHue: 200,
  voice: null,
  role: "skynet-maintainer",
  roles: ["skynet-maintainer"],
  avatarMime: "image/png",
  avatarUrl: "/identities/willow/avatar?hostId=1",
  avatarEtag: "etag-1",
  coordinator: false,
  task: "build the pool endpoint",
  project: null,
};

vi.mock("@/state/identities-store", () => ({
  useIdentities: vi.fn(() => ({
    identities: [FIXTURE],
    byKey: new Map([[FIXTURE.identityKey, FIXTURE]]),
    byHostKey: new Map([[`1::${FIXTURE.identityKey}`, FIXTURE]]),
    loaded: true,
    refresh: vi.fn(),
  })),
}));

vi.mock("@/state/trapped-work-store", () => ({
  useTrappedWork: vi.fn(() => undefined),
}));

vi.mock("@/state/conversation-store", () => ({
  useProjects: vi.fn(() => []),
}));

vi.mock("@/main-axios", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return { ...orig, authApi: { post: vi.fn(), get: vi.fn() } };
});

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

import { TaskPill } from "./TaskPill";
import { __resetCompactRequestsForTests } from "@/state/compact-request-store";
import { authApi } from "@/main-axios";
import { toast } from "sonner";
import {
  __setSessionContextPctForTests,
  __resetSessionContextPctForTests,
} from "@/api/fleet-status-client";
import {
  publishFleetStatusSessionState,
  __resetForTest as resetWorkingStore,
} from "@/state/session-working-store";

const postMock = authApi.post as unknown as ReturnType<typeof vi.fn>;
const toastError = toast.error as unknown as ReturnType<typeof vi.fn>;

function renderPill(overrides: Partial<React.ComponentProps<typeof TaskPill>> = {}) {
  const onOpen = vi.fn();
  const utils = render(
    <TaskPill
      identityKey="willow"
      hostId={1}
      tmuxSession="willow"
      tabId="tab-1"
      dragDescriptor={{ tabType: "terminal", sessionKind: "harness", targetTmuxSession: "willow" }}
      menuItems={[{ label: "Archive", danger: true, onClick: vi.fn() }]}
      onOpen={onOpen}
      {...overrides}
    />,
  );
  return { ...utils, onOpen };
}

const gauge = () => screen.getByTestId("memory-gauge");

async function pressCondense() {
  fireEvent.click(gauge());
  const btn = await screen.findByRole("button", { name: "Compact conversation" });
  act(() => {
    fireEvent.click(btn);
  });
}

function condensingState(condensing: boolean) {
  return {
    hostId: "1",
    tmuxSession: "willow",
    sessionId: "test-session",
    pid: 12345,
    status: "idle" as const,
    backgroundTasks: [] as never[],
    updatedAt: Date.now(),
    lastMessageAt: null,
    aiTitle: null,
    dormant: false,
    condensing,
  };
}

describe("TaskPill — agent memory pie", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetSessionContextPctForTests();
    postMock.mockResolvedValue({ status: 200, data: { ok: true } });
  });
  afterEach(() => {
    __resetCompactRequestsForTests();
    __resetKitDialogsForTests();
    act(() => {
      resetWorkingStore();
    });
    __resetSessionContextPctForTests();
    vi.useRealTimers();
  });

  it.each([
    [375, true],
    [1200, false],
  ])("in a pane %ipx wide, condensing is the pulsing pie alone: %s", (width, compact) => {
    const pane = document.createElement("div");
    Object.defineProperty(pane, "clientWidth", { value: width });
    document.body.appendChild(pane);
    act(() => {
      publishFleetStatusSessionState("1", condensingState(true));
    });
    render(
      <TaskPill
        identityKey="willow"
        hostId={1}
        tmuxSession="willow"
        menuItems={[]}
        onOpen={vi.fn()}
      />,
      { container: pane },
    );
    expect(gauge().getAttribute("data-condensing")).toBe("true");
    expect(gauge().getAttribute("data-compact")).toBe(compact ? "true" : null);
    expect(gauge().textContent?.includes("Compacting…")).toBe(!compact);
    expect(gauge().getAttribute("aria-label")).toBe("Agent memory: compacting");
    pane.remove();
  });

  it("sits inside the pill, just before the ⋯", () => {
    renderPill();
    const pill = screen.getByTestId("pv-task-pill");
    const slot = screen.getByTestId("pv-task-pill-memory");
    expect(pill.contains(slot)).toBe(true);
    expect(slot.contains(gauge())).toBe(true);
    const kebab = screen.getByTestId("pv-task-pill-kebab-trigger");
    expect(slot.compareDocumentPosition(kebab) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("is absent on an archived agent", () => {
    renderPill({ identity: FIXTURE });
    expect(screen.getByTestId("pv-task-pill")).toBeTruthy();
    expect(screen.queryByTestId("memory-gauge")).toBeNull();
  });

  it("shows the fleet-status reading — 61% is amber with its number", () => {
    __setSessionContextPctForTests("1", "willow", 61);
    renderPill();
    expect(gauge().getAttribute("data-pct")).toBe("61");
    expect(gauge().getAttribute("data-band")).toBe("amber");
    expect(gauge().textContent).toContain("61%");
  });

  it("a tap opens the pop-over and never the agent window", async () => {
    const { onOpen } = renderPill();
    fireEvent.click(gauge());
    expect(await screen.findByTestId("memory-pop")).toBeTruthy();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("Condense asks first, without any typed-text line; a dismissed confirm requests nothing", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    const { onOpen } = renderPill();
    await pressCondense();
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    const opts = dialogs.calls[0].opts as KitConfirmOptions;
    expect(String(opts.title)).toBe("Compact this conversation?");
    expect(String(opts.body)).not.toContain("typed");
    await new Promise((r) => setTimeout(r, 0));
    expect(postMock).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("accepted: posts the request with no guidance, and the pie reads Compacting…", async () => {
    autoAnswerKitDialogs({ confirm: true });
    const { onOpen } = renderPill();
    expect(gauge().getAttribute("data-condensing")).toBeNull();
    await pressCondense();
    await waitFor(() => expect(postMock).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith("/identities/willow/condense", { hostId: 1 });
    await waitFor(() => expect(gauge().getAttribute("data-condensing")).toBe("true"));
    expect(gauge().textContent).toContain("Compacting…");
    expect(onOpen).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("a failed request says why in a toast and the pie doesn't claim a condense", async () => {
    autoAnswerKitDialogs({ confirm: true });
    postMock.mockRejectedValue(new Error("Network Error"));
    renderPill();
    await pressCondense();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Not connected — try again in a moment"));
    expect(gauge().getAttribute("data-condensing")).toBeNull();
  });

  it("a server error is named as one, not 'Not connected'", async () => {
    autoAnswerKitDialogs({ confirm: true });
    postMock.mockRejectedValue(Object.assign(new Error("500"), { response: { status: 500 } }));
    renderPill();
    await pressCondense();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Couldn't compact — something went wrong on the server"),
    );
  });

  it("an unreachable machine is named", async () => {
    autoAnswerKitDialogs({ confirm: true });
    postMock.mockRejectedValue(Object.assign(new Error("504"), { response: { status: 504 } }));
    renderPill({ hostName: "workstation" });
    await pressCondense();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Couldn't reach workstation — try again in a moment"));
  });

  it("an answer without ok is a failure too", async () => {
    autoAnswerKitDialogs({ confirm: true });
    postMock.mockResolvedValue({ status: 200, data: {} });
    renderPill();
    await pressCondense();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(gauge().getAttribute("data-condensing")).toBeNull();
  });

  it("the backend's condensing axis takes over, and clears it when done", async () => {
    autoAnswerKitDialogs({ confirm: true });
    renderPill();
    await pressCondense();
    await waitFor(() => expect(gauge().getAttribute("data-condensing")).toBe("true"));
    await act(async () => {
      publishFleetStatusSessionState("1", condensingState(true));
    });
    expect(gauge().getAttribute("data-condensing")).toBe("true");
    await act(async () => {
      publishFleetStatusSessionState("1", condensingState(false));
    });
    await waitFor(() => expect(gauge().getAttribute("data-condensing")).toBeNull());
  });

  it("with no word from the backend, Compacting… clears itself after 2 minutes", async () => {
    vi.useFakeTimers();
    autoAnswerKitDialogs({ confirm: true });
    renderPill();
    fireEvent.click(gauge());
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Compact conversation" }));
    });
    await act(async () => {
      for (let k = 0; k < 5; k++) await Promise.resolve();
    });
    expect(gauge().getAttribute("data-condensing")).toBe("true");
    act(() => {
      vi.advanceTimersByTime(2 * 60 * 1000 - 1000);
    });
    expect(gauge().getAttribute("data-condensing")).toBe("true");
    act(() => {
      vi.advanceTimersByTime(1001);
    });
    expect(gauge().getAttribute("data-condensing")).toBeNull();
  });
});
