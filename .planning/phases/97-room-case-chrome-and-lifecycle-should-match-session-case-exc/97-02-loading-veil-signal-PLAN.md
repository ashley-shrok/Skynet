---
phase: 97-room-case-chrome-and-lifecycle-should-match-session-case-exc
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/ui/features/pretty-view/sources/chat-surface-source.ts
  - src/ui/features/pretty-view/sources/use-relay-adapter.ts
  - src/ui/features/pretty-view/sources/use-harness-adapter.ts
  - src/ui/features/pretty-view/PrettyView.tsx
autonomous: true
requirements:
  - F-1
  - D-03
  - D-04
  - D-17

must_haves:
  truths:
    - "In relay case: loading veil (PrettyViewLoadingOverlay) shows on room mount and stays up until the relay adapter has processed its first history_batch WS frame."
    - "In relay case: veil dismisses on empty rooms too (history_batch with an empty events array flips isMessagesLoaded=true — the FRAME arrival is the signal, not events.length)."
    - "In harness case: veil behavior byte-identical to pre-plan — driven off renderedState === 'resolving' via the existing effect at PrettyView.tsx:2002-2013, not off isMessagesLoaded."
    - "The relay-veil path preserves the 400ms delay-arm treatment (flash-suppression on fast WS reconnect)."
    - "ChatSurfaceAdapterState carries a new optional `isMessagesLoaded?: boolean` field; use-harness-adapter's INERT_STATE defaults it to true; use-relay-adapter's IDLE_STATE defaults it to false; the relay adapter flips it true on the first history_batch frame."
    - "Rules-of-hooks preserved in use-relay-adapter (new useState above the source===null early-return; new field in the useMemo deps at L605-625)."
  artifacts:
    - path: "src/ui/features/pretty-view/sources/chat-surface-source.ts"
      provides: "Optional isMessagesLoaded field on ChatSurfaceAdapterState"
      contains: "isMessagesLoaded"
    - path: "src/ui/features/pretty-view/sources/use-relay-adapter.ts"
      provides: "useState + history_batch flip + memo dep for isMessagesLoaded"
      contains: "setIsMessagesLoaded"
    - path: "src/ui/features/pretty-view/sources/use-harness-adapter.ts"
      provides: "INERT_STATE default isMessagesLoaded: true"
      contains: "isMessagesLoaded: true"
    - path: "src/ui/features/pretty-view/PrettyView.tsx"
      provides: "Case-branched veil-arm effect for relay case"
      contains: "chatSurfaceAdapter.isMessagesLoaded"
  key_links:
    - from: "src/ui/features/pretty-view/sources/use-relay-adapter.ts"
      to: "src/ui/features/pretty-view/PrettyView.tsx (veil-arm effect)"
      via: "ChatSurfaceAdapterState.isMessagesLoaded field flowing through the adapter return"
      pattern: "isMessagesLoaded"
    - from: "src/ui/features/pretty-view/PrettyView.tsx (relay veil-arm effect)"
      to: "showResolvingSpinner state"
      via: "setShowResolvingSpinner(false) on isMessagesLoaded=true, setShowResolvingSpinner(true) after 400ms otherwise"
      pattern: "setShowResolvingSpinner"
---

<objective>
Extend the ChatSurfaceAdapterState contract with an optional `isMessagesLoaded?: boolean` field, wire the relay adapter to flip it `true` on the first `history_batch` WS frame, and add a peer veil-arm effect in PrettyView that dismisses `showResolvingSpinner` in the relay case when the field flips true. Preserves the harness veil path byte-identically (still driven off `renderedState === "resolving"` from the pane-state machine).

Purpose: Ship F-1, the first UAT blocker — in the shipped Phase 93 tree the relay case's veil never dismisses because `paneState` and `wsTransportState` (both harness-adapter concepts) never fire for a relay mount, so `renderedState` collapses to `"resolving"` forever and `showResolvingSpinner` stays on. Data-over-configuration (Phase 93 D-17): the veil signal flows from adapter → surface as data, not as a case-branch on rendering. Per D-04, the signal is `history_batch` (backend has read the room's history), NOT `session` (backend has WS-authed — too early) and NOT `messages.length > 0` (empty rooms would never dismiss).

Output: adapter contract extended, relay adapter flips isMessagesLoaded on history_batch (belt-and-suspenders with the existing setIsReady flip at the same site), harness inert shim defaults to true (never read in harness case anyway — the veil consumer gates on source.kind), PrettyView carries a new peer veil-arm effect for the relay path with the same 400ms delay-arm as the harness path.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/shapes/shape-phase-93-uat-polish-arc.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-CONTEXT.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md
@.planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Relay WS backend → useRelayAdapter | `history_batch` frame is trusted client-side; parsed by existing zod schema at use-relay-adapter.ts (Phase 93). New `isMessagesLoaded` flip observes the frame arrival, does not introduce new parsing. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-97-02-01 | Denial of Service (client-side) | Veil stuck in "up" state forever if history_batch never arrives | mitigate | Existing `ChatSurfaceErrorState` overlay (Phase 93 Slice 6 reshape, commit 9ceab1b0) handles the WS error path — if the adapter emits `error !== null`, PrettyView renders the error overlay above the message list. The veil scrim + error scrim coexist as overlays per Phase 93 Landmine 7. |
| T-97-02-02 | Tampering | Harness case veil signal | mitigate | New peer effect gates on `source.kind === "relay"`; harness effect gates on `source.kind === "harness"`. Byte-identical harness veil path preserved. Regression covered by existing PrettyView.test.tsx harness snapshots. |
| T-97-02-SC | Tampering | package installs | accept | No package installs; RESEARCH § Package Legitimacy Audit confirms zero new packages. |

Severity: LOW / none-new. The new field is optional client-side state; the flip site adds one setState call at an existing frame-handling branch. No new endpoints, no new WS opcode, no new auth surface.
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Extend adapter contract + wire relay adapter isMessagesLoaded flip on history_batch</name>
  <files>
    src/ui/features/pretty-view/sources/chat-surface-source.ts,
    src/ui/features/pretty-view/sources/use-relay-adapter.ts,
    src/ui/features/pretty-view/sources/use-harness-adapter.ts,
    src/ui/features/pretty-view/sources/use-relay-adapter.test.ts
  </files>
  <read_first>
    - src/ui/features/pretty-view/sources/chat-surface-source.ts (full 80 lines — the interface being extended at L67-79)
    - src/ui/features/pretty-view/sources/use-harness-adapter.ts (full 45 lines — INERT_STATE at L26-32)
    - src/ui/features/pretty-view/sources/use-relay-adapter.ts (targeted reads: L1-50 file header + JSDoc; L200-260 for existing isReady state + reset sites; L390-509 for history_batch branch and session frame flip; L580-645 for both useMemo blocks and IDLE_STATE early-return)
    - src/ui/features/pretty-view/sources/use-relay-adapter.test.ts (existing test file — read for existing test patterns to mirror; specifically the history_batch tests)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md § "Finding 1" (root cause, fix approach paths A/B, landmines — especially: do NOT gate on messages.length > 0; do NOT dismiss on session frame alone; preserve harness veil byte-identically; 400ms delay-arm preserved)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md § "Finding 1 — Loading veil dismisses on `history_batch`" (all four subsections)
    - Phase 93 post-close landmines documented in RESEARCH § "Landmines / anti-patterns" (items 4, 5, 8 — memo deps, rules-of-hooks discipline, adapter memoization rationale)
  </read_first>
  <behavior>
    - Test 1 (RED first): use-relay-adapter mounted with a mock WS; assert `state.isMessagesLoaded === false` before any frame arrives.
    - Test 2 (RED first): after mock WS emits a `history_batch` frame with an empty events array, assert `state.isMessagesLoaded === true` (frame arrival is the signal, not events.length).
    - Test 3 (RED first): after mock WS emits a `history_batch` frame with a non-empty events array, assert `state.isMessagesLoaded === true`.
    - Test 4 (regression): after mock WS emits only a `session` frame (no history_batch), assert `state.isMessagesLoaded === false` while `state.isReady === true` (session frame flips isReady but MUST NOT flip isMessagesLoaded — per RESEARCH § Finding 1 landmines "do NOT dismiss on session frame alone").
    - Test 5 (regression, memoization): after two identical `history_batch` frames, the returned adapter state's identity is stable when nothing else changed (useMemo deps discipline preserved per Phase 93 Landmine 4). This test may be tricky — if the existing test suite already covers memo stability across other fields, add isMessagesLoaded to that test's inputs; do not create a separate one if that leads to duplication.
    - Test 6 (harness shim): mounting use-harness-adapter returns INERT_STATE with `isMessagesLoaded: true` (or the field defaulting to a truthy value that means "harness case, no relay-veil signal to gate on").
  </behavior>
  <action>
    Three files touched, one test file. Execute in TDD order: write the tests first (RED), then implement (GREEN).

    **File 1: src/ui/features/pretty-view/sources/chat-surface-source.ts**

    Extend the `ChatSurfaceAdapterState` interface at L67-79 with a new optional field, placed immediately after `isReady`. Exact insert:

    ```
      /**
       * Phase 97 Finding 1: flips true on the first `history_batch` frame
       * (relay adapter) or defaults to true for the harness inert shim.
       * PrettyView's loading-veil arm reads this in the relay case as the
       * "backend has responded with historical messages" signal. `isReady`
       * flips earlier (on `session` frame — WS-auth pass) and is NOT the
       * right signal for the veil per RESEARCH § Finding 1 landmines.
       */
      isMessagesLoaded?: boolean;
    ```

    Do NOT change the existing optional pagination fields (`hasOlder`, `loadOlderStatus`, `loadOlderError`, `fetchOlder`) — additive change only.

    **File 2: src/ui/features/pretty-view/sources/use-harness-adapter.ts**

    Extend `INERT_STATE` at L26-32 to include `isMessagesLoaded: true`. The harness case reads this field never (the veil consumer gates on `source.kind === "harness"` and reads `renderedState === "resolving"` instead), so this default is defensive-only. Exact insert (last field, inside the const object literal):

    ```
      isMessagesLoaded: true,
    ```

    Preserve the JSDoc header at L1-25 explaining the inert-shim discipline (do NOT rewrite comments unrelated to this change).

    **File 3: src/ui/features/pretty-view/sources/use-relay-adapter.ts**

    Three changes in this file:

    3a. **Add useState** for `isMessagesLoaded` at the useState declarations block. This state MUST live ABOVE the `if (source === null) return IDLE_STATE;` early-return (per Phase 93 Landmine 5 — rules-of-hooks discipline). The exact line number to insert at is adjacent to the existing `setIsReady` declaration (find via grep in the file — do NOT hardcode; the file has evolved). Insert (adjacent to `const [isReady, setIsReady] = useState<boolean>(false);` — same pattern):

    ```
    const [isMessagesLoaded, setIsMessagesLoaded] = useState<boolean>(false);
    ```

    3b. **Flip in the history_batch branch at L438-445** (the existing branch that already calls `setIsReady(true)` belt-and-suspenders). Add ONE new line immediately after `setIsReady(true);` inside the `case "history_batch":` block:

    ```
    setIsMessagesLoaded(true);
    ```

    Do NOT also add this flip to the `session` frame branch (that would defeat the whole point of separating the two signals — per RESEARCH landmine "do NOT dismiss on session frame alone"). Do NOT add it anywhere gated on `parsed.events.length > 0` (empty rooms MUST dismiss the veil — the FRAME is the signal).

    3c. **Reset on WS reopen** — trace the existing reset site for `setIsReady(false)` (grep for `setIsReady(false)`). Wherever that reset lives (typically in the cancel/cleanup path or in the ws.onopen preflight), add an adjacent `setIsMessagesLoaded(false);`. If NO existing reset for isReady is found, do NOT add a defensive reset — that would introduce a new behavior not present for isReady and could flash the veil on reconnect. Mirror the existing site exactly; if isReady is never reset, isMessagesLoaded is also never reset. Trace and preserve.

    3d. **Extend the returned-shape useMemo at L605-625** with the new field. Both:
       - Add `isMessagesLoaded,` to the object literal.
       - Add `isMessagesLoaded,` to the deps array.

    Both changes are per Phase 93 Landmine 4 — every field returned MUST be in deps.

    3e. **Update IDLE_STATE** (the singleton returned when `source === null` at L631) — add `isMessagesLoaded: false` to the object. This is the "no source connected yet" state; false is the correct default because the veil consumer sees this as "not yet loaded" and shows the scrim (though in practice `source.kind === "relay"` gates the peer effect, so this idle-state field is defensive).

    **File 4: use-relay-adapter.test.ts (or a new test file if the existing test file's structure does not accommodate)**

    Add the six behavior tests above. Mirror the existing history_batch test's structure — Phase 93 tests already exercise the history_batch branch; extend the existing test cases where an assertion for `isMessagesLoaded` fits naturally, or add new `it()` blocks. Preserve the existing tests' setup (mock WS, msw, etc.).

    Landmines (checklist before commit):
    - useState above L631 early-return? Yes / No — confirm via grep line numbers.
    - Field added to both the useMemo object AND deps array? Yes / No — grep for `isMessagesLoaded` count in L605-625 should be exactly 2 (one in object, one in deps).
    - history_batch branch flip is UNCONDITIONAL on events.length? Yes / No — should be the same nesting level as `setIsReady(true)` (not inside an `if (parsed.events.length > 0)` check).
    - Session frame branch NOT modified? Yes / No — grep for `setIsMessagesLoaded` count in the file should be exactly 2 (one flip on history_batch, one reset — if the reset exists; else 1 flip only).
    - INERT_STATE + IDLE_STATE both updated? Yes / No.

    Structured log: NO new logs added in this task. The existing `history_batch` handler at use-relay-adapter.ts already emits an `{operation: "...", ...}` structured log at the frame-processing site (per Phase 93 discipline) — do not add another. Per RESEARCH § "Structured logging discipline": "Finding 1: any new adapter log around `isMessagesLoaded` flip (RECOMMENDED: none — the existing `history_batch` handler already logs enough)."
  </action>
  <verify>
    <automated>
      cd /home/ubuntu/skynet-taylor && \
      grep -q 'isMessagesLoaded?: boolean' src/ui/features/pretty-view/sources/chat-surface-source.ts && \
      grep -q 'isMessagesLoaded: true' src/ui/features/pretty-view/sources/use-harness-adapter.ts && \
      grep -q 'const \[isMessagesLoaded, setIsMessagesLoaded\]' src/ui/features/pretty-view/sources/use-relay-adapter.ts && \
      grep -c 'isMessagesLoaded' src/ui/features/pretty-view/sources/use-relay-adapter.ts | awk '$1 >= 4 { exit 0 } { exit 1 }' && \
      awk '/useMemo\(/ && /=>/{ block=1 } block && /isMessagesLoaded/{ found++ } block && /\]\)/{ block=0 } END { exit (found >= 2) ? 0 : 1 }' src/ui/features/pretty-view/sources/use-relay-adapter.ts && \
      npx vitest run --related src/ui/features/pretty-view/sources/use-relay-adapter.ts src/ui/features/pretty-view/sources/use-harness-adapter.ts src/ui/features/pretty-view/sources/chat-surface-source.ts 2>&1 | tee /tmp/97-02-task1-vitest.log | grep -qE 'Tests +[0-9]+ passed'
    </automated>
  </verify>
  <acceptance_criteria>
    - `chat-surface-source.ts` contains the exact line `isMessagesLoaded?: boolean;` (grep-verifiable, matches interface field syntax).
    - `use-harness-adapter.ts` INERT_STATE contains `isMessagesLoaded: true` (grep-verifiable, matches property syntax).
    - `use-relay-adapter.ts` contains exactly one `const [isMessagesLoaded, setIsMessagesLoaded] = useState<boolean>(false);` declaration (grep count = 1).
    - `use-relay-adapter.ts` contains `setIsMessagesLoaded(true)` inside the `case "history_batch":` block (grep, plus manual verification the line is inside that case block).
    - `use-relay-adapter.ts` returned-shape useMemo block contains `isMessagesLoaded` in BOTH the object literal AND the deps array (verified via the awk block or manual read of L605-625).
    - `use-relay-adapter.ts` IDLE_STATE object literal contains `isMessagesLoaded: false`.
    - No `setIsMessagesLoaded(true)` call exists inside the `case "session":` branch (grep + manual — session frame MUST NOT flip isMessagesLoaded).
    - Scoped Vitest run against all four files exits 0 with all tests passing including the 6 new behavior tests.
    - `useState` declaration line number is LESS than the line number of `if (source === null) return IDLE_STATE;` (rules-of-hooks preserved; verifiable via `grep -n` on both).
  </acceptance_criteria>
  <done>ChatSurfaceAdapterState carries optional `isMessagesLoaded`; use-harness-adapter INERT_STATE defaults it to true; use-relay-adapter has a useState above the early-return, a flip in the history_batch branch, both useMemo dep + object entries, and IDLE_STATE default false. All new behavior tests (6) pass green. TypeScript compiles.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add relay-case peer veil-arm effect in PrettyView</name>
  <files>
    src/ui/features/pretty-view/PrettyView.tsx,
    src/ui/features/pretty-view/PrettyView.relay-veil.test.tsx
  </files>
  <read_first>
    - src/ui/features/pretty-view/PrettyView.tsx (targeted reads: L1970-2020 for existing veil-arm effect; L1727 for `paneState` state slot; L1976-1983 for `wsTransportState` derivation; L2023 for the harness ingestion gate `if (source.kind !== "harness") return`; L2189-2192 for setPaneState site; L3782 for veil mount gate; L3830-3832 for the message-list mount gate that ALREADY includes `source.kind === "relay"`)
    - src/ui/features/pretty-view/resolve-phase.ts (full 200 lines — the pure reducer that produces `renderedState`; specifically the truth-table row (e) at L199 that collapses to "resolving" when both inputs are null/not-connected)
    - src/ui/features/pretty-view/PrettyView.relay-source.test.tsx (existing test file — read for the mock ChatSurfaceAdapter setup pattern used when mounting with `source={{kind:"relay",...}}`)
    - src/ui/features/pretty-view/sources/chat-surface-source.ts (post-Task-1 — the ChatSurfaceAdapterState interface now with isMessagesLoaded)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-RESEARCH.md § "Finding 1" fix approach path A + landmines (400ms delay-arm preservation, harness path untouched)
    - .planning/phases/97-room-case-chrome-and-lifecycle-should-match-session-case-exc/97-PATTERNS.md § "Finding 1 — PrettyView.tsx" subsection (current + extension shape with peer effect)
    - Phase 93 Landmine 7 (from RESEARCH): "ChatSurfaceErrorState is an OVERLAY (scrim + card) above the message list, NOT a replacement. The Finding-1 veil is a similar scrim; do NOT conflate the two."
  </read_first>
  <behavior>
    - Test 1 (RED first): mount PrettyView with `source={{kind:"relay",...}}` and a mocked `chatSurfaceAdapter` where `isMessagesLoaded: false`; assert `PrettyViewLoadingOverlay` (or its data-testid — grep the existing loading overlay component for its testid) is present in the DOM after the 400ms delay elapses (use vitest fake timers).
    - Test 2 (RED first): re-render with `chatSurfaceAdapter.isMessagesLoaded: true`; assert `PrettyViewLoadingOverlay` is NOT present.
    - Test 3 (RED first): mount with relay source and `isMessagesLoaded: false`; before 400ms elapses (advance timers by 200ms only), assert the overlay is NOT yet present (delay-arm suppresses flash on fast reconnect).
    - Test 4 (regression, harness case): mount with `source={{kind:"harness",...}}` and default renderedState="resolving"; assert the existing veil path still fires (overlay appears after 400ms). The new peer effect MUST NOT change harness behavior.
    - Test 5 (regression, harness case with pane state active): mount with `source={{kind:"harness",...}}` and a paneState that resolves renderedState to "active"; assert overlay is NOT present. Confirms harness path still driven by renderedState, not by isMessagesLoaded.
  </behavior>
  <action>
    Two changes in PrettyView.tsx:

    **Change 1 — case-gate the existing harness veil-arm effect at L2002-2013.** Current effect:

    ```
    useEffect(() => {
      if (renderedState !== "resolving") {
        setShowResolvingSpinner(false);
        return;
      }
      const t = setTimeout(() => {
        setShowResolvingSpinner(true);
      }, 400);
      return () => {
        clearTimeout(t);
      };
    }, [renderedState]);
    ```

    Extension: add a `source.kind !== "harness"` early-guard at the top of the effect body so that when a relay source is mounted, the harness effect is a no-op (does not overwrite showResolvingSpinner):

    ```
    useEffect(() => {
      if (source.kind !== "harness") return;
      if (renderedState !== "resolving") {
        setShowResolvingSpinner(false);
        return;
      }
      const t = setTimeout(() => {
        setShowResolvingSpinner(true);
      }, 400);
      return () => {
        clearTimeout(t);
      };
    }, [source.kind, renderedState]);
    ```

    NOTE: this guard is a no-op for existing harness mounts (source.kind === "harness" in every harness call site — verified by RESEARCH § Finding 1 code trace). The regression floor at Phase 93 D-01 remains intact.

    **Change 2 — add a peer effect immediately after the harness effect.** New effect:

    ```
    // Phase 97 Finding 1: relay-case peer veil-arm.
    // Mirrors the harness veil's 400ms delay-arm treatment (flash-suppression
    // on fast WS reconnect). Dismisses when the relay adapter reports the
    // first history_batch frame has landed (isMessagesLoaded=true), matching
    // the harness pane_state:active signal semantics. Empty rooms dismiss
    // because history_batch fires regardless of events.length — the FRAME
    // is the signal, not the array cardinality.
    useEffect(() => {
      if (source.kind !== "relay") return;
      if (chatSurfaceAdapter.isMessagesLoaded === true) {
        setShowResolvingSpinner(false);
        return;
      }
      const t = setTimeout(() => {
        setShowResolvingSpinner(true);
      }, 400);
      return () => {
        clearTimeout(t);
      };
    }, [source.kind, chatSurfaceAdapter.isMessagesLoaded]);
    ```

    Placement: immediately after the closing `}, [renderedState]);` (post-Change-1: `}, [source.kind, renderedState]);`) of the harness effect. Both effects then coexist as peers, each gated on their own source.kind, both writing to the same `showResolvingSpinner` state, which is consumed at L3782 case-agnostically:

    ```
    {showResolvingSpinner && <PrettyViewLoadingOverlay />}
    ```

    Do NOT modify:
    - L3782 (the veil mount JSX gate) — it stays case-agnostic; both effects arm the same state.
    - L3830-3832 (the message-list mount gate, which already handles `source.kind === "relay"` — Phase 93 lock).
    - `paneState`, `wsTransportState`, `renderedState`, `resolveRenderedState`, or any input to the harness path.
    - `ChatSurfaceErrorState` (the error overlay is a separate scrim per Phase 93 Landmine 7; do NOT conflate).

    Add PrettyView.relay-veil.test.tsx as a NEW test file. Mirror the existing PrettyView.relay-source.test.tsx setup (MSW/mock adapter). Use `vi.useFakeTimers()` + `vi.advanceTimersByTime(400)` to test the delay-arm. Cover the 5 behaviors above.
  </action>
  <verify>
    <automated>
      cd /home/ubuntu/skynet-taylor && \
      grep -c 'if (source.kind !== "harness") return' src/ui/features/pretty-view/PrettyView.tsx | grep -v '^0$' && \
      grep -c 'if (source.kind !== "relay") return' src/ui/features/pretty-view/PrettyView.tsx | grep -v '^0$' && \
      grep -q 'chatSurfaceAdapter.isMessagesLoaded === true' src/ui/features/pretty-view/PrettyView.tsx && \
      grep -q 'chatSurfaceAdapter.isMessagesLoaded' src/ui/features/pretty-view/PrettyView.tsx && \
      test -f src/ui/features/pretty-view/PrettyView.relay-veil.test.tsx && \
      npx vitest run --related src/ui/features/pretty-view/PrettyView.tsx 2>&1 | tee /tmp/97-02-task2-vitest.log | grep -qE 'Tests +[0-9]+ passed'
    </automated>
  </verify>
  <acceptance_criteria>
    - PrettyView.tsx contains the harness-guard `if (source.kind !== "harness") return;` inside the veil-arm effect at (post-change) L2002-L2015 range (grep-verifiable).
    - PrettyView.tsx contains a NEW peer effect with `if (source.kind !== "relay") return;` guard + `chatSurfaceAdapter.isMessagesLoaded === true` dismiss branch + a `setTimeout(..., 400)` arm branch + deps `[source.kind, chatSurfaceAdapter.isMessagesLoaded]` (grep + read verification).
    - The peer effect calls `setShowResolvingSpinner` at both dismiss + arm branches (grep count: at least 2 occurrences of `setShowResolvingSpinner` within the new peer effect body).
    - PrettyView.relay-veil.test.tsx exists and contains the 5 behavior tests (test title grep: "shows overlay when isMessagesLoaded is false", "dismisses overlay when isMessagesLoaded is true", "suppresses flash before 400ms", or equivalent verbatim wording).
    - Scoped Vitest run against PrettyView.tsx (via --related) exits 0 with all tests passing.
    - No modification to L3782 (grep: `showResolvingSpinner && <PrettyViewLoadingOverlay />` unchanged, still exactly one occurrence in the file).
    - No modification to L3830-3832 message-list mount gate (grep: existing `source.kind === "relay"` gate on the message-list JSX unchanged — before-and-after diff empty on those lines).
    - Existing PrettyView.relay-source.test.tsx and PrettyView.test.tsx suites still pass green (regression floor).
  </acceptance_criteria>
  <done>PrettyView.tsx has two peer veil-arm effects (harness-guarded and relay-guarded), both writing to `showResolvingSpinner`. PrettyView.relay-veil.test.tsx covers 5 behaviors. Harness veil path byte-identical to pre-plan (except for the new `source.kind !== "harness" return` early-guard which is a no-op for existing harness mounts). All scoped tests green.</done>
</task>

</tasks>

<verification>
- Task 1 grep gates confirm: interface field added; harness inert defaults true; relay useState above early-return; relay history_batch flip; useMemo deps + object both include field; IDLE_STATE default false.
- Task 2 grep gates confirm: harness effect gated on source.kind === "harness"; new peer effect gated on source.kind === "relay" with isMessagesLoaded dismiss branch; message-list mount gate unchanged; veil mount JSX unchanged.
- Rules-of-hooks: useState line number LESS than `if (source === null) return IDLE_STATE;` line number (grep -n check).
- Regression floor: PrettyView.relay-source.test.tsx + PrettyView.test.tsx all pass green (harness case untouched, relay case still renders message list).
- Regression floor: existing use-relay-adapter.test.ts session-frame tests still pass (session flips isReady but NOT isMessagesLoaded).
- Delay-arm: 400ms preserved in both harness and relay effects (grep for `400` inside both effect bodies).
</verification>

<success_criteria>
- ChatSurfaceAdapterState carries optional `isMessagesLoaded?: boolean` field.
- use-harness-adapter INERT_STATE defaults to `isMessagesLoaded: true`.
- use-relay-adapter has useState above early-return, history_batch flip, both useMemo dep + object entries, IDLE_STATE default false.
- PrettyView.tsx has case-branched peer veil-arm effects (harness path + relay path, both writing to showResolvingSpinner).
- PrettyView.relay-veil.test.tsx covers the 5 documented behaviors including 400ms delay-arm suppression.
- Harness veil path byte-identical for existing session mounts.
- Empty relay rooms dismiss the veil (history_batch fires even with empty events).
- All scoped Vitest runs pass green.
</success_criteria>

<output>
Create `.planning/phases/97-.../97-02-SUMMARY.md` when done. Include:
- Confirmation that empty rooms dismiss the veil (test evidence)
- Line numbers of the two peer effects in PrettyView.tsx (post-change)
- Whether use-relay-adapter.ts has an existing setIsReady(false) reset site and whether setIsMessagesLoaded(false) was mirrored there
</output>
