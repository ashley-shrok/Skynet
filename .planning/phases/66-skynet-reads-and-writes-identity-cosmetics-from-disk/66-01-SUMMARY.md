---
phase: 66-skynet-reads-and-writes-identity-cosmetics-from-disk
plan: 01
subsystem: identity-birth
tags: [birth, orchestrator, sftp, frontmatter, avatar, cosmetics]
dependency_graph:
  requires:
    - identity-artifact-reader.writeMarkdownFileAtomic (Phase 22 SRIC-02)
    - IDENTITY_KEY_RE, execWithTimeout, getLocalIdentitiesRoot helpers
    - identity-avatar-batch.getCandidateForBirth {bytes, mime}
  provides:
    - writeAvatarSiblingFile(conn, key, ext, bytes) SFTP+LOCAL binary writer
    - MIME_TO_AVATAR_EXT / AVATAR_EXT_VALUES / AvatarExt type
    - IDMEDIT_MAX_AVATAR_BYTES = 5MB DoS cap
    - buildIdentityFileBody() full-cosmetics frontmatter builder in orchestrator
    - BirthDeps.writeAvatarSiblingFile injected dep
  affects:
    - Every Skynet-born identity now lands on disk with the fleet's Phase A byte-shape
    - Plan 66-02 UPDATE will reuse writeAvatarSiblingFile for identity-modal edits
    - Plan 66-03 READ can consume the on-disk cosmetics that this plan writes
tech_stack:
  added: []
  patterns:
    - SFTP tmp+ext_openssh_rename atomic-overwrite (byte-for-byte mirror of writeMarkdownFileAtomic)
    - Absent-⇒-omit YAML emission (null / empty-string keys never appear as YAML null)
    - Ordered-pairs → Object.fromEntries → yaml.dump({sortKeys:false}) for role-first insertion order
    - Graceful partial recovery (avatar write is LAST call in Step 2.5; failure preserves .md + wakeups/ + handoff.md)
key_files:
  created: []
  modified:
    - src/backend/claude-session/identity-artifact-reader.ts
    - src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts
    - src/backend/database/routes/identity-birth-orchestrator.ts
    - src/backend/database/routes/identity-birth-orchestrator.test.ts
    - src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts
    - src/backend/database/routes/identity-birth.ts
    - src/backend/database/routes/identity-birth.test.ts
decisions:
  - yaml.dump options landed as {sortKeys:false, lineWidth:-1, noRefs:true, forceQuotes:false} — sortKeys:false preserves the [role, displayName, title, colorHue, voice, avatar] canonical insertion order that gives us post-Phase-A byte-shape parity on disk
  - image/jpeg → "jpg" (not "jpeg") in MIME_TO_AVATAR_EXT — matches Nelly's Phase A fleet-wide sibling-file convention
  - writeAvatarSiblingFile is a separate helper from writeMarkdownFileAtomic (not an overload) — kept the string-vs-buffer split so log tags stay grep-friendly (identity_markdown_write vs identity_avatar_write)
  - Avatar write runs LAST in Step 2.5, AFTER writeMarkdownFileAtomic — a failure leaves the identity folder in a partial state (.md + wakeups/ + handoff.md still on disk); re-birth is the recovery path, not a rollback we build (matches Ashley-locked "graceful partial recovery" design in the shape file)
  - Tests 12 + 17 (pre-existing) had regexes that asserted role was the ONLY frontmatter key — those were accidents of the pre-Phase-66 role-only design, not real invariants; loosened to assert only "role first" which is the invariant we DO want to pin going forward
metrics:
  duration_min: 25
  completed_date: 2026-09-01
requirements: []
---

# Phase 66 Plan 66-01: BIRTH — Skynet emits full cosmetics + avatar to disk

**One-liner:** Grew identity-birth Step 2.5 to emit displayName/title/colorHue/voice/avatar frontmatter (absent-⇒-omit) and land the uploaded avatar bytes as a sibling `<key>.<ext>` file via a new SFTP binary tmp+ext_openssh_rename writer.

## What shipped

**New public API in `identity-artifact-reader.ts`:**

- `writeAvatarSiblingFile(conn: SSHClient | null, identityKey: string, ext: AvatarExt, bytes: Buffer): Promise<void>` — SFTP-remote OR LOCAL-branch binary atomic writer. Guards: IDENTITY_KEY_RE + AVATAR_EXT_VALUES.includes(ext) + bytes.byteLength ≤ IDMEDIT_MAX_AVATAR_BYTES — all fire before touching the network / disk.
- `MIME_TO_AVATAR_EXT` — five-entry map (`image/webp→webp`, `image/png→png`, `image/jpeg→jpg`, `image/gif→gif`, `image/svg+xml→svg`).
- `AVATAR_EXT_VALUES` typed const tuple + `AvatarExt` type alias.
- `IDMEDIT_MAX_AVATAR_BYTES = 5_000_000` (5MB — headroom over multer's 2MB birth cap).
- Private helper `sftpWriteBinaryAtomic(conn, targetPath, bytes)` — byte-for-byte mirror of writeMarkdownFileAtomic's promise-wrap + ext_openssh_rename + try/finally sftp.end() + best-effort unlink cleanup, but for binary payloads with log tag `identity_avatar_write`.

**Grown `identity-birth-orchestrator.ts` Step 2.5:**

- New module-private `buildIdentityFileBody(opts, displayName, avatarFilename)` — ordered pairs array → yaml.dump → `---\n{yaml}---\n\n{SEED_COMMENT}\n\n# {name}\n`. Absent-⇒-omit for title (empty-after-trim), colorHue (null), voice (empty-after-trim).
- `birthCandidate` hoisted above `runStep(1)`; populated inside runStep(1) after the non-null guard so Step 2.5 can reuse `.mime` + `.bytes` without a second `getCandidateForBirth` call (would race with `consumeCandidateForBirth` cleanup).
- Step 2.5 now: derives `avatarExt` from `MIME_TO_AVATAR_EXT[cand.mime]` (throws "unsupported avatar mime for on-disk write" if unmapped, defense-in-depth) → builds full-cosmetics `identityFileBody` → `writeMarkdownFileAtomic(conn, path, body)` → `writeAvatarSiblingFile(conn, opts.name, avatarExt, cand.bytes)` (LAST call in Step 2.5, graceful-partial-recovery ordering).
- New `BirthDeps.writeAvatarSiblingFile` field (additive; existing tests unaffected).

**Wired in `identity-birth.ts`:**

- Import `writeAvatarSiblingFile` alongside existing `writeMarkdownFileAtomic`.
- BirthDeps assembly at L263 gains the passthrough.

## Tests

**New (10):**
- `identity-artifact-reader.remote-writes.test.ts` — 4 tests: Test A (ext_openssh_rename path + bytes round-trip), Test B (invalid identityKey), Test C (invalid ext), Test D (oversized payload).
- `identity-birth-orchestrator.role-frontmatter.test.ts` — 6 tests: Test 20 (all 6 keys emitted in canonical role-first order + js-yaml round-trip), Test 21 (absent-⇒-omit for title=""/colorHue=null/voice=null — only role+displayName+avatar survive), Test 22 (writeAvatarSiblingFile called ONCE with mime→ext=png), Test 23 (image/webp→"webp" and image/jpeg→"jpg" sub-cases), Test 24a (avatar throw surfaces as step:2:failed + Steps 3/4/5 never fire), Test 24b (call-order pin: mkdir+touch → writeMarkdownFileAtomic → writeAvatarSiblingFile).

**Pre-existing test fixture updates:**
- `identity-birth-orchestrator.test.ts` + `identity-birth.test.ts` vi.mock of identity-artifact-reader gains the new exports; makeDeps in both gains `writeAvatarSiblingFile: vi.fn().mockResolvedValue(undefined)`.
- `identity-birth.test.ts` Test 5 gains one new assertion for the new dep key.

**Scoped test result (final):**
```
Test Files  4 passed (4)
     Tests  62 passed (62)
```

## yaml.dump options landed + role-first preservation

Landed exactly as planned:
```ts
yaml.dump(Object.fromEntries(pairs), {
  sortKeys: false,    // preserve [role, displayName, title, colorHue, voice, avatar] insertion order
  lineWidth: -1,      // no wrapping — long titles/voice paths stay on one line for clean grep/diff
  noRefs: true,       // never emit &anchor / *alias for repeated values
  forceQuotes: false, // let yaml.dump decide per-value; auto-quotes colon-containing strings (T-66-01-04)
});
```

Role-first ordering is preserved by the `sortKeys:false` option combined with building the pairs array in canonical order and only pushing entries that pass the absent-⇒-omit check. Object.fromEntries preserves insertion order in Node ≥12.

## Surprises in js-yaml behavior around null/undefined omission

**None material.** The concern going in was whether yaml.dump might emit `title: null` or `title: ` for a null value. We sidestepped it entirely by filtering at the pairs-array construction stage — null/empty-after-trim values are never added to the map that yaml.dump sees. This is more explicit than relying on any yaml.dump "skip null" flag (which js-yaml doesn't have — it will happily emit `key: null` for `{key: null}`).

Verified via a manual sanity check exactly matching the plan's done criterion:
```
opts = {name:"nyla", title:"Test", colorHue:220, voice:null}
→ yaml.load(body) = {role, displayName:"Nyla", title:"Test", colorHue:220, avatar:"nyla.png"}
```
No voice key, no title:null. Role first.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] Pre-existing Tests 12 + 17 in role-frontmatter.test.ts had assertions incompatible with the plan's core change**

- **Found during:** Task 2 GREEN verification (`npx vitest run` after implementation)
- **Issue:** Test 12 asserted `contents.match(/^---\r?\nrole: box-maintainer\r?\n---/)` and Test 17 asserted `contents.startsWith("---\nrole: box-maintainer\n---")`. Both encoded "role is the ONLY frontmatter key" — an accident of the pre-Phase-66 role-only design, not a real invariant. Plan grew the frontmatter to include displayName/title/colorHue/voice/avatar after role, so both assertions became structurally impossible to satisfy.
- **Plan said:** "Pre-existing Tests 11-19 all green (no assertion drift; makeDeps addition purely additive)." That claim was inconsistent with the plan's core body-shape change. Choosing between "let two tests fail" and "adjust two assertions to pin the actual invariant" — the latter is clearly correct.
- **Fix:** Loosened both to pin the invariant we DO want: "role is FIRST" (rather than "role is the only key"). Test 12 regex changed to `/^---\r?\nrole: box-maintainer\r?\n/` (role appears immediately after opening `---` — nothing said about what follows). Test 17 gained a two-part check: `startsWith("---\nrole: box-maintainer\n")` for role-first, plus `toMatch(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)` for frontmatter-block-closes-properly. Semantic intent preserved (role-first, seed comment present, heading present).
- **Files modified:** `src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts`
- **Commit:** `c26cd6f0`

**2. [Rule 3 — Blocking] identity-birth-orchestrator.test.ts + identity-birth.test.ts vi.mock of identity-artifact-reader was missing new exports**

- **Found during:** Task 2 GREEN verification (11 pre-existing tests started failing at step 3/4/5)
- **Issue:** The orchestrator now imports `MIME_TO_AVATAR_EXT` from identity-artifact-reader. Both peer test files vi.mock that module with only `isLocalHostId + writeMarkdownFileAtomic`. Without the new exports in the mock, the orchestrator's Step 2.5 `MIME_TO_AVATAR_EXT[cand.mime]` returned `undefined` → the "unsupported avatar mime" throw fired → step 2 failed → step 3 never ran → 11 tests that assert step 3+ behavior failed.
- **Fix:** Extended the vi.mock in both test files to also export `writeAvatarSiblingFile: vi.fn().mockResolvedValue(undefined)`, `MIME_TO_AVATAR_EXT` (5-entry map), `AVATAR_EXT_VALUES`, `IDMEDIT_MAX_AVATAR_BYTES`. Also added `writeAvatarSiblingFile` to both files' `makeDeps()` defaults per plan spec (which planned for the .role-frontmatter.test.ts file but implicitly requires the same in .test.ts).
- **Files modified:** `src/backend/database/routes/identity-birth-orchestrator.test.ts`, `src/backend/database/routes/identity-birth.test.ts`
- **Commit:** `c26cd6f0`

## Authentication gates

None. Fully autonomous scoped execution.

## Commits

- `22de3b5f` test(66-01): RED — writeAvatarSiblingFile REMOTE-branch atomic-rename tests
- `c51c2107` feat(66-01): GREEN — writeAvatarSiblingFile SFTP binary atomic writer
- `a2ac3ae6` test(66-01): RED — full-cosmetics frontmatter + avatar-sibling write tests
- `c26cd6f0` feat(66-01): GREEN — Step 2.5 emits full cosmetics + writes avatar sibling

TDD gate compliance: RED and GREEN commits present for both tasks in strict alternating order.

## Self-Check: PASSED

Files created/modified verified present:
- FOUND: /home/ubuntu/skynet-tina/src/backend/claude-session/identity-artifact-reader.ts (contains `writeAvatarSiblingFile`, `MIME_TO_AVATAR_EXT`, `sftpWriteBinaryAtomic`, `IDMEDIT_MAX_AVATAR_BYTES`)
- FOUND: /home/ubuntu/skynet-tina/src/backend/claude-session/identity-artifact-reader.remote-writes.test.ts (contains `describe("writeAvatarSiblingFile — REMOTE branch atomic-rename API"`)
- FOUND: /home/ubuntu/skynet-tina/src/backend/database/routes/identity-birth-orchestrator.ts (contains `buildIdentityFileBody`, `writeAvatarSiblingFile` dep in BirthDeps)
- FOUND: /home/ubuntu/skynet-tina/src/backend/database/routes/identity-birth.ts (contains `writeAvatarSiblingFile` import + BirthDeps wiring)
- FOUND: /home/ubuntu/skynet-tina/src/backend/database/routes/identity-birth-orchestrator.role-frontmatter.test.ts (contains Tests 20-24)

Commits verified in git log:
- FOUND: 22de3b5f
- FOUND: c51c2107
- FOUND: a2ac3ae6
- FOUND: c26cd6f0
