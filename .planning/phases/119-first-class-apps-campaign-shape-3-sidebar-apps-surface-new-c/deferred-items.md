# Phase 119 — Deferred Items (out-of-scope discoveries)

## 2026-09-18 (executor plan 119-05)

### Pre-existing TS errors in `src/backend/distributor/catalog.ts` (26 total)

`npm run build:backend` reports 26 `TS2322` errors of the shape:

> Property 'sourceKind' is missing in type '{ readonly slug: ...; readonly bundledPath: ...; readonly installPath: ...; readonly restartHook: null; }' but required in type 'BundledCatalogEntry'.

**Verified pre-existing:** stashed 119-05 changes → still 26 errors. Not caused by
this plan's work. All 26 errors are confined to `src/backend/distributor/catalog.ts`
(catalog entries for the `app-development` skill's app-starter template files
missing the required `sourceKind` discriminant).

**Scope decision:** OUT OF SCOPE for 119-05 (backend icon route). Do NOT auto-fix
per the executor scope-boundary rule (only fix issues DIRECTLY caused by the
current task). Owner: whoever last touched `catalog.ts` /
`BundledCatalogEntry` — likely a Wave-2 shape 1 follow-up on the app-starter
template that added a discriminant without updating all entries.
