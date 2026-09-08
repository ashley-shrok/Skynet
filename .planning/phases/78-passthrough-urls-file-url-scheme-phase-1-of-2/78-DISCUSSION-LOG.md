# Phase 78: Passthrough URLs — file URL scheme (phase 1 of 2) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-06
**Phase:** 78-passthrough-urls-file-url-scheme-phase-1-of-2
**Areas discussed:** URL grammar, Broken-URL bubble UX, Parent-Skynet-domain config, Read access mechanic

---

## URL grammar

| Option | Description | Selected |
|--------|-------------|----------|
| Literal path segments | `<skynet-domain>/file/<hostname>/home/ubuntu/foo.md` — path segments preserved after hostname, backend strips prefix + re-adds leading slash | ✓ |
| URL-encoded single segment | `<skynet-domain>/file/<hostname>/<encoded-full-path>` — the whole absolute path as one URL-encoded blob | |
| Query param | `<skynet-domain>/file/<hostname>?path=/home/ubuntu/foo.md` — path as a query parameter | |

**User's choice:** Literal path segments (agreed via "Agree on all" after Claude's recommendation).
**Notes:** Matches the existing tailnet-URL pattern shape agents already know (`http://100.x.y.z:PORT/filename` — no encoding), matches how file URLs read on other systems, agent-natural to construct.

---

## Broken-URL bubble UX

| Option | Description | Selected |
|--------|-------------|----------|
| Passive render, error in modal on click | URL renders with pencil affordance if extension is whitelist-eligible; failure surfaces INSIDE the modal on click | ✓ |
| Preflight HEAD on render | Fire a HEAD request per URL when rendering messages; dim/flag broken URLs upfront | |
| Passive render, no affordance for broken | Render as plain link only if URL known-valid, no pencil for potentially-broken URLs | |

**User's choice:** Passive render, error in modal on click.
**Notes:** Preflight HEAD would fire an SSH round-trip per URL per rendered message — untenable at scale (a scrolled chat with a few file mentions across 20 messages = 50-100 SSH channels just for render). Matches existing Phase 40 tailnet-URL behavior.

---

## Parent-Skynet-domain config

| Option | Description | Selected |
|--------|-------------|----------|
| Single-line file `~/.claude/skynet-parent` | URL only, distributor writes it during same sweep as settings.json/hooks. Agent `cat`s it when constructing URLs | ✓ |
| JSON file `~/.claude/skynet-parent.json` | `{"url": "..."}` — extensible if we ever add fields | |
| Line in user-wide `~/.claude/CLAUDE.md` | Agents read it as prose | |
| Env var set by distributor | No file at all | |

**User's choice:** Single-line file `~/.claude/skynet-parent`.
**Notes:** JSON is over-engineered for a single value; prose in CLAUDE.md is fragile (agents extract from prose differently); env vars need shell reload and hide missing-config as silent empty string. Single-line file mirrors existing patterns like `~/.claude/identities/<name>/relay-state/since`.

---

## Read access mechanic on the target host

| Option | Description | Selected |
|--------|-------------|----------|
| As Skynet's existing per-host SSH user | Use the SSH connection Skynet already has; no escalation, no dedicated account | ✓ |
| `sudo cat` | Skynet elevates on the host regardless of user; broader read reach, requires sudo entry per host | |
| Dedicated `skynet-fs-read` service account per host | Separate audit trail, needs onboarding per host | |

**User's choice:** As Skynet's existing per-host SSH user.
**Notes:** On fleet boxes Skynet's SSH user is typically `ubuntu` — same user agents run as — so agent-written files are readable in the default case. Failure surfaces as "permission denied" in the modal, operator fixes host-side. YAGNI on escape hatches until they hurt.

---

## Claude's Discretion

- Exact regex for the new URL pattern — planner + phase-researcher pick following the shape and mirroring existing `TAILNET_URL_RE_CLIENT` in `editable-file-whitelist.ts`.
- Backend route mount path (e.g. under `/api/host/file/...` or top-level `/file/<host>/<path>`) — planner picks; the SHAPE-locked path is what agents write (`<skynet-domain>/file/<host>/<path>`), Caddy/routing at the edge maps to internal.
- Which Phase 40 code paths get extended vs. copied — intent is REUSE, planner scouts and decides.
- Distributor mechanism specifics for `~/.claude/skynet-parent` — which sweep step, upgrade propagation, etc.

## Deferred Ideas

- Serve URL scheme (phase 2 of shape) — separate GSD phase after phase 75 ships.
- Directory listings via file URL — explicitly ruled out by shape.
- Skynet writing directly to host files — explicitly ruled out by shape.
- Preflight HEAD on rendered URLs — rejected in D-02; may revisit if UX proves confusing at scale.
- `sudo cat` / dedicated service account on hosts — rejected in D-04 as YAGNI; may revisit if plain SSH-user read boundary causes friction.
