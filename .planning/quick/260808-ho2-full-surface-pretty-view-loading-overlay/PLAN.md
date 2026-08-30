---
quick_id: 260808-ho2
slug: full-surface-pretty-view-loading-overlay
date: 2026-08-08
type: execute
bounty: pretty-view-conversation-pick-loading-feedback
autonomous: true

files_modified:
  - src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx        # NEW component
  - src/ui/features/pretty-view/PrettyViewLoadingOverlay.test.tsx   # NEW unit tests (rendering, class-list, scrim invariants)
  - src/ui/features/pretty-view/PrettyView.tsx                      # arm/dismiss state machine + mount site
  - src/ui/features/pretty-view/PrettyView.test.tsx                 # integration tests (arm on cold, no-arm on warm, dismiss on frame, timeout, mutual-exclusion)

preservation_constraints:
  - src/ui/features/pretty-view/SessionHoldingOverlay.tsx           # BYTE-UNTOUCHED
  - src/ui/features/pretty-view/DormancyOverlay.tsx                 # BYTE-UNTOUCHED
  - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx   # untouched
  - src/ui/features/pretty-conversations/PrettyConversationRow.tsx      # untouched
  - src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx  # untouched
  - src/ui/features/pretty-view/ComposeBox.tsx                      # untouched (no new *_active prop; loading window is short + textarea already typeable on fresh mount)
  - WebSocket message types + backend                               # untouched (pure frontend, uses existing frames)

must_haves:
  truths:
    - "Tapping a conversation-list row that swaps pretty-view to a fresh (cold) pane shows a full-surface loading overlay (spinner over scrim) within one paint frame — no perceptible silent window."
    - "The loading overlay covers messages / tasks / shells but does NOT cover ComposeBox (Ashley can pre-draft during the boot window; patch #275 anchor)."
    - "The loading overlay dismisses the moment the first user-visible WS frame arrives (message / image / relay_* / context_pct / harness_tasks / session)."
    - "The loading overlay dismisses automatically after ~10s if no frame arrives (stuck-state fallback; silent dismiss, no error variant per Ashley)."
    - "The loading overlay does NOT render for a warm re-focus (hidden→visible on the same paneKey, e.g. patch #344 hidden-pane pause resume) — the WS re-open is fast and needs no affordance."
    - "The loading overlay does NOT render when the dormant overlay OR session-holding overlay is up (mutual exclusion: Dormancy > Holding > Loading)."
    - "SessionHoldingOverlay.tsx and DormancyOverlay.tsx are byte-untouched. Both continue to work exactly as before."
    - "Full test suite green (`npx vitest run` exit 0, zero failures)."
    - "TypeScript typechecks (`npx tsc --noEmit`) with no new errors."
  artifacts:
    - path: "src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx"
      provides: "Full-surface loading overlay component (spinner over scrim). No props except optional aria-label overrides — sole visibility gate is parent's mount conditional."
      exports: ["PrettyViewLoadingOverlay"]
    - path: "src/ui/features/pretty-view/PrettyViewLoadingOverlay.test.tsx"
      provides: "Unit tests: renders spinner (Loader2 + animate-spin), scrim class-list invariants (pointer-events-auto, bg-black/40, backdrop-blur-md, animate-in, isolate, [transform:translateZ(0)], z-[99]), role=status accessibility."
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "isBooting state + arm/dismiss useEffects + showLoadingOverlay derivation + mount inside chat-region wrapper as sibling of SessionHoldingOverlay/DormancyOverlay."
    - path: "src/ui/features/pretty-view/PrettyView.test.tsx"
      provides: "Integration tests: cold-mount arms, first-frame dismisses, 10s timeout dismisses, mutual-exclusion with dormant + holding, warm-visibility-flip does NOT arm."
  key_links:
    - from: "src/ui/features/pretty-view/PrettyView.tsx (fresh-pane reset block, currently ~lines 636-662)"
      to: "setIsBooting(true) alongside existing setStatus('connecting')"
      via: "same paneKey-change useEffect that already owns the cold-vs-warm gate"
      pattern: "if \\(paneKey !== paneKeyRef.current\\)"
    - from: "src/ui/features/pretty-view/PrettyView.tsx (WS onmessage handler, currently ~lines 689-722)"
      to: "setIsBooting(false) at the same point where the dormant auto-dismiss fires"
      via: "shared first-user-visible-frame set: message / image / relay_inbound / relay_outbound / context_pct / harness_tasks / session"
      pattern: "if \\((?:isBootingRef|dormantRef)\\.current && \\(parsed\\.type === 'message'"
    - from: "src/ui/features/pretty-view/PrettyView.tsx (mount site, currently ~line 1556-1568)"
      to: "<PrettyViewLoadingOverlay /> mounted as third sibling under {chatRegionEl} wrapper, gated by showLoadingOverlay"
      via: "showLoadingOverlay = isBooting && !dormant && !showOverlay"
      pattern: "\\{showLoadingOverlay && <PrettyViewLoadingOverlay"
---

<objective>
Add a full-surface loading overlay to pretty-view that covers the ~5s window between a fresh pane mount (typically triggered by tapping a conversation-list row) and the first user-visible WS frame arriving. Blocks stray taps, provides feedback that the switch registered, and preserves ComposeBox pre-draft.

Purpose: eliminate the silent-window UX bug — Ashley taps a conversation row, the row lights up but pretty-view sits blank for 5s while it mounts + fetches + does its WS handshake, so she re-taps and double-fires. Ashley verbatim ask: "just doing like a full screen overlay with like a spinner to block everything else from being touched and let you know that it's going would be good."

Output:
  - `src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx` — new stateless component (spinner over scrim; sibling to SessionHoldingOverlay/DormancyOverlay).
  - `src/ui/features/pretty-view/PrettyViewLoadingOverlay.test.tsx` — new unit-test file.
  - `src/ui/features/pretty-view/PrettyView.tsx` — arm on fresh-pane reset, dismiss on first live frame, ~10s timeout, mutual exclusion with sibling overlays, mount site adjacent to SessionHoldingOverlay + DormancyOverlay inside the chat-region wrapper.
  - `src/ui/features/pretty-view/PrettyView.test.tsx` — integration tests appended in a new `describe("quick 260808-ho2 loading overlay integration")` block.

Design decisions locked (with justifications; reference the orchestrator prompt's 6 gate items):
  1. **ARM site — PrettyView-local, on the fresh-pane paneKey-change reset block.** Reuses the existing cold-vs-warm gate at lines 636-662 (which already distinguishes `paneKey !== paneKeyRef.current` from a retryKey-triggered re-run). Fresh pane = paneKey changed = cold mount → arm. Retry re-run (same pane, warm WS reopen) = paneKey unchanged = do NOT arm. This is the exact signal the orchestrator prompt asked for — no new `useRef<boolean>` sentinel needed; the existing `paneKeyRef` already carries it. Panel and row code stays untouched.
  2. **DISMISS trigger — first user-visible WS frame at the top of `onmessage`.** Mirrors the DormancyOverlay dismiss pattern (currently lines 700-722): the frame set `{message, image, relay_inbound, relay_outbound, context_pct, harness_tasks, session}` fires `setIsBooting(false)` alongside the existing `setDormant(false)` logic. Uses `isBootingRef` to avoid stale-closure inside the WS onmessage handler (pattern mirrors `dormantRef` and `isVisibleRef` — same rationale documented in comments at lines 544-549). Do NOT dismiss on `ws.onopen` alone — Ashley's complaint is specifically about the pre-first-frame window.
  3. **Minimum hold time — NONE. Arm INSTANTLY.** Contrast with SessionHoldingOverlay's 350ms delay-arm (patch #74): that pattern avoids flashing for genuinely-instant recycles. Here the opposite tradeoff applies — Ashley's complaint is silence during any perceptible latency, so the flash on a fast mount is on the good side. `setIsBooting(true)` happens synchronously inside the paneKey-change reset block, right next to `setStatus("connecting")`.
  4. **Timeout — 10s auto-dismiss, silent.** No error variant per Ashley's ask. Contrast with SessionHoldingOverlay's 300000ms (patch #127 5-min watchdog): that's for a genuinely-long recycle; here loading is expected to be sub-5s and a stuck load past 10s is a bug that the underlying `status === "inactive"` / `status === "error"` state should show through instead of a false-loading scrim. `console.info("[pv-loading-overlay] 10s timeout dismiss")` for future diagnosis (no console-forwarder import needed — plain console call, consistent with other diagnostic logs already in PrettyView).
  5. **Mutual exclusion — Dormancy > Holding > Loading.** Encoded as `showLoadingOverlay = isBooting && !dormant && !showOverlay` (where `showOverlay` is the existing patch #74 SessionHoldingOverlay gate). Dormant wins because loading is meaningless without an alive session. Holding wins because a recycle IS a loading state, just a distinct kind. Loading only renders when neither of the other two is active AND the arm gate is true. No z-index conflict — all three siblings share z-[99] (same as existing pair) and mutual exclusion is enforced at the mount gate, not stacking order.
  6. **Warm re-focus — no arm.** Handled naturally by decision #1: the WS-pause visibility effect (lines 1154-1187) closes/reopens the WS on isVisible flip via `setRetryKey(k => k + 1)`, which triggers the main WS-setup effect with `paneKey === paneKeyRef.current` — the reset block is skipped and `isBooting` stays false. No additional guard needed; the existing architecture already draws the cold-vs-warm boundary at the right place.

Component name: **`PrettyViewLoadingOverlay`** (chosen over the orchestrator's working title `ConversationPickLoadingOverlay`). Justification: the overlay lives in `src/ui/features/pretty-view/`, is mounted by PrettyView, and mirrors the sibling naming convention (SessionHoldingOverlay, DormancyOverlay) — component name should describe what the overlay IS, not the specific user action that most-frequently triggers it (the same overlay can appear whenever a fresh pane mounts, not only from a conversation-row tap).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
Reference material (READ during discovery, do NOT re-read to verify — extract in one pass):

@src/ui/features/pretty-view/SessionHoldingOverlay.tsx
@src/ui/features/pretty-view/DormancyOverlay.tsx
@src/ui/features/pretty-view/DormancyOverlay.test.tsx
@src/ui/features/pretty-view/SessionHoldingOverlay.test.tsx
@src/ui/features/pretty-view/PrettyView.tsx
@src/ui/features/pretty-view/PrettyView.test.tsx

Patch history reference (for design lineage — the executor is not expected to reopen these but the file+line-range hints below are self-contained):
  - patch #74 (SessionHoldingOverlay origin, delay-arm rationale): src/ui/features/pretty-view/PrettyView.tsx lines 302-310, 1223-1243, and the SessionHoldingOverlay.tsx file header lines 1-73.
  - patch #275 (chat-region anchor + ComposeBox typeable rationale): src/ui/features/pretty-view/PrettyView.tsx lines 1523-1568, and the SessionHoldingOverlay.tsx file header lines 55-62.
  - patch #333 (iOS backdrop-filter isolate fix — MANDATORY for any new backdrop-blur surface): src/ui/features/pretty-view/SessionHoldingOverlay.tsx lines 121-133, DormancyOverlay.tsx lines 87-93. The new overlay MUST include `isolate [transform:translateZ(0)]` on the scrim.
  - patch #344 (hidden-pane WS-pause via isVisibleRef; explains why warm re-focus does not trigger paneKey change): src/ui/features/pretty-view/PrettyView.tsx lines 1125-1192.
  - patch #345 (DormancyOverlay first-live-frame dismiss — the dismiss pattern this plan mirrors): src/ui/features/pretty-view/PrettyView.tsx lines 700-722.
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create PrettyViewLoadingOverlay component + unit tests</name>
  <files>
    src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx (NEW)
    src/ui/features/pretty-view/PrettyViewLoadingOverlay.test.tsx (NEW)
  </files>
  <behavior>
    Component behavior:
      - Renders a `role="status"` scrim with `aria-label="Loading conversation…"`.
      - Scrim class list — VERBATIM classes required (mirrors SessionHoldingOverlay + DormancyOverlay for CSS coherence and iOS hardening):
          `absolute inset-0 z-[99] flex items-center justify-center backdrop-blur-md bg-black/40 [-webkit-backdrop-filter:blur(12px)] isolate [transform:translateZ(0)] pointer-events-auto animate-in fade-in duration-150`
      - Centered glass-card child mirroring SessionHoldingOverlay's neutral variant:
          `rounded-[var(--radius-pv-bubble)] px-4 py-3 backdrop-blur-xl saturate-150 [-webkit-backdrop-filter:blur(20px)_saturate(1.6)] bg-[linear-gradient(160deg,rgba(45,55,80,0.5),rgba(28,35,55,0.55))] text-[#dfe3ee] border border-white/[0.08] shadow-[0_8px_24px_rgba(0,0,0,0.5),_0_1px_0_rgba(255,255,255,0.12)_inset,_0_0_0_0.5px_rgba(255,255,255,0.05)] flex items-center gap-3 text-sm`
      - Inside the glass card: `<Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />` + `<span>Loading…</span>`.
      - No props (component has no visibility gate, no variants — parent's mount conditional is the sole visibility control; mirrors SessionHoldingOverlay's default-variant posture).
      - IMPORTANT — MOTION-CHANNEL DEVIATION (document in file header comment):
          SessionHoldingOverlay's file header (lines 38-46) establishes a "static glyph = STATE, spinner = WORK" guardrail — a spinner in SessionHoldingOverlay would steal the WipBubble motion channel. That guardrail was written for the RECYCLE state, where the surface is temporarily unavailable but no active work is happening. For LOADING, the semantic is different: the surface IS actively doing work (mounting, fetching, handshaking) that will produce a first frame — so a spinner is semantically correct here. The file header MUST call out this deviation explicitly so a future reader does not "fix" it into a static glyph. Wording suggestion: "Deviates from the SessionHoldingOverlay / DormancyOverlay static-glyph guardrail (patch #72): the loading state is genuinely WORK-in-progress (surface booting) rather than STATE (temporarily unavailable), so `animate-spin` is correct here. WipBubble owns the motion channel for TASK work; this overlay owns the motion channel for SURFACE work — the two never co-render (loading overlay is only up before any bubbles render)."

    Test behavior (test file: PrettyViewLoadingOverlay.test.tsx). All tests import from `./PrettyViewLoadingOverlay`. Use `render + screen + container.querySelector` (mirror DormancyOverlay.test.tsx style):
      - Test 1: renders `role="status"` element with `aria-label="Loading conversation…"`.
      - Test 2: renders `<Loader2>` SVG (query by class `.animate-spin` on the SVG) — asserts the spinner is present AND is spinning.
      - Test 3: renders the copy `Loading…` inside the glass card.
      - Test 4 (scrim class-list invariants — REGRESSION-GUARD for the iOS hardening + interaction-blocking classes): the `role="status"` element's className string CONTAINS each of: `absolute`, `inset-0`, `z-[99]`, `pointer-events-auto`, `bg-black/40`, `backdrop-blur-md`, `animate-in`, `isolate`, `[transform:translateZ(0)]`. This is the most important test in the file — it locks the iOS backdrop-filter mitigation (patch #333) and the interaction-blocking behavior (Ashley's ask).
      - Test 5 (motion-channel deviation regression-guard): the `<svg>` inside the glass card DOES carry `animate-spin` in its class list. Inverse of the SessionHoldingOverlay/DormancyOverlay static-glyph test — asserts the deviation is intentional and won't be silently "fixed" by a future refactor.
  </behavior>
  <action>
    RED-GREEN-REFACTOR (task-level TDD, per plan `tdd="true"`):
      RED: Create PrettyViewLoadingOverlay.test.tsx first with the 5 tests above. Run `npx vitest run src/ui/features/pretty-view/PrettyViewLoadingOverlay.test.tsx` — expect failure (module does not exist).
      GREEN: Create PrettyViewLoadingOverlay.tsx with the exact class strings + Loader2 spinner as specified in the behavior block. Include the file-header comment documenting the motion-channel deviation and the mount-context expectation ("mounted inside PrettyView's chat-region wrapper as sibling of SessionHoldingOverlay + DormancyOverlay; sole visibility gate is the parent's mount conditional"). Run tests — expect green.
      REFACTOR: Only if a class string is duplicated between file and test in a way that's clearly a maintenance hazard. Prefer keeping the test-side assertion verbose over adding a shared constant — tests are documentation.

    Import Loader2 from `lucide-react` (already used elsewhere: OPKSSHDialog.tsx line 3, NewSessionDialog.tsx line 39). Import `cn` from `@/lib/utils` (matches SessionHoldingOverlay pattern).

    Do NOT copy DormancyOverlay's `flex-col` — the loading card is a single row (spinner + text), no elapsed-hint, no button. Match SessionHoldingOverlay's `flex items-center gap-3 text-sm` (no `flex-col`).
  </action>
  <verify>
    <automated>npx vitest run src/ui/features/pretty-view/PrettyViewLoadingOverlay.test.tsx</automated>
  </verify>
  <done>
    - PrettyViewLoadingOverlay.tsx exists, exports `PrettyViewLoadingOverlay`, uses Loader2 + animate-spin.
    - PrettyViewLoadingOverlay.test.tsx has 5 passing tests covering rendering, copy, scrim class-list invariants (including iOS hardening classes), and motion-channel deviation regression-guard.
    - File header comment explicitly documents the motion-channel deviation from the sibling overlays.
    - No TypeScript errors introduced (spot-check: `npx tsc --noEmit` clean if run — full check happens in Task 3).
  </done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Wire loading overlay into PrettyView (state, arm, dismiss, timeout, mutual exclusion, mount site)</name>
  <files>
    src/ui/features/pretty-view/PrettyView.tsx (MODIFY)
    src/ui/features/pretty-view/PrettyView.test.tsx (APPEND new describe block)
  </files>
  <behavior>
    State additions in PrettyView.tsx (place adjacent to existing `showOverlay` / `dormant` state around lines 298-325 for topical grouping):
      - `const [isBooting, setIsBooting] = useState(false);`
      - `const isBootingRef = useRef<boolean>(false);` (stale-closure protection inside WS onmessage; pattern mirrors `dormantRef` at line 549 and `isVisibleRef` at line 544).

    Mirror-effect for the ref (place adjacent to the `dormantRef` mirror at lines 1102-1107):
      - `useEffect(() => { isBootingRef.current = isBooting; }, [isBooting]);`

    ARM site — inside the fresh-pane paneKey-change reset block (currently lines 636-662, immediately after `setShowOverlay(false)` on line 655 for topical grouping with the other overlay resets):
      - Add `setIsBooting(true);` — the sole ARM path. Comment: "quick 260808-ho2: arm the loading overlay on fresh-pane mount only (paneKey change). Retry re-runs (warm WS reconnect, same paneKey) skip this whole block, so warm re-focus never arms — matches decision #6 in the plan."

    DISMISS trigger — inside the WS onmessage handler at the same site as the existing dormant auto-dismiss (currently lines 700-722). Extend the frame-type guard so it fires for `isBootingRef.current` too. Structural change: promote the existing single `if (dormantRef.current && (parsed.type === ...))` into two separate `if` blocks OR one combined block — either works, but keep the frame-type set VERBATIM identical between the two (so any future frame-type addition is a single grep). Recommended shape (adjacent to the dormant block, NOT nested):

      ```
      // quick 260808-ho2: loading overlay first-live-frame auto-dismiss. Mirrors
      // the DormancyOverlay dismiss pattern (immediately above) using the SAME
      // frame-type set — both overlays consider the SAME frames "user-visible."
      // Uses isBootingRef (not isBooting state) to avoid stale-closure inside
      // the WS onmessage handler; pattern mirrors dormantRef.
      if (
        isBootingRef.current &&
        (parsed.type === "message" ||
          parsed.type === "image" ||
          parsed.type === "relay_inbound" ||
          parsed.type === "relay_outbound" ||
          parsed.type === "context_pct" ||
          parsed.type === "harness_tasks" ||
          parsed.type === "session")
      ) {
        setIsBooting(false);
      }
      ```

    (Rendered here as a fenced block for reference-only — the executor writes it as normal source code inside PrettyView.tsx; no fenced blocks in the actual file.)

    TIMEOUT — new useEffect placed adjacent to the existing overlay-related useEffects (currently lines 1223-1276). Pattern mirrors patch #122's holding_timeout watchdog (lines 1257-1265):

      ```
      // quick 260808-ho2: 10s timeout auto-dismiss for the loading overlay.
      // If no user-visible frame arrives within 10s of arming, the pane is
      // genuinely stuck — the underlying status="inactive" / "error" state
      // should show through instead of a false-loading scrim. Silent dismiss,
      // no error variant (per Ashley's ask — no cancel button, no error card).
      // console.info for future diagnosis. Cleanup clears the timer on unmount
      // OR when isBooting flips back false via any path (first-live-frame
      // dismiss, fresh-pane remount, dormancy takeover — the isBooting deps
      // re-run covers all of them).
      useEffect(() => {
        if (!isBooting) return;
        const t = setTimeout(() => {
          console.info("[pv-loading-overlay] 10s timeout dismiss (no user-visible frame arrived)");
          setIsBooting(false);
        }, 10000);
        return () => { clearTimeout(t); };
      }, [isBooting]);
      ```

    Also — when dormancy takes over WHILE isBooting is true (edge case: fresh-pane mount into an already-dormant pane), we need `isBooting` to clear so the loading overlay does not remain armed under the dormant one. Simpler approach — piggyback on the existing dormant frame handler at line 784-795: add `setIsBooting(false)` inside the `case "dormant":` arm branch (only when `parsed.dormant === true`). Comment: "quick 260808-ho2: dormancy trumps loading — cleanup the arm state if the fresh pane turned out to be dormant."

    Similarly, when session_holding takes over WHILE isBooting is true, clear it. Add `setIsBooting(false)` inside `case "session_holding":` (line 885-892). Comment: "quick 260808-ho2: holding trumps loading — same rationale as dormancy above."

    (These two extra clears are belt-and-suspenders on top of the `showLoadingOverlay` derivation — the derivation is the sole visibility gate, but clearing the underlying arm state prevents the loading overlay from re-appearing the moment dormant/holding clears if no frame has arrived yet. The 10s timeout would eventually cover this too, but explicit clears feel cleaner and don't leave a stale 10s ghost.)

    DERIVATION + MOUNT — at the mount site (currently lines 1556-1568, immediately after `{dormant && <DormancyOverlay ... />}`):

      ```
      {/* quick 260808-ho2: full-surface loading overlay for the ~5s window
          between a fresh pane mount and the first user-visible WS frame.
          Mutual exclusion: Dormancy > Holding > Loading. Loading only renders
          when neither of the other two overlays is up AND the arm gate is
          true. Shares z-[99] with the sibling overlays; mutual exclusion is
          enforced at the mount gate, not stacking order. Mount site is
          adjacent to the sibling overlays inside the chat-region wrapper so
          ComposeBox (peer sibling below the wrapper) stays typeable — Ashley
          can pre-draft during the boot window. */}
      {isBooting && !dormant && !showOverlay && <PrettyViewLoadingOverlay />}
      ```

    (Same fenced-block convention as above — this is reference for the executor; the actual file has normal JSX with no fences.)

    Import statement at top of PrettyView.tsx (place adjacent to existing `SessionHoldingOverlay` / `DormancyOverlay` imports at lines 26-27):
      - `import { PrettyViewLoadingOverlay } from "./PrettyViewLoadingOverlay";`

    Test behavior (append new describe block to PrettyView.test.tsx after the existing dormancy-integration block, using the same helpers — `getCurrentWs`, `fireWsFrame`, `flipToStreaming`, fake timers). Wrap in `describe("quick 260808-ho2 loading overlay integration", () => { ... })`. Use `container.querySelector('[aria-label="Loading conversation…"]')` as the mount-detection selector (unique to this overlay; the sibling overlays use different aria-labels).

    Reuse the ResizeObserver stub pattern from the dormancy describe block (lines 1082-1086). All tests use fake timers (`vi.useFakeTimers()` in beforeEach, `vi.useRealTimers()` in afterEach).

      Test A (arm on cold mount): Render PrettyView with hostId=1, tmuxSession="s1", isVisible=true. Immediately (before any WS frames arrive) assert `container.querySelector('[aria-label="Loading conversation…"]')` is truthy. Rationale: covers must-have truth #1 (fresh pane → loading overlay within one paint).

      Test B (dismiss on first user-visible frame): Render PrettyView. Assert overlay is mounted. Fire `ws.onopen()`. Assert overlay is STILL mounted (onopen alone does not dismiss — per decision #2). Fire a `{type:'session', sessionFile:'/tmp/test.jsonl'}` frame via fireWsFrame. Assert overlay is now UNMOUNTED. Rationale: covers must-have truth #3 (dismiss on first user-visible frame, not on onopen).

      Test C (dismiss on 'message' frame — alternative dismiss path): Render PrettyView. Fire `ws.onopen()`. Fire a `{type:'message', role:'user', content:'hi', eventId:'ev-1', ts:1}` frame. Assert overlay unmounted. Rationale: covers the shared frame-type set (patch #345 mirror).

      Test D (10s timeout dismiss): Render PrettyView. Assert overlay mounted. Advance fake timers by 10001ms. Assert overlay unmounted. Rationale: covers must-have truth #4 (10s stuck-state fallback).

      Test E (mutual exclusion — dormant): Render PrettyView. Assert loading overlay mounted. Fire `{type:'dormant', dormant:true}` frame. Assert loading overlay UNMOUNTED (dormant overlay is now the visible one). Assert dormant overlay IS mounted (query by its aria-label from DormancyOverlay.tsx line 74 pattern: `/session is asleep|waking/i`). Rationale: covers must-have truth #6.

      Test F (mutual exclusion — session_holding): Render PrettyView. Fire `ws.onopen()` then `{type:'session', ...}` (flip to streaming; also dismisses loading via first-frame). Verify loading is dismissed. Then re-arm loading via re-render with a NEW paneKey (change `tmuxSession` prop from "s1" to "s2"). Assert loading mounted again. Now fire `{type:'session_holding'}` and advance 400ms past the 350ms delay-arm. Assert loading UNMOUNTED and SessionHoldingOverlay IS mounted (query by `/session recycling/i`). Rationale: covers must-have truth #6.

        NOTE: this test exercises the paneKey-change re-arm path (part of decision #1 for pane swaps) AND the mutual exclusion. If pane-swap re-arm turns out awkward in test setup, an acceptable simplification is to test session_holding takeover on the initial mount (before any dismissing frame arrives) — same mutual-exclusion assertion, no re-arm required.

      Test G (no arm on warm re-focus): Render PrettyView with isVisible=true. Fire `ws.onopen()` + `{type:'session', ...}` to dismiss the initial arm. Assert loading unmounted. Now flip isVisible=false (re-render with `isVisible={false}`), then back to isVisible=true. This should trigger the WS-pause reopen path (retryKey bump + WS-setup effect re-run with SAME paneKey), NOT a paneKey change. Assert loading overlay stays UNMOUNTED across the visibility flip. Rationale: covers must-have truth #5 (warm re-focus does not arm).

      Test H (SessionHoldingOverlay preservation — regression-guard for the "byte-untouched" invariant): Fire the existing armHolding path (session_holding + 400ms advance). Assert SessionHoldingOverlay's role=status element exists and its aria-label matches `/recycling/i`. This is the same assertion pattern as existing Test F1 (line 909) — copied verbatim to guarantee SessionHoldingOverlay behavior did not regress from the mount-site edit.
  </behavior>
  <action>
    RED-GREEN-REFACTOR (task-level TDD):
      RED: Append the new describe block with all 8 tests (A-H) to PrettyView.test.tsx. Run `npx vitest run src/ui/features/pretty-view/PrettyView.test.tsx -t "260808-ho2"` — expect all failing (PrettyViewLoadingOverlay wired changes not yet applied).
      GREEN: Apply the PrettyView.tsx edits in this order (grouped by topical location — one edit per section, minimize diff):
        1. Add the `PrettyViewLoadingOverlay` import.
        2. Add `isBooting` state + `isBootingRef` alongside the existing overlay state (near lines 298-325).
        3. Add `setIsBooting(true)` inside the fresh-pane paneKey-change reset block (near line 655, after `setShowOverlay(false)`).
        4. Add the dismiss-on-first-live-frame block inside `onmessage` (adjacent to the existing dormant dismiss block, near line 700-722).
        5. Add `setIsBooting(false)` inside `case "dormant":` (near line 784) when parsed.dormant===true.
        6. Add `setIsBooting(false)` inside `case "session_holding":` (near line 885).
        7. Add the `isBootingRef` mirror useEffect (near line 1102-1107).
        8. Add the 10s timeout useEffect (near lines 1223-1276, adjacent to other overlay useEffects).
        9. Add the `<PrettyViewLoadingOverlay />` mount JSX (near line 1568, immediately after `{dormant && <DormancyOverlay ... />}`).
      Run the new tests — expect green. If a test fails, DIAGNOSE the root cause (stale closure? wrong frame type? mutual-exclusion off-by-one?) — do NOT paper over with `waitFor` or arbitrary timer advances. The test setup uses fake timers throughout.
      REFACTOR: Only if the executor spots a clear cleanup (e.g. the dismiss-on-first-frame block could share a helper with the dormant block). Prefer minimal-diff — this is a targeted addition, not a refactor pass.

    Preservation self-check before running the full suite:
      - `git diff --stat src/ui/features/pretty-view/SessionHoldingOverlay.tsx src/ui/features/pretty-view/DormancyOverlay.tsx` MUST be empty (byte-untouched invariant).
      - `git diff --stat src/ui/features/pretty-conversations/` MUST be empty (panel side untouched).
      - `git diff src/ui/features/pretty-view/ComposeBox.tsx` MUST be empty (no new `*_active` prop).

    Full-suite green precondition (fleet standing directive): run `npx vitest run` (entire suite, no filter). Exit 0, zero failures. If pre-existing failures exist (from other work already on this branch), fix them in this quick per the role standing directive ("never leave tests failing, regardless of where they came from"). If failures look genuinely large or unrelated, HALT and report to the orchestrator with the failing test names and short summaries — do not commit a partial-green state.
  </action>
  <verify>
    <automated>npx vitest run src/ui/features/pretty-view/PrettyView.test.tsx -t "260808-ho2" && npx vitest run</automated>
  </verify>
  <done>
    - PrettyView.tsx has: import, state, ref, mirror effect, arm site, dismiss block, dormant/holding clears, 10s timeout useEffect, mount JSX. All comments cite `quick 260808-ho2` for grep-ability.
    - PrettyView.test.tsx has the new `quick 260808-ho2 loading overlay integration` describe block with 8 tests (A-H) all passing.
    - SessionHoldingOverlay.tsx and DormancyOverlay.tsx are byte-untouched.
    - PrettyConversationsPanel.tsx, PrettyConversationRow.tsx, PrettyConversationContextMenu.tsx, ComposeBox.tsx are byte-untouched.
    - `npx vitest run` (full suite) exits 0 with zero failures.
  </done>
</task>

<task type="auto">
  <name>Task 3: TypeScript typecheck + commit-on-branch (no push)</name>
  <files>
    (verification only — no files modified in this task)
  </files>
  <action>
    Step 1 — Typecheck (frontend-only per orchestrator; backend is untouched):
      `npx tsc --noEmit`
      Exit 0, no new errors. If pre-existing errors exist, fix them if trivially in-scope; otherwise HALT and report.

    Step 2 — Sanity re-run of the full test suite:
      `npx vitest run`
      Exit 0, zero failures. (Task 2 already ran this — this is a defensive re-run right before commit in case any interleaving edit slipped in.)

    Step 3 — Commit (single atomic commit per fleet convention; commit_docs=true means PLAN.md ships with the code):
      Stage exactly these files (specific paths, no `git add .`):
        - src/ui/features/pretty-view/PrettyViewLoadingOverlay.tsx
        - src/ui/features/pretty-view/PrettyViewLoadingOverlay.test.tsx
        - src/ui/features/pretty-view/PrettyView.tsx
        - src/ui/features/pretty-view/PrettyView.test.tsx
        - .planning/quick/260808-ho2-full-surface-pretty-view-loading-overlay/PLAN.md

      Commit message (HEREDOC form to preserve newlines):
        ```
        feat(pretty-view): full-surface loading overlay for fresh-pane mount window (quick 260808-ho2, full-surface-pretty-view-loading-overlay)

        Adds PrettyViewLoadingOverlay — a full-surface scrim + spinner covering the
        ~5s window between a fresh pane mount (typically triggered by tapping a
        conversation-list row) and the first user-visible WS frame arriving.
        Fixes Ashley's silent-window UX bug (row lights up but pretty-view sits
        blank for 5s → she thinks the tap didn't register → re-taps → double-fires).

        Design (all six gate decisions locked in PLAN.md § Objective):
          1. ARM on fresh-pane paneKey change (reuses existing cold-vs-warm gate at
             the paneKey-reset useEffect — no new sentinel ref needed).
          2. DISMISS on first user-visible WS frame (mirrors DormancyOverlay's
             patch #345 pattern; same frame-type set: message / image / relay_* /
             context_pct / harness_tasks / session). NOT on ws.onopen alone.
          3. No minimum hold time — arm instantly. Flash on fast mount is fine
             (Ashley's complaint is silence, not overlong loading UX).
          4. 10s timeout auto-dismiss, silent (no error variant per Ashley's ask).
             Stuck load past 10s is a bug — let inactive/error state show through.
          5. Mutual exclusion Dormancy > Holding > Loading, enforced at the mount
             gate: showLoadingOverlay = isBooting && !dormant && !showOverlay.
          6. No arm on warm re-focus (hidden→visible flip) — the WS-pause reopen
             path bumps retryKey without changing paneKey, so the reset block
             (which owns the arm) is skipped.

        Preservation invariants:
          - SessionHoldingOverlay.tsx byte-untouched.
          - DormancyOverlay.tsx byte-untouched.
          - PrettyConversationsPanel.tsx / Row.tsx / ContextMenu.tsx untouched.
          - ComposeBox.tsx untouched (no new *_active prop — loading window is
            short and its own fresh-mount state already handles pre-draft).
          - No WebSocket type or backend changes.

        Motion-channel note (documented in PrettyViewLoadingOverlay.tsx header):
        this overlay uses animate-spin, deviating from the SessionHoldingOverlay
        / DormancyOverlay static-glyph guardrail. Justification: loading is
        genuinely WORK-in-progress (surface booting) rather than STATE (temporarily
        unavailable). WipBubble owns motion for TASK work; this overlay owns
        motion for SURFACE work — the two never co-render (loading is only up
        before any bubbles render).

        iOS backdrop-filter hardening: scrim carries isolate + transform:translateZ(0)
        per the patch #333 lesson banked in the role file — non-negotiable for
        any new backdrop-filter surface in this fork.

        Tests: 5 unit tests (PrettyViewLoadingOverlay.test.tsx) + 8 integration
        tests (new describe block in PrettyView.test.tsx). Full suite green.
        ```

      Command (single call):
        `git commit -m "$(cat <<'EOF'\n<the message body above>\nEOF\n)"`
        (executor: adapt to the exact heredoc form shown in the Bash tool's git guidance — one commit, on-branch, no --amend, no --no-verify, no --sign, no push.)

    Step 4 — Post-commit sanity:
      `git status` — should be clean (working tree).
      `git log -1 --stat` — verify the commit includes exactly the 5 files staged and no others.

    DO NOT:
      - `git push`
      - `docker build` / `docker compose up`
      - Touch `~/.claude/roles/box-maintainer/skynet-patches.md` (orchestrator handles).
      - Touch the bounty JSON (orchestrator handles).
      - Rebase / force-push (multi-identity branch: `feat/tab-title-from-tmux`).
      - Use git worktrees (project has `workflow.use_worktrees=false`).
  </action>
  <verify>
    <automated>npx tsc --noEmit && npx vitest run && git log -1 --stat | grep -E "PrettyViewLoadingOverlay|PrettyView\.(tsx|test\.tsx)|PLAN\.md"</automated>
  </verify>
  <done>
    - `npx tsc --noEmit` exits 0.
    - `npx vitest run` exits 0 with zero failures.
    - One commit on branch `feat/tab-title-from-tmux` staging exactly the 5 planned files (4 source + 1 PLAN.md).
    - Working tree clean post-commit.
    - No push, no docker, no rebase, no touching of role files or the bounty JSON.
  </done>
</task>

</tasks>

<threat_model>

## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| WS onmessage → React state | Untrusted server-authored JSON crosses here into isBooting-dismiss logic. Already-established boundary shared with dormant / holding / message / image / relay handlers. This plan adds no new frame types, only extends existing frame-type discriminant switches — same trust envelope. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-260808-ho2-01 | Denial-of-service | PrettyViewLoadingOverlay mount + timeout | mitigate | 10s timeout guarantees the overlay cannot stay up indefinitely even if the WS delivers zero frames. Cleanup on unmount (useEffect return) prevents orphaned timers. `setIsBooting(false)` on dormancy + holding transitions prevents ghost re-arms. |
| T-260808-ho2-02 | Tampering | Malicious WS frame with unexpected discriminant | accept | New dismiss-block reads only `parsed.type`. Unknown discriminant → no dismiss → 10s timeout fires. Worst case: the overlay stays up 10s during a garbage-frame attack, no state corruption. Already-accepted risk in shared onmessage boundary. |
| T-260808-ho2-03 | Elevation of privilege | Loading overlay masking a real security-critical dialog | accept | Loading overlay uses z-[99] (same as sibling overlays), sits BELOW IdentityBadge (z-[101]) and BELOW app-modal dialogs (z-[500]). Same z-band as SessionHoldingOverlay + DormancyOverlay — no new elevation risk introduced. Documented in the JSX mount-site comment. |
| T-260808-ho2-04 | Repudiation | 10s timeout dismiss hides a genuine stuck state | accept | `console.info` log emitted on timeout dismiss (see Task 2 action). Stuck-state fallback intentionally silent (no error card per Ashley); underlying `status === "inactive"` / `"error"` render branches show through immediately after dismiss. |
| T-260808-ho2-SC | Tampering | Supply chain (npm installs) | n/a | This quick installs NO new packages. All imports use packages already in package.json: `lucide-react` (Loader2), `@/lib/utils` (cn). Package Legitimacy Gate does not apply. |

</threat_model>

<verification>

Phase-level checks (executor runs these before commit):

1. `npx vitest run src/ui/features/pretty-view/PrettyViewLoadingOverlay.test.tsx` — 5 tests pass.
2. `npx vitest run src/ui/features/pretty-view/PrettyView.test.tsx -t "260808-ho2"` — 8 tests pass.
3. `npx vitest run` — full suite green, exit 0, zero failures.
4. `npx tsc --noEmit` — no new TypeScript errors.
5. `git diff --stat src/ui/features/pretty-view/SessionHoldingOverlay.tsx src/ui/features/pretty-view/DormancyOverlay.tsx` — empty (byte-untouched preservation).
6. `git diff --stat src/ui/features/pretty-view/ComposeBox.tsx src/ui/features/pretty-conversations/` — empty (panel and ComposeBox untouched).
7. `git log -1 --stat` — commit touches exactly 5 files: PrettyViewLoadingOverlay.tsx, PrettyViewLoadingOverlay.test.tsx, PrettyView.tsx, PrettyView.test.tsx, PLAN.md.

</verification>

<success_criteria>

- New component `PrettyViewLoadingOverlay` renders a spinner-over-scrim identical in aesthetic to SessionHoldingOverlay's neutral variant, differing intentionally by (a) using `animate-spin` on a Loader2 glyph, (b) copy "Loading…", (c) no error variant, (d) no cancel button.
- Overlay arms on fresh-pane paneKey-change reset AND dismisses on first user-visible WS frame (or after 10s stuck-state timeout).
- Overlay does not arm on warm hidden→visible re-focus.
- Overlay does not co-render with SessionHoldingOverlay or DormancyOverlay (mutual exclusion enforced at the mount gate).
- SessionHoldingOverlay.tsx and DormancyOverlay.tsx are byte-untouched. All existing overlay tests still pass unchanged.
- ComposeBox stays typeable during the loading window (mount site is inside the chat-region wrapper as sibling of the other overlays; ComposeBox is a peer sibling below the wrapper — patch #275 posture preserved).
- Scrim carries the iOS backdrop-filter hardening classes (`isolate [transform:translateZ(0)]`) — patch #333 lesson honored.
- Full test suite (`npx vitest run`) is green with zero failures.
- Frontend typecheck (`npx tsc --noEmit`) is green.
- One atomic commit on branch `feat/tab-title-from-tmux`, no push, no rebase, no docker, no worktree.

</success_criteria>

<output>
On completion, return to orchestrator:
  - Task count (3)
  - Files touched (5: PrettyViewLoadingOverlay.tsx [NEW], PrettyViewLoadingOverlay.test.tsx [NEW], PrettyView.tsx [MODIFY], PrettyView.test.tsx [MODIFY-APPEND], PLAN.md [NEW])
  - Design decisions locked (all 6 gate items — inline in PLAN.md § Objective, restate briefly in the report)
  - Component name chosen and justified: `PrettyViewLoadingOverlay`
  - Full-suite-green + typecheck-green confirmation
  - Commit SHA (single atomic commit)
</output>
