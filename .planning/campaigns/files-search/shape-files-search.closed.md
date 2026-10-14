# Shape: a search box in the Files tab that finds things in subfolders too

**Opened:** 2026-10-14

## What this is

The Files tab — one file browser, shown in the agent, role, and project modals — gets a search box. Typing in it searches by name through the folder you're in and every folder beneath it, on the agent's machine. Results replace the normal listing and behave like normal rows; clearing the search brings the normal listing back.

## Shape

- **The box.** Its own full-width row just under the breadcrumb and toolbar buttons. Empty every time the tab opens; not focused automatically (no keyboard popping up on a phone). The breadcrumb keeps showing the folder being searched from.
- **When it searches.** As you type, after a short pause. Each pause starts a fresh search; only the newest search's results are ever shown, so a slow, older answer never lands over a newer one. While a search runs, the previous results stay on screen, dimmed, with a small "Searching…" beside the box — no flicker to a blank list.
- **What matches.** File and folder names only — not contents, not the path. Case doesn't matter. Several words typed are matched as separate pieces that must all appear in the name, in any order ("plan close" finds "close-plan-v2.md"). A matching folder appears as one result; its contents don't come along unless their own names match.
- **Where it looks.** The current folder and everything beneath it, with no depth limit. Shortcuts that point elsewhere are not followed. Dot-files and dot-folders are included, same as browsing shows them. Package-install folders, Python environment folders, and git's internal folder are skipped. Things deliberately hidden from the normal listing (the role's own file in the role modal, the project file in the project modal) are hidden from results too.
- **Limits, always reported.** At most 200 results; at most about 5 seconds of searching. If either limit cuts the search short, a notice says which ("Showing the first 200 matches — type more to narrow it" / "Search stopped after 5 seconds — there may be more"). A quiet line under results always says that package and environment folders aren't searched. No results gives a "no matches" message, not the empty-folder message.
- **A result.** The same row as normal — icon, name, size, modified, and the same three-dots menu — with the folder it lives in as a dimmer second line under the name. Starts ordered nearest-first (shallower before deeper), then alphabetical; clicking a column header re-sorts as usual.
- **Acting on results.** Clicking a file opens it in the usual viewer; closing the viewer returns to the same results. Clicking a folder goes into it and clears the search. Renaming or deleting from a result re-runs the search; renaming keeps the item in its own folder. Download works as normal.
- **Clearing.** Escape, emptying the box, a folder click, or a breadcrumb jump clear the search. Upload, New folder, New file, and dropping files onto the list still act on the current folder, and clear the search so you see what you just added.
- **Errors.** If the agent's machine can't be reached or the search fails, the same plain-English error the listing shows today appears.
- **Agent instructions.** The agent-facing description of the app (the id skill) is updated in the same piece of work so agents can explain the search box.

## Philosophy

A quick-find for when you know roughly what a thing is called but not where it lives. It favors honesty over completeness: it may stop early, but never silently — any limit that cut the results short is stated on screen. It deliberately does not search inside files, does not save searches, and does not invent a new kind of row — results are ordinary rows that happen to come from deeper folders.

## Prior context

Today the Files tab lists one folder at a time; the only way to find something deep is to click down through folders. The Git tab already asks the agent's machine to scan its folders for repos with bulky folders skipped, so asking the machine to do a name search is proven ground. The sidebar's search box is the nearest sibling in feel (filters as you type, forgets on reload).

## What would make it wrong

- Results silently missing because a limit hit and nothing said so.
- An old search's results replacing a newer one's after fast typing.
- The list blanking and flickering on every keystroke pause.
- A file that browsing hides (role file, project file) showing up in results — or a way to act on it from there.
- Search reaching outside the agent's, role's, or project's own folder.
- A big workspace freezing the tab or hogging the agent's machine with no end.
- Results that feel like a different kind of thing from normal rows (missing menu, can't open, can't download).
- Losing your results by opening and closing a file.
- Agents not knowing the box exists.

## Scope edges

- **In:** name search from the current folder down, in all three modals; caps with visible notices; full row behavior on results; id skill update.
- **Out:** searching inside file contents; searching by path text; saved or remembered searches; keyboard shortcut to focus the box.
- **Deferred:** content search could be its own shape later if wanted.
- **Tempting but no:** a depth limit (can't honestly report what it hid); auto-focus on open.

## Handoff notes

- Worked by bilbo-box-maintainer-3 in its Skynet tree on the shared working branch; inside the one-shape campaign at `.planning/campaigns/files-search/`.
- The file browser is a single shared piece used by all three modals — the change lands once.
- The new search runs on the agent's machine through the same per-request access checks every other Files action uses, and must refuse anything outside the target folder.
- Deploy follows the role's normal gates: commit + tests, stop, wait for push and deploy greenlights.

---

## Close-Out

**Closed:** 2026-10-14
**Overall verdict:** closed-hit

### Shape features (conformance)

- **The box** — present · own full-width row under the toolbar; empty on open; not auto-focused; breadcrumb keeps the searched-from folder
- **When it searches** — present · short pause after typing; each new search cancels the last (and stops it on the host); old results stay dimmed with "Searching…"
- **What matches** — present · names only, case ignored, every word must appear in any order, wildcard characters taken literally; a folder match doesn't bring its contents
- **Where it looks** — present · no depth limit, shortcuts not followed, dot-files included, package / Python environment / git folders skipped, start folder outside the target refused, role file and project file hidden (server and screen)
- **Limits, always reported** — present · 200-result and ~5-second notices with the agreed wording; skipped-folders line always shown; distinct "no matches"
- **A result** — present · same row and menu, folder as a dimmer second line, nearest first then alphabetical, column headers re-sort
- **Acting on results** — present · file opens in the usual viewer and closing returns to the same results; folder click enters and clears; rename/delete re-run; rename stays in its folder; download uses the full path
- **Clearing** — present · Escape, empty box, folder click, breadcrumb jump; upload/new/drop act on the current folder and clear the search
- **Errors** — present · unreachable/access failures reuse the listing's errors
- **Agent instructions** — present · id skill Files bullet describes the box
- **Philosophy** — present · stops early only with a stated notice; no content search, no saved searches, ordinary rows
- **What would make it wrong: limits silently hiding results** — present (guarded) · both limits named on screen
- **What would make it wrong: old search over newer** — present (guarded) · cancel + newest-only
- **What would make it wrong: blanking/flicker** — present (guarded) · previous rows stay, dimmed
- **What would make it wrong: hidden file shown or actionable** — present (guarded) · filtered server-side and on screen
- **What would make it wrong: reaching outside the target** — present (guarded) · start-folder check + no link following + same access checks
- **What would make it wrong: big workspace freezing/hogging** — present (guarded) · host time limit, low priority, server backstop, result/byte caps, cancel stops the host search
- **What would make it wrong: results unlike normal rows** — present (guarded) · same row, menu, open, download
- **What would make it wrong: losing results on file close** — present (guarded)
- **What would make it wrong: agents not knowing** — present (guarded) · id skill updated
- **Scope edges** — present · nothing from Out / Tempting-but-no appears

### Additions (in the result, not in the shape)

- Search gets two messages of its own ("Search isn't available here — you can still browse folders by hand" when the machine can't run a folder search; "Search failed — try again in a moment") — endorsed-as-drift
- A query-length limit that surfaced as a generic "malformed request" error, plus an eight-word limit — unsanctioned as built; fixed during close: the word limit was dropped and the box now stops typing at 200 characters, so the limit can never surface as an error

### Follow-ups

- On a phone, a deep folder path squeezes the breadcrumb into a tall narrow column beside the toolbar buttons (existing layout, surfaced more by search) — logged in the campaign's Other work, pending decision

### Notes

Supporting change: the shared modal now lets a field that handles Escape itself keep the modal open, so Escape in the search box clears the search instead of closing the modal. If the time limit and result cap both hit, only the time-limit notice shows. "Searching…" appears as soon as a key is pressed, not after the pause.
