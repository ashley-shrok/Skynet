---
phase: 101
plan: "04"
subsystem: ssh-semaphore
tags: [ssh, semaphore, rate-limiting, relay-pointer, skill-catalog, claude-session-server, tail-lifecycle]
dependency_graph:
  requires:
    - 101-01 (host-semaphore-registry.ts — getHostSemaphore)
  provides:
    - relay-pointer SSH reads capped under per-host semaphore
    - skill-catalog SSH fetches capped under per-host semaphore
    - claude-session tail slots held for tail lifetime under per-host semaphore
  affects:
    - src/backend/database/routes/relay-pointer.ts
    - src/backend/voice/skill-catalog.ts
    - src/backend/claude-session/claude-session-server.ts
tech_stack:
  patterns:
    - getHostSemaphore(hostId).run(async () => { ... }) for one-shot producers
    - acquireTailSlot(hostId) fire-and-forget run() for long-lived tail slots
    - origStop wrapping pattern for idempotent slot release on stop() + onError
key_files:
  modified:
    - src/backend/database/routes/relay-pointer.ts
    - src/backend/voice/skill-catalog.ts
    - src/backend/claude-session/claude-session-server.ts
decisions:
  - "relay-pointer: resolveHostById (DB call) stays outside the semaphore wrap; connectOneShot through conn.end() inside the run() callback"
  - "skill-catalog: resolveHostById moved outside the wrap (was inside the fail-open try); conn declared inside run() callback so lifetime matches slot"
  - "claude-session-server acquireTailSlot: fire-and-forget run() pattern — slot held until release() called; Promise already-resolved = idempotency guard"
  - "tail sites 1+2: wrap onError passed to tailSessionFile with a lambda that calls tailSlot.release() before forwarding to the original onError closure"
  - "tail site 3 (dormant): wrap deps.tailSessionFile to inject slot acquisition and stop()/onError release; cast c as import('ssh2').Client to match real tailSessionFile signature"
  - "session-file-tail.ts untouched (no hostId in signature, per planner analysis)"
metrics:
  duration: "~12 minutes"
  completed: "2026-09-10"
  tasks_completed: 3
  files_modified: 3
---

# Phase 101 Plan 04: Wrap relay-pointer, skill-catalog, claude-session-server SSH producers Summary

Three producers wrapped under the per-host SSH semaphore cap: relay-pointer one-shot reads, skill-catalog ls fetches, and claude-session-server long-lived tail slots.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Wrap relay-pointer.ts readRelayPointerFile SSH block | d891ac8a | src/backend/database/routes/relay-pointer.ts |
| 2 | Wrap skill-catalog.ts fetch flow | 46ddc845 | src/backend/voice/skill-catalog.ts |
| 3 | Add acquireTailSlot helper + wrap 3 tail sites | 9369afea | src/backend/claude-session/claude-session-server.ts |
| 3a | Type fix: cast conn to ssh2.Client in dormant wrapper | b1e077f6 | src/backend/claude-session/claude-session-server.ts |

## Key Implementation Details

### relay-pointer.ts
`readRelayPointerFile` now wraps `connectOneShot → execCommand(head -c...) → conn.end()` inside `getHostSemaphore(hostId).run(async () => { ... })`. The `resolveHostById` call (DB lookup, no SSH channel) stays outside per D-03. All sentinel parsing and conn cleanup remain inside the slot lifetime.

### skill-catalog.ts
`fetchSkillCatalog` moved `resolveHostById` outside the semaphore wrap (it was inside the fail-open `try` block). The SSH motion — `connectOneShot → Promise.race(execCommand, setTimeout) → conn.end()` — is wrapped in `getHostSemaphore(hostId).run(async () => { ... })`. The outer `try/catch` that swallows errors into an empty Set still wraps the `run()` call to preserve the fail-open invariant (#1: never throws).

### claude-session-server.ts — acquireTailSlot helper

```typescript
function acquireTailSlot(hostId: number | string): { release: () => void } {
  let releaser: () => void = () => {};
  void getHostSemaphore(hostId).run(
    () => new Promise<void>((resolve) => { releaser = resolve; }),
  );
  return { release: () => releaser() };
}
```

The `void` fire-and-forget pattern keeps the slot open until `release()` is called. Resolving an already-resolved Promise is a no-op — this is the idempotency guard for double-release from both `stop()` and `onError`.

### Tail site wrapping pattern (sites 1 + 2)
```typescript
const tailSlotN = acquireTailSlot(currentHostId!);
tailHandle = tailSessionFile(sshConn, sessionFile, onLine, (err) => { tailSlotN.release(); onError(err); });
const origStopN = tailHandle.stop;
tailHandle.stop = () => { tailSlotN.release(); origStopN.call(tailHandle); };
```

### Tail site 3 (dormant branch via deps object)
Wraps `deps.tailSessionFile` inline before calling `__applyDormantBranchTailOpenForTests`. The wrapper acquires a slot and patches both the returned handle's `stop()` and the `errCb` passed to `tailSessionFile`. Uses `c as import("ssh2").Client` to satisfy the strict build (consistent with pattern at L7027, L8181, L8265).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript build error: `c` typed `unknown` in dormant tailSessionFile wrapper**
- **Found during:** Task 3, npm run build:backend
- **Issue:** `__DormantBranchTailOpenDepsForTests.tailSessionFile` types `conn: unknown` to keep ssh2 out of test deps; the real `tailSessionFile` requires `Client`. Calling the real function with `c` (unknown) fails strict tsc.
- **Fix:** Added `c as import("ssh2").Client` cast, consistent with 3 existing cast sites in the same file.
- **Files modified:** src/backend/claude-session/claude-session-server.ts
- **Commit:** b1e077f6

### Pre-existing Issues (NOT regressions from this plan)
- `npm run build:backend` emits 2 pre-existing errors: `@aws-sdk/client-polly` and `@aws-sdk/client-transcribe-streaming` missing type declarations (unrelated to SSH semaphore work).
- `npm run test -- claude-session-server` emits 4-6 `EADDRINUSE` unhandled exceptions from vitest's parallel server startup (pre-existing test infrastructure flakiness; all 247 tests pass).

## Verification Results

- `npm run type-check`: clean
- `npm run test -- relay-pointer`: 13/13 passed
- `npm run test -- skill-catalog`: 13/13 passed
- `npm run test -- claude-session-server`: 247/248 passed (1 skipped, pre-existing), 21/21 test files
- `npm run build:backend`: clean (only pre-existing AWS SDK missing-module errors)
- `git diff --stat src/backend/claude-session/session-file-tail.ts`: no changes

## Known Stubs

None.

## Threat Flags

None — this plan adds no new network endpoints, auth paths, or trust-boundary schema changes. It only adds queueing/throttling around existing SSH call sites.

## Self-Check: PASSED

- [x] src/backend/database/routes/relay-pointer.ts modified with getHostSemaphore wrap
- [x] src/backend/voice/skill-catalog.ts modified with getHostSemaphore wrap
- [x] src/backend/claude-session/claude-session-server.ts modified with acquireTailSlot + 3 sites
- [x] Commits d891ac8a, 46ddc845, 9369afea, b1e077f6 exist in git log
- [x] session-file-tail.ts has no diff
- [x] grep -c "acquireTailSlot" claude-session-server.ts = 4 (1 definition + 3 call sites)
