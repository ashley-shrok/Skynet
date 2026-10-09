# Campaign: Skynet distributes the Claude Code harness itself to every fleet host, at a pinned version

**Opened:** 2026-10-09
**Status:** in_progress
**Workspace:** .planning/campaigns/harness-distribution/

## Concept

Skynet takes ownership of the Claude Code harness on every Linux host it manages. One exact
harness version is pinned in the Skynet repo (starting at 2.1.286). Every sweep checks each host:
a host with no harness gets the pinned version installed; a host on any other version is moved to
it. Bumping the pin and deploying Skynet moves the whole fleet at once — no staged rollout. The
install uses Anthropic's own official installer run on each host (Skynet never carries or ships
the harness bytes itself). Agents already running keep their version until their next
launch/recycle/dormant-wake.

## Success criteria

- A Linux host with no harness has the pinned version after its next sweep, with nobody touching it.
- Changing the pin + deploying moves every reachable host to the new version within a sweep or two.
- A host already on the pin pays almost nothing per sweep — no download, no installer run.
- A failed install (offline, disk, missing curl) is logged clearly, retried later, and blocks
  neither the rest of that host's sweep nor any other host.
- t1000 (local install path) behaves the same as remote hosts.
- Agents pick up the pinned version on their next launch; running sessions are not interrupted.

## Shapes

- **[declared] shape-harness-distribution** — pinned-version harness install/upgrade step on both sweep paths, with logging — closed

## Other work

- Manual, near the end of the build: remove the stale npm-global harness installs on this instance
  (workstation's system-wide copy, t1000's old 2.1.150) — only after the sweep has put the native
  pinned install in place on each — pending

## Lingerers (explicitly approved)

## Open questions
