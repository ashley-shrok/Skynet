# Phase 120: First-class apps — apps as a content type in the pane (shape 4) - Context

**Gathered:** 2026-09-18
**Status:** Ready for planning
**Source:** Shape file at `.planning/campaigns/first-class-apps/shape-app-pane-content-type.md` (opened + greenlit 2026-09-18 via /build → /open). This CONTEXT.md is seeded from that shape file per the build-skill rule "seed discuss-phase from the shape file — do not re-do the discovery /open already did." Every D-decision below either derives from the shape file's `## Shape` section (locked during the /open pitch → discuss → grill flow) or represents a residual planner-facing detail the shape file consciously punted to planning. The shape file's `## Philosophy`, `## What would make it wrong`, and `## Scope edges` are the LOCKED ruleset that governs every choice below — the planner + researcher must read the shape file before writing any plan.

<domain>
## Phase Boundary

Deliver the closing shape of the first-class-apps campaign: apps become the fifth content type the main pane can hold. Two gestures put them there — left-click on a sidebar tile replaces the focused leaf, and drag from a sidebar tile into a split creates a new leaf. The in-pane view is a live authenticated web view of the app running on its home box, served under Skynet's own primary origin via a new reverse-proxy path. The proxy enforces the same-origin (CSRF) check at its boundary, applies the existing host-visibility filter, and passes HTTP + WebSocket bytes to the app. The pane's existing content-type dispatch is refactored in-place from a `switch(tab.type)` block to a small local lookup table so this fifth kind is the last "switch branch"-shaped addition. Reload persistence + multi-instance fall out for free from the tuple-keyed pane machinery.

**Cross-repo scope:** Skynet frontend (TS/React: extend `TabType` in `src/types/ui-types.ts`; refactor `tabIcon` + `renderTabContent` in `src/ui/shell/tabUtils.tsx`; wire left-click + drag handlers into `src/ui/features/pretty-conversations/AppTile.tsx`; add a new `AppPane` component that mounts the in-pane view via an iframe at the same-origin proxy path; extend the pane's persisted-layout tuple format to carry `hostId + slug`) + Skynet backend (TS: new `/apps/:hostId/:slug/pane/*` proxy route that reuses `src/backend/serve-url/proxy-factory.ts` + `tunnel-cache.ts`; a new `app-frame-csrf-check.ts` middleware that enforces the Origin match; wire the existing per-user `checkHostAccess` gate at the route entrypoint) + substrate (starter template `svelte.config.js` comment update pointing the disabled-check line at the proxy layer as the enforcement site). Full container deploy + substrate distributor sweep at the campaign's close. All files live in `~/skynet-vision`.

**Relation to prior phases and adjacent shapes.** Shape 1 (closed 2026-09-18) locked the on-disk conventions and the starter template with its disabled same-origin check. Phase 118 (shape 2, `.planning/phases/118-*/`) delivered the fleet-wide app-frame subscription channel with per-user filtering via `checkHostAccess`. Phase 119 (shape 3, `.planning/phases/119-*/`) landed the sidebar tile surface (`AppTile.tsx` + `app-tiles-store.ts`) with left-click as a deliberate no-op reserved for shape 4, no drag handlers, and the context-menu "Open in new tab" action wired via a `/apps/:hostId/:slug` redirect route (added by shape 3's code-review fix pass; 302s to the direct `.serve.` subdomain). Phase 119's redirect route and the `.serve.` fresh-tab affordance stay UNCHANGED — the in-pane path is a SEPARATE new proxy that lives beside them. Phase 103 established the existing serve-URL infrastructure (`src/backend/serve-url/`) including `proxy-factory.ts`, `tunnel-cache.ts`, and the `HEADER_ALLOWLIST` discipline — Phase 120 reuses this machinery for the actual byte-forwarding and inherits its production hardening (D-04 default-deny allowlist-strip, WebSocket RSV1 fix, per-target middleware cache). Phase 120 is the fourth and final shape of the campaign; after it closes, the whole campaign UAT and deploy run together per the campaign hold policy.

</domain>

<decisions>
## Implementation Decisions

### Tab model + dispatch table refactor (client-side, shape's "small in-place unification")

- **D-01: Extend `TabType` in `src/types/ui-types.ts:157-162` from a five-arm union to a six-arm union by adding `"app"`.** The five existing arms (`"dashboard" | "terminal" | "rdp" | "vnc" | "telnet"`) stay untouched in position and semantics. Rationale: minimal blast radius — every existing `switch(tab.type)` gets a new case, exhaustive-check-safe.

- **D-02: Extend the `Tab` type (`src/types/ui-types.ts:186-`) with an optional `app?: { hostId: number; slug: string }` field.** Optional so existing tab-persistence records without the field continue to parse (backward-compat rule matching the existing `sessionKind` shape). The field is required whenever `type === "app"`; a type predicate `isAppTab(tab): tab is Tab & { app: { hostId: number; slug: string } }` narrows the union for downstream consumers. Rationale: the tuple identifying an app leaf is `(hostId, slug)` per the shape file's `## Shape` — two-part because the same slug can exist on different boxes. Naming: `app` (parallel to how relay-room tabs carry `relayRoomId`).

- **D-03: Refactor `tabIcon(type)` at `src/ui/shell/tabUtils.tsx:98-110` from a switch to a small local lookup — `const TAB_ICONS: Record<TabType, React.ElementType> = { dashboard: LayoutDashboard, terminal: Terminal, rdp: Monitor, vnc: Monitor, telnet: Terminal, app: AppWindow };` then `tabIcon(type) = <TAB_ICONS[type] className="size-3.5" />`.** Icon choice for `app` is `AppWindow` from lucide-react (already imported by Phase 119's `AppTile.tsx`, coherent semantics). Rationale: the shape file's "small in-place unification" — a fifth branch would work but the lookup collapses cleanly at four+ arms and makes the sixth+ addition a one-line change. Sits in the same file the switch was already in.

- **D-04: Refactor `renderTabContent`'s dispatch at `src/ui/shell/tabUtils.tsx:339-` from a switch to a small local per-kind renderer map.** The renderer signature is `(tab, deps) => ReactNode` where `deps` is the same closure of `onOpenTab`, `onCloseTab`, `isVisible`, `shouldAttach`, `onTmuxSessionChange`, `onTmuxSessionMissing` already threaded into the current switch. Each existing case (`dashboard`, `terminal`, `rdp`/`vnc`/`telnet`) becomes an entry in the map; the new `app` entry is the sixth. `rdp`/`vnc`/`telnet` today share one switch case (fall-through pattern with a runtime type check) — the map treats them as three separate entries that all point to the same `renderGuacamoleTab` helper, cleaning up the current fall-through into three explicit rows. Rationale: same in-place unification as D-03. The current fall-through is a subtle readability hazard; three explicit rows pointing at the same helper is easier to modify safely.

- **D-05: The `app` renderer mounts a new `<AppPane>` component from `src/ui/shell/AppPane.tsx` (new file).** The component receives `{ hostId, slug, tabId, isVisible }` and renders an `<iframe>` (or equivalent — planner may pick `<iframe>` or a Web Component wrapper if the codebase has a convention) whose `src` is the same-origin proxy path from D-08. Nothing else — the iframe IS the entire in-pane view; Skynet does not draw any chrome around the app inside the leaf. The leaf's title bar (D-13) is the ONLY Skynet-authored surface visible in the leaf. Rationale: keeps the "pane is a transparent viewport" philosophy honest — Skynet's contribution to the leaf is exactly the title bar + the frame that hosts the app; the app owns the entire content area.

### Sidebar tile gestures (client-side, wiring shape 4's two entry points)

- **D-06: Left-click on an app tile in the sidebar (Phase 119's `AppTile.tsx`) creates a new tab of type `"app"` and opens it in the focused leaf.** The existing tab-open plumbing (`onOpenTab({ type: "app", app: { hostId, slug }, label: <appTitle> })`) matches the pattern chat rows and terminal rows use today — `onOpenTab` reads the current focused leaf and dispatches replace-in-place semantics. Explicit reuse of the existing leaf-replace behaviour; no new "app-specific" open path. When the same app is already open in the focused leaf, the click is a no-op (matches existing behaviour — clicking the currently-open chat is a no-op today). When the same app is open in a DIFFERENT leaf, the click creates a new leaf (multi-instance allowed per D-15). Cursor style flips from Phase 119's deliberate `cursor: default` to `cursor: pointer` in this phase. Rationale: shape file `## Shape` — "left-click follows the exact same behaviour chats and terminals have today." Also Phase 119 D-13 explicitly reserved primary-click for this phase.

- **D-07: Drag from a sidebar app tile into the pane creates a new leaf holding the app via the existing split-drop machinery.** Phase 119's `AppTile.tsx` gets `draggable` handlers (mirror the existing conversation-row drag handlers in `PrettyConversationRow.tsx`) whose drag payload is `{ kind: "app-tile", hostId, slug, title }` on a MIME type parallel to the existing `application/x-skynet-row`. The existing split-drop machinery in `src/ui/shell/SplitView.tsx` and its drop-target handlers ALREADY accept a general "leaf source" payload; extending it to recognize the app-tile drag payload is additive (a new switch arm inside the existing drop-target handler, matching how relay-row and identity-badge drag sources land today). Rationale: shape file — "drag matches existing split-drop behaviour; nothing special-cased on kind."

### Backend in-pane proxy path (shape 4's core technical addition)

- **D-08: New backend proxy path `/apps/:hostId/:slug/pane/*` served under Skynet's own primary origin.** The `*` captures the remainder of the URL that the app itself sees — everything after the mount prefix flows to the app as its own URL space. HTTP + WebSocket upgrades both flow through. Mounted at `src/backend/database/database.ts` alongside the identities/apps routers (Phase 119 added the icon endpoint next to identities; Phase 120 mounts the pane endpoint next to the icon endpoint). Rationale: shape file — "a new reverse-proxy path served under Skynet's own primary origin." Path prefix is `/apps/:hostId/:slug/pane/` (with trailing slash) to distinguish from Phase 119's `/apps/:hostId/:slug/icon` (icon endpoint) and the shape-3 redirect route at `/apps/:hostId/:slug` (fresh-tab redirect); the three coexist cleanly under the `/apps/:hostId/:slug` namespace with distinct suffixes.

- **D-09: The proxy reuses `src/backend/serve-url/proxy-factory.ts`'s `getOrCreateProxyForTarget` verbatim.** Same `http-proxy-middleware`-based factory, same per-target cache, same D-04 default-deny header allowlist-strip, same RSV1 WebSocket-compression fix. Phase 120 does NOT fork or re-implement the proxy factory — the whole security posture of the serve-URL infrastructure (Phase 103's hardening) is a prerequisite Phase 120 inherits. Rationale: the shape file's philosophy explicitly says "reuses existing patterns." `proxy-factory.ts` is the production-hardened byte-forwarding layer; a parallel implementation would double the audit surface without adding capability.

- **D-10: The proxy reuses `src/backend/serve-url/tunnel-cache.ts` for the SSH tunnel to the app's home box.** Same tunnel-lifecycle discipline, same per-(hostname, port) cache. If the box is local (t1000 hosting an app on itself), the local-loopback bypass pattern from Phase 118's sweep script applies — a `pane-target-resolver.ts` helper (new small file) decides local-loopback vs remote-SSH-tunnel per the same `isLocalHostId` predicate the icon endpoint uses. Rationale: reuse-not-reinvent; the tunnel cache and the local-loopback bypass are both production-tested.

- **D-11: The path-prefix handling — the proxy strips `/apps/:hostId/:slug/pane` before forwarding to the app.** Configured via `http-proxy-middleware`'s `pathRewrite` option. So a request arriving at Skynet at `/apps/5/todo/pane/api/list` gets forwarded to the app at `/api/list`. This means the app itself is fully mount-path-unaware — it serves as if it's at its own root, which preserves "apps don't know they're in-pane" (shape file philosophy). **Load-bearing caveat carried to research:** the app's OUTGOING HTML/JS references to absolute paths (e.g. `<script src="/app.js">`, `fetch("/api/foo")`) resolve against the browser's current base, which is Skynet's origin at the pane path. Without either (a) app-side relative-base configuration (out of scope per shape 4's scope edges — "Changes to the underlying starter template's framework configuration beyond updating the comment on the disabled check" is explicitly OUT), or (b) response-body URL rewriting at the proxy, absolute-path references break. The researcher agent MUST investigate this and pick between: response-body HTML/JS rewriting via `http-proxy-middleware`'s response transform; a `<base>` tag injection; SvelteKit's built-in `basePath` support if it can be inferred at runtime rather than build-time (unlikely); or a scope-amendment escalation to Ashley to include a targeted starter-template `svelte.config.js` change for relative paths. This is the phase's ONE genuinely open design gray area. See canonical_refs for the SvelteKit and `http-proxy-middleware` docs to consult.

- **D-12: The proxy applies the existing per-user host-visibility filter (`checkHostAccess`) at the route entrypoint, before any tunneling or byte-forwarding.** A request from user U for app on host H proceeds ONLY if `await checkHostAccess(H, U, 'read')` resolves truthy. On failure: 403 with a body matching Skynet's existing 403 shape (do NOT reveal whether the host+app exists — same discipline as the icon endpoint and the identity-avatar endpoint). Rationale: shape file `## What would make it wrong` — "The proxy trusts anything upstream. A user with no access to the app's home box hits the proxy path directly and reaches the app. The visibility filter the sidebar uses to decide 'should this user see this tile' has to gate the proxy too." The filter function is the SAME one Phase 118 uses at the wire boundary — single source of truth.

### CSRF / Origin boundary check (shape's Option B — check at the proxy)

- **D-13: Add a new middleware `src/backend/apps/app-proxy-csrf-check.ts` that enforces same-origin on state-changing requests at the proxy boundary.** Applied at the `/apps/:hostId/:slug/pane/*` route entry, BEFORE the byte-forwarding proxy runs. Logic: for requests whose method is one of `POST | PUT | PATCH | DELETE`, inspect the `Origin` header. If it exactly matches Skynet's own primary origin (from `process.env.SKYNET_COOKIE_DOMAIN` combined with the request's `Host`), forward. If it doesn't match, refuse with 403 + a Skynet-authored body (not the app's). `GET | HEAD | OPTIONS` requests bypass this check (they aren't state-changing per HTTP semantics; the existing framework CSRF protections in web frameworks similarly only check state-changing methods). Missing `Origin` header on a state-changing request: refuse (browsers always send Origin on state-changing cross-origin requests; a missing Origin on such a request is anomalous and safer to refuse). Rationale: shape file `## Shape` — "the proxy itself enforces the check at the boundary." Chosen from Option B in the shape's philosophy section; the app-side check stays disabled by design.

- **D-14: Update the starter template's disabled-check comment in `substrate/skills/app-development/templates/app-starter/svelte.config.js`** (or wherever shape 1 left the disable line — the researcher should confirm the exact file). The current comment explains why the check is off in isolation; the new comment says "The framework's default same-origin check is disabled here because Skynet's reverse-proxy enforces it at the boundary — see `src/backend/apps/app-proxy-csrf-check.ts`. Apps served directly (bypassing the proxy) rely on Skynet's edge auth + the tailnet perimeter." Verbatim wording is Claude's-discretion at plan time; the intent must be clear: the check is off BECAUSE the proxy enforces it, not as a shortcut. Rationale: shape file `## What would make it wrong` — "The starter template's disabled-check comment stays pointing at nothing. The reason it was disabled must now point at the proxy layer as the enforcement site."

### Reload persistence + multi-instance (falls out of existing pane machinery)

- **D-15: Multi-instance is allowed by default.** When left-click or drag targets a leaf and the same `(hostId, slug)` tuple is already open in a different leaf, the pane creates a new leaf without deduplication. Two independent iframes to the same app, two independent WebSocket connections (the app either handles two open sessions gracefully or it doesn't — that's the app's business). No explicit code path is added for this; multi-instance IS the default when the pane keys leaves on the tuple and doesn't gate on duplicates. Rationale: shape file `## Shape` — "the same app can appear in multiple leaves simultaneously with no deduplication."

- **D-16: Reload persistence for app leaves rides the existing pane-layout persistence mechanism unchanged.** The pane's persisted-tab-layout format already carries `{ id, instanceId, type, ... }` for every leaf; adding `app: { hostId, slug }` to that object (via the D-02 field addition) means an app tab serialises + deserialises with the same code path as every other tab kind. On reload, the pane rebuilds every leaf by re-invoking the same open-tab flow; app leaves reconnect to the proxy just like fresh clicks. Rationale: shape file `## Shape` — "The pane already remembers its layout across reloads by saving the tuple that identifies each leaf. App leaves join that machinery without any new persistence mechanism."

- **D-17: On reload after the app has disappeared (folder deleted, box offline, tunnel refused), the leaf's iframe shows whatever the browser shows for a failed connection.** No Skynet-side placeholder, no friendly "app is gone" state, no specialised error page. The proxy's tunnel-cache classifies the failure via `error-classifier.ts` and returns the interstitial from `interstitial.ts` (which is Phase 103's production-hardened error surface) — Phase 120 makes NO custom error UI. Rationale: shape file `## Philosophy` — "unhealthy/gone are display concerns, not behavior concerns; the pane doesn't specialize on app state." Phase 103's interstitial already gives a reasonable failure surface; specialising here would violate the black-box philosophy.

### Unhealthy tiles + leaf title (already-decided, restated for planner clarity)

- **D-18: An unhealthy tile (from Phase 119 D-11) remains clickable + draggable — no gating on health.** Clicking an unhealthy tile creates an app leaf like any tile; the proxy attempts a connection; the connection fails at the tunnel layer; Phase 103's interstitial renders inside the iframe. Same behaviour for dragging an unhealthy tile into a split. This is the "unhealthy is display-only" line the shape file locks. Rationale: shape file `## Shape` — "Shape 3 renders unhealthy tiles with a muted-red second line under the title. This shape doesn't make unhealthy tiles unclickable, and doesn't render a friendly 'app is down' placeholder inside the pane when a click on an unhealthy tile lands."

- **D-19: The leaf title bar for an app leaf shows the app's STATIC title from the metadata card (`app.json`'s `title` field, propagated through Phase 118's app-frame `title` field, stored in the tab's `label` field on open).** It does NOT mirror the app's live `document.title` as the app changes it internally. Rationale: shape file `## Shape` — "the leaf title bar shows the app's static metadata title." Preserves the pane-is-transparent line — Skynet doesn't peek at the app's internal state.

- **D-20: The pane sends NO signal to the app that it's being rendered in-pane.** No custom header, no query parameter, no injected JavaScript, no postMessage handshake. The app is fully instance-agnostic; it can't tell whether it's being viewed inside Skynet's pane or as a standalone fresh-tab open. The proxy's `HEADER_ALLOWLIST` (from Phase 103) governs which headers Skynet may add or forward; Phase 120 adds nothing new. Rationale: shape file `## Philosophy` — "the pane is transparent to the app."

### Testing

- **D-21: Test at four layers — client dispatch, client sidebar-wiring, backend proxy, backend CSRF check.** Coverage required:
  - **Client dispatch (D-03/D-04):** the lookup-table refactor is byte-equivalent — snapshot the rendered output of each existing tab kind before and after the refactor; assert equivalence. Add one new test for the `app` kind: mount `<AppPane hostId={1} slug="todo" ...>`, assert an iframe is rendered with the correct `src` path.
  - **Client sidebar-wiring (D-06/D-07):** click on an `AppTile`, assert `onOpenTab` is called with `{ type: "app", app: { hostId, slug }, label }`. Drag an `AppTile`, assert the drag payload has the expected shape. Drop the payload into a split target, assert a new leaf appears.
  - **Backend proxy (D-08 through D-12):** in-process test mounting the proxy route with a mock SSH tunnel + a mock upstream. Assert: HTTP GET forwards; HTTP POST with matching Origin forwards; HTTP POST with mismatching Origin gets 403; WS upgrade forwards; request from a user without `checkHostAccess` returns 403; path prefix is stripped on outgoing.
  - **Backend CSRF check (D-13):** in-process test for the middleware in isolation. GET passes without Origin. POST with matching Origin passes. POST with mismatching Origin gets 403. POST with missing Origin gets 403.

- **D-22: Executor uses scoped test runs, deploy uses full suite.** Fleet directive 2026-09-07: executor's green gate is `npx vitest related --run <touched files>` OR targeted paths under `src/ui/shell/`, `src/ui/features/pretty-conversations/`, and `src/backend/apps/`. Full suite + Playwright smoke are the ORCHESTRATOR's pre-deploy gate, NOT baked into executor prompts. Standard fleet rule.

- **D-23: Agent-side UAT (per /build step 6) converges at campaign close, not this phase's individual close.** Per Phase 119's UAT-defer policy the whole campaign's UAT runs against the live deploy after all four shapes close. Phase 120's D-20 procedure: create scratch `~/fleet/apps/scratch-shape-4-test/` on t1000 with a real `app.json` + real systemd unit + real serving content; open the sidebar Apps section; click the tile → verify a new pane leaf appears with the app rendering inside; verify a form POST inside the app succeeds (validates the CSRF-check pass path); drag the same tile into a split → verify a new leaf with a second instance renders; navigate somewhere inside the app in leaf 1 → verify the URL bar stays on Skynet's origin (validates same-origin) → reload the whole page → verify both leaves restore; stop the app's unit → verify existing leaves show the tunnel-error interstitial + new opens show the same; delete the folder → verify tile disappears on next sweep + existing leaves show the connection-refused state. Cleanup after.

### Claude's Discretion (planner + executor decide)

- The exact React component name (`AppPane`, `AppLeaf`, `AppTabContent`) — pick coherent with existing pane siblings.
- Whether the D-04 renderer map is a `Record<TabType, RenderFn>` object, a `Map<TabType, RenderFn>`, or a `readonly [TabType, RenderFn][]` array — implementation style call; the shape's "small local lookup table" phrasing doesn't prescribe.
- The exact MIME type for the app-tile drag payload — `application/x-skynet-app-tile` parallel to the existing `application/x-skynet-row`, or reuse the row MIME with a `kind: "app-tile"` field. Depends on how `SplitView.tsx`'s drop-target dispatch currently branches.
- The exact iframe attributes on `<AppPane>` — `sandbox` policy (fully-permissive vs a specific allowlist), `referrerpolicy`, `loading="eager"` (default) vs `"lazy"`. Sensible defaults: no `sandbox` restriction (the app is fully authenticated and trusted at the pane level; sandboxing would break its own JavaScript), `referrerpolicy="no-referrer-when-downgrade"` (default), `loading="eager"` (the pane is visible immediately on tab open, no lazy needed).
- The exact resolution of D-11 (path-prefix + app absolute-URL handling). Options ranked: (i) response-body HTML `<base>` tag injection at the proxy, (ii) full response-body URL rewriting, (iii) app-side relative-base config in the starter template (SCOPE AMENDMENT — needs Ashley greenlight). Researcher must recommend after investigating the SvelteKit runtime path handling + `http-proxy-middleware` response transforms.
- The exact wording of the D-14 starter template comment.
- Whether the client-side `isAppTab` narrowing predicate lives in `ui-types.ts` next to the type definition, or in `tabUtils.tsx` alongside the dispatch — either fits the current file structure.
- Split-drop feedback visual for an incoming app-tile drop — existing drop-target chrome should apply verbatim; if the coral-overlay palette Phase 117 introduced doesn't already handle a fifth source kind, extend it minimally to include app-tile drops with the same visual treatment as identity-row drops.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (authoritative for this phase)
- `.planning/campaigns/first-class-apps/shape-app-pane-content-type.md` — the LOCKED agreement from the /open pass 2026-09-18. Every D-decision above derives from it or answers a residual gray area it consciously punted. **Read first.**
- `.planning/campaigns/first-class-apps/campaign-first-class-apps.md` — the campaign artifact naming the four-shape arc + campaign hold + UAT-defer-to-close policy.
- `.planning/campaigns/first-class-apps/shape-app-runtime-and-skill.closed.md` — the closed shape 1 artifact defining the on-disk conventions + the starter template with the disabled CSRF check.
- `.planning/campaigns/first-class-apps/shape-sweep-and-registry-api.closed.md` — the closed shape 2 artifact defining the app-frame wire protocol + the `checkHostAccess` filter this phase reuses at the proxy boundary.
- `.planning/campaigns/first-class-apps/shape-sidebar-apps-surface.closed.md` — the closed shape 3 artifact defining `AppTile.tsx` and its reserved left-click / no-drag hooks that Phase 120 wires up.

### Prior phase context (heavy relevance)
- `.planning/phases/119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c/119-CONTEXT.md` — the DIRECT precursor. All 20 D-decisions especially D-12 (context-menu "Open in new tab" via the `/apps/:hostId/:slug` redirect route, which STAYS unchanged) and D-13 (left-click reserved as no-op) locked the affordances Phase 120 activates.
- `.planning/phases/118-first-class-apps-sweep-registry-shape-2/118-CONTEXT.md` — Phase 118's D-14 (three app frame types) and D-15 (per-user host-visibility filter via `checkHostAccess`) — Phase 120's proxy gates on the same `checkHostAccess` function.
- Any Phase 103 planning artifact (search `.planning/phases/` for phase 103) — the serve-URL infrastructure that `proxy-factory.ts` / `tunnel-cache.ts` / `serve-route.ts` come from. Read the Phase 103 CONTEXT and SUMMARY if present; otherwise the code + the JSDoc-heavy file-tops are enough (they're deliberately self-documenting).

### The Skynet-side code being extended
- `src/types/ui-types.ts:157-235` — `TabType` union (extend at line 162 with `"app"`) + `Tab` shape (extend at line 186 with `app?: { hostId; slug }`).
- `src/ui/shell/tabUtils.tsx` — `tabIcon` at lines 98-110 (refactor to lookup) + `renderTabContent` at lines 337-410 (refactor to lookup). Both refactors happen in-place.
- `src/ui/shell/SplitView.tsx` — the split-drop machinery + drop-target handlers. Phase 120's D-07 extends the existing drop-target payload dispatch to recognize app-tile drops. Read to understand the current dispatch shape.
- `src/ui/features/pretty-conversations/AppTile.tsx` — Phase 119's tile component. Phase 120 adds left-click + drag handlers here. The existing D-13 cursor-default styling gets removed.
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — the existing conversation-row drag-source pattern that Phase 120's tile drag mirrors.

### The Skynet-side code being added
- `src/ui/shell/AppPane.tsx` (NEW) — the in-pane leaf mount. See D-05.
- `src/backend/apps/app-proxy-route.ts` (NEW) — the `/apps/:hostId/:slug/pane/*` proxy route. See D-08.
- `src/backend/apps/app-proxy-csrf-check.ts` (NEW) — the CSRF middleware. See D-13.
- `src/backend/apps/pane-target-resolver.ts` (NEW, small) — the local-loopback-vs-remote-SSH-tunnel target resolver. See D-10. Planner may inline into the route if it feels lightweight enough.

### Existing proxy machinery being reused (READ before implementing)
- `src/backend/serve-url/proxy-factory.ts` — `getOrCreateProxyForTarget`. The per-target-cached `http-proxy-middleware` factory with the D-04 default-deny allowlist, WebSocket RSV1 fix, and per-target cache. Phase 120 reuses this VERBATIM; do not fork. **Read the JSDoc top-of-file — 2 R&D gotchas documented that must NOT be circumvented.**
- `src/backend/serve-url/tunnel-cache.ts` — `tunnelCache.getOrCreate(target)`. SSH tunnel lifecycle. Phase 120 reuses.
- `src/backend/serve-url/serve-route.ts` — the reference pattern for how `tunnelCache` + `getOrCreateProxyForTarget` are composed. Phase 120's `app-proxy-route.ts` mirrors this composition (auth + tunnel + proxy handoff) but with different auth (JWT + `checkHostAccess` in place of subdomain-dispatch's D-03) and different failure classification if needed.
- `src/backend/serve-url/error-classifier.ts` + `src/backend/serve-url/interstitial.ts` — production-hardened error surface for tunnel failures. Phase 120 reuses the interstitial for the "app gone" / "tunnel refused" / "box offline" cases per D-17.
- `src/backend/serve-url/types.ts` — `HEADER_ALLOWLIST` + `ServeTarget` shape. Phase 120's target shape mirrors `ServeTarget` since the proxy factory consumes it.

### The starter template being nudged
- `substrate/skills/app-development/templates/app-starter/svelte.config.js` (or the CSRF-related config file — researcher confirms exact path from shape 1's on-disk artifacts) — the D-14 comment update. This is the ONLY substrate-side change; the actual CSRF-disable-line stays disabled.

### Backend endpoint mount point
- `src/backend/database/database.ts` — where Phase 119's `/apps/:hostId/:slug/icon` router mounts. Phase 120's pane router mounts alongside. Read the current mount block to preserve ordering conventions.

### Fleet + host visibility (already-enforced-elsewhere)
- The `checkHostAccess(hostId, userId, mode)` helper — grep for its definition; it's the SAME function Phase 118's app-frame filter (`src/backend/fleet-status/app-frame-filter.ts`) uses. Phase 120's proxy calls it at the route entrypoint.

### External library docs (for the D-11 gray area investigation)
- `http-proxy-middleware` — official docs (npm registry landing page + GitHub README). Sections of interest: `pathRewrite`, `onProxyRes` / response body transform hooks, WebSocket upgrade behavior.
- SvelteKit docs — `paths.base` config, `paths.relative` config, `basePath` runtime behavior. Section: `svelte.config.js`. Consult only if the researcher concludes D-11 requires a scope-amendment escalation.

### Fleet-wide standing rules (from the role file, applying to this phase)
- `~/fleet/roles/box-maintainer/box-maintainer.md` § "Standing directives" — container-mutation serialization (Ashley 2026-09-12), test discipline scoped-during-dev (Ashley 2026-09-07), deploy-boundary-at-push (Ashley 2026-08-29), no-worktrees (Ashley 2026-07-31), no message streaming ever (Ashley 2026-08-29). Planner + executor must honour these.
- `~/fleet/roles/box-maintainer/box-maintainer.md` § "Load-bearing invariants" — DatabaseSaveTrigger discipline (learned 2026-08-19). **Not applicable to this phase** — the in-pane proxy is stateless and the CSRF check writes nothing — but flagged so the executor doesn't accidentally introduce a DB write.
- Deploy hold for the whole first-class-apps campaign — Phase 120's commits stack on Phase 119's held commits (which stack on Phase 118's and the held shape-1 commits) on `~/skynet-vision`'s `feat/tab-title-from-tmux` branch. `git push` + `docker build` + `docker compose up --force-recreate` all held until the campaign-close greenlight.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/backend/serve-url/proxy-factory.ts` — `getOrCreateProxyForTarget`** — IS the byte-forwarding engine. Every HTTP + WebSocket byte flows through this. Phase 120's `app-proxy-route.ts` gets a `RequestHandler` from this factory and mounts it on the app route; nothing more.
- **`src/backend/serve-url/tunnel-cache.ts` — `tunnelCache.getOrCreate(target)`** — the SSH tunnel lifecycle. Returns a local tunnel port that `proxy-factory.ts` targets. Reused verbatim.
- **`src/backend/serve-url/interstitial.ts` + `error-classifier.ts`** — production-tested error UI + classification. Phase 120 reuses for the "app gone / box offline" cases inside the iframe.
- **`src/backend/serve-url/types.ts` — `HEADER_ALLOWLIST`** — the security-boundary header discipline. Phase 120 does NOT extend it; the default-deny allowlist governs.
- **Phase 118's `checkHostAccess` (in `src/backend/fleet-status/app-frame-filter.ts` or wherever the shared helper lives)** — the auth gate. Same function, called at Phase 120's route entrypoint.
- **Phase 119's `AppTile.tsx` + `app-tiles-store.ts`** — the sidebar surface. Phase 120 adds `onClick` + drag handlers; the store is READ-ONLY from Phase 120's perspective (no changes to the store slice).
- **`src/ui/shell/SplitView.tsx`'s drop-target machinery** — general leaf-source dispatch. Phase 120 extends the dispatch with a new payload arm; does not fork the machinery.
- **`src/ui/features/pretty-conversations/PrettyConversationRow.tsx`'s draggable pattern** — the model for Phase 120's `AppTile` drag handlers. Same MIME-type convention, same payload shape.

### Established Patterns
- **`serve-url/` composition — auth gate → tunnel cache → proxy factory → response**. This IS the pattern Phase 120 mirrors, with a different auth surface (per-user `checkHostAccess` instead of subdomain-dispatch's D-03) and a different mount path (path-based `/apps/:hostId/:slug/pane/*` instead of subdomain-based `.serve.` wildcard).
- **Path-based routing + JWT auth + `resolveHostById` + `checkHostAccess`** — Phase 119's icon endpoint (`GET /apps/:hostId/:slug/icon`) is the reference for this compound auth+resolution pattern. Phase 120's `app-proxy-route.ts` reuses the same auth + resolution scaffolding at its entrypoint.
- **`switch(tab.type)` dispatch across `tabIcon` + `renderTabContent`** — the current pattern in `tabUtils.tsx`. Phase 120's D-03/D-04 refactor unifies both to a shared lookup shape. Not a rewrite; the switch bodies become table values.
- **Iframe as pane content** — new for this phase. There's no existing precedent for embedding an iframe as a whole-leaf mount in the Skynet pane (chats + terminals + RDP all mount custom React components, not iframes). Phase 120 establishes the pattern; the researcher should confirm no existing convention forbids it (unlikely — Skynet has plenty of iframe usage elsewhere, e.g., Guacamole RDP is served through a Guacamole iframe internally in `GuacamoleApp.tsx`).
- **Reuse-not-reinvent for the WS RSV1 fix** — the `proxy-factory.ts` handles this. Phase 120 MUST NOT re-implement the fix; using the factory is the whole point.

### Integration Points
- **`src/backend/database/database.ts` — the router mount block** — Phase 119 added `/apps/:hostId/:slug/icon` here; Phase 120 mounts `/apps/:hostId/:slug/pane` alongside. Path ordering matters if there's overlap; there ISN'T (icon and pane are distinct suffixes), so appending at the end matches Phase 119's convention.
- **`src/types/ui-types.ts` — `TabType` union** — extending this cascades to every `switch(tab.type)` in the codebase; the tsc exhaustiveness check will surface every one. Standard TS union-extension discipline.
- **`src/ui/shell/tabUtils.tsx` — the dispatch center** — the ONLY file that dispatches on `tab.type` for rendering. Extending it is the ONLY code change for the client-side content-type addition; no other switch in the codebase branches on all six TabType arms.
- **`src/ui/features/pretty-conversations/AppTile.tsx` — the sidebar tile** — Phase 120 adds `onClick` (left-click handler that calls `onOpenTab({ type: "app", ... })`) + `draggable` + drag payload emitters. The tile's other affordances (right-click context-menu, unhealthy variant, keyboard) stay as Phase 119 shipped them.
- **The pane's persisted-tab-layout serialiser** — deserialises `Tab` objects; the D-02 field addition (`app?: ...`) rides the existing serialiser unchanged (JSON round-trip preserves optional fields). Verify at plan time that no explicit schema-validation gate rejects unknown fields; likely fine but worth a grep.
- **Container-mutation serialization** (Ashley 2026-09-12) — applies to the eventual deploy motion at campaign close, NOT to Phase 120's planning or executor phases.

### Test Considerations
- **The `tabUtils.tsx` refactor (D-03/D-04) is byte-equivalent for existing kinds.** Snapshot tests OR a small before/after equivalence check over the five existing kinds gives the executor's green gate for the refactor. Do NOT re-verify RDP/VNC/Terminal end-to-end — trust the existing tests to catch regressions on the leaf components; this phase is just moving dispatch shape.
- **The backend proxy tests are heavy** (mock SSH + mock upstream). The `serve-url/` module has integration tests at `src/backend/serve-url/tests/*.integration.test.ts` — Phase 120's proxy tests copy their scaffolding shape (a mock upstream server + a supertest client + assertions on forwarded headers, path rewrites, WS upgrade behaviour).
- **CSRF middleware unit tests are lightweight** — pure request-in / response-out with no I/O. Mount the middleware in a bare Express app; hit it with `supertest`; assert 403 vs 200 shapes across the matrix of (method, Origin present, Origin matches).
- **Client-side drag/drop tests use jsdom + React Testing Library + `DataTransfer` mock.** Existing conversation-row drag tests (Phase 117) are the template.
- **Real end-to-end integration (D-23)** requires creating a scratch app on t1000 and driving all the gestures. This is agent-side UAT (per /build step 6), NOT a CI-runnable test. Cleanup discipline: delete the folder + `systemctl --user stop <unit>` + `systemctl --user disable <unit>` + `systemctl --user daemon-reload`.
- **Cross-identity Vitest contention** — the shared node fork pool has starved runs when two identities run scoped Vitest in parallel (Phase 80 Fix B ship-prep 2026-09-07 hit this). Not blocking, but a known cost; the executor's scoped runs may take longer than expected during peak fleet activity.

</code_context>

<specifics>
## Specific Ideas

- **The URL prefix "pane" is the disambiguation** — `/apps/:hostId/:slug/icon` (Phase 119), `/apps/:hostId/:slug` (Phase 119's redirect, `.serve.` fresh-tab), `/apps/:hostId/:slug/pane/*` (this phase, in-pane iframe). Three coexist cleanly under one prefix namespace.
- **Left-click gets `cursor: pointer`** — Phase 119 shipped the tile with `cursor: default` explicitly, D-13 there. Phase 120 removes the override so the tile becomes primary-clickable-looking.
- **Icon glyph for the `app` case in `tabIcon()` is `AppWindow`** — already imported by Phase 119's `AppTile.tsx`, keeps the icon story consistent from sidebar tile to leaf title bar.
- **The drag payload MIME type sits alongside `application/x-skynet-row`** — Phase 117 introduced the row-source MIME convention; Phase 120 either mirrors it as `application/x-skynet-app-tile` or extends the same MIME with a `kind: "app-tile"` field. The choice depends on how `SplitView.tsx` currently branches — the planner reads that.
- **Multi-instance is the free-fall behaviour** — no dedupe logic anywhere; the tuple-keyed layout just allows duplicates. That means the D-15 test is verifying ABSENCE of a gate, not presence of a special code path.
- **The starter template comment intent is documented, not the exact wording** — planner picks wording that reads naturally in the SvelteKit config file's comment style.
- **The proxy factory's JSDoc top-of-file is REQUIRED reading before touching the proxy code** — two production-hardening R&D gotchas (WS RSV1 fix, per-target cache) that Phase 120 inherits and must not undermine.

</specifics>

<deferred>
## Deferred Ideas

- **Friendlier in-pane placeholder for unhealthy / gone / box-offline states** — Phase 120 lets Phase 103's `interstitial.ts` handle these. If the interstitial's tone or copy feels wrong for the pane-embedded context (e.g., it says "serve URL failed" when the user's mental model is "app is down"), a Skynet-authored pane-specific interstitial is a small forward addition.
- **Reload action inside the app leaf** — a way to force a fresh proxy hit from inside the pane without a full page reload. Phase 120 does NOT ship one; would be a leaf-level affordance across ALL content types, not just app. Belongs in its own future shape.
- **Per-app pane customization** — custom leaf title bar treatment, per-app pane settings, per-app visual affordances, per-app icon in the leaf title. Deferred; the pane's transparency line rules these out for v1.
- **Cross-app plumbing** — deep-linking into an app's sub-page from Skynet, app-to-app postMessage, shared state across apps. Explicitly OUT per shape 4 scope + shape 1 scope; deferred.
- **App-side awareness of being in-pane** — signalling to the app so it can adapt layout / hide chrome / know its base path. Rejected during /open ("we don't need this unless there's a good reason"). Not deferred — closed.
- **Iframe-into-`.serve.`-subdomain approach for the in-pane view** — an alternative technical path that the shape file considered and rejected in favour of same-origin path proxying. The rejection reasoning ("embedding across origins is a minefield") stands; not deferred, closed by the shape file.
- **Full response-body URL rewriting at the proxy** — Phase 120 lands the minimum needed for the current starter template (via D-11's chosen resolution, likely `<base>` tag injection or SvelteKit's `paths.relative` support). If future apps outside the starter template hit URL-resolution edge cases, a heavier response transform is a follow-up.
- **Multi-instance restrictions** — some future app might misbehave with two open sessions; a per-app-declared "singleton" flag in `app.json` could gate. Not deferred to a specific phase; would be a small enhancement if a real case surfaces.
- **Split-drop feedback specialised for app-tile drops** — Phase 120 reuses the existing coral-overlay palette from Phase 117 verbatim. A dedicated visual for app-tile drops would be a Phase 119.5-ish enhancement; not planned.

</deferred>

---

*Phase: 120-first-class-apps-campaign-shape-4-apps-as-a-content-type-in-*
*Context gathered: 2026-09-18*
