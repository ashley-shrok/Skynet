# Phase 88: Relay-mediated group conversations sub-slice A — human relay identities as first-class - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-08
**Phase:** 88-relay-mediated-group-conversations-sub-slice-a-human-relay-i
**Areas discussed:** discovery-first vs skip, slice scope, provisioning failure mode, mxid shape, sanitizer approach, OIDC treatment, password handling, user-delete lifecycle, runtime token storage, legacy user treatment

> **Note on the flow:** all substantive decisions for this phase were made during the `/open` conversation on the shape file (2026-09-08). `/gsd:discuss-phase` for phase 88 identified no additional gray areas — the shape file was thorough enough that the workflow's "skip assessment" applies. The log below captures the alternatives that were on the table during the `/open` conversation, one at a time, per Alice's "slow and steady, one thing at a time" pacing request.

---

## Discovery-first act vs skip

| Option | Description | Selected |
|--------|-------------|----------|
| Run discovery pass | Have an agent audit the codebase first to establish what exists for per-user relay credentials before deciding shape | |
| Skip discovery — already done | Codebase reading during shape conversation proved `users.mxid` is already first-class from Phase 75; the real gap is different (eager provisioning, not promotion) | ✓ |

**User's choice:** Skip. Alice agreed on the reframe once the shape of the actual gap (provisioning-at-create + backfill for legacy users) was laid out plainly.
**Notes:** The seed shape file's own "discovery-first" stance was written before the codebase had been read; the read (`users.mxid` column at schema.ts:40, Phase 75 comment; `matrix_admin_creds` singleton at schema.ts:698; `createOrUpdateUser` + `loginAsUser` primitives already exercised) invalidated the discovery-first premise.

---

## Slice scope — how big is slice A actually

| Option | Description | Selected |
|--------|-------------|----------|
| Add mxid+account provisioning to POST /users/create + backfill code for existing users | Full shape from seed, includes some form of backfill mechanism | |
| Only POST /users/create — hand-migrate existing users off-code | Slice touches only new-user creation going forward; existing users get hand-migrated by each instance's maintainer as part of upgrade | ✓ |

**User's choice:** POST /users/create only. Verbatim: *"I think it should just be for every new user going forward, because backfilling is easy enough manual migrations by the agents in charge of upgrading Skynet on these two instances, which are the only instances of the app that exist currently."*
**Notes:** Reduces slice scope significantly. Only two Skynet deployments exist (t1000 + T800); Taylor + Stacy handle their respective hand-migrations. No backfill code, no sweep, no lazy path.

---

## Provisioning failure mode — Synapse down at user-create time

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse account creation | Treat Synapse as a hard dependency; if mint fails, whole create request returns 500, no user row created | ✓ |
| Create user with mxid=null, retry later | Create the Skynet-side row, mark mxid null, pick up the slack via later login / background retry / lazy at first need | |

**User's choice:** Refuse. Verbatim: *"Synapse is like a hard dependency in terms of it running on the same box as Skynet now, so I'm okay with refusing new accounts if it can't be reached."*
**Notes:** Same-box co-location invariant makes the hard-dep tolerable. Locks the mint-first-then-insert ordering (mint failure aborts cleanly before any local side effects).

---

## mxid shape — user-hostile stable vs user-friendly fragile

| Option | Description | Selected |
|--------|-------------|----------|
| Username-derived (`@ashley:server`) | Semantic + short; fragile if usernames ever rename (Matrix mxids are immutable on Synapse) | |
| Opaque mxid + Matrix displayname carries semantics | Stable underlying id (e.g. `@u_<userId>:server`), rename-resilient; displayname (`Alice`) shows in Element | |
| Username-derived with `_human` suffix (`@alice_human:server`), sanitized to Synapse localpart grammar | Semantically obvious, differentiates humans from agents in same namespace, accepts "no rename" as implicit invariant | ✓ |

**User's choice:** Username-derived with `_human` suffix. Verbatim: *"let's do '@alice_human.taild9b663.ts.net' and username would have to be able to be converted to whatever synapse accepts for characters. on the other skynet instance, people may use their emails as usernames, so just want to call that out"*
**Notes:** Alice explicitly steered away from the opaque-mxid detour after being shown a concrete example. `_human` suffix invented in the same turn. Rename-fragility acknowledged as an implicit "usernames don't rename" invariant slice A relies on — noted in deferred ideas.

---

## Sanitizer approach — email usernames on T800

| Option | Description | Selected |
|--------|-------------|----------|
| Bijective escape (`_` → `__`, `@` → `_at_`, `.` → `_dot_`, etc.) | Deterministic, collision-free across any valid Skynet username, common case stays pretty, verbose in email case but readable | ✓ |
| Local-part only (strip domain from email) | Short and clean; collision risk when two users have same email local-part with different domains | |
| Trim to safe chars, append hash on collision | Pretty most of the time; order-dependent (which user signed up first) is nasty behavior | |

**User's choice:** Bijective escape (`thumbs up` after Claude recommended it with explicit rejection of the other two options).
**Notes:** Motivating case is T800 where users may sign in with corporate email addresses (Aither Health). The bijective mapping ensures `alice@example.com` becomes `@alice_at_example_dot_com_human:...` — verbose but readable and safe.

---

## OIDC-callback path treatment

| Option | Description | Selected |
|--------|-------------|----------|
| Wire mint-first provisioning into `registerOIDCUser` too | Cover both create paths; guarantee every user has an mxid regardless of auth mode | |
| Defer OIDC treatment | Leave `registerOIDCUser` untouched; OIDC-authenticated users would land with mxid=null. Fine as long as nobody actually uses OIDC in either deployment | ✓ |

**User's choice:** Defer. Alice verbatim: *"I don't even know what OIDC is, and I never use it."* Confirmed after Claude verified OIDC IS wired live in code but explained it's speculative for either deployment.
**Notes:** If OIDC ever goes live somewhere, slice A gets re-opened. Log-line grep will find any mxid=null users (if the invariant is violated by an OIDC signup) so it's not silent.

---

## Password handling — Skynet-owned vs human-owned

| Option | Description | Selected |
|--------|-------------|----------|
| Skynet generates + discards password | Nobody knows it; humans cannot log into Element as themselves; every relay action is Skynet-mediated | ✓ |
| Store password encrypted in Skynet | Skynet could serve it to user on demand; breaks the current "human relay creds owned by human" schema comment | |
| Show password to user once at create-time | User responsible for saving; original schema comment invariant preserved; UX burden on user | |
| Passwordless / SSO on Matrix | Synapse supports it but complicated to wire | |

**User's choice:** Discard. Verbatim (in response to Claude flagging the shift from schema comment): *"The only reason it says that human relay credentials are owned by the human is because for the few existing accounts that are out there already, some of them do, but that has nothing to do with how it's going to be treated normally from now forward."*
**Notes:** Confirmed the schema comment is a legacy artifact reflecting how Alice/Zoey/Laura got their accounts; go-forward is Skynet-mediated. Slice A also updates the schema comment as housekeeping.

---

## User-delete lifecycle — what happens to the Matrix account

| Option | Description | Selected |
|--------|-------------|----------|
| Deactivate the Matrix account | Preserves mxid (can't be re-registered), preserves historical attribution, clean lifecycle | ✓ |
| Delete the Matrix account | Hard delete; mxid becomes re-registerable; historical messages get orphaned attribution | |
| Leave it alone | Skynet forgets mxid; Matrix account remains active as an orphan | |

**User's choice:** Deactivate.
**Notes:** Alice added: *"I'm not sure that there is any path to deleting Skynet users right now."* — Claude verified two delete paths exist in code (`DELETE /users/delete-account` self-delete + `deleteUserAndRelatedData` admin+OIDC-merge helper). Both get wired for deactivation.

---

## Delete-failure mode — Synapse unreachable during delete

| Option | Description | Selected |
|--------|-------------|----------|
| Refuse Skynet-side delete (symmetric with create) | Strong invariant; couples user delete to relay availability | |
| Best-effort deactivate, log on failure, proceed with Skynet delete | Asymmetric with create; orphaned Matrix account acceptable state; user not blocked by unrelated infra weirdness | ✓ |

**User's choice:** Best-effort (`thumbs up`).
**Notes:** Reasoning accepted: an orphaned deactivated Matrix account holds space but opens no security hole; refusing user-delete because of infra weirdness is worse UX. Deactivation preserves the mxid so nobody can re-register it later.

---

## Runtime access-token retrieval — slice A concern or later slice

| Option | Description | Selected |
|--------|-------------|----------|
| Slice A owns the schema decision now | Add `matrix_access_token` column (or similar) to users table so shape is stable from day one | |
| Defer to a later sub-slice | Slice A promises only mxid + account; whichever slice builds the send path picks storage/cache/mint-per-request | ✓ |

**User's choice:** Defer. Verbatim: *"Yeah, if another further step in this arc is going to deal with this then we don't have to right now."*
**Notes:** Keeps slice A genuinely infrastructure-only; runtime token story rides on top when the send path gets built.

---

## Legacy users (Alice, Zoey, Laura) — update mxids to `_human` suffix or leave alone

| Option | Description | Selected |
|--------|-------------|----------|
| Migrate to `_human` suffix | Mint fresh Matrix accounts under new mxids, deactivate old, update room memberships, update users.mxid | |
| Leave legacy mxids alone | Suffix is convention going forward, not enforced; bridge and future relay-session code both take whatever mxid is in users.mxid | ✓ |

**User's choice:** Leave alone. Verbatim: *"Yeah, I wouldn't worry about it."*
**Notes:** Reduces migration blast radius. `_human` suffix is convention, not a correctness requirement.

---

## Claude's Discretion

The following were flagged as planner/researcher territory — not decisions Alice needed to weigh in on:

- Where the sanitizer helper file lives on disk.
- Structure of the rollback path when a later create-flow step fails after mint succeeded (mirror existing avatar-unlink-plus-row-delete pattern with an added admin deactivation call).
- Which specific test files get new coverage and which existing patterns to follow.
- Whether to introduce a shared `provisionRelayIdentity(userId, username)` helper vs inline in POST /users/create.

## Deferred Ideas

- OIDC-callback user creation — deferred until someone actually turns OIDC on.
- Backfill sweep code — hand-migration covers current deployments.
- Runtime access-token retrieval path — later sub-slice.
- Cleanup sweep for orphaned Matrix accounts — future infrastructure work.
- Regenerate-token / view-mxid / unlink-and-re-provision user-facing settings — no user-facing UI for relay identity in slice A.
- Rename of Skynet usernames — not supported today; slice A relies on the implicit invariant.
- Human ability to log into Element as themselves — Skynet-mediated model precludes; separate design if ever wanted.
- Retro item from Phase 82: on-disk `/opt/skynet/branding/branding.json` config wasn't updated to include the new `wipIndicatorPath` field (frontend type/guard/hook were, but not the runtime config file) — tina patched during her Phase 83 ship. Low-severity but worth noting for whoever plans the next branding-config phase; not slice A's concern.
