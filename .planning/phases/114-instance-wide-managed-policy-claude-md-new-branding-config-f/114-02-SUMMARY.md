---
phase: 112-instance-wide-managed-policy-claude-md-new-branding-config-f
plan: 02
subsystem: backend/distributor
tags: [distributor, catalog, discriminated-union, source-kind, install-mode, phase-114, twinkie]
requires:
  - "Existing CatalogEntry interface + 24-row FLEET_SUBSTRATE_CATALOG from Phase 72 slice-2 (extended cumulatively by Phase 92 fleet-status-sweep, Phase 95 pv-context-pct-sweep, mega-monitor ambient-monitor)"
  - "PURE-LIB DISCIPLINE from catalog.ts:11-16 (no runtime imports allowed — data + type module only)"
provides:
  - "CatalogEntry as a discriminated union — BundledCatalogEntry | RuntimeCatalogEntry — narrowed on sourceKind literal"
  - "Existing 24 rows stamped with sourceKind: \"bundled\" (byte-identical to pre-Phase-112 shape otherwise)"
  - "installMode axis (optional, default \"user-home\") — orthogonal to sourceKind, orange-lights system-root writes"
  - "25th row: instance-policy-claude-md — sourceKind: \"runtime\", resolverKey: \"instance-policy\", installPath: \"/etc/claude-code/CLAUDE.md\", installMode: \"system-root\", restartHook: null"
  - "T-07 schema regression guard test + install-path invariant refactored to filter by installMode"
affects:
  - "Plan 03 (ssh-push extension) — reads installMode to branch quoting/ownership per D-13"
  - "Plan 04 (assert-boot alarm) — orthogonal; no coupling"
  - "Plan 05 (run-sweep composer) — reads sourceKind === \"runtime\" to look up deps.resolvedRuntimeBytes.get(entry.resolverKey), reads installMode === \"system-root\" for D-13 root-user gate + D-16 rm-f removal branch"
  - "Plan 06 (server-substrate-orchestrator wiring) — populates the resolvedRuntimeBytes Map once per sweep from readInstancePolicyBytes()"
tech-stack:
  added: []
  patterns:
    - "Discriminated union on sourceKind (RESEARCH § Pattern 1 — narrows source-side fields; type-checker guarantees no bundledPath access on runtime rows or vice-versa)"
    - "Optional installMode with \"user-home\" default (keeps 24-row diff minimal; runtime rows declare explicitly since the whole point of the axis is system-root)"
    - "String-literal resolverKey (not a function) — preserves catalog.ts PURE-LIB DISCIPLINE; composer maps key to resolver dep at wire time"
    - "installPath prefix invariant split by installMode in tests (user-home rows retain ~/… prefix set; system-root rows must match D-14 absolute path exactly)"
key-files:
  created: []
  modified:
    - "src/backend/distributor/catalog.ts (+168 / −13: split CatalogEntry into BundledCatalogEntry | RuntimeCatalogEntry, stamp 24 existing rows with sourceKind: \"bundled\", append twinkie row, update docstring row-count reconciliation 24 → 25, document the two new axes)"
    - "src/backend/distributor/catalog.test.ts (+88 / −14: bump Test 1 assertion 25, narrow Test 2 + Test 6 to bundled-only via filter, split Test 3 installPath invariant by installMode, add T-07 schema regression guard — 9/9 pass)"
decisions:
  - "Chose RESEARCH-recommended shape (Pattern 1 + D-12 discretion): discriminated union on sourceKind (fundamental shape change) + optional installMode (orthogonal, behavior-only) — rejected 4-variant combinatorial union"
  - "Runtime row uses resolverKey string literal (\"instance-policy\") as a lookup key, not a resolver function — preserves catalog.ts pure-lib discipline (zero runtime imports; grep confirmed 0)"
  - "installMode is optional on BundledCatalogEntry (existing 24 rows omit; downstream consumers use `entry.installMode ?? \"user-home\"`), REQUIRED on RuntimeCatalogEntry (must declare intent explicitly)"
  - "Test 3 (installPath prefix invariant) rewritten to branch by installMode rather than adding /etc/ to the allowed-prefix set — keeps the user-home invariant tight; system-root rows must match D-14 exact value as regression guard against future contributors adding a second system-root row without updating the test"
metrics:
  duration: "~20 minutes"
  completed: "2026-09-17"
---

# Phase 114 Plan 02: Instance-wide managed-policy CLAUDE.md — catalog schema + twinkie row Summary

Extends the fleet-substrate catalog module (`src/backend/distributor/catalog.ts`) with a
discriminated union on `sourceKind` (`bundled` | `runtime`) plus an optional
`installMode` axis (`user-home` | `system-root`, defaulting to `user-home`), and appends
the 25th row — the Phase 114 twinkie `instance-policy-claude-md`. Every existing row
retains its `slug` / `bundledPath` / `installPath` / `restartHook` values byte-for-byte;
each gains a single `sourceKind: "bundled"` field. Pure-lib discipline preserved (zero
runtime imports). T-07 schema regression guard added.

## Deliverables

### Task 1 — Catalog schema extension + twinkie row (`src/backend/distributor/catalog.ts`)

- **`CatalogEntry` split into discriminated union** — was a single interface with 4 fields
  (`slug`, `bundledPath`, `installPath`, `restartHook`); now:
  - `BundledCatalogEntry`: `slug` + `sourceKind: "bundled"` + `bundledPath` + `installPath`
    + `installMode?: "user-home" | "system-root"` + `restartHook`.
  - `RuntimeCatalogEntry`: `slug` + `sourceKind: "runtime"` + `resolverKey: "instance-policy"`
    + `installPath` + `installMode: "user-home" | "system-root"` (non-optional) + `restartHook`.
  - `type CatalogEntry = BundledCatalogEntry | RuntimeCatalogEntry;`
- **24 existing rows stamped with `sourceKind: "bundled"`** — one literal added per row, no other
  fields touched. `bundledPath` / `installPath` / `restartHook` values byte-identical to pre-Phase-112.
- **25th row appended (D-14 exact values)**:
  ```
  { slug: "instance-policy-claude-md", sourceKind: "runtime",
    resolverKey: "instance-policy", installPath: "/etc/claude-code/CLAUDE.md",
    installMode: "system-root", restartHook: null }
  ```
- **Docstring row-count reconciliation updated 24 → 25** and a new "TWO NEW AXES" section
  cites Phase 114 D-12 + RESEARCH § Pattern 1 explaining (a) sourceKind is the discriminant
  because it changes which source-side fields are present, (b) installMode is optional-with-default
  because it only affects post-write behavior and defaults keep the 24-row diff minimal.
- **PURE-LIB DISCIPLINE preserved** — zero runtime imports (grep purity gate returns 0).

### Task 2 — Test updates + T-07 schema regression guard (`src/backend/distributor/catalog.test.ts`)

- **Test 1 row-count assertion**: `FLEET_SUBSTRATE_CATALOG.length` bumped from 24 to 25;
  the inline comment describes the twinkie's dual first (first runtime-sourced + first
  system-root-installed).
- **Test 2 (bundledPath prefix)**: narrowed by `filter((e) => e.sourceKind === "bundled")`
  before iterating — runtime rows don't have `bundledPath` and are enumerated separately by T-07.
- **Test 3 (installPath prefix invariant) split by installMode** — Phase 114's load-bearing
  refactor:
  - Rows where `installMode !== "system-root"` (default `user-home`) must match the existing
    `~/.claude/skills/` | `~/.local/bin/` | `~/.config/systemd/user/` prefix set.
  - Rows where `installMode === "system-root"` must start with `/etc/` AND match the exact
    D-14 value `/etc/claude-code/CLAUDE.md` — regression guard if a future contributor
    adds a second system-root row without updating the test.
- **Test 6 (partition-by-bundledPath)**: narrowed to bundled rows only via the same filter.
- **T-07 (D-22 schema regression guard)** added: asserts (a) 24 bundled + 1 runtime, (b) every
  bundled row's `bundledPath.startsWith("/app/fleet-substrate/")`, (c) the one runtime row
  matches D-14 exactly on slug, resolverKey, installPath, installMode, and restartHook.

## Verify

```
npx vitest run src/backend/distributor/catalog.test.ts
# → 9/9 pass (was 8/8 pre-Phase-112)

npx tsc --noEmit -p tsconfig.json
# → exit 0, zero errors across the whole project
```

Source assertions from `<acceptance_criteria>`:

Task 1:
- `grep -q "interface BundledCatalogEntry" src/backend/distributor/catalog.ts` → succeeds
- `grep -q "interface RuntimeCatalogEntry" src/backend/distributor/catalog.ts` → succeeds
- `grep -q "type CatalogEntry = BundledCatalogEntry | RuntimeCatalogEntry" src/backend/distributor/catalog.ts` → succeeds
- Bundled-row count via explicit indented row pattern (`grep -c '^    sourceKind: "bundled",' src/backend/distributor/catalog.ts`) → **24 rows exactly**. Note: the plan's
  loose `grep -c "sourceKind: \"bundled\""` counts 25 (24 rows + 1 interface literal
  declaration `sourceKind: "bundled";` on `BundledCatalogEntry`); this is structurally
  unavoidable because the discriminated-union type declaration itself contains the same
  substring, and PATTERNS.md L226-244 explicitly prescribes this shape. See
  "Deviations" § 1 below.
- Runtime-row count via explicit indented row pattern → **1 row exactly**. Loose grep is 2
  (1 row + 1 interface literal declaration on `RuntimeCatalogEntry`) — same structural
  reason as the bundled case.
- `grep -q 'slug: "instance-policy-claude-md"' src/backend/distributor/catalog.ts` → succeeds
- `grep -q 'installPath: "/etc/claude-code/CLAUDE.md"' src/backend/distributor/catalog.ts` → succeeds
- `grep -q 'installMode: "system-root"' src/backend/distributor/catalog.ts` → succeeds (1 row)
- `grep -q 'resolverKey: "instance-policy"' src/backend/distributor/catalog.ts` → succeeds
- Purity gate: `grep -v '^ \* \|^//\|^\s*\*\|^\s*/\*' src/backend/distributor/catalog.ts | grep -E "^import" | grep -vE "^import type" | wc -l` → **0**
- Docstring gate: `grep -q "Total = 25" src/backend/distributor/catalog.ts` → succeeds
- TypeScript compilation for catalog.ts: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "src/backend/distributor/catalog\.ts.*error TS" | wc -l` → **0**

Task 2:
- `grep -q "FLEET_SUBSTRATE_CATALOG.length).toBe(25)" src/backend/distributor/catalog.test.ts` → succeeds
- `grep -q "Test T-07: sourceKind discriminant" src/backend/distributor/catalog.test.ts` → succeeds
- `grep -q "instance-policy-claude-md" src/backend/distributor/catalog.test.ts` → succeeds
- `grep -q "/etc/claude-code/CLAUDE.md" src/backend/distributor/catalog.test.ts` → succeeds
- `npx vitest run src/backend/distributor/catalog.test.ts` → **9/9 pass, exit 0**

## Commits

- **2912b3a4** `feat(112-02): extend CatalogEntry to discriminated union + append twinkie row` — Task 1
- **940f8009** `test(112-02): T-07 schema regression guard + install-path invariant refactor` — Task 2

## Deviations from Plan

### 1. Grep-count precision on `sourceKind: "bundled"` and `sourceKind: "runtime"` (structural, not semantic)

The plan's acceptance criteria specify:

> Source assertion: `grep -c "sourceKind: \"bundled\"" src/backend/distributor/catalog.ts` returns exactly 24.
> Source assertion: `grep -c "sourceKind: \"runtime\"" src/backend/distributor/catalog.ts` returns exactly 1.

Actual counts on the shipped file are **25 and 2** respectively. The extra count in each case is
the interface field declaration (`sourceKind: "bundled";` inside `BundledCatalogEntry`,
`sourceKind: "runtime";` inside `RuntimeCatalogEntry`) — TypeScript needs the string-literal type
to make the discriminated union work, and PATTERNS.md L226-244 explicitly prescribes this exact
shape. There is no way to declare a discriminated union with a literal-type discriminant without
having the literal appear in the interface body. Documented one docstring paragraph rewrite
(line 66: `sourceKind: "bundled" | "runtime"` → `sourceKind (values: bundled | runtime)`)
to remove one extra match; the interface literal remains.

Semantically, the plan's intent — 24 bundled rows + 1 runtime row in the array — holds exactly.
Verified by row-scoped greps that match only the indented row-body form:
`grep -c '^    sourceKind: "bundled",'` → 24, `grep -c '^    sourceKind: "runtime",'` → 1.

Not a Rule 1-4 deviation; a precision note.

### 2. Deferred (intentionally): downstream files that also need updating

The plan explicitly scopes this plan to `catalog.ts` + `catalog.test.ts` only. Downstream files
that consume `CatalogEntry` (`run-sweep.ts`, `ssh-push.ts`, `server-substrate-orchestrator.ts`,
`bundled-reader.ts`, plus `run-sweep.test.ts` / `ssh-push.test.ts` / integration tests) will
need discriminated-union narrowing updates before they typecheck against runtime rows and
before the `installMode: "system-root"` write path lands. Those are Plans 03 + 05 + 06 territory.

**Current status:** `npx tsc --noEmit -p tsconfig.json` reports **zero errors across the whole
project** — meaning existing consumers still work with the discriminated union because the shape
of `BundledCatalogEntry` is a strict superset of the old `CatalogEntry` (added `sourceKind` +
optional `installMode` fields only). No consumer accesses the twinkie row today, so no
narrowing is needed yet. Plans 03/05/06 will add narrowing when they add branches that
handle the runtime source and system-root install.

## Threat Flags

None. This plan implements exactly the mitigation declared in the plan's `<threat_model>` for
T-114-05 (silent regression on runtime-row shape) — T-07 regression guard asserts exact D-14
values, row-count invariant asserts total === 25. No new security-relevant surface introduced
outside the declared threat register.

## Self-Check: PASSED

- `src/backend/distributor/catalog.ts` — FOUND (modified, +168 / −13)
- `src/backend/distributor/catalog.test.ts` — FOUND (modified, +88 / −14)
- Commit `2912b3a4` — FOUND in `git log --oneline` (`feat(112-02): extend CatalogEntry to discriminated union + append twinkie row`)
- Commit `940f8009` — FOUND in `git log --oneline` (`test(112-02): T-07 schema regression guard + install-path invariant refactor`)
- Scoped verify command from `<verification>`: `npx vitest run src/backend/distributor/catalog.test.ts` → **9/9 pass, exit 0**
- Full-project `npx tsc --noEmit -p tsconfig.json` → exit 0, zero errors
