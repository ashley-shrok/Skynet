---
phase: 78-passthrough-urls-file-url-scheme-phase-1-of-2
plan: 04
subsystem: fleet-substrate / id-skill
tags: [substrate, id-skill, docs, section-rewrite, wave-2]
dependency_graph:
  requires: [78-01, 78-02, 78-03]
  provides: id-skill teaches the Phase 78 <skynet-parent>/file/<hostname>/<absolute-path> URL scheme as the ONE and ONLY documented file-sharing path
  affects: every agent on every managed box on the next distributor sweep after container recreate
tech_stack:
  added: []
  patterns: [substrate-section-rewrite, retirement-of-superseded-recipe]
key_files:
  created: []
  modified:
    - substrate/skills/id/SKILL.md
decisions:
  - Retired the python http-server recipe ENTIRELY per RESEARCH Pitfall 5 (mechanical grep-gate enforcement — 0 matches for python3 -m http.server / mktemp -d -t share- / tailscale ip -4 / pkill -f / disown in the file)
  - Rephrased the retirement paragraph as "the old tailnet HTTP-server recipe" (instead of naming python3 -m http.server explicitly) to keep the mechanical prohibited-content grep gate at zero
  - Used the "abstract round-trip" copy ("treat it like any freshly-uploaded file when you receive it") because UPLOAD-09 is marked Pending in REQUIREMENTS.md — Phase 5 has not shipped, so we cannot promise the "full landing path visible" affordance yet
metrics:
  duration_minutes: ~10
  completed_date: 2026-09-06
---

# Phase 78 Plan 04: id-skill rewrite — Sending files → Skynet passthrough URLs Summary

One-liner: Rewrote substrate/skills/id/SKILL.md § "Sending files to the user" to teach the Phase 78 URL scheme (`<skynet-parent>/file/<hostname>/<absolute-path>`) as the single documented file-sharing path, retiring the tailnet http-server recipe entirely per RESEARCH Pitfall 5.

## What Changed

**File modified:** `substrate/skills/id/SKILL.md`

- **Section boundaries:** `## Sending files to the user` at L794 through the trailing `---` at L858 in the pre-edit file (65 lines).
- **New section size:** ~80 lines (L794 through the trailing `---`).
- **Diff numstat:** `70 55 substrate/skills/id/SKILL.md` — 70 additions, 55 deletions. Comparable size; slightly denser than the retired recipe because the URL grammar + construction snippet + round-trip semantics + error copy + retirement paragraph all landed in one section.
- **Structural integrity:** 23 H2 headings preserved (same count as pre-edit), horizontal-rule delimiters (`---`) at section start (L792) and section end (L~873) intact, next section `## On /id save — the continuity checkpoint` at heading-level 2 in its original position.

## Grep Gates (Acceptance Criteria)

All 12 mechanical gates from the plan pass:

| Gate | Expected | Actual |
|------|----------|--------|
| `^## Sending files to the user$` | 1 | 1 |
| `^## On \`/id save\`` | 1 | 1 |
| `python3 -m http.server` | 0 | 0 |
| `mktemp -d -t share-` | 0 | 0 |
| `tailscale ip -4` | 0 | 0 |
| `pkill -f` | 0 | 0 |
| `disown` (bonus check — was in the old recipe) | 0 | 0 |
| `skynet-parent` | ≥2 | 4 |
| `/file/` | ≥2 | 3 |
| `cat ~/.claude/skynet-parent` | ≥1 | 1 |
| D-03 missing-file phrase (regex `parent[- ]Skynet config is missing`) | ≥1 | 2 |
| `read-only` / equivalent | ≥1 | 2 |
| Diff `-` count (~65) | reasonable | 55 |
| Diff `+` count (~50-70) | comparable | 70 |

## The Rewritten Content — Key Copy

**User-facing missing-file error sentence** (used verbatim in the rewrite — appears twice, once in the shell snippet's stderr echo and once in the "Rules that matter" block's quoted copy):

> "I can't share files right now — my parent-Skynet config is missing. Ask the box-maintainer role to check the distributor sweep."

**Retirement paragraph — full text:**

> **Why we replaced the old tailnet HTTP-server recipe.** Serving files off the
> tailnet IP over plain HTTP had three chronic pain points: (1) Chrome flagged
> every download as "insecure file" because the tailnet has no cert path on
> Ashley's plan; (2) the tailnet-only reach meant customer VMs and any box off
> the tailnet (T800 today, future customer boxes tomorrow) simply couldn't be
> served this way; and (3) every share saddled you with agent-side server
> lifecycle burden — a backgrounded process to kill, `mktemp -d` staging dirs to
> clean up, port juggling, PID tracking, self-`pkill` traps. The Skynet
> passthrough URL scheme is the ONE and ONLY documented way to share files now:
> HTTPS end-to-end, works from anywhere Skynet reaches, and no agent-side
> process to babysit.

**All three RESEARCH-flagged failure modes named:** (1) Chrome insecure-download friction, (2) tailnet-only reach (T800 + customer VMs excluded), (3) agent-side server lifecycle burden. Meets the "MUST name at least two of three" requirement with all three.

## Structural Elements Preserved

Per the plan's formatting rules:

- Heading `## Sending files to the user` at H2 level (unchanged text)
- Bold intro pattern preserved (`**Small text (< ~5 KB)**` / `**Anything larger, or binary**`) matching original cadence
- Shell snippet in 4-space-indented code block (matches file convention — no ``` fences)
- "Rules that matter — bake them in every time:" verbatim phrase preserved with rewritten bullets underneath
- Trailing `---` horizontal rule closes the section

## Read-Permission Failure Mode Documented

Per plan Task 1 addition #3: the "Rules that matter" block explicitly names `/root/*`, `/etc/shadow`, `/proc/*`, `/sys/*`, `/dev/*` as paths that will fail with `permission_denied` / `path_forbidden` errors in the modal, and instructs agents to ask the box owner to widen access rather than escalate. Matches D-04 + Plan 01's error taxonomy.

## Round-Trip Semantics — Abstract Framing (UPLOAD-09 Pending)

Per plan Task 1 addition #4: I checked `.planning/REQUIREMENTS.md` for UPLOAD-09 status — it is listed as `Pending` in the traceability table (line 278). Because Phase 5 has NOT shipped, I used the abstract round-trip description ("treat it like any freshly-uploaded file") rather than promising the "full landing path visible" affordance. Explicit copy:

> If she edits and hits Save, Skynet does NOT overwrite the original file — the edit lands as an attachment on her NEXT message to you; treat it like any freshly-uploaded file when you receive it (read it, diff against the original, decide what to do). The file on disk at the original path is never touched by Skynet.

## Distributor Delivery

Per RESEARCH Assumption A8 (catalog.ts:96-99), `substrate/skills/id/SKILL.md` is already in the distributor's catalog. The rewrite ships to every managed box automatically on the next sweep after container recreate. No new catalog entry needed; no distributor code change in this plan.

## Wave Ordering Rationale — Confirmed Satisfied

Plan 04 is Wave 2 depending on Plan 03 (distributor step 4). Plan 03 already shipped, so every managed box either has `~/.claude/skynet-parent` populated on next bootstrap sweep OR will surface the D-03 missing-file error visibly (per rewrite copy) — which is the intended failure mode, not silent breakage.

## Deviations from Plan

### Rule 3 - Blocking issue: prohibited-content grep gate vs. plan's "reference only" allowance

**Found during:** Task 1 grep gate verification (first pass)

**Issue:** The plan's Task 1 action block says the retirement paragraph "MUST name at least two of the three failure modes" and permits referencing the retired recipe as "the old python3 -m http.server recipe" — but the mechanical acceptance-criteria grep gate explicitly requires `grep -c "python3 -m http.server" substrate/skills/id/SKILL.md` to return **0** (i.e. the phrase must not appear anywhere in the file).

**Resolution:** The mechanical gate wins (RESEARCH Pitfall 5 is enforced by grep, not by prose interpretation — the gate exists precisely to catch this class of muscle-memory drift). I renamed the reference in the retirement paragraph to "the old tailnet HTTP-server recipe" — no less descriptive, and passes the mechanical check. All three failure modes (Chrome insecure-download, tailnet-only reach, agent-side server lifecycle) are still named. The prohibited grep gates all read 0 in the final file.

**Files modified:** `substrate/skills/id/SKILL.md` (single-line rewording within the same section)

**No other deviations from the plan.**

## Known Stubs

None. The rewrite ships a complete, coherent single-path recipe. No TODO / FIXME / placeholder text was added; no "coming soon" affordances were referenced that don't already exist (URL scheme is backed by shipped Plans 01/02, parent-Skynet config is backed by shipped Plan 03).

## Threat Flags

None. The rewrite is a documentation-only change to a substrate file that the distributor already ships on every sweep. No new network endpoints, no new auth paths, no new file access patterns, no schema changes. The threat register in the plan (§ Threat Model) is fully mitigated by the acceptance-criteria grep gates + wave ordering (both enforced above).

## Self-Check: PASSED

- `[ -f substrate/skills/id/SKILL.md ]` → FOUND (the modified file exists; edit landed as verified by grep gate `grep -c "^## Sending files to the user$" ... = 1`)
- All 12 mechanical acceptance-criteria grep gates return the expected values (see table above)
- Commit hash recorded in the final commit block (populated by the atomic commit that carries this SUMMARY.md)
