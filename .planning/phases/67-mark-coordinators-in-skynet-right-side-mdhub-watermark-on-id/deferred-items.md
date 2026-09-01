# Phase 67 — Deferred Items (out-of-scope discoveries during Plan 67-02 execution)

## Pre-existing TypeScript errors in unrelated files (2026-09-01)

Discovered during Task 3 verification run of `npx tsc --noEmit -p tsconfig.app.json`.
Verified via `git stash && tsc` that these errors exist at HEAD before any Plan
67-02 change, so they are OUT OF SCOPE per the SCOPE BOUNDARY rule in the
executor contract (only fix issues directly caused by the current task's
changes).

**Files with errors (all pre-existing):**

1. `src/ui/state/conversation-store.test.ts` — 16 errors, all shape
   `Property 'role' is missing in type ... but required in type 'FleetSession'`.
   Test fixture literals for `FleetSession` don't include the `role` field
   that was added to the interface at some earlier point. Pre-dates Phase 67
   (unrelated to coordinator work).

2. `src/ui/user/ElectronVersionCheck.tsx` — 4 errors, shape mix of
   `Property 'html_url' does not exist on type 'unknown'` and
   `Property 'success' is missing`. Pre-dates Phase 67 (unrelated to
   coordinator work).

**Not fixed by 67-02:** Fixing these would exceed the plan scope (three
tracks bounded to PrettyConversationRow / IdentityBadge / IdentityModal +
their tests + pretty-conversations.css) and would require unrelated fixture
+ typing changes.

**Recommended follow-up:** Standalone `/gsd:quick` task to widen the
`FleetSession` test-fixture helper (add `role: null` default) and fix the
ElectronVersionCheck typing. Not urgent — TS errors don't block the build
in this repo (strict:false), and the frontend `npm run build` still
succeeds despite them.
