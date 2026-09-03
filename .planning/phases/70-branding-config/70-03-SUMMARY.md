---
phase: 70-branding-config
plan: 03
subsystem: frontend
tags: [branding, useSyncExternalStore, module-singleton, boot-fetch, favicon, pre-login]
dependency_graph:
  requires:
    - "70-01 (backend GET /api/branding at Express port 30001 returning BrandingConfig JSON)"
    - "70-02 (nginx location block proxying /api/branding through to backend port 30001)"
  provides:
    - "src/ui/branding/branding-store.ts — module singleton exporting BrandingConfig type, publishBrandingConfig, useBrandingConfig, __resetForTest"
    - "src/ui/branding/branding-fetch.ts — fetchBrandingConfig() boot-time async helper (silent no-op on failure)"
    - "src/ui/branding/apply-favicon.ts — useBrandingFavicon() imperative-DOM hook rewriting <link rel=icon> hrefs on faviconPath change"
    - "src/main.tsx — boot fires void fetchBrandingConfig() in parallel with prepareClientCacheVersion; createRoot render NOT gated"
  affects:
    - "src/ui/branding/ subtree — new directory with three files; zero UI consumers landed in this plan (Plan 70-04 is the surface-wiring consumer)"
    - "Boot chain in src/main.tsx — one added import + one added void call before the existing prepareClientCacheVersion().finally(createRoot()) chain"
tech_stack:
  added: []
  patterns:
    - "useSyncExternalStore module-singleton (analog: src/ui/state/session-tmux-store.ts)"
    - "Plain fetch() pre-login fetch (analog: WeeklyUsageMeter.tsx L96-111)"
    - "Imperative DOM assignment inside useEffect for <head> mutations (analog: AppShell.tsx L613-624 document.title)"
    - "Inline typeof / Array.isArray shape guard (analog: global-files-config-loader.ts L122-137)"
    - "JSON.stringify equality no-op guard for whole-object publish"
    - "Bundled-default sentinel initial state (byte-for-byte match with docker/branding-defaults/branding.json)"
key_files:
  created:
    - "src/ui/branding/branding-store.ts"
    - "src/ui/branding/branding-fetch.ts"
    - "src/ui/branding/apply-favicon.ts"
  modified:
    - "src/main.tsx (+1 import; +7 lines: comment banner + `void fetchBrandingConfig();`)"
decisions:
  - "Store singleton uses useSyncExternalStore, NOT React Context (banned per 70-RESEARCH.md L46+L201 — codebase has zero Context providers for app-scoped state). No new deps."
  - "Store initial state is a bundled-default sentinel returned by getBundledDefaultsSentinel() — byte-for-byte match with docker/branding-defaults/branding.json (appName='Skynet', iconPath='/branding/icon.png', etc.). Sentinel factory is a function (not a shared object literal) so __resetForTest and initial-state assignment produce independent objects, avoiding shared-reference contamination between tests."
  - "publishBrandingConfig uses JSON.stringify(state) === JSON.stringify(next) as the no-op guard. Config is tiny (~6 scalar fields + a 2-element pwaIcons array) so stringify is cheap; this correctly deep-compares the whole shape without introducing a helper. Contrasts with session-tmux-store which per-key compares one string field."
  - "Boot-chain integration uses the recommended parallel fire-and-forget form: `void fetchBrandingConfig();` placed immediately BEFORE the existing prepareClientCacheVersion().finally(createRoot(...).render) chain. Not Promise.all — the fetch is deliberately non-blocking and the initial defaults sentinel keeps first-paint defensible even if the fetch never resolves (Pitfall 5). Rationale per 70-RESEARCH.md L263."
  - "fetchBrandingConfig re-validates the response shape via inline isBrandingConfig type guard (typeof / Array.isArray only). Network is a distinct trust boundary from the backend loader; a compromised or misrouted response (e.g. nginx SPA fallback returning index.html masquerading as JSON) is rejected quietly, retaining the sentinel — never a partial or invalid store state."
  - "useBrandingFavicon() runs a useEffect keyed on branding.faviconPath (not the whole branding object) so the effect only fires when the favicon path actually changes. document.querySelectorAll('link[rel=\"icon\"]') iterates and rewrites .href on every match (index.html ships two — 16x16 + 32x32); no cleanup function (reverting on unmount would flash the old favicon and this hook is expected to live on an always-mounted top-level component)."
  - "silent no-op on all fetch failure paths (non-2xx, JSON.parse throw, shape-guard reject, network error). Per Pitfall 5 rationale, noisy console.error on a boot-race non-fatal fetch would pollute the console for every user on every page load; store retention of the sentinel is the correct behavior."
  - "Comment wording avoided the banned strings 'react-helmet', 'zustand', 'useContext' by rephrasing (e.g. 'head-management library', 'external state-management or head-management packages', 'no auth wrapper'). This is a Rule 3 auto-fix — the plan's own grep gates count comment matches; reword rather than skip the safety-net documentation."
metrics:
  duration: "~10 min"
  completed: "2026-09-03"
  tasks_completed: 2
  files_created: 3
  files_modified: 1
---

# Phase 70 Plan 03: Frontend Branding Store + Boot Fetch + Favicon Hook Summary

Frontend branding subsystem: module-singleton `useSyncExternalStore` store (mirroring `session-tmux-store.ts`) exposing `useBrandingConfig()` and `publishBrandingConfig()`, boot-time `fetchBrandingConfig()` that GETs `/api/branding` via plain `fetch()` (matching `WeeklyUsageMeter.tsx`'s pre-login unauthenticated shape), and `useBrandingFavicon()` hook that imperatively rewrites `<link rel="icon">` hrefs on `faviconPath` change. Boot fetch wired into `src/main.tsx` as `void fetchBrandingConfig();` fired in parallel with `prepareClientCacheVersion()` — `createRoot` render is NOT gated on the fetch, and the store's initial bundled-default sentinel (byte-for-byte match with `docker/branding-defaults/branding.json`, `appName="Skynet"`) defends first paint regardless of fetch outcome (Pitfall 5 mitigation). Three new files under `src/ui/branding/`; one existing file modified. Zero UI consumers in this plan — Plan 70-04 is the surface-wiring consumer.

## Tasks Executed

### Task 1: Create branding-store.ts + branding-fetch.ts

**Commit:** `7d9179f1`
**Files created:** 2

**`src/ui/branding/branding-store.ts` (164 lines)**

Direct copy of the state+listeners+notify+subscribe scaffolding from `src/ui/state/session-tmux-store.ts`, adapted for a single global `BrandingConfig` object rather than a keyed `Map`.

| Concern | Analog (session-tmux-store) | Branding delta |
|---------|-----------------------------|-----------------|
| State type | `{ map: Map<string, TmuxRecord> }` | Single `BrandingConfig` object (6 scalar fields + pwaIcons array) |
| Initial state | Empty Map | Bundled-default sentinel from `getBundledDefaultsSentinel()` (byte-for-byte match with docker/branding-defaults/branding.json) |
| notify() + subscribe() | verbatim | verbatim |
| Writers | `publishFleetStatusTmuxSession` + `publishFleetStatusTmuxSessionGone` (two writers, per-key) | Single `publishBrandingConfig(next)` — wholesale replacement, JSON.stringify no-op guard |
| No-op guard | Per-key: `existing.tmuxSession === tmuxSession` string equality | Whole-object: `JSON.stringify(state) === JSON.stringify(next)` deep-equal via serialize |
| Hook | `useSessionTmuxName(key)` returns `string \| null` for a specific key | `useBrandingConfig()` returns the whole `BrandingConfig` object |
| Structured log | `operation: "fleet_status_tmux_publish"` w/ hostId, tmuxSession, key, previous | `operation: "branding_config_publish"` w/ previous.appName, next.appName |
| Test helper | `__resetForTest()` → empty Map | `__resetForTest()` → fresh sentinel object from factory |

**Exports:** `BrandingConfig` (type), `publishBrandingConfig`, `useBrandingConfig`, `__resetForTest`.

**`src/ui/branding/branding-fetch.ts` (85 lines)**

Pre-login unauthenticated fetch shape verbatim from `WeeklyUsageMeter.tsx` L99 (`await fetch("/api/usage")`), adapted for `/api/branding`. Adds an inline `isBrandingConfig` type guard as a client-side second trust boundary — the backend already validates the JSON shape in `loadBrandingConfig` (Plan 70-01), but a compromised or misrouted response (e.g. nginx SPA fallback returning `index.html` masquerading as JSON) is caught here and silently rejected, retaining the store's bundled-default sentinel.

Guard fields checked: `appName`, `shortName`, `iconPath`, `wordmarkPath`, `faviconPath` (all `typeof === "string"`) + `pwaIcons` (`Array.isArray`). Nested per-icon shape (`src/sizes/type`) is intentionally NOT deep-checked at the client boundary — the backend validates it and the frontend never dereferences pwaIcons in a way that would crash on malformed entries (Plan 70-04 uses the icons for `<link>` generation which is defensive to missing fields).

Silent no-op contract on all failure paths: non-2xx response, `JSON.parse` throw, shape-guard rejection, network error. Store retains the sentinel — the app renders "Skynet" branding, byte-identical to today's t1000 behavior (D-14). Per Pitfall 5 rationale: no `console.error` on failure — noisy boot-race logging pollutes the console for every user on every page load.

**Task 1 verification (all pass):**

| Check | Expected | Actual |
|-------|----------|--------|
| `npx tsc --noEmit` | exit 0, zero output | exit 0, zero output |
| `grep -c "useSyncExternalStore" src/ui/branding/branding-store.ts` | ≥ 1 | 4 |
| `grep -REc "react-helmet\|zustand\|useContext" src/ui/branding/` | 0 total | 0 (after comment reword) |
| `grep -Ec "authApi\|Authorization:" src/ui/branding/branding-fetch.ts` | 0 | 0 (after comment reword) |
| `grep -c "isBrandingConfig" src/ui/branding/branding-fetch.ts` | ≥ 2 | 4 |
| `grep -c 'fetch("/api/branding"' src/ui/branding/branding-fetch.ts` | ≥ 1 | 2 (comment + call) |
| Line count store ≥ 70 | true | 164 |
| Line count fetch ≥ 25 | true | 85 |
| `package.json` unchanged | true | true |

### Task 2: Create apply-favicon.ts + wire boot fetch into main.tsx

**Commit:** `9377cd1d`
**Files created:** 1, **modified:** 1

**`src/ui/branding/apply-favicon.ts` (47 lines)**

`useBrandingFavicon()` hook — reads the current branding via `useBrandingConfig()`, then a `useEffect` keyed on `[branding.faviconPath]` (NOT the whole object) runs `document.querySelectorAll<HTMLLinkElement>('link[rel="icon"]')` and assigns `link.href = branding.faviconPath` for each match. Pattern mirrors `AppShell.tsx` L613-624's imperative `document.title` assignment inside a `useEffect` — no head-management library involved, no `react-helmet`.

`index.html` ships two `<link rel="icon">` tags (L22-23, 16x16 + 32x32 PNGs) — both are rewritten in one pass. Apple-touch-icon links (L17-21, 5 sizes) are intentionally left alone per D-10 (deferred as low-value MVP scope; PWA install picks up icons from the manifest not from apple-touch-icons on modern iOS).

No cleanup function on the useEffect. Rationale: (a) this hook is expected to be called from a top-level always-mounted component (Plan 70-04's wiring decision — recommendation is inside `AppShell` so the favicon applies pre-login too), and (b) even if the hook did unmount, reverting to a previous href would flash the OLD favicon briefly which is worse than keeping the new one visible.

**`src/main.tsx` edits (+1 import, +7 lines)**

Added import alongside existing route imports (line 20):
```typescript
import { fetchBrandingConfig } from "@/branding/branding-fetch";
```

Added call immediately BEFORE the existing `prepareClientCacheVersion().finally(...)` chain (line 261):
```typescript
// Phase 70: hydrate the branding-store from /api/branding.
// Fire-and-forget: the store's initial state is a bundled-default sentinel
// (byte-for-byte match with docker/branding-defaults/branding.json), so
// first-paint is defensible even if this fetch never resolves — matches
// today's t1000 "Skynet" behavior (Pitfall 5 mitigation, D-14). Runs in
// parallel with prepareClientCacheVersion(); createRoot render is NOT
// gated on the branding promise.
void fetchBrandingConfig();

prepareClientCacheVersion().finally(() => {
  createRoot(document.getElementById("root")!).render(...);
});
```

The `void` keyword is deliberate: it satisfies TypeScript's `no-floating-promises` and signals "we are intentionally not awaiting this" to future maintainers.

**Task 2 verification (all pass):**

| Check | Expected | Actual |
|-------|----------|--------|
| `npx tsc --noEmit` | exit 0 | exit 0 |
| `grep -c "fetchBrandingConfig" src/main.tsx` | ≥ 2 (import + call) | 2 |
| `grep -c "useBrandingFavicon" src/ui/branding/apply-favicon.ts` | ≥ 1 | 2 (comment mention + export) |
| `grep -c 'link\[rel=.icon.\]' src/ui/branding/apply-favicon.ts` | ≥ 1 | 1 |
| Boot chain: fetch not gating render | createRoot inside `.finally(prepareClientCacheVersion())` unchanged | verified |
| Line count apply-favicon ≥ 20 | true | 47 |
| `package.json` unchanged | true | true |

## Overall Verification

Final full verification suite after both tasks:

```
--- tsc: exit 0 ---
--- useSyncExternalStore in store (want ≥1): 4 ---
--- banned patterns in src/ui/branding/ (want 0): 0 ---
--- authApi/Authorization in fetch (want 0): 0 ---
--- fetchBrandingConfig in main.tsx (want ≥2): 2 ---
--- useBrandingFavicon in apply-favicon (want ≥1): 2 ---
--- link[rel=icon] in apply-favicon (want ≥1): 1 ---
--- package.json diff: (empty) ---
--- new subtree size: 296 lines total (store 164 / fetch 85 / apply-favicon 47) ---
```

All success criteria met: store implements useSyncExternalStore singleton with bundled-default sentinel initial state (`appName="Skynet"`); fetch implements plain-fetch unauthenticated GET `/api/branding` with inline shape guard and silent no-op on failure; favicon hook implements imperative-DOM `useEffect` keyed on `faviconPath`; `main.tsx` fires `fetchBrandingConfig()` at boot without awaiting it before `createRoot` render; no `react-helmet`, no `zustand`, no React Context in the new subtree; TypeScript compiles clean; no new `package.json` dependencies.

## Deviations from Plan

**[Rule 3 - Fix blocking issue] Reworded anti-pattern comments to avoid grep false-positives**
- **Found during:** Task 1 and Task 2 verification runs
- **Issue:** The plan's `<verify>` grep gate `grep -REc "react-helmet|zustand|useContext" src/ui/branding/` counts ALL matches including those in anti-pattern comments that document what NOT to use. My initial comment wording ("DO NOT install zustand or react-helmet — codebase house style is imperative DOM updates") and ("with no authApi, no Authorization header") tripped the gates by 1 in each file.
- **Fix:** Reworded the comments to convey the same anti-pattern rationale using generic phrasing:
  - `branding-store.ts`: `"external state-management or head-management packages"` (was `"zustand or react-helmet"`)
  - `branding-fetch.ts`: `"with no auth wrapper, no JWT header"` (was `"with no authApi, no Authorization header"`)
  - `apply-favicon.ts`: `"head-management library"` (was `"react-helmet / helmet-async"`)
- **Files modified:** All three new files (comment blocks only; zero code changes)
- **Commit:** rolled into the original per-task commits (`7d9179f1` and `9377cd1d`) — reworded before Task 1's commit, then again after Task 2's initial write.
- **Note:** This is a Rule 3 (auto-fix blocking issue) not Rule 1 (bug) — the code itself was always correct; only the safety-net documentation needed rephrasing. The rationale itself is preserved verbatim; only the literal package/API names were pulled from the prose.

Otherwise: plan executed exactly as written. Two minor implementation clarifications worth flagging (not deviations):

1. `main.tsx` lives at `src/main.tsx`, NOT `src/ui/main.tsx` as the plan's `files_modified` frontmatter states. The plan text elsewhere (`<context>` block and the L261 boot-chain reference) is consistent with `src/main.tsx`. Verified via `find src -name main.tsx`. The frontmatter path was updated implicitly by pointing my edit at the actual file.
2. The extension convention picked was **no `.js` suffix, bare `@/branding/...` alias imports** — matches how `AppShell.tsx` imports `session-tmux-store` (`from "@/state/session-tmux-store"`). Verified via `grep "from.*state/session-tmux-store" src`. The `main.tsx` import is `import { fetchBrandingConfig } from "@/branding/branding-fetch";`. Internal imports within the new `src/ui/branding/` subtree use relative paths (`from "./branding-store"`) since they're siblings and there's no established convention within a single subdir either way.

## Handoff Notes

**To Plan 70-04 (frontend surface wire-through):**

- **Consumer pattern:** Any surface component reads the config with
  ```typescript
  const brandingConfig = useBrandingConfig();
  ```
  and dereferences `brandingConfig.appName`, `brandingConfig.iconPath`, `brandingConfig.wordmarkPath`, `brandingConfig.faviconPath`, `brandingConfig.shortName`, `brandingConfig.pwaIcons` as needed. No prop-drilling, no Context wrapper — the hook reads the module singleton via `useSyncExternalStore` and re-renders the component on any published change.
- **Recommended favicon wiring site:** call `useBrandingFavicon()` ONCE from a top-level always-mounted component. Recommendation is inside `AppShell` (mounted for both pre-login/auth and post-login/main flows) so the favicon applies pre-login as well as post-login. Alternative: `App()` in `main.tsx`. Plan 70-04 owns this call-site decision — the hook itself is idempotent, so calling it in multiple places is safe but wasteful.
- **First-render defaults:** Store hydration is asynchronous. The first render may see the bundled-default sentinel briefly before the `/api/branding` fetch resolves. This is EXPECTED and DESIRED per Pitfall 5 mitigation — the sentinel matches the actual Skynet defaults byte-for-byte so t1000 users see no flash-of-wrong-brand (both states render as "Skynet" branding). For AI+ deploys, users may see the "Skynet" defaults for a beat before the fetch swaps to "Aither Intelligence Plus" — this is the acceptable trade-off vs blocking first paint on a boot-race network fetch.
- **AppShell integration:** L232 (initial dashboard tab label), L616 (`document.title` fallback chain — last-fallback slot), and L1569 (tab reset on close) each need `"SKYNET"` → `brandingConfig.appName`. Add `const brandingConfig = useBrandingConfig();` near the top of the `AppShell` function (~L225).
- **PrettyConversationsPanel header:** L1489-1497 `<SkynetLogo>` + `<img src="/skynet-wordmark.png">` → `<img src={brandingConfig.iconPath}>` + `<img src={brandingConfig.wordmarkPath} alt={brandingConfig.appName}>`. Also remove the `SkynetLogo` import at L135 IF no other usage in the file (verify via grep before deleting).
- **Auth.tsx login header:** L1131-1142 `<img src="/icon.png">` + `<img src="/skynet-wordmark.png">` → same swap as PrettyConversationsPanel. Note: today's login icon is `/icon.png` (raster) NOT `<SkynetLogo>` SVG — unifying both on `iconPath` will visually swap SVG-rendered → PNG-rendered on the conversation header for t1000 no-config deploys. See Plan 70-01 SUMMARY Handoff Notes item 3 for the three ways to preserve pixel-perfect continuity if that visual delta is unacceptable.
- **Fifth surface (Auth.tsx L1314 `t("auth.loginTitle")` = "Login to SKYNET"):** research Open Question #1. Plan 70-04's frontmatter says it neutralizes this via en.json — refer to 70-04-PLAN.md for the chosen approach.

**To Plan 70-05 (end-of-phase verify):**

- Store's initial defaults sentinel byte-for-byte matches `docker/branding-defaults/branding.json`. This means the automated test "startup with `/api/branding` stubbed to return 500 must still yield a working app with 'Skynet' branding" should pass without any extra scaffolding — the store never transitions from the sentinel on 500 responses, so the assertion is on the sentinel content, not on side-effects of the fetch.
- No frontend build changes were made — no new eslint rules, no new tsconfig entries, no vite config edits. The subsystem is self-contained under `src/ui/branding/` and reachable only via the single `main.tsx` import.

## Threat Flags

None. The `<threat_model>` register in the plan (T-70-03-01 through T-70-03-SC) covers all security-relevant surface introduced by this frontend subsystem:
- No new endpoints — the frontend is a pure consumer of Plan 70-01's `/api/branding`
- No new auth paths — pre-login unauthenticated fetch matches existing WeeklyUsageMeter precedent
- No new file access — favicon hook only writes to existing `<link rel="icon">` DOM nodes' href attributes
- No schema changes at trust boundaries — the inline `isBrandingConfig` shape guard is a defense-in-depth mirror of the backend's `isValidBrandingShape` (Plan 70-01)

`package.json` diff verified empty — T-70-03-SC (no new packages) satisfied.

## Self-Check: PASSED

- Files created (all present):
  - `src/ui/branding/branding-store.ts` — FOUND (164 lines)
  - `src/ui/branding/branding-fetch.ts` — FOUND (85 lines)
  - `src/ui/branding/apply-favicon.ts` — FOUND (47 lines)
- File modified (present in git log):
  - `src/main.tsx` — modified in commit `9377cd1d` (+1 import, +7 lines added; existing prepareClientCacheVersion().finally(createRoot()) chain unchanged)
- Commits:
  - `7d9179f1` — FOUND (feat(70-03): add branding-store useSyncExternalStore singleton + boot fetch)
  - `9377cd1d` — FOUND (feat(70-03): add useBrandingFavicon hook and wire boot fetch into main.tsx)
