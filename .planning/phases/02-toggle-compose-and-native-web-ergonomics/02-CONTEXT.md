# Phase 2: Toggle, compose, and native web ergonomics — Context

**Gathered:** 2026-07-17
**Status:** Ready for planning
**Source:** Synthesized from shape file `.planning/shapes/shape-pretty-session-view.md` (patch #43 /open artifact), equivalent to PRD Express Path. Extends Phase 1's context with Phase 2 scope and layer-in points against the shipped read-only pipe.

<domain>
## Phase Boundary

This phase turns Phase 1's read-only pretty view into a real chat surface:

1. Replaces the `#pretty=1` URL-fragment gate with a real keyboard chord that flips the top pane between the existing tmux mode (default) and the pretty mode, per pane, per tab.
2. Preserves the message queue drawer at the bottom across mode flips — same position, same behaviour, no re-mount side effects.
3. Adds a compose box below the conversation with Enter-sends / Shift-Enter-newline semantics, sending through the same split-send WebSocket input path patch #40 established.
4. Verifies that native browser text-selection and click-to-focus behaviour already work correctly by virtue of Phase 1's HTML render (RENDER-04/05 are avoided problems, not implementation tasks — see below).

Phase 2 does NOT change the backend session-file discovery / tail / WS bridge — that pipe is shipped and stable. All Phase 2 work is frontend + one new tiny WS input plumbing detail (the compose box's send path) at most. If Phase 2 finds itself changing `src/backend/claude-session/`, something has drifted from the shape.

</domain>

<decisions>
## Implementation Decisions

### RENDER-04 and RENDER-05 are verify-only, not implementation (Ashley clarified at /id reset 2026-07-17)
- RENDER-04 (native browser text selection with no highlight-then-Enter dance) and RENDER-05 (click-to-focus without accidentally starting a selection) come for **free** with Phase 1's HTML `PrettyView.tsx` — they are avoided problems, not build items.
- The planner MUST treat these as verification / acceptance items in the phase's success criteria, NOT as tasks in the plan. Do not create a plan file whose goal is "make text selectable" or "fix click focus."
- If verification finds a regression (e.g., a Phase 2 wrapper accidentally sets `user-select: none`, or a click handler stops event propagation and eats the browser's native focus), that becomes a Phase 2 remediation task at that time — but do not pre-emptively plan for it.

### Toggle mechanism — real chord, replaces URL fragment (TOGGLE-01, TOGGLE-02)
- The chord IS the mechanism. The `#pretty=1` URL-fragment gate at `src/ui/shell/tabUtils.tsx:137-153` is scaffolding from Phase 1 and MUST be removed as part of this phase (the fragment gate and the real chord are mutually exclusive — leaving both in place invites the "which one wins" bug).
- Reference implementation: `src/ui/hooks/use-keyboard-close-tab.ts` (patch #37) and `use-keyboard-message-queue.ts` (patch #39). Both use the SAME shared pattern that Phase 2 MUST follow: document-capture-phase keydown handler, `enabledRef` reading `localStorage["<key>Enabled"]` with a `<key>EnabledChanged` window event for cross-component sync, and `e.code === "..."` (not `e.key`) for layout independence. Deviating from this pattern will drift the fork.
- Chord choice: **Ctrl+Shift+O** is the recommended default (unbound in Chrome + VS Code + Ashley's OS binding table per patch #37 lesson-learned; adjacent-alphabet to Ctrl+Shift+I devtools but not colliding). Planner should confirm with Ashley before committing.
- Toggle state lives on the **Terminal component per pane** (like the message queue drawer's `isMessageQueueOpen` state, patch #39). No global store; every fresh Terminal mount starts in tmux mode (TOGGLE-02).
- The chord acts on the ACTIVE tab only (same guard pattern as patch #37 — dashboard/RDP/VNC/files ignored). Non-terminal tabs are a no-op.

### Every fresh tab opens in tmux mode; NO persistence of mode choice (TOGGLE-02)
- Explicitly out of scope: persisting the mode across tab reload, session restore, or reopenTabsOnLogin. The shape file's "Not persistent about mode choice" language is a hard lock.
- Do NOT extend the `Tab` type (`src/types/ui-types.ts`) with a `mode` field. Do NOT add mode encoding to `tab-url.ts` (patch #25) or `open_tabs` schema (patch #7). If the planner surfaces those as tasks, that is a scope violation.
- The `#pretty=1` fragment removal is a corollary — it was the only Phase-1 persistence vector; killing it eliminates the temptation to keep any.

### Message queue drawer preserved across flips (TOGGLE-03)
- Terminal.tsx (patch #39) already carries a flex-column outer wrapper with the drawer as a sibling below xterm. Phase 2 must preserve that layout for BOTH modes: in tmux mode, the top region hosts xterm; in pretty mode, the top region hosts PrettyView. The drawer sits below in either case, identically.
- The drawer's mount MUST NOT re-mount on mode flip — losing an in-flight compose or scroll state is a "heavy flip" failure per the shape's "what would make it wrong."
- Practical implication: the outer flex-column wrapper + drawer live at the same level in the tree; only the top region's inner content swaps between xterm and PrettyView. Do NOT unmount Terminal and mount a separate PrettyPane wrapper — that would recreate the drawer.

### Compose box — Enter sends, Shift-Enter newlines, split-send (COMPOSE-01..03)
- Compose box mounts INSIDE the pretty view pane, directly below the conversation scroll region. It is not part of the queue drawer (which stays at the bottom in either mode) and is not related to the drawer's per-message-list layout — the compose box is a single always-present textarea, the drawer is a queue.
- Enter-key semantics: `e.key === "Enter" && !e.shiftKey` triggers send; `e.key === "Enter" && e.shiftKey` inserts a newline in the textarea (default textarea behavior; do not preventDefault).
- Send path: reuse `TerminalHandle.sendInput(data)` from `terminal-types.ts` (patch #40 already exposed this for the queue drawer). The Terminal ref is available at the tab level (already threaded to MessageQueueDrawer). Compose calls sendInput twice with a ~60ms setTimeout gap: first the message body, then `\r` — this is patch #40's proven split-send that defeats Ink's bracketed-paste batching in Claude Code's REPL.
- **Multi-line message handling — Claude's Discretion for the planner, with a fence.** COMPOSE-05 forbids "[pasted N lines]" collapse but the send path still has to interoperate with Ink. Two viable shapes: (a) preserve newlines in the compose textarea for display but collapse to spaces on send (matches queue drawer's patch #39 behaviour, cleanest for Ink); (b) preserve newlines on send by chunking as `line + \r + line + \r ...` with 60ms gaps between each line (more faithful to what the user typed but higher risk of Ink misinterpreting mid-message Enter as submit). Planner should default to (a) with a note recommending (b) as a future patch if Ashley wants literal multi-line preserved end-to-end.

### No optimistic display of sent messages (COMPOSE-04) — HARD LOCK from shape
- Sent messages MUST NOT appear in the conversation until the session file tail confirms them.
- The natural implementation: after send success, clear the compose textarea and wait for the next session-file event to bubble through the existing Phase 1 WS bridge — the user's message will appear when it lands in the JSONL on disk (typically <1s after Claude Code's REPL processes the input).
- Do NOT add a "sending..." spinner, a pending-message ghost bubble, or a client-side echo. The shape file names "optimistic bubbles that lie about state" as a stop-the-line failure.
- If send fails (e.g., WS is disconnected), surface an inline error near the compose box — do NOT drop the user's typed text (they may want to retry). Textarea contents stay until send succeeds.

### Pastes stay readable in compose box (COMPOSE-05)
- Compose box is a plain HTML `<textarea>`. Paste behaviour is the browser default: the full pasted text lands in the textarea, visible to the user. No paste-event interception, no collapse, no summarization.
- The COMPOSE-05 requirement is about defeating Claude Code's OWN "[pasted N lines]" collapse — which happens when Claude Code's Ink REPL receives a large paste as a bracketed-paste block from the terminal. Because Phase 2's compose box sends via the WebSocket input path (patch #40 split-send), not via a real terminal-paste event, Claude Code sees "typed" input rather than pasted input and does not trigger its collapse behaviour.
- This means COMPOSE-05 is largely a **verification** requirement: verify that a large paste into the compose box arrives in Claude Code's REPL as full readable content, not a "[pasted N lines]" summary. Add a manual UAT step. No dedicated implementation task unless verification fails.

### Chord conflict discipline (learned from patch #37 K→L switch)
- The chord chosen MUST be verified against Ashley's live OS bindings before ship. Patch #37 shipped Ctrl+Shift+K and had to be resworn to Ctrl+Shift+L because Ashley's OS-level speech-to-text hotkey ate K. Add a UAT step: "Ashley confirms the chord flips modes on all her active OS-level binding profiles."
- Chord must also survive xterm's own key handler AND Guacamole's key handler on other tabs — this is why the document-capture-phase pattern (patch #37 reference implementation) is non-negotiable.

### Claude's Discretion
- **Chord choice** — Ctrl+Shift+O recommended, planner should propose 1–2 alternates in case Ashley has a conflict.
- **Compose box height / min-height** — 2 rows default, auto-grow to N rows on newline (planner picks N; 6 rows is a reasonable cap). Matches queue drawer textarea shape.
- **Where the mode-toggle state lives in Terminal.tsx** — a `useState<'tmux' | 'pretty'>('tmux')` sibling to `isMessageQueueOpen` is the natural home. Planner confirms.
- **What triggers a `TerminalHandle.toggleMode()` method** — parallel to the existing `toggleMessageQueue()` (patch #39). Planner adds to `terminal-types.ts`.
- **Compose send failure copy** — inline error text below compose box; wording is Claude's Discretion (short, non-alarming). Do NOT toast, do NOT modal-dialog.
- **Whether the compose box is a shared component with the queue drawer's textarea** — probably not; the queue drawer is a queue-of-messages surface and the compose box is a single always-present entry. Duplication is fine here; sharing would drag scope. Planner note.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### The design contract
- `.planning/shapes/shape-pretty-session-view.md` — **authoritative** shape file (Ashley 2026-07-17). Re-read the Philosophy, "What would make it wrong," and "Scope edges" sections before every planning + implementation decision. "Not persistent about mode choice" and "Not optimistic about sends" are the two hard locks Phase 2 must not accidentally erode.

### Phase 1 artifacts (shipped, stable — DO NOT modify unless verification finds a bug)
- `src/backend/claude-session/session-file-discovery.ts` — pane→process→session-file walker.
- `src/backend/claude-session/session-file-tail.ts` — tail loop.
- `src/backend/claude-session/session-file-parser.ts` — JSONL parser (conversational-messages only).
- `src/backend/claude-session/claude-session-server.ts` — WebSocket bridge on port 30011 (note: originally 30003, moved to 30011 to avoid tunnel-server collision; see history 2026-07-17).
- `src/ui/features/pretty-view/PrettyView.tsx` — read-only chat renderer, WS client, auto-scroll behaviour.
- `src/ui/features/pretty-view/ChatMessage.tsx` — per-message bubble.
- `src/ui/features/pretty-view/use-auto-scroll.ts` — chat-app scrollback convention hook.
- `src/ui/shell/tabUtils.tsx:120-183` — Phase 1's `TerminalTabContent` with the `isPrettyMode` computed off `#pretty=1`. Phase 2 removes the fragment gate and lifts mode state up to Terminal.

### Prior-art code (Termix fork) to reuse — MUST follow these patterns
- `src/ui/hooks/use-keyboard-close-tab.ts` — reference implementation for the mode-toggle chord. Copy this shape 1:1 (adjust `KeyCode` and `localStorage` key). Patch #37 pattern.
- `src/ui/hooks/use-keyboard-message-queue.ts` — a second reference for the same pattern; Ctrl+Shift+; opens the drawer, dispatched via `TerminalHandle.toggleMessageQueue()`. Patch #39 pattern.
- `src/ui/hooks/use-keyboard-tab-nav.ts` — original reference (patch #31). All three keyboard-chord hooks in this dir follow the same shape; Phase 2's new hook makes four.
- `src/ui/AppShell.tsx` — three hook calls sit in the keyboard-chord neighborhood in a row (patches #31, #37, #39). Add the new hook call as a fourth adjacent line; keep the neighborhood organized.
- `src/ui/features/terminal/Terminal.tsx` — the busiest file on the branch (patches 1/3/6/13/17/24/26/28/33/39/40/41 all touch it). Patch #39 established the flex-column wrapper for the drawer. Phase 2 layers mode-swap on the inner top region; DO NOT change the outer flex-column or the drawer sibling mount.
- `src/ui/features/terminal/MessageQueueDrawer.tsx` — reference for a textarea-driven compose surface with server-side persistence. The Phase 2 compose box does NOT have persistence (it's ephemeral entry, not a queue), but the textarea handling, split-send call pattern (patch #40), and error-surface UX are all reusable in spirit.
- `src/ui/features/terminal/terminal-types.ts` — `TerminalHandle` interface. Already exposes `sendInput(data)` (patch #40) and `toggleMessageQueue()` (patch #39). Phase 2 adds `toggleMode()` (or similar; planner names).
- `src/ui/sidebar/UserProfilePanel.tsx` — three keyboard-chord SettingRow toggles already stack in the same neighborhood (Tab Switching, Close Tab, Message Queue). Phase 2 adds a fourth for the mode-toggle chord; localStorage key + `<key>EnabledChanged` window event follow the same convention.
- `src/ui/locales/en.json` — three `keyboard*` + `keyboard*Desc` key pairs already present; add a fourth.

### The project scope
- `.planning/PROJECT.md` — Termix fork context; Core Value = Ashley never loses access.
- `.planning/REQUIREMENTS.md` — Phase 2 covers TOGGLE-01..03, RENDER-04..05 (verify-only), COMPOSE-01..05.
- `.planning/ROADMAP.md` — Phase 2 Goal and Success Criteria.
- `.planning/phases/01-live-session-stream-to-browser-read-only-pretty-view/01-CONTEXT.md` — Phase 1 context; the "Rendering — Chat App, Not Terminal Wrapper" section and the "No-Active-Session Fallback" already govern PrettyView; Phase 2 does not restate those.

### Deploy discipline (STANDING CONSTRAINT — NOT a plan task)
- The fork's mandatory 15-min deadman rollback timer (`/opt/termix/.tmp-revert.sh`) fires on every deploy per Ashley 2026-07-03; no exceptions.
- Every backend route change (Phase 2 has none unless verification finds one) needs matching nginx location blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`. Phase 2 SHOULD NOT introduce backend route changes; the compose box send reuses the existing terminal WS input path.
- Fork build: `sudo bash /opt/termix/termix-patches/build-termix.sh`. Deploy: `cd /opt/termix && sudo docker compose up -d --force-recreate termix`.
- Fleet directive (Ashley 2026-07-12): pre-authorized code work does NOT authorize the deploy — every build → deploy transition is a distinct ask. Planner should note this so the executor doesn't stumble.

### Docs / runbook
- `/home/ubuntu/AGENTS.md` — fork runbook. Patches #37 (Ctrl+Shift+L close), #39-41 (message queue drawer with split-send) are the closest analogs to Phase 2's chord + compose work. Phase 2 will need its own dense per-patch write-up in AGENTS.md as part of close-out (already tracked in the pretty-session-view bounty todos).

### External (informational only, not a dependency)
- `github.com/delexw/claude-code-trace` — Phase 1 informational reference; Phase 2 does not need it.

</canonical_refs>

<specifics>
## Specific Ideas

- **Phase 2 should ship as a single fork commit** (patch #44 in the numbered patch series) unless the executor discovers a natural mid-commit break. Aligns with the fork convention where each numbered patch is individually PR-able against upstream.
- Test the chord AND the compose flow in production against a REAL live Claude Code session (any of Ashley's active workstation panes). A unit-tested compose that doesn't work end-to-end because of a split-send timing edge case (patch #40 lesson) is worse than shipping without unit tests. Manual UAT is authoritative here.
- The `#pretty=1` URL-fragment removal cleanup is easy to overlook. Explicitly plan a task to remove:
  - The `isPrettyMode` useMemo in `tabUtils.tsx:137-143`.
  - The branching mount in `tabUtils.tsx:146-153` (the PrettyView conditional).
  - The `PrettyView` import in `tabUtils.tsx:19` (unless PrettyView is now imported elsewhere for the toggle).
  After removal, PrettyView must be imported and mounted inside Terminal.tsx (adjacent to the message queue drawer's conditional mount), gated by the new mode state.
- **Do NOT add a URL fragment for the mode.** No `#mode=pretty`, no `#pretty=1` preservation. Every fresh tab opens tmux (TOGGLE-02); if the user wants to arrive on a specific pretty session, they open the tab and flip. Restating this because it's the single most tempting scope violation.
- Watch for regressions to patches #26 (session-tint overlay), #17 (IdentityBadge), #33 (tmux target session), #39-41 (message queue drawer) when refactoring Terminal.tsx layout. The flex-column mount, absolute-positioned overlays, and IdentityBadge top-right anchoring all coexist there. Add a UAT checklist for each.
- The identity registry (patch #17) infrastructure exists — Phase 2 could tint the compose box or per-message bubbles by identity hue for visual consistency with tmux mode. Judgment call for the planner: nice-to-have if trivially cheap; skip if it adds even one file worth of scope. The shape file does not call for it.

</specifics>

<deferred>
## Deferred Ideas

Explicitly OUT of Phase 2 (either future v2 or out-of-scope entirely):

**Future v2 patches (each its own separate design conversation):**
- Tool call / tool result / thinking-block rendering (RENDER-V2-01..05)
- Cross-session browser / historical session picker (NAV-V2-01..02)
- "tmux wants your attention" detection (UX-V2-01)
- Persist per-tab mode choice across tab opens (UX-V2-02) — hard-locked out of Phase 2 by TOGGLE-02
- Per-identity chat aesthetic in pretty view (identity hue tinting of compose or bubbles)

**Out of scope entirely:**
- Replacing the tmux pane (pretty view is an alternate mode, not a replacement)
- Interactive tmux features in pretty view (approval prompts, arrow-key nav, slash-commands like /agents /monitor, escape sequences, Ctrl-C on runaway) — users flip to tmux for these
- Optimistic display of sent messages — hard-locked by COMPOSE-04
- Multi-user simultaneous view of the same session
- Rich paste treatment (rendering pasted attachments, image previews)

**Out of Phase 2, in a follow-up patch if Ashley wants it:**
- Multi-line preservation on send (COMPOSE-05 note): compose textarea preserves newlines visually today per browser default; whether the send path preserves them as `line + \r + line + \r ...` chunks or collapses to spaces is Claude's Discretion in Phase 2. If Ashley later wants literal multi-line end-to-end, it's a small follow-up.

</deferred>

---

*Phase: 02-toggle-compose-and-native-web-ergonomics*
*Context gathered: 2026-07-17 via shape-file synthesis (equivalent to PRD Express Path), extending Phase 1 context*
