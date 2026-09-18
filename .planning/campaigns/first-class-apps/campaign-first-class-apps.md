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

- **[declared] shape-app-runtime-and-skill** — the canonical `app-development` skill and the on-disk conventions for `~/fleet/apps/<slug>/` on the agent's box. Adapts the archived `web-app-development` skill to Skynet's world: same Bun + systemd `--user` + per-app SQLite + numbered-migration pattern, moved from `~/apps/` to `~/fleet/apps/`, per-app metadata file inside the slug folder, no portal, no tailnet-IP framing. Skill description: "Builds a new app, or edits an existing one. Use when the user asks for an app, tool, tracker, dashboard, log, or webpage for a specific purpose, or asks to edit, tweak, or add features to an existing app." Ships via the substrate distributor so every fleet agent gets it. — status: in_progress

- **[declared] shape-sweep-and-registry-api** — extend Skynet's fleet-status sweep to also enumerate `~/fleet/apps/*/` on each managed box and read each app's metadata file. The fleet-wide app list is held in memory in the Skynet backend the same way identity discovery holds identities — no database writes, no schema, no migration. A read-only API endpoint returns the current list, filtered at the API layer by the requesting user's host access. Add or remove an app on a box → next sweep picks it up → next API read reflects it. — status: in_progress

- **[declared] shape-sidebar-apps-surface** — a new collapsible section at the top of the sidebar, above conversations. Header always visible, even when the user has zero apps, so the feature is discoverable. Collapsed by default, matching the existing group-header pattern. Empty-expanded state carries a friendly prompt ("Ask an agent to make an app for you"). Populated state lists app tiles, reusing the existing sidebar context menu component for per-tile actions (starting with "Open in new tab"). — status: in_progress

- **[declared] shape-app-pane-content-type** — teach the app to be a leaf content type in the main content slot. Click a sidebar tile to open the app in the current view (replacing whatever's there); drag a sidebar tile into a split to open it as a leaf. Includes a small in-place unification of the current per-content-type dispatch (a switch over four cases becomes a small local table in the same file) so future content types are one-line additions instead of another switch branch. — status: in_progress

## Side-bounties

None yet.

## Other work

None yet.

## Lingerers (explicitly approved)

Empty until close-time approvals populate it.

## Open questions

- **App metadata file — exact fields.** Slug, title, port, owning agent (for provenance display), created-at are obvious. Icon (path to a file in the app folder, or a name from a stock set?) and one-liner description are worth deciding when shape 1 starts. Answered as part of shape 1.
- **Sidebar tile visual shape.** Icon + title, icon + title + description, grouped by host or flat. Decided as part of shape 3.
- **Removal flow.** Deleting a folder removes the app on next sweep, but the systemd unit still needs cleanup. Whether that's a script invocation or a natural part of the delete command is a shape-1 design call.
- **Sweep freshness.** Existing sweep cadence is the starting point. If apps feel laggy after create, an eager-refresh nudge (agent touches a sentinel file, or the create script pings Skynet) is a small follow-up — not a shape.
- **Proxying apps into the client — Origin-header behavior.** *Discovered during shape 1 (2026-09-18).* Apps in the starter template disable SvelteKit's default same-origin CSRF check because when the client proxies a browser POST through to `http://127.0.0.1:<port>`, the browser's Origin header names the client's domain rather than the loopback socket. Whichever shape wires up the proxy (currently shape 4, `shape-app-pane-content-type`) needs to decide: (a) preserve/rewrite Origin so the framework's default same-origin check works, (b) add a compensating check upstream at the proxy layer, or (c) explicitly accept the residual CSRF surface given the tailnet's other guardrails. The disable is currently baked into the starter template's framework config; whichever option shape 4 lands may require an updater on the starter.

## Sequencing

1 → 2 → (3 and 4 in parallel or either order). Shape 3 and shape 4 both depend on shape 2 but are independent of each other. Shape 3 delivers standalone value (sidebar visibility + external-tab open) even before shape 4 lands.
