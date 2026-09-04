# Phase 72 DISCUSSION-LOG

**For human reference only. Not consumed by downstream agents.**

Discussion date: 2026-09-04
Discuss-mode: compressed shape-seeded (per build-skill convention — shape file at `.planning/shapes/shape-identity-modal-scope-split.md` already covered What / Shape / Philosophy / Prior context / What-would-make-it-wrong / Scope edges, so discuss-phase did not re-elicit those).

## Provenance

Phase entered through `/build` (feature mode). Sequence:

1. `/build "update the identity modal to support both role-level and identity-level wakeups"` — Ashley pitched the mismatch: current modal shows only identity-scope wakeups, so a coordinator (who only has role-scope wakeups) sees "no scheduled wakeups" — technically true, entirely unhelpful. Also raised broader dissatisfaction with the flat 6-tab strip mixing role-scope and identity-scope content in one flat list.
2. `/open identity-modal-scope-split` — pitched shape back to Ashley (scope-legibility redesign, coordinator case as the strongest argument for doing this at all, history-tab-scope surfaced as a possible confusion — turned out Ashley had misspoken and it IS role-scope per id-skill canonical text, no change needed).
3. Ashley asked for a "tasting" (visual variant comparison) after her direction was "hard to say" — pushed to `/gsd:sketch` to produce 5 layout variants (grouped strip, stacked sections, left rail, top scope switch, dashboard cards), each showing actor-identity AND coordinator-identity states side-by-side.
4. Sketch served on tailnet `http://100.99.149.8:8899/001-identity-modal-role-vs-identity-split/`. Ashley picked **variant D — Top Scope Switch** with "definitely D". Winner marked in README + MANIFEST + ★ on the tab. Sketch commit HEAD `f5c8f459`.
5. Returned to `/open` to write shape file. Vehicle proposed: GSD phase (backed by fleet standing directive that phase-shaped work gets a phase, plus real backend surface, plus 4 modal test files in blast radius). Ashley greenlit vehicle with thumbs-up.
6. Shape file written at `.planning/shapes/shape-identity-modal-scope-split.md`. Ashley greenlit running `/gsd:phase` with thumbs-up.
7. `/gsd:phase add` — Phase 72 added to roadmap via `gsd-sdk phase.add` (slug `identity-modal-role-identity-scope-split-with-role-level-wak`). STATE.md updated with Roadmap Evolution entry.
8. `/gsd:discuss-phase 72` (this step) — seeded CONTEXT.md from shape file per build-skill convention. Compressed discussion: no gray-area re-elicitation, just canonical-refs + code-context + locked implementation decisions for what the shape didn't cover.

## Codebase probes performed

Before writing CONTEXT.md, probed the codebase for existing patterns this phase mirrors:

- **`grep -rln "wakeups\|Wakeup" src/backend/`** → confirmed backend wakeup handling centered on `src/backend/claude-session/identity-artifact-reader.ts` (`readIdentityWakeups` at L700, `humanizeWakeupSchedule` at L109) and WS handlers in `src/backend/claude-session/claude-session-server.ts` (`identity:list-wakeups` at L4953, `identity:update-wakeup` at L5010, patch #17g + patch #154).
- **`grep -n "resolveRoleForIdentity\|readRoleFile" identity-artifact-reader.ts`** → confirmed the role-folder two-step (identity file → `role:` frontmatter → role artifact) is the established pattern at L539 (`readRoleFile`); same pattern used by `readBounties` and `writeBountyFields`. New role-wakeup reader/writer follow this shape directly.
- **`grep -n "coordinator" src/ui/api/identities-api.ts`** → confirmed Phase 67 Plan 67-01 already added `coordinator: boolean` to the Identity type (L22, non-nullable, derived from on-disk YAML frontmatter). Modal reads `identity.coordinator` directly for default-scope logic; no new backend API needed.
- **`ls src/ui/features/pretty-view/IdentityModal*.test.tsx`** → 4 existing modal test files (base, voice, role-tab, stays-awake); all will need updates for new default-active-tab logic.

## Implementation decisions locked during discuss-phase

All items below are LOCKED with defaults grounded in the existing codebase patterns above. Each is a decision that the shape file did not lock but that the planner needs to know before drafting plans. Ashley can override any of them in one line before `/gsd:plan-phase` runs.

### Wire protocol shape for role-scope wakeup CRUD

**Decision:** Add 4 new WS handlers (`identity:list-role-wakeups`, `identity:update-role-wakeup`, `identity:create-role-wakeup`, `identity:delete-role-wakeup`) as siblings to the existing identity-scope ones. Also add 2 new identity-scope handlers (`identity:create-wakeup`, `identity:delete-wakeup`) since the shape says both scopes get full CRUD parity but the current identity-scope surface only supports list + update.

**Rationale:** Extending existing `identity:list-wakeups` with a `scope` parameter is DRY but muddies the "this is an identity op" boundary. Separate handlers keep the boundary clean, add zero risk to the existing identity-scope surface, and match how the codebase already differentiates identity-scope vs role-scope reads elsewhere (`readIdentityWakeups` vs `readRoleFile`).

### Scope-switch memory storage

**Decision:** A tiny Zustand slice (e.g. `src/ui/state/modal-scope-store.ts`), keyed by `identityKey → 'role' | 'identity'`. In-memory only (browser session lifetime). NOT persisted to localStorage.

**Rationale:** Shape locks scope memory at "within a browser session" — matches Zustand's default in-memory shape exactly. Mirrors existing `bounty-counts-store` pattern already imported in `IdentityModal.tsx:28`. Cross-tab / cross-day persistence would be surprising per the "no surprising memory" failure mode.

### Add-wakeup UX

**Decision:** Sub-modal (Radix Dialog-in-Dialog) with a form. Fields: Name (slug-normalized), Schedule type (segmented: Interval/Daily/Weekly/One-shot), dynamic schedule params per type, optional Timezone (IANA), Instruction (multiline), Enabled (Switch, default true). Save posts to backend via new create wire type; Cancel closes.

Affordance is a hue-tinted pill button at the top of the wakeups tab, matching the mid-gradient palette of the existing sticky-search input in the Bounties tab.

**Rationale:** Add-wakeup is genuinely new UX (current modal only supports list + edit). Sub-modal fits the mobile-first constraint better than an inline form (would require significant re-flow of the tab body). Field set follows the id-skill's wakeup schema exactly.

### Delete-wakeup UX

**Decision:** Small trash icon per row (lucide `Trash2`), positioned symmetrically to the existing enable/disable Switch. Click opens a small in-modal confirm (Radix AlertDialog): "Delete `<slug>`? This cannot be undone." Confirm posts delete wire type; refreshes list on success.

**Rationale:** Destructive op needs a confirm; no undo because file-write is atomic and there's no history to roll back to.

### Tab labels

**Decision:** Under Role view — "Role file" / "Bounties" / "History" / "Wakeups". Under Identity view — "Identity file" / "Wakeups" / "Handoff". The scope switch at top already carries the disambiguation.

**Rationale:** Naming the wakeup tab differently under each scope is redundant. Matches shape's "picker-in-tab is redundant with the top switch" call.

### Race handling for concurrent role-wakeup writes

**Decision:** Atomic write via `fs.writeFile` (Linux atomic within a single file for the whole payload). Last-writer-wins. No lockfile.

**Rationale:** Matches existing bounty-write pattern that already accepts the same race with no incidents. Wakeup CRUD write frequency is low (Ashley-driven, not automated); lockfile is over-engineering.

### Coordinator identity Identity-view behavior

**Decision:** All three identity-view tabs render, with informative empty states for Wakeups ("Coordinators use role-scope wakeups only. Switch to Role view to manage.") and Handoff ("Coordinators are stateless routers — no handoff to display."). Identity file renders normally.

**Rationale:** Matches sketch variant-D coord column mockups + shape edge "empty-with-caption is more informative than hidden."

## Flagged for planner (not locked here)

- **Testing surface size** — 4 existing modal test files need updates + 4 new test files expected. Planner may consolidate.
- **Modal file split decision** — `IdentityModal.tsx` is ~1963 lines today. Adding scope switch without splitting is defensible; pre-split into `<ScopeSwitch>` + `<RoleView>` + `<IdentityView>` sub-components is also defensible. Plan-checker pass should weigh testability and blast radius; both approaches acceptable.

## Deferred ideas (out of scope for Phase 72)

- Global schedule dashboard across all roles/identities.
- Schedule scope conversion (identity ↔ role move without recreate).
- Coordinator dispatch history tab.
- Unified schedule editor with in-form scope picker (explicitly ruled out per shape).
- Alternative to rendering the Role file tab under coordinator Role view (currently shows "not loaded" empty state; could hide entirely — deferred until Ashley sees shipped version).
