# Phase 20: Identity creation UI - Context

**Gathered:** 2026-08-03
**Status:** Ready for planning
**Source:** `/open` session with Ashley 2026-08-03 (shape file locked) → `/gsd:discuss-phase` 2026-08-03 (this file). Nelly's DM 2026-08-03 supplied the bootstrap mechanism spec.

<domain>
## Phase Boundary

Extend the New-Session modal to birth a whole new fleet identity in one motion — a compound flow that creates the Skynet-side identity record AND opens a tmux session on the target host AND launches a Claude CLI inside it AND does the "hit enter a few times" bootstrap dance AND sends `/id <name>` so the fresh identity begins its own onboarding dialogue — all triggered by one Create click, with modal staying open on per-step progress and focus following to the new session on completion.

**In scope:**
- Extension of `src/ui/sidebar/NewSessionDialog.tsx` (274 lines) — the PRIMARY New-Session modal opened from the pretty-conversations panel's pencil icon
- New **path field** visible in both regular-session and identity-mode (default `~`, tilde-expanded, `/`-or-`\`-tolerant, `mkdir -p` on target host if missing)
- New **identity-mode checkbox** (defaults ON) that reveals the identity-birth field cluster below the existing host+name fields
- Identity-birth field cluster (visible when checkbox is on): **title**, **brief** (ephemeral, avatar-prompt seed only), **avatar** (Generate/Regenerate loop of 3 horizontal gamma-corrected candidates with fresh archetype every regen and required pick), **voice** (reused from `IdentityModal.tsx`), **color** (reused from `IdentityModal.tsx`)
- Backend avatar generation pipeline: LLM archetype draft (from name+title+brief) → 3 parallel gpt-image-1 calls → gamma 0.7 correction per image → return 3 URLs for modal to display
- Backend compound-birth endpoint (recommend one orchestrator with SSE progress stream, planner's call) that runs the 5-step birth sequence per Nelly's mechanism
- Compound birth sequence (5 steps, matching shape file's granularity — see `<decisions>` below for the exact Nelly-cribbed sequence)
- Per-step progress rendering in modal (5 checkboxes ticking as steps complete)
- Per-step contextual failure messages (defaults drafted by Tina; Ashley overrides if any read wrong post-ship)
- Collision blocking on BOTH Skynet-side (409 pre-check via GET `/identities`) AND target-host-side (backend probes `~/.claude/identities/<name>/` over SSH before submit)
- Focus-follow to the new session on success (modal closes, conversation view switches to the fresh identity's session)
- Self-birth support: when target host IS `skynet-ec2` itself, backend runs the tmux/claude commands locally instead of via SSH
- Frontend + backend tests, `skynet-patches.md` entry, ship as numbered patch(es) after #288

**Out of scope (deliberate, Ashley-confirmed):**
- **Homeserver-register / relay.json bootstrap for the fresh identity** — Ashley 2026-08-03 verbatim: "Nelly does not do that part for the relay, so it wouldn't be part of what you're building either." Identities have historically handled their own relay setup via the /id skill or first-wake onboarding. Do NOT add a homeserver-register step to the birth sequence. (Related concern flagged to Nelly on the relay: if the current homeserver requires her to do that step for other identities as a workaround, that's a separate problem to fix at the source, NOT to bake into Skynet.)
- The second, smaller `src/ui/features/session-launcher/NewSessionDialog.tsx` (106 lines) opened from CommandPalette — stays regular-session-only; no identity-mode. Only the primary sidebar variant gets the upgrade.
- Voice list gender-splitting or defaults-per-gender — Ashley flagged as a separate concern (see `<deferred>`).
- Any visible archetype-prompt editor — the prompt is a black box under Generate. Regen re-runs the LLM archetype draft with the same inputs, producing a genuinely different spin every time.
- Review-before-commit / rollback / retry / cancel-mid-birth — Ashley locked these out during `/open`.
- Batch-size tuning UI — three is fixed.
- Reuse-existing-identity path from this modal — collisions BLOCK. Existing identities are edited from the existing `IdentityModal.tsx`.
- Any `description` / `personality` / `role` fields in the modal — the identity discovers itself via its own onboarding dialogue on first wake. The brief field is EPHEMERAL and only feeds the avatar prompt; it is never persisted anywhere.
- Auto-triggering avatar generation on field-fill — explicit Generate button, always.
- CEO-instance multi-user isolation concerns — this is single-operator scope for Ashley's box.

</domain>

<decisions>
## Implementation Decisions

### Frontend modal target
- **Extend `src/ui/sidebar/NewSessionDialog.tsx`** (274 lines) — this is the primary modal opened from the pretty-conversations panel pencil icon (`src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:979`).
- Leave `src/ui/features/session-launcher/NewSessionDialog.tsx` (the smaller CommandPalette variant, 106 lines) alone. No identity-mode there.

### Field additions to the sidebar modal
- **Path field (both modes).** Default value `~`. Client accepts either `/` or `\` and normalizes to `/`. Tilde expansion happens server-side (target-host-relative). Server runs `mkdir -p <expanded-path>` on target host if the directory does not exist. Empty path field = same as `~`.
- **Identity-mode checkbox (defaults ON).** When on, reveals the identity-birth field cluster below the existing host+name fields.

### Identity-birth field cluster (visible when identity-mode is on)
- **Title.** Free text, required, maps to `displayName` in the identity record.
- **Brief.** Multiline text, required, EPHEMERAL. Sent to backend for avatar-prompt seed ONLY. Backend does NOT store it anywhere (not in the identity row, not in a separate table, not in a log). Any implementation that persists it is a plan-checker BLOCK per shape file's "What would make it wrong" § 1.
- **Avatar.** Generate/Regenerate button. Produces 3 horizontal gamma-corrected candidates. User must pick one — Create button disabled until a candidate is picked. Every press of Generate/Regenerate re-runs the LLM archetype draft from the current (name + title + brief) inputs, producing a genuinely different spin (NOT same-prompt-different-seeds). Prompt itself is hidden from the user.
- **Voice.** Reused from `IdentityModal.tsx` voice picker (patch #223 surface, L186-190 + L1144). Planner's call whether to extract to a shared component (`src/ui/features/pretty-view/pickers/VoicePicker.tsx`) or inline-copy into the create modal — recommend extraction if the two modals will diverge in the future, recommend inline-copy if they'll stay in lockstep.
- **Color.** Reused from `IdentityModal.tsx` color picker (patch #279 surface, L190-192 + L836). Same extraction-vs-inline call as voice.

### Name field validation
- **Identity name (=identityKey).** Must match `[a-z0-9._=/+-]+` (backend `IDENTITY_KEY_RE` at `identities.ts:22`). Lowercased on submit.
- **Collision blocks (BOTH must pass before Create is enabled):**
  1. **Skynet-side.** GET `/identities` filtered by `identityKey === <typed>` returns non-empty → block. The backend's POST /identities already returns 409 on collision (identities.ts:129-132) but the modal should pre-check to keep the block synchronous and visible before the user picks an avatar.
  2. **Target-host-side.** Backend probes `~/.claude/identities/<name>/` on the target host (over SSH, or locally if self-birth) — if directory exists → block. New backend endpoint like `GET /identities/exists-on-host?host=<hostId>&name=<name>` returns `{exists: boolean}`.
- Both checks fire when the name field is filled and either (a) loses focus, or (b) the identity-mode checkbox becomes on with a name already filled.
- Collision UI: inline red text under the name field naming which side the collision is on ("Already exists in Skynet" / "Already exists on <host>"). Create stays disabled until name is changed.

### Avatar generation pipeline
- **New backend endpoint** `POST /identities/avatar/batch` (or similar path — planner's call). Request body: `{ name: string, title: string, brief: string }`. Response: `{ candidates: [{ url: string, id: string }, ...] }` — 3 candidates.
- **Server-side flow:**
  1. LLM archetype draft — call OpenAI Chat Completions API with a system prompt derived from the avatar-flow runbook's archetype-drafting pattern (see `~/.claude/identities/tina/runbooks/avatar-flow.md`). Input: name + title + brief. Output: image-generation prompt.
  2. gpt-image-1 batch — 3 PARALLEL calls with the same drafted prompt (fresh archetype was already picked at step 1; batch parallelism is for latency, not variance).
  3. Gamma correction — for each returned image, apply gamma 0.7 (`output = input^0.7` on normalized RGB per avatar-flow runbook). Python subprocess with Pillow+numpy is the existing recipe; Node/sharp-based alternative acceptable if it produces the same output.
  4. Store the 3 corrected images in a short-lived server-side cache keyed by a batch-id (temporary — expires ~10 min or when picked).
  5. Return URLs the modal can `<img src>`.
- **User picks one → its bytes get uploaded via existing `POST /identities` multipart contract** when Create fires (see "Compound birth sequence" below step 1).
- **OpenAI API key source:** Tina's `~/.claude/identities/tina/openai-key.json` on skynet-ec2 (mode 0600) is the operational key today. Backend reads it at boot. Planner should confirm this is the right sharing model during plan-phase, or propose Skynet gets its own key (deferred question — not a blocker for CONTEXT.md).
- **Regen semantics:** Every press of Generate/Regenerate is a fresh archetype draft (step 1 re-runs). No same-prompt-different-seeds mode. If a previous batch is in-flight when Regenerate is clicked, disable the button until the previous batch resolves (my call — Ashley waved forward). Cancellation of an in-flight batch is out of scope for v1.
- **Stale-avatar handling:** If the user picks an avatar and then edits name/title/brief afterward, the picked avatar stays (silently — no "your inputs changed, please regen" warning). User's call whether to regen. My call, matches "best we can" philosophy.

### Compound birth sequence (5 steps — per Nelly's mechanism, cribbed from `~/vms-apps/apps/home/agent-supervisor.sh` on thenasty)

Runs on backend after Create is clicked. Each step emits progress (SSE or equivalent — planner's call on transport):

**Step 1: Create Skynet identity record.**
- Backend POST to its own `identities` router with multipart body: `avatar` file = picked avatar bytes, `data` field = JSON `{identityKey, displayName: title, colorHue, voice}`. The **`data` field name is load-bearing** (see silent-no-op section in Tina's learned preferences — a wrong field name silently no-ops with 200).
- On success, GET-verify the row to confirm colorHue + voice + avatar hash stuck (silent-no-op guard).
- On failure → step-1 failure blurb, stop.

**Step 2: Open tmux session on target host.**
- If target host is `skynet-ec2` (self-birth): run locally. Otherwise: SSH into target host via Tailscale (crib the SSH orchestration shape from `~/.claude/skills/spawn-remote-agent/`).
- `mkdir -p <expanded-path>` — create working directory if missing.
- `tmux new-session -d -s <name> -c <expanded-path>` (optionally `-x 220 -y 50` per Nelly's terminal-sizing gotcha).
- `sleep 3` (login shell needs to source profile).
- On failure → step-2 failure blurb, stop.

**Step 3: Pre-set trust flag + launch Claude CLI.**
- Ensure `~/.claude.json` on target host has `.projects[<expanded-path>].hasTrustDialogAccepted = true` — see `accept_trust_for_workdir()` in `~/vms-apps/apps/home/agent-supervisor.sh:125` for the node one-liner recipe.
- `tmux send-keys -t <name> -l "CLAUDE_CODE_RESUME_THRESHOLD_MINUTES=99999999 CLAUDE_CODE_RESUME_TOKEN_THRESHOLD=99999999 claude --dangerously-skip-permissions"` (verbatim env-vars from Nelly — these dodge the resume-summary + resume-threshold prompts as belt-and-suspenders even though `--dangerously-skip-permissions` covers trust for fresh launches).
- `tmux send-keys -t <name> Enter`
- `sleep 2`
- On failure (send-keys errors — `-t "=<name>"` exact-match syntax is a known tmux3.4 trap; use plain `-t <name>`) → step-3 failure blurb, stop.

**Step 4: Blind Enter train (bootstrap dance).**
- Deliberately fire-and-forget, timing-based, NOT scrape-based. Nelly's rationale: "scrape logic is brittle." Overshoot is harmless — a spurious Enter at an empty REPL is a no-op.
- Loop 7 times: `tmux send-keys -t <name> Enter; sleep 3` (SETTLE_SECONDS=22 default).
- No detection of REPL-ready state. Always progress to step 5 after the loop completes.

**Step 5: Send `/id <name>`.**
- `tmux send-keys -t <name> -l "/id <name>"`
- `tmux send-keys -t <name> Enter`
- On success → close modal, focus to new session.
- On failure → step-5 failure blurb, close modal (session exists but /id didn't fire).

### Progress reporting granularity
- **5 steps as ticking checkboxes**, matching the shape file. My call per Ashley's "whatever you think for number three." Rationale: 5 mirrors the birth-sequence structure directly, gives the user enough feedback to know where a failure landed for the manual finish-up blurb, and avoids the noise of ~15 sub-steps (Enter train firing 7 times is one step, not seven).
- Transport: SSE stream from `POST /identities/birth` is my recommendation — cleanest to write on the modal side (`EventSource` with typed events `step:1:started`, `step:1:completed`, `step:N:failed:<reason>`, `birth:completed`). WebSocket alternative acceptable if there's an existing pattern in Skynet. Planner's call.
- Each step visible state: **pending** (dim), **in-progress** (spinner), **done** (green check), **failed** (red X + blurb below the checklist).

### Failure blurbs (my defaults; Ashley overrides post-ship if any read wrong)
- **Step 1 (Skynet record):** "Couldn't create the Skynet identity record. Nothing was created — safe to retry."
- **Step 2 (tmux session):** "Skynet record created, but couldn't open a tmux session on \<host>. You'll need to delete the identity record from the identity modal before retrying, or open the session by hand: \`ssh \<host> tmux new-session -d -s \<name> -c \<path>\`."
- **Step 3 (Claude CLI launch):** "Session is open on \<host>, but the Claude CLI didn't launch. Attach with \`ssh \<host> tmux attach -t \<name>\` and start it yourself."
- **Step 4 (bootstrap dance):** "Session is open and Claude launched, but the bootstrap dance didn't complete. Attach with \`ssh \<host> tmux attach -t \<name>\` and press Enter a few times until the REPL responds, then run \`/id \<name>\` yourself."
- **Step 5 (/id command):** "Session is at the REPL, but /id \<name> didn't fire. Attach with \`ssh \<host> tmux attach -t \<name>\` and run it yourself."

### Focus-follow on success
- Modal closes.
- Conversation-list view switches to the fresh identity's session tab.
- Rationale: the freshly-born identity is about to hit its own `/id` create-path, which prints "No identity found for <name>. Creating one now." then "Tell me about this role and I'll update the identity file." — the user needs to be looking at that pane the moment it renders, ready to answer.
- Implementation: on the SSE `birth:completed` event, modal fires an `onSuccess({ host, sessionName })` callback that the pretty-conversations panel handles by activating that session in its list.

### Field persistence on failure/close
- Modal state resets when closed after a failure (or a normal cancel). No draft store. If the user wants to retry, they re-fill the fields. My call, matches "best we can" philosophy — a draft store is significantly more complexity for a rare-per-user case.

### Skynet identity record contract details (from `src/backend/database/routes/identities.ts`)
- **POST /identities requires `avatar` file** (line 96-98) — 400 without it. Perfectly matches shape file's "avatar pick is required" without extra client-side enforcement.
- **`identityKey` is unique per user** — line 129-132 returns 409 with `Identity "\<key>" already exists`. Modal's pre-check saves the round-trip but the backend 409 is the source of truth.
- **Metadata field is `data` (not the JSON's contents)** — a wrong field name silently no-ops with 200. See Tina's learned preferences file for the full-field silent-no-op class. **All PUT and POST bodies MUST be multipart with `data` field.**
- **colorHue validated 0-359** (line 109-115).
- **voice must match `[A-Z][A-Za-z]+\.wav`** (line 223 — enforced by `IDENTITY_VOICE_RE`).
- **displayName is required** (line 106-108) — maps to modal's title field.
- **After the birth's step-1 POST, GET-verify the row** to confirm colorHue + voice + avatar hash stuck (patch #77 piece-1 arc lesson — 200 status is a worthless signal on this endpoint class).

### SSH orchestration shape (Nelly's explicit recommendation)
- Do NOT add a supervisor HTTP endpoint. Nelly's rationale: "8 lines of shell — adding an endpoint adds network + auth + daemon-liveness as new failure modes."
- Skynet backend runs the sequence INLINE over Tailscale SSH.
- Shape reference: `~/.claude/skills/spawn-remote-agent/` — same problem shape (unattended remote spawn), minus the birth-a-new-identity-record piece Phase 20 adds.
- Backend already has SSH machinery (identity edit modal talks to hosts, various host CRUD flows use SSH exec channel). Planner should identify the existing SSH-command-exec pattern in the codebase (grep for `exec-channel` or similar) and reuse it rather than introducing a new SSH primitive.

### Testing
- **Backend unit tests** for the orchestrator endpoint (mocking SSH shell-out): happy-path 5-step sequence, per-step failure paths, self-birth (skynet-ec2) uses local-exec branch, timing (blind Enter train fires 7 times at 3s intervals, verifiable via mock timer), fixture identity record verification after step 1.
- **Backend unit tests** for avatar batch endpoint: LLM archetype call with mocked response, gpt-image-1 x3 parallel with mocked response, gamma-correction determinism, cache expiry.
- **Frontend tests** for `NewSessionDialog.tsx` extension: mode-toggle field visibility, name-collision pre-check UI (both sides), avatar Generate/Regenerate loop with mocked batch endpoint, avatar-pick-required Create-button-enable logic, SSE progress consumption + step render, failure blurb per step, modal-close on failure resets fields, focus-follow onSuccess callback fires with correct payload.
- **End-to-end manual verify** (part of ship checklist, not a plan task): birth a real test identity on a real test host (e.g., ephemeral name like `phase20test`), verify all 5 steps tick green, verify pane switches to the new session, verify fresh identity's `/id` create-path fires, verify identity file scaffolded on target host. Then birth on skynet-ec2 itself (self-birth) and verify local-exec branch works. Then test both collision blocks (create a name that exists Skynet-side; create a name whose folder exists on target host). Then test at least one failure path (kill SSH mid-step-2, verify blurb).

### Ship
- Numbered patch(es) after #288. Planner slices — likely 3-5 plans: (1) backend avatar batch endpoint + LLM/gpt-image-1 integration + gamma correction; (2) backend orchestrator endpoint + SSH sequence + SSE progress + tests; (3) frontend modal extension + validation + pickers reuse; (4) frontend avatar loop + SSE consumption + progress UI + failure blurbs; (5) skynet-patches.md entries + human-verify checklist.
- Deploy per Tina's held-queue posture (patches #267-#288 currently held atop container `sha256:07547f6c4185`). Do NOT push / build / recreate without Ashley's explicit greenlight.

### Claude's Discretion
- **Exact number of plans + wave decomposition** — planner's call. Suggested slicing above.
- **SSE vs WebSocket vs long-poll for progress transport** — SSE recommended, but planner may pick differently if there's a stronger existing pattern in Skynet's backend.
- **Voice-picker + color-picker: extract to shared component vs inline-copy** — planner's call based on codebase pattern conventions.
- **Where the avatar batch's 3 candidates are cached server-side** — planner's call (in-memory Map with TTL / SQLite temp / filesystem tmpdir). Recommend in-memory with 10-min TTL for simplicity.
- **Node vs Python subprocess for gamma correction** — planner's call. Existing avatar-flow runbook uses Python+Pillow+numpy; Node+sharp is a fair alternative if it produces identical output. Verify with a spot-check.
- **Nginx location blocks** for any new backend routes — MUST be added to BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` (CLAUDE.md caveat, patch #232 lesson). Planner enumerates the routes.
- **RESUME-path relevance** — Nelly noted her supervisor's RESUME path (agent-supervisor.sh lines 227-323) is probably NOT relevant to Skynet since Skynet is birthing NEW identities, not resuming. Planner confirms during plan-phase.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Design source-of-truth (LOCKED)
- `~/.claude/identities/tina/bounties/identity-creation-ui/shape-identity-creation-ui.md` — Shape file from `/open` session with Ashley 2026-08-03. LOCKED per the "What would make it wrong" section. Do NOT re-litigate design.
- `~/.claude/identities/tina/bounties/identity-creation-ui/bounty.json` — Bounty tracker with Ashley's verbatim original ask + shape/vehicle timeline.

### Nelly's mechanism (source of truth for the birth sequence)
- Nelly's DM 2026-08-03: event `$IC059aLvfcQsVu01q-ffEil9TazzhU0AZ0wfl2zqLNs`, full text at `~/.claude/identities/tina/relay-state/messages/_IC059aLvfcQsVu01q-ffEil9TazzhU0AZ0wfl2zqLNs.txt`. Captures the full 8-line sequence, env-var rationale, failure modes, and architectural recommendation.
- `~/vms-apps/apps/home/agent-supervisor.sh` on thenasty (served at `http://100.113.23.63/vms/home/agent-supervisor`) — CANONICAL SOURCE for the bootstrap sequence. Relevant chunks:
  - Lines 106-142: env-var definitions + `accept_trust_for_workdir()` helper (the pre-launch trust-flag write recipe).
  - Lines 326-340: the FRESH-path drive() sequence (what Phase 20 cribs).
  - Lines 227-323: the RESUME path — probably NOT relevant to Phase 20 (Skynet births NEW, doesn't resume).
- `~/.claude/skills/spawn-remote-agent/` — Nelly's explicit reference for the SSH orchestration shape. Same problem shape as Phase 20's birth flow minus the identity-record piece.

### Skynet frontend (files to touch or reuse from)
- **`src/ui/sidebar/NewSessionDialog.tsx`** (274 lines) — PRIMARY target modal. This is the one that gets the path field, identity-mode checkbox, and identity-birth field cluster.
- `src/ui/features/session-launcher/NewSessionDialog.tsx` (106 lines) — smaller CommandPalette variant. NOT touched by Phase 20.
- **`src/ui/features/pretty-view/IdentityModal.tsx`** (1494 lines) — source of the voice picker (patch #223, L186-190 + L396-402 + L404-410 + L790 + L822-825 + L853-854 + L877 + L1144-1150+) and color picker (patch #279, L190-192 + L400-401 + L826-828 + L836 + L856). Reuse pattern TBD (extract vs inline-copy).
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:979` — the caller that opens the primary NewSessionDialog. Consumes the `onCreate({ host, sessionName })` callback. Phase 20 changes its onSuccess-focus-follow behavior when identity-mode was on.
- `src/ui/api/` — new API helpers land here: `postGenerateAvatarBatch(name, title, brief)`, `postBirthIdentity(...)` (or the SSE equivalent), `getIdentityExistsOnHost(host, name)`.

### Skynet backend (files to touch or reuse from)
- **`src/backend/database/routes/identities.ts`** (335 lines) — existing identity CRUD. **POST /identities** (L86-171) is the endpoint the birth flow calls at step 1 (avatar required, multipart with `data` field, 409 on identityKey collision, colorHue 0-359, voice regex). **PUT /identities/:id** (L173-257) is the mutation contract Tina has already documented the silent-no-op class for. **GET avatar** (L281-314) serves picked-avatar bytes.
- New backend endpoints land somewhere reasonable — planner's call. Suggested paths: `POST /identities/avatar/batch` (avatar generation), `POST /identities/birth` (compound orchestrator with SSE progress), `GET /identities/exists-on-host?host=<id>&name=<name>` (target-host collision precheck).
- Existing SSH exec channel machinery — planner greps the codebase (`exec-channel` pattern or similar) to identify the current SSH-command-exec primitive for reuse in step 2/3/4/5 of the birth sequence.

### Tina's operational tools
- **Avatar-flow runbook:** `~/.claude/identities/tina/runbooks/avatar-flow.md` — SOURCE OF TRUTH for the archetype-drafting LLM call pattern, gpt-image-1 request shape, gamma 0.7 correction recipe (Python+Pillow+numpy), Skynet multipart upload contract, etc. The backend's avatar generation endpoint is essentially wiring this runbook into a programmatic pipeline instead of a hand-run one.
- **OpenAI key:** `~/.claude/identities/tina/openai-key.json` (mode 0600) — operational key today; used for both the LLM archetype call and gpt-image-1. Planner confirms sharing model during plan-phase.
- **Skynet admin creds:** `~/.claude/identities/tina/skynet-creds.json` (mode 0600) — Ashley's account creds + TOTP, used for admin cookie-authenticated Skynet API calls if the birth flow needs any (probably not — JWT auth on the existing identity routes should cover).

### Fleet-wide rules (CLAUDE.md-tier)
- **Nginx location blocks in BOTH configs.** `docker/nginx.conf` AND `docker/nginx-https.conf` (per CLAUDE.md caveat: "Every new backend route needs matching location blocks in BOTH... else it 200s with index.html and crashes the frontend on .map"). Applies to any new route Phase 20 adds.
- **Deploy discipline.** Held-queue posture — do NOT push / build / recreate without Ashley's explicit greenlight. Held atop container `sha256:07547f6c4185` per Tina's handoff.
- **Silent-no-op class on identity endpoint.** Documented in Tina's learned preferences (`~/.claude/identities/tina/tina.md` § "Skynet `/identities/:id` PUT is multipart/form-data..."). Any modal-side PUT/POST to identities MUST use multipart with `data` field, spot-check by GET-verify.
- **Fresh archetype fleet-rule reminders** (Tina's tina.md): NEVER use git worktrees (Ashley 2026-07-31 fleet rule); NO more UAT check-ins (Ashley 2026-07-27); deploy pre-work (push/build) is NOT authorized by a code-work ask; NEVER mask exit codes with `| tail` / `| head` on build commands; frontend `tsc --noEmit` does NOT catch backend TS errors (use `npm run build:backend`).

### Skynet patches history (context for planners)
- `~/.claude/identities/tina/skynet-patches.md` — 288-patch fork catalog. Planner reads recent entries for shape reference (patches #279 = colorHue picker, #223 = voice picker, #77 = identity endpoint silent-no-op discovery).

### Related bounties (context, not requirements)
- Companion bounties still open in Tina's identity: `identity-modal-color-editing`, `terminology-review-sessions-and-conversations-to-agents`. Phase 20 does NOT depend on either but naming conventions there ripple into the modal's copy.

</canonical_refs>

<specifics>
## Specifics — Ashley's verbatim decisions

### /open session 2026-08-03 (design lock)
Full session captured in bounty timeline. Load-bearing verbatims:

> "for the creation ui, i forgot to mention in that bounty that color choice would need to be there." (2026-08-02, added colorHue to the field cluster)

> "we're going to create a ui for creating identities and you know during that process there will be various llm calls to you know generate a prompt for the avatar and stuff and we could also have them judge like whether the name is male or female or have a drop down for the user asking if it's male or female or they could pick their own voice and sample things you know so that's gonna be a whole thing that kind of overlaps" (2026-07-31, umbrella scope + voice-gender adjacent-concern)

> "So I'm thinking for this one, you would hit the new session button, and then it would bring up the modal. And you pick a host. And you type in a name. And I would like if you could also put in a path... regardless of whether you type forward slashes or backslashes. and you know it would support the home directory tilde... a checkbox that defaults to checked. That would do a little bit more than the default session of just a TMUX situation... it would create the TMUX session in the directory that was entered, and then it would run the Claude dangerously skip permissions command, and then it would have to hit enter a few times... you could ask Nelly for the agent supervisor code that's relevant to this, because she's already gone through how to get this to be reliable in starting a new session. And then once it's in the session, you could use what her code does, which is it runs the ID command. And it would take what you put in as the name of the session as the name of the identity there." (2026-08-01, full flow spec)

### /open grill decisions (2026-08-03)
- **Avatar batch = required pick, generate/regenerate loop, gamma-corrected candidates** — "we just make picking an avatar a required field. And there's a generate or regenerate button... they would be gamma corrected."
- **No atomicity/review/rollback** — "we got to do the best we can here because we're not shipping this to millions of people you know... you just got to get the name right you know like i'm not going to add a whole review step to make sure that you didn't put an extra Y on the end."
- **Brief field = ephemeral, does NOT seed identity file** — "I don't think it should seed the identity file because when a new identity is created, it has a wake-up procedure where it asks what it's supposed to be about, and the user answers that, and it creates its own identity file."
- **Name collisions block on both** — "Yes, obviously block on both."
- **Post-Create modal stays open, focus follows to new session** — "makes sense to just stay open. And then, I mean, the best thing to do would be then to, when it finishes, switch to that session. Because the user will need to go into answering the question of, you know, the questions that are asked that come from the ID skill that the agent is going to ask about itself and stuff."
- **Failure = contextual per-step blurb, no rollback/retry/cancel** — "give a little blurb depending on how far it got... you're going to have to go to that session manually and run the ID command or something, and there would just be a different message for whichever stage it screwed up at because the user is going to have to go and do that afterwards."
- **Regen semantics: fresh archetype every time, prompt hidden** — "probably fresh archetype, so they're different enough where you're making progress when you regenerate... And the users don't need to see the prompt."
- **No cancel mid-birth** — "No cancel."
- **Batch = 3 horizontal** — "I think we do three horizontally."

### discuss-phase decisions (2026-08-03)
- **Nelly coordination timing:** "the earlier you get with the stuff from Nelly, the better, because you'll just have more context" → coordinated during discuss-phase; her mechanism folded into `<decisions>` above.
- **Self-birth on skynet-ec2 allowed:** "obviously self-birth would have to be possible too" → local-exec branch when target host === skynet-ec2, SSH otherwise.
- **Progress granularity + failure blurbs = Tina's call:** "whatever you think for number three, and I don't need to approve for number four" → 5 steps as ticking checkboxes; failure blurbs drafted above (Ashley overrides post-ship if any read wrong).
- **Homeserver-register OUT of scope:** "Nelly does not do that part for the relay, so it wouldn't be part of what you're building either." → No homeserver-register / relay.json step in the birth sequence. Identity self-services relay per historical pattern. Concern flagged to Nelly separately in case current homeserver requires her to do it as a workaround — that's fix-at-source, not bake-into-Skynet.

</specifics>

<deferred>
## Deferred Ideas (out of Phase 20, catalog for future work)

- **Voice list gender-splitting + defaults per gender.** Ashley flagged during original bounty capture as an adjacent-but-separate concern. Chatterbox voice list has 28 predefined voices; splitting them into male/female presented sets with a default per gender at creation time is its own bounty when she wants it.
- **Description / personality / role fields in the create modal.** Deliberately OUT — the identity discovers its own self through onboarding dialogue on first wake. The brief field is ephemeral and only feeds the avatar prompt.
- **Editable archetype prompt UI.** Prompt stays hidden. If Ashley later wants a "power user" mode where she can tweak the drafted prompt before batch generation, that's its own bounty.
- **Review-before-commit step.** Explicitly rejected during /open.
- **Rollback / retry / cancel across the compound birth sequence.** Explicitly rejected during /open. If failure rates prove higher than "best we can" tolerates post-ship, revisit.
- **Batch-size tuning UI.** Three is fixed.
- **Reuse-existing-identity path from the create modal.** Explicitly rejected — collisions block. Existing identities are edited from the existing IdentityModal.
- **Homeserver-register / relay.json bootstrap for fresh identities.** Ashley explicitly OUT. Identity self-services via /id skill's create-path or first-wake onboarding. See `<specifics>`.
- **CommandPalette variant of NewSessionDialog gets identity-mode.** OUT of Phase 20. If Ashley later wants birth-from-command-palette, that's a small follow-up.
- **Supervisor "adopt" HTTP endpoint on Nelly's side.** Nelly offered it if we need the supervisor to pick up the new identity immediately without a service restart. Deferred until we know whether that's a real requirement based on Ashley's usage. Ping Nelly if it becomes one.
- **Auto-triggering avatar generation on required fields being filled.** Deferred — explicit Generate button is v1. If the friction becomes real, revisit.
- **Backend gains its own OpenAI key** (vs. reading Tina's `openai-key.json`). Plan-phase question, not blocked at CONTEXT.md level.
- **Post-ship polish for the avatar batch.** If specific batches drift or fail to land, an editable archetype prompt (see above) or a per-identity prompt-archive template pull (leveraging `~/.claude/identities/tina/avatar-prompts/<name>.md`) are natural v2 candidates.

</deferred>

---

*Phase: 20-identity-creation-ui*
*Context gathered: 2026-08-03 via `/gsd:discuss-phase 20` with Ashley, following `/open identity-creation-ui` design lock earlier in session. Nelly's DM 2026-08-03 supplied the bootstrap-sequence spec cribbed into `<decisions>` step 3-4.*
