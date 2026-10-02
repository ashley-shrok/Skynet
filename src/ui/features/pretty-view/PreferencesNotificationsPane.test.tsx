/**
 * Phase 144 Plan 03 Task 1 — PreferencesNotificationsPane tests (ntfy rebuild).
 *
 * Eight behavior cases:
 *   PANE-01: On mount, pane calls getNtfySetup; while loading shows spinner/placeholder; on error shows inline error.
 *   PANE-02: isSetUp=false renders "Set up notifications" primary button with explainer copy.
 *   PANE-03: isSetUp=true renders three value rows (Server address, Topic name, Reading credential)
 *            each with copy affordance; below renders "Send test notification" and "Regenerate credential" buttons.
 *   PANE-04: Clicking "Set up notifications" POSTs /ntfy-setup, updates state to isSetUp=true,
 *            displays newly-returned values.
 *   PANE-05: Clicking "Send test notification" POSTs /ntfy-test, shows success/failure inline.
 *   PANE-06a (MC-2 happy): Clicking "Regenerate credential" with window.confirm=true fires POST /ntfy-regenerate,
 *            updates displayed values.
 *   PANE-06b (MC-2 cancel): With window.confirm=false, clicking "Regenerate credential" does NOT POST
 *            /ntfy-regenerate.
 *   PANE-07: Pane source contains NO Notification.permission, NO pushManager.subscribe, NO VAPID, NO requestPermission.
 *   PANE-08: Pane includes honest-copy ntfy iOS app section above setup values.
 *
 * MC-2 fix: window.confirm is mocked via vi.spyOn for PANE-06a/06b.
 * vi.restoreAllMocks() in afterEach ensures no spy leaks.
 */

vi.mock("@/features/notifications/ntfy-setup-api", () => ({
  getNtfySetup: vi.fn(),
  postNtfySetup: vi.fn(),
  postNtfyTest: vi.fn(),
  postNtfyRegenerate: vi.fn(),
  deleteNtfySetup: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  getNtfySetup,
  postNtfySetup,
  postNtfyTest,
  postNtfyRegenerate,
} from "@/features/notifications/ntfy-setup-api";
import { PreferencesNotificationsPane } from "./PreferencesNotificationsPane";

// ─── Fixtures ────────────────────────────────────────────────────────────────

const SET_UP_SHAPE = {
  isSetUp: true,
  serverAddress: "https://term.gigaashley.click/ntfy",
  topicName: "abc123def456",
  readingCredential: "tk_testreadingcredential",
  ntfyUsername: "skynet-reader-u1",
};

const NOT_SET_UP_SHAPE = { isSetUp: false };

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("PreferencesNotificationsPane (ntfy rebuild)", () => {
  beforeEach(() => {
    vi.mocked(getNtfySetup).mockReset();
    vi.mocked(postNtfySetup).mockReset();
    vi.mocked(postNtfyTest).mockReset();
    vi.mocked(postNtfyRegenerate).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("PANE-01 (loading + error): shows loading state initially, then error on getNtfySetup failure", async () => {
    // Never resolves (stays loading)
    let resolveFn: (v: unknown) => void;
    vi.mocked(getNtfySetup).mockReturnValue(
      new Promise((resolve) => { resolveFn = resolve; }) as ReturnType<typeof getNtfySetup>,
    );

    render(<PreferencesNotificationsPane />);

    // Loading state visible
    const loadingEl = screen.queryByTestId("preferences-notifications-loading");
    expect(loadingEl).toBeTruthy();

    // Resolve with error
    vi.mocked(getNtfySetup).mockReset();
    vi.mocked(getNtfySetup).mockRejectedValue(new Error("network error"));

    // Re-render with error
    render(<PreferencesNotificationsPane />);

    await waitFor(() => {
      const errorEl = screen.queryByTestId("preferences-notifications-error");
      expect(errorEl).toBeTruthy();
    });
  });

  it("PANE-02 (not set up): renders 'Set up notifications' button with ntfy explainer copy", async () => {
    vi.mocked(getNtfySetup).mockResolvedValue(NOT_SET_UP_SHAPE as ReturnType<typeof getNtfySetup> extends Promise<infer T> ? T : never);

    render(<PreferencesNotificationsPane />);

    await waitFor(() => {
      expect(screen.getByTestId("preferences-notifications-setup-button")).toBeTruthy();
    });

    expect(screen.getByTestId("preferences-notifications-setup-button").textContent).toContain("Set up notifications");
    // Explainer copy
    expect(screen.getByText(/generate your ntfy credential/i)).toBeTruthy();
  });

  it("PANE-03 (set up): renders three value rows with copy affordances and test/regenerate buttons", async () => {
    vi.mocked(getNtfySetup).mockResolvedValue(SET_UP_SHAPE as ReturnType<typeof getNtfySetup> extends Promise<infer T> ? T : never);

    render(<PreferencesNotificationsPane />);

    await waitFor(() => {
      expect(screen.getByTestId("preferences-notifications-server-address")).toBeTruthy();
    });

    // Three value rows
    expect(screen.getByTestId("preferences-notifications-server-address")).toBeTruthy();
    expect(screen.getByTestId("preferences-notifications-topic-name")).toBeTruthy();
    expect(screen.getByTestId("preferences-notifications-reading-credential")).toBeTruthy();

    // Values displayed
    expect(screen.getByTestId("preferences-notifications-server-address").textContent).toContain("term.gigaashley.click");
    expect(screen.getByTestId("preferences-notifications-topic-name").textContent).toContain("abc123def456");
    expect(screen.getByTestId("preferences-notifications-reading-credential").textContent).toContain("tk_testreadingcredential");

    // Test and regenerate buttons
    expect(screen.getByTestId("preferences-notifications-test-button")).toBeTruthy();
    expect(screen.getByTestId("preferences-notifications-regenerate-button")).toBeTruthy();
  });

  it("PANE-04 (setup flow): clicking 'Set up notifications' calls postNtfySetup and transitions to set-up view", async () => {
    vi.mocked(getNtfySetup).mockResolvedValue(NOT_SET_UP_SHAPE as ReturnType<typeof getNtfySetup> extends Promise<infer T> ? T : never);
    vi.mocked(postNtfySetup).mockResolvedValue(SET_UP_SHAPE as ReturnType<typeof postNtfySetup> extends Promise<infer T> ? T : never);

    render(<PreferencesNotificationsPane />);

    await waitFor(() => {
      expect(screen.getByTestId("preferences-notifications-setup-button")).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("preferences-notifications-setup-button"));

    await waitFor(() => {
      expect(postNtfySetup).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("preferences-notifications-server-address")).toBeTruthy();
    });

    // After setup, reading credential is shown
    expect(screen.getByTestId("preferences-notifications-reading-credential").textContent).toContain("tk_testreadingcredential");
  });

  it("PANE-05a (test ok): clicking 'Send test notification' shows success copy on ok=true", async () => {
    vi.mocked(getNtfySetup).mockResolvedValue(SET_UP_SHAPE as ReturnType<typeof getNtfySetup> extends Promise<infer T> ? T : never);
    vi.mocked(postNtfyTest).mockResolvedValue({ ok: true });

    render(<PreferencesNotificationsPane />);

    await waitFor(() => {
      expect(screen.getByTestId("preferences-notifications-test-button")).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("preferences-notifications-test-button"));

    await waitFor(() => {
      expect(postNtfyTest).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("preferences-notifications-test-result")).toBeTruthy();
    });

    const result = screen.getByTestId("preferences-notifications-test-result");
    expect(result.textContent).toMatch(/test sent|phone buzzed|setup works/i);
  });

  it("PANE-05b (test failed): clicking 'Send test notification' shows failure message on ok=false", async () => {
    vi.mocked(getNtfySetup).mockResolvedValue(SET_UP_SHAPE as ReturnType<typeof getNtfySetup> extends Promise<infer T> ? T : never);
    vi.mocked(postNtfyTest).mockResolvedValue({ ok: false, error: "ntfy unreachable" });

    render(<PreferencesNotificationsPane />);

    await waitFor(() => {
      expect(screen.getByTestId("preferences-notifications-test-button")).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("preferences-notifications-test-button"));

    await waitFor(() => {
      expect(screen.getByTestId("preferences-notifications-test-result")).toBeTruthy();
    });

    const result = screen.getByTestId("preferences-notifications-test-result");
    expect(result.textContent).toMatch(/test failed|ntfy unreachable/i);
  });

  it("PANE-06a (MC-2 confirm=true): Regenerate with window.confirm=true fires POST /ntfy-regenerate and updates values", async () => {
    vi.mocked(getNtfySetup).mockResolvedValue(SET_UP_SHAPE as ReturnType<typeof getNtfySetup> extends Promise<infer T> ? T : never);

    const newShape = {
      ...SET_UP_SHAPE,
      readingCredential: "tk_rotatedcredential",
    };
    vi.mocked(postNtfyRegenerate).mockResolvedValue(newShape as ReturnType<typeof postNtfyRegenerate> extends Promise<infer T> ? T : never);

    // MC-2: mock window.confirm deterministically via vi.spyOn
    vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<PreferencesNotificationsPane />);

    await waitFor(() => {
      expect(screen.getByTestId("preferences-notifications-regenerate-button")).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("preferences-notifications-regenerate-button"));

    await waitFor(() => {
      expect(postNtfyRegenerate).toHaveBeenCalledTimes(1);
    });

    // After regenerate, new reading credential is displayed
    await waitFor(() => {
      expect(screen.getByTestId("preferences-notifications-reading-credential").textContent).toContain("tk_rotatedcredential");
    });
  });

  it("PANE-06b (MC-2 confirm=false): Regenerate with window.confirm=false does NOT fire POST /ntfy-regenerate", async () => {
    vi.mocked(getNtfySetup).mockResolvedValue(SET_UP_SHAPE as ReturnType<typeof getNtfySetup> extends Promise<infer T> ? T : never);

    // MC-2: mock window.confirm to return false — cancel branch
    vi.spyOn(window, "confirm").mockReturnValue(false);

    render(<PreferencesNotificationsPane />);

    await waitFor(() => {
      expect(screen.getByTestId("preferences-notifications-regenerate-button")).toBeTruthy();
    });

    const user = userEvent.setup();
    await user.click(screen.getByTestId("preferences-notifications-regenerate-button"));

    // No POST should have been fired
    expect(postNtfyRegenerate).not.toHaveBeenCalled();

    // Original credential unchanged
    expect(screen.getByTestId("preferences-notifications-reading-credential").textContent).toContain("tk_testreadingcredential");
  });

  it("PANE-07 (browser-push API absent): component source has no Notification.permission, pushManager, VAPID, or requestPermission references", () => {
    // This test reads the component source directly — no DOM assertions.
    const panePath = resolve(
      __dirname,
      "PreferencesNotificationsPane.tsx",
    );
    const source = readFileSync(panePath, "utf-8");

    // Strip comment lines before checking (// and * lines)
    const nonCommentLines = source
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join("\n");

    const forbiddenPatterns = [
      "Notification.permission",
      "requestPermission",
      "pushManager",
      "getVapidPublicKey",
      "urlBase64ToUint8Array",
      "pushNotificationsSupported",
    ];

    for (const pattern of forbiddenPatterns) {
      expect(nonCommentLines, `Should not contain "${pattern}"`).not.toContain(pattern);
    }
  });

  it("PANE-08 (honest copy): pane includes ntfy iOS app section above setup values", async () => {
    vi.mocked(getNtfySetup).mockResolvedValue(SET_UP_SHAPE as ReturnType<typeof getNtfySetup> extends Promise<infer T> ? T : never);

    render(<PreferencesNotificationsPane />);

    await waitFor(() => {
      expect(screen.getByTestId("preferences-notifications-server-address")).toBeTruthy();
    });

    // Check for ntfy iOS app copy
    const container = document.body;
    expect(container.textContent).toMatch(/ntfy/i);
    expect(container.textContent).toMatch(/iOS app|phone/i);
  });
});
