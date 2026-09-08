# Deferred items — Phase 85

Pre-existing issues encountered during execution but outside plan scope.
Logged per executor SCOPE BOUNDARY (executor auto-fix only for direct
consequences of current task's changes).

## From Plan 85-01 execution (2026-09-07)

Backend `tsc -p tsconfig.node.json --noEmit` reports three pre-existing
errors in files NOT touched by this plan:

- `src/backend/database/routes/host.ts(473,15)` — TS2322 Type 'unknown' not
  assignable to 'string'.
- `src/backend/database/routes/host.ts(1182,17)` — TS2322 Type 'unknown' not
  assignable to 'string'.
- `src/backend/database/routes/pretty-view-fetch-host-file.ts(440,56)` —
  TS2345 Argument of type 'string | string[]' not assignable to 'string'.

Not introduced by the Phase 85-01 schema.ts or db/index.ts changes;
`grep 'src/backend/database/db/(schema|index)\.ts'` on the tsc output
returns zero hits. Left in place for a dedicated typecheck-cleanup plan
or an orchestrator ship-gate resolution pass.
