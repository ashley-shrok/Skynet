---
phase: 66-skynet-reads-and-writes-identity-cosmetics-from-disk
plan: 03
subsystem: identities-api
tags: [read, get, disk-derived, cosmetics, safe-defaults, publicIdentity, avatar, artifact-reader]
dependency_graph:
  requires:
    - identity-artifact-reader.readIdentityFile (Phase 18 / R3 patch #92)
    - identity-artifact-reader.sftpReadFile private helper (Phase 18)
    - identity-artifact-reader.getLocalIdentitiesRoot, IDENTITY_KEY_RE, execWithTimeout
    - identity-artifact-reader.IDMEDIT_MAX_AVATAR_BYTES + AVATAR_EXT_VALUES + AvatarExt (Plan 66-01)
    - ssh-one-shot.connectOneShot (5s timeout for GET / lazy fanout)
    - host-resolver.resolveHostById (userId-scoped hostId lookup)
    - crypto.createHash (per-response ETag md5)
  provides:
    - readAvatarSiblingFile(conn, identityKey) → {bytes, mime, ext} | null
    - extractCosmeticsFromFrontmatter(markdown) → {displayName?, title?, colorHue?, voice?, avatar?}
    - AVATAR_MIME_FROM_EXT inverse of MIME_TO_AVATAR_EXT
    - publicIdentity() safe-defaults contract (capitalizeFirst(identityKey); "" for avatarMime/etag; null for title/colorHue/voice)
    - Flipped GET /identities disk-derivation with per-request identityHosts query
    - Flipped GET /identities/:id/avatar disk-read with required hostId query
    - listIdentities(identityHosts?) widened frontend API surface + avatarUrlWithHost helper
  affects:
    - Every render surface pulling cosmetics from GET /identities now flows through disk (or safe-defaults during Plan 03→05 transition window)
    - Plan 05 (Wave 3) consumes this plan's identityHosts wire contract; wires populated map from conversation-store fleetSessions
    - Plan 04 (migration drop-column) unblocked once Plan 05 lands the frontend fetchOnce populated call
tech_stack:
  added: []
  patterns:
    - Per-request per-identity lazy disk-fetch via Promise.all (bounds wall-clock; O(their-identity-count) cost)
    - Frontmatter-authoritative avatar ext discovery, with LOCAL fs cascade / REMOTE ls-and-basename fallback
    - Silent-swallow safe-defaults degradation (accept-the-ugly-render per shape) scoped to individual rows, not endpoint
    - publicIdentity() overlay pattern: absent-in-overlay → safe-default per-field (mirrors frontend withDisplayCap)
    - Per-response ETag (createHash md5) — HTTP cache-validation, NOT server-side caching (shape-compliant per W6)
key_files:
  created:
    - src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts
    - src/backend/database/routes/identities.get-disk.test.ts
    - .planning/phases/66-skynet-reads-and-writes-identity-cosmetics-from-disk/66-03-SUMMARY.md
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/database/routes/identities.ts
    - src/ui/api/identities-api.ts
    - src/ui/state/identities-store.ts
decisions:
  - identityHosts is CALLER-SCOPED and passed as a URL-encoded JSON query param — no fleet-walk, no per-user hostId registry on the server. Empty map = zero SSH cost. Plan 05 rewires fetchOnce to pass populated map from conversation-store fleetSessions (matches CONTEXT open question 1 lean toward per-user lazy fetch).
  - publicIdentity() safe-defaults MOVED FROM PLAN 05 to Plan 03 per checker B2 co-locate with the READ flip that creates the null-cosmetics scenario. displayName = capitalizeFirst(identityKey); title/colorHue/voice = null; avatarMime/avatarEtag = "" — satisfies the frontend Identity type's non-nullable-string contract without widening the type.
  - Per-response ETag on GET /:id/avatar uses createHash("md5") on the freshly-read disk bytes — HTTP cache-validation is distinct from server-side cosmetics caching. The shape file's "no cache" rule targets the latter; per-response ETags are compatible (inline comment at the ETag computation site documents this per W9→W6 semantic note).
  - Frontmatter is AUTHORITATIVE for avatar ext discovery when present — if <key>.md declares `avatar: <key>.<ext>`, that ext wins over the cascade. Falls through to ls (REMOTE) or per-ext fs.readFile cascade (LOCAL) when frontmatter is absent OR names a non-existent file (stale-frontmatter recovery).
  - Empty markdown (readIdentityFile returned "") is treated as "no cosmetics" (safe-defaults), NOT as an error, in the GET / flow. Consistent with the shape's per-row degradation model and Test 3 unreachable-test-fixture semantics.
  - REMOTE branch REMOTE ls uses bash brace expansion for single round-trip discovery of the sibling avatar file — chosen over 5 sequential SFTP-stat calls (5x round-trips) because fleet standard hosts have bash + xargs available. IDENTITY_KEY_RE-validated identityKey makes direct interpolation shell-safe (same pattern as readIdentityFile at L440).
  - The pre-flip GET /identities role parameter (which always returned null anyway per patch #92 note) is retained on the publicIdentity signature for backward compat but always passes null — role is authoritative from /sessions/list, not from this route (unchanged from pre-flip behavior).
  - 5s connectOneShot timeout for GET / lazy fanout (vs PUT's 30s) — READ latency budget is tighter (rendering blocks on this endpoint); a single unreachable box should degrade to safe-defaults within 5s per row so the endpoint returns within reasonable wall-clock even with fleet-scale identities.
metrics:
  duration_min: 25
  completed_date: 2026-09-01
requirements: []
---

# Phase 66 Plan 66-03: READ — disk-derived cosmetics flip + publicIdentity safe-defaults Summary

**One-liner:** Flipped GET /identities to per-request lazy disk-derivation of cosmetics via caller-scoped identityHosts map + rewrote GET /:id/avatar to read sibling avatar file via new readAvatarSiblingFile helper + moved publicIdentity() safe-defaults (capitalizeFirst(identityKey); non-nullable "" strings) here from Plan 05 per checker B2 so the null-cosmetics scenarios are contract-safe from the moment the flip lands.

## What shipped

**New public API in `identity-artifact-reader.ts` (section 6c):**

- `AVATAR_MIME_FROM_EXT: Record<AvatarExt, string>` — inverse of MIME_TO_AVATAR_EXT (Plan 01): `{ webp:"image/webp", png:"image/png", jpg:"image/jpeg", gif:"image/gif", svg:"image/svg+xml" }`. Used by GET /:id/avatar Content-Type header derivation.
- `extractCosmeticsFromFrontmatter(markdown) → { displayName?, title?, colorHue?, voice?, avatar? }` — parses top-of-file `---...---` block via the same regex used by extractRoleFromMarkdown. yaml.load wrapped in try/catch (malformed → `{}`). Each field type-narrowed: strings must be non-empty; colorHue must be number in [0,359]. Anything failing its gate is DROPPED (not defaulted).
- `readAvatarSiblingFile(conn, identityKey) → { bytes, mime, ext } | null` — LOCAL branch cascades through AVATAR_EXT_VALUES = [webp,png,jpg,gif,svg] via fs.readFile per-ext; REMOTE branch uses single-round-trip `ls "$HOME/.claude/identities/<key>/"<key>".{webp,png,jpg,gif,svg}" 2>/dev/null | head -n1 | xargs -r basename` + SFTP-read via existing sftpReadFile helper. Frontmatter's `avatar: <key>.<ext>` is AUTHORITATIVE when present. Guards: IDENTITY_KEY_RE + IDMEDIT_MAX_AVATAR_BYTES cap. Returns null on no-sibling-exists; throws on SSH errors / invalid identityKey / cap violation.

**Rewritten `identities.ts` handlers:**

- **GET /identities** now accepts optional `identityHosts` query param (URL-encoded JSON `{ identityKey: hostId }`). Per-row parallel fetch via `Promise.all` (semantically Promise.allSettled — inner try/catch swallows per-row failures). For each row: if identityKey NOT in map → publicIdentity(row, {}) safe-defaults; if IN map → connectOneShot (REMOTE) or conn=null (LOCAL) → readIdentityFile → extractCosmeticsFromFrontmatter → publicIdentity(row, cos) overlay. Timeout is 5s per connect. ANY per-row error (unreachable / missing / malformed / connectOneShot fail) yields safe-defaults for that row; endpoint NEVER errors 5xx due to a per-row failure.
- **GET /identities/:id/avatar** now accepts required `hostId=<n>` query. Reads sibling via readAvatarSiblingFile. Null result → 404 `no avatar on disk for this identity`. SSH throw → 502 `identity home box unreachable`. Missing/invalid hostId → 400. LOCAL branch skips connectOneShot entirely. Per-response ETag = `"disk-<md5>"` (createHash on the disk bytes). Content-Type derives from readResult.mime.
- **`publicIdentity()`** signature widened to accept optional `cosmetics` overlay (moved from Plan 05 per B2). `capitalizeFirst()` helper added (mirrors frontend withDisplayCap). Emits: `displayName = cosmetics.displayName ?? capitalizeFirst(row.identityKey)`, `title = cosmetics.title ?? null`, `colorHue = cosmetics.colorHue ?? null`, `voice = cosmetics.voice ?? null`, `avatarMime = cosmetics.avatarMime ?? ""`, `avatarEtag = cosmetics.avatarEtag ?? ""`. Non-nullable-string fields satisfy the frontend Identity type contract via "" safe-defaults; nullable fields (title/colorHue/voice) stay null when disk-overlay absent.

**Frontend widening — `identities-api.ts`:**

- `listIdentities(identityHosts?)` signature widened; default `{}` matches the transition-window semantic. Populated call passes URL-encoded JSON as query param.
- New exported `avatarUrlWithHost(identity, hostId): string` helper for Plan 05 consumers that need to thread hostId through avatar URL fetches.

**Frontend caller — `identities-store.ts`:**

- `fetchOnce()` updated to pass `{}` to listIdentities. Documented as transition-window semantic; Plan 05 rewires this call site to pass a populated map derived from conversation-store fleetSessions.

## Tests

**New (20):**
- `identity-artifact-reader.avatar-read.test.ts` — 12 tests:
  - Test A: LOCAL sibling exists as tina.png (no frontmatter) → cascade finds png
  - Test B: LOCAL, no sibling exists → null
  - Test C: LOCAL, frontmatter names tina.webp → webp result (frontmatter authoritative)
  - Test D: REMOTE ls returns tina.webp → SFTP-read yields webp
  - Test E: REMOTE ls empty → null
  - Test F: extractCosmeticsFromFrontmatter all 5 keys present
  - Test G: malformed YAML → {}
  - Test H: colorHue out-of-range (400) → colorHue omitted
  - Test I: explicit YAML null title → title omitted
  - Test J: invalid identityKey throws
  - AVATAR_MIME_FROM_EXT sanity: all 5 canonical extensions
  - IDMEDIT_MAX_AVATAR_BYTES sanity: 5_000_000
- `identities.get-disk.test.ts` — 8 tests:
  - Test 1: happy path GET / — mixed disk-overlay + capitalizeFirst safe-defaults for row not in identityHosts
  - Test 2: nelly connectOneShot rejects → per-row safe-defaults, tina still overlays, endpoint 200
  - Test 3: unreachable-test-fixture (empty markdown) → safe-defaults for that row; 200 (per B2 — asserts capitalizeFirst("unreachable-test") = "Unreachable-test", avatarMime="", avatarEtag="")
  - Test 4: GET /:id/avatar happy path — 200 + Content-Type + body bytes
  - Test 5: GET /:id/avatar disk-empty → 404
  - Test 6: GET /:id/avatar SSH-fail → 502
  - Test 7: GET /:id/avatar missing hostId query → 400
  - Test 8: GET /:id/avatar LOCAL branch → connectOneShot NEVER called

**Zero regression to (verified with scoped run):**
- `identities.put-disk.test.ts` (10/10)
- `identity-artifact-reader.remote-writes.test.ts` (7/7)
- `identities-api.test.ts` (8/8)

**Scoped test result (final):**
```
Test Files  5 passed (5)
     Tests  45 passed (45)
```

## The identityHosts caller-scoped design (rationale)

The plan's core wire-shape decision was WHERE the identityKey→hostId map lives. Two options:

1. **Server-side registry** — Skynet maintains a per-user table of "which host each identity lives on." GET /identities fanout iterates all identities and reads cosmetics from each host. Pro: single-round-trip for the caller. Con: this table has no source of truth on Skynet (each identity's home box is only knowable via /sessions/list which live-queries the fleet); we'd be duplicating fleet knowledge into a server-side cache, which the shape file explicitly forbids ("Skynet quietly holds a cache is WRONG").

2. **Caller-scoped map (chosen)** — GET /identities accepts an optional identityHosts query param. The frontend caller (which already renders per-identity UI with hostId context from conversation-store fleetSessions) passes the map. Server does per-row parallel lazy-fetch on ONLY the identities the caller cares about. Cost is O(identities-in-caller-map), not O(fleet). Empty map = zero SSH cost.

Option 2 wins on the shape rule and on cost. The tradeoff is a wider client contract — Plan 05 (Wave 3) is the twin plan that rewires the frontend caller to pass a populated map derived from fleetSessions.

## The publicIdentity safe-defaults contract (moved from Plan 05 per B2)

The frontend Identity type (src/ui/api/identities-api.ts L3-16) declares displayName, avatarMime, and avatarEtag as non-nullable strings. Pre-flip, these values always came from the store (which required them at write-time — POST /identities validates displayName as non-empty and computes an avatarEtag from the uploaded bytes). Post-flip, they come from disk overlay — but the overlay can be ABSENT (transition window; unreachable box; missing frontmatter). Two options:

1. **Widen the Identity type to nullable** — every render surface consuming these fields has to handle null. Big blast radius (IdentityBadge, IdentityModal, SessionRow, PrettyConversationRow, ChatMessage, and more).

2. **Emit safe-defaults from publicIdentity() so the wire type stays satisfied (chosen)** — `displayName = capitalizeFirst(identityKey)` (matches frontend withDisplayCap); `avatarMime = ""` and `avatarEtag = ""` (satisfy the non-nullable-string contract; consumers see empty-string as "no avatar" via existing truthiness checks). Nullable fields (title/colorHue/voice) stay null when overlay absent.

Option 2 keeps the type contract stable. Checker B2 moved this from Plan 05 into Plan 03 because the READ flip is what CREATES the null-cosmetics scenario — co-locating the safe-defaults with the READ flip means Plan 03's own tests exercise the safe-defaults path (Tests 1, 2, 3), rather than testing them in Plan 05 after they've been "in production" for a plan.

## Plan 05 is the twin plan

Plan 05 (Wave 3) depends on this plan (Wave 2). Plan 05's scope:

1. **Populate identityHosts** — rewrite `identities-store.ts fetchOnce` to derive `Record<identityKey, hostId>` from conversation-store fleetSessions and pass it to `listIdentities(hosts)`. So first-render cosmetics come back populated from disk, not as safe-defaults.
2. **Thread hostId into avatarUrl consumers** — the flipped GET /:id/avatar requires `?hostId=<n>`; every consumer (IdentityBadge, IdentityModal DialogHeader avatar, SessionRow, chat surfaces) needs to append it. `avatarUrlWithHost(identity, hostId)` helper (shipped in this plan) is the consumption idiom.

Between "Plan 03 lands" (right now) and "Plan 05 lands" the frontend renders with safe-default cosmetics on every identity (capitalizeFirst names, no avatars, gray backgrounds). Ashley greenlit this as "accept the ugly render" per shape file open question 4.

## Confirmation: GET /:id/avatar's ETag is per-response, NOT stored (W6)

Inline comment at the ETag computation site (src/backend/database/routes/identities.ts around L671):

```
// ETag is per-response, not stored server-side. Browser-side
// revalidation via If-None-Match is standard HTTP cache-validation
// — the shape file's "no cache" clause targets server-side
// cosmetics caching (Skynet holding a copy of the disk values),
// NOT HTTP cache-validation. Per-response etag is compatible with
// the shape rule (per W6).
```

`createHash("md5").update(readResult.bytes).digest("hex")` runs per-request against the freshly-read disk bytes. There is NO Skynet-side storage of prior etags or bytes. If-None-Match short-circuiting saves the browser a full-body download on unchanged bytes but never affects the disk-read cost — the disk read fires unconditionally at the top of the handler.

## Deviations from Plan

None. Plan executed as specified. The single minor variation:

- The plan's Task 2 (a) called for `Promise.allSettled` to bound wall-clock. Implementation uses `Promise.all` with per-row try/catch — semantically equivalent (per-row errors are caught internally and return safe-defaults publicIdentity; Promise.all only rejects if a synchronous handler throws outside the try/catch, which none do). Test 2 (nelly connectOneShot rejects) verified this equivalence: response 200 with tina + nelly rows, nelly with safe-defaults.

## Authentication gates

None. Fully autonomous scoped execution.

## Commits

- `f67916a0` test(66-03): RED — readAvatarSiblingFile + extractCosmeticsFromFrontmatter unit tests
- `b96bfda6` feat(66-03): GREEN — readAvatarSiblingFile + extractCosmeticsFromFrontmatter + AVATAR_MIME_FROM_EXT
- `501787d1` test(66-03): RED — GET /identities + GET /:id/avatar disk-derived contract
- `95d49213` feat(66-03): GREEN — GET /identities + GET /:id/avatar disk-derived + publicIdentity safe-defaults

TDD gate compliance: RED (test-only) commit precedes GREEN (feat) commit for each of the two tasks, in strict alternating order.

## Self-Check: PASSED

Files created/modified verified present on disk:

- FOUND: /home/ubuntu/skynet-tina/src/backend/claude-session/identity-artifact-reader.ts (contains `readAvatarSiblingFile`, `extractCosmeticsFromFrontmatter`, `AVATAR_MIME_FROM_EXT`)
- FOUND: /home/ubuntu/skynet-tina/src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts (contains `describe("readAvatarSiblingFile — LOCAL branch`)
- FOUND: /home/ubuntu/skynet-tina/src/backend/database/routes/identities.ts (contains `capitalizeFirst`, `parseIdentityHosts`, `readAvatarSiblingFile` import + call, `extractCosmeticsFromFrontmatter` import + call; no `row.displayName/title/colorHue/voice/avatarData/avatarMime/avatarEtag` reads in GET handlers)
- FOUND: /home/ubuntu/skynet-tina/src/backend/database/routes/identities.get-disk.test.ts (contains `describe("GET /identities — disk-derived cosmetics`)
- FOUND: /home/ubuntu/skynet-tina/src/ui/api/identities-api.ts (contains `listIdentities(identityHosts` widened signature + `avatarUrlWithHost` helper)
- FOUND: /home/ubuntu/skynet-tina/src/ui/state/identities-store.ts (fetchOnce passes `{}` to listIdentities)

Commits verified in git log:

- FOUND: f67916a0
- FOUND: b96bfda6
- FOUND: 501787d1
- FOUND: 95d49213

Scoped test result (final):
```
Test Files  5 passed (5)
     Tests  45 passed (45)
```
