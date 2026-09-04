# Shape: feature 05 — per-user auth flow (admin-vs-non-admin container isolation)

> **⚠️ CLOSED / SUPERSEDED 2026-09-04** — this shape is no longer the direction.
> Multi-VM POC validated 2026-09-04 (Ivy provisioned t4g.small in Aither VPC,
> tiffany installed substrate, Ashley drove login + `/id` via Skynet frontend
> — worked). Codebase-verification pass revealed **Skynet already user-scopes
> every host operation** (`WHERE hosts.userId = req.userId`), AND already has
> an admin-scoped `POST /users/api-keys` endpoint that creates a `tmx_` API key
> for any target user. Combined: the entire AI+ isolation flow uses existing
> Skynet primitives with zero code changes. Feature 05 as a Skynet feature
> DISSOLVES — folded into feature 07's orchestration (create Skynet user +
> issue API key + provision VM + install substrate + POST host under exec's
> userId). See `~/.claude/roles/box-maintainer/bounties/ai-plus-mvp-project/
> PROJECT.md` § Architecture at a glance, `decisions.md` § Isolation
> architecture pivot 2026-09-04, and `feature-07-linux-user-provisioning-
> helper.md` (reshaped) for the current direction. Container-per-user
> analysis below is preserved as historical reasoning trail only.

**Opened:** 2026-09-03
**Vehicle:** GSD phase (deferred pending multi-VM validation)

## What this is

Skynet needs to know, for every logged-in user, HOW to reach that user's harness context so all enumeration and access — identity discovery, session listings, liveness polling, terminal opening — targets the right execution boundary. This feature is the load-bearing plumbing that makes a per-user isolation model actually work at the app layer: non-admin users get their own container on every managed host (isolated); admin users share the host's box-level context (full-access, no wrapping). A single small choke point in the backend answers "what's this user's exec target on this host?" and every enumeration site routes through it. Flip the switch on and isolation is real; the rest of the code doesn't need to know the shape of the answer, just to ask through the one door.

## Shape

Every Skynet user has a flag for "am I an admin" (already in the user record) and, if they're non-admin, a container identifier — the name of the container that hosts their harness on any given managed host. Which container to reach depends on who they are AND which host is in question. The single choke point takes the logged-in user and the target host and returns a description of how to reach that user's context on that host: either the shared box context (for admins) or the user's per-user container context (for non-admins). Every enumeration site in the backend that needs to see into a user's world — identity readers, session discovery, fleet-status polling, host CRUD, tab opening — passes through the choke point instead of building its own target string. The login flow surfaces the admin flag onto the session so the choke point can read it without a database roundtrip on every call.

Alongside the choke point, three plumbing pieces:

- A user-record column carrying the per-user container identifier (populated by feature 07 at account creation for non-admins; null for admins).
- A short-lived connection-reuse layer for SSH-into-managed-hosts so a burst of enumeration calls doesn't re-handshake every time.
- A safe fallback semantic — for the transition period, if a non-admin user's container identifier isn't populated yet, treat them as admin-context (shared) rather than throw, so a mid-migration state isn't a crash. Once feature 07 lands and populates for real users, the fallback is dead code that a phased-rollout task can retire.

UI-layer per-owner filter is enforced on the conversation-list side for BOTH admin and non-admin: each admin sees only their own agents, matching the locked visibility intent, even though at OS level multiple admins share the same shared context on any given host.

## Philosophy

**The isolation shape maps to who needs what.** Admins need full box access because they run agents that manage the server itself; containers would fight that need. Non-admins have no reason for full box access; a container gives them a cleanly bounded world where their agents can't see or touch anyone else's. One flag, one branch, no per-user overrides.

**One door, not dozens.** The pain the choke point avoids is not "SSH-target-string construction is hard" — it's "when we later want to change how we reach a user's context (SSH-into-container vs docker-exec vs something else), we don't want to hunt through dozens of sites." Every enumeration site goes through the same door and the door decides. If we ever change the transport, only the door changes.

**Ships to both boxes as one codebase.** The productization instance (T800) and the internal maintainer instance (T1000) run the same build. The per-user shape is decided at runtime by the user's admin flag, not by which box the code is running on. That means the container path is dormant on T1000 (sole admin = shared context = zero behavior change) and live on T800 (mixed admins + execs). This gives a natural phased-rollout property: deploy to T1000 first, verify zero-change confidence, then deploy to T800 where the new path lights up.

**Skynet self-manages, always.** Provisioning containers on managed hosts is Skynet's job, not a human-on-host job. If a managed host is missing container tooling, Skynet installs it via its own existing shared-user access. Feature 07 owns the provisioning helper mechanics; feature 05 owns the plumbing that consumes what feature 07 populates. No external-party handoff at any point in the provisioning lifecycle.

**Migration over reinstall.** T800 already exists — it runs an older Skynet with the CEOs' MFA/OAuth already set up. The AI+ MVP work migrates T800 forward to the new version, not fresh-installs it. The schema change here is an additive column, populated for future non-admin accounts by feature 07 at creation time; existing accounts stay in the admin-context fallback until explicitly flipped. Losing the CEOs' authentication state is a UX disaster that any technical benefit can't overshadow.

**Container-per-user, not container-per-identity.** One user, one container that hosts all of that user's identities. No use case exists for isolating one identity from another within the same user. Per-identity would be wasted overhead.

## Prior context

Skynet today runs every SSH access as one shared box-level user on every managed host. On the internal maintainer box (T1000), all the maintainer identities share that context — they can see each other's processes and state, which is fine because they're all trusted agents under a single operator. On the productization box (T800), that model doesn't extend to five executives with different scopes of work; some kind of per-user isolation is needed.

An earlier locked design proposed doing isolation via per-linux-user accounts on each managed host — a shape well-supported by Unix but architecturally noisy at fleet scale: linux users are load-bearing OS primitives (home dirs, permissions, groups, sudo, systemd-user, PAM), and using them as app-level isolation labels means every managed host grows N per-Skynet-user accounts to keep in sync. Investigation into containers as an alternative showed the tradeoffs favor containers for this use case: per-user auth stays cleanly independent (each container has its own OAuth token / API key store), isolation is stronger (kernel namespaces + cgroups, not just Unix file perms), the substrate stays codified in one place (image + compose file, shippable via the same distribution mechanism that already ships the main Skynet image), and Anthropic officially supports containerized harness execution with published dev-container patterns and self-hosted-deployment guides.

T800 already runs an older Skynet version and is maintained by a peer agent (Stacy) with the CEOs (Lisa & Laura) as its Skynet admins. The AI+ MVP work will migrate T800 forward to the same new version T1000 runs — no fork, no separate build. T1000 has only its sole operator as an admin and no non-admin accounts today; the container path is dormant there until a scratch non-admin is added.

## What would make it wrong

- **A non-admin user can see another non-admin user's agents, files, or process state.** That's the isolation floor collapsing. Doesn't matter if it happens via a leaked path, a wrong exec target, a fallback that shouldn't have fired, or a conversation-list bug that shows cross-user rows — same failure.
- **An admin doesn't have full box access.** That's the escape-hatch collapsing. Admins run agents that manage the server itself; if a container silently wraps them anyway, they lose the ability to do their job.
- **The choke point isn't actually the only door.** If any enumeration site constructs its own exec target and skips the choke point, the whole point of the plumbing is defeated — future transport changes would require another hunt.
- **Existing MFA/OAuth state is lost during migration on T800.** Any migration path that requires re-authentication of CEO accounts is a UX disaster that overshadows any technical benefit of the pivot.
- **Skynet can't reach a container it provisioned itself.** Provisioning must produce something Skynet can immediately enumerate through, without a completion step that Skynet can't do on its own.
- **The dormant container path is dormant in name only on T1000** — silent side effects (broken enumerations for admin identities, spurious errors in logs) that only surface once you actually try to log in as an admin post-deploy defeat the "safe rollout" property.
- **Cross-admin visibility bleeds through into non-admin land.** Admins seeing only their own agents in their conversation list is by-design (the OS shares state between admins, but the UI still filters per-owner). A non-admin accidentally seeing anyone else's agents through the same filter path would leak information.

## Scope edges

**In this feature:**

- User-record column for per-user container identifier (nullable).
- Login flow surfaces admin flag onto session.
- Single choke point returning exec target given `(user, host)`.
- Audit pass over every backend SSH-exec / enumeration site, routing each through the choke point.
- Connection-reuse layer for the SSH-into-managed-host burst pattern.
- Fallback semantic for the transition period.
- UI-layer per-owner filter enforced for both admin and non-admin conversation lists (admins see only their own agents).

**Deferred to feature 07 (provisioning):**

- The provisioning helper that creates a per-user container on demand on any managed host.
- The generation and installation of per-container access credentials.
- The container image itself, its substrate contents (harness, tmux, agent-supervisor, wakeup-scheduler, context-watch, relay receiver), its lifecycle management.
- Skynet-side bootstrap of container tooling on managed hosts that don't yet have it.

**Deferred to feature 02 (distributor):**

- Shipping the per-user container image alongside the main Skynet image to managed hosts on version bumps.
- Migration path for T800's existing older-version state to the new version.

**Deferred to feature 03 (account creation):**

- Triggering feature 07's provisioning at account creation time.
- Admin-flag toggling by an existing admin.

**Out of scope entirely:**

- Aggregated cross-user view for admins ("show me all execs' agents").
- Per-identity isolation.
- Backfill of a container to existing T800 accounts on migration — they stay in the admin-context fallback unless explicitly flipped.
- Login-audit surface (was going to hook feature 04's audit log; feature 04 was dropped).
- Password recovery flow.
- Per-admin permission scoping (all admins are full-admin).
- View-as-user toggle.

**Tempting but no:**

- Doing the container-provisioning in this feature "since it's the natural place." No — feature 07's job. Keep the surface bounded so this feature can land cleanly and be reviewed cleanly.
- Removing the fallback semantic immediately because "it's dead code once feature 07 lands." Keep it until feature 07 is deployed AND populating for real users. It's the safety net for the multi-feature ship chain.
- Building the admin conversation-list aggregation "since the admin-sees-only-own case is already the current design, might as well future-proof for later." Designing for a hypothetical is exactly what bloats a spec.

## Vehicle notes

**Vehicle: GSD phase.** Same shape as feature 01 (Phase 70) last session — backend schema + choke-point helper + call-site audit is squarely phase-sized work, needs discussion/plan/execute/verify structure, benefits from `gsd-phase-researcher` doing the codebase enumeration of every SSH-exec site so the audit pass is comprehensive rather than "grep and hope."

**Ship-gate deferred.** The AI+ MVP chain-ship intent means this feature is code-complete-not-shipped at the end of its /build cycle. The chain (01 → 05 → 07 → 03 → 02 → 09) lands together on both T1000 and T800 at a future single deploy motion. Skip ship-gate / deploy / hand-off / notify-stakeholders at the /build pipeline's tail.

**Planning-quality reminder from Phase 70.** Phase 70's plan-checker missed two ship-blockers (Express 5 wildcard syntax + nginx location-priority) that only surfaced in /close's code review. This phase has similar risk shape — the audit pass could easily miss a site, and the choke point's fallback branch is exactly the kind of thing that looks fine in review but fails on real data. Budget a real audit-pass task, verify with a grep over the phase's touched surface at close time, and ask the plan-checker to specifically confirm: (a) every SSH-out site routes through the choke point, (b) the login flow surfaces the admin flag AT session creation not on-demand, (c) the fallback semantic doesn't accidentally fire for admin users too.

**Related files that will change but don't belong to this feature.** The AI+ MVP project doc and the sibling feature files (07, 02, 03) all need pivot notes reflecting the container-per-user shift. Owner (tiffany) will update those separately as a follow-up on the AI+ MVP bounty — those live in bounty context, not repo.

**Identity: tiffany. Working tree: `~/skynet-tiffany/`. Branch: `feat/tab-title-from-tmux`.**
