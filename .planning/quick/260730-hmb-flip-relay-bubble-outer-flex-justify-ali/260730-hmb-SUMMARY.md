---
id: 260730-hmb
title: Unify relay-bubble alignment + colors with pretty-view chat convention
status: complete
kind: quick
completed: 2026-07-30
---

# Quick Task 260730-hmb — Summary

Closes pinned bounty `relay-bubbles-sides-swapped`. Ships as patch #200 in the tina/skynet-patches ledger.

## What changed

Relay bubbles (RelayOutboundBubble = agent's Matrix curl-send; RelayInboundBubble = Matrix message received by agent) now match the surrounding pretty-view chat convention on BOTH alignment AND color:

| Bubble | Was | Now |
|---|---|---|
| `RelayOutboundBubble` | `flex justify-end` + blue glass (`bg-[rgba(64,_96,_160,_0.28)]`) | `flex justify-start` + agent identity-hue gradient (`bg-[linear-gradient(160deg,hsla(var(--pv-id-hue),50%,38%,0.55),hsla(var(--pv-id-hue),45%,24%,0.6))]`) — matches ChatMessage assistant styling |
| `RelayInboundBubble` | `flex justify-start` + orange glass (`bg-[rgba(200,_128,_64,_0.28)]`) | `flex justify-end` + blue-gray gradient (`bg-[linear-gradient(160deg,rgba(45,55,80,0.55),rgba(28,35,55,0.6))]`) — matches ChatMessage user styling |

Border + text colours also swapped to ChatMessage parity per side. `backdrop-blur-xl saturate-150` kept so bubbles retain glass depth alongside ChatMessage's shadow-based bubbles. `▸ relay send → {room}` / `via curl` and avatar-dot + `{name} · {room}` / `via recv.sh` attribution markers KEPT (Ashley's A choice) — preserves the "this went through Matrix, not native Skynet" semantic.

## Files touched

Code (single atomic commit):
- `src/ui/features/pretty-view/RelayOutboundBubble.tsx` — wrapper alignment + bg/border/text swap + header comment refresh
- `src/ui/features/pretty-view/RelayInboundBubble.tsx` — wrapper alignment + bg/border/text swap + header comment refresh
- `src/ui/features/pretty-view/PrettyView.tsx` — comment sync at RELAYBUB-01/02 WS-dispatch sites (lines 572, 577)
- `src/ui/features/pretty-view/RelayOutboundBubble.test.tsx` — Test 1 alignment assertion flipped from `.justify-end` to `.justify-start` (RelayInboundBubble.test.tsx had no alignment/color assertions to touch)

Docs:
- `.planning/quick/260730-hmb-flip-relay-bubble-outer-flex-justify-ali/260730-hmb-PLAN.md`
- `.planning/quick/260730-hmb-flip-relay-bubble-outer-flex-justify-ali/260730-hmb-SUMMARY.md`
- `.planning/STATE.md` — Quick Tasks Completed row appended
- `~/.claude/identities/tina/skynet-patches.md` — patch #200 entry (outside git, hand-appended)

## Verification

- `npx tsc --noEmit` — exit 0.
- `npx vitest run src/ui/features/pretty-view/RelayOutboundBubble.test.tsx src/ui/features/pretty-view/RelayInboundBubble.test.tsx` — 10/10 pass, 2/2 files, 4.74s.

## Investigation notes (before this ship)

Before flipping any CSS, verified offline (bounty timeline captures the full trace):
1. Deployed bundle in `skynet-patched:local` (built 2026-07-29 15:23 UTC) exactly matches source — `flex justify-end` wraps `via curl`, `flex justify-start` wraps `via recv.sh`. Not a stale-deploy issue.
2. Backend `INBOUND_REGEX` detection is not silently failing: on 10 most-recent sessions on this box, 23/23 relay-inbound-shaped notifications matched (100%). Not a detection-fallthrough issue.

Ashley eyeballed live: her orange bubble on the LEFT (in line with the agent's ChatMessage-assistant column) and Tina's blue relay-reply on the RIGHT (in line with her ChatMessage-user column) — inverted from the surrounding "who's speaking" convention. She reconfirmed the flip is what she wants AND expanded scope to color-parity so relay bubbles unify with chat visually (same side, same colour, only the small attribution markers signal "this went through Matrix").

## Deploy status

**NOT pushed, NOT built, NOT deployed.** Batches on `feat/tab-title-from-tmux` behind #198 + #199, waits for Ashley's ship greenlight per fleet rule (Ashley 2026-07-27, "deploy pre-work is not authorized by a code-work ask"). Third patch in the pinned-bounties working-slate (after #198 terminal-button, #199 sidebar-chevron).

## Follow-up

Bounty `~/.claude/identities/tina/bounties/relay-bubbles-sides-swapped/` will be marked `status:"done"` + timeline entry with both commit shas + moved to `bounties/archive/` after both commits land.
