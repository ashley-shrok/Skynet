---
phase: 111-frontend-stale-prevention-version-drift-hard-lock
plan: 02
subsystem: ui
tags: [skew-lock, modal, react, use-sync-external-store, session-storage, hard-lock]

# Dependency graph
requires: []  # Wave 0 — parallel with Plan 01
provides:
  - "lockSkewedSession({reason, clientBuild, serverBuild}) shell-level trigger at src/ui/state/skew-lock-store.ts (idempotent, first-drift-wins)"
  - "getSkewLockedSnapshot() + subscribeSkewLock(fn) subscribable-store API for useSyncExternalStore consumers"
  - "<SkewLockModal /> mounted at App root (src/main.tsx:244) — non-dismissible shell-level modal reacts to any lock event"
  - "recordReloadAttempt() + shouldSuppressReload() reload-loop sentinel at src/ui/features/skew-lock/reload-loop-sentinel.ts (Pitfall 4 defense)"
  - "inert attribute on #root while locked — freezes underlying UI from pointer/keyboard events per D-12"
affects:
  - "132-04-PLAN — axios response interceptor imports lockSkewedSession on drift detection"
  - "132-05-PLAN — server middleware needs no dependency on this plan (backend-only)"
  - "132-06-PLAN — 4 WS clients (claude-session, fleet-status, relay, terminal) + guacamole client import lockSkewedSession on close code 4409 / message-tag mismatch"

# Tech tracking
tech-stack:
  added: []  # ZERO new packages; react/vitest/testing-library already in tree
  patterns:
    - "Roll-your-own module-scope subscribable store with useSyncExternalStore consumer (matches the six existing stores in src/ui/state/)"
    - "Idempotent first-drift-wins state transition (state.locked short-circuits repeat calls; diagnostic fields preserve first-lane's values)"
    - "Reference-stable snapshot object across reads (useSyncExternalStore identity contract) — module-scope const swap-only-on-mutation"
    - "sessionStorage-backed rolling-window counter with fail-open exception handling (Pitfall 4 shape)"
    - "Non-dismissible shell modal via role='dialog' aria-modal + inert on #root (React 19 native pattern; no radix dependency to avoid escape/click-outside dismissal)"
    - "Direct var(--color-pv-*) tokens (NOT hsl(var(...))) per Skynet's raw-hex/rgba token shape"

key-files:
  created:
    - "src/ui/state/skew-lock-store.ts"
    - "src/ui/state/skew-lock-store.test.ts"
    - "src/ui/features/skew-lock/SkewLockModal.tsx"
    - "src/ui/features/skew-lock/SkewLockModal.test.tsx"
    - "src/ui/features/skew-lock/reload-loop-sentinel.ts"
    - "src/ui/features/skew-lock/reload-loop-sentinel.test.ts"
  modified:
    - "src/main.tsx"  # +2 lines: import + JSX mount

key-decisions:
  - "Palette: use existing --color-pv-* tokens (base, base-end, fg, fg-muted, border-quiet-strong, shadow-pv-root) with direct var() syntax. Plan's action block prescribed non-existent tokens (--color-pv-backdrop/-bg-elevated/-accent/-fg-on-accent) with hsl(var(...)) wrapper — Skynet's tokens are raw hex/rgba values (see src/ui/index.css:143-159), not HSL triplets, so hsl(var(--color-pv-fg)) would produce invalid CSS. Existing tokens satisfy the palette-authority rule and the plan's grep-based acceptance criteria (--color-pv- count > 3, --background/--foreground count == 0)."
  - "Backdrop rgba() literal instead of a --color-pv-backdrop token: the intended token doesn't exist, and inventing one would balloon scope into src/ui/index.css. Used rgba(10, 11, 18, 0.92) which is --color-pv-base-end at 0.92 alpha — a visually equivalent, contained choice."
  - "Reload button colors: inverted --color-pv-fg (warm off-white) on --color-pv-base (dark) rather than an --color-pv-accent token that doesn't exist. Provides high-contrast affordance without introducing new tokens."
  - "sessionStorage encoding as raw JSON array of numbers (not the plan's {timestamps: number[]} object shape). The plan's Test 5 documents 'JSON-encoded array of timestamps' as the read/written shape, and the plan's action block also uses {timestamps: number[]} — the two conflict. Chose the flat-array shape because the test-suite documents that shape as behavior. Test 5 accepts either encoding to future-proof against maintenance."
  - "Test-file suffix: skew-lock-store.test.ts imports './skew-lock-store.js' (matches every existing store test's .js suffix pattern for TSC-emitted-module resolution)."

requirements-completed:
  - "SKEW-03"
  - "SKEW-11"
  - "SKEW-12"

# Metrics
duration: 11min
completed: 2026-09-21
---

# Phase 132 Plan 02: Skew-Lock Store + SkewLockModal + Reload-Loop Sentinel Summary

**Shell-level hard-lock mechanism assembled entirely on the client side — a subscribable store, a non-dismissible modal wired via useSyncExternalStore, and a sessionStorage-backed reload-loop sentinel — with zero networking dependencies, ready for Wave 1's interceptor/WS lanes to import and fire.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-09-21T04:07:00Z
- **Completed:** 2026-09-21T04:18:00Z
- **Tasks:** 3
- **Files created:** 6 (store + test, sentinel + test, modal + test)
- **Files modified:** 1 (src/main.tsx — 2-line addition)

## Accomplishments

- **Skew-lock store** (`src/ui/state/skew-lock-store.ts`): module-scope subscribable state exposing `lockSkewedSession`, `getSkewLockedSnapshot`, `subscribeSkewLock`, and `__resetForTest`. First-drift-wins idempotency guarantees that a burst of concurrent detections from multiple lanes (axios interceptor, WS handshake, WS message) doesn't overwrite the diagnostic `reason`/`clientBuild`/`serverBuild` fields or fire redundant notifies. Snapshot reference stability preserved for useSyncExternalStore identity contract. Structured console.warn on transition uses explicit-field extraction per the role-file directive.
- **Reload-loop sentinel** (`src/ui/features/skew-lock/reload-loop-sentinel.ts`): sessionStorage-backed sliding-window counter defending against Pitfall 4. Trip point is `count > 3` within 60 seconds (i.e. the 4th attempt activates). Fail-open on any sessionStorage exception (quota, disabled, parse error) — no compounded failure mode. Per-tab isolation via sessionStorage matches D-17 (independent tabs).
- **SkewLockModal** (`src/ui/features/skew-lock/SkewLockModal.tsx`): non-dismissible full-viewport modal that subscribes to the store via `useSyncExternalStore` and paints above every app surface with `z-[9999]`. `inert` attribute on `#root` freezes underlying UI to pointer + keyboard events (D-12 mechanism). Fatal-mode variant replaces the Reload button with a contact-support message when the sentinel trips. Belt-and-suspenders race guard in `handleReload` re-checks `shouldSuppressReload()` after recording (edge case for the exact 4th attempt).
- **App-root mount** (`src/main.tsx`): imported and rendered as a sibling of `<Toaster>`. Positioned above both `showApp` and `showAuth` branches so a stale-client user on the login page still sees the modal (RESEARCH.md §Q7 rationale).

## Task Commits

Each task was committed atomically with RED-GREEN authored together in the same commit (task-level unit, per Plan 01 precedent for this phase):

1. **Task 1: Skew-lock store + test** — `8316a60e` (`feat(132-02)`)
   - `src/ui/state/skew-lock-store.ts` (145 lines) + `.test.ts` (176 lines, 6 vitest cases)
2. **Task 2: Reload-loop sentinel + test** — `61e6d8fa` (`feat(132-02)`)
   - `src/ui/features/skew-lock/reload-loop-sentinel.ts` (88 lines) + `.test.ts` (160 lines, 6 vitest cases)
3. **Task 3: SkewLockModal + test + App-root mount** — `5fddede5` (`feat(132-02)`)
   - `src/ui/features/skew-lock/SkewLockModal.tsx` (132 lines) + `.test.tsx` (211 lines, 6 vitest cases) + `src/main.tsx` 2-line addition

## Files Created/Modified

**Created:**

- `src/ui/state/skew-lock-store.ts` — module-scope LockState + `lockSkewedSession` (idempotent) + `getSkewLockedSnapshot` (reference-stable) + `subscribeSkewLock(fn): dispose` + `__resetForTest` (guarded on NODE_ENV="test"). Exports the `LockReason` union type for downstream consumers.
- `src/ui/state/skew-lock-store.test.ts` — 6 vitest cases mirroring the plan's `<behavior>` block.
- `src/ui/features/skew-lock/reload-loop-sentinel.ts` — `recordReloadAttempt(): void` + `shouldSuppressReload(): boolean`. Storage key `"skynet_skew_reload_history"`, JSON-encoded number[] array, 60_000 ms window, threshold `>3`.
- `src/ui/features/skew-lock/reload-loop-sentinel.test.ts` — 6 vitest cases with `vi.useFakeTimers` + `vi.setSystemTime` for TTL boundary conditions and `Storage.prototype` spies for the fail-open case.
- `src/ui/features/skew-lock/SkewLockModal.tsx` — named export `SkewLockModal`. Bare-div dialog (no radix — avoids escape-key / click-outside dismissal that would violate D-12). `useSyncExternalStore(subscribeSkewLock, getSkewLockedSnapshot, getSkewLockedSnapshot)` for React-19-native subscription.
- `src/ui/features/skew-lock/SkewLockModal.test.tsx` — 6 vitest cases covering unlocked-null, locked-dialog, Reload-button-accessible-name, click-behavior, fatal-mode, inert-on-#root.

**Modified:**

- `src/main.tsx` — 2 additive lines: `import { SkewLockModal } from "@/features/skew-lock/SkewLockModal";` at the App-root imports block, and `<SkewLockModal />` as a JSX sibling of `<Toaster position="bottom-right" />` at the App return.

## Decisions Made

- **Palette fidelity via existing tokens.** The plan's `<action>` block prescribed `hsl(var(--color-pv-backdrop))`, `hsl(var(--color-pv-bg-elevated))`, `hsl(var(--color-pv-accent))`, `hsl(var(--color-pv-fg-on-accent))`. None of those four tokens exist in `src/ui/index.css` (the pv namespace is `base`, `base-mid`, `base-end`, `surface-quiet(-alt)`, `border-quiet(-strong)`, `fg`, `fg-muted`, `fg-dim`, `code-fg` — see index.css:143-159). Also, Skynet's tokens are stored as raw hex/rgba values, not HSL-triplet channel groups, so wrapping them in `hsl(var(...))` would produce invalid CSS.

  **Resolution:** mapped to existing tokens with direct `var()` (verbatim: `var(--color-pv-base)`, `var(--color-pv-fg)`, `var(--color-pv-fg-muted)`, `var(--color-pv-border-quiet-strong)`, `var(--shadow-pv-root)`). Backdrop opacity uses a literal `rgba(10, 11, 18, 0.92)` (which is `--color-pv-base-end` at α=0.92) rather than inventing a `--color-pv-backdrop` token — smaller blast radius, no CSS-file modifications.

  Satisfies all plan-level grep acceptance criteria (`--color-pv-*` count == 7, `--background`/`--foreground` count == 0, `@radix-ui` count == 0).

- **Reload button contrast.** No `--color-pv-accent` token exists. Used inverted `--color-pv-fg` (warm off-white) on `--color-pv-base` (dark) — a high-contrast affordance consistent with the pretty-view palette without introducing new tokens.

- **sessionStorage encoding.** The plan documents two conflicting shapes: Test 5 says "JSON-encoded array of timestamps" (flat `number[]`), but the action block says `{ timestamps: number[] }`. Chose flat `number[]` because the test-suite is the authoritative behavior contract. The test itself is defensively coded to accept either encoding so downstream maintenance can flip shapes without breaking the test.

- **Test-file `.js` import suffix.** Followed the existing store-test convention (`session-queue-pending-store.test.ts:25` imports from `./session-queue-pending-store.js`). This matches Skynet's TS→JS-emit module resolution shape.

- **inert applied via `document.getElementById("root")`, not JSX.** React 19 supports `inert` as a JSX prop, but the modal is a SIBLING of `#root` (mounted inside the same root but at a different subtree), and the intent is to gate the app-shell tree from receiving events. Setting `inert` on the shell's root ancestor via effect (with cleanup on unmount) accomplishes this without needing to restructure the App return tree.

## Deviations from Plan

**1. [Rule 3 - Blocking] Palette tokens mismatch between plan and CSS**
- **Found during:** Task 3 (Modal component authoring)
- **Issue:** Plan prescribed four `--color-pv-*` tokens that don't exist in `src/ui/index.css` (`backdrop`, `bg-elevated`, `accent`, `fg-on-accent`) AND used `hsl(var(...))` syntax that's incompatible with Skynet's raw-hex/rgba token values.
- **Fix:** Mapped to existing pv tokens with direct `var()` syntax. Used `var(--color-pv-base)`, `var(--color-pv-fg)`, `var(--color-pv-fg-muted)`, `var(--color-pv-border-quiet-strong)`, `var(--shadow-pv-root)`. Backdrop uses inline rgba() at 0.92 alpha (equivalent to `--color-pv-base-end` at that alpha) rather than inventing a new token.
- **Files modified:** `src/ui/features/skew-lock/SkewLockModal.tsx`
- **Commit:** `5fddede5`
- **Verification:** Plan-level grep `grep -c "--color-pv-" src/ui/features/skew-lock/SkewLockModal.tsx` returns `7` (plan wants >3); `grep -c "--background|--foreground"` returns `0`.

**2. [Rule 3 - Blocking] JSON.stringify substring in comments tripped acceptance grep**
- **Found during:** Task 1 (after initial store write)
- **Issue:** Plan's Task 1 acceptance criterion `grep -c "JSON.stringify" src/ui/state/skew-lock-store.ts returns 0` is a strict literal-count. Three doc comments explaining "never `JSON.stringify(event)`" (documenting the anti-pattern) tripped it.
- **Fix:** Rephrased the doc comments to describe the discipline without the literal substring ("no serialization of DOM Event objects", "no DOM Event objects touch the log payload").
- **Files modified:** `src/ui/state/skew-lock-store.ts` (comments only)
- **Commit:** `8316a60e` (rolled into Task 1's atomic commit before it landed)

**3. [Rule 3 - Blocking] Same anti-pattern substring in modal comments**
- **Found during:** Task 3 (after modal write)
- **Issue:** Plan's Task 3 acceptance criterion `grep -c "--background|--foreground"` == 0 tripped by a doc comment explaining what NOT to use.
- **Fix:** Rephrased to "Never the generic shadcn bg/fg tokens per role-file palette-authority rule" — same discipline, no anti-token substring.
- **Files modified:** `src/ui/features/skew-lock/SkewLockModal.tsx` (comments only)
- **Commit:** `5fddede5` (rolled into Task 3's atomic commit before it landed)

None of these deviations changed any behavior or wire contract. They are palette-shape adaptations to the actual codebase and comment-hygiene fixes to satisfy strict literal-grep acceptance rules.

## Threat Register Status

All threats declared in the plan's `<threat_model>` are addressed as planned:

- **T-132-05 (DoS — attacker fires lockSkewedSession from console):** Accepted per plan. Store's idempotency limits blast radius to a single lock; user resolves with Reload. Same-origin script access is a bigger problem this can't remedy.
- **T-132-06 (DoS — infinite reload loop, Pitfall 4):** Mitigated. Reload-loop sentinel activates on the 4th call within 60s; SkewLockModal's fatal-mode variant replaces the Reload button with a contact-support message. Test 5 in SkewLockModal.test.tsx confirms.
- **T-132-07 (Info Disclosure — build IDs in DOM):** Accepted per plan. Modal renders only generic text ("A newer version is available", "Reload to continue.", "Something is wrong", "Please contact support."). Neither `clientBuild` nor `serverBuild` values appear in the rendered DOM.
- **T-132-08 (Tampering — sessionStorage counter):** Accepted per plan. sessionStorage is per-origin-per-tab; only same-origin scripts can tamper.
- **T-132-SC (Supply chain):** Accepted per plan. ZERO new packages installed. All imports (`react`, `@testing-library/react`, `vitest`) already in package.json.

## Verification Results

All plan-level `<verification>` gates green:

- **Task 1 scoped vitest:** 6/6 tests passed (`npx vitest related src/ui/state/skew-lock-store.ts src/ui/state/skew-lock-store.test.ts --run`).
- **Task 2 scoped vitest:** 6/6 tests passed.
- **Task 3 scoped vitest:** 6/6 tests passed.
- **Combined vitest across all Plan 02 files:** 18/18 tests passed across 3 test files.
- `grep -q "<SkewLockModal" src/main.tsx`: **hit**.
- `grep -q "export function lockSkewedSession" src/ui/state/skew-lock-store.ts`: **hit**.
- `grep -q "skynet_skew_reload_history" src/ui/features/skew-lock/reload-loop-sentinel.ts`: **hit**.
- `grep -c "--color-pv-" src/ui/features/skew-lock/SkewLockModal.tsx`: **7** (expected >3).
- `grep -c "--background|--foreground" src/ui/features/skew-lock/SkewLockModal.tsx`: **0** (expected 0).
- `grep -c "JSON.stringify" src/ui/state/skew-lock-store.ts`: **0** (expected 0).
- `grep -c "@radix-ui" src/ui/features/skew-lock/SkewLockModal.tsx`: **0**.
- `npx tsc --noEmit`: **exit 0** (full-tree TS compile clean, including new files and main.tsx modification).

## Deferred to Downstream Plans

- **Consumer wiring.** Nothing in this plan actually calls `lockSkewedSession(...)`. That's intentional; Wave 1's plans (04-06) will wire the axios interceptor and the 5 WS clients to fire the lock on drift detection.
- **Server-side build-id capture.** Plan 03 owns the server middleware and boot log; this plan needs no dependency on it.
- **Anti-analytics: no click-tracker on the modal.** The plan didn't request one; if a future maintenance ticket wants tracking (e.g. "how often does the sentinel trip in prod?"), it can be added by extending the `handleReload` structured log without touching this file's contract.

## Next Plan Readiness

- Plan 03 (server middleware) — no dependency on this plan's outputs (backend-only).
- Plan 04 (axios interceptor + response drift detection) — **ready**. Will `import { lockSkewedSession, type LockReason } from "@/state/skew-lock-store";` and fire on 409 stale_client + response header mismatch.
- Plan 05 (WS servers) — no dependency on this plan (backend-only).
- Plan 06 (WS clients + guacamole client) — **ready**. Will import `lockSkewedSession` from the same module for close-code 4409 detection and per-message tag checks.

## Self-Check: PASSED

Verified after summary write:

- `src/ui/state/skew-lock-store.ts` — FOUND
- `src/ui/state/skew-lock-store.test.ts` — FOUND
- `src/ui/features/skew-lock/reload-loop-sentinel.ts` — FOUND
- `src/ui/features/skew-lock/reload-loop-sentinel.test.ts` — FOUND
- `src/ui/features/skew-lock/SkewLockModal.tsx` — FOUND
- `src/ui/features/skew-lock/SkewLockModal.test.tsx` — FOUND
- `src/main.tsx` — FOUND (modified, +2 lines for SkewLockModal import and mount)
- Commit `8316a60e` (Task 1) — present in git log
- Commit `61e6d8fa` (Task 2) — present in git log
- Commit `5fddede5` (Task 3) — present in git log

---
*Phase: 111-frontend-stale-prevention-version-drift-hard-lock*
*Plan: 02 — Skew-lock store + SkewLockModal + reload-loop sentinel*
*Completed: 2026-09-21*
