// ─── CreateRoleDialog coverage (Phase 22 SRIC-04 Plan 22-04 Task 2)
//
// Tests 11-20 cover the new CreateRoleDialog component that ships with the
// `+ New role` launcher button (Task 2 also adds Test 21 in the sibling
// panel test file).
//
// Behavior spec (from 22-04-PLAN.md <behavior>):
//   Test 11: renders Name (input), Description (textarea), Host picker,
//     `Then create an agent with this role` checkbox (CHECKED by default)
//   Test 12: Name validation — kebab-case-lowercase gate; invalid inline error;
//     Create disabled while invalid
//   Test 13: Description validation — empty disables Create
//   Test 14: Host validation — no host picked disables Create
//   Test 15: Auto-select single host on open (mirrors NewSessionDialog L316-322)
//   Test 16: On submit, createRole is called with {name, description, hostId}
//   Test 17: On successful submit with checkbox CHECKED (default) AND
//     onChainToCreateIdentity provided → onChainToCreateIdentity invoked; safe
//     when callback is undefined (no crash)
//   Test 18: On successful submit with checkbox UNCHECKED → onChainToCreateIdentity
//     NOT invoked
//   Test 19: On 409 conflict from server → dialog stays open + inline error
//     "A role named `<name>` already exists on <host>"
//   Test 20: On modal close, all state resets (name, description, host,
//     checkbox → default true)
//
// Mock pattern lifted from NewSessionDialog.role-dropdown.test.tsx §mocks
// (react-i18next passthrough, session-hue / identities-store / touch-device
// inert stubs). CreateRoleDialog does NOT depend on voice/avatar/color pickers,
// so those mocks are omitted.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor, screen, act } from "@testing-library/react";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

// Mock identities-api — the new createRole from Task 1 + RoleAlreadyExistsError.
const mockCreateRole = vi.fn();

vi.mock("@/api/identities-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    createRole: (...args: unknown[]) => mockCreateRole(...args),
  };
});

// The dialog imports RoleAlreadyExistsError directly. Import the real class so
// the mockRejectedValue tests below throw the actual instance the dialog
// checks against with instanceof.
import { RoleAlreadyExistsError } from "@/api/identities-api";
import { CreateRoleDialog } from "./CreateRoleDialog";
import type { Host, HostFolder } from "@/types/ui-types";

// ─── Fixture helpers (byte-shape from NewSessionDialog.role-dropdown.test.tsx)

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
  return { name: "root", children: hosts } as HostFolder;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCreateRole.mockResolvedValue({ name: "box-maintainer", description: "d" });
});

afterEach(() => {
  // Best-effort cleanup — @testing-library auto-unmounts, no explicit action.
});

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("CreateRoleDialog", () => {
  it("Test 11: renders Name input, Description textarea, Host picker, and 'Then create an agent with this role' checkbox CHECKED by default", () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([
          makeHost("h1", "hostA"),
          makeHost("h2", "hostB"),
        ])}
      />,
    );

    // Name input
    expect(screen.getByLabelText(/name/i)).toBeTruthy();
    // Description textarea (multi-line)
    const desc = screen.getByLabelText(/description/i) as HTMLTextAreaElement;
    expect(desc).toBeTruthy();
    expect(desc.tagName).toBe("TEXTAREA");
    // Host picker — listbox with two options
    const listbox = screen.getByRole("listbox");
    expect(listbox).toBeTruthy();
    expect(screen.getByRole("option", { name: /hostA/ })).toBeTruthy();
    expect(screen.getByRole("option", { name: /hostB/ })).toBeTruthy();
    // Chain-checkbox present + CHECKED by default (D-CONTEXT §UX rules)
    const checkbox = screen.getByRole("checkbox", {
      name: /then create an agent with this role/i,
    }) as HTMLInputElement;
    expect(checkbox).toBeTruthy();
    expect(checkbox.checked).toBe(true);
  });

  it("Test 12: Name validation — 'Box_Maintainer' shows inline error and disables Create; 'box-maintainer' clears the error", () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("h1", "hostA")])}
      />,
    );

    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
    // Type an invalid name (uppercase + underscore both fail /^[a-z0-9-]+$/)
    fireEvent.change(nameInput, { target: { value: "Box_Maintainer" } });

    // Inline error present
    expect(
      screen.getByText(/kebab-case-lowercase|a-z, 0-9, hyphen/i),
    ).toBeTruthy();

    // Create button disabled
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);

    // Now type a valid name → error clears + button state re-checked in test 13
    fireEvent.change(nameInput, { target: { value: "box-maintainer" } });
    expect(
      screen.queryByText(/kebab-case-lowercase|a-z, 0-9, hyphen/i),
    ).toBeNull();
  });

  it("Test 13: Description validation — empty description disables Create even when name+host are valid", () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("h1", "hostA")])}
      />,
    );

    // Auto-select single-host (Test 15) means selectedHost is already set.
    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "box-maintainer" } });

    // Description empty → still disabled
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);

    // Fill description → enabled
    const descArea = screen.getByLabelText(/description/i) as HTMLTextAreaElement;
    fireEvent.change(descArea, { target: { value: "Some description" } });
    expect(createBtn.disabled).toBe(false);
  });

  it("Test 14: Host validation — no host picked disables Create", () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([
          makeHost("h1", "hostA"),
          makeHost("h2", "hostB"),
        ])}
      />,
    );

    // Two hosts → NO auto-select (single-host auto-select only)
    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
    const descArea = screen.getByLabelText(/description/i) as HTMLTextAreaElement;
    fireEvent.change(nameInput, { target: { value: "box-maintainer" } });
    fireEvent.change(descArea, { target: { value: "description" } });

    // No host picked → disabled
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(true);

    // Click hostA → enabled
    fireEvent.click(screen.getByRole("option", { name: /hostA/ }));
    expect(createBtn.disabled).toBe(false);
  });

  it("Test 15: Auto-select single host on open (mirrors NewSessionDialog)", () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("h1", "onlyHost")])}
      />,
    );

    // Single-host tree → auto-select. The option should render aria-selected=true.
    const opt = screen.getByRole("option", { name: /onlyHost/ });
    expect(opt.getAttribute("aria-selected")).toBe("true");
  });

  it("Test 16: On submit, createRole is called with {name, description, hostId}", async () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("42", "hostA")])}
      />,
    );

    const nameInput = screen.getByLabelText(/name/i) as HTMLInputElement;
    const descArea = screen.getByLabelText(/description/i) as HTMLTextAreaElement;
    fireEvent.change(nameInput, { target: { value: "box-maintainer" } });
    fireEvent.change(descArea, { target: { value: "d1" } });

    const createBtn = screen.getByRole("button", { name: /create/i });
    fireEvent.click(createBtn);

    await waitFor(() => {
      expect(mockCreateRole).toHaveBeenCalledTimes(1);
    });
    expect(mockCreateRole).toHaveBeenCalledWith({
      name: "box-maintainer",
      description: "d1",
      hostId: 42,
    });
  });

  it("Test 17: On successful submit with checkbox CHECKED (default), onChainToCreateIdentity is invoked; also safe when undefined", async () => {
    const chainSpy = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <CreateRoleDialog
        open={true}
        onClose={onClose}
        hostTree={makeHostTree([makeHost("42", "hostA")])}
        onChainToCreateIdentity={chainSpy}
      />,
    );

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "box-maintainer" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "d1" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(chainSpy).toHaveBeenCalledTimes(1));
    expect(chainSpy).toHaveBeenCalledWith({
      role: "box-maintainer",
      host: expect.objectContaining({ id: "42", name: "hostA" }),
      description: "d1",
    });
    expect(onClose).toHaveBeenCalled();

    // Now render WITHOUT onChainToCreateIdentity — undefined callback must not crash
    rerender(
      <CreateRoleDialog
        open={true}
        onClose={onClose}
        hostTree={makeHostTree([makeHost("42", "hostA")])}
      />,
    );
    // Fill + submit — this must not throw even though callback is undefined
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "another-role" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "d2" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      // The second createRole call fires without throwing
      expect(mockCreateRole).toHaveBeenCalledTimes(2);
    });
  });

  it("Test 18: On successful submit with checkbox UNCHECKED, onChainToCreateIdentity is NOT invoked", async () => {
    const chainSpy = vi.fn();
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("42", "hostA")])}
        onChainToCreateIdentity={chainSpy}
      />,
    );

    // Uncheck the chain checkbox
    const checkbox = screen.getByRole("checkbox", {
      name: /then create an agent with this role/i,
    }) as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(false);

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "box-maintainer" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "d1" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(mockCreateRole).toHaveBeenCalledTimes(1));
    expect(chainSpy).not.toHaveBeenCalled();
  });

  it("Test 19: On 409 conflict, dialog stays open and renders inline 'already exists on <host>' error", async () => {
    mockCreateRole.mockRejectedValueOnce(new RoleAlreadyExistsError("box-maintainer"));
    const onClose = vi.fn();

    render(
      <CreateRoleDialog
        open={true}
        onClose={onClose}
        hostTree={makeHostTree([makeHost("42", "hostA")])}
      />,
    );

    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "box-maintainer" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "d1" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      // Inline error rendered
      expect(
        screen.getByText(
          /A role named .*box-maintainer.* already exists on .*hostA/i,
        ),
      ).toBeTruthy();
    });

    // Dialog stays open — onClose NOT called
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Test 20: On modal close, all state resets (name, description, host, checkbox → default true)", async () => {
    let openState = true;
    const setOpen = (v: boolean) => { openState = v; };
    const { rerender } = render(
      <CreateRoleDialog
        open={openState}
        onClose={() => setOpen(false)}
        hostTree={makeHostTree([
          makeHost("1", "hostA"),
          makeHost("2", "hostB"),
        ])}
      />,
    );

    // Fill fields + uncheck the chain checkbox
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "box-maintainer" } });
    fireEvent.change(screen.getByLabelText(/description/i), { target: { value: "d1" } });
    fireEvent.click(screen.getByRole("option", { name: /hostB/ }));
    const checkbox = screen.getByRole("checkbox", {
      name: /then create an agent with this role/i,
    }) as HTMLInputElement;
    fireEvent.click(checkbox); // uncheck
    expect(checkbox.checked).toBe(false);

    // Close (open=false)
    rerender(
      <CreateRoleDialog
        open={false}
        onClose={() => setOpen(false)}
        hostTree={makeHostTree([
          makeHost("1", "hostA"),
          makeHost("2", "hostB"),
        ])}
      />,
    );

    // Re-open — all state should be reset
    rerender(
      <CreateRoleDialog
        open={true}
        onClose={() => setOpen(false)}
        hostTree={makeHostTree([
          makeHost("1", "hostA"),
          makeHost("2", "hostB"),
        ])}
      />,
    );

    // Name empty
    expect((screen.getByLabelText(/name/i) as HTMLInputElement).value).toBe("");
    // Description empty
    expect((screen.getByLabelText(/description/i) as HTMLTextAreaElement).value).toBe("");
    // Neither host selected (two hosts → no auto-select)
    expect(screen.getByRole("option", { name: /hostA/ }).getAttribute("aria-selected")).toBe("false");
    expect(screen.getByRole("option", { name: /hostB/ }).getAttribute("aria-selected")).toBe("false");
    // Checkbox back to CHECKED default
    expect(
      (screen.getByRole("checkbox", { name: /then create an agent with this role/i }) as HTMLInputElement).checked,
    ).toBe(true);
  });
});
