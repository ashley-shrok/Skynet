import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── renameApp API client + validateAppTitle — app-rename shape ─────────────
//
//   PATCH /apps/:hostId/:slug   body: { title }   200 → { ok: true, title }

vi.mock("@/main-axios", () => ({
  authApi: {
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
  },
  handleApiError: (err: unknown, operation: string): never => {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "string"
          ? err
          : "unknown error";
    throw new Error(`${operation}: ${msg}`);
  },
}));

import { renameApp, validateAppTitle } from "@/api/apps-rename-api";
import { authApi } from "@/main-axios";

describe("renameApp", () => {
  beforeEach(() => {
    vi.mocked(authApi.patch).mockReset();
  });

  it("PATCHes /apps/:hostId/:slug with { title } and returns the body", async () => {
    vi.mocked(authApi.patch).mockResolvedValueOnce({
      data: { ok: true, title: "New" },
    });
    const result = await renameApp(42, "my-app", "New");
    expect(authApi.patch).toHaveBeenCalledWith("/apps/42/my-app", { title: "New" });
    expect(result).toEqual({ ok: true, title: "New" });
  });

  it("throws through handleApiError on failure", async () => {
    vi.mocked(authApi.patch).mockRejectedValueOnce(new Error("409"));
    await expect(renameApp(42, "my-app", "New")).rejects.toThrow("rename app: 409");
  });
});

describe("validateAppTitle (client mirror)", () => {
  it("trims and accepts", () => {
    expect(validateAppTitle("  Hi  ")).toEqual({ ok: true, title: "Hi" });
  });

  it("accepts 80 chars and non-ASCII", () => {
    expect(validateAppTitle("x".repeat(80)).ok).toBe(true);
    expect(validateAppTitle("Café ☕").ok).toBe(true);
  });

  it.each(["", "   ", "x".repeat(81), "a\nb", "a\tb", "a\u0000b"])(
    "rejects %j",
    (raw) => {
      expect(validateAppTitle(raw).ok).toBe(false);
    },
  );
});
