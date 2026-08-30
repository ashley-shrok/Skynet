# Phase 20: Identity creation UI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-03
**Phase:** 20-identity-creation-ui
**Areas discussed:** Nelly coordination timing, Target-host self-birth policy, Progress-step granularity, Failure-blurb wording ownership

---

**Preface:** This discuss-phase was unusually thin because the shape file at `~/.claude/identities/tina/bounties/identity-creation-ui/shape-identity-creation-ui.md` (LOCKED via `/open identity-creation-ui` earlier in the same session) already settled the load-bearing user-facing decisions: modal shape, field cluster, avatar-batch loop (required-pick + regen + 3 horizontal + gamma-corrected + fresh archetype + hidden prompt), name collision blocking (both sides), post-Create modal-stays-open + focus-follow-to-new-session, failure = per-step contextual blurb, no rollback/retry/cancel/review, brief-field-is-ephemeral. discuss-phase only needed to cover the remaining implementation-side gray areas.

---

## Nelly coordination timing

| Option | Description | Selected |
|--------|-------------|----------|
| Now (during discuss) | Message Nelly on the relay, fold her bootstrap mechanism into CONTEXT.md so plan-phase reads from source of truth | ✓ |
| During plan-phase | Planner asks her at plan time when actually building the step | |
| During execute | Executor asks her the moment they need it in code | |

**User's choice:** Now (during discuss).
**Notes:** Ashley verbatim: "Yeah, the earlier you get with the stuff from Nelly, the better, because you'll just have more context." Nelly replied inside the same discuss session with the full 8-line fresh-launch sequence + `accept_trust_for_workdir()` recipe + env-var rationale + failure modes + architectural recommendation (inline Tailscale SSH, don't add supervisor HTTP endpoint; use `~/.claude/skills/spawn-remote-agent/` as shape reference). Full DM captured at `~/.claude/identities/tina/relay-state/messages/_IC059aLvfcQsVu01q-ffEil9TazzhU0AZ0wfl2zqLNs.txt`; source code at `~/vms-apps/apps/home/agent-supervisor.sh` lines 106-142 (env-vars + helper) and 326-340 (fresh-drive sequence).

---

## Target-host self-birth policy

| Option | Description | Selected |
|--------|-------------|----------|
| Self-birth allowed | Modal permits birthing an identity on skynet-ec2 (same box that hosts the modal); backend takes local-exec branch instead of SSH | ✓ |
| Self-birth blocked | Modal filters skynet-ec2 out of the host picker when identity-mode is on | |

**User's choice:** Self-birth allowed.
**Notes:** Ashley verbatim: "obviously self-birth would have to be possible too." Implementation: backend detects `targetHost === skynet-ec2` and skips the SSH wrapper, runs tmux/claude commands locally with the same 5-step sequence.

---

## Progress-step granularity

| Option | Description | Selected |
|--------|-------------|----------|
| Tina's call | Ashley waves forward; Tina picks a granularity | ✓ |

**User's choice:** Tina's call.
**Notes:** Ashley verbatim: "whatever you think for number three." Tina picked **5 steps as ticking checkboxes**, matching the shape file's birth-sequence structure exactly (Skynet record → tmux session → CLI launch → bootstrap dance → /id command). Rationale: mirrors the mechanism, gives enough feedback to pinpoint which failure blurb applies, avoids ~15 sub-step noise (the blind Enter train fires 7 times but presents as one "bootstrap dance" step, not seven).

---

## Failure-blurb wording ownership

| Option | Description | Selected |
|--------|-------------|----------|
| Ashley drafts/approves each | Blocking design pass on the exact wording per step before ship | |
| Tina drafts defaults, Ashley overrides post-ship if any read wrong | Non-blocking — reasonable defaults ship, iterate on real-world friction | ✓ |

**User's choice:** Tina drafts defaults, Ashley overrides post-ship.
**Notes:** Ashley verbatim: "I don't need to approve for number four." Tina's default blurbs drafted in CONTEXT.md `<decisions>` § "Failure blurbs" — 5 blurbs, one per step, each including the specific manual finish-up commands the user needs to run.

---

## Homeserver-register / relay.json (newly-surfaced gray area, resolved verbatim)

**Not an initial gray area** — surfaced by Nelly's DM reply ("adjacent bit worth mentioning" about the --break-glass path for a genuinely-first-run new identity needing initial relay.json bootstrap).

**User's choice (verbatim):** "Nelly does not do that part for the relay, so it wouldn't be part of what you're building either."
**Notes:** Ashley locked homeserver-register OUT of Phase 20 scope. Historical pattern is identity-self-service: fresh identities handle their own relay setup via the /id skill's create-branch or during first-wake onboarding. Ashley also directed Tina to relay a concern back to Nelly: "if the new relay server would require her to do that stuff instead of identities doing it themselves like they have historically, then that's a problem." Followup message sent to Nelly documenting this. Nelly's reply confirmed the server-side supports self-service registration and identified the actual gap: the /id skill's create-new-identity branch stops at writing `<name>.md` and doesn't do the register+write-relay.json step. Nelly offered to close that gap at the id-skill layer if Ashley greenlights — that fix would be independent of Phase 20 and would make Phase 20's "leave relay entirely alone" posture work end-to-end.

---

## Claude's Discretion

- **Exact number of plans + wave decomposition** — planner's call. Suggested slicing in CONTEXT.md § Ship: (1) backend avatar batch endpoint + LLM/gpt-image-1 + gamma; (2) backend orchestrator + SSH sequence + SSE progress + tests; (3) frontend modal extension + validation + pickers reuse; (4) frontend avatar loop + SSE consumption + progress UI + failure blurbs; (5) skynet-patches.md entries + verify checklist.
- **SSE vs WebSocket vs long-poll for progress transport** — SSE recommended in CONTEXT.md, planner may override.
- **Voice-picker + color-picker reuse pattern** — extract to shared component vs inline-copy from IdentityModal.tsx — planner's call based on codebase pattern conventions.
- **Avatar batch server-side cache** — in-memory Map with TTL vs SQLite temp vs filesystem tmpdir — planner's call; recommend in-memory + 10-min TTL.
- **Node vs Python subprocess for gamma correction** — planner's call; avatar-flow runbook uses Python+Pillow+numpy, Node+sharp acceptable if output matches.
- **Regen-while-generating behavior** — Tina picked "disable Generate button until in-flight batch resolves." Ashley did not surface this; my call under best-we-can philosophy.
- **Stale-avatar handling** — Tina picked "silently keep picked avatar even if name/title/brief edited afterward, no warning." Ashley did not surface this; my call under best-we-can philosophy.
- **Field persistence on failure/close** — Tina picked "reset on modal close, no draft store." Ashley did not surface this; my call under best-we-can philosophy.
- **OpenAI key sharing model** — plan-phase question. Tina's `~/.claude/identities/tina/openai-key.json` is operational today; planner confirms whether Skynet backend continues reading it or gets its own.

## Deferred Ideas

- **Voice list gender-splitting + defaults per gender.** Ashley flagged during original bounty capture as an adjacent-but-separate concern.
- **Editable archetype prompt UI ("power user" mode).** Prompt stays hidden in v1.
- **Auto-triggering avatar generation on required fields being filled.** Deferred — explicit Generate button is v1.
- **CommandPalette variant of NewSessionDialog gains identity-mode.** OUT of Phase 20.
- **Supervisor "adopt" HTTP endpoint on Nelly's side.** Deferred until it becomes a real requirement.
- **Backend gets its own OpenAI key.** Plan-phase question.
- **Post-ship polish for the avatar batch** (editable archetype, per-identity prompt-archive templates from `~/.claude/identities/tina/avatar-prompts/`). Natural v2 candidates.
- **Homeserver-register at the /id skill layer** (Nelly's proposed fix). NOT in Phase 20's scope regardless of Ashley's greenlight decision on the id-skill patch — those are independent workstreams.
