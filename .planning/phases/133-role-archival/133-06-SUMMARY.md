---
phase: 133-role-archival
plan: 06
subsystem: id-skill-docs
tags: [docs, id-skill, role-archival]
requires:
  - 133-04 (scanner exists — docs describe shipped behavior, not aspirational)
provides:
  - substrate/skills/id/SKILL.md `## On archiving a role` section
affects:
  - fleet identities reading the id-skill (new sibling section adjacent to
    identity-archive)
tech-stack:
  added: []
  patterns: [sibling-section-mirror]
key-files:
  created: []
  modified:
    - substrate/skills/id/SKILL.md (+128 lines, one new H2 section)
decisions:
  - "Placed new section BETWEEN existing identity-archive section and file-locations section (as PLAN specified) — insertion after the `---` at L836, ordering is identity-archive → role-archive → file-locations."
  - "Rephrased 'no retire-stuck-style marker' → 'no persisted stuck-marker' to avoid naming the removed-in-D-14 mechanism by name in the new section (per done-criteria: no `retire-stuck` / `retire-fail-count` references)."
  - "Kept the identity-archive section fully untouched — the D-13/D-14 refactor is caller-transparent (retire_identity() still returns 0/1 the same way), and the identity-archive body doesn't reference the removed cross-tick mechanism, so no edit was needed there."
metrics:
  duration: ~10min
  completed: 2026-09-24
---

# Phase 133 Plan 06: id-skill Docs Summary

Added `## On archiving a role` section to `substrate/skills/id/SKILL.md` as
sibling to the existing `## On archiving an identity` section. 128 lines
inserted, zero deletions.

## What landed

**File:** `substrate/skills/id/SKILL.md`
**Insertion location:** between line 836 (`---` after identity-archive section) and line 838 (`## File locations` header). Post-insertion structure:

```
## On archiving an identity   (existing, L790-834, unchanged)
---                           (existing separator, L836)
## On archiving a role        (NEW, L838-964, +128 lines)
---                           (matching separator added)
## File locations             (existing, now at L966, unchanged)
```

**Section contents** (in written order):

1. **Preamble** — what/why: role-archive is a NEW gesture in Phase 133, adjacent to but distinct from identity-archive (compose over, not duplicate); it tears down role folder + cascade-retires holding identities in one operator gesture.
2. **⚠️ USER-INITIATED ONLY callout** — mirrors the identity-archive callout at L800-806. Explicit rule: agents never drop `~/fleet/roles/<name>/.archive-requested` on their own initiative. Same reasoning as `/id reset` and `/id archive`. Added a defensive addendum: "no `/id`-style body-drop path for role archival either — only supported trigger is the operator's click in Skynet."
3. **How it works (mechanism)** — 5-step numbered walkthrough: right-click → double confirm (with cascade preview list) → POST `/roles/<name>/archive` → backend sentinel drop → supervisor reconcile tick (fresh enumeration → per-identity retire fail-soft → role folder move only if all-clean → sentinel deleted regardless).
4. **Failure semantics** — honest partial-failure description. Successfully-retired identities gone from live tree; failed identities remain with their own `.archive-requested` sentinel; role folder stays in live tree; role sentinel deleted anyway (one-shot); retry = operator re-clicks. Plus explicit "no cross-tick failure counter, no persisted stuck-marker" (D-14 messaging without naming the removed mechanism).
5. **Guard bypass** — `.pinned`, `.no-dormancy`, `coordinator: true` bypassed for cascaded identities (D-10). Reasoning: guards protect against automated retirement; operator click is not automated.
6. **Click-vs-scan enumeration race (design, not bug)** — RESEARCH Pitfall 6 / D-11 documented honestly. Frontend dialog at CLICK TIME vs supervisor enumeration at SCAN TIME; discrepancy visible in log lines; philosophy quote: "sentinel is the memory, supervisor freshly reads disk on every tick."
7. **Not reversible (yet)** — D-19. Archived at `~/fleet/roles-archive/<name>/`, manual `mv` back possible, no in-app un-archive gesture. Framed as separate future concern.
8. **What travels with the archive** — D-17 verbatim-move rule. Role file, history, runbooks, reference docs, wakeups, bounties, ad-hoc content; no scrubbing even if credentials present (called out as hygiene concern, not this gesture's responsibility).
9. **Per-box scope** — D-18. Role and holders live on the same box; sentinel drops per-box, scanner runs per-box, cascade retires that box's identities. No cross-box coordination.

## D-decisions represented (from CONTEXT.md)

- **D-01** (single operator gesture, cascade in supervisor) — covered in preamble + mechanism section
- **D-02** (right-click context menu on RolesListModal) — covered in mechanism step 1
- **D-03** (double confirmation) — covered in mechanism step 2
- **D-04** (frontend-side cascade preview) — covered in mechanism step 2 + click-vs-scan race section (implicitly — the "at CLICK TIME" phrasing)
- **D-05** (`.archive-requested` at `~/fleet/roles/<name>/`) — covered in mechanism step 4 + USER-INITIATED callout
- **D-06** (one-shot sentinel deleted regardless) — covered in mechanism step 5 + failure semantics
- **D-07** (fresh enumeration each scan) — covered in mechanism step 5 + click-vs-scan race section
- **D-08** (fail-soft cascade) — covered in mechanism step 5 (word "fail-soft" used verbatim)
- **D-09** (folder moves only if all-clean) — covered in mechanism step 5 + failure semantics
- **D-10** (guard bypass) — dedicated Guard bypass subsection
- **D-11** (retry = operator re-clicks) — covered in failure semantics
- **D-12** (empty cascade is degenerate case) — covered in mechanism step 2 ("if zero identities hold the role, the first dialog says so plainly") — the cascade-side no-op behavior is not stated explicitly but falls out naturally from the fresh-enumeration description
- **D-16** (archive location `~/fleet/roles-archive/<name>/`) — covered in mechanism step 5 + not-reversible section + what-travels section
- **D-17** (verbatim move, no scrubbing) — dedicated What-travels-with-the-archive subsection
- **D-18** (per-box only) — dedicated Per-box scope subsection
- **D-19** (one-way, no un-archive) — dedicated Not-reversible-yet subsection
- **D-20** (user-initiated only) — dedicated ⚠️ USER-INITIATED ONLY callout

## D-decisions intentionally NOT represented

- **D-13, D-13a, D-14, D-15, D-21** — implementation-side refactor details (inline per-step retries, removal of cross-tick counter + retire-stuck sentinel, both callers benefit, old on-disk state left as archaeology). These are supervisor-implementation concerns, not agent-facing. The plan's guidance is explicit: "docs describe operator/agent-facing behavior, not the substrate implementation." A fleet identity reading the id-skill does not need to know how the supervisor's retry mechanism works internally; they need to know what happens when their role gets archived.
- The failure-semantics section does mention "no cross-tick failure counter and no persisted stuck-marker" as a positive statement of the current design — this is a NEW-behavior claim, not a description of the removed mechanism.

## Existing identity-archive section

**Unchanged.** Verified via `git diff --stat`: 128 insertions, 0 deletions. The plan's guidance was "the D-13/D-14 refactor in Plan 133-03 is caller-transparent" and "a fresh read of L810-827 suggests it doesn't reference retire-stuck at all, so likely no edit needed" — confirmed correct. The identity-archive section describes only the caller-facing behavior (sentinel drop → supervisor picks up → 5-step retire), which is unchanged.

## Removed-mechanism scrub

Verified via `grep -Ec 'retire-stuck|retire-fail-count'` on the file: returns **0**. Zero references to removed mechanisms anywhere in SKILL.md (new section or existing).

## Deviations from Plan

**Minor rephrasing** (1 spot): The plan's suggested outline had text implying "no `retire-stuck`-style marker for role archival" but the done-criteria said "no accidental references to `retire-stuck` in the new section." These are in tension — a literal reading of the suggested outline would name the removed mechanism. Resolved by rephrasing to "no cross-tick failure counter and no persisted stuck-marker" which preserves the semantic (no cross-tick state) without naming the removed mechanism. This is the tighter reading of the done-criteria.

**Structural placement** matched the plan exactly: identity-archive → `---` → role-archive → `---` → file-locations.

**Section length:** the plan targeted ~40-60 lines of body prose; the delivered section is 128 lines including headings and blank lines (approximately 90 lines of body prose). Slightly longer than the target ceiling because each of the 8 subsections carries a small preamble; the trade-off was chosen because the reader benefits from having each concern (mechanism / failure / guards / race / reversibility / archive contents / per-box scope) as a distinct H3 rather than compressed into a wall of prose. The identity-archive section is much shorter (~44 lines) because role-archive has strictly more surface to document (cascade, guards, race, per-box). Judgment call, not blocking.

## Verification (all done-criteria)

```
grep -c '^## On archiving' SKILL.md               → 2   ✓ (expect 2)
grep -c 'USER-INITIATED ONLY' SKILL.md            → 3   ✓ (expect >= 2)
grep -F 'roles-archive' SKILL.md | wc -l           → 3   ✓ (expect >= 1)
grep -F '.archive-requested' SKILL.md | wc -l      → 5   ✓ (expect >= 2)
grep -Ec '[Gg]uard bypass' SKILL.md               → 1   ✓ (expect >= 1)
grep -Ec 'fail-soft|fail soft' SKILL.md           → 1   ✓ (expect >= 1)
grep -Ec 'no un-archive|not reversible|[Oo]ne-way' → 1   ✓ (expect >= 1)
grep -Ec 'retire-stuck|retire-fail-count' SKILL.md → 0   ✓ (expect 0)
Diff deletion count on identity-archive section    → 0   ✓ (unchanged)
```

All done-criteria pass. All success-criteria pass.

## Commits

- `68e40b14` — `docs(133-06-1): add "On archiving a role" section to id-skill`

## Self-Check: PASSED

- Modified file exists: `/home/ubuntu/fleet/identities/voyager-box-maintainer/workspace/skynet/substrate/skills/id/SKILL.md` — FOUND
- Commit exists in git log: `68e40b14` — FOUND
