---
phase: 119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c
plan: 05
subsystem: backend
tags:
  - backend
  - express-route
  - ssh-file-read
  - phase-119
  - d-06
requires:
  - Phase 118 D-06 (hasIcon boolean on AppState) — consumed via frontend Plan 119-03 fetches
provides:
  - "GET /apps/:hostId/:slug/icon endpoint (image/webp bytes + ETag/304 + no-store)"
  - "APP_SLUG_RE export (kebab-case slug validator, shell-safety gate)"
  - "readAppIconFile(conn, slug) helper (single-extension icon.webp reader, LOCAL+REMOTE branches)"
affects:
  - src/backend/database/routes/apps.ts (NEW — route body)
  - src/backend/database/routes/apps.test.ts (NEW — 15 route tests)
  - src/backend/database/database.ts (MODIFIED — one import line + one mount line)
  - src/backend/claude-session/identity-artifact-reader.ts (MODIFIED — two new exports co-located with siblings)
  - src/backend/claude-session/identity-artifact-reader.read-app-icon.test.ts (NEW — 11 helper tests)
tech-stack:
  added: []
  patterns:
    - "Auth-gate → path validation → host resolution → local/remote branch → stream file → finally { conn.end() } (identity-avatar mirror at identities.ts:849-966)"
    - "APP_SLUG_RE regex enforced at BOTH route entry AND helper entry (defence-in-depth)"
    - "Pitfall 5 lock: single filename icon.webp — no multi-extension cascade"
key-files:
  created:
    - src/backend/database/routes/apps.ts
    - src/backend/database/routes/apps.test.ts
    - src/backend/claude-session/identity-artifact-reader.read-app-icon.test.ts
  modified:
    - src/backend/database/database.ts
    - src/backend/claude-session/identity-artifact-reader.ts
decisions:
  - "APP_SLUG_RE = /^[a-z0-9-]{1,64}$/ (kebab-case only, NO underscore — shape 1's create-app.sh contract; differs from IDENTITY_KEY_RE)"
  - "Single-filename lock: icon.webp only — no cascade to png/jpg/gif/svg (Pitfall 5, shape 1 §80-82)"
  - "502 for both 'cross-tenant' and 'unreachable' — identical error body — matches identity-avatar V4 discipline (no cross-tenant fingerprint)"
  - "IDMEDIT_MAX_AVATAR_BYTES (5MB) reused as the icon-size cap (icons are the same class of small file per RESEARCH.md A4)"
  - "LOCAL branch uses os.homedir() directly (no IDENTITIES_HOST_DIR-style bind-mount split — apps live under real $HOME)"
  - "readAppIconFile REMOTE branch uses an `ls` probe front-check before sftpReadFile (mirrors readAvatarSiblingFile at L2551-2578; cleanly distinguishes ENOENT from SSH errors)"
metrics:
  duration: 40m
  completed: 2026-09-18
requirements:
  - D-06
---

# Phase 119 Plan 05: Backend `/apps/:hostId/:slug/icon` route + `readAppIconFile` helper — Summary

**One-liner:** Adds the backend endpoint the sidebar tile's `<img>` fetches (Plan 119-03), mirroring the identity-avatar route byte-for-byte with a single-filename (`icon.webp`) lock and a defence-in-depth `APP_SLUG_RE` shell-safety gate.

## What shipped

### Task 1 — `APP_SLUG_RE` + `readAppIconFile` helper

New exports in `src/backend/claude-session/identity-artifact-reader.ts`, co-located with the identity-side siblings they mirror:

- **`APP_SLUG_RE = /^[a-z0-9-]{1,64}$/`** (near `IDENTITY_KEY_RE` at ~L175) — kebab-case-only, deliberately drops the underscore from `IDENTITY_KEY_RE` because shape 1's `create-app.sh` requires kebab-case slugs. Enforced twice: at the route entry (Task 2) AND inside `readAppIconFile` as defence-in-depth. The regex is the sole shell-safety gate for the REMOTE-branch `ls "${targetPath}"` interpolation — mitigation for T-119-05-01 (path traversal) and T-119-05-02 (command injection) in the plan's threat register.

- **`readAppIconFile(conn, slug)`** (immediately after `readAvatarSiblingFile` at ~L2582) — reads exactly one filename, `icon.webp`, from `~/fleet/apps/<slug>/`. LOCAL branch: `fs.readFile($HOME/fleet/apps/<slug>/icon.webp)`; REMOTE branch: `ls`-probe front-check + `sftpReadFile`. Returns `{bytes, mime: "image/webp"}` on success, `null` on absent, throws on invalid-slug / oversized / SSH errors. **No multi-extension cascade** — Pitfall 5 lock from RESEARCH.md; shape 1 §80-82 mandates the agent converts artwork to WebP before dropping it in.

**Tests (11/11 pass):** `src/backend/claude-session/identity-artifact-reader.read-app-icon.test.ts`
- T1a-e: `APP_SLUG_RE` accepts kebab-case, rejects uppercase / underscore / path chars / shell metachars / empty / >64
- T2: helper throws on invalid slug before any exec (both LOCAL and REMOTE entrypoints)
- T3: LOCAL returns `{bytes, mime:'image/webp'}` for an existing `icon.webp`
- T4: LOCAL returns null on ENOENT
- T5: LOCAL throws when file exceeds `IDMEDIT_MAX_AVATAR_BYTES` (5MB)
- T6: REMOTE returns null when the `ls` probe reports absent, and the probe targets exactly `icon.webp` (never any other extension)
- T7: source-level assertion that the helper body never references `png/jpg/jpeg/gif/svg` (Pitfall 5 lock at the AST level)

### Task 2 — `GET /apps/:hostId/:slug/icon` route + mount

New route file: `src/backend/database/routes/apps.ts`. Mirrors `GET /identities/:identityKey/avatar` at `identities.ts:849-966` byte-for-byte in security discipline with two deliberate D-06 deltas:

1. **hostId in the URL path** (not `?hostId=<n>` query) — D-06 explicit.
2. **`APP_SLUG_RE`** instead of `IDENTITY_KEY_RE` for the slug validator.

Discipline preserved verbatim:
- `authenticateJWT` gate → 401 without token
- Slug regex + hostId positive-integer validation → 400 (fail-fast before any SSH work)
- `resolveHostById(hostId, userId)` → 502 on null with body `{"error": "app home box unreachable"}` (does NOT distinguish cross-tenant from unknown-host — RESEARCH.md §Security V4)
- `connectOneShot(host, 5_000)` → same canned 502 on throw
- `readAppIconFile(conn, slug)` → 404 on null result with body `{"error": "no icon on disk for this app"}`
- 200 response: `Content-Type: image/webp` + `Content-Length` + `ETag: "disk-<md5>"` + `Cache-Control: no-store` + bytes
- 304 on `If-None-Match` match
- `finally { conn.end() }` cleanup on every REMOTE-branch exit path (success/404/502)

**Router mount:** `src/backend/database/database.ts` — one import line (`import appsRoutes from "./routes/apps.js";` near the `identities` import) + one mount line (`app.use("/apps", appsRoutes);` immediately after the `/identities` mount at L1977). No overlap with existing prefixes; no reorder of prior mounts.

**Tests (15/15 pass):** `src/backend/database/routes/apps.test.ts` (twelve plan-mandated behaviours + three extra `conn.end()` variants + a LOCAL-branch short-circuit)
- T1: 401 when JWT missing (`connectOneShot` never called)
- T2: 400 on uppercase slug (`BADSLUG` → APP_SLUG_RE mismatch)
- T3: 400 on percent-encoded traversal (`%2E%2E%2Fetc%2Fpasswd`)
- T4: 400 on non-numeric hostId
- T5: 400 on negative hostId
- T6: 400 on zero hostId
- T7: 404 with canned body when `readAppIconFile` returns null
- T8: 200 + `image/webp` + `Content-Length` + `ETag` + bytes on present
- T9: 304 when `If-None-Match` matches the current ETag
- T10: 502 when `resolveHostById` returns null (cross-tenant OR unknown)
- T11: 502 when `connectOneShot` throws
- T12: `conn.end()` called once after successful REMOTE request
- T12b: `conn.end()` called once after 404 REMOTE request
- T12c: `conn.end()` called once after 502 REMOTE request (helper throws)
- T12d: LOCAL branch never invokes `connectOneShot`

## Deviations from Plan

**None (Rule 1/2/3).** Plan executed exactly as written. No auto-fixes required; no architectural questions raised.

**Out-of-scope discovery logged (NOT fixed per executor scope-boundary rule):** 26 pre-existing TS errors in `src/backend/distributor/catalog.ts` (all `TS2322` — missing `sourceKind` discriminant on the app-development skill's template catalog entries). Verified pre-existing by stashing the 119-05 delta and re-running `npm run build:backend` → same 26 errors, all confined to `catalog.ts`. Logged to `deferred-items.md` in the phase directory. Owner: whoever added the `sourceKind` discriminant to `BundledCatalogEntry` without back-filling all entries — likely a Wave-2 shape 1 follow-up on the app-starter template.

## TDD gate compliance

RED → GREEN cycle honoured for both tasks:
- Task 1: `test(119-05):` commit `cf08a1a3` (RED, 11/11 failing) → `feat(119-05):` commit `fcb7ac0f` (GREEN, 11/11 passing)
- Task 2: `test(119-05):` commit `610a52e4` (RED, module-missing) → `feat(119-05):` commit `38f69d7f` (GREEN, 15/15 passing)

No REFACTOR pass required — implementations landed in their canonical mirror shape on first cut.

## Verification

| Gate | Command | Result |
| --- | --- | --- |
| Backend typecheck | `npm run build:backend` | 26 errors, ALL pre-existing in `catalog.ts` (verified via stash baseline); ZERO errors in touched files |
| Scoped vitest | `npx vitest run src/backend/database/routes/apps.test.ts src/backend/claude-session/identity-artifact-reader.read-app-icon.test.ts` | 26/26 passing |
| Related vitest | `npx vitest related --run src/backend/database/routes/apps.ts src/backend/database/routes/apps.test.ts src/backend/claude-session/identity-artifact-reader.ts src/backend/database/database.ts` | 65 files / 1091 tests passing, 1 pre-existing skip |
| Route grep | See Task 2 acceptance criteria block | All 15 grep-based criteria pass (path, auth, slug regex, host resolver, SSH one-shot, finally, conn.end, image/webp, Cache-Control, ETag, mount line, no query-string hostId) |
| Helper grep | See Task 1 acceptance criteria block | All 7 grep-based criteria pass (APP_SLUG_RE export + shape, readAppIconFile export, icon.webp ≥2 mentions, no non-webp extensions in the helper body, mime ≥2 return sites) |

## Threat surface scan

Every threat in the plan's `<threat_model>` maps to a shipped mitigation:

| Threat | Mitigation shipped |
| --- | --- |
| T-119-05-01 (path traversal via slug) | `APP_SLUG_RE` at route entry + helper entry; regex forbids `/`, `.`, `..` |
| T-119-05-02 (command injection via slug in `ls`) | Same `APP_SLUG_RE`; regex forbids `$`, `;`, `&`, backtick, whitespace |
| T-119-05-03 (cross-tenant hostId) | `resolveHostById(hostId, userId)` → canned 502 (no cross-tenant fingerprint) |
| T-119-05-04 (concurrent SSH DoS) | Accepted per plan — identity-avatar has same shape; no new rate-limit |
| T-119-05-05 (byte-length side channel) | Accepted per plan — icons are fleet-public by design |
| T-119-05-06 (oversized icon) | `IDMEDIT_MAX_AVATAR_BYTES` cap in helper before response; route catch → 502 |
| T-119-05-07 (SSH conn leak) | `finally { conn.end() }` in every REMOTE-branch code path; tests T12/T12b/T12c |
| T-119-05-08 (XSS via wrong Content-Type) | `Content-Type` hardcoded to `image/webp` (from `result.mime`, which is a literal type) |
| T-119-05-SC (package installs) | N/A — zero new dependencies |

No new threat surface introduced beyond what the threat model already registered. No `Threat Flags` section required.

## Known stubs

None. Every export is fully wired: the helper reads real file bytes (LOCAL) or SFTPs them (REMOTE), the route calls the real helper via the real host resolver + real SSH one-shot, and the frontend `<img>` tag (already shipped in Plan 119-03) will hit this endpoint the moment Wave-3+ integration lands.

## Self-Check: PASSED

- `src/backend/database/routes/apps.ts` — FOUND
- `src/backend/database/routes/apps.test.ts` — FOUND
- `src/backend/claude-session/identity-artifact-reader.read-app-icon.test.ts` — FOUND
- `.planning/phases/119-first-class-apps-campaign-shape-3-sidebar-apps-surface-new-c/deferred-items.md` — FOUND
- Commit `cf08a1a3` (RED test — helper) — FOUND
- Commit `fcb7ac0f` (GREEN feat — helper) — FOUND
- Commit `610a52e4` (RED test — route) — FOUND
- Commit `38f69d7f` (GREEN feat — route + mount) — FOUND
