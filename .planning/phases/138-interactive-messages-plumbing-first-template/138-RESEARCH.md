# Phase 138: Interactive Messages — Plumbing + First Template — Research

**Researched:** 2026-09-27
**Domain:** Full-stack plumbing — sweep extension, proxy routing, URL detection, invisible-message blacklist, in-bubble iframe, poll template, scaffold skill
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
All design decisions are locked in the shape file (`shape-interactive-messages.md`), which is identical to the CONTEXT.md for this phase. Key locked decisions relevant to Phase 1:

- Widgets live at `~/fleet/interactive-messages/<slug>/` (separate root from `~/fleet/apps/`)
- Systemd unit prefix: `im-<slug>.service` (separate from `app-<slug>.service`)
- URL prefix: `/interactive/<hostId>/<slug>/pane/*`
- Sweep: enumerates interactive-message folder root, emits a new `line_kind` (NOT bumping schema version)
- Sidebar filter: widgets are NOT shown as sidebar tiles
- URL detection: extends existing `eligibleUrls` mechanism with a URL-type discriminator (`"file"` | `"interactive-message"`)
- Submit routing: uses existing message blacklist / render-blacklist
- Phase 1 scope: one template only (poll in terminal-on-click mode)
- No lifecycle infrastructure this phase

### Claude's Discretion
- Port range for widgets (must not collide with apps' 9501-9599)
- Exact shape of `line_kind: "interactive-message"` wire fields (parallels `SweepAppLine`)
- URL-type discriminator field name on the eligibility wire
- In-bubble iframe component structure and retry logic
- Exact shape of `create-widget.sh` scaffold script

### Deferred Ideas (OUT OF SCOPE)
- Other five templates (checklist, form, list-with-per-row-actions, ranking, color picker)
- Non-terminal and terminal-on-submit modes
- Multi-widget per message
- Agent teardown command
- Seven-day backstop timer
- Expired-placeholder UI
- Custom-widget authoring instructions
- Mobile responsiveness audit beyond making the poll functional
</user_constraints>

---

## Summary

Phase 138 is pure plumbing: it wires up the entire interactive-message loop end-to-end using the existing full-app machinery as a model, forking only what must be distinct (folder root, unit prefix, URL prefix, sweep source-D, in-bubble iframe rather than full-pane iframe). Seven independent concerns must all ship together for the loop to close.

The research confirms the design's reuse strategy is sound. The proxy path (app-pane-router + app-pane-proxy-factory) can be mounted at a second URL prefix by adding one more route registration. The sweep extension is strictly additive — a new `line_kind: "interactive-message"` on the existing wire, same schema version. The URL-type discriminator requires the smallest possible change to `use-editable-file-eligibility.ts`: the hook already returns `Set<string>`; it needs to return `Map<string, "file" | "interactive-message">` (or an equivalent typed set). The render-blacklist mechanism already handles invisible user turns via the `isIdCommand` check in `PrettyView.tsx`; widget submit-signals need the same pattern at the same layer. The AppPane.tsx iframe philosophy (referrer policy, drag pass-through, dark-mode injection) transfers directly to the new `WidgetBubble` component, sized for chat flow rather than full-pane.

The single sticking point is the `eligibleUrls` rename: it is referenced in three places (`use-editable-file-eligibility.ts`, `ChatMessage.tsx`, and the `markdownComponents` memo deps). The refactor is straightforward but load-bearing — getting the type wrong here will silently break file-link pencil affordances.

**Primary recommendation:** Build in dependency order — sweep extension first (unlocks registry lookup), then proxy route (unlocks iframe src), then URL detection + type discriminator, then `WidgetBubble` component, then submit-signal blacklist wiring, then scaffold script, then poll template.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Widget discovery (port lookup) | Backend sweep (Python) | Backend registry | Same pattern as apps: sweep emits, orchestrator ingests, registry exposes `getWidgetSnapshot()` |
| Widget proxy routing | Backend Express | Nginx | Reuses app-pane-router pattern; nginx just needs `location ^~ /interactive/` block like existing `/apps/` |
| URL-type detection | Frontend hook | Backend (no change) | `use-editable-file-eligibility` runs client-side; eligibility classification is already client-side |
| In-bubble iframe rendering | Frontend (ChatMessage.tsx) | — | `a` component override in ReactMarkdown already controls URL rendering |
| Submit-signal routing | Frontend (postMessage listener) | Backend API | iframe fires postMessage → parent page writes invisible message via existing send path |
| Invisible-message blacklist | Frontend (PrettyView.tsx) | — | `isIdCommand` pattern lives in PrettyView; widget submit-signals need same check at same layer |
| Scaffold command | Substrate skill (bash script) | — | Same shape as `create-app.sh`, runs on agent's box |

---

## Standard Stack

### Core (all existing — no new npm packages for plumbing)

| Component | Version | Purpose | Why Standard |
|-----------|---------|---------|--------------|
| http-proxy-middleware | existing | Proxy widgets via SSH tunnel | Same library already used by app-pane-proxy-factory.ts |
| express | existing | Mount `/interactive/` router | Same Express instance |
| ReactMarkdown | existing | Markdown rendering in ChatMessage | No change — only the `a` override changes |
| vitest | existing | Unit tests | Project-wide test runner |

### Poll Template Runtime (widget runs on agent's box, not in Skynet container)

| Component | Purpose | Why Standard |
|-----------|---------|--------------|
| Python 3 stdlib `http.server` | Serve poll HTML | Zero dependencies; same precedent as the id-skill's file server |
| systemd `--user` unit | Keep widget alive | Same pattern as `app-<slug>.service` |
| Plain HTML + vanilla JS | Poll UI | No build step; agents can author and edit directly |

No new npm dependencies are required for the Skynet backend or frontend. The poll template uses Python stdlib only. [VERIFIED: codebase grep]

---

## Package Legitimacy Audit

No new packages are installed by this phase. The plumbing reuses existing Skynet dependencies (http-proxy-middleware, express, ReactMarkdown). The poll template uses only Python stdlib. Scaffold script is bash.

**Packages removed due to slopcheck verdict:** none (no new packages)
**Packages flagged as suspicious:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Agent box:
  ~/fleet/interactive-messages/<slug>/        widget files + state.json
  ~/.config/systemd/user/im-<slug>.service    binds to PORT (9601-9699)
  fleet-status-sweep.py                       emits line_kind:"interactive-message" JSONL

Skynet backend:
  ssh-poll-orchestrator.ts                    ingests "interactive-message" lines
  SubscriptionRegistry.getWidgetSnapshot()    port lookup
  /interactive/:hostId/:slug/pane/*           proxy route (new, mirrors /apps/)
  docker/nginx.conf location ^~ /interactive/ WebSocket-capable proxy block

Skynet frontend:
  use-editable-file-eligibility.ts            returns Map<url, "file"|"interactive-message">
  ChatMessage.tsx `a` override                "file" → pencil, "interactive-message" → WidgetBubble
  WidgetBubble.tsx (new)                      iframe + retry + postMessage listener
  PrettyView.tsx                              postMessage listener → write invisible message
```

Data flow for submit:
```
[user clicks poll option]
  → iframe JS: window.parent.postMessage({type:"widget-submit", widgetId, value}, "*")
  → WidgetBubble postMessage listener fires
  → calls sendWidgetSubmit(hostId, tmuxSession, widgetId, value) via WS/API
  → backend writes message with isMeta:true (or isIdCommand-style blacklisted prefix) into tmux session
  → agent wakes; reads ~/fleet/interactive-messages/<slug>/state.json directly
  → bubble list stays clean (blacklist applied at PrettyView.tsx onSendPayload gate)
```

### Recommended Project Structure (new files only)

```
substrate/skills/interactive-messages/
  SKILL.md                          # agent instructions for poll template
  create-widget.sh                  # scaffold command (mirrors create-app.sh)
  templates/poll-terminal-on-click/ # poll template files
    widget.html                     # static HTML + vanilla JS
    server.py                       # Python http.server wrapper + state write
    im-SLUG.service.template        # systemd unit template

src/backend/apps/
  im-pane-router.ts                 # mirrors app-pane-router.ts; mounts at /interactive
  # app-pane-proxy-factory.ts UNCHANGED (reused directly)
  # pane-target-resolver.ts UNCHANGED (reused directly)

src/ui/features/pretty-view/
  WidgetBubble.tsx                  # new in-bubble iframe wrapper

src/ui/features/pretty-view/
  use-editable-file-eligibility.ts  # MODIFIED: return type change
  ChatMessage.tsx                   # MODIFIED: a-override extended
```

### Pattern 1: Sweep Extension — New line_kind Without Schema Version Bump

**What:** Add `line_kind: "interactive-message"` lines to the sweep JSONL output. Existing parsers hit the `unknownLines` counter and continue; no fallback triggered.

**When to use:** Any time a new source is added to the sweep that isn't replacing an existing one (Phase 118 established this with `line_kind: "app"`).

**Precedent from sweep-schema.ts:**
```typescript
// Rolling-deploy safety: adding this line kind is ADDITIVE per RESEARCH.md
// § Pitfall 6. SWEEP_SCHEMA_VERSION is NOT bumped — older parsers hit the
// `else { unknownLines += 1 }` branch for `line_kind: "app"` and continue
// processing identity + pid lines fine.
```

**New interface to add:**
```typescript
// Source-D parity — one line per ~/fleet/interactive-messages/<slug>/
export interface SweepInteractiveMessageLine {
  line_kind: "interactive-message";
  schema_version: SweepSchemaVersion;
  slug: string;
  port: number | null;
  is_healthy: boolean;
  created_at_ms: number;
}
```

And widen the union and `isSweepLineOfCurrentSchema` guard:
```typescript
export type SweepLine = SweepIdentityLine | SweepPidLine | SweepAppLine | SweepInteractiveMessageLine;
// In isSweepLineOfCurrentSchema:
return (
  rec.line_kind === "identity" ||
  rec.line_kind === "pid" ||
  rec.line_kind === "app" ||
  rec.line_kind === "interactive-message"
);
```

And in `SweepParseResult`:
```typescript
interactiveMessageLines: SweepInteractiveMessageLine[];
```

### Pattern 2: Proxy Route Fork — Minimal Router for /interactive/

**What:** `im-pane-router.ts` mounts at `/interactive` in database.ts alongside the existing `/apps` mount. It performs identical auth → slug validation → hostId check → CSRF check → port lookup → target resolve → proxy handoff — but calls `getWidgetSnapshot()` instead of `getAppSnapshot()`.

**Key insight:** `getOrCreateAppPaneProxyForTarget` from `app-pane-proxy-factory.ts` can be called directly with a different `hostId`+`slug` cache key pair. The `pathRewrite` will strip `/interactive/<hostId>/<slug>/pane` instead of `/apps/<hostId>/<slug>/pane`. No need to copy the proxy factory.

**The `buildPaneMountPathRewrite` function is already exported** from `app-pane-proxy-factory.ts` (for unit tests). The new router can import it directly with the widget's slug.

**What DOES need to change in the router vs app-pane-router.ts:**
- Mount path regex: `PANE_UPGRADE_PATH_RE = /^\/interactive\/(\d+)\/([a-z0-9-]{1,64})\/pane(\/|$)/`
- Port lookup: `registry.getWidgetSnapshot()` not `getAppSnapshot()`
- Unit slug prefix: widget slugs use `im-<slug>` in the unit filename but the URL slug is just `<slug>`
- Log operation tags: `im_pane_*` for grep-ability

**WebSocket upgrade handler** must also be wired at the `httpServer.on("upgrade", ...)` level in database.ts (same as `handleAppPaneUpgrade`).

### Pattern 3: URL-Type Discriminator — Minimal Change to eligibleUrls

**What:** `use-editable-file-eligibility.ts` currently returns `Set<string>`. To support type-dispatch in ChatMessage.tsx, it must return a typed structure distinguishing file URLs from widget URLs.

**Smallest correct change:** Return `Map<string, "file" | "interactive-message">` instead of `Set<string>`.

**Impact analysis:**
- `use-editable-file-eligibility.ts`: return type changes, `eligible.add(url)` → `eligible.set(url, "file")`
- `ChatMessage.tsx line 136`: `useEditableFileEligibility` return type changes
- `ChatMessage.tsx line 408`: `eligibleUrls.has(href)` → `eligibleUrls.has(href)` still works (Map has `.has()`), but the dispatch changes to `eligibleUrls.get(href)` to determine type
- `markdownComponents` useMemo deps (line 445): unchanged (`eligibleUrls` is still the dep)
- `EditableFileAffordance` branch: only rendered when type === "file"
- New `WidgetBubble` branch: rendered when type === "interactive-message"

**Widget URL shape:** `/interactive/<hostId>/<slug>/pane/` — same origin, HTTPS. This is recognized by a new client-side regex `INTERACTIVE_MSG_URL_RE_CLIENT` added alongside `TAILNET_URL_RE_CLIENT` and `SKYNET_FILE_URL_RE_CLIENT` in `editable-file-whitelist.ts`.

**No backend change required for URL classification.** The classification of widget URLs as "interactive-message" type is purely client-side (URL shape is deterministic), unlike tailnet URLs which require a backend fetch to classify as text-or-not.

### Pattern 4: Render-Blacklist for Widget Submit Signals

**What:** Widget submit-signals are user turns that must reach the backend (wake the agent) but must not render as visible chat bubbles.

**Existing mechanism (confirmed):** `isIdCommand()` in PrettyView.tsx line 536-538 is a module-scope predicate that returns `true` for `/id ` prefix or `<command-name>/id</command-name>` content. The `onSendPayload` callback (line 1639) returns early without adding to `pendingSends` when `isIdCommand(payload)` is true. The WS send still fires — the agent wakes — but no bubble is created.

**For widget submits:** Add a parallel predicate `isWidgetSubmit()` and gate on it in the same `onSendPayload` at line 1639. Widget submit messages need a recognizable prefix. Recommended shape:

```
/widget-submit <widgetId> <value>
```

This is a raw `/widget-submit ` prefix check (plain text injected by the surrounding page's postMessage handler). The agent reads the actual state from `~/fleet/interactive-messages/<slug>/state.json`; the message body is just a wake ping.

**The `/widget-submit` message is injected via the same `__applyInputMessageForTests` / WS `input` frame path** that the ComposeBox uses, with an auto-generated mqid so the backend's split-send watchdog fires. The ComposeBox is NOT involved — the postMessage handler in WidgetBubble.tsx calls the same send-input API directly.

### Pattern 5: In-Bubble Iframe Wrapper — WidgetBubble Component

**What:** New `src/ui/features/pretty-view/WidgetBubble.tsx`. Renders inside ChatMessage.tsx's `a` component override when the URL type is `"interactive-message"`.

**Sizing:** Unlike `AppPane.tsx` which is `h-full w-full`, WidgetBubble is sized for chat flow. Poll template: fixed `height: 200px` or content-height with a max. Width: 100% of bubble content column.

**Retry-on-load-fail:** The widget's port may not be up yet when the message first renders (sweep-discovery gap after scaffold). Recommended: 3 retries with 2s / 4s / 8s backoff (exponential). On load event, clear retry timer. On error event, schedule retry. After 3 failures, render inline placeholder "Widget loading... (retrying)". No expired-placeholder UI this phase (lifecycle deferred).

**postMessage listener:** The iframe fires `window.parent.postMessage({type: "widget-submit", widgetId: string, value: unknown})`. WidgetBubble attaches a `message` event listener on the window and dispatches to the surrounding page via a prop callback `onWidgetSubmit(widgetId: string, value: string)`.

**Attribute philosophy (from AppPane.tsx):**
```tsx
<iframe
  src={`/interactive/${encodeURIComponent(hostId)}/${encodeURIComponent(slug)}/pane/`}
  title={`Widget ${slug}`}
  referrerPolicy="no-referrer"   // D-20: no Referer leak
  loading="eager"
  className="w-full border-0 rounded"
  style={{ height: "200px" }}   // chat-flow sizing
/>
```

**Drag pass-through:** Same `hasSkynetDragPayload` gating from AppPane.tsx — copy verbatim.

**Dark-mode injection:** Same `injectDarkViewerStylesheetIfApplicable` from AppPane.tsx is optional (widgets own their own dark mode since they're agent-authored HTML). Omit for Phase 1 — keep scope tight.

### Pattern 6: Sweep Python Extension — Source D

**What:** Add `_enumerate_widgets()` and `_build_widget_line()` functions to `fleet-status-sweep.py`, mirroring `_enumerate_apps()` and `_build_app_line()`.

**Key differences from apps:**
- Folder root: `~/fleet/interactive-messages/` not `~/fleet/apps/`
- Unit prefix: `im-<slug>.service` not `app-<slug>.service`
- No `app.json` metadata file — widgets only need slug + port + health
- No `has_icon` / `title` / `description` / `users` fields — widgets are not sidebar tiles
- Port extraction: same `APP_UNIT_ENV_PORT_RE` regex against `~/.config/systemd/user/im-<slug>.service`
- Health probe: same `_probe_app_port()` function (reused directly)
- Slug regex: reuse `APP_SLUG_RE` (same character class, different unit prefix)

**Widget-slug constant (add to sweep script):**
```python
WIDGET_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]*$")  # same shape as APP_SLUG_RE
WIDGET_SLUG_MAX_LEN = 40  # same ceiling
WIDGET_ENUM_CAP = 50       # same DoS-hardening cap
```

**Emit shape:**
```python
{
  "line_kind": "interactive-message",
  "schema_version": SCHEMA_VERSION,
  "slug": slug,
  "port": port_or_none,
  "is_healthy": is_healthy,
  "created_at_ms": int(folder_mtime * 1000),
}
```

No `SWEEP_SCHEMA_VERSION` bump — additive per existing pattern. [VERIFIED: sweep-schema.ts lines 260-297]

### Pattern 7: Registry Extension — getWidgetSnapshot()

**What:** `SubscriptionRegistry` (subscription-registry.ts) needs a `getWidgetSnapshot()` method parallel to `getAppSnapshot()`. The orchestrator needs an `adaptWidgetLineToState()` function and `lastTickLiveWidgets: Set<string>` per host state.

**Why separate from getAppSnapshot():** The proxy routers need to look up ports by type. If widget and app ports were co-mingled in `getAppSnapshot()`, the app-pane-router would find widget slugs and vice versa. Keeping them separate maintains the clean separation the design requires.

**Sidebar filter (NO change required):** The frontend already filters `app-snapshot` frames to render sidebar tiles. Widget frames use a different frame type (`widget-snapshot` / `widget-update` / `widget-gone`) and are never forwarded to the sidebar subscription. The `app-frame-filter.ts` handles only `app-*` frame types; widget frames pass through a no-op filter (or no filter at all — they're just not subscribed to by any frontend component that renders sidebar tiles).

### Pattern 8: Scaffold Script Shape — create-widget.sh

**What:** `substrate/skills/interactive-messages/create-widget.sh <slug> [template]`

**Key differences from create-app.sh:**
- Folder root: `~/fleet/interactive-messages/<slug>/`
- Unit prefix: `im-<slug>.service`
- Port range: `9601-9699` (distinct from apps' `9501-9599`) [ASSUMED — planner picks exact range, verify no conflicts]
- No `bun install` / `bun run build` — poll template is Python + static HTML
- No `app.json.pending` / publish step — widgets appear when port is healthy
- Pane base: `/interactive/<HOSTID>/<SLUG>/pane` substituted into the widget's HTML

**Lock file:** `~/fleet/.create-widget-lock` (separate from `~/fleet/.create-lock` used by create-app.sh to avoid flock contention)

**The `~/.claude/skynet-hostid` read** is identical — same HOSTID_FILE, same validation, same die-on-missing behavior.

### Anti-Patterns to Avoid

- **Bumping SWEEP_SCHEMA_VERSION for the new line_kind.** The app-pane precedent proves additive line_kinds do not require a version bump. Bumping it would trigger a full fallback-to-legacy cycle on all hosts simultaneously during rolling deploy.
- **Reusing app-pane-proxy-factory.ts's `buildCacheKey` directly.** The cache key includes `${hostId}:${slug}`. An `/interactive/` proxy using the same factory would share cache entries with any `/apps/` proxy that happens to have the same slug. The `im-pane-router.ts` must pass a disambiguated slug or use a different key prefix.
- **Making `use-editable-file-eligibility.ts` also fetch and classify widget URLs.** Widget URLs are same-origin HTTPS paths — they never need a backend proxy fetch. Classification is purely by URL shape (regex match on `/interactive/`). Adding them to the async sniff loop would fire a 404 fetch against every widget URL in every message on every render.
- **Using `window.parent.postMessage` with `targetOrigin: "*"` in the widget HTML.** The surrounding page is same-origin (Skynet HTTPS). The widget should target `window.location.origin` or at minimum not wildcard into cross-origin. The listener in WidgetBubble.tsx must validate `event.origin === window.location.origin`.
- **Putting widget-submit message routing through the ComposeBox.** The submit is a programmatic action from the iframe, not a user compose action. Routing it through ComposeBox would trigger WIP indicators, send animations, and other compose-flow side effects. It must go directly through the WS send-input path with an auto-generated mqid.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Proxy widget requests to agent's box | Custom HTTP tunnel | `getOrCreateAppPaneProxyForTarget` + `resolvePaneTarget` | SSH tunnel cache, interstitial error pages, header strip, WS upgrade all exist |
| Port discovery for widgets | A separate discovery poll | Extend fleet-status-sweep.py with source-D | One exec per host per cycle already; sweep is the established discovery mechanism |
| Authentication on `/interactive/` route | New auth middleware | `authenticateJWT` from AuthManager | Identical auth requirement to `/apps/` |
| CSRF protection on widget proxy | Custom origin check | `appProxyCsrfCheck` | Already handles `Origin: null` edge case from referrerPolicy=no-referrer |
| URL-type detection in message content | New scanning loop | Extend `use-editable-file-eligibility.ts` | Already runs on every message render; adding one regex pattern costs zero latency |
| In-bubble iframe dark mode | Per-widget CSS | `injectDarkViewerStylesheetIfApplicable` (optional) | Already handles Chrome's JSON/text auto-rendered viewer; copy if needed |

**Key insight:** The entire backend proxy pipeline (auth, CSRF, host resolve, SSH tunnel, error interstitials) is already correct and battle-tested. The only new backend code is a thin router that wires these existing pieces at the new URL prefix.

---

## Common Pitfalls

### Pitfall 1: Widget Proxy Cache Key Collision

**What goes wrong:** `getOrCreateAppPaneProxyForTarget` caches by `${hostname}:${port}::${tunnelPort}::${hostId}:${slug}`. If an app and a widget on the same host happen to share the same `slug` string (possible since they're in different directories), they'd share a proxy middleware with the wrong `pathRewrite`.

**Why it happens:** The cache key doesn't encode whether the slug belongs to an app or a widget.

**How to avoid:** In `im-pane-router.ts`, pass `"im-" + slug` as the `slug` argument to `getOrCreateAppPaneProxyForTarget`. This makes the cache key unique and means the `pathRewrite` rule strips `/interactive/<hostId>/<slug>/pane` → `/` correctly (the rule is keyed on the hostId+slug pair, not on the literal prefix string — see `buildPaneMountPathRewrite` in app-pane-proxy-factory.ts which builds the regex from the passed-in slug).

**Warning signs:** Widget iframe shows app content, or 404s with wrong path strip.

### Pitfall 2: Widget URL Classification Fires Backend Fetch

**What goes wrong:** `use-editable-file-eligibility.ts` currently tries to classify every URL it finds in a message body. If `/interactive/` URLs are scanned and hit the async sniff path, the backend will proxy-fetch `/interactive/<hostId>/<slug>/pane/` — which returns HTML, not a text file — and classify it incorrectly.

**Why it happens:** Widget URLs match neither `TAILNET_URL_RE_CLIENT` nor `SKYNET_FILE_URL_RE_CLIENT` today, so they're currently invisible to the hook. When we add `INTERACTIVE_MSG_URL_RE_CLIENT`, we must ensure those URLs are classified immediately (sync path, type "interactive-message") without going through the fetch path.

**How to avoid:** In the classification loop in `use-editable-file-eligibility.ts`, check the new regex first and `eligible.set(url, "interactive-message"); continue;` — same pattern as the `classifyByExtension` sync short-circuit.

### Pitfall 3: Sweep Schema Version Bump Triggers Fleet-Wide Fallback

**What goes wrong:** Setting `SCHEMA_VERSION = 2` in `fleet-status-sweep.py` causes the orchestrator's `schemaMismatch` flag to trip on every line from every host that has been upgraded. For the duration of the rolling deploy (every host where the new sweep script is running), the orchestrator falls back to legacy per-identity plumbing, losing sweep efficiency and emitting no app lines.

**Why it happens:** The `parseSweepJsonl` function rejects lines with `schema_version !== SWEEP_SCHEMA_VERSION` (current value: 1). A mismatch trips the caller's fallback branch.

**How to avoid:** Never bump `SWEEP_SCHEMA_VERSION` for additive line_kind additions. The existing comment in `sweep-schema.ts` is explicit on this. Only bump for breaking field-name/field-shape changes.

### Pitfall 4: postMessage Origin Validation Missing in WidgetBubble

**What goes wrong:** WidgetBubble's `message` event listener receives postMessages from ALL iframes on the page, not just the widget iframe. A malicious widget (or a compromised one) could inject submit signals into any conversation.

**Why it happens:** `window.addEventListener("message", handler)` fires for all sources by default.

**How to avoid:** In the listener: `if (event.source !== iframeRef.current?.contentWindow) return;` AND `if (event.origin !== window.location.origin) return;`. Both guards are needed — source guards against wrong iframe, origin guards against cross-origin injection even via same-window tricks.

### Pitfall 5: Nginx Missing /interactive/ WebSocket Block

**What goes wrong:** In-pane widget apps that use WebSockets (some might, for live state) get silently downgraded — Upgrade/Connection headers stripped by the default proxy block.

**Why it happens:** The nginx `@express_spa_fallback` block handles generic routes without WebSocket headers. Without a dedicated `location ^~ /interactive/` block with explicit `proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";`, WebSocket upgrades from widget iframes fail.

**How to avoid:** Add a `location ^~ /interactive/` block to BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` (per CLAUDE.md nginx-parity rule), mirroring the existing `location ^~ /apps/` block byte-for-byte (same proxy_http_version, same header set). The poll template doesn't use WebSockets in Phase 1, but the plumbing must be correct from day one.

**Warning signs:** Poll HTML loads, but any app that upgrades WS from inside a widget iframe fails with ERR_INVALID_HTTP_RESPONSE.

### Pitfall 6: App-pane-router.ts WebSocket Upgrade Handler Scope

**What goes wrong:** The current `handleAppPaneUpgrade` in app-pane-router.ts destroys any WebSocket upgrade request that doesn't match `PANE_UPGRADE_PATH_RE` (this was a HIGH-3 code-review fix, 2026-09-19). If the new `/interactive/` upgrade handler is not registered BEFORE `handleAppPaneUpgrade` handles the path check, interactive-message WS upgrades will be silently destroyed.

**How to avoid:** In `database.ts`, register both upgrade handlers in the `httpServer.on("upgrade", ...)` chain. The current shape calls `handleAppPaneUpgrade` only when the path matches — the non-match branch destroys the socket. For Phase 1, the simplest fix is to modify the upgrade dispatch to try both handlers before destroying: check `/apps/` path → if match, handleAppPaneUpgrade; check `/interactive/` path → if match, handleImPaneUpgrade; else destroy.

---

## Code Examples

### Existing `a` override in ChatMessage.tsx (current shape to be extended)

```typescript
// Source: src/ui/features/pretty-view/ChatMessage.tsx lines 394-434
a: ({ node: _node, ...rest }) => {
  const props = rest as React.AnchorHTMLAttributes<HTMLAnchorElement>;
  const href = props.href;
  let filename = "";
  let isEligible = false;
  if (href && eventId && onOpenEditor) {
    try {
      const parsed = new URL(href);
      filename = decodeURIComponent(parsed.pathname.split("/").pop() ?? "");
      isEligible = eligibleUrls.has(href);
    } catch { isEligible = false; }
  }
  return (
    <>
      <a {...props} target="_blank" rel="noopener noreferrer" />
      {isEligible ? (
        <EditableFileAffordance filename={filename} onOpen={() => onOpenEditor!(...)} />
      ) : null}
    </>
  );
},
```

**New shape after URL-type discriminator:**
```typescript
// eligibleUrls is now Map<string, "file" | "interactive-message">
a: ({ node: _node, ...rest }) => {
  const props = rest as React.AnchorHTMLAttributes<HTMLAnchorElement>;
  const href = props.href;
  const urlType = (href && eligibleUrls.get(href)) ?? null;
  if (urlType === "interactive-message" && href) {
    // Swap anchor for WidgetBubble entirely
    return <WidgetBubble src={href} onSubmit={onWidgetSubmit} />;
  }
  const filename = /* ... same as before ... */
  return (
    <>
      <a {...props} target="_blank" rel="noopener noreferrer" />
      {urlType === "file" ? (
        <EditableFileAffordance filename={filename} onOpen={() => onOpenEditor!(...)} />
      ) : null}
    </>
  );
},
```

### isWidgetSubmit predicate (PrettyView.tsx, mirrors isIdCommand)

```typescript
// Source: pattern from PrettyView.tsx lines 536-538 (isIdCommand)
const isWidgetSubmit = (content: string): boolean =>
  content.trimStart().startsWith("/widget-submit ");
```

Add to `onSendPayload` gate at line 1639:
```typescript
if ((isIdCommand(payload) || isWidgetSubmit(payload)) && !(attachments && attachments.length > 0)) { return; }
```

### SweepInteractiveMessageLine interface (sweep-schema.ts)

```typescript
// Source: pattern from SweepAppLine in sweep-schema.ts lines 268-297
export interface SweepInteractiveMessageLine {
  line_kind: "interactive-message";
  schema_version: SweepSchemaVersion;
  slug: string;
  port: number | null;
  is_healthy: boolean;
  created_at_ms: number;
}
```

### WidgetBubble retry pattern

```typescript
// New component src/ui/features/pretty-view/WidgetBubble.tsx
// Retry: 3 attempts, exponential: 2s / 4s / 8s
const RETRY_DELAYS_MS = [2000, 4000, 8000];

export function WidgetBubble({ src, onSubmit }: WidgetBubbleProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrySrc, setRetrySrc] = useState(src);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onError = () => {
      if (retryCount < RETRY_DELAYS_MS.length) {
        timer = setTimeout(() => {
          setRetryCount(c => c + 1);
          setRetrySrc(src + (src.includes("?") ? "&" : "?") + `_r=${Date.now()}`);
        }, RETRY_DELAYS_MS[retryCount]);
      }
    };
    iframe.addEventListener("error", onError);
    return () => {
      iframe.removeEventListener("error", onError);
      if (timer) clearTimeout(timer);
    };
  }, [src, retryCount]);

  useEffect(() => {
    const handler = (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "widget-submit") {
        onSubmit?.(e.data.widgetId, String(e.data.value ?? ""));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [onSubmit]);

  return (
    <iframe
      ref={iframeRef}
      src={retrySrc}
      title="Interactive widget"
      referrerPolicy="no-referrer"
      loading="eager"
      className="w-full border-0 rounded-md"
      style={{ height: "200px" }}
    />
  );
}
```

### Poll template — minimal Python server

```python
#!/usr/bin/env python3
# server.py — widget server for poll-terminal-on-click
# Binds to 127.0.0.1:$PORT, serves widget.html at / and POST /submit for state.
import json, os, pathlib, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

STATE_FILE = pathlib.Path(__file__).parent / "state.json"
HTML_FILE  = pathlib.Path(__file__).parent / "widget.html"
PORT = int(os.environ.get("PORT", "9601"))
lock = threading.Lock()

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            body = HTML_FILE.read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        else:
            self.send_response(404); self.end_headers()
    def do_POST(self):
        if self.path == "/submit":
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            with lock:
                STATE_FILE.write_text(json.dumps(body, indent=2) + "\n")
            self.send_response(204); self.end_headers()
        else:
            self.send_response(404); self.end_headers()
    def log_message(self, *a): pass  # silence default access log

HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
```

### systemd unit template for widgets

```ini
# im-SLUG.service.template — mirrors app-SLUG.service.template shape
[Unit]
Description=Skynet interactive widget: __SLUG__
After=network.target

[Service]
Type=simple
WorkingDirectory=__WIDGET_DIR__
ExecStart=/usr/bin/python3 __WIDGET_DIR__/server.py
Environment=PORT=__PORT__
Restart=on-failure
RestartSec=5s

[Install]
WantedBy=default.target
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|-----------------|--------|
| Full-pane iframe (AppPane.tsx) | New chat-flow-sized WidgetBubble.tsx | Must NOT reuse AppPane — wrong size/philosophy |
| `Set<string>` eligibleUrls | `Map<string, "file"\|"interactive-message">` | Additive change, not a replacement |
| Apps only in `~/fleet/apps/` | Add `~/fleet/interactive-messages/` in parallel | Same sweep machinery, separate folder |
| Single upgrade handler (handleAppPaneUpgrade) | Two handlers, checked before destroy | WS upgrades for both prefixes must work |

**Deprecated/outdated in this context:**
- `eligibleUrls.has(href)` dispatch pattern in ChatMessage.tsx → becomes `eligibleUrls.get(href)` type dispatch

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Widget port range 9601-9699 is free of conflicts with existing services | Standard Stack / create-widget.sh | Port collision; choose a different range at plan time |
| A2 | The poll template's postMessage from widget to parent will work given `referrerPolicy="no-referrer"` on the iframe | WidgetBubble pattern | postMessage is not affected by referrerPolicy (referrerPolicy controls Referer header, not postMessage). LOW risk — postMessage origin/source validation is what matters. |
| A3 | `/widget-submit ` prefix is not used anywhere else in the codebase | isWidgetSubmit | If it is, the blacklist would suppress legitimate user messages. Search before using. |
| A4 | `app-pane-proxy-factory.ts`'s `getOrCreateAppPaneProxyForTarget` is safe to call from a second router (im-pane-router.ts) concurrently | Proxy route fork | The factory is already called from both the HTTP handler and the WS upgrade dispatcher for apps; concurrent callers are fine (module-level Map with synchronous get/set). |

**If this table is empty:** All other claims in this research were verified or cited.

---

## Open Questions

1. **WebSocket upgrade handler ordering in database.ts**
   - What we know: `httpServer.on("upgrade", handleAppPaneUpgrade)` is the only upgrade handler registered today; non-matching paths are destroyed.
   - What's unclear: Is `handleAppPaneUpgrade` exported in a way that lets the new interactive-message router share or extend the dispatch logic, or does the Phase 1 plan need to refactor the upgrade dispatcher in database.ts?
   - Recommendation: Export both `handleAppPaneUpgrade` and the new `handleImPaneUpgrade`; register them in database.ts inside a combined dispatcher that tries both and destroys only if neither matched.

2. **WidgetBubble `height` — fixed vs. content-auto**
   - What we know: The poll template has a predictable number of buttons.
   - What's unclear: Whether a fixed `height: 200px` is correct for an N-option poll, or whether the iframe should resize to content height via postMessage from the widget.
   - Recommendation: Fixed height for Phase 1 (2-5 options at ~40px each = 200px max). Leave content-resize as a Phase 2 enhancement.

3. **Widget URL shape in agent messages**
   - What we know: The agent writes an anchor URL into its message. The URL must be same-origin.
   - What's unclear: Whether the URL is `/interactive/<hostId>/<slug>/pane/` (discovered from `~/.claude/skynet-hostid` + slug) or a fully-qualified `https://<skynet-domain>/interactive/...`.
   - Recommendation: The skill tells agents to use the relative path `/interactive/<hostId>/<slug>/pane/`. The frontend's `INTERACTIVE_MSG_URL_RE_CLIENT` matches both forms. The `use-editable-file-eligibility.ts` hook scans `messageBody.match(...)` — both relative and absolute URLs can be matched if the regex is designed for it. Using the fully-qualified HTTPS URL (absolute) is safer for the regex and mirrors how `SKYNET_FILE_URL_RE_CLIENT` works.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3 on agent box | Poll template server | ✓ (fleet standard) | 3.6+ | None — fleet requirement |
| systemd --user on agent box | Widget service unit | ✓ (fleet standard) | any | None — fleet requirement |
| bun | NOT required for Phase 1 | — | — | Poll uses Python, no bun |
| `~/.claude/skynet-hostid` | create-widget.sh | ✓ (written by distributor) | n/a | Die on missing, same as create-app.sh |

---

## Validation Architecture

*nyquist_validation: false in config.json — section omitted per config.*

---

## Security Domain

`security_enforcement: true` in config.json.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `authenticateJWT` middleware — same as /apps/ route |
| V3 Session Management | no | Widget proxy is stateless |
| V4 Access Control | yes | `checkHostAccess` — same as /apps/ route |
| V5 Input Validation | yes | `APP_SLUG_RE` for widget slugs; `hostIdNum` positive-integer check |
| V6 Cryptography | no | No new crypto surfaces |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via widget slug | Tampering | `APP_SLUG_RE` gate (same pattern as apps) before any DB/SSH work |
| SSRF via widget iframe postMessage injecting arbitrary messages | Tampering | `event.origin === window.location.origin` + `event.source === iframeRef.current.contentWindow` in WidgetBubble listener |
| Cross-origin widget injection (attacker-controlled iframe postMessage) | Elevation of Privilege | Same origin check above |
| Widget slug collision between apps and widgets | Tampering | Disambiguate cache key: `"im-" + slug` in im-pane-router; separate port range |
| Widget postMessage flood (DoS via rapid submit signals) | DoS | The blacklist gate in PrettyView means each signal writes exactly zero bubbles; the WS send-input rate limiter (if any) applies normally |
| CSRF on widget proxy | Tampering | `appProxyCsrfCheck` — reused from app-pane-router |
| Clickjacking widget in external frame | Elevation of Privilege | `X-Frame-Options: SAMEORIGIN` + `Content-Security-Policy: frame-ancestors 'self'` — set in `on.proxyRes` hook (same as apps, reused from `getOrCreateAppPaneProxyForTarget`) |

---

## Sources

### Primary (HIGH confidence)

- `src/backend/apps/app-pane-router.ts` — full proxy router implementation, WS upgrade dispatcher, auth/CSRF/hostAccess/port-lookup chain [VERIFIED: codebase read]
- `src/backend/apps/app-pane-proxy-factory.ts` — proxy factory, cache key, pathRewrite, base-tag injection, header discipline [VERIFIED: codebase read]
- `src/backend/apps/pane-target-resolver.ts` — SSH tunnel resolution [VERIFIED: file exists, imported by router]
- `substrate/scripts/fleet-status-sweep.py` lines 174-213 — app enumeration constants, filesystem-only inspection, port probe [VERIFIED: codebase read]
- `src/backend/fleet-status/sweep-schema.ts` — SweepAppLine, parseSweepJsonl, isSweepLineOfCurrentSchema, rolling-deploy safety comment [VERIFIED: codebase read]
- `src/ui/features/pretty-view/use-editable-file-eligibility.ts` — full eligibility hook, return type `Set<string>`, sync/async paths [VERIFIED: codebase read]
- `src/ui/features/pretty-view/ChatMessage.tsx` lines 390-445 — `markdownComponents` useMemo, `a` override, `isEligible` / `eligibleUrls` dispatch [VERIFIED: codebase read]
- `src/ui/features/pretty-view/PrettyView.tsx` lines 536-538, 1623-1639 — `isIdCommand` definition, render-blacklist gate in `onSendPayload` [VERIFIED: codebase read]
- `src/ui/shell/AppPane.tsx` — iframe philosophy (referrerPolicy, drag pass-through, dark-mode injection), full component [VERIFIED: codebase read]
- `substrate/skills/app-development/create-app.sh` — full scaffold script, port-claim lock, HOSTID read, unit template substitution [VERIFIED: codebase read]
- `docker/nginx.conf` lines 159-184 — `location ^~ /apps/` WebSocket-capable block, mirror requirement [VERIFIED: codebase read]

### Secondary (MEDIUM confidence)

- `src/backend/fleet-status/registry-holder.ts` — `getRegistry()` / `setRegistry()` pattern; `getAppSnapshot()` interface defined in subscription-registry.ts line 264 [VERIFIED: grep]
- `src/backend/fleet-status/app-frame-filter.ts` — app frame filtering; confirms widget frames need separate handling to stay off sidebar [VERIFIED: file structure read]

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — all reused libraries are confirmed existing deps
- Architecture: HIGH — all patterns verified directly in source; forking/extension points confirmed
- Pitfalls: HIGH — all from direct code reading, not conjecture
- Sweep extension pattern: HIGH — confirmed from sweep-schema.ts rolling-deploy comment + parseSweepJsonl logic
- Poll template shape: MEDIUM — Python stdlib server pattern is known-good; exact HTML/JS is Phase 1 authoring work

**Research date:** 2026-09-27
**Valid until:** ~2026-10-28 (30 days; this is a stable internal codebase)
