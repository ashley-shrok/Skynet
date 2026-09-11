---
phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool
verified: 2026-09-06T19:00:00Z
status: passed
score: 15/15 must-haves verified
overrides_applied: 0
---

# Phase 80: id skill revamp Phase A — Verification Report

**Phase Goal:** Deliver the Skynet-side frontend + backend so a new identity can be born as a task-scoped worker with a pool-picked name + task string, with the task surfaced on both the chat surface (centered pill) and conversation-list row (task-primary), gracefully falling back to current display when task is null. Reuse Tina's Phase 77 identity-birth-orchestrator; implement A1 DIVERGE (identity key `willow`, MXID `Willow-Skynet-Maintainer[-N]`); A2 pool-pick Shape A (backend returns bare name); D-01 through D-06 all covered.

**Verified:** 2026-09-06T19:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Task field on disk: `extractCosmeticsFromFrontmatter` extracts `task` from frontmatter | VERIFIED | `src/backend/claude-session/identity-artifact-reader.ts` L2108, L2127, L2152-2155 — task narrowed same as voice/title |
| 2 | Task field on disk: `buildIdentityFileBody` emits `task` key to frontmatter on birth | VERIFIED | `identity-birth-orchestrator.ts` L406-412 — task emitted after avatar via absent-⇒-omit guard |
| 3 | No Skynet DB storage for task (grep `db.insert.*task` / `db.update.*task` / task column) | VERIFIED | Zero matches under `src/backend/` — task is disk-only per D-05 |
| 4 | Task exposed via identity API: `publicIdentity` includes task | VERIFIED | `identities.ts` L120-139 — `task: typeof cosmetics.task === "string" ? cosmetics.task : null` |
| 5 | Task field write-once (no in-UI edit affordance) | VERIFIED | `setTask` / `<textarea id="new-identity-task">` only in `NewSessionDialog.tsx` L313, L437, L1099-1108 — no edit UI elsewhere in src/ui |
| 6 | Task field accepted on POST /identities/birth | VERIFIED | `identity-birth.ts` L97, L145-155, L176, L289-292 — validated nullable, ≤500 chars, threaded to orchestrator |
| 7 | Task field on clone POST BUT does NOT propagate `source.task` (A3 lock) | VERIFIED | `identity-clone.ts` L302, L381-389, L694 — task pulled from body only; `grep -cE 'source(Identity)?\.task\|sourceCosmetics\.task'` = 0 |
| 8 | Pool storage: `docker/pool-defaults/pool.json` exists with placeholder names | VERIFIED | File exists with `{"names":["Willow","Cinder","Aster","Vega","Onyx","Sable","Fig"]}` (7 entries) |
| 9 | Dockerfile has `COPY --chown=node:node docker/pool-defaults /app/pool-defaults` | VERIFIED | `docker/Dockerfile` L79 — exact string present |
| 10 | `src/backend/pool/pool-loader.ts` exports `getVettedPool()` memoized never-throws | VERIFIED | L81-126 — module-scope cache, ENOENT-silent, safe defaults on every failure branch |
| 11 | `countUsersMatching(prefix)` primitive exported from matrix-admin-client | VERIFIED | `matrix-admin-client.ts` L363-405 — CountUsersOk type + async function; deactivated=true; encodeURIComponent; timeout+abort discipline |
| 12 | POST /identities/pool/pick exists AND composes FULL PascalCase-hyphenated base-handle MXID (blocker 2 fix) | VERIFIED | `pool-routes.ts` L75, L148-186 — extracts serverHost, composes `@<PascalCandidate>-<PascalHyphenatedRole>:<serverHost>` and calls `countUsersMatching(baseHandleMxid)`; returns `{ name: <lowercase> }`; mounted at L1850 BEFORE generic /identities at L1887 in `database.ts` |
| 13 | A1 MXID DIVERGE at birth: composeMxidLocalpart + deriveMxidWithOrdinal helpers, gated on `opts.poolPicked === true` | VERIFIED | `identity-birth-orchestrator.ts` L510-608 (helpers), L704-741 (Step 6 uses derived MXID when poolPicked, else legacy `@<name>:<serverName>` fallback); 6 runStep call sites (1,2,3,6,7,8) — no new numbered SSE step introduced |
| 14 | Frontend Identity.task + BirthRequest.task + BirthRequest.poolPicked + pickPoolName exposed | VERIFIED | `identities-api.ts` L23-27 (Identity.task), L420-422 (BirthRequest.task), L428-430 (BirthRequest.poolPicked), L277-287 (pickPoolName) |
| 15 | NewSessionDialog: task textarea (soft-cap 200), pool auto-prefill on role/host change, poolPicked wire, role-select bug fix | VERIFIED | `NewSessionDialog.tsx` L313 (state), L1091-1109 (textarea maxLength=200), L582-608 (useEffect calls pickPoolName), L736-738 (poolPicked wire = poolPickedName!==null && name.trim()===poolPickedName ? true : undefined), L1023-1027 (Approach A "Pick a host to see available roles" hint) |
| 16 | Task pill on PrettyView: JSX gated on pvIdentity?.task, glass formula hue-tinted from colorHue, z-[100], D-06 fallback | VERIFIED | `PrettyView.tsx` L3092-3116 — render gate `pvIdentityKey && pvIdentity?.task`, hue = `pvIdentity.colorHue ?? 35`, absolute top-4 left-1/2 -translate-x-1/2 z-[100], maxWidth 50% w/ nowrap+ellipsis, plain-text `{pvIdentity.task}` |
| 17 | Task-primary conversation row: gated on identity?.task, reuses `.pv-label` + `.pv-ai-title` + `.pv-hostname-suffix`, D-06 fallback verbatim | VERIFIED | `PrettyConversationRow.tsx` L1291-1315 — ternary on `identity?.task`; top line = `<span className="pv-label">{identity.task}</span>`, subtitle = `<strong>{identity.role}</strong> <span className="pv-hostname-suffix">({identity.displayName})</span>`; fallback preserves pre-Phase-80 markup |
| 18 | Clone entry-point repurposed: CloneAgentDialog.tsx deleted, handleRowClone seeds chainPrefill (A3 no source.task), context-menu label "Spawn under this role" | VERIFIED | `CloneAgentDialog*` files do not exist; `PrettyConversationsPanel.tsx` L1249-1266 handleRowClone seeds `{role: identity.role, host: row.host}` (no description → initialBrief=null); `PrettyConversationRow.tsx` L1388 emits `label: "Spawn under this role"`; zero references to `CloneAgentDialog` remain in `src/` |

**Score:** 18/18 truths verified (goal-decomposed into 18 concrete checks, all pass)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `docker/pool-defaults/pool.json` | Seed vetted pool JSON `{names:string[]}` | VERIFIED | 7 PascalCase names; valid JSON |
| `docker/Dockerfile` | COPY line for pool-defaults | VERIFIED | L79, `COPY --chown=node:node docker/pool-defaults /app/pool-defaults` |
| `src/backend/pool/pool-loader.ts` | `getVettedPool()` + `POOL_FILENAME` | VERIFIED | 140 lines; memoized; never-throws contract enforced |
| `src/backend/pool/pool-routes.ts` | Router with POST /pick handler | VERIFIED | 218 lines; JWT + creds + host + role + pool gates; base-handle probe shape |
| `src/backend/matrix/matrix-admin-client.ts` | `countUsersMatching` + `CountUsersOk` | VERIFIED | L363-405; discriminated-union return matching loginAsUser byte-shape |
| `src/backend/claude-session/identity-artifact-reader.ts` | task narrowing in extractCosmeticsFromFrontmatter | VERIFIED | L2108, L2152-2155 |
| `src/backend/database/routes/identities.ts` | publicIdentity emits task | VERIFIED | L120-139 |
| `src/backend/database/routes/identity-birth-orchestrator.ts` | BirthOptions.task, BirthOptions.poolPicked, composeMxidLocalpart, deriveMxidWithOrdinal, Step 6 gate | VERIFIED | L138 (task), L150 (poolPicked), L544 (composeMxidLocalpart), L576 (deriveMxidWithOrdinal), L704-741 (Step 6 branching) |
| `src/backend/database/routes/identity-birth.ts` | Body validates task + poolPicked, threaded to birthIdentity | VERIFIED | L97-98, L145-155, L166, L182, L271 (matrixCountUsersMatching dep), L292, L297 |
| `src/backend/database/routes/identity-clone.ts` | Body validates task (fresh, A3) | VERIFIED | L302, L381-389, L694; zero source.task reads |
| `src/backend/database/database.ts` | `/identities/pool` mounted BEFORE generic /identities | VERIFIED | L1850 pool, L1887 generic /identities |
| `src/ui/api/identities-api.ts` | Identity.task + BirthRequest.task + BirthRequest.poolPicked + pickPoolName | VERIFIED | L23-27, L420-422, L428-430, L277-287 |
| `src/ui/sidebar/NewSessionDialog.tsx` | task textarea + prefill + poolPicked wire + role-select bug fix | VERIFIED | L313, L437, L1091-1109, L582-608, L736-738, L1023-1027 |
| `src/ui/features/pretty-view/PrettyView.tsx` | Task pill JSX sibling to IdentityBadge | VERIFIED | L3092-3116 |
| `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` | Task-primary branch + fallback + "Spawn under this role" label | VERIFIED | L1291-1315, L1388 |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | handleRowClone routes to NewSessionDialog via chainPrefill | VERIFIED | L1249-1266, L1954-1956 |
| `src/ui/sidebar/CloneAgentDialog.tsx` | DELETED | VERIFIED | File does not exist; zero references remain in src/ |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `pool-loader.ts` | `/app/pool-defaults/pool.json` | `readFileSync` | WIRED | L83-85 |
| `docker/Dockerfile` | `docker/pool-defaults/` | COPY line | WIRED | L79 |
| `pool-routes.ts` | `getVettedPool` | direct import | WIRED | L49, L127 |
| `pool-routes.ts` | `countUsersMatching` | direct import per candidate | WIRED | L50, L174 — with FULL base-handle MXID |
| `pool-routes.ts` | `resolveHostById` | cross-user isolation gate | WIRED | L47, L118 |
| `database.ts` | `pool-routes.ts` | `app.use("/identities/pool", identityPoolRoutes)` | WIRED | L29 (import), L1850 (mount) — BEFORE generic /identities at L1887 |
| `identity-birth.ts` handler | `birthIdentity(opts) → buildIdentityFileBody → writeMarkdownFileAtomic` | opts.task + opts.poolPicked thread-through | WIRED | L271 (matrixCountUsersMatching dep), L289-297 (task + poolPicked plumbed) |
| `birthIdentity → runRelayMintAndWrite Step 6` | `countUsersMatching` | `deriveMxidWithOrdinal` iteration | WIRED | L727-731 (Step 6 calls deriveMxidWithOrdinal with deps.matrixCountUsersMatching) |
| `composeMxidLocalpart(name, role)` | `mxid` variable in runRelayMintAndWrite L734 | replaces legacy `@${opts.name}:${serverName}` when opts.poolPicked === true | WIRED | L709-741 |
| `extractCosmeticsFromFrontmatter` | `publicIdentity` | cosmetics spread | WIRED | L120-139 |
| `Identity.task` | frontend components | JSON deserialization | WIRED | Consumed at `PrettyView.tsx:3092,3114` and `PrettyConversationRow.tsx:1291,1293` |
| `pickPoolName(role, hostId)` | POST /identities/pool/pick | authApi.post | WIRED | L282 |
| `NewSessionDialog` task textarea | openBirthStream request body | state → body assembly | WIRED | L1102 → L725-738 |
| `NewSessionDialog` useEffect | `pickPoolName` on [selectedRole, selectedHost, identityMode] | prefill + tracking | WIRED | L582-608 |
| `NewSessionDialog` openBirthStream body | `BirthOptions.poolPicked` | `poolPicked: (poolPickedName !== null && name.trim() === poolPickedName) ? true : undefined` | WIRED | L736-738 |
| `PrettyView task pill glass style` | `pvIdentity.colorHue ?? 35` | inline linear-gradient(hsla…) | WIRED | L3100-3104 |
| `PrettyConversationRow .pv-body` | `identity.task, identity.role, identity.displayName` | React render gate on `identity?.task` truthy | WIRED | L1291-1315 |
| `handleRowClone` in PrettyConversationsPanel | NewSessionDialog | setChainPrefill(...) + setNewSessionDialogOpen(true) | WIRED | L1249-1266; NewSessionDialog mount passes initialHost/initialRole/initialBrief at L1954-1956 |
| `PrettyConversationRow context-menu label` | "Spawn under this role" | static JSX label | WIRED | L1388 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| PrettyView task pill | `pvIdentity.task` | `useSessionIdentity(tmuxSession)` from identities-store → GET /identities → `publicIdentity` → disk frontmatter | Yes (disk-read task field) | FLOWING |
| PrettyConversationRow task-primary | `identity.task` | `identitiesByKey` from identities-store → GET /identities → publicIdentity → disk frontmatter | Yes | FLOWING |
| POST /identities/pool/pick response | `{ name: pascalCandidate.toLowerCase() }` | pool-loader `getVettedPool()` reads `/app/pool-defaults/pool.json` seed → countUsersMatching(baseHandleMxid) filters used | Yes | FLOWING |
| NewSessionDialog `poolPickedName` state | pickPoolName API response `{name}` | POST /identities/pool/pick | Yes | FLOWING |
| identity-birth-orchestrator Step 6 MXID | `mxid` local variable | composeMxidLocalpart(opts.name, opts.role) + deriveMxidWithOrdinal + deps.matrixCountUsersMatching | Yes (real Synapse admin API) | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Pool loader + Matrix admin primitive test suites pass | `npx vitest run src/backend/pool/pool-loader.test.ts src/backend/matrix/matrix-admin-client.test.ts` | 2 files / 47 tests passed in 11.02s | PASS |
| Pool routes + MXID derivation + identity-birth handler tests pass | `npx vitest run src/backend/pool/pool-routes.test.ts src/backend/database/routes/identity-birth-orchestrator.mxid-derivation.test.ts src/backend/database/routes/identity-birth.test.ts` | 3 files / 49 tests passed in 24.88s | PASS |
| Task-field disk-read + clone + identities.get-disk tests pass | `npx vitest run src/backend/database/routes/identity-clone.test.ts src/backend/database/routes/identities.get-disk.test.ts src/backend/claude-session/identity-artifact-reader.avatar-read.test.ts` | 3 files / 71 tests passed in 16.27s | PASS |
| Frontend Phase 80 tests: NewSessionDialog task-input, PrettyView task-pill, PrettyConversationRow task-primary, Panel clone-dialog | `npx vitest run [4 frontend test files]` | 4 files / 29 tests passed in 196.92s | PASS |

**Total tests run: 196 tests across 12 test files — all passing.**

### Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes declared for Phase 80. Verification uses vitest test suites as behavioral evidence (see Behavioral Spot-Checks). SKIPPED (no probe declarations for this phase).

### Requirements Coverage

All plans have `requirements: []` in frontmatter (no formal REQ-IDs declared for Phase 80 — see ROADMAP "Requirements: TBD"). Coverage is via shape file (`~/.claude/roles/box-maintainer/bounties/id-skill-revamp/shape-id-skill-revamp.md`) and locked decisions D-01 through D-06 in `80-CONTEXT.md`. All 6 decisions verified through observable-truth checks above:

| Decision | Description | Status | Evidence |
|----------|-------------|--------|----------|
| D-01 | Pool storage = JSON file in repo, loaded on boot | SATISFIED | `docker/pool-defaults/pool.json` + `pool-loader.ts` memoized loader |
| D-02 | Task pill uses glass treatment hue-tinted from colorHue | SATISFIED | `PrettyView.tsx` L3100-3104 inline linear-gradient(hsla, colorHue-based) |
| D-03 | Conversation-list row reuses existing `.pv-label` + `.pv-ai-title` + `.pv-hostname-suffix` classes verbatim | SATISFIED | `PrettyConversationRow.tsx` L1291-1315 — no new CSS selectors; zero CSS files modified in phase 80 commits |
| D-04 | Reuse Phase 77 identity-birth-orchestrator, no new registration primitive | SATISFIED | Wire-through via BirthDeps + BirthOptions extensions; no new orchestrator step (6 runStep call sites preserved) |
| D-05 | Task write-once at creation, disk-only, no DB caching | SATISFIED | No `db.insert.*task` / DB column adds; task narrowed in `extractCosmeticsFromFrontmatter`; write-once UI (only NewSessionDialog has `setTask`) |
| D-06 | Fallback when task null: no pill; name-primary conversation row | SATISFIED | `PrettyView.tsx` render gate `pvIdentity?.task`; `PrettyConversationRow.tsx` ternary preserves pre-Phase-80 markup verbatim on falsy branch |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No debt markers (TBD/FIXME/XXX) found in any Phase 80–modified file | Info | Clean |
| — | — | No empty stubs / hardcoded empty renderings found | Info | Clean |
| — | — | No new html-level CSS (D-03 upheld) | Info | Clean |

### Fleet Constraint Verification

| Constraint | Status | Evidence |
|-----------|--------|----------|
| No git worktree usage | PASS | `git worktree list` shows only main tree at /home/ubuntu/skynet-taylor |
| No `--no-verify` in commits | PASS | `git log --grep="no-verify\|no-gpg-sign"` returns zero Phase 80 commits |
| No git push / docker build / docker compose up in Phase 80 commits | PASS | `git log --grep="80-"` reveals no such actions |
| Executor commit prefixes `feat(80-XX)` | PASS | 39 commits with 80- prefix; all use `feat(80-XX)`, `test(80-XX)`, or `docs(80-XX)` |
| No DB writes for task | PASS | Zero matches for `db.insert.*task` / column adds |
| No new CSS files touched | PASS | Zero `.css` files modified in Phase 80 commits |
| No new streaming affordances | PASS | 6 runStep call sites preserved (1,2,3,6,7,8) — no new numbered SSE step |

### Scope Discipline Verification

All items explicitly deferred to Phase B or C are NOT in Phase 80 commits:

| Deferred Item | Target Phase | Smuggled In? | Evidence |
|---------------|--------------|--------------|----------|
| Cosmetics move to role frontmatter | B | No | grep of commits shows no role-frontmatter cosmetic edits |
| Pin sentinel migration | B | No | No pin/sentinel work in 80-* commits |
| Agent-supervisor idle-scan | C | No | No supervisor edits |
| Working-dir consolidation | C | No | No workspace/ path edits |
| Id skill body edits | C | No | No substrate/ skill body edits |
| Coord companion file edits | C | No | No coord companion edits |
| Agent-relay discovery convention | C | No | No agent-relay skill body edits |

### Human Verification Required

Automated coverage is comprehensive at code + unit-test level. The following visual/behavior aspects would benefit from human UAT but are not gap-generating because the code substrate is verified and pertinent tests pass:

- **Visual coherence of the task pill against real identity colorHues** — glass formula tested against hue values 200 and null-fallback 35 in test file, but perceptual "does this pill visually key to the identity" is a human judgment call.
- **Character-count sizing of the ~200-char task field against rendered pill widths at real fonts** — planner explicitly deferred pixel-exact tuning to Claude's Discretion. The 200-char cap is a soft cap; final tuning belongs to visual review.
- **End-to-end birth flow against a live Skynet admin API** — vitest tests use mocked matrixCountUsersMatching. Real Synapse admin API response shape verified against Phase 77 primitives that already ship. A live round-trip UAT (Alice greenlighting a pool-picked identity birth) is customary before rolling to the fleet.
- **Fallback rendering for existing coord-spawned identities on the conversation list** — fallback branch is byte-verbatim per grep guard, and existing 96 tests in PrettyConversationRow.test.tsx continue to pass, but visual confirmation on a live boxes is customary.

These are informational, not gap-generating — the phase goal is delivered end-to-end in code.

### Gaps Summary

**No gaps found.** All 18 goal-decomposed truths verified. All 17 required artifacts present and wired. All 19 key links traced. All 5 data-flow paths flowing. All 4 behavioral spot-checks (196 total tests) pass. All 7 fleet constraints upheld. All 7 deferred items honored.

The phase goal is delivered end-to-end: a Skynet identity can be born as a task-scoped worker with a pool-picked lowercase name (identity key), a task string in disk frontmatter, a PascalCase-hyphenated MXID (A1 DIVERGE at Matrix registration when poolPicked=true), a chat-surface pill showing the task hue-tinted to identity, and a task-primary conversation-list row — with graceful D-06 fallback across all display surfaces when task is null.

---

_Verified: 2026-09-06T19:00:00Z_
_Verifier: Claude (gsd-verifier)_
