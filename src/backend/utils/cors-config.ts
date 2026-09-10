import cors from "cors";
import type { Request, Response, NextFunction } from "express";
import { getRequestOrigin } from "./request-origin.js";

const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];
const ELECTRON_FILE_ORIGIN = "file://";

// Phase 103 D-07: primary domain refuses CORS for any *.serve.term.<domain>
// origin. This blocks CSRF from serve subdomains at the browser preflight
// layer for any state-changing endpoint requiring preflight (JSON POST/PUT/
// DELETE/PATCH/custom-header). Explicit deny wins — placed as the very first
// check after the no-origin guard so no accept branch can shadow it.
const SERVE_SUBDOMAIN_RE = /^https:\/\/[^/]+\.serve\.term\.[a-zA-Z0-9.-]+$/;

function getAllowedOrigins(): string[] {
  const envOrigins = process.env.CORS_ALLOWED_ORIGINS;
  if (!envOrigins) return [];
  return envOrigins
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

function isLocalRequest(req: Request): boolean {
  const remoteAddr = req.socket?.remoteAddress || req.ip || "";
  return (
    remoteAddr === "127.0.0.1" ||
    remoteAddr === "::1" ||
    remoteAddr === "::ffff:127.0.0.1"
  );
}

export function createCorsMiddleware(
  methods: string[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  extraHeaders: string[] = [],
) {
  const allowedHeaders = [
    "Origin",
    "X-Requested-With",
    "Content-Type",
    "Accept",
    "Authorization",
    "User-Agent",
    "X-Electron-App",
    "Cache-Control",
    ...extraHeaders,
  ];

  return (req: Request, res: Response, next: NextFunction) => {
    const handler = cors({
      origin: (origin, callback) => {
        // No origin = same-origin or non-browser request (curl, internal service calls)
        if (!origin) return callback(null, true);

        // Phase 103 D-07: explicit reject BEFORE any accept check. Any origin
        // matching *.serve.term.<domain> is a serve subdomain and must never
        // be granted CORS access to the primary domain — this is the browser-
        // preflight CSRF defense for the widened JWT cookie (D-02).
        if (SERVE_SUBDOMAIN_RE.test(origin)) {
          return callback(
            new Error("Not allowed by CORS (serve subdomain origin)"),
          );
        }

        // Requests coming from localhost (nginx proxy, internal service calls)
        if (isLocalRequest(req)) return callback(null, true);

        if (DEV_ORIGINS.includes(origin)) return callback(null, true);
        if (origin.startsWith(ELECTRON_FILE_ORIGIN))
          return callback(null, true);

        const configured = getAllowedOrigins();
        if (configured.includes("*") || configured.includes(origin))
          return callback(null, true);

        const sameOrigin = getRequestOrigin(req);
        if (origin === sameOrigin) return callback(null, true);

        callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods,
      allowedHeaders,
    });
    handler(req, res, next);
  };
}
