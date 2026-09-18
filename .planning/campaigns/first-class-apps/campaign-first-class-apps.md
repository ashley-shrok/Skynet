# Campaign: First-class apps in Skynet

**Opened:** 2026-09-17
**Status:** in_progress
**Workspace:** /home/ubuntu/skynet-vision/.planning/campaigns/first-class-apps/

## Concept

Agents build custom apps for their users. Today that's a one-off served URL — an agent runs its own server on some port and hands the user a link. This campaign makes apps a first-class Skynet concept: an app lives on disk under a canonical location on the agent's own box, gets auto-discovered by Skynet, and shows up in the user's sidebar as an always-available tile. A user sees every app her agents have made for her, across every box in her fleet, in one place — clickable to open in the current view, draggable into a split-view leaf, or openable in a separate authenticated browser tab.

The pattern is deliberately instance-agnostic: the Skynet running at term.gigaashley.click and Stacy's Skynet on T800 both use it identically without per-instance tailoring.

## Success criteria

- An agent on any box in the fleet can build a working app end-to-end using a single canonical skill (`app-development`), without touching Skynet directly.
- Apps are auto-discovered by Skynet's fleet-status sweep — no registration API, no push, no database. Disk is the source of truth, the same way it is for identities.
- Every user of a Skynet instance sees the apps hosted on boxes she has access to, and only those apps. Same visibility model as identities.
- The apps section appears in the sidebar even when the user has zero apps, so the feature is discoverable. Empty-expanded state carries a friendly prompt suggesting the user ask an agent to make one.
- An app can be opened in three ways: inside the current view (replacing whatever's there), in a split-view leaf (dragged from the sidebar), or in a separate authenticated browser tab (via the sidebar tile's context menu).
- The pattern holds identically on any Skynet instance — nothing is tailored to a specific host, homeserver, or tenant.

## Shapes

- **[declared] shape-app-runtime-and-skill** — the canonical `app-development` skill and the on-disk conventions for `~/fleet/apps/<slug>/` on the agent's box. Adapts the archived `web-app-development` skill to Skynet's world: same Bun + systemd `--user` + per-app SQLite + numbered-migration pattern, moved from `~/apps/` to `~/fleet/apps/`, per-app metadata file inside the slug folder, no portal, no tailnet-IP framing. Skill description: "Builds a new app, or edits an existing one. Use when the user asks for an app, tool, tracker, dashboard, log, or webpage for a specific purpose, or asks to edit, tweak, or add features to an existing app." Ships via the substrate distributor so every fleet agent gets it. — status: closed (see shape-app-runtime-and-skill.closed.md; deploy held for campaign-close so a peer's next `--force-recreate` doesn't ride-along a half-campaign)

- **[closed] shape-sweep-and-registry-api** — extend Skynet's fleet-status sweep to also enumerate `~/fleet/apps/*/` on each managed box and read each app's metadata file. The fleet-wide app list is held in memory in the Skynet backend the same way identity discovery holds identities — no database writes, no schema, no migration. Piggybacks on the existing live subscription channel (not a separate HTTP endpoint) so that adds / removes / health-changes deliver as delta frames alongside identity frames, filtered per-user by the existing host-visibility function. Adopts the per-host reconciliation-on-success pattern the identity sweep gained on the trunk 2026-09-18 (Phase 115) so deletions vanish naturally and transient outages don't flap the sidebar. Inclusion test is functional (folder + card + unit-active); the one carve-out is "unit exists but currently stopped" — that app appears with an unhealthy flag + short message so it doesn't silently vanish. Icon presence is boolean only (URL construction is a client concern once serving lands). Full shape + Close-Out: see shape-sweep-and-registry-api.closed.md. — status: closed 2026-09-18 (verdict: closed-hit; 3 additions endorsed-as-drift; 1 follow-up bounty spun up for the general metadata-visibility audit)

- **[closed] shape-sidebar-apps-surface** — a new collapsible section in the sidebar, positioned below the search input and above the Pinned group (first content group). Header always visible even when the user has zero apps (discoverability is load-bearing). Collapsed by default with lazy-render, matching the existing archived-section convention. Empty-expanded state carries a friendly italic muted prompt ("Ask an agent to make an app for you.") — verbatim. Populated state is a flat list of app tiles (no host grouping) consuming shape 2's live app-frame subscription channel with atomic reconciliation per frame. Tile visual: same glass bubble as conversation rows, rounded-square icon slot instead of round avatar disc, single-line title only, all tiles at the sidebar's default neutral hue 216 (no per-app colour in v1). Iconless fallback: first-letter monogram on the same neutral hue (mirrors the `.pv-avatar-initial` pattern identity rows use). Unhealthy variant (added post-shape-file during discuss-phase tasting round 2): two-line tile with a muted-red italic healthMessage under the title when the app's isHealthy flag is false. Context menu (right-click desktop, long-press mobile) has one action: "Open in new tab" — opens a Skynet-served URL (`/apps/:hostId/:slug`) that server-side 302s to the direct serve URL (`<hostname>-<port>.serve.<domain>`) with wildcard cookie carrying auth. Left-click is a deliberate no-op with cursor-default styling (reserved for shape 4). Full shape + Close-Out: see shape-sidebar-apps-surface.closed.md. — status: **closed 2026-09-18 (verdict: closed-hit; 1 addition endorsed-as-drift — the unhealthy two-line variant, decided in tasting round 2 but shape file failed to record it; code review found 2 HIGH + 4 MEDIUM all fixed atomically in a single fix pass; agent-side pre-deploy UAT deferred to campaign-close so all four shapes can UAT together against the eventual live deploy — D-20 procedure remains as written, just executed at that later moment)**

- **[declared] shape-app-pane-content-type** — teach the app to be a leaf content type in the main content slot. Click a sidebar tile to open the app in the current view (replacing whatever's there); drag a sidebar tile into a split to open it as a leaf. Includes a small in-place unification of the current per-content-type dispatch (a switch over four cases becomes a small local table in the same file) so future content types are one-line additions instead of another switch branch. — status: in_progress

## Side-bounties

None yet.

## Other work

None yet.

## Lingerers (explicitly approved)

Empty until close-time approvals populate it.

## Open questions

- **App metadata file — exact fields.** Slug, title, port, owning agent (for provenance display), created-at are obvious. Icon (path to a file in the app folder, or a name from a stock set?) and one-liner description are worth deciding when shape 1 starts. Answered as part of shape 1 (card is `app.json` with just title + description; slug from folder, port from unit env, icon-presence from optional `icon.webp`, created-at from mtime). Shape 2 (2026-09-18) further ruled OUT the owning-agent field — no benefit to tracking who created an app; disk-observable data only.
- **Sidebar tile visual shape.** Icon + title, icon + title + description, grouped by host or flat. Decided as part of shape 3.
- **Removal flow.** Deleting a folder removes the app on next sweep, but the systemd unit still needs cleanup. Whether that's a script invocation or a natural part of the delete command is a shape-1 design call.
- **Sweep freshness.** Existing sweep cadence is the starting point. If apps feel laggy after create, an eager-refresh nudge (agent touches a sentinel file, or the create script pings Skynet) is a small follow-up — not a shape.
- **Proxying apps into the client — Origin-header behavior.** *Discovered during shape 1 (2026-09-18).* Apps in the starter template disable SvelteKit's default same-origin CSRF check because when the client proxies a browser POST through to `http://127.0.0.1:<port>`, the browser's Origin header names the client's domain rather than the loopback socket. Whichever shape wires up the proxy (currently shape 4, `shape-app-pane-content-type`) needs to decide: (a) preserve/rewrite Origin so the framework's default same-origin check works, (b) add a compensating check upstream at the proxy layer, or (c) explicitly accept the residual CSRF surface given the tailnet's other guardrails. The disable is currently baked into the starter template's framework config; whichever option shape 4 lands may require an updater on the starter.

## Sequencing

1 → 2 → 3 → 4 (or, originally, 3 and 4 in parallel — chose serial in practice, one shape per session per the campaign rhythm). Shape 3 and shape 4 both depend on shape 2 but are independent of each other. Shape 3 delivers standalone value (sidebar visibility + external-tab open) even before shape 4 lands; the redirect route added by the shape 3 code-review fix pass is the bridge that makes external-tab-open work standalone (shape 4's proxy may later replace or complement it).

## UAT hold — deferred to campaign close

The `/build` pipeline's step-6 agent-side pre-deploy UAT requires the code to be live in the running Skynet container. Because the campaign holds deploys until all four shapes close (peer `--force-recreate` ride-along risk on a half-campaign), no shape's live UAT can run against a real deploy in isolation. Instead, all UAT converges at campaign-close: after shape 4 lands, the orchestrator runs full-suite tests + Playwright smoke as the pre-deploy gate, deploys the full campaign, and then executes each shape's D-20 UAT procedure against the deployed instance in one pass. Shape 3's D-20 procedure (scratch app on t1000 + expand sidebar + verify tile + verify Open-in-new-tab + verify unhealthy state + verify sweep-remove) is unchanged — just executed at that later moment.
