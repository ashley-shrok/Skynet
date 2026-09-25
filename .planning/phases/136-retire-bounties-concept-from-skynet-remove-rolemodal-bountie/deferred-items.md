# Deferred items — Phase 136

Out-of-scope discoveries during plan execution. Do NOT fix in this phase unless the phase plan is amended.

## From Plan 136-05

### Dead `vi.mock` stub property

- **File:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.role-management-flow.test.tsx:250`
- **Content:** `listBountiesForRoleName: vi.fn().mockResolvedValue({ bounties: [], archivedBounties: [] })` inside a vi.mock factory spread object
- **Why deferred:** After Plan 136-05 removed the `listBountiesForRoleName` export, this stub property assigns onto an object literal returned to vi.mock. Vi.mock's factory return type is loosely typed (`() => object`), so this does NOT fail tsc. No test in the file actually calls it (RoleModal no longer imports the helper). Removing it is a routine test-hygiene cleanup, not a correctness bug. Out of scope per executor scope-boundary rule ("only fix issues directly caused by current task's changes" — this stub predates 136-05).
- **Suggested cleanup:** future test-cleanup pass, or Plan 136-07/08 if it wants to squash the last string traces of bounty terminology from the test corpus.

### Pre-existing vitest teardown warnings

- **File:** `src/ui/features/pretty-view/IdentityModal.test.tsx`
- **Symptom:** During `vitest related --run src/ui/api/claude-session-api.ts`, two runs report `EnvironmentTeardownError: [vitest-worker]: Closing rpc while "onUserConsoleLog" was pending` originating from IdentityModal.test.tsx.
- **Why deferred:** Warnings do not fail the run (711 tests still all green). Unrelated to bounties — likely a console-log lifecycle race in the IdentityModal test setup. Predates Plan 136-05 (no bounty types are touched by IdentityModal.test.tsx anymore per Plans 03/04).
- **Suggested cleanup:** independent test-infra improvement ticket; not blocking phase progress.

### Historical `Bounty <uuid>` diagnostic-track comments

- **Files:** `src/backend/starter.ts`, `src/backend/fleet-status/ssh-poll-orchestrator.ts`, `src/backend/identity-birth/global-throttle.ts`, `src/backend/database/routes/compose-drafts.ts`, `src/ui/features/terminal/Terminal.tsx`, `src/ui/lib/diag-*.ts`, `src/ui/auth/return-url.ts`, `src/main.tsx` (and ~30 more)
- **Content:** Prose comments of the form `// Bounty <uuid> — <description>` or `// Bounty <slug>: <description>` used as informal issue-tracker references for pre-Phase-133 dev work.
- **Why deferred:** These are NOT the "bounties concept" being retired by Phase 136 (which is the RoleModal Bounties tab + backing WS wire types). They are informal prose comments referencing a historical diagnostic-tracking convention. Retiring them is a documentation/style pass, not a code correctness change. Explicitly out of Phase 136 scope.
- **Suggested cleanup:** if a future phase wants to scrub the last vestiges of "bounty" terminology from the codebase, it should be its own explicit deliverable.
