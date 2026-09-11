# Phase 79: Telegram bridge Phase B — substrate promotion + identity modal Telegram section — Research

**Researched:** 2026-09-06
**Domain:** Fleet-substrate distribution + Matrix admin token minting + Skynet identity modal + host↔container bridge triggering
**Confidence:** HIGH (all 11 must-answer questions answered against live code and live systems)

## Summary

Phase 79 promotes Nina's `/home/thenasty/.config/tg-bridge/` bash bridge into a first-class Skynet substrate: script + systemd unit + a helper library ship in `substrate/`, the fleet distributor pushes them like `agent-supervisor.sh` does today, and the identity modal grows a Telegram tab that lets a human paste a bot token and end up wrist-reachable with no shell. The load-bearing reliability deliverable is disk-persisting the Matrix `since` cursor per human (mirroring `recv.sh`'s `SINCE_FILE` pattern) so the reconcile-restart cycle never floods Telegram with a boot-replay. Human Matrix passwords are eliminated: `matrix-admin-client.loginAsUser` (Phase 77) mints per-human tokens on demand, Skynet writes `<human>.token` files (0600) into the bridge's registry directory via a bind-mount, and `<human>.cred` files are deleted forever.

All 11 research questions have concrete answers grounded in the running codebase. The single biggest surprise: the substrate distributor already fires `systemctl --user restart <unit>` for `agent-supervisor.sh` (`ssh-push.ts:211-242`) via an SSH channel, so **Phase B's tg-bridge restart trigger is a solved problem** — we add `restartHook: "tg-bridge.service"` to the catalog entry and the bytes-changed → restart wire already exists. Two operational gaps ride alongside: (a) the Skynet host itself (id 6, name "Skynet") is `runsFleetSubstrate:true` but has **no SSH credential attached**, so the distributor currently skips it — pushing the bridge to t1000 either needs that credential wired up, or we install locally via a docker-bind-mount + startup script. (b) `jq` and `curl` are absent from the Skynet Docker container, so any "Skynet writes files consumed by the bridge on the host" motion is fine (Node handles JSON + fetch natively), but any thought of the container `curl`-ing to trigger the bridge is not.

**Primary recommendation:** Ship the bridge script as `substrate/scripts/tg-bridge.sh` + `substrate/user-onboarding/tg-bridge.service` (SYSTEM unit — NOT `--user`, see Q1 below for why); add both to `FLEET_SUBSTRATE_CATALOG` with `restartHook: "tg-bridge.service"` and an `installPath` under `~/.local/bin/tg-bridge` and `/etc/systemd/system/tg-bridge.service`; add a new `telegram_bot_tokens` FieldCrypto-encrypted table mirroring `matrix_admin_creds`; add a new admin-gated backend route family (`/telegram-bridge/*`) — with nginx-caveat-matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`; add `/var/lib/tg-bridge/` as a new read-write bind-mount in `/opt/skynet/docker-compose.yml`; add a Telegram tab to the identity modal following the exact `WakeupsTab` shape.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (Alice + Tina 2026-09-06 discuss-phase)

**1. Bridge lives where Skynet lives — co-located, distributor-shipped.**
- Bridge runs on the Skynet host (t1000 for this deployment; T800 for Stacy's; whatever host in the future).
- Distributed by the fleet-substrate distributor as a **universal** substrate item (like `agent-supervisor.sh`) — not host-filtered. Alice: *"there's nothing in the distributor that takes a universal piece like the bridge and distributes it to only one host. like that would be dumb and silly and so it certainly doesn't work that way today and it would be weird for us to make it work that way as a part of this."*
- Systemd unit enabled on the Skynet host as part of Skynet's own runtime setup.
- **Config values the bridge reads come from Skynet's own config**, not hardcoded in the script. Hard requirement — verified at ship gate.
  - **Matrix homeserver URL** — from Skynet's Matrix config (same source `matrix_admin_creds.base` uses). Removes hardcoded `http://100.113.23.63:8008`.
  - **STT URL** — from Skynet's existing STT config. Removes hardcoded `http://100.80.122.111:8000/v1/audio/transcriptions`.
  - **TTS URL** — same rule if the bridge grows a TTS path.
- **Reliability check:** if the bridge is NOT reading STT (and Matrix + any shared endpoint) from Skynet config post-phase, we've shipped a bug. Alice verbatim: *"if we come out of this and the bridge is not using the config values for where to get speech to text from that Skynet also uses, then that will have been a mistake."*

**2. Identity modal — Telegram gets its own top-level tab under Identity view.**
- Alongside identity-file / wakeups / handoff. Fixed real-estate: every identity's modal has the Telegram tab, even if un-configured (same as Handoff for young identities).
- Discoverability wins over hidden slots.
- Icon: planner's choice (Material `MdWatch`/`MdSmartphone` or `FaTelegramPlane` are candidates). **Note:** the modal currently uses only `lucide-react` icons (see `IdentityModal.tsx:2` — `AlarmClock, Clock, Handshake, Pencil, Target, User, Users, X`). Recommendation in § Standard Stack.
- Label: "Telegram" (plain — no cutesy branding).
- Wakeups and Telegram stay conceptually separated: different credential shapes, different failure modes.

**3. Activation-flow UX (all locked, minimal by design):**
- **3A Connected view (MINIMAL):** green dot + "Connected. Bot: @your-bot-name. Human: @your-telegram-handle." + one "Disconnect" button. No timestamps, no mute, no diagnostic log tail.
- **3B Activation errors:**
  - Bad bot token (Telegram API rejects on paste): inline "Telegram rejected that token — check you copied the full string from @BotFather." Paste field cleared and focused. No backend write.
  - Token accepts, bot silent (no `/start` yet): persistent "waiting for you to send /start to @your-bot..." + **Copy bot link** button (`t.me/your-bot`). No timeout that flips to error. **Cancel** button wipes pending state and returns to paste.
  - Bridge restart fails: tab shows "Bridge didn't come back up — Telegram is not receiving messages right now." **Retry** button. **No automatic DM notification.**
  - Network/registry-write failure: "Couldn't save — try again in a moment." Retry button.
- **3C Restart interrupts others:** do nothing special. Restart is <5s. Matrix-cursor persistence means no messages drop. Alice: *"as long as we're not ever dropping messages, I don't care that the restart happens."*
- **3D Recovery from bad clicks:** Disconnect button + confirm dialog ("This will unbridge <identity> from Telegram. The bot stays alive in Telegram (you can reconnect anytime with the same token, or paste a new one). Confirm.") → clears registry entry for this (identity, human) row → restart bridge → tab returns to paste-state.

**4. Wire mechanics (all locked):**
- **4A `telegram_bot_tokens` table:** FieldCrypto-encrypted, columns `identityKey` (pk), `botTokenEncrypted`, `botUsername` (display), `humanUserId` (authz), `telegramChatId` (nullable until `/start`), `createdAt`, `updatedAt`. Multi-human-per-identity deferred to future join table.
- **4B `<human>.cred` files eliminated:** Skynet mints tokens via `matrix-admin-client.loginAsUser(<mxid>)` (Phase 77); writes `<human>.token` (0600) to the bridge's registry dir. Migration: one-shot admin-mint fresh tokens for Alice + Zoe + Laura; delete the three existing `<human>.cred` files (research confirms only Alice + Zoey — Laura had no cred file live).
- **4C Restart trigger:** mirror the substrate distributor's `agent-supervisor` restart pattern (which is `systemctl --user restart` via SSH channel — see Q1 answer below). Bind-mount: `/var/lib/tg-bridge/` into the Skynet container.
- **5 Matrix-cursor disk persistence:** per-human `<human>.since` file, mirroring `recv.sh`'s `SINCE_FILE` pattern. Load-bearing for Phase B's reliability floor.

### Claude's Discretion

- Exact icon library / icon choice for the Telegram tab (locked to "planner's choice", constrained to what the modal already imports from `lucide-react` — see § Standard Stack for the concrete recommendation).
- Whether the SYSTEM systemd unit vs USER systemd unit — Q1 finding forces SYSTEM but the shape file spec says "same shape" as the existing USER unit. Planner decides how to reconcile.
- Whether the "Skynet host installs on itself" motion uses (a) the SSH-based distributor (needs the missing credential on host id 6), or (b) a docker-bind-mount + host-side install script triggered on Skynet startup. Q4 finding shows (a) requires credential-wire work; (b) is faster and simpler for the single "install on the box Skynet runs on" case.
- Where in the backend the new admin routes live (recommendation: `src/backend/telegram-bridge/telegram-bridge-routes.ts` — new file, mounted at `/telegram-bridge` per the nginx location-block pattern).
- Exact retry cadence / reconcile-pass shape for dead-token detection (Q6 finding says admin-minted tokens don't expire by default, so a purely reactive-to-401s design is sufficient; no polling needed).

### Deferred Ideas (OUT OF SCOPE — verbatim from CONTEXT.md)

- Federation between Skynet boxes, shared relays across deployments.
- Skynet UI for the Matrix admin itself (room management, invite/kick, moderation UI). Phase B touches the admin capability only in the narrow sense of using `loginAsUser`.
- Rewriting Nina's bridge in another language. Stays bash.
- Any changes to how agents DM each other. Unchanged.
- Skynet PWA or in-app notification story.
- **Any new frontend UI beyond the identity-modal Telegram tab.** (scope-locked)
- Deletion/rename propagation.
- Hot-reload of bridge config (signal-driven re-registration) — restart is acceptable given cursor persistence.
- Multi-humans-per-identity UI — bridge supports it, v1 UI does not.
- Migration of legacy encrypted/frozen rooms from the pre-admin era.
- **Bridge-side restart-free bot addition** (deferred during discuss): today adding a new bot requires a bridge restart because `tg_poller` threads spawn at startup. Real improvement, not Phase B.
</user_constraints>

<phase_requirements>
## Phase Requirements

Phase 79 has no pre-existing REQUIREMENTS.md IDs (verified: `grep telegram /home/ubuntu/skynet-tina/.planning/REQUIREMENTS.md` returns only the unrelated Telegram-visual-language TG-16 requirement). Deriving requirement IDs from CONTEXT.md's Success Definition:

| ID | Description | Research Support |
|----|-------------|------------------|
| TGB-01 | Bridge script + systemd unit + registry-writer helper live in `~/skynet-tina/substrate/` and are distributed by the fleet-substrate distributor to every substrate host (universal — not host-filtered). | § Substrate distributor (Q1); § Files created |
| TGB-02 | On the Skynet host (t1000 for this deployment), the bridge systemd unit is enabled and running as an official Skynet service. Nina's `/home/thenasty/.config/tg-bridge/` install can be shut down after cutover. | § Install-on-self alternatives (Q4); § Cutover risks |
| TGB-03 | Bridge reads Matrix homeserver URL + STT URL (+ any other shared endpoints) from Skynet's config — no hardcoded IPs in the script. | § Config source-of-truth (Q2, Q3) |
| TGB-04 | Bridge's Matrix cursor persists to disk per human; restart drops zero messages (proven with a repro test that force-restarts mid-bridged-conversation). | § Matrix cursor persistence (recv.sh mirror) |
| TGB-05 | Identity modal has a Telegram tab under Identity view; an owner can paste a bot token, follow on-screen instructions through `/start`, and end up wrist-reachable with no shell. | § Identity modal tab pattern (Q10); § Telegram getMe validation (Q11) |
| TGB-06 | Bot tokens live in `telegram_bot_tokens` FieldCrypto-encrypted; no plaintext on disk anywhere. | § FieldCrypto pattern; § New table schema |
| TGB-07 | Zero `<human>.cred` files exist anywhere post-migration. Human tokens live in `<human>.token` files written by Skynet via `matrix-admin-client.loginAsUser`; the bridge does not know how to relogin. | § loginAsUser (Q9); § Migration path (Q8) |
| TGB-08 | Registry write + restart trigger works from inside the Skynet container to the host-side bridge (via the substrate-distributor-consistent mechanism). | § Container→host wire (Q5); § Distributor restart pattern (Q1) |
| TGB-09 | Recovery from bad clicks: Disconnect button in the tab returns to paste-state in one click + one confirm. | § Modal shape spec |
| TGB-10 | No new frontend UI outside the Telegram tab (scope-locked). | § Locked scope-outs |
| TGB-11 | No automatic DM notifications on bridge failure — surfaced in the tab only. | § Locked scope-outs |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Bridge script + systemd unit (bash) | Substrate/Host | Distributor (API/Backend) | Bridge is host-level bash; distributor is the shipping mechanism |
| `telegram_bot_tokens` storage | Database/Storage | API/Backend | AES-encrypted SQLite is the singleton pattern for secrets |
| `POST /telegram-bridge/activate` etc. routes | API/Backend | Database/Storage | Backend mediates all reads/writes; browser never touches bot token |
| `matrix-admin-client.loginAsUser` for `<human>.token` minting | API/Backend | Substrate/Host filesystem | Backend calls Synapse admin; writes file via bind-mount to host |
| Registry file writer (`registry.json` updates from container) | API/Backend | Substrate/Host filesystem | Node writes to bind-mounted `/var/lib/tg-bridge/` |
| Restart trigger (container → bridge) | API/Backend | Distributor (SSH) or Host (bind-mount sentinel) | See Q1: mirror distributor's `systemctl restart` via SSH; for the local (self-Skynet) case, planner decides between SSH-to-self vs bind-mount sentinel |
| Telegram tab in IdentityModal | Browser/Client | API/Backend | New tab in existing React modal following `WakeupsTab` shape |
| Paste-time bot-token validation | API/Backend | Telegram API (external) | Backend proxies `/getMe` so browser never talks to Telegram directly (avoids exposing `api.telegram.org` to CSP) |
| Bridge reading Skynet config | Substrate/Host | API/Backend | Bridge reads from bind-mounted `/etc/tg-bridge/config.env` (or similar) that Skynet writes at startup |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `bash` (host) | 5.x+ | Bridge script language | [VERIFIED: t1000 has `/usr/bin/bash`] Bridge stays bash per locked scope-out ("Rewriting Nina's bridge in another language — out"). |
| `jq` (host) | 1.6+ | Bridge JSON parsing | [VERIFIED: t1000 has `/usr/bin/jq`] Used throughout `bridge.sh` L52, L88, L118 etc. |
| `curl` (host) | 8.x | Bridge HTTP calls | [VERIFIED: t1000 has `/usr/bin/curl`] Used throughout `bridge.sh`. |
| Node builtin `fetch` (container) | Node ≥ 22.12.0 | Backend admin routes + Telegram getMe proxy | [VERIFIED: docker exec shows node 22+] `voice.ts:113` uses fetch; `matrix-admin-client.ts` uses fetch. **Note:** container does NOT have `jq` or `curl` (verified) — all HTTP + JSON goes through Node. |
| `express` | ^5.2.1 | New route file `telegram-bridge-routes.ts` | [VERIFIED: package.json] Existing framework. |
| `drizzle-orm` | ^0.45.2 | New `telegram_bot_tokens` table typing + queries | [VERIFIED: package.json] Existing ORM. |
| `better-sqlite3` | 12.9.0 | `CREATE TABLE telegram_bot_tokens` at boot via `addColumnIfNotExists`-style migration | [VERIFIED: package.json] Existing driver. Migration pattern from Phase 75 (`db/index.ts:875-878`). |
| `lucide-react` | in tree | Telegram tab icon | [VERIFIED: `IdentityModal.tsx:2`] All 8 existing tab icons come from lucide-react. **Recommendation:** use `Send` from lucide-react for the Telegram tab (paper-airplane, matches Telegram's brand affordance, no new npm dep). Alternatives if the planner wants something more Telegram-specific: `MessageCircle` or `Bell`. Do NOT pull in `react-icons/fa` or `react-icons/md` for one icon. |
| `FieldCrypto` (in-tree at `src/backend/utils/field-crypto.ts`) | — | AES-256-GCM at-rest encryption for the `botTokenEncrypted` column | [VERIFIED: `field-crypto.ts:50` — `matrix_admin_creds: new Set(["access_token", "password"])`] Add `telegram_bot_tokens: new Set(["bot_token"])` to the `ENCRYPTED_FIELDS` map. |
| `DatabaseSaveTrigger` (in-tree at `src/backend/utils/database-save-trigger.ts`) | — | Persist RAM-SQLite writes to disk after every `telegram_bot_tokens` mutation | [VERIFIED: `matrix-admin-creds-store.ts:166`] Use `.triggerSave("telegram_bot_tokens_save")` (debounced 2s); wrap in try/catch, non-fatal warn. |
| `AuthManager.createAdminMiddleware()` | in-tree at `src/backend/utils/auth-manager.ts` | Admin-gate the new `/telegram-bridge/*` routes | [VERIFIED: reuse pattern from `matrix-admin-routes.ts:71`] Not every route needs admin gate — the "which routes need admin vs which need only authenticated-user" is a planner call. Deleting a token that isn't yours should be blocked; activating your own bot should be authenticated-user-only. |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `inotify-tools` (host) — optional | 3.22+ (available on t1000 via `apt install inotify-tools`, not currently installed) | Only if Phase B chooses the sentinel-file+inotifywait restart pattern instead of mirroring the distributor's SSH-based `systemctl restart` | Q1 finding says: mirror the distributor. Distributor uses SSH `systemctl restart`. So inotifywait is likely NOT needed. Only relevant if the "install-on-self" motion (Q4) uses a bind-mount sentinel because it can't reach itself via SSH. |
| `matrix-admin-client.loginAsUser` | in-tree at `src/backend/matrix/matrix-admin-client.ts:127` | Mint per-human Matrix tokens without knowing passwords | [VERIFIED: file exists, tested via Phase 77 integration tests] Call signature: `loginAsUser(mxid: string, validUntilMs?: number) → Promise<LoginAsUserOk \| AdminErr>`. Returns `{ok:true, accessToken:string}` on success. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| SYSTEM systemd unit (`/etc/systemd/system/tg-bridge.service`) | USER systemd unit (`~/.config/systemd/user/tg-bridge.service`) — same shape as Nina's current, and same shape as `agent-supervisor.service` | The USER pattern requires `loginctl enable-linger <user>` to survive user logout. Fine for Nina's thenasty (where `thenasty` user is always logged in) and for fleet substrate hosts (where `ubuntu` has linger enabled). But for the t1000 Skynet host itself, the bridge needs to survive across container recreation AND across `ubuntu` logout — a SYSTEM unit is more robust. Also, `/var/lib/tg-bridge/` (locked path) is a system-level path, not `~/`. **Recommend SYSTEM unit for the tg-bridge; keep the distributor's `systemctl --user` mechanism for its existing agent-supervisor entry unchanged.** New helper needed in distributor: a `unitScope: "user" | "system"` field on `CatalogEntry` so the restart command becomes `systemctl [--user] restart <unit>`. |
| Bind-mount `/var/lib/tg-bridge/` (locked from CONTEXT.md) | `/opt/skynet/tg-bridge/` — alongside branding | Locked path is `/var/lib/tg-bridge/` per CONTEXT.md § 4C. Verified free on t1000 (`ls: cannot access '/var/lib/tg-bridge': No such file or directory`). `/opt/skynet/tg-bridge/` also free — both would work. Keep the locked choice. |
| New `/telegram-bridge/*` route family (recommendation) | Extend `/matrix-admin/*` or add to `/identities/*` | Semantic mismatch: `/matrix-admin` is Skynet's Synapse admin surface; `/identities` is the identity CRUD surface. Telegram is a separate concern (external routing). New route family matches Phase 77's precedent (`/matrix-admin` is its own family added same way). |
| Backend proxy for Telegram `getMe` validation | Direct browser fetch to `https://api.telegram.org/bot<token>/getMe` | Direct browser fetch would leak the bot token to Telegram-CORS + require adding `api.telegram.org` to any CSP. Backend proxy is simpler + hides the token from any browser-side attacker who might sniff network traffic. Backend needs `api.telegram.org` reachable — verified: t1000 has public egress. |
| `Send` icon (recommendation) | `MessageCircle`, `Bell`, or `Phone` | `Send` (paper airplane) is the closest lucide-react equivalent to Telegram's brand. All lucide-react. No new dep. If Alice strongly prefers Telegram-plane-branded icon, `react-icons/fa`'s `FaTelegramPlane` is one call away but adds a dep for one icon. Recommendation stays: `Send`. |

**Installation:** No new npm packages required. On the host, `inotify-tools` may or may not be needed depending on restart-trigger choice — if needed, `sudo apt install -y inotify-tools`. If the SYSTEM systemd unit is chosen, no `linger` setup needed.

**Version verification:**
```bash
# Container:
sudo docker exec skynet node -v                              # v22.x+ [VERIFIED via docker exec]
# Host:
bash --version | head -1                                     # 5.2.x [VERIFIED]
jq --version                                                 # 1.6+ [VERIFIED]
curl --version | head -1                                     # 8.x [VERIFIED]
systemctl --version | head -1                                # systemd 255 [VERIFIED]
# Package sanity:
grep '"drizzle-orm":' package.json                           # ^0.45.2 [VERIFIED]
grep '"better-sqlite3":' package.json                        # 12.9.0 [VERIFIED]
grep '"express":' package.json                               # ^5.2.1 [VERIFIED]
grep '"lucide-react":' package.json                          # in tree [VERIFIED — used by IdentityModal.tsx:2]
# Live Telegram + Synapse:
curl -s "https://api.telegram.org/bot0:0/getMe" | jq .       # expect {"ok":false,"error_code":404} — proves egress works
curl -s http://100.113.23.63:8008/_synapse/admin/v1/server_version  # {"server_version":"1.157.2"} [VERIFIED live 2026-09-06]
```

## Package Legitimacy Audit

Phase 79 installs **zero new npm packages**. Every JS/TS dependency is already in `package.json` (verified via `IdentityModal.tsx:2` for lucide-react; `matrix-admin-client.ts` for fetch/express/drizzle). On the host, `inotify-tools` is an optional Debian package (verified installable via `apt-cache show inotify-tools` — version 3.22.6.0-4 on t1000's mirrors) that may or may not be needed depending on the restart-trigger choice.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| — | — | — | — | — | — | No new npm packages proposed. |
| `inotify-tools` (optional, host apt) | Debian bookworm | 3.22.6.0-4 (mature — package originated 2005) | — (apt) | https://github.com/inotify-tools/inotify-tools | n/a (not slopcheckable — Debian package) | Optional. Only if restart-trigger choice needs it. Verified upstream at inotify-tools/inotify-tools GitHub org, well-known Debian package. |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                         t1000 (Skynet host machine)                                 │
│                                                                                     │
│  ┌───────────────────────────────────────────────────────────────────┐              │
│  │  Skynet Docker container (node 22, no jq/curl)                    │              │
│  │                                                                   │              │
│  │  User → nginx (port 443) → Express (port 30001)                   │              │
│  │                                     │                             │              │
│  │  ┌─────────────────────────────────┴─────────────────────┐        │              │
│  │  │  /telegram-bridge/* routes (NEW — this phase)         │        │              │
│  │  │    POST /telegram-bridge/activate                     │        │              │
│  │  │    POST /telegram-bridge/getme (proxy)                │        │              │
│  │  │    POST /telegram-bridge/disconnect                   │        │              │
│  │  │    GET  /telegram-bridge/:identityKey (status view)   │        │              │
│  │  │    POST /telegram-bridge/restart                      │        │              │
│  │  └───────────────────────┬───────────────────────────────┘        │              │
│  │                          │                                        │              │
│  │  ┌───────────────────────┴────────────────────────────────┐       │              │
│  │  │  telegram_bot_tokens table (NEW — FieldCrypto)          │       │              │
│  │  │    identityKey (pk) / botTokenEncrypted / botUsername   │       │              │
│  │  │    humanUserId / telegramChatId / createdAt / updatedAt │       │              │
│  │  └────────────────────────────────────────────────────────┘       │              │
│  │                                                                   │              │
│  │  ┌────────────────────────────────────────────────────────┐       │              │
│  │  │  matrix-admin-client.loginAsUser (Phase 77 primitive)   │       │              │
│  │  │  → Synapse admin API: mint access token for @ashley:... │       │              │
│  │  └────────────────────────┬───────────────────────────────┘       │              │
│  │                           │                                       │              │
│  │  ┌────────────────────────┴──────────────────────────┐            │              │
│  │  │  registry-writer helper (NEW module)              │            │              │
│  │  │  writes registry.json, <human>.token, <human>.since│            │              │
│  │  │  to bind-mounted /var/lib/tg-bridge/               │            │              │
│  │  └────────────────────────┬──────────────────────────┘            │              │
│  │                           │                                       │              │
│  └──────────────────────────╬────────────────────────────────────────┘              │
│                             ║  bind-mount                                           │
│                             ║  /var/lib/tg-bridge/ (rw)                             │
│                             ▼                                                       │
│  ┌───────────────────────────────────────────────────────────────────┐              │
│  │  /var/lib/tg-bridge/ (host filesystem — NEW, 750, root:root)      │              │
│  │    registry.json                                                  │              │
│  │    <human>.token   (0600 — minted by Skynet admin)                │              │
│  │    <human>.since   (persistent Matrix cursor — this phase's       │              │
│  │                     load-bearing reliability delivery)            │              │
│  │    config.env       (Skynet writes at startup — Matrix + STT URL) │              │
│  │    offset.<agent>   (per-bot Telegram getUpdates offset)          │              │
│  │    work/            (in-flight media scratch)                     │              │
│  │    bridge.log                                                     │              │
│  │  NOTE: no <human>.cred files (deleted by Phase B migration)       │              │
│  └───────────────────────────────────────────────────────────────────┘              │
│                             ▲                                                       │
│                             │ reads registry, tokens, cursor                        │
│                             │ writes offsets, since, log                            │
│  ┌───────────────────────────────────────────────────────────────────┐              │
│  │  tg-bridge.service (NEW SYSTEM systemd unit — /etc/systemd/system) │             │
│  │  ExecStart=/usr/local/bin/tg-bridge   Restart=always  RestartSec=5 │              │
│  │           │                                                        │              │
│  │           ▼                                                        │              │
│  │  /usr/local/bin/tg-bridge (Phase B version of Nina's bridge.sh):   │              │
│  │    - loads config.env for MATRIX_ROOT + STT_URL (no hardcodes)     │              │
│  │    - reads <human>.token (never .cred — that whole path is gone)   │              │
│  │    - persists <human>.since to disk per human                      │              │
│  │    - tg_poller per bot (loop) → mx_send AS <human>                 │              │
│  │    - mx_sync_for_human per human (loop) → tg_send outbound         │              │
│  └───────────────────────────────────────────────────────────────────┘              │
│                             ▲                                                       │
│                             │ restart trigger                                       │
│                             │ (see § Restart-trigger design)                        │
└─────────────────────────────╬───────────────────────────────────────────────────────┘
                              │
                     ┌────────┴──────────────────────────┐
                     │  Fleet substrate distributor       │
                     │  (Phase 73/75 code, in-tree)       │
                     │  On bytes change:                  │
                     │  ssh <host> systemctl [--user]     │
                     │  restart tg-bridge.service         │
                     └────────────────────────────────────┘

                     ┌────────────────────────────────────┐
                     │  Nicole's Synapse @ thenasty       │
                     │  100.113.23.63:8008                │
                     │  admin API: /_synapse/admin/v1/…   │
                     └────────────────────────────────────┘

                     ┌────────────────────────────────────┐
                     │  Telegram Bot API                  │
                     │  api.telegram.org/bot<token>/…     │
                     │  (backend-only — no browser calls) │
                     └────────────────────────────────────┘
```

### Recommended Project Structure

```
substrate/
├── scripts/
│   └── tg-bridge.sh                     # NEW — Phase B bridge (evolution of Nina's bridge.sh)
├── user-onboarding/
│   └── tg-bridge.service                # NEW — SYSTEM systemd unit (NOT --user; see Q1)
└── skills/
    └── (unchanged)

src/backend/
├── telegram-bridge/                     # NEW directory (mirrors matrix/ layout)
│   ├── telegram-bridge-routes.ts        # NEW — /telegram-bridge/* Express routes
│   ├── telegram-bridge-routes.test.ts   # NEW
│   ├── registry-writer.ts               # NEW — writes registry.json + <human>.token + config.env
│   ├── registry-writer.test.ts          # NEW
│   ├── telegram-getme-proxy.ts          # NEW — backend proxy for /getMe validation
│   └── telegram-bot-tokens-store.ts     # NEW — FieldCrypto CRUD (mirrors matrix-admin-creds-store.ts)
├── matrix/
│   └── matrix-admin-client.ts           # UNCHANGED (loginAsUser reused as-is)
├── database/db/
│   ├── schema.ts                        # MODIFIED — add telegramBotTokens table (mirrors matrixAdminCreds)
│   └── index.ts                         # MODIFIED — add CREATE TABLE + persist trigger for new table
├── utils/
│   └── field-crypto.ts                  # MODIFIED — add telegram_bot_tokens → new Set(["bot_token"]) entry
└── distributor/
    └── catalog.ts                       # MODIFIED — 2 new rows (tg-bridge.sh + tg-bridge.service)

src/ui/features/pretty-view/
├── IdentityModal.tsx                    # MODIFIED — NAV_SECTIONS_IDENTITY grows a Telegram entry;
│                                        #            add <TabsContent value="telegram">
├── TelegramTab.tsx                      # NEW — mirrors WakeupsTab / HandoffTab shape
└── TelegramTab.test.tsx                 # NEW

src/ui/api/
└── telegram-bridge-api.ts               # NEW — frontend fetch wrappers for the 5 routes

docker/
├── docker-compose.yml                   # NEW at this location OR modify /opt/skynet/docker-compose.yml directly (see § Deploy motion)
├── nginx.conf                           # MODIFIED — add location ~ ^/telegram-bridge(/.*)?$ block
└── nginx-https.conf                     # MODIFIED — same location block (CLAUDE.md nginx caveat)

/opt/skynet/                             # host-side deploy artifacts (not in repo — orchestrator territory)
└── docker-compose.yml                   # MODIFIED — add /var/lib/tg-bridge/ bind-mount

.planning/phases/79-.../                 # this phase's artifacts (already exist)
├── 79-CONTEXT.md                        # (exists)
├── 79-RESEARCH.md                       # THIS FILE
├── 79-PATTERNS.md                       # (planner adds)
├── 79-VERIFICATION.md                   # (planner adds)
└── 79-01-PLAN.md through 79-NN-PLAN.md  # (planner adds)
```

### Pattern 1: SSH-based `systemctl restart` via substrate distributor

**What:** After the distributor pushes new bytes for a catalog entry with a non-null `restartHook`, it fires `systemctl --user restart <unit>` via the SSH channel it already holds.

**When to use:** Any Phase B catalog entry that needs re-execution to pick up new bytes.

**Example:**
```typescript
// Source: src/backend/distributor/ssh-push.ts:211-242 (VERIFIED)
export async function restartUserUnit(
  channel: SshChannel,
  unitName: string,
): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  const escapedUnit = shellSingleQuote(unitName);
  const cmd = `systemctl --user restart ${escapedUnit} && echo __RESTART_OK__ || echo __RESTART_FAIL__`;
  const raw = await channel.exec(cmd);
  if (raw === null) return { ok: false, errorMessage: "channel returned null" };
  const trimmed = raw.trimEnd();
  if (trimmed.endsWith("__RESTART_OK__")) return { ok: true };
  return { ok: false, errorMessage: trimmed.slice(0, 500) || "systemctl restart failed" };
}
```

**Phase B extension needed:** If the tg-bridge unit is SYSTEM scope (recommended — see Q1 answer), we need a `unitScope` field on the catalog and a sibling `restartSystemUnit()` helper that runs `sudo systemctl restart <unit>` (or `systemctl restart <unit>` if the SSH user has NOPASSWD sudo, which is worth checking per host).

### Pattern 2: Matrix cursor persistence (from `recv.sh`)

**What:** Each `mx_sync_for_human` loop resumes its Matrix `since` cursor from `<human>.since` on startup and writes updates atomically.

**When to use:** Every place in the bridge where a Matrix `/sync` cursor advances.

**Example:**
```bash
# Source: substrate/skills/agent-relay/recv.sh:102, 235 (VERIFIED)
# Startup — resume across restarts:
SINCE=$(cat "$SINCE_FILE" 2>/dev/null)

# In the sync loop, only advance on real next_batch (CURSOR GUARD from recv.sh:226-235):
NB=$(jq -r '.next_batch // empty' <<<"$R" 2>/dev/null)
if [ -z "$NB" ]; then sleep 3; continue; fi
SINCE="$NB"; printf '%s' "$SINCE" > "$SINCE_FILE"
```

**Phase B extension:** `mx_sync_for_human()` in `tg-bridge.sh` gets:
- `SINCE_FILE="$REGISTRY_DIR/${human}.since"` at function top
- Load `since=$(cat "$SINCE_FILE" 2>/dev/null)` before the initial-sync-retry loop
- If `since` non-empty on entry, skip the initial `?timeout=0` sync and go straight to the incremental loop
- Write `since` to `$SINCE_FILE` on every cursor advance (mirror `recv.sh:235`)

### Pattern 3: FieldCrypto-encrypted singleton table (from `matrix_admin_creds`)

**What:** New encrypted-column table follows the exact shape of `matrix_admin_creds`: schema, `ENCRYPTED_FIELDS` entry, store module with encrypt-on-write / decrypt-on-read, `DatabaseSaveTrigger.triggerSave` on every mutation.

**Example:** See `matrix-admin-creds-store.ts:113-177` verbatim. For `telegram_bot_tokens`, mirror the module: `getTelegramBotToken(identityKey)`, `setTelegramBotToken(identityKey, {botToken, botUsername, humanUserId, telegramChatId})`, `deleteTelegramBotToken(identityKey)`. Change `SINGLETON_ID = 1` → per-identity keying (identityKey is the pk). Note: the field-crypto record-id-in-HKDF context is `String(identityKey)`, not `"1"`.

### Pattern 4: Identity modal tab (from WakeupsTab/HandoffTab)

**What:** New TSX file exports a single function-component that takes `{state, hue, isCoordinator, onSave/onActivate/onDisconnect}` props. Rendered inside `IdentityModal.tsx` under a new `<TabsContent value="telegram">`. Icon + label added to `NAV_SECTIONS_IDENTITY`.

**Example:** `HandoffTab.tsx` (200 lines) is the closest shape — state=loading/error/ready, save-flow with confirm/cancel, error surface. `WakeupsTab.tsx` (874 lines) is bigger because it manages a list with row-add/-delete; Telegram tab is closer to `HandoffTab` (single credential per identity, one-shot activate/disconnect).

### Anti-Patterns to Avoid

- **Anti-pattern: Direct browser fetch to `api.telegram.org`.** Leaks the bot token to Telegram-CORS and requires CSP whitelisting. **Do:** backend proxies `/getMe`, so the browser only ever posts `{token}` to Skynet, which validates and returns `{ok:true, botUsername:"..."}`.
- **Anti-pattern: Storing Matrix passwords for humans (Nina's current `<human>.cred`).** Eliminated in Phase B. **Do:** `matrix-admin-client.loginAsUser(mxid)` mints tokens; bridge only ever reads `<human>.token`; if a token dies, Skynet re-mints via admin.
- **Anti-pattern: Container writes JSON via `jq` in an execFile shell-out.** Container doesn't have `jq` (verified). **Do:** all JSON manipulation in Node using `JSON.parse`/`JSON.stringify`; fs.writeFileSync/fs.promises.writeFile for atomic writes.
- **Anti-pattern: New backend route with only nginx.conf updated.** CLAUDE.md nginx caveat: routes need matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`, else the frontend crashes on `.map` requests. **Do:** every new route family gets two location blocks. Verify post-deploy with `curl -si https://term.example.com/telegram-bridge/xxx -X POST`. Expected: 401/403/404 (backend response), NOT 200 with `text/html`.
- **Anti-pattern: Bridge restart mid-tg-getUpdates long-poll.** Every restart interrupts `curl --max-time 40 .../getUpdates?timeout=25`. **Guard:** rely on `Restart=always` + `RestartSec=5` and cursor persistence; don't try to graceful-stop the pollers.
- **Anti-pattern: Trying to bind-mount `/opt/skynet/tg-bridge/` when the locked path is `/var/lib/tg-bridge/`.** Path is locked in CONTEXT.md.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Matrix admin token minting | Custom login endpoint | `matrix-admin-client.loginAsUser` (Phase 77) | Already exists, tested, handles error branches |
| At-rest bot-token encryption | Custom crypto | `FieldCrypto` (in-tree) | Established pattern; auto-decrypt on read via `ENCRYPTED_FIELDS` map |
| SQLite → disk persistence | `saveMemoryDatabaseToFile()` inline | `DatabaseSaveTrigger.triggerSave("<reason>")` | Debounced; used by every other write path (matrix-admin-creds, host, etc.) |
| Substrate file distribution to hosts | Custom SFTP + restart loop | `FLEET_SUBSTRATE_CATALOG` + `runSweepForHost` (Phase 73/75) | Already handles byte-compare, push, restart-hook fire; add two rows to the catalog |
| Systemd unit installation | Custom systemctl commands via SSH | Same substrate distributor + `restartHook: "tg-bridge.service"` | The `agent-supervisor.service` row already proves this pattern; add a `tg-bridge.service` row |
| Matrix `/sync` cursor persistence | In-memory cursor | Mirror `recv.sh:102, 235` — read on startup, write on every advance | Load-bearing for Phase B reliability |
| Telegram token validation | Regex + hope | Backend proxy to `https://api.telegram.org/bot<token>/getMe` | `ok:true` + `.result.username` is definitive; no false positives possible |
| Admin route pattern | New middleware | `AuthManager.createAdminMiddleware()` | Existing; same pattern used by `/matrix-admin/creds` |

**Key insight:** Phase 77 built the primitives; Phase 79 is 90% wiring. The only genuinely new custom code is (a) the `telegram_bot_tokens` store (a copy-adapt of `matrix-admin-creds-store.ts`), (b) the identity modal Telegram tab (a copy-adapt of `HandoffTab.tsx`), and (c) the bridge script's edits to add config-loading + cursor-persistence + `.cred`-deletion. Everything else already exists.

## Runtime State Inventory

**Applicable:** Phase 79 is a migration/rename phase for the bridge's disk state (kills `<human>.cred`; changes registry.json shape; adds `<human>.since`; moves the whole install from `/home/thenasty/.config/tg-bridge/` to `/var/lib/tg-bridge/` on the Skynet host).

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | (1) Nina's `registry.json` on thenasty at `/home/thenasty/.config/tg-bridge/registry.json` — full agent+humans+chat_ids. (2) 2 `.cred` files (alice.cred, zoey.cred — verified via ssh). (3) 2 `.token` files (alice.token, zoey.token). (4) 15 `<agent>.bottoken` + 12 `<agent>.chatid` files (per-bot state). (5) 15 `offset.<agent>` files (Telegram `getUpdates` cursors). (6) `bridge.log`. (7) Skynet DB has 2 `mxid` values registered for humans: `@ashley:thenasty.taild9b663.ts.net` (Alice) + `@zoey:thenasty.taild9b663.ts.net` (Zoey) — VERIFIED via `docker logs skynet`. Laura has NO mxid registered yet. | **Data migration:** at cutover, (a) copy registry.json shape to `/var/lib/tg-bridge/registry.json` on t1000, (b) admin-mint fresh tokens for Alice + Zoey (Laura deferred until she has an mxid registered), write to `/var/lib/tg-bridge/{alice,zoey}.token`, (c) delete existing `.cred` files on thenasty AS PART OF CUTOVER, not before (bridge on thenasty stays running until t1000's bridge is verified working), (d) copy offset files if we want zero Telegram-message replay, (e) do NOT copy `.since` — Phase B introduces this, so first startup does initial-sync per human. **Code edit:** none needed — bridge script deletes `.cred` handling. |
| Live service config | (1) Nina's `/home/thenasty/.config/systemd/user/tg-bridge.service` — USER-scoped unit. (2) 15 `<agent>.bottoken` files each holding a live Telegram bot token — these are still valid tokens registered with @BotFather. (3) `matrix_admin_creds` row in Skynet's SQLite (id=1) — holds admin token, homeserver base, admin mxid. VERIFIED. | **Manual:** Bot tokens must migrate cleanly — they're per-bot registered at @BotFather, so as long as we preserve them into `telegram_bot_tokens` (encrypted) OR keep the bridge reading them from bot-token files during cutover, no BotFather work needed. **NOTE:** Nina's registry lists ~15 agents with active humans. Phase B v1 UI is one-identity-one-bot-one-human, but the bridge itself supports multi-human. So the migration is: for the ~15 agents Nina serves today, populate `telegram_bot_tokens` with one row per (agent, primary human). Alice owns most; some rows Nina owns. |
| OS-registered state | Nina's `systemctl --user enable tg-bridge.service` on thenasty. `enable-linger thenasty` is set (bridge stays up across user logout on thenasty). | **Re-register:** on t1000, `sudo systemctl enable tg-bridge.service` (SYSTEM scope, no linger needed). AFTER t1000 bridge is verified working: on thenasty, `systemctl --user disable tg-bridge.service` + `systemctl --user stop tg-bridge.service`. |
| Secrets/env vars | (1) Skynet's admin token (in `matrix_admin_creds.access_token`, FieldCrypto-encrypted, id=1). (2) 15 Telegram bot tokens on thenasty (plaintext files) — need migration. (3) Alice + Zoey Matrix passwords in `<human>.cred` files (plaintext) — must be DELETED (that's the whole security win of Phase B). | **Update:** Skynet reads `matrix_admin_creds` via `getMatrixAdminCreds()` — unchanged. New `telegram_bot_tokens` table gets the 15 bot tokens (or however many the migration script lands). |
| Build artifacts / installed packages | (1) Phase 77's `matrix-admin-client` compiled into `/app/dist/backend/backend/matrix/matrix-admin-client.js` inside the running skynet container — VERIFIED. (2) Docker image `skynet-patched:local` is what's running (VERIFIED via `docker ps`). (3) fleet-substrate bundled at `/app/fleet-substrate/scripts/` inside the container (VERIFIED — has `agent-supervisor.sh` etc.). | **None** — Phase B rebuilds the container with the new fleet-substrate contents (Dockerfile's COPY of `substrate/` picks up the new files automatically per Phase 73 shape). |

**Nothing found in category:** All 5 categories have items. No category is empty.

## Common Pitfalls

### Pitfall 1: Nginx caveat — new route family without matching location blocks

**What goes wrong:** `POST /telegram-bridge/activate` returns 200 with `text/html` (SPA index.html) instead of proxying to backend.

**Why it happens:** `docker/nginx.conf` and `docker/nginx-https.conf` are two separate files (HTTP and HTTPS server blocks) and the SPA-fallback `location /` catches anything without an explicit `location ~ ^/<route>` block. Adding to only one breaks the other.

**How to avoid:** Every new route family gets a `location ~ ^/telegram-bridge(/.*)?$` block in BOTH files, following the exact shape of the existing `/matrix-admin` block (`nginx.conf:153-162`).

**Warning signs:** Post-deploy, frontend crashes on `.map` file loads (SPA fallback is serving `index.html` for something the browser expects to be JSON). Sanity check: `curl -si https://term.example.com/telegram-bridge/nonexistent -X POST` should return 401/404 (backend), NOT 200 text/html.

### Pitfall 2: SYSTEM vs USER systemd unit mismatch with distributor

**What goes wrong:** The distributor fires `systemctl --user restart tg-bridge.service`, but the unit is installed at `/etc/systemd/system/tg-bridge.service` (SYSTEM scope), so systemd returns "Unit tg-bridge.service not found."

**Why it happens:** The existing distributor code hard-codes `--user` (`ssh-push.ts:218`); the existing `agent-supervisor.service` is a USER unit installed under `~/.config/systemd/user/`. If Phase B's tg-bridge is a SYSTEM unit (recommended for the reasons in the Alternatives Considered table), the restart command needs to change.

**How to avoid:** Extend `CatalogEntry` with an optional `unitScope: "user" | "system"` field (default "user" for backward compatibility with `agent-supervisor`), and pass it to a new `restartUnit(channel, unitName, scope)` helper that emits `systemctl [--user] restart <unit>` accordingly. The `restartUserUnit` name should become `restartUnit`. Passing `scope: "system"` may need `sudo` prefix (SSH user must have NOPASSWD sudo — verify per host during rollout).

**Warning signs:** Distributor sweep logs show `__RESTART_FAIL__` with "Unit tg-bridge.service not found" or "Access denied" from `systemctl --user`.

### Pitfall 3: The Skynet host (t1000) is `runsFleetSubstrate:true` but has no SSH credential attached

**What goes wrong:** The distributor's sweep skips the Skynet host itself (VERIFIED via `docker logs skynet 2>&1 | grep 'no credential'` — logs Show `[WARN] fleet_substrate_host_no_credential_id,host:6,hostName:Skynet`). So even though the substrate distributor will push tg-bridge to every OTHER `runsFleetSubstrate:true` host, it won't push to t1000, which is where we need it.

**Why it happens:** Host id 6 ("Skynet") was seeded with `runsFleetSubstrate:true` but its host row has `credentialId=null`. The `list-substrate-hosts.ts:116-125` filter warns and skips such rows.

**How to avoid:** Two options —
1. **Wire up a real SSH credential on host id 6.** The host can SSH to itself (t1000's SSH server accepts key auth from t1000's own ubuntu account via localhost). Add a `~/.ssh/id_ed25519` key, register it as a Skynet SSH credential, attach to the Skynet host row. Then the distributor sweep just works for the self-case. This is the fleet-consistent choice.
2. **Skip the distributor for the local install entirely.** Ship a `tg-bridge-install-on-self.sh` script in `substrate/scripts/` that runs from the Skynet container startup, uses the bind-mounted `/var/lib/tg-bridge/` as a staging dir, and copies bytes to `/usr/local/bin/tg-bridge` + `/etc/systemd/system/tg-bridge.service` via an nsenter-style shell-out to the host (or simpler: relies on a docker post-start hook that runs on t1000 outside the container). This is the "container writes files to bind-mount; host reads files, moves them into place, restarts service" pattern.

**Recommendation:** Option 1 is fleet-consistent (every substrate host is treated the same); Option 2 is simpler for the one-off self case but introduces a special code path. **Alice/Tina to decide during discuss.** Both are viable.

**Warning signs:** Post-deploy, `systemctl status tg-bridge.service` on t1000 shows "Unit tg-bridge.service could not be found." OR the sweep log continues to show `no credential — skipping` for host id 6.

### Pitfall 4: `<human>.cred` file deletion timing during migration

**What goes wrong:** We delete Alice's `.cred` on thenasty BEFORE t1000's bridge is proven working, then the bridge's next 401 finds no `.cred` file, and Alice is silently deaf until manual repair.

**Why it happens:** The migration script naïvely deletes `.cred` files immediately after minting new tokens; but during the cutover window both bridges are running and both may try to `relogin()` on the same token.

**How to avoid:** Explicit sequenced migration:
1. Admin-mint fresh tokens for Alice + Zoey via `loginAsUser`.
2. Write `<human>.token` files to BOTH `/home/thenasty/.config/tg-bridge/` AND `/var/lib/tg-bridge/` on t1000 (so both bridges have valid tokens).
3. Start t1000's bridge; verify it's polling.
4. Stop thenasty's bridge.
5. THEN delete `<human>.cred` files on thenasty.
6. Verify no `.cred` files exist anywhere: `ssh root@100.113.23.63 'ls /home/thenasty/.config/tg-bridge/*.cred 2>/dev/null'` → empty output.

**Warning signs:** A cutover window where "wrist-reachability" goes offline for one of Alice's identities. Test by having Alice DM one of her agents via Telegram right after cutover and confirm receipt.

### Pitfall 5: STT_URL is currently hardcoded in `voice.ts`, not a config value

**What goes wrong:** CONTEXT.md says "STT URL comes from Skynet's existing STT config" but VERIFIED (`grep STT_URL src/backend/database/routes/voice.ts`): the STT URL is a hardcoded `const STT_URL = "http://100.80.122.111:8000/v1/audio/transcriptions"` at `voice.ts:28`. There is NO existing "Skynet STT config" to inherit from.

**Why it happens:** The shape/CONTEXT.md assumed a config key exists because Alice uses voice input; the actual implementation hardcodes it, using a comment `// --- Locked STT endpoint (Nelly-verified live, 2026-07-27) ---`.

**How to avoid:** Phase B has two options:
1. **Add a real config key.** Introduce a `system_config` table (or reuse `matrix_admin_creds`'s pattern with a new singleton table `skynet_service_endpoints` or add rows to some existing `settings`-style table). Migrate `voice.ts` to read from it too. Skynet writes the current value into `/var/lib/tg-bridge/config.env` at startup so the bridge reads it. This is the "consistent" answer — both voice.ts and the bridge share the same source of truth.
2. **Extract the constant into a shared module.** Move `STT_URL` to `src/backend/config/service-endpoints.ts` (or similar) as a plain TS const; import from voice.ts; also write to `config.env` at startup. This is the fast answer — no DB table, just a shared module.

Recommendation: **Option 2 for Phase B** (fast, honors the "read from same source" spirit), with a note that if Alice ever wants runtime-configurable STT/TTS endpoints, the migration to Option 1 is a small follow-up. **Alice to confirm during discuss** — this is a real gray area that CONTEXT.md's "existing STT config" language assumed away.

**Warning signs:** Bridge script has `STT_URL=http://100.80.122.111:8000/v1/audio/transcriptions` copied verbatim from Nina's bridge, which is the pre-Phase-B state and violates the "no hardcoded IPs" requirement.

### Pitfall 6: Matrix homeserver base URL — `matrix_admin_creds.homeserverBase` is admin-specific

**What goes wrong:** Bridge reads `matrix_admin_creds.homeserverBase` to get the Matrix root URL, but this credential row is only populated once Phase 77's admin ingestion has run. On a fresh Skynet install without admin ingested, the bridge has no config to read.

**Why it happens:** The `matrix_admin_creds` table is a singleton for admin creds specifically. A "plain Matrix homeserver URL that any Matrix consumer reads" concept doesn't exist in Skynet today (VERIFIED via `grep -rn "homeserver" src/backend`).

**How to avoid:** Two options:
1. **Reuse `matrix_admin_creds.homeserverBase`** for both admin and bridge purposes. Semantically fine — both are Skynet's connection to the relay. If admin isn't ingested, the bridge can't operate (which is the correct behavior — Phase B depends on Phase 77 for token minting anyway, so if admin creds are missing, wrist-reachability is impossible).
2. **Add a plain `matrix_homeserver_url` value to a shared config table** that both the admin client and the bridge read from. Semantically cleaner (base URL is not a credential), but adds a new config surface for one value.

Recommendation: **Option 1** — Phase B has a hard dependency on Phase 77's admin foundation anyway, so `matrix_admin_creds` being populated is a Phase B precondition. Reusing `.homeserverBase` avoids inventing new config surface. Document explicitly that "bridge cannot start until Phase 77's admin ingestion has run" as a Phase B precondition.

### Pitfall 7: Telegram bot-token registry.json shape drift

**What goes wrong:** Nina's `registry.json` (VERIFIED shape via SSH read) has agents indexed by name string with a `bot_token` string embedded. Phase B moves bot tokens into `telegram_bot_tokens` (FieldCrypto-encrypted). But the bridge script still reads `registry.json` to know which agents exist. So the on-disk shape has to change (drop `bot_token` from registry.json — that field now lives in encrypted DB) AND the bridge reads bot_token from a different place.

**Why it happens:** Two sources of truth for the same fact (which bot serves which agent) — DB (encrypted) and disk (registry.json).

**How to avoid:** Skynet writes both files from the DB — `registry.json` (public: name + mxid + humans structure) AND per-agent `<agent>.bottoken` files (private: 0600, plaintext token file). The bridge reads `registry.json` for the shape, and reads `<agent>.bottoken` for the actual token (matching Nina's existing convention of `<agent>.bottoken` files — VERIFIED via SSH ls). No `bot_token` field in registry.json. On any DB write, Skynet rewrites both. When a bot is disconnected, Skynet deletes the `<agent>.bottoken` file AND clears the DB row AND rewrites registry.json AND triggers restart.

**Warning signs:** Bridge starts but finds `bot_token: null` for every agent — Skynet forgot to write the `.bottoken` files.

### Pitfall 8: `matrix-admin-client.loginAsUser` tokens don't rotate on the admin's `/logout/all`

**What goes wrong:** If the Skynet admin ever calls `/_matrix/client/v3/logout/all` for the `@skynet-admin` account (or Nicole rotates the admin's password), ALL tokens minted via `loginAsUser` become invalid simultaneously — including every human `<human>.token` file for every identity.

**Why it happens:** VERIFIED via [Synapse admin API docs](https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html) (§ Login as a user): *"The token will expire if the admin user calls /logout/all from any of their devices, but the token will not expire if the target user does the same."*

**How to avoid:** (a) never call `/logout/all` for `@skynet-admin` (add a comment to the admin creds ingestion runbook); (b) if the admin token itself dies, Skynet needs to re-mint tokens for every human that has a `<human>.token` file. This is a low-probability event but plan for it: the reconcile pass (which runs on bridge-401 signals) should be able to re-mint on demand. No polling needed — Q6 confirms tokens don't expire by TTL.

## Code Examples

### Q1 answer: Distributor restart mechanism (VERIFIED, canonical)

```typescript
// Source: src/backend/distributor/ssh-push.ts:211-242
export async function restartUserUnit(
  channel: SshChannel,
  unitName: string,
): Promise<{ ok: true } | { ok: false; errorMessage: string }> {
  const escapedUnit = shellSingleQuote(unitName);
  const cmd = `systemctl --user restart ${escapedUnit} && echo __RESTART_OK__ || echo __RESTART_FAIL__`;
  const raw = await channel.exec(cmd);
  // ...
}
```

And the catalog wiring:
```typescript
// Source: src/backend/distributor/catalog.ts:186-191
{
  slug: "agent-supervisor",
  bundledPath: "/app/fleet-substrate/scripts/agent-supervisor.sh",
  installPath: "~/.local/bin/agent-supervisor",
  restartHook: "agent-supervisor.service",
},
```

**Phase B additions to catalog.ts:**
```typescript
// NEW rows (recommended)
{
  slug: "tg-bridge",
  bundledPath: "/app/fleet-substrate/scripts/tg-bridge.sh",
  installPath: "/usr/local/bin/tg-bridge",   // SYSTEM path (not ~/.local/bin/)
  restartHook: "tg-bridge.service",
  unitScope: "system",                        // NEW field (see Pitfall 2)
},
{
  slug: "tg-bridge-service-unit",
  bundledPath: "/app/fleet-substrate/user-onboarding/tg-bridge.service",
  installPath: "/etc/systemd/system/tg-bridge.service",   // SYSTEM path
  restartHook: "tg-bridge.service",
  unitScope: "system",
},
```

### Q2 answer: STT_URL is hardcoded, not a config

```typescript
// Source: src/backend/database/routes/voice.ts:27-28 (VERIFIED)
// --- Locked STT endpoint (Nelly-verified live, 2026-07-27) ---
const STT_URL = "http://100.80.122.111:8000/v1/audio/transcriptions";
```

**No existing config key.** See Pitfall 5 for the two options.

### Q3 answer: Matrix homeserver base URL — only in `matrix_admin_creds`

```typescript
// Source: src/backend/matrix/matrix-admin-creds-store.ts:37-42, 91-96 (VERIFIED)
export interface MatrixAdminCreds {
  homeserverBase: string;   // ← the URL we need
  userId: string;
  accessToken: string;
  password: string;
}
// ...
return {
  homeserverBase: row.homeserverBase,
  // ...
};
```

Recommendation: reuse this field (see Pitfall 6).

### Q4 answer: `runsFleetSubstrate` state on t1000

```
# Source: sudo docker logs skynet (VERIFIED live 2026-09-06)
[12:53:19 PM] [WARN] [🚀] Fleet-substrate: substrate host has no credential — skipping
  [op:fleet_substrate_host_no_credential_id, host:6, hostName:Skynet]
```

t1000 IS marked `runsFleetSubstrate:true` (host id 6, name "Skynet"), but has `credentialId=null` so the sweep skips it. See Pitfall 3 for the two remediation paths.

### Q5 answer: Docker bind-mount pattern (VERIFIED at /opt/skynet/docker-compose.yml)

```yaml
# Source: /opt/skynet/docker-compose.yml (VERIFIED live 2026-09-06)
services:
  skynet:
    volumes:
      - skynet-data:/app/data
      - /opt/skynet/console-forward-logs:/var/log/skynet/console-forward
      - /opt/skynet/stt-recordings:/app/stt-recordings
      # Phase 70: branding — the reference bind-mount pattern from CONTEXT.md
      - type: bind
        source: /opt/skynet/branding
        target: /etc/skynet/branding
        read_only: true
        bind:
          create_host_path: true
```

**Phase B adds:**
```yaml
      # Phase 79: tg-bridge substrate — bind-mount for registry, tokens, cursors.
      # READ-WRITE (Skynet writes registry.json and <human>.token files;
      # bridge writes <human>.since cursor files, offset.<agent>, and bridge.log).
      - type: bind
        source: /var/lib/tg-bridge
        target: /var/lib/tg-bridge
        # NOT read_only — Skynet writes here from the container
        bind:
          create_host_path: true
```

**Path identity (`source == target`):** simplifies mental model — the same path inside the container is the same path on the host, so log lines about `/var/lib/tg-bridge/` are unambiguous. Existing bind-mounts use different paths (`/opt/skynet/branding` → `/etc/skynet/branding`) but that's a choice, not a constraint.

### Q6 answer: Synapse `loginAsUser` token lifetime

**VERIFIED** via [Synapse admin API docs — Login as a user](https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html):

> By default, tokens created via this endpoint "do not expire." An optional `valid_until_ms` field can be specified in the request body as an integer timestamp that specifies when the token should expire.
>
> The token will expire if the **admin** user calls `/logout/all` from any of their devices, but the token will _not_ expire if the target user does the same.

**Impact on Phase B design:** Skynet's reconcile pass does NOT need to poll `/whoami` on stored tokens — they don't expire on their own. Purely reactive to bridge-side 401s is sufficient. The bridge (`bridge.sh`'s `mx_send_event`) already logs 401 responses (see `bridge.sh:66` `[ "$attempt" = "1" ] && relogin "$h"` in current code — this whole branch gets deleted in Phase B); Phase B replaces `relogin` with "log LOUD, keep the row broken until the reconcile pass detects it and re-mints via admin." The reconcile pass can be as simple as "on any bridge-emitted 401 log line, admin-mint fresh for that human, write the new token file, restart bridge."

### Q7 answer: `/var/lib/tg-bridge/` path is FREE on t1000

```
# Source: ls /var/lib/tg-bridge (VERIFIED live 2026-09-06)
ls: cannot access '/var/lib/tg-bridge': No such file or directory
```

Path is free. The parent `/var/lib/` exists as normal (owned by root:root, 755). Recommended perms for `/var/lib/tg-bridge/`: 750 root:root (readable by bridge running as root via SYSTEM systemd unit; the Docker daemon on t1000 runs as root so the container can bind-mount rw).

### Q8 answer: Ground-truth reading of Nina's bridge.sh (VERIFIED via SSH)

Key findings from the 344-line script:

1. **`since` cursor is in-memory only.** `mx_sync_for_human` (bridge.sh:~208) starts each restart with `curl "$BASE/sync?timeout=0"` which returns all pending state including a fresh `next_batch`. The comment at bridge.sh:266-274 explicitly documents this as *"the whole reboot-replay flood into Telegram"* (~1000 events, ~200 outbound per-agent after filtering).

2. **Hardcoded `ROOT=http://100.113.23.63:8008`** at bridge.sh:29 (also `BASE=$ROOT/_matrix/client/v3` at bridge.sh:30). Must become config reads.

3. **Hardcoded `STT=http://100.80.122.111:8000/v1/audio/transcriptions`** at bridge.sh:33. Must become config reads.

4. **`<human>.cred` files read at bridge.sh:42** (`acred()` helper). Used by `relogin()` at bridge.sh:45-56 which POSTs `{type:"m.login.password", password:$pw}` on any 401. **Entire code path deleted in Phase B.**

5. **`<human>.token` files read at bridge.sh:42** (`atok()` helper). Used everywhere for Matrix auth. This helper stays; the source of the token changes from "bridge's `relogin()` writes it" to "Skynet writes it via admin mint."

6. **registry.json shape (VERIFIED via `ssh root@100.113.23.63 cat .../registry.json | jq .agents[0]`):**
   ```json
   {
     "name": "alexander",
     "mxid": "@alexander:thenasty.taild9b663.ts.net",
     "bot_token": null,                    // ← moves out of registry.json in Phase B (see Pitfall 7)
     "humans": [{
       "name": "alice",
       "mxid": "@ashley:thenasty.taild9b663.ts.net",
       "chat_id": null,                    // ← nullable until first /start
       "room": "!rARjoVOsdNFihTxNth:thenasty.taild9b663.ts.net",
       "cred": "alice.cred",              // ← REMOVED in Phase B
       "token": "alice.token"             // ← STAYS
     }]
   }
   ```

7. **Current systemd USER unit at `/home/thenasty/.config/systemd/user/tg-bridge.service` (VERIFIED via SSH):**
   ```ini
   [Unit]
   Description=Telegram <-> Matrix bridge (per-agent, Apple Watch access to the fleet)
   After=network-online.target
   [Service]
   Type=simple
   ExecStart=/bin/bash /home/thenasty/.config/tg-bridge/bridge.sh
   Restart=always
   RestartSec=5
   KillMode=mixed
   [Install]
   WantedBy=default.target
   ```
   Phase B's version is SYSTEM scope (see Q1 recommendation), so `[Install] WantedBy=multi-user.target`, `ExecStart=/usr/local/bin/tg-bridge`, `After=network-online.target` unchanged, `Type=simple` / `Restart=always` / `RestartSec=5` / `KillMode=mixed` unchanged.

### Q9 answer: `matrix-admin-client.loginAsUser` signature

```typescript
// Source: src/backend/matrix/matrix-admin-client.ts:127-171 (VERIFIED)
export async function loginAsUser(
  mxid: string,
  validUntilMs?: number,
): Promise<LoginAsUserOk | AdminErr> {
  // POST /_synapse/admin/v1/users/{mxid}/login
  // With admin's own access token in Authorization: Bearer header
  // Returns { ok: true, accessToken: string } | { ok: false, status, error }
}

export type LoginAsUserOk = AdminOk<{ accessToken: string }>;
```

**Rate limits:** none documented (Phase 77 research verified live against Synapse 1.157.2 with no observed limits). **Caching:** no — every call mints a fresh token via `POST`. Phase B should NOT call `loginAsUser` on every route — call it once per (human, activation), write to `<human>.token`, and reuse from disk until a 401 forces a re-mint.

**Gotchas:** the token has `admin`'s device-lock semantics (see Q6). If `.homeserverBase` on `matrix_admin_creds` is wrong, the URL will be malformed. `mxid` is URL-encoded (`encodeURIComponent`) at line 136 — pass the raw `@name:host` form, not pre-encoded.

### Q10 answer: Identity modal tab pattern (VERIFIED)

The tab shape is 100% inferrable from `IdentityModal.tsx:308-319` (NAV_SECTIONS definitions) + `IdentityModal.tsx:2144-2186` (TabsContent slots) + `IdentityModal.tsx:2198-2228` (bottom icon-bar renderer):

```typescript
// Source: src/ui/features/pretty-view/IdentityModal.tsx:314-319 (VERIFIED)
const NAV_SECTIONS_IDENTITY = [
  { value: "identity", label: "Identity file", Icon: User },
  { value: "identity-wakeups", label: "Wakeups", Icon: AlarmClock },
  { value: "handoff", label: "Handoff", Icon: Handshake },
] as const;

// Phase B adds a fourth entry (VERIFIED lucide-react is the icon lib in use):
// { value: "telegram", label: "Telegram", Icon: Send },
```

**TabsContent slot pattern (VERIFIED at IdentityModal.tsx:2177-2186):**
```tsx
<TabsContent
  value="handoff"
  className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
>
  <HandoffTab
    state={handoffState}
    isCoordinator={identity.coordinator}
    onSave={updateHandoff}
  />
</TabsContent>
```

**Phase B adds (recommended shape):**
```tsx
<TabsContent
  value="telegram"
  className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
>
  <TelegramTab
    state={telegramState}           // {status: "loading" | "unconfigured" | "pending-start" | "connected" | "error", …}
    hue={hue}
    identityKey={identity.key}
    humanUserId={/* current user's ID */}
    onActivate={activateTelegram}   // POST /telegram-bridge/activate
    onDisconnect={disconnectTelegram}
    onRetry={retryBridgeRestart}
  />
</TabsContent>
```

**Bottom icon-bar auto-updates** — it iterates `NAV_SECTIONS.map(...)` (IdentityModal.tsx:2198), so adding to `NAV_SECTIONS_IDENTITY` auto-renders the new pill. No changes needed to the icon-bar rendering block.

**Icon options (all VERIFIED as already-imported or trivially-addable lucide-react):**
- `Send` (paper airplane) — recommended; matches Telegram's brand affordance
- `MessageCircle` — generic
- `Bell` — evokes notifications

### Q11 answer: Telegram `/getMe` for paste-time validation

**URL format:** `https://api.telegram.org/bot<token>/getMe` (VERIFIED via Telegram Bot API docs)

**Response on valid token:**
```json
{
  "ok": true,
  "result": {
    "id": 8954468254,
    "is_bot": true,
    "first_name": "Angel",
    "username": "angel_skynet_bot",
    "can_join_groups": true,
    "supports_inline_queries": false
  }
}
```

**Response on invalid token:**
```json
{
  "ok": false,
  "error_code": 401,
  "description": "Unauthorized"
}
```

**Backend proxy pattern (recommended):**
```typescript
// src/backend/telegram-bridge/telegram-getme-proxy.ts (NEW)
export async function validateBotToken(token: string): Promise<
  | { ok: true; botUsername: string; botId: number; firstName: string }
  | { ok: false; error: string }
> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getMe`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await response.json() as { ok: boolean; result?: { id: number; username?: string; first_name?: string }; description?: string };
    if (!data.ok || !data.result) {
      return { ok: false, error: data.description ?? "Telegram rejected token" };
    }
    if (!data.result.username) {
      return { ok: false, error: "Bot has no username set (create one via @BotFather)" };
    }
    return { ok: true, botUsername: data.result.username, botId: data.result.id, firstName: data.result.first_name ?? "" };
  } catch (err) {
    clearTimeout(timeoutId);
    return { ok: false, error: "Telegram unreachable" };
  }
}
```

**Frontend flow:** paste-time → POST `/telegram-bridge/validate {token}` → on `ok:true`, show "@botusername detected" preview + "Confirm" button → on Confirm, POST `/telegram-bridge/activate {identityKey, humanUserId, token}` → backend writes to DB + writes bridge files + restarts bridge → tab transitions to "waiting for /start" state.

## New Files Phase B Creates

**Substrate (fleet-shipped):**
- `substrate/scripts/tg-bridge.sh` — the evolved bridge (based on Nina's 344 lines, minus `.cred`/`relogin` code, plus cursor persistence, plus config.env sourcing)
- `substrate/user-onboarding/tg-bridge.service` — SYSTEM systemd unit

**Backend:**
- `src/backend/telegram-bridge/telegram-bridge-routes.ts` — Express routes
- `src/backend/telegram-bridge/telegram-bridge-routes.test.ts`
- `src/backend/telegram-bridge/registry-writer.ts` — Node module that writes registry.json + <human>.token + config.env to `/var/lib/tg-bridge/`
- `src/backend/telegram-bridge/registry-writer.test.ts`
- `src/backend/telegram-bridge/telegram-getme-proxy.ts` — backend proxy for token validation
- `src/backend/telegram-bridge/telegram-getme-proxy.test.ts`
- `src/backend/telegram-bridge/telegram-bot-tokens-store.ts` — FieldCrypto CRUD (mirrors `matrix-admin-creds-store.ts`)
- `src/backend/telegram-bridge/telegram-bot-tokens-store.test.ts`
- (optional) `src/backend/telegram-bridge/bridge-restart-trigger.ts` — the "how does the container tell the bridge to restart" glue (SSH via distributor, or bind-mount sentinel — depends on Q4 remediation choice)

**Frontend:**
- `src/ui/features/pretty-view/TelegramTab.tsx` — the new tab (mirrors `HandoffTab.tsx`)
- `src/ui/features/pretty-view/TelegramTab.test.tsx`
- `src/ui/api/telegram-bridge-api.ts` — frontend fetch wrappers

**One-shot migration script (not in main tree — planner decides):**
- `scripts/phase79-migrate-thenasty-to-t1000.sh` OR a Skynet startup one-shot in the container that runs once per install lifetime — mints tokens for Alice/Zoey, writes bridge files, later phase deletes .cred on thenasty

## Existing Files Phase B Modifies

**Schema + storage:**
- `src/backend/database/db/schema.ts` — add `telegramBotTokens` sqliteTable export (mirrors matrixAdminCreds at lines 680-692); add `mxid` reference note (already exists — verified)
- `src/backend/database/db/index.ts` — add `CREATE TABLE telegram_bot_tokens (…)` at boot (mirrors matrix_admin_creds create at ~line 878); add `addColumnIfNotExists` calls for any new columns
- `src/backend/utils/field-crypto.ts` — add `telegram_bot_tokens: new Set(["bot_token"])` to the `ENCRYPTED_FIELDS` map (line 17-46 area)

**Distributor:**
- `src/backend/distributor/catalog.ts` — add 2 new entries (tg-bridge.sh, tg-bridge.service) with SYSTEM scope
- `src/backend/distributor/catalog.ts` (extend interface) — add optional `unitScope: "user" | "system"` field to `CatalogEntry`
- `src/backend/distributor/ssh-push.ts` — rename `restartUserUnit` → `restartUnit`, take scope arg, emit `sudo systemctl restart <unit>` for system-scope (or `systemctl --user restart <unit>` for user-scope)
- `src/backend/distributor/sweep-logic.ts` — thread the `unitScope` through the decision passed to `restartUnit`
- `src/backend/distributor/run-sweep.ts` — thread the scope
- All associated `.test.ts` files

**Server startup:**
- `src/backend/starter.ts` — mount `/telegram-bridge` router alongside `/matrix-admin`; potentially fire a "write config.env + registry.json to /var/lib/tg-bridge/ on startup" one-shot so the bridge has valid config even on first boot
- `src/backend/starter.ts` (identity-birth-orchestrator extension) — if the shape says agent creation also implies "register agent in registry.json," extend the birth orchestrator; otherwise defer

**Nginx (CLAUDE.md caveat — BOTH files):**
- `docker/nginx.conf` — add `location ~ ^/telegram-bridge(/.*)?$` block (mirror `/matrix-admin` at line 153-162)
- `docker/nginx-https.conf` — same block (mirror `/matrix-admin` at line 164-173)

**Docker (deploy-side artifact, orchestrator-owned per fleet rule):**
- `/opt/skynet/docker-compose.yml` — add `/var/lib/tg-bridge/` bind-mount to the `skynet` service volumes

**Frontend integration:**
- `src/ui/features/pretty-view/IdentityModal.tsx` —
  - Line 2 (imports): add `Send` to the lucide-react import list
  - Line 314-319 (NAV_SECTIONS_IDENTITY): add `{ value: "telegram", label: "Telegram", Icon: Send }` as fourth entry
  - Line ~2186 (TabsContent slots): add a new `<TabsContent value="telegram">` block after `<TabsContent value="handoff">`
  - Import `TelegramTab` at top

## Runtime State Inventory

See § Runtime State Inventory above (already included in full).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bash 5 (host) | tg-bridge script | ✓ | 5.2.x | — |
| jq (host) | tg-bridge script JSON parsing | ✓ | 1.6+ | — |
| curl (host) | tg-bridge script HTTP calls | ✓ | 8.x | — |
| systemd 250+ (host) | SYSTEM systemd unit | ✓ | 255 | — |
| Node 22.12+ (container) | Backend routes | ✓ | 22.x+ (verified via docker exec) | — |
| `matrix_admin_creds` row populated (Skynet DB) | Bridge token minting | ✓ | id=1 ingested per Phase 77 (verified via docker logs) | — |
| `users.mxid` populated for Alice + Zoey | Human identification for bridge | ✓ (both) | Alice: `@ashley:thenasty.taild9b663.ts.net`; Zoey: `@zoey:thenasty.taild9b663.ts.net`. Laura: NOT populated. | Laura's Telegram tab shows "no mxid — ask admin to register" until Phase 77's `/users/:id/mxid` route is called for her |
| `inotify-tools` (host) | Only if restart-trigger uses sentinel-file+inotifywait | ✗ (not installed on t1000) | — | `sudo apt install -y inotify-tools` (package exists per apt-cache) — OR skip and use SSH-based restart (Q1 recommendation) |
| SSH credential attached to host id 6 (Skynet self-host) | Distributor pushes tg-bridge to t1000 via SSH sweep | ✗ | — | See Pitfall 3 for 2 options: wire up SSH credential OR use bind-mount+startup-script install |
| Egress to `api.telegram.org` (from container) | Telegram getMe proxy + tg_send_text | ✓ (assumed — t1000 has full public egress) | — | If blocked, backend proxy fails, activation UI shows error |
| Egress to `100.113.23.63:8008` (from container) | Synapse admin API calls | ✓ (verified via `docker logs skynet` — Phase 77 admin ingestion succeeded) | Synapse 1.157.2 | — |

**Missing dependencies with no fallback:**
- SSH credential on host id 6 for the "distributor pushes to Skynet itself" path — SEE Pitfall 3

**Missing dependencies with fallback:**
- `inotify-tools` — only needed if restart-trigger uses sentinel-file approach; SSH-based restart (Q1 recommendation) needs neither
- Laura's `users.mxid` — Phase 77's endpoint exists, Laura just hasn't been registered yet; running that endpoint once unblocks Laura's Telegram tab

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest 3.x (verified in tree at `package.json`) |
| Config file | `vitest.config.*.ts` — several exist for backend/ui/electron |
| Quick run command | `npx vitest run src/backend/telegram-bridge --reporter=basic` |
| Full suite command | `npm test` (or `npx vitest run`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TGB-01 | Bridge + unit ship via distributor | unit | `npx vitest run src/backend/distributor/catalog.test.ts` (extend existing test with new rows assertion) | ❌ Wave 0 |
| TGB-03 | Bridge reads STT + Matrix URL from config, not hardcoded | integration | `bash -n substrate/scripts/tg-bridge.sh && grep -c '100\.113\.23\.63\|100\.80\.122\.111' substrate/scripts/tg-bridge.sh` → expect 0 | ❌ Wave 0 (a lint test in a new script) |
| TGB-04 | Matrix cursor persists to disk per human | integration | Custom shell test: start bridge, write to `<human>.since`, kill+restart, assert cursor loaded | ❌ Wave 0 |
| TGB-05 | Identity modal Telegram tab renders + activates | unit (react-testing-library) | `npx vitest run src/ui/features/pretty-view/TelegramTab.test.tsx` | ❌ Wave 0 |
| TGB-06 | Bot tokens FieldCrypto-encrypted | unit | `npx vitest run src/backend/telegram-bridge/telegram-bot-tokens-store.test.ts` — assert plaintext token never appears in DB row via encrypted column | ❌ Wave 0 |
| TGB-07 | Zero .cred files post-migration | integration | Migration script test + `find /var/lib/tg-bridge -name '*.cred' \| wc -l` → expect 0 | ❌ Wave 0 |
| TGB-08 | Container→bridge restart wire works | integration | Fire distributor sweep on t1000, assert `systemctl status tg-bridge.service` shows recent restart | ❌ Wave 0 |
| TGB-09 | Disconnect button returns to paste-state | unit (react-testing-library) | `npx vitest run src/ui/features/pretty-view/TelegramTab.test.tsx` — flow test | ❌ Wave 0 |
| TGB-11 | No automatic DM on failure | code inspection | `grep -c "sendMessage\|admin_notify" src/backend/telegram-bridge/*.ts` in bridge-restart error paths → expect 0 | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npx vitest run src/backend/telegram-bridge --reporter=basic` (should be < 15s)
- **Per wave merge:** `npx vitest run` (backend + frontend subsets)
- **Phase gate:** Full suite green before `/gsd-verify-work`; live smoke tests against t1000 for cursor-persistence and disconnect-flow

### Wave 0 Gaps

- [ ] All 9 new backend test files (`*.test.ts` alongside each new module)
- [ ] `TelegramTab.test.tsx` fixture for identity-modal props
- [ ] Vitest config coverage for `src/backend/telegram-bridge/` (may auto-pick-up via existing config globs)
- [ ] Integration test harness for bridge script — bash+curl testing pattern from Phase 75/77 (existing pattern)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Reuse `AuthManager.createAdminMiddleware()`; bot-token access requires authenticated user |
| V3 Session Management | yes | Existing JWT session for the modal user |
| V4 Access Control | yes | Row-level auth: user can only activate/disconnect Telegram for identities their `humanUserId` owns; admin-gate for restart |
| V5 Input Validation | yes | Bot token: match `^[0-9]{9,10}:[A-Za-z0-9_-]{35}$` before proxy call; identityKey: existing validation pattern; mxid: `^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$` (from Phase 77) |
| V6 Cryptography | yes | FieldCrypto for `botTokenEncrypted` — do NOT hand-roll; reuse `matrix_admin_creds` pattern verbatim |
| V7 Error Handling | yes | Never leak bot token, Matrix token, or Telegram response bodies in error responses — return `{error: <stable-code>}` shape mirroring `matrix-admin-client.ts` |
| V8 Data Protection | yes | Bot tokens: encrypted at rest (FieldCrypto), never logged (log ops names, not values); `<human>.token` files: 0600, root:root, on bind-mount readable only by bridge |

### Known Threat Patterns for {node backend + bash bridge + Docker + bind-mount}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Bot token leakage in logs | Information Disclosure | Log operation names only; log `{botUsername}` not `{botToken}`; use structured logger `authLogger.info(op, meta)` |
| CSRF on `/telegram-bridge/activate` | Tampering | Existing session cookie / JWT — same middleware as `/matrix-admin` |
| Token stuffing via bot-token brute force | Denial-of-Service | Rate-limit the `/telegram-bridge/validate` endpoint (100/hr per user); Telegram itself rate-limits `/getMe` at their edge |
| Path traversal in `<human>.token` filename | Tampering | Whitelist human_name against known-good mxid regex before constructing filename; never concat unsanitized user input into paths |
| Malicious identityKey → cross-identity token leak | Elevation of Privilege | Every route checks the authenticated user's ownership of the identity (existing pattern; identity-birth-orchestrator has precedent) |
| Bind-mount write-race with bridge reads | Tampering | Registry-writer uses atomic write (write to `.tmp`, `fs.rename` — POSIX atomic on same filesystem); bridge reads full-file `cat` (atomic-visible via inode) |
| Container escape via bind-mount | Elevation of Privilege | Bind-mount is read-write from container, but `/var/lib/tg-bridge/` is a fresh path (not a system-critical dir); container runs as node:node UID inside → bind-mount UID mapping is a Docker platform concern; document to run bridge as root:root outside container (systemd SYSTEM unit runs as root) |
| Telegram bot token as an OAuth-equivalent secret | Information Disclosure | Backend proxy pattern: browser never touches token; token is only ever in Skynet DB (encrypted) or bridge files (0600 on host); wire in transit is TLS |
| Synapse admin `/logout/all` invalidates every human token | Denial-of-Service | Runbook must forbid `/logout/all` on the admin account (see Pitfall 8) |

## Sources

### Primary (HIGH confidence)

- **Live codebase (VERIFIED):**
  - `src/backend/distributor/catalog.ts` — restart-hook pattern for agent-supervisor
  - `src/backend/distributor/ssh-push.ts:211-242` — the exact `systemctl --user restart` command
  - `src/backend/distributor/sweep-logic.ts` — decision flow that routes bytes-changed → restart
  - `src/backend/matrix/matrix-admin-client.ts:127-171` — `loginAsUser` signature and semantics
  - `src/backend/matrix/matrix-admin-creds-store.ts:64-176` — FieldCrypto singleton pattern (verbatim template for tg tokens store)
  - `src/backend/database/db/schema.ts:147, 680-692, 871-875` — hosts.runsFleetSubstrate; matrixAdminCreds; users.mxid
  - `src/backend/database/routes/voice.ts:27-28` — STT_URL hardcoded (VERIFIED)
  - `src/backend/utils/field-crypto.ts:17-50` — ENCRYPTED_FIELDS registry
  - `src/backend/distributor/list-substrate-hosts.ts:70-211` — substrate host enumeration with credential-required guard
  - `src/ui/features/pretty-view/IdentityModal.tsx:2, 308-319, 2144-2228` — tab pattern + NAV_SECTIONS + bottom icon-bar renderer
  - `src/ui/features/pretty-view/HandoffTab.tsx:1-200` — closest tab-shape reference
  - `substrate/scripts/agent-supervisor.sh:26-707` — the sole existing substrate script with a restart hook
  - `substrate/skills/agent-relay/recv.sh:102, 235` — Matrix cursor persistence pattern
  - `substrate/user-onboarding/agent-supervisor.service` — reference systemd unit shape
  - `/opt/skynet/docker-compose.yml` — the LIVE docker-compose on t1000 (VERIFIED via cat)
  - `docker/nginx.conf:142-162` and `docker/nginx-https.conf:153-173` — the /users and /matrix-admin location-block precedents
- **Live systems (VERIFIED):**
  - Skynet container logs (via `sudo docker logs skynet`) — confirmed Alice + Zoey mxids registered; confirmed host id 6 Skynet is `runsFleetSubstrate:true` but skipped for `no credential`; confirmed matrix-admin creds ingested
  - `ssh root@100.113.23.63` — read Nina's live bridge.sh (344 lines), registry.json (~15 agents), systemd USER unit, `.cred` file existence (2 files: alice + zoey)
  - `command -v jq curl bash` on t1000 host — all present; `inotifywait` NOT present but apt-installable
  - `sudo docker exec skynet` — Node 22 present; jq + curl ABSENT in container (important for the container-side design)
  - `ls /var/lib/tg-bridge` — path FREE on t1000
- **Documentation (VERIFIED via WebFetch):**
  - [Synapse admin API — Login as a user](https://element-hq.github.io/synapse/latest/admin_api/user_admin_api.html) — admin-minted tokens don't expire by default; admin `/logout/all` invalidates them
  - [Telegram Bot API — getMe](https://core.telegram.org/bots/api#getme) — exact endpoint shape and error format

### Secondary (MEDIUM confidence)

- `.planning/phases/77-.../77-RESEARCH.md` — Phase 77's own research (specifically the `valid_until_ms` and admin foundation info; validated against source)
- `.planning/phases/77-.../77-CONTEXT.md` — Phase 77 decisions that Phase B builds on

### Tertiary (LOW confidence)

- None. Every claim in this document is either VERIFIED against live code/live systems or CITED to a specific URL.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Container has public egress to `api.telegram.org` (443). Not directly tested this session — inferred from t1000 having full outbound (verified via successful Synapse HTTP call which is public tailnet). | Standard Stack / Telegram getMe | Backend proxy fails; activation UI shows "Telegram unreachable" — reversible: sanity check with `docker exec skynet node -e "fetch('https://api.telegram.org/bot0:0/getMe').then(r=>r.text()).then(console.log)"` |
| A2 | The Skynet ubuntu user on t1000 has NOPASSWD sudo (needed if we choose SYSTEM systemd unit + SSH-based restart). Not verified. | Pitfall 2 | `systemctl restart` via SSH fails with "must be root"; fallback: use USER systemd unit + `--user` (same as agent-supervisor), OR reconfigure sudoers on t1000, OR use bind-mount sentinel restart |
| A3 | Skynet writes to `/var/lib/tg-bridge/` need the container to run as root, OR need UID mapping so node:node inside the container can write to the bind-mounted host directory. Docker's bind-mount UID handling is platform-dependent. Not verified. | Pitfall in code examples | If writes fail with EACCES, either chown the host dir to match container UID OR run the container as root; concrete verification: `docker exec skynet node -e "fs.writeFileSync('/var/lib/tg-bridge/probe', 'x')"` post-mount |
| A4 | Nina's ~15 active bots can migrate to Phase B without human intervention beyond the /start bootstrap. Assumes: (a) bot tokens are portable (they are — a bot token is an API key, not tied to a host); (b) the DM rooms Matrix-side don't need re-creation; (c) Telegram will accept new getUpdates calls from the new t1000-bridge (they will — Telegram doesn't rate-limit by source IP for bot API). Not tested. | Migration plan | If any bot's getUpdates race condition drops messages during cutover, we have offset files to resume from — mitigate by copying offset files to t1000 before starting the new bridge |
| A5 | The `identityKey` (pk of `telegram_bot_tokens`) matches whatever concept Skynet already uses for "identity" — likely the folder-name slug from Phase 68 (identities are folders on disk). Not directly verified. | New table schema | If Skynet's identity concept has an id-column, use that instead of a text slug; planner call during implementation |
| A6 | Laura's mxid must be registered via Phase 77's `/users/:id/mxid` endpoint before her Telegram tab is functional. Laura currently has no mxid in Skynet's DB (verified — only Alice + Zoey visible). Phase B does NOT block on Laura's registration but her tab will show "no mxid" until it happens. | Environment availability | Laura's Telegram tab is inert until run: `curl -X POST /users/<laura-id>/mxid {mxid:"@laura:..."}`. Not blocking Phase B. |
| A7 | The bridge's per-agent `<agent>.bottoken` file convention (Nina's) is preserved in Phase B for the bridge-side; Skynet writes these files at activation-time, deletes at disconnect-time. Alternative: bridge could read tokens straight from `registry.json` (Skynet writes them there decrypted). Verified: Nina's `bridge.sh:203` calls `tg_poller "$name" "$tok"` where `$tok` comes from `jq -r '.agents[] | .bot_token' registry.json`. So today the token IS in registry.json. Phase B has to decide: (a) keep it in registry.json (decrypted-on-disk, but bind-mount is 750 so only bridge reads it), or (b) split into `<agent>.bottoken` files. (a) matches Nina's exact current shape; (b) is more granular but requires more file management. **Assumption:** we pick (a) for minimum churn. | Pitfall 7 | If we pick (b), the bridge script needs an edit to `tg_poller` invocation to read from files instead of registry.json |
| A8 | The frontend modal's activeTab state (line 257) will accept a new value "telegram" without breaking the scope-flip effect at line 259 (which resets activeTab on scope change). Verified pattern (identity-wakeups + handoff both flow through same mechanism); low risk. | Q10 answer | If the scope-flip effect asserts on a hardcoded list of valid tabs, we may need to extend it — planner discovers during implementation |
| A9 | Skynet startup can write `config.env` (with MATRIX_ROOT + STT_URL) atomically to bind-mounted `/var/lib/tg-bridge/` before the bridge systemd unit starts. This is a startup-ordering question — if the bridge starts before Skynet writes config, the bridge crashes on missing config on first boot. Mitigation: bridge script has a bounded retry loop reading config.env on startup (5s intervals × 60 tries = 5 min budget) OR systemd `After=` ordering. **Recommendation:** bridge script does the retry loop — belt-and-suspenders (systemd After= doesn't help if the container hasn't run its startup yet). | Startup ordering | First boot silently doesn't bridge for up to 5 min after container starts — acceptable |

## Open Questions

1. **How does the "install on the Skynet host itself" case wire up?**
   - What we know: host id 6 (Skynet) is `runsFleetSubstrate:true` but has no SSH credential attached (VERIFIED via container logs).
   - What's unclear: (a) wire up SSH credential on host id 6 (fleet-consistent) vs (b) skip distributor for self-case, ship a container-side install script (simpler for one host).
   - Recommendation: Alice/Tina should decide during plan review. Slight preference for (a) — fleet consistency, one code path for every substrate host.

2. **SYSTEM vs USER systemd unit for tg-bridge?**
   - What we know: current agent-supervisor is USER-scope, and the distributor hard-codes `--user`. Nina's current bridge is USER-scope. But `/var/lib/tg-bridge/` is a system-level path and the bridge needs to survive `ubuntu` logout on t1000.
   - What's unclear: is the extra complexity of adding SYSTEM-scope support to the distributor worth it, vs just running the tg-bridge as a USER unit under `ubuntu` on t1000 (with linger enabled) like every other substrate host?
   - Recommendation: **USER-scope for consistency with agent-supervisor.** Skip Pitfall 2 entirely. Locked bind-mount path is at `/var/lib/tg-bridge/` but that's a host filesystem choice — the bridge running as USER `ubuntu` still reads/writes to it if perms are `750 ubuntu:ubuntu`. This is the simpler path. Alice to confirm.

3. **STT_URL hardcode — Option 1 (config table) or Option 2 (shared TS constant)?**
   - What we know: STT_URL is hardcoded in voice.ts (VERIFIED). CONTEXT.md assumes a config exists but it doesn't.
   - Recommendation (from Pitfall 5): **Option 2 (shared TS const)** for Phase B speed; Option 1 (proper config table) as a follow-up if runtime configurability is ever needed. Alice to confirm.

4. **How does the reconcile-loop for dead-token detection get triggered?**
   - What we know: Q6 confirms admin-minted tokens don't TTL-expire; only bridge-side 401s or admin's `/logout/all` invalidate them.
   - Options: (a) bridge writes to a `<human>.dead-token` sentinel file on any 401, Skynet startup + a periodic sweep watches these; (b) bridge emits a structured log line that Skynet's log tailer picks up; (c) Skynet's `/telegram-bridge/heartbeat` route the bridge polls periodically.
   - Recommendation: **(a) sentinel file** — simplest, doesn't need a live process on Skynet's side; deferred to Phase B implementation planning. This is planner territory.

5. **Migration script placement — one-shot bash on operator's laptop, or container startup one-shot, or backend endpoint?**
   - What we know: Alice + Zoey are the only two humans with .cred files today; migration is a small one-off.
   - Options: (a) manual bash script Alice runs once; (b) container-boot idempotent one-shot (checks if migration marker exists, skips if yes); (c) admin-gated backend endpoint she POSTs once.
   - Recommendation: **(c) admin-gated backend endpoint** — matches Phase 77 precedent (matrix-admin creds ingestion is a POST route), auditable, idempotent, doesn't need shell access to t1000.

## Metadata

**Confidence breakdown:**
- Q1 (distributor restart pattern): HIGH — read the exact code
- Q2 (STT config): HIGH — grep proved it's hardcoded
- Q3 (Matrix base URL config): HIGH — grep proved only source is admin creds
- Q4 (runsFleetSubstrate on t1000): HIGH — live docker logs verified state
- Q5 (docker bind-mount pattern): HIGH — read live /opt/skynet/docker-compose.yml
- Q6 (Synapse token lifetime): HIGH — verified against official Synapse admin API docs
- Q7 (/var/lib/tg-bridge/ path free): HIGH — ls verified
- Q8 (Nina's bridge script + registry): HIGH — SSH-read the live files
- Q9 (loginAsUser signature): HIGH — read the exact code
- Q10 (identity modal tab pattern): HIGH — read the exact code
- Q11 (Telegram getMe): HIGH — verified against Telegram Bot API docs
- Standard stack: HIGH — all packages verified in package.json + used in existing code
- Architecture: HIGH — mirrors Phase 77's proven pattern
- Pitfalls: HIGH — all pitfalls grounded in a specific file:line or verified system behavior

**Research date:** 2026-09-06
**Valid until:** 2026-10-06 (30 days — codebase is stable, Synapse admin API is stable, Telegram Bot API is stable)
