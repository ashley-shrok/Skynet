# Phase 79 — Deferred items

## From Plan 03 (2026-09-06)

### Plan 04 files have pre-existing TS narrowing errors (not blocking Plan 03)

`npx tsc --noEmit -p tsconfig.node.json` reports 5 errors, ALL in Plan 04's files:

- `src/backend/telegram/bridge-config-writer.ts` L221 — `.error` access on `{ok:true} | {ok:false, error}` union without narrowing
- `src/backend/telegram/bridge-config-writer.ts` L287 — same pattern, `.reason` field
- `src/backend/telegram/bridge-config-writer.ts` L299 — same pattern, `.error` field
- `src/backend/telegram/human-token-writer.ts` L44 — `.error` access on `AdminErr | LoginAsUserOk` union
- `src/backend/telegram/human-token-writer.ts` L46 — same as L44

Plan 03 works around the same TS quirk in `routes.ts` by using `"error" in x ? x.error : "unknown"` guards. Plan 04 should adopt the same pattern OR the tsconfig should be tightened so proper `!x.ok` narrowing works (currently `strict: false` in tsconfig.node.json).

Not blocking Plan 03 — errors are IN Plan 04's own files, do not affect this plan's tests or the build gate that Ashley requested (`docker build` will fail if these persist through Wave 3, but that's Plan 04's problem to fix).

Owner: Plan 04 executor / follow-up chore(79-04) commit.
