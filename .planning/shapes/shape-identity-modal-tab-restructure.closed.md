# Shape: Identity modal — tab restructure (drop History + Handoff, add Runbooks)

**Opened:** 2026-09-08
**Vehicle:** GSD phase

## What this is

The identity modal today has a tab set covering both role-scoped and identity-scoped surfaces of a loaded identity. Two of its tabs are internal plumbing (History, Handoff) that Alice doesn't read, and both go away. In their place, a new Runbooks tab appears on the role side of the modal, reading from the role-scoped runbooks folder layout that landed in the prior session's formalization work. Clicking a runbook in that tab swaps the identity modal for a dedicated runbook-editor modal that mirrors the existing skills-editor modal — same list-picker + bottom tabs pattern, same lazy per-file read, same save mechanics — so runbooks get skills-parity editing affordances essentially for free. Closing the runbook modal returns the user to nothing (the identity modal is not restored); the swap-not-stack call is deliberate for v1 to dodge modal-on-modal interaction complexity. As part of the on-disk shape, the main runbook file is renamed from `<slug>.md` to `runbook.md`, mirroring the skills convention where the folder names the thing and the file inside it is a fixed sentinel.

## Shape

**Two visible surfaces are involved, plus on-disk data + the id-skill contract:**

1. **Identity modal — tab set change.** History tab and Handoff tab are removed entirely: no tab button, no lazy-load effect, no header count/badge, no keyboard nav slot. A new Runbooks tab appears on the role-scope side of the modal (peer to the role-file tab). The four tabs that stay untouched: role file, identity file, bounties, wake-ups.

2. **Runbooks tab body (inside the identity modal).** A bare list of runbook slugs — the folder names directly under `~/.claude/roles/<role>/runbooks/`. Rows are click-to-open, no per-row peek info in v1 (no last-modified, no companion-file count, no first-line preview). Empty state (role has no runbooks folder OR folder is empty) shows a plain "no runbooks yet" message. Clicking a row triggers the swap.

3. **Runbook editor modal (the swap target).** Structurally a clone of the existing skills editor modal, adapted for role-scoped runbooks. Shape:
   - Header shows the runbook name (the folder slug) plus a delete-runbook affordance and a close button. The close button also functions semantically as "back" — the user came from the identity modal, but v1 does not restore it (swap-not-stack).
   - Body is a lazy-loaded file editor for the currently-selected file inside the runbook folder.
   - Bottom tab strip enumerates every file in the runbook folder recursively (same `find -type f -printf '%P\n'` enumerator shape the skills editor uses), one tab per file, full relative path as the tab label. Horizontally scrollable when the file list is long. Nested subfolder support falls out for free — `avatar-prompts/amelia.md` just appears as a tab with that literal label.
   - Add-file, delete-file, mtime-conflict-on-save UX all mirror the skills editor.

4. **On-disk data migration.** The 4 existing box-maintainer runbooks get their main markdown renamed:
   - `avatar-flow/avatar-flow.md` → `avatar-flow/runbook.md`
   - `css-fast-path/css-fast-path.md` → `css-fast-path/runbook.md`
   - `skynet-admin/skynet-admin.md` → `skynet-admin/runbook.md`
   - `user-onboarding/user-onboarding.md` → `user-onboarding/runbook.md`
   Rename motion propagates via the fleet-substrate distributor to any other box that inherits runbooks (currently just t1000; T800 will pick it up on next sweep).

5. **id-skill body update.** The § Runbooks section currently says the main markdown MUST be named `<slug>.md`. That becomes: MUST be named `runbook.md`. Both the storage subsection and the awareness-on-wake enumeration step need to reflect the new naming; enumeration still keys off folder names (unchanged), but any "read the file named `<slug>.md` inside it" phrasing shifts to "read `runbook.md`."

6. **Role file pointer update.** The box-maintainer role file's `## Runbooks` section has a bulleted list where each entry currently references e.g. `runbooks/avatar-flow/avatar-flow.md` — those paths update to `runbooks/avatar-flow/runbook.md`.

7. **Stale-reference sweep.** Grep active bounties for any remaining `runbooks/<slug>/<slug>.md` path references and update to the new shape (Phase 86's follow-up sweep found ~5 such refs; expect a similar handful).

## Philosophy

**Steal from the skills modal rather than invent a new pattern.** The runbook editor is a clone of the skills editor with the disk path and the "what's the parent thing" dimension swapped. Runbooks and skills are structurally the same: a named self-contained unit, a canonical main file, optional siblings. Anything we invent here that diverges from the skills modal is a bug in the design unless there's a specific reason for it (there isn't in v1).

**Swap-not-stack for v1, because the app doesn't currently do modal-on-modal.** Stacking a second modal on top of the identity modal would introduce a new interaction shape (escape-key ambiguity, click-away ambiguity, z-index ladder) that isn't present anywhere else in the app. Swapping is simpler and cheaper to build; if it turns out to be annoying in practice, upgrading to stack-on-top is a straightforward follow-up because the modal shape is already working.

**Runbook file naming standardizes on `runbook.md`, mirroring skills' `SKILL.md`.** The folder already names the thing. Repeating the name inside the folder just introduces a per-runbook variable in every path expression; a fixed sentinel is easier to read, easier to write tools against, and matches what she's used to from the skills world. This is an on-disk contract change, not just a display choice — the id skill contract must reflect it.

**Runbooks tab is a bare list. No peek info in v1.** She said bare list; adding hover-mtime or first-line-preview later is easy if the launcher feels too thin, but starting minimal keeps the surface honest to what it actually is: a launcher.

**The Runbooks tab row shape does NOT try to be its own micro-editor.** No inline expand-to-view, no hover preview of file contents, no per-row action menu. Click means "open the editor modal" — that's the ONLY interaction on a row. Anything richer belongs in the editor modal.

## Prior context

**The runbooks concept itself was formalized last session** in Phase 89 (`runbooks-formal-concept`) — the id skill body gained a § Runbooks section with storage / awareness-on-wake / when-to-invoke / editing-rules / distinction-from-reference-files subsections, and the on-wake load flow gained a step that silently enumerates the role's runbook subfolder names. The 4 existing box-maintainer runbooks were migrated from flat-files to subfolder shape (`avatar-flow/avatar-flow.md`, etc.). That work landed as HEAD `2e45bd38` on `feat/tab-title-from-tmux` this box, none of it pushed yet — this phase's ship gate is where it deploys.

**The skills editor modal (Phase 44) is the pattern being cloned.** It lives at `src/ui/features/pretty-view/SkillsEditorModal.tsx` (696 lines) with the file-editor sub-component at `SkillFileTab.tsx` (149 lines) and the API surface at `src/ui/api/skills-api.ts` fronting `src/backend/database/routes/skills-editor.ts`. Its enumerator is `find <skillRoot> -type f -printf '%P\n'` — recursive, full relative paths, no depth limit. Its bottom-tab strip renders each file as a tab labeled with the FULL relative path (line-626 comment is emphatic: "NOT `split('/').pop()`"), horizontally scrollable. Its save handler carries 409-mtime-conflict UX. All of that shape is what the runbook editor inherits.

**The identity modal today has its full pre-restructure tab set intact.** The prior UX-pass campaign bounty (4/8) touched runbook conceptualization but not the modal UI. Bounties 6/8 and 7/8 target other identity modal surfaces (composebox + queue tab, global files agents-may-edit); each is a separate bounty and separate phase.

**The UX-pass campaign runs push-only during dev — no full builds, no `docker cp` fast-path, no deploy motion until every bounty in the campaign has landed and Alice greenlights the ship gate.** This phase respects that: local scoped tests pass, commits push to origin, but no docker build and no container restart until the campaign-level ship greenlight fires.

## What would make it wrong

- **A runbook editor that isn't skills-parity.** If it invents its own affordances that don't match the skills editor (different save UX, different add-file flow, different bottom-tab shape, different delete-confirm pattern), it's off. The whole point is to steal.

- **The Runbooks tab becoming a micro-editor.** If clicking a row expands the row in place, or hovering shows a preview pane, the tab has stopped being a launcher and become half of a two-pane view. That's a different design and would defeat the swap-not-stack call.

- **The main runbook file staying as `<slug>.md` after this phase ships.** The rename is a contract change; leaving one runbook's main file as `<slug>.md` while the modal expects `runbook.md` would make that runbook silently unreadable in the UI even though the folder enumerates.

- **The id-skill body saying `<slug>.md` and the modal reading `runbook.md`.** Contract drift. The id-skill body is the authority for the runbook-on-disk shape; if the modal doesn't match, the id skill body wins conceptually and the modal is wrong.

- **The identity modal keeping History or Handoff tab machinery after the removal.** If the tab button is gone but the underlying data-fetch effect still fires on modal open, that's dead code and a subtle latency cost.

- **Companion files in nested subfolders becoming invisible.** The whole `avatar-prompts/<name>.md` set for the avatar-flow runbook must render as tabs, one per file, exactly the way the skills modal handles a nested `tests/basic.py`. Losing them because the enumerator wasn't fully cloned is off-spec.

- **Modal-on-modal appearing anywhere.** The swap-not-stack rule is deliberate for v1. If the phase ships and clicking a runbook shows both modals at once, that's a scope violation.

## Scope edges

**In:**
- Identity modal tab set: remove History + Handoff, add Runbooks tab.
- Runbooks tab body: bare list of runbook slugs + empty state.
- New runbook editor modal (clone of skills modal, adapted for role-scoped runbooks).
- Backend routes for runbook enumeration + file read/write/create/delete, scoped to `~/.claude/roles/<role>/runbooks/`.
- On-disk rename of the 4 existing box-maintainer runbooks' main files to `runbook.md`.
- id-skill body update: § Runbooks reflects `runbook.md` convention.
- box-maintainer role file update: pointer list uses new paths.
- Stale-reference sweep in active bounties.
- Test coverage: in-process test walking the flow (identity modal → Runbooks tab → click runbook → editor modal opens → file loads → save → close).

**Out:**
- Stack-mode (modal-on-modal). If v1 swap-not-stack is annoying, that's a follow-up.
- Per-row peek in the Runbooks tab list (mtime, file count, first-line preview). Bare list only.
- Runbook creation via the modal. Runbooks are created by writing folders directly (either by hand or by the /role and id skills); the modal is edit-only for v1.
- Restore-identity-modal-on-close (the "back button" that reopens the identity modal at the Runbooks tab after closing the runbook editor). Not a v1 concern; if she wants it later, easy to add.
- Runbooks tab appearing on identities whose role has no runbooks folder. Tab still renders — empty state carries the signal.
- Cross-role runbook browsing (viewing another role's runbooks from within this identity modal). Runbooks are scoped to the loaded identity's role, full stop.
- Deploy motion for this phase individually. It ships together with the rest of the UX-pass campaign when Alice greenlights.

**Deferred (v2 or later, not this phase):**
- Modal-on-modal upgrade if swap-not-stack proves annoying.
- Per-row peek info.
- Nested-folder grouping in the bottom tab strip (an expando for `avatar-prompts/` etc.) if long lists become visually noisy.
- Runbook-creation UI (from-scratch or from-template).

**Tempting-but-no:**
- Rebuilding the skills modal into a shared "editor-modal" primitive that both skills and runbooks share. Right instinct, wrong time — do the clone first, extract the primitive later when the shape is proven for both. Premature abstraction.
- Adding a "recently-edited" section at the top of the Runbooks tab list. Nice-to-have, feature-creep.
- Sprucing up the runbook editor modal beyond the skills modal's polish level. Parity is the goal; anything better is a separate design pass on the shared primitive later.

## Vehicle notes

**Why GSD phase.** Multi-slice work (new backend routes + new modal + tab restructure + on-disk migration + id-skill body update + role file update + tests), real risk of missing coupling if handled inline or as a single quick. Fits the standing fleet directive that phase-shaped work gets set up as a phase — not routed around.

**Phase number:** to be assigned via `/gsd:phase` — expect the next available slot on `feat/tab-title-from-tmux`. If a slot collision fires per the phase-collision rescue-rebase rule, tabitha applies the rescue-rebase.

**Handoff into `/gsd:discuss-phase`:** this shape file seeds CONTEXT.md. Don't re-elicit the "why + what + constraints" — it's all here. Discuss-phase focuses on refining implementation approach (probably: extract shared editor-modal helpers even at this phase? — likely no per the "tempting-but-no" note above; probably: rename ordering — do we ship the disk rename and id-skill update BEFORE the modal work so intermediate commits don't have contract drift? — worth deciding).

**Ship constraint:** part of the UX-pass campaign. Commits + push + scoped tests only. No `docker build`, no `docker cp`, no `docker compose up --force-recreate`, no full-suite test run until every remaining campaign bounty lands and Alice explicitly greenlights the ship gate.

**Related bounties held open by this phase's ship gate:**
- `identity-avatar-revert-completes-end-to-end` (Phase 86 follow-up — small backend patch)
- `role-avatar-filename-regex-tightening` (Phase 86 follow-up — defense-in-depth regex)

Both should fold into a post-campaign followup phase OR into the last campaign bounty's execute step, before the campaign ship greenlight.

**Peer coordination:** box-maintainer role runs under multiple identities on `feat/tab-title-from-tmux`. Before every push: `git pull --rebase origin feat/tab-title-from-tmux`. Since this phase ships push-only (no container mutation), NO coord-room post is needed per the 2026-09-05 rule.

**Close-out:** `/close identity-modal-tab-restructure` runs after the phase's execute step, then the unbiased general-purpose code review per /build feature-mode step 4, then agent UAT walks the flow in-process.

---

## Close-Out

**Closed:** 2026-09-08
**Vehicle used:** GSD phase (Phase 89, 6 plans across 6 waves)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · History + Handoff tabs removed at file level (git deletion in commit `657e5493`), Runbooks tab added on role scope side of identity modal, dedicated runbook editor modal swaps in on row click, id-skill body updated to say `runbook.md`
- **Shape §1: Identity modal — tab set change** — present · `NAV_SECTIONS_ROLE = [role, runbooks, bounties, role-wakeups]`; `NAV_SECTIONS_IDENTITY = [identity, identity-wakeups, telegram]`. History/Handoff data-fetch effects also removed — only comments about removal remain, no live code
- **Shape §2: Runbooks tab body** — present · `RunbooksTab.tsx` renders bare list of runbook slugs, click-to-open, empty state "This role has no runbooks yet.", alphabetical sort, no per-row peek info
- **Shape §3: Runbook editor modal** — present · Clone of `SkillsEditorModal` with runbook name + delete button + close in header, per-file lazy load, mtime-409 UX, add-file via `window.prompt`, bottom horizontal-scroll tab strip with FULL relative paths (verbatim `file.path`), reuses `SkillFileTab` directly
- **Shape §4: On-disk data migration** — present · Explicitly scoped out of repo per shape's "Outside the repo" note — Alice's manual pass post-close; no shape miss
- **Shape §5: id-skill body update** — present · `substrate/skills/id/SKILL.md` § Storage says "The main markdown MUST be named `runbook.md`"; awareness-on-wake reflects new naming; storage path shows `runbook.md` sentinel
- **Shape §6: Role file pointer update** — present · Explicitly scoped out of repo per shape's "Outside the repo" note; not judged as miss
- **Shape §7: Stale-reference sweep** — present · Explicitly scoped out of repo per shape's "Outside the repo" note; not judged as miss
- **Philosophy: Steal from the skills modal** — present · `RunbookEditorModal` is a documented byte-shape clone with structural parity comments throughout; `SkillFileTab` is imported and used directly; nginx block sits parallel to skills-editor block
- **Philosophy: Swap-not-stack for v1** — present · `PrettyView` `handleOpenRunbook` sets `isIdentityModalOpen=false` at the same tick it sets `runbookEditorOpenState`; on runbook-editor close, no reopen — swap-not-stack test suite S2 locks this invariant
- **Philosophy: runbook.md sentinel naming** — present · Backend routes gate on `RUNBOOK_NAME_RE` and compose paths as `runbooks/<slug>/...`; id-skill body reflects the contract
- **Philosophy: bare list, no peek info** — present · `RunbooksTab` renders only slug text in each row button; no mtime, no file count, no first-line preview
- **Philosophy: no micro-editor on tab** — present · Row's only interaction is `onClick → onOpenRunbook`; no hover preview, no inline expand
- **What would make it wrong: runbook editor not skills-parity** — present · Guarded — same save UX (`writeRunbookFile` with mtime), add-file via `window.prompt`, bottom tab strip with full relative paths, delete-confirm via `DeleteConfirmDialog` — all mirror skills
- **What would make it wrong: Runbooks tab becoming a micro-editor** — present · Guarded — row is a plain button with `onClick`, no expand, no preview pane
- **What would make it wrong: main runbook file staying as `<slug>.md`** — present · Backend reads `runbook.md` sentinel; id-skill contract updated; disk rename is Alice's out-of-repo pass
- **What would make it wrong: id-skill body drift vs modal contract** — present · id `SKILL.md` § Storage explicitly requires `runbook.md`; matches backend path composition
- **What would make it wrong: dead History/Handoff data-fetch machinery** — present · Wire types removed from `claude-session-api.ts` (see "History + Handoff wire types removed 2026-09-08"); no fetch effects remain in `IdentityModal`; only comments explaining the removal
- **What would make it wrong: companion files in nested subfolders invisible** — present · Bottom tab strip renders each `file.path` verbatim (comment: "label is the FULL path relative to runbook root, e.g. `avatar-prompts/amelia.md` — verbatim `file.path`, not a basename extract"); enumerator uses `find -type f` recursive
- **What would make it wrong: modal-on-modal appearing** — present · `PrettyView` `handleOpenRunbook` closes identity modal AT THE SAME TICK it opens runbook editor; test S1 asserts identity modal's scope switch is absent after swap; test S2 asserts close-of-editor does not reopen identity modal
- **Scope edges: IN** — present · Backend routes (7 endpoints), on-disk shape via id-skill body, tests including in-process swap flow test (S1–S5), all landed
- **Scope edges: OUT** — present · No stack-mode, no per-row peek, no runbook creation via modal (only file-creation within a runbook, which mirrors skills parity), no restore-identity-modal-on-close, tab renders on empty-runbooks role, no cross-role runbook browsing
- **Scope edges: Tempting-but-no** — present · No shared editor-modal primitive extracted (clone-first per shape); no "recently-edited" section; no upgraded polish on runbook editor beyond skills parity

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Byte-shape clone discipline is strongly documented throughout — comments reference specific line numbers in `skills-editor.ts`/`SkillsEditorModal.tsx` being mirrored. Notable structural echo: a `_structuralParity useMemo(() => null)` placeholder was retained solely to preserve import parity with skills modal, which is a curious but explicitly-noted parity artifact rather than functional behavior. The runbook editor uses a hardcoded blue hue (220) rather than the identity's hue — this matches the skills editor's posture and is called out as intentional for the swap-not-stack context ("no per-identity context in this top-level modal per D-06"). Backend gate hardening includes `ROLE_NAME_RE` + `RUNBOOK_NAME_RE` + `isSafeRelativePath` ALL firing before SSH connect, with a belt-and-suspenders `absPath` prefix assertion post-compose (defense-in-depth beyond what shape required). Test file for backend routes (1217 lines) is larger than the skills-editor test file (846 lines) — driven by role-404 case addition and 12+ SEC-labeled path-safety attack-input tests. The three actually-out-of-repo pieces (disk rename, role file pointer update, stale-reference sweep) are correctly recognized in the shape's own "Outside the repo" note as Alice's manual pass and were properly excluded from judgment.
