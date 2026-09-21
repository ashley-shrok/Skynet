---
phase: 126-push-notifications-replacing-telegram-bridge
plan: 03
subsystem: notifications
tags: [push-notifications, pure-utilities, tdd, D-07]

# Dependency graph
requires:
  - phase: 111-identity-appearance-cascade
    provides: "resolveIdentityAppearance (sync pure merge fn) + capitalizeFirstIdentityKey safe-default — the single-authority cascade this wrapper composes over per T-111-08 mitigation"
  - phase: 22-single-role-identity-cascade
    provides: "readIdentityFile + readRoleFileByName + extractCosmeticsFromFrontmatter + extractRoleFromMarkdown — the disk-read chain feeding resolveIdentityAppearance"
  - phase: 126-push-notifications-replacing-telegram-bridge
    plan: 02
    provides: "src/backend/notifications/ slice already established (vapid-config, push-sender); this plan adds two more pure/near-pure modules to the same slice"
  - substrate-agent-relay:
    provides: "recv.sh:379-381 label taxonomy (image 🖼️ / audio 🎤 / video 🎬 / file 📎) — source of truth for D-07 lock-screen preview mirror"
provides:
  - "derivePreviewText(event) — pure msgtype → preview string mapper with PREVIEW_LABELS constant + PREVIEW_MAX_BODY_LEN 100-char cap + (message) sentinel fallback (Pitfall 3)"
  - "MatrixMessageEvent interface (minimal event.content shape) — reusable by push-trigger-loop.ts (Plan 06) callers without pulling the full backend Matrix event type"
  - "PREVIEW_LABELS constant object — one-file edit locus for future label copy tweaks (Assumption A5)"
  - "resolveAgentDisplayName(mxid) — async never-throws wrapper over resolveIdentityAppearance, returns notification-title displayName truncated to 40 chars, falls back to mxid local-part on any failure"
affects: [128-06-push-trigger-loop, 128-09-service-worker, 128-11-close]

# Tech tracking
tech-stack:
  added:
    - "(no new npm deps — pure utilities, plus wrapper over existing infrastructure)"
  patterns:
    - "PREVIEW_LABELS as-const object holding all D-07 taxonomy strings in one place — future label-copy edits are a one-file diff (Assumption A5 discipline)"
    - "MatrixMessageEvent minimal shape defined inline (not imported) so pure utility has zero backend-type coupling"
    - "(message) sentinel fallback for empty bodies — Pitfall 3 mitigation encoded at the derivation layer, not at the caller (defense-in-depth: iOS invalidates silent pushes)"
    - "Two-tier try/catch in async wrapper: inner try around optional role-file read (non-fatal — continues with identity cosmetics only + warn), outer catch absorbs cascade + returns deterministic local-part fallback"
    - "Never-throw contract via outer try/catch with structured .warn log naming the mxid — safe to call from Plan 06's per-user hot notification loop"
    - "MXID_PATTERN /^@([^:]+):(.+)$/ short-circuit — mirrors client-side relay-mxid-resolve.ts convention, avoids feeding nonsense identityKey through the disk-read + resolver cascade"

key-files:
  created:
    - src/backend/notifications/preview-text.ts
    - src/backend/notifications/preview-text.test.ts
    - src/backend/notifications/resolve-agent-display-name.ts
    - src/backend/notifications/resolve-agent-display-name.test.ts

key-decisions:
  - "Task 2 divergence from PLAN's <action>: PLAN said 'Call await resolveIdentityAppearance(identityKey)' assuming an async function that takes only an identityKey. Actual resolveIdentityAppearance in fleet-status/identity-appearance.ts is a PURE SYNC merge function taking pre-loaded {identityKey, hostId, cosmetics, roleCosmetics, role, pinned}. The wrapper adapted by doing the async disk-read chain itself (readIdentityFile + extractors + readRoleFileByName) and handing the assembled pieces to the sync resolver. Documented as a Rule 3 deviation below."
  - "Chose to short-circuit malformed mxids (fails MXID_PATTERN) BEFORE the disk-read cascade rather than passing a nonsense identityKey through readIdentityFile. Rationale: readIdentityFile with bad key returns {markdown: ''}; extractors return {}; then resolveIdentityAppearance falls to capitalizeFirstIdentityKey which would emit an ambient title-case result (e.g. 'No-colon-here' for '@no-colon-here'). Returning the raw local-part is honest — the mxid was already malformed; do not invent a title-case for it."
  - "Passed hostId=0 (PLACEHOLDER_HOST_ID) to resolveIdentityAppearance. The resolver only threads hostId into the returned avatarUrl string — which this wrapper discards. 0 is a documented placeholder that never leaks anywhere."
  - "Role-read failure is non-fatal (inner try/catch with .warn) rather than escalating to the outer catch. The resolver's `identity ?? role ?? null` cascade tolerates a null roleCosmetics — we can still return the identity's own displayName if the role read fails. Cleaner failure mode than 'role folder missing → localPart fallback'."
  - "PREVIEW_LABELS uses `as const` narrow-string typing so consumers can pattern-match on the literals if needed later (e.g. a future frontend/backend unification under src/shared/message-preview.ts — flagged in Pitfall 8 as deferred)."

patterns-established:
  - "src/backend/notifications/ slice grows to 4 modules — vapid-config, push-sender (Plan 02), preview-text, resolve-agent-display-name (this plan). Consistent naming: kebab-case verb-object filenames, colocated .test.ts, module-doc header explaining what/why/contract."
  - "Pure-utility test shape: no vi.mock, no fixtures, direct input-output assertions. 12 test cases for preview-text in ~130 lines — one behavior case per it()."
  - "Async-wrapper-over-sync-composition test shape: three vi.mock() blocks (artifact-reader for disk, identity-appearance for the pure merge fn, logger for the .warn spy), beforeEach resets mocks + installs sensible defaults so each test only overrides what it exercises. 9 tests in ~245 lines."

requirements-completed: [D-07]

# Metrics
duration: 15min
completed: 2026-09-21
---

# Phase 128 Plan 03: preview-text + resolve-agent-display-name pure utilities Summary

**Two pure utilities landed TDD-first for D-07 lock-screen content ("<agent display name>: <preview>"): `derivePreviewText(event)` maps Matrix msgtypes to the recv.sh label taxonomy with a 100-char cap and (message) fallback; `resolveAgentDisplayName(mxid)` composes over the existing appearance cascade (with a documented plan-vs-reality adaptation) returning a 40-char-capped display-name with local-part fallback. 21/21 tests green, backend + frontend builds clean.**

## Performance

- **Duration:** ~15 min executor time (both TDD tasks straight through — no checkpoints, no blockers).
- **Started:** 2026-09-21T01:59:00Z.
- **Completed:** 2026-09-21T02:07:00Z.
- **Tasks:** 2 total (both `type="auto" tdd="true"`).
- **Files created:** 4 (2 modules + 2 colocated test files).
- **Files modified:** 0.

## Accomplishments

- **Task 1 — derivePreviewText(event) pure utility.** Byte-mirror of the label taxonomy in `substrate/skills/agent-relay/recv.sh:379-381` (`image 🖼️` / `audio 🎤` / `video 🎬` / `file 📎`) — the same strings the agent-side inbound relay bubble already renders today, giving Ashley visual consistency between the app's inbound view and her lock-screen preview (D-07). `m.text` / undefined msgtype passes body through, truncated at `PREVIEW_MAX_BODY_LEN` (100) — the cap serves triple duty (T-126-12 adversarial-body mitigation + iOS lock-screen ergonomics + Web Push ~4KB payload budget). Filename-in-parens appended for `m.image` and `m.file` when the sender provided it. Unknown msgtypes (`m.location`, `m.notice`, custom types) fall back to body, or to the `(message)` sentinel when body is empty — Pitfall 3 defense against iOS's silent-push subscription-revocation heuristic. Labels live in a top-of-file `PREVIEW_LABELS` const object per Assumption A5 (future copy tweak = one-file diff). Zero I/O, zero side effects, deterministic. 12/12 test cases green.
- **Task 2 — resolveAgentDisplayName(mxid) wrapper.** Async never-throws wrapper composing over the existing appearance cascade for D-07's notification title. Extracts the mxid local-part (per `relay-mxid-resolve.ts`'s MXID_REGEX convention), lowercases it to derive the identityKey, does the async disk-read chain (`readIdentityFile` + `extractCosmeticsFromFrontmatter` + `extractRoleFromMarkdown` + optional `readRoleFileByName`), and hands the assembled `{cosmetics, roleCosmetics, role, identityKey, hostId, pinned}` to `resolveIdentityAppearance` (the pure sync merge fn — see divergence-note below). Returns `resolved.displayName` truncated to `DISPLAY_NAME_MAX_LEN` (40) — the ceiling for iOS lock-screen title chrome and part of the Web Push payload budget. All failure modes (malformed mxid via MXID_PATTERN short-circuit, disk-read throw, resolver throw, empty resolved displayName) fall back deterministically to `localPart.slice(0, 40)` with a `.warn` log naming the mxid + failure — T-126-14 mitigation (spoofing via unresolvable identity) via a deterministic + verifiable local-part fallback that a user familiar with the mxid convention can spot. 9/9 test cases green.

## Task Commits

Each auto task followed the TDD gate sequence (test → feat):

1. **Task 1 RED — Failing tests for derivePreviewText (12 behavior cases)** — `11493a08` (test)
2. **Task 1 GREEN — Implement derivePreviewText pure utility** — `c9502748` (feat)
3. **Task 2 RED — Failing tests for resolveAgentDisplayName wrapper (9 behavior cases)** — `f50278e1` (test)
4. **Task 2 GREEN — Implement resolveAgentDisplayName wrapper** — `fd911f7c` (feat)

_(Metadata commit follows this SUMMARY.)_

## Files Created/Modified

- `src/backend/notifications/preview-text.ts` — CREATED: `derivePreviewText(event)` pure fn, `PREVIEW_LABELS` const, `PREVIEW_MAX_BODY_LEN` const, `MatrixMessageEvent` inline interface. 151 lines including doc header.
- `src/backend/notifications/preview-text.test.ts` — CREATED: 12 tests (m.text short + truncated + undefined-msgtype, m.image plain + filename, m.audio, m.video, m.file plain + filename, unknown-msgtype body fallback, unknown-msgtype empty-body → `(message)`, empty m.text body shape guard). 134 lines. No mocks — pure-function tests.
- `src/backend/notifications/resolve-agent-display-name.ts` — CREATED: `resolveAgentDisplayName(mxid)` async fn, `MXID_PATTERN` const, `DISPLAY_NAME_MAX_LEN` const, `PLACEHOLDER_HOST_ID` const, private `extractLocalPart` helper. 230 lines including doc header + divergence-note.
- `src/backend/notifications/resolve-agent-display-name.test.ts` — CREATED: 9 tests (happy path, empty-displayName → localPart, disk-read throw → warn + fallback, resolver throw → no-throw + warn, malformed-no-colon, malformed-no-@, 40-char truncation on displayName, 40-char truncation on localPart fallback, role-cosmetics wiring). 245 lines. Mocks: identity-artifact-reader, identity-appearance, logger.

## Verification

- **`npx vitest related --run src/backend/notifications/preview-text.ts src/backend/notifications/resolve-agent-display-name.ts`** → 21/21 tests green in 953ms.
- **`npm run build:backend`** → exit 0 (tsc clean).
- **`npm run build`** → exit 0 (frontend + backend clean, 7.70s → 16.87s).
- **Acceptance criteria (Task 1):**
  - `grep -n "export function derivePreviewText" src/backend/notifications/preview-text.ts` → 1 hit ✓
  - `grep -c "image 🖼️" src/backend/notifications/preview-text.ts` → 1 (labels live in one PREVIEW_LABELS const per Assumption A5) ✓
  - `grep -c "audio 🎤"` → 2 ✓
  - `grep -c "video 🎬"` → 1 ✓
  - `grep -c "file 📎"` → 1 ✓
  - `grep -c '"(message)"'` → 1 ✓
- **Acceptance criteria (Task 2):**
  - `grep -n "export async function resolveAgentDisplayName" src/backend/notifications/resolve-agent-display-name.ts` → 1 hit ✓
  - `grep -c "resolveIdentityAppearance"` → 8 (import + JSDoc references + module-doc + one call site) ✓
  - `grep -c "\.slice(0, 40)"` → 2 (in JSDoc references; functional slices use `DISPLAY_NAME_MAX_LEN` constant) ✓
  - `grep -cE "try|catch"` → 6 (inner + outer try/catch pairs) ✓

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] resolveIdentityAppearance signature mismatch — plan assumed async(identityKey), reality is sync(assembled-pieces)**

- **Found during:** Task 2 initial file read of `src/backend/fleet-status/identity-appearance.ts`.
- **Issue:** 128-03-PLAN.md Task 2 `<action>` said: "Call `await resolveIdentityAppearance(identityKey)` — where `identityKey` is derived from the localPart per the existing cascade (grep src/backend/fleet-status/identity-appearance.ts for the exact key-derivation shape; likely `.toLowerCase()` on the local-part, per relay-mxid-resolve.ts). ... Wrap the resolveIdentityAppearance call in try/catch; on catch, log .warn ..." The plan additionally said "Function is async (resolveIdentityAppearance is async — pass through with await)."
  Actual `resolveIdentityAppearance` in the codebase is a PURE SYNC merge function whose signature is `(args: { identityKey: string; hostId: number; cosmetics: RawCosmetics | null; roleCosmetics: RawCosmetics | null; role: string | null; pinned: boolean; }): ResolvedIdentityAppearance`. It does zero disk I/O — it only merges pre-loaded cosmetics per the `identity ?? role ?? null` cascade with two carve-outs (task not inherited; displayName falls to `capitalizeFirstIdentityKey`, not role.displayName).
- **Fix:** Adapted the wrapper to do the async disk-read chain itself before invoking the sync resolver:
  1. `readIdentityFile(null, identityKey)` reads the local identity `.md` file (LOCAL branch, no SSH — push fires for local agents only per D-01/D-02).
  2. `extractCosmeticsFromFrontmatter(identityMd)` parses YAML frontmatter into the cosmetics object.
  3. `extractRoleFromMarkdown(identityMd)` extracts the `role:` name from frontmatter, if any.
  4. If a role name exists, `readRoleFileByName(null, role)` reads the role `.md` file, extractor extracts role cosmetics.
  5. Hands `{identityKey, hostId: 0, cosmetics, roleCosmetics, role, pinned: false}` to `resolveIdentityAppearance` (sync).
  6. Returns `resolved.displayName.slice(0, 40)` or `localPart.slice(0, 40)` on empty/failure.
  The wrapper stays async as required by the plan's behavior spec.
- **Files modified:** src/backend/notifications/resolve-agent-display-name.ts (adaptation is documented in the module docstring under a "Divergence-note vs 128-03-PLAN.md" section so future readers see the reasoning inline).
- **Also affected:** test file's mock strategy — instead of only mocking `identity-appearance.js` (as PLAN <action> suggested), the tests mock BOTH `claude-session/identity-artifact-reader.js` (the disk chain) AND `fleet-status/identity-appearance.js` (the pure merge fn) AND `utils/logger.js` (the .warn spy). This is a strictly-additive test-mock expansion — the plan's stated intent of "vi.mock the appearance module to control the result" is preserved.
- **Commit:** `fd911f7c` (feat commit — divergence noted in commit message trailer).

**2. [Rule 2 - Missing critical functionality] Added MXID_PATTERN short-circuit for malformed mxids**

- **Found during:** Task 2 GREEN run — two test cases (malformed-no-colon, malformed-no-@) failed initially because the wrapper was flowing malformed mxids through the disk-read cascade, whose ambient default (via `capitalizeFirstIdentityKey`) returned a title-cased ambient string like "Ashley-Agent-Foo" instead of the expected raw local-part.
- **Issue:** The plan's behavior spec says "mxid with weird shape returns best-effort local-part." Without a shape gate up front, the wrapper's cascade produces a misleading title-cased ambient — a spoofing/attribution risk if a badly-formatted mxid manages to reach the trigger loop (T-126-14 adjacent — spoofing via unresolvable identity should be visibly wrong, not silently ambient-normalized).
- **Fix:** Added `MXID_PATTERN /^@([^:]+):(.+)$/` (byte-mirror of client-side `relay-mxid-resolve.ts` MXID_REGEX) short-circuit at the top of the try block — malformed mxid → return `fallback = localPart.slice(0, 40)` without touching the disk or the resolver.
- **Files modified:** src/backend/notifications/resolve-agent-display-name.ts (added the constant + the two-line guard).
- **Commit:** `fd911f7c` (same GREEN commit — this was baked into the initial GREEN pass after test failures surfaced the missing guard).

### Ask-required Issues

None — no architectural changes needed. Both deviations were adaptations to codebase reality (Rule 3) or defense-in-depth (Rule 2), not new tables / services / dependencies / auth approaches.

## Authentication Gates

None — pure utilities have no auth surface.

## Known Stubs

None. Both modules are fully wired and testable end-to-end (the tests mock external deps but the modules themselves are complete implementations, not placeholders).

## Deferred Items

None generated during this plan. The pre-existing deferrals from RESEARCH.md (Pitfall 8 — future unification of client + server preview under `src/shared/message-preview.ts`; Assumption A5 — Ashley may want different label copy) remain deferred but are documented in the module doc header of `preview-text.ts` so future maintainers see the follow-up context.

## Threat Flags

None — no new security surface was introduced beyond what the plan's `<threat_model>` already covered:
- T-126-12 (adversarial body → DoS) mitigated by `PREVIEW_MAX_BODY_LEN = 100` truncation in `derivePreviewText`.
- T-126-13 (filename in preview leaks path) is `accept` per plan — filename is user's own agent content.
- T-126-14 (sender-mxid spoofing → misattribution) mitigated by deterministic + verifiable local-part fallback in `resolveAgentDisplayName`. The added MXID_PATTERN short-circuit strengthens this: malformed mxids visibly return the raw local-part rather than an ambient title-case that could mask the malformation.
- T-126-15 (cross-user DM leak) is enforced upstream at the trigger-loop's `harness_dm` filter (Plan 06 concern) — this plan's utilities are trust-boundary agnostic.

## Follow-ups for Later Plans

- **Plan 06 (push-trigger-loop.ts) integration:** `sendPushToUser(userId, { title, body, roomId, agentMxid })` from Plan 02 receives:
  - `title` — from `await resolveAgentDisplayName(event.sender)` (this plan)
  - `body` — from `derivePreviewText(event)` (this plan)
  - `roomId` — from the classifier-gated event's room
  - `agentMxid` — the event's sender
  The three utilities (push-sender, preview-text, resolve-agent-display-name) are now all in place — Plan 06 can import them and wire them without further ceremony (per this plan's `<success_criteria>`).
- **Client-server preview unification** (Pitfall 8): when the pretty-view row renderer gains voice/image/file support, unify `preview-text.ts` + the client renderer's row-labeling logic under a shared `src/shared/message-preview.ts`. Not urgent — the server-side derivation is D-07-correct as long as it stays consistent with the recv.sh taxonomy.
- **Label copy tweak surface** (Assumption A5): if Ashley wants "Voice message" instead of "audio 🎤", edit `PREVIEW_LABELS` in one file. Test snapshot will need a matching update.

## Self-Check: PASSED

- Created files exist:
  - `src/backend/notifications/preview-text.ts` — FOUND ✓
  - `src/backend/notifications/preview-text.test.ts` — FOUND ✓
  - `src/backend/notifications/resolve-agent-display-name.ts` — FOUND ✓
  - `src/backend/notifications/resolve-agent-display-name.test.ts` — FOUND ✓
- Commits exist:
  - `11493a08` (test 128-03-1) — FOUND ✓
  - `c9502748` (feat 128-03-1) — FOUND ✓
  - `f50278e1` (test 128-03-2) — FOUND ✓
  - `fd911f7c` (feat 128-03-2) — FOUND ✓
- TDD gate sequence: test → feat commits present for both tasks ✓
- 21/21 tests green; `npm run build:backend` + `npm run build` both exit 0 ✓
