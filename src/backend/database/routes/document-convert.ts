import express from "express";
import type { Request, Response } from "express";
import crypto from "crypto";
import { apiLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

/**
 * /document-convert — front door to the LibreOffice converter sidecar
 * (docker/converter). The file viewers send a document's bytes here to get
 * a format the browser can open: .doc/.odt → .docx (Word editor), .xls/.ods
 * → .xlsx (Excel viewer), .ppt/.pptx/.odp → .pdf (PDF viewer); saving an
 * edited .doc/.odt converts it back.
 *
 *   GET  /document-convert/status            → { available }
 *   POST /document-convert?from=<ext>&to=<ext>  body: raw bytes
 *
 * The sidecar is optional: with SKYNET_CONVERTER_URL unset (or the sidecar
 * down) POST answers 503 converter_unavailable and the viewers fall back to
 * the download card. Results are cached in memory by content hash, and
 * concurrent requests for the same conversion share one sidecar call (a
 * chat chip thumbnail and the modal opening the same deck, say).
 */

export const MAX_CONVERT_BYTES = 50 * 1024 * 1024;
const CACHE_MAX_BYTES = 200 * 1024 * 1024;
const CACHE_MAX_ENTRIES = 200;
const CONVERT_TIMEOUT_MS = 90_000;
const STATUS_TIMEOUT_MS = 3_000;
const STATUS_TTL_MS = 15_000;

export const CONVERT_TARGETS: Record<string, string> = {
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  odt: "application/vnd.oasis.opendocument.text",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export const CONVERT_SOURCES = new Set([
  "doc", "docx", "odt", "rtf",
  "xls", "xlsx", "ods",
  "ppt", "pptx", "odp",
]);

type ConvertError = { status: number; error: string };
type ConvertResult = { bytes: Buffer } | ConvertError;

export type ConverterDeps = {
  converterUrl: () => string | undefined;
  fetchImpl: typeof fetch;
};

const defaultDeps: ConverterDeps = {
  converterUrl: () => process.env.SKYNET_CONVERTER_URL?.replace(/\/+$/, "") || undefined,
  fetchImpl: (...args) => fetch(...args),
};

/** Insertion-ordered Map as an LRU, capped by entry count and total bytes. */
export class ConversionCache {
  private entries = new Map<string, Buffer>();
  private bytes = 0;

  constructor(
    private maxBytes = CACHE_MAX_BYTES,
    private maxEntries = CACHE_MAX_ENTRIES,
  ) {}

  get(key: string): Buffer | undefined {
    const hit = this.entries.get(key);
    if (hit) {
      this.entries.delete(key);
      this.entries.set(key, hit);
    }
    return hit;
  }

  set(key: string, value: Buffer): void {
    if (value.length > this.maxBytes) return;
    const old = this.entries.get(key);
    if (old) {
      this.bytes -= old.length;
      this.entries.delete(key);
    }
    this.entries.set(key, value);
    this.bytes += value.length;
    while (this.bytes > this.maxBytes || this.entries.size > this.maxEntries) {
      const [oldestKey, oldest] = this.entries.entries().next().value as [string, Buffer];
      this.entries.delete(oldestKey);
      this.bytes -= oldest.length;
    }
  }

  get size(): number {
    return this.entries.size;
  }

  get totalBytes(): number {
    return this.bytes;
  }
}

export function createDocumentConverter(deps: ConverterDeps = defaultDeps) {
  const cache = new ConversionCache();
  const inFlight = new Map<string, Promise<ConvertResult>>();
  let status: { available: boolean; at: number } | null = null;

  async function callSidecar(base: string, body: Buffer, from: string, to: string): Promise<ConvertResult> {
    let res: globalThis.Response;
    try {
      res = await deps.fetchImpl(`${base}/convert?from=${from}&to=${to}`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body,
        signal: AbortSignal.timeout(CONVERT_TIMEOUT_MS),
      });
    } catch (err) {
      apiLogger.warn("document converter unreachable", { operation: "document_convert", error: String(err) });
      return { status: 503, error: "converter_unavailable" };
    }
    if (res.ok) {
      const bytes = Buffer.from(await res.arrayBuffer());
      return bytes.length > 0 ? { bytes } : { status: 422, error: "conversion_failed" };
    }
    // Drain the body so the connection can be reused.
    await res.arrayBuffer().catch(() => undefined);
    if (res.status === 413) return { status: 413, error: "too_large" };
    if (res.status === 422) return { status: 422, error: "conversion_failed" };
    if (res.status === 503) return { status: 503, error: "converter_busy" };
    return { status: 502, error: "converter_error" };
  }

  async function convert(body: Buffer, from: string, to: string): Promise<ConvertResult> {
    const base = deps.converterUrl();
    if (!base) return { status: 503, error: "converter_unavailable" };
    // The source extension doesn't change LibreOffice's output (it sniffs
    // the content), so the key is content + target only.
    const key = `${crypto.createHash("sha256").update(body).digest("hex")}:${to}`;
    const cached = cache.get(key);
    if (cached) return { bytes: cached };
    const pending = inFlight.get(key);
    if (pending) return pending;
    const job = callSidecar(base, body, from, to)
      .then((result) => {
        if ("bytes" in result) cache.set(key, result.bytes);
        return result;
      })
      .finally(() => inFlight.delete(key));
    inFlight.set(key, job);
    return job;
  }

  async function available(): Promise<boolean> {
    const base = deps.converterUrl();
    if (!base) return false;
    if (status && Date.now() - status.at < STATUS_TTL_MS) return status.available;
    let ok = false;
    try {
      const res = await deps.fetchImpl(`${base}/healthz`, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
      await res.arrayBuffer().catch(() => undefined);
      ok = res.ok;
    } catch {
      ok = false;
    }
    status = { available: ok, at: Date.now() };
    return ok;
  }

  async function handleConvert(req: Request, res: Response): Promise<void> {
    const q = req.query as Record<string, unknown>;
    const to = typeof q.to === "string" ? q.to.toLowerCase() : "";
    const from = typeof q.from === "string" ? q.from.toLowerCase() : "";
    if (!(to in CONVERT_TARGETS)) {
      res.status(400).json({ error: "unsupported_target" });
      return;
    }
    if (!CONVERT_SOURCES.has(from)) {
      res.status(400).json({ error: "unsupported_source" });
      return;
    }
    const body = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      res.status(400).json({ error: "empty_body" });
      return;
    }
    if (body.length > MAX_CONVERT_BYTES) {
      res.status(413).json({ error: "too_large" });
      return;
    }
    const result = await convert(body, from, to);
    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.setHeader("Content-Type", CONVERT_TARGETS[to]);
    res.setHeader("Content-Length", String(result.bytes.length));
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.status(200).end(result.bytes);
  }

  async function handleStatus(_req: Request, res: Response): Promise<void> {
    res.setHeader("Cache-Control", "no-store");
    res.json({ available: await available() });
  }

  return { convert, available, handleConvert, handleStatus, cache };
}

const router = express.Router();
const authenticateJWT = AuthManager.getInstance().createAuthMiddleware();
const converter = createDocumentConverter();

router.get("/status", authenticateJWT, (req, res) => {
  void converter.handleStatus(req, res);
});

router.post(
  "/",
  authenticateJWT, // BEFORE the body parser, so anonymous uploads are never buffered
  express.raw({ type: "application/octet-stream", limit: MAX_CONVERT_BYTES }),
  (req, res) => {
    void converter.handleConvert(req, res).catch((err) => {
      apiLogger.error("document conversion failed", err, { operation: "document_convert" });
      if (!res.headersSent) res.status(500).json({ error: "internal_error" });
    });
  },
);

export default router;
