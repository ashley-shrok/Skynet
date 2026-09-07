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
//
// ─── Phase 84 (Plan 84-03 test-side updates for Plan 84-01 code) ────────
// The seven Plan 84-01 changes to CreateRoleDialog.tsx invalidate parts
// of the original Phase 22 behavior spec above. Deltas:
//   Test 11: no longer asserts checkbox; instead asserts the new
//     header blurb ("A role is what an agent does and how it thinks —
//     many agents can share one.") renders below the title, and asserts
//     the deleted required-caption text ("Name and description are
//     required") is NOT present.
//   Test 15: auto-select-single-host behavior is preserved but the
//     listbox is now HIDDEN when flatHosts.length === 1; the assertion
//     shifts from "aria-selected on the option" to "no listbox, but
//     the sole host is still selected as evidenced by canOpen".
//   Test 17: onChainToCreateIdentity fires unconditionally on success
//     (no more thenCreateIdentity gate). The two-part semantic split
//     stays — cb-provided fires; cb-undefined is safe.
//   Test 18: DELETED. The "checkbox UNCHECKED → chain does NOT fire"
//     branch no longer exists (D-CONTEXT item 4: primary button ALWAYS
//     advances).
//   Test 20: state reset no longer includes the checkbox — the state
//     hook itself was deleted (Plan 84-01 CHANGE A).
//   Test 22 (NEW): single-host picker suppression — hostTree with one
//     host renders no listbox + no search input, and Create is
//     enable-able without a host click.

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
  it("Test 11 (Phase 84 Plan 03): renders Name input, Description textarea, Host picker; header blurb present below title; required-caption + chain-checkbox both DELETED from DOM", () => {
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

    // Phase 84 (Plan 84-01 CHANGE E.2): title conforms to dropdown label
    // — "New role", not "Create a role". Regression here would revert the
    // dropdown↔modal alignment intent.
    expect(
      screen.getByRole("heading", { name: /^new role$/i }),
    ).toBeTruthy();

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
    // Phase 84 (Plan 84-01 CHANGE F.3): the chain-checkbox is DELETED
    // from DOM entirely. Assert its ABSENCE rather than its presence.
    expect(
      screen.queryByRole("checkbox", {
        name: /then create an agent with this role/i,
      }),
    ).toBeNull();

    // Phase 84 (Plan 84-01 CHANGE F.1): the header blurb renders below
    // the title, above the fields. Exact string from D-CONTEXT item 1
    // (LOCKED for planning; user may redirect during execute).
    expect(
      screen.getByText(
        /A role is what an agent does and how it thinks — many agents can share one\./,
      ),
    ).toBeTruthy();

    // Phase 84 (Plan 84-01 CHANGE E.1 + F.1): the pre-Phase-84
    // required-caption sentence ("... Name and description are
    // required.") is DELETED from source — the DialogDescription now
    // holds the blurb instead. Assert the old caption text is gone.
    expect(
      screen.queryByText(/Name and description are required/i),
    ).toBeNull();
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

  it("Test 15 (Phase 84 Plan 03): Auto-select single host on open — listbox is HIDDEN per Plan 84-01 CHANGE F.2, but sole host is still auto-picked as evidenced by canOpen predicate", () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("h1", "onlyHost")])}
      />,
    );

    // Phase 84 (Plan 84-01 CHANGE F.2): single-host picker suppression
    // means the listbox is NOT rendered. Assert its absence.
    expect(screen.queryByRole("listbox")).toBeNull();
    // The search input is inside the same guard — also absent.
    expect(screen.queryByPlaceholderText(/search hosts/i)).toBeNull();

    // The auto-select branch in the open-effect (Plan 84-01 CHANGE B kept
    // this intact) still fires. Evidence: after typing valid name + valid
    // description, the Create button becomes enabled — which requires
    // selectedHost !== null in the canOpen predicate.
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "d1" },
    });
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(false);
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

  it("Test 17 (Phase 84 Plan 03): On successful submit, onChainToCreateIdentity is invoked UNCONDITIONALLY when the callback prop is provided (checkbox gate removed per Plan 84-01 CHANGE C); also safe when the callback prop is undefined", async () => {
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

    // Note: single-host tree means the listbox is suppressed and hostA
    // is auto-picked (Plan 84-01 CHANGE F.2 + B). No option click needed.
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "d1" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(chainSpy).toHaveBeenCalledTimes(1));
    expect(chainSpy).toHaveBeenCalledWith({
      role: "box-maintainer",
      host: expect.objectContaining({ id: "42", name: "hostA" }),
      description: "d1",
    });
    expect(onClose).toHaveBeenCalled();

    // Phase 84 (Plan 84-01 CHANGE C): the checkbox gate is gone; the
    // callback fires whenever the callback prop is provided. Below we
    // render WITHOUT the prop — the callback is undefined and the
    // handleSubmit branch `if (onChainToCreateIdentity)` guards it.
    rerender(
      <CreateRoleDialog
        open={true}
        onClose={onClose}
        hostTree={makeHostTree([makeHost("42", "hostA")])}
      />,
    );
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "another-role" },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "d2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => {
      // The second createRole call fires without throwing
      expect(mockCreateRole).toHaveBeenCalledTimes(2);
    });
  });

  // Test 18 (Phase 84 Plan 03): DELETED. The behavior it verified
  // ("checkbox UNCHECKED → chain does NOT fire") no longer exists in
  // CreateRoleDialog — per D-CONTEXT item 4 LOCKED, the primary button
  // ALWAYS advances to the create-agent modal on success. There is no
  // un-chain path in the component anymore, so there is nothing to test.

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

  it("Test 20 (Phase 84 Plan 03): On modal close, all state resets (name, description, host). The checkbox reset assertion is DELETED — the state hook itself was deleted (Plan 84-01 CHANGE A).", async () => {
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

    // Fill fields — 2-host tree means the listbox IS rendered (Plan 84-01
    // CHANGE F.2 only suppresses at length === 1). Click hostB to pick it.
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "d1" },
    });
    fireEvent.click(screen.getByRole("option", { name: /hostB/ }));

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

    // Re-open — all remaining state should be reset
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
    expect(
      screen.getByRole("option", { name: /hostA/ }).getAttribute("aria-selected"),
    ).toBe("false");
    expect(
      screen.getByRole("option", { name: /hostB/ }).getAttribute("aria-selected"),
    ).toBe("false");

    // Phase 84 (Plan 84-01 CHANGE A): the thenCreateIdentity state hook
    // was DELETED. There is no checkbox to assert reset-to-CHECKED on.
    // Verify no such checkbox exists in the re-opened dialog at all:
    expect(
      screen.queryByRole("checkbox", {
        name: /then create an agent with this role/i,
      }),
    ).toBeNull();
  });

  it("Test 22 (Phase 84 Plan 03; implements Plan 84-01 CHANGE F.2): with a single-host hostTree, the search input and the host listbox are NOT rendered; the sole host is still auto-picked into selectedHost, so Create becomes enabled once name + description are valid", () => {
    render(
      <CreateRoleDialog
        open={true}
        onClose={() => {}}
        hostTree={makeHostTree([makeHost("42", "onlyHost")])}
      />,
    );

    // Picker chrome absent
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByPlaceholderText(/search hosts/i)).toBeNull();

    // The single host has no option button either — the whole subtree
    // is guarded by flatHosts.length !== 1.
    expect(screen.queryByRole("option", { name: /onlyHost/ })).toBeNull();

    // But the sole host IS auto-picked into selectedHost (Plan 84-01
    // CHANGE B kept the open-effect's auto-select-single-host branch
    // intact). Evidence: Create button enables after valid name + desc.
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "box-maintainer" },
    });
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "d1" },
    });
    const createBtn = screen.getByRole("button", { name: /create/i }) as HTMLButtonElement;
    expect(createBtn.disabled).toBe(false);
  });
});
