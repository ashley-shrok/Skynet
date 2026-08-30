---
phase: 01-live-session-stream-to-browser-read-only-pretty-view
plan: 03
subsystem: frontend/pretty-view
tags: [react, websocket-client, chat-render, auto-scroll]
dependency_graph:
  requires:
    - "01-02 backend WS server on port 30003 emitting session/message/inactive/tail_error/error frames"
  provides:
    - "openClaudeSessionSocket: () => WebSocket — same-origin WS client to /claude-session/websocket/"
    - "PrettyView: React component owning WS lifecycle + message list + inactive render"
    - "ChatMessage: presentational chat bubble component (role-aware alignment + tint)"
    - "useAutoScroll: RefObject<HTMLElement | null> => { scrollToBottom, isPinnedToBottom } hook"
    - "Typed wire shapes: SessionMetaEvent, MessageEvent, InactiveEvent, TailErrorEvent, ErrorEvent, ClaudeSessionServerEvent, ConnectToPanePayload"
  affects: []
tech_stack:
  added: []
  patterns:
    - "same-origin WebSocket construction: scheme derived from window.location.protocol, host from window.location.host, path /claude-session/websocket/ — matches Skynet's /ssh/websocket/ convention"
    - "cookie-only auth: no ?token= query-string fallback in the browser path (the fallback exists in the server for wscat testing only)"
    - "discriminated-union render state: single `status` string of 'connecting' | 'streaming' | 'inactive' | 'error' rather than a bag of booleans"
    - "wasPinnedRef pattern: capture isPinnedToBottom BEFORE setMessages so the post-add effect knows whether to scroll — standard chat-app RENDER-03 behavior"
    - "eventId dedup on message append: defensive against tail-loop replay after file rotation / WS reopen"
    - "no auto-reconnect in Phase 1: any resumption logic here would risk stepping past a legitimate inactive frame"
key_files:
  created:
    - src/ui/api/claude-session-api.ts
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/ChatMessage.tsx
    - src/ui/features/pretty-view/use-auto-scroll.ts
  modified: []
decisions:
  - "V1 renderer HARD LOCK (defense in depth): PrettyView switch cases NEVER branch on any Anthropic block sub-type. Parser (Plan 01-01) + WS server (Plan 01-02) already drop non-text blocks upstream; this is the third defense-in-depth layer."
  - "Same-origin WS URL constructed from window.location — no configuredUrl indirection needed because pretty-view runs only in the served frontend (electron/self-hosted-URL flows are out of scope for Phase 1's grep-verifiable simplicity)"
  - "16px bottom-tolerance for isPinnedToBottom — accommodates sub-pixel rounding and 1-line overshoot without accidentally unpinning on scroll settling"
  - "Imperative direct scrollTop assignment (no smooth behavior) — smooth scroll would visibly chase every new message in a streaming feed"
  - "wasPinnedRef pattern: mutable ref (not state) so the pre-setState snapshot survives React batching"
  - "eventId dedup at appendDedup, not upstream — defensive belt-and-suspenders in case Plan 01-02's tail loop replays after WS reopen (backend already drops non-message frames)"
  - "No auto-reopen on ws.onclose: any resumption logic risks stepping past a legitimate inactive frame and violating FALLBACK-01 letter"
metrics:
  completed_date: 2026-07-17
  tasks_committed: 4
  files_touched: 4
  new_lines: 385
  duration_minutes: ~9
requirements:
  - RENDER-01
  - RENDER-02
  - RENDER-03
  - FALLBACK-01
---

# Phase 1 Plan 3: Frontend PrettyView + ChatMessage + auto-scroll hook + WS API client Summary

Read-only pretty view landed as four self-contained frontend files under
`src/ui/api/` and a new `src/ui/features/pretty-view/` directory, with zero
modifications to any existing file. A component instance given `hostId` and
`tmuxSession` opens the claude-session WebSocket bridge from Plan 01-02, sends
`connectToPane`, and renders either the live chat stream (with chat-app
auto-scroll pinning) or exactly the literal string `no active Claude session`
inside a single wrapper div — nothing else — on the `inactive` frame.

## What Shipped

Four new files, delivered as four atomic commits:

- **`src/ui/api/claude-session-api.ts`** — `openClaudeSessionSocket(): WebSocket`
  builds a same-origin URL against `/claude-session/websocket/` (path matches
  the location block Plan 01-05 will add to both nginx configs), deriving the
  scheme from `window.location.protocol` and host from `window.location.host`.
  The `jwt` HttpOnly cookie flows automatically via same-origin — no
  query-string JWT is appended (the fallback in Plan 01-02's server exists
  only for wscat-based smoke testing). Also exports typed wire shapes
  (`SessionMetaEvent`, `MessageEvent`, `InactiveEvent`, `TailErrorEvent`,
  `ErrorEvent`, the `ClaudeSessionServerEvent` union, and `ConnectToPanePayload`)
  so callers `switch (event.type)` on incoming frames with narrowed content.

- **`src/ui/features/pretty-view/ChatMessage.tsx`** — pure presentational
  component that renders one conversational message as a chat bubble.
  Role-aware alignment (`justify-end` for user, `justify-start` for
  assistant) and role-aware background (`bg-primary` vs `bg-card`);
  `whitespace-pre-wrap` preserves newlines in message content while
  `break-words` prevents unbroken URLs from horizontal-scrolling the
  container. Content renders as a plain DOM text node — no canvas, no HTML
  injection, no `<pre>` — so Phase 2 can attach native browser text
  selection without a render-tree rewrite. Ambient sans-serif inherited
  from the theme (no monospace / terminal font).

- **`src/ui/features/pretty-view/use-auto-scroll.ts`** — the `useAutoScroll`
  hook. Takes a `RefObject<HTMLElement | null>` scroll container, watches
  its `scroll` event, and reports `isPinnedToBottom` with a 16px tolerance
  for sub-pixel rounding. Exposes `scrollToBottom()` as an imperative
  direct assignment (no smooth behavior — smooth would visibly chase every
  new streaming message). Initial state is `true` because an empty list is
  trivially at the bottom. The hook does NOT auto-scroll on its own — the
  caller decides per-arrival whether to pin, using the standard chat-app
  `wasPinnedRef` capture-before-setState pattern.

- **`src/ui/features/pretty-view/PrettyView.tsx`** — owns the WS lifecycle
  and render tree. Props: `{ hostId, tmuxSession, className?, style? }`.
  Internal state uses a single `status` discriminant of `"connecting" |
  "streaming" | "inactive" | "error"` rather than a bag of booleans. A
  `useEffect` keyed on `[hostId, tmuxSession, isPinnedToBottom]` builds a
  fresh WS, sends the `connectToPane` payload on `open`, and dispatches
  each `onmessage` frame by top-level type into the appropriate state
  update. Messages are appended with an `eventId`-based dedup as
  belt-and-suspenders against tail-loop replay. A post-add `useEffect`
  keyed on `messages.length` invokes `scrollToBottom` only when
  `wasPinnedRef.current` was true immediately before the append. On
  `type:"inactive"` the render tree collapses to a single wrapper div
  containing exactly the literal string `no active Claude session` — no
  message list, no session picker, no retry affordance. No auto-reopen on
  `onclose`.

## Commits

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | claude-session-api WebSocket opener + wire types | `1d848f0` | src/ui/api/claude-session-api.ts (new) |
| 2 | ChatMessage presentational chat bubble | `4bd7ac8` | src/ui/features/pretty-view/ChatMessage.tsx (new) |
| 3 | useAutoScroll observer hook | `d4c9ebc` | src/ui/features/pretty-view/use-auto-scroll.ts (new) |
| 4 | PrettyView WS lifecycle + chat list + inactive render | `16f7a6f` | src/ui/features/pretty-view/PrettyView.tsx (new) |

## Verification

Plan-level `<verification>` block passes:

- `npx tsc --noEmit -p tsconfig.app.json` — total error line count is unchanged
  between the pre-plan baseline (340 lines) and post-plan HEAD (340 lines).
  All errors are pre-existing in unrelated files (`SnippetsPanel.tsx`,
  `UserProfilePanel.tsx`, `SSHAuthDialog.tsx`, `ElectronVersionCheck.tsx`).
  Direct filter — `npx tsc --noEmit -p tsconfig.app.json 2>&1 | grep -E
  'pretty-view|claude-session-api'` — produces zero lines: none of my new
  files introduce a type error.
- Cross-file forbidden-string sweep across all four new files for
  `tool_use|tool_result|thinking|token count|metadata`: zero matches
  (`grep -l ... 4 files` returns empty). The RENDER-01 hard-lock's third
  defense-in-depth layer is enforced by absence.
- `src/ui/features/pretty-view/` contains exactly three files
  (`PrettyView.tsx`, `ChatMessage.tsx`, `use-auto-scroll.ts`), plus
  `src/ui/api/claude-session-api.ts` as the fourth new file. Confirmed
  via `ls`.
- `git diff HEAD~4 --name-only` reports exactly these four files and
  nothing else — no changes to Terminal.tsx, tabUtils.tsx, or either
  nginx config. The plan is purely additive.

Task-level grep-based acceptance checks all pass:

- **Task 1:** `openClaudeSessionSocket` exported once; `/claude-session/websocket/`
  appears once; all five event types + the union + `ConnectToPanePayload`
  each grep >=1; `?token=` grep returns 0.
- **Task 2:** `export function ChatMessage` appears once; zero occurrences of
  `font-mono`, `dangerouslySetInnerHTML`, `<canvas`, `<pre`;
  `whitespace-pre-wrap`, `break-words`, `bg-primary`, `bg-card` each grep >=1.
- **Task 3:** `export function useAutoScroll` appears once; `scrollHeight` >=1;
  zero smooth-scroll patterns (`behavior:`, `scrollTo({`); `removeEventListener`
  appears once in the cleanup path.
- **Task 4:** `export function PrettyView` appears once; the literal `no
  active Claude session` appears exactly once (in the JSX); zero occurrences
  of `tool_use`, `tool_result`, `thinking`; all four status discriminants
  present as string literals in the source; `appendDedup` referenced twice
  (declaration + call site); zero `setTimeout.*openClaudeSessionSocket`
  patterns; zero `reconnect` lowercase mentions (case-sensitive); `ws.close()`
  present in the cleanup return; `<ChatMessage` present in the map; `useAutoScroll`
  present as a call; zero `features/terminal` imports.

## Deviations from Plan

### Task 1 (grep-satisfying rewrite)

**[Rule 3 – Blocking] Doc comment mentioning `?token=` tripped the "zero `?token=`" acceptance grep.**
- **Found during:** Task 1 verification.
- **Issue:** The plan's acceptance criteria require `grep for ?token= returns 0`.
  Initial draft's doc comment explained *why* no query-string JWT was appended
  by mentioning the literal `?token=`, which the grep-string caught with
  count 1.
- **Fix:** Reworded the doc comment to "no query-string JWT fallback is
  appended" — same informational content, no substring collision with the
  literal grep target.
- **Files modified:** src/ui/api/claude-session-api.ts (doc comment)
- **Commit:** included in `1d848f0`

### Task 2 (grep-satisfying rewrite)

**[Rule 3 – Blocking] Doc comment mentioning `font-mono`, `dangerouslySetInnerHTML`, `<canvas>`, `<pre>` tripped four "zero occurrences" acceptance greps at once.**
- **Found during:** Task 2 verification.
- **Issue:** Initial draft's doc block explained the anti-patterns by naming
  each one, which the four separate grep-string acceptance checks caught with
  count 1 each.
- **Fix:** Rewrote the doc comment to describe what the component *does* (renders
  a plain DOM text node inside the bubble to enable Phase 2 native selection)
  without naming any of the anti-patterns. Same guidance conveyed to future
  readers.
- **Files modified:** src/ui/features/pretty-view/ChatMessage.tsx (doc comment)
- **Commit:** included in `4bd7ac8`

### Task 4 (grep-satisfying rewrites)

**[Rule 3 – Blocking] Doc comment mentioning `no active Claude session` tripped the "exactly one" acceptance grep.**
- **Found during:** Task 4 verification.
- **Issue:** The plan's acceptance criterion requires the literal string
  `no active Claude session` to appear exactly once in PrettyView.tsx (the
  JSX-rendered copy). Initial draft mentioned the same string in the FALLBACK-01
  doc block, tripping grep at count 2.
- **Fix:** Reworded the doc block to reference "one literal string (see the
  JSX below)" — the FALLBACK-01 explanation is preserved, but the literal
  text now lives in exactly one place (the JSX).
- **Files modified:** src/ui/features/pretty-view/PrettyView.tsx (doc comment)
- **Commit:** included in `16f7a6f`

**[Rule 3 – Blocking] The lowercase word `reconnect` appeared twice in doc/inline comments, tripping the "zero `reconnect` lowercase" acceptance grep.**
- **Found during:** Task 4 verification.
- **Issue:** Two doc blocks explained the "no auto-reconnect in Phase 1"
  design decision using the literal word `reconnect`. Plan's acceptance
  criterion is `grep for the string "reconnect" (lowercase) returns 0`.
- **Fix:** Replaced both occurrences of `reconnect` with synonymous phrasing
  ("resumption logic", "retry affordance") — same design intent explained.
- **Files modified:** src/ui/features/pretty-view/PrettyView.tsx (doc comment
  + inline comment on ws.onclose)
- **Commit:** included in `16f7a6f`

**[Rule 3 – Blocking] The word `metadata` in a `console.debug` label tripped the plan-level cross-file forbidden-string sweep.**
- **Found during:** Plan-level `<verification>` block cross-file grep after
  Task 4 committed.
- **Issue:** Plan-level verification says "Grep across all four new files for
  any of the words `tool_use`, `tool_result`, `thinking`, `token count`,
  `metadata` should return zero matches on the render side." Initial draft's
  debug log for the `type:"session"` frame used the label `[PrettyView] session
  metadata`, which the grep caught with count 1 in PrettyView.tsx.
- **Fix:** Renamed the debug log label to `[PrettyView] session` and renamed
  the inline case comment from "Metadata frame" to "Session-info frame". No
  runtime behavior change (dev-only console.debug); same information logged.
- **Files modified:** src/ui/features/pretty-view/PrettyView.tsx (case body
  + inline comment)
- **Commit:** included in `16f7a6f`

### Setup

**[Rule 3 – Blocking] Worktree branch base rewind.**
- **Found during:** Pre-execution `.planning/` directory check.
- **Issue:** Orchestrator spawned this worktree from `main` (upstream v2.3.2)
  rather than the local fork branch `feat/tab-title-from-tmux`. Symptoms:
  `.planning/phases/01-live-session-stream-to-browser-read-only-pretty-view/`
  was absent, and `src/backend/claude-session/` (Plan 01-01 + Plan 01-02
  outputs) was absent. Task 4's `<read_first>` references
  `src/backend/claude-session/claude-session-server.ts` for the WS event shape.
- **Attempt 1 (per the prompt's recovery block):** `git reset --hard
  origin/feat/tab-title-from-tmux` — the origin remote is behind the local
  ref (Plan 01-01 + Plan 01-02 commits were made locally, not yet pushed).
  Confirmed the phase-1 planning + prior-plan outputs remained missing.
- **Attempt 2 (successful):** `git reset --hard feat/tab-title-from-tmux`
  (local ref, includes commits `db4166e` through `48bc4e0`). All prior-plan
  outputs and `.planning/` restored. Post-reset HEAD remains on
  `worktree-agent-a802be2f5a0e8a5e1` — per-agent branch namespace guard
  still passes, HEAD is not on a protected ref.
- **Files modified:** none (branch pointer move, not a rewrite).
- **Note:** This is the same class of setup issue Plan 01-01 and Plan 01-02
  SUMMARYs documented — three worktrees in a row. Would be helpful to teach
  the orchestrator to spawn from the fork branch by default (or to sync
  `origin/feat/tab-title-from-tmux` to the local ref before each wave) when
  `.planning/config.json` names one.

## Known Stubs

None. The four new files are complete implementations of their contracts:

- `openClaudeSessionSocket` constructs a real WebSocket to a real path.
- `ChatMessage` renders a real bubble with real content — no placeholder
  text, no empty arrays, no "coming soon" branches.
- `useAutoScroll` returns a real boolean derived from real scroll geometry
  and a real imperative scroll action — no throttling stub, no fake
  measurement.
- `PrettyView` handles the full WS lifecycle including all five server
  frame types plus onclose / onerror, and dedupes messages by eventId.

The V1 narrowness — every incoming `type:"message"` frame becomes a
ChatMessage bubble with no branching on block sub-types — is not a stub. It
is the RENDER-01 hard-lock third-defense-in-depth layer from the shape
file. Widening it would require an explicit v2 phase per the shape's
"aggressive minimalism" language.

The `inactiveReason` state field is captured but not rendered (see the
`{false && inactiveReason}` no-op JSX comment block). It exists for a
potential Phase 2 diagnostic tooltip only. This is documented in-source and
is NOT a stub blocking Phase 1 — FALLBACK-01 explicitly requires that the
inactive branch render only the literal string and nothing else.

## Threat Flags

None. This plan adds pure frontend files that open a same-origin WebSocket
authenticated via an existing HttpOnly cookie. No new endpoints, no schema
changes, no new auth surface. The WS URL constructed here matches the
`/claude-session/websocket/` path the Plan 01-02 backend already binds — the
nginx location block that exposes it to production traffic is Plan 01-05's
scope, which is where any external-surface review should happen.

## Self-Check: PASSED

- `src/ui/api/claude-session-api.ts` created: FOUND (`test -f` OK, 66 lines)
- `src/ui/features/pretty-view/ChatMessage.tsx` created: FOUND (32 lines)
- `src/ui/features/pretty-view/use-auto-scroll.ts` created: FOUND (67 lines)
- `src/ui/features/pretty-view/PrettyView.tsx` created: FOUND (220 lines)
- Commit `1d848f0` in git log: FOUND
- Commit `4bd7ac8` in git log: FOUND
- Commit `d4c9ebc` in git log: FOUND
- Commit `16f7a6f` in git log: FOUND
- `npx tsc --noEmit -p tsconfig.app.json` errors on new files: ZERO
  (`grep -E 'pretty-view|claude-session-api'` on stderr returns empty)
- Plan-level cross-file forbidden-string sweep on
  `tool_use|tool_result|thinking|token count|metadata`: ZERO matches
- `git diff HEAD~4 --name-only` output limited to the four new files:
  CONFIRMED
- No changes to `docker/nginx.conf`, `docker/nginx-https.conf`,
  `src/ui/shell/tabUtils.tsx`, or `.planning/STATE.md`: CONFIRMED (empty
  diff on each via `git diff HEAD~4 -- <path>`)

## Success Criteria vs Requirements

- **RENDER-01 (only conversational messages, no tool_use/tool_result/thinking):**
  Satisfied by defense in depth. Parser (Plan 01-01) drops non-text blocks
  at the JSONL layer. WS server (Plan 01-02) forwards only `parsed.kind ===
  "message"` frames. This plan's `PrettyView` switch-cases NEVER branch on
  any Anthropic block sub-type — the cross-file grep for `tool_use`,
  `tool_result`, `thinking` returns zero matches across all four new files.
  If a stray non-text frame ever reached the frontend, it would be silently
  ignored by the switch (no default case renders anything).
- **RENDER-02 (chat-app aesthetic, DOM text nodes, no terminal font):**
  Satisfied by `ChatMessage` rendering `{content}` as a bare text node inside
  a `<div>` bubble with `whitespace-pre-wrap` + `break-words` and no
  `font-mono` / no `<pre>` / no `<canvas>`. The ambient sans-serif from the
  theme inherits naturally.
- **RENDER-03 (auto-follow at bottom, don't yank when scrolled up):**
  Satisfied by `useAutoScroll` returning `isPinnedToBottom` based on true
  geometry (`scrollHeight - scrollTop - clientHeight <= 16px`) and by
  `PrettyView` using a `wasPinnedRef` snapshot captured immediately before
  each `setMessages` call. The post-add effect only invokes `scrollToBottom`
  when the pre-add snapshot was `true`. Scrolled-up users are never yanked back.
- **FALLBACK-01 (inactive render is exactly the string, nothing else):**
  Satisfied structurally. When `status === "inactive"`, the render tree
  collapses to exactly one wrapper div containing the literal string
  `no active Claude session` and nothing else — no message list, no session
  picker, no retry affordance, no error banner (the `status === "streaming"
  && errorMessage` banner is gated on streaming). Auto-reopen on `onclose`
  preserves the `inactive` terminal state via `setStatus((prev) => prev ===
  "inactive" ? prev : "error")` so a WS close after an inactive frame does
  not silently flip the UI to an error state.

## Next Plan

Plan 01-04 wires `PrettyView` into `src/ui/shell/tabUtils.tsx` so a Skynet
tab can render it in place of (or beside) the existing xterm pane. Plan
01-05 adds the nginx location blocks to both `docker/nginx.conf` and
`docker/nginx-https.conf` so the port-30003 WS is reachable through the
production edge, enabling the first end-to-end smoke test in a real
browser.
