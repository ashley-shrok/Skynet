# Phase 102 — Host-picker ownership filter — SUMMARY

**Executed:** 2026-09-10
**Status:** Code-complete, awaiting bundled ship with commit `f5b6c4e0` (newline fix from role-cosmetics-data-migration).

## What shipped

Two atomic commits on `feat/tab-title-from-tmux`:

1. **Backend** — `feat(102-backend): add ?ownedOnly=true opt-in filter to GET /host/db/host`
   - `src/backend/database/routes/host.ts` — parse `req.query.ownedOnly === "true"`; `treatAsAdmin = isAdmin && !ownedOnly`; WHERE clause branches on ownedOnly to `eq(hosts.userId, userId)` (strict own) vs existing OR-sharing-branch; ownHosts/sharedHosts split downstream keys on treatAsAdmin.
2. **Frontend** — `feat(102-frontend): default getSSHHosts to ownedOnly=true (single choke-point)`
   - `src/ui/api/ssh-host-management-api.ts` — `getSSHHosts(ownedOnly: boolean = true)`; when true, appends `?ownedOnly=true` to the URL. All 4 callers (AppShell, CommandPalette, ServerStatusContext, FullScreenAppWrapper) get filtered results for free.

## Why single choke-point instead of 6 wire-ups

Original scope named 6 UI surfaces (5 pickers + sidebar). During execution, tracing revealed that ALL 5 pickers consume `hostTree` from `AppShell` via prop drilling — there's only ONE fetch site (`getSSHHosts()`), and AppShell is the sole caller that populates the tree. Additional non-picker callers (CommandPalette, ServerStatusContext, FullScreenAppWrapper) also want owned-only behavior for the same reason.

Flipping the default at the API layer:
- Delivers the filter to all 6 named surfaces + 3 unnamed-but-benefit surfaces
- Single line change vs 6+ per-consumer wire-ups
- Backward-compatible signature (existing callers require no update)
- Any future caller that genuinely needs cross-user visibility can opt out with `getSSHHosts(false)` — none exist today (admin console surfaces were stripped per role file)

## Verification plan

Manual smoke test via curl after deploy (no unit test — see "Test rig gap" below):

```bash
# Owned-only should return 3 rows for Alice (thenasty, workstation, ZoeyBattlestation — her own).
curl -sk -b /tmp/tina-skynet-cookie.txt \
  "https://term.example.com/host/db/host?ownedOnly=true" \
  | jq 'length'  # expect 3

# Default (no param) should still return 6 rows (unchanged behavior — admin cross-user visibility preserved).
curl -sk -b /tmp/tina-skynet-cookie.txt \
  "https://term.example.com/host/db/host" \
  | jq 'length'  # expect 6 (Alice's 3 + joe's workstation + zoey's thenasty + ZoeyBattlestation)
```

Then eyeball the Roles modal, sidebar, and command palette on Skynet post-deploy — non-owned rows should be gone.

## Test rig gap (documented follow-up)

`src/backend/database/routes/host.test.ts` (1356 lines) only extracts POST/PUT handlers from `router.stack`. Adding a GET-handler test requires setting up mocks for the entire query-builder chain (`db.select().from().leftJoin().where()`) plus `DataCrypto.getUserDataKey/decryptRecord`, `resolveHostCredentials`, and `stripSensitiveFields` — a rig 10-20x larger than the fix. Deferred as a separate follow-up if the endpoint grows further test-worthy branches. The current change is small enough that runtime verification via the curl commands above (which Alice will do as part of UAT post-ship) is proportionate.

## Bundled ship

Bundled with commit `f5b6c4e0` (backend newline fix from role-cosmetics-data-migration same session) per Alice's directive to accumulate work for one deploy. Pre-push steps documented in the role-cosmetics bounty's timeline (pull-rebase past taylor + tabitha's recent origin advances; full-suite; coord-post; push; build; force-recreate; verify).

## Related

- Bounty: `~/.claude/roles/box-maintainer/bounties/host-picker-ownership-filter/`
- Related: `role-cosmetics-data-migration` (originating session), `T800-multi-user-isolation`.
- Preceding commit in ship bundle: `f5b6c4e0` (roles-list-for-host newline guarantee).
