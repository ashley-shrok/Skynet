/**
 * PreferencesModal tests
 *
 *   (a)/(b) open / closed
 *   (c) each side-list item shows its section; gated sections hide
 *   (d) Esc closes
 *   (e) every open starts on the account
 *   (f–k) Phone and Services gating / flows
 *   (i) About: pinned last, branded name, source link, licence page
 *   (l) Log out lives in the account section and asks first
 *   (m) side list: account card leads; no General / Log out items; no Close foot
 *   (n) leave guard: unsaved About-you writing asks before switching or closing
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PreferencesModal from "./PreferencesModal";
import type { UserPreferences } from "@/api/open-tabs-api";
import type { Host, HostFolder } from "@/types/ui-types";
import { __resetKitDialogsForTests, autoAnswerKitDialogs } from "@/components/kit";
import { publishBrandingConfig, __resetForTest as resetBranding } from "@/branding/branding-store";

// About you's editor, as a plain textarea.
vi.mock("@/features/pretty-view/MarkdownEditor", () => ({
  MarkdownEditor: (props: { content: string; onChange: (v: string) => void }) => (
    <textarea
      data-testid="mock-editor"
      value={props.content}
      onChange={(e) => props.onChange(e.target.value)}
    />
  ),
}));

const { listGlobalFilesMock, readGlobalFileMock } = vi.hoisted(() => ({
  listGlobalFilesMock: vi.fn(),
  readGlobalFileMock: vi.fn(),
}));
vi.mock("@/api/global-files-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/global-files-api")>();
  return {
    ...actual,
    listGlobalFiles: (...a: unknown[]) => listGlobalFilesMock(...a),
    readGlobalFile: (...a: unknown[]) => readGlobalFileMock(...a),
    writeGlobalFile: vi.fn().mockResolvedValue({ mtime: 2 }),
  };
});

// VoicePicker (used by PreferencesVoicePane) imports postSpeak from voice-api.
// Mock the API so tests don't make real network calls.
vi.mock("@/api/system-status-api", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/api/system-status-api")>();
  return {
    ...actual,
    getVersionInfo: vi.fn(async () => ({
      localVersion: "9.9.9",
      sourceUrl: "https://example.com/acme/skynet-fork",
    })),
  };
});

vi.mock("@/api/voice-api", () => ({
  postSpeak: vi.fn(async () => new Blob([], { type: "audio/wav" })),
  postSpeakStream: vi.fn(async () => new Response(null, { status: 200 })),
  SAMPLE_PHRASE: "Hi, this is your voice.",
  fetchVoiceCatalog: vi.fn(async () => ({
    voices: ["Danielle", "Joanna", "Ruth", "Salli", "Tiffany", "Matthew", "Stephen"].map((id) => ({ id, name: id })),
    defaultVoice: "Joanna",
    listError: false,
  })),
}));

// saveUserPreferences is called by PreferencesVoicePane on picker change.
vi.mock("@/api/open-tabs-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/open-tabs-api")>();
  return {
    ...actual,
    saveUserPreferences: vi.fn().mockResolvedValue(undefined),
  };
});

// Phone section gating — the modal fetches the user's number on open.
const { getMyPhoneMock } = vi.hoisted(() => ({
  getMyPhoneMock: vi.fn<() => Promise<string | null>>(),
}));
vi.mock("@/api/user-phone-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/user-phone-api")>();
  return {
    ...actual,
    getMyPhone: () => getMyPhoneMock(),
    clearMyPhone: vi.fn().mockResolvedValue(undefined),
  };
});

// Services section gating — the modal lists user-managed service secrets.
const { getMyServiceSecretsMock, setMyServiceSecretMock } = vi.hoisted(() => ({
  getMyServiceSecretsMock: vi.fn(),
  setMyServiceSecretMock: vi.fn(),
}));
vi.mock("@/api/service-secrets-api", () => ({
  getMyServiceSecrets: () => getMyServiceSecretsMock(),
  setMyServiceSecret: (...a: unknown[]) => setMyServiceSecretMock(...a),
  clearMyServiceSecret: vi.fn().mockResolvedValue(undefined),
}));

// Notifications section gating — the modal probes GET /push-subscriptions/telegram
// on open; any failure (403 when the user lacks notifications access) hides it.
const { getTelegramStatusMock } = vi.hoisted(() => ({
  getTelegramStatusMock: vi.fn<() => Promise<{ setUp: boolean; linked: boolean }>>(),
}));
vi.mock("@/features/notifications/telegram-setup-api", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/features/notifications/telegram-setup-api")
    >();
  return {
    ...actual,
    getTelegramStatus: () => getTelegramStatusMock(),
  };
});

vi.mock("@/main-axios", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/main-axios")>();
  return { ...actual, logoutUser: vi.fn().mockResolvedValue(undefined) };
});

const AGENT_HOST_TREE: HostFolder = {
  name: "root",
  children: [
    {
      id: "1",
      name: "thenasty",
      enableRdp: false,
      enableSsh: true,
      enableTerminal: true,
      enableTunnel: false,
      enableFileManager: false,
      enableDocker: false,
      enableVnc: false,
      enableTelnet: false,
      username: "ubuntu",
      ip: "10.0.0.1",
      port: 22,
      folder: "",
      online: true,
      cpu: null,
      ram: null,
      lastAccess: "",
      authType: "key",
      serverTunnels: [],
      quickActions: [],
      sshPort: 22,
      rdpPort: 3389,
      vncPort: 5900,
      telnetPort: 23,
      runsFleetSubstrate: true,
    } as Host,
  ],
};

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  userId: "user-123",
  username: "ashley",
  avatarPath: null,
  onAvatarChanged: vi.fn(),
  userPrefs: {} as UserPreferences,
  hostTree: null,
  defaultHostId: null,
};

describe("PreferencesModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMyPhoneMock.mockResolvedValue(null);
    getMyServiceSecretsMock.mockResolvedValue([]);
    setMyServiceSecretMock.mockResolvedValue(undefined);
    getTelegramStatusMock.mockResolvedValue({ setUp: false, linked: false });
    listGlobalFilesMock.mockResolvedValue([{ path: "~/.claude/CLAUDE.md" }]);
    readGlobalFileMock.mockResolvedValue({ content: "I like tea", mtime: 1, size: 10 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    __resetKitDialogsForTests();
    resetBranding();
  });

  it("(a) renders modal when open=true", () => {
    render(<PreferencesModal {...defaultProps} open={true} />);
    expect(screen.getByTestId("preferences-modal")).toBeTruthy();
  });

  it("(b) does not render modal content when open=false", () => {
    render(<PreferencesModal {...defaultProps} open={false} />);
    expect(screen.queryByTestId("preferences-modal")).toBeNull();
  });

  it("(c) clicking Voice nav button shows voice pane content", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    const voiceBtn = screen.getByTestId("preferences-nav-voice");
    await user.click(voiceBtn);
    expect(screen.getByTestId("preferences-voice-pane")).toBeTruthy();
  });

  it("(c) clicking Notifications nav button shows notifications pane content", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    const notifBtn = await screen.findByTestId("preferences-nav-notifications");
    await user.click(notifBtn);
    // Mocked status: not set up → the pane shows the BotFather steps.
    expect(
      await screen.findByTestId("preferences-telegram-setup"),
    ).toBeTruthy();
  });

  it("(c) hides the Notifications section when the user lacks notifications access", async () => {
    getTelegramStatusMock.mockRejectedValue(
      new Error("Request failed with status code 403"),
    );
    render(<PreferencesModal {...defaultProps} open={true} />);
    await waitFor(() => expect(getTelegramStatusMock).toHaveBeenCalled());
    expect(screen.queryByTestId("preferences-nav-notifications")).toBeNull();
  });

  it("(c) clicking About you shows its header and, with no agent-capable machine, says so", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    await user.click(screen.getByTestId("preferences-nav-about-you"));
    expect(screen.getByTestId("preferences-modal-pane")).toBeTruthy();
    expect(screen.getByTestId("preferences-section-hero").textContent).toContain("About you");
    expect(screen.getByText("No machines can run agents yet")).toBeTruthy();
  });

  it("(c) About you lands straight on the machine's file", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} hostTree={AGENT_HOST_TREE} open={true} />);
    await user.click(screen.getByTestId("preferences-nav-about-you"));
    expect((await screen.findByTestId("preferences-about-you-file")).textContent).toContain(
      "I like tea",
    );
    expect(listGlobalFilesMock).toHaveBeenCalledWith(1);
  });

  it("(c) Voice opens with a header saying what it's for", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    await user.click(screen.getByTestId("preferences-nav-voice"));
    const hero = screen.getByTestId("preferences-section-hero");
    expect(hero.textContent).toContain("Voice");
    expect(hero.textContent).toContain("How your agents sound");
  });

  it("(d) Escape key calls onOpenChange(false)", async () => {
    const onOpenChange = vi.fn();
    render(
      <PreferencesModal
        {...defaultProps}
        open={true}
        onOpenChange={onOpenChange}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    // The window asks its leave guard first, so closing lands a tick later.
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("(e) opens on the account; reopening after navigating to Voice starts on the account again", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PreferencesModal {...defaultProps} open={true} />);
    expect(screen.getByTestId("preferences-account-pane")).toBeTruthy();
    expect(screen.getByTestId("preferences-nav-account").getAttribute("aria-current")).toBe("true");

    await user.click(screen.getByTestId("preferences-nav-voice"));
    expect(screen.getByTestId("preferences-voice-pane")).toBeTruthy();
    expect(screen.queryByTestId("preferences-account-pane")).toBeNull();
    expect(screen.getByTestId("preferences-nav-account").getAttribute("aria-current")).toBeNull();

    rerender(<PreferencesModal {...defaultProps} open={false} />);
    rerender(<PreferencesModal {...defaultProps} open={true} />);
    expect(screen.queryByTestId("preferences-voice-pane")).toBeNull();
    expect(screen.getByTestId("preferences-account-pane")).toBeTruthy();
  });

  it("(e) the account card returns to the account section", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    await user.click(screen.getByTestId("preferences-nav-voice"));
    await user.click(screen.getByTestId("preferences-nav-account"));
    expect(screen.getByTestId("preferences-account-pane")).toBeTruthy();
    expect(screen.queryByTestId("preferences-voice-pane")).toBeNull();
  });

  it("(f) hides the Phone section when the user has no number on file", async () => {
    render(<PreferencesModal {...defaultProps} open={true} />);
    await waitFor(() => expect(getMyPhoneMock).toHaveBeenCalled());
    expect(screen.queryByTestId("preferences-nav-phone")).toBeNull();
  });

  it("(f) hides the Phone section when the number fetch fails", async () => {
    getMyPhoneMock.mockRejectedValue(new Error("boom"));
    render(<PreferencesModal {...defaultProps} open={true} />);
    await waitFor(() => expect(getMyPhoneMock).toHaveBeenCalled());
    expect(screen.queryByTestId("preferences-nav-phone")).toBeNull();
  });

  it("(g) shows the Phone section when a number is on file", async () => {
    getMyPhoneMock.mockResolvedValue("+17165550100");
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    await user.click(await screen.findByTestId("preferences-nav-phone"));
    expect(screen.getByTestId("preferences-phone-pane")).toBeTruthy();
    expect(
      (screen.getByTestId("preferences-phone-input") as HTMLInputElement).value,
    ).toBe("+17165550100");
  });

  it("(j) hides the Services section when there are no user-managed secrets", async () => {
    render(<PreferencesModal {...defaultProps} open={true} />);
    await waitFor(() => expect(getMyServiceSecretsMock).toHaveBeenCalled());
    expect(screen.queryByTestId("preferences-nav-services")).toBeNull();
  });

  it("(k) shows Services, saves a key write-only and refreshes the status", async () => {
    const secret = {
      service: "notes",
      serviceDescription: "Notes service",
      name: "NOTES_KEY",
      label: "Notes API key",
      managedBy: "user",
      hasFallback: false,
      isSet: false,
      updatedAt: null,
    };
    getMyServiceSecretsMock
      .mockResolvedValueOnce([secret])
      .mockResolvedValue([
        { ...secret, isSet: true, updatedAt: "2026-10-08T00:00:00Z" },
      ]);
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    await user.click(await screen.findByTestId("preferences-nav-services"));
    const input = screen.getByTestId(
      "service-secret-notes-NOTES_KEY-input",
    ) as HTMLInputElement;
    expect(input.type).toBe("password");
    await user.type(input, "abc123");
    await user.click(screen.getByTestId("service-secret-notes-NOTES_KEY-save"));
    expect(setMyServiceSecretMock).toHaveBeenCalledWith(
      expect.objectContaining({ service: "notes", name: "NOTES_KEY" }),
      "abc123",
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("service-secret-notes-NOTES_KEY-status").textContent,
      ).toMatch(/^Set/),
    );
    expect(input.value).toBe("");
  });

  it("(h) removing the number hides the Phone section and returns to the account", async () => {
    getMyPhoneMock.mockResolvedValue("+17165550100");
    autoAnswerKitDialogs({ confirm: true });
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    await user.click(await screen.findByTestId("preferences-nav-phone"));
    await user.click(screen.getByTestId("preferences-phone-remove"));
    await waitFor(() =>
      expect(screen.queryByTestId("preferences-nav-phone")).toBeNull(),
    );
    expect(screen.queryByTestId("preferences-phone-pane")).toBeNull();
    expect(screen.getByTestId("preferences-account-pane")).toBeTruthy();
  });

  it("(i) About is pinned last and shows the version + server-provided source link", async () => {
    render(<PreferencesModal {...defaultProps} open={true} />);
    const nav = screen.getByTestId("preferences-modal-nav");
    const buttons = Array.from(nav.querySelectorAll("button"));
    const about = screen.getByTestId("preferences-nav-about");
    expect(buttons.at(-1)).toBe(about);
    expect(about.textContent).toBe("About");
    fireEvent.click(about);
    expect(await screen.findByText("Version 9.9.9")).toBeTruthy();
    const link = screen.getByTestId("preferences-about-source-link");
    expect(link.getAttribute("href")).toBe("https://example.com/acme/skynet-fork");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("(i) About shows the instance's branded name and logo, never a hard-coded Skynet", async () => {
    publishBrandingConfig({
      appName: "Acme Agents",
      shortName: "Acme",
      iconPath: "/branding/acme.png",
      wordmarkPath: "/branding/acme-wordmark.png",
      faviconPath: "/branding/acme.svg",
      wipIndicatorPath: "/branding/wip.webp",
      pwaIcons: [],
      avatarDirectorSpec: "x",
      avatarGammaDefault: 0.7,
    });
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    await user.click(screen.getByTestId("preferences-nav-about"));
    const pane = screen.getByTestId("preferences-about-pane");
    expect(screen.getByTestId("preferences-about-name").textContent).toBe("Acme Agents");
    expect(pane.querySelector("img")?.getAttribute("src")).toBe("/branding/acme.png");
    // The header (logo, name, version) carries the brand only. (The source
    // link is the mocked fork URL, so it's left out of this check.)
    expect(pane.firstElementChild?.textContent).not.toMatch(/skynet/i);
    expect(screen.getByTestId("preferences-modal-nav").textContent).not.toMatch(/skynet/i);
  });

  it("(i) Licence opens one level deeper; back and Esc return to About without closing", async () => {
    const onOpenChange = vi.fn();
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} onOpenChange={onOpenChange} open={true} />);
    await user.click(screen.getByTestId("preferences-nav-about"));

    await user.click(screen.getByTestId("preferences-about-licence-row"));
    const licence = screen.getByTestId("preferences-about-licence");
    expect(licence.textContent).toMatch(/This app is built on Skynet/);
    expect(licence.textContent).toMatch(/AGPL-3\.0 terms/);
    expect(screen.getByTestId("preferences-about-copyright").textContent).toMatch(
      /Copyright .*no warranty/,
    );
    expect(screen.queryByTestId("preferences-about-pane")).toBeNull();

    await user.click(screen.getByTestId("preferences-about-back"));
    expect(screen.getByTestId("preferences-about-pane")).toBeTruthy();

    await user.click(screen.getByTestId("preferences-about-components-row"));
    expect(screen.getByTestId("preferences-about-components").textContent).toContain("SuperDoc");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByTestId("preferences-about-pane")).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalled();

    // On About itself, Esc closes the window as usual.
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("(l) Log out lives in the account section and asks first; cancel stays, confirm logs out", async () => {
    const onLogout = vi.fn();
    window.addEventListener("skynet:logout", onLogout);
    try {
      const answers = [false, true];
      const dialogs = autoAnswerKitDialogs({ confirm: () => answers.shift() ?? false });
      const user = userEvent.setup();
      render(<PreferencesModal {...defaultProps} open={true} />);
      await user.click(screen.getByTestId("preferences-account-logout"));
      await waitFor(() => expect(dialogs.calls).toHaveLength(1));
      expect(dialogs.calls[0].opts.title).toBe("Log out?");
      expect(onLogout).not.toHaveBeenCalled();
      expect(screen.getByTestId("preferences-account-pane")).toBeTruthy();

      await user.click(screen.getByTestId("preferences-account-logout"));
      await waitFor(() => expect(onLogout).toHaveBeenCalledTimes(1));
    } finally {
      window.removeEventListener("skynet:logout", onLogout);
    }
  });

  it("(m) side list: account card first; no General or Log out items; no Close button at the bottom", async () => {
    render(<PreferencesModal {...defaultProps} open={true} />);
    await waitFor(() => expect(getTelegramStatusMock).toHaveBeenCalled());
    const nav = screen.getByTestId("preferences-modal-nav");
    const buttons = Array.from(nav.querySelectorAll("button"));
    const card = screen.getByTestId("preferences-nav-account");
    expect(buttons[0]).toBe(card);
    expect(card.textContent).toContain("ashley");
    expect(card.textContent).toContain("Picture, log out");
    expect(screen.queryByTestId("preferences-nav-general")).toBeNull();
    expect(screen.queryByTestId("preferences-nav-logout")).toBeNull();
    expect(nav.textContent).not.toMatch(/General|Log out/);
    // The X is the only way to close — no "Close" button in a foot.
    const closeButtons = Array.from(document.querySelectorAll("button")).filter(
      (b) => b.textContent?.trim() === "Close",
    );
    expect(closeButtons).toHaveLength(0);
    expect(screen.getByTestId("preferences-close")).toBeTruthy();
    expect(document.querySelector("[data-slot='modal-foot']")).toBeNull();
  });

  describe("(n) leave guard — unsaved About-you writing", () => {
    async function startDirtyEdit(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByTestId("preferences-nav-about-you"));
      await user.click(await screen.findByTestId("preferences-about-you-edit"));
      const editor = (await screen.findByTestId("mock-editor")) as HTMLTextAreaElement;
      fireEvent.keyDown(editor, { key: "a" });
      fireEvent.change(editor, { target: { value: "half a thought" } });
    }

    it("switching section asks; Keep editing stays put, Discard switches", async () => {
      const answers = [false, true];
      const dialogs = autoAnswerKitDialogs({ confirm: () => answers.shift() ?? false });
      const user = userEvent.setup();
      render(<PreferencesModal {...defaultProps} hostTree={AGENT_HOST_TREE} open={true} />);
      await startDirtyEdit(user);

      await user.click(screen.getByTestId("preferences-nav-voice"));
      await waitFor(() => expect(dialogs.calls).toHaveLength(1));
      expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
      expect(screen.queryByTestId("preferences-voice-pane")).toBeNull();
      expect((screen.getByTestId("mock-editor") as HTMLTextAreaElement).value).toBe(
        "half a thought",
      );

      await user.click(screen.getByTestId("preferences-nav-voice"));
      expect(await screen.findByTestId("preferences-voice-pane")).toBeTruthy();
      expect(dialogs.calls).toHaveLength(2);
    });

    it("closing with the X asks; Keep editing keeps the window open", async () => {
      const dialogs = autoAnswerKitDialogs({ confirm: false });
      const onOpenChange = vi.fn();
      const user = userEvent.setup();
      render(
        <PreferencesModal
          {...defaultProps}
          hostTree={AGENT_HOST_TREE}
          onOpenChange={onOpenChange}
          open={true}
        />,
      );
      await startDirtyEdit(user);
      await user.click(screen.getByTestId("preferences-close"));
      await waitFor(() => expect(dialogs.calls).toHaveLength(1));
      expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
      expect(onOpenChange).not.toHaveBeenCalled();
    });

    it("no unsaved writing → switching section doesn't ask", async () => {
      const dialogs = autoAnswerKitDialogs({ confirm: false });
      const user = userEvent.setup();
      render(<PreferencesModal {...defaultProps} hostTree={AGENT_HOST_TREE} open={true} />);
      await user.click(screen.getByTestId("preferences-nav-about-you"));
      await user.click(await screen.findByTestId("preferences-about-you-edit"));
      await screen.findByTestId("mock-editor");
      await user.click(screen.getByTestId("preferences-nav-voice"));
      expect(await screen.findByTestId("preferences-voice-pane")).toBeTruthy();
      expect(dialogs.calls).toHaveLength(0);
    });
  });
});

describe("PreferencesModal mobile drill-in", () => {
  const realMatchMedia = window.matchMedia;
  beforeEach(() => {
    vi.clearAllMocks();
    getMyPhoneMock.mockResolvedValue(null);
    getMyServiceSecretsMock.mockResolvedValue([]);
    getTelegramStatusMock.mockResolvedValue({ setUp: false, linked: false });
    // Below `sm` — the modal is fullscreen.
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  });
  afterEach(() => {
    window.matchMedia = realMatchMedia;
  });

  const navHidden = () =>
    screen.getByTestId("preferences-modal-nav").classList.contains("hidden");
  // ModalSidebar hides the pane column that wraps the pane body.
  const paneHidden = () =>
    screen.getByTestId("preferences-modal-pane").closest(".hidden") !== null;

  it("opens on the section list; a section drills in; back returns to the list", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    expect(navHidden()).toBe(false);
    expect(paneHidden()).toBe(true);

    await user.click(screen.getByTestId("preferences-nav-voice"));
    expect(navHidden()).toBe(true);
    expect(paneHidden()).toBe(false);
    expect(screen.getByTestId("preferences-voice-pane")).toBeTruthy();
    const back = screen.getByTestId("preferences-nav-back");
    expect(back.parentElement?.textContent).toContain("Voice");

    await user.click(back);
    expect(navHidden()).toBe(false);
    expect(paneHidden()).toBe(true);
  });

  it("tapping the account card (already active) drills into the account", async () => {
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} open={true} />);
    const card = screen.getByTestId("preferences-nav-account");
    expect(card.getAttribute("data-drill")).toBe("true");
    await user.click(card);
    expect(paneHidden()).toBe(false);
    expect(screen.getByTestId("preferences-account-pane")).toBeTruthy();
  });

  it("back from About you with unsaved writing asks first; Keep editing stays in the section", async () => {
    const dialogs = autoAnswerKitDialogs({ confirm: false });
    listGlobalFilesMock.mockResolvedValue([{ path: "~/.claude/CLAUDE.md" }]);
    readGlobalFileMock.mockResolvedValue({ content: "I like tea", mtime: 1, size: 10 });
    const user = userEvent.setup();
    render(<PreferencesModal {...defaultProps} hostTree={AGENT_HOST_TREE} open={true} />);
    await user.click(screen.getByTestId("preferences-nav-about-you"));
    await user.click(await screen.findByTestId("preferences-about-you-edit"));
    const editor = (await screen.findByTestId("mock-editor")) as HTMLTextAreaElement;
    fireEvent.keyDown(editor, { key: "a" });
    fireEvent.change(editor, { target: { value: "half a thought" } });

    await user.click(screen.getByTestId("preferences-nav-back"));
    await waitFor(() => expect(dialogs.calls).toHaveLength(1));
    expect(dialogs.calls[0].opts.title).toBe("Discard your changes?");
    expect(navHidden()).toBe(true);
    expect(screen.getByTestId("mock-editor")).toBeTruthy();
    __resetKitDialogsForTests();
  });

  it("reopening starts on the list again", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<PreferencesModal {...defaultProps} open={true} />);
    await user.click(screen.getByTestId("preferences-nav-voice"));
    rerender(<PreferencesModal {...defaultProps} open={false} />);
    rerender(<PreferencesModal {...defaultProps} open={true} />);
    expect(navHidden()).toBe(false);
    expect(paneHidden()).toBe(true);
  });
});
