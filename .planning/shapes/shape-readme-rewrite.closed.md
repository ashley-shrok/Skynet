# Shape: rewrite the Skynet repo README from scratch

**Opened:** 2026-09-23
**Vehicle:** inline

## What this is

Replace the top-level README of the Skynet repo. The current one opens with "a personal app," dedicates most of its text to being a fork of Termix, and never says what the app does. That framing is stale — Skynet has become an agent chat app that is actively deployed beyond Ashley's own use, including to a workplace and to 100+ other users, so a "personal, no support" framing no longer fits. The new README describes what Skynet actually is (a self-hosted Claude Code-native agent chat app), plainly and without ceremony, and doesn't point readers at stale scaffolding.

## Shape

One top-level `README.md` replacement, plus a cleanup pass over the stale scaffolding around it. The new README leads with a tagline, describes the app functionally, names the differentiators (Claude Code-native, fleet across machines, real terminal sessions on real hosts, agents-can-build-apps, RDP as a secondary capability), documents the tech stack, gives an honest short paragraph on running it, notes the license, and closes with a one-line footer on the Termix origin.

Around it, five other pieces of scaffolding get resolved:

- The `readme/` folder of 14 translations gets deleted (every file still carries stale Termix-era marketing content — GitHub-stars badges pointing at a different project, Discord link, marketing tagline).
- Each of `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `RELEASE_NOTES.md`, `TESTING.md`, `SECURITY.md` gets a per-file decision: keep, rewrite, or delete. Read each first, propose per-file, execute on Ashley's approval.

## Philosophy

The README is for the reader who opened the repo cold. Two audiences: an outsider deciding whether the app is worth their time, and an agent starting work in the repo. Both need the same thing — a plain, functional description of what this is, without ceremony.

Deliberately not:

- Marketing the app to a general audience or trying to build community.
- Inviting traffic to Ashley's personal instance (URL never appears).
- Naming the workplace where it's deployed.
- Leaning on hype language ("agent OS," etc.); the aspiration exists but isn't the headline.
- Pointing at docs that don't exist (`docs/deploy/` is one file for AWS Polly) or aren't in the repo (`CLAUDE.md` is gitignored).

## Prior context

- The current README is 7 lines, opens with "a personal app," and gives Termix-fork origin more space than app description.
- The repo previously carried full open-source-project scaffolding (contributing / conduct / translations) inherited from the Termix upstream; that upstream tie was severed 2026-07-24 and the scaffolding has been drifting ever since.
- Skynet is actively deployed beyond Ashley's personal machine: at her workplace and to 100+ other users. Framing matches that reality without naming specifics.
- Contemporaries in the space split their framing across "fleet" (Fleet, Agent Fleet, Phleet), "workspace" (AnythingLLM, Multica, Msty), and "agent OS" (OpenAgents, LobeChat). Skynet's spot: Claude Code-native, browser-based, fleet across machines, workspace ambition, but "agent OS" is a stretch aspiration not a headline.

## What would make it wrong

- Reads like marketing copy. The register is plain and functional; the app sells itself in screenshots and word-of-mouth, not README hype.
- Invites internet traffic to Ashley's personal instance by naming a URL or hostname.
- Names Ashley's workplace, either directly or in a way that lets a reader identify it.
- Points at documentation that isn't there — a "how to deploy" section that leads to one AWS-Polly file, or a pointer to `CLAUDE.md` which is gitignored.
- Carries residual Termix-era content in adjacent files (translations, contributing docs) that contradict what the new README says.
- Reads as if the app is only for coding agents. Ashley uses it for coding; most deployers don't.

## Scope edges

**In scope:**

- Full replacement of `README.md` with the locked content.
- Delete `readme/` folder (all 14 translation files).
- Per-file decision on the five other repo-root docs: `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `RELEASE_NOTES.md`, `TESTING.md`, `SECURITY.md`.

**Out of scope:**

- Adding screenshots to the README (Ashley doesn't have any handy right now; deferred).
- Rewriting or regenerating `CLAUDE.md` (gitignored, separate concern).
- Adding a deploy tutorial or backfilling `docs/deploy/`.
- Documenting the tech stack in depth beyond the one paragraph.
- Adding Ashley's copyright line to `LICENSE`.

**Tempting but no:**

- Naming the workplace or scale of deployment. Adds credibility but adds identifiable specifics.
- Leaning harder into the "agent OS" framing.
- Adding a badge row (build status, license, version). No badges gives a cleaner read for this audience.

## Vehicle notes

Inline execution in this session. Atomic commits per motion:

1. Replace `README.md` with the locked content.
2. Delete `readme/` folder.
3. One commit per side-doc decision (keep-with-edit or delete).

## Locked README content

```markdown
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
```

---

## Close-Out

**Closed:** 2026-09-23
**Vehicle used:** inline
**Overall verdict:** closed-hit

### Shape features (conformance)

- **What this is** — present · README replaced with the locked content verbatim — old 'personal app / Termix fork' framing gone, new framing is a self-hosted Claude Code-native agent chat app.
- **Shape** — present · Tagline, functional description, differentiators (Claude Code-native, fleet, real terminal sessions, agents-can-build-apps, RDP secondary), tech stack paragraph, honest short 'Running it' paragraph, license, Termix-origin footer — all present. Cleanup pass done: readme/ deleted, four side docs deleted, TESTING.md kept.
- **Philosophy** — present · Plain functional register; no personal-instance URL; no workplace naming; no hype; no pointer at missing docs or gitignored CLAUDE.md.
- **Failure mode — reads like marketing copy** — present · Register is plain and functional throughout.
- **Failure mode — invites traffic to personal instance** — present · No URL or hostname appears.
- **Failure mode — names Ashley's workplace** — present · No workplace reference, direct or identifiable.
- **Failure mode — points at documentation that isn't there** — present · No deploy-tutorial pointer, no CLAUDE.md reference; 'Running it' is honest about the absence of a paved path.
- **Failure mode — residual Termix-era content in adjacent files** — present · readme/ folder (14 files) deleted; CONTRIBUTING, CODE_OF_CONDUCT, RELEASE_NOTES, SECURITY deleted; TESTING.md retained and is current Skynet-native content, not Termix drift.
- **Failure mode — reads as if only for coding agents** — present · Framed as an agent chat app / workspace for a fleet of AI agents; coding is not the headline.
- **Scope edges — in-scope items** — present · Full README replacement done; readme/ deleted; per-file decisions taken on all five named side docs (four deleted, TESTING.md kept).
- **Scope edges — out-of-scope items** — present · No screenshots added; CLAUDE.md untouched; no deploy tutorial; tech stack kept to one paragraph; LICENSE untouched.
- **Scope edges — tempting-but-no** — present · No workplace/scale naming; no 'agent OS' framing; no badge row.
- **Vehicle notes — atomic commits per motion** — present · Four atomic commits landed: README rewrite, readme/ deletion, side-docs deletion, .github/ deletion.

### Additions (in the result, not in the shape)

- The entire .github/ directory was deleted — ISSUE_TEMPLATE/config.yml, pull_request_template.md, dependabot.yml, and four workflow files (electron.yml, openapi.yml, pr-check.yml, release.yml). The shape's scope edges named five specific side docs for per-file decisions but did not mention .github/ at all. — endorsed-as-drift

### Follow-ups

None.

### Notes

The shape's locked README content contains a small typographic slip ('projects.Agents' — missing space after the period); the material reproduces it exactly, which is conformance to the letter of the shape rather than a divergence, but worth carrying forward as a future micro-fix. The mid-execution greenlight on .github/ is a pattern worth noting — a cleanup pass tends to surface adjacent stale scaffolding the shape didn't anticipate; keeping the shape open enough to absorb a drift like this (rather than blocking) worked well here.
