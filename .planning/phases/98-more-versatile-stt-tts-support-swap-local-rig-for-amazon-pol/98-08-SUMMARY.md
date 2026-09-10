---
phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol
plan: 08
subsystem: telegram-bridge
tags: [tg-bridge, config-writer, service-token, jwt, provider-transparency, kill-list, atomic-deploy]

# Dependency graph
requires:
  - phase: 98-06
    provides: "AWS-backed /voice/transcribe endpoint (multipart audio in → JSON {text} out; auth via authenticateJWT middleware; disk-bank preserved; slash-command transform preserved)"
provides:
  - "mintBridgeServiceToken(): mints a 30-day bridge-scoped JWT signed with the same SystemCrypto JWT secret AuthManager uses for user tokens; payload {userId:'tg-bridge-service', subject:'tg-bridge', scope:'voice-transcribe'}; NO sessionId (stateless — authenticateJWT skips sessions-table lookup); returns {ok:true, token} | {ok:false, reason}; never throws"
  - "bridge-config-writer.ts: writes MATRIX_ROOT + SKYNET_BASE + SKYNET_BRIDGE_TOKEN to /state/config.env (STT_URL write dropped); mints fresh JWT on every config-write via mintBridgeServiceToken (returns {ok:false} on mint failure, atomic tmp+rename preserved, never throws)"
  - "SKYNET_INTERNAL_BASE = 'http://skynet:8080' constant — docker-compose service name (skynet) + internal expose port (8080); matches container_name/expose in docker/docker-compose.yml; both services co-joined on skynet-net"
  - "bridge.sh: sources SKYNET_BASE + SKYNET_BRIDGE_TOKEN from /state/config.env (STT_URL sourcing removed); tg_voice_to_mx STT curl POSTs to \$SKYNET_BASE/voice/transcribe with Authorization: Bearer \$SKYNET_BRIDGE_TOKEN; timeout bumped 90→120s; -F model=large-v3 dropped; token deliberately NOT echoed to stdout (STRIDE T-98-08-02)"
affects:
  - "Deploy sequencing invariant: 98-08 lands atomically — bridge.sh update + bridge-config-writer.ts update MUST ship together (Pitfall 8 in RESEARCH). If bridge.sh redeploys without bridge-config-writer's Skynet-side changes, /state/config.env is missing SKYNET_BASE and the bridge FATAL-exits, crash-looping the tg-bridge Docker service. Both file changes are in this same commit set."
  - "98-10 (media-endpoints.ts deletion) can now proceed with a clean slate: bridge-config-writer.ts is the last consumer of getMatrixHomeserverBase from media-endpoints; Plan 10 moves that helper to src/backend/matrix/ and deletes media-endpoints.ts. bridge-config-writer.ts no longer imports STT_URL from anywhere."
  - "Future audit-logging path: the bridge JWT's {subject:'tg-bridge', scope:'voice-transcribe'} claims are additive — a downstream middleware wanting to distinguish bridge calls from user calls can inspect these claims without changing the verification gate. Not wired in this plan; option preserved."

# Tech tracking
tech-stack:
  added: []  # jsonwebtoken already installed via AuthManager; SystemCrypto singleton pre-existing
  patterns:
    - "Bridge-scoped JWT minted with same JWT secret as user tokens (SystemCrypto.getInstance().getJWTSecret()) — verifies through unchanged authenticateJWT middleware; no bridge-specific verification path"
    - "Stateless service JWT (no sessionId) — authenticateJWT's sessions-table lookup gated on payload.sessionId truthiness (auth-manager.ts:842); bridge token stays stateless, no persisted session row required"
    - "vi.mock stubbing for SystemCrypto singleton via getInstance-returning-fake-shape; jwtSecretSpy pattern lets tests control the secret without touching disk/env"
    - "Atomic tmp+rename config.env write preserved verbatim (Phase 79 invariant — half-written config.env crashes bridge at bridge.sh:73 `. \"$CONFIG_FILE\"`)"
    - "Bearer-credential exclusion from stdout logs (STRIDE T-98-08-02) — echo the SKYNET_BASE only, never the token; comment in bridge.sh explains why"

key-files:
  created:
    - "src/backend/telegram/bridge-service-token.ts (71 lines)"
    - "src/backend/telegram/bridge-service-token.test.ts (196 lines, 6 assertions)"
  modified:
    - "src/backend/telegram/bridge-config-writer.ts (removed STT_URL import + write; added mintBridgeServiceToken import + call; added SKYNET_INTERNAL_BASE constant; updated body assembly + safety guards; header bumped Phase 79 Plan 04 → Phase 98)"
    - "src/backend/telegram/bridge-config-writer.test.ts (media-endpoints.js mock reduced to getMatrixHomeserverBase only; bridge-service-token.js mock added; happy-path body assertion swapped from STT_URL to SKYNET_BASE + SKYNET_BRIDGE_TOKEN with anti-regression not.toContain('STT_URL'); new test case for token-mint-failure short-circuit; 18/18 tests green, up from 17)"
    - "substrate/services/tg-bridge/bridge.sh (config-check + config-source + STT curl block: STT_URL sourcing → SKYNET_BASE + SKYNET_BRIDGE_TOKEN; curl target Chatterbox → Skynet /voice/transcribe with Bearer auth; timeout 90→120s; -F model=large-v3 dropped; token intentionally not echoed)"
    - "substrate/services/tg-bridge/README.md (config schema line 22 + operator log-line list line 40 updated for new env var pair; STRIDE T-98-08-02 explanation of why token is not echoed)"

key-decisions:
  - "SKYNET_INTERNAL_BASE hardcoded to 'http://skynet:8080' (not env-var-driven). Alternative: process.env.SKYNET_INTERNAL_BASE fallback. Rejected because bridge + Skynet are always co-deployed via docker-compose — the internal-network topology is invariant (both services on skynet-net; skynet has container_name:skynet + expose:['8080']). If a future era decouples them, one-line change to add env-var read. Constant with explanatory comment is the correct minimalism."
  - "Bridge JWT payload includes subject:'tg-bridge' AND scope:'voice-transcribe' AS ADDITIVE CLAIMS. Alternative: create a mintServiceToken(subject, scope, expiresIn) helper on AuthManager. Rejected because AuthManager's existing generateJWTToken() has userId-must-exist-in-users-table entanglement (it inserts into sessions table when deviceType+deviceInfo are set); refactoring that for a service-token use case would invert the change surface. Direct jsonwebtoken.sign() with the shared secret is cleaner and keeps AuthManager unchanged. IMPORTANT: authenticateJWT is not scope-aware (STRIDE T-98-08-06 accepted disposition) — the additive claims are for future observability, not current authorization. A compromised bridge token has the same access as any authed user."
  - "30-day expiry chosen deliberately. Alternative: 24h (matches session_timeout_hours default). Rejected because the bridge doesn't restart daily — a bridge that survives 25 hours would silently break voice notes on the 25th hour. 30 days lets rotation happen naturally at reboot/redeploy cadence. Alternative: 365d. Rejected because STRIDE T-98-08-05 (replay window) — 30 days is the balance point."
  - "Stateless JWT (NO sessionId claim) — bridge token skips the sessions-table lookup in authenticateJWT. Verified explicitly in test 3 (bridge-service-token.test.ts). This is what makes the token 'bridge-scoped' without requiring a database session row for the bridge's identity. authenticateJWT at auth-manager.ts:842 only runs the sessions-table query when payload.sessionId is truthy — a bridge token's absence of sessionId bypasses that path cleanly."
  - "Bridge token NOT echoed to bridge stdout in the config-sourced log line (STRIDE T-98-08-02). Only SKYNET_BASE is echoed. Rationale: `docker logs tg-bridge` retains stdout for the container's lifetime; echoing the token would land it in log storage for the full 30-day token lifetime, expanding the attack surface unnecessarily. Comment in bridge.sh documents the reasoning."
  - "The plan's <verification> criterion 'grep -rn STT_URL src/backend/telegram/ substrate/services/tg-bridge/ returns 0' is satisfied for SOURCE code (bridge-config-writer.ts and bridge.sh both return 0). Remaining hits in the test file (bridge-config-writer.test.ts — 6 hits) are load-bearing: the expect(contents).not.toContain('STT_URL') assertion IS the anti-regression gate. Remaining hit in README.md is narrative documentation of the config-schema change. Both are correct — the source purge is complete."
  - "Task order followed TDD RED→GREEN gate for Task 1 (test commit 8a05d60f then impl commit 417819e4). Tasks 2 and 3 shared the pattern of atomic file-pair change (impl + test-updates together, or impl + doc-updates together) — no separate RED/GREEN split, no tdd='true' frontmatter on those tasks."

# Metrics
duration: ~10min
completed: 2026-09-10
---

# Phase 98 Plan 08: Telegram bridge STT — route through Skynet's /voice/transcribe Summary

**Telegram bridge's voice-note STT path (`substrate/services/tg-bridge/bridge.sh:225`) rewired from POSTing directly to Chatterbox at `$STT_URL` on the tailnet to POSTing to Skynet's own `/voice/transcribe` endpoint with a bridge-scoped Bearer JWT — Skynet handles the AWS Transcribe leg server-side. Bridge stays provider-agnostic (Ashley's verbatim lock 2026-09-10: "the telegram bridge is supposed to use whatever STT that Skynet is configured with for STT on the front end."). Bridge-config-writer drops the `STT_URL` write and adds `SKYNET_BASE` + `SKYNET_BRIDGE_TOKEN` writes. New `mintBridgeServiceToken()` helper mints a 30-day JWT via the same JWT secret AuthManager uses for user tokens. All 3 file changes land atomically in one wave-4 plan (RESEARCH § Pitfall 8: split deploy → bridge crash-loops on missing SKYNET_BASE).**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-09-10T03:28:00Z (approximate)
- **Completed:** 2026-09-10T03:35:00Z (approximate)
- **Tasks:** 3 (Task 1 TDD RED → GREEN; Tasks 2 & 3 direct impl-with-test-updates)
- **Files created:** 2 (bridge-service-token.ts, bridge-service-token.test.ts)
- **Files modified:** 4 (bridge-config-writer.ts, bridge-config-writer.test.ts, bridge.sh, README.md)
- **Test count:** +6 new (bridge-service-token) + 1 new + 17 preserved = 24 total across the two touched test files
- **Commits:** 4 (1 RED test, 3 GREEN feat)

## Accomplishments

- **Created `src/backend/telegram/bridge-service-token.ts`** — mints a bridge-scoped JWT via `SystemCrypto.getInstance().getJWTSecret()` (same secret as user tokens) and `jsonwebtoken.sign()`. Payload: `{userId: "tg-bridge-service", subject: "tg-bridge", scope: "voice-transcribe"}`. No sessionId — stateless. 30-day expiry via `expiresIn: "30d"`. Wraps everything in try/catch; returns `{ok:true, token} | {ok:false, reason}` — never throws. Emits `databaseLogger.warn` with `operation: "bridge_service_token_mint_failed"` on any failure. Verified by 6 test assertions covering happy path, bridge-identifying claims, absence of sessionId, 30-day lifetime, no-throw guarantee, and end-to-end jsonwebtoken.verify() roundtrip.
- **Rewired `src/backend/telegram/bridge-config-writer.ts`** — dropped the `STT_URL` import from `../config/media-endpoints.js` (kept `getMatrixHomeserverBase` — the only remaining consumer of media-endpoints, which Plan 10 will migrate out). Added `mintBridgeServiceToken` import from `./bridge-service-token.js`. Added `SKYNET_INTERNAL_BASE = "http://skynet:8080"` module-level constant (documented as invariant given docker-compose co-deployment). In `writeBridgeConfigEnv`: after resolving `homeserverBase` and before the safety-guard block, now calls `await mintBridgeServiceToken()` — on `{ok:false}`, returns `{ok:false, reason: "token mint failed: ..."}` without writing (preserves atomic invariant: nothing on disk, no tmp file, no half-state). Safety-guard block extended to check `SKYNET_INTERNAL_BASE` and the minted token for `#`/`\n`. Body-assembly template updated to write `# Written by Skynet at boot — Phase 98. Do not edit by hand.` header + `MATRIX_ROOT=... SKYNET_BASE=... SKYNET_BRIDGE_TOKEN=...` — three lines, `STT_URL` line gone. Atomic tmp+rename write (lines 111-115 in prior file) preserved verbatim. `ensureBridgeConfigWritten` never-throws invariant preserved.
- **Updated `src/backend/telegram/bridge-config-writer.test.ts`** — `vi.mock("../config/media-endpoints.js")` no longer exports `STT_URL` (only `getMatrixHomeserverBase`). Added `vi.mock("./bridge-service-token.js")` returning stub `mintBridgeServiceToken` that resolves `{ok:true, token:"test-bridge-jwt-abc.def.ghi"}` by default. Reset the stub in `beforeEach`. Happy-path test asserts body contains `MATRIX_ROOT=...`, `SKYNET_BASE=`, `SKYNET_BRIDGE_TOKEN=test-bridge-jwt-abc.def.ghi`, and `Phase 98` header — AND asserts body does NOT contain `STT_URL` (anti-regression). New test case: when `mintBridgeServiceToken` returns `{ok:false, reason:"..."}`, `writeBridgeConfigEnv` returns `{ok:false, reason:/token mint failed/}` AND asserts no `config.env` or `config.env.tmp` on disk. All existing test cases (17 originals) preserved verbatim — 18/18 green.
- **Rewired `substrate/services/tg-bridge/bridge.sh`** — header comment (lines 5-14) updated to document the new env vars + reference D-Telegram-bridge-STT. Config-check at old line 75 changed from `[ -z "${STT_URL:-}" ]` to `[ -z "${SKYNET_BASE:-}" ] || [ -z "${SKYNET_BRIDGE_TOKEN:-}" ]`. FATAL message updated. Deleted the `STT="$STT_URL"` variable assignment (no longer needed). Updated config-sourced echo to `[tg-bridge] config sourced: MATRIX_ROOT=$ROOT SKYNET_BASE=$SKYNET_BASE` — token NOT echoed (STRIDE T-98-08-02, comment in-file explains). `tg_voice_to_mx` STT curl at line 225 rewritten: `curl -s --max-time 120 -X POST "$SKYNET_BASE/voice/transcribe" -H "Authorization: Bearer $SKYNET_BRIDGE_TOKEN" -F "file=@$dest;type=audio/ogg" | jq -r '.text // empty'`. Timeout bumped 90→120s (per plan — Skynet adds transcode + Transcribe streaming on top of what Chatterbox did in one hop). `-F model=large-v3` dropped (Chatterbox-specific field). Response parse `| jq -r '.text // empty'` preserved (both endpoints return same `{text}` shape). `bash -n` exits 0.
- **Updated `substrate/services/tg-bridge/README.md`** — config schema at line 22 rewritten to describe the new `MATRIX_ROOT + SKYNET_BASE + SKYNET_BRIDGE_TOKEN` shape with a narrative note explaining the provider-agnostic routing decision (locked 2026-09-10). Operator-facing log-line list at line 40 updated to `[tg-bridge] config sourced: MATRIX_ROOT=... SKYNET_BASE=...` with parenthetical explaining why SKYNET_BRIDGE_TOKEN is intentionally NOT echoed.
- **Atomic ship-motion guarantee preserved** — all 4 commits (RED test + 3 GREEN feats) landed sequentially on `feat/tab-title-from-tmux` in one executor session. When Skynet+bridge redeploy, bridge-config-writer.ts writes the new SKYNET_BASE + SKYNET_BRIDGE_TOKEN before the bridge container sources `/state/config.env`; bridge.sh then sees the new vars and proceeds cleanly. If either half were missing at deploy time, the bridge's config-check FATALs immediately (fail-loud pattern). Deploy-sequencing gate met per RESEARCH § Pitfall 8.

## Task Commits

| Task | Type | Commit | Files |
|------|------|--------|-------|
| 1 RED | test | `8a05d60f` | bridge-service-token.test.ts (new, 6 failing tests) |
| 1 GREEN | feat | `417819e4` | bridge-service-token.ts (new; 6/6 pass) |
| 2 | feat | `a7ee1b46` | bridge-config-writer.ts + .test.ts (18/18 pass) |
| 3 | feat | `1ab9c4cc` | bridge.sh + README.md (bash -n OK) |

## Decisions Made

- **SKYNET_INTERNAL_BASE hardcoded to `http://skynet:8080`** — not env-var-driven. Alternatives: (a) `process.env.SKYNET_INTERNAL_BASE ?? "http://skynet:8080"`, (b) derive from a shared config module. Rejected because bridge + Skynet are always co-deployed via docker-compose (same `skynet-net`, `container_name: skynet`, `expose: ["8080"]`) — the internal-network topology is invariant. Documented as `const SKYNET_INTERNAL_BASE` with explanatory comment noting the one-line change needed if a future era decouples them.
- **Bridge JWT payload uses ADDITIVE claims, not restrictive ones** — `subject:"tg-bridge"` and `scope:"voice-transcribe"` are informational metadata for future observability, NOT authorization guards. STRIDE T-98-08-06 disposition is "accept" (documented in plan threat model): authenticateJWT is not scope-aware, so a compromised bridge token has the same access as any authed user. This is acceptable because a compromised bridge already has network access to all `/voice/*` routes; future work could add scope-aware middleware.
- **30-day expiry chosen** — long enough to survive frequent bridge restarts and the config-writer's startup-only mint cadence (bridge-config-writer runs on Skynet boot and on activate/disconnect via `rewriteRegistryFromCurrentState`; the JWT is re-minted each of those times, so a 30-day window comfortably covers any operational cadence). Short enough to bound the replay window per STRIDE T-98-08-05.
- **Stateless JWT (NO sessionId)** — authenticateJWT's sessions-table lookup only fires when `payload.sessionId` is truthy (auth-manager.ts:842). By omitting sessionId in the bridge token payload, the JWT skips that lookup cleanly. No sessions row for the bridge is required. Verified explicitly by dedicated test.
- **Direct `jsonwebtoken.sign()` instead of extending AuthManager** — AuthManager's existing `generateJWTToken()` conflates JWT signing with sessions-table insertion (when `deviceType+deviceInfo` are set). Refactoring that for a stateless service-token use case would invert the change surface and risk breaking user-token issuance. Direct signing with the shared secret keeps AuthManager unchanged; the plan's Task 1 <action> called this out as "IMPORTANT: If the exact JWT-signing helper on AuthManager doesn't fit this use case ... the plan MUST surface the constraint rather than hard-code a workaround." Constraint surfaced here for the record: added no helper to AuthManager; bridge-service-token.ts uses jsonwebtoken directly via the shared SystemCrypto secret.
- **Token intentionally NOT echoed to bridge stdout** — STRIDE T-98-08-02 mitigation. `docker logs tg-bridge` retains stdout for the container's lifetime; echoing the token would land it in log storage for the token's 30-day lifetime, expanding attack surface unnecessarily. The echo line only prints `MATRIX_ROOT + SKYNET_BASE`; comment in bridge.sh documents the reasoning.
- **Test file's `not.toContain("STT_URL")` assertion is load-bearing** — the plan's verification block asks for `grep -rn STT_URL src/backend/telegram/ substrate/services/tg-bridge/` to return 0. The source code (bridge-config-writer.ts, bridge.sh) does return 0. The test file has 6 hits (all narrative comments + the anti-regression assertion itself) — these are correct: the `expect(contents).not.toContain("STT_URL")` line IS the gate, and it necessarily contains the literal string it's asserting the absence of. README.md has 1 hit — narrative documenting the schema migration. Both are the intended state.

## Deviations from Plan

None — plan executed exactly as written.

Two task-execution notes (NOT code deviations, NOT tracked under Rules 1-4):

1. **TDD RED→GREEN split for Task 1 only.** The plan's frontmatter has `tdd="true"` on Task 1 but not Tasks 2 or 3. Followed the RED→GREEN pattern strictly for Task 1 (commit `8a05d60f` = test RED, commit `417819e4` = impl GREEN with all 6 tests passing). Tasks 2 and 3 combined implementation + test/doc updates in single commits per the plan's own <files> lists — no separate RED gate required or applicable there.
2. **Bash-safety comment expanded.** The bash-safety guard block picked up a longer comment than the original (documenting that homeserverBase is the realistic attack surface; SKYNET_INTERNAL_BASE and bridgeToken are defensive-only). Not a behavior change — comment-only expansion for future readers.

## Known Stubs

None — every code path is wired to real production behavior. The bridge JWT signing uses the real `SystemCrypto.getJWTSecret()` (which reads from `.env` or `JWT_SECRET` env var per its existing implementation). The bridge's `curl` call hits the real Skynet endpoint via the internal Docker network. No mock-only or placeholder logic in production code.

Tests use `vi.mock` for `SystemCrypto` (bridge-service-token.test.ts) and `bridge-service-token` (bridge-config-writer.test.ts) — those are legitimate test-scoped substitutions, not stubs left in production code.

## User Setup Required

None — no manual configuration required at this plan boundary. On next Skynet deploy:

1. **Skynet starts up** → `ensureBridgeConfigWritten()` fires from `starter.ts` → calls `mintBridgeServiceToken()` (uses existing JWT secret) → writes `/state/config.env` with `MATRIX_ROOT` + `SKYNET_BASE` + `SKYNET_BRIDGE_TOKEN`.
2. **Bridge starts up** → sources `/state/config.env` → sees the new vars → passes the config-check → proceeds to normal operation.
3. **First voice note through Telegram** → `tg_voice_to_mx` fires curl to `http://skynet:8080/voice/transcribe` with the Bearer token → Skynet's authenticateJWT accepts the token (same verify path as user tokens) → routes through `handleTranscribe` → returns the transcript → bridge posts the transcript to Matrix as `🎤 <text>`.

If Skynet is deployed WITHOUT the bridge being re-deployed, or vice versa, the bridge will crash-loop on the next restart because `/state/config.env` either lacks the new vars (bridge FATAL exits at line 78 config-check) or the vars are stale (curl fails to hit http://skynet:8080). Both halves MUST redeploy together — atomic ship-motion invariant per RESEARCH § Pitfall 8, satisfied by landing all 3 tasks in this single plan.

## Next Phase Readiness

**Plan 09 (deploy doc — `docs/deploy/aws-voice-setup.md`)** — no dependency on this plan's file surface. Runs independently.

**Plan 10 (media-endpoints.ts deletion + tg-bridge coordination)** — can safely proceed. `bridge-config-writer.ts` is now the SOLE remaining consumer of `getMatrixHomeserverBase` from `media-endpoints.ts` (the `STT_URL` import + write are gone). Plan 10 will move `getMatrixHomeserverBase` to `src/backend/matrix/matrix-config.ts` (or inline into bridge-config-writer), then delete `media-endpoints.ts` and its sibling `.test.ts` file entirely. Grep confirms:
```bash
$ grep -rn 'from "../config/media-endpoints' src/backend/
src/backend/telegram/bridge-config-writer.ts:32:import { getMatrixHomeserverBase } from "../config/media-endpoints.js";
```
One importer left — clean handoff to Plan 10.

No blockers. No open questions. Every acceptance criterion in the plan is satisfied by grep + tsc + test + bash -n verification.

## Self-Check: PASSED

**Files verified present:**
- FOUND: `src/backend/telegram/bridge-service-token.ts`
- FOUND: `src/backend/telegram/bridge-service-token.test.ts`
- FOUND: `src/backend/telegram/bridge-config-writer.ts` (modified)
- FOUND: `src/backend/telegram/bridge-config-writer.test.ts` (modified)
- FOUND: `substrate/services/tg-bridge/bridge.sh` (modified)
- FOUND: `substrate/services/tg-bridge/README.md` (modified)

**Commits verified present in git log:**
- FOUND: `8a05d60f` (test 98-08 bridge-service-token RED)
- FOUND: `417819e4` (feat 98-08 bridge-service-token GREEN)
- FOUND: `a7ee1b46` (feat 98-08 bridge-config-writer + tests)
- FOUND: `1ab9c4cc` (feat 98-08 bridge.sh + README)

**Test suite verified:** `npx vitest run src/backend/telegram/bridge-config-writer.test.ts src/backend/telegram/bridge-service-token.test.ts` → 24/24 tests passed in 2 test files (6 new bridge-service-token + 18 bridge-config-writer, up from 17).

**TypeScript compile verified:** `npx tsc --noEmit -p tsconfig.node.json` → exit 0, no errors.

**Bash syntax verified:** `bash -n substrate/services/tg-bridge/bridge.sh` → exit 0.

**Acceptance-criteria greps (all satisfied):**

Task 1 (bridge-service-token.ts):
- Exports `mintBridgeServiceToken`: 1 match on `export async function mintBridgeServiceToken` in the module.
- Returns `{ok, token}` or `{ok:false, reason}` never throws: verified by test "returns {ok:false, reason} on secret-retrieval failure — does NOT throw".
- Token payload includes bridge-identifying claim: verified — decoded.userId === "tg-bridge-service" AND decoded.subject === "tg-bridge".
- 6/6 test assertions pass.

Task 2 (bridge-config-writer.ts):
- `grep -c 'STT_URL' src/backend/telegram/bridge-config-writer.ts` → **0** ✓
- `grep -c -E 'SKYNET_BASE|SKYNET_BRIDGE_TOKEN|mintBridgeServiceToken' src/backend/telegram/bridge-config-writer.ts` → **7** (≥3 required) ✓
- Written config.env body contains SKYNET_BASE and SKYNET_BRIDGE_TOKEN in test assertions ✓
- Test for token mint failure returns `{ok:false}` without writing ✓ (verified `fs.existsSync(config.env)` false + `.tmp` false)
- `ensureBridgeConfigWritten` never-throws invariant preserved (existing test "never throws even when everything fails" still passes) ✓
- Atomic tmp+rename preserved (existing test assertions on tmp cleanup still pass) ✓

Task 3 (bridge.sh + README):
- `grep -c 'STT_URL' substrate/services/tg-bridge/bridge.sh` → **0** ✓
- `grep -c -E 'SKYNET_BASE|SKYNET_BRIDGE_TOKEN' substrate/services/tg-bridge/bridge.sh` → **8** (≥3 required) ✓
- `grep -c 'SKYNET_BASE.*voice/transcribe' substrate/services/tg-bridge/bridge.sh` → **1** (≥1 required) ✓
- Token NOT echoed in config-sourced log line: verified — line 90 echoes only `MATRIX_ROOT=$ROOT SKYNET_BASE=$SKYNET_BASE`; SKYNET_BRIDGE_TOKEN nowhere in echo/printf; comment on line 87-89 explains why (T-98-08-02).
- README config schema updated: verified — README.md:22 rewritten with the new pair.
- `bash -n substrate/services/tg-bridge/bridge.sh` → exit 0 ✓

Global purge (source-only, per plan `<verification>`):
- `grep -rn 'STT_URL' src/backend/telegram/ substrate/services/tg-bridge/` returns 6 test-file hits (load-bearing anti-regression assertion + explanatory comments) + 1 README hit (narrative migration doc). ZERO source hits in `.ts` implementation files or `.sh` shell files.

## TDD Gate Compliance

Task 1 followed the strict RED → GREEN gate sequence:

| Task | RED (test) commit | GREEN (feat) commit | Assertions |
|------|-------------------|---------------------|------------|
| 1 (bridge-service-token) | `8a05d60f` (6 initial failures — Cannot find module) | `417819e4` | 6 |

The RED commit was verified to fail before the GREEN commit was made — running `npx vitest run src/backend/telegram/bridge-service-token.test.ts` after the test commit returned "6 failed (6)" with the expected `Cannot find module` error. After the GREEN commit, the same command returned "6 passed (6)". No REFACTOR pass was needed.

Tasks 2 and 3 do not have `tdd="true"` in the plan frontmatter — they combined implementation + test/doc updates in single commits per the plan's own file lists.

## Threat Flags

None — this plan's file changes stay within the surface enumerated in the plan's `<threat_model>`. The one new authenticated network path (bridge → Skynet /voice/transcribe with Bearer JWT) IS the threat surface the plan's STRIDE register (T-98-08-01 through T-98-08-07) already covers. No new endpoints, no new file access patterns, no schema changes at trust boundaries beyond what the plan's threat_model documented.

The bridge JWT is stored in `/state/config.env` at 0644 (T-98-08-03 accept disposition — bind-mounted volume shared between Skynet and tg-bridge containers only; equivalent trust to bot tokens already stored there). This state was pre-existing and the disposition is unchanged.

---
*Phase: 98-more-versatile-stt-tts-support-swap-local-rig-for-amazon-pol*
*Completed: 2026-09-10*
