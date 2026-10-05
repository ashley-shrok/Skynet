# Skynet

A self-hosted agent chat app, built to be the place you and a fleet of Claude Code agents get all your work done.

## What it is

Skynet is a browser-based workspace for driving a fleet of AI agents across your machines. You install it once, point it at your hosts, and every Claude Code agent running on them shows up as a conversation in a chat-style sidebar. Open one and the main pane renders that agent's session as a native web chat with its own compose box. Behind each conversation is a real tmux session running a real Claude Code process on a real host, reached over SSH, so agents work in a real environment and the terminal is always one click away.

The whole app is built around Claude Code. This isn't a multi-provider chat app that also happens to support Anthropic; it's Claude Code all the way down.

The goal is one place to see, talk to, and direct every agent in the fleet, with the conversation as the main surface and the terminal, files, and desktop close by when you need them.

Skynet is open source. Fork it, deploy it, use it however you want.

## Features

**Chat surface**
- The Claude Code session transcript is tailed from the host and rendered as web chat, and it keeps following the session across restarts and resumes
- A compose box with optimistic sends, queued messages, hold-to-send, and file and image upload to the host
- Live working, idle, and waiting status driven by Claude Code hooks
- Plan-mode approval, a background-agent panel, and interactive widgets that agents can post into the chat
- Split views: open conversations, terminals, and apps side by side in any layout

**Sidebar and workspace**
- A fleet-wide conversation list that stays live over WebSocket, with pins, filters, recency sort, and per-conversation work hints
- Projects that group conversations, each with a shared context file
- Apps: agents can build web apps that show up in your sidebar and open in a pane, a split, or a new tab
- Conversation search, a workspace file browser, and archive/un-archive

**Agents**
- Roles and identities define what each agent is. They live as plain folders under `~/fleet/` on each host, and disk is the source of truth
- An agent-supervisor on each host spawns, reconciles, and retires agents
- Sleeping agents wake up automatically when you message them
- Scheduled agents and wake-ups for recurring work
- Identities can be shared between users

**Fleet management**
- A distributor installs the substrate (skills, scripts, and services) onto every managed host and keeps it reconciled
- An instance-wide managed `CLAUDE.md` policy pushed to all hosts
- File-drop brokers let any host request spawns, image generation, and phone calls, while paid API keys stay on the backend

**Messaging, voice, and notifications**
- Matrix relay rooms for agent-to-agent and multi-party conversations, shown on the same chat surface
- Voice input (Amazon Nova Sonic) and text-to-speech (Amazon Polly)
- Phone notifications through a self-hosted ntfy server, plus an audio cue when an agent finishes a turn
- In-app feedback delivered by email

**Instance**
- Multiple users per instance, each with their own view of roles and identities
- Per-instance branding: name, images, avatar style
- Browser RDP and VNC into your hosts when you need a desktop

## Architecture

One Docker Compose stack per instance:

| Service   | Role |
|-----------|------|
| `skynet`  | Express backend and built React frontend behind nginx |
| `guacd`   | Guacamole daemon for RDP and VNC |
| `synapse` | Matrix homeserver for relay rooms |
| `ntfy`    | Push notifications to your phone |
| `caddy`   | TLS and edge proxy |

Hosts are reached over SSH (typically over a tailnet). Each managed host runs Claude Code in tmux, carries the `~/fleet/` tree (roles, identities, projects, apps, request folders), and has the substrate from `substrate/` installed by the distributor.

Host credentials are stored encrypted in SQLite. Third-party API keys (AWS, OpenAI, SMTP, phone provider) are held by the backend and never sent to hosts.

## Tech stack

React + TypeScript (Vite) frontend. Node 22 + Express backend on Drizzle ORM over AES-encrypted SQLite. Guacamole (guacd) handles RDP and VNC. Synapse for Matrix, ntfy for notifications. Docker Compose ties everything together, and Caddy 2 fronts it at the edge.

## Repository layout

- `src/` - frontend and backend source
- `docker/` - Compose stack, Dockerfiles, nginx and Caddy config, `skynet.env.example`, branding defaults
- `substrate/` - skills, scripts, and units installed on managed hosts
- `docs/deploy/` - deployment notes (for example, AWS voice setup)
- `.planning/` - project planning: phases, shapes, and campaigns. `.planning/PROJECT.md` has the full project overview

## Running it

Everything you need to stand up an instance is in this repo. The Docker Compose stack lives in `docker/`, so start there: copy `docker/skynet.env.example` to `docker/skynet.env`, fill it in, and bring the stack up. There's no step-by-step self-hosting tutorial yet.

## License

Apache 2.0. See `LICENSE`.

## Origin

Skynet originated as a fork of [Termix](https://github.com/LukeGus/Termix), a self-hosted SSH/RDP manager. It has since diverged completely: the Termix dashboard, host manager, snippets, and admin surfaces are gone, and it is no longer compatible with, endorsed by, or affiliated with the upstream project.
