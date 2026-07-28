---
phase: quick-260728-rt7
plan: 01
subsystem: phase-17-relay-bubbles
tags: [relay, pretty-view, phase-17, uat-gap, bug-fix, ssrf-gate, regex]
dependency_graph:
  requires: [phase-17-plan-03]
  provides: [UAT-GAP-17-BUG1-OUTBOUND-RENDER, UAT-GAP-17-BUG2-POINTER-PATH-SHAPE]
  affects: [RelayOutboundBubble, relay-pointer-detect, relay-pointer-backend]
tech_stack:
  added: []
  patterns: [Option-D-rawCommand-as-body, lockstep-regex-update]
key_files:
  created: []
  modified:
    - src/backend/claude-session/session-file-parser.ts
    - src/backend/claude-session/session-file-parser.test.ts
    - src/backend/claude-session/claude-session-server.ts
    - src/ui/api/claude-session-api.ts
    - src/ui/features/pretty-view/RelayOutboundBubble.tsx
    - src/ui/features/pretty-view/RelayOutboundBubble.test.tsx
    - src/ui/features/pretty-view/PrettyView.tsx
    - src/ui/features/pretty-view/relay-pointer-detect.ts
    - src/ui/features/pretty-view/RelayInboundBubble.test.tsx
    - src/backend/database/routes/relay-pointer.ts
    - src/backend/database/routes/relay-pointer.test.ts
decisions:
  - Option D (Ashley 2026-07-28): delete body-extractor entirely; rawCommand IS the bubble body
  - lockstep regex swap: POINTER_REGEX and WHITELIST_REGEX updated in the same commit to identical inner path pattern
metrics:
  duration: ~30min
  completed: "2026-07-28"
  tasks: 2
  files: 11
---

# Quick 260728-rt7: Fix Phase 17 UAT Gaps — Outbound Bubble Render + Pointer Path Shape

**One-liner:** Delete outbound body-extractor (rawCommand as mono block per Option D) and swap both client/backend file-pointer regexes to the actual recv.sh identity-dir path shape.

## Commits

| Task | Commit | Message | Files |
|------|--------|---------|-------|
| Task 1 (Bug 1) | `34e29dc` | `fix(phase-17): render outbound bubble as command block (delete extractor, close UAT Bug 1)` | 7 files changed, 87 ins / 128 del |
| Task 2 (Bug 2) | `1bd5967` | `fix(phase-17): file-pointer regex matches recv.sh identity-dir path (close UAT Bug 2)` | 4 files changed, 95 ins / 39 del |

## Task 1: Bug 1 — Outbound Bubble Render (UAT-GAP-17-BUG1-OUTBOUND-RENDER)

**Problem:** Every outbound bubble showed "⚠ extraction failed" because fleet-standard sends use `curl -d "$(jq -n --arg b "$MSG" ...)"` — literal-JSON extraction cannot succeed on those forms.

**Fix (Option D, Ashley 2026-07-28):** Delete the body-extraction block (~L181-197) from `detectRelayOutbound`. `rawCommand` IS the body — rendered faithfully as a scrollable `<pre>` mono block.

### Changes

**session-file-parser.ts:**
- `RelayOutboundMessage` type drops `body` and `extractError` fields; now `{ kind, room, rawCommand, eventId, ts }`.
- `detectRelayOutbound` return type simplified to `{ room, rawCommand }`.
- Body-extraction block (dSingle/dDouble/dArg/JSON.parse) deleted.
- Follow-up bounty comment added: opportunistic MSG=/BODY=/TEXT= grep deferred per Ashley's explicit decision.

**claude-session-server.ts:**
- `relay_outbound` WS emit carries `{ type, room, rawCommand, eventId, ts }` only; comment updated to "faithful command record."

**claude-session-api.ts:**
- `RelayOutboundEvent` wire type: `body` and `extractError` removed; doc comment updated per Option D.

**RelayOutboundBubble.tsx:**
- Props `Pick<>` drops `body`/`extractError` — now `Pick<RelayOutboundEvent, "room" | "rawCommand">`.
- `useState` and `showSource`/`setShowSource` deleted (no longer needed).
- `extractError !== null ? (...) : body !== null ? (...) : null` conditional block deleted.
- Replaced with single always-rendered `<pre>` with classes: `whitespace-pre overflow-x-auto max-h-[24rem] overflow-y-auto font-[JetBrains...] bg-black/40 rounded p-2 text-xs`.
- `useState` import removed; `cn` import retained (used in other JSX).
- Header ("▸ relay send → {room}") and footer ("via curl") UNCHANGED.

**PrettyView.tsx:**
- `<RelayOutboundBubble>` JSX: `body` and `extractError` props removed.

### Tests Updated

**session-file-parser.test.ts:**
- Test 1: dropped `body` and `extractError` assertions; kept room/rawCommand/eventId.
- Test 4 renamed to "outbound-shellvar — shell-var -d arg still emits relay_outbound with rawCommand"; assertions updated to room + rawCommand only.
- Test 5 renamed to "outbound-dataraw — --data-raw variant still emits relay_outbound with rawCommand"; same.

**RelayOutboundBubble.test.tsx:** Fully rewritten:
- Test 1: renders room-id header + rawCommand in mono block; asserts `justify-end` wrapper.
- Old Test 2 (extractError/showSource flow): DELETED.
- NEW Test 2: long command with newlines preserves them; asserts `whitespace-pre` class + PRE element text content.
- Test 3: room null → unknown room (props cleaned of body/extractError).
- NEW Test 4: very long single-line command has `overflow-x-auto` class (structural assertion).

## Task 2: Bug 2 — File-Pointer Regex Swap (UAT-GAP-17-BUG2-POINTER-PATH-SHAPE)

**Problem:** POINTER_REGEX and WHITELIST_REGEX were matching `/tmp/relay-msg-*.txt` — the obsolete path. recv.sh actually writes to `~/.claude/identities/<id>/relay-state/messages/<eventid>.txt`. Every long inbound bubble rendered raw pointer text instead of the fetched body.

**Fix:** Swap both regexes in lockstep to the identity-dir path shape.

### New Regex Pattern (inner path, shared by both sides)

```
/home/[a-z0-9_-]+/\.claude/identities/[a-z0-9_-]+/relay-state/messages/[A-Za-z0-9_-]+\.txt
```

Character class choices:
- User + identity name: `[a-z0-9_-]` — POSIX-safe lowercase; rejects uppercase, dot, slash.
- Event-id: `[A-Za-z0-9_-]` — Matrix event ids are base64url-like; dot excluded (recv.sh event ids never contain dot; dropping dot strengthens the whitelist).

**relay-pointer.ts (backend):**
- `WHITELIST_REGEX` → `^\/home\/[a-z0-9_-]+\/\.claude\/identities\/[a-z0-9_-]+\/relay-state\/messages\/[A-Za-z0-9_-]+\.txt$` (anchored `^...$`).
- Comment updated; T-17-02-01 tag preserved.

**relay-pointer-detect.ts (frontend):**
- `POINTER_REGEX` → `(?:^|\s)(\/home\/[a-z0-9_-]+\/\.claude\/identities\/[a-z0-9_-]+\/relay-state\/messages\/[A-Za-z0-9_-]+\.txt)(?:\s|$)` — preserves the existing whitespace-boundary wrapper.
- Em-dash note: recv.sh preview line uses ` — ` (ASCII space + em-dash + ASCII space); JS `\s` matches the ASCII space so no boundary changes needed.

### Tests Updated

**relay-pointer.test.ts:**
- Test 1: Replaced `/tmp/` positives with Ashley's exact reproducer path (`_j14UxhqP0NpJXLReeXBR0qPGh04JwNXDGneCrEyarWw.txt`) + alt identity path — both MUST match.
- Test 2: Updated traversal path to identity-dir shape with `../../` traversal.
- Test 3: Kept `/etc/passwd`; added `/home/ubuntu/other/file.txt` (missing identities segment).
- Test 4: Updated to identity-dir path with `.sh` suffix.
- NEW Test 4b: `/home/UBUNTU/.claude/...` — uppercase user rejected.
- NEW Test 4c: `/home/ubuntu/.claude/identities/../evil/...` — traversal in identity name rejected.
- Tests 5-11: All `/tmp/relay-msg-*.txt` path args updated to identity-dir shape.

**RelayInboundBubble.test.tsx:**
- Test 2: body updated to `body written to /home/ubuntu/.claude/identities/molly/...`.
- Test 3: body updated to identity-dir path.
- NEW Test 6: "detectFilePointer matches recv.sh preview line format with em-dash boundaries" — feeds the exact Ashley reproducer string; asserts `pointerPath` equals the identity-dir path.

## Test Run Summary

| Stage | Files | Tests |
|-------|-------|-------|
| Before Task 1 (baseline) | 67 pass | 767 pass, 6 skip |
| After Task 1 | 67 pass | 767 pass, 6 skip |
| After Task 2 | 67 pass | 770 pass, 6 skip (+3 new tests) |

Backend TS gate: `npm run build:backend && npm run build` — both succeed with zero TS errors, after each commit.

## Deviations from Plan

### Minor Adaptation

**Test 2 (RelayOutboundBubble) — `getByText` normalises whitespace for multi-line `<pre>` content**

The plan specified asserting `getByText(cmd)` where cmd contains `\n`. Testing-library's `getByText` normalises whitespace (collapses newlines to spaces for matching), so this fails for multi-line strings even when the `<pre>` correctly contains the newline-preserving text.

Fix applied: use custom function matcher `screen.getByText((_content, el) => el?.tagName === "PRE" && el.textContent === cmd)` which checks the raw DOM `textContent` without normalisation. The assertion still verifies the same semantic property (the `<pre>` element contains the exact rawCommand string including newlines).

Classification: [Rule 1 - Bug] test infrastructure adaptation; no production code change.

## Verification

- `grep -rn "extractError" src/` → zero hits in production code.
- `grep -n "relay-msg" relay-pointer-detect.ts relay-pointer.ts` → zero hits in production code.
- Ashley's exact reproducer path (`_j14UxhqP0NpJXLReeXBR0qPGh04JwNXDGneCrEyarWw.txt`) matches WHITELIST_REGEX and POINTER_REGEX — verified by Test 1 (backend) and Test 6 (frontend).
- Two atomic commits on branch `feat/tab-title-from-tmux`, in order.
- No push performed. No docker build performed. No docker compose up performed.

## Callout for Tina / Orchestrator

Ready to bundle-ship alongside kiro-cli fix + Phase 17 patch #169 pin per bounty `3f0369dd-01fc-4e0e-a89c-b45597877e9b` timeline item 2. Phase 17 through-line ("relay bubbles work in Skynet") is now satisfied at the code level for both outbound render and inbound file-pointer fetch.

## Self-Check

- [x] All 11 modified files exist on disk.
- [x] Commit `34e29dc` exists in git log.
- [x] Commit `1bd5967` exists in git log.
- [x] `npm test` passes (770 tests, 67 files, 6 skipped).
- [x] `npm run build:backend && npm run build` both clean.
- [x] No push, no docker build, no docker compose up performed.
