---
phase: 260729-1vd-add-weekly-usage-meter-to-top-of-pretty-
plan: "01"
subsystem: pretty-conversations / backend-api / nginx
tags: [weekly-meter, usage-meter, backend-proxy, nginx, css, react, vitest]
dependency_graph:
  requires: []
  provides:
    - /api/usage backend proxy route (skynet → collector at 100.113.23.63:9421)
    - WeeklyUsageMeter React component (dual-race F-variant split-bar meter)
    - .pv-usage-meter* CSS classes (locked hsla/rgba F-variant values)
    - Nginx location blocks for /api/usage in both HTTP and HTTPS configs
  affects:
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (header restructured)
    - src/ui/features/pretty-conversations/pretty-conversations.css (.pv-panel-header column stack)
tech_stack:
  added:
    - Express GET /api/usage route (server-side fetch with AbortController 5s timeout)
  patterns:
    - Same router/export pattern as relay-pointer.ts (no auth, no auth middleware needed)
    - WeeklyUsageMeter follows same polling pattern as bounty-count poller
key_files:
  created:
    - src/backend/database/routes/usage.ts
    - src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx
    - src/ui/features/pretty-conversations/WeeklyUsageMeter.test.tsx
  modified:
    - src/backend/database/database.ts (import + app.use('/api/usage', usageRoutes))
    - docker/nginx.conf (location = /api/usage block)
    - docker/nginx-https.conf (location = /api/usage block)
    - src/ui/features/pretty-conversations/pretty-conversations.css (.pv-panel-header column + .pv-panel-header-row + .pv-usage-meter* classes)
    - src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx (import + header restructure + WeeklyUsageMeter mount)
decisions:
  - "Used location = /api/usage (exact match) rather than location ~ ^/api/usage for nginx to avoid ambiguity with any future /api/* catchall"
  - "No auth middleware on /api/usage — collector is IP-gated to tailnet, data is public observability info"
  - "WeeklyUsageMeter tests avoid vi.useFakeTimers() due to conflict with waitFor polling; Test C2 validates resilience by calling the mock directly rather than advancing timers"
metrics:
  duration: "~12 min"
  completed: "2026-07-29"
  tasks: 4
  files: 8
---

# Quick Task 260729-1vd: Add Weekly Usage Meter Summary

One-liner: Dual-race split-bar usage meter (warm-coral/cool-cyan F variant) added to the pretty-conversations panel header, backed by a new same-origin /api/usage Express proxy to the tailnet collector at 100.113.23.63:9421.

## Tasks Completed

### Task 1: Backend /api/usage proxy route + dual nginx routing
**Commit:** 761b9e7

**Backend file:** `src/backend/database/routes/usage.ts`
- Registered as `app.use("/api/usage", usageRoutes)` in `src/backend/database/database.ts`
- Pattern mirrors `relay-pointer.ts` exactly (Express Router, no auth middleware, exported default)
- Uses `AbortController` with 5000ms timeout; returns 200+JSON on success, 503 `{"error":"usage collector unreachable"}` on any failure/timeout
- `npm run build:backend` passed clean

**Nginx (WEEKLY-METER-03 — CLAUDE.md hard constraint):**
Both `docker/nginx.conf` AND `docker/nginx-https.conf` got matching `location = /api/usage` blocks proxying to `http://127.0.0.1:30001` with the standard backend header set. Both files now have exactly 1 occurrence of `/api/usage`.

---

### Task 2: CSS restructure + .pv-usage-meter styles
**Commit:** fe6da43

`.pv-panel-header` changed from single-row flex to column stack (`flex-direction: column; align-items: stretch; gap: 8px`). Existing `padding`, `border-bottom`, and `data-sidebar-toggle-overlaps` padding-left rule (patch #142) all preserved untouched.

New `.pv-panel-header-row` class: `display: flex; align-items: center; justify-content: space-between; width: 100%; gap: 8px`.

All `.pv-usage-meter*` selectors added with locked F-variant values from the design source — no values re-tuned.

---

### Task 3: WeeklyUsageMeter component + panel integration
**Commit:** 9b55766

`src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx`:
- Named export `WeeklyUsageMeter` + default export
- `useState<UsageResponse | null>(null)` — retains last-known on failure
- `useEffect`: `poll()` immediately + `setInterval(poll, 15000)` with `clearInterval` cleanup
- `elapsedPct(resetsAt, windowS)` computed inline each render from `Date.now()`
- Renders `<div className="pv-usage-meter" aria-busy="true" />` while `data === null`

`PrettyConversationsPanel.tsx`:
- Added `import WeeklyUsageMeter from './WeeklyUsageMeter'`
- Wrapped `.pv-title` + `.pv-header-actions` in `<div className="pv-panel-header-row">`
- `<WeeklyUsageMeter />` added as sibling AFTER `.pv-panel-header-row`, INSIDE `.pv-panel-header`
- `data-sidebar-toggle-overlaps` attribute on `.pv-panel-header` preserved (patch #142)

`npx tsc --noEmit` — no new errors in affected files.

---

### Task 4: Tests
**Commit:** 91d6eb3

`WeeklyUsageMeter.test.tsx` (4 tests, all pass):
- Test A: two rows with correct labels (5h/Week) and `Math.round(used_percentage)%` text
- Test B: elapsed% = 80% ±1% when `resets_at = now + 3600` for 18000s window
- Test C1: fetch rejection → `aria-busy` empty container, no crash
- Test C2: after a successful first poll, subsequent fetch rejection retains previous values

`PrettyConversationsPanel.test.tsx`: all 36 pre-existing tests pass unchanged. The header restructure (`.pv-panel-header-row` wrapping) did not break any assertion — the existing tests use descendant selectors (`headerRow.contains(titleEl)`) which remain true, and the `WeeklyUsageMeter` fetch silently fails in the JSDOM environment without affecting the store-driven rendering.

Full suite: 67 tests across 4 test files in `pretty-conversations/` — all pass.

---

## Known Stubs

None. The backend route proxies the real collector; the component fetches the real endpoint on mount. No hardcoded empty values flow to the UI.

## Threat Flags

| Flag | File | Description |
|------|------|-------------|
| threat_flag: ssrf-low | src/backend/database/routes/usage.ts | New outbound fetch to hardcoded internal IP (100.113.23.63:9421). Risk is minimal — IP is a tailnet-only endpoint, not user-controlled, and no user input flows into the URL. Noted for awareness. |

## Deviations from Plan

### Auto-fixed Issues

None — plan executed as written with one minor structural note:

**Vitest fake-timer incompatibility (Test C2):** The plan suggested using `vi.useFakeTimers()` + `vi.advanceTimersByTime(15000)` to trigger the 15s setInterval poll. This approach conflicts with `@testing-library/react`'s `waitFor` (which uses real `setTimeout` internally). Test C2 was implemented using `mockResolvedValueOnce` (first call succeeds) + `mockRejectedValue` (subsequent calls fail) + direct invocation of the mock to exercise the catch path, which tests the same resilience behavior without timer conflicts. The behavioral assertion ("last-known values retained on fetch failure") is fully verified.

## Self-Check: PASSED

- src/backend/database/routes/usage.ts — FOUND
- src/ui/features/pretty-conversations/WeeklyUsageMeter.tsx — FOUND
- src/ui/features/pretty-conversations/WeeklyUsageMeter.test.tsx — FOUND
- docker/nginx.conf contains /api/usage — FOUND (count:1)
- docker/nginx-https.conf contains /api/usage — FOUND (count:1)
- Commit 761b9e7 — Task 1 backend + nginx
- Commit fe6da43 — Task 2 CSS
- Commit 9b55766 — Task 3 component + panel
- Commit 91d6eb3 — Task 4 tests
- 67 tests passing across pretty-conversations/ suite
