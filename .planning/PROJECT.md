# Skynet Fork

## What This Is

A maintained fork of Skynet (self-hosted browser SSH/RDP manager) that adds 42
numbered patches on top of upstream v2.3.x to fit Ashley's specific workflow:
many parallel Claude Code sessions on many machines, coordinated via
identity-aware terminal panes with per-pane message queues. Runs in production
at term.gigaashley.click as the central access point for her fleet.

## Core Value

Ashley never loses access to her fleet. Skynet is the gateway to every managed
machine (SSM-only admin on the EC2, tailnet-only on the peers). Every change
must preserve reliable browser SSH+RDP access; features are added around that
hard constraint, not through it.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- ✓ Browser SSH/RDP/VNC to managed hosts — upstream + 42 fork patches
- ✓ Named tmux session launcher (patch #7) — one-click session list dashboard
- ✓ Identity registry + per-pane badges (patch #17)
- ✓ Per-pane message queue drawer with split-send (patches #39–41)
- ✓ URL-encoded workspace fragments surviving Chrome window-restore (patches #25, #33–35)
- ✓ RDP single-active takeover per (user, host) (patch #23)
- ✓ RDP/VNC keep-alive across backgrounded tabs (patch #10)
- ✓ Identity hue tint row→tab→pane (patches #26, #30, #32)
- ✓ Keyboard tab chords: switch [/], close L, queue ; (patches #31, #37, #39)
- ✓ Unified auto-collapse sidebar (patches #14, #28)
- ✓ tmux 2-line wheel scroll (patch #42, shipped 2026-07-17)

### Active

<!-- Current scope. Building toward these. -->

- [ ] **Pretty session view for Claude Code panes (patch #43)** — see
  `.planning/shapes/shape-pretty-session-view.md`; native web chat rendering
  of Claude Code sessions with keyboard-chord toggle from tmux mode; own
  compose box with no optimism on sends

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Rewriting/replacing upstream Skynet — this is a maintained fork, not a rebrand
- Changes that break rebase-ability — patches must apply cleanly and stay
  individually PR-able upstream
- Speculative features outside Ashley's workflow — no additions for hypothetical users
- Anything that risks locking Ashley out of the fleet during deploy —
  deadman rollback covers accidents but the intent is not to court them

## Context

- Fork branch: `feat/tab-title-from-tmux` on `github.com/ashley-shrok/Skynet`
- Upstream: `github.com/Skynet-SSH/Skynet`
- 42 numbered patches as of 2026-07-17; each patch is PR-able upstream individually
- Runtime: `skynet-patched:local` docker image built by
  `/opt/skynet/skynet-patches/build-skynet.sh` and deployed via docker compose
- Deployed on this EC2 (skynet-ec2), Caddy 2 edge with Let's Encrypt HTTP-01
- Maintainer: tina identity (this box's whole-box maintainer)
- Full runbook and per-patch documentation: `/home/ubuntu/AGENTS.md`
- Design work for in-flight patches lives at `.planning/shapes/shape-*.md`

## Constraints

- **Tech stack**: React + TypeScript frontend; Node/Express backend on Drizzle
  ORM over AES-encrypted SQLite; Docker Compose; Caddy 2 edge; guacd 1.6.0
  (FreeRDP 2.11.7) for RDP/VNC — the backend session-file work in patch #43
  goes through the existing SSH exec-channel plumbing, not a new subsystem.
- **Rebase-ability**: Every fork commit must survive rebases against upstream
  `main`. Feature commits are numbered and individually PR-able; no squashes.
- **Deploy safety**: Every `docker compose up -d --force-recreate skynet` runs
  behind the 15-min deadman rollback timer (`/opt/skynet/.tmp-revert.sh`) —
  no exceptions, per Ashley 2026-07-03, even when she is at the keyboard.
- **Blast radius**: A bad deploy loses Ashley access to her whole fleet
  (Skynet is the gateway to every managed box). Asymmetric risk drives all
  safety practices.
- **Encryption**: Skynet stores host credentials + SSH keys in AES-encrypted
  SQLite (`skynet-data` volume). Backup is daily EBS DLM snapshot of the root
  volume; no separate DB backup story.
- **Access model**: EC2 admin is AWS SSM only (no public inbound SSH). Skynet
  reaches managed targets over Tailscale (not `--accept-routes`).
- **Nginx caveat**: Every new backend route needs matching `location` blocks
  in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`, else it 200s
  with `index.html` and crashes the frontend on `.map`.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Maintain as a numbered-patch fork, not a rewrite | Preserves rebase-ability against upstream + PR-able commits + clear audit trail | ✓ Good — 42 patches shipped, all upstream-PR-able |
| Mandatory 15-min deadman on every deploy | Asymmetric risk: lose Skynet = lose fleet = can't recover; the timer is the only safety net that survives lockout | ✓ Good — saved 2 known bad deploys |
| Adopt GSD for the fork (2026-07-17) | Patch #43 is large enough (~500+ lines, backend session-file tail + WS bridge + new pane component + compose box + layout refactor) to justify one-time GSD bootstrap | — Pending |
| Vertical-MVP phase mode (phase = one patch) | Each shipped patch is an end-to-end user-visible slice; matches how the fork has always worked | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-17 after initialization*
