# Phase 103: Passthrough URLs — serve URL scheme (phase 2 of 2) — Pattern Map

**Mapped:** 2026-09-10
**Files analyzed:** 15 (5 modified, 10 created)
**Analogs found:** 14 / 15

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/backend/serve-url/subdomain-dispatch.ts` (NEW) | middleware | request-response | `src/backend/database/routes/pretty-view-fetch-host-file.ts` (routes.ts split-router pattern) | role-match |
| `src/backend/serve-url/tunnel-cache.ts` (NEW) | service | pub-sub (per-target cache) | `src/backend/ssh/ssh-connection-pool.ts` (Map-based cache) | role+flow |
| `src/backend/serve-url/proxy-factory.ts` (NEW) | service | streaming (HTTP+WS proxy) | `src/backend/guacamole/routes.ts:295-395` (SSH-tunneled proxy) | exact |
| `src/backend/serve-url/serve-route.ts` (NEW) | controller | request-response | `src/backend/database/routes/pretty-view-fetch-host-file.ts` | exact |
| `src/backend/serve-url/interstitial.ts` (NEW) | utility | request-response (HTML rendering) | `errorTextBody` in `pretty-view-fetch-host-file.ts` L524-550 | role-match |
| `src/backend/serve-url/header-audit-sampler.ts` (NEW) | utility | event-driven (structured logging) | `sshLogger.info` blocks in `pretty-view-fetch-host-file.ts` L379-395 | role-match |
| `src/backend/serve-url/tests/no-cookie-egress.integration.test.ts` (NEW) | test | integration | `src/backend/database/routes/user-avatars.integration.test.ts` | exact |
| `docker/Caddy.Dockerfile` (NEW) | config | build | `docker/Dockerfile` (multi-stage) | role-match |
| `substrate/skills/id/SKILL.md` (MODIFIED) | doc | — | existing file-URL section L843-932 | exact |
| `src/ui/features/pretty-view/editable-file-whitelist.ts` (MODIFIED) | utility | (regex export) | existing `SKYNET_FILE_URL_RE_CLIENT` L143-144 | exact |
| `src/backend/utils/editable-file-whitelist.ts` (MODIFIED) | utility | mirror | frontend mirror (Phase 78 mirror-rule) | exact |
| `src/backend/utils/auth-manager.ts` (MODIFIED) | service | (one-fn change) | `getSecureCookieOptions` L709-720 | exact |
| `src/backend/utils/cors-config.ts` (MODIFIED) | middleware | request-response | existing `createCorsMiddleware` L26-70 | exact |
| `src/backend/database/routes/host.ts` (MODIFIED) | controller | CRUD (host-add validation) | existing POST `/db/host` handler L122-244 | exact |
| `/opt/skynet/Caddyfile` (MODIFIED — deployed only, not in-repo) | config | — | existing Caddy config (referenced via `docker/docker-compose.yml:85`) | no analog in repo |

---

## Pattern Assignments

### `src/backend/serve-url/proxy-factory.ts` (NEW — service, streaming)

**Analog:** `src/backend/guacamole/routes.ts:295-395` — canonical `net.createServer` + `sshClient.forwardOut` + `sock.pipe(stream).pipe(sock)` pattern (referenced explicitly by CONTEXT.md D-16 and code_context "Guacamole reverse-proxy pattern").

**Core streaming tunnel pattern** (from `src/backend/guacamole/routes.ts:321-368`):
```typescript
const tunnelPort = await new Promise<number>((resolve, reject) => {
  const sshClient = new Client();
  sshClient.on("ready", () => {
    const server = net.createServer((sock) => {
      sshClient.forwardOut(
        "127.0.0.1",
        0,
        hostname,
        port,
        (err, stream) => {
          if (err) {
            sock.destroy();
            return;
          }
          sock.pipe(stream).pipe(sock);
        },
      );
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as net.AddressInfo;
      resolve(addr.port);
    });
  });
  sshClient.on("error", reject);
  // ... connectOpts including host, port, username, privateKey, ...
  sshClient.connect(connectOpts);
});
```

**Phase 103 additions on top of this pattern:**
- Use `withConnection(poolKey, () => connectOneShot(host, TIMEOUT), async (client) => {...})` from `src/backend/ssh/ssh-connection-pool.ts:214-225` INSTEAD of `new Client()` — Phase 103 MUST NOT open its own SSH clients (canonical_refs "Reusable Assets" + R&D GOTCHA 3).
- Wrap the `net.createServer` + `forwardOut` result in a `Map<"host:port", { server, port }>` cache — per R&D GOTCHA 2 "proxy instance MUST be cached per target".
- On top of the tunnel port, mount `createProxyMiddleware({ target, ws: true, on: { proxyReqWs: (proxyReq) => proxyReq.setHeader("sec-websocket-extensions", "") } })` — per R&D GOTCHA 1 (permessage-deflate strip; bake in from day one, not follow-up).
- Apply the **allowlist-strip** in `on.proxyReq` and `on.proxyReqWs` hooks: iterate `proxyReq.getHeaderNames()`, `proxyReq.removeHeader(h)` for every header NOT in the allowlist `["host", "connection", "upgrade", "sec-websocket-key", "sec-websocket-version", "sec-websocket-protocol", "content-type", "content-length"]`. Per D-04 (default-deny, everything stripped except explicit list; NO cookies, NO `Authorization`, NO `X-Skynet-*`).

**Pool-key pattern from `pretty-view-fetch-host-file.ts:249`:**
```typescript
const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
```
Phase 103 tunnel cache key uses `<hostname>:<port>` (the AGENT's port, not SSH port) — separate cache key from the SSH pool key.

**Alternative helper (higher-level):** `pipeTunnelStreams(inbound, outboundPromise, tunnelName)` from `src/backend/ssh/tunnel-ssh-primitives.ts:159-181` — same `inbound.pipe(outbound).pipe(inbound)` shape with error-destroy plumbing. Consider using instead of hand-rolling the pipe.

---

### `src/backend/serve-url/serve-route.ts` (NEW — controller, request-response)

**Analog:** `src/backend/database/routes/pretty-view-fetch-host-file.ts` — the Phase 78 file-URL sibling. Same auth wiring, same `resolveHostByName` call, same `permissionManager.canAccessHost` gate, same error taxonomy shape.

**Auth wiring pattern** (from `pretty-view-fetch-host-file.ts:108-113`):
```typescript
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();
```

**Auth+resolve+permission sequence pattern** (from `pretty-view-fetch-host-file.ts:200-240`, load-bearing D-17 REUSE):
```typescript
// 5. Host resolution (scoped to userId — cross-user isolation)
const host = await resolveHostByName(hostname, userId);
if (!host) {
  throw new Error("unknown_host");
}
// 6. Per-user-per-host RBAC
const accessInfo = await permissionManager.canAccessHost(
  userId,
  host.id,
  "read",
);
if (!accessInfo.hasAccess) {
  throw new Error("permission_denied");
}
```
Phase 103 uses this VERBATIM per D-17 ("Backend serve URL routing calls existing `resolveHostByName(name, userId)` … owned-only, matches Phase 78 file URL precedent"). Substitute `"read"` with the appropriate action word for serve access (planner picks — likely `"read"` since serve URL is HTTP proxy, not remote-exec).

**Error taxonomy pattern** (from `pretty-view-fetch-host-file.ts:474-514`, referenced in D-14 for interstitial mapping):
```typescript
function classifyErrorToStatus(err: unknown): number {
  const name = err instanceof Error ? err.name : "unknown";
  const msg = err instanceof Error ? err.message : "";
  if (name === "AbortError") return 504;
  if (msg === "invalid_hostname") return 400;
  if (msg === "unknown_host") return 404;
  if (msg === "permission_denied") return 403;
  // ...
  return 502;
}
```
Phase 103 error classes (per D-14 five failure classes): `port_not_listening`, `host_unreachable`, `permission_denied`, `ssh_failure`, `auth_missing`. The `auth_missing` class redirects to primary; the other four render Skynet-styled interstitials on the serve subdomain.

**Structured logging pattern** (from `pretty-view-fetch-host-file.ts:379-395`):
```typescript
sshLogger.info("pretty-view proxy: ok", {
  operation: "pretty_view_fetch_host_file",
  host: `${hostname}:sftp`,
  duration: Date.now() - startEpoch,
});
// ... on error:
sshLogger.warn("pretty-view proxy: sftp error", {
  operation: "pretty_view_fetch_host_file",
  host: `${hostname}:sftp`,
  errorClass: err instanceof Error ? err.name : "unknown",
  duration: Date.now() - startEpoch,
});
```
Phase 103 uses same `sshLogger` + `{ operation, host, duration, errorClass }` shape. Message strings use `"serve-url proxy: <verb>"`. `errorClass` never carries user-supplied bytes (info-leak invariant T-40-05).

**Router export pattern** (from `pretty-view-fetch-host-file.ts:563-577`, mounted in `src/backend/database/database.ts:1941-1942`):
```typescript
export const prettyViewFetchHostFileRoutes = express.Router();
prettyViewFetchHostFileRoutes.post("/fetch-host-file", express.json({ limit: "8kb" }), authenticateJWT, postHandler);
```
Phase 103 pattern: `serveUrlRoutes = express.Router()`, mounted with a subdomain-scoped middleware guard (see subdomain-dispatch.ts below). Do NOT mount as a URL-prefix router — the dispatch is HOST-header-based, not URL-path-based.

---

### `src/backend/serve-url/subdomain-dispatch.ts` (NEW — middleware, request-response)

**Analog:** Any middleware in `src/backend/utils/*.ts`; closest is `src/backend/utils/cors-config.ts` for the "top-of-stack express middleware factory" shape.

**Middleware factory pattern** (from `src/backend/utils/cors-config.ts:26-70`):
```typescript
export function createCorsMiddleware(
  methods: string[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  extraHeaders: string[] = [],
) {
  // ...
  return (req: Request, res: Response, next: NextFunction) => {
    const handler = cors({
      origin: (origin, callback) => {
        // ... decision logic ...
      },
      // ...
    });
    handler(req, res, next);
  };
}
```

**Serve-subdomain dispatch pattern (new for Phase 103):**
- Read `X-Skynet-Serve-Subdomain` header (set by Caddy via `header_up X-Skynet-Serve-Subdomain {host}` per R&D findings-summary L106).
- If header absent → `next()` (falls through to existing frontend serving — the "no route" experience per R&D "Fallback (unknown / no subdomain)").
- Parse per D-11: `const label = subdomain.split(".")[0]; const lastDash = label.lastIndexOf("-"); const port = label.slice(lastDash + 1); if (!/^\d+$/.test(port)) → 400 interstitial; const hostname = label.slice(0, lastDash);`
- Call `resolveHostByName(hostname.toLowerCase(), userId)` per D-13 (lowercase for lookup, display case preserved in DB).
- On resolve success → forward to `proxy-factory.ts` output for `<hostname>:<port>`.
- On any failure → render appropriate interstitial from `interstitial.ts`.

**Mount point:** `src/backend/database/database.ts` — insert BEFORE the existing frontend-static-serve router. Per canonical_refs "Backend serve-URL route → SSH tunnel → agent's local port — new dispatch layer plugged on top of existing SSH pool + guac tunnel pattern."

---

### `src/backend/serve-url/tunnel-cache.ts` (NEW — service, pub-sub cache)

**Analog:** `src/backend/ssh/ssh-connection-pool.ts` — the fleet's canonical Map-based cache with health-check + factory-on-miss + cleanup-interval pattern.

**Map-based cache pattern** (from `src/backend/ssh/ssh-connection-pool.ts:11-24`):
```typescript
class SSHConnectionPool {
  private connections = new Map<string, PooledConnection[]>();
  private maxConnectionsPerHost = 3;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup();
      },
      2 * 60 * 1000,
    );
  }
```

**Factory-on-miss pattern** (from `ssh-connection-pool.ts:41-87`):
```typescript
async getConnection(
  key: string,
  factory: () => Promise<Client>,
): Promise<Client> {
  let connections = this.connections.get(key) || [];
  const available = connections.find((conn) => !conn.inUse);
  if (available) { /* ... health check + reuse ... */ }
  if (connections.length < this.maxConnectionsPerHost) {
    const client = await factory();
    // ... push to map, wire end/close handlers ...
    return client;
  }
  // ... queue on next available ...
}
```

**Singleton export pattern** (from `ssh-connection-pool.ts:212`):
```typescript
export const connectionPool = new SSHConnectionPool();
```
Phase 103 tunnel-cache follows: `export const tunnelCache = new TunnelCache();` — single container-lifetime instance per D-16 ("Per-target proxy instances live for container lifetime; NO cache eviction built now").

**Deliberate DIVERGENCE from pool pattern per D-16:** NO `cleanup()` interval, NO eviction. Cache grows monotonically for container lifetime; entries only die when tunnel death is detected on next request (D-15 "transparent recovery on the next request"). This is a smaller cache than `ssh-connection-pool.ts` — copy the Map + factory-on-miss skeleton, omit `cleanupInterval` and `cleanup()`.

---

### `src/backend/serve-url/interstitial.ts` (NEW — utility, HTML rendering)

**Analog:** `errorTextBody` in `src/backend/database/routes/pretty-view-fetch-host-file.ts:524-550` — same "static human-readable strings per error class, NEVER include err.message" pattern (info-leak invariant T-40-05).

**Static-message-per-class pattern** (from `pretty-view-fetch-host-file.ts:524-550`):
```typescript
function errorTextBody(errorClass: string): string {
  switch (errorClass) {
    case "invalid_hostname":
      return "invalid_hostname: hostname contains characters outside [a-zA-Z0-9._-]";
    case "unknown_host":
      return "unknown_host: host is not registered in this Skynet or you do not have access to it";
    case "permission_denied":
      return "permission_denied: you do not have read access to this file on this host";
    case "ssh_timeout":
      return "ssh_timeout: the host is slow or unreachable — try again in a moment";
    case "host_unreachable":
    default:
      return "host_unreachable: the box may be offline or the SSH channel is down";
  }
}
```

**Phase 103 Skynet-styled HTML interstitials (per D-14):** one HTML template per failure class:
- `port_not_listening` → 502 + "port `<port>` of `<hostname>` isn't responding"
- `host_unreachable` → 502 + "`<hostname>` may be offline"
- `permission_denied` → 403 + "you don't have access to `<hostname>`"
- `ssh_failure` → 502 + "SSH tunnel to `<hostname>` failed to establish"
- `auth_missing` → 302 redirect to `https://term.<domain>/login?return=<original-url>` (per D-14: redirect to primary for re-auth)

Each HTML has:
- Skynet branding (share `<link rel="stylesheet">` with the primary Skynet interstitial pages if any exist — planner scouts).
- A plain "Try again" button (per specifics L145: NO auto-refresh — reload the page on click via `<a href="<original-url>">` or `<form action=... method=get>`).
- Info-leak invariant: NEVER include SSH error messages, stack traces, or absolute paths in the rendered HTML. Only the classified sentence + host + port.

**Content-Type**: `text/html; charset=utf-8`. Response headers: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff` (same defense set as `PLAIN_TEXT_HEADERS` from `pretty-view-fetch-host-file.ts:101-105`).

---

### `src/backend/serve-url/header-audit-sampler.ts` (NEW — utility, structured logging)

**Analog:** `sshLogger.info/warn` calls throughout `pretty-view-fetch-host-file.ts`; specifically the operation-tag + structured-context shape used across the codebase.

**Structured log emission pattern** (from `pretty-view-fetch-host-file.ts:379-395`):
```typescript
sshLogger.info("pretty-view proxy: ok", {
  operation: "pretty_view_fetch_host_file",
  host: `${hostname}:sftp`,
  duration: Date.now() - startEpoch,
});
```

**Header-fingerprint sampler pattern (new for Phase 103, per D-06):**
- Inside `proxy-factory.ts`'s `on.proxyReq`/`on.proxyReqWs` hooks, AFTER the allowlist-strip completes.
- Sample rate: log 100% of outbound requests during first hour post-deploy, then downsample to (e.g.) 1% via `Math.random() < 0.01`.
- Emit via `systemLogger.info("serve-url header audit", { operation: "serve_url_header_audit", target, headers: proxyReq.getHeaderNames() })`.
- ADDITIONALLY, on ANY header not in the allowlist appearing on outbound: emit at `warn` level with `operation: "serve_url_header_anomaly"`. This is the "second layer of defense" per D-06.

**Alert wiring**: distributor + fleet-status log pipeline already surfaces `warn`-level entries (grep for `fleet_substrate_item_failed` handling as precedent — logs surface via the existing console-forward-transport chain to Alice's dashboard).

---

### `src/backend/serve-url/tests/no-cookie-egress.integration.test.ts` (NEW — test, integration)

**Analog:** `src/backend/database/routes/user-avatars.integration.test.ts` — the canonical end-to-end lifecycle integration test in the codebase.

**Integration test structure pattern** (from `user-avatars.integration.test.ts:47-84`):
```typescript
import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
// ... real fs, real SQLite (in-memory), spy on DatabaseSaveTrigger.forceSave ...

let sqliteDb: InstanceType<typeof Database>;
const forceSaveFn = vi.fn<[string], Promise<void>>().mockResolvedValue(undefined);

// vi.mock for db and other modules with hoisted factory closures ...
```

**Phase 103 cookie-egress test structure (per D-05 mandatory):**
1. Stand up an echo-server upstream (Node http.createServer) that records EVERY inbound request's headers to a shared array.
2. Stand up the serve-url dispatch middleware + proxy-factory pointing at the echo server (via mocked SSH tunnel that returns a plain TCP socket to the echo server's localhost port).
3. Cases to enumerate (each an `it(...)` block):
   - `it("no Cookie header on GET")` — send GET with `Cookie: skynet_session=abc; Domain=term.example.com`; assert echo-recorded headers have NO `cookie`.
   - `it("no Cookie header on POST")` — same, POST with JSON body.
   - `it("no Cookie header on WebSocket upgrade")` — upgrade a WS with cookie; assert echo-recorded upgrade headers have NO `cookie`.
   - `it("no Cookie header on SSE stream")` — GET with `Accept: text/event-stream`; assert throughout stream lifetime.
   - `it("no Cookie header on multipart upload")` — POST multipart/form-data.
   - `it("no Cookie header on redirect follow")` — echo returns 302; follow redirect.
   - `it("no Authorization header egress")` — same enumeration for `Authorization: Bearer ...`.
   - `it("no X-Skynet-* header egress")` — same for `X-Skynet-User-Id: 123`.
4. Assertion helper: `expect(echoRecordedHeaders.cookie).toBeUndefined()` etc.

**MUST pass to merge (D-05).** Test file location: co-located with serve-url code per Phase 103 convention: `src/backend/serve-url/tests/no-cookie-egress.integration.test.ts`.

---

### `docker/Caddy.Dockerfile` (NEW — config, build)

**Analog:** `docker/Dockerfile` — Skynet's multi-stage builder pattern (5 stages).

**Multi-stage pattern** (from `docker/Dockerfile:1-30`):
```dockerfile
# Stage 1: Install dependencies
FROM node:22-slim AS deps
WORKDIR /app

# ... npm ci ...

# Stage 2: Build frontend
FROM deps AS frontend-builder
# ... npm run build ...
```

**Phase 103 custom Caddy Dockerfile (per D-19, direct from R&D findings-summary L82-87):**
```dockerfile
FROM caddy:2-builder AS builder
RUN xcaddy build --with github.com/caddy-dns/route53
FROM caddy:2
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
```

**Docker-compose update** (`docker/docker-compose.yml:77-87`, currently `image: caddy:2`):
Change to `build: { context: ., dockerfile: docker/Caddy.Dockerfile }` OR keep image reference and add a separate `docker build -t skynet-caddy:local -f docker/Caddy.Dockerfile .` step in the deploy motion. Planner picks. Existing volumes stay: `${SKYNET_HOST_DIR:-/opt/skynet}/Caddyfile:/etc/caddy/Caddyfile:ro`.

**AWS SDK config (per R&D findings-summary L282-292):** Additional volume mount `~/.aws/config:/root/.aws/config:ro` and env `AWS_PROFILE=caddy`, `AWS_REGION=us-east-1`. user-side host `.aws/config` contents:
```
[profile caddy]
role_arn = arn:aws:iam::<personal-aws-account>:role/<caddy-route53-role>
credential_source = Ec2InstanceMetadata
region = us-east-1
```

---

### `substrate/skills/id/SKILL.md` (MODIFIED — doc)

**Analog:** existing "Sending files to the user" section at `substrate/skills/id/SKILL.md:843-932` (Phase 78 file-URL rewrite).

**Existing file-URL guidance pattern** (from L843-864):
```markdown
## Sending files to the user

When the user asks for a file — a diff, an artifact, a log, a screenshot, a built
output — the canonical way is to cite it as a **Skynet passthrough file URL** that
Skynet renders with a pencil affordance in her chat view. Click → modal → view /
edit → save-attaches-to-her-next-message. Two flavors, pick by size:

**Small text (< ~5 KB)** — a short diff, a config snippet, a stack trace, a JSON
blob — just paste it inline in a code block.

**Anything larger, or binary** — cite the file as a **Markdown-formatted Skynet
file URL** so it's clickable in her chat (and openable in the editable-file
modal Skynet renders around it). Grammar:

    <skynet-parent>/file/<hostname>/<absolute-path>
```

**Phase 103 rewrite (per D-25, D-26, D-27):**
- REPLACE the whole L843-932 section (do NOT append; per D-27 "DELETE the old tailnet-HTTP-server recipe entirely — no dual-path").
- New framing per D-26: "active vs passive"
  - *Active* = something running on the other end (dev server, jupyter, WS stream, static server for multi-file content) → serve URL
  - *Passive* = bytes on disk (a doc, screenshot, log, config, downloadable binary) → file URL
  - Rule of thumb: "Do you need something running on the other end for the user to have the right experience?"
- Retain the existing file-URL bash recipe (L865-884) verbatim — Phase 78 shipped this and Phase 103 keeps it.
- Add a NEW serve-URL sub-section paralleling the file-URL one:
  - Grammar: `<hostname>-<port>.serve.<term-parent>` where `<term-parent>` is derived from `~/.claude/skynet-parent` (strip protocol, then prepend `<hostname>-<port>.serve.`).
  - Bash recipe: construct URL from `~/.claude/skynet-parent` + `~/.claude/skynet-hostname` + agent-chosen port.
  - Example: `https://t1000-3020.serve.term.example.com`
- Retain the L922-932 "Why we replaced tailnet HTTP-server" reasoning but expand to cover both URL schemes.
- NO auto-serve heuristics guidance per D-28 (agents-aren't-lied-to).

**Distributor push:** the `id-skill` catalog entry at `src/backend/distributor/catalog.ts:101-107` already points at `/app/fleet-substrate/skills/id/SKILL.md`. The bundled source is copied via `Dockerfile:80` (`COPY --chown=node:node substrate /app/fleet-substrate`). Modifying `substrate/skills/id/SKILL.md` in-repo IS the push mechanism — rebuild + deploy triggers a distributor sweep on next cycle; agents pick up on next `/id <name>` load.

---

### `src/ui/features/pretty-view/editable-file-whitelist.ts` (MODIFIED — utility, regex export)

**Analog:** existing `SKYNET_FILE_URL_RE_CLIENT` export at L143-144 (Phase 78's sibling regex — Phase 103 adds a THIRD sibling).

**Sibling regex pattern** (from L96-97 and L143-144):
```typescript
// Tailnet URL (Phase 40)
export const TAILNET_URL_RE_CLIENT =
  /http:\/\/100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}:\d{1,5}\/[^\s)]+/g;

// File URL (Phase 78 D-01)
export const SKYNET_FILE_URL_RE_CLIENT =
  /https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?\/file\/[a-zA-Z0-9._-]+\/[^\s)?#]+/g;
```

**Phase 103 addition (per D-29 + Claude's Discretion "Exact regex shape … — mirror `TAILNET_URL_RE_CLIENT` and the file-URL regex"):**
```typescript
// Serve URL (Phase 103 D-01) — <hostname>-<port>.serve.term.<domain>/path
// Grammar: hostname (any DNS-legal characters except dash-terminal), literal
// "-", digit port, literal ".serve.term.", any DNS-legal parent domain,
// optional path.
export const SKYNET_SERVE_URL_RE_CLIENT =
  /https:\/\/[a-zA-Z0-9._-]+-\d{1,5}\.serve\.term\.[a-zA-Z0-9.-]+(?::\d{1,5})?(?:\/[^\s)?#]*)?/g;
```

**⚠️ Same /g gotcha as siblings (see L89-91, L125-131):** NEVER `.test()` on this regex; use `.match()` (stateless) for message-scanning, or a fresh non-global regex for dispatch decisions.

**Extension to `use-editable-file-eligibility.ts` (L86-97):** For serve URLs, do NOT run through the eligibility byte-sniff loop — serve URLs render as PLAIN clickable links per D-29 (no edit-file affordance). The eligibility hook returns `Set<string>` of edit-eligible URLs only. Serve URLs get handled by a separate render path in `ChatMessage.tsx` (regex match + plain `<a>` render).

**PLANNER NOTE:** the frontend surface for D-29 is minimal. Confirm ChatMessage.tsx's ReactMarkdown `<a>` override doesn't inadvertently hide serve URLs — they should render as normal clickable anchors, distinct from the file-URL pencil affordance.

---

### `src/backend/utils/editable-file-whitelist.ts` (MODIFIED — utility, mirror)

**Analog:** backend mirror pattern — see extensive mirror-rule docblock at L1-27 explaining the byte-identical whitelist DATA rule.

**Mirror-rule bookkeeping pattern** (from L16-27, updated for Phase 78):
```typescript
/*
 *   PHASE 75 D-01 MIRROR-RULE UPDATE (2026-09-06): the frontend twin has
 *   gained a second URL regex `SKYNET_FILE_URL_RE_CLIENT` (sibling to
 *   `TAILNET_URL_RE_CLIENT`) matching the new file-URL shape
 *   `https://<domain>[:port]/file/<hostname>/<abs-path>`. This backend twin
 *   does NOT re-export that regex — the backend route ... does its own
 *   hostname + path validation with `/^[a-zA-Z0-9._-]+$/` and explicit
 *   prefix/traversal checks. Same rationale as `TAILNET_URL_RE_CLIENT` being
 *   client-only. The whitelist DATA … remains mirrored in lockstep as before.
 */
```

**Phase 103 update (append to docblock):**
Add a new PHASE 103 mirror-rule paragraph documenting that `SKYNET_SERVE_URL_RE_CLIENT` is also client-only (same rationale: the backend validates the URL via the subdomain-dispatch middleware's own parse logic per D-11, not by regex re-application). The whitelist DATA (`EDITABLE_EXTENSIONS`, `EDITABLE_BASENAMES`, `classifyByExtension`) remains mirrored — this file's DATA does NOT change for Phase 103.

**Actual code change:** docstring-only. No functional code changes to this file.

---

### `src/backend/utils/auth-manager.ts` (MODIFIED — one-function change)

**Analog:** existing `getSecureCookieOptions` at L709-720 (called out explicitly by CONTEXT.md D-02 and code_context).

**Existing function** (L709-720):
```typescript
getSecureCookieOptions(
  req: RequestWithHeaders,
  maxAge: number = 24 * 60 * 60 * 1000,
) {
  return {
    httpOnly: true,
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    sameSite: "lax" as const,
    maxAge: maxAge,
    path: "/",
  };
}
```

**Phase 103 modification (per D-02):**
```typescript
getSecureCookieOptions(
  req: RequestWithHeaders,
  maxAge: number = 24 * 60 * 60 * 1000,
) {
  const skynetDomain = process.env.SKYNET_COOKIE_DOMAIN; // e.g. "term.example.com"
  return {
    httpOnly: true,
    secure: req.secure || req.headers["x-forwarded-proto"] === "https",
    sameSite: "lax" as const,
    maxAge: maxAge,
    path: "/",
    ...(skynetDomain ? { domain: skynetDomain } : {}),
  };
}
```

**Corresponding `getClearCookieOptions` at L722-729** also needs the same `domain` addition — otherwise clearing the cookie leaves the widened-domain version in place. Same modification pattern.

**Env-var vs hardcoded:** use `process.env.SKYNET_COOKIE_DOMAIN` so t1000 vs T800 vs future customer VMs can each set their own value (per D-23 T800 handles its own config; per D-19 t1000 sets `term.example.com`). The env-var goes into `/opt/skynet/skynet.env` on t1000 during the same deploy motion (D-24 "Single deploy — Caddy image rebuild + cookie widen + subdomain routing + agent URL construction all live in one atomic ship motion").

---

### `src/backend/utils/cors-config.ts` (MODIFIED — middleware, request-response)

**Analog:** existing `createCorsMiddleware` function itself at L26-70 — extending its `origin` callback.

**Existing origin-callback pattern** (from L42-63):
```typescript
return (req: Request, res: Response, next: NextFunction) => {
  const handler = cors({
    origin: (origin, callback) => {
      // No origin = same-origin or non-browser request (curl, internal service calls)
      if (!origin) return callback(null, true);
      // Requests coming from localhost (nginx proxy, internal service calls)
      if (isLocalRequest(req)) return callback(null, true);
      if (DEV_ORIGINS.includes(origin)) return callback(null, true);
      if (origin.startsWith(ELECTRON_FILE_ORIGIN)) return callback(null, true);
      const configured = getAllowedOrigins();
      if (configured.includes("*") || configured.includes(origin))
        return callback(null, true);
      const sameOrigin = getRequestOrigin(req);
      if (origin === sameOrigin) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    // ...
  });
  handler(req, res, next);
};
```

**Phase 103 modification (per D-07):**
Add an EXPLICIT REJECT check BEFORE the existing accept checks:
```typescript
// Phase 103 D-07: primary domain refuses CORS for any *.serve.term.<domain> origin.
// This blocks CSRF from serve subdomains at the browser preflight layer for any
// state-changing endpoint requiring preflight (JSON POST/PUT/DELETE/PATCH/custom-header).
const SERVE_SUBDOMAIN_RE = /^https:\/\/[^/]+\.serve\.term\.[a-zA-Z0-9.-]+$/;
// ...
origin: (origin, callback) => {
  if (!origin) return callback(null, true);
  // Phase 103: explicit reject FIRST — before any accept check.
  if (SERVE_SUBDOMAIN_RE.test(origin)) {
    return callback(new Error("Not allowed by CORS (serve subdomain origin)"));
  }
  // ... existing accept checks unchanged ...
}
```

**⚠️ Regex order-of-operations invariant:** the reject MUST fire before the `getRequestOrigin(req)` same-origin check — otherwise if a request from `foo-3000.serve.term.example.com` somehow shares the same host header the same-origin path could accidentally accept it. Explicit deny always wins.

---

### `src/backend/database/routes/host.ts` (MODIFIED — controller, CRUD validation)

**Analog:** existing POST `/db/host` handler at L122-244 (the host-add code path referenced by D-12).

**Existing validation pattern** (from L239-244):
```typescript
if (
  !isNonEmptyString(userId) ||
  !isNonEmptyString(ip) ||
  !isValidPort(port)
) {
  sshLogger.warn("[host-db] create-host-validation-failed", {
    operation: "host_create",
    userId,
    error: err,
  });
  return res.status(400).json({ error: "..." });
}
```

**Phase 103 addition (per D-12):**
Add a NEW validation rejecting hostnames ending in `-\d+` (which would collide with the serve-URL parse rule per D-11). Insert AFTER the existing `isNonEmptyString(userId) / isNonEmptyString(ip) / isValidPort(port)` block:
```typescript
// Phase 103 D-12: hostname registration constraint. A hostname ending in
// -<digits> would be ambiguous with the serve URL grammar
// (<hostname>-<port>.serve.term.<domain>) which splits on the LAST dash of
// the leftmost label. Reject at registration time so the ambiguity never
// enters the DB. Current fleet passes this check (thenasty, workstation,
// linux-beelink, aither-cloud, aither-cloud2, aither-sftp, t1000, t800,
// WINDOWS-PC, ZoeyBattlestation).
if (typeof name === "string" && /-\d+$/.test(name)) {
  sshLogger.warn("[host-db] host-name-collision-with-serve-url-grammar", {
    operation: "host_create",
    userId,
    name,
  });
  return res.status(400).json({
    error: "Hostname cannot end in -<number> (reserved for serve URL grammar)",
  });
}
```

**⚠️ Host-record trap (from CONTEXT.md code_context "Host record trap"):** editing a host's protocol/RDP tab nulls its SSH key. This validation is on the CREATE code path only — not PUT. If Phase 103 also applies the constraint to PUT, ensure the validation happens BEFORE any field-nulling logic. Planner check.

**⚠️ Enable-flags trap (from CONTEXT.md code_context):** `enableSsh` / `enableRdp` / `enableTerminal` are load-bearing on any PUT. This new validation MUST NOT accidentally touch enable flags — it's a name-shape check only.

**DB-write forceSave check (from CONTEXT.md code_context "In-memory SQLite `forceSave` rule"):** the host-add flow already writes to DB and thus already invokes `DatabaseSaveTrigger.forceSave`. New validation is a REJECT-BEFORE-WRITE — no additional forceSave needed.

**Tests:** grep for `host.test.ts` existing test cases on the create path; add cases for `name = "foo-42"` → 400, `name = "foo-bar"` → 200 (no digit suffix), `name = "t800"` → 200 (no dash), `name = "aither-cloud2"` → 200 (dash + non-terminal digit ok — the check is `-\d+$` anchored to end).

---

## Shared Patterns

### Auth wiring (applied to all backend routes in Phase 103)

**Source:** `src/backend/utils/auth-manager.ts` + `src/backend/utils/permission-manager.ts`

**Apply to:** `serve-route.ts`, `subdomain-dispatch.ts`, `host.ts` (already has it), integration test setup.

```typescript
import { AuthManager } from "../utils/auth-manager.js";
import { PermissionManager } from "../utils/permission-manager.js";

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();
```

The JWT check MUST run at the edge on `*.serve.term.<domain>` requests BEFORE the tunnel is opened (per D-03). The `authenticateJWT` middleware reads the cookie (now with widened domain per D-02) and populates `req.userId`.

### Structured logging (applied to all backend files in Phase 103)

**Source:** `src/backend/utils/logger.ts` — `sshLogger`, `systemLogger`, `databaseLogger` named loggers.

**Apply to:** all backend serve-url files.

```typescript
import { sshLogger, systemLogger } from "../utils/logger.js";

// Success
sshLogger.info("serve-url proxy: ok", {
  operation: "serve_url_proxy",
  target: `${hostname}:${port}`,
  duration: Date.now() - startEpoch,
});

// Failure
sshLogger.warn("serve-url proxy: error", {
  operation: "serve_url_proxy",
  target: `${hostname}:${port}`,
  errorClass: err instanceof Error ? err.name : "unknown",
  duration: Date.now() - startEpoch,
});
```

**Info-leak invariant (T-40-05):** `err.message`, absolute paths, and user-supplied bytes NEVER appear in log messages or response bodies. Only classified error-class strings + hostname + port + duration.

### SSH connection pool reuse (applied to proxy-factory and any SSH usage)

**Source:** `src/backend/ssh/ssh-connection-pool.ts` L214-225 `withConnection` helper.

**Apply to:** `src/backend/serve-url/proxy-factory.ts` (per canonical_refs "Reusable Assets" + R&D GOTCHA 3 "Reuse this pool for the serve URL feature; do not create yet another pool").

```typescript
import { withConnection } from "../ssh/ssh-connection-pool.js";
import { connectOneShot } from "../ssh/ssh-one-shot.js";

const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
const result = await withConnection(
  poolKey,
  () => connectOneShot(host, SSH_CONNECT_TIMEOUT_MS),
  async (sshClient) => {
    // ... use sshClient.forwardOut(...) here ...
  },
);
```

**⚠️ Do NOT `new Client()` in Phase 103 code.** Every SSH interaction goes through the pool. This gives ~30 concurrent channels per host (3 conns × 10 MaxSessions) per R&D GOTCHA 3 — plenty for realistic serve-URL loads.

### Host resolution (applied to serve-route and subdomain-dispatch)

**Source:** `src/backend/ssh/host-resolver.ts:373-388` `resolveHostByName(name, userId)`.

**Apply to:** any Phase 103 code that needs to look up a host by name.

```typescript
import { resolveHostByName } from "../ssh/host-resolver.js";

// D-13 lowercase-for-lookup:
const host = await resolveHostByName(hostname.toLowerCase(), userId);
if (!host) {
  // D-11: reject with 400 on parse failure, 404 on unknown host
  throw new Error("unknown_host");
}
```

Per D-17: owned-only lookup. The `resolveHostByName` implementation filters `and(eq(hosts.name, name), eq(hosts.userId, userId))` per line 383 — cross-user isolation is baked in. Grants (`hostAccess`) are deliberately out of scope for name resolution.

**Display-case preservation (D-13):** `resolveHostByName` returns `host.name` as stored in the DB (mixed case preserved). Phase 103 code does the lowercase transformation only on the LOOKUP input, not on the stored DB value. Currently the resolver uses `eq(hosts.name, name)` — this is CASE-SENSITIVE by default in SQLite. Per D-13 planner MUST swap to `LOWER(hosts.name) = LOWER($input)` OR the subdomain-dispatch middleware pre-lowercases (whichever the planner picks; recommendation: pre-lowercase at dispatch to avoid modifying the shared resolver used by Phase 78).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `/opt/skynet/Caddyfile` (deployed only) | config | — | Deployed-config file, not in-repo. Only `docker/docker-compose.yml:85` references its mount path. Planner writes the wildcard site block + bare-redirect block AS AN ARTIFACT under phase directory (e.g. `Caddyfile.serve-url-additions.snippet`) for Alice to append to `/opt/skynet/Caddyfile` during the deploy motion. R&D findings-summary L91-104 shows the exact block shape. |

---

## Metadata

**Analog search scope:** `src/backend/`, `src/ui/features/pretty-view/`, `docker/`, `substrate/skills/`.

**Files scanned:** ~35 (routes, middleware, SSH pool, guacamole, docker files, substrate skill).

**Pattern extraction date:** 2026-09-10

**Key patterns identified:**
- All backend Phase 103 code uses `AuthManager.getInstance()` + `PermissionManager.getInstance()` singletons for auth wiring — no per-route factory divergence.
- SSH tunneling uses `withConnection(poolKey, factory, fn)` from `ssh-connection-pool.ts` — NEVER `new Client()`. Enforced by R&D GOTCHA 3.
- Reverse-proxy pattern is `net.createServer(...) + sshClient.forwardOut(...) + sock.pipe(stream).pipe(sock)` per `guacamole/routes.ts:295-395`. Higher-level helper `pipeTunnelStreams` from `tunnel-ssh-primitives.ts:159` is a viable simplification.
- Frontend-backend URL-regex mirror rule: any new URL regex goes in `src/ui/features/pretty-view/editable-file-whitelist.ts` client-only; backend uses its own explicit parse (not regex). Backend twin `src/backend/utils/editable-file-whitelist.ts` gets a docblock-only update noting the new frontend regex exists.
- All error responses use classified error-class strings (never `err.message`) — info-leak invariant T-40-05 inherited from Phase 40 + Phase 78.
- Structured logs use `{ operation: "<snake_case_tag>", ... }` context; `warn` for classified errors, `info` for success, `error` reserved for unexpected/uncaught.
- Router mount pattern: split narrow routers (one router per method+path family), mounted in `src/backend/database/database.ts` — but Phase 103's subdomain-dispatch is HOST-based, NOT URL-prefix-based, so it mounts as top-of-stack middleware in `database.ts` BEFORE the existing frontend static-serve router.
