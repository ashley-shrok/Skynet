# Campaign: Wake-ups redesign — global on-disk specs, fresh identity per fire, front-end management

**Opened:** 2026-09-20 (retroactively converted from single-build to campaign on 2026-09-21 after shape-1 close surfaced that the feature was only half-done without the front-end)
**Status:** in_progress (1/3 shapes shipped, 1/3 code-complete-awaiting-bundled-ship, 1/3 declared)
**Ship strategy:** Shapes 2 and 3 will ship together in ONE motion at end-of-campaign (user's call, 2026-09-21). Shape 2's REST endpoints are useful only when consumed by shape 3's modal — shipping shape 2 solo means deploying code with zero callers.
**Workspace:** `/home/ubuntu/fleet/identities/vector/workspace/skynet/.planning/campaigns/wake-ups-redesign/`

## Concept

Move wake-ups from the current per-identity / per-role scattered file convention to a **global per-host on-disk concept**: a wake-up is a small on-disk spec (name, prompt, one or more roles, optional skills, schedule), and when it fires, a **fresh identity is born on that host** to carry out the prompt as its one job (tissue model — no reuse of running identities).

The user manages wake-ups two equal-citizen ways: through a **modal in Skynet** reached from the conversation-list header, or by touching the same on-disk files directly (which any agent on the host can also do). Two paths in, one source of truth.

Per-role wake-ups (the coordinator-routes-to-actor pattern) are subsumed by the new mechanism and retired. Per-identity self-scheduled wake-ups (the "wake me later" pattern) stay untouched.

## Success criteria

- A wake-up spec present on disk at `~/fleet/wakeups/<slug>/wakeup.json` on any supervisor host fires on its schedule and births a fresh identity — no reuse of an existing identity, no coord-route.
- The newborn identity is fully constituted (roles + skills applied, task frontmatter set from the wake-up's name, first-turn work described in the identity file body as a pre-authorized next action per the id-skill's load-time body-read contract).
- The user can create, view, filter, edit, disable, and delete wake-ups through a modal in Skynet — the same modal reachable from every place the conversation-list header is visible.
- An agent on the same host can CRUD the same wake-ups by touching the disk files directly; the UI shows those changes on next refetch. Neither surface is authoritative over the other.
- The old per-role wake-up mechanism is gone fleet-wide — no per-role scheduler processes, no per-role dispatch code, no leftover per-role spec files.
- The tissue-model philosophy holds: recurring wake-ups start fresh every fire, no baggage, no hidden state channel. Continuity is the prompt author's job via existing shared-knowledge mechanisms (role files, bounties, arbitrary scratch files).
- The pattern is instance-agnostic — the Skynet at term.example.com and any downstream Skynet (like Stacy's on T800) both work identically without per-instance tailoring.

## Shapes

- **[closed]** **shape-wake-ups-backend** — the load-bearing plumbing: on-disk spec convention at `~/fleet/wakeups/<slug>/wakeup.json`, session-independent global-scope wakeup-scheduler running per host, extended spawn-request schema (`roles[]` + `skills?` + `prompt`), birth pipeline extended so wake-up spec's `name` → newborn's `task:` frontmatter and `prompt` → identity file body's `## Do this first` block, one-time fleet-wide hand-migration of existing per-role wake-up specs (28 across workstation + thenasty), sunset of per-role scheduler-spawn + coordinator Type C dispatch + coord-instructions companion files. Full shape + Close-Out: see `shape-wake-ups-backend.closed.md`. — status: **closed 2026-09-21 (verdict: closed-hit; end-to-end verified via smoke tests; two container mutations shipped as GSD Phase 127 + a small follow-up commit)**

- **[code-complete-awaiting-bundled-ship]** **shape-wake-ups-crud-api** — Skynet backend REST endpoints for CRUD over the global wake-up specs (list / create / update / delete / toggle-enabled) plus role enumeration reuse of the existing `roles-list-for-host.ts` endpoint. Thin layer over the on-disk state — the file is the truth, the API just marshals HTTP into filesystem operations. No DB shadow, no streaming, no rate-limiting server-side smarts. Fleet-wide sweep on list (host param on writes). Also folds in removal of the retired per-role wake-up CRUD surface (6 backend service functions + 8 WS wire ops + 5 frontend API helpers + RoleModal's role-wakeups tab + 4 wholesale test-file deletions + 2 surgical test-file excisions). Depends on shape 1's disk convention (live). Skill picker: OUT (roles-only). Full shape: see `shape-wake-ups-crud-api.md`. Full context + decisions: see `.planning/phases/134-wake-ups-redesign-campaign-shape-2-crud-api-fleet-wide-rest-/134-CONTEXT.md`. — status: **code-complete 2026-09-21 as GSD Phase 134** (14 body commits + 8 code-review-followup commits + 1 planning-artifacts commit; 1417 scoped tests green; backend + frontend build clean; awaiting bundled ship with shape 3 per user's end-of-campaign ship strategy)

- **[declared]** **shape-wake-ups-modal** — the front-end surface. New icon button in the conversation-list panel header opens a modal (glass-morphism, matching `ConversationSearchModal`'s chrome recipe). Modal has a list view (filter bar + rows with name/schedule/prompt/chips + enable-toggle + kebab) and a create/edit form (name / prompt / role picker / skill picker / schedule segmented control). Design was **tasting-settled** during shape 1's /open session; the prototype lives at `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/prototype.html`. Depends on shape 2's CRUD endpoints. Full shape: see `shape-wake-ups-modal.md`. — status: declared

## Side-bounties

Spun up during shape 1 shipment (not blockers, small quality-of-life follow-ups):

- **`agent-supervisor-spawn-honesty`** (implicit) — Spawn block in `substrate/scripts/agent-supervisor.sh` currently logs `"global wake-up scheduler started"` even when the `setsid` redirect silently failed. The laptop-host root-owned-fleet-dir issue would have been loud instead of silent with proper exit-code checking. One-line fix + a bit of test coverage.
- **`nested-wakeups-state-dir-glitch`** (implicit) — Global scheduler writes a `~/fleet/wakeups/wakeups/.state/scheduler.pid` nested-dir artifact at startup on some hosts (thenasty + zoeybattlestation confirmed at shape-1 close). Probable state-dir path glitch in the scheduler when running in global mode. Cosmetic but ugly; also may affect the one-shot self-delete path's sentinel writes.
- **`deep-coord-code-retirement`** (implicit) — Broader retirement of the coord-as-mode concept beyond the wake-up dispatch: `ambient-monitor.py`'s IS_COORDINATOR branch, `agent-supervisor.sh`'s `is_coordinator()` function, backend `coordinator: boolean` fields (fleet-status wire-protocol, identity-appearance, identity-clone). All inert (no `coordinator: true` identities exist fleet-wide), but stale carry-over from the coord-as-mode retirement completed 2026-09-20. Not this campaign's scope but naturally follows.

## Other work

None yet.

## Lingerers (explicitly approved)

None yet — will populate at campaign close if any additions land during shapes 2 or 3 that were unforeseen at open.

## Open questions

- ~~**Shape 2 host scope.**~~ SETTLED 2026-09-21: fleet-wide sweep (b), mirroring fleet-status pattern. See `shape-wake-ups-crud-api.md` § Shape.
- **Whether the modal deep-links per-host or shows fleet-wide by default.** Follow-on from shape 2's host-scope decision — since shape 2 locked fleet-wide-by-default, modal shows fleet-wide by default with per-host filter as an affordance. Now effectively settled but worth confirming in shape 3 discussion.
- **How much of the id-skill's `## Do this first` contract to lean on in shape 3's UI hint text.** The form's prompt-field hint should probably say something about the prompt landing as a "Do this first" section, so users understand why their prompt shows up as an authorization + imperative rather than a plain instruction.
- **NEW 2026-09-21 — Fate of per-role wake-up CRUD surface.** SETTLED same session: fold removal into shape 2. See `shape-wake-ups-crud-api.md` § Scope edges. De-risk item flagged for discuss-phase: confirm what `WakeupsTab.tsx` / `RoleModal.tsx` actually serves (per-role vs per-identity vs both) so per-identity management doesn't get killed prematurely.

## Sequencing

1 (backend) ✓ → 2 (CRUD API) → 3 (UI modal).

Shape 3 hard-depends on shape 2 (needs endpoints to call). Shape 2 depends on shape 1's disk convention (already live). No parallelism opportunity here — strictly serial.

Each shape ships independently (unlike first-class-apps' campaign, which held deploys until the whole campaign closed to avoid ride-along risk). Wake-ups CRUD API and UI can ship one at a time because they don't overlap surfaces with concurrent peer identity work in a way that creates ride-along risk. Standard `git push` + deploy motion per shape.

## Vehicle notes for future shape execution

- **Bounty carries the design memory.** `~/fleet/roles/box-maintainer/bounties/wake-ups-redesign/` on t1000 (also on any box-maintainer identity's home box, since the bounty is role-scoped) holds the shape-1 tasting prototype, the migration script that ran fleet-wide, and any post-close scratch. **Shape 2 + 3 executors should look here for the settled modal design.**
- **Container mutation required for shapes 2 + 3.** Both touch Skynet backend and/or frontend, so both need docker rebuild + `--force-recreate` and the user's container-mutation coordination.
- **No fleet-substrate changes expected for shapes 2 + 3.** All work is inside the Skynet container.
- **Shape 3 references shape 2's endpoints directly.** Don't start shape 3 until shape 2 has landed the enumeration + CRUD endpoints; the modal will be untestable without them.

## Historical / genesis

**Genesis.** User ask via `/build`: "Wake-ups — mostly global; a wake-up schedules the creation of an agent at a later time; individual sessions can still self-schedule; creating a wake-up = prompt + skill selection + schedule; good UI needed for viewing/filtering wake-ups" (2026-09-20).

**Initial /open sizing.** Explicit confirmation from user during shape sizing that "the interface for managing these wake ups would be part of this build." Sizing pivoted to "three GSD phases" — which was campaign-shape in practice but not called that at the time.

**Retroactive campaign conversion (2026-09-21).** After shape 1 shipped end-to-end (Phase 127 + follow-up commit), user pointed out that the feature was only half done since the user can't manage wake-ups from the front end yet. Restructured as a proper campaign to prevent losing context about the remaining scope. Shape 1 closed with its ship verification; shapes 2 and 3 declared with their concept + design references so future sessions can `/build shape-<slug>` cleanly.
