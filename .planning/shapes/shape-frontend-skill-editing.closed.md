# Shape: skill editing on the front end, like is already available for the global files

**Opened:** 2026-08-18
**Vehicle:** GSD phase

## What this is

An editor surface for the skill files that live on a host, reached the same way the existing global-files editor is reached. From the same menu, you pick a host, then you pick which of that host's skills you want to work on, then you see the files inside that skill as a row of tabs and can edit them, delete them, add new files, or delete the whole skill. It behaves as a plain file editor on the host's disk — it does not know or care about how skills are distributed or self-updated between hosts.

## Shape

Two selectors at the top of the modal: the existing host dropdown that global files already has, and next to it a new skill dropdown that populates from whichever host is picked. Beneath, the same bottom-tab pattern the global-files editor uses today, but now each tab is a file inside the picked skill.

Files are listed flat regardless of any subfolders inside the skill — a file that lives in a subfolder shows up as a tab whose label is the path relative to the skill's root, so its location is still legible in the label. If a skill has more tabs than the tab bar can show, the tab bar becomes horizontally scrollable as a fallback. In practice this is expected to be rare.

Each tab opens into the same editor pane as global files. Text files are editable. Non-text files still appear as tabs — they aren't hidden — but where the editor would be, a placeholder says the file isn't text and cannot be edited.

Alongside editing: a way to add a new file to the currently-open skill, a way to delete a file (with a confirmation prompt), and a way to delete the currently-open skill. Adding a brand-new skill from scratch is out of scope for this cut.

## Philosophy

This is a plain file editor for a specific class of folder on a host — nothing more.

It deliberately does not know anything about how skills are distributed, self-updated, or synchronized between hosts. Some skills fetch a fresh copy from a central server every time they run; the editor is unaware of that and shouldn't care. If an edit gets overwritten later by a self-update, that is not this feature's problem. Same principle for any other lifecycle concern: this feature edits files where they are, on the host they're on.

It also deliberately isn't a file manager. It doesn't browse a host's entire filesystem, it doesn't move files between skills, it doesn't rename anything. It's scoped to "pick a skill, work on its files."

There are no protected files. If a file is visible in the tab bar, it's deletable (with a confirm). If a skill is visible in the skill dropdown, it's deletable. The user is trusted to know what she's touching; the editor's job is to be a fast tool, not a safety harness.

## Prior context

The global-files editor already exists on this frontend and is reached from a specific menu. That editor's shape — a modal with a host dropdown at the top and a row of file tabs at the bottom — is the direct model for this feature. This new surface is meant to sit as a sibling entry in the same menu, reuse the same modal chrome, and reuse the same editor pane. Almost nothing about the modal's look-and-feel is fresh design; the fresh work is the added skill dropdown and the fact that the tab bar's content is now scoped to a picked skill instead of a global set of files.

The trigger that motivates this is: making a quick adjustment to a skill on a host without leaving the frontend. That framing keeps the priority on a fast path from "I want to edit this skill" to "I'm editing this skill" — three selections at most (menu → host → skill), then a file tab.

## What would make it wrong

The user did not have a strong intuition for what shape of failure would sour her on this feature. The one implicit failure mode that follows from the "quick adjustment" trigger: any friction on the fast path — the modal taking a long time to enumerate skills on a host, the file list not opening promptly after picking a skill, edits not saving cleanly — undermines the whole reason for having it. Beyond that, no explicit failure modes were named.

## Scope edges

**In:**
- Pick a host (existing dropdown) → pick a skill (new dropdown) → see its files as tabs.
- Edit any text file inside the skill.
- View any non-text file, with a placeholder in place of the editor pane saying it isn't a text file.
- Add a new file to the currently-open skill.
- Delete a file inside the skill, with a confirmation prompt.
- Delete the currently-open skill.
- Files inside a skill's subfolders show up as flat tabs with path-relative labels.
- Fallback for many-tabs case: horizontal scroll on the tab bar.

**Out:**
- Creating a brand-new skill from scratch.
- Renaming skills or files.
- Moving files between skills.
- Any behavior tied to skill distribution or self-update.
- A tree view, drill-down navigation, or any richer intra-skill navigation than a flat tab bar.
- Guards on any specific file (no "you can't delete this one" logic).

**Deferred (tempting but no):**
- A richer navigation UI for skills with many nested files, beyond horizontal scroll.
- Pushing edits back to a source-of-truth host for distributed skills.

## Vehicle notes

Chosen vehicle: a full GSD phase. The feature is multi-step across both the backend (endpoints that enumerate skills on a host, enumerate files inside a skill, and read / write / create / delete those files) and the frontend (new menu entry alongside the global-files entry, skill dropdown alongside the host dropdown, tab bar populated per-skill, delete confirmations, new-file affordance, non-text placeholder). It's phase-shaped in size, so a phase entry is table stakes.

Handoff notes for the implementing agent:
- This is being done by identity `tiffany` at `~/skynet-tiffany/` on the `feat/tab-title-from-tmux` branch, per the box-maintainer directives.
- Reuse the existing global-files editor modal's chrome, host dropdown, tab bar, and editor pane. The skill dropdown is the one new top-level selector; the tab bar's contents are the one new fill-in.
- Tests should exercise the full user flow: pick host, pick skill, open a text tab, edit and save, open a non-text tab and see the placeholder, add a new file, delete a file (with confirm), delete a skill.
- Deploy handoff: as with all Skynet phases here, executor stops at code + commit + tests green. Container mutation (build + recreate) is orchestrator-managed with the coord-room BEFORE/AFTER post protocol.

`/close frontend-skill-editing` is how this arc closes at the end.

---

## Close-Out

**Closed:** 2026-08-19
**Vehicle used:** GSD phase (Phase 46 — 46-frontend-skill-editing-editor-surface-for-skill-folders-on-a)
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is — editor surface for skill files, reached the same way as global files** — present · Modal opened from the same panel-header menu, sibling entry "Edit skills…" right after "Edit global files…"; two selectors at top (host, skill), tab bar of files below, editor pane per tab.
- **Shape — host dropdown + new skill dropdown side by side in header** — present · Host select then skill select in the header; skill select is disabled/placeholder until a host is picked and until skills load.
- **Shape — same bottom-tab pattern as the global-files editor, one tab per file inside the picked skill** — present · Bottom icon-bar with FileText + label per file, structurally mirroring the global-files tab strip; selection styled with the same hue-tinted glassy pill.
- **Shape — files listed flat, subfolder files show as tabs whose label is the path relative to the skill root** — present · Tab label uses the full relative path from the file entry, not the basename; backend uses `find -printf '%P'` so a file at `tests/basic.py` surfaces as `tests/basic.py`.
- **Shape — many-tabs fallback is a horizontally-scrollable tab bar** — present · Tab strip container has `overflow-x-auto` + iOS momentum scrolling; per-tab buttons are intrinsic-width (`shrink-0`, no `flex-1`) so they overflow and scroll rather than squishing.
- **Shape — each tab opens into the same editor pane as global files; text files are editable** — present · Monospace textarea styled verbatim from the mirror; save button gated on draft-diverges-from-loaded-content; save handler mirrors the 409 mtime-conflict reload-or-keep flow.
- **Shape — non-text files still appear as tabs; editor pane replaced by a placeholder that says the file isn't text and can't be edited** — present · Every file in the skill appears in the tab bar regardless of type; when the read result has `isText=false`, the tab body renders an AlertTriangle + "Not a text file" heading + "This file isn't text and can't be edited here" body in place of the textarea.
- **Shape — way to add a new file to the currently-open skill** — present · "+ Add file" button in the header (disabled until a skill is picked and file list is ready) triggers a prompt for the relative filename, then create endpoint, then refetch + auto-activate the new tab.
- **Shape — way to delete a file with a confirmation prompt** — present · Trash2 icon left of the Save button in the file tab body opens the confirmation dialog naming the skill/path; confirm fires the delete-file endpoint and refetches.
- **Shape — way to delete the currently-open skill** — present · Header-row Trash2 (only rendered when a skill is picked) opens the confirmation dialog naming the skill and warning it removes the folder and every file inside; confirm fires the delete-skill endpoint.
- **Philosophy — plain file editor for skill folders on a host; no awareness of distribution/self-update** — present · Backend endpoints operate directly on `~/.claude/skills/<skill>/...` via SSH exec + SFTP atomic write; there is no sync, no distribution hook, no self-update coupling.
- **Philosophy — not a file manager; scoped to "pick a skill, work on its files"** — present · No filesystem browsing outside the picked skill; no rename, no move-between-skills; skill selector is the only navigation dimension above the file list.
- **Philosophy — no protected files, no per-item deletion guards** — present · Deletion path has no allow-list or block-list; any file in the tab bar is deletable and any skill in the dropdown is deletable — the only gate is the shared destructive-confirm dialog.
- **Prior context — reuse the global-files modal chrome and editor pane; skill dropdown is the one new top-level selector** — present · Overlay/content/gradient/close-button copied verbatim from the mirror; textarea and save controls copied verbatim; skill select and "Edit skills" title are the only header-chrome additions.
- **What would make it wrong: modal takes a long time to enumerate skills on a host** — present · Backend uses a single `find -mindepth 1 -maxdepth 1 -type d -printf %f | sort` with a 5s exec timeout; UI shows a "Loading skills…" state so latency doesn't strand the user on an empty header.
- **What would make it wrong: file list not opening promptly after picking a skill** — present · Skill-change effect immediately fires the file-enumerate call with a "Loading files…" body state; first file auto-activates on load.
- **What would make it wrong: edits not saving cleanly** — present · Write path uses atomic tmp+rename via `ext_openssh_rename`, preserves optimistic-concurrency mtime check with a 409 reload flow, and echoes back a server-authoritative mtime so subsequent saves don't spurious-conflict.
- **Scope edge (IN) — pick host → pick skill → see files as tabs** — present · Full path present exactly as described.
- **Scope edge (IN) — edit any text file inside the skill** — present · Ready+text branch renders the always-editable monospace textarea.
- **Scope edge (IN) — view any non-text file with a placeholder in place of the editor pane** — present · Non-text branch handled explicitly with the "Not a text file" pane.
- **Scope edge (IN) — add a new file to the currently-open skill** — present · "+ Add file" + prompt + create endpoint; subpaths accepted (`mkdir -p` on parent) so a new file inside a subfolder is possible.
- **Scope edge (IN) — delete a file with a confirmation prompt** — present · Trash2 in tab body → confirmation dialog → delete-file endpoint.
- **Scope edge (IN) — delete the currently-open skill** — present · Header Trash2 → confirmation dialog → delete-skill endpoint.
- **Scope edge (IN) — subfolder files show as flat tabs with path-relative labels** — present · Backend uses `find -type f -printf '%P'`; tab label renders `file.path` (not basename).
- **Scope edge (IN) — horizontal-scroll fallback for many-tabs case** — present · `overflow-x-auto` on the tab strip + `shrink-0` intrinsic-width buttons.
- **Scope edge (OUT) — creating a brand-new skill from scratch** — present · No such affordance in the UI and no create-skill endpoint on the backend.
- **Scope edge (OUT) — renaming skills or files** — present · No rename affordance or endpoint anywhere in the surface.
- **Scope edge (OUT) — moving files between skills** — present · No move affordance or endpoint anywhere.
- **Scope edge (OUT) — any behavior tied to skill distribution / self-update** — present · Feature operates on files at rest; no notion of a source-of-truth host or a sync trigger.
- **Scope edge (OUT) — tree view / drill-down / richer intra-skill navigation** — present · Only navigation inside a skill is the flat tab bar.
- **Scope edge (OUT) — guards on specific files ("you can't delete this one" logic)** — present · Delete handlers have no per-file allow-list; every listed file is deletable.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

Feature is byte-shape mirrored from the existing global-files modal / tab pair — same chrome, same z-index ladder, same 409 reload UX, same lazy per-tab load with the exhaustive-deps quirk preserved. The only genuinely new pieces are the skill dropdown, the tab-strip horizontal scroll, the isText placeholder branch, and the +Add/Delete affordances with a shared confirmation dialog. Backend path-safety posture is stronger than global-files (two-layer regex gate + belt-and-suspenders prefix assertion before the life-critical `rm -rf` on delete-skill), which is a reasonable hardening for the destructive endpoints and not out of shape scope. Not deployed to a running instance — conformance is judged from source only, as the review contract requires.

---

## Close-Out (pass 2 — post code-review fixes)

**Closed:** 2026-08-19
**Vehicle used:** GSD phase (Phase 46 — 46-frontend-skill-editing-editor-surface-for-skill-folders-on-a)
**Overall verdict:** closed-hit

Re-close after applying the unbiased general-purpose code-review pass (1 blocker + 4 concerns fixed inline; 6 concerns filed as followup bounties for a mirror-wide pass). The B1 fix changed create-failure error UX from a state-clobber to a transient prompt-style alert, which moves the built code toward — not away from — the shape's "edits not saving cleanly" failure-mode commitment. Re-close per the build skill's rule ("if a fix is substantive enough that it changes the built behavior, re-run /close").

### Shape features (conformance)

- **What this is** — present · Editor surface for skill files reached from the same panel menu as the global-files editor — sibling "Edit skills…" entry opens a modal with host + skill selectors and a per-file tab strip below.
- **Shape: host dropdown + new skill dropdown at the top of the modal** — present · Host select then skill select in the header; skill select disabled/placeholder until a host is picked and skills load.
- **Shape: same bottom-tab pattern as global-files, one tab per file inside the picked skill** — present · Bottom icon-bar structurally mirrors the mirror; selection styled with the same hue-tinted glassy pill.
- **Shape: files flat, subfolder files show as tabs whose label is the path relative to skill root** — present · Backend uses `find -printf '%P'`; tab label uses the full relative path, not the basename.
- **Shape: many-tabs fallback is a horizontally-scrollable tab bar** — present · `overflow-x-auto` on the strip + intrinsic-width `shrink-0` buttons (no `flex-1`/`justify-around`) so tabs overflow-and-scroll instead of squishing.
- **Shape: each tab opens into the same editor pane as global files; text files editable** — present · Monospace textarea styled verbatim from the mirror; save button gated on draft-diverges-from-loaded-content; 409 mtime-conflict reload flow reused.
- **Shape: non-text files still appear as tabs; editor pane replaced by placeholder** — present · Every file appears in the tab bar; when isText=false, tab body renders AlertTriangle + "Not a text file" + "This file isn't text and can't be edited here" instead of the textarea.
- **Shape: way to add a new file to the currently-open skill** — present · "+ Add file" button in the header opens a prompt for the relative filename, then create endpoint, then refetch + auto-activate the new tab.
- **Shape: way to delete a file with a confirmation prompt** — present · Trash2 icon in the file tab body opens the shared confirmation dialog naming the skill/path.
- **Shape: way to delete the currently-open skill** — present · Header-row Trash2 (only rendered when a skill is picked) opens confirmation dialog naming the skill and warning it removes the folder + every file.
- **Philosophy: plain file editor; no awareness of distribution/self-update** — present · Backend endpoints operate directly on the skills folder on the host via SSH exec + SFTP atomic write; no sync, no distribution hook.
- **Philosophy: not a file manager; scoped to "pick a skill, work on its files"** — present · No filesystem browsing outside the picked skill; no rename, no move-between-skills; skill selector is the only navigation dimension.
- **Philosophy: no protected files, no per-item deletion guards** — present · Deletion has no allow-list or block-list; any listed file is deletable, any listed skill is deletable — only gate is the shared confirm dialog.
- **Prior context: reuse global-files modal chrome + editor pane; skill dropdown is the one new top-level selector** — present · Overlay/content/gradient/close-button copied verbatim; textarea + save controls copied verbatim; skill select and "Edit skills" title are the only header-chrome additions.
- **What would make it wrong: modal takes a long time to enumerate skills on a host** — present · Single `find -mindepth 1 -maxdepth 1 -type d` call with a 5s exec timeout; "Loading skills…" UI state so latency doesn't strand the user.
- **What would make it wrong: file list not opening promptly after picking a skill** — present · Skill-change effect immediately fires file-enumerate with "Loading files…" body; first file auto-activates on load.
- **What would make it wrong: edits not saving cleanly** — present · Atomic tmp+rename via `ext_openssh_rename`; optimistic-concurrency mtime check with 409 reload flow; server-authoritative mtime echo prevents spurious next-save conflicts. **Improved this pass:** create-failure error UX no longer clobbers the files state (B1 fix — a subtle "unsaved edits vanished when the user hit + Add file with a duplicate name" bug that had slipped past the first close pass).
- **Scope edge (IN): pick host → pick skill → see files as tabs** — present · Full path present exactly as described.
- **Scope edge (IN): edit any text file inside the skill** — present · Ready+text branch renders the always-editable monospace textarea.
- **Scope edge (IN): view any non-text file with a placeholder in place of the editor pane** — present · Non-text branch handled explicitly.
- **Scope edge (IN): add a new file to the currently-open skill** — present · "+ Add file" + prompt + create endpoint; Ashley endorsed sub-path creation as intended.
- **Scope edge (IN): delete a file with a confirmation prompt** — present · Trash2 in tab body → shared confirmation dialog → delete-file endpoint.
- **Scope edge (IN): delete the currently-open skill** — present · Header Trash2 → shared confirmation dialog → delete-skill endpoint.
- **Scope edge (IN): subfolder files show as flat tabs with path-relative labels** — present · Backend uses `find -type f -printf '%P'`; tab label renders `file.path` (not basename).
- **Scope edge (IN): horizontal-scroll fallback for many-tabs case** — present · `overflow-x-auto` on tab strip + `shrink-0` intrinsic-width buttons.
- **Scope edge (OUT): creating a brand-new skill from scratch** — present · No such affordance in UI; create endpoint has an explicit skill-existence gate that 404s if the skill folder doesn't yet exist. **Strengthened this pass:** C2 fix added the explicit `test -d skillRoot` gate on the backend so the API surface can no longer implicitly scaffold a skill folder via `mkdir -p`.
- **Scope edge (OUT): renaming skills or files** — present · No rename affordance or endpoint anywhere.
- **Scope edge (OUT): moving files between skills** — present · No move affordance or endpoint anywhere.
- **Scope edge (OUT): any behavior tied to skill distribution or self-update** — present · Feature operates on files at rest; no sync trigger, no distribution notion.
- **Scope edge (OUT): tree view / drill-down / richer intra-skill navigation** — present · Only intra-skill navigation is the flat tab bar.
- **Scope edge (OUT): guards on specific files (no "you can't delete this one" logic)** — present · Delete handlers have no per-file allow-list.

### Additions (in the result, not in the shape)

- Adding a new file into a not-yet-existing subfolder inside the skill works — typing a nested path into the "+ Add file" prompt creates the intermediate folder on the fly. The shape describes the file surface as flat but doesn't say whether creation into a new subfolder was in scope. **Ashley endorsed this pass 2 as intended.** — endorsed-as-drift

### Follow-ups

None.

### Notes

Second close pass reconfirmed clean conformance after applying the code-review fix batch (B1 create-error state fix, C2 skill-existence gate, C7 strict 409 shape checks, C8 per-dialog delete state, C9 auth-before-body-parser). Two of the fixes (B1, C2) actually strengthened commitments the first pass had already marked "present" — B1 hardens the "edits not saving cleanly" failure-mode commitment; C2 hardens the OUT-scope "no new skill from scratch" commitment. Six other reviewer concerns that touch the shared global-files mirror layer (execCommand .trim() data-mutation, detectIsText re-encoding, find newline-split, echo \$HOME per-request, parentDir extraction, per-exec timeout budget) were deferred to two followup bounties in the box-maintainer's shared bounty pool for a mirror-wide pass. No unsanctioned additions; nothing missing. Ready for deploy.
