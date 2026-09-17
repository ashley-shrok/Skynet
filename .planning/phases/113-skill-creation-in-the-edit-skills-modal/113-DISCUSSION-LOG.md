# Phase 113: skill-creation-in-the-edit-skills-modal - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-17
**Phase:** 113-skill-creation-in-the-edit-skills-modal
**Areas discussed:** New-skill affordance placement, Empty-body copy, SKILL.md invariant scope, Two-input UX, Slugification visibility, Header-vs-tab affordance layout, Vehicle selection

> **Note on process.** This discussion happened in the `/open` grill session
> that produced `.planning/shapes/shape-skill-creation-in-edit-skills-modal.md`,
> not in a live `/gsd:discuss-phase` re-elicitation. Per the `/build` directive
> ("seed CONTEXT.md from the shape file, do not re-elicit"), CONTEXT.md was
> written directly from the shape and this log captures the alternatives that
> came up in the grill.

---

## New-skill affordance shape

| Option | Description | Selected |
|--------|-------------|----------|
| Header button next to skill picker | A dedicated `+ New skill` button in the header row | ✓ |
| Sentinel row in the skill dropdown | A `+ New skill…` option inside the `<select>` itself | |
| Two-mode toggle | A tab-like switch between "pick" and "create" | |

**User's choice:** Header button, positioned AFTER the skill picker.
**Notes:** User's verbatim: *"i think new skill goes after the skill pick"*. Ordering makes the picker feel like the primary action and the create button the escape hatch.

---

## `+ Add file` affordance placement

| Option | Description | Selected |
|--------|-------------|----------|
| Keep in header (status quo) | Leave `+ Add file` where it is today | |
| Move to right end of tab strip as an action-tab | Rightmost pseudo-tab that click-and-prompts | ✓ |
| Bottom-of-body button | Standalone button under the file content | |

**User's choice:** Right-end tab-shaped action.
**Notes:** User's verbatim: *"i was thinking like what if we took the add file button that's there now out of the header and made it like a far right tab at the bottom of the modal you know because that's already where the files show so it would be like if you want to add another one then it's down there kind of like at the end of the list where the new file would appear"*. Affordance lives where its outcome lives.

---

## Empty-file-list body state

| Option | Description | Selected |
|--------|-------------|----------|
| Keep empty-state copy, point at `+ New file` tab | Copy is updated to reference the tab | ✓ (fallback for legacy skills) |
| Drop the copy, leave body blank | The `+` tab is the whole affordance | |
| Unreachable state — new skills always seed SKILL.md | Rely on invariant | ✓ (primary case) |

**User's choice:** Both — the state is unreachable for NEW skills (SKILL.md always seeded), but legacy skills without SKILL.md can still land there, so copy is repointed at the tab.
**Notes:** User's verbatim on the invariant: *"honestly i think you shouldn't be allowed to delete the base skill file and given that new skills will be automatically created with one of those then there should be never a scenario where there are no files under a skill"*.

---

## SKILL.md invariant scope

| Option | Description | Selected |
|--------|-------------|----------|
| Forward-only | Invariant applies to skills created via this modal + protects against delete going forward. Legacy skills untouched | ✓ |
| Enforce always | Auto-seed SKILL.md when opening any skill that lacks one | |

**User's choice:** Forward-only.
**Notes:** User's verbatim: *"yeah let's just do forward only"*. Simpler; no stealth mutations on file-list load.

---

## Two-input UX (name + description)

| Option | Description | Selected |
|--------|-------------|----------|
| Chained `window.prompt`s | Two dialogs in sequence, name then description | ✓ |
| Mini-dialog with both fields | A form modal-in-modal with Create/Cancel | |
| Single-prompt with delimiter | e.g. "name: description" | |

**User's choice:** Chained prompts.
**Notes:** User's verbatim: *"yeah let's just do the chained prompts for now"*. Deliberate consistency with the existing `+ Add file` UX register; a mini-dialog upgrade is a future beat.

---

## Slugification visibility

| Option | Description | Selected |
|--------|-------------|----------|
| Show slug to user before commit | Second prompt's message displays the derived slug | |
| Silent slugify | Client normalizes invisibly | ✓ |

**User's choice:** Silent.
**Notes:** User's verbatim: *"i don't think we need to show the user the final slug"*. Machine detail; the user thinks in human words, the picker just shows the slug after the fact.

---

## Description required vs optional

| Option | Description | Selected |
|--------|-------------|----------|
| Required — empty rejected | Second prompt re-asks until non-empty | ✓ |
| Optional — empty allowed | Frontmatter carries an empty string | |

**User's choice:** Required.
**Notes:** User's verbatim: *"description should be required"*.

---

## Single-host chrome

| Option | Description | Selected |
|--------|-------------|----------|
| Always show host picker (status quo) | The picker renders even when there's only one host | |
| Hide picker when host list has exactly one entry | Auto-select stays, chrome disappears | ✓ |

**User's choice:** Hide when single-host.
**Notes:** User's verbatim: *"if the user only has one host i want to hide the host picker entirely and just have it like automatically be on the host that they have if that's not how it already works"*. Scoped to THIS modal for now; extending to `GlobalFilesModal` is a follow-up.

---

## Philosophical failure mode

| Option | Description | Selected |
|--------|-------------|----------|
| Continuous-canvas failure | The modal feels bolted-on rather than one flow | |
| Reset-on-cancel friction | User retypes description because cancel doesn't remember name | |
| Broken invariant | Skills without SKILL.md created | |
| None — feature is straightforward | | ✓ |

**User's choice:** None.
**Notes:** User's verbatim: *"i don't really think there is a philosophical failure mode to this because it's pretty straightforward"*. Recorded so the CONTEXT's "what would make it wrong" section is scoped to shallow security-adjacent risks, not conceptual ones.

---

## Vehicle

| Option | Description | Selected |
|--------|-------------|----------|
| Inline | Do it now in this session, no pipeline | |
| Harness plan mode | Single planned change | |
| `/gsd:quick` | Small-task lane | |
| GSD phase | Full pipeline | ✓ |
| Bounty | Park for later | |

**User's choice:** GSD phase.
**Notes:** Confirmed via thumbs-up after size assessment (new backend endpoint, security gates, nginx parity, frontend restructure, tests on both sides).

---

## Claude's Discretion

- Exact TypeScript signature and naming for `SkillAlreadyExistsError` and the `createSkill` API client function.
- Icon size / spacing tuning inside the `+ New file` tab (starting values picked to match existing `FileText` size 18 and `text-[10px]` labels).
- Whether the new `+ New skill` button uses the same primary-accent style as the retired `+ Add file` button.
- Slug-collision handling in client-side slugify (collapsing consecutive hyphens).
- Whether the `+ New file` tab is `role="button"` or participates in the ARIA tab-role structure — plain `<button>` recommended.

## Deferred Ideas

- Renaming a skill (needs endpoint + UI).
- Cloning / duplicating a skill.
- Template starter picker for new skills (bare frontmatter for now).
- Marketplace / import / share flows.
- Retroactive SKILL.md migration for legacy skills.
- Extending single-host-hides-picker to `GlobalFilesModal`.
- Upgrading chained `window.prompt` to a proper mini-dialog for both `+ New skill` and `+ New file`.
