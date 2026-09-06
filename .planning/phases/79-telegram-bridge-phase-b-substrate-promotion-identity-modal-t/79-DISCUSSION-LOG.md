# Phase 79 DISCUSSION-LOG — Telegram bridge Phase B

**Date:** 2026-09-06
**Participants:** Ashley (visionary), Tina (builder)
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

**Ashley's answer (verbatim):**
> "Yeah, but the whole point of this is that the bridge is becoming a part of Skynet. And so, like, I understand the matrix server lives on the nasty, but that's kind of why Skynet just has a config option to point at whatever the matrix's URL is, regardless of where it is. So that kind of works fine. And the speech to text and text to speech stuff should just be using whatever Skynet is pointing at anyways. So if we come out of this and the bridge is not using the config values for where to get speech to text from that Skynet also uses, then that will have been a mistake. Like, by the time this is done, the bridge is a shipping piece of Skynet, just like Agent Supervisor and everything else. And your fleet substrate distributor comment is wrong, because there's nothing in the distributor that takes a universal piece like the bridge and distributes it to only one host. like that would be dumb and silly and so it certainly doesn't work that way today and it would be weird for us to make it work that way as a part of this the shapefile should not have deferred that i didn't agree to it"

**Decisions locked:**
- **Bridge is a Skynet piece, co-located with Skynet** (t1000 for this deployment; T800 for Stacy's). Shape file's "deferred → migrate bridge onto Skynet box" is REVERSED for the bridge (Matrix homeserver / relay stays on thenasty — different piece of infra, Nicole's).
- **Distributor is universal** — ships bridge.sh + systemd unit + registry-writer helper to every substrate host, same as agent-supervisor. Systemd unit is enabled on the Skynet host as part of Skynet's own runtime setup.
- **Shared-config invariant:** bridge reads Matrix homeserver URL + STT URL (+ any other shared endpoint) from Skynet's own config. Hardcoded IPs in `bridge.sh` (`http://100.113.23.63:8008`, `http://100.80.122.111:8000`) get removed and replaced with reads from Skynet config. Ashley: *"if we come out of this and the bridge is not using the config values for where to get speech to text from that Skynet also uses, then that will have been a mistake."*
- **Builder correction acknowledged.** Original "distribute to only one host" framing was wrong — the distributor pattern is universal. Cascades on wire mechanics (gray area 4) collapse: local file writes + local systemctl restart, no SSH.

---

## Gray area 2: Identity modal — where the Telegram section slots

**Options presented:**
- (a) Own top-level tab under Identity view
- (b) Section on the Wakeups tab
- (c) Hidden bottom-icon slot visible only when configured

**Builder's recommendation:** (a) — own top-level tab. Rationale: discoverability, semantic separation from Wakeups (self-schedule vs external-routing are different mental models), Phase-72 already established tab-per-capability as the right chrome, fixed real-estate cost is small (same as Handoff tab).

**Ashley's answer (verbatim):** *"I agree with area two."*

**Decisions locked:**
- Telegram gets its own top-level tab under Identity view, alongside identity-file / wakeups / handoff.
- Icon: planner's call (candidates: Material `MdWatch`, `MdSmartphone`, `FaTelegramPlane`).
- Label: "Telegram" — plain, no cutesy branding.
- Wakeups and Telegram stay separate tabs — related in intent (both are how identity gets pinged) but different in credential shape, mechanism, and failure modes.

---

## Gray area 3: Activation-flow surfaces + recovery affordances

Four sub-questions presented (3A connected-state view, 3B activation errors, 3C restart-interrupts-others, 3D recovery from bad clicks) with builder recommendations for each.

**Ashley's answer (verbatim):**
> "Yeah, 3A I agree with, and I agree with 3B, except we're not going to automatically notify anyone. And then for 3C, yeah, like I said, as long as we're not ever dropping messages, I don't care that the restart happens. So we don't do anything special for that. And then I agree with 3D."

**Decisions locked:**
- **3A — Minimal connected-state view.** Green dot + "Connected. Bot: @your-bot-name. Human: @your-telegram-handle." One Disconnect button. No timestamps, no last-seen indicators, no diagnostic log, no mute toggle.
- **3B — Actionable errors inline, one modification from builder's original:**
  - Bad bot token → inline "Telegram rejected that token" + paste field cleared/focused.
  - Token accepts / no `/start` yet → persistent status + "Copy bot link" button + Cancel.
  - Bridge restart fails → tab shows the error + Retry button. **NO automatic DM notification to any maintainer** (Ashley's carve-out). Tab surface is the only escalation surface.
  - Network / registry-write failure → "Couldn't save — try again" + Retry.
- **3C — Do nothing special for restart-interrupts-others.** Cursor persistence makes drops impossible; no confirm dialog, no rate-limiting. Ashley: *"as long as we're not ever dropping messages, I don't care that the restart happens."*
- **3D — Disconnect button in tab, one confirm, deterministic return to paste state.** No pause, no history, no audit UI. Pause = disconnect + reconnect.

---

## Gray area 4: Wire mechanics

Three sub-questions presented (4A bot-token storage schema, 4B .cred-file elimination, 4C restart trigger mechanism) with builder recommendations for each.

**Ashley's answer (verbatim):** *"Okay, I agree with your recommendations."*

**Decisions locked:**
- **4A — `telegram_bot_tokens` table, one row per identity.** Columns: `identityKey` (pk), `botTokenEncrypted`, `botUsername`, `humanUserId`, `telegramChatId` (nullable), `createdAt`, `updatedAt`. FieldCrypto pattern mirroring `matrix_admin_creds`. Multi-human is deferred → join table when that UI lands, cheap one-shot migration.
- **4B — Kill all `<human>.cred` files.** Bridge no longer stores passwords. Skynet mints per-human tokens via `matrix-admin-client.loginAsUser` (Phase 77) and writes `<human>.token` files. `relogin()` function deleted from bridge.sh. On dead token, bridge logs LOUD; Skynet's reconcile pass rotates. Migration: admin-mint fresh tokens for Ashley + Zoe + Laura, write new `.token` files, delete existing `.cred` files.
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
