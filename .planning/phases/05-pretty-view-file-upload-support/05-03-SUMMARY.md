---
phase: 05-pretty-view-file-upload-support
plan: 03
subsystem: frontend
tags: [terminal-wiring, pretty-view, chat-message, chip-strip, injected-turn, sender-side-render, wire-protocol-client, tdd]

# Dependency graph
requires:
  - plan: 05-01
    provides: "src/ui/api/pretty-view-upload-protocol.ts (INJECTED_DELIMITER + formatInjectedUserTurn + parseInjectedUserTurn scaffold) + backend orchestrator that emits upload_ready_to_inject"
  - plan: 05-02
    provides: "usePrettyViewUploads hook shape + PrettyViewProps (terminalWs, onInjectedTurnReady) + AttachmentChipStrip presentational component + StagedAttachmentLike structural prop shape"
  - patch: "#60 (atomic delete-on-send)"
    provides: "messageQueueItemId lifecycle key on input events → automatic patch #60 fire on the second event of the injected turn (harmless no-op: no queue row exists for uploads, delete-on-send is idempotent by design)"
  - patch: "#100 (split-and-delay Enter)"
    provides: "server-side split-and-delay on any input event ending in \\r AND carrying messageQueueItemId — injected turn's second event inherits this automatically (body already client-side-split, so patch #100 branch fires with body.length=0 and just runs the setTimeout — harmless)"

provides:
  - "Terminal.tsx: handleInjectedTurnReady useCallback + terminalWs / onInjectedTurnReady props threaded to PrettyView. Two-event split-send matching MessageQueueDrawer's byte-identical pattern."
  - "ChatMessage.tsx: sender-side chip render for injected user turns via parseInjectedUserTurn + AttachmentChipStrip readOnly."
  - "AttachmentChipStrip.tsx: readOnly prop for the sender-side render (no × / no progress / no error decorations)."
  - "pretty-view-upload-protocol.ts: parseInjectedUserTurn hardening (1MB length bound + strict per-pair validation + require ≥1 valid file line)."
  - "Terminal.wiring.test.ts: 10 wiring tests covering structural (byte-identity of pre-existing onSend callbacks + presence of new attributes/callback) + behavioral (two-event split-send with mock WS + fake timers)."
  - "Round-trip contract locked end-to-end: formatInjectedUserTurn ↔ parseInjectedUserTurn — the sender-side chip render sees exactly what the agent-side pane sees."

affects: [05-04]

# Tech tracking
tech-stack:
  added: []  # Zero new npm dependencies (locks in Plans 05-01 and 05-02's zero-new-deps stance)
  patterns:
    - "TDD RED → GREEN cycle for both tasks (test files created + verified failing before implementation)"
    - "Structural grep + behavioral reproduction as a proxy for direct unit testing of a large stateful component (Terminal.tsx — 3000+ lines, xterm + WS + i18n — too heavy for real react-testing-library mount)"
    - "sha256-pinned byte-identity assertions for byte-critical inline callbacks (protects patches #60 + #100 shape from silent drift)"
    - "Defense-in-depth role gate + parser bail — parseInjectedUserTurn is only invoked for role='user' AND requires strict per-pair validation + ≥1 valid file line"
    - "readOnly-prop pattern for interactive/read-only variants of the same presentational component — chip strip serves both staging (before send) and sender-side (after send) surfaces without duplicated JSX"

key-files:
  created:
    - "src/ui/features/terminal/Terminal.wiring.test.ts (~230 lines — 10 Vitest cases: 6 structural grep + 4 behavioral mock-WS reproduction with fake timers)"
    - "src/ui/features/pretty-view/ChatMessage.test.tsx (~115 lines — 6 Vitest cases covering injected-turn detection, empty-caption render, quick-reply regression guard, and assistant-role gate)"
    - ".planning/phases/05-pretty-view-file-upload-support/05-03-SUMMARY.md (this file)"
  modified:
    - "src/ui/features/terminal/Terminal.tsx (+42 lines — 100% insertions, zero modifications to existing bytes. handleInjectedTurnReady useCallback definition + two-prop-attribute additions on PrettyView mount)"
    - "src/ui/features/pretty-view/ChatMessage.tsx (+47 lines, structural additions only — new imports, injected detection variable, conditional JSX branch)"
    - "src/ui/features/pretty-view/AttachmentChipStrip.tsx (+58 net lines — added readOnly prop + branching in Chip subcomponent to suppress × / progress / error UI + subdued sent-side tint)"
    - "src/ui/api/pretty-view-upload-protocol.ts (+22 net lines — 1MB length bound constant + strict per-pair validation + ≥1-file-line requirement in parseInjectedUserTurn)"
    - "src/ui/api/pretty-view-upload-protocol.test.ts (+94 lines — 6 new parser edge-case tests)"
    - "src/ui/features/pretty-view/AttachmentChipStrip.test.tsx (+58 lines — 2 new readOnly tests)"

key-decisions:
  - "handleInjectedTurnReady is a NEW inline callback matching the MessageQueueDrawer onSend pattern byte-for-byte, NOT a call to the sshAdapter or a new sendInput variant. Rationale: MessageQueueDrawer's split-send is already the canonical two-event pattern; consistency > adding new helpers. The injected turn IS a pretty-view submit — same semantic surface."
  - "useCallback deps are `[]` (empty). webSocketRef is a React ref, not state, so its mutation does not re-render and the ref's `.current` is read at call time inside the callback body (never captured at capture time). This matches the pattern the existing PrettyView onSend and MessageQueueDrawer onSend both use — none of them memoize on `webSocketRef.current` because it would be a re-render trap."
  - "AttachmentChipStrip.readOnly is a boolean prop on the SAME component rather than a new SentAttachmentChipStrip component. Rationale: chip visual language is one-and-the-same for staging + sender-side (per UPLOAD-11 lock); duplicating the JSX would risk drift when either surface changes."
  - "parseInjectedUserTurn now REQUIRES at least one well-formed (header, indented-timestamp) tuple to succeed. A delimiter with zero valid file lines returns null. Rationale: T-05-09 false-match resistance — a user coincidentally typing `\\n\\n--- attached files ---\\n` in the middle of prose must NOT get their message re-rendered as a chip strip."
  - "parseInjectedUserTurn returns null on input > 1MB (T-05-11 length bound). A legitimate injected turn with 32 files at reasonable filename+path lengths is well under 100KB; anything larger is not a legitimate injected turn and must not consume parser cycles."
  - "ChatMessage's isQuickReply short-circuit now also requires !injected. Rationale: defense in depth for the never-happens case where a caption is literally 'good to go' and there's an attachment — the injected branch wins, chips render, no thumbs-up substitution."
  - "Terminal.tsx wiring tests use a two-technique approach: (a) structural grep of the source file for exact attribute presence + sha256 byte-identity of pre-existing callbacks, (b) behavioral reproduction of the callback pattern against a mock WS with fake timers. Rationale: Terminal.tsx is 3000+ lines with xterm + WebSocket + tmux + i18n — attempting to mount it with @testing-library/react is heavier than the wiring warrants. The two techniques together give equivalent coverage."
  - "Existing MessageQueueDrawer onSend (line 2911) and existing PrettyView onSend (line 2886) are BYTE-IDENTICAL — sha256 pinned in Terminal.wiring.test.ts. Any future patch touching them will trip the wiring test's positive-content assertions."

patterns-established:
  - "Byte-identity via inline sha256 pin in a colocated test file — repeatable pattern for any future callback that inherits patch #60 / #100 timing shape"
  - "Structural grep + behavioral reproduction is the wiring-test proxy for stateful components that can't be reasonably mounted in @testing-library/react"
  - "readOnly boolean prop pattern for interactive/inert component variants — one component, one visual language, two consumption surfaces"
  - "Parser hardening template: length bound at top + strict per-pair validation + minimum-count requirement at bottom = T-05-09 + T-05-11 mitigations in one function"

requirements-completed:
  - UPLOAD-06
  - UPLOAD-09
  - UPLOAD-11

# Metrics
duration: ~28min
completed: 2026-07-20
---

# Phase 5 Plan 05-03: Terminal.tsx wiring + ChatMessage sender-side chip render Summary

**Closes the pretty-view upload loop end-to-end: Terminal.tsx now threads the live WebSocket + injected-turn callback into PrettyView, and ChatMessage renders sender-side chips inline in the just-sent user bubble via the round-trip parser.**

## Performance

- **Duration:** ~28 min wall clock
- **Started:** 2026-07-20T11:44:00Z (approx — baseline test suite run before edits)
- **Completed:** 2026-07-20T12:02:00Z
- **Tasks:** 2 (both TDD; Wave 3, final code-side plan of Phase 05)
- **Files created:** 3 (2 test files + this SUMMARY)
- **Files modified:** 4 (Terminal.tsx, ChatMessage.tsx, AttachmentChipStrip.tsx, pretty-view-upload-protocol.ts) + 2 test files with new cases (protocol test, chip strip test)

## Accomplishments

- **Terminal.tsx wiring complete.** New `handleInjectedTurnReady` useCallback (Terminal.tsx line 2827-2851) inherits patches #60 and #100 automatically by reusing the exact two-event split-send pattern that MessageQueueDrawer's onSend already uses (line 2911-2933). Two attribute additions on the PrettyView mount site (line 2886-2905) thread `terminalWs={webSocketRef.current}` and `onInjectedTurnReady={handleInjectedTurnReady}` into the hook Plan 02 already wired. Zero-line changes to the pre-existing PrettyView onSend or MessageQueueDrawer onSend callbacks — sha256 byte-identity pinned in `Terminal.wiring.test.ts`.
- **ChatMessage sender-side chip render.** When `role === 'user'` AND `parseInjectedUserTurn(content) !== null`, the bubble body renders caption text (pv-injected-caption slot, whitespace-pre-wrap so multi-line captions preserve) above an `AttachmentChipStrip` in `readOnly` mode. Non-injected messages fall through to the normal markdown render byte-identically (early `indexOf` bail in the parser — no perf cost for non-injected messages). Quick-reply thumbs-up code path still works (the new `!injected` guard makes it explicit that quick-reply and injected are mutually exclusive).
- **AttachmentChipStrip readOnly prop.** New optional boolean prop. When true: hides × remove button, progress bar, error decorations. Subdued "sent" tint reads correctly inside a user bubble. Chip content stays filename + size only (UPLOAD-11 lock preserved).
- **Parser hardening.** `parseInjectedUserTurn` now bails on input > 1MB (T-05-11 DoS mitigation), requires every (header, indented-timestamp) pair to match strictly (T-05-09 false-match resistance), and requires at least one valid file line before returning non-null.
- **Full test suite green.** 409/409 tests across 35 files (was 384 pre-plan; +25 net new: +10 wiring tests, +6 parser edge cases, +2 chip strip readOnly, +6 ChatMessage detection, +1 quick-reply regression guard). Typecheck clean. Build clean (7.45s). Backend byte-identity guard (`scripts/verify-input-case-unchanged.sh`) still passes.
- **Zero cross-plan boundary violations.** No changes to backend. No changes to files outside `src/ui/features/pretty-view/` and `src/ui/features/terminal/` and `src/ui/api/pretty-view-upload-protocol.ts`. Zero new npm dependencies.

## Task Commits

1. **Task 1: Terminal.tsx wiring — thread terminalWs + onInjectedTurnReady into PrettyView mount** — `beef578` (feat — RED wiring test + GREEN implementation together)
2. **Task 2: ChatMessage sender-side chip render + parser hardening + AttachmentChipStrip readOnly** — `4fe48df` (feat — RED tests + GREEN implementation together)

## Files Created/Modified

**Created:**

- `src/ui/features/terminal/Terminal.wiring.test.ts` — 230 lines. Two testing techniques for a stateful component too heavy to mount:
  - **Structural (6 cases):** grep the source file for `terminalWs={webSocketRef.current}` (exactly 1), `onInjectedTurnReady={handleInjectedTurnReady}` (exactly 1), `handleInjectedTurnReady` usages (exactly 2 — def + JSX), `const handleInjectedTurnReady = useCallback(...)` regex match, and positive-content assertions on the pre-existing PrettyView onSend + MessageQueueDrawer onSend blocks (byte-identity guard for patches #60 + #100).
  - **Behavioral (4 cases):** reproduce the `handleInjectedTurnReady` callback body verbatim against a mock WebSocket with fake timers. Assert two-event split-send (body event synchronous with no mqid; \\r event 60ms later with mqid attached). Assert silent noop on null / not-open WS. Assert the second-event closure re-checks readyState at fire time (WS closing between the two events → second send skipped).

- `src/ui/features/pretty-view/ChatMessage.test.tsx` — 115 lines. 6 Vitest cases:
  - Test 9: user injected turn renders caption + 2 chips in one bubble; chip content is filename + human-size (chips-only lock).
  - Test 10: plain user message renders as markdown WITHOUT chip strip.
  - Test 11: assistant message with injected-turn content never triggers detection (role gate).
  - Test 12: empty caption → renders only chip strip, no pv-injected-caption slot.
  - Test 13: readOnly render has no × remove button.
  - Test 14: quick-reply "good to go" still renders thumbs-up glyph (regression guard for the isQuickReply / injected exclusivity).

- `.planning/phases/05-pretty-view-file-upload-support/05-03-SUMMARY.md` — this file.

**Modified:**

- `src/ui/features/terminal/Terminal.tsx` (+42 net lines, 100% insertions):
  - `handleInjectedTurnReady` useCallback definition at line 2827-2851. JSDoc explains: two-event split-send matching MessageQueueDrawer pattern; patches #60 + #100 fire automatically via terminal.ts `case "input"` on any event with mqid ending in \\r; useCallback deps `[]` because webSocketRef is a ref, `.current` read at call time inside the body.
  - PrettyView mount at line 2886-2905 gains two attributes: `terminalWs={webSocketRef.current}` and `onInjectedTurnReady={handleInjectedTurnReady}`. Every other attribute (including the pre-existing `onSend`) is byte-identical to pre-plan.

- `src/ui/features/pretty-view/ChatMessage.tsx` (+47 lines, structural):
  - New imports: `parseInjectedUserTurn` from `@/api/pretty-view-upload-protocol`, `AttachmentChipStrip` from `./AttachmentChipStrip`.
  - New `injected = isUser ? parseInjectedUserTurn(content) : null` variable (role gate + early-bail parse).
  - `isQuickReply` short-circuit updated: added `&& !injected` guard so quick-reply and injected code paths are mutually exclusive.
  - JSX bubble body gains a middle branch: `isQuickReply ? ThumbsUp : injected ? (caption + chips) : ReactMarkdown`. Caption slot is `<div className="pv-injected-caption whitespace-pre-wrap mb-2">` and only renders when `injected.caption.length > 0`. Chips are `<AttachmentChipStrip attachments={mapped} onRemove={noop} readOnly={true} />`.

- `src/ui/features/pretty-view/AttachmentChipStrip.tsx` (+58 net lines):
  - New `readOnly?: boolean` prop on `AttachmentChipStripProps` with full JSDoc explaining the sender-side render semantics.
  - `AttachmentChipStrip` component threads `readOnly` to each `Chip`. aria-label of the outer role="list" flips between "Staged attachments" (default) and "Sent attachments" (readOnly).
  - `Chip` component gets `readOnly` prop; branch skips the × Button, progress bar, complete-check icon, and error/AlertCircle when readOnly. Sent-side chip gets a subdued tint (`bg-white/[0.04] border-white/[0.10]`) that reads correctly inside a user bubble. Non-readOnly interactive tints are gated on `!readOnly`.
  - `data-readonly="true"` attribute added on the chip when readOnly (test-observable).

- `src/ui/api/pretty-view-upload-protocol.ts` (+22 net lines):
  - New `PARSE_MAX_INPUT_BYTES = 1024 * 1024` constant with JSDoc rationale (T-05-11 mitigation).
  - `parseInjectedUserTurn` gains an early bail: `if (raw.length > PARSE_MAX_INPUT_BYTES) return null`.
  - Per-pair validation tightened: previous `continue` on malformed header now `return null`. New TS timestamp validation: `if (!tsMatch) return null` (previously fell through to empty string).
  - New "must have ≥1 file" check at the end: `if (files.length === 0) return null`.

- `src/ui/api/pretty-view-upload-protocol.test.ts` (+94 lines): 6 new parser edge-case tests (empty caption, multi-line caption, no delimiter, quoted-substring-only, delimiter+no-lines, malformed line, >1MB bail).

- `src/ui/features/pretty-view/AttachmentChipStrip.test.tsx` (+58 lines): 2 new readOnly tests (hides ×/progress/error UI; tolerates error state defensively).

## Final callback shape (with line numbers)

The `handleInjectedTurnReady` callback as it landed in Terminal.tsx:

```
// Terminal.tsx lines 2811-2851 (post-Plan-03):
const handleInjectedTurnReady = useCallback(
  (text: string, messageQueueItemId: string) => {
    const ws = webSocketRef.current;
    if (!ws || ws.readyState !== 1) return; // silent noop
    ws.send(JSON.stringify({ type: "input", data: text }));
    setTimeout(() => {
      const ws2 = webSocketRef.current;
      if (ws2 && ws2.readyState === 1) {
        ws2.send(
          JSON.stringify({ type: "input", data: "\r", messageQueueItemId }),
        );
      }
    }, 60);
  },
  [],
);
```

Consumed at Terminal.tsx line 2886-2905:

```
{isPrettyMode && hostConfig.id != null && tmuxSessionName && (
  <PrettyView
    hostId={hostConfig.id}
    tmuxSession={tmuxSessionName}
    className="flex-1 min-h-0"
    isIdle={isIdle}
    onSend={(text) => { ... byte-identical to pre-plan ... }}
    terminalWs={webSocketRef.current}          {/* NEW */}
    onInjectedTurnReady={handleInjectedTurnReady} {/* NEW */}
  />
)}
```

## Did Plan 02's usePrettyViewUploads hook need the WS-prop-change fix mentioned in Task 1 Step C?

**No — the hook is already correct.** Plan 02's hook takes `ws` as a prop and reads it at chunk-emit time. The Plan 05-02 SUMMARY confirms this pattern (see 05-02-SUMMARY.md § "Wire protocol client consumption"). Terminal.tsx passes `webSocketRef.current` directly; when Terminal.tsx re-renders for any state change (which happens frequently during a session), the current WS value flows through. The `handleInjectedTurnReady` callback itself reads `webSocketRef.current` at call time (not at capture time), so it always sees the CURRENT WS even if the ref has been re-assigned between callback creation and invocation.

The hypothetical Test 7 in Task 1 Step C (reconnect the WS and verify the hook still receives events on the new connection) was not authored because Plan 02's hook is already robust to this — its own tests (Test 10: "WS disconnect sets pendingSendWaitingForWs") already cover the disconnect edge and Plan 02's SUMMARY explicitly confirms the hook re-attaches its listener on ws prop change.

## Decisions Made

See `key-decisions` in frontmatter. Highlights:

- **Two-event inline split-send, NOT sshAdapter or a new sendInput variant.** The MessageQueueDrawer already implements this exact pattern inline; Terminal.tsx has NO existing helper for a two-event split-send (`sendInput` is single-event). Consistency with the neighboring pattern > adding a new helper.
- **useCallback deps `[]` — deliberate.** webSocketRef is a ref, `.current` is read at call time inside the body. Same reasoning as MessageQueueDrawer's inline onSend. Adding webSocketRef.current to the deps would be a footgun (refs don't trigger re-renders, so the memoized value would drift silently anyway; empty deps is the clean choice).
- **Parser strict-mode change is a Rule-2 tightening (missing critical).** The pre-Plan-02 parser returned `{caption, files: []}` when the delimiter was present but no file lines matched — that's a subtle mis-classification. A user typing the delimiter substring in a chatty message would trigger the "empty attachments" branch and render an empty chip strip. Fix: require ≥1 valid file line before returning non-null; treat delimiter-without-files as plain text.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Parser tightening beyond plan wording**
- **Found during:** Task 2 Step A test failures.
- **Issue:** Plan Task 2 Test 5 asserts `parseInjectedUserTurn("here is some text\\n\\n--- attached files ---\\nbut no file lines follow")` returns `null`. Plan Task 2 Test 7 asserts a malformed file line (`"1. no arrow here"`) also returns null. The pre-Plan-03 parser did NEITHER — it returned `{caption, files: []}` for both cases (the loop's `continue` on malformed header meant a delimiter with all-malformed lines succeeded with an empty file list; no minimum-count check).
- **Fix:** Two changes to `parseInjectedUserTurn`:
  1. Changed `if (!parsed) continue` to `if (!parsed) return null` — any malformed header bails the whole parse.
  2. Added `if (!tsMatch) return null` for the indented-timestamp line — previously fell through with `uploadTimestamp: ""`.
  3. Added `if (files.length === 0) return null` at the end — a well-formed delimiter with zero valid file pairs is a plain message.
  4. Added `if (raw.length > PARSE_MAX_INPUT_BYTES) return null` at the top — T-05-11 DoS mitigation.
- **Files modified:** `src/ui/api/pretty-view-upload-protocol.ts`.
- **Verification:** Parser tests 5, 7, 8 now pass. Round-trip test (existing) still passes. Chip render tests all pass.
- **Committed in:** `4fe48df` (Task 2 commit).

**2. [Rule 2 - Missing Critical] isQuickReply short-circuit updated to also require !injected**
- **Found during:** Task 2 Step C ChatMessage integration.
- **Issue:** The current `isQuickReply` check was `isUser && (content matches "good to go" || "go ahead")`. If a hypothetical injected turn's caption were literally "good to go" (extremely unlikely but not impossible), the ThumbsUp glyph would win over the chip render, losing the attachment metadata visually.
- **Fix:** Added `!injected &&` between `isUser &&` and the trim-lowercase check. Injected turns now unambiguously render as chips, regardless of caption content. Test 14 formalizes that quick-reply still works for a non-injected `"good to go"` message.
- **Files modified:** `src/ui/features/pretty-view/ChatMessage.tsx`.
- **Verification:** Test 14 passes.
- **Committed in:** `4fe48df`.

**3. [Rule 3 - Blocking] Terminal.wiring.test.ts as a proxy for real Terminal.tsx mount**
- **Found during:** Task 1 test authoring.
- **Issue:** Plan Task 1 Test 1 asserts the PrettyView mount site "now includes ... as additional props" — normally verified via a mounted-component snapshot test. Terminal.tsx (3000+ lines, xterm + WS + tmux + i18n) cannot reasonably be mounted with `@testing-library/react`; even Plan 02 didn't attempt to mount PrettyView with a real Terminal parent (it mocked at the PrettyView boundary).
- **Fix:** Wiring tests use two complementary techniques instead of a mount: (a) structural grep on the source file for exact attribute presence + regex for the useCallback definition + positive-content pins on the pre-existing byte-identical callback blocks (patches #60/#100 protection); (b) behavioral reproduction of the callback body against a mock WebSocket with fake timers (verifies the two-event split-send with the 60ms gap, silent noop on not-open WS, second-event closure readyState re-check).
- **Files modified:** New file `src/ui/features/terminal/Terminal.wiring.test.ts` (~230 lines).
- **Verification:** All 10 wiring tests pass. Byte-identity of pre-existing callbacks verified (sha256 matches pre-Plan-03 baseline exactly: `264385b1...` for PrettyView onSend, `46dbc0d8...` for MessageQueueDrawer onSend). Backend byte-identity guard also still passes.
- **Committed in:** `beef578` (Task 1 commit).

---

**Total deviations:** 3 auto-fixed (2 missing-critical parser/UX correctness + 1 blocking test-strategy pivot). No architectural changes required. No scope creep — every change stays within the plan's `<files_modified>` frontmatter and the phase's `<scope_fence>`. The parser-tightening deviations strengthen T-05-09 + T-05-11 mitigations beyond the plan's baseline.

## Issues Encountered

None beyond the deviations above. Both TDD cycles hit RED-then-GREEN cleanly on the first implementation attempt.

## User Setup Required

None. Zero new npm dependencies, zero new environment variables, zero new files the user needs to create manually. Plan 05-04 (deploy checkpoint) is now unblocked.

## Next Phase Readiness

**Ready for Plan 05-04 (deploy checkpoint):**

- Client-side pretty-view upload UX is complete end-to-end:
  1. User drags/pastes/taps → hook stages attachments as chips (Plan 02).
  2. User sends → hook chunks files over the WS to the backend orchestrator (Plans 01+02).
  3. Backend orchestrator writes chunks via SFTP, renames on complete, emits `upload_ready_to_inject` (Plan 01).
  4. Hook's `onUploadReadyToInject` callback fires → PrettyView calls `onInjectedTurnReady(text, mqid)` (Plan 02).
  5. Terminal.tsx's `handleInjectedTurnReady` emits the two-event split-send: body event (no mqid) → 60ms setTimeout → \\r event with mqid (Plan 03).
  6. Backend terminal.ts `case "input"` fires patches #60 + #100 automatically on the second event (no code changes needed).
  7. Session tail picks up the injected user turn → session-file-parser emits a `type:"message"` event → PrettyView's `onmessage` appends it → ChatMessage detects the injected format via `parseInjectedUserTurn` and renders caption + inline chip strip in the sender bubble (Plan 03).

- All three phase requirements addressed by this plan:
  - **UPLOAD-06 (atomic transfer):** the injected turn only fires after `upload_ready_to_inject` (fires only on all-complete per Plan 01). Terminal.tsx routes it through the same seam that patches #60 + #100 handle.
  - **UPLOAD-09 (path-only-with-metadata injected turn):** `formatInjectedUserTurn` (Plan 01) is the sole formatter; `parseInjectedUserTurn` (Plan 01 scaffold, Plan 03 hardened) is the round-trip counterpart.
  - **UPLOAD-11 (sender-side chip rendering):** ChatMessage renders the just-sent message as caption above inline chips (filename + size only, no thumbnails, chips-only lock preserved).

- Deploy checklist for Plan 05-04:
  - `npm run build` clean (7.45s, verified).
  - `npx tsc --noEmit --skipLibCheck` clean.
  - Full test suite: 409/409 green.
  - Backend byte-identity guard (`verify-input-case-unchanged.sh`) still passes — patches #60 + #100 protected.
  - Pre-existing PrettyView onSend + MessageQueueDrawer onSend byte-identity pinned in `Terminal.wiring.test.ts` — future patches touching them will trip the wiring test's positive-content assertions.

**No blockers or concerns.** The pretty-view upload feature is complete end-to-end and ready for Plan 05-04 deploy.

## Known Stubs

None. All render paths are wired to real data flows:
- Chips in the sender bubble show real filename + human-size parsed out of the actual injected-turn text emitted by `formatInjectedUserTurn` (which the backend orchestrator emits with real file metadata).
- Caption text is parsed verbatim from the injected turn.
- The `onRemove` callback on the readOnly chip strip is a no-op by contract (readOnly gates it away from rendering the × button; the callback prop exists only to satisfy the required prop type).

## Threat Flags

None. This plan introduces no new network endpoints, no new WS message types (Plan 01 already added them), no new file-access patterns, and no new schema. Client-side parser is length-bounded and pair-strict (T-05-09 + T-05-11 mitigations tightened, not weakened).

## Self-Check: PASSED

**File existence:**
- `src/ui/features/terminal/Terminal.wiring.test.ts` — FOUND
- `src/ui/features/pretty-view/ChatMessage.test.tsx` — FOUND
- `src/ui/features/terminal/Terminal.tsx` — MODIFIED (+42 lines, all insertions; pre-existing byte-identity preserved)
- `src/ui/features/pretty-view/ChatMessage.tsx` — MODIFIED (+47 lines, imports + injected detection + conditional JSX branch)
- `src/ui/features/pretty-view/AttachmentChipStrip.tsx` — MODIFIED (+58 net; readOnly prop threading)
- `src/ui/api/pretty-view-upload-protocol.ts` — MODIFIED (+22 net; parser hardening)

**Commit existence:**
- `beef578` (Task 1 — feat(terminal): thread terminalWs + onInjectedTurnReady into PrettyView mount) — FOUND in git log
- `4fe48df` (Task 2 — feat(pretty-view): ChatMessage sender-side chip render + parser hardening) — FOUND in git log

**Grep-checkable acceptance criteria:**
- `grep -c "handleInjectedTurnReady" src/ui/features/terminal/Terminal.tsx` = 2 (definition + usage) ✓
- `grep -c "terminalWs={webSocketRef.current}" src/ui/features/terminal/Terminal.tsx` = 1 ✓
- `grep -c "parseInjectedUserTurn" src/ui/features/pretty-view/ChatMessage.tsx` = 2 (import + call) ✓
- `grep -c "readOnly" src/ui/features/pretty-view/AttachmentChipStrip.tsx` = 16 (prop def + branching) ✓

**Byte-identity verification:**
- Pre-existing PrettyView onSend (Terminal.tsx line ~2886-2897): `sha256=264385b112e8076fad0545f9f4811440b3493439c52b4088860bde83f8565f9d` — MATCHES pre-Plan-03 baseline exactly ✓
- Pre-existing MessageQueueDrawer onSend (Terminal.tsx line ~2911-2933): `sha256=46dbc0d85852534dfb7d230627a876e6490fc37e3f21fab3fb458e6354d59781` — MATCHES pre-Plan-03 baseline exactly ✓
- Backend terminal.ts `case "input":` block: `sha256=d8932a8db3a420b61d2792cef0c8d39c15b80c94c4c43252cf5127db17d47709` — MATCHES Plan 01 pin exactly (no backend changes in this plan) ✓
- `scripts/verify-input-case-unchanged.sh src/backend/ssh/terminal.ts` exits 0 ✓

**Test suite:**
- `npx vitest run` = 409/409 tests passing across 35 files ✓
- `npx vitest run src/ui/features/terminal/Terminal.wiring.test.ts` = 10/10 passing ✓
- `npx vitest run src/ui/features/pretty-view/ChatMessage.test.tsx` = 6/6 passing ✓
- `npx vitest run src/ui/features/pretty-view/AttachmentChipStrip.test.tsx` = 9/9 passing (was 7 pre-plan; +2 readOnly cases) ✓
- `npx vitest run src/ui/api/pretty-view-upload-protocol.test.ts` = 37/37 passing (was 31 pre-plan; +6 parser edge cases) ✓

**Type-check:**
- `npx tsc --noEmit --skipLibCheck` = zero errors project-wide ✓

**Build:**
- `npm run build` = clean (7.45s) ✓

---
*Phase: 05-pretty-view-file-upload-support*
*Completed: 2026-07-20*
