# Shape: Skynet distributes the Claude Code harness itself to every fleet host, at a pinned version

**Opened:** 2026-10-09
**Vehicle:** inline

## What this is

Skynet takes ownership of the Claude Code harness program on every Linux host it manages. One
exact harness version is pinned in the Skynet repo — 2.1.286 to start. Every time Skynet sweeps a
host, it makes sure that host has exactly the pinned version installed and that it is the copy
agents will launch. A host with no harness gets it; a host on any other version — newer or older —
is moved to the pin. Changing the pin and deploying Skynet moves the whole fleet at once.

## Shape

- **The pin.** One exact version number, kept in the Skynet repo and carried inside each Skynet
  build. Changing it is a commit plus a deploy, like any other distributed change. Moving it down
  is a rollback and works exactly the same as moving it up.
- **The check.** Part of each host's sweep. A cheap look at the host: is the pinned version
  installed, and is it the copy at the place agents launch from? If yes, nothing else happens —
  no download, no installer run.
- **The install.** When the check fails, Skynet has the host run Anthropic's own official
  installer for exactly the pinned version. It installs for the same user the sweep logs in as
  (the same user every other distributed file lands under), needs no root, and picks the right
  build for the host's processor. It runs without holding up the rest of that host's sweep, and
  only one install at a time per host.
- **t1000 (Skynet's own box).** Skynet runs in a container there, so it cannot run the installer
  directly. Instead it asks the box's own service manager to run the installer as the box's
  normal user — the same route it already uses to restart the supervisor there. Same check, same
  outcome as remote hosts.
- **Cleanup of old versions.** After a successful install, the host keeps the pinned version plus
  the one before it (instant rollback with no download); anything older is deleted. Agents still
  running on a deleted version are unaffected until they exit.
- **Retry on failure.** If the install fails, the rest of the host's sweep still counts as done.
  The harness install retries on its own slower schedule: a few minutes after the first failure,
  doubling each time, capped at about an hour. The existing "host keeps failing" alert still fires
  after three consecutive failures.
- **When it runs.** The sweep already re-checks every host each time Skynet starts, and every pin
  change arrives with a deploy, which restarts Skynet — so a pin change reaches every reachable
  host on the next sweep. A host offline at deploy time picks it up when it comes back.
- **Visibility.** Logs only: per host, the version wanted, the version found, and what was done
  (nothing / installed / failed and why / cleaned up).

## Philosophy

- Skynet never carries, bundles or ships the harness itself. Each host downloads it straight from
  Anthropic via Anthropic's installer. This keeps Anthropic's proprietary terms and Skynet's
  AGPL-covered build fully separate, and avoids redistributing Anthropic's software.
- One version across the fleet, chosen on purpose. The pin is always an exact version — never
  "latest" or "stable". The harness's own self-updating stays off fleet-wide (already the case).
- Never interrupt running agents. A new version takes effect when an agent next starts — fresh
  launch, recycle, or wake from dormancy. No forced fleet-wide restart.
- All hosts at once — no staged or canary rollout.
- Cheap when nothing is wrong: a host already on the pin should barely notice the check.

## Prior context

- The sweep already pushes skills, helper scripts, service files and settings to every managed
  host, and already turns off the harness's self-updating on every host.
- Today the harness is installed by hand per host, by a mix of methods. Every host checked was on
  2.1.286. Most use Anthropic's installer; this instance's workstation host has a system-wide npm
  copy, and t1000 also carries an old 2.1.150 npm copy alongside its installer copy.
- The supervisor that launches agents already prefers the installer's location over system-wide
  copies, so once the pinned copy is in place agents use it even where an npm copy remains.
- A successful sweep marks a host done until Skynet restarts; a failed sweep is retried every 30
  seconds.

## What would make it wrong

- If any host ends up on a version other than the pin after a sweep that reached it, this has
  missed the point.
- If Skynet ever ships the harness bytes itself rather than having the host fetch them from
  Anthropic.
- If a host already on the pin downloads or reinstalls anything on a sweep.
- If one host's failing install delays the rest of that host's sweep, or any other host.
- If a failing host re-downloads every 30 seconds indefinitely.
- If a pin change kills or restarts agents that are mid-work.
- If cleanup removes the version the pin names, or leaves a host with no runnable harness.
- If t1000 is silently left out because it is the local box.

## Scope edges

- **In:** the pin; the check + install on the remote sweep path and on t1000's local path;
  retry backoff; old-version cleanup; logging; tests for all of it.
- **Out:** signing hosts in to the harness (logging in is separate); Windows hosts (Linux only);
  showing harness versions in the app; staged rollout; forced restart of running agents.
- **Deferred / manual:** removing the leftover npm installs on workstation and t1000 is a manual
  step after deploy, done per host only once the sweep has put the pinned copy in place there.
- **Tempting but no:** a "latest" pin; Skynet hosting or caching the harness for offline hosts.

## Vehicle notes

Inline, worked directly in this session by callisto-box-maintainer-2 (the user is evaluating model
performance and wants it worked through inline rather than via GSD). Track pieces with harness
tasks. Scoped tests during development; full suite only as the deploy gate. Code motion only —
push and deploy each need the user's explicit greenlight. No id-skill change is needed (nothing
user-facing in the app changes). Campaign artifact sits alongside this file.

---

## Close-Out

**Closed:** 2026-10-09
**Vehicle used:** inline (one commit on feat/tab-title-from-tmux by callisto-box-maintainer-2; nothing pushed or deployed at close time)
**Overall verdict:** closed-hit (initially closed-partial; all three additions and the retry-alert drift endorsed by the user)

### Shape features (conformance)

- **The pin** — present · One exact version (2.1.286) in the repo, carried in each build; up and down use the same path; a non-exact pin disables the step with a warning.
- **The check** — present · Cheap look at whether the launch entry points at the pinned, runnable version; if so nothing else happens.
- **The install** — present · Over the sweep's own login (same user, no root), Anthropic's installer for exactly the pin, verified afterwards; runs alongside the sweep, one attempt per host at a time.
- **t1000 (Skynet's own box)** — present · Cheap check through the shared home, else the box's own service manager runs the same script as a one-off job for the box user.
- **Cleanup of old versions** — present · After a successful move only; keeps pin + previous; deletes only version-named items.
- **Retry on failure** — drifted (endorsed) · Backoff 2 min doubling to 1 h; a separate harness-only "keeps failing" alert at three in a row instead of feeding the existing sweep alert — the user kept it.
- **When it runs** — present · After each sweep at startup, on retry ticks, and on host add; converged hosts not rechecked until restart.
- **Visibility** — present · Logs only: wanted, found, action, reason, pruned.
- **Philosophy: never ship harness bytes** — present
- **Philosophy: never interrupt running agents** — present
- **Philosophy: all hosts at once, cheap when nothing is wrong** — present
- **What would make it wrong: host left on non-pin after a reachable sweep** — present
- **What would make it wrong: host on pin downloads or reinstalls** — present
- **What would make it wrong: one host's install delays its own sweep or other hosts** — present
- **What would make it wrong: re-download every 30 seconds** — present
- **What would make it wrong: cleanup removes the pin or leaves no runnable harness** — present
- **What would make it wrong: t1000 silently left out** — present
- **Scope OUT / tempting-but-no** — present
- **Tests for all of it** — present

### Additions (in the result, not in the shape)

- A 1 GB free-disk floor: the host refuses to install and reports a failure below it — endorsed-as-drift
- A ~15-minute limit on one installer run (~17 minutes for the t1000 result wait), counted as a failed attempt — endorsed-as-drift
- A separate harness-specific "keeps failing" alert, distinct from the existing host-sweep alert — endorsed-as-drift

### Follow-ups

None.

### Notes

Rollback to a version still on disk re-points the launch entry without running Anthropic's installer — that is how "instant rollback with no download" is delivered. The commit carries the shape and campaign files alongside the code.
