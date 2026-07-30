---
id: 260730-hmb
title: Unify relay-bubble alignment + colors with pretty-view chat convention
status: in-progress
kind: quick
created: 2026-07-30
---

# Quick Task 260730-hmb — Relay-bubble alignment + color unification

Closes pinned bounty `relay-bubbles-sides-swapped`.

## Context

Ashley eyeballed the deployed pretty-view (tina's session) and confirmed the relay bubbles read inverted from the surrounding chat convention:

- Regular `ChatMessage.tsx` uses `isUser ? justify-end : justify-start` — user (Ashley's compose-box input) = RIGHT, assistant (agent's own reply) = LEFT.
- Current relay bubbles were shipped opposite: agent's outbound Matrix-send RIGHT (blue glass), inbound Matrix-message LEFT (orange glass).

Ashley wants relay bubbles to read like the rest of the chat — same "who's speaking → which side, which color" convention. Small attribution headers/footers (`▸ relay send → {room}` / `via curl`; avatar-dot + `{name} · {room}` / `via recv.sh`) STAY per Ashley's A-vs-B answer — they preserve the "this went through Matrix, not native Skynet" semantic without needing a color difference to carry that signal.

Investigation confirmed (before this ship): (1) deployed bundle exactly matches source; not a stale-deploy issue. (2) Backend detection is not silently failing (23/23 relay-inbound-shaped notifications on 10 recent sessions matched INBOUND_REGEX). So this is a pure client-side visual change — no backend or dispatch work needed.

## Scope of change

All under `src/ui/features/pretty-view/`:

### 1. `RelayOutboundBubble.tsx` (agent's curl send → identity-hue, LEFT)

- **Outer wrapper (line 38)**: `flex justify-end` → `flex justify-start`.
- **Background** (line 53): `bg-[rgba(64,_96,_160,_0.28)]` → `bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]` — mirrors ChatMessage.tsx:124 assistant gradient. The `--pv-id-hue` CSS var is set per pretty-view identity, so the bubble auto-tints to whichever agent's view is showing.
- **Border** (line 55): `border border-[rgba(96,_128,_200,_0.42)]` → `border border-[hsla(var(--pv-id-hue),65%,55%,0.32)]` — mirrors ChatMessage.tsx:126.
- **Text** (line 57): `text-[#e8e4d8]` → `text-[#fbf5e8]` — mirrors ChatMessage.tsx:125.
- Keep `backdrop-blur-xl saturate-150` and `[-webkit-backdrop-filter:blur(20px)_saturate(1.6)]` — the glass depth is still worth having; ChatMessage uses shadow but the relay bubble's glass reads fine alongside it.
- Keep the header (`▸ relay send → {room}`), the mono `<pre>` command block, and the `via curl` footer.
- Update the file header comment (line 7 "right-aligned blue glass bubble" → "left-aligned identity-hue gradient bubble") and the RELAYBUB-01 comment (line 17) accordingly.

### 2. `RelayInboundBubble.tsx` (Matrix send from Ashley → blue-gray, RIGHT)

- **Outer wrapper (line 107)**: `flex justify-start` → `flex justify-end`.
- **Background** (line 122): `bg-[rgba(200,_128,_64,_0.28)]` → `bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))]` — mirrors ChatMessage.tsx:112 user gradient.
- **Border** (line 124): `border border-[rgba(220,_148,_80,_0.42)]` → `border border-[rgba(120,140,180,0.2)]` — mirrors ChatMessage.tsx:114.
- **Text** (line 126): `text-[#e8e4d8]` → `text-[#dfe3ee]` — mirrors ChatMessage.tsx:113.
- Keep `backdrop-blur-xl saturate-150` and the WebKit fallback.
- Keep the avatar-dot header (colored via resolved identity hue), the `{name} · {room}` line, file-pointer fetch behavior, and the `via recv.sh` footer.
- Update the file header comment (line 11 "left-aligned orange glass bubble" → "right-aligned blue-gray gradient bubble") and the RELAYBUB-02 comment (line 21).

### 3. `PrettyView.tsx` — comment updates

- Line 572: `// RELAYBUB-01: outbound relay frame → RelayOutboundBubble (blue, right-aligned).` → `(identity-hue, left-aligned)`.
- Line 577: `// RELAYBUB-02: inbound relay frame → RelayInboundBubble (orange, left-aligned).` → `(blue-gray, right-aligned)`.

No behavior change here — WS dispatch stays the same.

### 4. Tests

- `RelayOutboundBubble.test.tsx` line 29: `document.querySelector(".justify-end")` → `document.querySelector(".justify-start")` (Test 1 wrapper-alignment structural assertion).
- `RelayInboundBubble.test.tsx`: no alignment or color assertions to update (verified — file has no `.justify-*` or `rgba(200,` selectors).

### Verification

- `npx tsc --noEmit` from `~/skynet` — must pass with zero errors.
- `npx vitest run src/ui/features/pretty-view/RelayOutboundBubble.test.tsx src/ui/features/pretty-view/RelayInboundBubble.test.tsx` — all tests pass.

## Out of scope

- Backend detection: untouched (verified working).
- WS dispatch in PrettyView.tsx: untouched (only comment sync).
- Historical planning artifacts under `.planning/phases/17-*/`: not touched — they document the phase-17 shipped state; patch #200 is the forward record.
- Shadow (`shadow-[0_8px_24px_...]` on ChatMessage): NOT added to relay bubbles — the backdrop-blur already gives depth and adding shadow would flatten them into indistinguishable-from-chat. Keeping the visual "these are relay bubbles" cue subtle.
- No deploy — patch batches on `feat/tab-title-from-tmux` with #198+#199, waits for Ashley's ship greenlight (fleet rule).

## Commits

Two atomic commits per fleet pattern (mirror #198/#199):

1. `fix(quick-260730-hmb): unify relay-bubble alignment + colors with pretty-view chat convention` — the four source-file edits + test update.
2. `docs(quick-260730-hmb): patch #200 — relay-bubble alignment + color unification` — appends patch #200 to `~/.claude/identities/tina/skynet-patches.md` and commits the PLAN.md + SUMMARY.md.

## Bounty follow-up

After both commits land, mark `relay-bubbles-sides-swapped` bounty as `done`, append a timeline entry with both commit shas, move folder into `~/.claude/identities/tina/bounties/archive/`.
