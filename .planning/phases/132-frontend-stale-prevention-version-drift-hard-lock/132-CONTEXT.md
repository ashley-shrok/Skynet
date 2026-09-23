# Phase 132: Frontend stale-prevention: version-drift hard-lock — Context

**Gathered:** 2026-09-21
**Status:** Ready for planning
**Source:** Seeded from `/open` shape file per /build rule — decisions already grilled through, no re-litigation.

<domain>
## Phase Boundary

Guarantee that a user's Skynet browser session is never running client-side code out of agreement with the server it is talking to. On any drift signal, the app hard-locks and surfaces a non-dismissible modal with a single Reload button; the user consents to reload, the tab now runs the current version. There is no in-between state — a session is either provably current or provably stale, and stale sessions cannot silently continue.

**Delivered:**
- A version tag baked into the browser bundle at build time, computed deterministically from something both the compiled artifact and the running server can agree on.
- Server stamps every response with its own current tag; browser stamps every request with its baked-in tag; server also stamps every message it emits over its persistent bidirectional connection to each tab.
- A global request-interception at browser boot (on the axios instance in `src/ui/main-axios.ts` and any raw fetch paths that exist) that attaches the header by construction, so no code path can miss it.
- A global server-side check that refuses any request whose stamp does not match its own current tag (mismatch-only enforcement; absence passes through so non-browser callers keep working).
- A handshake-time stamp on every persistent-connection open (URL parameter or first-message contract, planner's call) and refusal on mismatch.
- A shell-level browser lock: on any drift signal (rejected request, mismatched response, mismatched handshake), all further activity halts (dispatches drop, renders skip, polls stop) and a framework-owned modal fills the screen with a single Reload button.
- Cache-header discipline on the shell page (`index.html`) so returning users always fetch a fresh shell and thus always see the correct asset filenames for the current deploy.

**Not delivered (deliberately — see `<deferred>`):**
- No service-worker / update-worker path.
- No cross-tab coordination of the lock or the reload.
- No preservation of unsaved compose text through the lock.
- No user-preference opt-out.
- No timeout-based warning banners.

</domain>

<decisions>
## Implementation Decisions

All decisions below were locked with Ashley via `/open` this session; the shape file at `.planning/shapes/shape-frontend-stale-prevention.md` is the primary source of truth. Downstream agents MUST read that shape file before planning or implementing.

### Detection surface

- **D-01:** Piggyback on every HTTP request (client → server, response → client) AND on every persistent-connection message emitted by the server. Two lanes; both use the same tag.
- **D-02:** No polling. No explicit deploy-time broadcast. The stamp on the messages the server already sends IS the drift signal — a connected tab learns immediately when the server starts stamping its new tag.
- **D-03:** Update-worker path (browser resident background helper) explicitly REJECTED — adds subtle lifecycle bugs for offline-first-detection benefit Skynet does not need.

### Enforcement — client-side

- **D-04:** Client-side stamping is airtight-by-construction via global request interception at browser boot. All app code — no matter what layer initiates the request — passes through the interceptor first and gets the header attached. No code-review vigilance, no lint rule, no per-call convention.
- **D-05:** Skynet's client already routes most HTTP through the axios instance at `src/ui/main-axios.ts` — the interceptor lives there. Any raw `fetch()` paths that exist get wrapped with the same discipline. Planner audits for other outbound-request surfaces (image loads, upload streams, etc.) and either brings them in or explicitly rules them out.

### Enforcement — server-side

- **D-06:** Mismatch-only refusal, NOT absence-refusal. Requests carrying no stamp pass through unaffected — this preserves the fleet substrate distributor's API calls, agent-driven scripted access, and curl-based testing. Rationale: the client-side interceptor already makes browser requests airtight; server-side absence-enforcement would only impose cost on non-browser callers without buying safety we don't already have.
- **D-07:** The refusal runs before any business logic sees the request — global middleware on the Express-based server bootstrap in `src/backend/starter.ts`, not per-route opt-in. This addresses the class-1 defect vms's Phase 29 explicitly fixed (per-controller opt-in guards silently missed).

### Persistent-channel handling

- **D-08:** Stamp at handshake time (URL query parameter or first-message contract, planner's call per WS-server convention). Server refuses connection on mismatch — closes with a code the client can distinguish from ordinary connection loss.
- **D-09:** Stamp on messages the server sends over the open connection (piggyback field on the message envelope) — this is the idle-tab detection lane. Client checks each incoming message; mismatch fires the lock.
- **D-10:** Do NOT stamp every message the CLIENT sends over the open connection — once the handshake was version-agreed, the session is trusted for its lifetime. Excessive; mid-stream stamping adds no safety and costs framing overhead.

### Lock behavior

- **D-11:** Pure firm modal. Everything freezes on first drift signal. `skewLocked` shell-level state gates all further dispatches (drop) AND all subsequent renders (skip). Polls stop. Any in-flight request that resolves after the lock does not affect the DOM.
- **D-12:** Modal is non-dismissible. Single `[Reload]` button. No `X` close, no escape/click-outside dismissal, no countdown.
- **D-13:** `[Reload]` triggers a hard browser reload (`window.location.reload()` or equivalent). No state carryover. Unsaved compose text is lost by design — users learn to send before leaving the app open indefinitely.
- **D-14:** Reload semantics: the fresh page fetches the current shell (see D-19), which references the current asset names, which the browser downloads. Terminal sessions reconnect (their state lives server-side). RDP panes reconnect (Guacamole session lives server-side). The user lands back at approximately the same view, structurally.

### Version-drift ≠ server-down

- **D-15:** The lock ONLY fires on a successful response with a mismatched tag. Failed requests during the deploy-restart window (server temporarily down) do NOT fire the lock — the existing reconnecting-affordance handles that. Two different surfaces, two different UIs.
- **D-16:** The server's own tag is captured once at process startup (from the on-disk manifest / commit identifier / equivalent, per D-17) and held in memory. The old CSS fast-path pattern that touched `/app/html/` in the running container has been retired (role file confirmed 2026-09-21); the design does NOT need to accommodate hot-swap.

### Multi-tab behavior

- **D-17:** Independent tabs — each tab fires its own modal on its own drift signal. No cross-tab coordination via `BroadcastChannel` or equivalent. A user with five open tabs during a deploy sees five modals and clicks Reload five times. Simpler mechanism, no wrong states to debug. Ashley explicitly picked A over cross-tab coordination.

### Version tag source (open decision for planner)

- **D-18:** The version tag is a deterministic string that both the browser bundle (baked in at build time) and the running server (read at startup) compute or read from the same source. The exact source is a **plan-time decision** — candidates:
  - Hash of a compiled asset manifest (vms's approach — SHA-256 of `manifest.json`, first 12 hex chars).
  - Git commit identifier (short SHA).
  - Build-time nonce (random string produced at build).
  Planner researches which fits Skynet's build shape best. Constraint: server-side and client-side must produce byte-identical strings from the same source (empirically verified via test).

### Shell-page cache discipline

- **D-19:** The shell page (`index.html` served at the app's root URL) is served with a cache policy that guarantees the browser never uses a cached copy. `Cache-Control: no-store` OR `Cache-Control: no-cache, must-revalidate` — planner's call between the two based on what interacts best with Caddy's edge behavior and the nginx configs in `docker/nginx.conf` / `docker/nginx-https.conf`. Referenced Vite-hashed asset filenames (JS/CSS bundles emitted with `-[hash].js` suffix by Vite's default config) remain aggressively cacheable — hashing already scopes them.

### Baseline verification (plan-time or execute-time)

- **D-20:** Two factual checks the planner must schedule (they are NOT design decisions, they are current-state audits):
  1. **Is `index.html` currently cached at any layer today?** — check Caddy config, nginx configs, and the response headers the browser observes for the root URL. Result determines whether D-19 is a change or a codification.
  2. **What's the full set of outbound-request surfaces from the browser?** — the axios instance is the primary; any raw `fetch()` calls, `new Image()`-driven loads, upload streams, or WS surfaces outside the main lane must be enumerated. Result feeds the interceptor's coverage story (D-04).

### Claude's Discretion

- Exact DOM structure of the modal (backdrop + dialog + button). Match Skynet's warning-tone palette (`--color-pv-*` tokens per role-file palette-authority rule, NOT `--background`/`--foreground`). `inert` attribute on the container.
- CSS class prefix (suggest `skynet-skew-lock-*` or similar; align with existing `.vms-toast`-style conventions on Skynet's side if any exist).
- WS-server handshake stamp placement (URL query param vs first-message contract) — pick per each WS server's existing convention. The three WS surfaces to cover: `claude-session`, `guacamole`, `relay-*`.
- Server-side middleware placement in the Express pipeline (before body parsing so the check can run cheap; after cookie/auth parsing is not needed for this check).
- Test coverage strategy — unit tests for the interceptor + the middleware, integration test for a full drift round-trip, playwright smoke that walks through the deploy-and-drift scenario.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (primary source of truth for this phase)
- `.planning/shapes/shape-frontend-stale-prevention.md` — full `/open` shape file with Ashley's philosophy, deliberately-not-doing list, failure-mode taxonomy, and scope edges. LOCKED via `/open` grill 2026-09-21.

### Reference implementation (vms — Ashley's own separately-maintained framework)
The vms repo at `~/fleet/identities/rio/workspace/vms/` (cloned during `/open` research) ships this exact class of feature as `Phase 29 — Version-skew hard-lock`. Its `<decisions>` block is the closest existing prior-art — Skynet's design adopts the philosophy and extends the mechanism for the persistent-channel lane. Concrete files worth reading:
- `~/fleet/identities/rio/workspace/vms/.planning/phases/29-version-skew-hard-lock-global-server-guard-client-hard-lock-/29-CONTEXT.md` — full context doc including tasting-locked decisions.
- `~/fleet/identities/rio/workspace/vms/viewmodel-shell/src/vite.ts` — the reference Vite plugin that hashes `manifest.json` bytes into a deterministic build ID (`vmsHashManifestBytes`, exported for cross-backend parity).
- `~/fleet/identities/rio/workspace/vms/viewmodel-shell/src/index.ts` — client-side detection, `skewLocked` state, `showSkewLock` adapter verb, `checkVersionSkew` helper (line ~3497).
- `~/fleet/identities/rio/workspace/vms/viewmodel-shell/src/browser.ts` — reference modal DOM implementation (line ~614 `showSkewLock`).
- `~/fleet/identities/rio/workspace/vms/viewmodel-shell/src/server.ts` — TS server-subpath `createVersionGuard` global-guard factory (line ~1592).
- `~/fleet/identities/rio/workspace/vms/viewmodel-shell/agent-skill.md` — the shipped user-facing description of the drift mechanism, including `X-VMS-Client-Build` header semantics + `stale_client` error envelope.

**Adopt from vms:** philosophy (hard lock, user-consented reload, no third state), the piggyback-per-request lane, the build-id-in-bundle-via-Vite-plugin pattern, the global-middleware refusal, the `[Reload]`-button-only modal shape.

**Do NOT copy verbatim from vms:** the specific class names (`.vms-*`), the placeholder-in-bundle rewrite (`import.meta.env.VITE_VMS_BUILD` scheme is one specific implementation — Skynet may use a simpler `VITE_BUILD_ID` env-var read at compile time; planner's call), the `onVersionSkew: "custom"` opt-out flag (Skynet has no external consumers).

### Skynet role/directive context (already in Rio's loaded role file)
- **Standing directive on log discipline** — see role file § Standing directives; any patch touching lifecycle boundaries (skew-lock is a lifecycle boundary) proactively adds structured logs. `hostId`, `sessionId`, WS `event.code`/`reason`/`wasClean` in every log line touching close events. NEVER `JSON.stringify(event)` on DOM Event objects.
- **Test discipline** — role file § Test discipline. Scoped `vitest --related` during dev; full suite is deploy-time gate only, orchestrator-owned.
- **Deploy boundary** — role file § Standing directives. Every push needs fresh per-push greenlight; deploy motion is orchestrator-exclusive.
- **No worktrees** — role file § Standing directives. All work in `~/fleet/identities/rio/workspace/skynet` on `feat/tab-title-from-tmux`.

### Codebase entry points (from scout)
- `src/backend/starter.ts` — Express server bootstrap; middleware pipeline installation point.
- `src/ui/main-axios.ts` — centralized axios instance the vast majority of client HTTP flows through. Request-interceptor installation point.
- `vite.config.ts` — Vite config; build-id plugin insertion point.
- `docker/Dockerfile` — image build; controls when the version tag is computed and how it lands in both bundles.
- `docker/nginx.conf`, `docker/nginx-https.conf` — inside-container reverse proxy; potential cache-header injection point for the shell page.
- `src/backend/claude-session/`, `src/backend/guacamole/`, `src/backend/relay-*` — the three primary WS surfaces to cover in D-08/D-09.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/ui/main-axios.ts`** — the primary HTTP lane. Adding a request interceptor here covers the majority of client-side requests without touching individual call sites.
- **Vite's default asset-hashing** — Vite emits `dist/assets/[name]-[hash].js` by default. The referenced-assets side of D-19 is already in place; only the shell page (`index.html`) needs an explicit cache-header policy.
- **Express middleware pipeline in `src/backend/starter.ts`** — the natural install point for the server-side global refusal check (D-07).

### Established Patterns
- **Centralized axios** — Skynet's convention is a single axios instance with interceptors, not per-call `fetch()`. The client-side stamping design follows that pattern.
- **Docker `docker build` + `docker compose up --force-recreate`** — atomic deploys, single-container. Justifies the D-16 assumption (server captures tag once at startup).
- **Palette authority via `--color-pv-*`** — per role-file rule, ANY new surface's colors draw from the pretty-view token set. Applies to the modal.

### Integration Points
- Bundle-side build-id plugin: `vite.config.ts`.
- Client-side interceptor: `src/ui/main-axios.ts`.
- Server-side middleware: `src/backend/starter.ts` before route handlers.
- WS-server handshake stamps: three distinct surfaces (`claude-session`, `guacamole`, `relay-*`) — each with its own handshake shape.
- Shell-page cache header: either at Caddy edge or in nginx inside container (planner picks per which cleanly overrides browser's default).
- Modal: framework-owned; goes wherever Skynet's shell-level lock UI would go (planner picks; likely `src/ui/shell/` or `src/ui/features/skew-lock/` new).

</code_context>

<specifics>
## Specific Ideas

- **Ashley's own framing** (verbatim, 2026-09-21): *"this is building something to ensure that users are never running on anything client side stale for any amount of time"* — the one-sentence philosophy anchor.
- **Ashley's failure-mode framing** (verbatim, 2026-09-21): *"if what we've designed doesn't work reliably. because we came up with a pretty airtight plan"* — reliability IS the spirit; anything less is failure.
- **Ashley's enforcement intuition** (verbatim, 2026-09-21): *"if there was a way to make sure that always happened then both ends of this become fairly trivial"* — she saw the airtight-by-construction path and greenlit it.
- **Ashley's multi-tab call**: option A (independent tabs, no coordination) — verbatim answer to my three-way question.
- **Ashley's modal firmness call**: option A (pure firm, unsaved is gone) — verbatim answer to my three-way question.
- **Motivating context**: Skynet is about to be rolled out to a hundred new users. Stale-frontend bugs grow with user count; removing that class from the possible reports is the operational win.

</specifics>

<deferred>
## Deferred Ideas

None. Ashley's grill answer to the scope-edges question (verbatim): *"not sure if i can think of anything."* The tempting-but-no list is documented in the shape file's `## Scope edges` section as an explicit ruling-out (update-worker, cross-tab, drain-restore, per-user opt-out) — those are not deferrals, they are decisions to never add them.

</deferred>

---

*Phase: 111-Frontend stale-prevention: version-drift hard-lock*
*Context gathered: 2026-09-21*
