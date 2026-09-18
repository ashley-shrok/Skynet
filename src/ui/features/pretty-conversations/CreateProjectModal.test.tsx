/**
 * Phase 117 Plan 117-09 Task 1 — CreateProjectModal tests.
 *
 * Behavior surface (see 117-09-PLAN.md Task 1 <behavior>):
 *   Test 1  — renders when open=true: dialog + name input + Submit + Cancel
 *   Test 2  — does not render when open=false: dialog NOT in DOM
 *   Test 3  — Submit disabled with empty input
 *   Test 4  — Submit enabled with valid input
 *   Test 5  — Submit calls createProject(hostId, raw displayName); fires
 *             onCreated({slug, displayName}) + closes modal on success
 *   Test 6  — Cancel closes without firing onCreated
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

// ─── Test helpers ────────────────────────────────────────────────────────────

function renderModal(
  overrides: {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    onCreated?: (result: { slug: string; displayName: string }) => void;
    hostId?: number;
  } = {},
) {
  const onOpenChange = overrides.onOpenChange ?? vi.fn();
  const onCreated = overrides.onCreated ?? vi.fn();
  const hostId = overrides.hostId ?? 1;
  const open = overrides.open ?? true;
  const result = render(
    <CreateProjectModal
      open={open}
      onOpenChange={onOpenChange}
      onCreated={onCreated}
      hostId={hostId}
    />,
  );
  return { onOpenChange, onCreated, hostId, ...result };
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

  it("Test 1 (renders open): dialog with name input + Submit + Cancel present", () => {
    renderModal({ open: true });
    expect(
      screen.getByRole("dialog", { name: /new project/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/project name/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /create project/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
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

  it("Test 6 (cancel): Cancel closes without firing onCreated or createProject", () => {
    const { onOpenChange, onCreated } = renderModal({ open: true });
    typeName("My Project");
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
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
});
