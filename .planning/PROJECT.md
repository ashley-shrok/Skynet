# Skynet

## What This Is

Skynet is a self-hosted, browser-based workspace for working with a fleet of
Claude Code agents spread across many machines. A Skynet instance is pointed at
a set of hosts; every Claude Code agent running on those hosts shows up as a
conversation in a chat-style sidebar, and the main pane renders that agent's
session as a native web chat with its own compose box. Behind each
conversation is a real tmux session running a real Claude Code process on a
real host, reached over SSH.

Around the chat sits the rest of the workspace: projects that group
conversations, roles and identities that define what each agent is, apps that
agents build and publish into the sidebar, Matrix relay rooms for
agent-to-agent and multi-party messaging, scheduled agents and wake-ups,
voice in and out, phone-call and notification channels back to the user, and
RDP/VNC into hosts when a desktop is needed.

The project started as a fork of Termix (a self-hosted SSH/RDP manager) and
has since diverged completely: the Termix dashboard, host manager, snippets,
and admin surfaces have been removed, and the codebase is no longer
compatible with upstream. It is open source under Apache 2.0, and more than
one independent instance runs it.

## Core Value

One place to see, talk to, and direct every agent in the fleet — with the
conversation as the primary surface and the terminal, files, and desktop one
step away when they are needed.

## Requirements

### Validated

Shipped capabilities, grouped by area. Phase numbers point into
`.planning/phases/`.

**Conversations and chat surface**
- ✓ Pretty view: Claude Code JSONL session tailed from the host and rendered as
  web chat, with session changeover detection on recycle/resume (Phases 1–3)
- ✓ Compose box with a single send funnel, optimistic bubbles reconciled
  against the transcript, hold-to-send, queued messages, and file/image
  upload to the host (Phases 5, 9, 50, 68, 81)
- ✓ Windowed message pagination with manual load-more (Phases 43, 45, 47)
- ✓ Position-derived auto-scroll (Phase 71)
- ✓ Backend-authoritative working/idle, waiting, and recycling signals driven
  by Claude Code hooks (Phases 30, 34, 53, 61, 63)
- ✓ Plan-mode approval bubble and background-agent panel (Phases 24, 51)
- ✓ Interactive messages: agent-posted widgets (built-in templates and
  custom widgets) with lifecycle and expiry (Phases 138–142)
- ✓ Terminal view mounted on demand behind the chat (Phase 41)
- ✓ Split-view layout: recursive split tree with drag-to-open and drop
  previews, persisted in the URL (Phases 56–59, 64)

**Sidebar and navigation**
- ✓ Fleet-discovered conversation list that arrives complete and stays live
  over a WebSocket channel (Phases 7, 13, 111)
- ✓ Recency sort from a Skynet-side send log, pins zone, RDP zone, filters,
  per-row current-work hint and repo-state indicator (Phases 42, 48, 85, 104)
- ✓ Projects: sidebar sections with drag-and-drop membership and a
  per-project context file (Phase 117)
- ✓ Apps section: agent-built apps discovered on disk, opened in a pane, a
  split, or a new tab through an authenticated reverse proxy (Phases 118–120)
- ✓ Conversation search, workspace file browser, archived-item discovery and
  un-archive (Phases 121, 122, 143)

**Agents: roles, identities, lifecycle**
- ✓ Roles and identities as on-disk folders under `~/fleet/` on each host;
  disk is the sole source of truth (no identities table) (Phases 66, 69, 96)
- ✓ Role and identity modals: files, runbooks, skills, cosmetics, wake-ups
  (Phases 18, 46, 72, 86, 89, 90, 113)
- ✓ Identity creation through the agent-supervisor as sole spawner, with a
  name pool, task-scoped creation, and a global birth throttle
  (Phases 20, 80, 106, 108, 110)
- ✓ Identity and role archiving with cascade, and un-archiving
  (Phases 94, 115, 133, 143)
- ✓ Invisible dormancy: sleeping agents wake on send (Phases 60, 62, 76)
- ✓ Wake-ups: global specs, CRUD API, management modal (Phases 127, 134, 135)
- ✓ Scheduled agents: recurring agents created from a sidebar modal
- ✓ Coordinator marking and identity sharing between users (Phases 38, 67)

**Fleet substrate**
- ✓ Distributor that installs skills, scripts, and services onto every
  managed host from a catalog, with a reconcile loop (Phases 73, 75)
- ✓ Instance-wide managed-policy CLAUDE.md pushed to hosts (Phase 114)
- ✓ Fleet-status sweep: one batched exec per host per tick (Phases 92, 95)
- ✓ Per-host SSH concurrency semaphore for all outbound SSH (Phase 101)
- ✓ File-drop brokers on hosts for spawn requests, image generation, and
  phone calls (Phases 99, 116)

**Messaging, voice, notifications**
- ✓ Matrix (Synapse) relay rooms rendered on the same chat surface as agent
  sessions (Phases 17, 77, 93, 97)
- ✓ Voice input via Amazon Nova Sonic on Bedrock with chunked parallel
  streaming; voice "slash" skill invocation; TTS via Amazon Polly
  (Phases 16, 36, 98, 100, 109)
- ✓ Notifications to the user's phone through a self-hosted ntfy server
  (Phases 128, 144)
- ✓ Audio cue when an agent finishes a turn (Phase 126)
- ✓ In-app feedback: general feedback and per-message thumbs, delivered by
  SMTP (Phases 123–125)

**Instance and users**
- ✓ Per-instance branding config (name, images, avatar style, WIP indicator)
  (Phases 70, 74, 82)
- ✓ Multiple users per instance and per host, with per-user visibility of
  roles and identities (Phases 87, 102, 129)
- ✓ Preferences modal: voice, notifications, avatar, about-you (Phase 137)
- ✓ Passthrough URLs for files and served ports (Phases 78, 103)
- ✓ Markdown (WYSIWYG) and code editing across editor surfaces (Phases 40, 112)
- ✓ Frontend version-drift lock against stale clients (Phase 132)
- ✓ Browser RDP/VNC to hosts through guacd

### Active

Open campaigns and shapes in `.planning/campaigns/` and `.planning/`:

- [ ] Un-archiving: sidebar header affordances; agent-side identity
  un-archive (`campaigns/un-archiving/`)
- [ ] More file editors: native viewers in the file modal
  (`campaigns/more-file-editors/`)
- [ ] ComposeBox cutover to the agent-supervisor inbox
  (`shape-composebox-cutover.md`, `campaign-composebox-via-agent-supervisor.md`)
- [ ] Project move affordances (`campaign-project-move-affordances.md`)

### Out of Scope

- Non-Claude agent runtimes — the app is built around Claude Code
  specifically, not as a multi-provider chat client
- Compatibility with upstream Termix — the codebase has diverged and is not
  rebased or contributed back
- The original Termix surfaces (dashboard, host manager, snippets, admin
  console) — removed in Phases 11–12
- Telegram bridge and browser Web Push — replaced by ntfy (Phases 128, 144)
- Bounties as a Skynet concept — retired in Phase 136
- A database-backed identity registry — identities and pins live on disk
  (Phases 69, 105)

## Context

- **Shape of a deployment:** one Docker Compose stack per instance —
  `skynet` (Express backend + built frontend behind nginx), `guacd`,
  `synapse` (Matrix homeserver), `ntfy`, and `caddy` at the edge. Config and
  secrets come from `docker/skynet.env`; branding defaults live in
  `docker/branding-defaults/`.
- **Hosts:** reached over SSH (typically over a tailnet). Each managed host
  runs Claude Code in tmux, carries the `~/fleet/` tree (roles, identities,
  projects, apps, request drop folders), and has substrate installed by the
  distributor.
- **Substrate** (`substrate/`): the skills (`id`, `role`, `queue`,
  `agent-relay`, `app-development`, `interactive-messages`, `image-gen`,
  `agent-phone`), scripts, and systemd units that run on managed hosts. The
  agent-supervisor on each host spawns, reconciles, and retires identities.
- **Planning layout:** numbered phases in `.planning/phases/`; ad-hoc work in
  `.planning/quick/`; design agreements as `shape-*.md` (`.closed.md` once
  shipped) in `.planning/shapes/` and `.planning/`; multi-shape efforts in
  `.planning/campaigns/`. Since roughly Phase 20, each phase's requirements
  are recorded as D-numbered decisions in its own `CONTEXT.md` rather than as
  REQ-IDs in `REQUIREMENTS.md`.
- **Development:** several agents work on the codebase in parallel; phase
  numbers occasionally collide and are renumbered on landing.
- **Working branch:** `feat/tab-title-from-tmux`.

## Constraints

- **Tech stack:** React + TypeScript (Vite) frontend; Node 22 + Express
  backend on Drizzle ORM over AES-encrypted SQLite; guacd for RDP/VNC;
  Synapse for Matrix; ntfy for notifications; Docker Compose; Caddy 2.
- **Routing:** backend routes are proxied by nginx inside the `skynet`
  container, configured in both `docker/nginx.conf` and
  `docker/nginx-https.conf`; a path with no matching `location` falls
  through to `index.html`.
- **Blast radius:** a Skynet instance is the user's main way into their
  hosts, so a broken deploy cuts off access to the whole fleet.
- **Public repository:** personal and deployment-specific identifiers are
  checked by `src/backend/no-personal-strings.test.ts` against a banned-list
  file kept outside the repo.
- **Credentials:** host credentials and keys are stored encrypted in SQLite
  (`skynet-data` volume); third-party API keys (AWS, OpenAI, phone provider,
  SMTP) are held by the backend and never distributed to hosts — hosts reach
  those services through file-drop brokers.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Chat view over the Claude Code transcript, terminal one step away | Native web ergonomics (selection, paste, scrolling) without losing tmux | ✓ Pretty view is the primary surface; terminal mounts on demand |
| Diverge fully from Termix | The product became an agent workspace, not an SSH manager | ✓ Old surfaces purged; no upstream compatibility |
| Disk on each host is the source of truth for roles, identities, projects, apps, pins | One truth readable by agents and the app alike; no sync layer | ✓ Identities table dropped (69), pins to sentinels (105) |
| Backend-authoritative state pushed to clients | Client inference from PTY output was unreliable | ✓ Hook-driven status file + fleet-status WS channel |
| Agent-supervisor is the sole spawner of identities | One place owns lifecycle; Skynet only requests | ✓ Phase 106 |
| Distributor installs substrate on every host | Hosts stay consistent without manual setup | ✓ Phases 73, 75, 114 |
| File-drop brokers for paid APIs | Keys stay on the backend; any host can request work | ✓ Spawn, image-gen, phone-call brokers |
| Optimistic send bubbles, reconciled with the transcript | The original "no optimism" rule made sends feel broken | ✓ Phases 50, 81 reversed the original stance |
| Plain-DOM windowed pagination instead of virtualization | Virtualization caused correctness bugs with scroll anchoring | ✓ Phases 43, 45 |
| Managed cloud voice (Nova Sonic STT, Polly TTS) over a local rig | Works on any instance without GPU hosts | ✓ Phases 98, 109 |
| ntfy for notifications | Browser Web Push was unreliable on iOS; Telegram added infra | ✓ Phase 144 |
| GSD for planning, one phase per shippable slice | Large multi-file features with many agents working in parallel | ✓ 140+ phases |

---
*Rewritten 2026-10-05 to reflect the project as of Phase 144.*
