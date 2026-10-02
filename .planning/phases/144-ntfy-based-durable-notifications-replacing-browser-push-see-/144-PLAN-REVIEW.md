# Phase 144 — Plan-checker review

**Reviewed:** 2026-10-02
**Verdict:** PASS WITH CONCERNS
**Reviewer:** gsd-plan-checker (sonnet)

## Summary

Four plans across three waves cover the phase goal end-to-end. Goal coverage,
scope-edge adherence, "what would make it wrong" avoidance, deep-work-rules
compliance, and fleet-rule compliance all pass. Four HIGH concerns and five
MEDIUM concerns flagged for executor awareness.

## HIGH concerns (must be visible to executors)

### HC-2 — Bootstrap circularity: no task provisions the initial ntfy admin user

**Severity:** HIGH (real functional bug — the current plans produce an ntfy
container with no admin user, which breaks every HTTP admin API call that
follows at runtime).

Plan 01 says "ntfy learns about the publisher via auth-tokens + auth-users
in server.yml — see plan 02 for the server.yml commit." Plan 02 has no such
task. The runtime bootstrap in `ntfy-bootstrap.ts` calls `createNtfyUser` via
`POST /v1/users` — but that endpoint requires admin auth, which has no
credential to use because no admin user exists yet.

**Fix needed before execution:** Add a task (likely in Plan 01) to create
a server.yml file (e.g., `docker/ntfy-server.yml`) mounted into the ntfy
container, with an initial `auth-users` entry provisioning the Skynet admin
user. The admin user credential comes from `NTFY_ADMIN_USER` /
`NTFY_ADMIN_PASS` env vars, and the server.yml would reference the
bcrypt-hashed form.

### HC-1 — Confused bootstrap identity ("skynet-publisher" vs admin user)

Plan 02's `ntfy-bootstrap.ts` calls `createNtfyUser("skynet-publisher", ...)`
using the admin password. The RESEARCH.md addendum describes the admin user
and the publisher as potentially separate. The code is safe (409 is
swallowed), but architecturally confused. Executors should treat the
`skynet-publisher` HTTP-API call as belt-and-suspenders; the actual
provisioning path is via server.yml at compose up (per HC-2's fix).

### HC-3 — `ntfy_publish_config` singleton table from RESEARCH.md Q7 is not planned

RESEARCH.md anticipated a DB-stored publish token in a singleton table. The
plans intentionally skip it — the publish token lives in
`NTFY_PUBLISH_TOKEN` env var only. **Flag in executor prompts:** the
`ntfy_publish_config` table is deliberately NOT built. Publish token is
env-only.

### HC-4 — Test-notification deep-link uses `agentHostId: null`

Plan 02's `/ntfy-test` endpoint builds a push with `agentMxid "@system:skynet"`
and `agentHostId null`. The deep-link format expects both to be real. The
resulting Click URL may be `/?openHarness=@system:skynet&host=null`, which
may fail to navigate or open something unexpected when tapped. Not critical
(test notification only), but the executor should either (a) use a sentinel
real `agentHostId` or (b) have `buildClickUrl` handle null gracefully (omit
the `host` param rather than passing "null").

## MEDIUM concerns (nice-to-fix)

- **MC-1:** No explicit acceptance criterion that the Caddyfile snippet was
  NOT applied inline during Plan 01 execution (ship-prep only).
- **MC-2:** Plan 03's `window.confirm` test needs mocking in vitest/jsdom.
- **MC-3:** Plan 04 runs `npm install` to regenerate `package-lock.json`.
  Not a deploy motion; fine.
- **MC-4:** Plan 02's `DELETE /ntfy-setup` route doesn't explicitly say to
  read the ntfy username from the stored DB column; executor might hardcode
  the `"skynet-reader-" + userId` construction instead.
- **MC-5:** Plan 03's `must_haves.truths` forward-references work Plan 04
  does (SKILL.md update). Verifier at end of Plan 03 can't verify.

## LOW notes

- Scope edges clean (no out-of-scope items leaked).
- Content privacy clean (nothing passes through ntfy.sh except msgId + topic
  hash).
- No instance-specific hardcoding anywhere.
- Dependency graph valid; no cycles; parallel waves have no file overlap.
- Threat models present and substantive in all 4 plans.
- `requirements: []` across all plans is structurally valid (shape-seeded,
  no formal requirement IDs).
- Plan 01 keeps both VAPID and ntfy boot assertions until Plan 04 ships —
  intentional for the pure-cutover ship structure.

## Executor awareness

If plans are executed as-is without a revision pass, executors MUST see
HC-2 in their prompts. The bootstrap circularity bug would cause runtime
401s on every HTTP admin API call until a server.yml with the initial
admin user is mounted. HC-1 and HC-3 are architectural clarifications
that reduce confusion but don't block execution. HC-4 is a minor polish.

## Recommended next step

**Option A: Revision pass.** Send plans back to planner with HC-1, HC-2,
HC-3, HC-4 as fix items. ~10 min of planner time; produces clean plans
with the bootstrap bug fixed.

**Option B: Proceed to execute.** Pass HC-2 (and the other HCs) explicitly
in executor prompts so Plan 01's executor knows to create the server.yml
with initial admin user provisioning. Slightly higher risk if executor
misreads the hand-off.

**Option C: Pause.** Session has been long; context has significant
accumulation. Resume in a fresh session with `/gsd:execute-phase 144` after
reviewing the plans manually, or run a revision pass in a fresh session.
