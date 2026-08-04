---
phase: 20-identity-creation-ui
verified: 2026-08-03T05:10:00Z
status: human_needed
score: 10/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Birth a real test identity on a remote host end-to-end"
    expected: "All 5 steps tick green, pane switches to new session, fresh identity's /id create-path fires"
    why_human: "End-to-end requires SSH to real Tailscale host, real OpenAI API key, real tmux session — cannot be exercised in CI without a running container"
  - test: "Self-birth on skynet-ec2 (local-exec branch)"
    expected: "Birth completes using local child_process.exec rather than SSH; session opens and /id fires"
    why_human: "Requires container running Skynet with the new routes deployed"
  - test: "Skynet-side collision block (create a name that already exists in the identities table)"
    expected: "Inline red 'Already exists in Skynet' appears under name field; Create button stays disabled"
    why_human: "UI behaviour in real browser against live backend"
  - test: "Target-host-side collision block (name whose ~/.claude/identities/<name>/ folder exists on target host)"
    expected: "Inline red 'Already exists on <hostname>' appears; Create button stays disabled"
    why_human: "Requires live SSH probe to real host"
  - test: "Failure blurb at each step (kill SSH mid-step-2, verify step-2 blurb renders)"
    expected: "Step 2 shows red X, failure blurb text matches CONTEXT.md spec verbatim, modal stays open"
    why_human: "Requires network-level intervention against a running birth stream"
  - test: "Avatar Generate/Regenerate loop in browser"
    expected: "3 horizontal gamma-corrected candidate images render; clicking each picks it (visual ring); Regen produces visually different set; Create disabled until a candidate is picked"
    why_human: "Requires OPENAI_API_KEY set in container and browser interaction to verify visual state"
  - test: "Voice picker sample playback in new modal"
    expected: "Clicking Volume2 icon plays a short audio sample via postSpeak"
    why_human: "Audio playback requires real browser with audio device"
  - test: "Focus-follow on successful birth"
    expected: "Modal closes and conversation-list view switches to the newly-birthed session tab automatically"
    why_human: "End-to-end flow only observable in running app"
  - test: "Cancel button is ABSENT during birth and reappears after failure"
    expected: "No Cancel button visible while birth SSE stream is in-flight; Cancel reappears after failed step so user can close"
    why_human: "Visual browser state during an in-flight SSE stream"
---

# Phase 20: Identity Creation UI — Verification Report

**Phase Goal:** Extend the primary NewSessionDialog (sidebar variant) so it can create a NEW fleet identity end-to-end — the compound-birth path: generate/pick avatar, pick voice+color, set path, set name+title, ephemeral brief; on Create, orchestrate identity write + avatar upload + target-host bootstrap (Nelly-cribbed sequence verbatim) + first `/id <name>` invocation, all with per-step SSE progress. No cancel, no retry, no rollback. Focus follows completion to the newly-born agent.
**Verified:** 2026-08-03T05:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Primary sidebar `NewSessionDialog.tsx` has path field (both modes) and identity-mode checkbox (defaults ON) revealing title, brief, avatar, VoicePicker, ColorPicker | VERIFIED | `src/ui/sidebar/NewSessionDialog.tsx` line count 916; `identityMode` useState(true); path field visible in both branches (lines 253-264); `<VoicePicker>` L843, `<ColorPicker>` L860 |
| 2 | Avatar batch endpoint exists, runs LLM archetype draft + 3 parallel gpt-image-1 + gamma 0.7, returns 3 candidate URLs | VERIFIED | `identity-avatar-batch.ts` exists, implements Promise.all for 3 image calls, raw-pixel Math.pow gamma correction, in-memory TTL cache; 11 tests pass |
| 3 | Target-host collision probe exists (GET /identities/exists-on-host), has SSH + local-exec branches | VERIFIED | `identity-exists-on-host.ts` exists; mounts at `/identities` prefix with `/exists-on-host` sub-path; uses `isLocalHostId` for branch selection; 10 tests pass |
| 4 | Compound birth endpoint (POST /identities/birth) streams SSE, runs 5-step Nelly-cribbed sequence | VERIFIED | `identity-birth-orchestrator.ts` + `identity-birth.ts` exist; ENTER_TRAIN_COUNT=7, ENTER_TRAIN_SPACING_MS=3000, SETTLE_SECONDS=22 exported verbatim; `hasTrustDialogAccepted` written before claude launch; CLAUDE_CODE_RESUME env vars verbatim; no capture-pane; 26+8=34 tests pass |
| 5 | `tmux send-keys` uses plain `-t <name>` (never `-t "=<name>"` — tmux 3.4 trap) | VERIFIED | `grep -n '-t "=' orchestrator.ts` returns only 1 result which is a code comment warning. Actual exec calls use `-t ${opts.name}` (lines 385, 388, 402, 413, 414) |
| 6 | Both nginx configs have routes for /identities/avatar, /identities/exists-on-host, /identities/birth with correct ordering (specific before general) and SSE directives on birth | VERIFIED | nginx.conf L210-251 and nginx-https.conf L221-262 show all three Phase 20 blocks declared before `location ~ ^/identities(/.*)?$`; birth block has `proxy_buffering off; chunked_transfer_encoding on` |
| 7 | VoicePicker + ColorPicker extracted to `src/ui/features/pretty-view/pickers/` and IdentityModal.tsx consumes them (not inline) | VERIFIED | Both files exist; IdentityModal.tsx L1095, L1101 use `<VoicePicker>` and `<ColorPicker>`; VoicePicker preserves patch #211 `Promise.resolve(audio.play()).catch(()=>{})` guard verbatim at VoicePicker.tsx L66-67 |
| 8 | Brief field is EPHEMERAL: zero localStorage/sessionStorage call sites in NewSessionDialog.tsx | VERIFIED | `grep -c "localStorage\|sessionStorage" src/ui/sidebar/NewSessionDialog.tsx` = 0; `brief` is only in React state (useState("")) and forwarded to postGenerateAvatarBatch and the onCreate payload |
| 9 | No cancel/retry/rollback affordances in the new frontend surface | VERIFIED | Lines 31, 356, 883 are comment/JSX-comment references only; `grep -n "cancelBirth\|retryBirth\|rollback" NewSessionDialog.tsx` returns 0; Cancel Button wrapped in `{!birthing && ...}` so it disappears during birth (hidden, not disabled); no retry-birth button exists |
| 10 | CommandPalette variant `src/ui/features/session-launcher/NewSessionDialog.tsx` is untouched (106 lines, zero identity-mode content) | VERIFIED | File is 106 lines; `grep -c "identityMode\|VoicePicker\|ColorPicker\|avatar" = 0`; last git commit on that file predates Phase 20 |

**Score:** 10/10 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/backend/database/routes/identity-avatar-batch.ts` | POST /batch + GET /candidate/:id + in-memory TTL cache | VERIFIED | 11 tests; getCandidateForBirth + consumeCandidateForBirth also exported |
| `src/backend/database/routes/identity-avatar-batch.test.ts` | 9+ tests for batch, gamma, cache, JWT gate | VERIFIED | 11 `it()` blocks (expanded from plan's 9) |
| `src/backend/database/routes/identity-exists-on-host.ts` | GET /exists-on-host + SSH + local branches | VERIFIED | 10 tests; IDENTITY_KEY_RE gate; single-quoted name in shell command |
| `src/backend/database/routes/identity-exists-on-host.test.ts` | 10 tests: local branch, SSH branch, ownership, name validation | VERIFIED | 10 `it()` blocks |
| `src/backend/database/routes/identity-birth-orchestrator.ts` | birthIdentity() pure function + Nelly constants | VERIFIED | 26 test blocks; ENTER_TRAIN_COUNT=7, ENTER_TRAIN_SPACING_MS=3000, SETTLE_SECONDS=22 |
| `src/backend/database/routes/identity-birth-orchestrator.test.ts` | 18+ orchestrator tests | VERIFIED | 26 `it()` blocks |
| `src/backend/database/routes/identity-birth.ts` | SSE route wrapping orchestrator | VERIFIED | `text/event-stream`, `flushHeaders`, `event: birth` frame format |
| `src/backend/database/routes/identity-birth.test.ts` | 5 SSE route-level tests | VERIFIED | 8 `it()` blocks |
| `src/ui/features/pretty-view/pickers/VoicePicker.tsx` | Standalone voice picker reusable component | VERIFIED | 7 tests; SAMPLE_PHRASE re-exported; patch #211 guard preserved |
| `src/ui/features/pretty-view/pickers/ColorPicker.tsx` | Standalone color hue slider component | VERIFIED | 6 tests; pure controlled component |
| `src/ui/sidebar/NewSessionDialog.tsx` | Extended modal with all birth-mode fields | VERIFIED | 916 lines (from 274); all field state present; BirthProgress inline sub-component |
| `src/ui/sidebar/NewSessionDialog.test.tsx` | 43 tests covering all new behaviors | VERIFIED | 43 `it()` blocks (9 existing + 22 plan-05 + 12 plan-06) |
| `src/ui/api/identities-api.ts` | postGenerateAvatarBatch + getIdentityExistsOnHost + openBirthStream | VERIFIED | All three exported; openBirthStream is async generator with SSE frame parser |
| `src/ui/api/identities-api.test.ts` | 5 tests for openBirthStream | VERIFIED | 5 `it()` blocks |
| `docker/nginx.conf` | All three Phase 20 route blocks above /identities | VERIFIED | Lines 210-251; ordering confirmed |
| `docker/nginx-https.conf` | Mirror of nginx.conf | VERIFIED | Lines 221-262; identical ordering |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `identity-avatar-batch.ts` | api.openai.com (chat/completions + images/generations) | `fetch` with `process.env.OPENAI_API_KEY` | VERIFIED | Both URL patterns present; AbortController guards (30s archetype, 60s image gen) |
| `database.ts` | identity-avatar-batch router | `app.use("/identities/avatar", identityAvatarBatchRoutes)` | VERIFIED | Line 1800 |
| `database.ts` | identity-birth router | `app.use("/identities/birth", identityBirthRoutes)` | VERIFIED | Line 1804 — before general /identities |
| `database.ts` | identity-exists-on-host router | `app.use("/identities", identityExistsOnHostRoutes)` | VERIFIED | Line 1807 — before identitiesRoutes |
| `identity-exists-on-host.ts` | `connectOneShot` (SSH) + `isLocalHostId` | import | VERIFIED | Both imported; SSH branch uses connectOneShot + execCommand |
| `identity-birth-orchestrator.ts` | `connectOneShot` + `execCommand` + `isLocalHostId` | injected BirthDeps | VERIFIED | Dependency-injected for testability; real deps wired in route |
| `identity-birth-orchestrator.ts` | `getCandidateForBirth` (plan 01 cache) | BirthDeps.getCandidateForBirth | VERIFIED | Exported from identity-avatar-batch.ts and injected into orchestrator |
| `NewSessionDialog.tsx (sidebar)` | `VoicePicker` from pickers/ | import | VERIFIED | L52: `from "@/features/pretty-view/pickers/VoicePicker"` |
| `NewSessionDialog.tsx (sidebar)` | `ColorPicker` from pickers/ | import | VERIFIED | L53: `from "@/features/pretty-view/pickers/ColorPicker"` |
| `NewSessionDialog.tsx (sidebar)` | `openBirthStream` in identities-api.ts | fetch + ReadableStream SSE consumer | VERIFIED | L58 import; used in handleBirth() for identity-mode ON |
| `NewSessionDialog.tsx (sidebar)` | AppShell `onCreateSession` callback | `onCreate()` on `ended:ok:true` | VERIFIED | L472-485: onCreate called with full opts on success, then onClose() |
| `AppShell.tsx` | openTab with targetTmuxSession + allowCreateTmux | opts.identityMode discriminated union | VERIFIED | L1414-1424: uses opts.name as sessionName; allowCreateTmux: !opts.identityMode |
| `PrettyConversationsPanel.tsx` | NewSessionOnCreateOpts type | import from NewSessionDialog | VERIFIED | L82: imports type; L191: typed prop |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `NewSessionDialog.tsx` candidates | `candidates: AvatarCandidate[]` | `postGenerateAvatarBatch()` → `/identities/avatar/batch` → OpenAI API | Yes (gpt-image-1 via real fetch; guarded by OPENAI_API_KEY 503 check) | FLOWING (conditionally — requires API key in env) |
| `NewSessionDialog.tsx` collision state | `skynetCollision, hostCollision` | `listIdentities()` + `getIdentityExistsOnHost()` → backend routes | Yes — live DB query + SSH probe | FLOWING |
| `NewSessionDialog.tsx` birthProgress | BirthStepState[] | SSE stream from POST /identities/birth | Yes — backend runs real tmux + SSH sequence | FLOWING |

---

### Behavioral Spot-Checks

Step 7b: SKIPPED (no runnable entry points — container not redeployed; backend routes exist but cannot be exercised without running container + OPENAI_API_KEY env + SSH network access to fleet).

---

### Probe Execution

Step 7c: No probe scripts found for Phase 20. N/A.

---

### Requirements Coverage

IDUI requirement IDs are defined in ROADMAP.md Phase 20 section (not REQUIREMENTS.md, which covers earlier patches). All 10 are mapped to plan files and verified:

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| IDUI-01 | 20-05 | Path field (both modes) + identity-mode checkbox defaults ON | VERIFIED | NewSessionDialog.tsx: path field in JSX for both modes; `useState(true)` for identityMode |
| IDUI-02 | 20-05 | Birth field cluster: title, brief (ephemeral), avatar (required pick), voice (reused), color (reused) | VERIFIED | All fields in state + JSX; VoicePicker + ColorPicker from pickers/; brief = 0 persistence calls |
| IDUI-03 | 20-05 | Path field: default ~, backslash→forward slash, mkdir -p server-side | VERIFIED | normalizePath() exported from NewSessionDialog.tsx; mkdir -p in orchestrator step 2 |
| IDUI-04 | 20-01, 20-05 | Avatar batch endpoint + gamma 0.7 + fresh archetype per regen + required pick | VERIFIED | identity-avatar-batch.ts; 11 tests; getCandidateForBirth guards pick requirement |
| IDUI-05 | 20-02, 20-05 | Both-side collision blocking: Skynet-side + target-host-side | VERIFIED | identity-exists-on-host.ts; NewSessionDialog collision precheck state; inline error text naming which side |
| IDUI-06 | 20-04 | 5-step Nelly-cribbed compound birth sequence | VERIFIED | identity-birth-orchestrator.ts; all 5 steps implemented with correct sleep timings and tmux syntax |
| IDUI-07 | 20-06 | Per-step progress (5 ticking checkboxes via SSE) + focus-follow on success | VERIFIED | BirthProgress sub-component; SSE consumed in handleBirth(); onCreate + onClose called on ended:ok:true |
| IDUI-08 | 20-04, 20-06 | Per-step failure blurbs (verbatim from CONTEXT.md) + no rollback/retry/cancel | VERIFIED | BIRTH_STEP_BLURBS array matches CONTEXT.md verbatim; grep -c cancelBirth = 0; grep -c retryBirth = 0 |
| IDUI-09 | 20-04 | Self-birth: local-exec when isLocalHostId(hostId)===true | VERIFIED | identity-birth-orchestrator.ts uses `deps.execLocal` for local branch; 2 tests cover self-birth |
| IDUI-10 | 20-03 | Voice + color pickers reused from IdentityModal.tsx (extraction into pickers/) | VERIFIED | VoicePicker.tsx + ColorPicker.tsx in pickers/; IdentityModal refactored to use them; patch #211 guard preserved |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/ui/sidebar/NewSessionDialog.tsx` | 99 | `TODO (plan 06): Update AppShell.tsx onCreate handler...` | Info | Stale comment — AppShell WAS updated in plan 06 (confirmed: `opts.identityMode` appears at AppShell.tsx L1411+). No code is gated behind this TODO. The comment is cosmetic debt only. |

No FIXME, XXX, or TBD markers found in any Phase 20 files. No placeholder implementations found. No unreferenced debt markers. The single TODO is a residual comment that describes completed work; it does not reference any unimplemented code path.

---

### Human Verification Required

#### 1. End-to-end identity birth on a remote host

**Test:** With container deployed and OPENAI_API_KEY set, open the New Session dialog, select a remote host, fill name/title/brief, click Generate (wait ~30-90s for avatar batch), pick one candidate, fill voice/color, click Create.
**Expected:** All 5 steps tick green in sequence. Modal closes. Conversation list switches to the new session pane. The fresh identity's `/id create-path fires ("No identity found for <name>. Creating one now.")` is visible.
**Why human:** Requires live container, OPENAI_API_KEY, SSH to Tailscale host, real tmux session. Cannot verify in CI.

#### 2. Self-birth on skynet-ec2 (local-exec branch)

**Test:** Same as #1 but select `skynet-ec2` as the target host.
**Expected:** Birth completes using local child_process.exec (no SSH). Functional parity with remote path.
**Why human:** Requires deployed container and local-exec path exercised at runtime.

#### 3. Skynet-side name collision block

**Test:** Choose a name that already exists in the Skynet identities table. Tab away from the name field.
**Expected:** "Already exists in Skynet" appears in red below the name field within ~300ms. Create button stays disabled until name is changed.
**Why human:** Requires live backend + identity table with existing data.

#### 4. Target-host-side name collision block

**Test:** Choose a name whose `~/.claude/identities/<name>/` directory already exists on the selected target host.
**Expected:** "Already exists on <hostname>" appears in red below the name field. Create button stays disabled.
**Why human:** Requires SSH probe to real host with pre-existing identity folder.

#### 5. Per-step failure blurb verification

**Test:** Trigger a failure at step 2 (e.g., SSH to an unreachable host). Observe the failure UI.
**Expected:** Step 2 shows red XCircle icon. Below the 5-checkbox list, the verbatim step-2 blurb from CONTEXT.md appears: "Skynet record created, but couldn't open a tmux session on <host>. You'll need to delete the identity record..." Modal stays open. No Cancel-mid-birth button anywhere.
**Why human:** Requires live network-level failure injection.

#### 6. Avatar Generate/Regenerate visual verification

**Test:** Fill name/title/brief, click Generate, wait for 3 candidates to appear horizontally. Click one to pick it. Edit brief, click Regenerate. Observe new 3 candidates.
**Expected:** Candidates render as horizontal images with a visible ring/border on the picked one. Regen produces visually different images (fresh archetype). Generate button disabled during in-flight batch.
**Why human:** Visual rendering + OPENAI_API_KEY required.

#### 7. Voice picker sample playback in new modal

**Test:** In identity-mode ON, click the Volume2 icon in the voice picker section of the new create modal.
**Expected:** Short audio sample plays via postSpeak.
**Why human:** Audio playback requires real browser.

#### 8. Focus-follow on successful birth

**Test:** Complete a successful birth end-to-end.
**Expected:** After step 5 completes and `ended:ok:true` arrives, modal closes and the conversation list automatically selects/scrolls to the newly-birthed session.
**Why human:** End-to-end flow requiring deployed app.

#### 9. Cancel button visibility during birth

**Test:** Click Create (identity-mode ON) and observe the modal UI while the SSE stream is in-flight.
**Expected:** The Cancel button is invisible (hidden by `{!birthing && ...}` guard) during birth. No "Cancel Birth" button appears anywhere. After a failed step + `ended:ok:false`, Cancel reappears so the user can close.
**Why human:** Requires active in-flight SSE stream to observe intermediate UI state.

---

### Gaps Summary

No automated gaps. All 10 IDUI requirements have verifiable implementation in the codebase. Build is clean (`npm run build:backend` exits 0; `npx tsc --noEmit` exits 0). Full test suite passes (1217 tests, 97 files, 6 skipped). The only outstanding items are 9 human UAT checks that require a running container with the new code deployed, which is explicitly deferred per the phase's held-queue deploy posture (`sha256:07547f6c4185`).

---

_Verified: 2026-08-03T05:10:00Z_
_Verifier: Claude (gsd-verifier)_
