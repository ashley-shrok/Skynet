---
phase: 32-identity-first-turn-session-discovery-wake-bubble-message-hi
plan: 03
subsystem: deploy-runbook (external role file)
tags: [runbook, deploy, docker, nginx, box-maintainer, external-edit]
requires: []
provides:
  - "corrected-served-path-doc (/app/html/ not /app/dist/)"
  - "mandatory-hash-match-verify-step in the standard deploy runbook"
affects:
  - "~/.claude/roles/box-maintainer/box-map.md (OUTSIDE skynet-tiffany repo)"
tech-stack:
  added: []
  patterns:
    - "post-deploy served-bundle vs local-bundle hash-match check as a mandatory verify gate before declaring a docker-cp deploy verified"
key-files:
  created: []
  modified:
    - path: "~/.claude/roles/box-maintainer/box-map.md"
      change: "Inserted 3-block addition into the 'In-container nginx layer' section (immediately after the 'X-Powered-By: Express' distinguishing-tell paragraph, immediately before the 'Container diagnostics' block): (1) served-static-tree correction paragraph (/app/html/ not /app/dist/), (2) 2026-08-12 quick 260812-ma8 incident narrative, (3) mandatory served-bundle hash-match verify step with the exact shell snippet + MISMATCH recovery instructions + backend-only-changes caveat pointing at full-rebuild fallback."
decisions:
  - "Placed the new content inside the existing 'In-container nginx layer' block (between the 'X-Powered-By: Express' tell paragraph and the 'Container diagnostics' block) so it groups semantically with the existing nginx-vs-Express prose (per plan Task 1 § placement guidance)."
  - "Included a backend-only caveat noting docker cp shortcut generally does NOT apply for dist-backend/ changes — those need a full docker build + container recycle. Added a cross-check hint (mtime comparison of claude-session-server.js inside vs outside the container) so an operator hot-patching backend doesn't repeat the same silent-no-op pattern in a different tree."
  - "Kept the hash-match snippet as a plain shell block (not a script file) so it can be pasted directly into an SSH session without a lookup — matches the ergonomics of the other operational commands already in box-map.md § Operating."
metrics:
  duration_minutes: 1
  completed_date: "2026-08-12"
  tasks_total: 1
  tasks_completed: 1
  files_created: 0
  files_modified: 0     # inside skynet-tiffany repo tree
  files_external: 1     # ~/.claude/roles/box-maintainer/box-map.md
---

# Phase 32 Plan 03: Deploy-Runbook Hardening (Served-Path Correction + Hash-Match Verify) Summary

## One-Liner

Corrected `~/.claude/roles/box-maintainer/box-map.md` deploy documentation so the container's actually-served static tree (`/app/html/`) is documented as such (not the wrong `/app/dist/` that caused a silent no-op deploy on 2026-08-12), and codified a mandatory served-bundle-vs-local-bundle hash-match verify step into the standard `docker cp` runbook so the same failure mode can't recur silently.

## Tasks Completed (1/1)

| Task | Name                                                                              | Commit                                              | Files                                          |
| ---- | --------------------------------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------------- |
| 1    | Correct served-path doc + codify hash-match verify step in box-map.md deploy runbook | *(no repo commit — external file outside repo tree)* | `~/.claude/roles/box-maintainer/box-map.md`   |

## Exact Insertion Point in box-map.md

Inserted between the tail of the "In-container nginx layer" paragraph
(ending at the "X-Powered-By: Express" distinguishing-tell) and the
"Container diagnostics" block that opens with "the container image is
minimal: no ps, no curl, no find inside." No section header was created;
the addition is three bolded sub-blocks (paragraph + italic incident
narrative + hash-match verify code block + recovery/backend-caveat) that
extend the existing "In-container nginx layer" section by ~35 lines.

Post-edit section headers preserved verbatim (grep `^## `):

- L14  `## What runs here (docker stack, volumes, tailscale)`
- L43  `## Caddy edge (\`/opt/skynet/Caddyfile\`)`
- L148 `## Managed hosts (inside Skynet)`
- L175 `## Operating`
- L281 `## RDP + guacd notes`
- L339 `## Filestash (file UI at files.gigaashley.click)`
- L396 `## Windows hosts (GIGAASHLEYPC)`
- L406 `## Cross-fleet pointer`

(Line numbers shifted downward by ~35 lines vs pre-edit for headers after
the insertion point, as expected. No headers renamed, removed, or
re-ordered.)

## Exact Hash-Match Snippet As Landed

```
# From /home/ubuntu/skynet-tiffany after `npm run build` + `docker cp`:
SERVED=$(curl -sS https://term.gigaashley.click/ | grep -oE 'assets/index-[^"]+\.js' | head -1)
LOCAL=$(grep -oE 'assets/index-[^"]+\.js' dist/index.html | head -1)
[ "$SERVED" = "$LOCAL" ] && echo "OK: served=$SERVED local=$LOCAL" || echo "MISMATCH: served=$SERVED local=$LOCAL"
```

Identical to the plan's draft snippet — no tightening was needed; the
shell was already minimal.

Recovery-on-MISMATCH paragraph as landed (verbatim):

> A `MISMATCH` result means the `docker cp` copied to the wrong path (or
> otherwise didn't propagate) — the deploy is NOT verified. Recovery:
> (i) redo the copy against the correct destination
> (`docker cp /home/ubuntu/skynet-tiffany/dist/. <container>:/app/html/`),
> OR (ii) fall back to a full `docker build` + `docker compose up -d
> --force-recreate skynet`. For **backend-only** changes (`dist-backend/`),
> the `docker cp` shortcut generally does NOT apply because the backend is
> baked into the image at build time and served by Express from
> `/app/dist/backend/...` — those changes need a full rebuild + container
> recycle. Cross-check `dist-backend/` freshness by comparing the mtime of
> e.g. `claude-session-server.js` inside the container against the local
> build output (`sudo docker exec skynet stat -c '%Y' /app/dist/backend/...`
> vs `stat -c '%Y' dist-backend/backend/...`).

## Verify Commands + Results

| Command | Result |
| --- | --- |
| `grep -c '/app/html/' ~/.claude/roles/box-maintainer/box-map.md` | 6 (≥ 1 required) |
| `grep -c '260812-ma8' ~/.claude/roles/box-maintainer/box-map.md` | 2 (≥ 1 required) |
| `grep -Ec 'MISMATCH\|hash-match\|hash match' ~/.claude/roles/box-maintainer/box-map.md` | 3 (≥ 1 required) |
| `cd /home/ubuntu/skynet-tiffany && git status --porcelain \| grep -c 'box-map'` | 0 (file OUTSIDE repo, correctly never staged) |
| Structural check: 8 pre-existing `^## ` section headers preserved | all 8 present, in original order, none renamed |

All 5 done criteria from the plan (Task 1 `<done>` block) pass.

## Confirmation: box-map.md OUTSIDE skynet-tiffany Repo

`cd /home/ubuntu/skynet-tiffany && git status --porcelain` output contains
zero entries mentioning `box-map`. The file lives at
`/home/ubuntu/.claude/roles/box-maintainer/box-map.md`, which is under
`$HOME/.claude/`, not under `/home/ubuntu/skynet-tiffany/`. It was edited
via the Edit tool only; no git command was executed against it.

The only new untracked entry currently in the repo tree (unrelated to
this plan) is `.planning/quick/260809-eqk-pause-hidden-terminal-ws/` from
a prior workflow — see gitStatus at plan-start.

## Deviations from Plan

None — plan executed exactly as written. The `<action>` block spelled out
the three sub-block insertions verbatim; the exact insertion point (after
"X-Powered-By: Express" paragraph, before "Container diagnostics" block)
was unambiguous from the pre-existing L75-92 nginx-layer context; no
Rule 1-3 issues discovered during editing; no Rule 4 architectural
question arose.

The plan's D-05 citation (loose motivating decision — cold-start / fallback
path) is honored implicitly: the hash-match verify step is a cold-start /
zero-cache validation (it inspects only what is served + what is on disk;
no bootstrap, no warm-up, no first-visit fallback — mirroring the
mechanic-shape of D-05's decision for the identity-session discovery
helper it motivates).

## Auth Gates

None. Pure documentation edit on a local file; no network calls, no
credentials, no supervisor round-trips.

## Deploy Notes

**No deploy required for this plan.** The runbook file
(`~/.claude/roles/box-maintainer/box-map.md`) is read by the
box-maintainer role at agent invocation time — it takes effect the next
time a box-maintainer agent (or any operator following the runbook)
consults the file. No build, no restart, no container recycle.

Consequential deploy note: **the next `docker cp` deploy** (whether for
this phase's later plans or for any unrelated ship) MUST run the
hash-match snippet before declaring the deploy verified. If it returns
`MISMATCH`, redirect the `docker cp` at `/app/html/` and re-verify — do
NOT declare the deploy shipped until `OK: served=... local=...` is seen.

## Requirements Satisfied

- [x] **D-05 (loose motivating)** — Runbook hardening is a downstream
  consequence of the phase's cold-start-works discipline; the hash-match
  check operates purely on cold state (served bytes + on-disk build
  output), no cache or bootstrap.

## Known Stubs

None. No hardcoded empty values, no placeholder text, no unwired data
sources — this is a pure documentation edit on an external file.

## Threat Flags

None. The plan touched only a local runbook file; introduced no new
network endpoints, auth paths, file-access patterns, or trust-boundary
schema changes. The public URL (`term.gigaashley.click`) cited in the
hash-match snippet is already documented earlier in box-map.md (Caddy
edge section) — no new information disclosure.

## Self-Check

Files exist:

- FOUND: `/home/ubuntu/.claude/roles/box-maintainer/box-map.md` (contains `/app/html/` x6, `260812-ma8` x2, `MISMATCH`/`hash-match` x3)
- FOUND: `/home/ubuntu/skynet-tiffany/.planning/phases/32-identity-first-turn-session-discovery-wake-bubble-message-hi/32-03-SUMMARY.md` (this file)

Commits exist:

- N/A — this plan intentionally makes no repo commits (external file only). Per the plan's `<constraints>` block: "NO repo commit — external file edit only." The orchestrator handles the phase-end docs commit.

## Self-Check: PASSED
