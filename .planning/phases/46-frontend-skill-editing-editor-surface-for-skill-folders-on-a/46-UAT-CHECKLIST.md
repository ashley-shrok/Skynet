# Phase 46 UAT Checklist — Frontend Skill Editing

**Coverage:** D-01 through D-16 (every decision in `46-CONTEXT.md`).
**Audience:** Ashley, iPhone-primary PWA + desktop browser.
**Ship-target URLs:** `https://gigaashley.click` (primary) and `https://skynet-ec2.ashleycook.com` (secondary).

Walk these steps on production Skynet after the box-maintainer's build + deploy has landed and the 15-minute deadman timer has cancelled cleanly. Sign off each step with the Pass/Fail checkbox + a short note. Any `Fail` routes back to a new planning cycle; a fail on the destructive paths (Steps 9, 10) or the path-safety step (Step 13) means an immediate rollback discussion with the maintainer.

**Fast-path Ashley cares about first:** Steps 1 → 6 (menu → host → skill → tab → edit → save). If those pass, the feature is minimally usable even if a later step fails. Steps 7-14 cover branches Ashley won't hit on every session but the maintainer needs verified before considering the phase closed.

**Prep once, before starting:**

- Sign in to Skynet in your usual browser (whichever pane's already open is fine — no need for a fresh window).
- Pick a host in the fleet that actually has skills under `~/.claude/skills/`. `thenasty` is a safe bet; `skynet-ec2` (this box) is also safe.
- For Step 7 (non-text branch), the maintainer will drop a tiny binary file into one of your skills beforehand — you don't need to make one. Ask them which skill has it.

---

## Step 1: The menu shows "Edit skills…" in the right position

**D-01:** sibling menu entry, positioned after "Edit global files…" — the sole entry point to the feature.

**Action:** In the pretty-conversations panel (the left-hand column), tap the ⋮ (MoreVertical) icon at the top-right of the panel header. The floating glass menu should appear.

**Expected:** The menu has exactly four items, in this order top-to-bottom:
1. `New agent`
2. `New role`
3. `Edit global files…`
4. `Edit skills…`

No icon next to "Edit skills…". No keyboard-shortcut hint. No "beta" badge. Tap anywhere outside the menu — it should close.

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 2: The modal opens with a host dropdown and "Pick a host…" placeholder

**D-01, D-02:** modal opens on click; host `<select>` visible with the Phase 23 shape.

**Action:** Reopen the menu (⋮). Tap `Edit skills…`.

**Expected:** A large glass modal fades in over the panel column (same visual chrome as `Edit global files…`). At the top-left of the modal is a `<select>` that reads `Pick a host…` by default. To its right you should see a disabled-looking second `<select>` reading `Pick a host first…` (the skill dropdown). At the top-right is a glass X close button.

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 3: Picking a host reveals the skill dropdown with "Pick a skill…" placeholder

**D-03:** skill `<select>` populates from whichever host is currently picked.

**Action:** Tap the host `<select>` and pick a host that has skills (e.g., `thenasty`). Wait for the second dropdown to update.

**Expected:** The second `<select>` becomes active and its placeholder changes to `Pick a skill…`. Tapping it opens a list of every skill folder that exists under `~/.claude/skills/` on that host, sorted alphabetically.

Body copy while loading: `Loading skills…` (centered, muted). If the host has zero skills, body shows heading `No skills on this host.` and body `Skills live in ~/.claude/skills/ on the host. Nothing to edit here yet.`

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 4: Picking a skill populates the tab bar with files (flat + path-relative labels)

**D-04, D-05:** tab bar shows files inside the picked skill; subfolder files list flat as tabs whose label is the path relative to skill root (e.g., `tests/basic.py`).

**Action:** Pick a skill from the skill `<select>`. Wait for the tab bar at the bottom of the modal to populate.

**Expected:** The bottom tab bar fills with one small icon-button per file in the skill (FileText icon on top, label underneath). The first tab is auto-selected and its content loads in the editor pane above. Every subfolder file shows its **whole relative path** as the label — for example, `tests/basic.py`, not just `basic.py`. Files at the skill root show just their filename.

Body copy while loading files: `Loading files…`. If the skill is empty: heading `This skill has no files.` body `Use "+ Add file" to create one.`

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 5: A skill with many files gets horizontal-scroll on the tab bar

**D-06:** if a skill has more tabs than fit, the tab bar becomes horizontally scrollable.

**Action:** Pick a skill with lots of files. The `build` skill on `thenasty` is a candidate if it has ≥12 files; otherwise ask the maintainer which skill on the fleet is the biggest. If no fleet skill has enough files, use "+ Add file" (Step 8) to create four or five throwaway files (`a.md`, `b.md`, `c.md`, `d.md`) in a small skill until the row overflows on your device — delete them afterward in Step 9.

**Expected:** When there are more tabs than the tab bar can show on your current screen, the row scrolls horizontally with a native touch swipe (iPhone) or a two-finger scroll (trackpad). Tabs stay their natural width — they don't shrink to fit. On desktop, a horizontal scrollbar may appear.

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 6: Opening a text tab shows the editor pane; save works

**D-07:** text files open in the same editor pane as global-files editor; Save is disabled until you edit; Save persists.

**Action:** Tap a text-file tab (any `.md`, `.py`, `.txt`, `.json`, etc.). The editor pane shows the file's contents in a monospaced textarea. Type a small change (add a space or a comment). The `Save` button (bottom-right of the editor) should light up. Tap `Save`.

**Expected:** The Save button is disabled (`opacity-40`) when the textarea content matches disk. When you edit, it enables. Tap Save — the button label flips to `Saving…` briefly, then back to `Save` and disables again (because now content matches new disk state). Reload the modal (close and reopen from the menu, pick the same host + skill + tab) — the saved change persists.

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 7: A non-text file shows the AlertTriangle placeholder

**D-08:** non-text files appear as tabs (not hidden) but the editor pane is replaced with a placeholder.

**Action:** Ask the maintainer which skill has a binary file in it (they'll drop a 64-byte random file — probably named `binary.bin` — into one of your skills before UAT). Pick that skill. Tap the `binary.bin` tab.

**Expected:** The tab is visible in the bar with the same FileText icon and full-path label as a text file (no visual "you can't edit this" hint in the tab itself). When you tap it, instead of a textarea, the editor pane shows a centered card:
- An `AlertTriangle` icon (small, muted)
- Heading: `Not a text file`
- Body: `This file isn't text and can't be edited here.`

No Save button, no Trash2 delete-file button visible on this branch. Layout height matches a loaded text file — the modal doesn't jump size when you switch between binary and text tabs.

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 8: "+ Add file" creates a new file at the skill root

**D-09:** add-file affordance in the header row, right of the skill `<select>`.

**Action:** With a skill picked, tap the `+ Add file` text button in the modal header row (immediately to the right of the skill dropdown). A `window.prompt` opens with placeholder `""` and instruction `New file name (relative to skill root):`. Type a fresh filename (e.g., `uat-scratch-260819.md`) and confirm.

**Expected:** After a short pause, the tab bar refetches and the new file appears as a tab, auto-selected. The editor pane shows an empty textarea. You can type + Save (Step 6).

**Sub-check — subpath creation:** Tap `+ Add file` again. This time enter a path like `notes/uat-260819.md`. Confirm.

**Expected:** The backend creates the `notes/` subfolder (mkdir -p) then touches the file. The new tab appears with label `notes/uat-260819.md` (full path — D-05).

**Sub-check — duplicate rejection:** Tap `+ Add file` a third time and enter a name that already exists in the skill (e.g., the file you just created). Confirm.

**Expected:** An inline error surfaces in the file-list area: `A file with that name already exists in this skill.` No duplicate tab created.

**Sub-check — empty / cancel:** Tap `+ Add file`, then either click Cancel on the prompt or hit OK with an empty string.

**Expected:** No-op. No new tab, no error.

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 9: Delete-file confirm dialog appears, removes file on confirm

**D-10:** the ONE confirmation Ashley explicitly asked for.

**Action:** Pick a text file you don't care about (one of the throwaway ones from Step 5 or Step 8 is ideal). Tap the file's tab so it's active in the editor. Look for the small `Trash2` (trash-can) icon-button to the **left** of the Save button. Tap it.

**Expected:** A small modal-in-modal appears, centered inside the parent skill-editor modal (dims the parent modal only — the rest of Skynet stays visible/undimmed underneath). Contents:
- Heading: `Delete file?`
- Body: `<skill>/<path>` on its own line in monospaced font (e.g., `test-skill/uat-scratch-260819.md`), then plain: `This can't be undone.`
- Two buttons at the bottom-right: `Cancel` (neutral, left) and `Delete` (red-tinted, right, auto-focused).

**Sub-check — Cancel:** Tap `Cancel`. The dialog closes; the tab is still there.

**Sub-check — Delete:** Reopen the delete-file dialog (Trash2 again). Tap `Delete`.

**Expected:** Button label flips to `Deleting…` briefly. On success the dialog closes and the tab disappears from the tab bar. Another tab is auto-selected in its place.

**Sub-check — Esc dismisses:** Reopen the dialog, press Esc. It should close (= Cancel).

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 10: Delete-skill confirm dialog appears, removes skill on confirm

**D-11:** delete an entire skill (folder + everything under it).

**Action:** Pick a skill you don't care about — ideally a throwaway one you create just for UAT via `mkdir -p ~/.claude/skills/uat-scratch-260819 && echo "hi" > ~/.claude/skills/uat-scratch-260819/README.md` on the host beforehand. Once picked, look for the small `Trash2` icon-button in the modal header row, immediately right of `+ Add file` (only visible when a skill is picked). Tap it.

**Expected:** A modal-in-modal appears (same visual family as Step 9). Contents:
- Heading: `Delete skill?`
- Body: `<skill>` on its own line in monospaced font (e.g., `uat-scratch-260819`), then plain: `This removes the skill folder and every file inside it. This can't be undone.`
- Buttons: `Cancel` (left, neutral) and `Delete skill` (right, red-tinted, auto-focused).

**Sub-check — Cancel:** Tap `Cancel`. Dialog closes; the skill is still picked in the dropdown.

**Sub-check — Delete skill:** Reopen and tap `Delete skill`.

**Expected:** Button flips to `Deleting…`. On success the dialog closes; the skill disappears from the skill `<select>` dropdown; the tab bar clears; the skill dropdown reverts to `Pick a skill…` placeholder.

Verify on the host afterward that `~/.claude/skills/uat-scratch-260819/` is gone entirely (`ls ~/.claude/skills/` should not list it).

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 11: Menu item has no icon, no shortcut hint, no beta badge

**D-01 + UI-SPEC L116:** menu entry is visually indistinguishable from "Edit global files…" except for the label.

**Action:** Open the panel-header ⋮ menu again. Look carefully at the "Edit skills…" row versus the "Edit global files…" row above it.

**Expected:** Same font, same size, same color, same hover treatment, same left/right padding. Only the label differs. No `⌘K` or similar shortcut hint on the right. No lucide icon on the left. No `NEW` / `BETA` badge.

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 12: "Edit global files…" still works unchanged

**D-01 (regression guard for the sibling menu-entry mount):** the Wave 3 wiring must not accidentally cross-wire "Edit global files…" into the skill flow or vice versa.

**Action:** Open the ⋮ menu, tap `Edit global files…` (not `Edit skills…`). Pick a host. Confirm files load, at least one file opens in the editor, save works. Close the modal.

**Expected:** Global-files editor behaves exactly like it did before Phase 46 shipped. No visual change, no behavioral regression, no accidental cross-wiring where "Edit global files…" opens the skill editor or vice versa.

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 13: Path-safety gate rejects crafted attack requests (browser DevTools check)

**D-16 / T-46-02 defense verification.** This is a maintainer-assisted check — Ashley doesn't have to type curl.

**Action:** Open your browser's DevTools → Network tab. Open the skill editor, pick a host + skill. Open a text file (Step 6) — you should see an XHR/fetch call to `/skills-editor/read` succeeding with a 200 response. In DevTools console, run:

```javascript
fetch("/skills-editor/read", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer " + localStorage.getItem("skynet_access_token"),
  },
  body: JSON.stringify({ hostId: <same-hostId-as-worked-above>, skill: "../etc", path: "passwd" }),
}).then(r => r.status).then(console.log);
```

**Expected:** The response status logs as `400` (not 200, not 500). No file read from the host. Run again with `skill: ".."` — also `400`. Run once more with `path: "../../etc/passwd"` (skill: your real skill) — also `400`.

If any of these returns anything other than `400`, STOP the UAT and page the maintainer immediately — this is a life-critical gate.

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Step 14: Esc closes the modal; outside click does NOT close it

**D-02 (modal chrome inheritance):** the skill-editor reuses the global-files modal chrome verbatim; `onInteractOutside preventDefault` (from patch #111f) must survive the Wave 2 fork so accidental taps behind the modal don't dismiss unsaved edits.

**Action:** Open the skill editor modal (⋮ → `Edit skills…`). Try tapping/clicking outside the modal (in the darkened region around it, on the underlying app). Then press Esc.

**Expected:** Outside tap/click does NOT close the modal — the modal chrome stays put. Pressing Esc closes the modal cleanly (fade-out animation, returns focus to the trigger).

**Pass/Fail:** ☐ Pass ☐ Fail — Notes:

---

## Post-walk sign-off

- [ ] Steps 1-14 all `Pass`. Feature usable end-to-end for Ashley's fast-path.
- [ ] Any `Fail` above: route back to the planner via `/gsd-plan-phase` on a new phase or `/gsd-quick` for a scoped fix.
- [ ] Deploy considered safe post-UAT. Deadman timer already cancelled by the maintainer once HTTPS 200 verified on `/skills-editor/skills?hostId=<n>` before the timer window ran out.
- [ ] Throwaway UAT files/skills cleaned up on the host (`~/.claude/skills/uat-scratch-*` — delete any that survived Steps 8/9/10).

---

*Phase: 46-frontend-skill-editing-editor-surface-for-skill-folders-on-a*
*Checklist authored: 2026-08-19*
*Ships alongside: 46-PATCH-DRAFT.md (maintainer pastes into skynet-patches.md at PIN time)*
