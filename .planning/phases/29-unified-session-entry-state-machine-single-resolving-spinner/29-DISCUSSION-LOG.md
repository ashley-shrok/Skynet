# Phase 29: Unified session-entry state machine — single resolving spinner fronts every overlay until deterministic verdict - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-10
**Phase:** 29-unified-session-entry-state-machine-single-resolving-spinner
**Areas discussed:** Spinner visual identity + copy, Anti-flash delay on entry, Error phase UI, Transient WS drops after resolved-to-active

---

## Spinner Visual Identity + Copy

| Option | Description | Selected |
|--------|-------------|----------|
| Reuse `PrettyViewLoadingOverlay` visual + keep "Loading…" copy | Same glass card, Loader2 spinning glyph, iOS backdrop-filter hardening, current copy | ✓ |
| New spinner visual + different copy (e.g. "Connecting…", "Resolving…") | Fresh visual design; copy that more accurately reflects "figuring out state" rather than "loading data" | |

**User's choice:** Reuse as-is (Claude recommendation, Ashley confirmed via "let's go").
**Notes:** Not part of this phase's win to redesign what she already knows. Motion channel `animate-spin` on Loader2 is correct here (surface work in progress); locked in by patch quick-260808-ho2's regression test.

---

## Anti-Flash Delay on Entry

| Option | Description | Selected |
|--------|-------------|----------|
| No delay — spinner mounts immediately on entry-trigger | Cleanest model; but every warm re-focus that resolves in <100ms still flashes the spinner | |
| ~150ms armed delay — spinner mounts only if resolving takes longer than that | Symmetric to patch #74's 350ms delay-arm on holding; genuinely-instant resolutions never flash | ✓ |

**User's choice:** ~150ms armed delay (Claude recommendation, Ashley confirmed via "let's go").
**Notes:** This is NOT a resolve timeout (which SPEC bans) — it's a paint-delay for the spinner only. The `resolving` phase itself enters immediately on entry-edge; only the SPINNER RENDER is delay-armed. If inputs settle before ~150ms, spinner never mounts. Exact value (100-200ms range) is planner's call, UAT-locked with Ashley.

---

## Error Phase UI (`phase === "error"`)

| Option | Description | Selected |
|--------|-------------|----------|
| (i) Small inline error text banner | Roughly today's shape; low prominence | |
| (ii) Full-surface warm-red error card with retry button | Mirrors `SessionHoldingOverlay` error variant one-to-one; static `RefreshCcw` glyph (state, not work); retry button triggers fresh WS reconnect | ✓ |
| (iii) Something else | (Left open) | |

**User's choice:** Option (ii) (Claude recommendation, Ashley confirmed via "let's go").
**Notes:** Inline banner (option i) is easy to miss on mobile PWA. Full-surface card is consistent with the existing warm-red treatment on `SessionHoldingOverlay` error variant, giving one warm-red palette across the app. Retry button UX shape parallels `DormancyOverlay`'s Wake button. Copy "Connection failed — retry" is a planner default, UAT-locked with Ashley.

---

## Transient WS Drops After Resolved-to-Active

| Option | Description | Selected |
|--------|-------------|----------|
| (a) Re-enter `resolving` on any WS drop | Clean model — every WS drop re-arms the resolving phase; but spinner shows for every network blip (phone dips a bar, PWA background) | |
| (b) Stay `active` — only entry-triggers re-arm `resolving` | Post-resolve WS drops don't re-enter resolving; new input signals (dormant/holding frames arriving after WS reconnect) drive terminal state directly without spinner between; more user-friendly for mid-conversation reads | ✓ |

**User's choice:** Option (b) (Claude recommendation, Ashley confirmed via "let's go").
**Notes:** Entry triggers are USER ACTIONS where re-resolving is the right UX. A network blip is NOT a user action — flashing a spinner over a live conversation for 2s of reconnect is exactly the flicker class this phase is trying to eliminate. Model shape: state machine has TWO modes — "initial resolving" (entered on entry-trigger, exited when both inputs settle) and "post-resolve steady state" (inputs still drive terminal phase, but resolving is not re-entered). Planner picks implementation (e.g., `hasEverResolved: boolean` flag, or a two-layer machine).

---

## Claude's Discretion

Areas where user deferred to Claude:
- Hook file location + name (`usePaneResolvingMachine` proposed; final location — `src/ui/state/` or `src/ui/features/pretty-view/` — planner's call)
- Exact mechanism for surfacing `wsState = failed-permanently` from the existing WS retry ladder (add explicit slot vs. observe absence of scheduled retry + `status === "error"`)
- Migration order for the 6 existing local state hooks (one atomic PR vs. phased coexistence)
- Precise value of the anti-flash delay (100-200ms range, D-06)
- Exact error-card copy (D-08)
- Retry button implementation mechanism (D-09 — synthetic entry-trigger vs. explicit WS-layer reconnect event)

## Deferred Ideas

- Extend the pattern to Terminal panes (xterm.js SSH mode)
- Extend the pattern to RDP/VNC/Guacamole panes
- Two open Ashley-questions from session 9 on `pretty-view-conversation-pick-loading-feedback` bounty (revert-#351 timing; app-root-overlay-vs-anchored) — separately owned
- WS retry-ladder redesign (if the observation-based derivation of failed-permanently proves insufficient)
- Backend "first frame" observation site helper (if planner finds client-side derivation is awkward)
