# Skynet

A self-hosted agent chat app, built to be the place you and a fleet of Claude Code agents get all your work done.

## What it is

Skynet is a browser-based workspace for driving a fleet of AI agents across your machines. You install it once, point it at your hosts, and get a chat surface for all the Claude Code agents running on each. The whole app is built around Claude Code — this is not a multi-provider chat app that also happens to support Anthropic; it's Claude Code all the way down.

The workspace is more than the chat. Conversations are grouped into projects.Agents can build apps that live in your sidebar. Each conversation is backed by real terminal sessions on real hosts, so agents run in a real environment.

And you can RDP into your hosts if you need to as well.

Skynet is open source. Fork it, deploy it, use it however you want.

## Tech stack

React + TypeScript frontend. Node + Express backend on Drizzle ORM over AES-encrypted SQLite. Guacamole (guacd) handles RDP and VNC for the desktop-remote side. Docker Compose ties everything together, and Caddy 2 fronts it at the edge.

## Running it

Everything you need to stand up an instance is in this repo. The Docker Compose stack lives in `docker/`; that's where to start. Self-hosting isn't paved with a tutorial, yet.

## License

Apache 2.0. See `LICENSE`.

## Origin

Skynet originated as a fork of [Termix](https://github.com/LukeGus/Termix). It has since diverged extensively and is no longer meaningfully compatible with, endorsed by, or affiliated with the upstream project.
