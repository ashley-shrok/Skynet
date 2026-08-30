# Phase 4 — Pretty View Visual Reskin — UAT Checklist

**Purpose**: post-deploy walk-through Ashley runs to confirm the Phase 4 Glass depth reskin works end-to-end across VISUAL-01 through VISUAL-10.

## Prerequisites (do these once before starting the checklist)

- Confirm the fresh build is running: `sudo docker exec skynet cat /app/dist/backend/backend/starter.js | head -3` (any nonempty output means the container is up on the current patch).
- Have at least two identity-tagged tmux panes available in Skynet. Ideally:
  - One pane matched to an identity **with `colorHue` set** (e.g. tina at hue 35 = amber — verify via `curl -s -H "Authorization: Bearer <tmx_>" https://term.gigaashley.click/identities/ | jq '.[] | {identity_key, color_hue}'`).
  - One pane matched to a **different-colorHue identity** (e.g. bella if her colorHue is set to a distinct value — pink/hue 320 works if configured).
- Have at least one non-identity pane available (e.g. a fresh `ssh` session on GIGAASHLEYPC or any host with no matching identity in the registry).
- **Safety canary first** — before flipping any pane to pretty view, open a terminal tab (tmux mode, any host) and confirm the terminal-pane IdentityBadge (if identity-matched) appears in the top-right at the same size/position/style as pre-deploy. If the terminal-pane badge looks different, **STOP and revert** — this indicates the IdentityBadge `size="md"` default is not preserving patch #17/#38 behavior byte-identically.

---

## Checklist (walk through in order; check each box)

### VISUAL-10 — Terminal chrome untouched (safety canary — DO FIRST)

- [ ] Open any terminal tab (tmux mode, not pretty). IdentityBadge (if identity-matched) appears in top-right at the same **120px pill, 80px avatar, name-below, title-below** treatment as before deploy.
- [ ] Session tint on the pane (patch #26) is unchanged — still a subtle static wash of hash-derived or identity hue.
- [ ] Open an RDP tab (e.g. thenasty-RDP or workstation-RDP). Guacamole canvas fills its container; IdentityBadge (if applicable) styled identically to pre-deploy.
- [ ] Open a VNC tab if any host is configured for VNC. Chrome unchanged.
- [ ] Open the file manager (Filestash). Chrome unchanged.
- [ ] Open the dashboard tab. Session list, remote-host chips, new-session chips — all unchanged.
- [ ] Sidebar (AppRail + expanded panels) unchanged: HostsPanel, SessionsPanel, HistoryPanel, SnippetsPanel, UserProfilePanel, AdminIdentitiesSection all render as pre-deploy.
- [ ] TabBar unchanged: identity tint + avatar carry-through (patch #32) still works, tab hover states, drag-to-reorder, right-click menu, overflow dropdown.

**Failure indicator**: any visual difference in terminal / RDP / VNC / dashboard / sidebar / tab bar / AppRail / file manager. If yes, revert immediately per AGENTS.md deploy runbook (`sudo bash /opt/skynet/.tmp-revert.sh`).

### VISUAL-01 — Atmospheric warm-neutral base

- [ ] Flip to pretty view on any pane (Ctrl+Shift+O). Background reads as a **warm off-black atmosphere**, not flat black, not cool navy-black. Two radial-gradient overlays imply an ambient light source: warm hue-tinted glow from the top-left, cool violet from the bottom-right.
- [ ] Scroll through the message list — the atmospheric background stays consistent (no banding, no visible seams, no repeat pattern).
- [ ] The overall feel is "themed island" — pretty view has its own distinct visual identity separate from Skynet's flat-brutalist chrome.

**Failure indicator**: flat black/dark background, cool blue-black tint, or visible gradient banding.

### VISUAL-02 — Bubbles as raised physical objects

- [ ] Both assistant and user bubbles have **soft rounded corners** (~14px), a visible **drop shadow underneath**, a thin **bright rim highlight along the top edge**, and **backdrop-blur** behind (visible when a bubble overlaps the atmospheric gradient).
- [ ] Bubbles look like they float above the surface, not painted flat on it.
- [ ] WipBubble (spinner) and PlanPendingBubble (ClipboardList) use the SAME assistant-bubble treatment — same corners, shadow, blur, rim.

**Failure indicator**: bubbles look flat, no shadow, no rim highlight, or no visible backdrop-blur when overlapping the atmospheric background.

### VISUAL-03 — Identity-hue color chain end-to-end

- [ ] Open pretty view on a pane matched to an identity **WITH `colorHue`** (e.g. tina → amber hue 35). Verify **user bubble accents** (bg gradient, border, outer glow), **context-bar fill** (< 80% path), **send-button gradient**, **focused-textarea border and outer glow**, and (in BackgroundedAgentsPanel if agents are running) the **subagentType tag pill** all read the same identity color.
- [ ] Flip to a pane matched to a **different-colorHue identity** (e.g. bella at pink). The color chain shifts to that hue across ALL the same elements above. **This is the key cross-pane test.**
- [ ] Open pretty view on a pane whose identity has **NO colorHue set**. Color chain falls back to a neutral warm amber (hue 35) — no visual break, no black rings, no missing accents.
- [ ] Open pretty view on a pane with **NO matching identity** (e.g. fresh ssh session on GIGAASHLEYPC). Color chain uses the neutral warm amber fallback; the IdentityBadge simply doesn't render (matches terminal-pane semantic).

**Failure indicator**: identity-hue elements stay a fixed color regardless of pane, OR unmatched-identity panes render a broken/missing color chain, OR any element in the chain (bubble, context bar, send button, focus ring, tag pill) reads a different hue than the others on the same pane.

### VISUAL-04 — Bigger identity badge with breathing

- [ ] Pretty view identity badge is a **~56px avatar with name + title stacked to the RIGHT** of the avatar (not below). Uses the identity's colorHue for the rim + outer glow. Warm-glass linear-gradient background, backdrop-filter blur.
- [ ] Subtle **breathing brightness animation** over ~5s (`filter: brightness()` cycles 1.0 → 1.08 → 1.0). Not distracting, but noticeable at rest.
- [ ] **Hover the badge** — it fades to transparent within ~150ms (patch #38 hover-fade preserved). Move cursor away — it fades back.
- [ ] Enable "prefer reduced motion" in the OS/browser accessibility settings — the badge stops breathing (animation disabled via `@media (prefers-reduced-motion: reduce)`) but stays visible with everything else intact.
- [ ] Flip back to tmux mode. The **terminal-pane IdentityBadge is UNCHANGED** — 120px pill, 80px avatar, name+title stacked vertically. This is the `size="md"` default preserving patch #17 + #38 behavior byte-identically.

**Failure indicator**: badge is too small in pretty view, name/title stacked below the avatar (wrong direction), breathing runs even when reduced-motion is on, OR the terminal-pane badge changed size/layout.

### VISUAL-05 — Ambient panels shelf reads as one quiet floating card treatment

- [ ] Run a `TaskCreate` in the pane's Claude session so at least one harness task appears. Also spawn a **backgrounded Agent** (Explore or general-purpose with `run_in_background:true`) AND a **backgrounded Bash** (`run_in_background:true` with a sleep or long-running command). All three panels visible together.
- [ ] The three panels (Tasks, Agents, Shells) **stack ABOVE ComposeBox**, each with subtle translucent warm-tint bg + backdrop-blur-md + soft drop shadow + rounded card. They read as a **shelf of three related cards**, distinct from the messages above but not shouting for attention.
- [ ] The BackgroundedAgentsPanel's **subagentType tag pill** (e.g. "Explore") is the identity color of the pane, with hue-tinted bg + border + text.
- [ ] Static glyphs on all three panels — NO SPINNERS anywhere (motion channel owned by WipBubble per patch #53 discipline extended to Phase 4).

**Failure indicator**: panels look like flat gray boxes with a top border (pre-deploy styling remnant), tag pill is gray instead of identity-hue, OR any panel has a spinning icon (would compete with WipBubble's motion channel).

### VISUAL-06 — Compose surround intentionally low-prominence

- [ ] The compose area does **NOT have a card treatment**. No bright top rim, no drop shadow around the whole area, no visible border separating it from the panels above.
- [ ] The only visual cue distinguishing compose from the messages above is a **very subtle inset shadow shading the bottom strip** + a faint darkening linear-gradient.
- [ ] Compose reads as "quiet — go there when you're ready." Does NOT compete with chat for attention.

**Failure indicator**: compose looks like a raised card with hard edges, bright top rim, or a bordered panel treatment. This was the Round-3 dead-end Ashley explicitly rejected — treat any card treatment on compose as a regression.

### VISUAL-07 — Textarea lightest-touch outline + identity-hue focus ring

- [ ] Textarea's default state: **barely-there warm-white outline** (1px, ~9% opacity), soft warm-dark background (`rgba(255,255,255,0.03)`), muted placeholder text. Findable as a receptacle for typing but not visually loud.
- [ ] Click into the textarea. Focus ring lights up: **identity-hue border + soft outer glow + inset shadow depth increases**. Transition ~200ms on box-shadow + border-color.
- [ ] Click away. Focus ring fades back to the barely-there outline.
- [ ] shadcn's default ring/border defaults do NOT peek through (verified suppressed via `focus-visible:ring-0 focus-visible:outline-none`).

**Failure indicator**: textarea has a bright bordered box treatment when unfocused (looks like a hole punched in the compose), focus ring uses a fixed blue/gray instead of the identity hue, OR the shadcn default ring shows alongside the Phase 4 ring.

### VISUAL-08 — Send button saturated identity-hue glow as ONE grab-point

- [ ] Send button (paper-airplane icon at the bottom of the icon column): **saturated identity-hue gradient background**, warm rim highlight, outer glow. Reads as the **ONE intentional attention-grab-point** in the compose area. Deep dark text/icon color for contrast against the saturated bg.
- [ ] Hover: gradient brightens, outer glow intensifies.
- [ ] Disabled state (empty text OR `canSend===false`): faded to ~40% opacity, cursor changes to not-allowed.
- [ ] Reset (RotateCcw) + Go-Ahead (ThumbsUp) buttons ABOVE the send button take the **QUIETER treatment**: subtle warm-dark gradient, faint white rim, no outer glow at rest. Hover reveals a subtle hue-tinted rim and outer glow.

**Failure indicator**: send button doesn't glow at all (looks like the reset/go-ahead buttons), OR the reset/go-ahead buttons are as saturated as send (breaks the ONE-grab-point semantic).

### VISUAL-09 — All existing behavior preserved

- [ ] Chat rendering works: **markdown, inline code, preformatted blocks, bullet lists, tables** all render (patch #47 + #48 preserved). Inline `<code>` renders in the warm coral `--color-pv-code-fg`.
- [ ] Markdown links open in a new tab (patch #62 `target="_blank" rel="noopener noreferrer"` preserved).
- [ ] Type into ComposeBox and hit **Enter**: message sends via the split-send WS input events (patch #40b/#45); sent message appears in the chat when the session file confirms (COMPOSE-04 HARD LOCK — no ghost bubbles).
- [ ] **Shift-Enter** in ComposeBox inserts a newline (COMPOSE-02).
- [ ] Reset button sends `/id reset (<body>)` when text present, or bare `/id reset` when empty (patches #52a + #58).
- [ ] Go-ahead button sends "go ahead" without touching the textarea's current content (patches #50 + #52a).
- [ ] **Context-window fill bar** animates when contextPct changes; **≥80% branch is RED** (`hsla(0,75%,60%,1)`), not identity-hue (semantic HARD LOCK).
- [ ] HarnessTasksPanel populates when Claude Code has tasks; disappears when empty.
- [ ] BackgroundedAgentsPanel populates when subagents run; disappears when done (patch #61/#66).
- [ ] BackgroundedShellsPanel populates when BG Bash runs; disappears on task-notification completion (patch #68).
- [ ] WipBubble appears when Claude is working (patch #51 PTY-idle signal); disappears when quiet; `motion-reduce:animate-none` respects reduced-motion.
- [ ] PlanPendingBubble appears when ExitPlanMode is pending (patch #63/#67); disappears on tool_result close.
- [ ] **SessionHoldingBanner sticky positioning**: fire `/id reset` on the pane. Banner appears at the top of the scroll region ("Session ending…" then "Session changed"), STAYS STUCK at the top as messages scroll, dismisses on `session_changed`. WebSocket does NOT drop (patch #64/#65). **This is the FRAGILITY WARNING acid test** — if the banner scrolls with the content or vanishes at the top of the scroll region, the reskin broke the sticky positioning and needs immediate revert.
- [ ] ComposeBox draft persistence: type into textarea, refresh the page. Draft returns (patches #57 + #49 + #55).
- [ ] **Ctrl+Shift+O** flips between pretty and tmux; **Ctrl+Shift+;** toggles message-queue drawer; **Ctrl+Shift+L** closes tab; **Ctrl+Shift+[/]** cycle tabs; all keyboard chords work.
- [ ] Message-queue drawer coexists with pretty view — opens below, doesn't disrupt pretty view's layout (patch #39/#40/#41/#49/#50/#54/#55/#60).
- [ ] Message-queue send from drawer atomically deletes on the backend (patch #60 — WS input event carries `messageQueueItemId`; server DELETEs the row after writing the input to the SSH stream).
- [ ] Jump-to-latest sticky pill appears when scrolled up in pretty view (patch #45/#50).
- [ ] Auto-scroll ratchet preserves pin state across content growth (patch #50 — content growth without user scroll does not un-pin).

**Failure indicator**: any of the above behaviors is broken. If any is, revert per AGENTS.md deploy runbook.

---

## Sign-off

- [ ] All ten **VISUAL-01 through VISUAL-10** requirements verified as PASSING via the above checks.
- [ ] Terminal / RDP / VNC / dashboard / sidebar / AppRail / tab bar / file manager chrome verified as UNCHANGED.
- [ ] All existing pretty-view functionality verified as PRESERVED end-to-end.
- [ ] SessionHoldingBanner sticky positioning verified as PRESERVED (FRAGILITY WARNING acid test passed).
- [ ] Ashley signs off: **"Phase 4 UAT green — pin the deploy."**

If any item fails, the standard 15-min deadman timer + `sudo bash /opt/skynet/.tmp-revert.sh` runbook handles rollback. Otherwise pin with the **narrow pkill pattern** per AGENTS.md:

```bash
sudo touch /tmp/skynet-keep-patched && sudo pkill -f 'sleep 900; \[ ! -f /tmp/skynet-keep-patched'
```

⚠️ Do NOT use `pkill -f "sleep 900"` — the bare match kills the guacd-zombie sentinel too.

After pin: paste `04-AGENTS-MD-ENTRY.md` into `/home/ubuntu/AGENTS.md` as patch #69 (or whatever the current-highest+1 is at pin time) per the fork's standing "AGENTS.md write-up at PIN, not deferred" rule.
