---
phase: 69-kill-the-identities-db-table-disk-becomes-sole-source-of-tru
plan: "04"
subsystem: identity-frontend identity-api identity-store
tags: [db-removal, disk-authoritative, tdd, frontend, phase-69, identity-cascade]
dependency_graph:
  requires: [69-01, 69-02, 69-03]
  provides: [frontend-identity-narrow, no-avatarUrlWithHost, identityKey-keyed-store]
  affects:
    - src/ui/api/identities-api.ts
    - src/ui/state/identities-store.ts
    - src/ui/features/pretty-view/IdentityModal.tsx
    - src/ui/features/terminal/IdentityBadge.tsx
    - src/ui/features/sessions/SessionRow.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/sidebar/CloneAgentDialog.tsx
    - src/ui/sidebar/NewSessionDialog.tsx
tech_stack:
  added: []
  patterns: [disk-authoritative-identity, identityKey-keyed-frontend, baked-avatarUrl]
key_files:
  created: []
  modified:
    - src/ui/api/identities-api.ts
    - src/ui/state/identities-store.ts
    - src/ui/features/pretty-view/IdentityModal.tsx
    - src/ui/features/terminal/IdentityBadge.tsx
    - src/ui/features/sessions/SessionRow.tsx
    - src/ui/features/pretty-conversations/PrettyConversationRow.tsx
    - src/ui/sidebar/CloneAgentDialog.tsx
    - src/ui/sidebar/NewSessionDialog.tsx
decisions:
  - "OPTION b chosen for identityId field rename: kept as identityId in NewSessionOnCreateOpts type union but value now carries identityKey; JSDoc added; field name retained for backward-compat with AppShell consumer (which never reads the field)"
  - "BIRTH_STEP_LABELS stays 5 entries (SHAPE B from 69-03); Step 1 label changed from 'Create Skynet identity record' to 'Check identity name is available on host'; blurb[0] updated for SSH-side collision semantics"
  - "Task 4 audit: zero LOOKUP-AS-PK sites found; all identityId consumers are PASSED-THROUGH or in test/comment context"
metrics:
  duration: "~2.5 hours"
  completed: "2026-09-02T04:16:20Z"
  tasks_completed: 4
  files_changed: 8
---

# Phase 69 Plan 04: Frontend Cascade Summary

Frontend Identity type narrowed to 10 fields; avatarUrlWithHost helper deleted; all consumers migrated to identity.avatarUrl direct render; updateIdentity signature rewired to identityKey; applyIdentityChange keyed on identityKey; NewSessionDialog BIRTH_STEP arrays updated for SHAPE B; Task 4 audit confirmed zero LOOKUP-AS-PK survivals.

## Tasks Completed

### Task 1: Narrow Identity type + rewire updateIdentity + delete avatarUrlWithHost

**TDD cycles:** RED (63a06655) → GREEN (b2023e4b)

**identities-api.ts changes:**
- Identity interface narrows from 13 to 10 fields: `id`, `createdAt`, `updatedAt` DELETED
- `avatarUrlWithHost` helper DELETED (backend bakes hostId into avatarUrl)
- `updateIdentity` first arg renamed `id` → `identityKey`; URL uses `encodeURIComponent(identityKey)`
- `buildUpdateFormData` JSDoc updated

**identities-store.ts changes:**
- `applyIdentityChange` second arg renamed `removedId` → `removedKey`
- Filter: `i.id !== removedId` → `i.identityKey.toLowerCase() !== removedKeyLc`
- Update logic: `list.findIndex((i) => i.id === next.id)` → `list.findIndex((i) => i.identityKey.toLowerCase() === nextKeyLc)`

**Test file updates (RED cycle):**
16 test files updated to drop `id`/`createdAt`/`updatedAt` from Identity fixtures and add `role`/`coordinator`:
- IdentityModal.test.tsx (+ 4 modal sub-tests): BASE_IDENTITY narrowed; updateIdentity assertions updated (`"id-1"` → `"tina"`); Phase 66 Plan 05 avatar URL tests updated to use baked-hostId format
- IdentityBadge.test.tsx: FIXTURE narrowed
- CloneAgentDialog.test.tsx: makeIdentity narrowed; identityId assertion updated (`"new-id"` → `"tina-2"`)
- PrettyConversationRow.test.tsx, PrettyConversationRow.clone-menu.test.tsx, PrettyConversationsPanel.clone-dialog.test.tsx: makeIdentity narrowed
- RelayInboundBubble.test.tsx, relay-mxid-resolve.test.ts: makeIdentity narrowed
- IdentitySessionPane.test.tsx: identity fixture narrowed
- NewSessionDialog.test.tsx: inline Identity fixtures narrowed
- conversation-store.test.ts: makeIdentity narrowed (removed `as unknown as Identity` cast)

### Task 2: Migrate consumers off avatarUrlWithHost + off identity.id

**TDD cycles:** (RED folded into Task 1 RED) → GREEN (33c92a7e)

**IdentityModal.tsx:**
- `avatarUrlWithHost` import removed
- L557 useEffect dep: `identity.id` → `identity.identityKey`
- L1092 updateIdentity: `identity.id` → `identity.identityKey`
- L1278-1280 header avatar src: `avatarUrlWithHost(identity, hostId)` + etag → `identity.avatarUrl` + etag (using `&` not `?`)
- L1422-1424 drawer avatar src: same pattern

**IdentityBadge.tsx:**
- `avatarUrlWithHost` import removed; `hostId` prop JSDoc updated (kept for backward-compat)
- `avatarSrc` computation: `hostId != null ? avatarUrlWithHost(...) : identity.avatarUrl` → `identity.avatarUrl` directly

**SessionRow.tsx:**
- `avatarUrlWithHost` import removed
- `src={avatarUrlWithHost(identity, session.hostId)}` → `src={identity.avatarUrl}`

**PrettyConversationRow.tsx:**
- `avatarUrlWithHost` import removed
- `src={avatarUrlWithHost(identity, rowHostIdNum)}` → `src={identity.avatarUrl}`
- avatarUrl gate no longer checks `rowHostIdNum` (hostId baked by backend)

**CloneAgentDialog.tsx:**
- `avatarUrlWithHost` import removed
- `identityId: result.id` → `identityId: result.identityKey` (Phase 69: result.id removed from publicIdentity shape)
- Preview img src: `hostId != null ? avatarUrlWithHost(sourceIdentity, hostId) : sourceIdentity.avatarUrl` → `sourceIdentity.avatarUrl`

### Task 3: NewSessionDialog.tsx — BIRTH_STEP arrays + identity handle

**TDD cycles:** RED (5b021971) → GREEN (bd1df70b)

**SHAPE decision: SHAPE B (5 steps retained)**. From 69-03-SUMMARY.md: SHAPE B was chosen to avoid frontend churn in a backend-scoped wave. BIRTH_STEP array length stays 5; BirthEvent `n` type union stays `1|2|3|4|5`.

**BIRTH_STEP_LABELS[0]:** `"Create Skynet identity record"` → `"Check identity name is available on host"`

**BIRTH_STEP_BLURBS[0]:** `"Couldn't create the Skynet identity record..."` → `"The identity name is already in use on this host. Pick a different name and retry."`

**BIRTH_STEP_BLURBS[1]:** Updated to remove stale "Skynet record created" reference.

**identityId field decision: OPTION b** — field name `identityId` kept in `identityMode:"existing"` type union; JSDoc added explaining it now carries the identityKey value (was nanoid PK pre-phase). AppShell.tsx never reads `.identityId` at runtime; no wider rename cascade needed.

**Test updates:** Test W assertion updated (`"create skynet identity record"` → `"check identity name is available"`); Test EE updated for SHAPE B blurb text.

### Task 4: birthEvent.identityId Consumer Audit (BLOCKER 3 acceptance)

**Audit result: TRACE COMPLETE — zero LOOKUP-AS-PK sites found.**

#### Grep sweep results

```
# birthEvent.identityId / ended.*identityId scan (informational):
src/ui/api/identities-api.ts:362:  JSDoc comment showing wire format ← comment only, SAFE
src/ui/sidebar/NewSessionDialog.test.tsx:3 hits ← test event payloads, SAFE
src/ui/api/identities-api.test.ts:2 hits ← test event payloads, SAFE
Total: 7 hits, all in comments or test files

# .identityId consumer scan (non-test, non-identities-api.ts):
src/ui/sidebar/NewSessionDialog.tsx:137:  identityId: string;  ← TYPE DECLARATION only, not a runtime read
src/ui/sidebar/CloneAgentDialog.tsx:319:  identityId: result.identityKey,  ← PASSED-THROUGH

# identities.find scan: 0 hits

# .find(i.id === ...) scan: 0 hits  ← THE SAFETY GATE
```

#### Consumer classifications

| Consumer | Location | Classification |
|----------|----------|----------------|
| `ended` event `identityId` field | `identities-api.ts` JSDoc | COMMENT — not code |
| `identityId: string` type field | `NewSessionDialog.tsx:137` | TYPE DECLARATION — not a runtime read |
| `identityId: result.identityKey` | `CloneAgentDialog.tsx:319` | PASSED-THROUGH — value placed in opts and forwarded to onCreateSession; never dereferenced as a PK lookup |
| `{ type: "ended", ..., identityId }` | test files | TEST PAYLOADS — not production code |

**NewSessionDialog.tsx:** The `ended` event consumer at L698 reads only `endedEvent.ok` and `endedEvent.type`; the `identityId` field on the event is never dereferenced.

**AppShell.tsx:** The `"existing"` branch at L1993 reads `opts.identityName` (NOT `opts.identityId`) as the tmux session name. The `identityId` field is never read at runtime.

**BLOCKER 3 acceptance criterion: SATISFIED.** Zero `identities.find(i => i.id === value)` patterns survive in `src/ui/` non-test code. The TSC gate (Identity narrowing removes `id` from the type) provides belt-and-suspenders coverage.

## Test Results

All scoped tests pass:
- `identities-api.test.ts`: 6 tests pass
- `identities-store.enrichment.test.ts`: 9 tests pass
- `IdentityModal.test.tsx`: 12 tests pass (all suites)
- `IdentityBadge.test.tsx`: 16 tests pass
- `CloneAgentDialog.test.tsx`: 13 tests pass
- `NewSessionDialog.test.tsx`: 46 tests pass
- `PrettyConversationRow.test.tsx` + related: 206 tests pass
- `conversation-store.test.ts`: included in above

`npx tsc --noEmit`: clean (no output).

## Deviations from Plan

**1. [Rule 2 - Missing coverage] Task 3 RED included BIRTH_STEP test update (Test W) that wasn't in the pre-plan RED scope**

The plan's Task 3 RED said "if NewSessionDialog has tests exercising BIRTH_STEP arrays, update them." Test W did exercise BIRTH_STEP_LABELS[0]. The test was updated as part of the Task 3 RED → GREEN cycle (not a separate pre-planned RED commit).

**2. [Auto-fix] Task 1 RED commit covered 16 test files instead of ~6**

The plan anticipated updating ~5 test files. In practice, 16 test files across the codebase had `id`/`createdAt`/`updatedAt` in Identity fixtures — all updated in the single Task 1 RED commit for consistency.

None. Otherwise plan executed exactly as written. OPTION (b) was chosen for the `identityId` field rename per executor discretion.

## Known Stubs

None. All data flows are real (identity.avatarUrl is populated by the backend at emit time).

## Wave 4 Handoff

Frontend is fully migrated:
- Identity interface has 10 fields — no DB-only fields (`id`/`createdAt`/`updatedAt`)
- All avatar URLs rendered via `identity.avatarUrl` directly (hostId baked by backend)
- updateIdentity routes to `PUT /identities/:identityKey` (not `:id`)
- applyIdentityChange keyed on identityKey throughout
- No frontend consumer treats `birthEvent.identityId` as a nanoid PK lookup
- Wave 4 (plan 69-05) can DROP TABLE identities without any frontend impact

## Self-Check: PASSED

Files exist and commits verified:
- `src/ui/api/identities-api.ts`: present, avatarUrlWithHost deleted, id removed from Identity
- `src/ui/state/identities-store.ts`: present, removedKey in applyIdentityChange
- `src/ui/features/pretty-view/IdentityModal.tsx`: present, identity.identityKey in updateIdentity call
- `src/ui/features/terminal/IdentityBadge.tsx`: present, avatarUrlWithHost removed
- `src/ui/features/sessions/SessionRow.tsx`: present, identity.avatarUrl direct render
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx`: present, identity.avatarUrl direct render
- `src/ui/sidebar/CloneAgentDialog.tsx`: present, result.identityKey in identityId payload
- `src/ui/sidebar/NewSessionDialog.tsx`: present, BIRTH_STEP_LABELS[0] updated

Commits:
- 63a06655: test(69-04): RED — Identity type narrow + updateIdentity signature
- b2023e4b: feat(69-04): GREEN — Identity type narrow + updateIdentity signature
- 33c92a7e: feat(69-04): GREEN — component consumer migration
- 5b021971: test(69-04): RED — NewSessionDialog step arrays + identity handle
- bd1df70b: feat(69-04): GREEN — NewSessionDialog step arrays + identity handle
