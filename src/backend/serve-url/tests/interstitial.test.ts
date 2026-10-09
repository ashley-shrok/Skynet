import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const { infoSpy } = vi.hoisted(() => ({ infoSpy: vi.fn() }));
vi.mock("../../utils/logger.js", () => ({
  sshLogger: { info: infoSpy, warn: vi.fn() },
}));

import {
  INTERSTITIAL_CLASS_HEADER,
  INTERSTITIAL_RETRY_HEADER,
  renderInterstitial,
  trackInterstitialRetry,
} from "../interstitial.js";
import type { ErrorClass, ServeTarget } from "../types.js";

const target = { hostname: "thenasty", port: 3020, host: {} } as ServeTarget;
const url = "https://term.example.com/apps/3/videos/pane/";

describe("renderInterstitial self-retry", () => {
  const retryable: ErrorClass[] = [
    "port_not_listening",
    "host_unreachable",
    "app_not_serving",
  ];
  const terminal: ErrorClass[] = ["permission_denied", "invalid_link", "ssh_failure"];

  it.each(retryable)("%s renders the Loading screen with a hidden error card", (cls) => {
    const r = renderInterstitial(cls, target, url, "term.example.com");
    expect(r.headers[INTERSTITIAL_CLASS_HEADER]).toBe(cls);
    expect(r.body).toContain("<title>Loading…</title>");
    expect(r.body).toContain('id="loading"');
    expect(r.body).toContain('<main class="card" id="card" hidden>');
    expect(r.body).toContain("<script>");
    expect(r.body).toContain("<noscript>");
    expect(r.body).toContain("Try again");
  });

  it.each(terminal)("%s renders the error card immediately with no script", (cls) => {
    const r = renderInterstitial(cls, target, url, "term.example.com");
    expect(r.headers[INTERSTITIAL_CLASS_HEADER]).toBe(cls);
    expect(r.body).not.toContain("<script>");
    expect(r.body).not.toContain("Loading…");
    expect(r.body).toContain('<main class="card" id="card">');
  });

  it("keeps request-derived data out of the retry script", () => {
    const evil = 'https://term.example.com/apps/3/x/pane/"</script><script>alert(1)</script>';
    const r = renderInterstitial("app_not_serving", target, evil, "term.example.com");
    const script = r.body.slice(r.body.indexOf("<script>"), r.body.indexOf("</script>"));
    expect(script).not.toContain("alert");
    expect(r.body).not.toContain("<script>alert");
  });

  it("auth_missing stays a bare redirect", () => {
    const r = renderInterstitial("auth_missing", target, url, "term.example.com");
    expect(r.status).toBe(302);
    expect(r.headers[INTERSTITIAL_CLASS_HEADER]).toBeUndefined();
  });
});

describe("trackInterstitialRetry", () => {
  beforeEach(() => infoSpy.mockReset());

  function fakeRes(headers: Record<string, string>, status: number) {
    const res = new EventEmitter() as EventEmitter & Partial<Response>;
    res.statusCode = status;
    res.getHeader = ((name: string) => headers[name]) as Response["getHeader"];
    return res as unknown as Response;
  }
  function fakeReq(retry?: string) {
    return {
      headers: retry === undefined ? {} : { [INTERSTITIAL_RETRY_HEADER]: retry },
      originalUrl: "/apps/3/videos/pane/?q=1",
    } as unknown as Request;
  }

  it("ignores normal requests", () => {
    const res = fakeRes({}, 200);
    trackInterstitialRetry(fakeReq(), res);
    res.emit("finish");
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("logs still-failing probes with the class", () => {
    const res = fakeRes({ [INTERSTITIAL_CLASS_HEADER]: "app_not_serving" }, 404);
    trackInterstitialRetry(fakeReq("3"), res);
    res.emit("finish");
    expect(infoSpy).toHaveBeenCalledWith(
      "interstitial retry: still failing",
      expect.objectContaining({
        operation: "interstitial_retry_failed",
        attempt: 3,
        errorClass: "app_not_serving",
        path: "/apps/3/videos/pane/",
      }),
    );
  });

  it("logs recovered probes", () => {
    const res = fakeRes({}, 200);
    trackInterstitialRetry(fakeReq("2"), res);
    res.emit("finish");
    expect(infoSpy).toHaveBeenCalledWith(
      "interstitial retry: recovered",
      expect.objectContaining({ operation: "interstitial_retry_recovered", attempt: 2, status: 200 }),
    );
  });

  it("ignores malformed attempt values", () => {
    const res = fakeRes({}, 200);
    trackInterstitialRetry(fakeReq("abc"), res);
    res.emit("finish");
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
