---
phase: 109-stt-provider-swap-amazon-transcribe-to-amazon-nova-sonic-on
plan: "01"
subsystem: voice/stt
tags: [nova-sonic, bedrock, stt, adapter, tdd]
dependency_graph:
  requires: []
  provides: [transcribeNovaSonic, nova-sonic-adapter]
  affects: [voice.ts (Plan 03), package.json]
tech_stack:
  added:
    - "@aws-sdk/client-bedrock-runtime ^3.784.0 (resolved 3.1131.0)"
    - "@smithy/node-http-handler ^4.0.4 (resolved 4.12.1)"
  patterns:
    - Module-level BedrockRuntimeClient singleton (mirrors PollyClient + TranscribeStreamingClient pattern)
    - Async generator body for bidirectional stream (D-ASYNCGEN, aws-sdk-js-v3 #7125)
    - vi.hoisted + vi.mock function-ctor pattern (mirrors transcribe-adapter.test.ts topology)
key_files:
  created:
    - src/backend/voice/nova-sonic-adapter.ts
    - src/backend/voice/nova-sonic-adapter.test.ts
  modified:
    - package.json
    - package-lock.json
decisions:
  - "Used amazon.nova-2-sonic-v1:0 as default MODEL_ID per D-PROV; nova-sonic-v1:0 documented as one-line fallback in docstring only"
  - "Post-completionEnd ValidationException swallowed via name-based catch (D-TEARDOWN) — same observable behavior as the Python experiment's teardown fix"
  - "System prompt verbatim from CONTEXT.md §System prompt — transcription-only nudge with single acknowledgment token"
  - "Frame builder extracted as module-level frame() helper to keep generateEvents() readable"
metrics:
  duration: "~15 minutes"
  completed: "2026-09-13"
  tasks: 3
  files: 4
---

# Phase 109 Plan 01: nova-sonic-adapter.ts + dep swap Summary

**One-liner:** BedrockRuntimeClient singleton adapter with async-generator bidirectional stream, role=USER filter, ValidationException-safe teardown, and transcribe-streaming → bedrock-runtime dep swap.

## What Was Built

### Task 1: package.json dep swap
- Removed `@aws-sdk/client-transcribe-streaming` (^3.1129.0)
- Added `@aws-sdk/client-bedrock-runtime` (^3.784.0, resolved 3.1131.0 at install)
- Added `@smithy/node-http-handler` (^4.0.4, resolved 4.12.1 at install)
- `npm install` regenerated `package-lock.json` cleanly (no ERESOLVE)

### Task 2: nova-sonic-adapter.test.ts (RED)
- 12 test cases covering all locked design decisions (D-SINGLETON through D-ASYNCGEN)
- vi.hoisted ctor spies: `bedrockClientCtor`, `invokeCmdCtor`, `sendMock`, `nodeHttp2HandlerCtor`
- `vi.mock('@aws-sdk/client-bedrock-runtime', ...)` + `vi.mock('@smithy/node-http-handler', ...)`
- Dynamic import AFTER mock — mirrors transcribe-adapter.test.ts topology byte-for-byte at harness level
- `fakeResponseBody()` helper drives receive-side tests
- `drainBody()` helper collects sent events for event-sequence assertions
- Confirmed RED before proceeding to Task 3

### Task 3: nova-sonic-adapter.ts (GREEN)
- 341 lines including docblock
- Module-level singleton: `new BedrockRuntimeClient({ region: 'us-east-1', requestHandler: new NodeHttp2Handler({...}) })` — no `credentials` field
- `async function* generateEvents()` emits 10 event types in exact locked sequence
- `audioOutputConfiguration` always included in `promptStart` (D-AUDIOOUT — empirical Amazon requirement)
- Audio chunks: 1920 bytes each, base64-encoded, `await setTimeout(PACE_MS=12)` between yields
- Response loop: `textOutput.role === 'USER'` → accumulate; `completionEnd` → break; everything else → discard
- Outer try/catch: `err.name === 'ValidationException'` → log + swallow; others → rethrow
- `databaseLogger.info(...)` for malformed frames and teardown swallows

## Test Results

```
npx vitest run src/backend/voice/nova-sonic-adapter.test.ts
✓ |backend| src/backend/voice/nova-sonic-adapter.test.ts (12 tests) 97ms
Test Files  1 passed (1)
     Tests  12 passed (12)
```

TypeScript: `npx tsc --noEmit -p tsconfig.json` — 0 errors.

## Deviations from Plan

None — plan executed exactly as written.

The `frame()` helper extracted at module scope is an implementation-internal detail not mentioned in the plan, but it's not a deviation — it doesn't affect any behavioral contract or test assertions.

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| nova-sonic-adapter.ts exists | PASS |
| wc -l >= 180 lines (341 actual) | PASS |
| InvokeModelWithBidirectionalStreamCommand present | PASS (4 occurrences) |
| NodeHttp2Handler present | PASS (3 occurrences) |
| BedrockRuntimeClient present | PASS (6 occurrences) |
| amazon.nova-2-sonic-v1:0 present | PASS |
| amazon.nova-sonic-v1:0 fallback documented | PASS (3 occurrences in docstring) |
| CRITICAL: no credentials field | PASS (0 matches in non-comment code) |
| role === 'USER' filter | PASS (2 occurrences) |
| audioOutputConfiguration | PASS (5 occurrences) |
| async function* | PASS (3 occurrences) |
| completionEnd | PASS (6 occurrences) |
| us-east-1 | PASS (2 occurrences) |
| ValidationException swallow | PASS (7 occurrences) |
| requestTimeout 300_000 | PASS (2 occurrences) |
| maxConcurrentStreams 20 | PASS (2 occurrences) |
| 12/12 tests green | PASS |
| tsc --noEmit passes | PASS |
| @aws-sdk/client-transcribe-streaming removed | PASS (0 matches in package.json) |
| @aws-sdk/client-bedrock-runtime added | PASS (1 match in package.json) |
| @smithy/node-http-handler added | PASS (1 match in package.json) |
| bedrock-runtime version >= 3.784.0 in lock | PASS (3.1131.0) |
| node-http-handler version >= 4.0.4 in lock | PASS (4.12.1) |

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | 015a26d2 | plan(109-01): swap npm deps — drop transcribe-streaming, add bedrock-runtime + node-http-handler |
| 2 | daf466e0 | plan(109-01): add failing nova-sonic-adapter test file (RED) |
| 3 | 07048a89 | plan(109-01): implement nova-sonic-adapter.ts (GREEN — all 12 tests pass) |

## Known Stubs

None — the adapter is fully wired. voice.ts is intentionally untouched (Plan 03 rewires it in Wave 2).

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced beyond what the plan's `<threat_model>` already covers. All STRIDE mitigations applied:
- T-109-01-01: buffer treated as opaque bytes, no shell interpolation
- T-109-01-03: per-frame malformed JSON caught and logged, does not crash loop
- T-109-01-04: role=USER filter enforced, ASSISTANT text discarded (Test 7 asserts)
- T-109-01-05: post-stream ValidationException swallowed (Test 9 asserts)
- T-109-01-06: no credentials field (Test 2 asserts; grep gate confirmed 0 matches)
- T-109-01-07: AccessDenied and network errors propagate unchanged (Tests 10+11)

## Self-Check: PASSED

- `/home/ubuntu/skynet-sky/src/backend/voice/nova-sonic-adapter.ts` — FOUND
- `/home/ubuntu/skynet-sky/src/backend/voice/nova-sonic-adapter.test.ts` — FOUND
- `/home/ubuntu/skynet-sky/package.json` — @aws-sdk/client-bedrock-runtime present, @aws-sdk/client-transcribe-streaming absent
- Commits 015a26d2, daf466e0, 07048a89 — all present in git log
