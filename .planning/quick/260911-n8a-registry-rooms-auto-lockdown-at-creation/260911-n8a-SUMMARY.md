---
quick_id: 260911-n8a
type: summary
status: complete
branch: feat/tab-title-from-tmux
commits:
  - 5dd60efd: "feat(260911-n8a): add getRoomPowerLevels + putRoomPowerLevels + createRoom initial_state"
  - e391567a: "feat(260911-n8a): add lockdown assertion + birth-locked initial_state to registry-rooms"
files_modified:
  - src/backend/matrix/matrix-admin-client.ts
  - src/backend/matrix/matrix-admin-client.test.ts
  - src/backend/relay-sessions/registry-rooms.ts
  - src/backend/relay-sessions/registry-rooms.test.ts
---

# 260911-n8a: Registry rooms auto-lockdown at creation

## One-liner

Both registry rooms (agents + humans) now come out of every boot pass structurally locked (all 8 `m.room.power_levels` invariants at PL 100, fleet-admin at PL 100 in `users`), applied both at `createRoom` time via `initial_state` (birth-locked, no observable open-write window) AND via a boot-time idempotent read-then-optionally-write PATCH (repairs drift on existing rooms). Preserves existing PL 100 humans; RAISE-only, never LOWER.

## What changed

### Task 1 — matrix-admin-client (commit `5dd60efd`)

- **`getRoomPowerLevels(roomId)`** — new exported primitive. `GET /_matrix/client/v3/rooms/{encodeURIComponent(roomId)}/state/m.room.power_levels`. Returns `{ ok:true, content: Record<string, unknown> }` on 200; discriminated `AdminErr` on non-2xx / timeout / proxy. 404 is a legitimate "state event unset — caller may assume defaults" case, kept as `{ ok:false, status:404, error:ERR_NON_2XX }` so the caller (`assertRegistryRoomLockdown`) can branch on it explicitly.
- **`putRoomPowerLevels(roomId, content)`** — new exported primitive. `PUT /_matrix/client/v3/rooms/{encodeURIComponent(roomId)}/state/m.room.power_levels` with the whole content object as JSON body. Returns `{ ok:true }` on 200; discriminated `AdminErr` on failure. Body content is never logged (proxy-error path only passes the operation label + raw err).
- **`createRoom` extended** — new optional `initialState?: Array<{ type; state_key?; content }>` parameter. When present, forwarded verbatim to the request body as `initial_state`. Zero behavioral change when the caller omits it — existing callers untouched.

Both new primitives follow the exact scaffolding shape of `getRoomName` / existing primitives: `getMatrixAdminCreds()` bail on null, `encodeURIComponent(roomId)` (T-75-05), `Bearer <token>` auth, `AbortController + REQUEST_TIMEOUT_MS`, `ERR_TIMEOUT` on `AbortError`, `ERR_PROXY` on other throws, `clearTimeout` in both branches, operation labels `matrix_admin_get_room_power_levels` / `matrix_admin_put_room_power_levels`, admin access_token never logged.

### Task 2 — registry-rooms (commit `e391567a`)

- **`buildLockdownPowerLevelsContent(fleetAdminMxid, existing | null)`** — new exported pure function. Produces the target `m.room.power_levels` content enforcing all 8 lockdown invariants:
  - Numeric fields at >= 100: `events_default`, `state_default`, `redact`, `invite`, `kick`, `ban`, `historical`. RAISE-only rule: `target[field] = Math.max(existing[field] ?? matrix_default, 100)` — never lowers, so a manually-set `kick=200` is preserved.
  - `users` map: shallow-copy existing (narrowed to `Record<string, number>` via per-entry `typeof` check), ADD `fleetAdminMxid: 100` if missing or below 100, NEVER remove or lower.
  - All other top-level fields (`events`, `notifications`, `users_default`, custom keys) pass through byte-identical.
  - `needsPatch = false` iff every invariant is already at target AND fleet-admin already at PL 100. Otherwise `true`.
- **`assertRegistryRoomLockdown(role, roomId, fleetAdminMxid)`** — new exported async fn. Wraps GET → diff → maybe-PATCH in try/catch. Never throws. Structured warn/info logs at every branch boundary with operation labels: `registry_rooms_lockdown_get_failed`, `registry_rooms_lockdown_noop`, `registry_rooms_lockdown_patch_fire`, `registry_rooms_lockdown_patch_failed`, `registry_rooms_lockdown_patched`, `registry_rooms_lockdown_assert_failed`. 404 on GET is mapped to `content=null` (state event unset → assume Matrix defaults).
- **`ensureRegistryRoomsExist` wiring** — lockdown assertion fires on BOTH paths:
  - Fast path (both settings rows present): after `selfHealAdminRoomsMembership` for both rooms, `assertRegistryRoomLockdown` runs for both.
  - Slow path (settings row missing → create): after each successful `createRegistryRoom`, `assertRegistryRoomLockdown` runs defensively (new room should already be locked from `initial_state`, but the assertion re-runs and no-ops on well-locked content).
- **`createRegistryRoom` updated** — now takes `fleetAdminMxid: string` as a new required param (threaded from `ensureRegistryRoomsExist`'s already-loaded `creds.userId`). Passes an `initialState: [{ type: "m.room.power_levels", content: buildLockdownPowerLevelsContent(fleetAdminMxid, null).content }]` to `createRoom`. Zero other changes to `createRegistryRoom`.

Fleet-admin identity source: `getMatrixAdminCreds().userId` — the existing admin credential source, per shape doc L88 ("read from wherever the app already knows its admin credentials"). No new config surface.

Join hooks (`joinAgentToAgentsRegistry`, `joinHumanToHumansRegistry`) untouched — the lockdown is orthogonal to the join hooks.

## Test results

### Scoped vitest — both touched test files (pre-Task-1 baseline: 121 tests / registry: 17 tests)

```
npx vitest run src/backend/relay-sessions/registry-rooms.test.ts \
                src/backend/matrix/matrix-admin-client.test.ts
Test Files  2 passed (2)
     Tests  158 passed (158)
```

**matrix-admin-client.test.ts** — 130 tests (121 pre-existing + 9 new):

| Test | Outcome |
| ---- | ------- |
| G1: `getRoomPowerLevels` 200 → `{ ok:true, content:{...} }` | PASS |
| G2: `getRoomPowerLevels` 404 → `{ ok:false, status:404, error:ERR_NON_2XX }` | PASS |
| G3: `getRoomPowerLevels` 403 → `{ ok:false, status:403, error:ERR_NON_2XX }` | PASS |
| G4: `getRoomPowerLevels` network exception → `ERR_PROXY`; access token never in log payload | PASS |
| G5: `getRoomPowerLevels` roomId encodeURIComponent-passed (`%2F`, `%3A`; `!` passes through per spec) | PASS |
| P1: `putRoomPowerLevels` 200 → `{ ok:true }`; method=PUT, body echoes content byte-for-byte | PASS |
| P2: `putRoomPowerLevels` 403 → `{ ok:false, status:403, error:ERR_NON_2XX }` | PASS |
| P3: `putRoomPowerLevels` AbortError → `{ ok:false, status:504, error:ERR_TIMEOUT }` | PASS |
| C1: `createRoom` no `initialState` → body has NO `initial_state` key (regression guard) | PASS |
| C2: `createRoom` with `initialState` → body has `initial_state` array w/ passed content | PASS |

**registry-rooms.test.ts** — 28 tests (17 pre-existing + 11 new L-suite):

| Test | Outcome |
| ---- | ------- |
| L1: fresh install / birth-locked (both `createRoom` calls carry initialState w/ invariants at 100 + fleet-admin at 100; assertion no-ops post-create) | PASS |
| L2: drift on both rooms → PATCH fires for both; agents preserves `@skynet-admin`; humans preserves `@nelly-admin` AND adds fleet-admin | PASS |
| L3: already-locked → `putRoomPowerLevels` NOT called; `registry_rooms_lockdown_noop` info log fires | PASS |
| L4: RAISE-only (`kick=200` preserved; `invite=0` raised to 100; existing PL 100 humans preserved; fleet-admin added) | PASS |
| L5: GET failure log-and-continue (agents 502 → boot returns ok; `registry_rooms_lockdown_get_failed` warn fires; humans PATCH still fires; agents PATCH does NOT) | PASS |
| L6: PUT failure log-and-continue (403 → boot returns ok; `registry_rooms_lockdown_patch_failed` warn fires; no throw) | PASS |
| L7a: `buildLockdownPowerLevelsContent(null)` → all invariants raised to 100 + fleet-admin at 100; `needsPatch==true` | PASS |
| L7b: `buildLockdownPowerLevelsContent(exact-match)` → `needsPatch==false` | PASS |
| L7c: `users_default` present in input → passes through unchanged | PASS |
| L7d: unrelated fields (`notifications`, `events`) → pass through unchanged | PASS |
| L7e: `assertRegistryRoomLockdown` exported & callable in isolation; no-op on already-locked content | PASS |

All pre-existing tests in both files still pass (regression clean).

## Typecheck result

- `npm run build:backend` → **exit 0** (backend tsc via `tsconfig.node.json`)
- `npm run build` → **exit 0** (full frontend + backend)

## Grep gates (all passed)

| Gate | Expected | Actual |
| ---- | -------- | ------ |
| `grep -c "^export async function \(getRoomPowerLevels\|putRoomPowerLevels\)" src/backend/matrix/matrix-admin-client.ts` | `== 2` | 2 |
| `grep -c "^export async function assertRegistryRoomLockdown" src/backend/relay-sessions/registry-rooms.ts` | `== 1` | 1 |
| `grep -c "^export function buildLockdownPowerLevelsContent" src/backend/relay-sessions/registry-rooms.ts` | `== 1` | 1 |
| `grep -c "assertRegistryRoomLockdown" src/backend/relay-sessions/registry-rooms.ts` | `>= 3` | 5 (1 export + 4 call sites — fast path × 2, slow path × 2) |
| `grep -c "initialState" src/backend/relay-sessions/registry-rooms.ts` | `>= 1` | 2 (comment + createRoom threading) |

Bonus (Task 1 gates):

| Gate | Expected | Actual |
| ---- | -------- | ------ |
| `grep -c "initialState" src/backend/matrix/matrix-admin-client.ts` | `>= 2` | 3 (JSDoc mention + signature field + threading) |

## Deviations from plan

**1. G5 test assertion — `%21` for `!` was wrong; encodeURIComponent does NOT encode `!`.**

The plan's G5 test bullet asserted the encoded URL contains `%21` for `!`. But `encodeURIComponent` per MDN / RFC 3986 does not encode `!` — it's in the reserved-safe set. The implementation follows the exact `getRoomName` scaffolding shape as the plan required (which uses `encodeURIComponent` verbatim), so the test assertion was the incorrect part. Corrected the test to assert `%2F` for `/` and `%3A` for `:` (the actual path-traversal vectors that DO get encoded), plus a regression pin comparing against `encodeURIComponent("!weird/room:server")` verbatim. Zero implementation change — this was a spec-bug in the test bullet, caught during RED-to-GREEN transition.

**2. Type narrowing pattern — used `assertNotOk` from `matrix-admin-narrow.ts` inside the not-ok branch.**

TypeScript's TS 6.0.3 discriminated-union narrowing didn't automatically narrow `AdminErr | GetRoomPowerLevelsOk` inside the `else if (got.status === 404)` clause; needed `assertNotOk(got)` first (matches the established pattern in the codebase — see `matrix-admin-narrow.ts` module-level docstring). Same fix applied on the `put.ok === false` branch. This isn't a plan deviation per se — the plan action step said "try/catch around the whole body" without specifying the narrow tool — but noting here for transparency since I had to fix a `tsc` failure on the first build attempt.

No architectural changes. No new dependencies. No changes to join hooks, `SETTINGS_KEY_*` constants, or the observation-loop side. No deploy.

## Follow-ups for orchestrator

None from this executor. The must_haves are met:

- **Fresh install:** birth-locked via `initial_state` on `createRoom`; post-create assertion no-ops.
- **Drifted room:** boot pass detects invariants below 100 (or missing fleet-admin) and PATCHes them up on the next `ensureRegistryRoomsExist` call.
- **Already-locked room:** boot pass detects zero-diff and issues NO PATCH (`registry_rooms_lockdown_noop` info log fires).
- **Matrix unreachable / permission denied on PATCH:** structured warn log with `roomId` + reason; boot continues; retry happens automatically on next `ensureRegistryRoomsExist` call.

Deploy is orchestrator (tanya) motion — `docker build` + `docker compose up` / `git push` are her call, not this executor's.

## Self-Check

- [x] `src/backend/matrix/matrix-admin-client.ts` modified (getRoomPowerLevels, putRoomPowerLevels, createRoom.initialState added)
- [x] `src/backend/matrix/matrix-admin-client.test.ts` modified (G1-G5, P1-P3, C1-C2 tests added)
- [x] `src/backend/relay-sessions/registry-rooms.ts` modified (assertRegistryRoomLockdown, buildLockdownPowerLevelsContent added; wired into ensureRegistryRoomsExist; createRegistryRoom threads fleetAdminMxid + initialState)
- [x] `src/backend/relay-sessions/registry-rooms.test.ts` modified (L1-L7e tests added; getRoomPowerLevels/putRoomPowerLevels mocked)
- [x] Task 1 commit `5dd60efd` exists in git log
- [x] Task 2 commit `e391567a` exists in git log
- [x] Scoped tests 158/158 passing
- [x] `npm run build:backend` exit 0
- [x] `npm run build` exit 0
- [x] All 5 grep gates pass

## Self-Check: PASSED
