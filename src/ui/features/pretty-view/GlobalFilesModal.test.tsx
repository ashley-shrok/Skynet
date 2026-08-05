/**
 * Quick 260805-7rq — GlobalFilesModal: lazy-load race regression test
 *
 * Reproduces the ~700ms SSH read race where the lazy-load useEffect's cleanup
 * fires (setting `cancelled = true`) before readGlobalFile resolves, leaving
 * the modal spinner forever. The fix (Task 2) drops `tabData` from the deps
 * array so the effect doesn't re-run after setTabData({loading}).
 *
 * Mocking strategy:
 *   - @/api/global-files-api: listGlobalFiles resolves synchronously with one
 *     entry; readGlobalFile resolves asynchronously after setTimeout(50ms) to
 *     simulate the macrotask delay that exposes the race.
 *   - No WS stubs, no identity-store mocks — GlobalFilesModal touches neither.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { HostFolder } from "@/types/ui-types";

// ── Module mocks (hoisted — must appear before imports of the mocked modules) ──

vi.mock("@/api/global-files-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listGlobalFiles: vi.fn().mockResolvedValue([
      { path: "~/.claude/CLAUDE.md", label: "User CLAUDE.md" },
    ]),
    readGlobalFile: vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { content: "MOCKED FILE CONTENT", mtime: 1_700_000_000, size: 20 };
    }),
  };
});

// ── Late imports (after mocks are registered) ────────────────────────────────
import GlobalFilesModal from "./GlobalFilesModal";

// ── Shared fixture ────────────────────────────────────────────────────────────

// Minimal HostFolder tree — only fields consumed by collectAllHosts + the <select>.
// Host id must be a string (per ui-types.ts Host.id: string); defaultHostId is number.
// enableRdp must NOT be true so the host passes the filter.
const HOST_TREE: HostFolder = {
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
    },
  ],
};

// ── Test suite ────────────────────────────────────────────────────────────────
describe("GlobalFilesModal — lazy-load race regression (quick 260805-7rq)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the READY textarea after an asynchronous readGlobalFile resolves (regression: lazy-load useEffect must not cancel its own in-flight read via tabData-in-deps re-run)", async () => {
    render(
      <GlobalFilesModal
        open={true}
        onOpenChange={vi.fn()}
        hostTree={HOST_TREE}
        defaultHostId={1}
        container={document.body}
      />,
    );

    // Wait for the READY branch — the textarea should appear with the mocked content.
    // 2000ms ceiling comfortably covers the 50ms mock delay plus React scheduling.
    // Real timers are used (no vi.useFakeTimers()) — mirroring IdentityModal.role-tab.test.tsx.
    await waitFor(
      () => expect(screen.queryByRole("textbox")).toBeTruthy(),
      { timeout: 2000 },
    );

    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toBe("MOCKED FILE CONTENT");
  });
});
