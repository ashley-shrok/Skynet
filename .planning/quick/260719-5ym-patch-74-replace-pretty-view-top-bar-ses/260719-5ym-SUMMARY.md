---
phase: 260719-5ym-patch-74-overlay
plan: 01
subsystem: pretty-view
tags:
  - pretty-view
  - overlay
  - session-recycle
  - glass
  - patch-74
requires: []
provides:
  - SessionHoldingOverlay
affects:
  - PrettyView
tech-stack:
  added: []
  patterns:
    - tw-animate-css animate-in fade-in duration-150 (existing project import)
    - Tailwind v4 arbitrary-value classes (bg-black/40, z-[110], [-webkit-backdrop-filter:...])
    - lucide-react static glyph (RefreshCcw)
    - React setTimeout-in-useEffect delay-armed gate pattern
key-files:
  created:
    - src/ui/features/pretty-view/SessionHoldingOverlay.tsx
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx
  deleted:
    - src/ui/features/pretty-view/SessionHoldingBanner.tsx
decisions:
  - Static RefreshCcw glyph (no animate-spin) — motion channel owned by WipBubble per patch #72 guardrail
  - 350ms delay-armed gate — filters instant recycles so no overlay flash
  - Overlay z-[110] — above IdentityBadge (z-[101]) but below app-modal dialogs (z-[500])
  - Delete SessionHoldingBanner.tsx outright rather than "keep for reference" — rebase-safety
  - Copy "Session recycling…" (drop "reconnecting") — scrim shape already communicates unavailability
metrics:
  duration: 201s
  completed: 2026-07-19T04:26:04Z
  tasks: 1
  files_changed: 3
  build: pass (8.37s)
  commits:
    - 72c4bd4
---

# Quick 260719-5ym: Patch #74 — Session-holding overlay Summary

One-liner: Replaced pretty-view's sticky top-bar `SessionHoldingBanner` with a full-surface, backdrop-blur scrim + centered glass-card `SessionHoldingOverlay`, delay-gated at 350ms so instant recycles don't flash.

## What Landed

Patch #74 swaps the previous "session recycling — reconnecting…" sticky pill (mounted at the top of the pretty-view scroll region) for a full-surface blocking overlay that reads as SERIOUS (the surface is temporarily unavailable) rather than DECORATIVE.

Ashley's live 2026-07-19 design read: the old top-bar treatment was "too subtle for how significant the state actually is." A session recycle means pretty-view is genuinely unusable for the next few seconds, and the UI should communicate that with a scrim + centered card, not a thin pill at the top edge that can be missed.

### Files

**Created — `src/ui/features/pretty-view/SessionHoldingOverlay.tsx`** (new component):
- Outer div = full-surface scrim: `absolute inset-0 z-[110] flex items-center justify-center backdrop-blur-md bg-black/40 pointer-events-auto animate-in fade-in duration-150 [-webkit-backdrop-filter:blur(12px)]` with `role="status"` and `aria-label="Session recycling — pretty view temporarily unavailable"`.
- Inner div = centered glass card mirroring `PlanPendingBubble` aesthetic (rounded-[var(--radius-pv-bubble)], backdrop-blur-xl saturate-150, linear-gradient bg, border, shadow) with slightly more prominent padding (px-4 py-3 vs. px-3 py-2, gap-3 vs. gap-2) since it's the sole focal element.
- Content: static `RefreshCcw` glyph (`h-4 w-4 shrink-0`, `aria-hidden="true"`) + `<span>Session recycling…</span>`.
- Top-of-file comment explains: what this is (patch #74 replacement), why the shape (Ashley's 2026-07-19 read), motion-channel guardrail (static glyph, no spinner — WipBubble owns motion per patch #72), and parent-owned visibility gating.

**Modified — `src/ui/features/pretty-view/PrettyView.tsx`**:
- Import swap: `SessionHoldingBanner` → `SessionHoldingOverlay` (line 17).
- Added `const [showOverlay, setShowOverlay] = useState(false);` right after `isHolding`, with a comment explaining why it's held separately from `isHolding` (delay-arm).
- Added `setShowOverlay(false)` to the `(hostId, tmuxSession)` reset useEffect so pane-swaps drop the overlay.
- Added a new `useEffect([isHolding])` right after the WS-open effect: arms a `setTimeout(() => setShowOverlay(true), 350)` on `isHolding=true`; on `isHolding=false` clears the timer AND immediately drops `showOverlay=false`; cleanup clears the timer. Comment explains why 350ms filters instant recycles.
- Removed the entire old sticky-banner JSX block (formerly lines ~417-455) including its lengthy FRAGILITY WARNING (W4) comment — the whole thing is mooted because the new overlay is absolute-positioned inside the already-relative `data-pv-root`, not sticky inside the scroll container.
- Added new overlay mount `{showOverlay && <SessionHoldingOverlay />}` as a sibling of `IdentityBadge` at the root level, with a comment covering positioning, z-band choice, and the patch-#74 rationale.
- Rewrote the root-div HARD LOCK comment (the "Do NOT add backdropFilter/filter/transform/willChange/perspective" block): the second paragraph now explains the new rationale (stacking-context contamination for IdentityBadge + trapping future sticky/fixed descendants) rather than the sticky-banner containing-block rationale (which the retired banner was the only reason for).

**Deleted — `src/ui/features/pretty-view/SessionHoldingBanner.tsx`** (via `git rm`):
- Deleted outright, not "neutralized" — a future rebase will not reintroduce a stale import path. Any future patch wanting a banner-shape indicator will grep and find `SessionHoldingOverlay` instead. Aligns with threat mitigation T-260719-5ym-04 in the plan.

## Verification

**Automated (all pass):**
```
grep -c 'SessionHoldingOverlay' src/ui/features/pretty-view/PrettyView.tsx     → 6
grep -q 'SessionHoldingBanner' src/ui/features/pretty-view/PrettyView.tsx      → (no match, exit 1) — OK
test -f src/ui/features/pretty-view/SessionHoldingOverlay.tsx                  → OK
grep -q 'backdrop-blur-md'   src/ui/features/pretty-view/SessionHoldingOverlay.tsx → OK
grep -q 'pointer-events-auto' src/ui/features/pretty-view/SessionHoldingOverlay.tsx → OK
grep -q 'animate-in fade-in' src/ui/features/pretty-view/SessionHoldingOverlay.tsx → OK
grep -q 'bg-black/40'        src/ui/features/pretty-view/SessionHoldingOverlay.tsx → OK
grep -q 'setTimeout'         src/ui/features/pretty-view/PrettyView.tsx            → OK
grep -q '350'                src/ui/features/pretty-view/PrettyView.tsx            → OK
SessionHoldingBanner.tsx deletion staged (git status: D)                       → OK
```

**Build:** `npm run build` completes cleanly in 8.37s. No TypeScript or Vite errors. Chunk-size warnings are pre-existing (codemirror + file-preview-vendor + graph-vendor + AppShell) and unrelated to this patch.

**Scope check:** `git diff --name-only HEAD~1 HEAD` shows only three files, all under `src/ui/features/pretty-view/`:
- src/ui/features/pretty-view/PrettyView.tsx (modified)
- src/ui/features/pretty-view/SessionHoldingBanner.tsx (deleted)
- src/ui/features/pretty-view/SessionHoldingOverlay.tsx (created)

Terminal.tsx, backend, docker, nginx, deps: UNTOUCHED. No package.json changes; no new npm dependencies.

**Human-check items** (deferred to Ashley/tina eyeballs in local dev — NOT deploy-verify):
1. Overlay appears centered over pretty-view surface, blurs+dims content, blocks clicks.
2. No flash on instantly-cleared recycles (delay-gate works).
3. Old sticky top banner definitely gone.

## Deviations from Plan

None. The plan was executed exactly as written. One micro-adjustment worth flagging:

- The root-div HARD LOCK comment mentions "SessionHoldingBanner" in one previous version of the rewrite — I noticed this would trip the plan's `! grep -q 'SessionHoldingBanner' src/ui/features/pretty-view/PrettyView.tsx` automated verify. Rewrote the new overlay mount's comment to say "the previous sticky top-of-scroll banner (retired in patch #74)" instead of "(SessionHoldingBanner)". Same information, satisfies the grep. This is inside the plan's spirit — the plan intended "no code references remain," and a comment naming the retired file would be misleading now that the file is gone.

## Threat Flags

None. No new network endpoints, no new auth paths, no new file access, no schema changes. This is a pure UI-component swap inside `src/ui/features/pretty-view/`.

## Known Stubs

None. The overlay is fully wired end-to-end (WS `session_holding` → `isHolding` state → 350ms timer → `showOverlay` → mounted overlay → clears on `session_changed` / `inactive`).

## Commit

- `72c4bd4` — `feat(pretty-view): centered blocking session-holding overlay (patch #74)` — 3 files changed, 144 insertions, 101 deletions.

Branch: `worktree-agent-a3d07f3c50e0625f4` (will land on `feat/tab-title-from-tmux` when the orchestrator merges the worktree back).

## NOT DEPLOYED

Explicit reminder: this is code-landing only. `docker compose up -d --force-recreate skynet` requires a separate per-deploy green-light from Ashley (blanket pre-authorization ≠ per-deploy green-light per tina.md and CLAUDE.md's DEPLOY DISCIPLINE constraint). The 15-min deadman rollback (`/opt/skynet/.tmp-revert.sh`) is not started; production is unchanged.

## Self-Check

Files verified to exist:
- FOUND: src/ui/features/pretty-view/SessionHoldingOverlay.tsx
- FOUND: src/ui/features/pretty-view/PrettyView.tsx (contains `SessionHoldingOverlay` import + `showOverlay` state + `setTimeout(...350)` + JSX mount)
- CONFIRMED DELETED: src/ui/features/pretty-view/SessionHoldingBanner.tsx (git status shows D; git log confirms deletion)

Commit verified:
- FOUND: 72c4bd4 `feat(pretty-view): centered blocking session-holding overlay (patch #74)`

## Self-Check: PASSED
