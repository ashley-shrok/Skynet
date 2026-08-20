# Phase 50: Optimistic message bubbles — Context

**Gathered:** 2026-08-19
**Status:** Ready for planning
**Source:** /build → /open discussion. Full shape file at `.planning/shapes/shape-optimistic-message-bubbles.md` — read that FIRST before planning; it carries the design agreement, philosophy, prior context, failure modes, scope edges, and vehicle notes that this CONTEXT.md compresses.

<domain>
## Phase Boundary

Make PrettyView's chat surface feel responsive on send by rendering the outgoing user bubble optimistically (the instant Enter is pressed), keyed off two authoritative session-file signals, with a bounded timer for genuine failure. Bundled second fix: replace the existing PV-submit watchdog on the send path — which uses noisy PTY-activity as its "message got through" proxy and still occasionally concludes wrongly — with a specific-signal watchdog keyed off the same session-file emission that drives the bubble state machine.

The phase touches the send path end-to-end: frontend send handler + bubble rendering, backend session-file parser, and the backend terminal-layer send code that houses the current watchdog. Deliberately reverses the COMPOSE-04 HARD LOCK — a stated architectural policy in ComposeBox.tsx forbidding pre-file-confirmation bubble render.

</domain>

<decisions>
## Implementation Decisions

### State machine (frontend)
- **D-01:** On send (Enter pressed), immediately render an optimistic user bubble with a small spinner indicator. No wait for backend/JSONL confirmation before render.
- **D-02:** Spinner clears when EITHER of two session-file signals arrives with matching content: (a) a normal `type:"user"` turn (direct-processing path, Claude was idle), OR (b) a `type:"queue-operation", operation:"enqueue"` entry with `content` field matching (queued path, Claude was busy).
- **D-03:** After ~20s with no matching signal from either path, bubble transitions to a red failure state AND the composebox text field re-populates with the outgoing text so the user can edit and resend.
- **D-04:** Spinner and red states render ONLY on the most recent outgoing bubble. Older bubbles look plain regardless of their historical send-state. iMessage-style "collapse to latest only."
- **D-05:** No client-side timer ever converts a "sent" (signal received) bubble into a "failed" state. Once the signal arrives, the message is on Claude's side, and Claude may take arbitrarily long to process a queued message; a client timeout would produce false-positive red on legitimate queues. This is the load-bearing WhatsApp-precedent invariant.
- **D-06:** The specific spinner glyph is small, minimal, and consistent with the existing PV chrome aesthetic (which has been progressively pruned). No large animated icon. A subtle dot, ring, or similar. Exact affordance is Claude's Discretion — see below.

### Matching (optimistic bubble ↔ session-file entry)
- **D-07:** Matching is FIFO by outgoing order: the oldest pending optimistic bubble in the session matches the next-arriving unmatched signal (either `user` turn or `queue-operation enqueue`). Content-string equality as tiebreaker for the identical-message-sent-twice edge case.
- **D-08:** No new per-message identifier is introduced. The FIFO + content-match approach is sufficient for the cases this design cares about; introducing a marker would require harness-side cooperation the app doesn't have.

### Backend parser (existing signals extended)
- **D-09:** Extend the session-file parser's existing `queue-operation` branch (currently only handles `task-notification` payloads for background-agent completion signals per patch #66; see claude-session-server.ts lines ~2464-2506) to ALSO emit a first-class "user message accepted" event for entries where `type === "queue-operation"`, `operation === "enqueue"`, and `content` is a normal user-message string (NOT starting with `<task-notification>` or other harness-internal wrappers).
- **D-10:** The emission from D-09 uses the same wire shape as a normal user-turn emission (via the existing `{type:"message", role:"user", content, eventId, ts}` frame path) so the frontend needs no new message-type routing. `eventId` for queue-operation-emitted entries derives from the entry's synthesized id (queue-operation entries lack a `uuid`; use a stable derivation — hash of `sessionId + timestamp + content` is acceptable) so the frontend's per-eventId dedup Set continues to function.
- **D-11:** Dedup at the source: a queued message appears TWICE in the session file — first as `queue-operation enqueue` when queued, then as a regular `user` turn when Claude dequeues and processes it (~seconds to minutes later). The parser MUST NOT emit a second WS frame for the later `user` turn if it already emitted from the enqueue entry for the same content within the same session. Concrete approach: maintain a per-session sliding-window Set of "recently-emitted user-content hashes" (or `sessionId + content + rough-timestamp-bucket` keys); on the later `user` turn, check the set; if match, suppress. Set can be bounded by size or by time-window.

### Missed-Enter watchdog (replaces existing PV submit watchdog)
- **D-12:** Rip out the current PV submit watchdog (patch quick 260803-1xw, terminal.ts:~777-805) — including `armPvSubmitWatchdog` and any related state. The PTY-activity proxy is retired.
- **D-13:** Replace with a specific-signal watchdog keyed off the same session-file emission: after the backend fires the tmux Enter, watch for a matching session-file signal (via the tail watcher's emission stream). If none arrives within T+2-3s, fire a retry Enter (single tmux `send-keys Enter` — no re-type).
- **D-14:** If still no signal at T+5-6s, execute a full re-send: `send-keys` a Ctrl+U (or equivalent) to clear the harness composebox, re-type the message body with the `-l` literal flag (same as the original send), then `send-keys Enter`.
- **D-15:** If still no signal at T+~20s (the same outer bound as the bubble red-state timer), emit `paste_send_failed` on the WebSocket to the client — which then triggers the red-state transition on the optimistic bubble (D-03). The two systems SHARE this outer signal path; they are not two independent timers.
- **D-16:** Retry Enter into an empty composebox is a safe no-op (Claude ignores empty-input Enter). This is the safety property that makes D-13/D-14 non-destructive in the edge case where the message DID land but the signal was slow.
- **D-17:** The full re-send (D-14) is scoped to the harness composebox ONLY. It does NOT touch the human user's own composebox in Skynet's UI (which is a different surface — the harness composebox is invisible to the human, only Skynet backend writes to it, so there's no risk of stomping user input).

### File-first hard-lock removal
- **D-18:** Remove the COMPOSE-04 HARD LOCK comment/logic at ComposeBox.tsx:~1281-1282 that forbids pre-file-confirmation bubble rendering. Deliberate reversal of the earlier architectural policy — replace with the new optimistic-bubble state machine (D-01 through D-07).
- **D-19:** The rationale for COMPOSE-04 (avoiding ghost bubbles / drift when render preceded file confirmation) is addressed structurally by the new design: bubbles are always ONE of (a) confirmed via signal, or (b) in optimistic-with-spinner state waiting for signal. There is no third path where a bubble persists without a corresponding signal.

### Failure paths beyond timer
- **D-20:** WS.send failing (readyState !== OPEN when the frontend tries to submit) → immediate red bubble + immediate composebox repopulation, no waiting on any timer. Same failure state as D-03 but arrives faster.
- **D-21:** Backend cannot execute `tmux send-keys` on the target pane (throws, exec fails, etc.) → backend emits an error frame back to the frontend, which triggers the red state. Distinct from the current log-and-swallow posture — this needs a new small backend ACK/error frame on the send-keys path.

### Test coverage
- **D-22:** In-process tests must cover: (a) happy path — send fires, signal arrives, spinner clears, bubble is normal; (b) queued path — send fires, `queue-operation enqueue` signal arrives, spinner clears, bubble is normal (and later `user` turn is deduped); (c) failure path — send fires, no signal, T+~20s → red bubble + composebox repopulate; (d) retry-Enter path — send fires, no signal at T+2-3s, retry Enter fires; (e) full-resend path — no signal at T+5-6s, clear + retype + Enter fires; (f) latest-only rendering — send message A, send message B, only B shows spinner; (g) dedup — parser sees enqueue then later user turn with matching content, only one frame emitted.
- **D-23:** Do not delete existing PV send tests wholesale — adapt to reflect the new behavior. The `__applyInputMessageForTests` seam stays; new tests plug into it.

### Claude's Discretion
- Exact visual glyph for the spinner (small dot vs. small ring vs. animated ellipsis) — pick something small and consistent with existing PV bubble chrome. Sample against the existing `--color-pv-*` palette. No new color tokens.
- Exact CSS positioning of the spinner within the bubble — inside the bubble at trailing edge, or as a small element just outside — planner picks based on what fits the existing bubble layout.
- Exact color for the red-failure state — draw from any existing danger/error hue already in the palette, or use a desaturated red that matches the muted PV aesthetic. Do not introduce a saturated alarm-red.
- The precise dedup window / cache size for the parser's suppress-double-emit logic (D-11). A reasonable default: a per-session Set of the last 100 (content-hash + wall-clock-second) tuples, with entries expiring after 10 minutes.
- Exact wire shape for the backend send-keys error frame (D-21) — pick a shape consistent with existing error/failure frames on the claude-session WS.
- Whether the retry Enter (D-13) requires any de-duplication guard against firing twice in the same window (e.g., if the retry itself times out) — planner decides based on the state model chosen. Preference: track "retry-fired" per-pending-message so it fires at most once.
- Whether to test the parser change with unit tests only, or also with an in-process test that exercises the full parser → WS → frontend path. Recommendation: both, but the in-process test is the higher-value one for goal-backward verification.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape file (agreement contract)
- `.planning/shapes/shape-optimistic-message-bubbles.md` — full design agreement from /open. Read first. What this is, Shape, Philosophy, Prior context, What would make it wrong, Scope edges, Vehicle notes.

### Existing send-path pipeline (traced during /open)
- `src/ui/features/pretty-view/ComposeBox.tsx:1235-1291` — current send handler. Contains the COMPOSE-04 HARD LOCK to be reverted (lines ~1281-1282).
- `src/ui/features/pretty-view/PrettyView.tsx:~144, ~639, ~1493` — parent that wires `onSend` and holds the PrettyView WS ref (`wsRef`) that carries send frames post-Phase-35.
- `src/ui/features/pretty-view/ChatMessage.tsx:52-79` — bubble render component. Currently no pending-state concept; extend for spinner + red state on latest bubble.
- `src/backend/claude-session/claude-session-server.ts:~2273-2768` — the `onLine` JSONL parser callback + WS frame emission. Emits `{type:"message", role, content, eventId, ts}`.
- `src/backend/claude-session/claude-session-server.ts:~2464-2506` — the existing `queue-operation` handler branch (patch #66 task-notification detection). Extend HERE to also emit for normal-content enqueue entries (D-09/D-10).
- `src/backend/claude-session/claude-session-server.ts:~4651-4678` — backend WS input handler (`type:"input"` case). Calls `__applyInputMessageForTests`.
- `src/backend/claude-session/session-file-parser.ts:~626-815` — parseSessionLine implementation. Reference for how existing user-turn parsing works.
- `src/backend/claude-session/session-file-parser.ts:~642-693` — existing `queued_command` attachment handling (patch #376/#377) — DIFFERENT from `queue-operation` type; do not conflate.
- `src/backend/claude-session/session-file-tail.ts:~35-50` — `tail -F` watcher. Not modified by this phase; understanding it helps.
- `src/backend/ssh/terminal.ts:~720-820` — send-path in the SSH terminal layer. Contains the split-send (body then Enter 250ms later) at ~735-806 AND the existing PV submit watchdog at ~777-805 (patch quick 260803-1xw) that gets removed and replaced.
- `src/backend/ssh/terminal-session-manager.ts:~57` — the watchdog pair reference.

### Related existing patches referenced in the design
- Patch quick 260803-1xw — original PV submit watchdog (being REMOVED). Bounty: `pv-paste-to-terminal-lands-as-unsent-bracket-paste` (archive).
- Patch #66 — the existing `queue-operation task-notification` handler being EXTENDED (background-agent completion detection).
- Patch #376/#377 — `queued_command` attachment rendering (SEPARATE mechanism — do not conflate with `queue-operation` type).
- Patch #339 — pretty-view reconnect preserving bubbles + Send/reset disable (context for the WS-lifecycle interaction).
- Phase 35 (patch #446, `pretty-view-owns-compose-send-migrate-off-terminal-ws-borrow`) — the migration that established the current send path using PrettyView's own WS.

### Empirical evidence backing the design
- Reproduced this session in a throwaway harness at `/tmp/queue-test` (subsequently torn down). Numbers: direct user turn hits JSONL at ~91ms; queued message hits as `queue-operation enqueue` at ~111ms; queued message reappears as normal `user` turn on dequeue (~2 minutes later in test with a 15-paragraph essay as the blocking turn). Fresh reproduction takes about a minute — the pattern is at the bottom of `shape-optimistic-message-bubbles.md` Vehicle notes.

### Fleet directives that apply
- Deploy is orchestrator-only — the executor produces code + green tests, then STOPS. Orchestrator handles push/build/coord-room-announce/recreate/verify per role file § Container mutations serialize + § Subagents don't do deploys.
- Rebase before push. No worktrees.
- Multi-identity role — `git pull --rebase origin feat/tab-title-from-tmux` from tree before every push; resolve conflicts locally first.
- Branch state: two un-deployed commits sit on the branch (`38eadffb` identity forceSave + `1e45b73a` context-meter diag). Ashley approved shipping everything together at the end of this phase.

</canonical_refs>

<specifics>
## Specific Ideas

- The parser's per-session dedup Set (D-11) can hang off the existing per-session state that the JSONL tail watcher maintains — no new global cache needed. It lives and dies with the tail watcher's lifecycle.
- The FIFO matching (D-07) is naturally implemented at the front end since that's where the outgoing bubbles live in a per-session order. The backend does not need to know about the FIFO — it emits signals; the front end orders them against its pending bubbles.
- For the retry-Enter (D-13), the timer/watchdog lives on the BACKEND side (in terminal.ts near the split-send logic), because that's where the ability to fire another `send-keys Enter` lives. The frontend's timer is a separate one for the RED-STATE transition (D-03/D-15). They share the outer T+~20s bound via the `paste_send_failed` frame.
- The full re-send (D-14) needs to clear the composebox reliably. Ctrl+U is the vi/emacs-style line-clear; Claude's Ink UI may or may not honor it. Alternative: `send-keys Home` then `send-keys C-k` (start-of-line then kill-to-end-of-line). Planner picks; verify with a quick check against the running Claude Code CLI.
- No changes to the tail watcher lifecycle or the WS connection lifecycle. This phase is purely additive on the parser and replaces logic on the send path; existing connection management stays as-is.
- The empirical evidence file (a throwaway `/tmp/queue-test` session) has been torn down; if the implementer wants to re-verify, the reproduction pattern is in the shape file's Vehicle notes.

</specifics>

<deferred>
## Deferred Ideas

- Distinguishing "queued" from "actively being processed" as separate visual bubble states. The signal exists — `queue-operation dequeue` fires as the harness drains a queued message — but adding a visual for it now would be chrome noise without matching value. Pick it up as its own change if a use case surfaces.
- Introducing a per-message identifier attached to outgoing sends and echoed back in the session file, to give perfect matching without FIFO+content-hash. FIFO+content is sufficient; a real identifier would require harness-side cooperation the app doesn't have.
- Replacing the T+~20s outer timer with something that adapts to observed harness behavior (rolling average of signal latency, etc.). Fixed and honest beats clever and drifty. Revisit only if 20s proves genuinely wrong across a range of conditions.
- Any change to how queued messages ORDER in the harness's own queue or how Claude Code renders them in its own display. Out of scope — this phase is Skynet-side only.
- Any "delivered vs read" two-tier state model from consumer-messenger prior art. There is no distinct "recipient read it" event in this domain; the single "message accepted" signal is all we get and all we need.

</deferred>

---

*Phase: 50-optimistic-message-bubbles*
*Context gathered: 2026-08-19 via /build → /open discussion*
