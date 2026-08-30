# Phase 5 Plan Check — pretty-view file upload support

**Checked:** 2026-07-20
**Checker:** gsd-plan-checker (goal-backward verification)
**Plans reviewed:** 05-01, 05-02, 05-03, 05-04

## Overall verdict: **PASS_WITH_NOTES**

All four plans are internally coherent, respect the CONTEXT.md LOCKED decisions, and collectively cover every UPLOAD-NN requirement and every Success Criterion. Every load-bearing fork-specific gotcha is honored (patch #60/#100 preservation, useIsTouchDevice reuse, $HOME resolution via sftp.realpath, no attachment-byte persistence). The plans are ready for Ashley's execution green-light.

Notes are non-blocking design tensions that Ashley may want to be aware of before executing (chiefly: Plan 02 discloses a retry-semantics deviation from Plan 01's protocol and Plan 04's "zero source diffs" pattern claim isn't perfectly matched by Phase 1 and Phase 2's actual deploy checkpoints — this is a doc nit, not a plan defect).

## Per-plan verdicts

| Plan | Wave | Tasks | Files | Verdict | Notes |
|------|------|-------|-------|---------|-------|
| 05-01 | 1 | 2 | 3 | **PASS** | Backend orchestrator + wire protocol + injected-turn formatter — all 8 STRIDE threats mitigated at ingress; case "input" byte-identity called out; SFTP via ssh2 (already in deps); `$HOME` via `sftp.realpath('.')` |
| 05-02 | 2 | 3 | 6 | **PASS_WITH_NOTES** | Client UX + orchestrator hook; retry-semantics deviation from Plan 01's protocol is disclosed inline (retry generates FRESH mqid, not reuse); patch #57 preservation asserted via grep gate; no localStorage/IndexedDB check |
| 05-03 | 3 | 2 | 3 (Terminal.tsx, PrettyView.tsx, ChatMessage.tsx) | **PASS** | Terminal.tsx wiring is surgical (< 40 lines); handleInjectedTurnReady mirrors MessageQueueDrawer's line-2869 pattern byte-for-byte; parseInjectedUserTurn is round-trip-safe; T-05-11 regex-DoS length-bound |
| 05-04 | 4 | 3 auto + 1 checkpoint | 2 (both .md — zero source diffs) | **PASS** | Build verify + UAT + patches-md-entry all present; mandatory 15-min deadman flow spelled out verbatim from deploy-runbook.md; UAT walks all 14 UPLOAD-NN |

## Requirement coverage matrix (UPLOAD-01..14 → covering plan)

| Req | Description (abbrev.) | 05-01 | 05-02 | 05-03 | 05-04 | Status |
|-----|-----------------------|-------|-------|-------|-------|--------|
| UPLOAD-01 | Drag-drop overlay + staging | | ✓ | | ✓ (UAT) | COVERED |
| UPLOAD-02 | Clipboard paste as attachment | | ✓ | | ✓ (UAT) | COVERED |
| UPLOAD-03 | Mobile-only paperclip via useIsTouchDevice | | ✓ | | ✓ (UAT) | COVERED |
| UPLOAD-04 | Chip strip staging, no empty chrome | | ✓ | | ✓ (UAT) | COVERED |
| UPLOAD-05 | Per-chip progress indicator | | ✓ | | ✓ (UAT) | COVERED |
| UPLOAD-06 | Atomic transfer semantics | ✓ (backend) | ✓ (client) | ✓ (wiring) | ✓ (UAT) | COVERED |
| UPLOAD-07 | Retry + queue-locally-on-disconnect | | ✓ | | ✓ (UAT) | COVERED |
| UPLOAD-08 | Caption persists, bytes don't | | ✓ | | ✓ (UAT) | COVERED |
| UPLOAD-09 | Path-only injected metadata block | ✓ (formatter) | | ✓ (wiring) | ✓ (UAT) | COVERED |
| UPLOAD-10 | ~/pretty-view-uploads/<date>/<time>-<name> | ✓ (backend) | | | ✓ (UAT) | COVERED |
| UPLOAD-11 | Sender-side chip render in bubble | | | ✓ (ChatMessage) | ✓ (UAT) | COVERED |
| UPLOAD-12 | Folder-drop refused | | ✓ | | ✓ (UAT) | COVERED |
| UPLOAD-13 | One caption per batch, empty allowed | | ✓ | | ✓ (UAT) | COVERED |
| UPLOAD-14 | Works on any pane (Claude or plain shell) | ✓ (backend) | | | ✓ (UAT) | COVERED |

**Coverage: 14/14 requirements — every UPLOAD-NN appears in ≥1 plan's `requirements` frontmatter AND is implemented by concrete task(s).** No unmapped requirements. No bogus requirements.

## Success Criteria coverage (SC1..SC6 → proving plan)

The 6 SCs from ROADMAP.md Phase 5:

| SC | Description (abbrev.) | Proven by | Verified in |
|----|-----------------------|-----------|-------------|
| SC1 | Any pane can drag/paste/(mobile-tap), stage chips, remove chips, send with optional caption | Plan 02 Tasks 1-3 (hook + chip strip + ComposeBox wiring) + Plan 03 Task 1 (Terminal.tsx wiring) | Plan 04 UAT (Desktop happy-path section, Clipboard paste section, Mobile paperclip section) |
| SC2 | Injected user turn only appears once every file has landed; failure → chips red, message stays in staging | Plan 01 Task 2 (upload_ready_to_inject only fires on all-files-complete) + Plan 02 Task 1 (hook consumes upload_ready_to_inject callback; failure sets chip status='error', batchInFlight=false) | Plan 04 UAT (Failure recovery + retry section) |
| SC3 | Injected message contains caption + per-file metadata (filename/size/mimetype/timestamp/path); bytes NEVER inlined | Plan 01 Task 1 (formatInjectedUserTurn: caption + delimited block, no bytes) + Plan 03 Task 1 (Terminal.tsx invokes formatter output as SSH input) | Plan 04 UAT (Desktop happy-path UPLOAD-09 check: inspect tail content) |
| SC4 | Paperclip invisible on desktop; folder-drop refused; sender-side chip-only (no thumbnails); caption survives, bytes don't | Plan 02 Task 3 (useIsTouchDevice gate) + Plan 02 Task 1 (folder detection) + Plan 03 Task 2 (readOnly chip strip in ChatMessage) + Plan 02 Task 1 (React-only staging state, no persistence) | Plan 04 UAT (Mobile paperclip negative-space, Folder rejection, Draft persistence asymmetry sections) |
| SC5 | Zero regression to plain-text send, WipBubble, PlanPendingBubble, drawer, identity badge, session-changeover, keyboard chords, patch #60, patch #100 | Plan 01 Task 2 (case "input" byte-identity verified via awk-diff) + Plan 03 Task 1 (existing PrettyView onSend + MessageQueueDrawer onSend byte-identical) + Plan 04 Task 1 (build verify greps for load-bearing bytes in dist) | Plan 04 UAT (Regression smoke section — walks patches #57, #60, #100, #102 + terminal/RDP/VNC/dashboard/sidebar) |
| SC6 | Works on Claude Code AND plain-shell panes; metadata block meaningful to human at shell | Plan 01 Task 2 (orchestrator only requires sshConn + writable $HOME; no Claude/tmux/identity assumption) + Plan 01 Task 1 (formatInjectedUserTurn output is human-legible) | Plan 04 UAT (Works-on-any-pane section: test on plain shell pane, cat the landing path) |

**Coverage: 6/6 Success Criteria — every SC has an implementation plan AND a UAT verification path.**

## HARD LOCK / LOCKED decision checks

CONTEXT.md's `<decisions>` block was audited task-by-task against every plan's `<action>`. All LOCKED items honored:

- ✅ **Path-only injection (HARD LOCK)** — Plan 01 Task 1's `formatInjectedUserTurn` emits caption + delimited metadata block; NO branch for inlined file bytes. Plan 03 Task 2's `parseInjectedUserTurn` inverts the same format. Grep gate: acceptance criterion "`INJECTED_DELIMITER` value is exactly the string `--- attached files ---`" locks the delimiter.
- ✅ **Atomic transfer (HARD LOCK)** — Plan 01 Task 2's orchestrator only emits `upload_ready_to_inject` after every file in the batch reaches `completed = true`; Plan 02 Task 1's hook only invokes `onUploadReadyToInject` callback when server emits that event; Plan 03 Task 1's `handleInjectedTurnReady` is the only place the injected turn ships. Zero paths to "inject before all files land."
- ✅ **Ride existing per-pane SSH WebSocket** — Plan 01 Task 2 wires three NEW cases in `src/backend/ssh/terminal.ts`; no new WebSocketServer, no new HTTP route, no new port. `case "input"` remains byte-identical.
- ✅ **Mobile paperclip gated on useIsTouchDevice (patch #102), NOT window width** — Plan 02 Task 3 imports `useIsTouchDevice` from `@/hooks/use-is-touch-device` at PrettyView layer and threads it as `showPaperclip` prop; verified consumer already in AppShell.tsx line 241. No `window.innerWidth` in any plan.
- ✅ **Attachment bytes NEVER persisted client-side** — Plan 02 Task 1 explicitly asserts "All state is React-only (`useState`, `useReducer`, `useRef`). NO localStorage, NO IndexedDB, NO sessionStorage." Acceptance criterion adds a `grep` gate: "Does NOT import `localStorage`, `sessionStorage`, `indexedDB`, or any persistence primitive."
- ✅ **Caption persistence uses existing primitive (patch #57's compose-drafts)** — Plan 02 Task 3 acceptance criterion: "Existing patch #57 compose-drafts imports (`putComposeDraft`, `flushComposeDraftKeepalive`) STILL present in ComposeBox — attachment feature did NOT accidentally rewrite the draft path." Verified: `src/ui/features/pretty-view/ComposeBox.tsx` lines 7-9 + 204/261/277/333 use these primitives; plans do not touch them.
- ✅ **Source machine NOT in metadata block** — Plan 01 Task 1 explicit note "Do NOT include source machine or user in the metadata block (CONTEXT.md locks this)." formatInjectedUserTurn signature accepts only `{caption, files: [{filename, size, mimetype, uploadTimestamp, landingPath}]}` — no machine field.
- ✅ **No auto-cleanup on receiving side** — Plan 01 Task 2 backend orchestrator has NO sweep policy, no cron, no delete-old-uploads path.
- ✅ **One caption per batch** — Plan 02 Task 1 hook exposes a single `startBatch(caption: string)` — no per-file captions in the state shape.
- ✅ **Extends patch #60 messageQueueItemId lifecycle, not parallel** — Plan 01 Task 1 uses the same `messageQueueItemId` field name; Plan 02 Task 1 generates it via crypto.randomUUID; Plan 03 Task 1 threads it through the same `case "input"` handler on the second event. No new id namespace.
- ✅ **Path resolved via sftp.realpath('.'), NEVER hardcoded** — Plan 01 Task 2 explicit "HOME resolved via `sftp.realpath('.')` at upload_start, NEVER string-concatenated with hardcoded `/home/...`". Truth in `must_haves.truths`.

No HARD LOCK / LOCKED decision violations detected.

## Scope fence checks

CONTEXT.md `<scope_fence>` was audited against every plan's `files_modified`. No violations:

- ✅ Terminal tab bar, RDP/VNC panes, message queue drawer chrome, session-file tail / WS bridge, identity registry, host records, Filestash, Caddy — none touched by any plan
- ✅ SSH connection lifecycle / authentication — untouched (uploads ride existing authenticated per-pane WS)
- ✅ No new HTTP endpoint or new WebSocket (three new WS *message types* on the existing WS; distinct from a new WS)
- ✅ No auto-cleanup policy (Plan 01 orchestrator has none)
- ✅ No client-side persistence of attachment bytes (Plan 02 explicit + acceptance criterion grep gate)
- ✅ No source machine in metadata (Plan 01 explicit + shape confirms)
- ✅ No configurable landing paths (`~/pretty-view-uploads/<yyyy-mm-dd>/<hhmmss>-<name>` is hardcoded in Plan 01 Task 2 Step A)
- ✅ No new npm dependencies (Plan 01 Task 2 explicit: "No new npm dependencies. `ssh2` is already imported at the top of terminal.ts"; Plan 04 Task 1 grep gate: `git diff --stat package.json` returns empty)
- ✅ No new nginx location blocks (Plan 04 Task 1 grep gate: `git diff --stat docker/nginx.conf docker/nginx-https.conf` returns empty)
- ✅ No new port (uploads ride terminal WS on port 30003, already exposed)

No scope fence violations detected.

## Threat model coverage

Phase kickoff enumerated 8 threats; the 4 blocking ones (path traversal, symlink write, disk-fill, delimiter collision in filename) MUST be mitigated at plan time. Full audit:

| Threat | Plan 01 mitigation | Coverage |
|--------|--------------------|----------|
| T-05-01 Path traversal | `sanitizeFilenameForUpload` rejects `/`, `\`, null bytes, `..`, leading-dot, length > 200; grep gate: filename `"../etc/passwd"` → `upload_failed` reason `invalid_filename`, `createWriteStream` NEVER called (Test 1) | ✅ BLOCKED at ingress |
| T-05-02 Symlink write | `sftp.createWriteStream(tempPath, { flags: 'wx' })` — fails-if-exists; landing dir via `sftp.realpath('.')`; test 5 asserts `flags: 'wx'` on mock | ✅ BLOCKED at ingress |
| T-05-03 Disk fill | Size caps at upload_start: MAX_PER_FILE = 500MB, MAX_PER_BATCH = 2GB; running counter during chunking → `size_overflow` + unlink; tests 2, 3, 7 | ✅ BLOCKED at ingress + during chunking |
| T-05-05 Delimiter collision in filename | `sanitizeFilenameForUpload` rejects filenames containing `--- attached files ---` OR any line starting with `--- `; test 12 asserts | ✅ BLOCKED at ingress |
| T-05-04 Mimetype spoof | Accepted per shape (informational only; agent posture handles) | ✅ Explicit acceptance |
| T-05-06 Prompt-injection via filenames | Accepted (agent handles untrusted filenames) | ✅ Explicit acceptance |
| T-05-07 CSRF/unauthenticated upload | Reuses existing `sshConn && userId && currentSessionId` auth gate from `case "input"` | ✅ No new surface |
| T-05-08 Chunk out-of-order | Validates offset === nextExpectedOffset; test 6 asserts | ✅ BLOCKED |

Additional Plan 03 threats:
| T-05-09 Delimiter false-match in parser | Strict pattern match (delimiter on line 3, file-line regex `^\d+\. .+ \(.+, .+\) → .+$`); tests 5, 6, 7 assert false-match resistance | ✅ Mitigated |
| T-05-10 WS message forgery injecting fake chips | Explicit acceptance — tail is trusted; display-only concern | ✅ Explicit acceptance |
| T-05-11 Regex DoS | Length-bound (1MB); linear per-line scans; no catastrophic backtrack; test 8 asserts | ✅ Mitigated |

All 4 blocking threats mitigated at plan time. All acceptance decisions explicit. No threat model gaps.

## Anti-shallow rule spot-checks

Randomly spot-checked 5 tasks across plans for `<read_first>` presence + `<acceptance_criteria>` concreteness + concrete identifiers in `<action>`:

**Plan 01 Task 1** (protocol types + formatter):
- `<read_first>` — 4 files (claude-session-api.ts as structural template, compose-drafts-api.ts as shape reference, CONTEXT.md decisions block, patch #60 entry for mqid field convention) ✓
- `<acceptance_criteria>` — 5 concrete assertions with grep gates ✓
- `<action>` names concrete identifiers: `UploadStartPayload`, `UploadChunkPayload`, `UploadFailureReason`, `MAX_PER_FILE_BYTES`, `INJECTED_DELIMITER`, `formatHumanSize`, `formatInjectedUserTurn`, `sanitizeFilenameForUpload` — 8+ concrete names ✓

**Plan 01 Task 2** (backend orchestrator + terminal.ts wiring):
- `<read_first>` — 7 files with specific line ranges (`terminal.ts:469-585` for case "input", `terminal.ts:187-190` for WS scope, `file-manager-session.ts:122-170` for SFTP pattern, etc.) ✓
- `<acceptance_criteria>` — 12 concrete assertions including grep gates ✓
- `<action>` names concrete: `handleUploadStart`, `handleUploadChunk`, `handleUploadAbort`, `emitEvent`, `cleanupBatchesForConnection`, `activeBatches: Map<...>`, `sftp.realpath('.')`, `sftp.createWriteStream(tempPath, { flags: 'wx' })` — deeply concrete ✓

**Plan 02 Task 1** (usePrettyViewUploads hook):
- `<read_first>` — 6 items with specific line references and rationale (protocol module, test file, CONTEXT decisions, use-auto-scroll as hook idiom reference, patch #60 offset in skynet-patches.md) ✓
- `<acceptance_criteria>` — 8 concrete assertions with grep gates (return shape, imports, `crypto.randomUUID` occurrences, `File.slice(...).arrayBuffer()` occurrence, 14 vitest tests) ✓
- `<action>` names concrete: `stageAttachments`, `startBatch(caption)`, `retryBatch`, `resetBatch`, `onWsReconnect`, `MAX_CONCURRENT_UPLOADS_PER_BATCH`, `getBufferedAmount` — 7+ concrete names ✓

**Plan 03 Task 1** (Terminal.tsx wiring):
- `<read_first>` — 7 items with line ranges (`Terminal.tsx:2820-2900` PrettyView mount, `Terminal.tsx:780-795` sendInput impl, `Terminal.tsx:2869` MessageQueueDrawer pattern, PrettyView.tsx props, patch #60 offset, patch #100 offset) ✓
- `<acceptance_criteria>` — 9 concrete grep gates ✓
- `<action>` shows the exact useCallback shape with all identifiers: `handleInjectedTurnReady`, `webSocketRef.current`, `messageQueueItemId`, exact timing (60ms) ✓

**Plan 04 Task 4** (deploy checkpoint):
- `<what-built>` — accurately synthesizes Plans 01-04 output ✓
- `<how-to-verify>` — 9-step deploy sequence with exact commands (`sudo touch /tmp/skynet-keep-patched`, deadman-arm nohup line, force-recreate) ✓ — matches deploy-runbook.md
- `<resume-signal>` — precise Ashley-facing phrase ✓

No anti-shallow rule violations. Every spot-checked task has read-first prereqs, concrete acceptance criteria, and named identifiers in actions.

## Wave dependency validation

| Plan | depends_on | Actual shared-file evidence | Verdict |
|------|-----------|-----------------------------|---------|
| 05-01 | `[]` (Wave 1) | Foundation — creates the shared protocol module | ✓ Correct |
| 05-02 | `["05-01"]` (Wave 2) | Imports `PrettyViewUploadServerEvent` from `pretty-view-upload-protocol.ts` (created by 05-01); Plan 01 Summary consumed | ✓ Correct |
| 05-03 | `["05-01", "05-02"]` (Wave 3) | Imports `formatInjectedUserTurn` (Plan 01) AND consumes `usePrettyViewUploads` hook (Plan 02) AND `AttachmentChipStrip` (Plan 02); shares PrettyView.tsx with Plan 02 (Plan 02 mounts DropOverlay + hook; Plan 03 adds new props) — but Plan 02's edits are declared complete before Plan 03 runs (serial) so this is OK ✓ | ✓ Correct |
| 05-04 | `["05-01", "05-02", "05-03"]` (Wave 4) | Deploy checkpoint; consumes all three summaries | ✓ Correct |

**File-overlap concern (WARNING, not blocker):** Plans 02 and 03 both modify `src/ui/features/pretty-view/PrettyView.tsx`. Plan 02 mounts DropOverlay + wires `usePrettyViewUploads`; Plan 03 adds `terminalWs` + `onInjectedTurnReady` props and modifies the existing `usePrettyViewUploads` call to route through `formatInjectedUserTurn`. Since Plan 03's `depends_on: ["05-01", "05-02"]` declares this dependency, sequential execution is correct — but the executor must ensure Plan 02's PrettyView.tsx edits land first. This is standard serial-wave discipline; not a defect.

**Similar concern for ComposeBox.tsx and ChatMessage.tsx:** Only Plan 02 touches ComposeBox.tsx and only Plan 03 touches ChatMessage.tsx — no overlap. ✓

## Deploy checkpoint discipline (Plan 05-04)

Plan 05-04 was checked against the pattern of Phase 1 (01-05) and Phase 2 (02-03):

| Metric | Phase 1 (01-05) | Phase 2 (02-03) | Phase 5 (05-04) | Verdict |
|--------|-----------------|-----------------|-----------------|---------|
| autonomous | false | false | false | ✓ Match |
| Source diffs | nginx configs (necessary for new WS route) | Settings toggle + i18n (small D-104/D-105 additions) | ZERO source diffs | ✓ Cleaner than reference plans |
| Task with checkpoint gate | Yes (Task 3) | Yes (Task 3) | Yes (Task 4) | ✓ Match |
| Deadman flow spelled out | Yes | Yes | Yes (exactly matches deploy-runbook.md 9-step sequence) | ✓ Match |
| Build verify + grep gates | Partial | Yes (patch #60 preservation greps) | Yes (patches #57, #60, #100, #102 + Phase 5 tokens) | ✓ Stronger than reference |
| UAT checklist artifact | 01-05 has one | 02-03 has one | 05-UAT-CHECKLIST.md drafted | ✓ Match |
| Patches-md-entry artifact | Not required in 01-05 | Not required in 02-03 | 05-PATCHES-MD-ENTRY.md drafted | ✓ Stronger than reference |

**Minor doc nit (user question 8):** The user claim "Phase 1's 01-05-PLAN.md and Phase 2's 02-03-PLAN.md — ZERO source diffs" is not perfectly accurate. Phase 1 modified nginx configs and Phase 2 modified UserProfilePanel.tsx + en.json. Phase 5's 05-04 is stricter (truly zero source diffs) because uploads ride the existing WS and don't add a toggle. This is a positive divergence, not a defect. If Ashley wants to enforce the "zero source diffs" rule strictly going forward, that's a policy decision worth stating; if the ROADMAP wants to codify it, that's a separate documentation task.

## Fork-specific gotcha compliance

| Gotcha | Compliance |
|--------|-----------|
| No modification to existing `case "input":` bytes in terminal.ts | ✅ Plan 01 Task 2 Step C explicitly extracts input case block before edits + diffs after; Test 11 formalizes byte-identity; acceptance criterion includes it |
| Landing path uses `$HOME` via `sftp.realpath('.')`, not hardcoded `/home/<user>/` | ✅ Plan 01 Task 2 Step A step 7 explicit; must_haves.truths lock this ("HOME resolved via SFTP realpath('.'), NEVER hardcoded"); works on Linux + Windows-via-OpenSSH |
| `useIsTouchDevice` from patch #102 is the sole gate for mobile paperclip | ✅ Plan 02 Task 3 Step F step 7 threads it via PrettyView; ComposeBox receives as `showPaperclip` prop; verification includes `grep -c "useIsTouchDevice" src/ui/features/pretty-view/PrettyView.tsx` returns exactly 1 |
| Caption persistence uses existing compose-drafts primitive (patch #57 in code, docs sometimes say patch #49) | ✅ Plan 02 preserves `putComposeDraft` / `flushComposeDraftKeepalive` (grep gate) — the ACTUAL identifiers are validated, resolving the doc/code patch-number drift |
| Attachment bytes NEVER localStorage/IndexedDB | ✅ Plan 02 Task 1 grep gate: `grep -E "localStorage|sessionStorage|indexedDB" src/ui/features/pretty-view/use-pretty-view-uploads.ts` returns 0 |
| Chunk size 64KB, per-file cap 500MB, per-batch cap 2GB, 3 concurrent uploads | ✅ Plan 01 Task 1 Test E: `CHUNK_SIZE_BYTES = 64 * 1024`, `MAX_PER_FILE_BYTES = 500 * 1024 * 1024`, `MAX_PER_BATCH_BYTES = 2 * 1024 * 1024 * 1024`, `MAX_CONCURRENT_UPLOADS_PER_BATCH = 3` — matches CONTEXT.md recommendations exactly |
| Backend files land in `src/backend/ssh/`, UI in `src/ui/features/pretty-view/`, shared protocol in `src/ui/api/` | ✅ Plans 01/02/03 file paths comply exactly with fork convention |

All fork gotchas honored.

## Warnings (non-blocking)

### W-1: Plan 02 discloses a protocol deviation from Plan 01

Plan 02 Task 1's `<action>` includes this text:

> "**DECISION FOR THIS PLAN:** since Plan 01 defines the protocol without an `upload_reset` message, the hook uses the SIMPLER path: on retry, re-upload ALL files under a NEW messageQueueItemId."

This creates a subtle coupling issue: Plan 02 Task 1 test 9 says "reuses SAME messageQueueItemId" but then the action text says the final decision is to use a NEW messageQueueItemId. The test description contradicts the action decision. Fix: reconcile before execution — either (a) update test 9 to assert NEW mqid on retry, or (b) add `upload_reset` to Plan 01's protocol (would require a Plan 01 revision).

**Severity: WARNING** — execution will proceed but the executor should update test 9 to match the action's actual semantics (NEW mqid on retry). This is a spec-vs-test inconsistency internal to Plan 02, not a blocker to Plan 01 or Plan 03.

**Recommendation to planner (if a revision is desired):** Simplest fix — edit Plan 02 Task 1 behavior list Test 9 to read: "calling `retryBatch()` after a failure generates a FRESH `messageQueueItemId` and emits a new `upload_start` with all still-staged files (successful ones NOT re-uploaded); the batch state resets internally to the new mqid." Ashley or execution agent can also do this fix inline; not worth revising the plan for.

### W-2: Plan 02 file-overlap with Plan 03 on PrettyView.tsx and AttachmentChipStrip.tsx

Plan 02 creates AttachmentChipStrip.tsx and modifies PrettyView.tsx; Plan 03 also modifies AttachmentChipStrip.tsx (adds `readOnly` prop) and PrettyView.tsx (adds `terminalWs`/`onInjectedTurnReady` props). Both plans declare correct `depends_on` (Plan 03 depends on 05-01 and 05-02). Serial execution handles this cleanly; no defect. Called out for executor awareness.

**Severity: WARNING (informational)** — no action required; standard serial-wave file-overlap.

### W-3: Plan 04 grep gate for `pretty-view-upload.js` dist path assumes Vite/tsc dist layout

Plan 04 Task 1 Step B grep checks `dist/backend/backend/ssh/pretty-view-upload.js`. This double-`backend/backend/` path matches the fork's existing dist layout (verified by `dist/backend/backend/ssh/terminal.js` in patch #60's verify commands). If Ashley's Vite/tsc config changes between now and execution, this grep might miss. Low probability, but worth noting.

**Severity: WARNING (informational)** — the acceptance criterion is otherwise correct.

## Blockers

**None.** No BLOCKER-severity issues found. All plans are safe to execute after Ashley's green-light.

## Hand-off notes for Ashley

1. **Execution order is strict Wave 1 → 2 → 3 → 4** — Plan 01 must complete first (it defines the shared protocol types that Plans 02 and 03 import). Plans 02 and 03 cannot run in parallel (both touch PrettyView.tsx and AttachmentChipStrip.tsx). Plan 04 waits for all three.

2. **W-1 recommendation for Plan 02 execution:** Before running Plan 02, update Test 9 wording to reflect the "NEW mqid on retry" semantics the action text locked in. Otherwise TDD will find a spec-vs-implementation mismatch in test 9 and stall. One-line fix.

3. **Load-bearing bytes to watch on rebase:** After execution, the load-bearing bytes that MUST survive are: patch #60 (`message_queue_delete_on_send`), patch #100 (`ssh_input_delayed_enter`), patch #57 (`putComposeDraft` / `flushComposeDraftKeepalive`), patch #102 (`pointer: coarse`). Plan 04 Task 1 has grep gates for all four.

4. **Zero-diff surfaces to protect:** `docker/nginx.conf`, `docker/nginx-https.conf`, `package.json`, `package-lock.json`, the `case "input":` block in `src/backend/ssh/terminal.ts` (lines 469-585 pre-change), the existing PrettyView `onSend` callback in `src/ui/features/terminal/Terminal.tsx:2846`, and the MessageQueueDrawer `onSend` at `Terminal.tsx:2869`.

5. **Deploy discipline reminder:** Plan 04 Task 4 spells out the mandatory 15-min deadman flow verbatim from `~/.claude/identities/tina/deploy-runbook.md`. Blanket pre-authorization for the code work does NOT authorize the deploy per Ashley 2026-07-12. Explicit per-deploy green-light required BEFORE the checkpoint's step 1 (build + push).

6. **Bounty status:** Once UAT green + patch pinned, close the bounty at `~/.claude/identities/tina/bounties/pretty-view-file-upload-support/` via `/close pretty-view-file-upload-support`.

7. **Post-deploy verify command Ashley may want to keep handy:**
   ```
   docker exec skynet grep -c 'case "upload_start":' /app/dist/backend/backend/ssh/terminal.js
   # → should return 1
   ```

## PLAN CHECK COMPLETE

**Verdict: PASS_WITH_NOTES.** All four plans are approved for execution. Two minor warnings (W-1 test-vs-action inconsistency in Plan 02; W-3 dist-path assumption in Plan 04) can be resolved inline during execution; neither blocks the phase goal.
