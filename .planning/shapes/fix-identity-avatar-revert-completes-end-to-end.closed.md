# fix — identity-avatar-revert-completes-end-to-end

Phase 86 follow-up (bounty of the same slug). Small backend patch closing the
avatar-revert shape gap flagged by Phase 86's /close conformance review.

## Observed wrong behavior

Clicking Revert on the avatar field in IdentityModal sends `meta.avatar = null`
in the multipart PUT to `/identities/:key`, but the backend PUT handler's
`IdentityMetadata` type omits the `avatar` field. The `JSON.parse` pass-through
silently drops the unknown key, no branch of the overlay logic ever sees
`meta.avatar === null`, and the identity's `avatar:` frontmatter key + sibling
avatar file on disk are left untouched. The wearer continues to see their old
identity-scope avatar even though the UI reported success — the affordance is
wire-only. To actually shed the override, the wearer must hand-edit their
identity file.

## Correct behavior after fix

Clicking Revert → the backend deletes the identity's `avatar:` frontmatter key
AND hard-deletes the identity's sibling avatar file on disk. Subsequent
`GET /identities` returns the identity showing the role's avatar (via Phase
86's Plan 86-01 role-folder fallback in `GET /:key/avatar`). The affordance is
end-to-end; no hand-editing required.

Idempotency: a Revert click on an identity that already has no avatar override
is a safe no-op — the frontmatter key delete on an absent key is a no-op, and
the sibling file unlink is best-effort (missing file is fine, matching the
existing ext-swap cleanup pattern at identities.ts:634-651).

## Suspected files

- `src/backend/database/routes/identities.ts` — extend `IdentityMetadata` type
  (L58-70) to include `avatar?: string | null`; add a null-delete branch in
  the overlay logic (after L595, matching the title/voice/colorHue pattern);
  when the branch triggers AND `oldAvatar` was captured (L570-576), hard-delete
  the sibling file using the same local/SSH pattern as the ext-swap cleanup
  (L634-651).
- `src/backend/database/routes/identities.put-disk.test.ts` — colocated test
  for the null-avatar delete path: identity with avatar override →
  `PUT /identities/:key` with `meta.avatar=null` → frontmatter `avatar:` key
  gone + sibling file removed + response echoes role's avatar.
- `src/ui/features/pretty-view/IdentityModal.tsx` — remove the stale
  "backend does not support this yet, wire-only" comment at L1373-1387; the
  wire will complete end-to-end after this fix.

## Vehicle

`/gsd:quick` — one type widening + one overlay branch + one filesystem-delete
using an existing pattern + one colocated test + one frontend comment sweep.
Bigger than a genuine one-liner (touches backend logic with cross-branch
behavior), well below phase size. TDD: RED first (test asserts key + file gone
after PUT-null), then GREEN.

## Done condition (fix-mode close check)

- Scoped `npx vitest run src/backend/database/routes/identities.put-disk.test.ts`
  passes with the new test case green (RED-then-GREEN evidence in commit log).
- Grep confirms no other test regressed under identities.* scope.
- IdentityModal.tsx stale comment removed.
- No changes outside the three files named above.

## Ship policy

Push-only. Batches into the UX-pass campaign ship gate with the other 7
completed bounties per Alice 2026-09-07. No docker build, no `docker cp`,
no `--force-recreate`, no deploy this session.

---

## Close-Out — 2026-09-09

**Change made:** `/gsd:quick 260909-dls` — three atomic commits on `feat/tab-title-from-tmux`:

- `435094e7` — RED: `identities.put-disk.test.ts` gains Test 12 (three sub-cases 12a LOCAL / 12b REMOTE / 12c idempotent no-op). `vi.hoisted()` fsUnlinkSpy added to intercept `node:fs/promises.unlink`. Failing pre-impl as expected.
- `0fcbd570` — GREEN: `identities.ts` gets three surgical edits — (a) `IdentityMetadata` widened with `avatar?: string | null`; (b) null-delete overlay branch after voice, matching title/voice/colorHue pattern; (c) post-`writeIdentityFile` sibling-file unlink block using `oldAvatar` verbatim (LOCAL `fs.unlink().catch(() => {})` / REMOTE `execCommand rm -f -H "$HOME/…".catch(() => {})`). Ordering intentional: frontmatter delete persists first, sibling unlink second — a mid-motion crash leaves an orphaned sibling file whose readers correctly fall back to the role's avatar via Phase 86 Plan 86-01, so the invariant holds. Task 3's stale-comment sweep in `IdentityModal.tsx:1373-1384` folded into this commit.
- `c1029e7b` — docs: quick-task SUMMARY.md.

**Test evidence:** `npx vitest run src/backend/database/routes/identities.put-disk.test.ts src/backend/database/routes/identities.get-disk.test.ts` → 45/45 passed (14 put-disk incl. new 12a/12b/12c, 31 get-disk, zero regressions). `npm run build:backend` → clean.

**Files touched:** exactly the three named in Suspected Files, no scope creep.

**done:** click-Revert on avatar in IdentityModal now deletes the identity's frontmatter `avatar:` key + sibling file end-to-end; wearer sees the role's avatar via existing Phase 86 fallback; idempotent no-op on identities already without an override.

**Deploy policy:** push-only per campaign discipline. Awaits Alice's push greenlight; batches with UX-pass campaign ship gate.
