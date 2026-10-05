import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: { getInstance: () => ({ createAuthMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next() }) },
}));

import {
  ConversionCache,
  createDocumentConverter,
  MAX_CONVERT_BYTES,
  type ConverterDeps,
} from "./document-convert.js";

type MockRes = {
  statusCode: number;
  headers: Record<string, string>;
  body: unknown;
  status: (c: number) => MockRes;
  json: (b: unknown) => MockRes;
  end: (b?: unknown) => MockRes;
  setHeader: (k: string, v: string) => void;
  headersSent: boolean;
};

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: 200,
    headers: {},
    body: undefined,
    headersSent: false,
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(b) {
      this.body = b;
      return this;
    },
    end(b) {
      this.body = b;
      return this;
    },
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
  };
  return res;
}

function makeReq(query: Record<string, string>, body: unknown): Request {
  return { query, body } as unknown as Request;
}

function sidecar(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init),
  ) as unknown as ConverterDeps["fetchImpl"] & ReturnType<typeof vi.fn>;
  return fetchImpl;
}

const PDF = Buffer.from("%PDF-1.7 fake");

describe("document-convert", () => {
  it("answers 503 converter_unavailable when no converter is configured", async () => {
    const fetchImpl = sidecar(() => new Response(PDF));
    const c = createDocumentConverter({ converterUrl: () => undefined, fetchImpl });
    const res = makeRes();
    await c.handleConvert(makeReq({ from: "pptx", to: "pdf" }, Buffer.from("x")), res as unknown as Response);
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({ error: "converter_unavailable" });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await c.available()).toBe(false);
  });

  it("validates target, source and body before calling the sidecar", async () => {
    const fetchImpl = sidecar(() => new Response(PDF));
    const c = createDocumentConverter({ converterUrl: () => "http://conv:3030", fetchImpl });
    const cases: Array<[Record<string, string>, unknown, number, string]> = [
      [{ from: "pptx", to: "exe" }, Buffer.from("x"), 400, "unsupported_target"],
      [{ from: "sh", to: "pdf" }, Buffer.from("x"), 400, "unsupported_source"],
      [{ from: "pptx", to: "pdf" }, Buffer.alloc(0), 400, "empty_body"],
      [{ from: "pptx", to: "pdf" }, { not: "a buffer" }, 400, "empty_body"],
      [{ from: "pptx", to: "pdf" }, Buffer.alloc(MAX_CONVERT_BYTES + 1), 413, "too_large"],
    ];
    for (const [query, body, status, error] of cases) {
      const res = makeRes();
      await c.handleConvert(makeReq(query, body), res as unknown as Response);
      expect([res.statusCode, res.body]).toEqual([status, { error }]);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("forwards to the sidecar and returns the converted bytes with the target type", async () => {
    const fetchImpl = sidecar(() => new Response(PDF, { status: 200 }));
    const c = createDocumentConverter({ converterUrl: () => "http://conv:3030", fetchImpl });
    const res = makeRes();
    await c.handleConvert(makeReq({ from: "PPTX", to: "pdf" }, Buffer.from("deck")), res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(Buffer.compare(res.body as Buffer, PDF)).toBe(0);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://conv:3030/convert?from=pptx&to=pdf",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("caches by content + target and shares in-flight conversions", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetchImpl = sidecar(async () => {
      await gate;
      return new Response(PDF);
    });
    const c = createDocumentConverter({ converterUrl: () => "http://conv:3030", fetchImpl });
    const a = c.convert(Buffer.from("same"), "pptx", "pdf");
    const b = c.convert(Buffer.from("same"), "odp", "pdf");
    release();
    expect("bytes" in (await a) && "bytes" in (await b)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await c.convert(Buffer.from("same"), "pptx", "pdf");
    expect(fetchImpl).toHaveBeenCalledTimes(1); // cache hit
    await c.convert(Buffer.from("same"), "pptx", "docx");
    await c.convert(Buffer.from("other"), "pptx", "pdf");
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("does not cache failures and maps sidecar errors", async () => {
    const statuses = [422, 503, 413, 500];
    let i = 0;
    const fetchImpl = sidecar(() => new Response("{}", { status: statuses[i++] }));
    const c = createDocumentConverter({ converterUrl: () => "http://conv:3030", fetchImpl });
    const results = [];
    for (let n = 0; n < statuses.length; n++) results.push(await c.convert(Buffer.from("doc"), "doc", "docx"));
    expect(results).toEqual([
      { status: 422, error: "conversion_failed" },
      { status: 503, error: "converter_busy" },
      { status: 413, error: "too_large" },
      { status: 502, error: "converter_error" },
    ]);
    expect(c.cache.size).toBe(0);
  });

  it("reports an unreachable sidecar as unavailable", async () => {
    const fetchImpl = sidecar(() => {
      throw new TypeError("fetch failed");
    });
    const c = createDocumentConverter({ converterUrl: () => "http://conv:3030", fetchImpl });
    expect(await c.convert(Buffer.from("x"), "ppt", "pdf")).toEqual({ status: 503, error: "converter_unavailable" });
    expect(await c.available()).toBe(false);
  });

  it("status checks the sidecar health and caches the answer briefly", async () => {
    const fetchImpl = sidecar((url) => new Response("{}", { status: url.endsWith("/healthz") ? 200 : 404 }));
    const c = createDocumentConverter({ converterUrl: () => "http://conv:3030", fetchImpl });
    const res = makeRes();
    await c.handleStatus(makeReq({}, undefined), res as unknown as Response);
    expect(res.body).toEqual({ available: true });
    await c.available();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("ConversionCache", () => {
  it("evicts least recently used entries past the byte or entry cap", () => {
    const cache = new ConversionCache(10, 3);
    cache.set("a", Buffer.alloc(4));
    cache.set("b", Buffer.alloc(4));
    cache.get("a"); // a is now most recent
    cache.set("c", Buffer.alloc(4)); // 12 bytes > 10 → evict b
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.totalBytes).toBe(8);
    cache.set("d", Buffer.alloc(1));
    cache.set("e", Buffer.alloc(1)); // 4 entries > 3 → evict the oldest
    expect(cache.size).toBe(3);
    cache.set("huge", Buffer.alloc(11)); // larger than the whole cache: skipped
    expect(cache.get("huge")).toBeUndefined();
  });
});
