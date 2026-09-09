/**
 * Component tests for NewSessionDialog — the small dialog opened from the
 * "New Session" affordance that collects a session name and dispatches
 * a session create against a chosen host.
 *
 * Covers:
 *   1. Basic submit — filling a valid name and clicking Start calls
 *      onSubmit(host, name).
 *   2. Sanitization — dots, colons, and whitespace are stripped from the
 *      name before onSubmit fires (tmux session names cannot contain these).
 *   3. Empty name — the submit is blocked and an error message renders;
 *      onSubmit is NOT called.
 *   4. Cancel — clicking Cancel fires onCancel; onSubmit is NOT called.
 *   5. Closed state — when isOpen=false, the dialog renders nothing (guard
 *      against the mount-when-hidden regression pattern).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NewSessionDialog } from "./NewSessionDialog";
import type { Host } from "@/types/ui-types";

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    id: 1,
    name: "test-host",
    ip: "10.0.0.1",
    port: 22,
    username: "root",
    // The dialog only reads .name and .ip — the rest satisfies the type
    // contract without influencing behavior.
    ...overrides,
  } as Host;
}

describe("NewSessionDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("submit — filling a valid name and clicking Start fires onSubmit(host, name)", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const host = makeHost();

    render(
      <NewSessionDialog
        isOpen={true}
        host={host}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    const input = screen.getByPlaceholderText(/fix-login-bug/i);
    fireEvent.change(input, { target: { value: "fix-my-bug" } });
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith(host, "fix-my-bug");
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("sanitize — dots, colons, and spaces are stripped before onSubmit", () => {
    const onSubmit = vi.fn();
    const host = makeHost();

    render(
      <NewSessionDialog
        isOpen={true}
        host={host}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    const input = screen.getByPlaceholderText(/fix-login-bug/i);
    fireEvent.change(input, {
      target: { value: "fix.my bug:with-stuff " },
    });
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    // Dots, spaces, colons all removed; dashes preserved.
    expect(onSubmit).toHaveBeenCalledWith(host, "fixmybugwith-stuff");
  });

  it("empty name — submit is blocked, error renders, onSubmit NOT called", () => {
    const onSubmit = vi.fn();
    const host = makeHost();

    render(
      <NewSessionDialog
        isOpen={true}
        host={host}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    // Don't fill anything; click Start.
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/name required/i)).toBeTruthy();
  });

  it("whitespace-only name — treated as empty; error renders, no submit", () => {
    const onSubmit = vi.fn();
    const host = makeHost();

    render(
      <NewSessionDialog
        isOpen={true}
        host={host}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    const input = screen.getByPlaceholderText(/fix-login-bug/i);
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/name required/i)).toBeTruthy();
  });

  it("cancel — clicking Cancel fires onCancel; onSubmit stays untouched", () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const host = makeHost();

    render(
      <NewSessionDialog
        isOpen={true}
        host={host}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    // Even after typing a valid name, Cancel bypasses onSubmit.
    fireEvent.change(screen.getByPlaceholderText(/fix-login-bug/i), {
      target: { value: "some-name" },
    });
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("closed — isOpen=false renders nothing", () => {
    const { container } = render(
      <NewSessionDialog
        isOpen={false}
        host={makeHost()}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );

    // Guard against the mount-while-hidden regression pattern —
    // the dialog should be entirely absent, not just visually hidden.
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("null host — dialog renders nothing even when isOpen=true", () => {
    const { container } = render(
      <NewSessionDialog
        isOpen={true}
        host={null}
        onSubmit={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(container.querySelector("form")).toBeNull();
  });
});
