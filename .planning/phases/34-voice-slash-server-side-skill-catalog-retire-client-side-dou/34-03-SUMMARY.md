---
phase: 34-voice-slash-server-side-skill-catalog-retire-client-side-dou
plan: 03
subsystem: backend/voice + ui/pretty-view/voice-recording
tags: [backend, voice, stt, client-retirement, atomic-cutover, wave-2, phase-vertical-complete]
requires:
  - src/backend/voice/slashCommandTransform.ts (Wave 1 / Plan 34-01)
  - src/backend/voice/skill-catalog.ts (Wave 1 / Plan 34-02)
provides:
  - "Server-side voice-slash transform wired into POST /voice/transcribe (handleTranscribe)"
  - "Client hook posts hostId + tmuxSession alongside audio blob; consumes server transcript verbatim"
  - "Retirement of client-side composeIntentTransform + INTENT_REGISTRY + doubled-word regex"
affects:
  - "ComposeBox voice-first slash-invocation UX — Ashley says 'slash gsd status' → tmux receives '/gsd status' (was: 'bounty bounty add X' → tmux receives '/bounty add X'; new registry is unbounded, server-fetched per-invocation)"
tech-stack:
  added: []
  patterns:
    - "Atomic cutover pattern (backend wire-in + client retirement + file deletion) as a single commit — prevents intermediate state where BOTH sides transform (double-slash bug)"
    - "Multer form-field passthrough: multer.single('file') already parses non-file multipart fields into req.body; hostId + tmuxSession require zero middleware changes"
    - "Fail-open response envelope splice: {...sttJson, text: transformedText} preserves any other Whisper fields (segments, timings) while replacing only the text field on matcher hit"
key-files:
  created: []
  modified:
    - src/backend/database/routes/voice.ts (handleTranscribe extended + 2 imports + 1 route-comment line)
    - src/backend/database/routes/voice.test.ts (6 new SD-P34 tests + vi.mock + MockReq body field + makeReq body param)
    - src/ui/features/pretty-view/useVoiceRecording.ts (import deleted, 2 call sites replaced, transcribeBlob extended with 2 fd.append lines)
    - src/ui/features/pretty-view/useVoiceRecording.test.ts (I1-I4 replaced with P34-01..05, header comment updated)
  deleted:
    - src/ui/features/pretty-view/composeIntentTransform.ts (4500 bytes, 105 lines)
    - src/ui/features/pretty-view/composeIntentTransform.test.ts (8035 bytes, 197 lines with 25 tests)
decisions:
  - "Composite grep 'composeIntentTransform' matches 4 comment-only historical references (2 in slashCommandTransform.ts JSDoc lines 33/78/89, 2 in test.tsx narrative comments at ComposeBox.aside-morph.test.tsx:130 and ComposeBox.test.tsx:1255). Left in place per plan Task 3 disposition rule 'bare comment ... fine'. The plan's acceptance criteria correctly target import/call-site patterns ('from \"./composeIntentTransform\"', 'applyIntentTransform', 'INTENT_REGISTRY') — all zero. Wave 1 file slashCommandTransform.ts is not editable per plan constraint ('do NOT modify their files')."
  - "Atomic single-commit boundary respected. Ran each task's <verify> as a progress gate but withheld git commit until Task 3's full-suite + tsc --noEmit + build:backend all passed. No intermediate 'server-transforms-and-client-transforms' commit ever existed."
metrics:
  duration: "11m 35s (start 2026-08-13T03:00:16Z → commit 2026-08-13T03:11:51Z)"
  completed: "2026-08-13"
  tasks_total: 3
  tasks_completed: 3
  files_modified: 4
  files_deleted: 2
  tests_added: 11 (6 backend SD-P34 + 5 client P34-0N)
  tests_removed: 29 (4 I-tests from useVoiceRecording + 25 composeIntentTransform tests)
  net_test_delta: -18
  tests_passing_full_suite: 2006
  commits: 1
---

# Phase 34 Plan 03: Atomic Cutover — Server-Side Voice-Slash Transform + Client Retirement Summary

**One-liner:** Wires the Wave 1 matcher + fetcher into the STT route, retires the client-side doubled-word intent-transform, and deletes the retired module — all as a single atomic commit so no intermediate state has both sides rewriting the transcript.

## What Shipped (the vertical is now end-to-end)

Ashley says **"slash gsd status"** into the mic in a pretty-view pane. The full path now runs:

```
useVoiceRecording.start()
  → MediaRecorder captures audio blob
useVoiceRecording.endSend("")
  → stopRecording() drains blob
  → transcribeBlob(blob):
      fd.append("file", blob, "clip.webm")
      fd.append("hostId", "42")           // NEW (Phase 34)
      fd.append("tmuxSession", "mysession")  // NEW (Phase 34)
      POST /voice/transcribe
        → authenticateJWT → multer.single("file") parses into req.body
        → handleTranscribe(req, res):
            fetch(STT_URL, {file}) → Whisper returns { text: "slash gsd status" }
            WAKE_WORD_REGEX.test(text) → true
            hostId="42" → parseInt → 42, Number.isFinite → true
            fetchSkillCatalog(42, "user-1", 10_000)  // Plan 34-02
              → SSH ls ~/.claude/skills/ → new Set(["gsd", "bounty", ...])
            applyServerSlashTransform("slash gsd status", catalog)  // Plan 34-01
              → { transformed: "/gsd status", matched: true, command: "gsd" }
            res.json({ ...sttJson, text: "/gsd status" })
      ← fetch resolves { text: "/gsd status" }
      return "/gsd status"
  ← transcript = "/gsd status"
  glued = applyGlue("", "/gsd status") = "/gsd status"
  return { transcript: "/gsd status", glued: "/gsd status" }
```

Downstream ComposeBox `send-text-to-tmux` receives `/gsd status` verbatim, tmux sends it to Claude Code, and Claude Code recognizes it as a skill invocation. NO client-side rewriting anywhere.

## Task-by-Task Delivery

### Task 1 — Backend wire-in (`voice.ts` + `voice.test.ts`)

**Two imports added at top:**
```ts
import { WAKE_WORD_REGEX, applyServerSlashTransform } from "../../voice/slashCommandTransform.js";
import { fetchSkillCatalog, DEFAULT_SKILL_CATALOG_TIMEOUT_MS } from "../../voice/skill-catalog.js";
```

**Transform block inserted between raw-json extraction and 200-response** (preserves existing `[voice-server] transcribe-ok` log line untouched — it fires on the raw text, before transform). Fail-open gates in order:
1. `rawText` must be non-empty string
2. `hostIdRaw` must be a string
3. `parseInt(hostIdRaw, 10)` must be finite AND > 0
4. `WAKE_WORD_REGEX.test(rawText)` must match

Only then does the server SSH-fetch. Outer try/catch defends against unreachable throws from the two Wave 1 modules (both are contract-non-throwing but the fail-open guard belts-and-suspenders that). On matcher hit, response splices `{ ...sttJson, text: transformedText }` — preserves any other Whisper fields Whisper returned (segments, word_timings) untouched.

**Route middleware:** zero middleware changes. multer's `upload.single("file")` already parses non-file multipart fields into `req.body` — added a one-line explanatory comment above `authenticateJWT` so future readers see this on inspection.

**Six new tests (`SD-P34-01` through `SD-P34-06`):**

| Test | Scenario | Expected |
|---|---|---|
| SD-P34-01 | hostId form field absent | raw transcript returned; fetchSkillCatalog NOT called |
| SD-P34-02 | wake-word regex misses ("hello world") | raw transcript returned; fetchSkillCatalog NOT called |
| SD-P34-03 | wake-word HIT + catalog HIT | transformed `/gsd status`; fetchSkillCatalog called with `(42, "user-1", 10_000)` |
| SD-P34-04 | wake-word HIT + empty catalog | raw transcript returned (matcher no-match branch) |
| SD-P34-05 | fetchSkillCatalog throws (defensive) | raw transcript returned via outer try/catch; res._status === 200 |
| SD-P34-06 | hostId non-numeric ("abc") | raw transcript returned; fetchSkillCatalog NOT called (Number.isFinite gate) |

`vi.mock("../../voice/skill-catalog.js", ...)` at module top; the pure matcher module intentionally NOT mocked (runs for real to assert transformed output). `MockReq` extended with optional `body?: Record<string, unknown>`; `makeReq` gained an optional 2nd param defaulting to undefined so all pre-existing 29 tests call it with a single arg unchanged.

**Verification:** `npx vitest run src/backend/database/routes/voice.test.ts` → **35 passed / 35 total**. `npm run build:backend` → **exit 0**.

### Task 2 — Client hook retire + form-field append (`useVoiceRecording.ts` + `.test.ts`)

**Import deleted** (line 54): `import { applyIntentTransform } from "./composeIntentTransform";`

**transcribeBlob extended** (was 40 lines, now 47) — 7 new lines add hostId + tmuxSession form fields when logContext provides them:
```ts
if (logContext?.hostId !== undefined) {
  fd.append("hostId", String(logContext.hostId));
}
if (logContext?.sessionId !== undefined) {
  fd.append("tmuxSession", logContext.sessionId);
}
```
The `logContext` param is already in scope — it's the hook's only arg, closed over on the `useVoiceRecording` factory line at :92. `String(logContext.hostId)` is required because FormData rejects raw numbers.

**Two call sites replaced** — both `endAppend` (line ~412) and `endSend` (line ~465) now consume the server transcript verbatim:
```ts
// Before:
const transformedTranscript = applyIntentTransform(transcript).transformed;
const glued = applyGlue(currentText, transformedTranscript);
return { transcript: transformedTranscript, glued };

// After:
const glued = applyGlue(currentText, transcript);
return { transcript, glued };
```

**Five new tests (`P34-01` through `P34-05`) replacing the four `I1-I4` tests:**

| Test | Scenario | Assertion |
|---|---|---|
| P34-01 | endAppend, server returns `/gsd-quick fix the login bug` | transcript + glued both === server text verbatim |
| P34-02 | endSend, server returns `/gsd-quick fix the login bug` | same shape as P34-01 for endSend path |
| P34-03 | endAppend, server returns `just some raw text` (no server transform) | transcript + glued both === "just some raw text" (no client-side rewrite) |
| P34-04 | logContext = {hostId: 42, sessionId: "mysession"} | fd.get("hostId") === "42", fd.get("tmuxSession") === "mysession", fd.get("file") not null |
| P34-05 | logContext omitted | fd.get("hostId") === null, fd.get("tmuxSession") === null, fd.get("file") not null |

**Verification:** `npx vitest run src/ui/features/pretty-view/useVoiceRecording.test.ts` → **21 passed / 21 total** (Tests 1-8, A-F, G-H, P34-01..05).

### Task 3 — Delete retired files + full-suite gates

Pre-check `grep -rn "composeIntentTransform|applyIntentTransform|INTENT_REGISTRY" src/` found 4 comment-only historical references outside the two files being deleted:

1. `src/backend/voice/slashCommandTransform.ts` lines 33, 78, 89 — JSDoc block comments referring to the retired module for historical context ("mirrors the retired composeIntentTransform.ts ... STRIDE T-54e-03"). This is a Wave 1 file (Plan 34-01, commit 756c6e3) that this plan is explicitly prohibited from modifying ("do NOT modify their files"). Comments compile cleanly and have no runtime/type impact. Left as-is.
2. `src/ui/features/pretty-view/ComposeBox.aside-morph.test.tsx:130` — bare narrative comment in a test file explaining historical patch #241 context. Plan explicitly documented this as safe ("if it's a bare comment, leave it").
3. `src/ui/features/pretty-view/ComposeBox.test.tsx:1255` — same shape as #2, narrative comment in the Vehicle B strip describe block explaining why /bounty (Target) prefix button was removed. Not enumerated in the plan's known-safe list but matches the identical bare-comment pattern; left in place per the plan's disposition rule for #2.

Deletions performed via `rm`:
- `src/ui/features/pretty-view/composeIntentTransform.ts` (105 lines, 4500 bytes)
- `src/ui/features/pretty-view/composeIntentTransform.test.ts` (197 lines, 8035 bytes, 25 tests)

Post-delete acceptance grep gates (targeting import/call-site patterns, not comment references):

| Gate | Command | Result |
|---|---|---|
| Both files deleted from disk | `test -f …` on each | both exit 1 (file not found) |
| No `from "./composeIntentTransform"` imports | `grep -r ...` | 0 |
| No `from "./composeIntentTransform.js"` imports | `grep -r ...` | 0 |
| No `applyIntentTransform` call sites | `grep -r ...` | 0 |
| No `INTENT_REGISTRY` references | `grep -r ...` | 0 |
| Frontend typecheck | `npx tsc --noEmit` | exit 0 |
| Backend build | `npm run build:backend` | exit 0 |
| Full test suite | `npx vitest run` | **155 files pass, 2006 passed, 6 skipped, 1 todo, 0 failed** |

**Full-suite delta arithmetic** (validates no accidental orphan tests):
- Pre-Phase 34: 156 files / 2024 tests (per 34-02 SUMMARY baseline)
- Post-Plan 34-03: 155 files / 2013 tests (2006 pass + 6 skip + 1 todo)
- Delta: -1 file (composeIntentTransform.test.ts deleted), +5 tests (P34-01..05), +6 tests (SD-P34-01..06), -4 tests (I1-I4 deleted), -25 tests (composeIntentTransform.test.ts contents deleted)
- Expected: 2024 + 5 + 6 - 4 - 25 = **2006** → matches exactly. Zero drift.

## Deviations from Plan

**None.** Plan 34-03 executed exactly as written. All three tasks landed in a single atomic commit per the ⚠️ ATOMICITY note. Task-by-task `<verify>` blocks ran as progress gates; commit was withheld until Task 3's full-suite + tsc --noEmit + build:backend all exited 0.

The four comment-only historical references (2 in Wave 1 JSDoc, 2 in test narrative) matching `composeIntentTransform` are documented as decisions above — they satisfy the plan's Task 3 disposition rule ("bare comment ... fine") and the plan's acceptance criteria (which target import/call-site patterns, all zero).

## Threat Flags

None. Plan 34-03's threat model already registered T-34-03-01 through T-34-03-04 with `mitigate` disposition:
- **T-34-03-01 (Tampering — hostId injection):** `parseInt` + `Number.isFinite` + `> 0` guards; test SD-P34-06 pins non-numeric drop.
- **T-34-03-02 (DoS — per-message SSH):** Wake-word regex gate short-circuits ~90% of transcripts; test SD-P34-02 pins skip on miss.
- **T-34-03-03 (DoS — wedged tailnet host):** `DEFAULT_SKILL_CATALOG_TIMEOUT_MS` = 10s outer deadline on fetch; test SD-P34-05 pins fail-open on throw.
- **T-34-03-04 (Info Disclosure — skill names):** raw transcript passthrough on no-match; test SD-P34-04 pins empty-catalog case.
- **T-34-03-SC (Package installs):** none in this phase.

No new security surface introduced beyond the plan's threat register.

## Known Stubs

None. The vertical is fully wired end-to-end. `useVoiceRecording` returns real server transcripts; `handleTranscribe` performs real SSH catalog fetches on wake-word hits; matcher runs the real Wave 1 pure kernel. No placeholder returns, no mock-only branches at runtime.

## Key Decisions Recorded

- **Atomic cutover was mandatory.** Splitting into "wire backend" + "delete client" as separate commits would leave an intermediate state where both sides transform, producing double-slashes on skill hits (server rewrites `slash gsd X` → `/gsd X`; client would then treat that literal `/gsd X` as typed input and pass it through unchanged... but the compose box would show the server-transformed text out of sync with user's spoken words). Landed as a single 6-file commit per the plan's ⚠️ ATOMICITY note.
- **Fail-open response envelope splice preserves other Whisper fields.** `{...sttJson, text: transformedText}` uses object spread to keep any auxiliary fields (segments, word_timings, language) that Whisper returns intact — only the `text` field is replaced on matcher hit. On matcher miss, response returns `sttJson` verbatim (byte-identical to pre-Phase 34 behavior).
- **Outer try/catch is defensive belt-and-suspenders.** Both Wave 1 modules (matcher pure + fetcher fail-open Set) are contract-non-throwing per their SUMMARY files (Plan 34-02 explicitly extended fail-open coverage over `resolveHostById` throws as a Rule 2 tightening). The outer try/catch in handleTranscribe defends against any future contract regression — a defensive throw would degrade to raw-transcript passthrough via the catch, never a 500 to the client.
- **hostId + tmuxSession are omitted (not empty-string) when logContext is missing.** FormData.get returns `null` for missing keys; server's typeof-check `typeof req.body?.hostId === "string"` correctly distinguishes "absent" from "empty string" from "string of zero length" — all three degrade to skip-transform. Test P34-05 pins the absent case.

## Commits

| Hash | Message |
|---|---|
| `728973a` | `feat(34-03): atomic cutover — server-side voice-slash transform + client retirement` |

Single atomic commit for the plan per the ⚠️ ATOMICITY constraint. Planning docs (SUMMARY.md, STATE.md, ROADMAP.md) will be committed by the orchestrator in the final metadata step, not by this executor.

## Self-Check: PASSED

Verified after commit:

- `src/backend/database/routes/voice.ts` — MODIFIED (2 imports + transform block + route comment) — FOUND at commit 728973a
- `src/backend/database/routes/voice.test.ts` — MODIFIED (vi.mock + MockReq body + 6 SD-P34 tests) — FOUND at commit 728973a
- `src/ui/features/pretty-view/useVoiceRecording.ts` — MODIFIED (import deleted, 2 call sites replaced, 2 fd.append lines added) — FOUND at commit 728973a
- `src/ui/features/pretty-view/useVoiceRecording.test.ts` — MODIFIED (I1-I4 replaced with P34-01..05) — FOUND at commit 728973a
- `src/ui/features/pretty-view/composeIntentTransform.ts` — DELETED — CONFIRMED (test -f exits 1)
- `src/ui/features/pretty-view/composeIntentTransform.test.ts` — DELETED — CONFIRMED (test -f exits 1)
- Commit `728973a` — FOUND on branch `feat/tab-title-from-tmux` (`git log --oneline -3` shows it at HEAD above `b7b906d` / `756c6e3`)
- `npm run build:backend` exit 0 — CONFIRMED
- `npx tsc --noEmit` exit 0 — CONFIRMED
- `npx vitest run` full suite: 155 files pass, 2006 passed, 6 skipped, 1 todo, **0 failed** — CONFIRMED
- Only 2 deletions in the commit, both were retired files explicitly enumerated in the plan (`git diff --diff-filter=D --name-only HEAD~1 HEAD` returns exactly those two paths)
- 6 files changed total (`git show --stat 728973a`) — matches the plan's "6 files modified" output spec exactly
- Wave 1 files NOT touched: `slashCommandTransform.ts`, `slashCommandTransform.test.ts`, `skill-catalog.ts`, `skill-catalog.test.ts` all show no changes in this commit
- Grep contracts all zero: `applyIntentTransform`, `INTENT_REGISTRY`, `from "./composeIntentTransform"`, `from "./composeIntentTransform.js"` all return 0 matches in src/
