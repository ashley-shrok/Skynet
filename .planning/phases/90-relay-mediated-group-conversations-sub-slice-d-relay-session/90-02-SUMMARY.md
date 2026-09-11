---
phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session
plan: 02
subsystem: frontend
tags:
  [
    primitives,
    extraction,
    outbound-bubble,
    compose-shell,
    room-inbound-bubble-fork,
    shared-components,
    slice-d,
    tdd,
    wave-1,
    D-12-fork,
  ]

# Dependency graph
requires:
  - phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session-plan-00
    provides: Wave 0 fleet-status contextPct + agent-reset endpoint (no direct dependency for this plan but lands on top)
  - phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session-plan-01
    provides: Widened FleetSession / RemoteTmuxSession / Tab types with kind + relay fields (no direct dependency but future consumers of these primitives will branch on `tab.sessionKind === "relay-room"`)
  - phase: 17-relay-inbound-bubble
    provides: RelayInboundBubble source of the D-12 fork (COPY-extracted verbatim minus collapse + pointer-detect)
  - phase: 50-optimistic-send-bubble
    provides: ChatMessage.tsx isUser-branch pendingState + failed-bubble treatment (source of OutboundBubble COPY)
  - phase: 80-pending-with-attachments
    provides: ChatMessage.tsx attachments render branch (source of OutboundBubble attachments-with-caption COPY)
provides:
  - OutboundBubble primitive under src/ui/components/ — right-aligned user-turn bubble with pendingState + attachments (D-13)
  - ComposeBoxShell primitive under src/ui/components/ — textarea + Send button shell with upperArea + attachButton slot props (D-04/D-05/D-06)
  - RelayRoomInboundBubble fork under src/ui/features/relay-room-pane/ — expanded-always inbound bubble for the relay-room pane (D-12 fork clarification)
  - Pretty view remains byte-untouched (D-03 upheld across all three artifacts)
affects:
  [
    Phase-90-Plan-05 (RelayMessageList — will import OutboundBubble + RelayRoomInboundBubble),
    Phase-90-Plan-06 (RelayCompose — will import ComposeBoxShell with both slots undefined per D-04/D-05),
    Any future convergence slice that migrates pretty view onto the primitives if drift becomes real,
  ]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "COPY-extraction discipline (D-03): primitive lives alongside original; original stays byte-untouched. Future convergence slice may migrate original onto primitive if drift becomes real."
    - "Fork-over-parameterize (D-12): rather than adding a `mode` axis to the existing RelayInboundBubble, the relay-room variant is a COPY with different UX (expanded-always, no pointer-detect). Docblock warns against naive 'dedupe' refactor attempts."
    - "Slot props for pane-orchestrator variance (D-04/D-05): ComposeBoxShell exposes `upperArea?: ReactNode` + `attachButton?: ReactNode`; different panes fill or leave undefined without needing a discriminator prop."
    - "Controlled textarea + externally-driven clear (Plan 06 need): ComposeBoxShell owns no state; pane orchestrator controls value + clears via onChange('') after onSend so optimistic-send success/failure paths can drive semantics."
    - "TDD RED/GREEN per task: 3 RED test commits + 3 GREEN implementation commits. RED signal is import-resolution failure at vitest transform (existence-of-file is the gate for pure-extraction work)."
    - "Grep gates in acceptance criteria as anti-regression guardrails: every 'must-not-contain' token from the source strip list is a literal grep count == 0 (must adjust doc comments to avoid literal token mentions)."
    - "Static presentational header replaces click-toggle button in the D-12 fork — <div> (not <button>), no onClick, no aria-expand, no toggle glyph."

key-files:
  created:
    - src/ui/components/OutboundBubble.tsx
    - src/ui/components/OutboundBubble.test.tsx
    - src/ui/components/ComposeBoxShell.tsx
    - src/ui/components/ComposeBoxShell.test.tsx
    - src/ui/features/relay-room-pane/RelayRoomInboundBubble.tsx
    - src/ui/features/relay-room-pane/RelayRoomInboundBubble.test.tsx
  modified: []

key-decisions:
  - "OutboundBubble strips ReactMarkdown in addition to the plan-required strip list — the relay-room pane's outbound bubble is plain composed text (not markdown-rich assistant output), and inheriting ReactMarkdown would drag in remarkGfm + preprocessCommandTriplets + splitMarkers + CopyableBlock + EditableFileAffordance dependencies with no benefit. If a future need arises to render user-typed markdown, add it back explicitly."
  - "ComposeBoxShell renders Send as a SIBLING <button> (right of textarea) rather than an inside-textarea absolute-positioned paper-plane SVG. Pretty view's inside-textarea paper-plane is a bespoke visual (patch #130 raw inline SVG verbatim from Alice's DevTools console); the shell's sibling Send is layout-independent and works cleanly regardless of pane orchestration positioning. Preserves the amber VISUAL-08 gradient language."
  - "ComposeBoxShell uses a controlled textarea (value + onChange) rather than internal state. Chosen over internal-state-with-onSend-only because Plan 06 needs to programmatically clear on optimistic-send success/failure paths from outside — the pane owns state, the shell is presentational."
  - "RelayRoomInboundBubble imports resolveMxidToIdentity + useIdentities from the pretty-view sibling (rather than copying the resolver inline). Justified: the resolver is a pure helper with no runtime state, no component coupling — importing across the pretty-view boundary is safe. If a future D-03 hardening pass requires zero cross-boundary imports, the resolver moves to a shared location and both files import from there."
  - "Distinct data-testid values (`relay-room-inbound-*`) on the fork to avoid cross-file test collisions with the original's `relay-inbound-*` testids. Enables the two files to be tested independently without querySelector namespace clashes."
  - "Docblock at the top of RelayRoomInboundBubble.tsx explicitly quotes Alice's D-12 fork rationale (2026-09-08 verbatim) so future maintainers understand why there are two nearly-identical files (guards against naive 'let's dedupe' refactor attempts)."
  - "Docblock/comment tokens avoid literal mentions of the stripped API surface (useState, useEffect, aria-expanded, detectFilePointer, FetchState, fetchState, via recv.sh) because the plan's grep gates are literal `grep -c` counts. Alternative would be to use --include='*.ts,*.tsx' with a regex that skips comments, but preserving the literal-count gate is the simpler contract."

patterns-established:
  - "COPY-extraction template for future convergence-optional primitives: (1) create primitive file alongside original, (2) copy load-bearing visuals verbatim, (3) drop consumer-specific machinery, (4) tests + grep gates enforce zero pretty-view diff + zero forbidden-token count, (5) docblock notes the source location + rationale + future convergence path."
  - "TDD RED signal for pure-extraction work: the failing test file that imports a not-yet-existing implementation module produces a vitest transform-time error at import resolution. Commit as `test(...)` RED, then create implementation + commit as `feat(...)` GREEN. tsc-strict is a secondary gate; the vitest import-resolution failure is the enforceable RED."
  - "Fork-clarification pattern for UX-divergent primitives: when a shared primitive gets two consumers with genuinely different UX (D-12 collapsed vs expanded-always), the fork is a COPY with a rationale docblock rather than a parameterized `mode` axis. Prevents the harness pane's surface area from growing to accommodate the second consumer's shape."
  - "Slot-prop pattern for pane-orchestrator variance: when the same shell component has to work for two panes with different chrome, expose `ReactNode` slot props for the divergent regions (upperArea, attachButton) rather than a discriminator prop that switches internal rendering. Pane orchestration fills or leaves undefined without the shell needing to know its mode."
  - "Comment-token hygiene for grep-gated files: when acceptance criteria enforce `grep -c <token> == 0`, docstring mentions of that token count too. Use paraphrase (e.g. 'expand-state ARIA attributes' vs 'aria-expanded') and reference the plan doc for the exhaustive strip list."

requirements-completed:
  [
    D-02,
    D-02b,
    D-02c,
    D-03,
    D-04,
    D-05,
    D-06,
    D-12,
    D-12-fork-clarification,
    D-13,
  ]

# Metrics
duration: 25 min
completed: 2026-09-08
---

# Phase 90 Plan 02: Extract shared primitives (OutboundBubble + ComposeBoxShell) + fork RelayRoomInboundBubble (D-12 Summary)

**Three primitives land under `src/ui/components/` (OutboundBubble + ComposeBoxShell) and `src/ui/features/relay-room-pane/` (RelayRoomInboundBubble fork) with the source visuals preserved verbatim, extraction-only strip disciplines applied, and grep gates enforcing zero pretty-view diff — Plans 05 + 06 can now import all three without further extraction work.**

## Performance

- **Duration:** ~25 minutes (Task 1 RED committed 20:33:04, Task 3 GREEN committed 20:41:47)
- **Started:** 2026-09-08T20:29:00Z (plan-loaded)
- **Completed:** 2026-09-08T20:42:00Z (final task committed)
- **Tasks:** 3 of 3 executed
- **Files created:** 6 (3 impl + 3 test — all frontend, all under `src/ui/`)
- **Files modified:** 0 (pretty view + originals all byte-untouched per D-03)

## Accomplishments

- **OutboundBubble primitive lands under `src/ui/components/`.** Standalone COPY of ChatMessage.tsx's user-branch (L420-594) preserving the verbatim gradient (`bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))]`), text color `#dfe3ee`, border, and multi-layer shadow. Props: `content`, `ts?`, `pendingState?: "sending" | "failed" | null` (Phase 50 D-01/D-06/D-19 — failed supersedes sending), `attachments?` (Phase 80 D-15 caption-above-strip render). Stripped: role discriminator, TTS/speak machinery, `onLongPressSpeak`/`onOpenEditor`/`autoplayArmed`, `injected` (parseInjectedUserTurn) branch, ReactMarkdown rendering.
- **ComposeBoxShell primitive lands under `src/ui/components/`.** Standalone COPY of ComposeBox.tsx Row 2 (L2683-3113) preserving the textarea styling (`resize-none w-full h-full`, `min-h-8!`, `bg-[rgba(10,12,20,0.5)]!` — `!` load-bearing per patches #82/#81) and Enter-to-send handler (`e.key === "Enter" && !e.shiftKey` → preventDefault + trim + onSend + clear). Slot props per D-04/D-05: `upperArea?: ReactNode` (relay pane passes undefined per D-04), `attachButton?: ReactNode` (relay pane passes undefined per D-05 — attach HIDDEN for v1). Send button rendered as sibling to the right (bare `<button type="button">`, sidesteps shadcn wrapper-specificity trap) with amber VISUAL-08 gradient language.
- **RelayRoomInboundBubble fork lands under `src/ui/features/relay-room-pane/`** (new directory). COPY-extraction of pretty-view/RelayInboundBubble.tsx per D-12 fork clarification (Alice 2026-09-08 verbatim: *"in relay sessions, the collapsed nature of relay bubbles would not be what we want. And there really wouldn't be a collapse feature in the relay sessions because it doesn't make sense."*). Renders EXPANDED by default, has NO collapse/expand toggle, does NOT run pointer-detection. Preserves sender-hue visual encoding + left-alignment + resolved-identity dot + T-17-03-01 security discipline (React text child, never dangerouslySetInnerHTML). Header is a static `<div>` (not `<button>`), no click behavior, no expand-state ARIA, no toggle glyph. No stream-source footer.
- **All three originals byte-untouched (D-03 upheld).** `git diff --stat HEAD~6 HEAD -- src/ui/features/pretty-view/` returns empty. Pretty view's ChatMessage, ComposeBox, and RelayInboundBubble all continue rendering their own private inline versions.
- **26 tests passing across 3 files.** OutboundBubble (7 tests): React text child, right-alignment, sending spinner, failed inline red + data attr, null pending state, attachments-with-caption, no assistant-branch DOM survives. ComposeBoxShell (8 tests): render + typing, Enter-to-send with trim + clear, Shift+Enter falls through, whitespace-only disable, canSend={false} disable, upperArea slot, attachButton slot, placeholder + default, click-to-send. RelayRoomInboundBubble (11 tests): expanded-always render, no aria-expanded, static div header, no fetch/pointer-detect, identity resolution, hue-tinted background, unresolved fallback to hue 210, left-alignment, T-17-03-01, ts hover title, no via-recv.sh footer.
- **Zero tsc errors across all three new files.** `npx tsc --noEmit 2>&1 | grep -E "OutboundBubble|ComposeBoxShell|RelayRoomInboundBubble"` returns nothing.

## Task Commits

Each TDD phase committed atomically (RED then GREEN per task):

1. **Task 1 RED (OutboundBubble tests)** — `ce2a384c` (test)
2. **Task 1 GREEN (OutboundBubble impl)** — `54e0a946` (feat)
3. **Task 2 RED (ComposeBoxShell tests)** — `61771e21` (test)
4. **Task 2 GREEN (ComposeBoxShell impl)** — `d63d9d50` (feat)
5. **Task 3 RED (RelayRoomInboundBubble fork tests)** — `ee62d168` (test)
6. **Task 3 GREEN (RelayRoomInboundBubble fork impl)** — `74dc17f2` (feat)

## Files Created/Modified

**Created (6):**

- `src/ui/components/OutboundBubble.tsx` — Standalone right-aligned user-bubble primitive with pendingState + attachments contract (COPY from ChatMessage.tsx L420-594)
- `src/ui/components/OutboundBubble.test.tsx` — 7 behavior tests (React text child, right-alignment, sending spinner, failed state, null state, attachments-with-caption, no assistant-branch DOM survives)
- `src/ui/components/ComposeBoxShell.tsx` — Textarea + Send button shell with upperArea + attachButton slot props (COPY from ComposeBox.tsx Row 2 L2683-3113)
- `src/ui/components/ComposeBoxShell.test.tsx` — 8 behavior tests (render + typing, Enter-to-send, Shift+Enter, whitespace disable, canSend disable, upperArea slot, attachButton slot, placeholder, click-to-send)
- `src/ui/features/relay-room-pane/RelayRoomInboundBubble.tsx` — Forked expanded-always inbound bubble for the relay-room pane (COPY from pretty-view/RelayInboundBubble.tsx per D-12)
- `src/ui/features/relay-room-pane/RelayRoomInboundBubble.test.tsx` — 11 behavior tests (expanded-always, no aria-expanded, static div header, no fetch, identity resolution, hue-tinted bg, unresolved fallback, left-alignment, T-17-03-01, ts propagation, no footer)

**Modified (0):** No files modified. Pretty view stays byte-untouched (D-03).

## Decisions Made

All 7 key decisions captured in the frontmatter `key-decisions` field. The three most consequential:

1. **OutboundBubble strips ReactMarkdown in addition to the plan-required strip list.** The relay-room pane's outbound bubble is plain composed text (not markdown-rich assistant output), and inheriting ReactMarkdown would drag in remarkGfm + preprocessCommandTriplets + splitMarkers + CopyableBlock + EditableFileAffordance dependencies with no benefit. This is a scope-tighten deviation from a strict verbatim-copy interpretation of the plan; justified because the plan's `<action>` says "strip the assistant path", ReactMarkdown is part of the assistant-path presentation shape for the harness pane, and no test coverage requires markdown rendering. If a future need arises to render user-typed markdown in the relay pane, add it back explicitly.
2. **ComposeBoxShell renders Send as a SIBLING `<button>` (right of textarea), not an inside-textarea absolute-positioned paper-plane SVG.** Pretty view's inside-textarea paper-plane is a bespoke visual (patch #130 raw inline SVG verbatim from Alice's DevTools console). The shell's sibling Send is layout-independent and works cleanly regardless of how the pane orchestrator positions its slots. Preserves the amber VISUAL-08 gradient language. Alternative (inside-textarea absolute-positioned Send matching pretty view exactly) was rejected because it couples the shell to pretty view's `pr-10` right-padding contract that the relay pane may not want.
3. **Distinct testid values on the D-12 fork (`relay-room-inbound-*` vs original's `relay-inbound-*`).** Prevents cross-file test collisions when both files' tests run together — a `document.querySelector("[data-testid='relay-inbound-wrap']")` in the fork's test file would match either file's element ambiguously if they shared testids. Adopting distinct names is the anti-collision fix and also makes future debugging easier (a screenshot with a testid tells you which pane rendered it).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] jsdom SVGAnimatedString className read**

- **Found during:** Task 1 Test 3 (sending spinner assertion)
- **Issue:** My test used `spinner.className` on a `Loader2` (SVG) element, but jsdom returns an `SVGAnimatedString` object (with `baseVal` / `animVal` properties), not a plain string. The `.toContain("animate-spin")` assertion failed.
- **Fix:** Changed to `spinner.getAttribute("class")` which returns a plain string for both HTML and SVG elements.
- **Files modified:** `src/ui/components/OutboundBubble.test.tsx`
- **Verification:** Test 3 now passes.
- **Committed in:** `54e0a946` (Task 1 GREEN commit — fixed test alongside GREEN impl)

**2. [Rule 3 - Blocking] jsdom hsla → rgba style normalization**

- **Found during:** Task 1 Test 4 (failed bubble inline style assertion)
- **Issue:** My test expected the inline style to contain `hsla(0` for the red background, but jsdom normalizes `hsla(0, 60%, 35%, 0.90)` to `rgba(143, 36, 36, 0.9)` when reading the style attribute. Regex `/hsla?\(0/` did not match.
- **Fix:** Updated assertion to match the deterministic rgba shape (`rgba(143, 36, 36, ...)` for the background, `rgba(217, 38, 38, ...)` for the border-color) which is stable across jsdom versions.
- **Files modified:** `src/ui/components/OutboundBubble.test.tsx`
- **Verification:** Test 4 now passes.
- **Committed in:** `54e0a946` (Task 1 GREEN commit)

**3. [Rule 3 - Blocking] Comment-token hygiene for grep gates**

- **Found during:** Task 1 GREEN + Task 3 GREEN acceptance-criteria check
- **Issue:** The plan's acceptance criteria enforce `grep -c <token> == 0` for tokens like `dangerouslySetInnerHTML`, `isUser`, `useState`, `useEffect`, `aria-expanded`, `detectFilePointer`, `FetchState`, `via recv.sh`. My initial docblocks referenced these tokens by name to explain what was stripped, which caused literal grep counts to be > 0.
- **Fix:** Rewrote docblocks to paraphrase (e.g., "expand-state ARIA attributes" instead of `aria-expanded`, "the source's collapse + fetch tokens" instead of naming them individually) and referenced the plan doc for the exhaustive strip list.
- **Files modified:** `src/ui/components/OutboundBubble.tsx`, `src/ui/features/relay-room-pane/RelayRoomInboundBubble.tsx`
- **Verification:** All grep gates pass (see Accomplishments section).
- **Committed in:** `54e0a946` (Task 1 GREEN) + `74dc17f2` (Task 3 GREEN)

---

**Total deviations:** 3 auto-fixed (all Rule 3 blocking — jsdom quirks + grep-gate hygiene).
**Impact on plan:** All three are test/documentation-level adjustments that do not change the primitive's runtime shape. The tests exercise the same behaviors the plan specified; only the assertion syntax changed. The docblocks convey the same information but with paraphrase to satisfy the literal-count gate. Zero scope creep. Zero D-03 violations.

## Threat Flags

None. This plan is pure-frontend primitive extraction + fork with no new network endpoints, no auth paths, no file access patterns, no schema changes at trust boundaries. The three tests exercising T-17-03-01 security discipline (React text child render, never dangerouslySetInnerHTML) preserve the existing security posture verbatim.

## Issues Encountered

- **Pre-existing frontend TypeScript errors** in files under `src/ui/state/conversation-store.test.ts` (~20 `role: missing` instances), `AppShell.persistence.test.tsx`, `identities-api.test.ts`, several other files — all pre-existing (also flagged by Plan 90-01 SUMMARY). Out of scope per the SCOPE BOUNDARY rule (only auto-fix issues DIRECTLY caused by my task's changes). My three new files (`OutboundBubble.tsx`, `ComposeBoxShell.tsx`, `RelayRoomInboundBubble.tsx`) + tests emit ZERO tsc errors.
- **`Loader2` from lucide-react is an SVG element in jsdom**, so its `.className` returns an `SVGAnimatedString` object rather than a plain string. Standard fix: read via `getAttribute("class")`. Documented as Deviation 1.
- **jsdom normalizes CSS `hsla(...)` values to `rgba(...)` in the style attribute.** Test assertions on inline-style color values need to match the rgba shape (or use `data-*` attributes carrying the raw string, which is the pattern the original RelayInboundBubble uses via `data-avatar-color`). Documented as Deviation 2.

## User Setup Required

None. Pure code + test additions. No external service configuration. No env var changes. No infrastructure touches. Pretty view continues to work exactly as before (byte-untouched).

## Next Phase Readiness

- **Plan 90-05 unblocked (RelayMessageList).** Can import `OutboundBubble` from `@/components/OutboundBubble` for the viewing user's own right-aligned bubble render, and `RelayRoomInboundBubble` from `./RelayRoomInboundBubble` for other room members' left-aligned bubbles. Both primitives are ready with the props contracts specified in the plan.
- **Plan 90-06 unblocked (RelayCompose).** Can import `ComposeBoxShell` from `@/components/ComposeBoxShell` and mount with `upperArea={undefined}` + `attachButton={undefined}` per D-04/D-05. Controlled textarea + Enter-to-send + Send-button-click + trim + clear all work out of the box.
- **D-12 fork clarification (Alice 2026-09-08) fully realized.** The relay-room pane's inbound bubble is a standalone COPY with expanded-always semantics; the harness pane's original RelayInboundBubble stays byte-untouched. Future maintainers reading the fork docblock will understand why there are two nearly-identical files.
- **D-01 + D-03 upheld across the plan.** Pretty view is not modified. The D-03 waivers from Plan 90-00 (fleet-status contextPct source-swap + ComposeBox reset rewire) were plan-specific and are not extended to Plan 02. All three primitives are COPIES that pretty view has NOT been migrated onto.

## Self-Check: PASSED

Verified all claims before proceeding to state updates:

- `src/ui/components/OutboundBubble.tsx` exists ✓
- `src/ui/components/OutboundBubble.test.tsx` exists ✓
- `src/ui/components/ComposeBoxShell.tsx` exists ✓
- `src/ui/components/ComposeBoxShell.test.tsx` exists ✓
- `src/ui/features/relay-room-pane/RelayRoomInboundBubble.tsx` exists ✓
- `src/ui/features/relay-room-pane/RelayRoomInboundBubble.test.tsx` exists ✓
- Commit `ce2a384c` exists (Task 1 RED) ✓
- Commit `54e0a946` exists (Task 1 GREEN) ✓
- Commit `61771e21` exists (Task 2 RED) ✓
- Commit `d63d9d50` exists (Task 2 GREEN) ✓
- Commit `ee62d168` exists (Task 3 RED) ✓
- Commit `74dc17f2` exists (Task 3 GREEN) ✓
- All grep gates pass for Task 1 (dangerouslySetInnerHTML=0, gradient=2>=1, data-pv-bubble-failed=3>=1, data-pv-bubble-spinner=2>=1, isUser=0) ✓
- All grep gates pass for Task 2 (upperArea=6>=2, attachButton=9>=2, min-h-8!=3>=1, enter-shift-handler=1>=1, dangerouslySetInnerHTML=0) ✓
- All grep gates pass for Task 3 (export function=1, useState=0, pointer/fetchState/FetchState=0, aria-expanded/setCollapsed=0, fetch(=0, useEffect=0, resolveMxidToIdentity=3>=1, bubbleHue|colorHue=9>=2, justify-start=2>=1, dangerouslySetInnerHTML=0, via recv.sh=0) ✓
- `git diff --stat HEAD~6 HEAD -- src/ui/features/pretty-view/` returns empty (D-03 upheld) ✓
- `npx tsc --noEmit 2>&1 | grep -E "OutboundBubble|ComposeBoxShell|RelayRoomInboundBubble"` returns nothing (zero tsc errors) ✓
- `npx vitest run` for all three test files: 26/26 passing ✓

---
*Phase: 90-relay-mediated-group-conversations-sub-slice-d-relay-session*
*Plan: 02*
*Completed: 2026-09-08*
