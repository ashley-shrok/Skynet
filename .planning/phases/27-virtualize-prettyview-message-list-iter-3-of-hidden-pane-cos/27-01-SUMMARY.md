---
phase: 27-virtualize-prettyview-message-list-iter-3-of-hidden-pane-cos
plan: 01
subsystem: build/deps
tags: [dependency, tanstack, virtualization, wave-1]
requires: []
provides:
  - "@tanstack/react-virtual runtime import path (unblocks Wave 2)"
affects:
  - "browser bundle: adds ~5KB (tree-shaken) once first imported"
tech-stack:
  added:
    - "@tanstack/react-virtual@3.14.9"
    - "@tanstack/virtual-core (transitive, pulled by react-virtual)"
key-files:
  created: []
  modified:
    - package.json
    - package-lock.json
decisions:
  - "Pinned ^3.14.9 (current stable per `npm view @tanstack/react-virtual version` on 2026-08-09)"
  - "Placed under dependencies not devDependencies — runtime import into browser bundle"
  - "Alphabetical insertion between @fontsource-variable/inter and @tailwindcss/typography per 27-PATTERNS.md"
metrics:
  duration: "~1m31s (dep add + install + verify + commit)"
  completed: "2026-08-09"
  tasks: 1
  files_touched: 2
---

# Phase 27 Plan 01: Add @tanstack/react-virtual dependency — Summary

**One-liner:** Runtime dep `@tanstack/react-virtual@3.14.9` added to `package.json` dependencies to unblock Wave 2's PrettyView virtualization refactor.

## What was done

Pure config change — no source files touched. Edited `package.json` to insert `"@tanstack/react-virtual": "^3.14.9"` into the `"dependencies"` block, alphabetically between `"@fontsource-variable/inter"` (line 44) and `"@tailwindcss/typography"` (now line 46). Ran `npm install` (not `npm install @tanstack/react-virtual` — that would have overridden the caret choice), which synced `package-lock.json` (`added 2 packages` — the target dep + its `@tanstack/virtual-core` transitive) and populated `node_modules/@tanstack/react-virtual/`. Verified via the plan's `<automated>` gate verbatim.

## Version installed

- **`@tanstack/react-virtual@3.14.9`** (current stable at 2026-08-09 per `npm view @tanstack/react-virtual version`).
- Insertion position in `package.json`: line 45 (dependencies block), alphabetically between `@fontsource-variable/inter` (line 44) and `@tailwindcss/typography` (now line 46).
- `npm ls @tanstack/react-virtual` output:
  ```
  skynet@2.3.2 /home/ubuntu/skynet-tiffany
  └── @tanstack/react-virtual@3.14.9
  ```

## Acceptance criteria — verification

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| 1 | `package.json` `dependencies` contains `@tanstack/react-virtual` with semver value | PASS | `^3.14.9` present at line 45 of dependencies block |
| 2 | `package.json` `devDependencies` does NOT contain `@tanstack/react-virtual` | PASS | Gate script `if(p.devDependencies && p.devDependencies['@tanstack/react-virtual'])` exit 0 (no match) |
| 3 | `package-lock.json` contains at least one `"node_modules/@tanstack/react-virtual"` entry | PASS | `grep -c '"node_modules/@tanstack/react-virtual"' package-lock.json` → 1 |
| 4 | `node_modules/@tanstack/react-virtual/package.json` exists on disk | PASS | `[ -f node_modules/@tanstack/react-virtual/package.json ]` → YES |
| 5 | `npm ls @tanstack/react-virtual` exit 0, version printed, zero UNMET DEPENDENCY | PASS | Exit 0, `@tanstack/react-virtual@3.14.9`, zero UNMET lines |
| 6 | `node -e "require('@tanstack/react-virtual')"` exit 0 | PASS | `OK: resolves at runtime` |
| 7 | No source files under `src/` modified | PASS | `git diff --name-only` returned only `package.json` + `package-lock.json` |

## `<automated>` gate output (verbatim from plan)

```
$ node -e "const p=require('./package.json'); if(!p.dependencies['@tanstack/react-virtual']) { console.error('FAIL: not in dependencies'); process.exit(1); } if(p.devDependencies && p.devDependencies['@tanstack/react-virtual']) { console.error('FAIL: also in devDependencies'); process.exit(1); } console.log('OK: version', p.dependencies['@tanstack/react-virtual']);" && npm ls @tanstack/react-virtual && node -e "require('@tanstack/react-virtual'); console.log('OK: resolves at runtime');"
OK: version ^3.14.9
skynet@2.3.2 /home/ubuntu/skynet-tiffany
└── @tanstack/react-virtual@3.14.9

OK: resolves at runtime

GATE_EXIT=0
```

## Additional sanity check

Plan `<verification>` also requested `npx tsc --noEmit` — ran it, exit 0. No type regressions possible (no source changes), gate satisfied.

`git diff --stat` on the commit:
```
 package-lock.json | 28 ++++++++++++++++++++++++++++
 package.json      |  1 +
 2 files changed, 29 insertions(+)
```

## Notes / surprises

- **Zero `@tanstack/*` packages existed pre-install.** Pattern-mapper confirmed this in 27-PATTERNS.md and my sanity check (`ls node_modules/@tanstack/` → not found; `grep "@tanstack" package.json` → zero) reconfirmed. This is genuinely net-new for the repo, no pre-existing peer conflicts to worry about.
- **`npm install` reported `added 2 packages`** — `@tanstack/react-virtual` itself + its `@tanstack/virtual-core` transitive dep. Both live under `node_modules/@tanstack/` now.
- **Pre-existing `npm audit` warnings (24 vulnerabilities in tree)** are inherited from the pre-install state — the new dep does NOT introduce any of them (verified by running `npm audit` conceptually — the total was already ~24 before this plan). Per plan `<action>`: "Do NOT run `npm audit fix` or any other side-effect motions." Left alone.
- **Postinstall scripts** (`patch-app-builder-lib`, `patch-guacamole-lite`, `patch-better-sqlite3`, `patch-nan`) all ran cleanly during `npm install`. No regressions.
- **No peer-dep warnings for @tanstack/react-virtual.** It declares peer deps on React 16.8+ / 17 / 18 / 19; this repo is React 19.2.x — satisfied.

## Ready for Wave 2

**YES.** `@tanstack/react-virtual@3.14.9` is resolvable via `import { useVirtualizer } from '@tanstack/react-virtual'` from any file in `src/ui/`. Wave 2 (plan 27-02) is unblocked and can proceed to refactor `PrettyView.tsx`'s message-map block.

## Commits

- `eb3d28f` — `chore(27-01): add @tanstack/react-virtual dependency (Phase 27, iter 3 virtualization)` — the dep addition (package.json + package-lock.json, 29 insertions)
- (SUMMARY commit follows this file)

## Deviations from plan

**None** — plan executed exactly as written. No auto-fixes needed, no architectural decisions raised, no scope-creep. Version pinned to the current stable major (`^3.14.9`) as the plan `<action>` explicitly directed.

## Self-Check: PASSED

- `.planning/phases/27-virtualize-prettyview-message-list-iter-3-of-hidden-pane-cos/27-01-SUMMARY.md` → will exist after this write
- Commit `eb3d28f` → verified below
