# Phase 61: WIP Indicator Shell-Idle Gate — Research

**Researched:** 2026-08-26
**Domain:** Fleet-status pipeline extension — harness Stop-hook (per-session write), backend SSH-poll (per-session glob + status-delta tracking), wire schema (two new optional axes), frontend predicate (working-store `main` computation).
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (from 61-CONTEXT.md — do not re-litigate)

1. **Ground-truth positive signal only.** The indicator trusts the harness's Stop-hook fire ("here is proof session ended its turn at time T"). It does NOT trust "status still says shell" as evidence of ongoing work.
2. **New predicate:** `main = busy || (shell && lastStatusChangeAt > lastStopAt)`, with no-Stop-yet defaulting to on. `idle`/`waiting` remain out of `main` (unchanged).
3. **Per-session Stop payload files** on managed boxes. The existing box-wide `~/.claude/fleet-status/last-stop-payload.json` STAYS in place (still carries `backgroundTasks[]`); the per-session file is **additive**, not a replacement.
4. **`lastStatusChangeAt` derived server-side from poll-to-poll status-value deltas.** MUST NOT trust the session-file's `updatedAt` heartbeat (harness bumps `updatedAt` for compose-box typing without a real state transition).
5. **Rollout is LAZY.** No bootstrap step. Existing stale-shell sessions (Poppy, aqua, wilma) stay lit until their next real turn-end, at which point the newly-installed hook writes the per-session file for the first time and the predicate flips.
6. **Passive.** No behavior changes on managed boxes beyond writing an additional small file per turn-end.
7. **Transcript-read alternative rejected.** Higher per-poll bandwidth; we own the hook script install path and it's cheap.

### Claude's Discretion

- Exact filename shape for the per-session Stop file (recommendation: `stop-<session_id>.json`; see § Architecture Patterns).
- Whether the backend reads per-session files via glob + read-per-file each poll, or via a single `find` / cat-many pipeline (see § Common Pitfalls Pitfall 3).
- Whether `lastStatusChangeAt` and `lastStopAt` are BOTH published on the wire, or only `lastStopAt` (with `lastStatusChangeAt` kept fully server-side and folded into a pre-computed `stopIsFresh` boolean that ships on the wire). Recommendation below in § Architecture Patterns.
- Cleanup strategy for old per-session Stop files (whether to piggyback on any existing session-lifecycle cleanup on the managed box, or defer indefinitely).
- Whether to bump the `PidCacheEntry` interface to add `lastStatus: string | null` (recommended for status-delta tracking) or use a separate parallel Map.

### Deferred Ideas (OUT OF SCOPE)

- Bootstrapping stale sessions at deploy time. Accepted as a clean-rollout trade for zero-magic deploy.
- Fixing the root cause upstream in the harness ("always rewrite status to idle on turn end regardless of pre-end state"). Out of our reach.
- Smart cleanup of per-session Stop files for dead sessions.
- Fancier edge cases beyond the compose-box-typing false positive (which is naturally handled by the value-transition derivation).
- Additional signals for other harness-lied-about states.

</user_constraints>

<phase_requirements>
## Phase Requirements

*Phase 61 has no formal REQ-IDs in `REQUIREMENTS.md` (the fleet-status pipeline was shipped in Phase 34 which pre-dated the REQ-ID convention for that subsystem). The phase's success criteria are captured verbatim from `61-CONTEXT.md`.*

| ID (local) | Behavior | Research Support |
|----|----------|------------------|
| WIP-01 | Stop hook writes a per-session file `stop-<session_id>.json` (in addition to the existing box-wide `last-stop-payload.json`) at every turn-end, atomically. | § Code Examples "Stop hook — additive per-session write". Existing box-wide write pattern preserved verbatim so `backgroundTasks[]` continues to work. |
| WIP-02 | `remote-hook-install.ts` reinstalls the updated `stop-hook.sh` script on every fleet-status subscriber lifecycle (existing behavior — `hookInstallAttempted` is cleared on `onLastUnsubscriber`). Existing hosts pick up the new script automatically on next subscribe. | § Code Examples "Install path — no code change needed". |
| WIP-03 | Backend per-poll reads any newly-arrived `stop-<session_id>.json` files and extracts each session's `lastStopAt` (unix millis). Reads are batched with the existing per-PID parallel fetches. Missing/malformed → treated as no-stop-yet (fail-open like the box-wide file). | § Architecture Patterns "Per-session file globbing". § Code Examples "Backend read pattern". |
| WIP-04 | Backend tracks `lastStatusChangeAt` per PID in `PidCacheEntry` — updated whenever the current tick's `sessionJson.status` differs from the cached previous tick's status. First-appearance PIDs seed `lastStatusChangeAt` to the current poll's `now()`. | § Code Examples "Status-delta tracking". |
| WIP-05 | New optional wire fields on `SessionStateSchema`: `lastStopAt?: number \| null` and `lastStatusChangeAt?: number \| null`. Both `.optional().nullable()`. `FRAME_SCHEMA_VERSION` stays at 1 (additive-optional invariant established by Phase 41). | § Architecture Patterns "Wire schema — the additive-axis pattern". |
| WIP-06 | Both new fields participate in `computeFingerprint` — a change to either causes `publishSessionState`. | § Common Pitfalls Pitfall 1. |
| WIP-07 | Frontend `session-working-store.ts` `main` predicate becomes: `busy || (shell && (lastStopAt === null || lastStatusChangeAt > lastStopAt))`. No-Stop-yet (`lastStopAt === null`) defaults to on, matching the CONTEXT.md rule. `WorkingRecord` gains cached `lastStopAt` and `lastStatusChangeAt`. Both consumers (WipBubble in PrettyView + row dot in PrettyConversationRow) inherit the fix through the existing `useSessionIsWorking` hook — no consumer-site changes required. | § Code Examples "Frontend predicate". |
| WIP-08 | New backend tests cover the four canonical cases (busy → still on; shell with stale stop → OFF; shell mid-turn with no-stop-yet → on; shell mid-turn with lastStatusChangeAt > lastStopAt → on) + additive-axis wire schema tests (mirror the Phase 52/53 pattern). | § Validation Architecture. |
| WIP-09 | Frontend tests mirror the four canonical cases at the `useSessionIsWorking` boundary. Existing Test B (`shell + bg:[] → true` per inline-260823-wip-shell-is-work) is REVISED — shell alone no longer means "on"; it means "on only if the stop-gate says so." | § Validation Architecture. |
| WIP-10 | The wire's byte-shape stays back-compat: a watcher pre-dating Phase 61 that omits the new fields is parsed cleanly (fields default `undefined` → treated as null → default-on gate → indicator behavior identical to today's on-shell). | § Code Examples "Wire schema — back-compat test pattern". |

</phase_requirements>

---

## Summary

Phase 61 is a **fifth-slice** in a long-running pattern of additive-axis extensions to the fleet-status pipeline. The exact playbook — Phase 41 (`lastMessageAt`), Phase 47 (`aiTitle`), Phase 52 (`dormant`), Phase 53 (`recycling`) — has been executed four times in the past four months on this same codebase. Each phase adds one or two optional-nullable axes to `SessionStateSchema`, extends `computeFingerprint`, plumbs the derivation into `ssh-poll-orchestrator.processPid`, extends `WorkingRecord` in `session-working-store.ts`, and (optionally) adds a new hook for consumers. `FRAME_SCHEMA_VERSION` has been held at 1 through every one of those extensions.

The new-in-Phase-57 wrinkles are:

1. **Two axes together, not one.** `lastStopAt` comes from a new per-session Stop payload file; `lastStatusChangeAt` is derived server-side from status-delta tracking against the cached previous tick.
2. **The Stop hook shell script needs a small edit** — the first change to `stop-hook.sh` since Phase 34 shipped. The change is 3 lines (parse `session_id` out of the piped stdin JSON, compute a second target path, atomic-write to it as well). The install path automatically ships the new script on next lifecycle (`hookInstallAttempted` is cleared on `onLastUnsubscriber`, and `installStopHook` is idempotent + re-writes the script from `STOP_HOOK_SCRIPT_CONTENTS`).
3. **Backend `processPid` gains status-delta tracking.** The current `PidCacheEntry.lastPublishedFingerprint` includes `status`, so a compare is already possible, but a dedicated cached `lastStatus` field is cleaner and makes the derivation loud in code review.
4. **The predicate change lives at ONE line** in `session-working-store.ts` (line 207, the `main =` computation). Both consumer surfaces inherit the fix through `useSessionIsWorking` — no consumer-site edits.

**Primary recommendation:** Model this phase as **four plans** —

- **61-01** — Stop hook edit + wire schema extension (backend types + fleet-status-types.ts mirror). Foundation, no runtime behavior changes yet.
- **61-02** — Backend `processPid` extension: per-session file glob + read, status-delta tracking, stamp both axes into `SessionState`, extend fingerprint. Backend tests.
- **61-03** — Frontend `session-working-store` extension: `WorkingRecord` gains two axes, `main` predicate updated. Frontend tests. **Also**: revise the existing session-working-store Test B ("`shell` + bg:[] → true") to reflect the new gate.
- **57-04** — Deploy checkpoint + UAT verification (lazy rollout — Ashley walks through Poppy/aqua/wilma, confirms next turn-end flips the indicator off correctly).

Note: 61-03 is technically parallelizable with 61-02 given clean wire contract in 61-01, but sequential is simpler and matches the Phase 53/52 pattern.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Turn-end event capture | Managed box (Claude Code harness → Stop hook) | — | Harness fires the Stop hook synchronously on turn-end; the hook is our observation point. |
| Per-session Stop file write | Managed box (our `stop-hook.sh` bash script) | — | Hook stdin JSON carries `session_id`; the shell script uses it to derive the target path. |
| Status-value delta tracking | API / Backend (`ssh-poll-orchestrator.processPid`) | — | Compares this-tick `sessionJson.status` to the previous-tick's cached value in `PidCacheEntry`. Managed box has no state machine here. |
| Wire publication of both axes | API / Backend (fleet-status registry) | — | Existing `publishSessionState` path unchanged; both axes participate in `computeFingerprint`. |
| Predicate composition | Frontend store (`session-working-store.ts`) | — | Single line change at line 207. Both consumer surfaces (WipBubble, row dot) inherit via `useSessionIsWorking`. |
| WipBubble render | Frontend (`PrettyView.tsx`) | — | Reads `useSessionIsWorking(sessionWorkingKey)`. No code change here. |
| Row dot render | Frontend (`PrettyConversationRow.tsx` + `PrettyConversationsPanel.tsx` wrapper) | — | Reads `useSessionIsWorking(sessionKey)`. No code change here. |

---

## Standard Stack

No new packages installed. All changes use existing infrastructure. This is a fifth-slice of the same subsystem extended by Phases 41 / 47 / 52 / 53.

### In-Scope Files

| File | Change Type | Purpose |
|------|-------------|---------|
| `src/backend/fleet-status/stop-hook.sh` | Small addition | Additive per-session file write alongside existing box-wide write. |
| `src/backend/fleet-status/remote-hook-install.ts` | Update `STOP_HOOK_SCRIPT_CONTENTS` constant | The inlined script constant must stay byte-for-byte in sync with `stop-hook.sh` (Test 11 in `remote-hook-install.test.ts` asserts this). Update both together in the same commit. |
| `src/backend/fleet-status/wire-protocol.ts` | Add two optional fields | `lastStopAt` + `lastStatusChangeAt` on `SessionStateSchema`; extend `computeFingerprint`. |
| `src/ui/api/fleet-status-types.ts` | Mirror two optional fields | Frontend-side `SessionState` interface — MUST stay in lockstep with backend schema. |
| `src/backend/fleet-status/ssh-poll-orchestrator.ts` | Extend `processPid` + `PidCacheEntry` | Per-session file glob + read + parse; status-delta tracking; stamp both derived axes. |
| `src/ui/state/session-working-store.ts` | Extend `WorkingRecord` + update `main` predicate + add Axis F / G reconciliation blocks | Two new cached axes + revised `main` computation on line 207. |
| `src/backend/fleet-status/stop-hook.sh` | (same file, listed twice for emphasis) | The `.sh` source is authoritative; `STOP_HOOK_SCRIPT_CONTENTS` in `.ts` is a drift-checked copy. |

### Test Files Touched

| File | Change Type |
|------|-------------|
| `src/backend/fleet-status/wire-protocol.test.ts` | Add tests for `lastStopAt` + `lastStatusChangeAt` following the P41/P47/P52/P53 patterns (forward-number, forward-null, back-compat-omitted, type-enforcement, schema-version-unchanged). |
| `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` | Add describe block covering per-session Stop file read + status-delta cache + fingerprint inclusion. |
| `src/ui/state/session-working-store.test.ts` | REVISE Test B (`shell + bg:[] → true` → `shell + bg:[] + no-stop → true` (default-on) AND add cases for `shell + stale-stop → false` + `shell + fresh-status-change → true`). Add cases for the new axes. |
| `src/backend/fleet-status/remote-hook-install.test.ts` | Test 11 (byte-equality of `STOP_HOOK_SCRIPT_CONTENTS` vs `stop-hook.sh`) will fail until both are updated together; not a new test, just a fixture update. |

### Files That MUST NOT Change

- `src/backend/starter.ts` — orchestrator wiring is fine as-is; `hookInstallAttempted.clear()` on `onLastUnsubscriber` already re-attempts install on next lifecycle.
- `src/backend/fleet-status/subscription-registry.ts` — the delta gate for publish only cares about fingerprint changes, which extend automatically.
- `src/backend/fleet-status/fleet-status-server.ts` — WebSocket transport is agnostic to `SessionState` shape.
- `src/ui/features/pretty-view/PrettyView.tsx` — consumes `useSessionIsWorking` (line 1172); the predicate change is invisible here.
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — same; consumes `useSessionIsWorking` via the wrapper.

### Alternatives Considered

| Instead of | Could Use | Tradeoff (why we do not) |
|------------|-----------|--------------------------|
| Per-session Stop files on the managed box | Transcript tail-read on each poll cycle to detect `<command-name>/exit</command-name>` markers | Higher per-poll bandwidth (already noted in CONTEXT); requires re-implementing exit-marker detection in the orchestrator. |
| Server-derived `lastStatusChangeAt` from poll-to-poll deltas | Trust `sessionJson.updatedAt` from the harness | Ruled out in CONTEXT — harness bumps `updatedAt` on compose-box typing without a real state transition. |
| Publishing both new axes on the wire | Publishing a pre-computed `stopIsFresh: boolean` from the backend and hiding the two raw axes | Frontend testing is cleaner and telemetry richer when both raw axes are visible; the fingerprint benefits from raw axis granularity too. Recommendation: publish both. |
| Additive **plus** cleanup on managed box | Cleanup step to delete `stop-<session_id>.json` for dead sessions | CONTEXT defers cleanup. Files are ~500 bytes each; ~1000 sessions/year = 500KB/year worst case per box. Not worth the complexity in v1. |

**Installation:** No new packages.

**Version verification:** N/A — no new packages.

---

## Package Legitimacy Audit

**No external packages installed.** Package legitimacy gate: N/A.

---

## Architecture Patterns

### System Architecture Diagram

```
Claude Code harness (managed box)
  └─ fires Stop hook on turn-end with stdin JSON:
       {session_id, transcript_path, cwd, permission_mode,
        hook_event_name:"Stop", stop_hook_active, background_tasks[]}

stop-hook.sh (our script, dropped by remote-hook-install.ts)
  ├─ [existing] atomic-write to ~/.claude/fleet-status/last-stop-payload.json
  │             (box-wide file — carries backgroundTasks[] for source A)
  └─ [NEW]      parse session_id from stdin, atomic-write to
                ~/.claude/fleet-status/stop-<session_id>.json
                (per-session file — carries the same payload; the ts of the
                 write IS the lastStopAt signal via file mtime OR embedded ts)

ssh-poll-orchestrator (Skynet backend, per 2s tick, per host)
  ├─ [existing] ls ~/.claude/sessions/*.json → PID list
  ├─ [existing] Per PID: read session-JSON + /proc stat + box-wide hook payload
  ├─ [NEW]      Per PID: read the paired ~/.claude/fleet-status/stop-<sessionId>.json
  │             (already know sessionId from parseSessionJson result)
  │             → derive lastStopAt (unix millis, either from file's embedded
  │                ts or from `stat -c %Y` if we go the mtime route)
  ├─ [NEW]      Status-delta tracking: compare this-tick sessionJson.status to
  │             cached previous-tick status. If different, update
  │             cachedLastStatusChangeAt = now(). If same, keep cached.
  │             First appearance: seed to now().
  ├─ compose SessionState { …, lastStopAt, lastStatusChangeAt }
  └─ computeFingerprint() — both new axes participate

fleet-status registry → WebSocket → browser

session-working-store (browser)
  └─ publishFleetStatusSessionState()
       ├─ Axis A: isWorking (REVISED — main now includes stop-gate)
       ├─ Axis B: lastMessageAt        [Phase 41]
       ├─ Axis C: aiTitle              [Phase 47]
       ├─ Axis D: dormant              [Phase 52]
       ├─ Axis E: recycling            [Phase 53]
       ├─ Axis F: lastStopAt           [NEW Phase 61 — cached for the main predicate]
       └─ Axis G: lastStatusChangeAt   [NEW Phase 61 — cached for the main predicate]

Consumers (unchanged surface):
  PrettyView.tsx WipBubble render — useSessionIsWorking(sessionWorkingKey)
  PrettyConversationRow.tsx dot — useSessionIsWorking(sessionKey)
```

### Wire schema — the additive-axis pattern

This has been executed FOUR times in the past four months (Phases 41 / 47 / 52 / 53). The invariant is:

- Every new field is `.optional().nullable()` — never required.
- `FRAME_SCHEMA_VERSION` stays at 1. There is a dedicated test in each phase (`Test P{XX}-01 F` / `A-guard`) that asserts the version constant did NOT bump.
- The frontend mirror at `src/ui/api/fleet-status-types.ts` MUST be updated in the same commit — the frontend has no zod validation, so a missed mirror update is invisible until runtime (though `strict: false` in `tsconfig.app.json` means the field is accessible either way; this is a documentation-parity concern flagged as a real bug in Phase 53 RESEARCH Pitfall 7).
- `computeFingerprint` in the orchestrator MUST include the new axis. Each addition is a segment appended to the template literal on ssh-poll-orchestrator.ts line 537.

**Both new axes SHOULD be published on the wire** (see Alternatives Considered above). The alternative — pre-computing `stopIsFresh` server-side — is possible but reduces telemetry granularity and complicates the wire's back-compat story (a pre-Phase-57 backend would omit the pre-computed field entirely, and the frontend would then need a fallback path).

### Per-session file globbing — design choice

The backend has three plausible ways to read per-session Stop files each tick:

1. **`ls ~/.claude/fleet-status/stop-*.json` + `cat` each one** — one extra SSH round-trip per file, N reads per host per tick.
2. **`find ~/.claude/fleet-status -name 'stop-*.json' -printf '%f %T@\n'` + read only newly-mtime-advanced files** — cheap globbing pass first, cat only newly-changed.
3. **Read the specific file for each PID's known sessionId directly**: `cat ~/.claude/fleet-status/stop-<sessionId>.json 2>/dev/null || true`, batched into the existing per-PID `Promise.all` at ssh-poll-orchestrator.ts:977.

**Recommendation: option 3.** The orchestrator already knows each PID's `sessionId` (from `parseSessionJson.result.sessionId`), so a directed cat per PID is exactly parallel to the existing box-wide `hookPayloadPromise` (line 971) and adds one round-trip per tick per PID (which is already the shape of the loop). This avoids a separate glob step, avoids read-per-file `find` complexity, and stays inside the per-PID `Promise.all` batching that already delivers session-JSON + stat + box-wide-hook in parallel. The cost is negligible — one small file per live PID per tick — matching what the box-wide hook payload read already does.

Option 1 (glob + read-all) has one advantage: it does not require knowing sessionId up front, which could matter for the source-B (dormant-only identity) path. But source B doesn't need `lastStopAt` — dormant identities aren't in `main`, and the stop-gate only fires for the `shell` case which requires a live PID. So option 3 is complete.

### Status-delta tracking — cache pattern

The `PidCacheEntry` at ssh-poll-orchestrator.ts:110 already has similar per-tick derivation cache patterns for `lastMessageAt`, `aiTitle`, and `dormant`. Add:

```typescript
interface PidCacheEntry {
  // ...existing fields...
  // Phase 61: the previous tick's sessionJson.status value, used to detect
  // status-value transitions for the lastStatusChangeAt derivation.
  // null on cold-start (first tick sees a PID with no prior comparison basis
  // → seed lastStatusChangeAt to now()).
  lastStatus: "busy" | "shell" | "idle" | "waiting" | null;
  // Phase 61: unix millis of the most recent poll tick where sessionJson.status
  // transitioned to a different value. Seeded to now() on first appearance;
  // updated whenever the current tick's status !== cached lastStatus.
  // Preserved across ticks otherwise (a "same status" tick does NOT bump).
  lastStatusChangeAt: number;
  // Phase 61: unix millis derived from the per-session Stop file. null when
  // the file does not exist (session has never had a turn end since the
  // hook was installed). Cache-preserved across SSH hiccups (transient null
  // returns preserve prior value, matching lastMessageAt / aiTitle patterns).
  lastStopAt: number | null;
}
```

**Seeding rule:** on the FIRST tick for a PID (`isNew === true`, which the code already tracks at ssh-poll-orchestrator.ts:964), set `lastStatusChangeAt = deps.now()` and `lastStatus = sessionJson.status`. This gives the front-end predicate an immediate "one poll ago was NOW" reading which — combined with `lastStopAt === null` on a fresh session — correctly defaults the indicator on.

### Predicate change — the one-line edit

Current (`session-working-store.ts` line 206–207):

```typescript
const main =
  state_arg.status === "busy" || state_arg.status === "shell";
```

Revised:

```typescript
// Phase 61 (WIP-shell-idle-gate): shell only counts as work if the session's
// status has actually TRANSITIONED since its last Stop-hook fire. no-stop-yet
// (lastStopAt === null / undefined) defaults to on — no evidence of any
// completed turn yet, treat as still working (rollout safety).
const stopIsFresh =
  state_arg.lastStopAt !== null &&
  state_arg.lastStopAt !== undefined &&
  state_arg.lastStatusChangeAt !== null &&
  state_arg.lastStatusChangeAt !== undefined &&
  state_arg.lastStatusChangeAt > state_arg.lastStopAt;
const shellIsWork = state_arg.status === "shell" && !stopIsFresh
  ? false
  : state_arg.status === "shell";
// Wait — clearer as a positive predicate:
const shellCountsAsWork =
  state_arg.status === "shell" &&
  (state_arg.lastStopAt === null ||
    state_arg.lastStopAt === undefined ||
    (state_arg.lastStatusChangeAt ?? Infinity) > state_arg.lastStopAt);
const main =
  state_arg.status === "busy" || shellCountsAsWork;
```

**Cache preservation:** the two new axes (`lastStopAt`, `lastStatusChangeAt`) MUST participate in the `WorkingRecord` — and the Axis-A republish path (line 258–264) must preserve them when the isWorking axis fires. This is exactly the Pitfall-3 pattern flagged in Phase 53 RESEARCH.md (Axis A must preserve ALL other axes from cache). See § Common Pitfalls Pitfall 3 below.

### Recommended File Structure

No new files. One file (`stop-hook.sh`) gets an additive block. Six existing files are extended (5 source + `remote-hook-install.ts` constant sync).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Turn-end detection | Custom Claude-Code JSONL tail parser looking for `<command-name>/exit</command-name>` or completion markers | The harness Stop hook (already installed on every fleet-status host by Phase 34 Plan 04) | The hook is the harness's own turn-end signal; the JSONL tail is a lossy reconstruction. |
| Per-session Stop file management on managed box | New Node subprocess, new daemon, watch-directory listener | Additive lines in the existing bash `stop-hook.sh` | The hook is already installed, already idempotent, already atomic-writes. Adding one more atomic-write is a 4-line delta. |
| Wire-schema axis discipline | New JSON envelope, new discriminator, new schema version | Optional-nullable fields on `SessionStateSchema` + `FRAME_SCHEMA_VERSION = 1` unchanged | This is the fourth axis extension in five phases — the pattern is battle-tested. Bumping the version would be a breaking change with no benefit. |
| Boolean axis on frontend store | New `session-stop-gate-store.ts` module | Axis F + G on `session-working-store` (extend `WorkingRecord`) | Phase 53 explicitly retired a parallel store (`session-recycling-store`) for this exact reason (unmounted-pane blindness). One store is authoritative for all fleet-status-derived signals. |
| Fingerprint accounting | Separate hash / separate delta detection | Extend the existing `computeFingerprint` template literal (line 537 of ssh-poll-orchestrator.ts) | Guarantees axis-only flips publish. Same pattern used by dormant + recycling. |
| Status-transition detection on managed box | New `.status-changed-at` sentinel file written by the harness (which does not exist) | Server-side compare of this-tick vs cached-previous-tick `sessionJson.status` in `processPid` | Managed box is passive per CONTEXT — no new writes beyond the Stop hook. The comparison is trivial on our side. |

**Key insight:** *This phase is literally the fifth iteration of a well-worn pattern.* Every complexity concern that surfaces should be answered "how did Phase 52/53 handle this?" If the answer is "the same way," do it the same way.

---

## Runtime State Inventory

This is not a rename/refactor/migration phase. However, there is a small runtime-state footprint worth noting for the planner:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `~/.claude/fleet-status/last-stop-payload.json` on each managed box (per-box, single file) — STAYS AS-IS. New per-session files `~/.claude/fleet-status/stop-<sessionId>.json` accumulate on each managed box, one per session that has ever completed a turn. Approx size: <1KB each. | No migration. Files auto-appear as sessions complete turns post-deploy. |
| Live service config | None — the harness's own settings.json entry pointing at `~/.claude/hooks/skynet-fleet-status-stop.sh` is unchanged (same path, same command). `remote-hook-install.ts` re-writes the script's contents but preserves the settings.json entry byte-for-byte via `readAndMergeStopHookSettings` idempotency. | No action. |
| OS-registered state | None. | — |
| Secrets and env vars | None. | — |
| Build artifacts / installed packages | `STOP_HOOK_SCRIPT_CONTENTS` constant in `dist/backend/fleet-status/remote-hook-install.js` is a compile-time inline of the `.sh` file contents. After the `.sh` edit, `tsc` must rebuild the backend for the new script contents to reach the deployed binary. This is the normal deploy path — no special action. | Standard `docker compose build && up -d` — no manual step. |

**Lazy rollout mechanics (verified by reading `starter.ts:346, 546, 469`):**
1. `hookInstallAttempted` is a Set of hostIds that had `installStopHook` called in the current fleet-status-subscriber lifecycle.
2. It is `.clear()`-ed inside `onLastUnsubscriber` (line 546) so the NEXT fleet-status subscriber re-attempts install on every host.
3. `installStopHook` writes the script contents fresh every time (it does NOT check whether the script bytes match — it just overwrites via heredoc + mv + chmod +x).
4. The Set is also cleared per-host in `releaseSshChannel` (line 469) so a re-added host re-installs.

Therefore: as soon as Ashley opens the Skynet UI after the deploy, every currently-connected host gets the new hook script written to disk on the next `acquireSshChannel` call. Existing sessions on those boxes carry the OLD hook (which fires the box-wide-file-only write) until their next turn-end, at which point the NEW hook fires and writes the per-session file for the first time. The Skynet backend's poll cycle sees the new file appear on its next tick and starts including `lastStopAt` for that session. The predicate flips.

**Poppy / aqua / wilma today (per CONTEXT):** they are `status: shell` with no per-session file yet. `lastStopAt === null` → default-on → indicator stays lit (correct — we cannot prove they are done). On their next real turn-end, per-session file appears, `lastStopAt` gets a value, `lastStatusChangeAt` was set on their last real status transition (which was days ago), the predicate reads `shell && lastStatusChangeAt < lastStopAt` → NOT work → indicator off. Ashley's UAT is exactly this scenario.

---

## Common Pitfalls

### Pitfall 1: Not accounting for new axes in `computeFingerprint`
**What goes wrong:** `lastStopAt` or `lastStatusChangeAt` changes but no new `SessionState` frame is emitted because the fingerprint didn't change.
**Why it happens:** Adding fields to `SessionState` but forgetting the corresponding segment on `computeFingerprint` (ssh-poll-orchestrator.ts:537).
**How to avoid:** Extend the template literal with `|${state.lastStopAt ?? ""}|${state.lastStatusChangeAt ?? ""}`. Model on Phase 52's dormant pattern (`|${state.dormant === true ? "1" : ...}`) — for numeric fields, `?? ""` is fine.
**Warning signs:** Backend log `fleet_status_session_state_published` fires on status changes but not on stop-file arrivals; frontend indicator lags behind real-world Stop-hook events.

### Pitfall 2: Byte-drift between `stop-hook.sh` file and `STOP_HOOK_SCRIPT_CONTENTS` constant
**What goes wrong:** The two copies diverge; deployed hosts get the OLD script (from the inlined constant) even though the `.sh` was edited.
**Why it happens:** Editing `stop-hook.sh` without updating the constant in `remote-hook-install.ts`.
**How to avoid:** Test 11 in `remote-hook-install.test.ts` asserts byte-exact equality. Run `npx vitest run src/backend/fleet-status/remote-hook-install` after editing either file. Do the edit in one commit that touches both.
**Warning signs:** Test 11 fails at CI. Deployed script has old behavior even after re-deploy.

### Pitfall 3: Axis F / G not preserved on Axis A republish (Phase-53-P3 pattern)
**What goes wrong:** When `isWorking` changes (Axis A fires) but the frame carries no fresh `lastStopAt` (undefined on the wire because backend published no change), the Axis A block's `nextMap.set(...)` overwrites cached `lastStopAt` with `null` or `undefined`.
**Why it happens:** Copying the Axis A `nextMap.set(...)` block without adding `lastStopAt: existing?.lastStopAt ?? null` and `lastStatusChangeAt: existing?.lastStatusChangeAt ?? null`.
**How to avoid:** Every Axis (A, B, C, D, E) MUST preserve ALL other axes from cache. This is a documented invariant on session-working-store.ts:232–235 for the existing five axes; extend the same pattern to Axes F + G. See Phase 53 RESEARCH Pitfall 3 for the exact bug this prevents.
**Warning signs:** `lastStopAt` briefly appears in the cache then disappears on the next unrelated frame; indicator flickers between correct-off and default-on.

### Pitfall 4: Trusting `sessionJson.updatedAt` for `lastStatusChangeAt`
**What goes wrong:** The `sessionJson.updatedAt` field bumps whenever the harness rewrites the session file — including on compose-box typing that never submits. Using it as `lastStatusChangeAt` would falsely register "the status changed" on every keystroke while Ashley is typing, defeating the entire purpose of the stop-gate.
**Why it happens:** `updatedAt` is right there in the parsed sessionJson, easy to grab.
**How to avoid:** Derive `lastStatusChangeAt` PURELY from server-side status-value delta tracking. Compare `sessionJson.status` (this tick) to `PidCacheEntry.lastStatus` (previous tick). Only update `lastStatusChangeAt = deps.now()` when they DIFFER. `updatedAt` MUST NOT feed this derivation. This is called out in CONTEXT.md as a locked decision.
**Warning signs:** Indicator flickers back on every time Ashley types a character in the compose box.

### Pitfall 5: Publishing before status-delta cache is seeded (first-tick correctness)
**What goes wrong:** On the FIRST tick a PID is seen, there is no cached `lastStatus` to compare against. If the code defaults `lastStatusChangeAt` to 0 (unix epoch), then `shell && lastStatusChangeAt > lastStopAt` is always false (any non-null Stop is fresher than epoch) → newly-appearing shell sessions incorrectly go dark on first appearance.
**Why it happens:** Treating "first tick" as "no status change" (which is logically true but produces the wrong signal).
**How to avoid:** On `isNew === true`, seed `lastStatusChangeAt = deps.now()`. First-tick sessions read as "just changed to X now" — combined with `lastStopAt === null` (no per-session file yet for a fresh PID), the predicate defaults on.
**Warning signs:** Freshly-launched Claude sessions appear as WIP=false in the first poll cycle even when they are actively working. Poppy-style false positives from the OTHER direction.

### Pitfall 6: Per-session file grows unbounded on active boxes
**What goes wrong:** Boxes with high session churn (identity recycles, `/id reset` cycles, new session creation) accumulate hundreds/thousands of `stop-<sessionId>.json` files over time.
**Why it happens:** No cleanup. CONTEXT explicitly defers cleanup.
**How to avoid:** Accept it (documented tradeoff). At <1KB per file, 1000 sessions/year on a busy box is ~1MB/year — safely below any noticeable disk-usage threshold. Ashley can `rm -rf ~/.claude/fleet-status/stop-*.json` manually if it ever becomes an issue. If a future phase wants cleanup, hook it into whatever session-lifecycle cleanup already exists on the managed box.
**Warning signs:** Would only surface as a disk-space alert on a managed box after years of use.

### Pitfall 7: Frontend mirror at `fleet-status-types.ts` missed
**What goes wrong:** Backend adds `lastStopAt` and `lastStatusChangeAt` to `SessionStateSchema` but the frontend `SessionState` interface at `src/ui/api/fleet-status-types.ts` is not updated. Because `strict: false` in `tsconfig.app.json`, `state_arg.lastStopAt` compiles fine but is undocumented and confusing for future readers.
**Why it happens:** Same reason Phase 52 missed adding `dormant` — the frontend has no zod validation and the field access silently works.
**How to avoid:** ADD `lastStopAt?: number | null` and `lastStatusChangeAt?: number | null` to the frontend `SessionState` interface in the same commit that changes the backend schema. This is a lockstep contract; see Phase 53 RESEARCH Pitfall 7 for the exact recurrence.
**Warning signs:** No compile error, no test failure, but grep for `lastStopAt` in `src/ui/` returns hits only in code, not in type definitions.

### Pitfall 8: Skipped Test B revision in session-working-store.test.ts
**What goes wrong:** The existing Test B (line 96, `session-working-store.test.ts`) asserts `status:'shell' → useSessionIsWorking returns true (shell IS real tool-execution work)` — with a comment block explicitly locking that behavior to `inline-260823-wip-shell-is-work`. Phase 61 changes this rule (shell only counts if the stop-gate says so). If Test B is left unchanged, either the test will fail (correct) OR someone will "fix" the new implementation to keep passing the old test (wrong).
**Why it happens:** Missing that the existing test locks the OLD behavior.
**How to avoid:** Explicitly revise Test B in Plan 61-03. Change the test to `status:'shell' + no-Stop-yet → useSessionIsWorking returns true (default-on rollout safety)`. Add sibling tests for the four canonical cases (busy → on; shell + stale-stop → OFF; shell + no-stop → on; shell + fresh-status-change → on).
**Warning signs:** Test file diff omits Test B modification.

---

## Code Examples

### Stop hook — additive per-session write [ASSUMED — extrapolated from existing script pattern]

The current script (verified from `stop-hook.sh`):

```bash
#!/bin/bash
set -eu
PAYLOAD_DIR="${HOME}/.claude/fleet-status"
PAYLOAD_FILE="${PAYLOAD_DIR}/last-stop-payload.json"
TMP_FILE="${PAYLOAD_FILE}.$$.tmp"
mkdir -p "${PAYLOAD_DIR}"
timeout 2 sh -c "cat > '${TMP_FILE}' && mv '${TMP_FILE}' '${PAYLOAD_FILE}'" || true
exit 0
```

**Recommended Phase 61 edit** — read stdin once into a variable, extract `session_id` via a lightweight bash JSON extraction (or invoke `jq` if available; recommendation: prefer a shell-native regex to avoid a dependency on `jq` being present on every managed box), then write BOTH files. Concrete shape (planner to firm up):

```bash
#!/bin/bash
set -eu
PAYLOAD_DIR="${HOME}/.claude/fleet-status"
PAYLOAD_FILE="${PAYLOAD_DIR}/last-stop-payload.json"
BOX_TMP_FILE="${PAYLOAD_FILE}.$$.tmp"
mkdir -p "${PAYLOAD_DIR}"

# Read stdin ONCE into a variable — the hook receives one JSON document.
# Timeout still protects the whole operation.
timeout 2 sh -c '
  payload="$(cat)"
  # Write the box-wide file (existing behavior — carries backgroundTasks[]).
  printf "%s" "$payload" > "'"$BOX_TMP_FILE"'"
  mv "'"$BOX_TMP_FILE"'" "'"$PAYLOAD_FILE"'"
  # Extract session_id via bash-native regex (avoids jq dependency).
  # StopHookPayload.session_id is a UUID-shaped string per Claude Code v2.1.150.
  if [[ "$payload" =~ \"session_id\"[[:space:]]*:[[:space:]]*\"([a-zA-Z0-9_-]+)\" ]]; then
    sid="${BASH_REMATCH[1]}"
    per_session_file="'"$PAYLOAD_DIR"'/stop-${sid}.json"
    per_session_tmp="${per_session_file}.$$.tmp"
    printf "%s" "$payload" > "$per_session_tmp"
    mv "$per_session_tmp" "$per_session_file"
  fi
' || true
exit 0
```

Notes for the planner:
- The regex extraction is best-effort — if it fails (malformed stdin, unexpected key ordering), the per-session file is not written but the box-wide file IS written (existing behavior preserved). Failure mode matches existing "fail-open on missing hook payload" semantics.
- `[[ =~ ]]` is bash-specific. The current script uses `#!/bin/bash` so this is fine; a subshell `sh -c` with `[[` requires the interpreter to be bash-compatible. Given the current script already relies on `bash`, this is safe.
- The `timeout 2 sh -c ...` wrapper needs to be a bash `sh -c` (which invokes /bin/sh, which may be dash on some distros). Wrap the inner logic in `bash -c` instead: `timeout 2 bash -c '...'`. Verify against actual managed boxes as a task-list item.
- The embedded timestamp: the payload's fields do NOT include a top-level `ts` — the backend derives `lastStopAt` from the file's mtime (`stat -c %Y stop-<sessionId>.json`) OR the backend can wrap-write and prepend a timestamp before the JSON body. Simplest: mtime. See "Backend read pattern" below.

Alternative shape — pure `awk` or `grep -Po` extraction — if the regex approach proves fragile:

```bash
sid=$(printf '%s' "$payload" | grep -oP '"session_id"\s*:\s*"\K[a-zA-Z0-9_-]+' | head -1)
```

Requires `grep -P` (Perl-compatible), which is available on all modern Linux distros but not on Alpine's busybox `grep`. Verify against the actual managed box set.

**MUST NOT** blocking-wait beyond the existing `timeout 2` — the hook fires synchronously during turn completion and Claude Code's harness must not be stalled.

### Install path — no code change needed [VERIFIED: codebase]

`remote-hook-install.ts` already:
- Inlines the script contents as `STOP_HOOK_SCRIPT_CONTENTS` (lines 73–93).
- Overwrites the deployed script on every `installStopHook` call (heredoc `.tmp` + `mv` + `chmod +x`; lines 247–252).
- Is idempotent w.r.t. `settings.json` — `readAndMergeStopHookSettings` short-circuits if the entry is already present (lines 113–128).

`starter.ts` calls `installStopHook` via `maybeInstallStopHook` on every first `acquireSshChannel` per host per fleet-status-subscriber lifecycle (lines 418–423). The `hookInstallAttempted` Set is cleared on `onLastUnsubscriber` (line 546) and on `releaseSshChannel` (line 469).

**Net effect:** editing `STOP_HOOK_SCRIPT_CONTENTS` (and its `.sh` source file) is the ENTIRETY of the deploy story. Redeploy backend, next subscriber opens Skynet, every host gets the new script on next `acquireSshChannel`.

### Backend read pattern [ASSUMED — extrapolated from existing box-wide read]

Current (ssh-poll-orchestrator.ts:971):

```typescript
const hookPayloadPromise = channel.exec(`cat ${hookPayloadPath} 2>/dev/null || true`);
```

Phase 61 addition — add a paired per-session-file read INSIDE the `Promise.all` batch (after `parseSessionJson` returns the `sessionId`, so ordering matters — this happens after the current `Promise.all` at line 977). Two possible patterns:

**Pattern A — sequential (simpler, one extra RTT per tick per PID):**
```typescript
// After parseSessionJson returns.
const perSessionStopPath = `~/.claude/fleet-status/stop-${sessionJson.sessionId}.json`;
// Read the file's mtime as unix millis (multiplied from seconds; %Y = seconds since epoch)
const perSessionMtimeRaw = await channel.exec(
  `stat -c %Y ${shellSingleQuote(perSessionStopPath)} 2>/dev/null || true`,
);
let lastStopAt: number | null = cached?.lastStopAt ?? null;
if (perSessionMtimeRaw !== null && perSessionMtimeRaw.trim() !== "") {
  const parsed = parseInt(perSessionMtimeRaw.trim(), 10);
  if (Number.isFinite(parsed)) {
    lastStopAt = parsed * 1000; // seconds → millis
  }
  // else: fail-open, keep cached value
}
```

**Pattern B — batched with existing Promise.all (fewer round-trips at the cost of complexity; requires re-shuffling processPid to know sessionId before Promise.all fires):**

Move `parseSessionJson` earlier, then add `stat` for the per-session file to the parallel batch. More invasive; Pattern A is preferable for the first cut.

**Recommendation: Pattern A.** One extra RTT per PID per tick is <100ms overhead in the worst case (fleet-status polls each host per-tick, not each PID separately — the RTTs are already round-trip-bounded by SSH channel latency). Optimize to Pattern B in a follow-up if a real perf regression surfaces.

### Status-delta tracking [ASSUMED — extrapolated from processPid patterns]

Inside `processPid`, after `sessionJson` is parsed:

```typescript
const cached = livenessMap.get(pid);
const isNew = !livenessMap.has(pid);

// ... (existing derivations for tmuxSession, dormant, lastMessageAt, aiTitle) ...

// Phase 61: status-delta tracking for lastStatusChangeAt derivation.
let lastStatusChangeAt: number;
if (isNew || cached?.lastStatus === null || cached?.lastStatus === undefined) {
  // First appearance — seed to now(). Combined with lastStopAt === null on a
  // fresh session, this defaults the indicator on (correct — treat as still
  // working until we have evidence of a stop).
  lastStatusChangeAt = deps.now();
} else if (cached.lastStatus !== sessionJson.status) {
  // Status transitioned this tick — record the transition timestamp.
  lastStatusChangeAt = deps.now();
} else {
  // Same status this tick — preserve cached value.
  lastStatusChangeAt = cached.lastStatusChangeAt;
}
```

Then when building the `SessionState`:

```typescript
const state: SessionState = {
  // ... existing fields ...
  lastStopAt,
  lastStatusChangeAt,
};
```

And when caching post-publish:

```typescript
livenessMap.set(pid, {
  // ... existing fields ...
  lastStatus: sessionJson.status,     // NEW — cache for next tick's delta
  lastStatusChangeAt,                 // NEW — cache for stability across ticks
  lastStopAt,                         // NEW — cache for fail-open on next tick
});
```

Applies BOTH to the "fingerprint changed → publish" branch AND to the "fingerprint unchanged → update-in-place" branch (ssh-poll-orchestrator.ts:1273 and :1286).

### Wire schema extension — mirror the Phase 53 pattern [VERIFIED: codebase]

Current (`wire-protocol.ts:195–215`):

```typescript
export const SessionStateSchema = z.object({
  hostId: z.string(),
  tmuxSession: z.string().nullable(),
  sessionId: z.string(),
  pid: z.number().int().nullable(),
  status: z.enum(["busy", "shell", "idle", "waiting"]),
  waitingFor: z.string().optional(),
  backgroundTasks: z.array(BackgroundTaskSchema),
  updatedAt: z.number(),
  lastMessageAt: z.number().nullable().optional(),
  aiTitle: z.string().nullable().optional(),
  dormant: z.boolean().nullable().optional(),
  recycling: z.boolean().nullable().optional(),
});
```

Phase 61 extension — append two lines:

```typescript
export const SessionStateSchema = z.object({
  // ... existing fields unchanged ...
  recycling: z.boolean().nullable().optional(),
  // Phase 61 (WIP shell-idle gate — 2026-08-26): unix millis of the most
  // recent turn-end Stop-hook fire for this session, derived from the mtime
  // of ~/.claude/fleet-status/stop-<sessionId>.json on the target host. null
  // when the file does not exist (session has never completed a turn since
  // the hook script was installed). Additive+optional per T-41-03-05 mitigation.
  lastStopAt: z.number().nullable().optional(),
  // Phase 61: unix millis of the poll tick where sessionJson.status most
  // recently transitioned to a different value. Derived server-side by
  // comparing this-tick status to previous-tick cached status. Seeded to
  // deps.now() on first appearance. NOT sourced from sessionJson.updatedAt
  // (which bumps on compose-box typing without a real state transition).
  // Additive+optional per T-41-03-05 mitigation.
  lastStatusChangeAt: z.number().nullable().optional(),
});
```

Fingerprint extension (`ssh-poll-orchestrator.ts:537`):

```typescript
return `${state.status}|${state.waitingFor ?? ""}|${bgKey}|${state.updatedAt}|${state.lastMessageAt ?? ""}|${state.aiTitle ?? ""}|${state.dormant === true ? "1" : state.dormant === false ? "0" : ""}|${state.recycling === true ? "1" : state.recycling === false ? "0" : ""}|${state.lastStopAt ?? ""}|${state.lastStatusChangeAt ?? ""}`;
```

Frontend mirror (`src/ui/api/fleet-status-types.ts`):

```typescript
export interface SessionState {
  // ... existing fields ...
  recycling?: boolean | null;
  // Phase 61 (WIP shell-idle gate — 2026-08-26): mirrors backend
  // SessionStateSchema.lastStopAt. MUST stay in lockstep. See Pitfall 7.
  lastStopAt?: number | null;
  lastStatusChangeAt?: number | null;
}
```

### Wire schema — back-compat test pattern [VERIFIED: codebase — Phase 53 tests P53-01 A-F]

Mirror the P53-01 A-F test block. Six tests per new field (twelve total):

- Forward-number: `{..., lastStopAt: 1700000000000}` → parse succeeds, value preserved.
- Null: `{..., lastStopAt: null}` → parse succeeds, null preserved.
- Back-compat: OMITTED → parse succeeds, `data.lastStopAt === undefined`.
- Type-enforcement: `{..., lastStopAt: "yes"}` → parse fails, error path includes `lastStopAt`.
- Schema-version guard: `FRAME_SCHEMA_VERSION === 1` (repeat the version-lock assertion — one per phase).

Same six for `lastStatusChangeAt`. Total ~12 additional wire tests.

### Frontend predicate [VERIFIED: codebase — session-working-store.ts:206]

Current predicate (line 206–207):

```typescript
const main =
  state_arg.status === "busy" || state_arg.status === "shell";
```

Replace with (Phase 61):

```typescript
// Phase 61 (WIP-shell-idle-gate 2026-08-26): shell only counts as work if
// the session's status has TRANSITIONED since its last Stop-hook fire —
// otherwise shell is stale post-turn state. Default-on when we have no
// Stop-hook signal yet (fresh session, or lazy rollout on a session that
// pre-dates the hook script upgrade). See 61-CONTEXT.md § Shape.
const lastStopAt = state_arg.lastStopAt ?? null;
const lastStatusChangeAt = state_arg.lastStatusChangeAt ?? null;
const shellCountsAsWork =
  state_arg.status === "shell" &&
  (lastStopAt === null ||
    (lastStatusChangeAt !== null && lastStatusChangeAt > lastStopAt));
const main =
  state_arg.status === "busy" || shellCountsAsWork;
```

WorkingRecord extension (session-working-store.ts:91):

```typescript
type WorkingRecord = {
  isWorking: boolean;
  lastMessageAt: number | null;
  aiTitle: string | null;
  dormant: boolean;
  recycling: boolean;
  // Phase 61 (WIP-shell-idle-gate 2026-08-26): mirrors wire fields.
  // Cached across Axis A republishes per the Pitfall-3 invariant.
  lastStopAt: number | null;
  lastStatusChangeAt: number | null;
};
```

Axis A block (line 258–264) — MUST preserve new axes:

```typescript
const nextMap = new Map(state.map);
nextMap.set(key, {
  isWorking,
  lastMessageAt: existing?.lastMessageAt ?? null,
  aiTitle: existing?.aiTitle ?? null,
  dormant: existing?.dormant ?? false,
  recycling: existing?.recycling ?? false,
  lastStopAt: existing?.lastStopAt ?? null,             // NEW — preserve
  lastStatusChangeAt: existing?.lastStatusChangeAt ?? null, // NEW — preserve
});
```

New Axis F + G blocks (after Axis E, following the direct swap-and-notify pattern of Axis D/E):

```typescript
// ── Axis F — lastStopAt swap-and-notify block (Phase 61) ──
// Wire semantic (optional field): number sets value; explicit null sets null;
// undefined preserves cached value. Same optional-field convention as D/E.
if (state_arg.lastStopAt !== undefined) {
  const nextLastStopAt = state_arg.lastStopAt;
  const existingAfterAxes = state.map.get(key);
  if (
    existingAfterAxes !== undefined &&
    existingAfterAxes.lastStopAt !== nextLastStopAt
  ) {
    // ... construct nextMap and notify (mirror Axis D exactly) ...
  }
}

// ── Axis G — lastStatusChangeAt swap-and-notify block (Phase 61) ──
// Same semantic as Axis F.
if (state_arg.lastStatusChangeAt !== undefined) {
  // ... same pattern ...
}
```

**IMPORTANT:** the `main` predicate change ALSO affects the `isWorking` computation on line 209. The revised predicate above must be plumbed there. The `existing.isWorking !== isWorking` guard on line 237 correctly gates the notify — so a frame that arrives with only a `lastStopAt` update AND that ALSO flips `main` will fire Axis A + Axis F together (two notifies), which is the correct observable contract per session-working-store.ts:218–226.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `main = busy \|\| shell` (session-working-store.ts line 207, per inline-260823-wip-shell-is-work) | `main = busy \|\| (shell && stop-gate-fresh)` with default-on when no stop signal | Phase 61 | Stale-shell false positives (Poppy/aqua/wilma pattern) resolve on next turn-end. |
| Box-wide Stop payload file (single overwrite) | Box-wide file (unchanged, for backgroundTasks[]) + additive per-session file (for lastStopAt) | Phase 61 | Two sessions ending their turns near-simultaneously no longer clobber each other's Stop record. |
| Frontend inferred "is session working" from `status` alone | Backend publishes both `lastStopAt` (fact) and `lastStatusChangeAt` (server-derived delta); frontend combines them | Phase 61 | Ground-truth positive signal supersedes negative-inference-from-status. |

**Deprecated/outdated:**
- The exclusion-of-shell pattern from patch #442 (2026-08-14, subsequently reverted 2026-08-23 via inline-260823-wip-shell-is-work). Phase 61 supersedes both — it neither excludes shell blanket-ly (patch #442) nor includes it blanket-ly (inline-260823), but instead gates it on the Stop-hook fact.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `bash`-native regex extraction of `session_id` from the Stop hook stdin payload works reliably across the managed box fleet's OS distributions. | Code Examples "Stop hook — additive per-session write" | If it fails on some distro, the per-session file simply isn't written for that box → indicator defaults-on (fail-safe direction — no incorrect off signal). Plan should include a task to verify against the actual fleet (Ubuntu, Alpine, macOS if any). |
| A2 | The Stop hook stdin JSON has a stable `"session_id"` string (verified by types.ts:88 zod schema; verified in production usage since Phase 34 shipped). | Code Examples | LOW — the schema has been stable since v2.1.119 per types.ts:28 and Phase 34's install has been running against v2.1.150 in production for weeks. |
| A3 | `stat -c %Y <path>` (mtime in seconds) is universally available on managed boxes. | Code Examples "Backend read pattern" | If a box uses BSD `stat` (no `-c` flag), the read returns null and lastStopAt fails open to cached value → indicator defaults on. Fail-safe. Note: `stat -f %m` is the BSD equivalent; the plan could add a BSD fallback via `|| stat -f %m ...`. |
| A4 | Publishing both raw axes on the wire is preferable to publishing a pre-computed `stopIsFresh: boolean`. | Alternatives Considered | If wire bytes become a concern (they will not — two optional numbers per session per state-change), the derivation could be moved server-side in a follow-up. |
| A5 | The per-session file write cost on the managed box side (one extra `printf` + `mv` per turn end) is negligible relative to the harness's own turn-completion latency. | Runtime State Inventory | Verified by inspection — the hook already does one atomic write; doubling it is well below the harness's own turn latency (~200ms typical). |
| A6 | The `PidCacheEntry.lastStatus` seed rule on first appearance (seed `lastStatusChangeAt = deps.now()`) correctly defaults freshly-started sessions to ON in the WIP indicator. | Common Pitfalls Pitfall 5 | If wrong, freshly-launched sessions flicker OFF for one tick. Verified against the predicate: fresh session has `lastStopAt === null` → predicate short-circuits to `shell && true` → ON. Correct. |

---

## Open Questions

1. **Managed-box `bash` vs `sh` for the Stop hook's inner subshell.**
   - What we know: current script uses `#!/bin/bash`, then `timeout 2 sh -c "..."`. `sh` may be dash on Debian/Ubuntu-derived, ash on Alpine. Bash-specific features (`[[`, `=~`) do NOT work under dash/ash.
   - What's unclear: whether the current single-string atomic-write `sh -c` works only because it uses POSIX-portable syntax, and whether extending it to include a bash regex would break on any managed box.
   - Recommendation: change the inner subshell to `timeout 2 bash -c "..."` (bash is present on every non-embedded Linux distro — it is a dependency of the harness itself since Claude Code requires it). Verify with `which bash` on Ashley's target fleet before finalizing the script.

2. **Where in `processPid` to place the per-session file read.**
   - What we know: `parseSessionJson` returns `sessionId` at line 991. The current `Promise.all` on line 977 does not know `sessionId` yet (it fires the box-wide payload read at line 971 before parsing).
   - What's unclear: whether to add a SECOND `Promise.all` after parsing (one extra RTT per PID per tick) OR to restructure the whole batching (larger diff).
   - Recommendation: add a second `channel.exec(stat -c %Y ...)` call after `parseSessionJson` returns and before the tail-scan block starts. Simpler; matches the pattern of the `stat .dormant` and `stat .recycled-at` calls added by Phases 52/53. One extra RTT is acceptable overhead.

3. **How to publish `lastStopAt` unit — mtime seconds vs derived millis?**
   - What we know: `stat -c %Y` returns integer seconds since epoch. `lastMessageAt` is unix millis. `updatedAt` is unix millis. Consistency argues for millis on the wire.
   - What's unclear: whether to multiply by 1000 server-side or expose seconds and multiply client-side.
   - Recommendation: multiply server-side (in `processPid`) and publish millis. Matches all other timestamp axes on the wire. The comparison `lastStatusChangeAt > lastStopAt` is then trivially correct because both are the same unit.

4. **How to handle the box-wide `last-stop-payload.json` when TWO sessions end their turns in the same 2s poll window.**
   - What we know: the file gets overwritten (second session's payload replaces first's). This is the exact bug that necessitates per-session files.
   - What's unclear: whether `backgroundTasks[]` should also be moved to per-session files (in which case, do we retire the box-wide file?), or whether backgroundTasks are best treated as per-box (as they largely represent shared MCP servers etc.).
   - Recommendation: CONTEXT explicitly locks the box-wide file staying as-is for backgroundTasks[]. Phase 61 does NOT touch the box-wide read path. Two sessions may still lose each other's `background_tasks[]` in a race — that is unchanged from today and out of scope. If Ashley cares about this in the future, it's a separate phase.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `bash` on managed boxes | The Stop hook script's regex extraction of `session_id` | Presumed ✓ (verified by existing hook script's `#!/bin/bash` shebang; harness itself requires bash) | ≥3.2 for `[[ =~ ]]` | Awk / grep -P fallback described in Code Examples |
| `stat -c %Y` on managed boxes | Backend read of per-session file mtime | Presumed ✓ (GNU coreutils on Linux — universally present) | GNU stat | `stat -f %m` for BSD systems if needed |
| SSH channel abstraction | Backend per-session file read | ✓ existing (unchanged from Phase 34) | — | — |
| Existing fleet-status install path | Deploying the updated hook script | ✓ existing (unchanged from Phase 34) | — | — |
| `zod` for wire schema extension | Wire type additions | ✓ existing | — | — |
| `vitest` for testing | Unit tests | ✓ existing | — | — |

**Missing dependencies with no fallback:** none identified.

**Missing dependencies with fallback:** BSD `stat` if any managed box uses it. Fleet is presumed Linux-only per prior phases; verify with Ashley if any macOS or *BSD boxes are in the fleet.

---

## Validation Architecture

`workflow.nyquist_validation` is explicitly `false` in `.planning/config.json` — this section is retained for reference but is NOT a phase-gate requirement.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (confirmed running via existing tests) |
| Config file | `vite.config.ts` (project root) |
| Quick run command | `npx vitest run src/backend/fleet-status src/ui/state/session-working-store` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|--------------|
| WIP-01 | Stop hook writes per-session file with session_id in name | manual / integration | manual UAT on managed box | tests too shell-native for vitest — verify via `bash -n` syntax + integration on a scratch box |
| WIP-02 | Install path re-writes script on next lifecycle | unit | `npx vitest run src/backend/fleet-status/remote-hook-install` (Test 11 byte-equality catches drift) | ✅ existing |
| WIP-03 | Backend reads per-session file per PID per tick | unit | `npx vitest run src/backend/fleet-status/ssh-poll-orchestrator` — new describe block | ✅ existing, extend |
| WIP-04 | Status-delta cache updates only on transition | unit | same | ✅ existing, extend |
| WIP-05 | Wire schema accepts new fields | unit | `npx vitest run src/backend/fleet-status/wire-protocol` (extend existing P53 pattern) | ✅ existing, extend |
| WIP-06 | Fingerprint includes new axes | unit | ssh-poll-orchestrator.test.ts — mirror Phase 52's P52-01-T2-iv (same-value-suppress) and P52-01-T2-v (delta-publishes) tests for the two new axes | ✅ existing, extend |
| WIP-07 | Frontend predicate flips correctly per canonical cases | unit | `npx vitest run src/ui/state/session-working-store` — REVISE Test B + add cases | ✅ existing, extend |
| WIP-08 | Backend fail-open on per-session file missing | unit | ssh-poll-orchestrator.test.ts — mirror the existing "Fail-open — hook payload exec null" pattern (Test 5, line 329) | ✅ pattern exists to copy |
| WIP-09 | Frontend `useSessionIsWorking` returns correct booleans for the four canonical cases | unit | session-working-store.test.ts — new describe block | ✅ existing, extend |
| WIP-10 | Wire back-compat: watcher omitting new fields still parses | unit | wire-protocol.test.ts — mirror Test P53-01 D (back-compat-omitted) | ✅ pattern exists to copy |

### Sampling Rate
- Per task commit: `npx vitest run src/backend/fleet-status/wire-protocol src/backend/fleet-status/ssh-poll-orchestrator src/ui/state/session-working-store` (~30s)
- Per wave merge: `npx vitest run src/backend/fleet-status src/ui/state` (~90s)
- Phase gate: `npx vitest run` full suite green.

### Wave 0 Gaps
None. All test scaffolding, mocks (`MockSshChannel`, `MockRegistry`), fixture builders (`makeSessionJson`, `makeValidPayload`), and predicate test patterns already exist. Phase 61 is a pure extension.

---

## Security Domain

`workflow.security_enforcement` is `true`, `workflow.security_asvs_level` is `1`, `workflow.security_block_on` is `"high"`. The phase's threat surface is small (SSH-channel reads and one bash regex).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | SSH auth handled by existing Skynet SSH primitives (unchanged). |
| V3 Session Management | no | No new session concept introduced (per-session Stop files are keyed on the harness's own sessionId). |
| V4 Access Control | no | Per-user Skynet auth unchanged; fleet-status remains presence-gated to a subscribed user. |
| V5 Input Validation | YES | Backend parses per-session Stop file contents via existing `parseStopHookPayload` (zod-validated). Filename derived from `sessionJson.sessionId` (already zod-validated as `z.string().min(1)` in types.ts:53). Managed-box regex extraction of `session_id` from stdin is best-effort with fail-open behavior. |
| V6 Cryptography | no | No new secrets, no new keys, no new encryption paths. |

### Known Threat Patterns for {this stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious `session_id` value in Stop-hook stdin (e.g. `../../../../etc/passwd`) causing hook script to write to arbitrary path | Tampering | The regex `[a-zA-Z0-9_-]+` in the shell script rejects anything with `/` or `..`. This is a defense-in-depth measure — the Stop hook stdin is authored by Claude Code (not user-controlled), but a compromised harness on a managed box would be able to write to arbitrary paths via this vector without the character-class gate. The backend's use of `shellSingleQuote` when interpolating sessionId into the SSH exec command prevents shell-injection on the read path (existing pattern used by dormant / recycling stats). |
| SSH exec of `cat` on an attacker-controlled path | Tampering | `sessionId` is already validated as a non-empty string by zod (types.ts:53). Additionally, the path is built as `~/.claude/fleet-status/stop-<sessionId>.json` — a directory Skynet does not control on the managed box, so attacker control of `sessionId` at most lets the attacker read a file within that directory. The backend uses `shellSingleQuote(sessionId)` when interpolating to prevent shell metacharacter escape (existing pattern from Phase 52 dormant stat interpolation). |
| Denial-of-service via per-session file explosion on the managed box | Denial of Service | Filesystem quota is enforced by the OS. Documented in Pitfall 6 as accepted tradeoff for lazy rollout. If concerning, a future phase can add a cleanup step. |
| Race between two Stop hook fires writing the same per-session file (same session ends two turns very close together — impossible because turns are sequential, but the `.tmp` + `mv` pattern is safe either way) | Tampering | Atomic `.tmp` + `mv` semantics — POSIX rename is atomic on the same filesystem. Same pattern used for the existing box-wide file. |

Overall risk: **LOW**. No new attack surface beyond what Phase 34 established for the fleet-status subsystem.

---

## Sources

### Primary (HIGH confidence)
- `src/backend/fleet-status/stop-hook.sh` (current shipped script) — verified via `Read`.
- `src/backend/fleet-status/remote-hook-install.ts` (install path) — verified via `Read`.
- `src/backend/fleet-status/ssh-poll-orchestrator.ts` (2s poll loop, session state derivation, cache patterns) — verified via `Read` (lines 1–1590).
- `src/backend/fleet-status/wire-protocol.ts` (schema definitions, additive-optional invariant docblock) — verified via `Read`.
- `src/backend/fleet-status/types.ts` (StopHookPayloadSchema, SessionJsonSchema, safe-parse helpers) — verified via `Read`.
- `src/ui/state/session-working-store.ts` (`main` predicate, five-axis store, subscription pattern) — verified via `Read`.
- `src/ui/api/fleet-status-types.ts` (frontend mirror of `SessionState`) — verified via `Read`.
- `src/backend/starter.ts` (orchestrator wiring, hookInstallAttempted lifecycle) — verified via `Read` (lines 220–560).
- `.planning/phases/53-.../53-RESEARCH.md` (immediate prior phase — identical patterns for axis addition) — verified via `Read`.
- `.planning/phases/57-.../61-CONTEXT.md` (locked decisions) — verified via `Read`.
- `src/backend/fleet-status/ssh-poll-orchestrator.test.ts` (test scaffolding, `MockSshChannel`, fixture builders, existing dormant test patterns) — verified via `Read`.
- `src/backend/fleet-status/wire-protocol.test.ts` (P41/P47/P52/P53 additive-axis test patterns) — verified via `Read`.
- `src/backend/fleet-status/remote-hook-install.test.ts` (byte-equality Test 11 pattern for script drift) — verified via `Read`.
- `src/ui/state/session-working-store.test.ts` (Test B locking the current `shell → true` behavior — the test being revised in Phase 61) — verified via `Read`.
- `src/ui/features/pretty-view/PrettyView.tsx` (WipBubble consumer of `useSessionIsWorking`) — verified via `Read` (lines 1155–1210).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (row-dot consumer of `useSessionIsWorking`) — verified via `Read` (lines 80–240).

### Secondary (MEDIUM confidence)
- Grep results for `state.status` and `useSessionIsWorking` production consumers — 2 consumer surfaces identified, no additional hidden dependencies.

### Tertiary (LOW confidence)
- Shell-portable regex extraction of JSON fields — assumed to work under bash 3.2+ on all fleet boxes. Should be verified against actual managed box set as a Plan 61-01 sub-task.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every change is a well-worn pattern with 4 prior in-repo executions (Phases 41, 47, 52, 53).
- Architecture: HIGH — five-file fifth-slice of the exact same subsystem architecture.
- Pitfalls: HIGH — the exact-same Pitfall-3 pattern is documented from Phase 53; every axis-addition phase has hit and fixed it the same way.
- Managed-box shell script edit: MEDIUM — bash regex JSON extraction is a small unknown vs. the rest of the phase. Recommended verification as a Plan 61-01 task.

**Research date:** 2026-08-26
**Valid until:** 2026-09-26 (30 days — this subsystem is stable per Phase 34 shipping + four additive phases without breaking changes)
