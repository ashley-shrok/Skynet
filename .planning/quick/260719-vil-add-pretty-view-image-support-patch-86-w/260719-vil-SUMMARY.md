---
phase: quick
plan: 260719-vil
subsystem: ui
tags: [pretty-view, claude-session, websocket, jsonl, base64, image, react]

# Dependency graph
requires:
  - phase: 02-live-session-stream-plus-read-only-view
    provides: session-file-parser + claude-session-server WS bridge + PrettyView component (extended here for images)
provides:
  - kind:"image" variant on session-file-parser's ParsedLine union
  - extractImageRefs() helper (canonical + CC-local dedup)
  - type:"image" WS frame on the claude-session bridge
  - ImageEvent + ImageBlock discriminated-union types on the frontend API
  - ImageBubble React component (assistant identity-hue Glass)
  - PrettyView StreamEvent union + case "image" WS dispatch
affects: [pretty-view, claude-session, ashley-fleet-review-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wire-inline base64 for images (~150KB PNG typical) — pretty-view is WS-only architecture, no HTTP endpoint to bolt onto"
    - "Discriminated-union stream events (ChatMessageEvent | ImageEvent) with shared eventId dedup"
    - "Aesthetic parity by token replication — ImageBubble copies ChatMessage assistant branch gradient/border/shadow byte-for-byte"

key-files:
  created:
    - src/backend/claude-session/session-file-parser.test.ts
    - src/ui/features/pretty-view/ImageBubble.tsx
  modified:
    - src/backend/claude-session/session-file-parser.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
    - src/ui/features/pretty-view/PrettyView.tsx

key-decisions:
  - "Role derivation for image bubbles: any tool_result-associated image (canonical toolUseId OR CC-local obj.toolUseResult presence) gets role='tool_result'; bare image content blocks keep their JSONL role"
  - "Dedup between canonical and CC-local paths: CC-local scan runs only when canonical scan yielded zero refs (both paths carry the same b64 in the common case)"
  - "ImageBubble always uses assistant identity-hue treatment regardless of role — the Read was invoked by the assistant so the image lives on the assistant side"
  - "12px padding on ImageBubble (vs. 18/14px on ChatMessage) — images want tighter breathing room than prose"
  - "Image bubbles interleave with text messages in the same messages[] state, dedup by eventId — strict wire order preserves chronological 'agent read this image' semantic"

patterns-established:
  - "Two-path scan + late-dedup: canonical Anthropic shape scanned first, Claude-Code-local convenience shape only when canonical was empty"
  - "Role widening on ParsedLine variants — ImageMessage adds 'tool_result' role that ConversationalMessage does not have"

requirements-completed: []

# Metrics
duration: ~15min
completed: 2026-07-19
---

# Quick 260719-vil: Pretty-View Image Support (patch #86) Summary

**JSONL parser emits kind:"image" variant, WS bridge forwards as {type:"image"} frame, PrettyView renders as assistant-identity-hue Glass ImageBubble with inline base64 <img>s — end-to-end image visibility on Read/tool_result events.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-19T22:48Z (approx.)
- **Completed:** 2026-07-19T22:56Z
- **Tasks:** 3
- **Files modified:** 4 (+ 2 created)

## Accomplishments

- Parser extension: `kind:"image"` variant with dedup between canonical `message.content[].tool_result.content[].image` and CC-local `obj.toolUseResult.file.base64` paths.
- WS wire-protocol extension: new `type:"image"` frame carries `role`, `images[]` (raw b64), `text`, `eventId`, `ts`. Wire-protocol comment block updated with payload-size rationale.
- Frontend types: `ImageBlock` + `ImageEvent` folded into `ClaudeSessionServerEvent` discriminated union.
- `ImageBubble` component: aesthetic parity with ChatMessage assistant branch (gradient/border/shadow tokens byte-identical), 12px padding, no markdown, no click-to-zoom, no `!` overrides.
- PrettyView wired: `StreamEvent = ChatMessageEvent | ImageEvent` union, `case "image":` dispatched via same `appendDedup(messages, parsed)` path, render branches on `m.type`.
- 9-case vitest suite for the parser: canonical, bare, CC-local, dedup, mixed text+image, multi-image, no-image regression, harness_wrapper with/without images.

## Task Commits

Each task was committed atomically:

1. **Task 1: Extend parser with kind:"image" variant + extractImageRefs + unit tests** — `5a8b166` (feat)
2. **Task 2: Emit type:"image" WS frame from claude-session-server + add ImageEvent to WS API union** — `2b1a703` (feat)
3. **Task 3: Create ImageBubble component + wire type:"image" case in PrettyView** — `ab20b18` (feat)

_Docs commit (SUMMARY.md, STATE.md, ROADMAP.md) is deferred to the orchestrator per constraints._

## Files Created/Modified

- `src/backend/claude-session/session-file-parser.ts` — modified: added `ImageBlock`, `ImageMessage`, `ParsedLine` widened, `extractImageRefs()` function, hard-lock comment revised to note the patch #86 image exception, empty-content skip + harness_wrapper skip now bypassed when images present.
- `src/backend/claude-session/session-file-parser.test.ts` — created: 9-case vitest suite.
- `src/backend/claude-session/claude-session-server.ts` — modified: wire-protocol comment block updated (new entry + payload-size paragraph), `kind === "image"` emit branch added alongside `kind === "message"`.
- `src/ui/api/claude-session-api.ts` — modified: `ImageBlock` + `ImageEvent` exported, added to `ClaudeSessionServerEvent` union (adjacent to `MessageEvent`).
- `src/ui/features/pretty-view/ImageBubble.tsx` — created: presentational component, assistant identity-hue Glass, inline base64 `<img>`s.
- `src/ui/features/pretty-view/PrettyView.tsx` — modified: imports `ImageBubble` + `ImageEvent`, `StreamEvent` type alias, `useState<StreamEvent[]>`, `appendDedup` widened, `case "image":` in `ws.onmessage`, render branches on `m.type`.

## Decisions Made

- **Role derivation rule refined during Task 1** — the plan proposed "any imageRef with toolUseId → tool_result, else user/assistant" but Test 3 (CC-local-only) expected role="tool_result" even though the CC-local shape carries no toolUseId. The prototype's rule ("user turn with image → tool_result") would fail Test 2 (bare image on user turn expects role="user"). Distinguishing factor: whether the image arrived via a tool_result path (either canonical `toolUseId` OR CC-local `obj.toolUseResult` presence). Adopted this refined rule; it satisfies all 9 test cases and reflects the true semantic (bare image content blocks are direct user/assistant image content; toolUseResult presence is by construction a tool response payload).
- **Aesthetic parity by verbatim token copying** — ImageBubble does not import ChatMessage's className builder or share styling helpers. The gradient/border/shadow tokens are literally copied so any future divergence (e.g. Ashley tunes ChatMessage's saturation) is a deliberate choice, not accidental drift. Justified by the aesthetic-parity constraint being a design contract, not a code-DRY concern.

## Deviations from Plan

**1. [Rule 3 — Blocking] Cwd drift from worktree to main repo during Task 1**
- **Found during:** Task 1 (parser + tests)
- **Issue:** Initial Edit/Write calls used absolute paths targeting `/home/ubuntu/skynet/src/...` (the main repo), not `/home/ubuntu/skynet/.claude/worktrees/agent-ace06add28322dba7/src/...` (the worktree). This is exactly the #3099 scenario the absolute-path safety guard was designed to catch — the Bash cwd was correct but the Edit/Write tool paths were computed from the orchestrator-visible main-repo path, not the worktree root.
- **Fix:** Reverted the accidental edits in the main repo with `git checkout --` + `rm`, then re-applied the same content into the worktree via `cp` from a `/tmp/` scratch. All subsequent Edit/Write calls (Task 2 and Task 3) used worktree-absolute paths (verified against `git rev-parse --show-toplevel`).
- **Files modified:** none in the main repo after fix (`git status` clean on `/home/ubuntu/skynet`); all task changes landed on the worktree.
- **Verification:** `git status` clean in the main repo; worktree HEAD advanced by 3 task commits with all 267 tests green and `npm run build` clean.
- **Committed in:** N/A (recovery only; the actual code landed in `5a8b166`).

---

**Total deviations:** 1 recovery (path routing).
**Impact on plan:** Zero on-code impact — the fix was mechanical (revert-and-recopy), and all task commits landed atomically on the correct branch (`worktree-agent-ace06add28322dba7`).

## Issues Encountered

- **Test 2 vs. Test 3 role expectation contradiction** — the plan's "simplest rule" (`anyToolUseId → tool_result, else user/assistant`) satisfies Test 2 (bare user image → role="user") but fails Test 3 (CC-local user image → expected role="tool_result"). Resolved by widening the rule to also check `obj.toolUseResult` presence. See "Decisions Made" above.

## Threat Flags

None — no new network endpoints, no new auth paths. WS-inline b64 payload rides the same authenticated `claude-session/websocket/` route the text-message frames already used. Base64 payloads are decoded browser-side into `<img src="data:...">` which does not create a script/eval surface.

## Known Stubs

None. ImageBubble renders real data end-to-end (parser → WS → component); no placeholder text or empty-value pass-throughs.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- Live-run hand-verify is deferred to Ashley's next deploy (per constraints: no build/docker/deploy for this patch; Ashley is still stacking patches on `feat/tab-title-from-tmux`).
- skynet-patches.md write-up (patch #86 row) is intentionally deferred to pin/deploy time per fleet directive — do NOT write it now.
- Aesthetic acceptance criterion is structural: ImageBubble's gradient/border/shadow tokens are byte-identical to ChatMessage's assistant branch. Ashley's per-pane identity hue will color-shift the bubble automatically via `hsla(var(--pv-id-hue),...)`.

## Self-Check: PASSED

Verified before writing this line:
- `src/backend/claude-session/session-file-parser.ts` present in worktree — FOUND
- `src/backend/claude-session/session-file-parser.test.ts` present in worktree — FOUND
- `src/backend/claude-session/claude-session-server.ts` present in worktree — FOUND
- `src/ui/api/claude-session-api.ts` present in worktree — FOUND
- `src/ui/features/pretty-view/ImageBubble.tsx` present in worktree — FOUND
- `src/ui/features/pretty-view/PrettyView.tsx` present in worktree — FOUND
- Commit `5a8b166` present on branch — FOUND
- Commit `2b1a703` present on branch — FOUND
- Commit `ab20b18` present on branch — FOUND
- `npm test` green (267/267 passing) — VERIFIED
- `npm run build` clean — VERIFIED

---
*Quick task: 260719-vil*
*Completed: 2026-07-19*
