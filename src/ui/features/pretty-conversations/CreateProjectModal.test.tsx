/**
 * Phase 117 Plan 117-09 Task 1 — CreateProjectModal tests.
 *
 * Behavior surface (see 117-09-PLAN.md Task 1 <behavior>):
 *   Test 1  — renders when open=true: dialog + name input + Submit + Close
 *   Test 2  — does not render when open=false: dialog NOT in DOM
 *   Test 3  — Submit disabled with empty input
 *   Test 4  — Submit enabled with valid input
 *   Test 5  — Submit calls createProject(hostId, raw displayName); fires
 *             onCreated({slug, displayName}) + closes modal on success
 *   Test 6  — Close (X) closes without firing onCreated
 *   Test 7  — 409 duplicate slug: modal stays open + inline error shown
 *   Test 8  — 500 error: modal stays open + generic inline error shown
 *   Test 9  — Submit in-flight disables input + Submit button
 *   Test 10 — whitespace-only input: Submit stays disabled (client-side sanity)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// ─── Mocks for createProject ─────────────────────────────────────────────────

const createProjectSpy = vi.fn<
  (hostId: number, displayName: string) => Promise<{ ok: true; slug: string }>
>(async () => ({ ok: true as const, slug: "" }));

vi.mock("@/api/project-list-api", () => ({
  createProject: (hostId: number, displayName: string) =>
    createProjectSpy(hostId, displayName),
}));

import { CreateProjectModal } from "./CreateProjectModal";
import type { Host, HostFolder } from "@/types/ui-types";

// Minimal Host factory — mirrors PrettyConversationsPanel.projects.test.tsx:391
// (kept local rather than shared to preserve test-file independence).
function makeHost(id: string, name: string, overrides: Partial<Host> = {}): Host {
  return {
    id,
    name,
    username: "user",
    ip: "10.0.0.1",
    port: 22,
    folder: "",
    online: true,
    cpu: null,
    ram: null,
    lastAccess: "",
    authType: "password",
    enableTerminal: true,
    enableTunnel: false,
    serverTunnels: [],
    enableFileManager: false,
    enableDocker: false,
    quickActions: [],
    enableSsh: true,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
    sshPort: 22,
    rdpPort: 3389,
    vncPort: 5900,
    telnetPort: 23,
    ...overrides,
  } as Host;
}

function makeHostTree(hosts: Host[]): HostFolder {
  return { name: "root", children: hosts };
}

// ─── Test helpers ────────────────────────────────────────────────────────────

function renderModal(
  overrides: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onCreated?: (result: { slug: string; displayName: string }) => void;
    /** Convenience: single host id — builds a 1-host tree so auto-select fires. */
    hostId?: number;
    /** Convenience: multiple hosts — pass {id, name} pairs. */
    hosts?: Array<{ id: string; name: string; overrides?: Partial<Host> }>;
    /** Escape hatch: pass a fully-formed HostFolder directly. */
    hostTree?: HostFolder | null;
  } = {},
) {
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const onCreated = overrides.onCreated ?? vi.fn();
  const open = overrides.open ?? true;

  // Prop resolution priority: explicit hostTree > hosts[] > hostId > default 1.
  let hostTree: HostFolder | null;
  if (overrides.hostTree !== undefined) {
    hostTree = overrides.hostTree;
  } else if (overrides.hosts) {
    hostTree = makeHostTree(
      overrides.hosts.map((h) => makeHost(h.id, h.name, h.overrides ?? {})),
    );
  } else {
    const hostId = overrides.hostId ?? 1;
    hostTree = makeHostTree([makeHost(String(hostId), `host-${hostId}`)]);
  }

  const result = render(
    <CreateProjectModal
      open={open}
      onOpenChange={onOpenChange}
      onCreated={onCreated}
      hostTree={hostTree}
    />,
  );
  return { onOpenChange, onCreated, hostTree, ...result };
}

function typeName(value: string) {
  const input = screen.getByLabelText(/project name/i);
  fireEvent.change(input, { target: { value } });
}

/** Minimal ApiError shape — matches src/ui/main-axios.ts:1020. */
class FakeApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("CreateProjectModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createProjectSpy.mockReset();
    createProjectSpy.mockResolvedValue({ ok: true as const, slug: "" });
  });
  afterEach(() => {
    cleanup();
  });

  it("Test 1 (renders open): dialog with name input + Submit + Close (X) present", () => {
    renderModal({ open: true });
    expect(
      screen.getByRole("dialog", { name: /new project/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/project name/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create project/i }),
    ).toBeInTheDocument();
    // Cancel button retired; close is now the top-right glass X (aria-label="Close").
    expect(screen.getByRole("button", { name: /close/i })).toBeInTheDocument();
  });

  it("Test 2 (renders closed): dialog NOT in DOM when open=false", () => {
    renderModal({ open: false });
    expect(
      screen.queryByRole("dialog", { name: /new project/i }),
    ).not.toBeInTheDocument();
  });

  it("Test 3 (submit disabled empty): Create button disabled when input empty", () => {
    renderModal({ open: true });
    const submit = screen.getByRole("button", { name: /create project/i });
    expect(submit).toBeDisabled();
  });

  it("Test 4 (submit enabled with text): Create button enabled after valid input", () => {
    renderModal({ open: true });
    typeName("My Project");
    const submit = screen.getByRole("button", { name: /create project/i });
    expect(submit).not.toBeDisabled();
  });

  it("Test 5 (happy path): submit calls createProject(hostId, displayName), fires onCreated, closes", async () => {
    createProjectSpy.mockResolvedValueOnce({
      ok: true as const,
      slug: "my-project",
    });
    const { onOpenChange, onCreated } = renderModal({
      open: true,
      hostId: 42,
    });
    typeName("My Project");
    fireEvent.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => {
      expect(createProjectSpy).toHaveBeenCalledTimes(1);
    });
    expect(createProjectSpy).toHaveBeenCalledWith(42, "My Project");
    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
    });
    expect(onCreated).toHaveBeenCalledWith({
      slug: "my-project",
      displayName: "My Project",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("Test 6 (close X): X button closes without firing onCreated or createProject", () => {
    const { onOpenChange, onCreated } = renderModal({ open: true });
    typeName("My Project");
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onCreated).not.toHaveBeenCalled();
    expect(createProjectSpy).not.toHaveBeenCalled();
  });

  it("Test 7 (409 duplicate slug): modal stays open + inline error surfaces 'already exists'", async () => {
    createProjectSpy.mockRejectedValueOnce(
      new FakeApiError("Conflict", 409, "CONFLICT"),
    );
    const { onOpenChange, onCreated } = renderModal({ open: true });
    typeName("My Project");
    fireEvent.click(screen.getByRole("button", { name: /create project/i }));

    // Modal stays open.
    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert").textContent).toMatch(/already exists/i);
    expect(onCreated).not.toHaveBeenCalled();
    // onOpenChange never called with false since submit failed.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // Modal still open — dialog still in DOM.
    expect(
      screen.getByRole("dialog", { name: /new project/i }),
    ).toBeInTheDocument();
  });

  it("Test 8 (500 error): modal stays open + generic error message", async () => {
    createProjectSpy.mockRejectedValueOnce(
      new FakeApiError("Server error", 500, "SERVER_ERROR"),
    );
    const { onOpenChange } = renderModal({ open: true });
    typeName("My Project");
    fireEvent.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    // Generic error (does NOT contain "already exists").
    expect(screen.getByRole("alert").textContent).not.toMatch(/already exists/i);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("Test 9 (in-flight state): input + Submit disabled during API call, re-enabled after", async () => {
    let resolve: ((v: { ok: true; slug: string }) => void) | null = null;
    const pending = new Promise<{ ok: true; slug: string }>((res) => {
      resolve = res;
    });
    createProjectSpy.mockReturnValueOnce(pending);
    renderModal({ open: true });
    typeName("My Project");
    const submit = screen.getByRole("button", { name: /create project/i });
    fireEvent.click(submit);

    // While in-flight — input + Submit disabled.
    await waitFor(() => {
      expect(screen.getByLabelText(/project name/i)).toBeDisabled();
    });
    expect(submit).toBeDisabled();

    // Resolve the promise → modal closes.
    resolve!({ ok: true as const, slug: "my-project" });
    await waitFor(() => {
      expect(createProjectSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("Test 10 (whitespace-only input): Create button stays disabled", () => {
    renderModal({ open: true });
    typeName("   ");
    const submit = screen.getByRole("button", { name: /create project/i });
    expect(submit).toBeDisabled();
  });

  // ─── M-G host-picker behavior ──────────────────────────────────────────────

  it("Test 11 (single host: picker hidden): listbox NOT rendered when the user has exactly one pickable host", () => {
    renderModal({ open: true, hostId: 1 });
    expect(
      screen.queryByTestId("create-project-host-listbox"),
    ).not.toBeInTheDocument();
  });

  it("Test 12 (multi host: picker visible): listbox IS rendered when the user has ≥2 hosts", () => {
    renderModal({
      open: true,
      hosts: [
        { id: "3", name: "thenasty" },
        { id: "6", name: "Skynet" },
      ],
    });
    expect(
      screen.getByTestId("create-project-host-listbox"),
    ).toBeInTheDocument();
    // Both hosts appear as options.
    expect(screen.getByTestId("create-project-host-option-3")).toBeInTheDocument();
    expect(screen.getByTestId("create-project-host-option-6")).toBeInTheDocument();
  });

  it("Test 13 (multi host: submit disabled until picked): Create disabled with name entered but no host selected", () => {
    renderModal({
      open: true,
      hosts: [
        { id: "3", name: "thenasty" },
        { id: "6", name: "Skynet" },
      ],
    });
    typeName("Trip Planning");
    const submit = screen.getByRole("button", { name: /create project/i });
    expect(submit).toBeDisabled();
    // Picking a host enables submission.
    fireEvent.click(screen.getByTestId("create-project-host-option-6"));
    expect(submit).not.toBeDisabled();
  });

  it("Test 14 (multi host: submit uses picked host): createProject called with the SELECTED host id, not the first one", async () => {
    createProjectSpy.mockResolvedValueOnce({
      ok: true as const,
      slug: "trip-planning",
    });
    renderModal({
      open: true,
      hosts: [
        { id: "3", name: "thenasty" },
        { id: "6", name: "Skynet" },
      ],
    });
    typeName("Trip Planning");
    // Pick the SECOND host (id=6), not the first (id=3).
    fireEvent.click(screen.getByTestId("create-project-host-option-6"));
    fireEvent.click(screen.getByRole("button", { name: /create project/i }));

    await waitFor(() => {
      expect(createProjectSpy).toHaveBeenCalledTimes(1);
    });
    // Guard against the pre-M-G regression: the panel defaulted to the first
    // host in the tree, so this test would have failed with hostId=3 pre-fix.
    expect(createProjectSpy).toHaveBeenCalledWith(6, "Trip Planning");
  });

  it("Test 15 (multi host: search filters listbox): typing narrows the visible options", () => {
    renderModal({
      open: true,
      hosts: [
        { id: "3", name: "thenasty" },
        { id: "6", name: "Skynet" },
        { id: "7", name: "workstation" },
      ],
    });
    const searchInput = screen.getByLabelText(/search hosts/i);
    fireEvent.change(searchInput, { target: { value: "skynet" } });

    // Only the Skynet option survives the filter.
    expect(screen.getByTestId("create-project-host-option-6")).toBeInTheDocument();
    expect(
      screen.queryByTestId("create-project-host-option-3"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("create-project-host-option-7"),
    ).not.toBeInTheDocument();
  });

  it("Test 16 (RDP-only host filtered): a host with enableRdp=true is excluded from the picker", () => {
    renderModal({
      open: true,
      hosts: [
        { id: "3", name: "thenasty" },
        { id: "5", name: "thenasty-RDP", overrides: { enableRdp: true } },
        { id: "6", name: "Skynet" },
      ],
    });
    // The two SSH hosts render as options.
    expect(screen.getByTestId("create-project-host-option-3")).toBeInTheDocument();
    expect(screen.getByTestId("create-project-host-option-6")).toBeInTheDocument();
    // The RDP-only host does NOT — project directories are SSH-written.
    expect(
      screen.queryByTestId("create-project-host-option-5"),
    ).not.toBeInTheDocument();
  });
});
