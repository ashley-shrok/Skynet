# Phase 69 — Unbiased Code Review

**Reviewer:** general-purpose subagent (per /build skill convention)
**Date:** 2026-09-02
**Scope:** commits `8609be56..HEAD` (23 commits, five plans)

## Summary

Phase 69 executes the shape faithfully: roster elimination via disk fanout,
route rekey :id → :identityKey, birth + clone rewired to disk-only, DELETE +
share flows removed, table physically dropped via an idempotent boot migration.
Test coverage is thorough; TSC is clean; migration is safe. **One WARNING-level
security regression** appeared in the route rekey (69-02) — the PUT handler
now interpolates a URL-controlled `identityKey` into shell commands and
filesystem paths WITHOUT the IDENTITY_KEY_RE validation that previously
protected the flow through the DB-row lookup path. Not a blocker for ship
because the LOCAL branch would need a bind-mount attack surface and the REMOTE
branch is partially caught by `writeIdentityFile`'s inner guard, but it should
be closed with a two-line handler-side check before this reaches
term.gigaashley.click. Two INFO items round it out.

## Findings

### Critical (blocks ship)

None.

### Warning (should fix before ship)

**W1. PUT /identities/:identityKey — URL param feeds shell interpolation without pre-validation.**

- **Location:** `src/backend/database/routes/identities.ts:286` (PUT handler entry)
- **Regression source:** commit `4abfb27d` (69-02 GREEN)
- **What changed:** Pre-Phase-68 the URL param was `:id` (a nanoid PK) that
  was looked up in the DB; the code operated on the validated
  `row.identityKey`. Post-69-02, the URL param IS the identityKey and flows
  straight through:
  - L367: `readIdentityFile(conn, identityKey)` — this helper does NOT
    validate `identityKey` (its own comment at L436 says
    "identityKey is already validated by IDENTITY_KEY_RE — direct
    interpolation is safe"; that assumption was true when callers passed
    `row.identityKey`, but is no longer true).
  - L471: `writeIdentityFile(conn, identityKey, ...)` — validates in the
    REMOTE branch (L1781) but **NOT the LOCAL branch** (`path.join(root, identityKey, identityKey + ".md")` at L1773).
  - L498: `rm -f "$HOME/.claude/identities/${identityKey}/${identityKey}.${oldExt}"` — direct shell interpolation on REMOTE cleanup.
  - L514: `readIdentityFile` again (post-write re-read).
- **Concrete impact:** A caller with `PUT /identities/..%2Fetc%2Fpasswd`
  yields `req.params.identityKey = "../etc/passwd"`. LOCAL branch
  `path.join` composes a path that escapes the identities root; REMOTE
  branch's shell interpolation runs `cat "$HOME/.claude/identities/../etc/passwd/../etc/passwd.md"` etc.
- **Note on `identityKey.toLowerCase()`:** the handler does not lowercase
  the URL param, but the point stands — the permissive shape file
  `IDENTITY_KEY_RE = /^[a-z0-9._=/+-]+$/` (identities.ts:36) allows `..`
  even after lowercase, and the URL param never runs through *any* regex.
- **Fix (one liner at handler entry, mirrors identity-clone.ts:302):**
  ```typescript
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    return res.status(400).json({ error: "identityKey must match [a-z0-9._=/+-]+" });
  }
  ```
  or ideally use the **stricter** `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/`
  from `identity-artifact-reader.ts` (the local `identities.ts` regex
  admits `.`, `/`, `+`, `=` which is exactly what enables the traversal —
  `..` matches). The GET /:identityKey/avatar handler is already safe
  because `readAvatarSiblingFile` self-validates at L1621 (writing the
  comment at identities.ts:570 credits this protection accurately). PUT
  deserves the same treatment.
- **Auth-adjacent nuance:** all requests are already `authenticateJWT`,
  and the LOCAL-branch bind-mount is scoped to `IDENTITIES_HOST_DIR`, so
  the exploitable surface is limited to authenticated users reading /
  writing files under the container's mount. Still: a bounded surface is
  not a safe surface, and the PUT handler is a write path that could land
  attacker-controlled markdown bytes on disk outside the identities root.

### Info (nice-to-have, not blocking)

**I1. GET / fanout is not "every host the user has access to" — it's "every host in the caller-provided identityHosts map."**

- **Location:** `src/backend/database/routes/identities.ts:181-264` (GET / handler)
- **Shape file wording:** *"Skynet fans out to every host the logged-in user
  has access to, reads what identities live on each host's disk, and returns
  the merged view."*
- **Actual implementation:** fans out only to hosts present in
  `req.query.identityHosts`, which the frontend builds from
  `buildIdentityHostsFromFleet(getFleetSessionsSnapshot())`. Empty map
  short-circuits to `res.json([])` at L188-190.
- **Effect on the motivating bug:** A disk-only identity on a host that
  has ZERO active tmux identity-sessions will not appear in the list,
  because the frontend never puts that host in identityHosts. The bug
  Ashley cited *does* close for the common case (identity lives on a box
  that has at least one live identity-session — same box gets enumerated,
  identity is discovered by disk read). Edge case where a whole box has
  no live sessions but has disk-only identities is silently invisible.
- **Not a Phase 69 regression** — this is inherited from the Phase 66
  Plan 05 identityHosts map shape — but it means the shape's "every host
  the user has access to" language is aspirational, not literal.
  Documenting it as an INFO because the shape file's "would make it wrong"
  bar (*"if a fresh identity created directly on some box's disk still
  doesn't show up in Skynet's fleet list on next enumeration"*) is
  partially satisfied and partially deferred.

**I2. Local `IDENTITY_KEY_RE` in identities.ts is dead code AND diverges from the strict regex.**

- **Location:** `src/backend/database/routes/identities.ts:36`
- **Content:** `const IDENTITY_KEY_RE = /^[a-z0-9._=/+-]+$/;` — used only
  by the old POST / body-validation path, which is now a 410 stub. The
  constant is orphaned after 69-02.
- **Divergence:** The strict artifact-reader regex is
  `/^[a-z0-9_-]{1,64}$/` — this local one allows `.`, `/`, `+`, `=` and
  has no length bound. If W1 above is fixed by importing this local regex
  instead of the strict one, the fix would be ineffective against the
  path-traversal payload (`..` passes both `.` and length gates).
- **Recommendation:** Delete the local `IDENTITY_KEY_RE` constant, and if
  W1 is fixed with a runtime check, import `IDENTITY_KEY_RE` from
  `../../claude-session/identity-artifact-reader.js` — that's the
  authoritative shell-safety regex used by every other identity route.

## Positive observations

- **Migration (69-05) is genuinely idempotent + safe.** `DROP TABLE IF
  EXISTS` runs before an inline `forceSave` wrapped in try/catch;
  first-boot race where forceSave arrives before DatabaseSaveTrigger init
  is analyzed in the summary and correctly falls back to the existing
  `saveMemoryDatabaseToFile()` persistence path in
  `handlePostInitFileEncryption`. Tests 5-7 cover drop-when-present,
  idempotent-re-run, and legacy-5-col cascade. DLM daily snapshot remains
  the 7-day rollback path (unchanged).
- **Birth SSH probe (69-03) is injection-safe.** `opts.name` is gated by
  both `IDENTITY_KEY_RE` and the stricter `TMUX_SAFE_NAME_RE
  = /^[a-z][a-z0-9_-]*$/` before reaching the `[ -d "$HOME/.claude/identities/${opts.name}" ]` interpolation. No metachars can survive.
- **Clone (69-03) validates newName + sourceIdentityKey with the strict
  IDENTITY_KEY_RE** imported from identity-artifact-reader — the correct
  regex, at handler entry, before any SSH work.
- **GET / fanout error handling is well-layered:** per-key try/catch
  (skip one bad file), per-host try/catch (skip one dead box), outer
  try/catch (500 only on structural failure). One slow / dead box does
  not stall or 5xx the endpoint.
- **First-host-wins dedup on cross-host identityKey collision** is
  correctly implemented via a Set and iteration order preserved by
  `new Set(Object.values(identityHosts))`.
- **Frontend cascade (69-04) is thorough** — Task 4's grep audit
  (`identities.find(i.id === ...)` → 0 hits; `.identityId` → only type
  declarations and pass-throughs) is real and correct. TSC-enforced type
  narrowing removes any residual `id` access as a compile-time gate.
- **`encodeURIComponent(identityKey)`** in the frontend's `updateIdentity`
  correctly escapes `/`, `+`, `=` — Express + nginx decode transparently.
  The wire path is clean; the missing gate is entirely on the receiving
  handler.

## Files reviewed (sample)

- `/home/ubuntu/skynet-tina/.planning/shapes/shape-kill-identities-table.md`
- `/home/ubuntu/skynet-tina/.planning/phases/68-.../69-01-SUMMARY.md`
- `/home/ubuntu/skynet-tina/.planning/phases/68-.../69-02-SUMMARY.md`
- `/home/ubuntu/skynet-tina/.planning/phases/68-.../69-03-SUMMARY.md`
- `/home/ubuntu/skynet-tina/.planning/phases/68-.../69-04-SUMMARY.md`
- `/home/ubuntu/skynet-tina/.planning/phases/68-.../69-05-SUMMARY.md`
- `/home/ubuntu/skynet-tina/src/backend/database/routes/identities.ts`
- `/home/ubuntu/skynet-tina/src/backend/database/routes/identity-birth-orchestrator.ts`
- `/home/ubuntu/skynet-tina/src/backend/database/routes/identity-clone.ts`
- `/home/ubuntu/skynet-tina/src/backend/database/routes/identities.get-disk.test.ts`
- `/home/ubuntu/skynet-tina/src/backend/database/routes/identities.put-disk.test.ts`
- `/home/ubuntu/skynet-tina/src/backend/claude-session/identity-artifact-reader.ts`
- `/home/ubuntu/skynet-tina/src/backend/database/db/index.ts`
- `/home/ubuntu/skynet-tina/src/backend/database/db/schema.ts`
- `/home/ubuntu/skynet-tina/src/backend/database/db/index.migration.test.ts`
- `/home/ubuntu/skynet-tina/src/ui/api/identities-api.ts`
- `/home/ubuntu/skynet-tina/src/ui/state/identities-store.ts`

## REVIEW COMPLETE

**Verdict:** minor concerns — one WARNING-level security fix (add
`IDENTITY_KEY_RE.test` gate at PUT handler entry, ~2 lines) before ship
to term.gigaashley.click. Everything else is clean and shape-conformant.
