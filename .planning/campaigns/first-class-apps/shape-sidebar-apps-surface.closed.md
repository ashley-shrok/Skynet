# Shape: Apps section in the sidebar

**Opened:** 2026-09-18
**Vehicle:** GSD phase

## What this is

A new collapsible section in the sidebar, sitting just above the pinned group, that shows the user her apps — the ones her agents have built for her, across every box she has access to in her fleet. The section is always present in the sidebar, even when she has zero apps, so the whole feature is discoverable rather than being a surprise the first time an agent builds her something.

Populated tiles let her open an app in a separate, authenticated browser tab via a context menu. Opening a tile in the current view or dragging it into a split leaf are deliberately out of scope for this shape — they belong to a later shape in the same campaign.

## Shape

A header row for the section, matching the existing collapsible-group pattern already used elsewhere in the sidebar — a small icon, an uppercase label reading "Apps", a fading rule line, and a chevron for collapse/expand. Collapsed by default, matching the existing convention.

When expanded, one of two contents renders:

- **Empty-expanded state.** A single line of muted italic text sitting in the section body: *Ask an agent to make an app for you.* That is the whole content when the user has zero apps visible to her.
- **Populated state.** A flat list of app tiles, one per app the user has access to across her fleet. No grouping by host; ordering is a design detail to settle in planning (alphabetical by title is the leaning; the frame stream needs a stable sort applied client-side regardless).

Each tile is a bubble in the same visual family as the existing conversation rows — same padded rectangle, same drop shadow, same hover lift — but with two deliberate differences:

- **The icon slot is a rounded square, not a round disc.** This distinguishes an app visually from an identity at a glance while keeping the visual weight consistent with the surrounding sidebar.
- **The body is single-line, showing only the app title.** No secondary line, no last-touched time, no description. Titles from the app metadata file stand on their own.

For v1, all tiles share a single neutral hue — the sidebar's default row hue (the hue that identity rows fall back to when no per-cosmetics colour has been supplied). No per-app colour. Per-app colour is deferred; if it becomes worth doing later, the tile treatment is ready to receive it (same mechanism the conversation rows already use).

The same neutral treatment carries into the icon-slot fallback: when an app supplied no icon, the icon slot renders a large first-letter on the same neutral hue that fills the rest of the tile — mirroring the fallback identity rows use today when an identity has no avatar. The fallback square deliberately does not receive a per-app hue; that would reintroduce the per-app colour the shape rules out for v1.

Each tile has a context menu, triggered by the same interactions the existing conversation rows use (right-click on desktop, long-press on mobile). The menu has one action in v1: **Open in new tab.** That action opens the app's Skynet-served URL in a fresh browser tab; the fresh tab inherits the user's authenticated session naturally via the browser session cookie, so no auth handshake is needed at the client.

Data comes from the live subscription channel the previous shape delivered. The client subscribes on mount, receives delta frames as apps appear, update, or disappear across the fleet, and renders atomically on each frame — no partial or streaming states. Backend already applies per-user host-visibility filtering, so the client does not re-filter; it renders whatever the channel delivers.

Placement in the sidebar's vertical order: below the search input (which stays first so it isn't displaced), above the Pinned group (which was previously first-content). The rest of the sidebar's order is unchanged.

## Philosophy

**Discoverability first.** The section header is always visible, even when the section is empty. A user who has never had an agent build her an app should be able to see the affordance and understand what it is. Hiding the section when empty would defeat the whole point of the campaign.

**Reuse existing sidebar vocabulary.** The section header pattern already exists elsewhere in the sidebar; the tile bubble already exists as the conversation row; the context menu component already exists. This shape is a new arrangement of familiar pieces, not a new visual language.

**Deliver standalone value.** This shape must be independently useful — a user should be able to see her apps, open one in a new tab, and get real work done, without the next shape ever landing. The "open in current view" and "drag into a split" affordances are the next shape's job; this shape is complete without them.

**Render atomically on frame arrival.** Skynet does not stream anywhere; app tiles are no exception. Every frame that arrives triggers a whole-list reconciliation and the tiles render in their new state in one paint. No skeleton rows, no shimmer, no "connecting…" states.

**Same visibility model as identities.** The user sees apps hosted on boxes she has access to, and only those. The filtering happens backend-side (previous shape); the client renders whatever the channel delivers, without a second layer of client-side filtering to go stale.

## Prior context

The previous shape in this campaign landed the fleet-wide subscription channel that delivers per-user-filtered app frames to the client. That channel is already live and tested; this shape consumes it.

The sidebar already has a collapsible-group pattern (used today for the archived-conversations section) with an icon + uppercase label + fading rule + rotating chevron. That is the header template this shape re-uses.

The conversation rows in the sidebar are hue-tinted glass bubbles with a round avatar disc, a title, and a secondary line. This shape re-uses the bubble treatment (padded rectangle, gradient, hover lift, drop shadow) but swaps the round disc for a rounded square, drops the secondary line, and holds the hue neutral for v1.

The sidebar's existing context menu component supports right-click on desktop and long-press on mobile. This shape re-uses it for app tiles.

Every managed box in the fleet has an app-metadata file per app under a canonical on-disk path (first campaign shape); Skynet's fleet-status sweep already reads those metadata files and pushes the resulting frames to subscribed clients (second campaign shape).

The archived-section content in the sidebar lazy-renders — rows are not mounted in the DOM until the section is expanded. That is a load-bearing convention this shape follows.

## What would make it wrong

- **The section only appears when the user has apps.** If the empty-expanded state is left out, or the whole section is hidden when the app list is empty, the feature stops being discoverable and defeats the campaign's premise.
- **Tiles leak apps the user doesn't have access to.** The backend filter is the sole enforcement mechanism; if a change in this shape accidentally introduces a second client-side filter (or re-fetches from an unfiltered channel), the visibility contract slips.
- **The sidebar layout thrashes when frames arrive.** If tiles reorder or flicker on every frame, the sidebar becomes unusable during periods of normal fleet activity. Rendering must be stable — a sort key that does not change unless the underlying data changes.
- **Opening a tile in a new tab lands on an unauthenticated page.** If the "Open in new tab" action produces a tab that greets the user with a login prompt (or worse, a blank page), the only user-visible action in this shape has failed. The tab must land on the app, live, authenticated.
- **The tile visual competes with or overwhelms the conversation list.** Apps are a sibling surface, not the main event. If the app tiles are so visually loud that they pull attention away from conversations, the sidebar's centre of gravity has been misplaced.
- **The section is always mounted, even when collapsed.** The existing archived-section pattern lazy-renders its content — rows are not in the DOM until expanded. Mounting many app tiles into a collapsed section would waste layout work and violate the established convention.
- **A "streaming" affordance sneaks in.** Skeleton rows, "loading…" placeholders, spinners for individual tiles — any of these violate the atomic-render fleet rule. The section shows what the channel has delivered so far, and updates atomically when new frames arrive.
- **A tile with no supplied icon renders with a blank space where the icon slot should be.** Every tile has an icon slot in its layout; when the app doesn't supply an icon, the slot is filled with a monogram fallback (first letter of the title on a hashed-hue rounded-square background), not left empty.

## Scope edges

**In:**

- New collapsible section, positioned below the search input and above the Pinned group.
- Section header matching the existing group-header pattern (icon + uppercase label "Apps" + rule + chevron), collapsed by default.
- Empty-expanded state carrying a single italic muted line: *Ask an agent to make an app for you.*
- Populated state: flat list of tiles, one per app in the frame stream.
- Tile visual: same bubble treatment as conversation rows, rounded-square icon slot, title only, neutral hue.
- Icon rendering: real icon if the app supplied one (fetched from a new small Skynet backend endpoint that mirrors the identity-avatar serving pattern — SSH to the app's home box, stream the icon file back, 404 if absent); first-letter fallback on the same neutral hue as the tile if not.
- Context menu on each tile with a single action: "Open in new tab."
- Wiring to the live app-frame subscription channel; atomic reconciliation on each frame.
- Stable client-side ordering (leaning alphabetical by title, to be finalised in planning).
- Lazy render when collapsed, matching the archived-section convention.
- Test coverage: in-process tests for the sidebar section rendering with mock frame streams (empty, populated, mixed icon-present/icon-absent, context-menu interaction, ordering stability across frame updates).

**Out:**

- Clicking a tile to open the app in the current view. That belongs to the app-pane-content-type shape.
- Dragging a tile into a split leaf. Same.
- Any in-view or embedded rendering of the app itself. Same.
- Additional context menu actions (rename, delete, launch on a specific host, share).
- Per-app colour or theming.
- App-management affordances from the sidebar (creating, editing, deleting apps).

**Deferred:**

- Grouping tiles by host. If titles alone become insufficient to distinguish apps on many boxes, revisit as a follow-up shape or a small enhancement.
- A secondary "description" line under the title. If titles are frequently ambiguous, this becomes a small enhancement rather than a whole shape.
- An eager-refresh nudge for freshly-created apps if the standard sweep cadence feels laggy after create.

**Tempting but no:**

- Making the section not appear until the user has apps. This defeats discoverability; it is the wrong instinct.
- Adding a "create app" button in the section header. App creation is an agent-driven flow, not a user-driven sidebar affordance.
- Streaming affordances for individual tiles as frames arrive. Skynet does not stream, and app tiles are no exception.
- Using per-app hues on day one to make tiles more distinguishable. Colour was explicitly deferred for v1; the tile treatment leaves room for it later without prejudging.

## Vehicle notes

Single GSD phase. Same vehicle the two previous campaign shapes used, same rhythm — discuss-phase seeded from this shape file, plan-phase, execute-phase in waves, verifier pass, followed by the campaign's usual unbiased general-purpose code review and `/close` conformance check.

Deploy stays held for campaign close (per Ashley's greenlight covering the whole campaign) — commits land locally on the current working branch and stack on top of the two previous shapes' held commits, pushed to origin and deployed together once the campaign completes.

Related pointers:

- Campaign artifact: `.planning/campaigns/first-class-apps/campaign-first-class-apps.md`
- Prior shape close-outs (same folder): `shape-app-runtime-and-skill.closed.md` and `shape-sweep-and-registry-api.closed.md`
- Tasting artifact from this `/open` session: `.planning/campaigns/first-class-apps/tasting-tile-visuals.html` (variant A + square-icon + title-only refinement is what this shape encodes; can be shut down after phase planning consumes it)
- Sidebar feature directory: the planning phase will identify the concrete files during discuss-phase — kept shape-neutral here per the no-code-symbols rule

This file feeds `/gsd:discuss-phase` directly as CONTEXT.md seed material (per fleet rule: shape files feed discuss-phase, don't re-do the discovery `/open` already did).

---

## Close-Out

**Closed:** 2026-09-18
**Vehicle used:** GSD phase
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · New collapsible Apps section renders above pinned group, always present, populated from the fleet-wide subscription channel
- **Shape: header row (icon + uppercase 'Apps' + fading rule + chevron, collapsed by default)** — present · Panel adds a group header mirroring the archived-section chrome; icon, uppercase label 'Apps', gradient rule, rotating chevron, collapsed-by-default
- **Shape: empty-expanded state (single muted italic line 'Ask an agent to make an app for you.')** — present · Renders the verbatim italic muted line inside the expanded-only gate
- **Shape: populated state (flat tile list, no host grouping, stable client-side sort)** — present · Flat list; alphabetical by title with hostId:slug tiebreak via locale-aware compare in the store
- **Shape: tile visual (conversation-row bubble family; rounded-square icon slot; title only; neutral hue)** — partial · Bubble treatment, rounded-square icon slot, neutral hue all present; title-only broken by an intentional second-line unhealthy variant added after the shape was written (see additions)
- **Shape: iconless first-letter monogram fallback on the same neutral hue** — present · Fallback letter renders inside the icon slot on the inherited neutral hue; per-app hue explicitly not emitted
- **Shape: context menu with single 'Open in new tab' action** — present · Right-click opens the existing context menu with exactly one item; touch long-press wires the same menu via a 500ms timer with movement cancel
- **Shape: Open in new tab lands authenticated** — present · Fresh tab opens with a noopener/noreferrer window features string and relies on the browser session cookie as the shape prescribes
- **Shape: live subscription wiring (snapshot/update/gone) with atomic reconciliation** — present · Three new frame arms mirrored, client dispatches to a standalone store slice that replaces the map atomically per frame
- **Shape: no second client-side filter (backend visibility trusted)** — present · Store consumes whatever the channel delivers; no re-fetch, no additional filter
- **Shape: placement below search input, above Pinned group** — present · Rendered outside the search-vs-three-zone ternary; A19/A20 tests lock placement
- **Philosophy: discoverability first** — present · Section header renders unconditionally regardless of tile count
- **Philosophy: reuse existing sidebar vocabulary** — present · Archived-section chrome, tile bubble treatment, existing context menu component all reused
- **Philosophy: deliver standalone value (no in-view / drag-into-split needed)** — present · Left-click is a deliberate no-op; only 'Open in new tab' ships
- **Philosophy: render atomically on frame arrival (no streaming/skeletons)** — present · Store publishes replace-whole-map on snapshot; no partial states, no skeletons, no loading affordance
- **Philosophy: same visibility model as identities** — present · Backend filtering is sole enforcement; client renders whatever arrives
- **Prior context: reuses archived-section header + tile bubble + context menu components** — present · All three vocabulary pieces reused as prescribed
- **Prior context: consumes the fleet-wide subscription channel from the prior shape** — present · Three app frame types flow from the prior shape's channel through the client dispatch into the store
- **Prior context: archived-section lazy-render convention (rows not mounted until expanded)** — present · Gate on the expanded flag suppresses the entire section body including tiles and empty-state prompt
- **What would make it wrong: section only appears when the user has apps** — present · Outer wrapper is not gated on tile count; test A15 locks it
- **What would make it wrong: tiles leak apps the user doesn't have access to** — present · No client-side filter added; store rendering trusts the backend-filtered channel
- **What would make it wrong: sidebar layout thrashes when frames arrive** — present · Stable sort key (title with hostId:slug tiebreak) computed via memoisation; no re-sort on unchanged data
- **What would make it wrong: opening a tile in a new tab lands unauthenticated** — present · Target URL is under the Skynet origin so the session cookie carries; matches the shape's model
- **What would make it wrong: tile visual competes with or overwhelms the conversation list** — present · Base tile is same visual weight as conversation rows; muted-red unhealthy line is small and only appears in the unhealthy branch (endorsed drift)
- **What would make it wrong: section always mounted even when collapsed** — present · Lazy-render via the expanded flag keeps tile DOM out until expanded; test A16 locks it
- **What would make it wrong: a 'streaming' affordance sneaks in** — present · No skeletons, no per-tile spinners, no loading state; store returns empty until first frame
- **What would make it wrong: tile with no icon renders blank** — present · First-letter monogram fallback in the icon slot; image error also flips to fallback
- **Scope edges IN: new collapsible section positioned correctly** — present
- **Scope edges IN: header chrome matches existing pattern** — present
- **Scope edges IN: empty-expanded prompt verbatim** — present
- **Scope edges IN: populated flat tile list from frame stream** — present
- **Scope edges IN: tile visual (bubble, rounded-square icon, title only, neutral hue)** — partial · Title-only broken by the endorsed unhealthy second-line drift; rest present
- **Scope edges IN: real-icon serving via new backend endpoint mirroring identity-avatar** — present · Auth-gated, slug-validated, host-resolved, SSH-fetched with 404/502 shapes mirroring identity-avatar
- **Scope edges IN: monogram fallback on the same neutral hue** — present
- **Scope edges IN: context menu with single 'Open in new tab'** — present · Exactly one item
- **Scope edges IN: live channel wiring + atomic reconciliation** — present
- **Scope edges IN: stable client-side ordering (leaning alphabetical by title)** — present · Alphabetical with hostId:slug tiebreak
- **Scope edges IN: lazy render when collapsed** — present
- **Scope edges IN: test coverage (empty, populated, mixed icons, context menu, order stability)** — present · Component tests, store tests, and panel integration tests all cover the D-18 three-layer bar
- **Scope edges OUT: click-to-open in current view** — present · Left-click is a documented no-op; cursor deemphasised
- **Scope edges OUT: drag into split leaf** — present · No drag handlers on the tile
- **Scope edges OUT: in-view / embedded rendering of the app** — present · Nothing embeds the app; only external new-tab open
- **Scope edges OUT: additional context menu actions (rename/delete/launch/share)** — present · Menu holds exactly one item
- **Scope edges OUT: per-app colour or theming** — present · No inline per-app hue emitted; test locks this
- **Scope edges OUT: app-management affordances from the sidebar** — present · No create/edit/delete controls anywhere in the section
- **Tempting but no: section hidden until user has apps** — present · Not hidden; header always renders
- **Tempting but no: 'create app' button in the section header** — present · No such button
- **Tempting but no: streaming affordances for individual tiles** — present · No skeletons, no per-tile spinners
- **Tempting but no: per-app hues on day one** — present · Neutral hue only

### Additions (in the result, not in the shape)

- Two-line unhealthy variant on the tile — a small muted-red italic second line under the title carrying the health message when the tile is unhealthy; dedicated CSS selector and dedicated component tests — endorsed-as-drift

### Follow-ups

- Amend the shape file (or a follow-up note in the campaign artifact) to record the tasting-round decision that added the unhealthy two-line variant, so the shape file matches the built result — accepted-as-drift

### Notes

The material conforms to the shape both ways with one exception: a two-line unhealthy variant on the tile (muted-red italic message under the title) that was not in the shape file but was decided during a tasting round after the shape was written. The user endorsed it as drift the shape file failed to capture. Every failure-mode guard is in place, every OUT/tempting-but-no item is genuinely absent, and every IN item is present. Pattern worth carrying forward: when a tasting round produces a design decision after a shape file is written, the shape file needs to be amended in-place before /close, otherwise the divergence surfaces as an addition at conformance-review time. Also worth noting: the shape file does not mention the health flag fields at all, even though the prior shape's close-out explicitly landed them on the wire with the expectation that the client would render the unhealthy state — the shape 3 author appears not to have carried that expectation forward, which is what created the drift.
