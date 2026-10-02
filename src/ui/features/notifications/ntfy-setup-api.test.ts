/**
 * Phase 144 Plan 03 Task 1 — ntfy-setup-api tests.
 *
 * Five behavior cases covering:
 *   - API-01: getNtfySetup() GETs /push-subscriptions/ntfy-setup with the main-axios JWT instance
 *   - API-02: postNtfySetup() POSTs /push-subscriptions/ntfy-setup (empty body — backend provisions idempotently)
 *   - API-03: postNtfyTest() POSTs /push-subscriptions/ntfy-test; returns {ok: boolean, error?: string}
 *   - API-04: postNtfyRegenerate() POSTs /push-subscriptions/ntfy-regenerate; returns the new setup shape
 *   - API-05: deleteNtfySetup() DELETEs /push-subscriptions/ntfy-setup; returns {ok: true}
 *
 * Mocking pattern mirrors apps-archive-api.test.ts: vi.mock("@/main-axios") with
 * an authApi stub.
 */

vi.mock("@/main-axios", () => ({
  authApi: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
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

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getNtfySetup,
  postNtfySetup,
  postNtfyTest,
  postNtfyRegenerate,
  deleteNtfySetup,
} from "./ntfy-setup-api";
import { authApi } from "@/main-axios";

describe("ntfy-setup-api", () => {
  beforeEach(() => {
    vi.mocked(authApi.get).mockReset();
    vi.mocked(authApi.post).mockReset();
    vi.mocked(authApi.delete).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("getNtfySetup — API-01", () => {
    it("API-01 (happy): GETs /push-subscriptions/ntfy-setup and returns parsed body", async () => {
      const responseShape = {
        isSetUp: true,
        serverAddress: "https://term.gigaashley.click/ntfy",
        topicName: "abc123",
        readingCredential: "tk_testcred",
        ntfyUsername: "skynet-reader-u1",
      };
      vi.mocked(authApi.get).mockResolvedValueOnce({ data: responseShape });

      const result = await getNtfySetup();

      expect(authApi.get).toHaveBeenCalledTimes(1);
      expect(authApi.get).toHaveBeenCalledWith("/push-subscriptions/ntfy-setup");
      expect(result).toEqual(responseShape);
    });

    it("API-01 (not set up): returns isSetUp=false shape", async () => {
      vi.mocked(authApi.get).mockResolvedValueOnce({ data: { isSetUp: false } });

      const result = await getNtfySetup();

      expect(result).toEqual({ isSetUp: false });
    });

    it("API-01 (error): rejects on non-2xx", async () => {
      vi.mocked(authApi.get).mockRejectedValueOnce(new Error("Request failed with status code 404"));

      await expect(getNtfySetup()).rejects.toThrow(/ntfy setup/i);
    });
  });

  describe("postNtfySetup — API-02", () => {
    it("API-02 (happy): POSTs /push-subscriptions/ntfy-setup with empty body and returns setup shape", async () => {
      const responseShape = {
        isSetUp: true,
        serverAddress: "https://term.gigaashley.click/ntfy",
        topicName: "abc123",
        readingCredential: "tk_newcred",
        ntfyUsername: "skynet-reader-u1",
      };
      vi.mocked(authApi.post).mockResolvedValueOnce({ data: responseShape });

      const result = await postNtfySetup();

      expect(authApi.post).toHaveBeenCalledTimes(1);
      expect(authApi.post).toHaveBeenCalledWith("/push-subscriptions/ntfy-setup");
      expect(result).toEqual(responseShape);
    });

    it("API-02 (error): rejects on non-2xx", async () => {
      vi.mocked(authApi.post).mockRejectedValueOnce(new Error("Request failed with status code 500"));

      await expect(postNtfySetup()).rejects.toThrow(/ntfy setup/i);
    });
  });

  describe("postNtfyTest — API-03", () => {
    it("API-03 (ok=true): POSTs /push-subscriptions/ntfy-test and returns {ok: true}", async () => {
      vi.mocked(authApi.post).mockResolvedValueOnce({ data: { ok: true } });

      const result = await postNtfyTest();

      expect(authApi.post).toHaveBeenCalledTimes(1);
      expect(authApi.post).toHaveBeenCalledWith("/push-subscriptions/ntfy-test");
      expect(result).toEqual({ ok: true });
    });

    it("API-03 (ok=false with error message): returns {ok: false, error: string}", async () => {
      vi.mocked(authApi.post).mockResolvedValueOnce({
        data: { ok: false, error: "ntfy publish failed: 503" },
      });

      const result = await postNtfyTest();

      expect(result.ok).toBe(false);
      expect(result.error).toContain("503");
    });

    it("API-03 (error): rejects on non-2xx", async () => {
      vi.mocked(authApi.post).mockRejectedValueOnce(new Error("Request failed with status code 503"));

      await expect(postNtfyTest()).rejects.toThrow(/ntfy test/i);
    });
  });

  describe("postNtfyRegenerate — API-04", () => {
    it("API-04 (happy): POSTs /push-subscriptions/ntfy-regenerate and returns new setup shape", async () => {
      const newShape = {
        isSetUp: true,
        serverAddress: "https://term.gigaashley.click/ntfy",
        topicName: "abc123",
        readingCredential: "tk_rotatedcred",
        ntfyUsername: "skynet-reader-u1",
      };
      vi.mocked(authApi.post).mockResolvedValueOnce({ data: newShape });

      const result = await postNtfyRegenerate();

      expect(authApi.post).toHaveBeenCalledTimes(1);
      expect(authApi.post).toHaveBeenCalledWith("/push-subscriptions/ntfy-regenerate");
      expect(result).toEqual(newShape);
    });

    it("API-04 (error): rejects on non-2xx", async () => {
      vi.mocked(authApi.post).mockRejectedValueOnce(new Error("Request failed with status code 500"));

      await expect(postNtfyRegenerate()).rejects.toThrow(/ntfy regenerate/i);
    });
  });

  describe("deleteNtfySetup — API-05", () => {
    it("API-05 (happy): DELETEs /push-subscriptions/ntfy-setup and returns {ok: true}", async () => {
      vi.mocked(authApi.delete).mockResolvedValueOnce({ data: { ok: true } });

      const result = await deleteNtfySetup();

      expect(authApi.delete).toHaveBeenCalledTimes(1);
      expect(authApi.delete).toHaveBeenCalledWith("/push-subscriptions/ntfy-setup");
      expect(result).toEqual({ ok: true });
    });

    it("API-05 (error): rejects on non-2xx", async () => {
      vi.mocked(authApi.delete).mockRejectedValueOnce(new Error("Request failed with status code 403"));

      await expect(deleteNtfySetup()).rejects.toThrow(/ntfy setup delete/i);
    });
  });
});
