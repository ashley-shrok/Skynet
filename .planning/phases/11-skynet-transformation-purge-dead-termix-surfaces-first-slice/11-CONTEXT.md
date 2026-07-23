# Phase 11: Skynet transformation — purge dead Termix surfaces (first slice) — Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Source:** Synthesized directly from Tina's bounty `skynet-transformation-purge-dead-surfaces` + `~/.claude/identities/tina/tina.md` § Skynet direction (Ship of Theseus). Ashley's UAT quote 2026-07-23 during Phase 10 walkthrough: *"I really feel like we need to get away from this termix front end stuff before any of this is worth quibbling over."* No discuss-phase for this one — the dead-surfaces canonical list and palette authority were both locked in tina.md across repeated calls-out during 2026-07-23. **The scope is not to be re-litigated; the planner's job is HOW to strip cleanly, not WHAT to strip.**

<domain>
## Phase Boundary

Phase 11 is the **first slice** of a multi-phase Ship-of-Theseus purge of Termix UI surfaces that Ashley never sees in Skynet. Long-term she sees two visible frontend surfaces: the pretty-conversations panel (sidebar) and the PrettyView chat surface (main pane). Everything else in today's Termix UI is dead weight going away.

This phase's slice covers the two surfaces Ashley called out most directly in the Phase 10 UAT:

1. **Landing-surface swap.** Desktop's default landing surface (what renders on a fresh page-load with no hash-fragment) becomes the pretty-conversations panel + PrettyView main pane, NOT the Termix dashboard. Mobile already lands on the pretty-conversations panel post-Phase 10; verify unchanged.
2. **AppRail retirement.** The left AppRail component (icon buttons for Termix dashboard, host manager, snippets, admin console, and any settings surfaces) is deleted from `AppShell` and its file removed from the source tree. Every import of the deleted AppRail path is stripped. `tsc` clean; test suite green.

Phase 11 does NOT touch:

- **Invisible-shell technical capability** (tab plumbing, terminal renderer, RDP/VNC/Guacamole panes, host CRUD BACKEND) — untouched, verbatim.
- **Backend routes and data layer.** `/host/db/*`, `/identities/*`, encrypted-SQLite host record store — untouched. This phase deletes UI only. Backend routes that only served deleted UI die in a subsequent Phase 12+.
- **The other dead surfaces** (host manager UI pages, snippets manager, admin console, settings surfaces, Termix tab bar chrome, keyboard shortcut editor UI). They're on the chopping block but for follow-up phases — this phase is landing + AppRail only, so we can UAT the effect before continuing the sweep.
- **Any visual polish on retained UI.** The pretty-conversations bubble+badge restyle, ready-dot behavior, and other in-flight visual work are separate bounties and stay parked until the purge lands.

</domain>

<decisions>
## Implementation Decisions

All items below are **LOCKED** by the bounty + tina.md § Skynet direction — do NOT re-open them during planning.

### Landing-surface swap (PURGE-01)

- **Default landing surface = pretty-conversations panel + PrettyView main pane.** On desktop, a fresh page-load without a URL hash-fragment lands here, NOT on the Termix dashboard. The pretty-conversations panel is the sidebar list; PrettyView is the default main pane content when no conversation is selected (empty-state glass card is fine — matches Phase 10's shipped behavior).
- **Mobile behavior unchanged.** Phase 10 already lands mobile on the pretty-conversations panel with the mobile back-button flow to PrettyView; verify no regression, but no new mobile-specific work in this phase.
- **URL fragment scheme preserved.** Patch #25 and Plan 06-03's `#mv=1` extension continue to work verbatim. Direct navigation to `#dashboard`, `#hosts`, `#snippets`, `#admin`, or any settings hash SHOULD 404-equivalent (route removed) or fall back to landing — planner's call, but the surfaces themselves must be unreachable via the visible UI regardless.
- **Backend host list continues to power the pretty-conversations panel.** The panel's data source is unchanged (whatever conversation-store input Phase 7 wired up).

### AppRail retirement (PURGE-02, PURGE-03)

- **Locate + delete.** The AppRail component lives somewhere under `src/ui/sidebar/` or `src/ui/shell/` (planner identifies exact path). Delete the file plus its test file. Remove every import in the source tree. `tsc` clean.
- **AppShell mount removed.** `AppShell.tsx` currently mounts the AppRail as part of its layout tree. Remove the mount, resolve any layout knock-on effects (probably a two-column → single-column shift on desktop; details in planner's investigation).
- **Every visible UI entry point to dead surfaces is gone.** If AppRail routes were the ONLY visible path to a dead surface, deleting AppRail is sufficient. If any other component still routes into a dead surface (a menu, a keyboard shortcut, a URL that AppRail didn't gate), the planner MUST identify and prune those too — this is a full "no visible UI path" gate, not just an AppRail deletion.
- **Deletion, not gating.** No feature-flag hide, no `if (false)` block, no CSS `display: none`. The files, imports, routes, and mounts are removed from the source tree. Ship-of-Theseus purge = the wood is off the boat.

### Invisible-shell preservation (PURGE-04, PURGE-05)

- **Backend routes NOT deleted in this phase.** `/host/db/*` (host CRUD), `/identities/*` (identity registry), and every WebSocket route (SSH terminal, RDP/guac, pretty-view session-file tail) continue to serve. The pretty-conversations panel reads the host list via the same API path it uses today; that stays working.
- **Encrypted-SQLite data layer untouched.** No schema changes, no migrations, no docker volume changes. The `termix-data` volume is the crown jewel and this phase must not touch it.
- **RDP/VNC/Guacamole panes remain reachable.** Phase 7 wired RDP-host-sentinel rows into the conversation list; those continue to open Guacamole panes exactly as before. Verify unchanged.
- **Tab plumbing untouched.** Tab lifecycle (mount/unmount, WebSocket lifecycle, focus routing), terminal renderer (xterm.js), pretty-view internals — all preserved verbatim. This phase is UI deletion at the AppShell layout level, not below.
- **Docker/Caddy/nginx untouched.** No infrastructure changes in this phase.

### Palette authority

- **`--color-pv-*` tokens are the authority** for any surface color change the deletion knock-on effects require (e.g., if AppShell's default background needs a rebase from Termix's `--background` to a Skynet color, use `--color-pv-base-end` = `#0a0b12` or `--color-pv-base-start` = `#141520`). Never chase Termix's dark-mode `--background` value — that token is on the chopping block in a follow-up phase.
- **This phase should be minimal color work.** The landing surface swap and AppRail removal don't inherently require a color change; if the planner discovers a color decision is needed, use `--color-pv-*` and note it in the plan for Ashley's review.

### Scope-fence discipline (Ashley's explicit lock)

- **No settings UI anywhere.** Not in this phase, not as a "small mobile preferences pane," not as a "settings icon in the corner." Zero. Ashley 2026-07-23: "we are not having settings at all." If any AppRail removal knock-on effect surfaces a "we still need somewhere for X setting" — the answer is remove the setting entirely (or move it to backend config only), not add a UI for it.
- **If a surface isn't the conversation list or the pretty view, don't defend it in scope decisions.** When the planner encounters a borderline "should this stay?" question, the default answer is remove. The invisible-shell technical capabilities named above are the ONLY exceptions.
- **Same landing behavior ships to both viewports.** No dual-mode ship. Desktop and mobile both use the pretty-conversations panel as landing; no viewport gets a special-case dashboard.
- **Deletion is atomic per plan.** Each plan's deletion set commits together with its verification (grep for imports zero, tsc clean, tests green). If a plan's deletion doesn't verify clean, the plan fails — do not commit a half-deleted state that leaves broken imports.
- **Rebase risk HIGH — accept the divergence.** Upstream Termix keeps evolving these deleted surfaces; our fork just doesn't have them anymore. When we next rebase against upstream `main`, deleted-file conflicts resolve to "stays deleted." This is intentional.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Bounty + identity source-of-truth (authoritative)
- `~/.claude/identities/tina/bounties/skynet-transformation-purge-dead-surfaces/bounty.json` — the bounty premise, Ashley's UAT quote, the todo set (landing-surface swap, AppRail retirement, per-surface enumeration + prove-dead + delete-with-atomic-commits).
- `~/.claude/identities/tina/tina.md` § Skynet direction — Ship of Theseus (includes the dead-surfaces canonical list, palette authority, the "conversation list + pretty view is all Ashley sees" scope-decision heuristic, and the "it is ONE project, not a collection of bounties" fleet lock).

### Phase 10 and prior visible-surface work (context for what stays)
- `.planning/phases/10-pretty-conversations-visual-language-rework/10-01-SUMMARY.md` through `10-05-SUMMARY.md` — the pretty-conversations panel that this phase makes landing.
- `.planning/phases/07-fleet-native-conversation-list/07-CONTEXT.md` and `07-*-SUMMARY.md` — Phase 7's fleet-native list + RDP-host-sentinel wiring (must continue to work post-AppRail removal).
- `.planning/phases/06-telegram-like-interface/06-CONTEXT.md` and `06-*-SUMMARY.md` — Phase 6 tab lifecycle / URL fragment / mobile flow (all preserved verbatim).
- `src/ui/features/pretty-view/**` — the visible chat surface that stays.
- `src/ui/features/pretty-conversations/**` — the visible list surface that stays.

### AppShell layout entry point (where deletion touches)
- `src/ui/AppShell.tsx` — the layout root. Where AppRail is currently mounted and where the landing-surface decision happens. Planner MUST read this fully to understand the mount points and the routing logic that keys landing surface off URL fragment or default.

### Requirements
- `.planning/REQUIREMENTS.md` § Dead-Surfaces Purge — First Slice (Phase 11) — PURGE-01..PURGE-05.

### Fork operating baseline
- `~/.claude/identities/tina/box-map.md` — Termix operational context.
- `~/.claude/identities/tina/termix-patches.md` — full patch catalog through patch #137. Phase 11 patches will pick up from #138.
- `~/.claude/identities/tina/deploy-runbook.md` — deploy flow (batched deploys per the "batch patches into meaningful deploys" fleet rule; no deploy inside this phase unless Ashley explicitly greenlights).

</canonical_refs>

<specifics>
## Specific Ideas

- **Enumerate before deleting.** First task in the plan should be an investigation pass: locate the AppRail file, grep every import of it, identify every route/menu/keyboard-shortcut that points at a dead surface via AppRail OR any other visible-UI entry point. Produce a strip list before any deletion. This is the "prove dead" step.
- **Atomic commits per surface.** One commit per logically-coherent deletion (AppRail removal, dashboard route deletion, landing-surface swap, etc.). If a commit breaks build, the commit is wrong — fix in the same commit before it lands, don't ship a broken intermediate and fix in a follow-up.
- **Verification IS a plan task.** Each plan's `<acceptance_criteria>` MUST include: `grep -r "AppRail" src/ | wc -l` = 0 (after AppRail deletion), `npx tsc` exits 0, `npx vitest run` all green, `npm run build` succeeds. Non-negotiable — a plan cannot claim done without these.
- **Landing-surface swap likely one file.** The change is probably in `AppShell.tsx` — its landing / default-render logic. Planner identifies the exact spot; the change itself is small (a few lines). The prep work is the enumeration + verification.

</specifics>

<deferred>
## Deferred Ideas

- **Full dead-surfaces purge (host manager UI pages, snippets manager, admin console, all settings surfaces, Termix tab bar chrome, keyboard shortcut editor UI).** In scope for Phase 12+, NOT this phase. Ashley chose landing + AppRail first so we can UAT the landing effect before the broader sweep.
- **Backend route deletion.** The routes that only served deleted UI (dashboard endpoints, snippet CRUD, etc.) die in a follow-up phase. This phase leaves backend untouched to keep the blast radius small.
- **Any visual polish on the retained UI** (bubble+badge restyle refresh, ready-dot debugging, sidebar-scroll padding fixes) — separate bounties, all parked pending purge completion per Ashley's blocking.
- **Rebase automation.** The rebase-risk-HIGH acceptance means we'll eat a manual rebase pass at some point. Not this phase.

</deferred>

---

*Phase: 11-skynet-transformation-purge-dead-termix-surfaces-first-slice*
*Context gathered: 2026-07-23 (no discuss-phase — synthesized from Tina's bounty + identity file)*
