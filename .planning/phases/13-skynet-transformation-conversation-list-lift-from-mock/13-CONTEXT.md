# Phase 13: Skynet transformation — conversation list lift-from-mock — Context

**Gathered:** 2026-07-23
**Status:** Ready for planning
**Source:** Direct user conversation (Ashley 2026-07-23, this session) — no discuss-phase needed because the mock IS the source of truth and Ashley has been telling me this framing across MANY sessions; the failure pattern up to now was not context-gathering, it was fragmenting the movement into sibling bounties instead of trusting the mock as the target.

<domain>
## Phase Boundary

**In scope (the ONLY things this phase touches):**
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — panel container + header (title + pencil) + scroll region
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — row rendering including all state variants (selected, active-set/ambient, working, pinned)
- `src/ui/features/pretty-conversations/PinAction.tsx` — pin/unpin button
- A NEW `src/ui/features/pretty-conversations/pretty-conversations.css` (or CSS module) that holds the mock's flat CSS lifted verbatim
- `src/ui/AppShell.tsx` — ONLY the shell chrome around the sidebar-toggle chevron (~L1407 area); no other AppShell changes
- Possibly `src/ui/index.css` — if a new `--color-pv-*` token is needed to support a mock treatment we don't already have; append-only, no rebase of Skynet `--background`

**Strictly OUT of scope (verified with Ashley 2026-07-23 verbatim):**
- `src/ui/features/pretty-view/*.tsx` — the pretty-view chat surface interior (bubbles, compose box, IdentityBadge, message rendering, chat-column background). "Leave alone, already good, locked."
- `src/ui/components/*.tsx` — shadcn primitives (input, skeleton, sidebar, card, sheet, sonner, password-input, command, tabs, alert-dialog, switch, etc.). Ship-of-Theseus rule: they still serve the RDP/SSH dialogs and xterm.js chrome that Ashley DOES see when she uses RDP/SSH, and preserving them preserves upstream Skynet rebase-ability.
- `src/ui/ssh/dialogs/` — OPKSSHDialog, SSHAuthDialog, TmuxSessionPicker, WarpgateDialog, ConnectionLog. Same rule.
- `src/ui/features/terminal/*` — xterm.js chrome. Same rule.
- Backend routes — Phase 13 was originally scoped as backend route cleanup, and Ashley called that off in the 2026-07-23 mid-purge discussion (kept for rebase-ability, zero user impact). This Phase 13 is the RENAMED phase — the backend-routes-cleanup phase is dead.

**The mock is the source of truth.** `~/.claude/identities/tina/bounties/skynet-transformation/prototype.html` (mock v4, Ashley signed off 2026-07-23 07:20Z). The v4 lock is: Full bubble intensity + Normal density + active-set/ambient recession + ONE dot with ONE meaning (row is in active set AND agent is idle). "Reduced" and "Selection-only" intensity variants in the mock are exploratory — Full is what ships. Density variants (tight/normal/cozy) — Normal is what ships. Do NOT re-litigate v4 lock — it's the target.

</domain>

<decisions>
## Implementation Decisions (LOCKED)

### Styling architecture (LOCKED)
- **Retire JS-computed inline styles** for the base + state variant treatments in `PrettyConversationRow.tsx`. Move all row visual definition into a real CSS file.
- **Retire Tailwind layout scaffolding** on the row itself (`flex-1 min-w-0 flex flex-col gap-0.5`, `shrink-0 flex items-center gap-1.5`, `rounded-full`, etc. on the row/avatar/body/meta divs). The mock uses raw CSS layout (`display: flex`, `flex: 1`, etc.). Lift THAT.
- **Keep JS for**: swipe reveal (mobile), ready-dot conditional render (`{inActiveSet && isWorking === false && <span class="dot" />}`), avatar image src selection, click handlers, aria-labels. Those are logic, not styling.
- **State variants are class toggles**, not JS-computed style branches. The React component composes `className` with concatenation or `clsx`: `<div className={cn("row", selected && "selected", inActiveSet && "active-set", isWorking && "working", pinned && "pinned")}>`. CSS handles the rest.

### Mock recipe details worth pinning
- Row base: `padding: 10px 12px; gap: 12px; border-radius: var(--radius-pv-bubble);` with `linear-gradient(160deg, hsla(hue, 50%, 38%, 0.55), hsla(hue, 45%, 24%, 0.60))` background, hue border 32%, warm inset rim, backdrop-filter blur(20px) saturate(1.5). Text color `#fbf5e8` (creamier than base fg).
- Row.hover: translateY(-1px), shadow +10%, border 42%.
- Row.selected: translateY(-1px), border 55%, shadow +30%, warm inset 28%, hue outer glow 34%.
- Row.active-set (default = row is in Ashley's active set, i.e. full bubble): base treatment applies as-is.
- Row NOT in active-set = ambient/recessed. **Mock's reduced-intensity variant** has bg at higher alpha than the current live implementation — the live's `hsla(hue, 40%, 20%, 0.16)` is TOO recessed. Use the mock's Reduced treatment (verify exact values from prototype.html when planning).
- Row.working: displays no dot (only ambient rows display no dot, and dot appears only on `active-set:not(.working)` rows per Ashley 2026-07-23 v4 lock — "one meaning: this row is in the active set AND its agent is idle").
- Row.pinned: pin icon visible; `.row:not(.pinned) .meta .pin { display: none }`.
- Avatar: 40x40 circle, gradient (deeper than row), hue border 40%, warm inset 35%, hue outer glow 40%. Warm cream 700-weight text or image.
- Panel: linear-gradient bg (`--color-pv-surface-quiet` → `--color-pv-surface-quiet-alt`), border-radius `--radius-pv-card`, backdrop-blur 28px + saturate 1.3, big drop shadow.
- Panel-header: 14px 16px padding, hairline `border-bottom: 1px solid --color-pv-border-quiet`. Title: 12px + 700 + 0.1em letter-spacing + UPPERCASE + `--color-pv-fg`. Pencil: 32x32, transparent bg + border, border-radius 8px, `--color-pv-fg-muted` icon.
- Pin (when pinned): `color: hsla(hue, 80%, 70%, 0.95)` + `filter: drop-shadow(0 0 4px hsla(hue, 80%, 60%, 0.55))`. No button chrome.

### AppShell shell chrome (LOCKED scope)
- ONLY the top bar with the sidebar-toggle chevron. Do not scope-creep into other AppShell chrome, keyboard handlers, tab state, etc.
- Rebase color decisions to `--color-pv-*` tokens. No new theme classes.
- Button style: transparent icon, rounded-md 8px, hue-tinted hover. Match panel-header pencil aesthetic.

### Compose order
- Wave 1: Extract mock CSS into `pretty-conversations.css` + rewrite `PrettyConversationRow.tsx` markup to use it. Panel still renders old-style header.
- Wave 2: Rewrite `PrettyConversationsPanel.tsx` header to mock treatment. AppShell shell chrome rebase.
- Wave 3: Rewrite `PinAction.tsx` to bare-icon-with-glow.
- Wave 4: Post-lift verification/investigation (dot visibility, mobile scroll-freeze, safe-area padding).
- Wave 5: Build verify + UAT checklist + patch draft.

Planner may re-slice, but keep atomic-commits-per-file discipline (Phase 11+12 pattern).

### Claude's Discretion
- Exact CSS file organization (single `pretty-conversations.css` vs per-component modules)
- Whether to keep any existing helpers (`tokens.ts`) or retire them
- Whether to introduce `clsx` if not already imported (probably is already)
- Test file updates (`PrettyConversationRow.test.tsx` + `PrettyConversationsPanel.test.tsx` exist; adjust as needed for new markup structure)
- Whether the `isAmbient = !isRdp && !inActiveSet` logic stays in JS (probably yes — it's business logic) or moves to CSS (probably no)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents (planner + executors) MUST read these before planning or implementing.**

### Design source-of-truth
- `~/.claude/identities/tina/bounties/skynet-transformation/prototype.html` — LOCKED mock v4, Ashley signed off 2026-07-23. The Full-intensity + Normal density variant with active-set/ambient recession and single ready-for-attention dot is what ships. Read the `<style>` block AND the semantic HTML for row/avatar/body/meta markup structure.

### Mental model + scope authority
- `~/.claude/identities/tina/tina.md` § "Skynet direction — the app IS Telegram" — the two-surfaces rule (pretty-view chat surface = DONE and LOCKED; conversation list + shell chrome = final unfinished piece). The "one bounty for the entire movement" rule (all Ship-of-Theseus work folds into `skynet-transformation` master bounty; no siblings).

### Master bounty
- `~/.claude/identities/tina/bounties/skynet-transformation/bounty.json` — timeline + todos for the entire Ship-of-Theseus movement (Phases 11+12+13). Phase 13 progress + closeout updates go IN this bounty, not in a sibling.

### Existing implementation to be replaced/rebased
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — 709 lines, mostly JS-computed inline styles for base + variant states. This is what gets rewritten with the mock's flat CSS class-toggles.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — 429 lines, panel container + header + scroll region + empty state + NewSessionDialog wiring. Header is what changes (title typography + pencil chrome); rest stays.
- `src/ui/features/pretty-conversations/PinAction.tsx` — pin button that currently renders as Skynet-button-chrome. Rewrite to bare-icon-with-glow.
- `src/ui/features/pretty-conversations/tokens.ts` — check whether it's still needed after the CSS rewrite.
- `src/ui/AppShell.tsx` L1407-1568 — the sidebar-toggle chevron area (comment there: "Phase 10 Wave 3: persistent top-left sidebar-toggle chevron"). Rebase color/chrome decisions here to mock aesthetic.

### Palette + token authority
- `src/ui/index.css:117-146` — `--color-pv-*` tokens (base gradient, warm-cream text, hue rims, radius-pv-bubble, radius-pv-card, shadow-pv-*). These are the ONLY tokens the survivor surfaces reference. Do NOT chase Skynet's `--background`/`--foreground` values.

### Prior phase precedents (planning + execution pattern)
- `.planning/phases/11-skynet-transformation-purge-dead-skynet-surfaces-first-slice/` — Wave-based decomposition + STRIP-LIST enumeration + atomic-commits-per-file pattern
- `.planning/phases/12-skynet-transformation-purge-dead-frontend-surfaces-second-slice/` — Same

### Diagnostic candidates (dot visibility, if lift alone doesn't fix)
- `src/ui/features/terminal/Terminal.tsx` — `isIdle` starts at null, flips on backend WS ticker. Check whether ticker has fired for Ashley's active session post-recreate.
- `src/stores/session-working-store.ts` (patch #137) — sessionWorkingKey = `${row.host?.id}:${row.targetTmuxSession ?? ''}`. If ConversationRow's row.targetTmuxSession is null but Terminal publishes real tmuxSessionName from hostConfig, keys mismatch.
- `src/stores/conversation-store.ts` (patch #137) — activeSet is sessionStorage-backed. Verify populate on fresh browser session.
- `PrettyConversationsPanel.tsx` — `PrettyConversationRowLive` micro-component. Verify Rules-of-Hooks compliance.

</canonical_refs>

<specifics>
## Specific requirements from Ashley (this session, 2026-07-23)

- "The bar at the top that says the name of the session still looks Skynet" — pretty-view context — but she also said "leave the pretty view chat interior alone." **Reconciliation:** the "top bar in pretty view" that she called out as still-Skynet-looking is NOT the IdentityBadge inside PrettyView; it's the AppShell shell chrome around it (the surface with sidebar-toggle). That IS in scope. The IdentityBadge itself and everything else inside `src/ui/features/pretty-view/` is out.
- "The bar at the top that says like conversations or something that to me looks like it's coming out of old Skynet stuff" — that's the PrettyConversationsPanel's `.panel-header` with the 13px mixed-case chunky title + filled-glass pencil pill. Rewrite to mock's UPPERCASE + tracking + transparent-pencil.
- "Active conversations like ones that I've already loaded into since I loaded the page are not glowing fully like they were supposed to. It seems like they more get like a glowing border or something." — ambient recession is too aggressive (0.16 alpha bg is nearly invisible; only the faint border shows) OR the `inActiveSet` flag isn't propagating. Fix by lifting the mock's Reduced-intensity ambient values AND by re-checking dot/active-set propagation post-lift.
- "The pin buttons are totally obnoxious" — retire the button chrome (`rounded-md bg-transparent hover:bg-white/[0.06]` + Skynet muted-gray icon color) and lift the mock's bare-icon-with-hue-drop-shadow, hidden when not pinned.

## Meta-lesson pinned this session (Ashley 2026-07-23 verbatim)

"I have fifteen other agents running the same way that you do and they just don't seem to have the same problem. So I don't- I don't know if this problem came from the fact that we weren't keeping this like tracked in a single bounty..."

The failure pattern: I fragmented the Ship-of-Theseus movement into sibling bounties (`conversation-list-bubble-badge-restyle`, `conversation-list-idle-vs-wip-state`, `phase10-mobile-tap-and-scroll-freeze`, `sidebar-scroll-escapes-appshell-padding`) instead of tracking it all inside the master `skynet-transformation` bounty. Fresh-session-me read them as unrelated open items and had to re-derive the vision every time. Fixed this session: renamed master bounty, merged the 4 fragments in, rewrote `tina.md § Skynet direction` to lead with the Telegram-shape framing so future-me arrives with it. Phase 13 progress updates go IN the master bounty's timeline+todos, NOT in a sibling.

</specifics>

<deferred>
## Deferred Ideas

- Pretty-view feature additions (message queue rendering, tool-use rendering, translation asides, scroll-to-bottom UX) — those are their own bounties, NOT Ship-of-Theseus work. Don't fold them into Phase 13.
- Backend routes serving now-dead UI — deliberately deferred forever per Ashley 2026-07-23 (zero user impact + upstream rebase-ability preservation).
- shadcn primitives / SSH-RDP dialogs / xterm chrome theme-class refactor — Ship-of-Theseus rule preserves them.
- The `deploy-runbook-stale-git-push-line` and `claude-md-15min-deadman-stale` bounties are docs hygiene, not Phase 13 scope. `/gsd:quick` those when convenient.

</deferred>

---

*Phase: 13-skynet-transformation-conversation-list-lift-from-mock*
*Context gathered: 2026-07-23 via direct user conversation + on-disk source-of-truth pinning (locked mock v4 + identity file § Skynet direction + master bounty)*
