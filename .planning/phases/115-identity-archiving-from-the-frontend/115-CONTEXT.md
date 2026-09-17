# Phase 115: identity archiving from the frontend - Context

**Gathered:** 2026-09-17
**Status:** Ready for planning
**Source:** Shape file at `.planning/shapes/shape-identity-archiving.md` (opened + greenlit 2026-09-17 via /build → /open). This CONTEXT.md is seeded from that shape file; do NOT re-elicit decisions already captured there. Discuss-phase surfaced three additional implementation decisions (sentinel filename, frontend transport shape, user-initiated retire failure behavior) — captured below as D-14/D-15/D-19.

<domain>
## Phase Boundary

Add an "archive" action to Skynet's unified context menu (sidebar row + identity badge), replacing the existing "hide" action in the same menus and standing as the identity-backed counterpart to the existing "kill" action. Front-end feel stays the same as hide today (confirmed click closes any visible session, row falls out of the live list, row appears in the lazy-loaded archived section); the back-end gesture becomes real — the identity is genuinely retired on the host by the agent-supervisor (matrix account deactivated, harness gracefully exited, tmux session killed, identity folder moved to `~/fleet/identities-archive/<name>/`). The `.hidden` sentinel concept goes away entirely.

**Cross-repo scope:** Skynet frontend (TS/React) + Skynet backend (per-identity-file primitive, fleet-status sweep) + fleet-substrate agent-supervisor (bash). All three codebases live in this repo (`~/skynet-wren`) — the supervisor script is at `substrate/scripts/agent-supervisor.sh`, distributed to every managed host by Skynet's fleet-substrate distributor.

**Relation to prior phases.** Phase 94 built the underlying retire flow (`retire_identity()` in the supervisor) gated behind a 180-day dormancy sweep. That code path has NEVER FIRED in production — the app hasn't existed for 180 days. Phase 115 both adds a second (user-initiated) trigger into that flow AND changes the step ordering, so the whole retire flow effectively runs for the first time as part of this phase's testing. Treat the Phase 94 retire code as untrusted and revalidate end-to-end. Phase 107 introduced the `.hidden` sentinel pattern this phase is replacing; the frontend row/badge menu that both phases modify was unified 2026-09-17 (HEAD `ebcbac5b` — `feat(context-menus): unify conversation-row and identity-badge menus`).

</domain>

<decisions>
## Implementation Decisions

### Frontend surface (unified context menu)

- **D-01: Menu item renamed.** In the unified context menu shared by the sidebar conversation row and the identity badge, the "Hide" item is renamed to "Archive". Same two entry points, same click path, same trigger condition (fleet-synthetic identity-backed rows only — the Phase 107 affordance-narrowing gate is preserved: archive is not offered on RDP synthetic rows, dev-created openTab rows, or relay-room rows). The menu's other actions (Pin/Unpin, Open/Move in new window, Kill) are untouched.

- **D-02: Red styling.** The Archive menu item is styled red, matching the existing Kill item. Two destructive actions in the same menu, same visual weight, so users read the gesture correctly.

- **D-03: Confirmation prompt.** Clicking Archive triggers a confirmation dialog before any state change fires. Copy: **"archive `<identity>`? this can't be undone."** No confirmation prompt exists on Hide today (because hide is reversible); Archive earns one because it's a real end-of-life action. Wording is user-locked.

- **D-04: Preserved side effect — close visible session.** If the identity currently has an open pane/tab in the frontend, confirming Archive closes it as a side effect. This mirrors Hide's current behavior exactly (see Phase 107 handler at `PrettyConversationsPanel.tsx:1355` / `handleToggleHide`) — same behavior, renamed handler.

- **D-05: Un-archive out of scope.** No un-archive affordance, no restore path, no `.archive-undo` handling. Archived rows are inert (D-06 below). This mirrors Phase 94 D-16 and Phase 94 D-13 (retire is one-way). Deferred to a later conversation.

- **D-06: Archived rows are fully inert.** In the sidebar's archived section, rows sourced from `~/fleet/identities-archive/` render without a context menu. No hover actions, no click actions. View only. Rationale: no options make sense yet given un-archive is out of scope; adding surface later is easier than retracting.

### Sentinel + trigger

- **D-07: Sentinel semantics — intent signal, not state.** Unlike `.hidden`/`.pinned` (which mean "this identity is in state X"), the archive sentinel is a one-shot intent signal: the frontend drops it, the supervisor consumes it during its next reconcile tick, and the sentinel is deleted as part of successful retire. This matches the existing `.recycle-requested` semantics exactly. Do NOT model archive as a toggleable state on the identity.

- **D-08: Sentinel filename — `.archive-requested`.** Mirrors `.recycle-requested`. User-locked. Presence-only empty file, same as other sentinel precedents (`.no-dormancy`, `.pinned`, `.hidden` today). The name is a signal, not a description of state — an identity with `.archive-requested` is one that WILL BE archived at the next reconcile tick, not one that already is.

- **D-09: Sentinel drop location.** `~/fleet/identities/<name>/.archive-requested` on the identity's host. Same tree the current `.hidden` sentinel is written to. Path is per-host — a single frontend click drops on ONE host (the host that owns the identity), not fan-out to every managed host.

- **D-10: Live-tree scan by the supervisor.** The agent-supervisor's existing reconcile loop grows a new branch: scan `~/fleet/identities/*/` for `.archive-requested` sentinels each tick (~15s cadence). For each hit, invoke `retire_identity(name)` immediately. NOT gated on `run_archive_scan_if_due()` (the 24h gate for the 180-day dormancy path) — the user-initiated path runs on every tick until the sentinel is gone. Cheap to check: one glob + presence test per identity.

- **D-11: Guards overridden by user click.** The 180-day retire's skip guards (`.pinned`, `.no-dormancy`, `coordinator: true` frontmatter) are BYPASSED by a `.archive-requested` sentinel. Reasoning: those guards exist to prevent automated retire from surprising the user; a direct click is not automated. If the user clicked archive on a pinned/coordinator/no-dormancy identity, they meant it. **Load-bearing:** the retire code path shared with the 180-day sweep must NOT re-check those guards inside `retire_identity()` — they belong in the caller (the daily-sweep path checks; the sentinel-scan path skips the check). Alternatively: `retire_identity()` grows a `force:bool` parameter and the caller decides. Planner picks.

- **D-12: Sentinel deletion on completion.** After `retire_identity(name)` returns success, the sentinel is deleted. Because step 4 (folder move) happens LAST in Phase 115's reordered flow, and the sentinel lives inside the folder being moved, the sentinel naturally travels with the folder into `identities-archive/`. **The deletion needs to happen BEFORE the move**, or the archive tree will accumulate stale sentinels. Planner chooses: (a) delete the sentinel as the first step of `retire_identity()`; (b) delete before the folder move; (c) let it move with the folder and treat it as harmless historical residue. Recommendation: option (b) — delete right before the folder move, so a mid-retire crash leaves the sentinel in place for the next tick to retry (aligns with D-19 retry semantics).

### Retire flow reordering (deviation from Phase 94)

- **D-13: New retire order.** Phase 94's order was: (1) move folder → (2) kill tmux → (3) deactivate matrix. Phase 115 REVERSES this to: **(1) deactivate matrix → (2) gracefully exit harness → (3) kill tmux → (4) move folder.** Applied to BOTH trigger paths (user-initiated `.archive-requested` and 180-day dormancy sweep) — the retire flow is shared. This is a deliberate correctness improvement over Phase 94, not an addition. Phase 94's own D-10 justification (move first stops watchers by starving them) works mechanically but is a hard stop, not a graceful one. The new order lets each layer flush before dying.

- **D-14: Graceful harness exit pattern reused from recycle.** Step 2 (gracefully exit harness) uses the SAME pattern as the existing recycle flow in `agent-supervisor.sh` around line 1050: send `/exit` to the pane, wait, SIGTERM survivors after a bounded timeout. Do NOT invent a second pattern. When the harness dies, the per-identity ambient-monitor (`substrate/scripts/ambient-monitor.py`) notices via `_harness_watch()` and shuts down its four watcher children (relay receiver, wakeup-scheduler, context-watch, role-file-watch) cleanly — including the CRITICAL relay receiver's message-cursor flush. That graceful-shutdown path is the reason the new order improves on Phase 94's.

- **D-15: Failure handling — LOUD on any step failure, retry semantics differ by trigger.** For the user-initiated path: sentinel STAYS IN PLACE on any step failure, so the next supervisor tick (~15s) retries from step 1. Retire-stuck sentinel drops after 3 consecutive per-tick failures on the same identity (small counter tracked in the supervisor's dormancy-state dir, mirrors Phase 94's `retire-fail-count-$name` pattern at line 528). No exponential backoff — supervisor's tick cadence provides the spacing. For the 180-day path: Phase 94's existing daily-cadence retry stays (24h between attempts, 3 fails → retire-stuck). Both paths use the same `retire-stuck` sentinel semantics. The Matrix deactivate step is idempotent per Synapse (deactivating an already-deactivated account returns success), so partial-retry safety is preserved.

- **D-16: Silent Matrix-deactivate failure is unacceptable.** Step 1 must either succeed or fail LOUDLY (log line + retire-stuck sentinel after 3 fails). Do NOT let a step-1 failure silently succeed the rest of the retire — the identity's Matrix account would remain live indefinitely with no signal. Phase 94's step-3 code already logs error paths; the same discipline applies to Phase 115's step 1.

### Fleet-status sweep — archived-section content

- **D-17: New dedicated frontend endpoint.** A new backend endpoint drops the sentinel — recommended shape `POST /identity/:hostId/:name/archive` (planner may adjust to fit existing route conventions in `src/backend/database/routes/identities.ts`). The endpoint fans out ONE `.archive-requested` sentinel to the target host via the same `writeIdentityFile` primitive from `src/backend/claude-session/per-identity-file.ts` that the current `.hidden` fanout uses. **Do NOT reuse the `PUT /user-preferences` array-of-IDs shape for this** — that shape fits state management (a persistent list of hidden IDs the frontend re-sends), not a one-way command (archive-this-one). Add `.archive-requested` to `ALLOWED_REL_PATHS` (mirrors Phase 107's `.hidden` addition).

- **D-18: Sweep enumerates the archive tree.** `substrate/scripts/fleet-status-sweep.py` grows to enumerate `~/fleet/identities-archive/` in addition to `~/fleet/identities/` on each poll. Rows sourced from the archive tree emit a new `archived: true` field on the `SweepIdentityLine` schema in `substrate/scripts/sweep-schema.ts` (sibling to existing `hidden`, `pinned`, `dormant`, etc). The frontend consumes this field to place rows in the archived section. Fleet-status sweep is a per-host operation, so this add is per-host; the archived section aggregates from all hosts naturally through the existing sweep-merge machinery.

- **D-19: Archived-section lazy loading — verify and preserve.** The shape file called out that archived-section rows should not hit the DOM until the section is expanded. This may already be how the current hidden-section renders (Phase 107 didn't change it, and the pre-Phase-107 hidden implementation may or may not have already been lazy). **Planner verifies during codebase reading; if it's already lazy, do nothing; if it isn't, add lazy rendering as part of this phase** (accept as scope, don't defer). No new decision to make — behavior is fixed at "lazy"; only implementation status is unknown.

### Migration of existing `.hidden` sentinels

- **D-20: Migration is manual, outside code scope.** The operator (Ashley) will manually convert existing `.hidden` sentinels on all managed hosts after Phase 115 code lands. The migration is NOT part of this phase's automated deploy. Rationale: the number of hosts is small, the conversion is trivial (either delete the `.hidden` sentinel and treat the identity as active, or write `.archive-requested` and let the newly-shipped supervisor retire it). Automating this would add substantial code for a one-off operation.

- **D-21: `.hidden` code path fully retired.** Post-Phase-115 there is NO code path anywhere (frontend, backend, supervisor) that reads or writes `.hidden` sentinels. Delete the entire `.hidden` handling: `deriveDiskHiddenIds` in `identities-store.ts`, the `putHiddenIds`/`hideConversation` API surface, the `hiddenConversationIds` fanout in `user-preferences.ts`, the `.hidden` entry in `ALLOWED_REL_PATHS`, the `hidden` field on `publicIdentity()`, the `hidden` field on `SweepIdentityLine`, and any test coverage. Test suite should surface any lingering references. Do NOT keep the code path around for backwards compat — Ashley will handle the manual migration.

### Testing — the 180-day retire path is untrusted

- **D-22: End-to-end retire must be revalidated.** Phase 94's retire flow has never fired in production. Phase 115 both adds a new trigger path AND reorders the flow's internal steps. Testing this phase treats the entire retire flow as untrusted. Required test coverage:
  - Sentinel-scan branch (new): dropping `.archive-requested` triggers retire on next tick, sentinel is deleted on success, guards are bypassed correctly, guards are respected for the 180-day path (both paths tested).
  - Retire flow (new order): each step observable, ordering enforced, ambient-monitor's harness-watch actually fires and cleans up its four children (real subprocess or realistic mock), Matrix deactivate call actually hits a homeserver (mock OR throwaway Matrix account on a test homeserver).
  - Retire failure paths: each step's failure path halts retire correctly, sentinel is retained on failure, retire-stuck fires after 3 fails, LOUD log lines emit.
  - Idempotency: partial-retire crash mid-flow is safely retried by the next tick.
- **D-23: Test motions per fleet directive.** Executor uses scoped `npx vitest run <files>` for its green gate — no full-suite runs at executor scope. Full-suite + Playwright smoke run as the first step of the DEPLOY motion (orchestrator scope), not before push, not inside the executor. Standard fleet rule; called out here so the planner doesn't seed a full-suite gate into an executor prompt.

### Claude's Discretion (implementation-level, planner decides)

- Exact route shape / naming for the new archive endpoint (`POST /identity/:hostId/:name/archive` vs `POST /host/:hostId/identity/:name/archive` vs another pattern that fits existing conventions in `identities.ts`).
- Where the guard-bypass logic lives (caller in the sentinel-scan branch vs `force:bool` parameter on `retire_identity()` per D-11). Recommendation: caller-side to keep `retire_identity()` guard-agnostic.
- How graceful-exit timeout is chosen for step 2 — reuse the recycle flow's exact wait window, or tune specifically for retire (recycle's window may be too short if the harness is mid-turn on a long response). Planner reviews the recycle code to decide.
- Whether the sentinel-scan branch runs inline on the reconcile tick (cheap; probably fine) or spawns a background task for the retire itself so subsequent ticks aren't blocked while retire is in flight. Given retire touches network (Matrix deactivate) and can take seconds, background-task pattern may be preferable for user-initiated (~15s tick cadence would otherwise spin waiting).
- Exact form of the retire-fail-count-<name> counter for the user-initiated per-tick path (may share Phase 94's existing counter file OR use a sibling; either is fine, the planner picks whichever integrates cleanly).
- Where in the fleet-status sweep code the archive-tree enumeration lands (a second walk parallel to the live-tree walk, or a unified walk over both trees with `archived` flag set per-entry).
- Frontend confirmation dialog implementation — new component, existing modal machinery, or a browser-native `window.confirm`. Planner picks based on existing patterns; the shape file specified copy but not mechanism.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (authoritative for this phase)
- `.planning/shapes/shape-identity-archiving.md` — the LOCKED agreement from the /open pass 2026-09-17. All D-01..D-23 above are derived from it plus the three discuss-phase clarifications (D-08 sentinel name, D-17 transport shape, D-15 failure retry). Read this first.

### Prior phase context (heavily informs Phase 115)
- `.planning/phases/94-supervisor-archive-extension-daily-archive-scan-for-180-day-/94-CONTEXT.md` — the retire flow being reused. Especially D-10..D-16 (retire action, failure handling, un-archive out of scope). ⚠ Phase 94's D-10 order (move → kill → deactivate) is DEVIATED FROM in Phase 115 (D-13); Phase 94's D-13/D-14 retry semantics are REUSED for the 180-day path and MIRRORED for user-initiated with faster cadence.
- `.planning/phases/94-supervisor-archive-extension-daily-archive-scan-for-180-day-/94-01-PLAN.md` through `94-*-SUMMARY.md` — Phase 94's implementation. Read to understand the current `retire_identity()`, `run_archive_scan_if_due()`, guard helpers (`is_coordinator`, `.pinned`/`.no-dormancy` presence checks), retire-stuck counter, and matrix deactivate call shape.
- `.planning/phases/107-hide-identity-rows-via-disk-sentinel-mirror-phase-92-for-the/107-CONTEXT.md` — the `.hidden` pattern being replaced. Establishes the ALLOWED_REL_PATHS extension pattern, `publicIdentity()` field addition, backend fanout, frontend derivation via `deriveDiskHiddenIds`, both-loaded hydrate gate, and affordance-narrowing gate (identity-row-only affordance). Phase 115 REMOVES most of what 107 added (see D-21).
- `.planning/phases/105-pin-sentinel-migration-move-identity-pin-state-from-skynet-d/` (originally Phase 92, rescue-renumbered to 105) — the reference implementation Phase 107 mirrored. Same primitive layer + fanout + derivation patterns.

### Files this phase modifies

**Frontend:**
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — unified context menu (renamed Hide→Archive item + red styling + confirmation trigger). Menu render site around L1341-1418 per HEAD `ebcbac5b`.
- `src/ui/shell/IdentitySessionPane.tsx` — mirror menu on the identity badge (Hide→Archive rename). Around L154-222 per HEAD `ebcbac5b`.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — `handleToggleHide` handler renamed / refactored to call the new archive endpoint. Around L1355. Archived-section lazy-render verification.
- `src/ui/api/user-preferences-api.ts` — retire `putHiddenIds`, `getHiddenIds`.
- `src/ui/api/identities-api.ts` (or new file) — new `archiveIdentity(hostId, name)` API call for the POST endpoint.
- `src/ui/state/conversation-store.ts` — retire `hideConversation`/`unhideConversation`; add archive handler.
- `src/ui/state/identities-store.ts` — retire `deriveDiskHiddenIds`, `hydrateHiddenIdsFromServer`.

**Backend:**
- `src/backend/database/routes/identities.ts` — new archive route; retire `hidden` field on `publicIdentity()` + parallel `.hidden` probe.
- `src/backend/database/routes/user-preferences.ts` — retire `hiddenConversationIds` fanout.
- `src/backend/claude-session/per-identity-file.ts` — add `".archive-requested"` to `ALLOWED_REL_PATHS`; retire `".hidden"` from same.
- `src/backend/database/db/index.ts` — no schema changes needed (Phase 107 already dropped the `hidden_conversation_ids` column; nothing new to drop for Phase 115).

**Fleet substrate (`substrate/scripts/`):**
- `agent-supervisor.sh` — new sentinel-scan branch on reconcile loop; retire flow step reordering; user-initiated retry counter.
- `fleet-status-sweep.py` — enumerate `identities-archive/` in addition to `identities/`.
- `sweep-schema.ts` — add `archived: boolean` field to `SweepIdentityLine`; retire `hidden: boolean` field.

**Distribution:**
- `src/backend/distributor/catalog.ts` — no changes (existing entries for `agent-supervisor.sh` + `fleet-status-sweep.py` continue to distribute).

### Files this phase READS (contract references, no changes)
- `substrate/scripts/agent-supervisor.sh` § `retire_identity()` (L368-478) — the function being reused with reordered internal steps. New step order sequences the same three primitives (matrix deactivate → tmux kill → folder move) plus a new step (graceful harness exit before tmux kill).
- `substrate/scripts/agent-supervisor.sh` § `recycle()` (~L1050) — the graceful harness-exit pattern D-14 reuses.
- `substrate/scripts/agent-supervisor.sh` § `run_archive_scan_if_due()` + `run_archive_scan()` (L482-577) — the existing 180-day scan machinery, referenced by the new sentinel-scan branch as a sibling; retire-fail-count-<name> counter shape used at L528.
- `substrate/scripts/ambient-monitor.py` § `_harness_watch()` (~L738) — the graceful-shutdown path that fires when the harness dies. Its correct behavior is what D-13's new retire order relies on; verify (not modify) that this actually SIGTERMs its four watcher children and flushes the relay receiver's cursor before ambient-monitor itself exits.
- `substrate/scripts/recv.sh` — the relay receiver. Cursor-flush behavior on shutdown is inherited from Phase 94 CONTEXT § canonical_refs.
- `~/.claude/skills/id/SKILL.md` § "Coordinator mode" — the strict `coordinator: true` detection rule (already used by Phase 94's `is_coordinator()`). Phase 115 BYPASSES this guard for user-initiated retire (D-11) but does NOT change the detection rule.

### Fleet substrate distribution
- `src/backend/distributor/catalog.ts` — canonical catalog. Once Phase 115 changes land on origin, the distributor spreads them to every managed host on its next sweep. **Never hand-edit installed copies on any box** (fleet rule, Ashley 2026-09-10).

### Homeserver deactivate reference (mechanics)
- Phase 94's Matrix deactivate call shape at `agent-supervisor.sh` L424-473 — POST `/_matrix/client/v3/account/deactivate` with `Authorization: Bearer <own-token>`, body `{"auth":{"type":"m.login.password","user":"<mxid>","password":"<pwd>"},"erase":true}`. Verified against Synapse 1.157.2 during Phase 94 shape development. No new server-side work needed for Phase 115 — the endpoint call already works.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`retire_identity()` in the supervisor** — Phase 94 built the whole flow. Phase 115 reuses it with two changes: (1) reorder its internal steps to matrix→harness→tmux→folder, (2) accept a bypass on the pinned/no-dormancy/coordinator guards for user-initiated calls. The move-folder, tmux-kill, and matrix-deactivate primitives inside it are all reused as-is.
- **`per-identity-file.ts` primitive** — `writeIdentityFile` / `removeIdentityFile` / `identityFileExists` with ALLOWED_REL_PATHS gate. Adding `".archive-requested"` to the allowlist is the entire mechanical change for the primitive layer (Phase 107 established this pattern for `.hidden`).
- **Ambient-monitor's harness-watch** — `_harness_watch()` at `substrate/scripts/ambient-monitor.py` ~L738 already does the "notice when the harness dies, shut down my four watcher children cleanly, flush relay cursor" work. D-13's new retire order leans on this being correct.
- **Recycle's graceful-exit pattern** — `agent-supervisor.sh` ~L1050 has the `/exit paste + Enter, wait, SIGTERM survivors` sequence. Step 2 of the new retire order reuses this verbatim.
- **Phase 94's retire-fail-count-<name>** file at `DORMANCY_STATE_DIR/retire-fail-count-<name>` (L528) — the counter mechanism for retire-stuck detection. The user-initiated path can use the same file (or a sibling) with faster per-tick semantics.
- **The `.hidden` fanout code path in `user-preferences.ts`** — the closest existing template for a per-identity sentinel-drop endpoint. Phase 115's new archive endpoint follows a similar pattern but as a POST-one-identity instead of PUT-array-of-IDs.
- **The unified context menu in `PrettyConversationRow.tsx`** — HEAD `ebcbac5b` just unified the row and identity-badge menus. Phase 115's rename lands cleanly in a single site (the unification means the badge menu inherits automatically).

### Established Patterns

- **Presence-is-meaning sentinels** — `.no-dormancy`, `.pinned`, `.hidden` (retiring), `.recycle-requested`. Phase 115's `.archive-requested` follows this convention: empty file, presence = intent. Do NOT encode content in the sentinel body.
- **Intent-signal sentinels vs state sentinels** — `.recycle-requested` is an intent (consumed and deleted); `.pinned` is state (persistence-checked). Phase 115's `.archive-requested` is an INTENT (D-07). Get this right — the semantics affect deletion timing (D-12).
- **Case-insensitive tmux session naming** (`agent-supervisor.sh` invariant) — the tmux kill step MUST use `-t <name>` not `-t =<name>` and match case-insensitively. Known trap documented in Phase 94 CONTEXT.
- **Idempotent-by-construction retire steps** — matrix deactivate is idempotent per Synapse, tmux kill is a no-op if the session is gone, folder move is idempotent if the destination exists. Phase 115's retry semantics (D-15) depend on this.
- **Fleet substrate distribution** — edits to `substrate/scripts/*.sh` land on all boxes via the distributor. Never hand-edit installed copies (fleet rule).
- **Scoped test runs at executor scope** — Phase 115 executor uses scoped `npx vitest run <files>` per fleet directive; full-suite + Playwright smoke are ORCHESTRATOR-owned pre-deploy motions.
- **User-initiated overrides guards** — the pinned/no-dormancy/coordinator guards protect against AUTOMATED retire; a direct click is not automated. Same reasoning could apply to other future user-initiated commands.

### Integration Points

- **Ambient-monitor + retire ordering.** The new retire order requires the ambient-monitor's graceful-shutdown path to actually work as documented — SIGTERM its four watcher children when the harness dies, flush the relay cursor before exit. Verify this during testing, don't just trust the docstring; the whole ordering improvement depends on it.
- **Fleet-status sweep + archive tree.** The sweep grows to enumerate `identities-archive/`. The archived section in the sidebar consumes the sweep's `archived: true` field. No push wire needed — Skynet's existing periodic per-host sweep discovers archive-tree changes on its normal cadence.
- **The unified menu's dispatcher.** After HEAD `ebcbac5b` the row and identity-badge menus share their action set. Phase 115's rename lands in the shared dispatcher, both entry points inherit. Confirm this is genuinely one site to touch, not two.

### Test Considerations

- **The full retire flow has never fired in production** (D-22 load-bearing). End-to-end tests against a throwaway matrix account + throwaway identity folder + real tmux session are the reference test for both trigger paths. Do NOT ship on the assumption that Phase 94's code works because it was reviewed — the code path is unproven.
- **Guard-bypass testing.** Both paths must be tested: user-initiated on pinned/no-dormancy/coordinator identity SHOULD retire; 180-day sweep on same SHOULD skip.
- **Sentinel deletion timing.** Test that a mid-retire crash leaves the sentinel in place for the next tick to retry, AND that a successful retire deletes the sentinel BEFORE the folder move so the archive tree doesn't accumulate stale sentinels.
- **Ambient-monitor shutdown observable.** The retire test should observe (via log or state file) that the ambient-monitor's four watcher children were SIGTERMed cleanly during step 2, not orphaned.
- **Reconcile-tick cadence.** The user-initiated path retries every ~15s on failure; test that this doesn't cause a runaway loop hammering a broken homeserver (retire-stuck at N=3 fails is the safety valve).

</code_context>

<specifics>
## Specific Ideas

- **Menu item color red** — from the shape's D-02, matches existing Kill's red styling. Not a knob to tune; the styling exactly matches Kill.
- **Confirmation copy** — exact wording "archive `<identity>`? this can't be undone" locked at D-03. The `<identity>` placeholder is the displayed identity name (e.g. "wren", "tabitha"). Any deviation should be a re-decision, not a paraphrase.
- **Sentinel filename `.archive-requested`** — user-locked (D-08). Mirrors `.recycle-requested`. Do NOT abbreviate or use synonyms.
- **The 180-day dormancy path is not changing its threshold.** Phase 115 adds a second trigger to the same retire flow; the 180-day path continues to fire on its 24h cadence for identities dormant for 180+ days.
- **No archive UI in Skynet's sidebar for archived rows.** The archived section is a read-only view (D-06); no context menu appears when right-clicking an archived row. This is deliberate for v1.
- **Migration plan** — the operator will manually convert existing `.hidden` sentinels across managed hosts after Phase 115 code ships. Not automated (D-20).
- **User-initiated retire runs on every reconcile tick until the sentinel is gone.** ~15s cadence per tick. On failure, sentinel stays; retire-stuck after 3 fails.

</specifics>

<deferred>
## Deferred Ideas

- **Un-archive / restore path** — mv folder back from `identities-archive/`, re-register Matrix account under an ordinal name (`<name>-2`), re-inject into the conversation list. Explicitly out of scope (D-05); shape says "genuinely tempting because it feels like a natural counterpart, but the Matrix deactivation makes it a much bigger conversation."
- **Permanently delete row from the archived section** — a "wipe this from the archive tree" action for hard cleanup. Also tempting, also its own decision. Not in v1.
- **Context menu on archived rows** — any interactions beyond viewing. Deferred (D-06); no options make sense yet.
- **Automated `.hidden` → `.archive-requested` migration** — a one-shot conversion baked into the ship. Not worth automating for the small host count (D-20).
- **Configurable graceful-exit timeout for the harness-exit step.** Reuse recycle's window in v1; if v2 shows some archive requests hang because the harness was mid-response, expose a knob then.
- **Cross-host archive announcement wire.** If the same identity name exists on multiple hosts and one host archives, no push wire announces this to peer hosts. Consistent with Phase 94 D-15 (silent by design) and Phase 94 D-17 (Skynet's periodic sweep discovers changes naturally).
- **User-facing "recently archived" toast or notification.** The row-disappears + appears-in-archived-section is the whole feedback. No additional confirmation UI.
- **Retention/pruning of the archive tree.** If `identities-archive/` grows large over time, no automated pruning. Manual cleanup by the operator when needed.
- **Multi-user re-scoping of the archive gesture.** Currently one user's archive = archive for everyone (same scoping as `.hidden`/`.pinned` today). Multi-user re-scoping is a separate future concern that would touch pin, hide, and archive together.

</deferred>

---

*Phase: 115-identity-archiving-from-the-frontend*
*Context gathered: 2026-09-17*
