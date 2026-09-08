# Shape: relay group conv — sub-slice A: human relay identities as first-class

**Opened:** 2026-09-08
**Vehicle:** `/build` cycle; inside /build's step 2, a full GSD phase (`/gsd:plan-phase` → `/gsd:execute-phase`)
**Bounty:** `relay-human-identities-first-class` (box-maintainer role)
**Parent shape:** `.planning/shapes/shape-relay-mediated-group-conversations.md`
**Parent bounty:** `relay-mediated-group-conversations-humans-agents-in-rooms`

## What this is

Every Skynet user gets a durable Matrix relay identity, provisioned by Skynet itself at the moment the user is created, so that later sub-slices in this arc can assume "the user has a relay identity, and Skynet can send / receive on it" without ceremony. "Has a relay identity" means both halves together: the Matrix account actually exists on the Synapse homeserver, AND the association between the Skynet user and that account is stored in Skynet's own database. Skynet owns the whole creation motion for both halves; nothing about it depends on the human having done anything themselves. Pure infrastructure — nothing user-visible in this slice.

## Shape

Discovery is not the opening act — it's already been done in the shaping conversation. The per-user relay identifier is already a first-class column on the users table (populated for a small legacy set by hand). What's actually missing is provisioning at user-create time and matching lifecycle handling at user-delete time.

**At user-create time**, Skynet does the whole minting motion synchronously as part of the create flow. It picks the identifier (see the shape decision below), asks Synapse's admin API to mint the Matrix account under that identifier with a Skynet-generated password, and — only if that succeeds — writes the users row with the identifier already populated. The mint happens BEFORE the row insert so a mint failure aborts cleanly with no rollback dance; the mint is idempotent so a retry of the same identifier is safe. Synapse is treated as a hard dependency: if the homeserver is unreachable, Skynet refuses to create the account and surfaces the failure to the caller. This is symmetric with the fact that Synapse already runs on the same box as Skynet in every current deployment.

**At user-delete time**, on any of the existing Skynet-side delete paths, Skynet also calls Synapse's admin API to deactivate the corresponding Matrix account. Deactivation preserves the identifier (nobody else can ever register it again) and preserves historical attribution in any rooms the account participated in. Delete is asymmetric with create in one way: it's best-effort. If Synapse is unreachable during delete, Skynet logs the failure and proceeds with the Skynet-side deletion anyway, leaving a temporarily-orphaned Matrix account behind rather than refusing to let the user delete their Skynet account for an unrelated infra reason.

**The identifier's shape** is username-derived with a suffix that distinguishes humans from agents: `@<sanitized-username>_human:<server_name>`. The sanitizer is a bijective character escape — `_` → `__`, `@` → `_at_`, `.` → `_dot_`, and analogous escapes for any other character Synapse's localpart grammar rejects. Bijective in both directions, deterministic (same username always maps to the same identifier), collision-free across any valid Skynet username, and cheap for the common non-email case (`ashley` → `@ashley_human:...`). The verbose case is when a username is an email — reasonable on the deployment where Aither users may sign in with corporate email addresses (`ashley@aitherhealth.com` → `@ashley_at_aitherhealth_dot_com_human:...`) — still readable, still safe.

**The Skynet-generated password is discarded on the spot.** Nobody ever knows it — not the human, not any stored record. Skynet only ever needs to mint access tokens for this account, and the admin API primitive that mints tokens uses admin authentication, not the account's password. This means humans cannot log in to a Matrix client (Element or otherwise) as themselves; every relay-side action they take is mediated by Skynet's backend on their behalf. That is the intended model.

**The schema comment claiming "human relay credentials are owned by the human and never stored anywhere in Skynet" is retired** as part of this slice. That comment reflected the legacy pattern (Ashley, Zoey, Laura all self-registered before Skynet had a provisioning path) and does not describe the go-forward model. It's updated to reflect Skynet-owned provisioning.

**Runtime access-token retrieval is deferred to a later sub-slice.** This slice promises the identifier exists and the Matrix account behind it exists; whether the send path caches tokens, mints them fresh per request, or persists them encrypted is decided by whichever sub-slice builds the actual send path.

## Philosophy

This slice is infrastructure. If any user notices anything from this slice landing, something has probably gone wrong. All the visible behavior — being able to create a relay session, seeing bubbles in a pane, participating in a group — arrives in later slices. This slice's success looks like "we can now assume every user has a durable relay identity" and nothing else visible.

Skynet-mediated is the model. Under the go-forward design, humans never directly touch the Matrix substrate; Skynet's backend acts on their behalf for every relay-side operation. The single-source-of-truth for a user's relay identity is the users row plus the Matrix account itself — humans hold no credential, no separate login, no independent access path. This is a deliberate simplification; anything richer (regenerate token, log into Element as yourself, multi-device) is either a later sub-slice or, more likely, permanently out of scope.

The `_human` suffix on new identifiers is convention, not schema-enforced. It gives humans and agents non-overlapping namespaces on the same homeserver (agents have no suffix; humans have `_human`). Existing legacy identifiers without the suffix — the ones populated by the one-shot import for Ashley, Zoey, and Laura — continue to work indefinitely; nothing in the code treats the suffix as a correctness requirement, only as a convention going forward.

The Telegram bridge stays entirely untouched. Its existing behavior — mint access tokens for humans who have both an identifier AND a Telegram bot-token row — is preserved. Slice A populates more humans' identifiers, but the bridge's gate on "does this human have a bot-token row" filters those without one out of the bridge's scope. The bridge sees the same set of bridged humans it saw before.

## Prior context

The per-user identifier column exists as a first-class first-class column on the users table (landed in Phase 75). Population today happens through two paths: an admin-only endpoint that takes a caller-supplied identifier string and associates it with a Skynet user, and a one-shot import script that seeded Ashley, Zoey, and Laura. Neither path mints the Matrix account itself; both assume the account was registered elsewhere.

The `matrix_admin_creds` singleton table holds the credentials Skynet uses to talk to Synapse's admin API. It's a real live thing — populated via an admin bootstrap endpoint, encrypted at rest. Two admin primitives are wired against it and exercised by other subsystems today: mint-or-update a Matrix account (with a caller-supplied password), and mint a fresh access token for any existing account without needing the account's password. Both are what slice A needs; nothing new gets built at the admin-client layer.

Agent identities are provisioned by a different mechanism entirely — the wake-up self-registration pattern where each agent's receiver on its target host self-registers a Matrix account on first wake. That mechanism stays as it is; slice A is only about humans.

The Telegram bridge is the only current consumer of per-user Matrix access tokens, and it mints them on-demand via the admin token primitive, writes them to a shared Docker volume, and reads them from a bridge daemon. That path is untouched by slice A.

Skynet's user-creation flow currently lives in POST /users/create with an OIDC-callback sibling. There is also live code for the OIDC-registration path (`registerOIDCUser`), but nobody in any current deployment is actually using OIDC — see the deferred list.

## What would make it wrong

A user is created through the normal registration flow and lands without a Matrix identifier. The provisioning is wired somewhere the create path doesn't call.

A Skynet user is created, then Synapse is unreachable, and Skynet silently creates the user anyway with a null identifier. The refuse-on-mint-failure gate is not doing its job.

A user is created, the Matrix account is minted successfully, and then something later in the create flow fails and the Skynet-side row is rolled back — leaving an orphaned Matrix account on Synapse. Small leak, but the log line for the failure should be there so a periodic cleanup can find it.

The Telegram bridge stops working after this slice ships. The provisioning path has crossed wires with the bridge's own mint pipeline.

A rename is added to Skynet later without the mxid scheme being revisited, and users' identifiers desync from their usernames. The rename-fragility invariant is documented but not enforced in code; if it is violated in a future change, the shape's premise breaks silently.

Two users end up with the same Matrix identifier because the sanitizer maps two different usernames to the same output. The bijective escape is not actually bijective in some corner case, or the sanitizer is short-circuited somewhere.

The Matrix-side displayname is left as the raw identifier (`ashley_human`) and looks robotic in Element / any Matrix client. Slice A also sets a human-friendly displayname (`Ashley`) at mint time.

## Scope edges

**In.**
- Extending `POST /users/create` to mint the Matrix account (via `createOrUpdateUser`), set a Matrix displayname derived from username, populate `users.mxid`, and refuse the create on Synapse failure.
- Wiring deactivation (via Synapse admin) into both existing user-delete paths (`DELETE /users/delete-account` and `deleteUserAndRelatedData`), best-effort with log-and-proceed on failure.
- Implementing the username → mxid sanitizer as a bijective escape (`_` → `__`, `@` → `_at_`, `.` → `_dot_`, and analogous escapes for other Synapse-rejected localpart characters).
- Retiring / updating the schema comment on `users.mxid` and `matrix_admin_creds` to reflect Skynet-owned provisioning.
- Test coverage for: happy path (create → mxid populated + Matrix account exists), failure path (Synapse down → create refused, no user row, no Matrix account), delete path (Skynet delete → Matrix deactivated), delete-failure path (Synapse down on delete → row deleted, log emitted).

**Out.**
- Backfill code for existing users without an mxid. The one-shot admin script for Ashley/Zoey/Laura is not being generalized; new deployments' existing users are hand-migrated by the maintainer of that instance (Taylor on t1000, Stacy on T800) as part of the upgrade rollout.
- Any change to legacy users' existing mxids (they don't get the `_human` suffix retroactively).
- Any user-visible UI, front-end code, or user-managed affordance for the Matrix identity. Users don't see it, don't manage it, don't know it's there.
- Any change to what the Telegram bridge does; its mint path continues unchanged.
- Runtime access-token retrieval for the eventual relay-session send path — deferred to whichever later sub-slice builds the send path.
- Any change to how agent identities are provisioned; agent birth continues via wake-up self-registration.

**Deferred to a later revision.**
- OIDC-callback user creation (`registerOIDCUser`) — the code path exists but nobody is currently using OIDC in either deployment; slice A leaves it untouched. If OIDC ever goes live, this slice needs to be re-opened to wire the same mint-first pattern into that path.
- User-facing relay-identity settings (regenerate token, view mxid, unlink and re-provision).
- Multi-device / multi-token per user.
- Cleanup sweep for orphaned Matrix accounts (accounts minted for Skynet users whose row failed to insert). Log lines from the fail-during-create path let a future sweep find them.

**Tempting but no.**
- Giving humans the Skynet-generated password so they can log into Element as themselves. Every path this opens up (multi-device, password reset, humans typing into Element instead of Skynet's UI) is either out of scope or works against the Skynet-mediated model.
- Retrying the mint asynchronously if it fails at create time (so the user is created and the identifier fills in later). Silently violates the "every user has one" invariant during the retry window and hides infra failures from the person creating the account.

## Vehicle notes

Full `/build` cycle, first sub-slice of the parent relay-group-conversations arc. Inside step 2 of `/build`, the actual code work is a single GSD phase (`/gsd:plan-phase` → `/gsd:execute-phase`) — the slice touches enough surface (create route + delete routes + admin-client integration + sanitizer helper + schema comment + tests) that phase planning is worth the ceremony.

The identity implementing this work is box-maintainer (Taylor working out of `~/skynet-taylor` on `feat/tab-title-from-tmux`). The bounty timeline at `~/.claude/roles/box-maintainer/bounties/relay-human-identities-first-class/` is where cross-turn context and decisions made during planning + execution should be recorded.

Nothing in this slice is user-visible; slice-A close-out is a `/close` against this shape file, not a UAT against user behavior. Verification is code-level (routes call the admin API in the right order, delete deactivates, sanitizer is provably bijective on the input space).
