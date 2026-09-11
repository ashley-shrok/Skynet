# Phase 79 CONTEXT — Telegram bridge Phase B: substrate promotion + identity modal Telegram section

**Seeded from:** `.planning/shapes/shape-telegram-bridge.md` (opened + locked 2026-09-05; amended 2026-09-06 with humans-own-their-credentials + no-new-frontend-UI + storage sections). Discuss-phase 2026-09-06 amended one shape deferral (see § Shape overrides).

**Vehicle:** `/build` feature-mode → GSD phase (this file) → `/gsd-plan-phase 79` → `/gsd-execute-phase 79` → `/close telegram-bridge`.

**Depends on:** Phase 77 (Matrix admin foundation, shipped 2026-09-06). Phase 77 deliverables in play here: `matrix-admin-client` with `loginAsUser` (used to mint per-human Matrix tokens on demand), `matrix_admin_creds` singleton FieldCrypto pattern (bot-token storage follows the same pattern), `users.mxid` column (bridge learns which mxid to bridge from Skynet users table).

---

## Domain

Take Nina's hand-configured Telegram bridge — currently a one-off systemd USER unit at `/home/thenasty/.config/tg-bridge/` — and make it a first-class shipping piece of Skynet, distributed by the fleet distributor and configured through the identity modal. Each identity opts in to wrist-reachability via a bot-token paste in a dedicated Telegram tab. Bridge lives where Skynet lives (t1000 for this deployment, T800 for Stacy's). Human Matrix passwords never touch disk; admin mints tokens on demand.

## Shape overrides (Ashley 2026-09-06, discuss-phase)

- **The shape file's "Migrating co-located relay+bridge onto Skynet box → deferred" is REVERSED for the bridge.** The bridge co-locates with Skynet in Phase B — that's the entire point of substrate promotion. Ashley verbatim: *"the whole point of this is that the bridge is becoming a part of Skynet"* / *"by the time this is done, the bridge is a shipping piece of Skynet, just like Agent Supervisor and everything else"* / *"the shapefile should not have deferred that i didn't agree to it."* The **relay/Matrix homeserver** stays on thenasty (Nicole's infra); only the bridge relocates.

---

## Attribution corrections (2026-09-06 course-correction after planning-phase surface)

An earlier revision of this file (and the earlier DISCUSSION-LOG) attributed decisions to Ashley she didn't actually make. Course-corrected 2026-09-06:

- **"Ashley 2026-08-30 normalized substrate services as user-scope"** — INVENTED by me (Tina). Ashley never said this; I pattern-matched from `agent-supervisor` being USER-scope and packaged the inference as her decision. Ashley verbatim on 2026-09-06: *"decisions get attributed to me that I didn't actually make. Because I don't even know why I would care about user scoping."* The systemd USER-scope decision is REMOVED — the bridge is a Docker Compose service (see § 4C-revised below), which drops the systemd question entirely.
- **"Ashley decision #1 = wire an SSH credential to host id 6"** — was Ashley's greenlight of my recommendation, but was BASED ON my erroneous assumption that the Skynet host is guaranteed to be self-registered in Skynet's own host DB. Ashley 2026-09-06 corrected: *"the host machine that the app is running on will actually be a host that is registered into Skynet"* → NOT guaranteed. Decision #1 is REMOVED. The Skynet-container-to-host install pathway becomes irrelevant because the bridge no longer runs on the host (see § 4C-revised below).

**Standing directive for the rest of this file and for downstream agents (researcher / planner / executor):** if a decision is attributed to Ashley, it must be traceable to her literal words in the conversation transcript. Inferences and pattern-matches are labeled *"my inference"* or *"mirrors existing X pattern"* — never *"Ashley decided."* This is the fleet directive from Tina's role file: *"Capture the user's words verbatim — don't paraphrase into attribution."*

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

**4C. Bridge runs as a Docker Compose service alongside `skynet` / `caddy` / `guacd`. No systemd unit, no host-side install, no cross-boundary SSH.** (Locked 2026-09-06 after the discovery that the Skynet host is not guaranteed to be self-registered in Skynet's own DB, invalidating the earlier SSH-to-self install pathway.)

- **New service block in `docker/docker-compose.yml`** — `tg-bridge` service, `Restart: always`, same shape as the other four services. Docker manages lifecycle. Container recreate is the restart mechanism.
- **Shared named Docker volume** `tg-bridge-state` — mounted by BOTH `skynet` and `tg-bridge` containers. Holds `registry.json`, per-human `.token` files, per-human `.since` cursor files, per-human `.token-dead` sentinels, and the bridge's `work/` scratch dir.
- **Skynet writes the registry** by writing directly to the shared volume (local filesystem write from inside the skynet container — no SSH, no bind-mount to host, no cross-boundary anything).
- **Bridge reload on registry change:** bridge watches `/state/registry.json` with `inotifywait` (or the Node equivalent if the bridge grows a Node companion — Nina's bridge stays bash for now, so `inotifywait` inside the container). On change, bridge triggers its own re-exec / re-init.
- **Bridge reads config from environment variables passed via docker-compose:** `MATRIX_HOMESERVER_BASE` (from `matrix_admin_creds.homeserverBase`, exported by skynet via a shared config mechanism — planner decides how — options include a small config-export sidecar OR direct env-var writing to compose from skynet on first run), `STT_URL` (from the new shared TS constant module). Ship-gate check remains: zero hardcoded IPs anywhere in `substrate/services/tg-bridge/bridge.sh`.
- **No systemd unit exists** for the bridge in Phase B. The whole USER-vs-SYSTEM systemd question is moot.
- **No host-side install path** — the bridge lives entirely inside Docker. Fresh Skynet deployments (T800, future) get the bridge automatically via `docker compose up`. Zero operator burden per deployment.
- **Nina's install on thenasty** (`/home/thenasty/.config/tg-bridge/`) can be shut down after cutover — nothing on the host needs replacing.

### 5. Matrix-cursor disk persistence

- Bridge's `mx_sync_for_human` function currently holds `since` in-memory only. On restart it does an initial `/sync?timeout=0` which produces the "reboot-replay flood" bug documented at bridge.sh L266-274 (Continuwuity returns ~30 timeline events per joined room, ~1000 events, ~200 per-agent outbound after filtering).
- Phase B persists `since` per human to `<human>.since` in the shared Docker volume `tg-bridge-state` (mirror the `recv.sh` `SINCE_FILE` pattern from `substrate/skills/agent-relay/recv.sh`). Path inside the bridge container: `/state/<human>.since`.
- On startup, `mx_sync_for_human` reads `/state/<human>.since` if present; falls back to initial-sync only if absent (first-run for that human).
- The Docker named volume survives `docker compose up --force-recreate` and container removal, so cursor state is durable across every routine ops motion.
- Load-bearing for Phase B's reliability floor — this is what makes 3C's "restart-interrupts-others = do nothing" acceptable AND what makes Docker-service-based restarts equivalent to systemd-based restarts for reliability purposes.

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

- **Bridge is a Docker Compose service** defined in `docker/docker-compose.yml`, alongside `skynet` / `caddy` / `guacd`. It comes up automatically on `docker compose up` and stays up via `Restart: always`. Zero operator-visible install step beyond `docker compose up`.
- **Bridge source** (`bridge.sh` + any companion files) lives in `~/skynet-tina/substrate/services/tg-bridge/` and is bundled into a `tg-bridge` Docker image built during Skynet's docker build (or a small Dockerfile that copies from a shared context). Nina's `/home/thenasty/.config/tg-bridge/` install can be shut down after cutover.
- **Shared named Docker volume** `tg-bridge-state` is mounted by both `skynet` and `tg-bridge` containers. Holds `registry.json`, per-human `.token`, per-human `.since`, per-human `.token-dead` sentinels, and bridge scratch. Survives container recreate.
- **Bridge reads Matrix homeserver URL + STT URL (+ any other shared endpoints) from Skynet's config** — no hardcoded IPs in `bridge.sh`. Mechanism: docker-compose environment variables passed from Skynet's config to the tg-bridge service (planner decides exact export mechanism — env var, config file in shared volume, or a small startup script).
- **Ship-gate reliability check:** `grep -E '100\.113\.23\.63|100\.80\.122\.111' substrate/services/tg-bridge/bridge.sh` returns zero matches. Baked into a permanent CI regression guard.
- **Bridge's Matrix cursor persists** per human to `/state/<human>.since` in the shared volume; restart drops zero messages (proven with a repro test that force-restarts mid-bridged-conversation).
- **Bridge reload-on-registry-change** works via `inotifywait` on `/state/registry.json` from inside the bridge container. Skynet writes the registry → bridge self-reinits within a second.
- **Identity modal** has a Telegram tab under Identity view; an owner can paste a bot token, follow on-screen instructions through `/start`, and end up wrist-reachable with no shell.
- **Bot tokens** live in `telegram_bot_tokens` FieldCrypto-encrypted; no plaintext on disk anywhere.
- **Zero `<human>.cred` files** exist anywhere post-migration. Human tokens live in `<human>.token` files written by Skynet via `matrix-admin-client.loginAsUser`; the bridge does not know how to relogin.
- **Dead-token detection** works via `.token-dead` sentinel files in the shared volume: bridge writes on 401, Skynet's reconcile pass scans on next tick, re-mints via `loginAsUser`, overwrites `.token`, unlinks sentinel. Bridge's `inotifywait` picks up the registry change and self-reinits.
- **Recovery from bad clicks:** Disconnect button in the tab returns to paste-state in one click + one confirm.
- **No new frontend UI** outside the Telegram tab (scope-locked).
- **No automatic DM notifications** on bridge failure — surfaced in the tab only.
- **Migration endpoint** `POST /matrix-admin/migrate-cred-files` — one-shot admin-gated, mints fresh tokens for Ashley + Zoe + Laura, writes to shared volume, deletes any legacy `.cred` files. Idempotent, safe to re-run.
- **No host-side systemd unit** for the bridge. No `~/.local/bin/tg-bridge`. No `/home/<user>/.config/tg-bridge/`. All bridge state lives in the Docker named volume.
- **No SSH-to-self** required for the install pathway. The Skynet host doesn't need to be self-registered in Skynet's own host DB for the bridge to work.

---

## Research questions for `/gsd-plan-phase 79` (revised 2026-09-06 for Option B)

Q1, Q4, and Q7 from the original list are OBSOLETE (see § 4C-revised — bridge is a Docker Compose service, no host-side install, no bind-mount to host paths, no runsFleetSubstrate for the bridge). Remaining research surface:

1. **Where does Skynet's STT config live?** Ashley confirmed it exists (she uses voice input). Find the config key, the source file, and the read mechanism. The bridge reads STT URL from the SAME source. This will inform the shared TS constant module design (§ Ashley-locked #3).
2. **Where does Skynet's Matrix homeserver base URL config live?** `matrix_admin_creds.homeserverBase` is one candidate (Phase 77). If there's a broader Matrix config, prefer that. If not, either reuse `matrix_admin_creds.homeserverBase` or add a plain broader config value. Bridge reads from the same source.
3. **How are docker-compose SERVICES structured today?** Read `docker/docker-compose.yml` — enumerate the existing `skynet`, `caddy`, `guacd` service blocks. Find the pattern for adding a new service: image build, volume mount, env var passing, network attachment, restart policy. The `tg-bridge` service block follows this pattern.
4. **How does Skynet currently pass configuration to Docker services?** Env vars in docker-compose.yml? Env file? Config file bind-mount? The bridge needs its Matrix homeserver URL and STT URL — the mechanism must be consistent with how Skynet already gets its own config.
5. **What Synapse token lifetime should we expect?** Synapse tokens don't expire by default, but admin-minted `loginAsUser` tokens may behave differently. Verify against the deployed Synapse (Nicole's homeserver on thenasty). Impacts whether Skynet's reconcile-pass needs to poll `/whoami` on stored tokens, or just react to bridge-side 401s (via the `.token-dead` sentinel mechanism).
6. **Named Docker volume shape:** Does `tg-bridge-state` follow the same volume-declaration pattern as `skynet-data`? Verify the pattern for a shared volume mounted by two services (skynet + tg-bridge).
7. **Bridge Docker image build:** does the bridge script build into a dedicated Docker image (new Dockerfile at `docker/Dockerfile.tg-bridge`), or does it copy into the existing skynet image and get invoked separately? Two viable shapes — planner picks one based on how much the bridge diverges from the skynet base image.
8. **Where does the Skynet backend WRITE files into the shared volume?** Skynet's SQLite `skynet-data` volume is the reference — Skynet writes via the ORM. For `tg-bridge-state`, Skynet writes raw files (registry.json, .token files) directly via Node's `fs`. Verify that path is bind-mounted into the skynet container (or the volume is mounted the same way `skynet-data` is).

---

## Canonical refs

- `.planning/shapes/shape-telegram-bridge.md` — shape file, locked; Ashley's discuss-phase overrides in § Shape overrides above.
- `.planning/phases/77-telegram-bridge-phase-a-skynet-matrix-admin-integration-foun/77-01-PLAN.md` through `77-05-PLAN.md` — Phase 77 admin foundation reference. Especially the `matrix-admin-client` primitives (`loginAsUser`, `createUser`, `makeAdmin`, `getWhoami`, `makeRoomAdmin`) used by Phase B for human-token minting.
- `.planning/phases/73-*/73-*-PLAN.md` — fleet-substrate distributor (feature-02 slice-2). The reconcile-loop pattern Phase B extends for bridge distribution.
- `.planning/phases/75-*/` — server-side substrate bootstrap; the startup-driven install pass that will place tg-bridge on hosts.
- `~/skynet-tina/substrate/skills/agent-relay/recv.sh` — reference implementation for disk-persisted Matrix `since` cursor. Bridge's Matrix-cursor persistence mirrors this exact shape.
- `/home/thenasty/.config/tg-bridge/bridge.sh` (root@100.113.23.63) — Nina's current bridge script, 344 lines. Source of truth for what the bridge does today. Full analysis in this CONTEXT § Locked decisions.
- `/home/thenasty/.config/tg-bridge/registry.json` — current registry structure: `{agents:[{name, mxid, bot_token, humans:[{name, mxid, chat_id, room, cred, token}]}]}`. Phase B keeps this shape but eliminates `.cred` files.
- `/home/thenasty/.config/systemd/user/tg-bridge.service` — current systemd USER unit on Nina's install. Phase B does NOT ship a systemd unit — bridge runs as a Docker Compose service instead. Reference kept for the `Type=simple`/`Restart=always`/`RestartSec=5`/`KillMode=mixed` intent, which translates to `restart: always` in the compose service block.
- `src/backend/matrix/client.ts` — Phase 77 admin client. `loginAsUser` is the Phase B token-minting primitive.
- `src/backend/database/schema.ts` — `matrix_admin_creds` table shape reference for `telegram_bot_tokens` schema.
- `src/backend/database/field-crypto.ts` + `src/backend/database/schema.ts` (`ENCRYPTED_FIELDS`) — encryption pattern.
- `src/ui/features/pretty-view/IdentityModal.tsx` — identity modal shell; where the new Telegram tab lives.
- `src/ui/features/pretty-view/WakeupsTab.tsx` — reference for what a top-level tab under Identity view looks like today.
- `docker/docker-compose.yml` — where the new `tg-bridge` service block lands + the `tg-bridge-state` named volume + the shared-volume mount on both `skynet` and `tg-bridge` services.
- `CLAUDE.md` § "Nginx caveat" — every new backend route Phase B adds needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`.

---

## Code context — reusable assets found during scout

- **`matrix-admin-client.loginAsUser(<mxid>)`** — Phase 77 primitive. Used by Phase B to mint per-human Matrix tokens without touching passwords.
- **FieldCrypto encryption pattern** — `matrix_admin_creds` table (Phase 77) is the reference shape for `telegram_bot_tokens`. Same `ENCRYPTED_FIELDS` list, same `forceSave` discipline post-write.
- **`recv.sh` `SINCE_FILE` pattern** at `substrate/skills/agent-relay/recv.sh` — exact template for the bridge's Matrix cursor persistence.
- **Existing docker-compose SERVICES** — `skynet`, `caddy`, `guacd` in `docker/docker-compose.yml` are the reference pattern for adding the new `tg-bridge` service block. The `skynet-data` named volume is the reference for adding the new `tg-bridge-state` shared volume.
- **Existing docker-compose named volume declarations** — `skynet-data` is a Skynet-owned encrypted volume; `tg-bridge-state` follows the same declaration syntax with different semantics (unencrypted; shared between skynet + tg-bridge services; holds registry + tokens + cursor state).
- **Identity modal tab pattern** in `IdentityModal.tsx` + `WakeupsTab.tsx` — shape for the new Telegram tab.
- **Note on obsolete patterns:** the earlier CONTEXT revision referenced `runsFleetSubstrate:true`, the fleet-substrate distributor SSH path, `identity-birth-orchestrator` step-6/7/8 SFTP-write, and bind-mount blocks (Phase-70 branding pattern) as reusable assets for the bridge install pathway. These are all IRRELEVANT under Option B — the bridge doesn't touch the host, doesn't SSH, doesn't bind-mount host paths, and isn't distributed via the substrate distributor. It's a Docker Compose service.

---

## No worktrees

Fleet rule (Ashley 2026-07-31). All Phase B work happens in the main tree on `feat/tab-title-from-tmux`. gsd-executor's worktree mode is not selected for any wave.

## Push is orchestrator-owned

Deploy motion (push → build → recreate → verify + coord-room announce cycle) is orchestrator-owned per fleet rule; executor scope stops at code + commit + tests-green. Every push requires a fresh per-push "may I?" moment even for approved work.
