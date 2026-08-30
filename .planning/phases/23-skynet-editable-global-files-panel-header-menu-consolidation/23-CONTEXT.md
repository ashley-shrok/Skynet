# Phase 23: Skynet editable global files + panel header menu consolidation — Context

**Gathered:** 2026-08-05
**Status:** Ready for planning
**Source:** Hand-authored from ROADMAP.md Phase 23 entry (design fully locked; do NOT re-litigate)

<domain>
## Phase Boundary

Give Ashley a UI-driven way to edit configurable per-host files that live OUTSIDE
the roles/identities paradigm — starting with each host's `~/.claude/CLAUDE.md`
and extensible to any file the deployment operator lists in a per-Skynet-instance
config. Uses the same two-step SSH read/write pattern as Phase 22 SRIC-06's Role
tab (`GET /roles?hostId=<n>` + backend SSH exec-channel). Coupled with a
panel-header menu consolidation: the pretty-conversations panel header has
accumulated action buttons (New agent pencil, `+ New role`, and now the new
Edit-global-files entry), so collapse everything except the Filter button under
a single dropdown menu to keep the header clean. Config file lives in the Skynet
docker volume (portable across deploys — Ashley's Skynet gets one file listed,
Stacy's ceo-skynet gets a different set); edited via SSH for MVP (self-hosted
UI-edit of the config file itself is deferred).

**In-scope:**
- Panel-header dropdown that consolidates the New-agent pencil + `+ New role`
  + new Edit-global-files entries into one Menu button (icon TBD, MoreHorizontal
  / MoreVertical / Plus likely). Filter stays separate. Pinned-count badge stays
  put (it's a badge, not a button).
- JSON config at `/app/data/global-files.json` in the container (mounted from
  the `skynet-data` docker volume — already crown-jewel, already DLM-snapshotted).
- Three backend endpoints (`GET /global-files`, `POST /global-files/read`,
  `PUT /global-files/write`) with dual nginx location blocks (fleet caveat) and
  cookie auth.
- `GlobalFilesModal` React component (host picker → per-file tabs → textarea +
  Save, sized like existing modals, `--color-pv-*` tokens).
- Bootstrap `global-files.json` for skynet-ec2 pre-populated with
  `~/.claude/CLAUDE.md` for each unix fleet host.

**Out-of-scope (deferred):**
- Meta-UI (editing `global-files.json` itself via the same modal, self-referentially).
- Per-user gating (anyone with the admin cookie can read/write — matches Ashley's
  "anyone could edit" decision 2026-08-04).
- Any file editing for a Windows host that doesn't have `~/.claude/CLAUDE.md`
  (Windows hosts omitted from bootstrap, not left in with an error state).
- Multi-tenancy support in the config (skynet-ec2 config vs ceo-skynet config
  are separate files owned by their respective operators, no shared schema).

</domain>

<decisions>
## Implementation Decisions (all LOCKED from ROADMAP Phase 23 entry)

### GEFM-01: Panel-header menu consolidation
- **Filter button** stays separate in `PrettyConversationsPanel` header — unchanged.
- **New Menu button** replaces the current action-button cluster. It collapses the
  existing New-agent pencil + `+ New role` + the new Edit-global-files entry into
  ONE dropdown. Icon TBD by planner (probably `MoreHorizontal` / `MoreVertical` /
  `Plus`).
- **Menu items** open their respective modals as they do now — no behavior change
  on the destinations, only the launcher chrome changes.
- **Header layout ends up:** `[Panel title] ... [Filter] [Menu-dropdown]`. Pinned
  count badge stays where it is (badge, not button).
- **Visual language:** same as existing panel header (`--color-pv-*` tokens, mock
  v4 aesthetic). Do NOT reintroduce Skynet chrome (stripped surfaces stay stripped
  per role file).

### GEFM-02: Config schema + volume mount
- **File location:** `/app/data/global-files.json` in the Skynet container.
- **Volume:** backed by the `skynet-data` docker volume — same volume as the
  crown-jewel encrypted SQLite, so it's already backed up by AWS DLM snapshots
  (no separate backup plumbing needed).
- **Shape:**
  ```json
  {
    "hosts": {
      "<hostName-or-hostId>": [
        { "path": "~/.claude/CLAUDE.md", "label": "User CLAUDE.md" },
        ...
      ]
    }
  }
  ```
- **Host key format:** planner picks either host name string (human-readable,
  human-editable) OR hostId int (survives host rename). Decision TBD by planner
  based on ergonomics of manual SSH-edit workflow.
- **`label`** is optional; defaults to `basename(path)` on the frontend.
- **Missing file OR missing host key** = "no files configured for this host"
  → modal shows empty state. Never fabricate a file that isn't in the config.
- **Bootstrap:** for MVP, the config is edited via SSH into skynet-ec2
  (e.g. `sudo vim /var/lib/docker/volumes/skynet_skynet-data/_data/global-files.json`
  or similar — planner confirms exact host-side path once it inspects the volume
  driver).
- **Meta-UI (editing the config from within the UI itself, self-referentially)
  is DEFERRED to a future phase.**

### GEFM-03: `GET /global-files?hostId=<n>` backend endpoint
- Reads `global-files.json` from the volume, returns the configured file list
  for the given host.
- **Response shape:** `{ files: [{ path, label }] }`. Empty array if no config
  or host not in config (not a 404 — 200 with empty array).
- **Dual nginx location blocks** in BOTH `docker/nginx.conf` AND
  `docker/nginx-https.conf` per fleet caveat.
- **Cookie auth** using the existing admin cookie — no new auth surface.

### GEFM-04: `POST /global-files/read` + `PUT /global-files/write` endpoints
- **`read`** takes `{ hostId, path }`. Whitelist-checks the path against the
  config for that host (rejects any path not listed with 403 — prevents
  arbitrary-file access). SSHes to host, `cat`s the file, returns
  `{ content, mtime, size }`.
- **`write`** takes `{ hostId, path, content, expectedMtime }`. Same whitelist
  enforcement. Optional `expectedMtime` for optimistic-concurrency conflict
  detection: if present AND file has changed since, return 409.
- **Uses the same SSH exec-channel plumbing SRIC-06 uses** — do NOT introduce a
  new subsystem.
- **Dual nginx location blocks** (both configs) per fleet caveat.
- **Cookie auth.** Anyone with the admin cookie can read/write — no per-user
  gating (matches Ashley's `anyone could edit` decision 2026-08-04).

### GEFM-05: `GlobalFilesModal` frontend component
- **New modal** opened from GEFM-01's dropdown Menu.
- **Layout:**
  1. Optional **host picker** (defaults to the currently-selected session's host
     if any; else prompts to pick from the same host list `NewSessionDialog` uses).
  2. **Tabs across the top** for each file the current host has configured
     (via `GET /global-files?hostId=<n>`).
  3. **Each tab** renders a **plain monospace textarea** — whole-file edit, same
     shape as Phase 22 SRIC-06's `RoleFileTab` component (which is the reference
     implementation).
  4. **Save button** per tab. Save fires `PUT /global-files/write` with the
     current content + the mtime received from the read.
- **Loading + error + empty states** mirror `IdentityModal` patterns
  (skeleton on load, error banner with retry, empty-state card when no files).
- **Visual:** `--color-pv-*` tokens, sized like other modals
  (see `IdentityModal`, `CreateRoleDialog`).

### GEFM-06: Config bootstrap + skynet-ec2 initial population
- **Ship an example `global-files.json`** in the docker volume for skynet-ec2,
  pre-populated with `~/.claude/CLAUDE.md` for each of the current unix fleet hosts:
  thenasty, workstation, ashley-beelink, ZoeyBattlestation, aither-cloud,
  aither-cloud2, aither-sftp, skynet-ec2.
- **Windows hosts** (GIGAASHLEYPC and others without `~/.claude/CLAUDE.md`)
  are OMITTED from bootstrap — not left in with an error state.
- **Document the SSH-edit workflow** in a doc — location TBD by planner
  (probably `.planning/phases/23-*/23-BOOTSTRAP.md` or an entry in `box-map.md`).

### Claude's Discretion (planner picks — not in the ROADMAP lock)
- Icon choice for the panel-header Menu button (MoreHorizontal vs MoreVertical
  vs Plus — pick whichever fits the panel header's visual language best).
- Host-key format for `global-files.json` (host NAME string vs host ID int —
  weigh readability of manually-edited JSON against survivability under host
  rename).
- Exact host-side path to the `global-files.json` file for the SSH-edit
  workflow doc (`docker volume inspect skynet-data` on skynet-ec2 to confirm).
- Whether the Menu dropdown is a shadcn `DropdownMenu` or a custom
  popover (should match existing panel-header patterns; check pretty-conversations
  for prior art).
- Whether the modal's per-file tabs use the same shadcn Tabs component
  IdentityModal uses (probably yes — consistency wins).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 22 SRIC-06 — the reference implementation for the read/write pattern
- `.planning/phases/22-skynet-ui-parity-with-the-role-identity-paradigm/22-06-PLAN.md`
  — Role tab shape, backend two-step read/write, whitelist enforcement pattern.
- `src/ui/features/pretty-view/RoleFileTab.tsx` — the textarea + Save UX to
  mirror in `GlobalFilesModal`.
- `src/ui/features/pretty-view/IdentityFileTab.tsx` — sibling pattern also worth
  a look for loading/error/empty states.
- `src/backend/database/routes/role-file-routes.ts` (or equivalent) — the SSH
  exec-channel read/write plumbing to reuse for `global-files/read` + `/write`.

### Phase 22 SRIC-04 — the `+ New role` launcher (prior art for panel-header buttons)
- `src/ui/sidebar/CreateRoleDialog.tsx` — sibling launcher; the button that
  opens it currently lives in the panel header and is one of the items being
  collapsed into the new Menu.
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — the
  panel header where the Menu goes; note the pencil-button + `+ New role`
  button + Filter button + pinned badge layout.

### Existing modals — visual + sizing reference
- `src/ui/features/pretty-view/IdentityModal.tsx` — canonical modal shape
  (DialogHeader, tabs, DialogClose, sizing). Header-drawer pattern I just
  landed in commit `2a183df` may be worth a look for how the pencil/edit-drawer
  interaction works — the `GlobalFilesModal` doesn't need a drawer (edit is
  always-on inside each tab) but the modal chrome is the shape to follow.

### Fleet caveats + role rules
- `~/skynet/CLAUDE.md` — "**Nginx caveat**: Every new backend route needs
  matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`,
  else it 200s with `index.html` and crashes the frontend on `.map`."
- `~/.claude/roles/box-maintainer/box-maintainer.md` — palette rules
  (do NOT chase Skynet's `--background`; use `--color-pv-*` tokens),
  stripped-surfaces list (do NOT reintroduce Skynet chrome).

### Docker + volume plumbing
- `/opt/skynet/docker-compose.yml` — the `skynet-data` volume mount
  (`services.skynet.volumes` entry). Config file lives INSIDE this volume.
- `~/.claude/roles/box-maintainer/box-map.md` — Docker Compose + volumes
  reference.

</canonical_refs>

<specifics>
## Specific Ideas / Existing Patterns to Mirror

- **`RoleFileTab` textarea sizing + monospace font** — copy directly. Do NOT
  reinvent the textarea styling; it's tuned.
- **`IdentityModal` DialogHeader + close button glow** — mirror.
- **`NewSessionDialog` host picker** — the same host list + selection logic.
  Either import + reuse, or extract into a shared `HostPicker` component if the
  planner sees a clean seam.
- **Save button disabled state**: `saving || content === committedContent`
  pattern (see how `IdentityModal`'s edit block computes button disabled).
- **Whitelist rejection = 403 with body `{ error: "path not in whitelist" }`** —
  match SRIC-06's shape.
- **Optimistic-concurrency 409 shape**: `{ error: "mtime mismatch", currentMtime,
  currentContent }` so the modal can offer the user a "reload + retry" or
  "overwrite anyway" affordance (planner decides the exact UX).

</specifics>

<deferred>
## Deferred Ideas

- **Meta-UI** — editing `global-files.json` from within the same modal,
  self-referentially. Deferred by design (per GEFM-02); MVP uses SSH.
- **Per-user gating** — anyone with the admin cookie can read/write. If Ashley
  ever wants finer-grain access control (e.g. a "editor" role separate from
  "admin"), that's a future phase.
- **Multi-file batch save** — modal saves one file at a time (per tab).
  Batch-save across tabs is not in scope.
- **Diff view / conflict resolution UI** — 409 response is documented but the
  frontend UX to resolve the conflict is minimal for MVP (reload + retry).
  A proper 3-way diff view is future work.
- **Windows-host support** — omitted from bootstrap (GEFM-06 explicitly).
  If Ashley later wants to edit files on Windows hosts, that's a separate
  investigation (path semantics, SSH availability, etc.).

</deferred>

<scope_fence>
## Scope Fence

- **Do NOT** add a route for arbitrary path access — whitelist enforcement is
  the whole point; a `?path=` query param that bypasses the config file is a
  fence violation.
- **Do NOT** introduce a new SSH subsystem — reuse SRIC-06's exec-channel
  plumbing.
- **Do NOT** add per-user auth gating — the "anyone with admin cookie" decision
  is locked.
- **Do NOT** ship a meta-UI for editing `global-files.json` in this phase.
- **Do NOT** touch the Filter button or the pinned-count badge in the panel
  header — GEFM-01 is explicitly limited to collapsing the launcher buttons.
- **Do NOT** modify existing modal launchers (`CreateRoleDialog`,
  `NewSessionDialog`) beyond moving how they're invoked from the panel header;
  their internal behavior is unchanged.
- **Do NOT** reintroduce any stripped Skynet chrome (host manager pages,
  snippets manager, admin console, etc. — see role file for the full list).

</scope_fence>

---

*Phase: 23-skynet-editable-global-files-panel-header-menu-consolidation*
*Context gathered: 2026-08-05 — hand-authored from ROADMAP Phase 23 lock*
