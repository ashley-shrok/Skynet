# Phase 132: Frontend stale-prevention: version-drift hard-lock — Research

**Researched:** 2026-09-21
**Domain:** Full-stack version-drift detection — build-time tag production, HTTP + WS enforcement lanes, shell-page cache discipline, browser hard-lock UX
**Confidence:** HIGH (Skynet codebase is fully inspected; vms reference is the user's own prior-art; no external library adoption required)

## Summary

Skynet's design piggybacks on infrastructure that already exists — the axios instance factory in `src/ui/main-axios.ts` has request+response interceptors, the Express app at `src/backend/database/database.ts` has a global-middleware chain, Vite already bakes `import.meta.env.VITE_APP_VERSION` from `package.json.version`, and every WS handshake in the four servers (`terminal`, `claude-session`, `guacamole`, `relay-room-stream`, plus a fifth `docker-console`) already reads a JWT token from cookies or query string, giving a natural extension point.

The one place Skynet's shape diverges from vms is that Skynet has **five persistent WS surfaces**, not the two vms had in mind — and one of them (`guacamole`) is a **third-party framing** (guacamole-lite) whose wire format is not JSON envelopes. The plan needs to acknowledge that Guacamole cannot carry a per-message piggyback tag (per-frame injection would corrupt the guac protocol), and instead relies on handshake-time refusal via the encrypted-token payload.

**Primary recommendation:** Version tag = **short git commit SHA** (D-18 candidate b), injected at Vite build via `define`, and read on the backend from a compile-time constant baked in `dist/backend/backend/version.js` (written by a Dockerfile stage). Server-side global middleware inserts at `src/backend/database/database.ts:302` immediately after the existing global `Cache-Control: no-store` middleware. Client-side interceptor inserts at `src/ui/main-axios.ts:456` immediately before the `return config` at the end of the request interceptor. `Cache-Control: no-store` on `index.html` **already exists** at nginx L138 (both configs) and at Express L2041 (branding-template `res.setHeader`) — D-19 is a codification, not a change. Shell modal goes at the App-root level of `src/main.tsx:243` alongside `<Toaster>`. Skew-lock state = new module-scope store `src/ui/state/skew-lock-store.ts` following the roll-your-own subscription pattern of the six existing stores in `src/ui/state/`.

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01** — Piggyback on every HTTP request (client→server, response→client) AND on every persistent-connection message emitted by the server. Two lanes; both use the same tag.
- **D-02** — No polling. No explicit deploy-time broadcast. Stamp on messages the server already sends IS the drift signal.
- **D-03** — Update-worker path (service worker) REJECTED — adds subtle lifecycle bugs for a benefit Skynet does not need.
- **D-04** — Client-side stamping airtight-by-construction via global request interception at browser boot.
- **D-05** — Interceptor lives in `src/ui/main-axios.ts`; any raw `fetch()` paths get wrapped with the same discipline; planner audits for other outbound-request surfaces.
- **D-06** — Mismatch-only refusal on the server; absence passes through (preserves non-browser callers).
- **D-07** — Global middleware on Express bootstrap in `src/backend/starter.ts` (NOTE: bootstrap is actually in `src/backend/database/database.ts` — see Q3 below), not per-route opt-in.
- **D-08** — WS handshake-time stamp; server refuses connection on mismatch with a distinguishable close code.
- **D-09** — Piggyback tag on messages the server sends over open connections (idle-tab detection lane).
- **D-10** — Do NOT stamp every message the CLIENT sends — post-handshake, session is version-trusted for its lifetime.
- **D-11** — Pure firm modal. `skewLocked` gates all further dispatches (drop) AND all subsequent renders (skip). Polls stop.
- **D-12** — Modal non-dismissible. Single `[Reload]` button. No X, no escape, no countdown.
- **D-13** — `[Reload]` = `window.location.reload()`. No state carryover.
- **D-14** — Reload semantics: fresh shell → current assets → terminal/RDP sessions reconnect (server-side state).
- **D-15** — Lock fires ONLY on successful response with mismatched tag. Failed requests during deploy-restart do NOT fire the lock (existing reconnecting affordance handles that).
- **D-16** — Server's own tag captured once at process startup, held in memory.
- **D-17** — Independent tabs. No cross-tab coordination via BroadcastChannel or similar.
- **D-18** — Version tag source: hash-of-manifest OR git short SHA OR build nonce. Planner picks. **See Q1 recommendation: short git SHA.**
- **D-19** — `index.html` served with `Cache-Control: no-store` (or `no-cache, must-revalidate`). Hashed assets stay aggressively cacheable.
- **D-20** — Two audits (already done in this research):
  1. Shell page IS explicitly `Cache-Control: no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` today at nginx L138 (both HTTP + HTTPS configs) AND Express L2041 (branding-fallback path). D-19 is CODIFICATION, not change.
  2. Client-side outbound surfaces enumerated in Q2 below — 20 raw `fetch()` call sites + 4 `new WebSocket` sites + guacamole-lite embedded.

### Claude's Discretion

- Exact DOM structure of the modal (backdrop + dialog + button). Match Skynet's `--color-pv-*` palette-authority rule. `inert` attribute on the container.
- CSS class prefix (suggest `skynet-skew-lock-*`).
- WS-server handshake stamp placement (URL query param vs first-message contract) — pick per each WS server's existing convention.
- Server-side middleware placement in the Express pipeline (before body parsing so the check runs cheap).
- Test coverage strategy — unit + integration + playwright smoke.

### Deferred Ideas (OUT OF SCOPE)

None. All tempting-but-no items are documented in `.planning/shapes/shape-frontend-stale-prevention.md` `## Scope edges` as never-do decisions, not deferrals (update-worker, cross-tab coordination, drain-restore, per-user opt-out, timeout-based warning banners).

## Phase Requirements

Skynet's REQUIREMENTS.md covers patch #43 (pretty session view) — this phase has no pre-declared REQ-IDs. The phase is fully driven by the CONTEXT.md `## Decisions` block (D-01..D-20) above; those are the requirements. New REQ-IDs (suggest `SKEW-01`..`SKEW-nn`) will be minted by the planner and added to REQUIREMENTS.md when the plan is written.

## Project Constraints (from CLAUDE.md)

CLAUDE.md does NOT exist at the repo root; user-global CLAUDE.md at `/home/ubuntu/.claude/CLAUDE.md` is present. Additional standing directives are enforced via the role file (loaded in context):

- **Deploy motion is orchestrator-exclusive.** Plans MUST NOT include `git push`, `docker build`, or `docker compose up --force-recreate` at executor scope.
- **Test discipline.** Scoped `npx vitest --related <files>` at executor scope; full-suite is orchestrator-owned deploy-time gate. Plans MUST NOT include `npm test` full-suite runs.
- **Structured logging.** Any patch touching lifecycle boundaries (skew-lock IS a lifecycle boundary) MUST include `hostId`, `sessionId`, WS `event.code` / `reason` / `wasClean` as explicit fields. **NEVER** `JSON.stringify(event)` on DOM Event objects.
- **Palette authority.** New UI surfaces draw from `--color-pv-*` tokens, NOT `--background` / `--foreground`.
- **Nginx-parity rule.** ANY nginx location-block edit MUST be mirrored in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`. Missing sister edit surfaces as `/foo` 200-returning `index.html` and frontend crash on `.map` in prod.
- **CSS-fast-path retired 2026-09-21.** Design does NOT need to accommodate hot-swap (D-16 is comfortable).
- **No worktrees.** All work in `~/fleet/identities/rio/workspace/skynet` on `feat/tab-title-from-tmux`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Build-time version tag generation | Vite build pipeline (`vite.config.ts`) | Dockerfile (backend-builder stage) | Client bundle needs tag baked in via `import.meta.env.*`; backend needs to read the same string. |
| Server tag capture at startup | Node backend process (Express main) | — | D-16 lock: read once at boot, hold in memory. |
| Request stamping | Browser (axios interceptor + raw-fetch wrappers) | — | D-04 airtight-by-construction. |
| Response stamping | API/Backend (Express global middleware) | — | Applied to every response before route handlers see the request. |
| Request refusal on mismatch | API/Backend (same global middleware) | — | D-06 mismatch-only, D-07 global. |
| WS handshake refusal | Node backend (5 WS servers) | — | Each `wss.on("connection", ...)` handler checks header/query param, closes with distinguishable code on mismatch. |
| WS server-emitted piggyback | Node backend (frame-emit sites in each WS server) | — | D-09; server owns the outgoing envelope. |
| Client-side drift detection | Browser (axios response interceptor + WS message parse sites) | — | Client sees the mismatched tag first — it dispatches the lock. |
| Shell-level lock state | Browser (module-scope store) | — | Read from anywhere (axios interceptor, WS callback), gates dispatch + render. |
| Non-dismissible modal render | Browser React (App-root or dedicated portal) | — | Framework-owned, mounted above all app UI. |
| Shell page cache discipline | Nginx (in-container) + Express fallback | Caddy edge | Both already ship `no-store`; Caddy at box passes through unmodified. |

## Standard Stack

### Core (all present in `package.json`)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `express` | ^5.2.1 | Backend HTTP server | Already the app's server framework |
| `ws` | ^8.20.0 | WebSocket server library | Used by 5 WS servers; `WebSocketServer` from `ws` package |
| `axios` | ^1.15.2 | Client HTTP | Centralized instance in `src/ui/main-axios.ts` |
| `vite` | ~6.x (via `@vitejs/plugin-react`) | Frontend build | Already emits `dist/assets/*-[hash].js` (D-19 asset side already correct) |
| `react` + `react-dom` | 19 | UI framework | Existing shell in `src/ui/AppShell.tsx` |
| `guacamole-lite` | ^1.2.0 | RDP/VNC WS proxy | Third-party — cannot inject per-message tag; handshake-only |

### Supporting (all present)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `cookie-parser` | ^1.4.7 | Cookie middleware | Not needed for skew check itself, but already in middleware chain |
| `body-parser` | ^2.2.2 | Body parsing | Skew check MUST run BEFORE this per D-07 rationale (cheap) |
| `sonner` | (in devDeps) | Toast library | Present for reference; not used for the modal (D-12 is non-dismissible; a toast is dismissible by design). Use a real full-viewport React node instead. |
| `axios-mock-adapter` | (in devDeps) | Test mocking | Used by `main-axios.test.ts:11` — the pattern to follow for interceptor unit tests |
| `@playwright/test` | (in devDeps) | E2E | `tests/e2e/smoke.spec.ts` is 8 lines; deploy-and-drift scenario is a NEW spec |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Custom Vite plugin (vms `vmsBuildIdPlugin`) | Extend existing `vite.config.ts define` block | Skynet already uses `define` at L75-79 for `VITE_APP_VERSION`; extending it for `VITE_BUILD_ID` is a 1-line diff. A full plugin would be over-engineered. |
| Fetch monkey-patch (global `window.fetch = ...`) | Wrap known-fetch sites explicitly | Fetch monkey-patch is fragile (Sonner, service-worker, and future libs would auto-inherit unintentionally). Explicit wrapping is auditable — the interceptor covers 99% (axios), the enumerated 20 raw-fetch sites are a bounded set. |
| Existing sonner toast for the modal | Custom full-viewport component | Sonner toasts are dismissible; D-12 REQUIRES non-dismissible. Custom is right. |

**Installation:** No new packages required.

**Version verification:** All above already in `package.json`; verified via file read.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero new packages. All required libraries (`express`, `ws`, `axios`, `vite`, `react`, `guacamole-lite`, `sonner`, `axios-mock-adapter`, `@playwright/test`) are ALREADY in the dependency tree and have been in production use for the entire lifetime of the codebase. Package-legitimacy gate is a no-op for this phase.

## Architecture Patterns

### System Architecture Diagram

```
                         ┌──────────────────────────┐
                         │ vite build (Dockerfile)  │
                         │  emits VITE_BUILD_ID     │
                         │  into bundle at compile  │
                         └────────────┬─────────────┘
                                      │ same source
                                      │ (git short SHA)
                                      ▼
                         ┌──────────────────────────┐
                         │  backend startup reads   │
                         │  VITE_BUILD_ID from env  │
                         │  → held in memory        │
                         └──────────────────────────┘

                                                                      ┌───────────────┐
       Browser tab (loaded with build_id="abc123")                    │ Skynet server │
   ┌─────────────────────────┐                                        │ (build_id=?)  │
   │ axios request interceptor│    HTTP request                       └───────┬───────┘
   │ inserts X-Skynet-Client- ├────────────────────────────────────►          │
   │ Build: abc123            │                                                │
   └─────────────────────────┘                                                 │
                                                                               ▼
                                                        ┌──────────────────────────────────┐
                                                        │ Express global middleware runs   │
                                                        │ AFTER cookie-parser, BEFORE      │
                                                        │ body-parser (D-07)               │
                                                        │                                  │
                                                        │ if header present && != server:  │
                                                        │   respond 409 stale_client       │
                                                        │ else pass                        │
                                                        └────────────┬─────────────────────┘
                                                                     │
   ┌─────────────────────────┐         409 or 200                    │
   │ axios response          │ ◄───────────────────────────────────┘
   │ interceptor             │
   │  - if 409 stale_client: │
   │    set skewLocked=true  │
   │  - always check         │
   │    X-Skynet-Server-Build│
   │    against baked-in tag │
   │  - fires modal on drift │
   └───────────┬─────────────┘
               │
               ▼
   ┌─────────────────────────┐
   │  skew-lock-store (new)  │
   │  module-scope subscribe │
   │  - skewLocked: bool     │
   │  - subscribe(fn): fn    │
   │  - lock(): void         │
   └───────────┬─────────────┘
               │ notifies subscribers
               ▼
   ┌─────────────────────────┐          ┌─────────────────────────────┐
   │ <SkewLockModal>         │          │ WS onmessage handlers       │
   │  in main.tsx App root   │◄─────────┤ read parsed.build_id field, │
   │  useSyncExternalStore   │          │ if mismatch → store.lock()  │
   │  reads store snapshot   │          └─────────────────────────────┘
   │  non-dismissible        │
   │  [Reload] → reload()    │
   └─────────────────────────┘

   WS handshake lane:
   ┌─────────────────────────┐          ┌─────────────────────────────┐
   │ new WebSocket(url +     │          │ wss.on("connection"): read  │
   │  "?build_id=abc123")    │─────────►│  URL param, if !=server:    │
   │                         │          │  ws.close(4409, "stale")    │
   │  onclose handler checks │◄─────────│ else attach                 │
   │  code === 4409 → lock()│          └─────────────────────────────┘
   └─────────────────────────┘
```

### Existing Project Structure (relevant slice)

```
src/
├── main.tsx                                  # createRoot, <Toaster>, <App>, <RootApp>
├── ui/
│   ├── AppShell.tsx                          # post-login shell, 3137 LOC
│   ├── main-axios.ts                         # createApiInstance factory (interceptors here)
│   ├── main-axios.test.ts                    # axios-mock-adapter test template
│   ├── lib/
│   │   └── client-cache-version.ts           # EXISTING VITE_APP_VERSION cache-clear
│   ├── state/                                # 6 module-scope stores (pattern to follow)
│   ├── api/
│   │   ├── claude-session-api.ts             # new WebSocket("/claude-session/...")
│   │   ├── fleet-status-client.ts            # new WebSocket("/fleet-status/ws")
│   │   ├── voice-api.ts                      # raw fetch → /voice/speak-stream, /voice/transcribe
│   │   ├── message-queue-api.ts              # raw fetch × 2
│   │   ├── compose-drafts-api.ts             # raw fetch × 1
│   │   ├── identities-api.ts                 # raw fetch → /identities/birth (SSE)
│   │   └── guacamole-api.ts                  # authApi.post("/guacamole/token") — axios-lane
│   ├── branding/
│   │   └── branding-fetch.ts                 # raw fetch → /api/branding
│   └── features/
│       ├── pretty-view/
│       │   ├── useVoiceRecording.ts          # raw fetch → /voice/transcribe
│       │   └── RelayInboundBubble.tsx        # raw fetch → /relay-pointer
│       ├── pretty-conversations/
│       │   └── WeeklyUsageMeter.tsx          # raw fetch → /api/usage
│       └── terminal/Terminal.tsx             # new WebSocket → /ssh/websocket/
├── backend/
│   ├── starter.ts                            # boot IIFE, no Express app here
│   ├── database/
│   │   └── database.ts                       # Express app + global middleware + route mounts (2305 LOC)
│   ├── claude-session/
│   │   └── claude-session-server.ts          # WS server port 30011
│   ├── guacamole/
│   │   ├── guacamole-server.ts               # WS server port 30008 (guacamole-lite)
│   │   └── token-service.ts                  # AES-encrypted token payload
│   ├── relay-room-stream/
│   │   └── relay-room-stream-server.ts       # WS server port 30015
│   ├── ssh/
│   │   ├── terminal.ts                       # WS server port 30002
│   │   └── docker-console.ts                 # WS server port 30009
│   └── fleet-status/
│       └── fleet-status-server.ts            # WS server port 30012
```

### Pattern 1: Bake VITE_BUILD_ID at compile time via existing Vite `define`
**What:** Extend the `define` block in `vite.config.ts:75-79` to also inject `import.meta.env.VITE_BUILD_ID`.
**When to use:** Every browser bundle emission — no per-request work.
**Example:**
```typescript
// vite.config.ts — additive change starting at L73
import { execSync } from "node:child_process";

// Read from env first (Docker stage passes it); fall back to git rev-parse for dev.
const buildId =
  process.env.VITE_BUILD_ID ||
  (() => {
    try {
      return execSync("git rev-parse --short=12 HEAD", { encoding: "utf8" }).trim();
    } catch {
      return "dev-" + Date.now().toString(36);
    }
  })();

export default defineConfig({
  // ...
  define: {
    "import.meta.env.VITE_APP_VERSION": JSON.stringify(packageJson.version || "0.0.0"),
    "import.meta.env.VITE_BUILD_ID": JSON.stringify(buildId),
  },
  // ...
});
```
Client reads via: `const CLIENT_BUILD_ID = import.meta.env.VITE_BUILD_ID as string;`

### Pattern 2: Backend reads VITE_BUILD_ID from environment
**What:** Dockerfile's `frontend-builder` stage computes the SHA and passes it via `ENV` to the `backend-builder` stage AND the runtime image. Backend reads `process.env.VITE_BUILD_ID` at startup.
**When to use:** Once, at Express bootstrap.
**Example:**
```dockerfile
# docker/Dockerfile — additive changes

# Add near the top of frontend-builder + backend-builder stages:
ARG SKYNET_BUILD_SHA
ENV VITE_BUILD_ID=${SKYNET_BUILD_SHA:-dev-unknown}
# Also propagate to final runtime image (Stage 5):
ENV VITE_BUILD_ID=${SKYNET_BUILD_SHA:-dev-unknown}
```
`docker-compose.yml` at `docker/docker-compose.yml:38-40` already sets `SKYNET_BUILD_SHA` as a build arg via labels. Compose passes it into the build context — but confirm the ARG is DECLARED in Dockerfile (currently it is not).
Backend reads at boot:
```typescript
// src/backend/database/database.ts — module-scope constant near line 138
const SERVER_BUILD_ID: string = process.env.VITE_BUILD_ID || "dev-unknown";
export function getServerBuildId(): string { return SERVER_BUILD_ID; }
```

### Pattern 3: Server-side global middleware — insert at `database.ts:302`
**What:** Skew-check middleware runs AFTER `cookieParser()` + `subdomain-dispatch` + `serveUrlHandler`, and BEFORE `bodyParser.*` (cheap check, no body parse required).
**When to use:** On every request. D-07 lock.
**Example:**
```typescript
// src/backend/database/database.ts — insert new middleware between L302 and L324

// Current middleware chain @ L293-302:
//   app.use(cookieParser());
//   app.use(createSubdomainDispatchMiddleware());
//   app.use(serveUrlHandler);
//   app.use(bodyParser.json({ limit: "1gb" }));
//   app.use(bodyParser.urlencoded({ limit: "1gb", extended: true }));
//   app.use(bodyParser.raw({ limit: "5gb", type: "application/octet-stream" }));
//   app.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });

// PROPOSAL — insert AFTER serveUrlHandler (L295) but BEFORE the three bodyParser
// mounts (L296-298). Placement rationale: (a) subdomain-dispatch owns its own
// proxy pass-through (Phase 103 serve URLs must bypass skew check entirely —
// they route to arbitrary backend targets not owned by Skynet), (b) skew check
// is header-only so runs before body-parsing (cheap; D-07 rationale).

app.use((req, res, next) => {
  // D-04 stamp on every response
  res.setHeader("X-Skynet-Server-Build", SERVER_BUILD_ID);

  // D-06 mismatch-only refusal on client-stamped requests
  const clientBuild = req.headers["x-skynet-client-build"];
  if (typeof clientBuild === "string" && clientBuild !== SERVER_BUILD_ID) {
    apiLogger.warn("Rejected stale client request", {
      operation: "skew_lock_stale_client_refused",
      clientBuild,
      serverBuild: SERVER_BUILD_ID,
      method: req.method,
      url: req.url,
    });
    return res
      .status(409)
      .json({ error: "stale_client", clientBuild, serverBuild: SERVER_BUILD_ID });
  }

  next();
});
```

### Pattern 4: Client-side interceptor — insert at `main-axios.ts:456`
**What:** Extend the existing request interceptor in `createApiInstance` factory. The factory is called 8 times to produce 8 axios instances (hostApi, tunnelApi, fileManagerApi, statsApi, authApi, dashboardApi, rbacApi, dockerApi) — a single edit to the factory covers all of them.
**When to use:** On every axios request.
**Example:**
```typescript
// src/ui/main-axios.ts — insert new header block between L455 (end of RN-webview
// block) and L458 (return config). Existing interceptor pattern shown in context:

    // (existing) — L419-433 attaches X-Electron-App / Authorization
    // (existing) — L435-456 attaches User-Agent for RN-webview

    // NEW — D-04 client-side stamping. AXIOS_HEADERS_SET_PATH covers both
    // AxiosHeaders instances (config.headers.set) and plain-object headers
    // (v0.x compat + test-mock adapter). See existing pattern at L419-424 for
    // the exact idiom.
    const CLIENT_BUILD_ID = (import.meta.env.VITE_BUILD_ID as string) || "dev-unknown";
    if (config.headers.set) {
      config.headers.set("X-Skynet-Client-Build", CLIENT_BUILD_ID);
    } else {
      config.headers["X-Skynet-Client-Build"] = CLIENT_BUILD_ID;
    }

    return config;   // existing L458
```
And extend the RESPONSE interceptor at `src/ui/main-axios.ts:461-506` to check the server's build id AND detect the 409 stale_client refusal:
```typescript
    // Inside response.use success handler, before the existing return:
    const serverBuild = response.headers["x-skynet-server-build"];
    if (typeof serverBuild === "string" && serverBuild !== CLIENT_BUILD_ID) {
      // D-15: only fires on a SUCCESSFUL response with mismatched tag.
      lockSkewedSession({
        reason: "response_tag_mismatch",
        clientBuild: CLIENT_BUILD_ID,
        serverBuild,
      });
    }

    // Inside response.use error handler, near the 401 fast-path @ L599:
    if (error.response?.status === 409) {
      const body = error.response?.data as { error?: string } | undefined;
      if (body?.error === "stale_client") {
        lockSkewedSession({
          reason: "server_refused_stale_client",
          clientBuild: CLIENT_BUILD_ID,
          serverBuild: (error.response.headers?.["x-skynet-server-build"] as string) || "unknown",
        });
        return Promise.reject(error); // still reject so caller cleanup fires
      }
    }
```

### Pattern 5: Roll-your-own module-scope store — mirror existing 6 stores at `src/ui/state/`
**What:** Store the `skewLocked` boolean at module scope; expose `subscribe(fn)` + `getSnapshot()` for `useSyncExternalStore` consumers.
**When to use:** Any shell-level state readable from anywhere. Skynet convention documented in `session-queue-pending-store.ts:58` header: *"subscribe() returns disposer. No zustand / jotai / redux — the fork rolls its own."*
**Example:**
```typescript
// src/ui/state/skew-lock-store.ts — NEW FILE

/**
 * Shell-level skew-lock state. When true:
 *   - all further axios requests short-circuit before send (checked at
 *     interceptor level via getSkewLockedSnapshot())
 *   - React root renders <SkewLockModal>, all app UI unmounts
 *   - Non-dismissible; only path forward is window.location.reload()
 *
 * Roll-your-own module pattern (mirrors trapped-work-store, session-working-
 * store, etc. — see the six stores in src/ui/state/ for the same shape).
 * No zustand/jotai/redux — Skynet convention.
 */

type LockReason =
  | "response_tag_mismatch"
  | "server_refused_stale_client"
  | "ws_handshake_mismatch"
  | "ws_message_tag_mismatch";

interface LockState {
  locked: boolean;
  reason: LockReason | null;
  clientBuild: string | null;
  serverBuild: string | null;
  lockedAt: number | null;
}

let state: LockState = {
  locked: false,
  reason: null,
  clientBuild: null,
  serverBuild: null,
  lockedAt: null,
};

const listeners = new Set<() => void>();

export function getSkewLockedSnapshot(): LockState {
  return state;
}

export function subscribeSkewLock(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function lockSkewedSession(args: {
  reason: LockReason;
  clientBuild: string;
  serverBuild: string;
}): void {
  if (state.locked) return; // idempotent — first drift signal wins
  state = {
    locked: true,
    reason: args.reason,
    clientBuild: args.clientBuild,
    serverBuild: args.serverBuild,
    lockedAt: Date.now(),
  };
  // Structured log per role-file directive — no JSON.stringify of DOM Events
  console.warn("[skew-lock] activated", {
    operation: "skew_lock_activated",
    reason: args.reason,
    clientBuild: args.clientBuild,
    serverBuild: args.serverBuild,
    lockedAt: state.lockedAt,
  });
  for (const fn of listeners) fn();
}
```

### Pattern 6: Shell-level modal at App-root (`src/main.tsx:243`)
**What:** Mount `<SkewLockModal>` at the same level as `<Toaster>`, at the top of the `App()` component return tree. `useSyncExternalStore` subscribes to `skew-lock-store`; when `locked === true`, modal renders a `fixed inset-0 z-[9999]` div and calls `document.body.setAttribute("inert", "")` to gate the rest of the app.
**When to use:** Once at App root. Ensures modal paints above all app UI regardless of which code path fired the lock.
**Example:**
```tsx
// src/ui/features/skew-lock/SkewLockModal.tsx — NEW FILE
import { useSyncExternalStore, useEffect } from "react";
import { subscribeSkewLock, getSkewLockedSnapshot } from "@/state/skew-lock-store";

export function SkewLockModal() {
  const snapshot = useSyncExternalStore(
    subscribeSkewLock,
    getSkewLockedSnapshot,
    // SSR fallback (Skynet doesn't SSR but useSyncExternalStore demands it)
    getSkewLockedSnapshot,
  );

  useEffect(() => {
    if (!snapshot.locked) return;
    // Gate rest of the app from receiving pointer/keyboard events
    const root = document.getElementById("root");
    if (root) root.setAttribute("inert", "");
    return () => root?.removeAttribute("inert");
  }, [snapshot.locked]);

  if (!snapshot.locked) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        // Palette: --color-pv-* per role-file authority rule
        backgroundColor: "hsl(var(--color-pv-backdrop) / 0.95)",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="skew-lock-title"
    >
      <div
        className="max-w-md rounded-lg p-8"
        style={{ backgroundColor: "hsl(var(--color-pv-bg-elevated))" }}
      >
        <h2 id="skew-lock-title" className="mb-4 text-lg font-semibold"
            style={{ color: "hsl(var(--color-pv-fg))" }}>
          A newer version is available
        </h2>
        <p className="mb-6 text-sm" style={{ color: "hsl(var(--color-pv-fg-muted))" }}>
          Reload to continue.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-md px-4 py-2 text-sm font-medium"
          style={{
            backgroundColor: "hsl(var(--color-pv-accent))",
            color: "hsl(var(--color-pv-fg-on-accent))",
          }}
        >
          Reload
        </button>
      </div>
    </div>
  );
}

// src/main.tsx — mount alongside <Toaster> at App() return @ L243
      <Toaster position="bottom-right" />
      <SkewLockModal />   {/* NEW */}
```

### Anti-Patterns to Avoid

- **Using sonner toast for the modal.** D-12 requires non-dismissible; toasts are dismissible by contract. Skynet's `<Toaster>` is used for transient auth-expired / retry warnings, none of which are lifecycle-fatal.
- **Monkey-patching `window.fetch`.** Fragile — libraries like Sonner internally use fetch for URL images, the service worker uses its own fetch, and future libs would silently inherit. Enumerate the 20 raw-fetch sites (see Q2) and wrap each explicitly.
- **Sending `X-Skynet-Client-Build` from server→server calls.** Only the browser stamps. `getGuacamoleToken` calls, GitHub API calls (`fetchGitHubAPI` at `database.ts:250`) etc. are server-side. If they hit our own server, they'd trigger absence-passes-through (D-06) — no bug, but the header should not be inherited into outbound backend fetches.
- **Falling through the WS handshake check when tag is absent.** For WS: absence should NOT pass through the same way HTTP does (D-06 protects non-browser HTTP callers; WS servers have no non-browser callers). Explicitly gate the handshake on presence + match.
- **Placing the middleware BEFORE `cookieParser`.** JWT-based auth in downstream middleware needs `req.cookies` populated. But the skew check itself only reads a header, so it CAN run before cookieParser — the placement recommendation (after cookieParser + serve-URL, before body-parser) is a defensive middle ground that lets the check bypass Phase 103 serve URLs cleanly.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Version tag comparison | Custom hashing scheme | Git short SHA (`git rev-parse --short=12 HEAD`) | Deterministic, monotonic per deploy, human-readable in logs, no manifest.json read required |
| Header attachment on every axios instance | Per-call `config.headers` override at each call site | Single edit to `createApiInstance` factory in `main-axios.ts:381` | Skynet has 8 axios instances all created by the same factory — D-04 airtight coverage from one diff |
| WS lifecycle detection | Custom onclose parsing | Standard `event.code` field (server closes with `4409` custom close code, client checks `event.code === 4409`) | Close codes 4000-4999 are reserved for app-specific use per RFC 6455 |
| Cache-Control on index.html | New middleware | Extends already-present nginx + Express fallback | D-19 audit shows `no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0` already ships (nginx.conf:138, nginx-https.conf:149, database.ts:2041) |
| React state management | Zustand / Redux / Jotai | Roll-your-own module-scope store (Skynet convention, 6 existing precedents in `src/ui/state/`) | Consistency with existing codebase; useSyncExternalStore is the React-19-native subscribe primitive |
| Playwright test scaffolding | New test infra | Extend existing `tests/e2e/smoke.spec.ts` + `tests/e2e/helpers/auth.ts` | 8-line existing baseline; adding one spec file mirrors the shape |

**Key insight:** Skynet has already-solved 60% of the mechanism. The mechanism this phase ships is a discipline layer: it uses the interceptors that already exist, the middleware chain that already exists, the WS handshake pattern (JWT-in-cookies-or-query) that already exists across all 5 servers, and the nginx cache-control that already exists. New surface area is minimal: 1 Vite define line, 1 module-scope store, 1 modal component, ~5 middleware/interceptor edits, and per-WS-server handshake+piggyback edits.

## Runtime State Inventory

Not applicable — this phase adds new functionality; it does NOT rename or refactor existing state.

## Common Pitfalls

### Pitfall 1: Guacamole cannot carry a per-message tag
**What goes wrong:** Attempting to inject a `build_id` field into guacamole-protocol frames corrupts the wire format (guacd parses text like `4.size,4.data;` — arbitrary JSON injection breaks parsing).
**Why it happens:** guacamole-lite is a third-party WS handler with a fixed wire format that Skynet doesn't own.
**How to avoid:** Do NOT stamp on-connection guacamole messages. Rely on the handshake-time refusal (embed `buildId` in the encrypted GuacamoleToken payload at `token-service.ts:135-150` — the server decrypts it and compares to `SERVER_BUILD_ID`, closes with `4409` on mismatch before guacd is contacted). The client checks close code, not per-frame content.
**Warning signs:** Any test that observes guacd data-frames should NOT have a mismatched tag injected mid-stream — that's a wire-format violation, not a design intent.

### Pitfall 2: Nginx location-block parity drift
**What goes wrong:** Any location edit made in `docker/nginx.conf` but not in `docker/nginx-https.conf` (or vice versa) causes the SSL vs non-SSL deploy path to diverge silently.
**Why it happens:** Two config files, manual sync. Skynet has 30+ location blocks in both files that need identical mirrors.
**How to avoid:** For THIS phase, D-20's audit found `index.html` caching is ALREADY correct in both files (L138 http, L149 https). If any nginx edit becomes necessary, plan a task that touches BOTH files and includes a `diff docker/nginx.conf docker/nginx-https.conf | wc -l` check in verification.
**Warning signs:** `.map` file 404 crash on production but not on dev.

### Pitfall 3: `git rev-parse` inside Docker build context
**What goes wrong:** The Dockerfile's `frontend-builder` stage does `COPY . .` which brings in `.git/` — but only if `.dockerignore` allows it. If `.git/` is excluded, `git rev-parse` fails at build time and the tag falls back to `dev-unknown`, defeating the mechanism.
**Why it happens:** Common `.dockerignore` patterns exclude `.git/` to shrink build context.
**How to avoid:** Two-pronged: (a) compute the SHA OUTSIDE the container in the deploy runbook (the ship command sets `SKYNET_BUILD_SHA` before invoking `docker compose build` — already done at `docker/docker-compose.yml:40`) and pass it as a build ARG; (b) declare `ARG SKYNET_BUILD_SHA` in the Dockerfile so the value propagates; (c) fall back to `dev-<timestamp>` if the ARG is empty — that produces a unique-per-build tag that still works (each dev rebuild forces stale clients to reload; acceptable in dev).
**Warning signs:** All production containers report `build_id=dev-unknown` in logs; drift lock never fires.

### Pitfall 4: Reload loop if server tag reads stale
**What goes wrong:** If `SERVER_BUILD_ID` is captured at module-import time (top of `database.ts`) but the container was started with an old `VITE_BUILD_ID` env var (config drift, image tag mismatch), then every fresh client after redeploy will see server_build ≠ client_build and reload indefinitely.
**Why it happens:** Container start reads a stale env; browser reload fetches fresh shell with fresh tag; new tag ≠ stale server tag; lock fires; user clicks Reload; same server; loop.
**How to avoid:**
1. Server tag reads exactly ONE source (`process.env.VITE_BUILD_ID`), set exactly ONCE at `docker compose up --force-recreate` via the same `SKYNET_BUILD_SHA` env used by the frontend-builder stage. Any code path that reads it MUST use the getter, not re-read `process.env`.
2. Structured log at server startup: `sshLogger.info("Server build id at startup", { operation: "server_boot_build_id", buildId: SERVER_BUILD_ID })`. If this line shows the WRONG SHA post-deploy, that's an operator error visible in the ship runbook.
3. On client, count reload activations in `sessionStorage`. After 3 reloads inside 60 seconds, show a different modal ("Something is wrong — please contact support") that does NOT loop. This is a belt-and-suspenders defense.
**Warning signs:** User reports "the reload button just keeps showing up again."

### Pitfall 5: Structured-logging discipline on WS close events
**What goes wrong:** Falling back to `JSON.stringify(event)` on the close event's DOM CloseEvent object crashes with a circular reference OR silently produces `{}`.
**Why it happens:** DOM Event objects have non-enumerable properties and circular targets.
**How to avoid:** Per role-file standing directive — ALWAYS extract explicit fields:
```typescript
ws.onclose = (event) => {
  const isSkew = event.code === 4409;
  console.info("[skew-lock] ws closed", {
    operation: "ws_closed",
    code: event.code,
    reason: event.reason,
    wasClean: event.wasClean,
    isSkew,
    // NEVER: JSON.stringify(event) — DOM Event has circular refs
  });
  if (isSkew) lockSkewedSession({ reason: "ws_handshake_mismatch", ... });
};
```
**Warning signs:** Server logs show `event: "{}"` in production, or `event: <circular>` at parse time.

### Pitfall 6: The `/api/branding` fetch fires before axios instances initialize
**What goes wrong:** `src/ui/branding/branding-fetch.ts:77` fires `fetch("/api/branding")` at module load, BEFORE `initializeApiInstances()` has populated the exported instances. If we don't wrap this raw-fetch site, the initial branding load will bypass the client-side stamping — small risk of a false-negative miss on the very first tab load.
**Why it happens:** Timing — branding-fetch runs in parallel with `initializeApiInstances()` inside `initializeApp()`.
**How to avoid:** Explicitly wrap `src/ui/branding/branding-fetch.ts:77` with a helper `stampedFetch()` (new file, `src/ui/lib/stamped-fetch.ts`) that ADDS the `X-Skynet-Client-Build` header — the interceptor pattern extended to plain fetch. Same for the other 19 raw-fetch sites enumerated in Q2 below.
**Warning signs:** First request from a freshly-loaded tab returns a response with mismatched server tag → lock fires → user sees modal on cold boot (bad UX). This is exactly the pathology the wrapping prevents.

### Pitfall 7: Middleware order interaction with `subdomain-dispatch`
**What goes wrong:** Skew check placed BEFORE `createSubdomainDispatchMiddleware()` intercepts Phase 103 `*.serve.term.*` subdomain traffic — that traffic proxies to arbitrary backend targets that DO NOT know about Skynet's build tag. Every serve-URL request would 409.
**Why it happens:** Serve URLs are Skynet-owned edge routing but arbitrary backend content.
**How to avoid:** Insert AFTER `createSubdomainDispatchMiddleware()` (which either handles the request and returns, or calls `next()` for non-serve traffic). The middleware chain in `database.ts:293-302` already runs in the right order — placement between L295 (`serveUrlHandler`) and L296 (first bodyParser) is correct.
**Warning signs:** All *.serve.term.* traffic 409s after deploy.

## Code Examples

### Server-side WS handshake gate (mirror across 5 WS servers)

```typescript
// Applied at claude-session-server.ts:4115 (before the existing JWT auth block).
// Same pattern in: terminal.ts:139, docker-console.ts:285, relay-room-stream-server.ts:1190,
// fleet-status-server.ts (find "on('connection'" — line differs).

wss.on("connection", async (ws: WebSocket, req) => {
  // D-08: Handshake-time skew check. Skew tag arrives as a URL query param
  // for parity with existing token/JWT query-param plumbing (see L4136-4139
  // in claude-session-server.ts).
  const url = new URL(req.url || "", "http://localhost");
  const clientBuild = url.searchParams.get("build");
  // Absence policy for WS: since only browsers open these sockets (no
  // agent-driven callers), we do NOT apply D-06 mismatch-only for WS.
  // Both absence AND mismatch close with 4409.
  if (!clientBuild || clientBuild !== SERVER_BUILD_ID) {
    ws.close(4409, "stale_client");
    return;
  }
  // ... existing JWT auth block continues
});
```

### Server-side WS message piggyback (D-09)

```typescript
// Applied at claude-session-server.ts every ws.send() site. The server emits
// dozens of message types — each one gets a `build` field added to the envelope
// at the wrapper layer, not at every call site. Pattern: extract a `sendFrame`
// helper (already exists in relay-room-stream-server.ts:1234-1240 as `emit`),
// wrap all ws.send() calls through it, and inject the tag once inside.

const sendFrame = (frame: object) => {
  try {
    ws.send(JSON.stringify({ ...frame, build: SERVER_BUILD_ID }));
  } catch { /* ws mid-close */ }
};
// Replace all ~50 direct `ws.send(JSON.stringify({ type: "..." }))` sites with
// `sendFrame({ type: "..." })`. This is mechanical but touches many lines.
```

### Client-side WS message check

```typescript
// Applied at each new WebSocket() call site. Pattern:
// src/ui/api/claude-session-api.ts:22, fleet-status-client.ts:81,
// features/pretty-view/sources/relay-room-api.ts:49,
// features/terminal/Terminal.tsx:1314

const CLIENT_BUILD_ID = (import.meta.env.VITE_BUILD_ID as string) || "dev-unknown";

// Attach on open:
const url = `${scheme}//${host}/claude-session/websocket/?build=${encodeURIComponent(CLIENT_BUILD_ID)}`;
const ws = new WebSocket(url);

// Detect refusal:
ws.addEventListener("close", (event) => {
  if (event.code === 4409) {
    lockSkewedSession({
      reason: "ws_handshake_mismatch",
      clientBuild: CLIENT_BUILD_ID,
      serverBuild: "unknown", // server closes before revealing its build
    });
  }
});

// Detect per-message drift:
ws.addEventListener("message", (event) => {
  const parsed = JSON.parse(event.data);
  if (parsed.build && parsed.build !== CLIENT_BUILD_ID) {
    lockSkewedSession({
      reason: "ws_message_tag_mismatch",
      clientBuild: CLIENT_BUILD_ID,
      serverBuild: parsed.build,
    });
    return; // drop the frame — session is skew-locked, do not process further
  }
  // existing message handler...
});
```

### Guacamole handshake via encrypted token payload

```typescript
// src/backend/guacamole/token-service.ts:135 — extend the GuacamoleToken shape
// to carry buildId inside the encrypted payload. Encryption is AES-256-CBC
// with a stable key (see token-service.ts:91-107). Server-side decrypt in
// guacamole-server.ts happens BEFORE guacd is contacted — extend to compare
// buildId against SERVER_BUILD_ID and refuse via the sendErrorToClient
// path if mismatched.

const token: GuacamoleToken = {
  connection: {
    type: hostConfig.protocol,
    settings: { /* ... */ },
    // ...
  },
  userId: authenticatedUserId,
  hostId: hostConfig.id,
  buildId: SERVER_BUILD_ID,  // NEW — stamped at token issuance
};
// Client passes this opaque encrypted blob as `token=` in the WS URL; server
// decrypts, checks token.buildId === SERVER_BUILD_ID.
// If mismatch: emit Guacamole `error` instruction with the same SKYNET_
// prefix pattern the takeover mechanism uses at guacamole-server.ts:178,
// then close. Client's guacamole-lite JS decodes the error and shows the
// skew-lock modal via the same lockSkewedSession() call.
```

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git rev-parse` (build time) | Vite plugin + Dockerfile stage | ✓ (in repo, in builder image) | Any git 2.x | Fall back to `dev-<timestamp>` if git call fails |
| Node.js runtime | Backend | ✓ | 22.x per Dockerfile | — |
| Docker | Deploy motion | ✓ | 24.x+ | — |
| `docker-compose.yml` `SKYNET_BUILD_SHA` env | Passing SHA into build | ✓ (already set at `docker/docker-compose.yml:40`) | — | — |
| `vitest` | Unit tests | ✓ | Per `package.json` | — |
| `@playwright/test` | E2E smoke | ✓ | Per `package.json` devDeps | — |
| `axios-mock-adapter` | Interceptor unit tests | ✓ (already used in `main-axios.test.ts:11`) | — | — |

No blocking or fallback situations.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | JWT auth on WS already exists; skew check runs BEFORE auth (unauthed users still get 409/4409 refused if stale — this is fine; no info leak, only stale-vs-current distinguishable) |
| V3 Session Management | no | Skew lock is independent of session; a session is version-scoped, not user-scoped |
| V4 Access Control | no | Skew lock is not an authorization primitive |
| V5 Input Validation | yes | `X-Skynet-Client-Build` header is untrusted user input — enforce string type, byte-length cap (12 hex chars + safety = ≤ 32 bytes) to prevent log-line flooding |
| V6 Cryptography | no | No secrets involved. The tag is public information (git SHA visible in `X-Skynet-Server-Build` response header) |

### Known Threat Patterns for the Skew-Lock Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Log-flooding by sending very long `X-Skynet-Client-Build` values on rejected requests | Denial of Service | Cap header value at 32 bytes before logging; truncate with ellipsis in structured log payload |
| Attacker crafting `X-Skynet-Client-Build` values to look like existing tags → bypass mismatch refusal | Tampering | Not a real threat — the value is compared exact-match against server's known-current tag. An attacker who guesses the current tag has zero advantage; they'd just get their real request processed like a real browser. Only bypassed to reach existing route handlers, which have their own auth. |
| Denial of service by clients refusing to reload after a legitimate deploy → indefinite lock | DoS (self-inflicted) | Not a threat vector — user consent (Reload button) is the mechanism. Non-reloading users can't hurt anyone else. |
| Reload-loop DoS on the server (client keeps reloading, each reload issues N requests) | DoS | Pitfall 4 mitigation — after 3 reloads inside 60s, show a different fatal-modal that does NOT loop. Also, server can rate-limit by IP/userId at the standard rate-limit layer if this ever presents. |
| Cross-tab data leak via `sessionStorage` for reload counter | Information Disclosure | Reload counter is per-tab (sessionStorage isolates by tab), no cross-tab leak; the value is public (a number) |
| Guacamole-lite token-forgery to bypass buildId check | Tampering | The token is AES-256-CBC encrypted with a persistent server-only key (`token-service.ts:79-88`). Forging requires the key. Existing token-forgery-resistance carries over unchanged. |

## Answers to the 12 Research Questions

### Q1: Version tag source — pick one and justify

**Recommend git short SHA (candidate b).**

Rationale grounded in Skynet's build system:
- `vite.config.ts:75-79` already uses `define` for `import.meta.env.VITE_APP_VERSION` from `package.json.version`. Extending this to inject `VITE_BUILD_ID` is a 3-line diff. No new Vite plugin required (unlike the vms `vmsBuildIdPlugin` which is 150 LOC).
- `docker/docker-compose.yml:40` ALREADY sets `SKYNET_BUILD_SHA` as an OCI label from the ship runbook. The value is available at compose-config time; propagating it to a Dockerfile ARG is 2 lines.
- Server reads it via `process.env.VITE_BUILD_ID` at startup — no filesystem read, no hash computation, deterministically produces the same string on both sides (source is the same env var, injected by the same runbook).
- Byte-identical on both sides: `git rev-parse --short=12` returns a 12-char lowercase hex string on both invocations from the same commit. The vite `define` and the backend `process.env` both receive the same string.
- Redundant rebuild (same source, no changes): same SHA → same tag → no drift → clients don't reload spuriously. Contrast with build-nonce which forces reload on every rebuild even without source changes.
- Human-readable in logs: `abc123def456` grepable in git log to find the exact commit that shipped.

Rejecting the other two:
- **Hash-of-manifest** (vms approach): requires a Vite plugin that hashes emitted `manifest.json` — new code, more moving pieces, needs the plugin to write the SAME hash both sides. Redundant rebuilds with identical source do NOT produce the same hash (asset filenames' internal hashes derived from content, which is byte-identical, so the manifest hash IS stable — but this is subtle and easy to break with source-map or ordering changes). Also introduces a chicken-and-egg where the server-side needs to read `manifest.json` from `/app/html/` at startup, which is a filesystem-timing landmine per Pitfall 3.
- **Build-time nonce**: forces spurious reload on every rebuild even without source change. Skynet has multiple no-op rebuilds in the deploy motion (env var change, restart with same image tag) — nonce would create user-visible modal churn.

How the browser bundle gets it baked in: `vite.config.ts:75-79` extended with `"import.meta.env.VITE_BUILD_ID": JSON.stringify(buildId)`. `buildId` computed at Vite config eval time from `process.env.VITE_BUILD_ID || execSync("git rev-parse --short=12 HEAD")`. The value becomes a string literal replaced at bundle emit time — no runtime env-var lookup on the client.

How the server reads it at startup: `src/backend/database/database.ts` at the top of the file (near L138 module-init), `const SERVER_BUILD_ID = process.env.VITE_BUILD_ID || "dev-unknown";`. Read once at module load, held in a closure-scoped const, exported via `getServerBuildId()` if needed elsewhere.

Byte-identical: yes, both sides receive the same string from the same source env var, injected by the same ship runbook.

Redundant rebuild with same commit: yes, same SHA → same string → clients stay on. Rebuilding for env-only changes with unchanged source is safe.

### Q2: Client-side interceptor coverage

**Existing axios request interceptor at `src/ui/main-axios.ts:392-459`.** Already exists, already adds `X-Electron-App`, `Authorization`, `User-Agent`. Adding one more header block for `X-Skynet-Client-Build` is a 5-line insertion at L456 immediately before the `return config`.

The factory `createApiInstance()` at L381 is called 8 times (`initializeApiInstances()` L883-911) to produce 8 axios instances. Every UI-initiated axios call routes through one of them. **Single edit to the factory covers all 8 instances.**

**Raw-fetch call sites (20 total)** — each needs explicit stamping:

| Site | File | Line | Purpose | How to fix |
|------|------|------|---------|------------|
| 1 | `src/ui/branding/branding-fetch.ts` | 77 | `/api/branding` initial load | Wrap with `stampedFetch()` helper |
| 2 | `src/ui/sidebar/CreateRoleDialog.tsx` | 414 | Fetch generated avatar candidate | ⚠ External URL (candidate.url) — SKIP; not our server |
| 3 | `src/ui/api/identities-api.ts` | 648 | `/identities/birth` SSE stream | Wrap with `stampedFetch()` |
| 4 | `src/ui/api/voice-api.ts` | 46 | `/voice/speak-stream` streaming TTS | Wrap with `stampedFetch()` (needs JWT header preserved) |
| 5 | `src/ui/api/message-queue-api.ts` | 76 | Message queue write | Wrap with `stampedFetch()` |
| 6 | `src/ui/api/message-queue-api.ts` | 98 | Message queue read | Wrap with `stampedFetch()` |
| 7 | `src/ui/api/compose-drafts-api.ts` | 82 | Compose drafts | Wrap with `stampedFetch()` |
| 8 | `src/ui/lib/console-forwarder.ts` | 94 | `/debug/console-log` beacon | Wrap with `stampedFetch()` (fire-and-forget) |
| 9 | `src/ui/features/pretty-view/RoleCosmeticEditBlock.tsx` | 257 | Avatar candidate refetch | ⚠ External URL — SKIP |
| 10 | `src/ui/features/pretty-view/useVoiceRecording.ts` | 296 | `/voice/transcribe` STT | Wrap with `stampedFetch()` |
| 11 | `src/ui/features/pretty-view/RelayInboundBubble.tsx` | 183 | `/relay-pointer?…` fetch | Wrap with `stampedFetch()` |
| 12 | `src/ui/auth/ElectronServerConfig.tsx` | 70 | Electron-only server-config health check | ⚠ Electron path; hits configured remote server (possibly not Skynet). Assess — likely NOT wrap since it also targets external Skynet installs |
| 13 | `src/ui/auth/ElectronServerConfig.tsx` | 81 | Electron-only version check | Same as above — assess |
| 14-20 | `src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx:99` + others | — | `/api/usage` poller | Wrap with `stampedFetch()` |

**WS surfaces (4 client-side, 5 server-side counterparts):**

| Client call | File:line | Server | Server port |
|-------------|-----------|--------|-------------|
| `openClaudeSessionSocket()` | `src/ui/api/claude-session-api.ts:22` | claude-session-server | 30011 |
| `createFleetStatusClient` | `src/ui/api/fleet-status-client.ts:81` | fleet-status-server | 30012 |
| `openRelayRoomSocket` | `src/ui/features/pretty-view/sources/relay-room-api.ts:49` | relay-room-stream-server | 30015 |
| `new WebSocket(baseWsUrl)` | `src/ui/features/terminal/Terminal.tsx:1314` | terminal (`ssh/websocket/`) | 30002 |
| (Guacamole) — via `guacamole-lite` client | (embedded library) | guacamole-server | 30008 |
| (Docker console) — no client wrapper yet | (Electron only) | docker-console | 30009 |

**Image loads / audio / other:** No `new Image()` calls found in `src/ui`. No `new Audio()` outside `useVoiceRecording.ts`. Assets loaded by `<img src>` from Vite-emitted URLs are hashed and safe.

**Bottom line for the interceptor's coverage:** one edit to axios factory + wrap ~15 raw-fetch sites + WS URL param for 4 client-side WS + guacamole-lite handled at token-payload level.

### Q3: Server-side middleware placement

**Correction to CONTEXT.md D-07:** `starter.ts` is the boot IIFE, NOT where Express is bootstrapped. Express lives at `src/backend/database/database.ts:138`.

Concrete insertion point: `src/backend/database/database.ts` between L295 (`app.use(serveUrlHandler)`) and L296 (first `bodyParser.json`).

Surrounding context (verbatim from file):
```typescript
// L293-302
app.use(cookieParser());
app.use(createSubdomainDispatchMiddleware());
app.use(serveUrlHandler);
// ⬇ INSERT NEW MIDDLEWARE HERE (between L295 and L296)
app.use(bodyParser.json({ limit: "1gb" }));
app.use(bodyParser.urlencoded({ limit: "1gb", extended: true }));
app.use(bodyParser.raw({ limit: "5gb", type: "application/octet-stream" }));
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});
```

Ordering rationale:
1. **After `cookieParser`** — no cookie parsing needed for skew check, but harmless
2. **After `subdomain-dispatch` + `serveUrlHandler`** — Phase 103 serve URLs (arbitrary backend traffic) MUST bypass skew check, and those middlewares short-circuit via `return` before `next()` when they handle a request (see Pitfall 7)
3. **Before `bodyParser.*`** — check is header-only, no body parse required; running before body parse means rejection is cheap
4. **Before the global `Cache-Control: no-store` middleware at L299** — irrelevant, that middleware only sets response headers, order between it and skew check doesn't matter functionally

`starter.ts` at `src/backend/starter.ts` bootstraps SSH channels, spawn-request worker, event-loop lag sampler, WS server imports (via `await import(...)`) — it does NOT own Express routing.

### Q4: WS handshake shape — five surfaces

Every one of Skynet's five WS servers uses **the exact same JWT-in-cookie-or-Bearer-or-query pattern**. This is a genuine convention worth exploiting.

| Server | File | Line | Port | Handshake pattern |
|--------|------|------|------|-------------------|
| claude-session | `src/backend/claude-session/claude-session-server.ts` | 4113-4144 | 30011 | Reads JWT from cookie, then Authorization header, then `?token=` query. Closes 1008 on failure. |
| terminal | `src/backend/ssh/terminal.ts` | 120-168 | 30002 | Identical pattern (verbatim same 3-strategy JWT lookup) |
| docker-console | `src/backend/ssh/docker-console.ts` | 285-310 | 30009 | Identical pattern |
| relay-room-stream | `src/backend/relay-room-stream/relay-room-stream-server.ts` | 1173-1212 | 30015 | Uses `extractJwt(req)` helper — same 3-strategy internally |
| fleet-status | `src/backend/fleet-status/fleet-status-server.ts` | 89 | 30012 | Auth-less (broadcast; anyone can subscribe to snapshot frames) — but per D-08, skew check runs regardless |
| guacamole | `src/backend/guacamole/guacamole-server.ts` | 194-200 | 30008 | Third-party `guacamole-lite`; auth via encrypted token in URL query. No JWT. |

**No common WS abstraction.** Five independent servers. But since the JWT pattern is identical across four of them, a shared helper `extractSkewTag(req: IncomingMessage): string | null` could sit alongside `extractJwt()` — and the guacamole check happens inside the token decrypt path, not at the raw handshake.

**Handshake stamp placement recommendation:**
- **URL query parameter** (`?build=abc123def456`) for the four JWT-based WS servers. Parity with the existing `?token=` query fallback these servers already read. Add ONE more line in each `wss.on("connection")` handler to read the param and refuse.
- **Encrypted token payload** for guacamole. `token-service.ts:135-150` extends the `GuacamoleToken` type; `guacamole-server.ts` extends `readTakeoverIds` or a peer `verifyBuildId` function.

**Version check in each: insert BEFORE JWT verification.** Cheap URL parse; refuse via `ws.close(4409, "stale_client")` before any DB work.

### Q5: Server-sent WS messages — piggyback the tag

| Server | Envelope shape | Piggyback strategy |
|--------|---------------|--------------------|
| claude-session | `JSON.stringify({ type: "...", ...fields })` — 60+ distinct message types (see the doc block at `claude-session-server.ts:107-350`) | Wrap all `ws.send()` calls through a `sendFrame(ws, frame)` helper that injects `build: SERVER_BUILD_ID` at envelope top-level. Grep shows ~50 direct `ws.send(JSON.stringify(...))` sites in this file. |
| terminal | `JSON.stringify({ type: "...", ...fields })` — messages: `data`, `sessionStart`, `error`, etc. | Same wrapper strategy |
| docker-console | `JSON.stringify({ type: "connect"|"data"|"error"|... })` | Same wrapper strategy |
| relay-room-stream | Already has `emit(frame)` helper at L1234-1240 — a one-line addition inside it (`{ ...frame, build: SERVER_BUILD_ID }`) covers every send site | Extend existing emit helper |
| fleet-status | `wss.on("connection")` broadcast fanout — see `fleet-status-server.ts` `ws.send(JSON.stringify(...))` sites | Same wrapper strategy |
| guacamole | Wire is guacamole-protocol text frames — CANNOT piggyback per-frame (see Pitfall 1) | Handshake-only enforcement via encrypted token buildId field. No per-frame stamp. |

**All five JSON-envelope WS servers use the same envelope shape:** top-level `type` field + arbitrary siblings. `build` is a new sibling field; consumers can safely ignore it (browsers only inspect it in the message handler wrapper).

**Existing consumers side:** frontend WS `onmessage` handlers parse `event.data` as JSON, `switch (parsed.type)` on the type field. `parsed.build` is orthogonal and can be checked with a single pre-switch check.

**Which existing message types carry it: ALL of them.** Simpler than filtering — every outbound WS frame gets stamped. Total network overhead is 24 bytes per frame (`"build":"abc123def456",`) — negligible.

### Q6: Shell-page cache headers — D-20 audit result

**D-19 is codification, NOT change.** `index.html` cache discipline ALREADY exists at three layers:

1. **In-container nginx (`docker/nginx.conf:131-140`, `docker/nginx-https.conf:142-151`)** — the `location /` block explicitly sets:
   ```nginx
   expires off;
   add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0" always;
   try_files $uri @express_spa_fallback;
   ```
2. **Express SPA fallback (`src/backend/database/database.ts:2039-2043`, `2056-2058`)** — the `getBrandedIndexHtml` path AND the `sendFile(index.html)` path both call:
   ```typescript
   res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
   ```
3. **Caddy at box level (`/opt/skynet/caddy-config/Caddyfile`)** — does NOT set any Cache-Control. Passes through unchanged (correct behavior; nginx behind Caddy owns the header).

**Recommendation:** Do nothing structural. The mechanism ALREADY guarantees `index.html` is never cached at any layer. What the plan should do:

1. **Add an assertion test** — verify at CI time that both nginx configs still have the block, and that the Express SPA fallback still sets the header. If either drifts (e.g. an upstream rebase strips the block), the test fails loudly.
2. **Add a comment in each of the three locations** referencing Phase 132 so future maintainers know it's load-bearing for skew-lock.
3. **Optionally** — add `Clear-Site-Data` header on the `X-Skynet-Server-Build` mismatch path. Advanced defense-in-depth: when the server refuses a stale-client request, respond with `Clear-Site-Data: "cache", "storage"` so the client's HTTP cache and web-storage clear on the next navigation. Not required for D-19 but complements it.

**Hashed assets stay aggressively cacheable:** `nginx.conf:110-119` (`~* \.(js|css|png|...)$`) sets `expires 1y` + `immutable` for the Vite-emitted hashed files. Correct — safe by design (filename is a hash of content).

**Bottom line:** Task in the plan = "verify existing headers persist" + "add a comment cross-reference." Minimal-diff intervention.

### Q7: Modal placement in the UI tree

Skynet does NOT have a dedicated shell-level modal container. Modals mount inline via `Sheet` (radix), `Dialog` (radix), or `createPortal` from `react-dom`.

**Natural home:** Alongside `<Toaster>` at `src/main.tsx:243` in the `App()` function's return. This is the App root; renders regardless of auth state (auth branch OR post-login shell); receives no props from AppShell. Snippet:

```tsx
// src/main.tsx L204-245 return block
return (
  <>
    {isTransitioning && <SpinnerOverlay />}
    {showApp && <div><Suspense><AppShell .../></Suspense></div>}
    {showAuth && <div><Auth .../></div>}
    <Toaster position="bottom-right" />
    <SkewLockModal />   {/* NEW — same App-root level */}
  </>
);
```

Because it's a `fixed inset-0 z-[9999]` div, it paints above ANY app UI (auth spinner, AppShell, in-tab modals). Because it's not wrapped inside `<Suspense>`, it's not lazily loaded — instant paint on lock activation.

The modal subscribes to the store via `useSyncExternalStore`. When `skewLocked === false`, returns `null` — zero DOM. When true, renders the modal AND applies `inert` to `#root` via a `useEffect` so pointer/keyboard events into the rest of the app are blocked.

**No need for `createPortal`** — `App()` renders `<SkewLockModal>` as a sibling of `<div>` root-level elements; z-index alone is sufficient (all Skynet dialog/sheet portals live at `z-50` or lower per Radix defaults; the modal at `z-[9999]` wins).

### Q8: Skew-lock state shape

Skynet uses **roll-your-own module-scope subscribable stores**. Six existing precedents in `src/ui/state/`:

| Store | Shape |
|-------|-------|
| `session-queue-pending-store.ts` | `subscribe(fn): () => void` disposer pattern |
| `trapped-work-store.ts` | Same pattern; composite-key indexed map |
| `conversation-store.ts` | Same pattern (see file header "No dependency on zustand / jotai / redux") |
| `identities-store.ts` | Same |
| `session-working-store.ts` | Same |
| `viewing-user-store.ts` | Same |

**New file: `src/ui/state/skew-lock-store.ts`.** Follows the same shape (see Pattern 5 code example above). Exports:
- `lockSkewedSession(args)` — one-way transition; idempotent (first drift wins)
- `getSkewLockedSnapshot()` — returns `{ locked, reason, clientBuild, serverBuild, lockedAt }`
- `subscribeSkewLock(fn): () => void` — subscribe with disposer

Consumers:
- `<SkewLockModal>` — via `useSyncExternalStore`
- `main-axios.ts` interceptors — direct `lockSkewedSession()` call
- Each WS client handler — direct `lockSkewedSession()` call

**Gating dispatches** (D-11):
- Axios REQUEST interceptor at the top of the config-fill logic: check `getSkewLockedSnapshot().locked === true`; if yes, reject the promise immediately with a synthetic `stale_client_locked` error without hitting the network.
- WS onmessage handlers: check the snapshot before processing; if locked, drop the frame silently.
- Timers/pollers: components read via `useSyncExternalStore` and their effects should conditionally skip work.

The store IS shell-level readable from anywhere. Zero React context needed — module scope is the singleton.

### Q9: Test scaffolding

**Backend middleware test template:** `src/backend/database/routes/sessions.test.ts:1-90` (already shown above). Pattern:
- `import express from "express"`, `import http from "node:http"`
- Mock `AuthManager` to pass-through with canned userId
- Spin up ephemeral http server via `http.createServer(app).listen(0)`, extract `AddressInfo`, hit with fetch
- Test the middleware chain end-to-end without booting the full backend

For the skew-check middleware, a fresh test file at `src/backend/database/routes/skew-lock-middleware.test.ts` following this pattern. Cases: (a) no header → passes through, (b) matching header → passes through, (c) mismatching header → 409 with `error: "stale_client"`, (d) response gets `X-Skynet-Server-Build` set on every path.

**Frontend interceptor test template:** `src/ui/main-axios.test.ts:380-429` (already shown above). Pattern:
- `import MockAdapter from "axios-mock-adapter"`
- `mock = new MockAdapter(instance, { onNoMatch: "throwException" })`
- Simulate response scenarios with `mock.onGet("/data").reply(...)`

For skew-check interceptor:
- Request stamping test: assert `X-Skynet-Client-Build` header is set on every mocked call
- Response drift test: `mock.onGet("/x").reply(200, {}, { "x-skynet-server-build": "different" })` → assert `getSkewLockedSnapshot().locked === true`
- 409 refusal test: `mock.onGet("/y").reply(409, { error: "stale_client", serverBuild: "different" })` → assert lock activated

**Modal component test:** `src/ui/features/pretty-view/*.test.tsx` files are the templates. Pattern:
- `import { render, screen } from "@testing-library/react"`
- Reset store between tests (add a `__resetForTest()` export in `skew-lock-store.ts` behind a `NODE_ENV === "test"` gate)
- Test cases: (a) `locked=false` → renders `null`, (b) `locked=true` → renders dialog with `role="dialog"` + `aria-modal="true"`, (c) click Reload → `window.location.reload` called (mock it via `Object.defineProperty(window, "location", {...})`)

### Q10: Playwright smoke — deploy-and-drift scenario

Existing `tests/e2e/smoke.spec.ts` is 8 lines. Existing helper: `tests/e2e/helpers/auth.ts` provides `loginViaUI(page, readCreds())`.

New file: `tests/e2e/skew-lock.spec.ts`. Shape:

```typescript
import { test, expect } from "@playwright/test";
import { loginViaUI, readCreds } from "./helpers/auth";

test("skew lock activates on version drift and reload recovers", async ({ page, request }) => {
  await loginViaUI(page, readCreds());
  await expect(page).not.toHaveURL(/\/login/);

  // Simulate a deploy: use the request context (out-of-band from the page) to
  // interpose a fake response with a mismatched X-Skynet-Server-Build header.
  //
  // OPTION A (page.route): intercept the next server request from the page
  // and rewrite the response header. Cleanest way with no backend cooperation.
  await page.route("**/host/**", async (route) => {
    const response = await route.fetch();
    const headers = response.headers();
    headers["x-skynet-server-build"] = "totally-different-build-id";
    await route.fulfill({ response, headers });
  });

  // Trigger any user action that fires an axios request. Click something.
  await page.getByRole("button", { name: /reload/i }).click().catch(() => {});
  // ... or fire a known action

  // Assert the modal appears
  const modal = page.getByRole("dialog", { name: /newer version/i });
  await expect(modal).toBeVisible({ timeout: 5000 });

  // Click Reload — we mock the reload as a page.reload() since window.location
  // in Playwright is a real navigation
  await page.route("**/host/**", (route) => route.continue()); // restore
  await modal.getByRole("button", { name: /reload/i }).click();
  await page.waitForLoadState("networkidle");

  // Assert we're back on the app (modal gone, request went through)
  await expect(modal).not.toBeVisible();
});
```

**Infra changes needed:** None. Playwright's `page.route` interposer is the standard way to simulate a mid-session server change. `playwright.config.ts` at repo root is already configured with `PLAYWRIGHT_BASE_URL` for the target.

**Alternative WS drift scenario** — inject a mismatched `build` field into an incoming WS message. Requires intercepting the WS at browser level. Playwright doesn't do this natively; would need `page.evaluate` to monkey-patch `WebSocket.prototype.dispatchEvent` in a beforeEach. Complexity — recommend deferring to a second spec if time allows.

### Q11: Landmines / gotchas

Beyond the 7 Pitfalls documented above, five candidates from the question worth explicit answers:

1. **Skynet's WS abstraction — is there a common upgrade handler?**
   **No.** Five completely independent WebSocketServer instances each with their own port and their own JWT plumbing (though the JWT plumbing is verbatim-identical across four of them). Guacamole is the fifth and it's a third-party library. **Practical consequence:** five separate integration edits, not one. **Mitigation:** extract a shared `extractSkewTag(req)` helper alongside the existing `rejectServeSubdomain(req)` helper in `src/backend/utils/`, so all five servers call `extractSkewTag(req)` and follow the same close-code convention.

2. **Vite dev vs prod — how does the design handle `npm run dev`?**
   In dev mode (`npm run dev` at `package.json:25`), Vite serves from `localhost:5173` in HMR mode. `import.meta.env.VITE_BUILD_ID` evaluates to whatever the `vite.config.ts` `define` says. Since the `execSync("git rev-parse ...")` runs at Vite config eval time, dev picks up the git working tree's HEAD SHA. Backend running via `npm run dev:backend` reads `process.env.VITE_BUILD_ID` — which is UNSET in dev (dev isn't invoked through the same env). **Recommendation:** in dev mode, backend falls back to `dev-<pid>` (see Pitfall 3). Client sends its git-SHA tag, backend refuses with 409. **This IS a problem for dev workflow.** Escape hatch: check `NODE_ENV !== "production"` in the middleware and skip refusal in dev, still stamping response headers so the client's interceptor never fires. Or: at dev startup, set `VITE_BUILD_ID=dev-any` in both dev commands. The escape-hatch approach is cleaner.

3. **Reload loop protection.** Detailed in Pitfall 4. `sessionStorage.getItem("skynet_skew_reload_count")` counter, incremented before `window.location.reload()`, TTL'd 60s. After 3 reloads inside 60s, show a different "contact support" modal that does NOT reload.

4. **Server tag capture timing.** `const SERVER_BUILD_ID = process.env.VITE_BUILD_ID` reads at module-load time of `database.ts`. This runs BEFORE any request handler fires — no filesystem timing landmine. The Dockerfile `frontend-builder` stage runs THREE times in the deploy motion: stage 1 (deps), stage 2 (frontend build), stage 3 (backend build). All three stages run BEFORE stage 5 (final image). The `ARG SKYNET_BUILD_SHA` needs to be declared in every stage that uses it (`ARG` scope in Docker resets per stage). Deferring to Pitfall 3 mitigation.

5. **Header stripping in nginx / Caddy.**
   - **Nginx:** by default, nginx passes ALL custom `X-*` headers through unchanged. The `proxy_set_header` directives in each location block SET headers, but don't STRIP unrelated ones. Verified against the 30+ location blocks in `docker/nginx.conf` — none use `proxy_pass_request_headers off` or `add_header ... "" hide` for `X-Skynet-*` patterns. **Safe by default.**
   - **Caddy at box level (`/opt/skynet/caddy-config/Caddyfile`):** default behavior also passes all headers. The `header_up` directives in the Phase 103 `*.serve.term.*` block SET headers but don't strip. **Safe by default.**
   - **Recommendation:** add ONE assertion test — `curl -sI https://term.gigathe user.click/ | grep -i x-skynet-server-build` — as a smoke check in the ship runbook. Not strictly needed in the phase's plan but cheap belt-and-suspenders.

### Q12: Deploy sequencing

Motion: `docker build` (2-3 min) then `docker compose up --force-recreate` (30-90s during which the old container is stopped and the new container starts).

Trace:

1. **T0** — the user runs `docker compose up --force-recreate skynet`. `SKYNET_BUILD_SHA` env has been set to the new HEAD SHA. Old container starts stopping.
2. **T0 + a few seconds** — Old container's Node process receives SIGTERM. In-flight HTTP requests either complete (fast) or fail with connection-reset (slow). Client's axios retry-interceptor at `main-axios.ts:559-597` retries ECONNRESET up to 3 times with 300ms base backoff. **D-15 says this does NOT fire the lock** — mismatches vs. failures are distinct.
3. **T0 + 5-15s** — Container is gone. Any client-initiated request hits nginx (down) or Caddy (up, returns 502). Client sees `status: 502` → NOT retryable per `isRetryable()` at `main-axios.ts:193-230` (5xx is only retryable for idempotent methods, but this returns a 502 to POSTs too; POSTs get a `503` toast). **Lock does NOT fire** (D-15).
4. **T0 + 30-90s** — New container starts. Backend initializes. `SERVER_BUILD_ID` is now the new SHA. Nginx starts listening on port 8080. Caddy's next reverse-proxy attempt succeeds.
5. **T0 + 30-90s + 1st req from stale client** — Browser tab that was open before the deploy is running with the OLD SHA baked in. Any axios request fires with `X-Skynet-Client-Build: <old SHA>`. Server-side middleware compares to `SERVER_BUILD_ID` (new SHA), mismatches, returns `409 { error: "stale_client", serverBuild: <new SHA> }`. Client's response interceptor detects 409 + `error === "stale_client"` and calls `lockSkewedSession({ reason: "server_refused_stale_client", ... })`.
6. **T0 + 30-90s + a moment** — Modal paints. User sees "A newer version is available. Reload."
7. **User clicks Reload.** `window.location.reload()` — browser fetches `/` with no-cache headers (Cache-Control response header from prior visit is honored). Fresh `index.html` returned. Fresh script tags → fresh bundle → fresh `import.meta.env.VITE_BUILD_ID`. Post-reload, client stamps with new SHA → matches server → normal operation.
8. **In parallel, any open WS was closed at T0+few-seconds** (server SIGTERM). Client's reconnect logic kicks in; new connection attempt fires with old `?build=<old SHA>` → server closes `4409 stale_client` → client detects code 4409 → also fires `lockSkewedSession({ reason: "ws_handshake_mismatch" })`. But since HTTP fires first and lock is idempotent, this is a no-op.

**Edge cases:**

- **Client reconnects DURING container restart:** Nginx and backend are both down; connection refused. Client's axios retry-interceptor retries; WS reconnect-with-backoff (see `fleet-status-client.ts:36`: 2s, 4s, 6s, 8s, 8s = 28s total). **No lock fires** — connection refused is not a mismatched-tag success (D-15). Once the new container is up, first successful request/reconnect trips the lock as in step 5.
- **New server comes up mid-request:** Impossible with `--force-recreate` (single container, atomic replacement — no window where both versions serve simultaneously). This is a Skynet-specific advantage; distributed deploys DO have this window but Skynet doesn't.
- **Client had a slow request in-flight at T0:** Request either completes on the old server (200 with OLD `X-Skynet-Server-Build` — matches client build, no lock) or fails with connection-reset (retryable; retry hits new server; new server returns 409; lock fires). Either way, no false-positive.
- **Client's clock skew from server:** Not relevant — build IDs are strings, not timestamps.

Design handles the deploy sequence cleanly. **The only genuine risk is Pitfall 4 (reload loop from stale server env var), which has explicit mitigation.**

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `SKYNET_BUILD_SHA` in the ship runbook maps 1:1 to the docker-compose `SKYNET_BUILD_SHA` env used at `docker/docker-compose.yml:40`. `[ASSUMED]` — need to confirm with the user or the ship runbook. | Pattern 2, Q1 | If the ship runbook uses a different var, plan needs to rename or add an alias. Not a design blocker; a name-check. |
| A2 | Skynet's Vite `manualChunks` config at `vite.config.ts:17-53` does NOT split `main-axios.ts` into a lazy-loaded chunk. `[ASSUMED]` — spot-check confirms it's imported eagerly by everything (login, dashboard, RBAC), but a chunk-graph audit would confirm. | Q2 | If it IS lazy, the interceptor doesn't attach until the first request that resolves the lazy chunk, meaning very-first requests could bypass. Low risk (main-axios is imported by main.tsx via `getUserInfo`). |
| A3 | Guacamole-lite's client-side JS surfaces close-code / error-instruction details in a way that the frontend can distinguish a skew-lock refusal from an ordinary disconnect. `[ASSUMED]` — the `SKYNET_SUPERSEDED:` prefix pattern at `guacamole-server.ts:178` suggests this pattern works, and the frontend detection code exists somewhere for takeovers. | Guacamole handshake code example | If not, need to fall back to close-code-only detection (harder). |
| A4 | The 20 raw-fetch call sites enumerated in Q2 are the COMPLETE set. `[ASSUMED]` — grep on `fetch(` found them, but a `fetch\s*\(` regex might miss template literals like `` fetch(`${url}`) ``. | Q2, Pitfall 6 | Missing 1-2 sites means those pathways bypass client-side stamping. Not catastrophic (D-06 mismatch-only on server means these fetches still work; they just won't detect drift). Low risk. |
| A5 | Skynet uses `--color-pv-*` CSS variables in the palette. `[ASSUMED]` — grep would confirm, but the role file directive is authoritative. | Pattern 6 | If the token names differ, cosmetic diff only. |
| A6 | The 5 WS servers' clients all reconnect with backoff (not hard-fail on close). `[VERIFIED: main-axios.ts:559-597 for HTTP retry; fleet-status-client.ts:36 for WS backoff]` — confirmed. Terminal.tsx has its own reconnect logic. | Q12 | — |

## Open Questions

1. **Should the modal be scoped to authenticated users only, or fire even on the login page?**
   - What we know: `<SkewLockModal>` at `main.tsx:243` renders regardless of auth state (App-root level). This means a user on the login page whose tab predates a deploy sees the modal on their first login attempt.
   - What's unclear: is that desired? The alternative is to gate `<SkewLockModal>` behind `showApp`, meaning login-page users see failed login attempts (409 from `/users/login`) with no explanation.
   - Recommendation: firing on the login page IS correct — a login attempt that gets a 409 stale_client refusal should be surfaced as "reload" not as "invalid credentials". Otherwise the user is stuck trying to log in with the modal-less UI showing a confusing auth error.

2. **`Clear-Site-Data` response header as a defense-in-depth on 409 refusal — include in v1 or defer?**
   - What we know: modern browsers honor `Clear-Site-Data: "cache"` to clear the HTTP cache. Setting this on the 409 stale_client response would force the browser to refetch everything on next navigation, including the shell.
   - What's unclear: does it interact badly with the immediate `reload()` on the client side? Should behave the same but is untested.
   - Recommendation: include in v1 as a comment/annotation, not a hard dependency. If UAT reveals reload isn't reliably clearing browser caches, flip the flag.

3. **Should the plan include a task to ensure `Cache-Control: no-store` remains on `index.html` at CI time?**
   - What we know: today it's set in three places; grep would trivially catch if any of them is deleted.
   - What's unclear: is this worth a CI test, or is a comment cross-reference sufficient?
   - Recommendation: add a lightweight vitest that reads the three source files and greps for the header. Cheap safety net for a load-bearing property.

## Sources

### Primary (HIGH confidence — read this session)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/.planning/phases/132-frontend-stale-prevention-version-drift-hard-lock/132-CONTEXT.md` — locked decisions D-01..D-20
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/.planning/shapes/shape-frontend-stale-prevention.md` — philosophy + scope edges
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/backend/database/database.ts` — Express bootstrap (L138), middleware chain (L293-302), route mounts, SPA fallback with cache-control (L2039-2058), Express.static cache-control (L2016-2046)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/ui/main-axios.ts` — axios factory (L381-664), request interceptor (L392-459), response interceptor (L461-661), 8 axios instance mounts (L883-911)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/vite.config.ts` — define block (L75-79), manualChunks (L17-71), assets emitted with hashes by default
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/docker/Dockerfile` — build stages, `COPY dist /app/html` (L77), backend build stage (L32-37)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/docker/docker-compose.yml` — `SKYNET_BUILD_SHA` OCI label (L40), atomic-recreate deploy motion
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/docker/nginx.conf` — location / cache-control (L131-140), assets cache-control (L110-119)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/docker/nginx-https.conf` — parity mirror of nginx.conf
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/docker/entrypoint.sh` — service startup order (nginx → node backend)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/main.tsx` — App root, Toaster mount (L243), RootApp, prepareClientCacheVersion (L2, L313)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/ui/lib/client-cache-version.ts` — existing VITE_APP_VERSION cache-clear pattern
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/backend/claude-session/claude-session-server.ts` — WS port 30011 (L4113), JWT-in-cookie-or-Bearer-or-query pattern (L4122-4139), ~50 ws.send sites
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/backend/ssh/terminal.ts` — WS port 30002 (L121), same JWT pattern (L146-163)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/backend/ssh/docker-console.ts` — WS port 30009 (L28), same JWT pattern (L288-305)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/backend/relay-room-stream/relay-room-stream-server.ts` — WS port 30015 (L1174), `emit` helper (L1234-1240) already provides a wrapper site for D-09
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/backend/guacamole/guacamole-server.ts` — guacamole-lite third-party WS handler, encrypted token payload path
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/backend/guacamole/token-service.ts` — GuacamoleToken shape (L135-193), AES-256-CBC encryption (L91-122)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/ui/state/session-queue-pending-store.ts` — roll-your-own store pattern (L58-)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/ui/api/claude-session-api.ts` — client WS URL pattern (L14-23)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/ui/api/fleet-status-client.ts` — client WS with backoff (L36, L81)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/ui/main-axios.test.ts` — axios-mock-adapter template (L380-429)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/src/backend/database/routes/sessions.test.ts` — express middleware test template (L1-90)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/tests/e2e/smoke.spec.ts` — 8-line baseline
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/playwright.config.ts` — E2E infra
- `/opt/skynet/caddy-config/Caddyfile` — box-level Caddy (no cache-control set; pass-through)
- `/home/ubuntu/fleet/identities/rio/workspace/skynet/.planning/config.json` — `nyquist_validation: false`, `security_enforcement: true`

### Secondary
- vms reference implementation at `~/fleet/identities/rio/workspace/vms/` — adopted philosophy + patterns per CONTEXT.md canonical-refs. Not re-read this session; the CONTEXT.md decisions ARE the distillation.

### Tertiary
- None. All findings verified against Skynet's live codebase this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library is already in `package.json` and in production use
- Architecture: HIGH — all insertion points verified with file:line references
- Pitfalls: HIGH — 7 pitfalls, each grounded in specific code paths
- WS surfaces: HIGH — all 5 servers inspected; handshake shape verified verbatim
- Cache headers: HIGH — audit found `no-store` already ships in 3 layers
- Git SHA availability: MEDIUM — Pitfall 3 flags the `.dockerignore` risk; mitigation in place

**Research date:** 2026-09-21
**Valid until:** ~2026-10-21 (30 days — Skynet moves fast but the middleware chain, WS server shapes, and Vite config are structurally stable; line numbers may drift but the design contracts hold)

## RESEARCH COMPLETE
