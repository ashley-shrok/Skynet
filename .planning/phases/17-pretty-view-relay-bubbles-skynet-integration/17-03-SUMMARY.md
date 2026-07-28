---
phase: 17-pretty-view-relay-bubbles-skynet-integration
plan: "03"
subsystem: pretty-view
tags:
  - pretty-view
  - relay
  - matrix
  - frontend
  - bubbles
dependency_graph:
  requires:
    - 17-01 (RelayOutboundEvent + RelayInboundEvent wire types, relay detection)
    - 17-02 (/relay-pointer HTTP endpoint on main backend)
  provides:
    - RELAYBUB-01: RelayOutboundBubble (blue right-aligned glass bubble in PrettyView)
    - RELAYBUB-02: RelayInboundBubble (orange left-aligned glass bubble with file-pointer fetch)
    - RELAYBUB-03: relay-mxid-resolve.ts (mxid → identity resolver)
    - RELAYBUB-04: relay-pointer-detect.ts (file-pointer body recogniser)
    - RELAYBUB-05: PrettyView WS dispatch + render loop updated
    - RELAYBUB-06: regression-locked — zero changes to ChatMessage/ComposeBox/IdentityBadge
  affects:
    - PrettyView message rendering pipeline (new bubble variants interleaved)
tech_stack:
  added:
    - relay-mxid-resolve.ts (pure TypeScript, no deps)
    - relay-pointer-detect.ts (pure TypeScript, no deps)
    - RelayOutboundBubble.tsx (React + Tailwind v4 arbitrary-value classes)
    - RelayInboundBubble.tsx (React + Tailwind v4 + useIdentities hook)
  patterns:
    - Tailwind arbitrary-value classes for SPACED rgba byte-shape (source-level)
    - CSS vars via bg-[rgba(N,_N,_N,_0.NN)] underscore-space escape
    - useEffect single-fire fetch with 4-state machine (idle/loading/done/error)
    - data-avatar-color attribute for testable inline-style hue values
key_files:
  created:
    - src/ui/features/pretty-view/RelayOutboundBubble.tsx (72 lines)
    - src/ui/features/pretty-view/RelayInboundBubble.tsx (133 lines)
    - src/ui/features/pretty-view/relay-mxid-resolve.ts (64 lines)
    - src/ui/features/pretty-view/relay-pointer-detect.ts (56 lines)
    - src/ui/features/pretty-view/RelayOutboundBubble.test.tsx (67 lines)
    - src/ui/features/pretty-view/RelayInboundBubble.test.tsx (186 lines)
    - src/ui/features/pretty-view/relay-mxid-resolve.test.ts (82 lines)
  modified:
    - src/ui/features/pretty-view/PrettyView.tsx (StreamEvent union + WS switch + render dispatch)
decisions:
  - "Tailwind arbitrary-value syntax bg-[rgba(64,_96,_160,_0.28)] satisfies source-level rgba grep; emitted CSS uses hex equivalents due to Tailwind v4 Lightning CSS normalization (documented as deviation)"
  - "data-avatar-color attribute added to avatar-dot span so tests can assert hsl() values without jsdom's rgb() normalization"
  - "fetch() call written on one line to satisfy the plan's grep -Eq 'fetch([^)]*/relay-pointer' single-line pattern"
  - "CSS vars approach (--color-pv-relay-*) explored and abandoned — Lightning CSS normalizes rgba() in CSS vars too"
metrics:
  duration: "~75 minutes"
  completed: "2026-07-28"
  task_count: 2
  file_count: 8
---

# Phase 17 Plan 03: Relay Bubble Components + PrettyView Dispatch Summary

**One-liner:** Blue/orange glass relay bubbles (RelayOutboundBubble + RelayInboundBubble) in PrettyView with mxid resolver, file-pointer fetcher, and WS dispatch wired to relay_* frame types.

---

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Bubble components + helpers + unit tests | db7d2c0 | 7 new files |
| 2 | PrettyView dispatch wiring | cffda07 | 3 modified files |

---

## Files Touched

| File | Change | Lines |
|------|--------|-------|
| `src/ui/features/pretty-view/RelayOutboundBubble.tsx` | created | 72 |
| `src/ui/features/pretty-view/RelayInboundBubble.tsx` | created | 133 |
| `src/ui/features/pretty-view/relay-mxid-resolve.ts` | created | 64 |
| `src/ui/features/pretty-view/relay-pointer-detect.ts` | created | 56 |
| `src/ui/features/pretty-view/RelayOutboundBubble.test.tsx` | created | 67 |
| `src/ui/features/pretty-view/RelayInboundBubble.test.tsx` | created | 186 |
| `src/ui/features/pretty-view/relay-mxid-resolve.test.ts` | created | 82 |
| `src/ui/features/pretty-view/PrettyView.tsx` | modified (imports + StreamEvent union + WS switch + render dispatch) | +41 lines |

---

## Test Coverage

| File | Tests |
|------|-------|
| relay-mxid-resolve.test.ts | 6 (4 resolver + 2 regex) |
| RelayOutboundBubble.test.tsx | 3 |
| RelayInboundBubble.test.tsx | 5 |
| **Total new tests** | **14** |

PrettyView.test.tsx baseline: **12 tests passing** (1 skipped — pre-existing skip).
Full pretty-view directory: **175 tests passing, 19 test files**.

---

## Prototype Byte-Shape Confirmation

### Source-level grep (PASSES):
- `grep -Eq 'rgba\(64,[[:space:]_]*96,[[:space:]_]*160,[[:space:]_]*0\.28\)' src/ui/features/pretty-view/RelayOutboundBubble.tsx` → OUTBOUND-RGBA-OK
- `grep -Eq 'rgba\(200,[[:space:]_]*128,[[:space:]_]*64,[[:space:]_]*0\.28\)' src/ui/features/pretty-view/RelayInboundBubble.tsx` → INBOUND-RGBA-OK

### Emitted CSS hex-equivalent verification (PASSES):
- `grep -Fq '#4060a047' dist/assets/*.css` → OUTBOUND-HEX-EQUIV-OK (= rgba(64, 96, 160, 0.28) in hex)
- `grep -Fq '#c8804047' dist/assets/*.css` → INBOUND-HEX-EQUIV-OK (= rgba(200, 128, 64, 0.28) in hex)

---

## Scope Fence Verification (RELAYBUB-06)

`git diff --stat src/ui/features/pretty-view/ChatMessage.tsx src/ui/features/pretty-view/ComposeBox.tsx src/ui/features/terminal/IdentityBadge.tsx` → zero lines changed. Ashley's 2026-07-23 lock held.

---

## hostId Verification

`grep -n '\bhostId\b' src/ui/features/pretty-view/PrettyView.tsx` shows:
- L87: `hostId: number;` in PrettyViewProps
- L161: `hostId,` in props destructure
- L1041, L1116, L1288: existing usages (paneKey, IdentityBadge, BackgroundedAgentsPanel)
- NEW: relay_inbound dispatch at render loop uses `hostId` from closure scope

---

## Fetch URL Confirmation

`grep -Eq 'fetch\([^)]*/relay-pointer' src/ui/features/pretty-view/RelayInboundBubble.tsx` → FETCH-URL-OK
URL: `/relay-pointer?hostId=${hostId}&path=${encodeURIComponent(pointer.pointerPath)}` — matches plan 17-02's main backend endpoint (NOT the earlier `/claude-session/relay-pointer`).

Credentials convention: `credentials: "include"` (double-quoted, matching message-queue-api.ts + compose-drafts-api.ts).
Same-origin regression gate: 0 occurrences of `credentials: 'same-origin'` or `credentials: "same-origin"`.

---

## Build Status

- `npx tsc --noEmit` → exits 0 (clean)
- `npm run build` → exits 0 (clean, 6.53s)
- `grep -l 'relay_outbound\|via curl\|via recv' dist/assets/*.js` → Terminal-Dsu1DX40.js (RelayOutboundBubble + RelayInboundBubble code present in bundle with minified component names)

---

## PrettyView Dispatch Additions

```
case "relay_outbound" → setMessages((prev) => appendDedup(prev, parsed))
case "relay_inbound" → setMessages((prev) => appendDedup(prev, parsed))

render dispatch:
m.type === "image"         → ImageBubble
m.type === "relay_outbound" → RelayOutboundBubble (room, body, extractError, rawCommand)
m.type === "relay_inbound"  → RelayInboundBubble (room, sender, body, hostId)
else                        → ChatMessage (role, content) [unchanged path]
```

---

## Deviations from Plan

### Emitted CSS SPACED rgba check — Tailwind v4 normalization (expected behavior, documented)

**Found during:** Task 2 build verification
**Issue:** The plan's emitted CSS byte-verbatim check (`grep -Fq 'rgba(64, 96, 160, 0.28)' dist/assets/*.css`) fails because Tailwind v4 uses Lightning CSS internally (independent of `cssMinify` setting), which normalizes all rgba() color values to their 8-digit hex equivalent in the emitted bundle. This conversion happens at the Tailwind compilation stage, before Vite's minifier. It applies to:
- Arbitrary-value Tailwind classes: `bg-[rgba(64,_96,_160,_0.28)]` → emitted as `.bg-\[rgba\(64\,_96\,_160\,_0\.28\)\]{background-color:#4060a047}`
- CSS custom properties: `--color-pv-relay-out-bg: rgba(64, 96, 160, 0.28)` → emitted as `--color-pv-relay-out-bg:#4060a047`
- ALL other rgba() in index.css (e.g. `--color-pv-surface-quiet: rgba(25, 26, 34, 0.5)` → `--color-pv-surface-quiet:#191a2280`)

Approaches attempted: CSS custom properties (failed), `cssMinify: false` (failed — different stage), separate CSS layer (failed — all processed by same pipeline).

**Result:** The colors ARE correct and pixel-identical. The hex values are exact equivalents:
- `#4060a047` = `rgba(64, 96, 160, 0.28)` (8-digit hex: RR=40=64, GG=60=96, BB=a0=160, AA=47=0.278...)
- `#c8804047` = `rgba(200, 128, 64, 0.28)` (8-digit hex: RR=c8=200, GG=80=128, BB=40=64, AA=47)

The prototype byte-shape acceptance intent (ensuring the correct colors reach the browser) IS satisfied. The literal-string grep gate requires format knowledge that the plan couldn't anticipate for Tailwind v4.

**Impact:** Visual output matches prototype 1:1. Acceptance criterion is semantically satisfied but fails the literal grep. Source-level grep criteria (on `.tsx` files) pass correctly.

### data-avatar-color test attribute (Rule 2 — correctness requirement)

**Found during:** Task 1 test implementation
**Issue:** jsdom normalizes `hsl()` inline style values to `rgb()` when reading `.style.color` or the `style` attribute. Tests for avatar-dot colorHue would fail even with correct component code.
**Fix:** Added `data-avatar-color={avatarColor}` attribute to the avatar-dot `<span>` so tests can read the raw hsl() string from the DOM attribute (not from the style property, which jsdom normalizes).
**Files modified:** RelayInboundBubble.tsx (1 attribute added), RelayInboundBubble.test.tsx (assertion updated)

### fetch() single-line form (Rule 3 — satisfying acceptance criteria pattern)

**Found during:** Task 1 implementation
**Issue:** Initial implementation split the fetch call across 3 lines; the plan's acceptance grep `grep -Eq 'fetch\([^)]*/relay-pointer'` requires single-line form (the regex can't match across newlines with `-E`).
**Fix:** Compacted to single line: `fetch(\`/relay-pointer?...\`, { credentials: "include" })`.

---

## Known Stubs

None. Both components are fully wired — real fetch, real identity resolution, real event data from WS.

---

## Threat Flags

No new security surfaces beyond what plan 17-03's threat model documents:
- T-17-03-01 through T-17-03-06 all addressed in component implementations (comments inline)
- No new network endpoints, no new auth paths, no new file access patterns beyond the /relay-pointer fetch documented in 17-02's SUMMARY

---

## Self-Check: PASSED

Files exist:
- `src/ui/features/pretty-view/RelayOutboundBubble.tsx` — FOUND
- `src/ui/features/pretty-view/RelayInboundBubble.tsx` — FOUND
- `src/ui/features/pretty-view/relay-mxid-resolve.ts` — FOUND
- `src/ui/features/pretty-view/relay-pointer-detect.ts` — FOUND

Commits exist:
- db7d2c0 feat(17-03): relay bubble components + mxid resolver + file-pointer detect helpers — FOUND
- cffda07 feat(17-03): wire relay bubble dispatch into PrettyView render loop — FOUND

Tests: 14 new tests passing, 175 total pretty-view tests passing.
TypeScript: tsc clean.
Build: clean.
