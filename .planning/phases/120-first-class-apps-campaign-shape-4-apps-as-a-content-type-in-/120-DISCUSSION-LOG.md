# Phase 120: First-class apps — apps as a content type in the pane (shape 4) - Discussion Log

**Session date:** 2026-09-18
**Discussion mode:** seeded-from-shape-file (per /build skill rule)
**Duration:** single session, chained inside /build

## Session shape

This discuss-phase was seeded directly from a completed /open shape file rather than conducted as a fresh Q&A. Per the /build skill: *"If the vehicle is a GSD phase, seed discuss-phase from the shape file. shape-<slug>.md already captures the 'why + what + constraints + scope edges' that /gsd:discuss-phase would otherwise re-elicit into CONTEXT.md — either drop the shape file in as CONTEXT.md directly, or generate CONTEXT.md from it. Don't re-do the discovery work /open already did."*

The /open conversation earlier in the same session covered all the substantive design decisions through the three-beat pitch → discuss → grill flow:

1. **Pitch** — I offered the shape I saw from the campaign artifact declaration + prior shape context. the user accepted my read and asked me to slow down and drive step-by-step.
2. **Discuss** — Walked through five conceptual layers in /explain style, one at a time, each with a check-in before proceeding:
   - What "content type" means today (pane, leaves, layout, kinds, tuple identifier)
   - What changes when apps join that family (fifth kind; (host, slug) tuple; leaf identical to chats/terminals from the pane's perspective; dispatch refactor rationale)
   - How the pane actually shows a live running app (two bridges — direct `.serve.` for fresh-tab, path-based same-origin for in-pane; why embedding-across-origins is a minefield; WebSocket + HTTP flowing through)
   - The Origin/CSRF question (what CSRF is; how the proxy creates the Origin mismatch; three options — rewrite Origin, check at proxy, accept residual — the user picked B, check at proxy)
   - The two gestures that put an app in the pane (left-click matches existing leaf-replace behavior; drag matches existing split-drop machinery)
3. **Design calls settled through discussion** — each with brief pitch + the user's greenlight:
   - Unhealthy tiles: no click/drag special-casing; unhealthy is display-only, no in-pane placeholder
   - Multi-instance: allowed by default; no deduplication
   - Gone-at-reload: proxy failure shows through naturally, no Skynet-side placeholder
   - Dispatch-table refactor: bundled inside this phase, not a separate pre-shape
4. **Grill** — Two sharp questions to surface unstated opinions:
   - Does the app know it's being rendered in-pane vs. standalone? → No, transparent (the user's leaning; I confirmed with case-analysis)
   - What does the leaf title bar show? → Static metadata title (preserves black-box philosophy)

All above landed in `.planning/campaigns/first-class-apps/shape-app-pane-content-type.md`, greenlit by the user with a thumbs-up before /build proceeded.

## Areas selected for discuss-phase

Given the shape file's thoroughness, no interactive AskUserQuestion round was run. Instead the seed-from-shape workflow produced CONTEXT.md by:

- **Direct translation** — the shape file's `## Shape` section decisions became D-01 through D-20 with explicit ties back to the shape file text.
- **Grounded to specific code** — every D-decision names the file(s) it touches and the pattern it reuses; done via a lightweight codebase scout of `src/ui/shell/tabUtils.tsx`, `src/types/ui-types.ts`, `src/backend/serve-url/`, `src/ui/features/pretty-conversations/AppTile.tsx`.
- **Residual gray areas surfaced** — one genuine open gray area consciously left for research: D-11's path-prefix + app absolute-URL handling (three options ranked; researcher recommends after investigating).

## Decisions locked in CONTEXT.md

**Tab model + dispatch table refactor:**
- D-01: Extend `TabType` union with `"app"` as sixth arm
- D-02: Extend `Tab` shape with optional `app?: { hostId; slug }`
- D-03: Refactor `tabIcon()` from switch to lookup table
- D-04: Refactor `renderTabContent()` from switch to lookup table
- D-05: New `<AppPane>` component mounts an iframe at the proxy path

**Sidebar tile gestures:**
- D-06: Left-click on tile creates `type: "app"` tab in focused leaf
- D-07: Drag from tile creates new leaf via existing split-drop machinery

**Backend in-pane proxy:**
- D-08: New route `/apps/:hostId/:slug/pane/*` under Skynet's own origin
- D-09: Reuses `serve-url/proxy-factory.ts` verbatim (HTTP + WS forwarding)
- D-10: Reuses `serve-url/tunnel-cache.ts` verbatim (SSH tunnels)
- D-11: Path-prefix stripping; **response URL handling for absolute paths is the phase's ONE open design gray area — researcher recommends**
- D-12: Per-user `checkHostAccess` filter at the route entrypoint

**CSRF/Origin boundary check (Option B from /open):**
- D-13: New middleware `app-proxy-csrf-check.ts` enforces same-origin on POST/PUT/PATCH/DELETE at the proxy
- D-14: Starter template comment update pointing the disabled-check line at the proxy layer as the enforcement site

**Reload persistence + multi-instance:**
- D-15: Multi-instance allowed by default (falls out of tuple-keyed layout)
- D-16: Reload persistence rides existing pane-layout mechanism unchanged
- D-17: Gone-at-reload shows Phase 103's `interstitial.ts` inside the iframe

**Unhealthy tiles + leaf title:**
- D-18: Unhealthy tiles clickable/draggable — no gating on health
- D-19: Leaf title = static metadata title (not app's live document.title)
- D-20: No signal from pane to app about being in-pane (transparent)

**Testing:**
- D-21: Test at four layers (client dispatch, client sidebar-wiring, backend proxy, backend CSRF)
- D-22: Executor scoped tests; orchestrator full suite pre-deploy (fleet rule)
- D-23: Agent-side UAT defers to campaign close per shape-3 UAT-defer policy

## Deferred to future phases

- Friendlier in-pane placeholder for unhealthy/gone/box-offline states
- Reload action inside app leaf (belongs to a leaf-level affordance across all content types)
- Per-app pane customization (custom title treatment, per-app pane settings)
- Cross-app plumbing (deep-linking, postMessage, shared state)
- Full response-body URL rewriting at the proxy (only if apps outside the starter template hit edge cases)
- Multi-instance singleton flag in `app.json` (if a real case surfaces)
- Split-drop feedback specialised for app-tile drops

## Rejected / closed by shape file

- App-side awareness of being in-pane (closed during /open grill)
- Iframe-into-`.serve.`-subdomain approach (rejected in shape file's philosophy)

## Claude's discretion (planner + executor decide)

- Exact component name (`AppPane` / `AppLeaf` / `AppTabContent`)
- Renderer map data structure (`Record` / `Map` / `readonly []`)
- Drag payload MIME type (parallel MIME vs extend existing)
- iframe attributes (sandbox policy, referrerpolicy, loading)
- D-11 resolution (base-tag injection vs response rewrite vs scope-amendment for starter template)
- Starter template comment exact wording
- `isAppTab` type predicate location

## Notes for the planner

- Shape file's `## Philosophy`, `## What would make it wrong`, and `## Scope edges` are the LOCKED ruleset. Read the shape file first — it's the source of truth for every "why" behind every D-decision.
- D-11 is the ONE genuinely open design question. The three options are ranked in CONTEXT.md; researcher should investigate `http-proxy-middleware` response transforms + SvelteKit `paths.base` / `paths.relative` runtime behavior before recommending.
- The `proxy-factory.ts` JSDoc top-of-file documents two production-hardening R&D gotchas (WebSocket RSV1 fix, per-target cache). Executor MUST NOT circumvent them.
- Deploy hold for the whole first-class-apps campaign: Phase 120's commits stack on Phase 119's held commits. No push, no build, no deploy until campaign close (all four shapes + agent-UAT + the user's greenlight).

---

*Phase: 120-first-class-apps-campaign-shape-4-apps-as-a-content-type-in-*
*Discussion logged: 2026-09-18*
