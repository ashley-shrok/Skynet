# Phase 79 CONTEXT — Telegram bridge Phase B: substrate promotion + identity modal Telegram section

**Seeded from:** `.planning/shapes/shape-telegram-bridge.md` (opened + locked 2026-09-05; amended 2026-09-06 with humans-own-their-credentials + no-new-frontend-UI + storage sections). Discuss-phase 2026-09-06 amended one shape deferral (see § Shape overrides).

**Vehicle:** `/build` feature-mode → GSD phase (this file) → `/gsd-plan-phase 79` → `/gsd-execute-phase 79` → `/close telegram-bridge`.

**Depends on:** Phase 77 (Matrix admin foundation, shipped 2026-09-06). Phase 77 deliverables in play here: `matrix-admin-client` with `loginAsUser` (used to mint per-human Matrix tokens on demand), `matrix_admin_creds` singleton FieldCrypto pattern (bot-token storage follows the same pattern), `users.mxid` column (bridge learns which mxid to bridge from Skynet users table).

---

## Domain

Take Nina's hand-configured Telegram bridge — currently a one-off systemd USER unit at `/home/thenasty/.config/tg-bridge/` — and make it a first-class shipping piece of Skynet, distributed by the fleet distributor and configured through the identity modal. Each identity opts in to wrist-reachability via a bot-token paste in a dedicated Telegram tab. Bridge lives where Skynet lives (t1000 for this deployment, T800 for Stacy's). Human Matrix passwords never touch disk; admin mints tokens on demand.

## Shape overrides (Ashley 2026-09-06, discuss-phase)

- **The shape file's "Migrating co-located relay+bridge onto Skynet box → deferred" is REVERSED for the bridge.** The bridge co-locates with Skynet in Phase B — that's the entire point of substrate promotion. Ashley verbatim: *"the whole point of this is that the bridge is becoming a part of Skynet"* / *"by the time this is done, the bridge is a shipping piece of Skynet, just like Agent Supervisor and everything else"* / *"the shapefile should not have deferred that i didn't agree to it."* The **relay/Matrix homeserver** stays on thenasty (Nicole's infra); only the bridge relocates.

## Locked decisions

### 1. Bridge lives where Skynet lives — co-located, distributor-shipped

- Bridge runs on the Skynet host: t1000 for this deployment, T800 for Stacy's, whatever host in the future.
- Distributed by the **fleet-substrate distributor** as a universal substrate item (like `agent-supervisor.sh`). Not "distributed to only one host" — universal, same as every other substrate piece. Ashley verbatim: *"there's nothing in the distributor that takes a universal piece like the bridge and distributes it to only one host. like that would be dumb and silly and so it certainly doesn't work that way today and it would be weird for us to make it work that way as a part of this."*
- The systemd unit is enabled on the Skynet host as part of Skynet's own runtime setup (research decides exact wiring — see § Research questions).
- **Config values the bridge reads come from Skynet's own config**, not hardcoded in the script. This is a HARD requirement — the shape's "each Skynet is its own island" clause is enforced at the config layer:
  - **Matrix homeserver URL** — comes from Skynet's Matrix config (same source `matrix_admin_creds.base` uses). Removes the hardcoded `http://100.113.23.63:8008` at the top of `bridge.sh`.
  - **STT URL** — comes from Skynet's existing STT config (Ashley confirmed Skynet already has one — she uses voice input to Skynet, which uses the same STT endpoint). Removes the hardcoded `http://100.80.122.111:8000/v1/audio/transcriptions`.
  - **TTS URL** — if the bridge grows a TTS path, same rule: read from Skynet config.
- **Reliability check for the executor:** if we come out of this phase and the bridge is NOT reading STT (and Matrix homeserver, and any other shared endpoint) from Skynet config, we've shipped a bug. Ashley verbatim: *"if we come out of this and the bridge is not using the config values for where to get speech to text from that Skynet also uses, then that will have been a mistake."*

### 2. Identity modal — Telegram gets its own top-level tab under Identity view

- Post-Phase-72 the identity modal has scope switch (Role view / Identity view) with a bottom icon-bar per scope. Telegram slots as its **own top-level tab under Identity view**, alongside identity-file / wakeups / handoff.
- Fixed real-estate: every identity's modal has the Telegram tab, even if un-configured (same as Handoff tab which is often near-empty for young identities).
- Discoverability wins over hidden slots or buried sections — the modal is where humans go to configure their identity, and Telegram is a configuration.
- Icon: planner's choice — Material `MdWatch` / `MdSmartphone` or `FaTelegramPlane` are candidates. Label: "Telegram" (plain — no cutesy branding).
- Wakeups and Telegram stay conceptually separated: Wakeups = self-schedule (identity pings itself on a clock), Telegram = external routing (human pings identity from wrist). Different credential shapes, different failure modes, different mental models. Don't mix.

### 3. Activation-flow UX and recovery affordances

**Connected-state view (3A) — MINIMAL.**
- Green dot + "Connected. Bot: @your-bot-name. Human: @your-telegram-handle."
- One "Disconnect" button (always visible, deterministic recovery).
- No last-message timestamps, no last-seen from Telegram side, no mute toggle, no diagnostic log tail. Wrist-reachability is either working or it isn't; humans notice message-drop from their wrist, not from a Skynet UI.

**Activation errors (3B).**
- **Bad bot token** (Telegram API rejects on paste): inline "Telegram rejected that token — check you copied the full string from @BotFather." Paste field cleared and focused. No backend write.
- **Token accepts, bot silent** (no `/start` yet): persistent "waiting for you to send /start to @your-bot..." status with a **Copy bot link** button (`t.me/your-bot`). No timeout that flips to error — human gets to it when they get to it. A **Cancel** button wipes the pending state and returns to paste.
- **Bridge restart fails** (Skynet-side): tab shows "Bridge didn't come back up — Telegram is not receiving messages right now." **Retry** button re-attempts the restart. **No automatic DM notification to the maintainer** (Ashley 2026-09-06: *"we're not going to automatically notify anyone"*). The tab surfaces the error; whoever is watching the modal deals with it or escalates manually.
- **Network / registry-write failure**: "Couldn't save — try again in a moment." Retry button.

**Restart-interrupts-others (3C) — do nothing special.**
- Bridge restart is <5s. Matrix-cursor persistence (this phase's core reliability deliverable) means no messages drop during restart. Ashley 2026-09-06: *"as long as we're not ever dropping messages, I don't care that the restart happens."*
- No confirm dialog warning about "briefly interrupting other Telegram bridges." No rate-limiting on activation ops.

**Recovery from bad clicks (3D).**
- **Disconnect** button in the Telegram tab (from 3A).
- Click → confirm: "This will unbridge <identity> from Telegram. The bot stays alive in Telegram (you can reconnect anytime with the same token, or paste a new one). Confirm."
- Confirms → bridge registry entry cleared for this (identity, human) row → restart bridge → tab returns to the "paste bot token" state.
- No pause/history/audit trail — pause is just disconnect+reconnect.

### 4. Wire mechanics

**4A. Bot token storage — `telegram_bot_tokens`, one row per identity.**
- New table, FieldCrypto pattern (same shape as Phase 77's `matrix_admin_creds`).
- Columns: `identityKey` (pk), `botTokenEncrypted`, `botUsername` (for display), `humanUserId` (which Skynet user owns this bot — used for authz on activation ops), `telegramChatId` (nullable until first `/start` seen), `createdAt`, `updatedAt`.
- Matches v1's "one identity → one bot → one human" model.
- Multi-human-per-identity is deferred (shape). When that UI lands, migrate to a join table `telegram_bot_bridges` — one-shot script, cheap. YAGNI for now.
- Encrypted field: `botTokenEncrypted` goes in `ENCRYPTED_FIELDS` list (mirror `matrix_admin_creds.access_token` / `matrix_admin_creds.password`).

**4B. Kill all `<human>.cred` files — bridge no longer stores passwords.**
- Bridge today keeps `<human>.cred` (plaintext Matrix password, 0600) so `relogin()` can re-mint tokens when they die. Shape file (§ Philosophy) makes this a hard-no going forward.
- Phase B removes `<human>.cred` files entirely from the bridge disk. The `relogin()` function is deleted from `bridge.sh`.
- **New token lifecycle:** Skynet mints tokens via `matrix-admin-client.loginAsUser(<mxid>)` (Phase 77 primitive). Skynet writes `<human>.token` (0600) to the bridge's registry directory. Bridge reads tokens; bridge never knows a password exists.
- **When a token dies** (Synapse 401): bridge logs LOUD, continues attempting for other humans; that human's Matrix events queue on the relay. Skynet's next reconcile pass detects the dead-token state (via a status field OR by polling `/whoami` on stored tokens periodically — research decides) and re-mints via admin.
- **Migration:** Phase B ships a one-shot migration that (a) admin-mints fresh tokens for Ashley + Zoe + Laura via `loginAsUser`, (b) writes new `<human>.token` files, (c) deletes existing `<human>.cred` files. The three existing humans get token-refreshed cleanly. Verify: bridge post-migration has zero `.cred` files anywhere.
- **Fleet-wide "bridge still bridges if Skynet is unhealthy" invariant preserved:** tokens on disk survive Skynet downtime; only re-minting requires Skynet to be up, and that's the rare path.

**4C. Restart trigger — research decides between sentinel-file+inotifywait and unix-socket+http, but MIRROR the existing distributor pattern for `agent-supervisor` restarts.**
- Skynet backend runs inside the Skynet Docker container; bridge runs as a systemd unit on the host. Writing the registry is easy (bind-mount). Triggering restart from inside the container is the wire question.
- Two candidate patterns:
  - **(a) Sentinel file + `inotifywait`** — bridge (or a tiny companion) watches `/var/lib/tg-bridge/.reload`; Skynet touches the sentinel; bridge triggers its own restart. Zero cross-boundary syscall from container. Simplest Unix-native shape.
  - **(c) Unix-socket HTTP endpoint** — bridge listens on `/var/run/tg-bridge.sock` and exposes `/reload`; container mounts the socket, POSTs. Bridge internalizes restart logic. Slightly more surface area but easier to add other admin ops later.
- **Rule for the planner/researcher:** whatever pattern the substrate distributor uses today to restart `agent-supervisor` after pushing an update, mirror THAT pattern for the bridge. Consistency across substrate services beats picking the "cleanest" answer in isolation. If distributor has no restart pattern yet (agent-supervisor might just be `Restart=always` picked up on next start), then default to sentinel+inotifywait (option a).
- Bind-mount: `/var/lib/tg-bridge/` (or wherever agreed) into the Skynet container (add to `docker/docker-compose.yml`).

### 5. Matrix-cursor disk persistence

- Bridge's `mx_sync_for_human` function currently holds `since` in-memory only. On restart it does an initial `/sync?timeout=0` which produces the "reboot-replay flood" bug documented at bridge.sh L266-274 (Continuwuity returns ~30 timeline events per joined room, ~1000 events, ~200 per-agent outbound after filtering).
- Phase B persists `since` per human to `<human>.since` in the bridge's state directory (mirror the `recv.sh` `SINCE_FILE` pattern from `substrate/skills/agent-relay/recv.sh`).
- On startup, `mx_sync_for_human` reads `<human>.since` if present; falls back to initial-sync only if absent (first-run for that human).
- Load-bearing for Phase B's reliability floor — this is what makes 3C's "restart-interrupts-others = do nothing" acceptable.

---

## Locked scope-outs (from shape file — still in force)

- Federation between Skynet boxes, shared relays across deployments — out.
- Skynet UI for the Matrix admin itself (room management, invite/kick, moderation UI) — out. Phase B touches the admin capability only in the narrow sense of using `loginAsUser` for token minting.
- Rewriting Nina's bridge in another language — out. Stays bash.
- Any changes to how agents DM each other — unchanged.
- Skynet PWA or in-app notification story — this design pivoted away.
- **Any new frontend UI beyond the identity-modal Telegram tab.**
- Deletion/rename propagation — no Skynet surface exists for either.

## Deferred (from shape — still in force)

- Hot-reload of bridge config (signal-driven re-registration) — restart is acceptable given cursor persistence.
- Multi-humans-per-identity UI — bridge supports it, v1 UI does not.
- Migration of legacy encrypted/frozen rooms from the pre-admin era.

## Deferred (raised during discuss, parked)

- **Bridge-side restart-free bot addition.** Today adding a new bot requires a bridge restart because `tg_poller` threads are spawned at startup. A refactor could spawn pollers on-the-fly on registry change, eliminating restart entirely. Real improvement, not in Phase B — cursor persistence makes the restart tolerable and this is a larger bridge-internal change than Phase B's scope.

---

## Success definition — Phase 79 is done when

- Bridge script + systemd unit + registry-writer helper are version-tracked in `~/skynet-tina/substrate/` and distributed by the fleet-substrate distributor to every substrate host (universal — not host-filtered).
- On the Skynet host (t1000 for this deployment), the bridge systemd unit is enabled and running as an official Skynet service. Nina's `/home/thenasty/.config/tg-bridge/` install can be shut down after cutover.
- Bridge reads Matrix homeserver URL + STT URL (+ any other shared endpoints) from Skynet's config — no hardcoded IPs in the script.
- Bridge's Matrix cursor persists to disk per human; restart drops zero messages (proven with a repro test that force-restarts mid-bridged-conversation).
- Identity modal has a Telegram tab under Identity view; an owner can paste a bot token, follow on-screen instructions through `/start`, and end up wrist-reachable with no shell.
- Bot tokens live in `telegram_bot_tokens` FieldCrypto-encrypted; no plaintext on disk anywhere.
- Zero `<human>.cred` files exist anywhere post-migration. Human tokens live in `<human>.token` files written by Skynet via `matrix-admin-client.loginAsUser`; the bridge does not know how to relogin.
- Registry write + restart trigger works from inside the Skynet container to the host-side bridge (via the substrate-distributor-consistent mechanism the researcher lands on).
- Recovery from bad clicks: Disconnect button in the tab returns to paste-state in one click + one confirm.
- No new frontend UI outside the Telegram tab (scope-locked).
- No automatic DM notifications on bridge failure — surfaced in the tab only.

---

## Research questions for `/gsd-plan-phase 79`

Land these during research before planning:

1. **How does the substrate distributor restart `agent-supervisor` today after a push?** Read `~/skynet-tina/substrate/scripts/agent-supervisor.sh` + relevant distributor code (Phase 73 slice-2 artifacts). Whatever the pattern is, mirror it for tg-bridge restart. If no restart pattern exists yet, default to sentinel-file + `inotifywait`.
2. **Where does Skynet's STT config live?** Ashley confirmed it exists (she uses voice input). Find the config key, mirror the same read path in the bridge for STT URL.
3. **Where does Skynet's Matrix homeserver base URL config live?** `matrix_admin_creds.base` is one candidate but that's admin-specific. If there's a broader Matrix config, prefer that. If not, add one.
4. **Is `runsFleetSubstrate:true` already set on t1000?** If yes, distributor already pushes to it. If no, either set it or figure out the alternative install path for the Skynet host.
5. **How does the Skynet container currently bind-mount host paths?** Look at `docker/docker-compose.yml` (see the Phase-70 branding bind-mount block referenced in the handoff). Adding `/var/lib/tg-bridge/` follows the same pattern.
6. **What Synapse token lifetime should we expect?** Synapse tokens don't expire by default, but admin-minted `loginAsUser` tokens may behave differently. Verify against the deployed Synapse (Nicole's `!Sxyrz…` on thenasty). Impacts whether the Skynet reconcile-pass needs to poll `/whoami` on stored tokens, or just react to bridge-side 401s.
7. **Do any existing docker-compose bind-mounts collide with `/var/lib/tg-bridge/`?** Path choice negotiable if there's a preferred convention.

---

## Canonical refs

- `.planning/shapes/shape-telegram-bridge.md` — shape file, locked; Ashley's discuss-phase overrides in § Shape overrides above.
- `.planning/phases/77-telegram-bridge-phase-a-skynet-matrix-admin-integration-foun/77-01-PLAN.md` through `77-05-PLAN.md` — Phase 77 admin foundation reference. Especially the `matrix-admin-client` primitives (`loginAsUser`, `createUser`, `makeAdmin`, `getWhoami`, `makeRoomAdmin`) used by Phase B for human-token minting.
- `.planning/phases/73-*/73-*-PLAN.md` — fleet-substrate distributor (feature-02 slice-2). The reconcile-loop pattern Phase B extends for bridge distribution.
- `.planning/phases/75-*/` — server-side substrate bootstrap; the startup-driven install pass that will place tg-bridge on hosts.
- `~/skynet-tina/substrate/skills/agent-relay/recv.sh` — reference implementation for disk-persisted Matrix `since` cursor. Bridge's Matrix-cursor persistence mirrors this exact shape.
- `/home/thenasty/.config/tg-bridge/bridge.sh` (root@100.113.23.63) — Nina's current bridge script, 344 lines. Source of truth for what the bridge does today. Full analysis in this CONTEXT § Locked decisions.
- `/home/thenasty/.config/tg-bridge/registry.json` — current registry structure: `{agents:[{name, mxid, bot_token, humans:[{name, mxid, chat_id, room, cred, token}]}]}`. Phase B keeps this shape but eliminates `.cred` files.
- `/home/thenasty/.config/systemd/user/tg-bridge.service` — current systemd USER unit. Phase B's system-scope unit follows the same shape (`Type=simple`, `Restart=always`, `RestartSec=5`, `KillMode=mixed`, `ExecStart=/bin/bash <path>/bridge.sh`) with the path relocated to the substrate install location.
- `src/backend/matrix/client.ts` — Phase 77 admin client. `loginAsUser` is the Phase B token-minting primitive.
- `src/backend/database/schema.ts` — `matrix_admin_creds` table shape reference for `telegram_bot_tokens` schema.
- `src/backend/database/field-crypto.ts` + `src/backend/database/schema.ts` (`ENCRYPTED_FIELDS`) — encryption pattern.
- `src/ui/features/pretty-view/IdentityModal.tsx` — identity modal shell; where the new Telegram tab lives.
- `src/ui/features/pretty-view/WakeupsTab.tsx` — reference for what a top-level tab under Identity view looks like today.
- `docker/docker-compose.yml` — where the new `/var/lib/tg-bridge/` bind-mount lands.
- `CLAUDE.md` § "Nginx caveat" — every new backend route Phase B adds needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`.

---

## Code context — reusable assets found during scout

- **`matrix-admin-client.loginAsUser(<mxid>)`** — Phase 77 primitive. Used by Phase B to mint per-human Matrix tokens without touching passwords.
- **FieldCrypto encryption pattern** — `matrix_admin_creds` table (Phase 77) is the reference shape for `telegram_bot_tokens`. Same `ENCRYPTED_FIELDS` list, same `forceSave` discipline post-write.
- **`recv.sh` `SINCE_FILE` pattern** at `substrate/skills/agent-relay/recv.sh` — exact template for the bridge's Matrix cursor persistence.
- **Fleet-substrate distributor + `runsFleetSubstrate:true` opt-in** (Phase 73/75) — the shipping mechanism; universal by design.
- **`identity-birth-orchestrator` step-6/7/8 SFTP-write pattern** — reference for how Skynet remote-writes files to hosts (though Phase B's target is the local host, the shape is instructive).
- **Existing bind-mount block** in `docker/docker-compose.yml` (Phase-70 branding block, per prior handoff `docker-compose.yml.bak-260904-p74-preseed`) — pattern for adding `/var/lib/tg-bridge/`.
- **Identity modal tab pattern** in `IdentityModal.tsx` + `WakeupsTab.tsx` — shape for the new Telegram tab.

---

## No worktrees

Fleet rule (Ashley 2026-07-31). All Phase B work happens in the main tree on `feat/tab-title-from-tmux`. gsd-executor's worktree mode is not selected for any wave.

## Push is orchestrator-owned

Deploy motion (push → build → recreate → verify + coord-room announce cycle) is orchestrator-owned per fleet rule; executor scope stops at code + commit + tests-green. Every push requires a fresh per-push "may I?" moment even for approved work.
