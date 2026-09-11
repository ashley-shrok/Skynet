# Phase 80: id skill revamp Phase A — Skynet frontend and backend for pool-based naming, task-scoped creation modal, task pill on chat, task-primary conversation list rows, task field on disk - Context

**Gathered:** 2026-09-06
**Status:** Ready for planning
**Shape file (primary canonical ref):** `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/shape-id-skill-revamp.md` — locked via `/open` 2026-09-06 with full grill pass; every scope decision below traces to it. Planner and researcher MUST read the shape file end-to-end before proceeding.

<domain>
## Phase Boundary

Phase A of the id-skill-revamp build (see shape file "Vehicle notes" for the three-phase split). Delivers, end-to-end, the **Skynet-side** frontend + backend changes that let a new identity be born as a task-scoped worker with a pool-picked name and a task string, and that surface the task in both display surfaces (chat + conversation list) with a graceful fallback when the field is absent.

**In scope for Phase 80:**
- Fix the existing new-agent modal bug where role selection isn't offered.
- Rename the context-menu "Clone" action to reflect that it simply spawns another agent under the same role (cosmetics come from the role, so nothing is being carried from the source identity). Simplify the clone modal accordingly.
- Rebuild the new-agent modal as a **unified** modal with two inputs: a task-description field ("what will this agent work on?") and a name field prefilled with a pool auto-pick. The user can edit the name field to anything — the pool is a suggestion source, not a restriction. The clone entry-point opens the same unified modal, pre-set to the row's role.
- Character-limit the task-input field with a soft cap approximating the coord-side word budget (~15-20 words). Actual pixel-precise limit gets pinned during implementation when the badge layouts render at real widths.
- **Skynet backend gains:**
  - Vetted-pool storage (locked to (a): JSON file in the repo, checked in at deploy time, loaded on boot). See D-01.
  - Pool-name-picking endpoint (frontend calls to get an unused pool name for prefill; backend picks and returns).
  - Ordinal-derivation logic against the Synapse admin API for the `<name>-<role>` handle. On creation: compute the full handle, query the admin API to count existing accounts matching the pattern, pick the next unused ordinal (silent auto-suffix if the base handle is already taken).
  - Wiring the pool-picked name + task string into Tina's existing identity-birth-orchestrator (Phase 77, shipped today) so registration + relay.json write reuse the already-shipped primitive. **No new registration code required in Phase A.**
  - Task field read/expose: task lives on disk in the identity file's frontmatter, backend reads on-demand when serving the identity API, same read pattern the aesthetics fields already use (see feature 66 "Skynet reads and writes identity cosmetics from disk"). No Skynet DB caching layer for task.
- **Chat surface (PrettyView):** identity badge unchanged (avatar + name + role, top-right corner). Add a **centered task pill in the top bar** showing the task string. Pill visual family: **glass treatment matching the identity badge, hue-tinted from the identity's colorHue** (locked D-02). Display gates on populated task field with graceful fallback (no pill) when task is absent.
- **Conversation list row:** current primary line (identity name + `(role)`) replaced by the task itself. Current subtitle line (AI-generated transcript summary) replaced by role prominent-on-the-left followed by identity name in muted parentheses. AI-generated transcript summary drops entirely. Display treatment reuses the existing top-line and subtitle-line behavior (D-03) — no new typographic vocabulary invented. Gates on populated task field with graceful fallback to current name-primary display when task is absent.

**Out of scope for Phase 80 (deferred to Phase B or C, or explicitly out):**
- Pin sentinel migration (Phase B).
- Cosmetics-to-role frontmatter move (Phase B). Frontend implementation of Phase 80 continues to read cosmetics from wherever they currently live — the shift happens in B.
- Agent-supervisor idle-scan archive logic (Phase C).
- Working-dir tree consolidation under `~/skynet/identities/<name>/workspace/` (Phase C).
- Metadata folder migration (Phase C, manual per-box by maintainers).
- Id skill body prose edits and coord companion file edits (Phase C).
- Coordinator name-picking convention change (Phase C, companion-file edit).
- Standardized agent-relay discovery convention in agent-relay skill body (Phase C).
- User-facing manual archive UI (deferred as "maybe later").
- In-UI human editability of the task field after creation (deferred; manual on-disk edit is the escape hatch).
- Coordinator picker changes (known future problem, kept as-is).
- Role-management UI (Alice's separate future work).
- Renaming existing maintainer identities to pool names (no forced migration).
- Palette-per-role or family-avatar-per-role.

</domain>

<decisions>
## Implementation Decisions

### Pool storage mechanism
- **D-01:** Vetted-pool storage is a **JSON file in the Skynet repo**, checked in at deploy time, loaded on boot. Simplest path; matches how other seeded lists live. Rejected alternatives: DB table + migration (harder to update, needs migration for every pool tweak), config value from branding-config (wrong layer — pool is universal, branding-config is per-instance aesthetic). The vetted list itself is being finalized by Alice in parallel (~1800 candidate names → vetted subset); Phase 80 ships with **whatever vetted list is landed by ship time**. Coordination gate at ship, not at plan.

### Task pill visual family (chat surface)
- **D-02:** Task pill uses the **same glass treatment as the identity badge, hue-tinted from the identity's colorHue** (per-identity today, per-role post-Phase-B). Pill visually belongs to the identity badge family — feels like "this identity's current task, wearing this identity's face." Rejected alternative: neutral pv-cream typographic treatment agnostic of colorHue. Rationale: cohesion with the badge; hue tint keeps the pill visually keyed to the identity even though it sits detached in the top-bar center.

### Conversation-list row typography (both lines)
- **D-03:** Both lines **reuse the existing top-line and subtitle-line typographic behavior** — no new vocabulary invented. Task inherits the current top-line style (previously used for identity name). Subtitle (role-prominent + `(name)` muted-parens) inherits the current subtitle-line style. No further typographic tuning is called for at planning time; the natural styles carry the change. Any pixel-level tuning discovered during implementation surfaces as an executor decision, not a planning question.

### Registration primitive re-use
- **D-04:** Phase A layers pool-selection + task-scoped identity model on top of Tina's **existing identity-birth-orchestrator (Phase 77, shipped 2026-09-06)** rather than building a new registration primitive. Tina's orchestrator already provides: `matrixCreateOrUpdateUser` (via admin API — no open registration needed), `matrixLoginAsUser` (mints working access_token so relay.json is usable from birth-time), build relay.json body, SFTP-write to the identity's folder mode 600, partial-failure recovery via `POST /identities/birth/retry/:key`. Phase A's contribution is (a) the modal + task input on the frontend, (b) pool-name-picker + ordinal-derivation on the backend, (c) wiring these into the orchestrator's inputs. Phase 77's Q2 invariant (partial-tolerated, surface error, no rollback) is inherited.

### Task field write-once, disk-only
- **D-05:** Task field is **write-once at identity creation**. No in-UI edit affordance in Phase A. Manual on-disk edit of the identity file frontmatter is the escape hatch if needed. In-UI editability is deferred (additive, can land in a later phase). Storage is **disk-only, no Skynet DB caching layer** — backend reads task from disk on-demand when serving the identity API, matching the pattern established by feature 66 (cosmetics from disk).

### Fallback behavior when task is null
- **D-06:** Both displays (chat pill + conversation-list row) gate on `task` being present-and-truthy in the identity's frontmatter. Absent → fall back to current display (no pill on chat surface; name-primary + AI-generated-summary-subtitle on conversation list). This is what preserves visual sanity for existing maintainer identities, coord-spawned identities from before this ships, and any legacy identity created by the pre-Phase-A modal. Task-primary display is the new default going forward; the fallback is the safety net, not a first-class alternate mode.

### Claude's Discretion (executor / planner)
- **Pixel-level task-input character cap.** Soft cap "~15-20 words" from the shape file; the actual character-count number gets pinned during implementation when the badge layouts render at real widths. Executor sizes it against the rendered pill width so the text doesn't wrap or truncate awkwardly.
- **Pool-fetch endpoint shape.** Whether the backend endpoint returns a single unused pool name per call (backend picks) or the full vetted list (frontend picks client-side). Backend-picks preferred (keeps ordinal-derivation logic server-side and atomic), but the exact endpoint contract is planner territory.
- **Ordinal-query implementation.** The specific Synapse admin endpoint to hit for "count existing accounts matching `<name>-<role>-*`" — likely `GET /_synapse/admin/v2/users?user_id=<pattern>` with search filter. Verified during research phase.
- **Modal layout details.** The unified modal has two inputs + a role selector (the role-select bug fix); exact form layout (order, labels, hint text, error states) is planner/executor territory.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Primary shape (READ FIRST)
- `~/.claude/roles/box-maintainer/bounties/id-skill-revamp/shape-id-skill-revamp.md` — the greenlit shape produced by `/open`. Every scope decision, philosophy note, "what would make it wrong" concern, and scope-edge call in this phase traces to this document. Alice confirmed settled 2026-09-06.

### Dependency phase (registration primitive)
- `.planning/phases/77-telegram-bridge-phase-a-skynet-matrix-admin-integration-foun/77-CONTEXT.md` — the shipped Phase 77 introducing the identity-birth-orchestrator (matrixCreateOrUpdateUser + matrixLoginAsUser + relay.json write via SFTP + partial-failure retry). Phase 80 wires into this; do not duplicate.
- `.planning/phases/77-telegram-bridge-phase-a-skynet-matrix-admin-integration-foun/plans/` — planner should skim the plan files for the orchestrator's shape and its Q2 "partial-tolerated, no-rollback" invariant.

### Related shipped work (patterns to match)
- `.planning/phases/66-skynet-reads-and-writes-identity-cosmetics-from-disk/` — the established disk-read pattern for identity attributes (task field extends this exact pattern; do not invent a new one).
- `.planning/phases/69-kill-the-identities-db-table-disk-becomes-sole-source-of-tru/` — reference for the "disk is sole source of truth for identity state" architecture. Task-on-disk is the natural extension.
- `.planning/phases/72-identity-modal-role-identity-scope-split-with-role-level-wak/` — recent identity-modal work; useful precedent for modal changes even though the split is orthogonal to this phase's task-input addition.

### Skynet architecture (backend surface)
- `src/backend/routes/identities-routes.ts` (or wherever the identity API surface lives) — the endpoints that read/write identity metadata. Task field API surfaces here.
- `src/backend/db/identity-file-reader.ts` (or equivalent) — disk-read pattern for cosmetics fields. Task field reuses this pattern.
- `src/backend/matrix-admin/` (Phase 77's added surface) — the admin-API client used for ordinal-derivation queries.

### Skynet frontend (display surfaces)
- `src/ui/features/pretty-view/` — chat surface where the task pill lands. Top-bar layout + identity badge live here.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — conversation-list row where the task-primary display + role-prominent-name-parens subtitle land.
- `src/ui/index.css:117-146` (the `--color-pv-*` tokens) — the palette source-of-truth for pill glass styling per D-02.

### Existing new-agent + clone modals
- Whatever files back today's new-agent and clone modals — planner identifies these during research phase. The role-select bug fix in the new-agent modal is scope-in.

### Substrate context (background reading)
- `~/.claude/roles/box-maintainer/box-maintainer.md` (§ Skynet direction, § Load-bearing invariants) — Skynet's dot semantics and DB-write flush pattern (identities table was killed in Phase 69; disk is sole source, matching D-05).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Tina's identity-birth-orchestrator (Phase 77)** — full registration primitive; Phase 80 wires the modal's task + name inputs into it. Do not re-implement.
- **Feature 66's disk-read pattern for cosmetics** — task field reads from disk on demand via the same code path. Add task to the frontmatter schema; extend the reader.
- **Existing new-agent modal** — starting point for the unified rebuild. The role-select bug fix is scope-in; don't rewrite the whole thing from scratch if the existing modal has salvageable structure.
- **Existing clone modal** — becomes a thin entry-point into the unified new-agent modal pre-set to the row's role. Rename the trigger action to reflect what it actually does.
- **Skynet host management channel** — used for SFTP-writing relay.json to identity folders (established by Phase 77). No new channel needed for task field (task lands as frontmatter inside the identity file itself, which is created by the orchestrator).

### Established Patterns
- **Disk-is-source-of-truth for identity state** (Phase 69 + Phase 66). Task field extends this without new mechanism.
- **Backend admin-API calls to Synapse via matrix-admin client** (Phase 77). Ordinal-derivation query uses this client.
- **Multi-identity phase artifacts respect the rescue-rebase protocol.** Phase 80 is a rescue-rebased slot after Phase 78 cross-tree collision (tiffany + tina both had 78 in their trees, tina moved to 79, taylor moved to 80). Executor commit-message prefixes retain `feat(80-XX)` etc. per fleet no-`git rebase -i` rule.

### Integration Points
- **Modal → backend name-picker endpoint** (new) — frontend calls to get an unused pool name for prefill.
- **Modal → backend create-identity endpoint** (extend existing) — POST includes the picked name + task string; backend derives ordinal, calls Tina's orchestrator, writes task field into the identity's frontmatter.
- **Backend identity API → frontend** — task field flows through the identity API alongside cosmetics fields.
- **Frontend chat surface → identity data** — top-bar renders task pill when task is present.
- **Frontend conversation-list row → identity data** — row renders task-primary display when task is present, falls back otherwise.

</code_context>

<specifics>
## Specific Ideas

- **Task pill hue-tint = identity's colorHue** (D-02). During Phase A colorHue is still per-identity in the frontmatter; Phase B moves it to the role. Phase A's implementation reads colorHue from wherever it currently lives; no coordination with Phase B needed — the code path is the same read.
- **Pool name examples (illustrative, not the actual vetted list):** Willow, Cinder, Aster, Vega, Onyx, Sable, Fig — single-word, evocative, memorable. The actual pool is Alice's vetted subset of ~1800 candidates; Phase 80 ships with whatever is landed at ship time.
- **Relay-account handle format:** `<PoolName>-<Role>` first use bare (e.g., `Willow-Skynet-Maintainer`), serial ordinal on reuse (`Willow-Skynet-Maintainer-2`, `-3`, ...). Casing: PascalCase for the pool name, hyphenated Role name — planner may adjust to match existing Matrix account conventions on the fleet.
- **Task-string coord derivation** (out of Phase 80 scope, but the character-limit tuning must accommodate what coord will produce): aim for 15-20 words max, first ~6 words carrying row-scanning weight. Phase 80's character limit lands compatible with this.
- **AI-generated conversation subtitle drops entirely** — not relocated to another position. Sketchy in that a small amount of information disappears (short summary of what the identity has been doing), but Alice greenlit the drop; do not "quietly preserve" it in a tooltip or side panel.

</specifics>

<deferred>
## Deferred Ideas

### To Phase B
- Pin sentinel migration (Skynet DB → `.pinned` file in identity folder). Pin state read from disk after this ships.
- Cosmetics frontmatter fields (color, avatar, voice, title) moved from identity files up to role files. Mechanical sweep across existing identities.

### To Phase C
- Metadata folder migration (per-box manual `mv` by each maintainer, coordinated with code deploy).
- Agent-supervisor idle-scan sub-loop (180-day threshold using `since` cursor mtime).
- Archive action (kill session → self-deactivate via own creds → move to archive/).
- Id skill body surgical edits (creation flow section rewritten, self-register block retired or made legacy-fallback, hardcoded paths updated).
- Tina's orchestrator SFTP-write target updated from `~/.claude/identities/<name>/relay.json` to `~/skynet/identities/<name>/relay.json`.
- Coordinator companion file edits (name-picking convention, drop letter-matching, add task-string derivation guidance).
- Standardized agent-relay discovery convention documented in agent-relay skill body.
- Agent-supervisor dual-path lookup for working directories (existing `~/skynet-<name>` vs. new `~/skynet/identities/<name>/workspace/`).

### To future work (post-C)
- User-facing manual archive UI ("maybe later").
- In-UI edit affordance for the task field after creation.
- Coordinator picker rework under increased identity count per role.
- Reactivation of deactivated accounts (explicitly rejected — historical baggage concern).

### Reviewed Todos (not folded)
None — no matching pending todos surfaced by `todo.match-phase`.

</deferred>

---

*Phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool*
*Context gathered: 2026-09-06*
