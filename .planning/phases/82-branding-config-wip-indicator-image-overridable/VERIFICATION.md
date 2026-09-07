---
phase: 82-branding-config-wip-indicator-image-overridable
verified: 2026-09-07T10:56:00Z
status: passed
score: 10/10 must-haves verified
overrides_applied: 0
---

# Phase 82: Branding config — WIP indicator image overridable — Verification Report

**Phase Goal:** Make the WIP indicator image (`docker/branding-defaults/wip-cube.webp` after relocation) operator-overridable via the Phase 70 branding config pipeline. Extend `BrandingConfig` with `wipIndicatorPath: string`, relocate the asset, rewire `WipBubble.tsx` to read src from `useBrandingConfig()`.

**Verified:** 2026-09-07T10:56:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Backend `BrandingConfig` type carries `wipIndicatorPath: string`; `HARDCODED_FALLBACK` sets `"/branding/wip-cube.webp"`; `isValidBrandingShape` validates it | VERIFIED | `src/backend/branding/branding-config-loader.ts` L48 (type), L86 (HARDCODED_FALLBACK), L184 (shape guard). 4 references total |
| 2 | Bundled JSON default `docker/branding-defaults/branding.json` contains `"wipIndicatorPath": "/branding/wip-cube.webp"` | VERIFIED | Line 7; `jq -e '.wipIndicatorPath == "/branding/wip-cube.webp"'` → exit 0 |
| 3 | Bundled asset exists at `docker/branding-defaults/wip-cube.webp` (1119530 bytes) | VERIFIED | `stat -c '%s'` returned `1119530` matching plan spec |
| 4 | Old asset location `public/wip-cube.webp` no longer exists; `git log --follow` shows rename lineage | VERIFIED | `test ! -e public/wip-cube.webp` OK; `git log --diff-filter=R --follow` shows `R100 public/wip-cube.webp → docker/branding-defaults/wip-cube.webp` at commit `1fa9f709`, walking back to `46469a8d` (pre-move Patch #260 canvas→WebP swap) — perfect rename detection |
| 5 | Frontend `BrandingConfig` type mirror in `branding-store.ts` carries `wipIndicatorPath: string`; initial-state sentinel contains `"/branding/wip-cube.webp"` | VERIFIED | `src/ui/branding/branding-store.ts` L57 (type), L85 (sentinel) |
| 6 | Frontend shape guard `isBrandingConfig` in `branding-fetch.ts` rejects missing/non-string `wipIndicatorPath` | VERIFIED | `src/ui/branding/branding-fetch.ts` L53: `if (typeof o.wipIndicatorPath !== "string") return false;` |
| 7 | `WipBubble.tsx` imports `useBrandingConfig` from `@/branding/branding-store`; destructures `wipIndicatorPath`; `<img>` src uses `{wipIndicatorPath}` (not hardcoded string); `h-[52px] w-[52px]` classes unchanged; existing comment header preserved | VERIFIED | L32 import; L35 destructure; L39 `src={wipIndicatorPath}`; L43 sizing classes intact; L1-20 patch #86/#260/2026-08-02/2026-09-05 history preserved verbatim; L21 Phase 82 addendum inserted; `grep 'src="/wip-cube.webp"'` returns 0 |
| 8 | Byte-for-byte invariant: `"/branding/wip-cube.webp"` present in all 3 files (backend HARDCODED_FALLBACK, bundled JSON, frontend sentinel) | VERIFIED | Backend loader L86, frontend store L85, JSON L7 — identical string |
| 9 | Scope fence honored: `assert-boot.ts` untouched, `nginx.conf`/`nginx-https.conf` untouched, `Dockerfile` untouched, `WipBubble.tsx` sizing unchanged, `branding-routes.ts` Cache-Control unchanged | VERIFIED | `git diff --name-only 27d42012^..df5d12b0` for phase window shows ONLY: ROADMAP, STATE, phase docs, `branding-config-loader.ts` + tests, `branding.json`, `wip-cube.webp`, `branding-store.ts`, `branding-fetch.ts`, `assert-boot.test.ts`, `WipBubble.tsx`. Zero scope-fence violations. `ASSET_CACHE = "public, max-age=300"` at branding-routes.ts L49 unchanged |
| 10 | Test fixtures updated: `branding-config-loader.test.ts` and `assert-boot.test.ts` include `wipIndicatorPath` | VERIFIED | loader test 11 references (fixture, bundled mock, Tests 8+9 body/assertions); assert-boot test 2 references (LoadResult type L41, makeValidLoadResult L63). Vitest `16 passed / 16 total` |

**Score:** 10/10 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/branding/branding-config-loader.ts` | Extended type + shape guard + HARDCODED_FALLBACK | VERIFIED (Level 1/2/3/4) | Exists (336 lines, substantive); imported by branding-routes.ts and assert-boot.ts; data flows into `/api/branding` JSON + `resolveAssetPath()` bundled fallback |
| `src/backend/branding/branding-config-loader.test.ts` | Fixture + shape-guard tests | VERIFIED | 11 wipIndicatorPath refs including Tests 8+9; `npx vitest run` → 10 pass |
| `src/backend/branding/assert-boot.test.ts` | Fixture updated | VERIFIED | 2 refs (LoadResult + factory); `npx vitest run` → 6 pass, no production `assert-boot.ts` edit |
| `docker/branding-defaults/branding.json` | Bundled default JSON with new field | VERIFIED | Line 7 present; jq check passes; existing SKYNET uppercase preserved |
| `docker/branding-defaults/wip-cube.webp` | Bundled asset present, 1119530 bytes | VERIFIED (Level 1/2/3/4) | File exists on disk; git rename R100 from `public/`; Dockerfile L78 `COPY --chown=node:node docker/branding-defaults /app/branding-defaults` glob-copies the whole directory (auto-picked up at container build) |
| `src/ui/branding/branding-store.ts` | Extended type + sentinel | VERIFIED (Level 1/2/3/4) | Type L57, sentinel L85; used by `useBrandingConfig()` consumers (`WipBubble`, `AppShell`, `Auth`, `PrettyConversationsPanel`, `apply-favicon`) |
| `src/ui/branding/branding-fetch.ts` | Extended shape guard | VERIFIED | Guard branch L53; `fetchBrandingConfig()` signature unchanged; publish path guarded |
| `src/ui/features/pretty-view/WipBubble.tsx` | Rewired to `useBrandingConfig().wipIndicatorPath` | VERIFIED (Level 1/2/3/4) | Import L32, destructure L35, JSX `src={wipIndicatorPath}` L39; mounted from `PrettyView.tsx:3388` via `{isWorking && <WipBubble />}` — mount conditions preserved |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `WipBubble.tsx` | `useBrandingConfig` in `branding-store.ts` | `import { useBrandingConfig } from "@/branding/branding-store"` + `const { wipIndicatorPath } = useBrandingConfig()` | WIRED | Verified in WipBubble.tsx L32+L35 |
| Backend `HARDCODED_FALLBACK` | Bundled JSON `wipIndicatorPath` | Byte-for-byte string agreement | WIRED | Both `"/branding/wip-cube.webp"` — cross-file grep confirms |
| Frontend sentinel | Backend HARDCODED_FALLBACK + Bundled JSON | Byte-for-byte string agreement (Phase 70 Pitfall 5 contract) | WIRED | All three files carry identical string; verified via grep |
| `WipBubble` src attribute | Backend `/branding/wip-cube.webp` route | Browser fetch → nginx `location ^~ /branding/` (proxy_pass) → Express `branding-routes.ts` `/branding/*splat` handler → `resolveAssetPath("wip-cube.webp")` → override `/etc/skynet/branding/wip-cube.webp` first, else bundled `/app/branding-defaults/wip-cube.webp` | WIRED | End-to-end trace verified: nginx.conf L999 proxy_pass, branding-routes.ts L127-166 handler, resolveAssetPath L280-335 override→default cascade, Dockerfile L78 COPY, physical file present |
| Bundled JSON | `getBundledDefaults()` | `readFileSync` + `isValidBrandingShape` (extended guard) | WIRED | JSON satisfies extended guard (verified by loader test Test 6 continuing to pass) |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|-------------------|--------|
| `WipBubble.tsx` | `wipIndicatorPath` | `useBrandingConfig()` → module-scoped `state` in `branding-store.ts` → published via `publishBrandingConfig(json)` from `branding-fetch.ts` after successful `/api/branding` fetch, else sentinel string `"/branding/wip-cube.webp"` from tick 0 | Yes | FLOWING — string always populated (sentinel initial state + backend publish); WipBubble renders real bytes via nginx→Express→resolveAssetPath cascade |
| `/api/branding` JSON response | `config` | `loadBrandingConfig()` → reads `/etc/skynet/branding/branding.json` OR returns `getBundledDefaults()` (from disk) OR `HARDCODED_FALLBACK` (last-resort) | Yes | FLOWING — full BrandingConfig object with `wipIndicatorPath` field populated at every fallback level |
| `/branding/wip-cube.webp` route | Response body (asset bytes) | `resolveAssetPath("wip-cube.webp")` → override `fs.access` at `/etc/skynet/branding/wip-cube.webp` → bundled `/app/branding-defaults/wip-cube.webp` → 404 | Yes | FLOWING — bundled default is the 1119530-byte file physically present in `docker/branding-defaults/`, ships in Dockerfile L78 COPY layer |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Backend loader accepts extended shape; rejects missing/wrong-type wipIndicatorPath | `npx vitest run src/backend/branding/branding-config-loader.test.ts src/backend/branding/assert-boot.test.ts` | `Test Files 2 passed (2); Tests 16 passed (16)` | PASS |
| PrettyView layout invariant (WipBubble mount as sibling of message list) preserved through the rewire | `npx vitest run src/ui/features/pretty-view/PrettyView.plain-dom.test.tsx` | `Test Files 1 passed (1); Tests 7 passed (7)` | PASS |
| Frontend + backend types compile with extended BrandingConfig | `npx tsc --noEmit` | exit 0, no output | PASS |
| Bundled asset is a real file, correct size | `stat -c '%s' docker/branding-defaults/wip-cube.webp` | `1119530` | PASS |
| JSON bundled default has correct wipIndicatorPath | `jq -e '.wipIndicatorPath == "/branding/wip-cube.webp"' docker/branding-defaults/branding.json` | exit 0 (true) | PASS |

### Requirements Coverage

All plans declare `requirements: []` — Phase 82 is a bounty-driven schema-extension phase with no formal REQUIREMENTS.md IDs. No coverage gap.

### Anti-Patterns Found

None. Full sweep:

- No `TBD`/`FIXME`/`XXX` markers in modified files
- No `TODO`/`HACK`/`PLACEHOLDER` markers in modified files
- No hardcoded empty returns (`return null`, `return []`, `return {}`) added
- No console.log-only implementations
- No hardcoded `/wip-cube.webp` string remains in any `.ts`/`.tsx` outside test fixtures (which correctly assert the sentinel value)
- Two documented deviations in 82-04-SUMMARY (grep counts of 3 for `useBrandingConfig` and 2 for `role="status"`) are comment-only — both are the intended additive comment mentions per the "preserve existing comment lines verbatim" mandate. Runtime behavior unchanged. Not anti-patterns.

### End-to-End Goal Verification

**The critical goal-backward truth:** An operator dropping `/opt/skynet/branding/wip-cube.webp` on the host will cause `<WipBubble>` to render THAT image after the next `/branding/wip-cube.webp` fetch. Trace validated hop-by-hop:

1. Browser `<img src={wipIndicatorPath}>` — `wipIndicatorPath` reads `"/branding/wip-cube.webp"` from `useBrandingConfig()` (sentinel at tick 0; operator override propagates via `/api/branding` publish if the operator's `branding.json` sets a different string). WipBubble.tsx L35+L39 verified.
2. Browser GET `/branding/wip-cube.webp` — Caddy → nginx.
3. Nginx `location ^~ /branding/` (nginx.conf L999) `proxy_pass http://127.0.0.1:30001` — routes to Express. Both http and https confs updated per Phase 70; **no Phase 82 nginx changes required**.
4. Express `branding-routes.ts` L127 `/branding/*splat` handler calls `resolveAssetPath("wip-cube.webp")`.
5. `resolveAssetPath` (branding-config-loader.ts L280-335): first checks operator override at `/etc/skynet/branding/wip-cube.webp` (bind-mounted from host `/opt/skynet/branding/wip-cube.webp` per Phase 70 D-01); if present → returns `{ source: "override", path }`. If absent → checks bundled default at `/app/branding-defaults/wip-cube.webp` (COPYed by Dockerfile L78 `COPY --chown=node:node docker/branding-defaults /app/branding-defaults`); if present → returns `{ source: "default", path }`.
6. Express `sendFile(resolved.path)` with `Cache-Control: public, max-age=300` — served bytes flow back to browser.

Every hop verified against shipped code at HEAD `df5d12b0`. The operator override path is functional end-to-end. No container restart required (Phase 70's per-request `fs.access` resolver).

WipBubble mount conditions preserved: `PrettyView.tsx:3388` still gates on `{isWorking && <WipBubble />}` (Terminal PTY non-idle OR backgrounded agents/shells running, per the file's L23-25 comment header). Rewire touched only the `<img src>` attribute value.

### Gaps Summary

No gaps. Every must-have verified via live-code inspection at HEAD `df5d12b0`, cross-file byte agreement confirmed, scope fence honored, tests green (16 backend + 7 PrettyView = 23/23), tsc clean, git rename detection intact for asset relocation.

---

*Verified: 2026-09-07T10:56:00Z*
*Verifier: Claude (gsd-verifier)*
