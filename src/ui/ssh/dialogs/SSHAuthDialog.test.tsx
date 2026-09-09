// ─── SSHAuthDialog — Vitest coverage ─────────────────────────────────────────
// Regression guard for the lazy-loaded SSH auth-fail modal (Terminal.tsx:37
// wraps this in React.lazy). If a future refactor breaks the dialog's contract
// — tab switching, password submit, key-tab submit, cancel — these tests
// catch it before it reaches a live SSH auth-fail surface (which is high-
// friction to trigger manually).
//
// CodeMirror mock: @uiw/react-codemirror hits contentEditable + custom
// scrollers that jsdom can't render meaningfully. We swap in a plain textarea
// stub that preserves the value/onChange contract — the concern under test
// is "does the dialog wire the editor's changes through submit", NOT
// CodeMirror's own internals. The lazy-chunk-actually-fetches verification
// stays covered structurally by the Playwright smoke (which parses every
// chunk on cold-shell) and Terminal.tsx's lazy() import path.
//
// Bounty: sshauth-dialog-first-open-verification-spec (arc phase 2, session 4)

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { SSHAuthDialog } from "./SSHAuthDialog";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
    i18n: { language: "en", changeLanguage: () => Promise.resolve() },
  }),
}));

vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    onChange,
    placeholder,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <textarea
      data-testid="ssh-key-editor"
      className="cm-editor"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
    />
  ),
}));

const HOST = { ip: "10.0.0.5", port: 22, username: "ubuntu", name: "test-vm" };

function renderDialog(overrides: {
  isOpen?: boolean;
  reason?: "no_keyboard" | "auth_failed" | "timeout";
  onSubmit?: ReturnType<typeof vi.fn>;
  onCancel?: ReturnType<typeof vi.fn>;
} = {}) {
  const onSubmit = overrides.onSubmit ?? vi.fn();
  const onCancel = overrides.onCancel ?? vi.fn();
  const utils = render(
    <SSHAuthDialog
      isOpen={overrides.isOpen ?? true}
      reason={overrides.reason ?? "no_keyboard"}
      onSubmit={onSubmit}
      onCancel={onCancel}
      hostInfo={HOST}
    />,
  );
  return { ...utils, onSubmit, onCancel };
}

describe("SSHAuthDialog", () => {
  beforeEach(() => cleanup());

  it("A: renders when isOpen=true, returns null when isOpen=false", () => {
    const { container: openContainer } = renderDialog({ isOpen: true });
    expect(
      openContainer.querySelector("form"),
    ).toBeTruthy();
    cleanup();
    const { container: closedContainer } = renderDialog({ isOpen: false });
    expect(closedContainer.querySelector("form")).toBeNull();
  });

  it("B: displays host info in the header", () => {
    renderDialog();
    // Format: "name (user@ip:port)" per hostDisplay logic
    expect(
      screen.getByText(/test-vm.*ubuntu@10\.0\.0\.5:22/),
    ).toBeInTheDocument();
  });

  it("C: password tab is the default; Connect disabled with empty password", () => {
    renderDialog();
    const connect = screen.getByRole("button", { name: /common\.connect/i });
    expect(connect).toBeDisabled();
    // Radix Tabs uses role=tab; the password tab must be the initially-active one.
    const passwordTab = screen.getByRole("tab", { name: /credentials\.password/i });
    expect(passwordTab).toHaveAttribute("data-state", "active");
  });

  it("D: typing a password enables Connect and submits with { password }", () => {
    const { onSubmit } = renderDialog();
    // PasswordInput renders an <input type=password>; grab it by type.
    const pwInput = document.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    expect(pwInput).toBeTruthy();
    fireEvent.change(pwInput!, { target: { value: "hunter2" } });
    const connect = screen.getByRole("button", { name: /common\.connect/i });
    expect(connect).not.toBeDisabled();
    fireEvent.click(connect);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ password: "hunter2" });
  });

  // Radix Tabs uses pointer events; fireEvent.click alone doesn't flip the
  // active tab in jsdom. userEvent.setup({ pointerEventsCheck: 0 }) issues
  // the full pointerdown → pointerup → click sequence that Radix expects.
  const user = userEvent.setup({ pointerEventsCheck: 0 });

  it("E: switching to key tab reveals the editor (cm-editor DOM present)", async () => {
    renderDialog();
    const keyTab = screen.getByRole("tab", { name: /credentials\.sshKey/i });
    await user.click(keyTab);
    const editor = screen.getByTestId("ssh-key-editor");
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveClass("cm-editor");
  });

  it("F: pasting a key into the editor + submit fires with { sshKey }", async () => {
    const { onSubmit } = renderDialog();
    await user.click(screen.getByRole("tab", { name: /credentials\.sshKey/i }));
    const editor = screen.getByTestId("ssh-key-editor");
    fireEvent.change(editor, {
      target: { value: "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----" },
    });
    const connect = screen.getByRole("button", { name: /common\.connect/i });
    expect(connect).not.toBeDisabled();
    fireEvent.click(connect);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({
      sshKey:
        "-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----",
    });
  });

  it("G: key + keyPassword both submit together on the key tab", async () => {
    const { onSubmit } = renderDialog();
    await user.click(screen.getByRole("tab", { name: /credentials\.sshKey/i }));
    fireEvent.change(screen.getByTestId("ssh-key-editor"), {
      target: { value: "pk-body" },
    });
    // Key-tab passphrase is the ONLY password input on that tab.
    const kpwInput = document.querySelector<HTMLInputElement>(
      'input[type="password"]',
    );
    expect(kpwInput).toBeTruthy();
    fireEvent.change(kpwInput!, { target: { value: "keypass" } });
    fireEvent.click(screen.getByRole("button", { name: /common\.connect/i }));
    expect(onSubmit).toHaveBeenCalledWith({
      sshKey: "pk-body",
      keyPassword: "keypass",
    });
  });

  it("H: whitespace-only key does NOT enable Connect (canSubmit trims)", async () => {
    renderDialog();
    await user.click(screen.getByRole("tab", { name: /credentials\.sshKey/i }));
    fireEvent.change(screen.getByTestId("ssh-key-editor"), {
      target: { value: "   \n\t  " },
    });
    expect(
      screen.getByRole("button", { name: /common\.connect/i }),
    ).toBeDisabled();
  });

  it("I: cancel button calls onCancel and does NOT call onSubmit", () => {
    const { onSubmit, onCancel } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /common\.cancel/i }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("J: reason='auth_failed' surfaces the failed-auth copy", () => {
    renderDialog({ reason: "auth_failed" });
    expect(
      screen.getByText(/auth\.sshAuthenticationFailed/i),
    ).toBeInTheDocument();
  });

  it("K: reason='timeout' surfaces the timeout copy", () => {
    renderDialog({ reason: "timeout" });
    expect(
      screen.getByText(/auth\.sshAuthenticationTimeout/i),
    ).toBeInTheDocument();
  });
});
