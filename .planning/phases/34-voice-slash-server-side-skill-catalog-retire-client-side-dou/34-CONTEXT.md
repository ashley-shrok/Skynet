# Phase 34: voice-slash-server-side-skill-catalog — Context

**Gathered:** 2026-08-13
**Status:** Ready for planning
**Source:** Live orchestrator↔user design conversation 2026-08-13 (skipped `/gsd:discuss-phase` — decisions already settled inline before phase creation)

<domain>
## Phase Boundary

Retire the client-side doubled-word intent-transform (voice-first shortcut where "bounty bounty add X" rewrites to "/bounty add X") in favor of a **server-side, STT-endpoint-scoped transform** that lets Ashley say "**slash `<skill-name>` `<args>`**" (voice-first path only) to invoke ANY skill present on the target box's `~/.claude/skills/` — with no client-maintained registry. Deliver a complete end-to-end vertical: STT endpoint accepts target-pane context, gates on the wake-word, SSH-fetches the skill catalog on demand (fail-open on timeout), applies a greedy longest-prefix matcher against the words after "slash", and returns the transformed transcript to the client. Both endSend (direct-send path) and endAppend (into-textarea path) in `useVoiceRecording.ts` consume the pre-transformed transcript. The client-side `composeIntentTransform.ts` module + `INTENT_REGISTRY` + doubled-word regex + all associated tests are retired in the same phase.

## Out of Scope (explicit)

- **Project-scoped skills** (`.claude/skills/*` inside a repo). User-wide only (`~/.claude/skills/*/`) at v1; project-scoped deferred.
- **TTL cache** of the skill catalog. Not needed at v1 (see § Decisions). Adding one later is a small follow-up.
- **Typed-message transform.** Voice-only path — Ashley types `/foo` directly for typed slash-commands (already works today; nothing to change).
- **Doubled-word registry backwards-compat.** The `bounty bounty → /bounty` shortcut is fully retired — Ashley says "slash bounty add a banana" from voice going forward.

</domain>

<decisions>
## Implementation Decisions (LOCKED — from user)

### Transform location — server-side, at the STT endpoint

Ashley 2026-08-13 (verbatim): *"the best time to be doing it would be when we do the STT, because that's the only time this pattern is used. So whether I'm intending to hit the send button where the voice gets transcribed and sent right away, or I'm hitting the append button so that it ends up in the compose box, i feel like the place that this change should happen is like coming back from the stt transcription server."*

**Consequence:** the transform lives on the backend STT route, NOT in the client and NOT in the pretty-view WS `send-text-to-tmux` seam. Both `endSend` (direct-send path) and `endAppend` (glue-to-textarea path) in `useVoiceRecording.ts` receive the ALREADY-TRANSFORMED transcript from the server.

### Wake-word gate — cheap regex, runs on every STT return

The transcript must begin with `/^\s*slash[\s.,;:!?\-]+/` (case-insensitive) — same punctuation-tolerance class as the current doubled-word regex, front-anchored, matches Whisper's habit of inserting commas/periods around "slash". On a MISS, the STT endpoint returns the transcript unchanged with zero server-side work beyond the regex test — no SSH, no filesystem, no matcher.

### On wake-word HIT — SSH-fetch the skill catalog, greedy longest-prefix match

- **Fetch:** SSH `ls ~/.claude/skills/` on the target box (parse directory names — each subdirectory of `~/.claude/skills/` whose name matches `[a-z0-9-]+` is a skill). Executed via the existing `execCommand` + `connectOneShot` primitives (see `src/backend/database/routes/sessions.ts` for the canonical pattern used by the Kill route). Skill names are already kebab-case on disk.
- **Timeout:** generous **10s** deadline on the SSH round-trip. Ashley 2026-08-13 (verbatim): *"instead of a 500 millisecond hard timeout, I think we could increase the timeout to something way overboard, and as long as that call is only happening when the message begins with the word slash, then I feel like that's a good tradeoff ... I only invoke skills that way, you know, maybe a handful of times out of every dozens of messages."*
- **Fail-open:** if SSH errors, times out, returns empty, or the parse fails, return the raw transcript unchanged. No user-visible failure, no error toast, no thrown exception up to the STT client. The transcript still lands in the textarea / gets sent — Ashley will just see it wasn't rewritten and understand.
- **Matcher (greedy longest-prefix):**
  1. Strip the wake-word prefix. The remainder is the "post-slash" text.
  2. Tokenize post-slash: split on `[\s.,;:!?\-]+` (same punctuation-tolerance class). Lowercase all tokens. Empty tokens dropped.
  3. Normalize each candidate: for each prefix length K = min(len(tokens), MAX_SKILL_WORDS) down to 1, join the first K tokens with `-` (e.g. `["gsd","quick"]` → `"gsd-quick"`). MAX_SKILL_WORDS = 5 (defensive cap; skill names are almost always ≤3 words on disk).
  4. Look up each candidate in the skill catalog (Set for O(1) membership). Longest match wins (greedy).
  5. On match: return `"/{matched-skill} {rest-of-transcript-verbatim-after-the-matched-prefix}"`. "Verbatim" means: take the tail of the original post-slash string after the last character of the matched prefix's tokens (preserving whitespace / punctuation / capitalization exactly as spoken). If the tail is empty or whitespace-only, return just `"/{matched-skill}"` with no trailing space.
  6. On no match: return the raw transcript unchanged (passthrough — same posture as current registry gate).

### No TTL cache at v1

Ashley 2026-08-13 (verbatim): *"I don't send messages more than once every 60 seconds usually anyways, so [TTL] would basically do nothing anyways ... if it's not a big deal, then we probably don't even need any TTL."*

**Rationale:** SSH cost (~70-150ms for a fresh one-shot connection + `ls` + close) is dominated by STT latency (~500-2000ms). Wake-word gate keeps the fetch off the 90%+ of STT calls that aren't slash-invocations. Fetching per-invocation is fine given Ashley's ~1-msg-per-minute cadence. Per-`(hostId, tmuxSession)` cache with a 60s+ TTL is a small follow-up if latency ever becomes visible; not v1.

### Client responsibilities

- STT client passes `{hostId, tmuxSession}` alongside the audio blob to the existing `POST /voice/transcribe` route (or whatever the current STT route is — planner must resolve exact route name during file reads). Small backwards-compat consideration: if hostId is absent, server skips the transform entirely (fail-open — same effect as wake-word miss).
- `useVoiceRecording.ts` `endSend` (:465) and `endAppend` (:412) DELETE the client-side `applyIntentTransform(transcript).transformed` call and use the transcript from the server response verbatim. No local transform.
- Textarea/send paths downstream of `useVoiceRecording` consume the transformed transcript exactly as they do today — no changes.
- `composeIntentTransform.ts`, `INTENT_REGISTRY`, doubled-word regex, and `composeIntentTransform.test.ts` all DELETED. The `import { applyIntentTransform } from "./composeIntentTransform"` line in `useVoiceRecording.ts` DELETED. No backward-compat shim, no re-export, no rename.

### Backend responsibilities

- New helper module: `src/backend/voice/skill-catalog.ts` (or similar path — planner picks; must live near existing voice/STT code). Exports `fetchSkillCatalog(hostId: number, timeoutMs: number = 10000): Promise<Set<string>>`. SSH via `connectOneShot` + `execCommand`. Returns Set of skill names on success; throws or returns empty Set on failure (planner picks — but the caller MUST fail-open to raw-transcript behavior either way).
- New matcher module: `src/backend/voice/slashCommandTransform.ts` (or similar — colocate with skill-catalog helper). Exports a pure function: `applyServerSlashTransform(transcript: string, catalog: Set<string>): {transformed: string, matched: boolean, command: string | null}`. Same result shape as the retired client-side `IntentTransformResult` for symmetry, but produced server-side. Pure module — no I/O, no async, testable via truth tables.
- Wire both into the STT route handler: after transcription resolves, gate on the wake-word regex; on hit, `fetchSkillCatalog` with 10s timeout, then `applyServerSlashTransform`, then return `{transcript: transformed}` (or whatever the response envelope currently is — planner reads existing route to preserve the wire contract, extending only if necessary to accept hostId/tmuxSession params). On miss or fail, return `{transcript: raw}` unchanged.

### Skill catalog scope — user-wide only at v1

`~/.claude/skills/*/` on the target box. Project-scoped `.claude/skills/*` deferred to v2 (would require knowing the identity's project cwd, which the current dormancy-branch probe already computes as `discoverIdentitySessionFile`'s working set, but is out of scope here).

### Typed messages — untransformed by design

Voice-only path. Ashley types `/foo` directly for typed slash-commands (already works — that text lands in tmux as-is and Claude Code sees it as a skill invocation). No typed-path transform, no changes to the ComposeBox send handler.

### Claude's Discretion (planner picks)

- Exact new-module file paths under `src/backend/` (colocate near existing voice/STT code — the planner reads the existing STT route to find the right neighborhood).
- Exact route parameter shape for hostId/tmuxSession (query params vs form fields vs JSON body — pick what matches the STT route's existing convention; the current route uses multipart/form-data for the audio blob so a form field is likely the right shape).
- Whether `fetchSkillCatalog` returns `Set<string>` on failure vs throws (either is fine as long as the caller fail-opens to raw-transcript behavior).
- Whether the skill-catalog and matcher are one module or two (either is fine — pick for testability + colocation).
- Test file locations and naming (colocate with the modules).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing client-side code being retired
- `src/ui/features/pretty-view/composeIntentTransform.ts` — module being deleted. Read the full JSDoc block (design invariants, ReDoS notes) to understand what the transform currently guarantees; the new server-side matcher must uphold the SAME contract at the wake-word regex level (front-anchoring, punctuation tolerance, case-insensitivity, ReDoS safety).
- `src/ui/features/pretty-view/composeIntentTransform.test.ts` — existing test file. Delete along with the module. Mirror its test shape when writing the new server-side matcher tests.
- `src/ui/features/pretty-view/useVoiceRecording.ts:412` — `endAppend` call site of `applyIntentTransform`. Deleted.
- `src/ui/features/pretty-view/useVoiceRecording.ts:465` — `endSend` call site of `applyIntentTransform`. Deleted.

### Backend SSH primitives to reuse
- `src/backend/database/routes/sessions.ts` — canonical `connectOneShot` + `execCommand` pattern for one-shot SSH calls with timeout, used by the Kill-session route.
- `src/backend/ssh/tmux-helper.ts` — `execCommand(conn, cmd)` primitive (or similar — planner grep-verifies).
- `src/backend/ssh/ssh-one-shot.ts` (or wherever `connectOneShot` lives) — one-shot SSH connection with configurable timeout.

### Existing STT route (planner must locate + read)
- Grep for the STT route: `grep -rn "voice/transcribe\|/voice\|faster-whisper\|audio/transcriptions" src/backend/` — this is where the new transform hooks in. Read the full handler to understand current request shape (multipart form? query params?), response shape, error handling, and any existing per-request context (userId, hostId?).

### Fleet directives (from CLAUDE.md / role file — apply to plan)
- Backend edits require `npm run build:backend` (NOT just `npx tsc --noEmit`) as pre-commit typecheck — frontend `tsc --noEmit` misses backend TS errors that only surface at Docker build time.
- Full `npx vitest run` must exit 0 with ZERO failures before any commit is considered done (no red suite ever, even pre-existing).
- Executor's remit stops at code + commit + tests green + `npm run build:backend` exit 0. No deploy step (git push, docker build, docker compose up) — deploy is orchestrator-only per fleet rule.
- NO worktrees — this project has `workflow.use_worktrees=false` set.

</canonical_refs>

<specifics>
## Specific Ideas

### Concrete wake-word regex (paste-into-code shape)

```ts
// Front-anchored, punctuation-tolerant, case-insensitive "slash <content>" gate.
// Mirrors current composeIntentTransform.ts:69 shape (same delimiter class); the
// "must have content after" clause (`\S.*`) enforces the same requires-content
// contract — bare "slash" or "slash   " passes through unchanged (probable
// accidental send).
const WAKE_WORD_REGEX = /^\s*slash[\s.,;:!?\-]+(\S.*)$/is;
```

The single captured group is the post-slash content that goes into the tokenizer + matcher.

### Concrete matcher behavior (truth table, planner mirrors in tests)

Given catalog `{"gsd-quick", "gsd", "explain", "bounty", "queue"}`:

| Transcript (post-slash) | Match | Result |
|---|---|---|
| `"gsd quick fix the login bug"` | `gsd-quick` (2-token prefix beats 1-token) | `/gsd-quick fix the login bug` |
| `"gsd status"` | `gsd` (1-token, `gsd-status` not in catalog) | `/gsd status` |
| `"explain the NDA thing."` | `explain` | `/explain the NDA thing.` |
| `"bounty, add a banana button"` | `bounty` | `/bounty add a banana button` (leading comma+space eaten by tokenizer as delimiter) |
| `"queue"` | `queue` (empty tail) | `/queue` (no trailing space) |
| `"nonesuch do a thing"` | no match | raw transcript unchanged (passthrough) |
| `""` (empty post-slash) | wake-word regex would already have failed the `\S.*` clause | never reaches matcher |

### Concrete "verbatim tail" rule for the transformed output

The rewritten string preserves the post-slash tail EXACTLY as spoken, minus the matched-prefix tokens and their trailing delimiter. So `"gsd quick.  Fix the login bug"` → `/gsd-quick Fix the login bug` (leading period+spaces after "quick" are eaten, but "Fix" keeps its uppercase F). This mirrors the current client-side transform's `${command} ${rest}` shape at `composeIntentTransform.ts:101`.

</specifics>

<deferred>
## Deferred Ideas

- **TTL cache** of skill catalog per `(hostId, tmuxSession)` — small follow-up if latency ever becomes visible. Ashley OK'd it as a v2.
- **Project-scoped skills** (`.claude/skills/*` inside identity's project cwd) — would layer on top of user-wide `~/.claude/skills/` in the catalog. Requires knowing the identity's cwd. Deferred.
- **Typed-path slash-transform** (typing "slash foo" gets rewritten to "/foo") — Ashley's usage is voice-first for slash-commands, typed path unchanged.
- **Feedback UX for no-match / SSH-fail cases** — currently silent passthrough (raw transcript). Could add a subtle toast/log if slash-invocations start missing. Defer until Ashley reports it.

</deferred>

<scope_fence>
## Scope Fence

- **In scope:** STT-route server-side transform, new backend helper (skill-catalog SSH fetch), new backend matcher (pure module), STT-route wiring, client-side deletion of `composeIntentTransform.ts` + tests + two call sites in `useVoiceRecording.ts`, backend tests for helper + matcher + route integration, minimal client tests to prove the two useVoiceRecording call sites now use server response verbatim.
- **NOT in scope:** UI changes (no new textareas, no toast, no visual affordance), ComposeBox / PrettyView / bubble-render changes, TTL cache, project-scoped skills, typed-message transform, any change to the audio-blob transport or Whisper-server side, any change to `tmux-helper.ts` or SSH primitives themselves (only reuse), any new frontend routes, any DB migration.
- **Rebase risk:** LOW — new backend surface + one client hook edit + client module deletion. No collisions with in-flight patches (tina's #433, my #431/#432/quick-260813-0qx). Backend STT route is not currently under active edits by other identities.

</scope_fence>

---

*Phase: 34-voice-slash-server-side-skill-catalog*
*Context gathered: 2026-08-13 via live orchestrator↔user conversation (skipped `/gsd:discuss-phase` — design decisions already settled before phase creation)*
