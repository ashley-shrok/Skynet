# Shape: registry rooms come out structurally locked, at creation and on every boot

**Opened:** 2026-09-11
**Vehicle:** gsd quick
**Campaign:** relay-consolidation, shape 2

## What this is

The fleet chat server has two rooms that exist as directories, not conversations. One is the roster of every agent on the fleet; the other is the roster of every human. The app reads them to know who's who. Neither is meant to be a place anyone says anything — they are rosters.

On paper they were open-write, because that's the platform's default. On 2026-09-11 that abstraction became concrete: a coordinator bot took a message meant to be forwarded to one specific agent and delivered it into the ~90-member agent roster instead. Every account joined to that room woke up and rendered the message as a chat bubble. A couple of them replied into the same room, and it cascaded.

This shape makes both rooms structurally incapable of accepting a message from anyone except the fleet-admin account — so it does not matter what a broken caller upstream does, the room itself refuses. The upstream caller bug still deserves its own fix as a separate shape; this one puts a floor under it.

## Shape

The app already has a boot-time pass that walks the two roster rooms — it creates them if they don't exist, or fixes up their metadata if it drifted. Extend that pass to also assert a lockdown property on each room: the fleet-admin account can write, invite, kick, ban, redact, and change room state; everyone else can do none of those things.

The assertion is idempotent. A room that is already locked correctly is a no-op. A room that has drifted — an invariant somewhere is lower than the required level — gets patched. A fresh room that this code creates comes out locked at birth: the lockdown properties are set inline at creation, so there is no window where the room exists in an open state.

The assertion preserves whatever human admins the operator has already promoted to the top level. It only ADDS the fleet-admin account (if it is not already at the top level) and only RAISES defaults; it never demotes anyone and never lowers an existing level.

If the assertion cannot be applied at boot — because the chat server is unreachable, or the account lacks permission to change power on an existing drifted room — the app logs the failure and continues booting. It retries automatically on the next boot. There is no in-app alert channel; the log is the diagnostic surface, checked by the maintainer.

## Philosophy

Structural, not procedural. The point is not "callers should be more careful" or "operators should remember to lock rooms after creation." The point is: the roster room cannot broadcast a message from anyone but admin, regardless of what a caller does upstream. This is a floor, not a suggestion.

Related: no operator escape hatch. If a future intent-change wants one of these rooms to become a directory-plus-chat hybrid, the path is a code change, not a config knob. This is exactly what "structural" is supposed to mean — reshaping the room's purpose is code-level, not runtime-level.

## Prior context

- The two rooms exist to support the sidebar classifier — the app knows who is an agent and who is a human by walking each room's membership.
- On the current primary chat server (which is presently down and being restored), the two rooms already exist and have been partially locked by a manual operator patch this session. The assertion here does not know or care about that manual patch; if the invariants match what it wants, the assertion is a no-op; if they don't, it patches. Either outcome is fine.
- On the second chat server (a co-tenant fleet's own server, which received the same manual lockdown from that fleet's operator earlier today), the same logic applies: manual patch is belt-and-suspenders that becomes redundant once this code ships and their app picks it up on next deploy.
- On a third chat server that this box's app will migrate to next (a separate campaign shape), the two rooms don't exist yet. When they are created, they will be created BY this code, which means they come out locked at birth from day one on that server. That migration is shape 6 of this campaign; this shape ships first so the migration lands on a structurally-sound substrate.

## What would make it wrong

- If the assertion ever silently succeeds while the room is actually still writable by non-admin, it has missed the point. Success has to mean the invariants are actually in place, not "the app tried."
- If the assertion ever strips a legitimate human admin the operator had already promoted, it has missed the point. It ADDS and RAISES; it never REMOVES or LOWERS.
- If the assertion runs on every boot but takes more than a trivial amount of time or emits noise into the general boot log path, it has missed the point. A silent no-op on a well-configured room should feel invisible.
- If a future maintainer can un-lock a room by fiddling with room settings from outside the app, and that un-lock survives the next boot, it has missed the point. The whole design assumes the assertion re-applies every restart.
- If a fresh install ever creates the rooms in an open state — even briefly — it has missed the point. Birth-locked means no observable open window, ever.

## Scope edges

**In:**
- The boot-time pass, extended with a lockdown assertion for the two roster rooms.
- The room-creation path, extended with initial lockdown state so new rooms come out locked at birth.
- Preserve any human admins already promoted to top level.
- Both roster rooms covered — the agent roster and the human roster.
- Tests: fresh install produces locked rooms; drift on an already-open room gets patched on next pass; already-locked rooms are no-ops.
- Log-only failure handling on unreachable / permission-denied cases.

**Out:**
- Cleaning up historical fanout messages in the room. Handled separately as one-off ops actions, tracked in the campaign's "Other work" section.
- Locking down any OTHER rooms besides the two rosters. Chat rooms should NOT be locked; other structural rooms are their own shapes if they need this treatment.
- Fixing the upstream caller bug that CAUSED the fanout in the first place. That is shape 1 of the campaign, blocked on the primary chat server being restored.
- Any in-app alert surface for failure. Log-only is deliberate.
- Config knob to opt out of the assertion on a per-room basis. Deliberately not included — the whole point is structural, not configurable.

**Deferred:**
- Post-migration cleanup of the legacy rooms on the current-primary server (once it is restored and the fleet has moved to the new one). Handled in the migration shape.

**Tempting but no:**
- Broadening the lockdown to "every room this app creates." Roster rooms are special; other rooms should be left alone unless there is a specific reason.
- Backfilling the assertion into some kind of general "boot invariants" framework. This shape scopes to the roster rooms only; if a pattern emerges across other structural rooms later, that's a future refactor.

## Vehicle notes

Vehicle is `/gsd:quick` — the scope is genuinely one file (`src/backend/relay-sessions/registry-rooms.ts`, the boot-time roster-room init) plus unit tests. Not phase-shaped: single file, well-specified invariants, all design decisions already made this session.

The executor's remit is code + tests green. Deploy stays with me as orchestrator per the standing role-file rule (subagents don't do deploys).

**Concrete invariant list** (from the bounty premise, for the executor):
- `events_default: 100` (only PL 100 can send messages)
- `state_default: 100` (only PL 100 can change room state)
- `redact: 100`
- `invite: 100`
- `kick: 100`
- `ban: 100`
- `users`: fleet-admin at 100, plus preserve any existing PL 100 humans
- `historical: 100` (already default; assert anyway)

Applied both via `initial_state` at `createRoom` time AND via a boot-time `PATCH` if drift is detected. Idempotent read-then-optionally-write pattern; no PATCH if already at required levels.

**Fleet-admin identity**: read from wherever the app already knows its admin credentials (the same source that mints and stores the admin at first-run). No new config surface.

**Failure handling**: try/catch around the assertion; on any failure, log a structured warning with room ID + reason and continue booting. Retry happens on next boot pass automatically.

**Test cases** (bounty todo #5):
1. Fresh install: rooms are created and come out with all invariants at PL 100.
2. Drifted room (some invariant below 100): boot pass patches it up to invariants.
3. Already-locked room: boot pass detects no drift and does not issue a PATCH.

**Bounty:** `~/fleet/roles/box-maintainer/bounties/registry-rooms-auto-lockdown-at-creation/bounty.json` (identity: tanya, role: box-maintainer).

**Working repo:** `~/skynet-tanya` on branch `feat/tab-title-from-tmux`. Do NOT use git worktrees (fleet rule).

**Close arc:** `/close registry-rooms-auto-lockdown-at-creation` — reads this file back and verifies conformance both ways.

---

## Close-Out

**Closed:** 2026-09-11
**Vehicle used:** gsd quick
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · Two roster rooms (agents + humans) are the targets; module owns their existence and lockdown.
- **Shape: boot-time pass extended with lockdown assertion** — present · `ensureRegistryRoomsExist` calls `assertRegistryRoomLockdown` on both rooms on both fast and slow paths every boot.
- **Shape: idempotent — locked = no-op, drifted = patched** — present · `buildLockdownPowerLevelsContent` returns `needsPatch`; PUT only fires when true.
- **Shape: birth-locked at creation via `initial_state` (no open window)** — present · `createRegistryRoom` passes `m.room.power_levels` in `initialState`; `createRoom` forwards as `initial_state` in the createRoom request body.
- **Shape: preserve existing admins; only ADD fleet-admin, only RAISE, never LOWER/REMOVE** — present · `Math.max(existing, 100)` on each invariant; users map shallow-copied; fleet-admin only added if missing; `kick=200` preserved in test L4.
- **Shape: log-only failure handling; retry on next boot** — present · try/catch around GET, diff, and PUT; warn logs on all failure branches; `ensureRegistryRoomsExist` still returns `ok:true`.
- **Philosophy: structural not procedural / no operator escape hatch** — present · No config knob, no opt-out; the assertion is unconditional and hard-coded.
- **Prior context: works on existing manually-patched rooms** — present · Read-then-diff pattern is a no-op when invariants already meet target (L3 test); patches only if drift.
- **What would make it wrong: silent success while still writable** — present · Success is only reported after a real GET showed target levels or a real PUT returned ok; no fake-success path.
- **What would make it wrong: strips a legitimate human admin** — present · Users merge is shallow-copy-then-only-add-fleet-admin; L4 test asserts two existing PL-100 humans preserved.
- **What would make it wrong: boot pass takes non-trivial time / emits noise on well-configured rooms** — present · No-op path is one GET + one diff + one info log per room; no PUT, no warn, no visible noise.
- **What would make it wrong: unlock survives next boot** — present · Assertion runs every boot on both fast-path and slow-path; any un-lock is re-locked on next restart.
- **What would make it wrong: fresh install has an observable open window** — present · `initial_state` carries the lockdown `power_levels` at `createRoom` time — L1 test verifies `createRoom`'s `initialState` contains all invariants at 100 plus fleet-admin.
- **Scope edges: IN — boot-time pass, createRoom extension, both rooms, three canonical test cases, log-only failure** — present · All six IN items realized. L1/L2/L3 tests map to fresh-install / drifted / already-locked.
- **Scope edges: OUT — no historical cleanup, no other rooms locked, no upstream caller fix, no in-app alert, no per-room opt-out** — present · None of the OUT items done; scope stayed contained.

### Additions (in the result, not in the shape)

None.

### Follow-ups

None.

### Notes

The implementer added a small belt-and-suspenders: after a fresh `createRoom` (which is already birth-locked via `initial_state`), the code still runs `assertRegistryRoomLockdown` once. This is consistent with the shape's "BOTH via `initial_state` AND via a boot-time PATCH" framing — the boot pass simply doesn't skip the room it just created — and the L1 test verifies it correctly no-ops in that case. Not an addition, just a rigorous reading of the shape. Also worth carrying forward: the exported `PL_INVARIANT_FIELDS` list and `buildLockdownPowerLevelsContent` are cleanly pure and unit-tested (L7a-e); if a future shape needs to broaden or vary the invariant set for another structural room, the merge helper is trivially reusable.
