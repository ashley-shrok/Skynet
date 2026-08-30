---
phase: 17
slug: pretty-view-relay-bubbles-skynet-integration
status: approved
shadcn_initialized: true
preset: radix-lyra / neutral / cssVariables
created: 2026-07-28
reviewed_at: 2026-07-28
design_source_of_truth: ~/.claude/identities/tina/bounties/pretty-view-relay-bubble-prototype/prototype.html
---

# Phase 17 — UI Design Contract

> Pretty-view relay bubbles: render fleet Matrix relay send/receive as distinct
> message bubbles in-flow next to normal conversation turns.
>
> **Design is LOCKED via the prototype at
> `~/.claude/identities/tina/bounties/pretty-view-relay-bubble-prototype/prototype.html`**
> (served at http://100.99.149.8:8899/relay-bubble-prototype.html, 6/6 acceptance
> battery passed with Ashley 2026-07-28). This UI-SPEC summarizes what the prototype
> pins down and names the byte-shape references — the prototype's CSS/HTML/JS is the
> port target, not a re-derivation from this spec.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | shadcn/ui |
| Preset | radix-lyra, baseColor neutral, cssVariables true (from components.json) |
| Component library | Radix UI (via shadcn) |
| Icon library | lucide-react |
| Font body | Inter Variable — inherits pretty-view chat surface font |
| Font mono (relay body) | JetBrains Mono Variable — for extracted message body payloads |
| Palette authority | `--color-pv-*` tokens (`src/ui/index.css:117-146`) — same as normal bubbles |

Source: `components.json`, `src/ui/index.css`, `~/.claude/identities/tina/bounties/pretty-view-relay-bubble-prototype/prototype.html`.

---

## The two bubble variants

The prototype defines two new bubble variants that render alongside normal
`ChatMessage` bubbles in `PrettyView`. Both are message-turn extensions —
they occupy the same rendering slot as a normal user/assistant bubble but
with different visual treatment so relay activity is immediately distinguishable
at a glance.

### OUTBOUND relay bubble (blue, right-aligned)

Emitted when the detection layer classifies a tool-use turn as an outbound
Matrix relay send (see § Detection contract). Right-aligned like a user bubble.

```
                              ┌─────────────────────────────────┐
                              │ ▸ relay send → !roomAlias:server │
                              │                                 │
                              │ Hey @ashley, the deploy is green│
                              │ across all three phases.        │
                              └─────────────────────────────────┘
                                                       via curl
```

- **Background**: cool blue glass — `rgba(64, 96, 160, 0.28)` with backdrop-filter blur (matches the prototype's `.bubble-outbound` treatment; port verbatim).
- **Border/rim**: 1px `rgba(96, 128, 200, 0.42)` top rim (glass highlight).
- **Text**: warm off-white `#e8e4d8` (same as user bubbles).
- **Header line**: `▸ relay send → {roomId or alias}` — small, dim, above the body.
- **Body**: extracted message text if parsable, `⚠ extraction failed — {reason}` fallback line if not.
- **Right-aligned** (`ml-auto` / `justify-self-end`).

### INBOUND relay bubble (orange, left-aligned)

Emitted when the detection layer classifies a `type=user` turn as an inbound
relay receive (see § Detection contract). Left-aligned like an assistant bubble.

```
┌─────────────────────────────────────────┐
│ 🟠 tina · !roomAlias:server             │
│                                         │
│ Nelly says the migration is finished    │
│ across all identities.                  │
└─────────────────────────────────────────┘
via recv.sh
```

- **Background**: warm orange glass — `rgba(200, 128, 64, 0.28)` with backdrop-filter blur (prototype's `.bubble-inbound`; port verbatim).
- **Border/rim**: 1px `rgba(220, 148, 80, 0.42)` top rim.
- **Text**: warm off-white `#e8e4d8`.
- **Header line**: `{identity-avatar-dot in identity colorHue} {resolved-identity-name or raw mxid} · {roomId}` — small, dim.
- **Body**: recv.sh message body if inline, `📄 {pointer-line} — click to expand` collapsed preview if file-pointer form (expands to fetched body inline).
- **Left-aligned** (default).

### Sender colorHue chain (INBOUND only)

The header identity-avatar-dot on inbound bubbles carries the resolved
identity's stored `colorHue` — same mechanism as `IdentityBadge` and
normal agent bubble hue chains. Unresolved mxids fall back to a neutral
grey (`hsl(210, 8%, 50%)`) with the raw `@name:server` shown verbatim.

Reuses the existing identity registry / `useSessionIdentity` hook / `--pv-id-hue`
CSS var mechanism — do **NOT** invent a parallel palette.

---

## Detection contract (behavior, not visuals)

The two detectors are the ONLY truth signal for classifying a turn as relay.
Port verbatim from `prototype.html`; loosening either produces the false
positives caught in the prototype's 6/6 acceptance battery.

**OUTBOUND** (fires on a tool-use turn's Bash command line):
```
command_line.includes('curl')
  && command_line.includes('-X PUT')
  && /rooms\/[^\/]+\/send\/m\.room\.message\/[^\/\s"']+/.test(command_line)
```
All three conditions required. Substring-only variants were rejected during
prototype validation (a heredoc'd `cat > bounty.json <<JSON` mentioning the
substring in prose text triggered the loose detector; a `grep -n
'send/m.room.message'` command whose comment contained "PUT" also triggered
it — both correctly rejected by the three-way conjunction).

**INBOUND** (fires on a `type=user` turn):
```
turn.origin?.kind === 'task-notification'
  && /^\[room [^\]]+\] \[@[^:]+:[^\]]+\] \(event \$?[^\)]+\): /.test(turn.text || '')
```
All three conditions required. Non-relay task-notifications (wakeup fires,
scheduled self-checks) correctly bypass this because they lack the recv.sh
line prefix.

---

## Best-effort extraction

Body extraction from the outbound command line is best-effort — the prototype
handled three failure cases and MUST continue to:

1. **Shell-var interpolation** (`--data "$body"`) — no static value available;
   render `⚠ extraction failed — shell variable interpolation` + the raw
   command line (collapsed by default, click to expand).
2. **`--data-raw` variant** — same graceful ⚠ path; detection still fires.
3. **Heredoc-nested payloads** — same graceful ⚠ path.

**Detection ALWAYS wins over extraction failure.** A ⚠-marked bubble that
missed the body is a MUCH better outcome than a silent drop.

---

## Long-inbound file-pointer support

When recv.sh wrote the body to a file (recognizable by a filesystem path
appearing in place of the body — e.g. `body written to /tmp/relay-msg-abc.txt`),
the pretty-view fetches the pointed-to file and renders the full body inline.
The pointer line is preserved as a small header/preview above the fetched body.

**Fetch failure fallback**: show the pointer line + a small `📄 fetch failed
({http-status or error})` indicator. Never a silent drop.

Backend endpoint: reuse whatever mechanism recv.sh writes to (likely `/tmp/`
on the receiver box). If the file isn't reachable from the browser's HTTP
context, the fetcher needs a small backend endpoint that proxies the read —
that's a plan-level decision, not a UI-spec decision.

---

## Scope fences (what this UI-SPEC does NOT touch)

Ashley's 2026-07-23 lock on pretty-view interior applies: the chat surface
itself (`ChatMessage.tsx` user/assistant bubbles, `WipBubble`, `PlanPendingBubble`,
`IdentityBadge`, `ComposeBox`, chat-column background, session-changeover
banners) is **structurally done and locked**. Phase 17 ADDS a new bubble
variant to the message-turn extension slot; it does NOT restyle, refactor,
or scope-creep into any existing bubble type.

**Explicitly out of scope:**
- Any change to `ChatMessage.tsx` beyond adding relay-bubble variants (may need
  a small dispatch in the render layer to route relay-detected turns to the new
  components — that's fine; anything beyond dispatch is out).
- Any change to `ComposeBox`, `IdentityBadge`, `PrettyView` root layout, or
  the atmospheric background gradient.
- Any change to `PrettyConversationsPanel` or `PrettyConversationRow` (Phase 10
  visual language stays put).
- New settings, new preferences, new toggles for relay bubble on/off — the
  detection is always-on, invisible when nothing matches, per Ashley's
  no-settings rule.

---

## Byte-shape reference

All CSS values, class names, and detection logic in the plans MUST match the
prototype byte-for-byte where practical. When the port needs to translate
raw `<style>` blocks into Tailwind v4 `@theme inline {}` tokens or
component-scoped classes, preserve the *value* verbatim (colors, blur
radii, alpha values, border widths) even if the *packaging* changes idiom.

- **Prototype CSS**: `~/.claude/identities/tina/bounties/pretty-view-relay-bubble-prototype/prototype.html` — inline `<style>` block, `.bubble-outbound` + `.bubble-inbound` rules
- **Prototype detector JS**: same file, inline `<script>` block, `detectOutbound()` + `detectInbound()` functions
- **Prototype file-pointer fetcher**: same file, inline `<script>`, `fetchPointedToBody()` function

---

## Interaction contract

- **No hover interactions on bubbles** (matches normal ChatMessage — bubbles are static content, not interactive controls).
- **Click on file-pointer expand indicator** = fetch and inline the pointed-to body. Idempotent (already-expanded bubbles are no-op).
- **Click on ⚠-marked bubble body** = toggle expand to show the raw command line (collapsed default). Idempotent.
- **No cross-tab coherence needed** — bubbles are derived from session-file content, so re-mount naturally rebuilds them.

---

## Accessibility

- Both bubble variants inherit `ChatMessage`'s existing ARIA treatment (message role, per-turn addressability).
- Header lines are static text (not headings) — screen readers announce them as part of the message body.
- Color is NOT the only signal — the header line text ("relay send →", identity name) carries the semantic distinction. The blue/orange treatment is redundant reinforcement, not the primary indicator.

---

## Ownership + iteration

- **Design lock**: Ashley UAT'd 6/6 in the prototype 2026-07-28. Do not re-litigate the shape.
- **Bounty of record**: `~/.claude/identities/tina/bounties/pretty-view-relay-bubble-prototype/` — through-line remains open until this phase ships.
- **Post-ship**: expect one round of "make it look nicer" polish after Ashley sees it in-flow (per prior pretty-view phase patterns — the ugly-but-reliable intermediate state was explicitly greenlit in the prototype bounty premise).
