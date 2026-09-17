# Phase 113 — Deferred Items

## Discovered by executor during plan execution

### From plan 113-02 (Task 2 — D-10 frontend guard)

- **`src/ui/features/pretty-view/SkillsEditorModal.test.tsx:325-357`** — the
  existing "delete-file confirm dialog opens and DELETE fires on confirm" test
  now fails because it clicked the Trash2 button on the auto-selected `SKILL.md`
  tab. After plan 113-02 Task 2 lands the D-10 frontend guard, that button no
  longer renders on `SKILL.md`. This is a known-scheduled companion edit owned
  by plan 113-04 per `113-PATTERNS.md` line 941:

  > "the existing delete-file confirm test at L325-357 targets `SKILL.md` (see
  > `expect(skillsApi.deleteSkillFile).toHaveBeenCalledWith(1, "build", "SKILL.md")`
  > at L355). After D-10 frontend lands, that Trash2 button is never rendered
  > on the `SKILL.md` tab — the test must switch to a non-SKILL.md tab first
  > (e.g., `fireEvent.click(screen.getByRole("button", { name: /tests\/basic\.py/i }))`
  > before the delete trigger click), and update the assertion to
  > `deleteSkillFile(1, "build", "tests/basic.py")`."

  **Scope decision:** `SkillsEditorModal.test.tsx` is NOT in plan 113-02's
  `files_modified` frontmatter list — the file is owned by plan 113-04. Not
  fixed here per executor scope constraint. Documented in 113-02-SUMMARY.md
  under Deferred Issues.

  **Fixed by:** plan 113-04 (per PATTERNS.md § "Companion edit to existing
  delete-file test").
