---
phase: quick-260910-gqi
plan: 01
status: complete
requirements:
  - QUICK-GQI-01
files_created: []
files_modified:
  - src/ui/lib/tab-url.ts
  - src/ui/lib/tab-url.test.ts
commits:
  - 1c7ab997  # RED: Tests 11b-11g added, all six fail with URIError
  - 0a6df6de  # GREEN: tmux + generic-host branches wrap decodeURIComponent
completed: 2026-09-10
---

# Quick 260910-gqi Summary

## One-liner

Extended Phase 97 code-review Fix 5's URIError guard from the relay branch to the two remaining `parseTabParam` branches (tmux + generic-host: terminal/rdp/vnc/telnet). Malformed percent-encoded fragments (`%ZZ`, stray `%`, `%2`) now return `null` from `parseTabParam` instead of throwing `URIError` and crashing tab restoration. Relay branch is byte-identical — additive only.

## What changed

### `src/ui/lib/tab-url.ts` (+36 / -3)

**tmux branch (lines 136-158)** — wrapped both `decodeURIComponent` calls (host + session slots) in a single `try { ... } catch { ... }`. On URIError:

- Emits `console.info({ operation: "parse_tab_param_tmux_malformed_uri", restLen: rest.length })`
- Returns `null`
- Same `// eslint-disable-next-line no-console` comment as the relay branch
- `!host || !session` empty-string guard preserved AFTER the successful decode
- `idx2 === -1` guard preserved BEFORE the try (not a URI-decoding concern)

**Generic-host branch (lines 165-179)** — wrapped `decodeURIComponent(rest)` in `try { ... } catch { ... }`. On URIError:

- Emits `console.info({ operation: "parse_tab_param_host_malformed_uri", restLen: rest.length, protocol })`
- Returns `null`
- Includes `protocol` in payload (branch covers terminal/rdp/vnc/telnet — useful forensic signal that single-protocol branches don't need)
- `!host` empty-string guard preserved AFTER the successful decode

**Relay branch (lines 114-135)** — untouched. Proven by `git diff HEAD~2 -- src/ui/lib/tab-url.ts | grep -E "^[+-]" | grep -c "parse_tab_param_relay_malformed_uri"` = 0.

### `src/ui/lib/tab-url.test.ts` (+46 / -0)

Six new `it(...)` blocks appended at the end of the existing `describe("tab-url — relay: protocol grammar widening (Phase 97 Plan 05)", ...)` block, before the closing `});`. Mirror Test 11's structure and comment style:

- **Test 11b**: tmux host slot — `parseTabParam("tmux:%ZZ:session")`, `"tmux:%:session"`, `"tmux:%2:session"` all return `null`
- **Test 11c**: tmux session slot — `parseTabParam("tmux:host:%ZZ")`, `"tmux:host:%"`, `"tmux:host:%2"` all return `null`
- **Test 11d**: generic-host branch (terminal) — `parseTabParam("terminal:%ZZ")`, `"terminal:%"`, `"terminal:%2"` all return `null`
- **Test 11e**: generic-host branch (rdp) — `parseTabParam("rdp:%ZZ")` returns `null`
- **Test 11f**: generic-host branch (vnc) — `parseTabParam("vnc:%ZZ")` returns `null`
- **Test 11g**: generic-host branch (telnet) — `parseTabParam("telnet:%ZZ")` returns `null`

No new imports (uses `parseTabParam` already imported at line 118). Tests 1-11 + splitTree suite untouched.

## Commits

| Commit | Type | Message |
|--------|------|---------|
| `1c7ab997` | test | RED — parseTabParam URIError guard for tmux + generic-host branches |
| `0a6df6de` | fix  | GREEN — wrap decodeURIComponent in parseTabParam tmux + generic-host branches |

Both atomic; on `feat/tab-title-from-tmux`. NOT pushed / NOT built / NOT deployed per code-work-doesn't-authorize-ship rule.

## Verification

### Vitest (scoped)

```
npx vitest run src/ui/lib/tab-url.test.ts
Test Files  1 passed (1)
     Tests  22 passed (22)
```

- RED run (post-Task 1, pre-Task 2): 6 failed / 16 passed — URIError thrown from `decodeURIComponent` at lines 139, 140, 144.
- GREEN run (post-Task 2): 22 passed — 6 new + 16 pre-existing, zero regressions.

### TypeScript

```
npx tsc --noEmit  (filtered to tab-url.ts / tab-url.test.ts)
# zero errors on either file
```

The `protocol` variable in the generic-host branch narrows correctly to `"terminal" | "rdp" | "vnc" | "telnet"` inside the `console.info` payload (already narrowed by the `if (protocol === "tmux")` / `if (protocol === "relay")` early returns above).

### ESLint

```
npx eslint src/ui/lib/tab-url.ts src/ui/lib/tab-url.test.ts
✖ 3 problems (0 errors, 3 warnings)
```

Zero errors. Three warnings, all "Unused eslint-disable directive (no problems were reported from 'no-console')":

- Line 122: **pre-existing** on the relay branch (untouched by this quick).
- Lines 150 + 170: mirror the relay branch's style per Task 2's `<behavior>` requirement — the plan mandates the new catch blocks carry the same eslint-disable comment as the relay branch (line 122).

The project doesn't actively enforce `no-console` for these files, so the directive is defensive style-parity — kept for consistency with the relay branch's precedent. This matches the plan's done criterion: "warnings acceptable only if pre-existing on the same lines" (same rule class as the pre-existing line 122 warning).

### Counter verification (from plan)

```
grep -c "parse_tab_param_tmux_malformed_uri"  src/ui/lib/tab-url.ts  → 1  ✓
grep -c "parse_tab_param_host_malformed_uri"  src/ui/lib/tab-url.ts  → 1  ✓
grep -c "parse_tab_param_relay_malformed_uri" src/ui/lib/tab-url.ts  → 1  ✓ (unchanged)
```

### Additive-only proof

```
git diff HEAD~2 -- src/ui/lib/tab-url.ts | grep -E "^[+-]" \
  | grep -c "parse_tab_param_relay_malformed_uri"
→ 0
```

Zero relay-identifier lines added or removed — the relay branch is byte-identical to pre-change state, as constrained.

## Success criteria vs plan

| Criterion | Status |
|-----------|--------|
| Both tmux + generic-host branches return `null` on malformed percent-encoding instead of throwing URIError | met (Tests 11b-11g pass) |
| Each new failure path emits structured `console.info` with distinct operation name + `restLen`; host branch also includes `protocol` | met |
| Regression tests cover both branches and all four generic-host protocols (terminal/rdp/vnc/telnet) | met (Tests 11b + 11c for tmux; 11d + 11e + 11f + 11g for generic-host) |
| Relay branch byte-identical to pre-change state | met (diff-scoped grep = 0) |
| No new TS or ESLint errors introduced | met (0 errors on both) |

## Deviations from plan

None. Plan executed exactly as written. Both RED (Task 1) and GREEN (Task 2) landed as single atomic commits. Task 3 required no changes — TSC clean on both files and ESLint reported zero errors (only style-parity warnings mirroring the pre-existing relay-branch pattern).

## Self-Check: PASSED

- FOUND: `src/ui/lib/tab-url.ts` — 424 lines, contains all three `parse_tab_param_*_malformed_uri` operation names (1/1/1).
- FOUND: `src/ui/lib/tab-url.test.ts` — 287 lines, contains Test 11 (relay, unchanged) + Tests 11b/11c/11d/11e/11f/11g (new).
- FOUND commit `1c7ab997`: `test(quick-260910-gqi-01): RED — parseTabParam URIError guard for tmux + generic-host branches`.
- FOUND commit `0a6df6de`: `fix(quick-260910-gqi-02): GREEN — wrap decodeURIComponent in parseTabParam tmux + generic-host branches`.
- Vitest re-run at self-check time: 22/22 pass.
