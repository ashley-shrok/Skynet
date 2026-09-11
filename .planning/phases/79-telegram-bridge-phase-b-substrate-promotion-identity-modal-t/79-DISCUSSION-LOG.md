# Phase 79 DISCUSSION-LOG — Telegram bridge Phase B

**Date:** 2026-09-06
**Participants:** Alice (visionary), Tina (builder)
**Mode:** Default (all 4 gray areas discussed, one at a time, each with builder recommendation)
**Vehicle context:** `/build` feature-mode → this discuss-phase → `/gsd-plan-phase 79` next.

---

## Pre-discussion prep

- Loaded shape file `.planning/shapes/shape-telegram-bridge.md` (locked 2026-09-05, amended 2026-09-06 with humans-own-credentials + no-new-frontend-UI + storage sections).
- Loaded Phase 77 artifacts (`77-01` through `77-05` PLAN.md + SUMMARY.md) — admin foundation primitives available to Phase B.
- Read Nina's actual bridge implementation on thenasty (`/home/thenasty/.config/tg-bridge/bridge.sh` — 344 lines) as root over SSH. Confirmed: single bash script under systemd USER unit, registry-driven with per-agent bot_token + per-human .cred/.token side files, media both ways (photos/docs/video/audio) + voice-notes-via-Whisper-STT, Matrix `since` cursor NOT persisted (in-memory only — the reboot-flood bug documented at L266-274).
- Read registry.json structure — `{agents:[{name, mxid, bot_token, humans:[{name, mxid, chat_id, room, cred, token}]}]}` — bridge already supports multi-humans-per-identity shape; Phase B UI restricts to one-human-per-identity per shape deferral.
- Read systemd user unit — `Type=simple`, `Restart=always`, `RestartSec=5`, `KillMode=mixed`, `ExecStart=/bin/bash <path>/bridge.sh`. Pattern to replicate as a system unit.
- Empty phase directory at start; empty todo-match; no SPEC.md; no DECISIONS-INDEX.md; no codebase maps.

---

## Gray area 1: Bridge location in v1

**Options presented:**
- (a) Stays on thenasty, Skynet-on-t1000 SSHs in
- (b) Moves onto t1000 in this phase (T800 gets its own on Stacy's box)
- (c) Hybrid — bridge stays on thenasty, new deployments (T800) co-locate

**Builder's initial recommendation:** (a) — stays on thenasty for v1, citing shape file's "Deferred" list for co-location.

**Alice's answer (verbatim):**
> "Yeah, but the whole point of this is that the bridge is becoming a part of Skynet. And so, like, I understand the matrix server lives on the nasty, but that's kind of why Skynet just has a config option to point at whatever the matrix's URL is, regardless of where it is. So that kind of works fine. And the speech to text and text to speech stuff should just be using whatever Skynet is pointing at anyways. So if we come out of this and the bridge is not using the config values for where to get speech to text from that Skynet also uses, then that will have been a mistake. Like, by the time this is done, the bridge is a shipping piece of Skynet, just like Agent Supervisor and everything else. And your fleet substrate distributor comment is wrong, because there's nothing in the distributor that takes a universal piece like the bridge and distributes it to only one host. like that would be dumb and silly and so it certainly doesn't work that way today and it would be weird for us to make it work that way as a part of this the shapefile should not have deferred that i didn't agree to it"

**Decisions locked:**
- **Bridge is a Skynet piece, co-located with Skynet** (t1000 for this deployment; T800 for Stacy's). Shape file's "deferred → migrate bridge onto Skynet box" is REVERSED for the bridge (Matrix homeserver / relay stays on thenasty — different piece of infra, Nicole's).
- **Distributor is universal** — ships bridge.sh + systemd unit + registry-writer helper to every substrate host, same as agent-supervisor. Systemd unit is enabled on the Skynet host as part of Skynet's own runtime setup.
- **Shared-config invariant:** bridge reads Matrix homeserver URL + STT URL (+ any other shared endpoint) from Skynet's own config. Hardcoded IPs in `bridge.sh` (`http://100.113.23.63:8008`, `http://100.80.122.111:8000`) get removed and replaced with reads from Skynet config. Alice: *"if we come out of this and the bridge is not using the config values for where to get speech to text from that Skynet also uses, then that will have been a mistake."*
- **Builder correction acknowledged.** Original "distribute to only one host" framing was wrong — the distributor pattern is universal. Cascades on wire mechanics (gray area 4) collapse: local file writes + local systemctl restart, no SSH.

---

## Gray area 2: Identity modal — where the Telegram section slots

**Options presented:**
- (a) Own top-level tab under Identity view
- (b) Section on the Wakeups tab
- (c) Hidden bottom-icon slot visible only when configured

**Builder's recommendation:** (a) — own top-level tab. Rationale: discoverability, semantic separation from Wakeups (self-schedule vs external-routing are different mental models), Phase-72 already established tab-per-capability as the right chrome, fixed real-estate cost is small (same as Handoff tab).

**Alice's answer (verbatim):** *"I agree with area two."*

**Decisions locked:**
- Telegram gets its own top-level tab under Identity view, alongside identity-file / wakeups / handoff.
- Icon: planner's call (candidates: Material `MdWatch`, `MdSmartphone`, `FaTelegramPlane`).
- Label: "Telegram" — plain, no cutesy branding.
- Wakeups and Telegram stay separate tabs — related in intent (both are how identity gets pinged) but different in credential shape, mechanism, and failure modes.

---

## Gray area 3: Activation-flow surfaces + recovery affordances

Four sub-questions presented (3A connected-state view, 3B activation errors, 3C restart-interrupts-others, 3D recovery from bad clicks) with builder recommendations for each.

**Alice's answer (verbatim):**
> "Yeah, 3A I agree with, and I agree with 3B, except we're not going to automatically notify anyone. And then for 3C, yeah, like I said, as long as we're not ever dropping messages, I don't care that the restart happens. So we don't do anything special for that. And then I agree with 3D."

**Decisions locked:**
- **3A — Minimal connected-state view.** Green dot + "Connected. Bot: @your-bot-name. Human: @your-telegram-handle." One Disconnect button. No timestamps, no last-seen indicators, no diagnostic log, no mute toggle.
- **3B — Actionable errors inline, one modification from builder's original:**
  - Bad bot token → inline "Telegram rejected that token" + paste field cleared/focused.
  - Token accepts / no `/start` yet → persistent status + "Copy bot link" button + Cancel.
  - Bridge restart fails → tab shows the error + Retry button. **NO automatic DM notification to any maintainer** (Alice's carve-out). Tab surface is the only escalation surface.
  - Network / registry-write failure → "Couldn't save — try again" + Retry.
- **3C — Do nothing special for restart-interrupts-others.** Cursor persistence makes drops impossible; no confirm dialog, no rate-limiting. Alice: *"as long as we're not ever dropping messages, I don't care that the restart happens."*
- **3D — Disconnect button in tab, one confirm, deterministic return to paste state.** No pause, no history, no audit UI. Pause = disconnect + reconnect.

---

## Gray area 4: Wire mechanics

Three sub-questions presented (4A bot-token storage schema, 4B .cred-file elimination, 4C restart trigger mechanism) with builder recommendations for each.

**Alice's answer (verbatim):** *"Okay, I agree with your recommendations."*

**Decisions locked:**
- **4A — `telegram_bot_tokens` table, one row per identity.** Columns: `identityKey` (pk), `botTokenEncrypted`, `botUsername`, `humanUserId`, `telegramChatId` (nullable), `createdAt`, `updatedAt`. FieldCrypto pattern mirroring `matrix_admin_creds`. Multi-human is deferred → join table when that UI lands, cheap one-shot migration.
- **4B — Kill all `<human>.cred` files.** Bridge no longer stores passwords. Skynet mints per-human tokens via `matrix-admin-client.loginAsUser` (Phase 77) and writes `<human>.token` files. `relogin()` function deleted from bridge.sh. On dead token, bridge logs LOUD; Skynet's reconcile pass rotates. Migration: admin-mint fresh tokens for Alice + Zoe + Laura, write new `.token` files, delete existing `.cred` files.
- **4C — Restart trigger: research decides between sentinel-file+inotifywait (option a) and unix-socket+http (option c), BUT mirror the existing distributor pattern for `agent-supervisor` restarts if one exists.** Default to sentinel+inotifywait if no distributor pattern exists yet. Consistency across substrate services beats picking the "cleanest" answer in isolation.

---

## Deferred ideas raised during discuss (parked)

- **Restart-free bot addition via on-the-fly `tg_poller` spawning.** Not in Phase B — cursor persistence makes restart-on-activation acceptable, and this is a larger bridge-internal refactor. Real improvement, worth doing later.

## Research questions handed to `/gsd-plan-phase 79`

Full list in `79-CONTEXT.md § Research questions`. Highlights:
1. Pattern used by distributor to restart `agent-supervisor` after push (Phase 73/75 territory).
2. Where Skynet's STT config key lives.
3. Where Skynet's Matrix homeserver base URL lives (beyond `matrix_admin_creds.base`).
4. Whether t1000 has `runsFleetSubstrate:true`.
5. Existing bind-mount pattern in `docker/docker-compose.yml`.
6. Synapse token lifetime for `loginAsUser`-minted tokens.
7. Collision check for `/var/lib/tg-bridge/` path.

---

## Session outcome

- 4/4 gray areas resolved, all builder recommendations adopted with one narrow modification (no auto-notifications in 3B) and one hard override (shape's bridge-co-location-deferral reversed in gray area 1).
- CONTEXT.md written with locked decisions, scope-outs, deferrals, success definition, canonical refs (12 items), code context (6 items), and 7 research questions.
- No SPEC.md or advisor mode in play.
- Ready for `/gsd-plan-phase 79`.

---

## Addendum — 2026-09-06 course-correction (post-research, pre-plan-checker)

Research completed cleanly (11/11 questions answered, high confidence across the board). Pattern-mapper completed (22 files classified). Planner ran and produced 5 PLAN.md files. **Before plan-checker fired, Tabitha DM'd me with an observation from Alice that surfaced two material errors in my planning framing.** Course-corrected — the 5 PLAN.md files were built on wrong assumptions and are deleted; planner will re-run against updated CONTEXT.md.

### What was wrong

1. **False attribution — "Alice 2026-08-30 normalized substrate services as user-scope."** I recorded this as fact when I recommended USER-scope systemd for the bridge. Alice never said this. I pattern-matched from agent-supervisor being USER-scope and packaged the inference as her decision. Alice 2026-09-06 verbatim: *"decisions get attributed to me that I didn't actually make. Because I don't even know why I would care about user scoping."* Standing rule going forward: no attributions without her literal words.

2. **False architectural assumption — "wire an SSH credential to host id 6" as install pathway.** I assumed the Skynet host is guaranteed to be self-registered in Skynet's own host DB, so distributor SSHs to it like any other host. Alice 2026-09-06 corrected: *"the host machine that the app is running on will actually be a host that is registered into Skynet"* → NOT guaranteed. That framing is coincidental to t1000 today, not the general case.

### What I found while investigating

- Tabitha's observation: `~/.local/bin/agent-supervisor` on t1000 IS byte-identical to `substrate/scripts/agent-supervisor.sh`, timestamp Sep 5 09:07 (~36 min after commit). But Skynet fleet-substrate distributor is definitively NOT the mechanism — docker logs prove it's skipping. Someone (a maintainer) manually `cp`'d it there. Current de-facto install is a fragile out-of-band step.
- During daily-box-check the same day: multiple established SSH sessions from Skynet container to t1000 host, `ubuntu@notty`, using `ssh2` Node client per `src/backend/starter.ts:445`. But the DEST is always t1000's own IP, and docker logs say host id 6 has no credential. Contradicts. Handed off as a bounty to Tabitha (not blocking Phase 79).

### What's changed in CONTEXT.md (see § Attribution corrections + § 4C-revised)

- **Bridge is now a Docker Compose service** (Option B), not a host-side systemd unit. New `tg-bridge` service block in `docker/docker-compose.yml`, shared named Docker volume `tg-bridge-state` mounted by both `skynet` and `tg-bridge` containers.
- **Zero operator burden per deployment** — `docker compose up` brings the bridge alongside the other services. Alice: *"do we need to put any burden on the operator? [...] can we just standardize that and not require that to be filled in?"* → yes.
- **No systemd unit, no host-side install, no SSH-to-self, no runsFleetSubstrate flag for the bridge, no bind-mount to host paths, no distribution via fleet-substrate distributor for the bridge.** All obsolete under Option B.
- **Kept from original locks:** STT_URL extraction into shared TS constant module (user-locked #3), dead-token detection via `.token-dead` sentinel files (user-locked #4 — mechanism is the same, now sentinel files live in shared docker volume), migration endpoint `POST /matrix-admin/migrate-cred-files` (user-locked #5).

### Planner replan

- Deleting the 5 existing PLAN.md files (built on wrong assumptions).
- Re-firing planner with updated CONTEXT.md.
- Research is still valid (RESEARCH.md's 11 answers still ground the technical reality — install pathway is the only thing changed).
- Pattern-mapper output partially valid — the "add rows to distributor catalog + wire restart hooks" section is now dead; the "backend telegram module mirrors matrix module" section still stands. Will note this in the planner prompt so it re-scopes its use of PATTERNS.md.

### Standing directive burned into role file (proposed to Alice)

Attribution discipline: never record "Alice decided X" without her literal words in the transcript. If inference, label it *"my inference"* or *"mirrors existing X pattern"*. This is the fleet directive *"Capture the user's words verbatim — don't paraphrase into attribution"* — I violated it and need to bake it into pre-write reflex.
