# Phase 88: Relay-mediated group conversations sub-slice A — human relay identities as first-class - Context

**Gathered:** 2026-09-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Every Skynet user gets a durable Matrix relay identity, provisioned by Skynet itself at the moment the user is created. "Has a relay identity" means both halves together: the Matrix account actually exists on the Synapse homeserver, AND the association between the Skynet user and that account is stored in Skynet's own database. Skynet owns the whole creation motion for both halves; nothing about it depends on the human having done anything themselves.

Slice A is pure infrastructure — nothing user-visible ships in this slice. All visible behavior (creating a relay session, seeing bubbles in a pane, participating in a group room) arrives in later sub-slices of the parent arc.

**Scope anchor:** slice A ONLY touches user-creation and user-deletion paths (plus a small localpart-sanitizer helper). It does NOT touch runtime send/receive paths, does NOT add user-visible UI, does NOT change Telegram-bridge behavior, and does NOT touch agent identity provisioning.

</domain>

<decisions>
## Implementation Decisions

All 8 decisions below were walked one-at-a-time with Ashley during the `/open` conversation for this shape (2026-09-08). Each one was greenlit `thumbs up` before advancing.

### Slice scoping

- **D-01: Skip the discovery-first act.** The seed shape opened with "figure out what exists in Skynet today for per-user relay credentials, then promote to first-class." Codebase reading during `/open` proved the promotion is already done — `users.mxid` is a first-class column landed in Phase 75, `matrix_admin_creds` is a live singleton, and the two Synapse admin primitives (`createOrUpdateUser` + `loginAsUser`) are already wired and exercised. The real gap is eager provisioning at user-create time, not promotion.

- **D-02: No backfill code in this slice.** Existing users without mxids get hand-migrated by the maintainer of each Skynet instance (Taylor on t1000, Stacy on T800) as part of upgrading Skynet on that box. Slice A ships zero backfill/sweep code. Legacy users (Ashley, Zoey, Laura on t1000) — who ALREADY have mxids from the pre-existing one-shot import — are not touched at all.

### Create-flow provisioning

- **D-03: Skynet mints the whole account, not just the association.** Today's `POST /users/:id/mxid` admin endpoint takes a caller-supplied mxid string and just associates it with a Skynet user row (assuming the Matrix account was registered elsewhere). Under slice A, the create flow both picks the mxid AND mints the Matrix account for that mxid via the admin API, then populates `users.mxid` with what it just minted. Slice A does NOT rework the existing `POST /users/:id/mxid` endpoint — that endpoint remains for its current use case (admin manually associating a pre-existing mxid).

- **D-04: Refuse account creation if Synapse can't be reached.** Synapse is a hard dependency and runs on the same box as Skynet in every current deployment. If the mint call fails (homeserver unreachable, mint returned non-2xx), the whole create request returns an error and no user row is created. This is symmetric-with-hard-dep — coupling user creation to relay availability is acceptable given the co-located deployment.

- **D-05: Mint FIRST, then insert.** Ordering matters. Mint the Matrix account via the admin API first; if it succeeds, then run the existing avatar-write + row-INSERT sequence. Reason: the admin mint is idempotent (a retry with the same identifier upserts harmlessly), so on later-step failure the Matrix account is not "leaked" in a harmful way — a subsequent successful create attempt with the same username re-mints (upsert) and picks up cleanly. Rollback path for later-step failures is a planner concern; the existing create-flow already rolls back avatar file + row on encryption-setup failure, and the same rollback should extend to also deactivating the just-minted Matrix account.

### Identifier shape

- **D-06: mxid format is `@<sanitized-username>_human:<server_name>`.** The `_human` suffix separates humans from agents in the same homeserver namespace (agents get no suffix). Legacy identifiers without the suffix (Ashley, Zoey, Laura) continue to work indefinitely — the suffix is convention going forward, not a schema-enforced correctness requirement.

- **D-07: Username → mxid sanitization is a bijective escape.** Per Synapse's localpart grammar `[a-z0-9._=/+-]`, disallowed characters escape to unique multi-char sequences. Table: `_` → `__`, `@` → `_at_`, `.` → `_dot_`, and analogous escapes for other rejected characters. Bijective (escape-the-escape ensures a literal `_at_` in a username cannot be confused with the escape sequence), deterministic (same input always same output), collision-free across any valid Skynet username. The common case stays clean (`ashley` → `@ashley_human:...`); the T800 case where a user's username is an email (`ashley@aitherhealth.com`) yields a longer-but-readable identifier (`@ashley_at_aitherhealth_dot_com_human:...`).

  Motivating context: on the T800 Skynet deployment (Aither Health), users may sign in with their corporate email address as their Skynet username. That must land as a valid Matrix identifier without collision.

### Password handling

- **D-08: Skynet-generated password, discarded on the spot.** At mint time, generate a random password (per existing agent-birth convention: `randomBytes(24).toString('base64')` or similar), pass to `createOrUpdateUser`, and discard immediately after the mint returns success. The password is never stored anywhere — not in Skynet's DB, not on disk, not in any human's possession. Skynet only ever needs to mint access tokens for this account going forward, and the `loginAsUser` admin primitive uses admin auth (not the account's password) to do that.

  Consequence: humans cannot log in to Element or any other Matrix client as themselves. Every relay-side action they take is mediated by Skynet's backend on their behalf. This is the intended model — the schema comment claiming "human relay creds are owned by the human" is a legacy artifact from the pre-provisioning era and gets updated as part of slice A's housekeeping.

### Delete-flow deactivation

- **D-09: On any Skynet-user-delete path, if `users.mxid` is populated, call Synapse admin to deactivate that account.** Wired into both existing delete paths: `DELETE /users/delete-account` (self-delete, direct route) and `deleteUserAndRelatedData` (admin-side + OIDC-merge helper).

- **D-10: Delete is asymmetric with create — best-effort deactivate.** If Synapse is unreachable during a delete, LOG the failure clearly (with the mxid so a future sweep can find the orphan) and proceed with the Skynet-side row deletion anyway. Rationale: refusing to let a user delete their Skynet account because of unrelated Synapse infra weirdness is worse UX than leaving a temporarily-orphaned deactivated Matrix account behind. Deactivation preserves the identifier (nobody can re-register it), so an orphan holds space rather than opening a security hole.

  Deactivate BEFORE the row DELETE so that if deactivation succeeds and the row DELETE fails (unlikely but possible), the Matrix side is already clean and the row DELETE can safely retry.

### Displayname

- **D-11: Skynet sets a Matrix displayname at mint time.** The mint call passes the human-friendly form as displayname (e.g. `Ashley` for username `ashley`, or the pre-escape human form for email usernames). Rooms in Element / any Matrix client show the displayname (not the sanitized mxid). Set once at mint time; nothing later updates it in this slice.

### Deferrals (locked out of slice A)

- **D-12: OIDC-callback user creation is out of scope.** Skynet has a live `registerOIDCUser` code path used by the OIDC callback route, but Ashley confirmed nobody is currently using OIDC on either deployment. Slice A leaves that path untouched — an OIDC-authenticated user would land with `mxid = null`. When OIDC ever goes live somewhere, whoever turns it on re-opens this slice's decision to also wire mint-first provisioning into that path.

- **D-13: Runtime access-token retrieval is out of scope.** The later relay-session send path will need access tokens at request time; how those get retrieved (mint fresh per request via `loginAsUser`, mint-and-cache in memory, mint-and-persist encrypted in `users.matrix_access_token`) is a decision for whichever later sub-slice builds the send path. Slice A promises only that the mxid exists and the Matrix account behind it exists — the runtime token story rides on top.

- **D-14: Schema comment cleanup is housekeeping, not a decision.** The comment on `users.mxid` (schema.ts line 35-40) and the comment on `matrix_admin_creds` (line 694-697) both claim "human relay creds are owned by the human and never stored anywhere in Skynet." That reflects the legacy one-shot-import model. Slice A updates both comments to reflect Skynet-owned provisioning (password minted + discarded; every access token comes from admin `loginAsUser`; humans never touch Matrix directly).

### Claude's Discretion

The following are planner-and-researcher territory; the shape does not lock them:

- Where the sanitizer helper lives on disk (standalone file? adjacent to matrix-admin-client? somewhere in a `utils/` folder?).
- Structure of the rollback path when a later create-flow step fails after mint succeeded (extend the existing avatar-unlink-plus-row-delete cleanup with an admin deactivation call).
- Which specific test files get new coverage and which existing patterns to follow (integration test for POST /users/create with mock/real Synapse; unit tests for the bijective sanitizer; delete-path integration test).
- Whether to introduce a shared `provisionRelayIdentity(userId, username)` helper that both current and future (OIDC) create paths could call, versus inline in POST /users/create.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape files (this arc)
- `.planning/shapes/shape-relay-human-identities-first-class.md` — the shape file for THIS slice (LOCKED via `/open` 2026-09-08). Contents mostly duplicated here; this shape file is the human-facing origin document.
- `.planning/shapes/shape-relay-mediated-group-conversations.md` — the parent-arc shape file. Explains where this slice fits (as the first of 4 sub-slices) and what downstream slices depend on.

### Related sibling shapes in the parent arc (context only — not touched by slice A)
- `.planning/shapes/shape-relay-session-model-generalization.md` — sub-slice B (session-model backend).
- `.planning/shapes/shape-relay-new-conversation-flow.md` — sub-slice C (new-conversation modal + flow).
- `.planning/shapes/shape-relay-session-pane-rendering.md` — sub-slice D (relay-session pane rendering; will consume runtime access tokens).

### Source of truth for existing infrastructure this slice extends
- `src/backend/database/db/schema.ts` §users (lines 12-51) — the `users` table including `mxid: text("mxid")` at line 40 landed by Phase 75. The comment at lines 35-40 gets updated as part of this slice.
- `src/backend/database/db/schema.ts` §matrix_admin_creds (lines 684-710) — the singleton store for the `@skynet-admin` Matrix admin credentials. The comment at lines 694-697 gets updated as part of this slice.
- `src/backend/database/routes/users.ts` §POST /users/create (lines 90-289) — the user-creation route this slice extends. Existing flow: registration-allowed check → avatar mandatoriness (D-07 from Phase 85) → username/password validation → uniqueness check → avatar write → row INSERT → default role assignment → encryption setup → forceSave. Rollback pattern already in place for encryption-setup failure (unlinks avatar + deletes row).
- `src/backend/database/routes/users.ts` §DELETE /users/delete-account (line 2279) — one of the two delete paths this slice extends. Direct-route, does NOT go through `deleteUserAndRelatedData`.
- `src/backend/database/routes/delete-user-data.ts` — houses `deleteUserAndRelatedData`, the other delete path (admin-side + OIDC-merge invocations).
- `src/backend/matrix/matrix-admin-client.ts` — the admin-client wrapper. Two primitives this slice consumes: `createOrUpdateUser(mxid, password, displayname?)` (PUT /_synapse/admin/v2/users/{mxid}; returns `CreateOrUpdateUserOk | AdminErr`; idempotent per Synapse contract) at line 66, and `loginAsUser(mxid)` (POST /_synapse/admin/v1/users/{mxid}/login; returns fresh access_token) at line 127. Also `deactivateUser` should exist here (or be added) — verify during research.
- `src/backend/matrix/matrix-admin-creds-store.ts` — `getMatrixAdminCreds()` used by every admin primitive to fetch the encrypted homeserver+token+password. Slice A does not touch this file.
- `src/backend/matrix/matrix-admin-routes.ts` (line 30) — regex `MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/` — the Synapse localpart grammar this slice's sanitizer must produce output valid against.
- `src/backend/database/routes/user-admin-routes.ts` §POST /:id/mxid (lines 296-381) — the existing admin-endpoint for manual mxid association. NOT touched by this slice; kept for its current use case.
- `src/backend/telegram/human-token-writer.ts` — reference implementation of the "get an access_token for a human by mxid" pattern (uses `loginAsUser` under the hood). Slice A does not touch this file — it's cited for context only.
- `src/backend/telegram/bridge-config-writer.ts` §rewriteRegistryFromCurrentState (lines 137-269) — the Telegram bridge's registry rewrite. Slice A must not break this. The bridge's read of `users.mxid` (line 179) will now see more populated rows (all newly-created users), but its gate on `telegramBotTokens` row existence (step 6, line 233) means only humans with a bot-token row get bridged. So bridge behavior visible to users is unchanged.
- `src/backend/database/routes/identity-birth-orchestrator.ts` — reference implementation for how agents get provisioned via admin-mint. Slice A mirrors the same admin-client-call shape (`createOrUpdateUser`) but for humans in the create-user flow.

### Fleet-scope references (not code)
- `~/.claude/roles/box-maintainer/bounties/relay-human-identities-first-class/` — the bounty tracker for this slice's execution. Timeline entries here as work progresses.
- `~/.claude/roles/box-maintainer/bounties/relay-mediated-group-conversations-humans-agents-in-rooms/` — the parent-arc coordinating bounty. Pinned by Ashley.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`createOrUpdateUser` in `matrix-admin-client.ts`** — the admin-mint primitive. Signature: `(mxid: string, password: string, displayname?: string) => Promise<CreateOrUpdateUserOk | AdminErr>`. Discriminated union return; PUT /_synapse/admin/v2/users/{mxid}; treats 200 (updated) and 201 (created) both as success. Idempotent — safe to retry on transient failure or on duplicate-request. Slice A's user-create motion calls this directly.
- **`loginAsUser` in `matrix-admin-client.ts`** — mint a fresh access_token for any account by mxid. Uses admin auth. Slice A does NOT call this directly (that's later slices' concern), but the `deactivateUser` primitive slice A needs likely lives in the same file with the same shape.
- **`getMatrixAdminCreds` in `matrix-admin-creds-store.ts`** — every admin primitive resolves the encrypted homeserver base + admin userId + admin access_token via this. Returns null if the singleton hasn't been bootstrapped; every primitive already handles null with a `matrix_admin_creds_missing` error.
- **`randomBytes` from `node:crypto`** — used elsewhere in identity-birth-orchestrator for password generation. Same pattern (`randomBytes(24).toString('base64')`) fits for slice A's Skynet-generated Matrix password.
- **`MXID_RE` in `matrix-admin-routes.ts`** (line 30) — the regex a valid mxid must satisfy. The sanitizer's output must always match this on the localpart side.

### Established Patterns
- **File-then-row-then-encryption ordering with staged rollback** in POST /users/create — new steps get inserted into this sequence; existing rollback pattern (unlink avatar on SQL failure; unlink avatar + delete row on encryption failure) gets extended with "also deactivate Matrix account on any post-mint failure."
- **`DatabaseSaveTrigger.forceSave(<reason>)` after any db.insert/update/delete** — crown-jewel in-memory-SQLite invariant. Slice A's new admin-mint doesn't touch the DB directly (Matrix side), but the `users.mxid` INSERT already gets `forceSave` treatment as part of the existing user-create flow. Deactivation on delete: verify the existing delete paths also `forceSave` after row DELETE (they should; if not, that's a separate bug).
- **Discriminated-union `{ ok: true, ... } | { ok: false, status, error }` return shape** across all admin primitives. Slice A's new provisioning code follows the same pattern.
- **Encrypted-at-rest via FieldCrypto** — the `matrix_admin_creds` password + access_token, and `telegram_bot_tokens.bot_token`, both use this. Slice A stores no new secrets; the mint password lives only in memory for the duration of the mint call.

### Integration Points
- **POST /users/create in users.ts** — the primary integration point. The mint call inserts between existing-step-4 (avatar mandatoriness check) and existing-step-5 (avatar file write), so a mint failure aborts before any local side effect.
- **DELETE /users/delete-account in users.ts** — the primary integration for self-delete. Deactivation call inserts before existing-step (row DELETE), best-effort.
- **`deleteUserAndRelatedData` in delete-user-data.ts** — the sibling integration for admin-side + OIDC-merge deletes. Same deactivation extension.
- **Schema comment on `users.mxid` (schema.ts:35-40) and `matrix_admin_creds` (schema.ts:694-697)** — both get updated to reflect Skynet-owned provisioning.

</code_context>

<specifics>
## Specific Ideas

- **Concrete mxid examples for the two cases:**
  - Simple username (`ashley` on t1000): `@ashley_human:thenasty.taild9b663.ts.net`
  - Email username (`ashley@aitherhealth.com` on T800): `@ashley_at_aitherhealth_dot_com_human:skynet.aithercloud.com`
- **Password generation approach** to mirror agent-birth's convention (existing `randomBytes` usage in identity-birth-orchestrator.ts).
- **Displayname derivation** — for a simple username `ashley`, the human-friendly displayname is `Ashley` (title-cased). For an email username `ashley@aitherhealth.com`, the displayname is either the raw email or the pre-`@` local part title-cased (`Ashley`) — implementer to pick during planning; both are acceptable.

</specifics>

<deferred>
## Deferred Ideas

Not lost, not part of slice A, tracked for later:

- **OIDC-callback user creation (`registerOIDCUser`).** Deferred until someone actually turns OIDC on in a deployment. When that happens, re-open the shape for this slice and wire mint-first provisioning into the OIDC path with the same failure-mode contract.

- **Backfill sweep for existing users without mxids.** Explicitly out — hand-migration by each instance's maintainer covers current deployments. If a third deployment ever spins up with many pre-existing users at import time, a script version of the hand-migration would be reasonable.

- **Runtime access-token retrieval path.** Deferred to whichever later sub-slice builds the actual relay-session send path. That slice decides among: mint-fresh-per-request via `loginAsUser` (simple, higher latency, zero storage), mint-and-cache-in-memory (fast, restart-invalidated), mint-and-persist-encrypted (fast, durable, requires a new schema field).

- **Cleanup sweep for orphaned Matrix accounts** — accounts minted for Skynet users whose row failed to insert. Log lines from the fail-during-create rollback path let a future sweep find them. Slice A doesn't build the sweep; it just makes sure the log lines are grep-findable.

- **Regenerate-token / view-mxid / unlink-and-re-provision user-facing settings.** Deferred — no user-facing UI for the relay identity in slice A. Future revision if any of these ever become useful.

- **Rename of Skynet usernames.** Not supported today; slice A relies on this implicit invariant (username-derived mxid + Matrix's immutable mxid rule = rename would strand or break). If rename ever gets added, this slice's mxid scheme needs revisiting (options at that time: opaque-mxid-plus-displayname migration, or mint-new-mxid-and-orphan-old cleanup dance).

- **Human ability to log into Element as themselves.** Explicitly out — the Skynet-mediated model gives humans no password of their own. Any future push toward "let humans use Element directly" would need a separate design (e.g., password-set flow, SSO integration, etc.).

</deferred>

---

*Phase: 88-relay-mediated-group-conversations-sub-slice-a-human-relay-i*
*Context gathered: 2026-09-08*
