# Phase 23 — global-files.json bootstrap + operator workflow

**Purpose:** Seed and maintain `/app/data/global-files.json` (the config
file that drives GEFM-05's GlobalFilesModal) on the deployed skynet-ec2
Skynet. Also serves as the reference doc for any future Skynet-instance
operator (Stacey on ceo-skynet, etc.) who wants to enable per-host
editable global files.

**Scope:** MVP edits via SSM into the EC2 host + `sudo` into the docker
volume. Meta-UI (editing this config from within Skynet's own modal,
self-referentially) is deferred per CONTEXT §GEFM-02.

---

## Where global-files.json lives

**Inside the Skynet container:** `/app/data/global-files.json`
(mounted from the `skynet-data` docker volume — same volume as the
crown-jewel encrypted SQLite, so it's already backed up by AWS DLM
snapshots — no separate backup plumbing needed).

**Volume name on skynet-ec2:** `skynet_skynet-data`
(compose project prefix is `skynet`, from the directory `/opt/skynet/` where
`docker-compose.yml` lives — confirmed via `sudo docker volume inspect`
on 2026-08-05).

**On the skynet-ec2 host filesystem:**
```
/var/lib/docker/volumes/skynet_skynet-data/_data/global-files.json
```

_(Confirmed via `sudo docker volume inspect skynet_skynet-data | jq -r '.[0].Mountpoint'`
returning `/var/lib/docker/volumes/skynet_skynet-data/_data` — per PATTERNS trap #4:
do NOT hardcode a guessed path; always inspect to confirm.)_

**As of 2026-08-05:** `global-files.json` does NOT yet exist in the volume
(the data directory contains only `db.sqlite.encrypted`, `.env`, `uploads/`, `opkssh/`).
The modal will show an empty state for every host until the seed is written.

---

## Config schema

```json
{
  "hosts": {
    "<hostName-or-hostId>": [
      { "path": "~/.claude/CLAUDE.md", "label": "User CLAUDE.md" }
    ]
  }
}
```

Rules (per plan 23-01's `global-files-config-loader.ts`):
- `hosts` keys accept BOTH host name strings AND numeric-string host IDs
  (name wins if both present — more ergonomic for SSH-hand-editing since
  Ashley won't need to look up hostIds in the DB when adding a new entry).
- `path` is the file path on the target host — supports `~/` for the
  SSH user's home directory (expanded server-side via `echo $HOME`).
- `label` is optional; defaults to `basename(path)` on the frontend.
- Missing config file OR missing host key = empty state in the modal
  (no error; user sees "No global files configured for this host") —
  the loader never throws on ENOENT or parse errors.
- Never fabricate: only paths listed here are accessible via the
  backend endpoints — everything else is 403-rejected (GEFM-04
  whitelist enforcement).
- File size cap: the config loader enforces a 256KB cap as a defense
  against oversized/malicious config files.

---

## Initial seed for skynet-ec2

Ashley's fleet — 8 unix hosts with `~/.claude/CLAUDE.md`.

**Windows hosts (GIGAASHLEYPC) are OMITTED** — no `~/.claude/CLAUDE.md`
to edit, and Windows SSH semantics are out of MVP scope per
CONTEXT §GEFM-06 non-negotiable. GIGAASHLEYPC should NOT be added to
this config until Windows host support is designed in a future phase.

```json
{
  "hosts": {
    "thenasty":          [ { "path": "~/.claude/CLAUDE.md", "label": "User CLAUDE.md" } ],
    "workstation":       [ { "path": "~/.claude/CLAUDE.md", "label": "User CLAUDE.md" } ],
    "ashley-beelink":    [ { "path": "~/.claude/CLAUDE.md", "label": "User CLAUDE.md" } ],
    "ZoeyBattlestation": [ { "path": "~/.claude/CLAUDE.md", "label": "User CLAUDE.md" } ],
    "aither-cloud":      [ { "path": "~/.claude/CLAUDE.md", "label": "User CLAUDE.md" } ],
    "aither-cloud2":     [ { "path": "~/.claude/CLAUDE.md", "label": "User CLAUDE.md" } ],
    "aither-sftp":       [ { "path": "~/.claude/CLAUDE.md", "label": "User CLAUDE.md" } ],
    "skynet-ec2":        [ { "path": "~/.claude/CLAUDE.md", "label": "User CLAUDE.md" } ]
  }
}
```

Host name sanity-check (confirmed 2026-08-05 via `box-map.md`):
- `thenasty` — 100.113.23.63 (tailnet)
- `workstation` — 100.82.225.100 (tailnet, Ubuntu EC2)
- `ashley-beelink` — 100.124.193.5 (tailnet, host id 18)
- `ZoeyBattlestation` — 100.78.107.56 (tailnet)
- `aither-cloud` — AWS aither production
- `aither-cloud2` — AWS aither production (second instance)
- `aither-sftp` — AWS aither SFTP
- `skynet-ec2` — this box itself (100.99.149.8)

---

## How to edit global-files.json on skynet-ec2

Per CLAUDE.md, EC2 admin is AWS SSM only (no public inbound SSH, no
inbound port on the security group). There is NO direct SSH to the EC2.

### Step-by-step operator workflow

**1. SSM into skynet-ec2:**
```bash
aws ssm start-session --target <instance-id> --profile <profile>
```
(Ashley's alias for this may be `skynet-ssm` — check shell aliases in
`~/.zshrc` or `~/.bashrc`. The instance ID is visible in the AWS console
under EC2 → Instances → skynet-ec2.)

**2. Confirm the host-side path (always do this — compose prefix may change):**
```bash
sudo docker volume inspect skynet_skynet-data | jq -r '.[0].Mountpoint'
# Expected output: /var/lib/docker/volumes/skynet_skynet-data/_data
```

**3. Check if global-files.json already exists:**
```bash
sudo ls -la /var/lib/docker/volumes/skynet_skynet-data/_data/
# If global-files.json appears: cat it before editing to see current state.
```

**4. Write or edit the file:**
```bash
sudo vim /var/lib/docker/volumes/skynet_skynet-data/_data/global-files.json
```
(`vim` or `nano` — whichever the operator prefers. If writing from scratch,
paste the seed JSON from §"Initial seed for skynet-ec2" above.)

**5. Validate JSON before saving:**
- If using vim: `:%!jq .` to reformat + validate (bails on parse error —
  vim will show the jq error and leave the buffer unchanged).
- Or drop to a shell after saving: `sudo cat /var/lib/docker/volumes/skynet_skynet-data/_data/global-files.json | jq .` — non-zero exit = broken JSON.

**6. No Skynet restart required.** The loader reads the file on every
request; changes take effect on the next `GET /global-files` call
(i.e. next time the GlobalFilesModal opens).

**7. If the JSON is broken,** the loader logs an error and returns
`{ hosts: {} }` as safe fallback — the modal will show empty state
for every host until the file is fixed. Skynet itself stays up.

---

## Adding new files to a host

Append entries to the host's array. Examples:

```json
"workstation": [
  { "path": "~/.claude/CLAUDE.md", "label": "User CLAUDE.md" },
  { "path": "~/.claude/roles/box-maintainer/box-maintainer.md", "label": "box-maintainer role" },
  { "path": "/opt/skynet/CLAUDE.md", "label": "Project CLAUDE.md" }
]
```

The frontend modal picks these up on next open — no code deploy,
no Skynet restart. The whitelist is enforced server-side (GEFM-04),
so ONLY the paths listed here are readable/writable via the endpoints.

**Path notes:**
- `~/` paths are expanded on the target host via `echo $HOME` — works for
  all unix fleet hosts (Linux only; Windows is not in scope).
- Absolute paths work too (e.g. `/opt/skynet/CLAUDE.md`).
- Paths are shell single-quote-escaped server-side before interpolation
  into `cat`/`stat` commands — operator does NOT need to escape manually.

---

## For a new Skynet instance (e.g. Stacey's ceo-skynet)

The `global-files.json` config is per-Skynet-instance — Ashley's Skynet
has one file, Stacey's ceo-skynet has a different file, both live in
each deployment's own `skynet-data` volume. There is NO shared config;
that is intentional per CONTEXT §non-negotiables ("Files are per-host,
config is per-Skynet-instance").

Bootstrap for a new instance:
1. SSM into the new EC2, run `sudo docker volume inspect skynet_skynet-data`
   (or grep `sudo docker volume ls | grep skynet-data`) to find the
   mount path — the compose prefix may differ if the docker-compose directory
   name differs.
2. Write a `global-files.json` scoped to THAT instance's fleet (may
   be a totally different set of hosts + files).
3. No shared-schema coordination needed.

---

## Verifying the seed lands (smoke test)

After writing `global-files.json`:

1. Open Skynet in a browser (`https://term.gigaashley.click`), log in.
2. Click the MoreVertical menu button in the pretty-conversations
   panel header (top-right of the sidebar — the three-dot overflow button
   added in GEFM-01 wave 1).
3. Click "Edit global files…" — the GlobalFilesModal opens.
4. Pick any of the 8 seeded hosts from the host picker dropdown.
5. Within ~1 second the "User CLAUDE.md" tab appears and the textarea
   loads with that host's actual `~/.claude/CLAUDE.md` content via SSH.
6. (Optional) Add a test line (e.g. `# GEFM smoke test — <date>`), click Save.
7. SSH into the target host and `cat ~/.claude/CLAUDE.md` — the test
   line should be there.
8. Remove the test line + click Save again to leave the file clean.

**Empty state is expected** until the seed is written: the modal shows
"No global files configured for this host" for every host.

---

## Two-key format flexibility (name vs. hostId)

Per plan 23-01's `getFilesForHost` logic, the config loader accepts
BOTH host name strings and numeric-string host IDs:

```json
{
  "hosts": {
    "workstation": [...],    // by name (preferred — readable)
    "7": [...]               // by numeric ID (fallback — survives host rename)
  }
}
```

Name wins if BOTH a name key and an ID key are present for the same
host. Using names is strongly preferred for this seed (SSH-hand-editing
is easier when the key is human-readable rather than a DB integer).

---

*Confirmed: 2026-08-05 — Mountpoint inspected directly on skynet-ec2.*
*Compose prefix: `skynet` (docker-compose.yml lives at `/opt/skynet/`).*
