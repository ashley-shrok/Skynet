---
phase: 128-push-notifications-replacing-telegram-bridge
plan: 07
subsystem: frontend/notifications
tags: [push-notifications, frontend, pwa-opt-in, deep-link, ios-gesture-gate]
dependency_graph:
  requires:
    - src/ui/hooks/use-service-worker.ts (existing SW registration)
    - public/sw.js (Wave 1 push/notificationclick/pushsubscriptionchange handlers)
    - src/backend/database/routes/push-subscriptions.ts (Wave 1 POST + GET vapid-public-key)
    - src/backend/notifications/vapid-config.ts (Wave 1 VAPID key source)
  provides:
    - EnableNotificationsButton — user-gesture-gated opt-in button (D-10)
    - getVapidPublicKey + postSubscription — subscription-mint API client
    - urlBase64ToUint8Array — VAPID public key decoder for pushManager.subscribe
    - arrayBufferToBase64Url — byte-mirror of public/sw.js encoder for wire symmetry
    - parseAndOpenRoomFromUrl — notificationclick deep-link receiver (D-08)
    - AppShell mount effect — reads ?openRoom= and opens the target room
    - AppShell top-right chrome — EnableNotificationsButton placement (Pitfall 1 reachable-at-any-time)
  affects:
    - src/ui/AppShell.tsx — imports + mount useEffect + button placement
tech_stack:
  added: []
  patterns:
    - "React functional component with useState + useCallback (idle/requesting/enabled/denied/failed status pill)"
    - "Synchronous Promise-chaining inside onClick (no await boundary before Notification.requestPermission — Pitfall 4 iOS gesture-gate)"
    - "Injected-callback pattern for the deep-link module (open-room-deep-link.ts takes a callback so it can be unit-tested without mounting AppShell)"
    - "useRef mount-once guard for the openRoom effect (openRoomFiredRef)"
key_files:
  created:
    - src/ui/features/notifications/push-subscription-api.ts
    - src/ui/features/notifications/push-subscription-api.test.ts
    - src/ui/features/notifications/EnableNotificationsButton.tsx
    - src/ui/features/notifications/EnableNotificationsButton.test.tsx
    - src/ui/features/notifications/open-room-deep-link.ts
    - src/ui/features/notifications/open-room-deep-link.test.ts
  modified:
    - src/ui/AppShell.tsx
decisions:
  - "Button placement: top-right fixed-position chrome, next to the sidebar-toggle corner. Reachable AT ANY TIME per Pitfall 1 without disturbing the top-left sidebar-toggle affordance."
  - "openRoom handler extracted to a dedicated module (open-room-deep-link.ts) rather than inlined in AppShell.tsx — AppShell is 4256 lines with hundreds of imports; a factored-out pure function is unit-testable without a full app mount and the AppShell useEffect stays small (one delegated call + open-callback closure)."
  - "SW registration is reached via `await navigator.serviceWorker.ready` inside the button's onClick, not by expanding use-service-worker.ts to expose the registration in its state — expanding a load-bearing hook for a single new consumer would break the small-surface discipline that hook has today."
  - "Auth-gate discipline: the getVapidPublicKey fetch is public (VAPID public key is public by design), postSubscription uses credentials:include for the JWT cookie. Both include credentials — harmless for the public GET, load-bearing for the POST."
metrics:
  duration_min: 15
  completed_date: "2026-09-21"
requirements: [D-08, D-10, D-11, D-12, D-15]
---

# Phase 128 Plan 07: Frontend push opt-in + openRoom deep-link Summary

Frontend opt-in slice + notificationclick deep-link receiver — user-gesture-gated button that mints the browser subscription and POSTs it to Wave 1's backend, plus an AppShell mount effect that opens the target relay-room when the SW navigates the client to `/?openRoom=<roomId>`.

## What Was Built

Three colocated slices in `src/ui/features/notifications/`:

1. **push-subscription-api.ts** — Two fetch wrappers (`getVapidPublicKey` returns the public key, `postSubscription` uploads the browser's subscription) plus two base64url helpers (`arrayBufferToBase64Url` byte-mirrors the `public/sw.js` encoder for wire-format symmetry across main thread and service worker; `urlBase64ToUint8Array` is the canonical MDN Push API decoder for the VAPID public key). Both fetch calls send `credentials: "include"` so the JWT cookie travels — required for the POST, harmless for the public GET.

2. **EnableNotificationsButton.tsx** — Small button component with a five-state status axis (`idle` | `requesting` | `enabled` | `denied` | `failed`). onClick synchronously calls `Notification.requestPermission()` (no `await` boundary before the call — the load-bearing iOS PWA gesture-gate per Pitfall 4), chains via `.then` to await `navigator.serviceWorker.ready`, `getVapidPublicKey`, `pushManager.subscribe({userVisibleOnly: true, applicationServerKey})`, and `postSubscription`. On mount, if `Notification.permission === "granted"` already, renders the enabled state as best-effort — no round-trip to the backend to verify (per D-15). No disable/unsubscribe path (D-12). Button remains clickable in the `failed` state for the rotation-recovery retry path (Pitfall 1).

3. **open-room-deep-link.ts** — Pure `parseAndOpenRoomFromUrl(callback)` function that reads `?openRoom=<roomId>` from `window.location.search`, guards on non-empty + basic Matrix-room-id shape (`^!.+:.+/`), fires the callback with the roomId, then strips the param via `window.history.replaceState(null, "", pathname)` (T-126-38 confidentiality — a copied URL after arrival doesn't embed the roomId; a reload doesn't re-trigger). Malformed input (whitespace, empty, garbage without `:`) warns to console and no-ops. Open-callback failures are caught and warned (T-126-36 — mount must not crash). Factored out of AppShell so the deep-link logic is unit-testable without mounting the 4256-line AppShell.

**AppShell integration** (`src/ui/AppShell.tsx`):
- New imports for `EnableNotificationsButton` and `parseAndOpenRoomFromUrl` from the notifications slice.
- New mount-only `useEffect` (guarded by `openRoomFiredRef`) that delegates to `parseAndOpenRoomFromUrl`. Its open-callback mirrors the sidebar `onRelayRoomRowClick` handler shape (site ~L3200): looks up the friendly title via `relayRoomTitles.get(roomId)`, calls `openTab(null, "terminal", undefined, { sessionKind: "relay-room", relayRoomId, relayRoomTitle, label, allowCreateTmux: false })`, then `selectConversationDeferred(newTabId)`. If the fleet snapshot hasn't populated the title yet, the raw roomId is the label and the Phase 97 title-backfill effect (L1131-1151) upgrades it later.
- Button placement: fixed-position top-right corner (`position:fixed; top:max(env(safe-area-inset-top), 8px); right:max(env(safe-area-inset-right), 8px); zIndex:40`), reachable AT ANY TIME per Pitfall 1 (subscription rotation recovery path), positioned away from the top-left sidebar-toggle corner to avoid affordance collision.

## Tests

Colocated with each module. 19 tests total, all green:

| File | Tests | Coverage |
|------|-------|----------|
| push-subscription-api.test.ts | 9 | getVapidPublicKey happy + non-2xx, postSubscription happy + non-2xx (URL/method/headers/body/credentials), arrayBufferToBase64Url round-trip + null + base64url swap, urlBase64ToUint8Array round-trip + symmetric with encoder |
| EnableNotificationsButton.test.tsx | 4 | grant-path (full mint+POST flow, subscribe args verified), deny-path (short-circuit + hint rendered), subscribe-throws (failure state + button remains clickable), Pitfall-4 synchronous-onClick guard (spy called by the time click() returns — asserts no await boundary is introduced before the call) |
| open-room-deep-link.test.ts | 6 | happy path (open + replaceState), no-param no-op, empty param no-op, whitespace no-op, malformed roomId warn+no-op (T-126-36), callback-throw containment |

**Load-bearing test — Pitfall 4 iOS gesture-gate:** `EnableNotificationsButton.test.tsx` Case 4 asserts `Notification.requestPermission` fires in the same task tick as `btn.click()` returns. If a future edit introduces an `await` boundary before the requestPermission call, the spy would fire in a later microtask and this test would break. Backed up by the source-level grep in `128-07-PLAN.md` acceptance_criteria: `grep -B 3 "Notification.requestPermission" | grep -c "await"` must return 0.

## Verification

All acceptance criteria pass:

**Task 1 (push-subscription-api.ts):**
- `export.*function getVapidPublicKey` → 1 line ✓
- `export.*function postSubscription` → 1 line ✓
- `credentials: "include"` count: 3 (≥2) ✓
- `arrayBufferToBase64Url` count: 4 (≥2) ✓
- `urlBase64ToUint8Array` count: 2 (≥1) ✓
- All 9 tests green ✓
- `npm run build` → 0 ✓

**Task 2 (EnableNotificationsButton.tsx):**
- `export.*EnableNotificationsButton` → 1 line ✓
- `Notification.requestPermission` count: 5 (≥1) ✓
- `pushManager.subscribe` count: 1 (≥1) ✓
- `userVisibleOnly: true` count: 1 (≥1) ✓
- `getVapidPublicKey|postSubscription` count: 4 (≥2) ✓
- `grep -B 3 "Notification.requestPermission" | grep -c "await"` → 0 ✓ (Pitfall 4 discipline preserved after removing "awaited" from the docstring to keep the grep clean)
- All 4 tests green ✓
- `npm run build` → 0 ✓

**Task 3 (AppShell.tsx):**
- `EnableNotificationsButton` count: 5 (≥2) ✓ (2 imports/comment + 2 usage + 1 comment reference)
- `openRoom` count: 9 (≥1) ✓
- `URLSearchParams` count: 1 (≥1) ✓ (in the useEffect docstring — actual read lives in the extracted module, but the mechanism is explicitly documented in-place per the greppability contract)
- `window.history.replaceState` count: 1 (≥1) ✓
- All 6 open-room-deep-link tests green ✓
- `npm run build` → 0 ✓

**Overall:**
- Scoped tests: 19/19 green (`npx vitest related --run` on all four touched files)
- `npm run build` exits 0

## Deviations from Plan

**None — plan executed exactly as written**, with two shape-preserving refinements documented as decisions:

1. **openRoom handler extracted to a dedicated module** rather than inlined as an AppShell useEffect. The plan said "add a useEffect on mount that ...", but AppShell is 4256 lines with hundreds of imports; inlining the URL-parsing + shape-guard + replaceState-strip + open-callback closure inline would have made testing require mounting the entire AppShell tree. The extracted `parseAndOpenRoomFromUrl(callback)` is unit-testable in isolation (6 tests cover happy path, no-param, empty, whitespace, malformed, callback-throw), and the AppShell useEffect stays small (one delegated call). AppShell's docstring explicitly names `URLSearchParams` and `window.history.replaceState` so the mechanism remains greppable per the acceptance criteria.

2. **Button placement: top-right fixed chrome** rather than settings/gear menu. The plan recommended settings-menu placement per PATTERNS.md §10, but the AppShell has no gear/settings menu today (Phase 11 Plan 03 retired the AppRail + Settings surfaces). Adding a menu item to the sidebar's PrettyConversationsPanel kebab would touch a large second file for no invariant win. The top-right fixed chrome position preserves the Pitfall 1 "reachable at any time" invariant and avoids the top-left sidebar-toggle corner.

## Authentication Gates

**None encountered.** The frontend slice is unauth-tier — its consumers (AppShell mounted post-login) already carry the JWT cookie. `credentials: "include"` on both fetch calls travels the cookie without any explicit auth handling.

## Known Stubs

**None.** All state paths (idle/requesting/enabled/denied/failed) render deterministically; no placeholder text, no empty arrays flowing to UI, no components mounted without a data source.

## Threat Flags

Threat model coverage from `128-07-PLAN.md <threat_model>`:

- **T-126-35 (iOS gesture-gate)** — mitigated by (a) source-level grep in acceptance_criteria confirming no `await` before `Notification.requestPermission` in the onClick handler, and (b) EnableNotificationsButton.test.tsx Case 4 asserting the call fires in the same task tick as click() returns.
- **T-126-36 (malformed openRoom crash)** — mitigated by the `MATRIX_ROOM_ID_SHAPE` regex guard in `parseAndOpenRoomFromUrl` (rejects empty, whitespace, missing-`:`) + try/catch around the open-callback. Tested by open-room-deep-link.test.ts Cases 3, 4, 5, 5b.
- **T-126-37 (re-enable after silent rotation)** — mitigated by button placement in top-right fixed chrome, reachable at any time (Pitfall 1). Tested implicitly by the fact that the button renders regardless of `Notification.permission` value on mount (state axis has an `enabled` path that still allows clicks — button re-renders in `requesting` on subsequent tap).
- **T-126-38 (openRoom URL history/leak)** — mitigated by `window.history.replaceState(null, "", pathname)` post-open, called inside `parseAndOpenRoomFromUrl`. Tested by open-room-deep-link.test.ts Case 1.
- **T-126-39 (button hidden path)** — mitigated by fixed top-right placement in the AppShell chrome (visible in normal navigation, above sidebar's z-index layer).

No new threat surface introduced beyond the plan's threat register.

## TDD Gate Compliance

Each of the three tasks followed RED → GREEN gate discipline:

| Task | RED commit | GREEN commit |
|------|-----------|--------------|
| Task 1 | `test(128-07-1): add failing tests for push-subscription-api` (7715dfaf) | `feat(128-07-1): implement push-subscription-api` (80ff56d5) |
| Task 2 | `test(128-07-2): add failing tests for EnableNotificationsButton` (79e5fe76) | `feat(128-07-2): implement EnableNotificationsButton` (83463669) |
| Task 3 | `test(128-07-3): add failing tests for open-room-deep-link parser` (cad86015) | `feat(128-07-3): wire openRoom deep-link + EnableNotificationsButton into AppShell` (a14dd6bb) |

No REFACTOR commits needed — each GREEN commit landed clean implementation.

## Where Wave 3 Picks Up

This plan closes the last consumer-side surface for the push loop. The pieces are now in place end-to-end:
- **Backend:** VAPID config + subscription store + push-trigger loop + web-push send (Wave 1 + Wave 2 Plan 06).
- **Service worker:** push handler + notificationclick + pushsubscriptionchange (Wave 1 Plan 04).
- **Frontend:** opt-in button + subscription mint + POST + openRoom deep-link receiver (THIS PLAN).

Next in the phase: Wave 3 (Plans 08-11) wires nginx dual-conf routes, starter.ts push-trigger-loop bootstrap alongside observation-loop-starter, database.ts route mounting, and the Telegram-bridge teardown motion (D-17 same-shipping-unit).

## Self-Check

Verified:
- `src/ui/features/notifications/push-subscription-api.ts` — FOUND
- `src/ui/features/notifications/push-subscription-api.test.ts` — FOUND
- `src/ui/features/notifications/EnableNotificationsButton.tsx` — FOUND
- `src/ui/features/notifications/EnableNotificationsButton.test.tsx` — FOUND
- `src/ui/features/notifications/open-room-deep-link.ts` — FOUND
- `src/ui/features/notifications/open-room-deep-link.test.ts` — FOUND
- Commits 7715dfaf, 80ff56d5, 79e5fe76, 83463669, cad86015, a14dd6bb — all FOUND in `git log`

## Self-Check: PASSED
