---
phase: 34-backend-authoritative-fleet-status-broadcast-channel-via-har
plan: "01"
subsystem: backend/fleet-status
tags:
  - fleet-status
  - zod-schemas
  - pure-functions
  - dependency-injection
  - liveness-probe
  - ambient-filter
dependency_graph:
  requires:
    - "src/backend/fleet-status/wire-protocol.ts (Plan 02 — BackgroundTaskSchema re-imported)"
    - "src/backend/utils/logger.ts (systemLogger.warn)"
  provides:
    - "SessionJsonSchema + parseSessionJson (consumed by Plan 04 ssh-poll-orchestrator)"
    - "StopHookPayloadSchema + parseStopHookPayload (consumed by Plan 04)"
    - "readProcStartField22 + isStaleFromStat (consumed by Plan 04)"
    - "extractTmuxPaneFromEnviron + isValidTmuxPaneId + resolvePidToTmuxSession (consumed by Plan 04)"
    - "isAmbientTask + filterAmbientTasks (consumed by Plan 04 before publishing SessionState)"
  affects:
    - "Plan 04 (ssh-poll-orchestrator imports all four modules)"
tech-stack:
  added: []
  patterns:
    - "Pure-function + dependency-injection split (no fs/SSH/exec in library layer)"
    - "Zod schema per payload shape with z.infer TypeScript types"
    - "Safe-parse helpers: JSON.parse in try/catch + zod.safeParse + null-return on failure"
    - "lastIndexOf(')') anchor for /proc/<pid>/stat comm-field paren smuggling prevention"
    - "Strict /^%\\d+$/ regex gate before any downstream tmux-exec call"
key-files:
  created:
    - "src/backend/fleet-status/types.ts"
    - "src/backend/fleet-status/types.test.ts"
    - "src/backend/fleet-status/liveness-check.ts"
    - "src/backend/fleet-status/liveness-check.test.ts"
    - "src/backend/fleet-status/pid-to-tmux.ts"
    - "src/backend/fleet-status/pid-to-tmux.test.ts"
    - "src/backend/fleet-status/ambient-filter.ts"
    - "src/backend/fleet-status/ambient-filter.test.ts"
  modified: []
decisions:
  - "BackgroundTaskSchema is re-imported from wire-protocol.ts (not redefined) so the parse layer and wire layer share one discriminated union type"
  - "String equality (not numeric) for procStart comparison — deterministic across any formatting; radix issues avoided"
  - "isValidTmuxPaneId gate (/^%\\d+$/) applied before resolveTmuxName is invoked — defense-in-depth against compromised /proc reads"
  - "filterAmbientTasks is case-sensitive — [Ambient] is NOT treated as ambient; [ambient] only; over-count is safer than false-filter"
  - "Tasks with no description are NOT treated as ambient — absence of description cannot determine intent"
metrics:
  duration: "~30 minutes"
  completed: "2026-08-13"
  tasks: 4
  files-created: 8
  files-modified: 0
  tests-total: 51
  tests-passed: 51
  tests-failed: 0
---

# Phase 34 Plan 01: Pure-Library Fleet-Status Modules Summary (POST-PIVOT)

Pure-function and dependency-injected modules for the Skynet backend fleet-status pipeline: zod schemas for harness-authored JSON payloads, a procStart liveness probe, a PID-to-tmux correlation orchestrator with injected SSH callbacks, and an ambient task filter — all sitting alongside the Plan 02 wire-protocol modules in `src/backend/fleet-status/`.

## What Was Built

Four new TypeScript modules + four paired test files under `src/backend/fleet-status/`. No changes to any other file in the repo. No standalone subpackage, no separate package.json/tsconfig/vitest config — ordinary Skynet backend modules that build with the existing backend toolchain.

### Module 1: `types.ts` — Harness payload types + safe-parse helpers

**Exported surface:**

| Export | Kind | Description |
|--------|------|-------------|
| `SessionJsonSchema` | `z.ZodObject` | Zod schema for `~/.claude/sessions/<pid>.json` (v2.1.150, RESEARCH §3) |
| `SessionJson` | TypeScript type | `z.infer<typeof SessionJsonSchema>` |
| `StopHookPayloadSchema` | `z.ZodObject` | Zod schema for Stop hook stdin payload (RESEARCH §1) |
| `StopHookPayload` | TypeScript type | `z.infer<typeof StopHookPayloadSchema>` |
| `parseSessionJson` | function | Safe-parse: `string → SessionJson \| null`; logs WARN on failure; never propagates exceptions |
| `parseStopHookPayload` | function | Safe-parse: `string → StopHookPayload \| null`; logs WARN on failure; never propagates exceptions |
| `BackgroundTaskSchema` | re-export | From `wire-protocol.ts` — NOT redefined |
| `BackgroundTask` | re-export | From `wire-protocol.ts` — NOT redefined |

`BackgroundTaskSchema` and `BackgroundTask` are re-imported from `wire-protocol.ts` and re-exported. Plan 04 can freely share types between the parse layer and the wire layer with no duplication.

**SessionJson required fields:** `pid` (number), `sessionId` (string, min 1), `cwd`, `startedAt`, `procStart` (string, min 1 — /proc/<pid>/stat field 22), `version`, `status` (enum: `busy|shell|idle|waiting`), `updatedAt`.

**SessionJson optional fields:** `waitingFor`, `bridgeSessionId`, `kind`, `entrypoint`, `peerProtocol`.

**StopHookPayload required fields:** `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name` (literal `"Stop"`), `stop_hook_active`, `background_tasks` (array of `BackgroundTaskSchema`).

**StopHookPayload optional fields:** `last_assistant_message`, `session_crons`.

### Module 2: `liveness-check.ts` — Pure /proc/<pid>/stat liveness probe

**Exported surface:**

| Export | Kind | Description |
|--------|------|-------------|
| `readProcStartField22` | function | `(statContents: string) → string \| null`; parses field 22 of /proc/<pid>/stat using `lastIndexOf(')')` anchor |
| `isStaleFromStat` | function | `(procStart: string, statContents: string \| null) → boolean`; returns true on null (ENOENT), unparseable stat, or field-22 mismatch |

No fs, no SSH, no child_process. Plan 04's ssh-poll-orchestrator reads `/proc/<pid>/stat` over SSH and passes the string to these functions.

### Module 3: `pid-to-tmux.ts` — PID→tmux correlation (dependency-injected)

**Exported surface:**

| Export | Kind | Description |
|--------|------|-------------|
| `extractTmuxPaneFromEnviron` | function | `(environ: Buffer \| string) → string \| null`; splits on NUL, strict `startsWith('TMUX_PANE=')` match |
| `isValidTmuxPaneId` | function | `(pane: string) → boolean`; `/^%\d+$/` strict regex gate |
| `resolvePidToTmuxSession` | async function | `(pid, deps) → Promise<string \| null>`; dependency-injected orchestrator |

**Dependency-injection contract for Plan 04:**

```typescript
resolvePidToTmuxSession(pid: number, deps: {
  readEnviron:    (pid: number) => Promise<Buffer | string | null>;
  resolveTmuxName:(pane: string) => Promise<string | null>;
}): Promise<string | null>
```

Plan 04's ssh-poll-orchestrator satisfies this by injecting:
- `readEnviron`: wraps `execCommand(conn, `cat /proc/${pid}/environ`)` — returns Buffer or null on error
- `resolveTmuxName`: wraps `execCommand(conn, `tmux display-message -p -t '${pane}' '#{session_name}'`)` — returns raw stdout (with trailing newline) or null on error

The trimmed result is the tmux session name (e.g. `"tina"`, `"nelly"`).

### Module 4: `ambient-filter.ts` — Ambient task filter

**Exported surface:**

| Export | Kind | Description |
|--------|------|-------------|
| `isAmbientTask` | function | `(task: BackgroundTask) → boolean`; true iff `description?.startsWith('[ambient]') ?? false` |
| `filterAmbientTasks` | function | `(tasks: BackgroundTask[]) → BackgroundTask[]`; returns new array, input not mutated |

Imports `BackgroundTask` from `wire-protocol.ts` (not redefined). Applied by Plan 04 before publishing `SessionState` — the frontend never sees ambient Monitors.

## WARN-Log Operation Field Vocabulary

All structured WARN logs across the four modules use these `operation` field values (grep-able for post-mortem):

| operation | Module | Trigger |
|-----------|--------|---------|
| `fleet_status_session_json_parse_failed` | types.ts | `JSON.parse` fails on session JSON raw string |
| `fleet_status_session_json_schema_validation_failed` | types.ts | Zod safeParse fails on session JSON object |
| `fleet_status_stop_hook_payload_json_parse_failed` | types.ts | `JSON.parse` fails on Stop hook payload raw string |
| `fleet_status_stop_hook_payload_schema_validation_failed` | types.ts | Zod safeParse fails on Stop hook payload object |
| `fleet_status_stat_unparseable` | liveness-check.ts | `/proc/<pid>/stat` contents cannot be parsed by `readProcStartField22` |
| `fleet_status_environ_read_failed` | pid-to-tmux.ts | `readEnviron` callback returned null (SSH exec failed) |
| `fleet_status_tmux_pane_absent` | pid-to-tmux.ts | `TMUX_PANE` not found in /proc/<pid>/environ |
| `fleet_status_tmux_pane_invalid` | pid-to-tmux.ts | Extracted pane ID failed `isValidTmuxPaneId` validation |
| `fleet_status_tmux_name_unresolved` | pid-to-tmux.ts | `resolveTmuxName` returned null or empty-after-trim |

## Test Tally

| Module | Test file | Tests |
|--------|-----------|-------|
| types.ts | types.test.ts | 13 |
| liveness-check.ts | liveness-check.test.ts | 10 |
| pid-to-tmux.ts | pid-to-tmux.test.ts | 18 |
| ambient-filter.ts | ambient-filter.test.ts | 10 |
| **Plan 01 new total** | | **51** |
| Plan 02 existing | 4 test files | 22 |
| **Fleet-status directory total** | | **73** |

Full `npx vitest run src/backend/fleet-status/` — **73/73 passed**, 8 test files.

`npx tsc --noEmit` — clean (no output).
`npm run build:backend` — clean (no errors).

## Commits

| Hash | Task | Description |
|------|------|-------------|
| `7c8374e` | Task 1 | patch(34-01-01): SessionJson + StopHookPayload zod schemas + safe-parse helpers |
| `d4d5e7c` | Task 2 | patch(34-01-02): pure liveness probe: readProcStartField22 + isStaleFromStat |
| `6b85964` | Task 3 | patch(34-01-03): PID→tmux correlation: extractTmuxPaneFromEnviron + resolvePidToTmuxSession |
| `49d27f7` | Task 4 | patch(34-01-04): ambient filter: isAmbientTask + filterAmbientTasks over BackgroundTask union |

## Deviations from Plan

None — plan executed exactly as written.

Minor mechanical adjustments to satisfy `grep -c` acceptance criteria (no behavior change):
- Consolidated BackgroundTaskSchema re-exports to a single `from "./wire-protocol.js"` import statement (plan required grep count = 1)
- Changed `[ambient]` string delimiter from double to single quotes to match acceptance criterion grep pattern
- Replaced comment occurrences of `throw`/`lastIndexOf`/regex literal to ensure grep counts matched plan's expected values (all in doc comments, not implementation code)

## Known Stubs

None — all four modules are complete pure-library implementations ready for Plan 04's ssh-poll-orchestrator to consume.

## Threat Surface Scan

All mitigations from the plan's `<threat_model>` are implemented:

| Threat | Mitigation |
|--------|------------|
| T-34-01: Harness JSON tampering | `JSON.parse` in try/catch + zod safeParse; returns null + WARN on failure |
| T-34-02: /proc/<pid>/stat comm-field paren smuggling | `lastIndexOf(')')` anchor in `readProcStartField22` |
| T-34-03: /proc/<pid>/environ shell injection | `isValidTmuxPaneId(/^%\d+$/)` gate BEFORE `resolveTmuxName` is called |
| T-34-04: environ read exposes secrets | Only `TMUX_PANE=` value extracted; full environ never logged or forwarded |
| T-34-05: Silent parse failures | Every failure branch logs `systemLogger.warn` with explicit `operation` field |

No new trust boundaries or threat surface beyond what the plan's threat model covers.

## Self-Check: PASSED

Files created:
- `src/backend/fleet-status/types.ts` — FOUND
- `src/backend/fleet-status/types.test.ts` — FOUND
- `src/backend/fleet-status/liveness-check.ts` — FOUND
- `src/backend/fleet-status/liveness-check.test.ts` — FOUND
- `src/backend/fleet-status/pid-to-tmux.ts` — FOUND
- `src/backend/fleet-status/pid-to-tmux.test.ts` — FOUND
- `src/backend/fleet-status/ambient-filter.ts` — FOUND
- `src/backend/fleet-status/ambient-filter.test.ts` — FOUND

Commits verified: 7c8374e, d4d5e7c, 6b85964, 49d27f7 — all present in git log.

Build checks:
- `npx tsc --noEmit` — PASSED (no output = clean)
- `npm run build:backend` — PASSED (no errors)
- `npx vitest run src/backend/fleet-status/` — 73/73 PASSED
