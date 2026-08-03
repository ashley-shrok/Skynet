# Phase 21: Fleet auth reminders + guided re-login, in Skynet — Specification

**Created:** 2026-08-03
**Ambiguity score:** 0.14 (gate: ≤ 0.20)
**Requirements:** 10 locked

## Goal

Skynet automatically warns the user, via top-of-conversation-list cards, when the coding-harness login on any qualifying managed box is close to expiring (~5 days out against a ~30-day baseline) or has already expired — and provides an in-app guided re-login flow (full-app-blocking modal + hidden tmux session driving `claude /login`) that resolves the reauth without the user leaving Skynet or opening a shell on the box by hand.

## Background

Today Skynet has zero visibility into the auth state of any managed box's coding-harness. When the harness's refresh-token expires (~monthly, but sooner if concurrent processes race the rotation), the user finds out only by noticing agent silence hours later, or when a scheduled wake-up on that box fails silently against an unauthenticated harness. The user must SSH into the box, spawn `claude`, type `/login`, hit Enter for the first prompt, get a URL, complete OAuth in a browser, paste the code back, hit Enter twice more — a multi-step manual chore done separately for every affected box.

Grounded in the codebase:
- `src/backend/claude-session/identity-artifact-reader.ts` already reads remote `~/.claude/identities/**` files over SSH — the same primitive extends naturally to reading `~/.claude/history.jsonl` on managed hosts.
- `src/backend/claude-session/claude-session-server.ts` already spawns/drives tmux sessions on managed hosts and does read-modify-write over SSH — the same primitive extends to spawning a hidden session to drive `/login`.
- The pretty-view peek keyboard shortcut exists in `src/ui/features/pretty-view/` and toggles the raw-terminal reveal — its semantics extend to revealing the hidden login session behind the modal.
- The conversation-list surface at `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` is where the cards will live.
- `claude auth status` was verified on this box's harness (v2.1.150) to return `{loggedIn: bool, ...}` JSON and to be read-only against `~/.claude/.credentials.json` (mtime + hash unchanged after invocation).
- `~/.claude/history.jsonl` on this box contains `{"display": "/login", "timestamp": <unix_ms>, ...}` entries — exact-match filter on `display == "/login"` extracts the reauth boundary reliably.

The shape at `.planning/shapes/shape-fleet-relogin-flow.md` is the settled design source-of-truth for this phase.

## Requirements

1. **Capability-based qualification**: Only Linux hosts with `tmux` AND `claude` installed participate.
   - Current: no per-host coding-harness capability probe exists
   - Target: on Skynet backend startup and again whenever the managed-host list changes, Skynet probes each managed host via SSH for (a) Linux (`uname -s`), (b) `tmux -V` returns non-empty, (c) `command -v claude` returns non-empty. Hosts failing any check are silently excluded from the auth-reminder subsystem for the life of the process.
   - Acceptance: adding a Windows-only or non-tmux managed host does not surface any auth reminder for it; removing `claude` from a previously-qualifying box causes it to drop out of the reminder pool on next probe cycle.

2. **Per-box polling of last-login timestamp**: Skynet reads each qualifying box's `~/.claude/history.jsonl` for the most-recent `/login` command entry.
   - Current: no such read happens
   - Target: on a cadence of once per hour (± jitter to avoid thundering-herd), Skynet fetches the tail of each qualifying host's `~/.claude/history.jsonl` over SSH, filters for `display == "/login"` (exact match, JSON-parsed line-by-line), takes the max `timestamp` value, stores as `authLastLoginMs` in per-host in-memory state.
   - Acceptance: manually running `/login` on a qualifying host and waiting one polling cycle results in `authLastLoginMs` for that host advancing to a value within one minute of the actual `/login` time.

3. **Per-box polling of current auth state**: Skynet calls `claude auth status` over SSH on each qualifying box.
   - Current: no such call happens
   - Target: on the same hourly cadence as requirement 2, Skynet runs `claude auth status` via SSH on each qualifying host, parses the returned JSON, extracts `loggedIn`, stores as `authLoggedIn` in per-host state. The call must not mutate `~/.claude/.credentials.json` (verified read-only on 2.1.150).
   - Acceptance: after polling a host whose harness is authenticated, `authLoggedIn === true`; after that host's harness auth is forcibly cleared (`rm ~/.claude/.credentials.json` in a test) and one polling cycle passes, `authLoggedIn === false`; verify with `stat` before/after that credentials.json mtime is unchanged by the call.

4. **Per-box computed status**: Skynet computes fine/warning/expired per host.
   - Current: no per-host auth status is computed
   - Target: for each qualifying host, `authStatus` is derived per polling cycle: `expired` if `authLoggedIn === false`; else `warning` if `authLastLoginMs > 0` AND `(now - authLastLoginMs) >= (25 days in ms)`; else `fine`. Constants: `WARNING_THRESHOLD_MS = 25 * 24 * 60 * 60 * 1000` (five days before the 30-day baseline).
   - Acceptance: a host with `authLoggedIn=true` and `authLastLoginMs` from 26 days ago computes to `warning`; same host with `authLoggedIn=false` computes to `expired`; same host with `authLastLoginMs` from 10 days ago computes to `fine`.

5. **WebSocket signals for status transitions**: Skynet pushes an event on any per-host status change.
   - Current: no such signal
   - Target: whenever a host's `authStatus` changes between polling cycles (fine↔warning, fine↔expired, warning↔expired), Skynet emits a WebSocket message `{type: "auth_status", hostId, status, authLastLoginMs}` to all connected pretty-view clients. On WebSocket reconnect, Skynet emits the current snapshot for every qualifying host (regardless of prior transitions) so a freshly-opened client sees the correct card set.
   - Acceptance: opening a new pretty-view client on a fresh WebSocket connection results in an `auth_status` message received for every qualifying host within 2s of connect; after a host transitions warning→expired mid-session, a single `auth_status` update is received without needing to reconnect.

6. **Top-of-list cards**: Cards for hosts in warning or expired state appear above all sessions in the conversation list.
   - Current: no such surface exists
   - Target: `PrettyConversationsPanel.tsx` renders a card list above the existing session/pin sections. One card per host with `authStatus !== "fine"`. Cards stacked with all `expired` cards above all `warning` cards; within each group, ordered by hostId. Expired cards use the pv-danger red palette; warning cards use a yellow (hue-38 amber, matching the existing amber-band meter color) palette. Each card shows the host name and a "Log in" affordance filling the right portion of the card. NO collapse when many cards — all cards always fully visible.
   - Acceptance: with 0 non-fine hosts, no card section renders (zero visual weight); with 1 expired + 2 warning hosts, 3 cards appear in the order expired-first-then-warning; clicking anywhere on a card triggers requirement 7.

7. **Guided-login modal with hidden session drive**: Clicking a card opens a full-app-blocking modal that drives `/login` on that host.
   - Current: no such modal or flow exists
   - Target: modal covers the entire app (existing modal-overlay pattern from IdentityModal). Modal orchestrates a backend-side flow: (a) spawn a hidden tmux session on the target host (name convention `_skynet-relogin-<hostId>-<epoch>`), (b) send `claude` + Enter to start the REPL, (c) send `/login` + Enter, (d) auto-confirm the auth-method prompt with a single Enter (subscription = option 1), (e) capture the URL emitted by the harness (regex match `https?://[^\s]+` against tmux pane content), (f) present URL to user in the modal — attempt window.open() for auto-tab, always render as clickable link fallback, (g) provide an input field for pasting the OAuth code back, (h) on paste-submit send the code as literal-string + Enter + Enter to the session, (i) wait for the harness's success signal (pane content contains a login-success marker or `authLoggedIn` on next poll flips true), (j) tear down the hidden tmux session (`tmux kill-session -t <name>`), (k) close the modal, remove the card. All whole-app-blocking; no other app interaction while modal is up.
   - Acceptance: clicking a card on a warning host opens a modal that within reasonable time presents a claude.ai OAuth URL; pasting a valid code into the field results in the modal closing, the card disappearing, and the target host's `authLoggedIn` reading true on the next poll.

8. **Cancel-tears-down on every abandon path**: Any way the modal is dismissed cleans up the hidden tmux session.
   - Current: no such lifecycle exists
   - Target: modal has an explicit Cancel affordance. Cancel, page navigation away from the pretty-view surface, WebSocket disconnect for > 30s, and Skynet backend restart all result in the hidden tmux session being killed via `tmux kill-session -t <name>` on the target host. On backend restart, a startup sweep runs `tmux ls | grep '^_skynet-relogin-'` on every qualifying host and kills any survivors.
   - Acceptance: after opening the modal and immediately closing it, `tmux ls | grep _skynet-relogin` on the target host returns empty within 5 seconds; after force-killing the Skynet backend process mid-flow and restarting it, the startup sweep kills any orphaned `_skynet-relogin-*` session on any host.

9. **Blanket per-step timeouts with retry-from-scratch**: Any step whose expected signal doesn't arrive in time fails the flow generically.
   - Current: no such timeouts exist
   - Target: each step of requirement 7 has an individual timeout appropriate to its work: spawn/start-repl = 15s, wait-for-URL = 30s, wait-for-user-code-paste = 15 minutes (user does the browser flow), wait-for-success-signal = 30s. If any step's timeout elapses before its expected signal is observed, Skynet tears down the tmux session (requirement 8 semantics) and shows a plain error message in the modal: "Login flow timed out at [step name]. Try again." Modal remains open with a Retry button that restarts the whole flow from step (a). NO per-step recovery attempts, NO partial-progress preservation.
   - Acceptance: forcibly blocking the URL emission (e.g. sending a bad harness command) causes the modal to show the timeout error within 35 seconds without hanging indefinitely.

10. **Peek-through via existing pretty-view peek shortcut**: The same shortcut that reveals the terminal behind pretty-view reveals the hidden login session behind the modal.
   - Current: no such peek exists for the login modal (the modal doesn't exist)
   - Target: while the login modal is open, pressing the pretty-view peek shortcut (whichever binding is currently wired to `PrettyView`'s "reveal underlying terminal" behavior) renders the raw tmux pane content of the hidden `_skynet-relogin-*` session inline behind (or as a peek-layer within) the modal. Release restores the modal-only view. NO on-screen button for peek — key-only.
   - Acceptance: opening the modal, pressing-and-holding the peek shortcut renders raw tmux pane text showing the actual state of the login session (URL emitted, prompt, whatever); releasing hides the peek and restores the polished modal view.

## Boundaries

**In scope:**
- Per-host capability probe (Linux + tmux + claude)
- Per-host hourly polling of `~/.claude/history.jsonl` for `/login` timestamps and `claude auth status` for current auth state
- Per-host status computation (fine/warning/expired) with 25-day warning threshold against 30-day baseline
- WebSocket `auth_status` transitions + full snapshot on connect
- Top-of-conversation-list cards, expired-above-warning, always fully visible
- Full-app-blocking guided-login modal driven by a hidden tmux session on the target host
- Auto-confirm of harness's auth-method prompt (option 1 = subscription)
- URL capture from tmux pane content + auto-open new tab + clickable fallback + code paste-back UI
- Cancel-tears-down semantics on every abandon path (explicit cancel, navigation, WS drop, backend restart)
- Blanket per-step timeouts (15s / 30s / 15min / 30s) with generic error + retry-from-scratch
- Peek-through via the existing pretty-view peek shortcut
- Auto-clear card on `authLoggedIn` next-poll transition to true
- Startup sweep of orphaned `_skynet-relogin-*` tmux sessions on every qualifying host

**Out of scope:**
- **Direct-message (Matrix) fallback channel** — deferred to a follow-up phase per user request ("save that for later")
- **Proactive re-login trigger outside the warning window** — the only entry point is a card, and cards only exist when a box is warning or expired
- **Dedicated fleet-wide auth-status glance view** — violates silence-when-fine; single-glance dashboard is out
- **Per-error-mode recovery flows** — coarse-grained timeout + retry-from-scratch is the whole story; no smart per-failure branches
- **Non-Linux, non-tmux, non-claude hosts** — silently excluded by capability probe
- **Per-box configurable threshold** — one fleet-wide constant (25 days) adjustable in one place
- **Adaptive threshold that learns each box's cycle** — feels clever, adds drift; fixed value is honest about the imprecision of the ~30-day estimate
- **Multi-account picker inside the modal** — harness's first prompt is auth-method (uniform), not account
- **Distinguishing race-induced expiry from natural expiry** — no user-actionable difference
- **Persisting or logging the OAuth code beyond the transient paste-back step** — trust posture stays same as existing SSH-key-holding
- **Cron-based day-zero safety net** — explicitly not shipping the pre-Skynet interim script

## Constraints

- **Coding-harness pinned to v2.1.150 fleet-wide.** The auto-confirm sequence (single Enter after `/login` for option 1, then paste code + Enter + Enter) is calibrated for that version. Any future harness upgrade is a separate concentrated effort that will re-verify these assumptions.
- **`claude auth status` must remain read-only.** Verified on v2.1.150 (mtime + hash of `~/.claude/.credentials.json` unchanged after call). Any plan that introduces token-rotating auth probes is a plan-checker BLOCK.
- **The `history.jsonl` filter must be exact-match on `display == "/login"`.** Substring match would false-positive on prose containing "/login" (verified in current file).
- **Hidden tmux session names must use the `_skynet-relogin-` prefix.** Enables the startup sweep to reliably identify and kill orphans without touching user-created sessions.
- **Polling cadence is hourly (± jitter).** More frequent adds SSH load; less frequent lets warnings surface too late relative to the 5-day margin.
- **NO push, NO build, NO deploy during code execution.** Per fleet directive "code work doesn't authorize ship" — plans commit atomically on the branch; Ashley greenlights ship separately.
- **NO worktrees.** Per fleet directive; work happens in the main tree on branch `feat/tab-title-from-tmux`.

## Acceptance Criteria

- [ ] Adding a non-Linux managed host produces zero auth reminders for it
- [ ] Removing `claude` from a previously-qualifying host causes it to drop out of the reminder pool on next probe cycle
- [ ] Manually running `/login` on a qualifying host and waiting one polling cycle advances that host's `authLastLoginMs` to within one minute of the actual /login time
- [ ] After forcibly clearing a host's credentials.json, the host's `authLoggedIn` reads `false` on the next polling cycle
- [ ] `claude auth status` invocation does not change `~/.claude/.credentials.json` mtime or hash on the target host
- [ ] A host with `authLastLoginMs` from 26 days ago and `authLoggedIn=true` computes to `warning`; same host with `authLoggedIn=false` computes to `expired`; same host with `authLastLoginMs` from 10 days ago computes to `fine`
- [ ] Opening a new pretty-view WebSocket connection results in a full `auth_status` snapshot for every qualifying host within 2s
- [ ] With 0 non-fine hosts, no card section renders in the conversation list (zero visual weight)
- [ ] With 1 expired + 2 warning hosts, exactly 3 cards render, expired first, no collapse
- [ ] Clicking a card opens a full-app-blocking modal
- [ ] The modal presents a claude.ai OAuth URL within 45s of opening (URL-capture step + timeout buffer)
- [ ] Pasting a valid code into the modal's input closes the modal, removes the card, and the target host's `authLoggedIn` reads `true` on the next polling cycle
- [ ] Closing the modal via Cancel results in `tmux ls | grep _skynet-relogin` returning empty on the target host within 5s
- [ ] Killing the Skynet backend mid-flow and restarting it results in orphaned `_skynet-relogin-*` sessions on any host being cleaned up by the startup sweep
- [ ] Forcibly blocking URL emission causes the modal to show a timeout error within 35s without hanging indefinitely
- [ ] Retry after timeout restarts the whole flow from scratch (new tmux session, fresh `/login`)
- [ ] Pressing the pretty-view peek shortcut while the modal is open reveals the raw tmux pane content of the hidden login session; release restores modal-only view

## Ambiguity Report

| Dimension          | Score | Min  | Status | Notes                                                                     |
|--------------------|-------|------|--------|---------------------------------------------------------------------------|
| Goal Clarity       | 0.90  | 0.75 | ✓      | Shape file locks WHAT + WHY end-to-end                                    |
| Boundary Clarity   | 0.95  | 0.70 | ✓      | Explicit in/out/deferred/tempting-but-no from shape                       |
| Constraint Clarity | 0.80  | 0.65 | ✓      | Harness pin, read-only invariant, 25-day threshold, tmux naming all locked|
| Acceptance Criteria| 0.75  | 0.70 | ✓      | 17 pass/fail criteria; some depend on discuss-phase HOW-details           |
| **Ambiguity**      | 0.14  | ≤0.20| ✓      |                                                                            |

Status: ✓ = met minimum, ⚠ = below minimum (planner treats as assumption)

## Interview Log

| Round | Perspective    | Question summary                     | Decision locked                                                                                          |
|-------|----------------|--------------------------------------|----------------------------------------------------------------------------------------------------------|
| —     | (auto-mode)    | Shape file drives WHAT + boundaries  | Ambiguity already 0.14 from shape file — no interview needed; requirements derived from shape + roadmap  |

Auto-mode reasoning: the phase entered spec-phase with a settled `/open`-produced shape file (`.planning/shapes/shape-fleet-relogin-flow.md`) that Ashley explicitly locked and told the workflow not to re-litigate. The shape's In/Out/Tempting-but-no lists provide boundary clarity; the shape's What/Shape/Philosophy sections provide goal clarity; the Prior Context section provides constraint grounding (30-day baseline, harness pin, capability qualification). Spec-phase's job here was to convert conceptual shape into falsifiable requirements + pass/fail acceptance criteria, not to re-discover the design.

---

*Phase: 21-fleet-auth-reminders-guided-re-login-in-skynet*
*Spec created: 2026-08-03*
*Next step: /gsd-discuss-phase 21 — implementation decisions (WHERE in the backend the poller lives, WebSocket message routing shape, card component reuse decisions, modal component design, tmux-drive pattern selection)*
