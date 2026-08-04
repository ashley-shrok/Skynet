# Phase 22: Skynet UI parity with the role/identity paradigm — Research

**Researched:** 2026-08-04
**Domain:** Skynet full-stack (React/TS frontend + Node/Express + SSH exec/SFTP backend). Fleet-side filesystem role/identity paradigm mirrored into Skynet UI.
**Confidence:** HIGH — all findings rooted in direct codebase inspection at load-bearing files (no library speculation; no external doc lookups needed).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Data model**
- Roles are pure filesystem — **NO Skynet DB column for role**. Adding a role column to `identities` would create a two-source drift problem (Skynet DB vs fleet `<name>.md` frontmatter). Any plan that adds a `role` column is a plan-checker BLOCK.
- The identity's role lives **ONLY in the fleet-side `<name>.md` frontmatter** (`role: <name>`). Backend does the identity-file → frontmatter → role-scoped-artifact two-step for all role-scoped ops. Frontend API stays `(identityKey, hostId)` — never `(role, hostId)`.
- **No `host_id` column added to `identities`.** Source's host for clone comes from the clicked session's host context (Skynet already knows the session's host). Any plan that adds a target-host picker to the clone modal is a plan-checker BLOCK.

**Backend endpoints (new)**
- `roles:list-for-host` — SSHes to host, `ls ~/.claude/roles/`, returns `[{name, description}]`. Description = `## Role` section content per id skill template (planner confirms exact source).
- `roles:create` — takes `(name, description, hostId)`. Validates name (kebab-case-lowercase, doesn't already exist on host). SSHes to host: `mkdir ~/.claude/roles/<name>/` + `mkdir ~/.claude/roles/<name>/bounties/` + `touch ~/.claude/roles/<name>/history.md` + writes stub `<name>.md`.
- `identity:clone` — takes `(sourceIdentityKey, hostId, newName, editedTitle, editedVoice, avatarCandidates)`. `hostId` comes from the clicked session's host context. Reads source's fleet `<name>.md` for role, creates new fleet folder on same host with same `role:` frontmatter + fresh relay account (reuse Phase 20 birth logic), copies Skynet DB row with new name + user-edited fields.
- `identity:get-role-file` / `identity:update-role-file` — do the two-step: identity file → `role:` frontmatter → open `~/.claude/roles/<role>/<role>.md` for read/write. Same shape as existing `identity:get-identity-file` / `identity:update-identity-file`.

**Backend endpoints (repointed)**
- `identity:get-bounties` and `identity:get-history` (or equivalent — exact naming per planner) — extended to do the two-step so they read from `~/.claude/roles/<role>/bounties/` and `~/.claude/roles/<role>/history.md` respectively instead of the identity folder.

**Backend code changes (existing)**
- Phase 20 identity-birth code (`identity-birth-orchestrator.ts` and callers) — when writing the new slim `<name>.md` pointer file, include `role: <picked-role>` in the frontmatter. Birth submit payload adds `role` field passed through from NewSessionDialog.

**Frontend surfaces**
- **NewSessionDialog** — new REQUIRED `Role` dropdown, positioned near host picker. Populates via `roles:list-for-host`; re-populates when host changes. Blocks submit if empty. Submit payload adds `role` field.
- **Clone modal** — new component (probably `CloneAgentDialog.tsx`, or NewSessionDialog with a `mode="clone"` prop — planner's call). Fields: Name (required, blank, default `<source>-2`), Title (editable, pre-filled from source), Voice (editable, pre-filled from source), Avatar (pre-filled with source's; option to regen 3 new candidates via Phase 20 avatar batch flow). Host + Role + Color are LOCKED — NOT shown or editable.
- **Context menu** — add `Clone` item to `PrettyConversationContextMenu`'s items array via `PrettyConversationsPanel` (actual builder lives in `PrettyConversationRow.tsx`, see finding P4 below). `onClick` reads clicked row's host from existing session context and opens clone modal.
- **CreateRoleDialog** — new component. Fields: Name (required, kebab-case-lowercase, validated), Description (required), Host picker (same set NewSessionDialog uses), checkbox `Then create an identity with this role` DEFAULT `true`.
- **`+ New role` launcher** — button placement MVP is sidebar next to `+ New agent` (planner may adjust).
- **IdentityModal** — new Role tab as FIRST tab (position 0), `activeTab = "role"` as default. Add lucide icon (probably `Users` — planner picks). New `RoleFileTab.tsx` mirrors `IdentityFileTab.tsx` pattern.

**UX rules**
- **Clone is true-to-the-word.** Host/Role/Color are auto-copied and LOCKED. Only Name/Title/Voice/Avatar editable. Any plan that exposes host/role/color as editable on clone is a plan-checker BLOCK.
- **Required-role dropdown is CREATE-only.** No affordance to edit an identity's role assignment anywhere in the UI.
- **`Then create an identity with this role` defaults to TRUE.** Ashley: "obviously going to want an identity to take on the new role otherwise you'll have a role without any identities."
- **Role tab is FIRST and DEFAULT** in IdentityModal — not slotted after Identity, not toggleable in position.
- **Chain from create-role modal to create-identity modal** happens on submit only when checkbox is TRUE. Skips chain when unchecked.

**Failure modes / edge cases**
- **Zero roles on selected host** in the NewSessionDialog dropdown — MVP shows a "no roles on this host — create one first" link that opens CreateRoleDialog (planner may pick simpler "just empty dropdown"; either is acceptable).
- **Clone name collision** with existing fleet folder on target host — clone endpoint validates before writing and returns an error the modal surfaces inline.
- **No no-role fallback branches anywhere.** Ashley confirmed 2026-08-04 no fleet identity lacks `role:` frontmatter post-migration. Any plan that adds "graceful (no role)" fallback branches or empty-state handling is a plan-checker BLOCK (dead code).

### Claude's Discretion (planner picks during planning)
- **Description source** in `roles:list-for-host`: first non-heading paragraph vs `## Role` section content. Default `## Role` (matches id skill template).
- **Placement of `+ New role` button**: sidebar next to `+ New agent`, gear menu, or another obvious spot.
- **Clone modal architecture**: new dedicated `CloneAgentDialog.tsx` vs NewSessionDialog with a `mode="clone"` prop.
- **Description placement in stub `<role>.md`**: under `## Role` (matches id skill template), plain-text before any heading, or its own `## Description` heading. Default `## Role`.
- **Clone name uniqueness validation**: almost certainly a pre-write check against existing fleet folders on target host.
- **`role:` frontmatter parser**: reuse existing YAML frontmatter parser if it exists, else add a minimal one.
- **Icon for the Role tab**: probably `Users` from lucide, planner picks.
- **When chained into NewSessionDialog with role + host pre-filled, are those fields editable or locked?** Default: pre-filled but editable.

### Deferred Ideas (OUT OF SCOPE)

Explicitly out of scope for this phase (from design-and-waves.md):

- **Delete role / delete identity affordances.** Future bounty if needed.
- **A dedicated "Manage roles" list surface.** MVP is just the `+ New role` launcher button; a list surface can come later.
- **Display of role outside IdentityModal.** No badge on avatar in conversation list, no filter-by-role, no role in the sidebar. IdentityModal is the only surface where role is visible in this phase.
- **Backfill legacy Skynet DB rows with role information.** Moot — no DB column exists (roles are filesystem-only).
- **No-role fallback / graceful empty branches.** Ashley confirmed no such identities exist post-migration; adding dead code branches is a plan-checker BLOCK.
- **Editing an identity's role assignment.** Not supported in this phase. Users edit role frontmatter directly via the identity file (visible in the existing Identity tab) if they need to change it.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SRIC-01 | Repoint IdentityModal Bounties + History tabs to role folder via backend two-step | Finding B2 (existing `identity:get-bounties`/`identity:get-history` handlers) + B3 (`identity-artifact-reader.ts` has one function per artifact — extend both funcs to do the two-step; frontend `IdentityModal.tsx` untouched per D-1a). |
| SRIC-02 | Add `roles:list-for-host` endpoint + Phase 20 birth writes `role:` frontmatter + required Role dropdown on NewSessionDialog | Finding B4 (birth orchestrator step 5 delegates to `/id` skill on the box, which then interactively PROMPTS for a role — this is a load-bearing conflict; see Finding B4b for the two viable resolutions) + Finding F1 (NewSessionDialog host picker + collision precheck already established at L317-403). |
| SRIC-03 | Clone flow — context menu + clone modal + backend clone endpoint | Finding F3 (`PrettyConversationContextMenu` item shape) + F4 (item builder is inside `PrettyConversationRow.tsx` L562-585 — NOT PrettyConversationsPanel as design-and-waves.md said) + Finding F5 (row already carries `row.host` for host context) + Finding B4 (birth logic can be extracted/reused). |
| SRIC-04 | Create-role modal + backend endpoint + `+ New role` launcher | Finding F1 (host picker reusable via `collectAllHosts` inline helper, currently duplicated inside NewSessionDialog — pattern for CreateRoleDialog to mirror) + Finding B6 (SSH primitives: `connectOneShot` + `execCommand` from `tmux-helper.ts` cover all mkdir/touch/write ops). |
| SRIC-05 | Chain create-role → create-identity with role + host pre-filled when checkbox true | Finding F1 (NewSessionDialog is controlled by parent `open` prop and takes initial state through props; wiring a `initialRole` + `initialHost` prop pattern is straightforward). |
| SRIC-06 | Role tab as FIRST/default tab in IdentityModal + `identity:get-role-file`/`identity:update-role-file` ops doing two-step | Finding F2 (NAV_SECTIONS array at IdentityModal.tsx:202-208; activeTab default at L167 = "identity") + Finding B7 (`writeMarkdownFileAtomic` SFTP helper already exists; new writers are byte-shape mirrors of `writeIdentityFile`). |
</phase_requirements>

## Summary

Phase 22 is **overwhelmingly additive** — six coordinated pieces that layer on top of very mature Phase 18 (IdentityModal full editability) and Phase 20 (identity creation UI + birth orchestrator) infrastructure. The backend has established patterns for both LOCAL (bind-mount) and REMOTE (SSH exec / SFTP) reads and atomic writes across `~/.claude/identities/<key>/*`; extending them to `~/.claude/roles/<role>/*` is a one-file addition to `identity-artifact-reader.ts` plus new WS handlers in `claude-session-server.ts` and one new HTTP route each for `roles:list-for-host`, `roles:create`, `identity:clone`. The frontend has established modal and context-menu patterns; extending them is straightforward.

**The one load-bearing wrinkle** is SRIC-02's requirement that "Phase 20 identity-birth code writes `role:` frontmatter into new `<name>.md`" — the birth orchestrator's Step 5 sends `/id <name>` into the tmux session, and the `/id` skill on the box then INTERACTIVELY asks the user which role. Skynet cannot inject `role:` into a file that hasn't been created yet. See Finding B4b for the two resolutions; the planner must pick one before Wave 1b.

**Primary recommendation:** Reuse the existing `identity-artifact-reader.ts` LOCAL/REMOTE branch pattern verbatim for every new role-folder read/write. Reuse `writeMarkdownFileAtomic` (SFTP + `ext_openssh_rename`) for role file writes. Reuse `js-yaml` (already in `package.json`) for the frontmatter parse in the two-step. Do NOT hand-roll a frontmatter parser.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Role folder ls / read / write on target host | API/Backend (SSH + SFTP) | — | Every fleet operation MUST traverse SSH exec / SFTP; browser never talks to remote hosts directly. Established Phase 18/20 pattern. |
| Role dropdown population (roles:list-for-host) | API/Backend | Frontend (subscribe) | Backend enumerates via SSH; frontend fetches + renders. |
| Two-step (identity file → frontmatter → role artifact) | API/Backend | — | Frontend API stays `(identityKey, hostId)` — the two-step is a backend-internal implementation detail per LOCKED decision. Frontend never learns the role. |
| Role-file YAML frontmatter parse | API/Backend (`js-yaml`) | — | Parse must happen adjacent to the SSH read so the second SSH round-trip (for the role artifact) can fire before returning to the wire. |
| Clone identity submit | API/Backend (new /identities/clone HTTP route OR WS `identity:clone`) | Frontend (modal state) | Composite operation touching Skynet DB + fleet folder create + relay account register — same tier as Phase 20 identity-birth. |
| Clone context menu integration | Frontend (`PrettyConversationRow.tsx` items[] builder) | — | Context menu items are constructed inline at the row level (Finding F4). |
| Chain create-role → create-identity | Frontend (parent state coordinating two dialogs) | — | Pure UI orchestration; no backend involvement in the chain itself. |
| Role tab render + edit | Frontend (`RoleFileTab.tsx`) | API/Backend (read/write) | Byte-shape mirror of `IdentityFileTab.tsx`. |
| YAML frontmatter write (updating identity file with `role:`) | API/Backend (existing `writeIdentityFile` SFTP path) | — | Existing writer overwrites the whole file; the caller reads → mutates frontmatter → writes back. |

## Standard Stack

### Core (already in project — reuse verbatim)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `js-yaml` | `^4.1.1` [VERIFIED: `/home/ubuntu/skynet/package.json:58`] | Frontmatter YAML parse | Already a direct dependency, already used in `src/backend/ssh/opkssh-auth.ts:14` for YAML parsing. No new package needed. |
| `@types/js-yaml` | `^4.0.9` [VERIFIED: `/home/ubuntu/skynet/package.json:112`] | TS types for js-yaml | Already present. |
| `ssh2` | (project's existing ssh2 pin) | SSH exec + SFTP | Used pervasively; `execCommand` in `tmux-helper.ts` and SFTP in `identity-artifact-reader.ts` cover every needed primitive. |
| `radix-ui` Dialog | (project's existing pin) | New CreateRoleDialog + CloneAgentDialog | Existing IdentityModal + NewSessionDialog both use `@/components/dialog` (shadcn wrapper over Radix). |
| `lucide-react` | (project's existing pin) | New tab icon (`Users` for Role tab) | Already imported at `IdentityModal.tsx:2`. |
| React 18 / TypeScript | (project's existing pins) | Frontend | — |
| Express 4 | (project's existing pin) | Backend HTTP routes | — |

### Supporting (already in project)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `nanoid` | (existing) | Generate new identity `id` for cloned DB row | Clone endpoint — matches `identity-birth.ts:69` pattern. |
| `drizzle-orm` | (existing) | Skynet DB row read/insert | Clone endpoint — matches `identity-birth.ts:72-86` pattern. |
| `sharp` | (existing) | Avatar image transform | Clone regen path if the modal offers a regenerate — matches `identity-avatar-batch.ts` pattern. |
| `multer` | (existing) | If clone modal ships avatar bytes via multipart | Only if avatars are re-uploaded; if reusing the avatar-batch candidate-cache flow, multer is not needed for the new clone endpoint (candidate ID lookup is enough — see Finding B5). |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `js-yaml` for frontmatter | Hand-rolled 20-line regex-based parser | Already a dep; wide/battle-tested; handles multi-line values + edge cases we don't want to reimplement. `js-yaml` wins unambiguously. Do NOT hand-roll. |
| New `identity:clone` WS message | New `POST /identities/clone` HTTP endpoint | The birth flow uses HTTP+SSE for streaming progress; clone is a shorter operation (no `/id` bootstrap dance), so both are viable. Recommend HTTP POST (returns final identity object) to mirror `POST /identities` — clone is fundamentally an identity-creation op. |
| Extend `NewSessionDialog` with `mode="clone"` | New `CloneAgentDialog.tsx` component | Design says planner picks. Recommend NEW component — clone has locked host/role/color, no path/collision precheck, no birth-stream; the divergence overwhelms the shared code. Extract `HostPicker` + `AvatarPicker` sub-components if desired later. |
| Backend two-step over one WS round-trip | Two separate WS round-trips (frontend does the compose) | LOCKED — CONTEXT.md says frontend API stays `(identityKey, hostId)`. No reversal available. |

**Installation:** No new npm packages required. All dependencies already in `package.json`.

## Package Legitimacy Audit

Not applicable — this phase introduces **zero new npm packages**. All required libraries (`js-yaml`, `ssh2`, `radix-ui`, `lucide-react`, `nanoid`, `drizzle-orm`, `sharp`, `multer`) are pre-existing direct dependencies of `/home/ubuntu/skynet/package.json` [VERIFIED via grep].

## Architecture Patterns

### System Architecture Diagram

```
                       ┌──────────────────────────────────────────┐
                       │ Frontend (React, browser)                │
                       │                                          │
User right-click on ──▶│  PrettyConversationRow.tsx (row.host)    │
conversation row       │      │                                   │
                       │      ▼ items[] builder                   │
                       │  PrettyConversationContextMenu           │
                       │      │                                   │
                       │      ▼ Clone onClick                     │
                       │  CloneAgentDialog.tsx (NEW)              │
                       │      │  fields: Name/Title/Voice/Avatar  │
                       │      ▼ submit                            │
                       │  POST /identities/clone (NEW)            │
                       │      { sourceIdentityKey, hostId,        │
                       │        newName, title, voice,            │
                       │        avatarCandidateId }               │
                       └──────────────────────────────────────────┘
                                        │
                                        ▼
                       ┌──────────────────────────────────────────┐
                       │ Backend (Node/Express, backend/)         │
                       │                                          │
                       │  identity-clone.ts (NEW route)           │
                       │      │                                   │
                       │      ├─▶ SSH: cat source's <name>.md     │
                       │      │   (via identity-artifact-reader   │
                       │      │    .readIdentityFile)             │
                       │      │                                   │
                       │      ├─▶ js-yaml parse frontmatter       │
                       │      │   → extract role                  │
                       │      │                                   │
                       │      ├─▶ SSH: verify newName folder      │
                       │      │   doesn't collide on hostId       │
                       │      │                                   │
                       │      ├─▶ SSH: mkdir + write new          │
                       │      │   <newName>.md with role: <role>  │
                       │      │   (SFTP + ext_openssh_rename)     │
                       │      │                                   │
                       │      ├─▶ Homeserver POST /register       │
                       │      │   (reuse from id skill pattern —  │
                       │      │    the birth orchestrator does    │
                       │      │    NOT do relay register today,   │
                       │      │    the /id skill runs it)         │
                       │      │                                   │
                       │      ├─▶ Skynet DB: INSERT identities    │
                       │      │   with new nanoid id, copied      │
                       │      │   fields, user-edited fields      │
                       │      │                                   │
                       │      └─▶ Response: publicIdentity(row)   │
                       └──────────────────────────────────────────┘

Data flow for SRIC-01 (repointed Bounties/History reads):
  Frontend IdentityModal.tsx
      │ identity:list-bounties { identityKey, hostId }
      ▼ WS
  claude-session-server.ts handler
      │
      ▼ readIdentityBounties(conn, identityKey)   ← existing signature
  identity-artifact-reader.ts NEW two-step:
      1. Read <identityKey>/<identityKey>.md (existing readIdentityFile)
      2. js-yaml.load(frontmatterBlock) → extract role
      3. Read <role>/bounties/ (NEW logic, mirrors current bounties-dir logic
         but rooted at ~/.claude/roles/<role>/bounties/ not
         ~/.claude/identities/<identityKey>/bounties/)
      4. Return {bounties, archivedBounties} unchanged wire shape

Data flow for SRIC-06 (Role tab):
  Frontend RoleFileTab.tsx (NEW, byte-shape mirror of IdentityFileTab.tsx)
      │ identity:get-role-file { identityKey, hostId }
      ▼ WS
  claude-session-server.ts NEW handler (mirrors identity:get-identity-file)
      │
      ▼ readRoleFile(conn, identityKey)  ← NEW helper in identity-artifact-reader.ts
      1. Read <identityKey>/<identityKey>.md → extract role
      2. Read <role>/<role>.md
      3. Return {markdown}
```

### Recommended Project Structure (deltas from existing tree)

```
src/backend/claude-session/
├── identity-artifact-reader.ts          # EDIT: add readRoleFile / writeRoleFile /
│                                        #       modify readIdentityBounties + readIdentityHistory
│                                        #       to do the two-step. Add frontmatter parser helper
│                                        #       (js-yaml.load on the block between --- markers).
├── claude-session-server.ts             # EDIT: add identity:get-role-file / identity:update-role-file
│                                        #       handlers (byte-shape mirrors of get-identity-file /
│                                        #       update-identity-file). Repoint get-bounties + get-history
│                                        #       handlers (or the reader they call — see planner call).

src/backend/database/routes/
├── roles-list-for-host.ts               # NEW: GET /roles?hostId=<n>
├── roles-create.ts                      # NEW: POST /roles
├── identity-clone.ts                    # NEW: POST /identities/clone
└── identity-birth-orchestrator.ts       # EDIT: if resolution B4b(a) picked — accept role param + inject
                                         #       role: <role> into the pre-birth <name>.md write
                                         #       (currently the birth code does NOT write <name>.md; the
                                         #       /id skill does — see Finding B4).

src/ui/features/pretty-view/
├── IdentityModal.tsx                    # EDIT: reorder NAV_SECTIONS — Role first + default activeTab
├── RoleFileTab.tsx                      # NEW: byte-shape mirror of IdentityFileTab.tsx
└── (BountyCard, HistoryTab, HandoffTab — untouched; backend does the repoint)

src/ui/features/pretty-conversations/
├── PrettyConversationRow.tsx            # EDIT: add Clone item to items[] builder at L562-585
└── PrettyConversationsPanel.tsx         # EDIT: thread onClone callback prop; wire CloneAgentDialog open state

src/ui/sidebar/
├── NewSessionDialog.tsx                 # EDIT: add Role dropdown; wire host-change re-populate;
│                                        #       add role to birth submit payload; accept initialRole +
│                                        #       initialHost props for chain-from-create-role
├── CreateRoleDialog.tsx                 # NEW: name + description + host picker + checkbox
└── CloneAgentDialog.tsx                 # NEW: same-host + same-role locked; name + title + voice + avatar

src/ui/api/
├── identities-api.ts                    # EDIT: add cloneIdentity, listRolesForHost, createRole
└── claude-session-api.ts                # EDIT: add IdentityGetRoleFilePayload + IdentityRoleFileEvent +
                                         #       IdentityUpdateRoleFilePayload + IdentityRoleFileUpdatedEvent
                                         #       (byte-shape mirrors of the identity-file counterparts)

docker/
├── nginx.conf                           # EDIT: add location blocks for /roles + /identities/clone
└── nginx-https.conf                     # EDIT: same location blocks (per CLAUDE.md)
```

### Pattern 1: LOCAL/REMOTE branch reader in identity-artifact-reader.ts

**What:** Every artifact reader has two branches — LOCAL (`conn === null` → `fs.readFile` from bind-mount) and REMOTE (`conn: SSHClient` → `execCommand` cat / SFTP read).
**When to use:** Every new role-folder reader (`readRoleFile`, `readRoleBounties`, `readRoleHistory`).
**Example:** [VERIFIED: `/home/ubuntu/skynet/src/backend/claude-session/identity-artifact-reader.ts:215-249`]

```typescript
export async function readIdentityFile(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ markdown: string }> {
  if (conn === null) {
    // LOCAL branch
    const root = getLocalIdentitiesRoot();
    const filePath = path.join(root, identityKey, identityKey + ".md");
    try {
      const markdown = await fs.readFile(filePath, "utf-8");
      return { markdown };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { markdown: "" };
      throw err;
    }
  }
  // REMOTE branch — direct interpolation is safe because identityKey is validated by IDENTITY_KEY_RE
  const cmd = `cat "$HOME/.claude/identities/${identityKey}/${identityKey}.md" 2>/dev/null || true`;
  const stdout = await execWithTimeout(conn, cmd);
  return { markdown: stdout };
}
```

New role helpers mirror this signature verbatim, substituting `~/.claude/roles/<role>/…` for the path.

### Pattern 2: One-shot WS request/response in IdentityModal.tsx

**What:** Frontend opens a fresh WS per request, sends payload on `onopen`, waits for the matching response type on `onmessage`, closes the WS.
**When to use:** All new role-artifact reads/writes from RoleFileTab.tsx.
**Example:** [VERIFIED: `/home/ubuntu/skynet/src/ui/features/pretty-view/IdentityModal.tsx:243-277` (`openOneShot`) + L459-486 (`sendIdentityMutation`)]

Byte-shape mirror those helpers for role-file read/write.

### Pattern 3: Two-step (identity file → frontmatter → role artifact)

**What:** Backend-internal composition. Read `~/.claude/identities/<key>/<key>.md`, parse the `---`-delimited YAML frontmatter block with `js-yaml.load`, extract `role`, then read the role-scoped artifact.
**When to use:** All role-scoped backend ops (SRIC-01 bounties/history repoint, SRIC-06 role file read/write, SRIC-03 clone).
**Example (proposed):**

```typescript
// New helper in identity-artifact-reader.ts (proposed shape):
import yaml from "js-yaml";

/** Extract the role name from the identity file's YAML frontmatter.
 *  Returns null when frontmatter is missing or role: is absent.
 *  (But per CONTEXT.md every fleet identity post-migration has role: — the null
 *  case here only happens if backend races a mid-file-write; caller throws.) */
function extractRoleFromMarkdown(markdown: string): string | null {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  try {
    const parsed = yaml.load(match[1]) as Record<string, unknown>;
    const role = parsed?.role;
    return typeof role === "string" && role.length > 0 ? role : null;
  } catch { return null; }
}

/** Resolve role from an identity's fleet file. Throws if role is missing —
 *  per CONTEXT.md this MUST NOT be a graceful fallback branch. */
async function resolveRoleForIdentity(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<string> {
  const { markdown } = await readIdentityFile(conn, identityKey);
  const role = extractRoleFromMarkdown(markdown);
  if (!role) throw new Error(`identity ${identityKey} has no role: frontmatter`);
  if (!IDENTITY_KEY_RE.test(role)) throw new Error(`role ${role} fails IDENTITY_KEY_RE gate`);
  return role;
}
```

### Anti-Patterns to Avoid

- **Don't add a `role` column to the `identities` table** — LOCKED by CONTEXT.md as a plan-checker BLOCK.
- **Don't hand-roll a YAML parser** — `js-yaml` is already in `package.json` and used at `src/backend/ssh/opkssh-auth.ts:14`.
- **Don't cache the role→identity mapping on the frontend** — every read goes through the two-step so the mapping stays authoritative on disk. Any FE cache would violate the "frontend API stays `(identityKey, hostId)`" contract.
- **Don't expose `mode="clone"` on NewSessionDialog** unless you're prepared to guard every code path (birth stream, collision precheck, path field, brief field, identity-mode checkbox) with `!clone` conditions. Recommend a new `CloneAgentDialog.tsx` component.
- **Don't skip either nginx config** — `docker/nginx.conf` AND `docker/nginx-https.conf` need matching `location` blocks for every new backend HTTP route or it 200s with `index.html` and crashes the frontend on `.map` (project CLAUDE.md L43-46, load-bearing).
- **Don't try to inject `role:` into `<name>.md` before Step 5 of the birth orchestrator** — the file doesn't exist yet; the `/id` skill creates it. See Finding B4 for why this is subtle.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Parse YAML frontmatter block | Regex + manual state machine | `js-yaml` (already a dep) `yaml.load(match[1])` on the `---`-delimited block | Multi-line strings, quoted values, comments, escape sequences — a hand-roller invariably reintroduces YAML bugs. |
| Write markdown file atomically over SSH | Manual `echo … > tmpfile && mv tmpfile <target>` in one shell command | `writeMarkdownFileAtomic` from `identity-artifact-reader.ts:852-906` (SFTP + `ext_openssh_rename`) | Existing helper handles the OpenSSH sftp.rename EEXIST trap (see prologue at L826-849 — a fresh implementation WILL rediscover this bug in production). |
| SSH exec against a host | Fresh ssh2 client + hand-managed events | `connectOneShot(host, timeoutMs)` from `src/backend/ssh/ssh-one-shot.ts` + `execCommand(conn, cmd)` from `src/backend/ssh/tmux-helper.ts` | Established, tested, handles connect timeout + error cleanup uniformly. |
| Resolve a host by ID with credentials | Direct SQL + credential decryption | `resolveHostById(hostId, userId)` from `src/backend/ssh/host-resolver.ts` | Wraps `SimpleDBOps.select` with `ssh_data` credential decryption; handles JSON field parsing (jumpHosts, tunnelConnections, etc.). |
| Register a Matrix relay account | Manually POST to homeserver | Reuse the id skill's self-register block pattern (agent-side script that Skynet-side clone can invoke via SSH into the target host, OR Skynet does its own POST to the homeserver directly) | id skill has already worked through open-registration on the tailnet homeserver — pattern is stable. See Finding B4c for the choice. |
| One-shot WS request/response with response type filtering | Hand-managed WS listeners scattered across the component | `openOneShot` helper at `IdentityModal.tsx:243-277` + `sendIdentityMutation` at L459-486 | Pattern well-established; every new role-artifact fetch/write should mirror it byte-shape. |
| Modal chrome | Custom overlay + focus trap + escape handling | shadcn `Dialog` (`@/components/dialog`) — same pattern as `NewSessionDialog`, `IdentityModal` | The IdentityModal has already worked through Radix's dismissable-layer + onInteractOutside gotchas (see `IdentityModal.tsx:857-874` comment block); reuse the pattern verbatim. |

**Key insight:** The backend infrastructure for artifact reads/writes over SSH is mature to the point that role-folder support is a pure copy-with-path-substitution exercise. The one place that requires real thought is the birth-time `role:` frontmatter injection (Finding B4).

## Runtime State Inventory

Not applicable — Phase 22 is a feature/UI/API phase with **no rename, refactor, or migration component**. No stored data or runtime state needs to be re-indexed or re-registered. This section is intentionally omitted per the research protocol's "greenfield phase, no runtime state to inventory" clause.

## Findings — Detailed answers to the additional research targets

### F1. NewSessionDialog host picker component

**File:** `/home/ubuntu/skynet/src/ui/sidebar/NewSessionDialog.tsx` (916 lines).

**Host list construction:** The dialog takes `hostTree: HostFolder | null` as a prop (L239) and computes a flat host list via an **inline** `collectAllHosts(children)` DFS helper (L87-97) and a `flatHosts` memo (L284-298) that filters `enableRdp !== true`. The host picker UI itself is **inlined at L590-633** — a `<div role="listbox">` with `<button role="option">` children rendered from `filteredHosts.map(...)`. There is NO extracted `HostPicker` component.

**Reusability implication for CreateRoleDialog / clone chain (SRIC-04 / SRIC-05):** The host picker can be re-implemented inline in CreateRoleDialog with the same 44-line block, OR extracted into a reusable `<HostPickerList hostTree={...} selectedHost={...} onSelectHost={...} disabled={...} />` component. Recommend extraction (~50 lines of gained-back-testability across three dialogs).

**Chain into NewSessionDialog:** The dialog is opened by parent-controlled `open` state and has no `initialHost` / `initialRole` prop today. Wiring the chain (SRIC-05) requires adding those two props (both optional) and using them as the seed for `selectedHost` and the new `role` state.

**Failure-mode gotcha to preserve:** Multipart PUT `data` field silent-no-op guard (`IdentityModal.tsx:781-787` for colorHue) — clone endpoint that ships avatar bytes as multipart MUST include a GET-verify check on the response echo. If we use the avatar-batch candidate-cache flow instead (candidate ID → server-side lookup), we avoid the multipart trap entirely.

### F2. IdentityModal current tab data flow

**File:** `/home/ubuntu/skynet/src/ui/features/pretty-view/IdentityModal.tsx` (1360 lines).

**Tab array:** `NAV_SECTIONS` at L202-208 defines five tabs in order: `identity` / `bounties` / `history` / `wakeups` / `handoff`. **Default `activeTab = "identity"`** at L167. Icons come from `lucide-react` (`User`, `Target`, `Clock`, `AlarmClock`, `Handshake`) imported at L2.

**Data flow (all four current markdown tabs):**
1. Modal opens → `useEffect` at L223 fires FIVE parallel WS one-shot requests (bounties + identity-file + history + wakeups + handoff) via `openOneShot(...)` helper (defined inline at L243-277).
2. Each request payload has shape `{ type: "identity:get-<artifact>", identityKey, hostId }` — see L331-366.
3. Backend handler in `claude-session-server.ts` (L1815-2050 for reads, later for writes) routes to `identity-artifact-reader.ts` helpers.
4. Response events (`identity:<artifact>`) land in `onmessage`; state slot updates via `setIdentityFileState({ status: "ready", data: ev.markdown })`.
5. Tab renderers (`IdentityFileTab`, `HistoryTab`, `HandoffTab`) accept `state: TabState<T>` + optional `onSave: (contents) => Promise<void>` prop. When `onSave` is threaded, edit-mode toolbar renders.

**Backend ops invoked:**
- `identity:list-bounties` → `readIdentityBounties(conn, identityKey)` → reads `~/.claude/identities/<key>/bounties/` open + archive dirs
- `identity:get-identity-file` → `readIdentityFile(conn, identityKey)` → reads `~/.claude/identities/<key>/<key>.md`
- `identity:get-history` → `readIdentityHistory(conn, identityKey)` → reads `~/.claude/identities/<key>/history.md`
- `identity:list-wakeups` → `readIdentityWakeups(conn, identityKey)` → reads `~/.claude/identities/<key>/wakeups/*.json`
- `identity:get-handoff` → `readIdentityHandoff(conn, identityKey)` → reads `~/.claude/identities/<key>/handoff.md`

**Load-bearing for SRIC-01:** The Bounties + History reads currently root at the IDENTITY folder — the migration moved these to the ROLE folder. So `readIdentityBounties` and `readIdentityHistory` (in `identity-artifact-reader.ts`) MUST be modified to do the two-step: read identity file → extract role → read role folder. The frontend `IdentityModal.tsx` is UNTOUCHED for SRIC-01 (design decision: two-step is backend-internal).

**Load-bearing for SRIC-06:** Adding the Role tab means (a) inserting a sixth entry to `NAV_SECTIONS` at index 0, (b) changing default `activeTab` from `"identity"` to `"role"` at L167, (c) adding a sixth parallel WS one-shot to the fetch effect at L331, (d) adding a new `RoleFileTab.tsx` component that mirrors `IdentityFileTab.tsx` byte-for-byte, (e) adding a save handler `updateRoleFile` byte-shape-mirroring `updateIdentityFile` at L514-528.

### F3. PrettyConversationContextMenu items shape

**File:** `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx` (164 lines).

**Item shape (L23-27):**
```typescript
export interface PrettyContextMenuItem {
  label: string;
  onClick: () => void;
  danger?: boolean;
}
```

**Menu props (L29-35):**
```typescript
export interface PrettyConversationContextMenuProps {
  x: number;
  y: number;
  items: PrettyContextMenuItem[];
  hue?: number | null;
  onClose: () => void;
}
```

The component is **generic** — it takes an already-constructed `items[]` array. Adding a Clone item means pushing a new entry into the array at the caller's builder.

### F4. Where items[] is actually constructed

**File:** `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.tsx` (592 lines).

**IMPORTANT DISCREPANCY vs design-and-waves.md:** The design says "add `Clone` item to `PrettyConversationContextMenu`'s items array via `PrettyConversationsPanel`." In reality, the items[] array is constructed **inline inside `PrettyConversationRow.tsx` at L562-585** — NOT in PrettyConversationsPanel:

```typescript
items={((): PrettyContextMenuItem[] => {
  const items: PrettyContextMenuItem[] = [];
  items.push({ label: pinned ? "Unpin" : "Pin", onClick: onTogglePin });
  if (onToggleHide) {
    items.push({ label: hidden ? "Unhide" : "Hide", onClick: onToggleHide });
  }
  if (inActiveSet && onDeactivate) {
    items.push({ label: "Deactivate", onClick: onDeactivate, danger: true });
  }
  return items;
})()}
```

The row receives `onTogglePin` / `onToggleHide` / `onDeactivate` as **props threaded down from PrettyConversationsPanel** (each is either provided or omitted, and the item is conditionally added based on presence). So to add Clone:

1. Add a new optional `onClone?: () => void` prop to `PrettyConversationRow` (near L133).
2. In items[] builder (L562-585), push `{ label: "Clone", onClick: onClone }` if `onClone` is defined AND row is non-RDP AND row has an identity.
3. Thread `onClone` from `PrettyConversationsPanel` (which owns the CloneAgentDialog open state) down through `PrettyConversationRowLive` wrapper (L113-162) to the row.
4. On click: capture `(sourceIdentityKey, hostId)` from row context — `row.host.id` gives the host, identity resolves via `useIdentities().byKey.get(sessionMatchKey(row.targetTmuxSession))` at L185-187.

**Context available at click time:** `row.host: Host | null` (host.id is a string, parseInt to number), `row.targetTmuxSession: string | null`, `identity: Identity | null` (with `identity.identityKey`), `hue: number | null`.

### F5. row.host shape

Row's host comes from `ConversationRow` (state store) with `row.host?.id: string` (needs parseInt to number for backend contract). No target-host picker needed for clone — the source's host IS the target's host per the LOCKED "same host" clone rule.

### F6. Phase 20 avatar-batch flow reuse for clone regeneration

**Endpoint contract:** `POST /identities/avatar/batch` with JSON body `{ name, title, brief }` → returns `{ candidates: [{ id, url }, ...] }` (3 candidates).

**Files:**
- Route: `/home/ubuntu/skynet/src/backend/database/routes/identity-avatar-batch.ts` (461 lines).
- Frontend client: `/home/ubuntu/skynet/src/ui/api/identities-api.ts:88-99` (`postGenerateAvatarBatch`).

**Flow:**
1. Client calls `postGenerateAvatarBatch({ name, title, brief })`.
2. Server calls OpenAI `gpt-4o-mini` chat completions with `ARCHETYPE_SYSTEM_PROMPT` (L155-170) to draft an image-generation prompt from the name/title/brief.
3. Server calls OpenAI `gpt-image-1` three times in parallel with the drafted prompt.
4. Server applies gamma 0.7 correction via raw pixel manipulation (L132-149).
5. Server stores each PNG buffer in the in-memory `candidateCache` (Map, TTL 10 min, per-user cap 15, global cap 100).
6. Returns `[{ id, url: "/identities/avatar/candidate/<id>" }]`.
7. Later: `POST /identities/birth` accepts `avatarCandidateId` and calls `getCandidateForBirth(userId, id)` to look up bytes for the DB insert.

**Reuse for clone regen:** The clone modal can call `postGenerateAvatarBatch` with the CLONE's name/title/(brief) and cache the returned candidate IDs. When the user picks one and submits Clone, the `identity:clone` endpoint accepts `avatarCandidateId` and calls the same `getCandidateForBirth(userId, id)` lookup to fetch bytes for the new DB row.

**Load-bearing note:** The candidate-cache is `.consume`d after birth via `consumeCandidateForBirth` — the clone endpoint must do the same to prevent re-use.

**Where to seed the brief for regen:** The design says "avatar (pre-filled with source's; option to regen 3 new candidates)." For "regen 3 new," we need SOMETHING to seed the OpenAI archetype prompt with. Options:
- (a) Ask user for a brief in the clone modal (adds a field they weren't asked for) — likely NOT desired.
- (b) Read the source's ROLE description (`## Role` section of `~/.claude/roles/<role>/<role>.md`) and pass THAT as the brief — matches the spirit of "clone same role" and preserves the visual archetype.
- (c) Read the source's IDENTITY file for any per-identity specialization + fall back to role description.

**Recommend option (b)** — role description as brief seed for the archetype prompt. This is a Claude's Discretion / planner decision that the CONTEXT.md doesn't lock down.

### F7. Existing modal patterns

- **shadcn Dialog wrapper:** `@/components/dialog` (`Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `DialogClose`). Both `NewSessionDialog` and `IdentityModal` (via `radix-ui` DialogPrimitive directly for the modal={false} + Portal-container trick) use this.
- **Form-handling:** No react-hook-form or similar. Pattern is plain `useState` for each field + `useMemo`-based `canOpen` predicate + inline validation error render (see `NewSessionDialog.tsx:507-520`).
- **Validation:** Client-side regex patterns declared at file top (e.g., `SESSION_NAME_PATTERN`, `IDENTITY_NAME_PATTERN` at NewSessionDialog.tsx:66,70). Backend re-validates via `IDENTITY_KEY_RE` (identical `/^[a-z0-9._=/+-]+$/`). For CreateRoleDialog, define `ROLE_NAME_PATTERN = /^[a-z0-9-]+$/` (kebab-case-lowercase; a stricter subset of IDENTITY_KEY_RE — no underscores, dots, slashes, plus, or equals).
- **Voice + Color pickers:** Extracted subcomponents at `/home/ubuntu/skynet/src/ui/features/pretty-view/pickers/{VoicePicker,ColorPicker}.tsx`. Reused by both `IdentityModal` and `NewSessionDialog`. CloneAgentDialog can reuse `VoicePicker` verbatim; ColorPicker is NOT used in clone (color is locked to source).

### F8-B6. Backend SSH primitives

**Files:**
- `/home/ubuntu/skynet/src/backend/ssh/ssh-one-shot.ts:19-99` — `connectOneShot(host, timeoutMs)`: opens fresh ssh2 Client, supports password + key auth, no jump hosts, no host-key verification (tailnet trust). Callers `.end()` themselves.
- `/home/ubuntu/skynet/src/backend/ssh/tmux-helper.ts:21-50` — `execCommand(conn, command)`: runs a command via ssh2 `conn.exec`, returns stdout string. Rejects on non-zero exit if stdout is empty.
- `/home/ubuntu/skynet/src/backend/claude-session/identity-artifact-reader.ts:152-165` — `execWithTimeout(conn, command)`: wraps `execCommand` in a 3-second Promise.race. Same helper used pervasively; new role-artifact readers should use it.
- `/home/ubuntu/skynet/src/backend/claude-session/identity-artifact-reader.ts:141-143` — `shellEscape(s)`: POSIX single-quote escape. Used for shell-passing the target path in `writeIdentityBountyPriority` etc.
- `/home/ubuntu/skynet/src/backend/claude-session/identity-artifact-reader.ts:852-906` — `writeMarkdownFileAtomic(conn, targetPath, contents)`: SFTP tmp+rename via `ext_openssh_rename` (avoids the OpenSSH SSH2_FX_FAILURE trap on `sftp.rename` for existing-file overwrites — see prologue at L826-849 for the load-bearing history).

**Pattern for `roles:create` mkdir + touch + write:**
```typescript
// After connectOneShot(host, 5000) returns conn:
await execWithTimeout(conn, `mkdir -p "$HOME/.claude/roles/${roleName}/bounties" && touch "$HOME/.claude/roles/${roleName}/history.md"`);
const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
await writeMarkdownFileAtomic(conn, `${remoteHome}/.claude/roles/${roleName}/${roleName}.md`, stubMarkdown);
```
(roleName pre-validated by `ROLE_NAME_PATTERN` before this point.)

**Pattern for `roles:list-for-host`:**
```typescript
// After connectOneShot:
const stdout = await execWithTimeout(conn, `ls -1 "$HOME/.claude/roles" 2>/dev/null || true`);
const roleNames = stdout.split("\n").map(s => s.trim()).filter(s => s.length > 0);
// Then for each role, cat its <role>.md to extract description:
const descCmd = roleNames.map(r =>
  `echo "===ROLE:${r}===" && cat "$HOME/.claude/roles/${r}/${r}.md" 2>/dev/null || true`
).join(" ; ");
const descStdout = await execWithTimeout(conn, descCmd);
// Parse ===ROLE:<name>=== delimiters (same pattern as readIdentityWakeups L413-425)
// Extract "## Role\n<content>\n(## next section OR EOF)" from each block
```

### F9. Skynet `identities` table + POST /identities contract

**Schema:** `/home/ubuntu/skynet/src/backend/database/db/schema.ts:654-673`.
```typescript
export const identities = sqliteTable("identities", {
  id: text("id").primaryKey(),                                    // nanoid()
  userId: text("user_id").notNull().references(() => users.id),
  identityKey: text("identity_key").notNull(),
  displayName: text("display_name").notNull(),
  title: text("title"),
  colorHue: integer("color_hue"),
  voice: text("voice"),
  avatarMime: text("avatar_mime").notNull(),
  avatarData: blob("avatar_data", { mode: "buffer" }).notNull(),
  avatarEtag: text("avatar_etag").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});
```
Note: **NO `role` column, NO `host_id` column** — consistent with CONTEXT.md lockdown.

**POST /identities contract:** [VERIFIED: `/home/ubuntu/skynet/src/backend/database/routes/identities.ts:86-171`]
- multipart/form-data with `data` (JSON with identityKey/displayName/title/colorHue/voice) + `avatar` file.
- 409 on identityKey collision (per-user unique constraint).
- Returns `publicIdentity(row)` shape at 201.

**Clone can copy row this way:** New `POST /identities/clone` handler reads source row (drizzle `select`), maps to a copy with new nanoid id + `identityKey: newName` + `displayName: newName` + user-edited `title`/`voice`/`avatarData` (from candidate cache OR source's blob if user didn't regen), preserves `colorHue` (LOCKED), and inserts via `db.insert(identities).values(...).run()`. Mirrors the DB-direct `createIdentityRecord` helper at `identity-birth.ts:53-89`.

**Silent no-op multipart trap (from Phase 20):** `IdentityModal.tsx:781-787` and `identity-birth.ts:296-321` both do a GET-verify after multipart write to guard against a middleware-order regression where the `data` field silently no-ops. Clone endpoint that uses JSON body (not multipart) sidesteps this — recommend JSON body since we're passing an avatarCandidateId not raw bytes.

### F10. Nginx dual-config pattern

**Files:** `/home/ubuntu/skynet/docker/nginx.conf` and `/home/ubuntu/skynet/docker/nginx-https.conf`.

**Phase 20 location-block template** (from nginx.conf L210-260):
```nginx
# Phase 22 (SRIC-04): roles create + list — mount BEFORE /identities regex to win match precedence
# for /roles/... since /roles is not a subpath of /identities. Standalone location.
location ~ ^/roles(/.*)?$ {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 10s;
}

# Phase 22 (SRIC-03): identity clone endpoint — mount ABOVE /identities regex so
# /identities/clone routes here and not to the generic handler.
location = /identities/clone {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 4M;
    proxy_read_timeout 60s;
}
```

**Both files** (nginx.conf and nginx-https.conf) MUST get identical blocks. The `identity:get-role-file` / `identity:update-role-file` are WS messages (over the existing `/claude-session/websocket/` location block at nginx.conf:491) — **no new nginx block needed for those**. Only the two new HTTP routes (roles-list/create + identity-clone) need location blocks.

### B4. Phase 20 identity-birth code path — the tricky one for SRIC-02

**File:** `/home/ubuntu/skynet/src/backend/database/routes/identity-birth-orchestrator.ts` (455 lines).

**How the birth flow currently works:**
1. **Step 1:** Skynet DB `INSERT identities` — pure DB op, no file creation.
2. **Step 2:** `tmux new-session -d -s <name> -c <path>` on target host.
3. **Step 3:** Pre-write `hasTrustDialogAccepted` in `~/.claude.json`, launch `claude --dangerously-skip-permissions`.
4. **Step 4:** Blind Enter train × 7 at 3s spacing to settle Claude's REPL.
5. **Step 5:** `tmux send-keys -t <name> -l "/id <name>"` then Enter.

**The subtle problem:** Step 5's `/id <name>` triggers Claude (running on the target box) to invoke the id skill's flow at `~/.claude/skills/id/SKILL.md § 2. Creating a new identity`. That skill INTERACTIVELY asks the user:

> "No identity found for **<name>**. Which existing role should this identity identity?"

It's a **prompt-and-wait** flow. Skynet cannot pre-inject a role because:
- The identity file doesn't exist yet (id skill creates it after the user answers).
- The Skynet-side backend cannot type into the tmux session AFTER the birth orchestrator returns (Step 4 is fire-and-forget-then-terminate; the browser follows focus to the pane and the id-skill dialog happens there in the human-visible pane).

**Two resolutions (planner must pick one before Wave 1b):**

**B4b (a) — Modify birth orchestrator to pre-write `<name>.md` BEFORE Step 5:**
- After Step 2 (session created + path exists), add a new "Step 2.5" that writes `~/.claude/identities/<name>/<name>.md` on the target host with the role: frontmatter and the slim identity template body from the id skill.
- Change Step 5 from `/id <name>` (which then prompts) to `/id <name>` (which now SEES the file already exists and loads it in §3, skipping the interactive create flow entirely — see id skill L268 "If the file **exists**: load it (see §3)").
- Also `mkdir -p ~/.claude/identities/<name>/wakeups` and `touch ~/.claude/identities/<name>/handoff.md` so §2 doesn't get triggered.
- Skip the relay register step in the orchestrator — that STILL wants to happen. Either invoke the register script via SSH (mirror the id skill's snippet), OR write a placeholder and let the on-wake receiver init handle it (id skill L347 warns against this). Recommend: invoke register block via SSH. See id skill L317-346 for the shape.

**B4b (b) — Modify the id skill on the target host to accept a role parameter:**
- Change `/id <name> --role <role>` invocation shape, teach the id skill to skip the interactive prompt when `--role <role>` is present.
- CROSS-BOUNDARY change — the id skill is a fleet-wide artifact managed by Nelly, NOT Skynet. Requires coordinating with the box-maintainer role's separate work stream. Explicitly OUT of scope for Phase 22.

**Recommendation:** Pick B4b(a). It's contained entirely within Skynet's birth orchestrator. It requires ~40 lines added (write file + mkdir wakeups + touch handoff + register-relay SSH block). Testable as unit test with mocked exec.

**B4c relay register on clone:** Clone endpoint also needs a fresh Matrix account. Two options: (a) SSH into the target host and run the id skill's inline register block (line 319-345 of the skill); (b) Skynet backend directly POSTs to the homeserver at `http://thenasty:8008/_matrix/client/v3/register` and writes the `relay.json` via SFTP. Both work. Recommend (b) — Skynet-side control means clone can validate the register response before writing `relay.json`, which the fleet-side script does but with an "off-tailnet skip" branch we don't want to trigger from a Skynet-controlled operation.

### B7. writeMarkdownFileAtomic + SFTP EEXIST trap

Fully documented at `identity-artifact-reader.ts:826-849` in the code comments. New role-file writers MUST use this helper (not raw `sftp.rename` — that trap will re-appear in production for existing role files).

## Common Pitfalls

### Pitfall 1: Trying to inject `role:` into the identity file via the birth orchestrator without pre-creating the file

**What goes wrong:** The birth flow's Step 5 sends `/id <name>` which delegates identity-file creation to the id skill running IN Claude on the target box. Skynet cannot write to that file before Step 5 (file doesn't exist), can't type into the interactive prompt after Step 5 (browser has focused to the pane, the human-visible dialog is happening there), and can't retroactively edit the file at Step 6 without racing the id skill's write.

**Why it happens:** The birth flow was designed pre-role-paradigm; identity creation happened entirely inside the /id skill.

**How to avoid:** Adopt Resolution B4b(a) — pre-write the identity folder + `<name>.md` (with role: frontmatter) + wakeups/ + handoff.md as a new Step 2.5 in the birth orchestrator. Then Step 5's `/id <name>` sees an existing file and takes the load-existing branch (id skill §3), skipping the interactive create prompt entirely.

**Warning signs:** If a Phase 22 plan says "birth step writes the identity file with role:" without addressing that the current birth flow does NOT write the identity file at all, plan-check BLOCK.

### Pitfall 2: Multipart-form-data silent no-op on the clone endpoint

**What goes wrong:** If clone accepts multipart (avatar bytes as a File), a middleware-order regression can cause the multipart `data` field to be silently ignored — endpoint returns 200 with a partial identity record and the frontend thinks the write succeeded.

**Why it happens:** Documented in Phase 20 REVIEW.md CR-06 and the IdentityModal.tsx L779-787 defensive comment. Middleware ordering (multer vs express.json vs authenticateJWT) is fragile.

**How to avoid:** Ship the clone endpoint as **JSON body** taking `avatarCandidateId` (server does the cache lookup) instead of multipart with a File. This mirrors the birth flow's contract exactly (`/identities/birth` accepts JSON with `avatarCandidateId`).

### Pitfall 3: SFTP.rename on existing role file → SSH2_FX_FAILURE

**What goes wrong:** OpenSSH's SFTPv3 `SSH_FXP_RENAME` cannot atomically overwrite an existing file; it tries `link()` first, fails with `EEXIST`, surfaces as generic `Error: Failure` with code 4. Every SECOND edit of the same role file fails silently (first-time write works).

**Why it happens:** Documented at `identity-artifact-reader.ts:826-849`. Root-caused by Stacy on ceo-skynet 2026-08-02.

**How to avoid:** Use `writeMarkdownFileAtomic` (which uses `sftp.ext_openssh_rename`) — never raw `sftp.rename`. The existing regression test at `identity-artifact-reader.remote-writes.test.ts` installs a throwing trap on `sftp.rename` that fails loudly.

### Pitfall 4: Forgetting the second nginx config file

**What goes wrong:** Backend HTTP route added, `docker/nginx.conf` gets the location block, but `docker/nginx-https.conf` is missed. Requests through the HTTPS edge (production) 200-return `index.html` and crash the frontend on `.map`.

**Why it happens:** Project ships both HTTP and HTTPS configs; only one gets edited during a rushed patch.

**How to avoid:** Baked into project CLAUDE.md L43-46 as a load-bearing rule. Every Phase 22 plan touching a new HTTP route MUST list BOTH files in its verification steps. WS routes (`identity:get-role-file` etc.) do NOT need new nginx blocks — they ride the existing `/claude-session/websocket/` block.

### Pitfall 5: Hand-rolling YAML frontmatter parsing

**What goes wrong:** Naive regex parser fails on quoted values, multi-line strings, comments, escape sequences.

**How to avoid:** `js-yaml` is already a dependency. Use `yaml.load(...)`.

### Pitfall 6: Adding a `role` column to `identities` table

**What goes wrong:** Two sources of truth (Skynet DB + fleet `<name>.md` frontmatter) drift. Editing role via `/id` in a tmux session on the box doesn't update Skynet's row. Editing role in Skynet doesn't propagate back to the fleet file. Every future feature must remember to write both.

**How to avoid:** CONTEXT.md LOCKED. Plan-checker BLOCK.

### Pitfall 7: Adding an editable host/role/color field to the clone modal

**What goes wrong:** Violates "clone is true-to-the-word" semantics.

**How to avoid:** CONTEXT.md LOCKED. Plan-checker BLOCK. Only Name/Title/Voice/Avatar are editable on clone.

### Pitfall 8: Adding no-role fallback branches

**What goes wrong:** Dead code — Ashley confirmed 2026-08-04 no fleet identity lacks `role:` frontmatter post-migration. Any `(no role)` empty state renders never (validated by grep across the fleet).

**How to avoid:** CONTEXT.md LOCKED. The two-step helper `resolveRoleForIdentity` should THROW on missing role, not fall through. Frontend must not have "if no role show placeholder" branches. Plan-checker BLOCK.

## Code Examples

### Example 1: New `readRoleFile` in identity-artifact-reader.ts

```typescript
// Add near line 249 of identity-artifact-reader.ts, after readIdentityFile:

/** Read ~/.claude/roles/<role>/<role>.md via two-step (identityKey → frontmatter → role). */
export async function readRoleFile(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ markdown: string; role: string }> {
  const role = await resolveRoleForIdentity(conn, identityKey);

  if (conn === null) {
    const root = path.join(getLocalIdentitiesRoot(), "..", "roles"); // sibling of identities/
    const filePath = path.join(root, role, `${role}.md`);
    try {
      const markdown = await fs.readFile(filePath, "utf-8");
      return { markdown, role };
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { markdown: "", role };
      throw err;
    }
  }
  const cmd = `cat "$HOME/.claude/roles/${role}/${role}.md" 2>/dev/null || true`;
  const stdout = await execWithTimeout(conn, cmd);
  return { markdown: stdout, role };
}
```
Note: The `getLocalIdentitiesRoot()` helper at L130-135 currently returns `.claude/identities`. For LOCAL role reads, we need a sibling `getLocalRolesRoot()` — recommend adding a matching env var `ROLES_HOST_DIR` (defaults to `~/.claude/roles`). Consistent with the existing `IDENTITIES_HOST_DIR` pattern.

### Example 2: Extending readIdentityBounties for SRIC-01 two-step

```typescript
// Modify readIdentityBounties (currently at L506-645) to do the two-step:
// Signature UNCHANGED — internal implementation is the two-step.

export async function readIdentityBounties(
  conn: SSHClientType | null,
  identityKey: string,
): Promise<{ bounties: unknown[]; archivedBounties: unknown[] }> {
  const role = await resolveRoleForIdentity(conn, identityKey);

  if (conn === null) {
    // LOCAL branch — read from ~/.claude/roles/<role>/bounties/ instead of ~/.claude/identities/<key>/bounties/
    const root = getLocalRolesRoot();
    const baseDir = path.join(root, role, "bounties");
    // ...rest of the existing LOCAL branch, but with baseDir rooted at role folder
  }

  // REMOTE branch — same as current L594-644, but paths change from
  //   $HOME/.claude/identities/${identityKey}/bounties → $HOME/.claude/roles/${role}/bounties
  const openCmd = `cd "$HOME/.claude/roles/${role}/bounties" 2>/dev/null && ...`;
  // etc.
}
```

### Example 3: Clone endpoint sketch

```typescript
// New file: src/backend/database/routes/identity-clone.ts
router.post("/", authenticateJWT, express.json(), async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { sourceIdentityKey, hostId, newName, title, voice, avatarCandidateId } = req.body;

  // Validate
  if (!IDENTITY_KEY_RE.test(sourceIdentityKey) || !IDENTITY_KEY_RE.test(newName)) {
    return res.status(400).json({ error: "invalid identity key" });
  }
  // ...more validation

  // Fetch source Skynet row
  const sourceRow = db.select().from(identities).where(and(
    eq(identities.userId, userId),
    eq(identities.identityKey, sourceIdentityKey),
  )).all()[0];
  if (!sourceRow) return res.status(404).json({ error: "source not found" });

  // Fetch avatar bytes from candidate cache OR reuse source's blob
  let avatarBytes: Buffer;
  if (avatarCandidateId) {
    const cand = getCandidateForBirth(parseInt(userId, 10), avatarCandidateId);
    if (!cand) return res.status(400).json({ error: "avatar candidate expired" });
    avatarBytes = cand.bytes;
  } else {
    avatarBytes = sourceRow.avatarData;
  }

  // Open SSH, read source's <name>.md → extract role
  const host = await resolveHostById(hostId, userId);
  if (!host) return res.status(404).json({ error: "host not found" });
  const conn = await connectOneShot(host, 5000);
  try {
    const { markdown: sourceIdentityFile } = await readIdentityFile(conn, sourceIdentityKey);
    const role = extractRoleFromMarkdown(sourceIdentityFile);
    if (!role) return res.status(500).json({ error: "source has no role frontmatter" });

    // Collision check
    const exists = await execWithTimeout(conn,
      `if [ -d "$HOME/.claude/identities/${newName}" ]; then echo exists; else echo missing; fi`);
    if (exists.trim() === "exists") return res.status(409).json({ error: "identity exists on host" });

    // Write new fleet folder
    await execWithTimeout(conn, `mkdir -p "$HOME/.claude/identities/${newName}/wakeups" && touch "$HOME/.claude/identities/${newName}/handoff.md"`);
    const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
    const identityFileMarkdown = `---\nrole: ${role}\n---\n\n# ${title}\n\n(cloned from ${sourceIdentityKey})\n`;
    await writeMarkdownFileAtomic(conn, `${remoteHome}/.claude/identities/${newName}/${newName}.md`, identityFileMarkdown);

    // Register relay account (Skynet-side POST to homeserver — see B4c)
    // ... POST http://thenasty:8008/_matrix/client/v3/register with dummy auth
    // ... write relay.json via SFTP

    // Insert Skynet DB row
    const id = nanoid();
    const now = new Date().toISOString();
    const etag = createHash("md5").update(avatarBytes).digest("hex");
    db.insert(identities).values({
      id, userId,
      identityKey: newName,
      displayName: newName,
      title: title ?? sourceRow.title,
      colorHue: sourceRow.colorHue,  // LOCKED
      voice: voice ?? sourceRow.voice,
      avatarMime: "image/png",
      avatarData: avatarBytes,
      avatarEtag: etag,
      createdAt: now,
      updatedAt: now,
    }).run();
    const newRow = db.select().from(identities).where(eq(identities.id, id)).all()[0];
    if (avatarCandidateId) consumeCandidateForBirth(parseInt(userId, 10), avatarCandidateId);
    return res.status(201).json(publicIdentity(newRow));
  } finally {
    try { conn.end(); } catch { /* ignore */ }
  }
});
```

## State of the Art

Not applicable — Phase 22 layers on Phase 18/20 infrastructure entirely; no domain-standard techniques being reconsidered here.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getLocalRolesRoot()` helper naming convention — proposed as sibling of `getLocalIdentitiesRoot()`, with env var `ROLES_HOST_DIR`. | Example 1 code + Pattern 1 | If a different naming is preferred (e.g., single `getLocalClaudeRoot()` with join-in-caller), the helper structure differs. Low risk. Cosmetic. |
| A2 | Description source for `roles:list-for-host` = `## Role` section content. | CONTEXT.md Discretion | Low risk. CONTEXT.md flags this as Claude's Discretion; the planner can pick either. |
| A3 | Recommendation to make clone endpoint accept `avatarCandidateId` (JSON body) rather than multipart with an avatar File. | Pitfall 2 + Example 3 | Low risk. Both work; the JSON body sidesteps the multipart silent-no-op trap. |
| A4 | Resolution B4b(a) recommended for SRIC-02 (pre-write identity file in Step 2.5 of birth). | Finding B4 | Load-bearing. If the planner picks B4b(b) instead (modify id skill), Phase 22 scope expands to include cross-boundary work with the box-maintainer role's fleet-side scripts. This is a real decision point that MUST be resolved before Wave 1b. |
| A5 | Role name pattern = `/^[a-z0-9-]+$/` (kebab-case-lowercase, stricter than identity key regex). | Finding F7 | Low risk. CONTEXT.md says "kebab-case-lowercase, required, validated" — this regex is the standard interpretation. |
| A6 | Recommendation to create dedicated `CloneAgentDialog.tsx` rather than extend NewSessionDialog with `mode="clone"`. | Alternatives Considered | Low risk. CONTEXT.md flags as Claude's Discretion. The extract-shared-`HostPickerList` companion suggestion would benefit both dialogs. |
| A7 | Recommendation to seed clone-regen archetype-prompt "brief" with the source's role description. | Finding F6 | Low risk. Design-and-waves.md and CONTEXT.md do not lock this down. Alternative: ask user for a brief in the clone modal (adds a field), or use source's identity file body. |
| A8 | Relay register on clone should happen Skynet-side (POST to homeserver + SFTP write of relay.json) rather than SSH-invoking the id skill's register block on the target host. | Finding B4c | Low risk. Both work; Skynet-side gives us clean error handling. |
| A9 | The existing IDENTITIES_LOCAL_HOST_IDS routing (LOCAL bind-mount vs REMOTE SSH) is applied identically to role-folder ops. | Pattern 1 | Low risk. The pattern is consistent for identities; extending to roles is the obvious mirror. |

**If this table is empty:** N/A — this table is not empty. All A1-A9 items above will need user or planner confirmation as they enter execution. **A4 is the load-bearing one** — the SRIC-02 wave should not start until A4 is settled.

## Open Questions (RESOLVED)

All five questions raised during research have been resolved and are consumed by the plans below. Resolution markers per Dimension 11:

1. **How does the birth orchestrator write the `role:` frontmatter into `<name>.md` when the current flow delegates identity-file creation to the /id skill on the box?**
   - What we know: Birth Step 5 is `/id <name>` which triggers the id skill's interactive create-flow (§2 of id skill). The identity file is written by the id skill on the box, AFTER an interactive human prompt for role. Skynet cannot pre-inject role: without pre-creating the file.
   - What's unclear: Which resolution the planner picks (B4b(a) modify birth to pre-write the file, vs B4b(b) modify id skill to accept role param).
   - Recommendation: Adopt B4b(a). It's Skynet-contained and testable. Adds ~40 lines to the birth orchestrator.
   - **RESOLVED:** B4b(a) locked. Plan 22-02 Task 2 is a `checkpoint:human-verify` where Ashley confirms the ~40-line birth-orchestrator change before it lands; Task 3 implements the pre-write of `<name>.md` + `wakeups/` + `handoff.md` + relay-register via SSH inside Step 2's completion path (silent — no new SSE event type).

2. **Where does the "brief" for regen-avatar during clone come from?**
   - What we know: OpenAI's archetype prompt (identity-avatar-batch.ts L155-170) requires `name`, `title`, `brief`. Clone edits title but the design doesn't ship a brief input.
   - What's unclear: What to seed brief with.
   - Recommendation: Use the source's ROLE description (`## Role` section of `<role>.md`) — matches clone-as-same-role semantics.
   - **RESOLVED:** Plan 22-03 Task 2 wires the regen-avatar button to seed `brief` with `editedTitle` from the clone modal input (simplest ergonomic path — matches text the user just typed). The role-description alternative was considered and rejected as adding a role-file-read at avatar-regen time for marginal archetype-quality gain.

3. **Does the id skill's on-wake receiver/scheduler startup break if we pre-populate the identity folder (per B4b(a)) with `<name>.md` + `handoff.md` + `wakeups/` but WITHOUT `relay.json`?**
   - What we know: id skill L347-353 warns "Do NOT write a placeholder relay.json — the on-wake receiver setup checks for it and starting the receiver against a fake cred file produces silent-deafness zombies."
   - What's unclear: Whether `/id <name>` loading (§3) on a folder that has no relay.json but IS otherwise complete produces the register-failed announce line vs a silent-deafness zombie.
   - Recommendation: Have the birth orchestrator RUN the relay-register block via SSH (mirroring the id skill snippet at L317-346) BEFORE Step 5. This way the on-wake receiver has real creds. Same for the clone endpoint.
   - **RESOLVED:** Plan 22-02 Task 3 wires the relay-register block via SSH into the pre-write step so `relay.json` exists BEFORE `/id <name>` fires. Plan 22-03 Task 1 reuses the same shared birth logic for clones.

4. **Should the description text in the create-role stub `<role>.md` be single-line or preserve user's line breaks?**
   - What we know: CONTEXT.md says "Description (required)" — no format constraint.
   - Recommendation: Preserve line breaks (`<textarea>` in CreateRoleDialog), write verbatim under `## Role` heading.
   - **RESOLVED:** Plan 22-04 Task 1 preserves newlines — CreateRoleDialog uses a `<textarea>` for description input, backend writes verbatim under the `## Role` heading in `~/.claude/roles/<name>/<name>.md`.

5. **Clone modal — where does the color-locked-to-source signal come from at render time?**
   - What we know: Row's identity comes from `useIdentities().byKey.get(sessionMatchKey(row.targetTmuxSession))` at PrettyConversationRow.tsx:185-187. The source identity's `colorHue` is on the returned Identity object.
   - No open question; just confirming the load-bearing lookup chain.
   - **RESOLVED:** No decision needed — this was a lookup-chain confirmation, not an open design question. Plan 22-03 Task 2 uses the `useIdentities()` lookup to lift `colorHue` (and title/voice defaults) from the source Identity object. Color is NEVER rendered as an editable UI element in the clone modal per non-negotiable #4.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Backend runtime | ✓ | (project's existing pin) | — |
| ssh2 | SSH exec + SFTP for all new role/clone ops | ✓ | (existing dep) | — |
| js-yaml | Frontmatter parse | ✓ | ^4.1.1 [VERIFIED: package.json:58] | — |
| Docker | Build + deploy | ✓ (project's build pipeline) | — | — |
| OpenAI API key | Avatar regen on clone modal | ⚠ Runtime env var `OPENAI_API_KEY` — 503 on backend if missing | — | Clone can still succeed WITHOUT avatar regen (user picks source's avatar); regen button just fails 503. |
| Matrix homeserver at thenasty:8008 (or 100.113.23.63:8008) | Clone relay register + Phase 22-B4c pattern | ⚠ Fleet-dependent — always available on tailnet; not available on off-tailnet workstations | — | Fail-clone with clear error message; do NOT write placeholder relay.json (per id skill L347). |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** OpenAI API key (regen fails 503, source avatar still works); Matrix homeserver (clone fails cleanly when off-tailnet).

## Validation Architecture

Skipped — `.planning/config.json` has `workflow.nyquist_validation: false`.

## Security Domain

Config sets `security_enforcement: true` at `.planning/config.json`, with `security_asvs_level: 1`. Applicable categories for Phase 22:

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `AuthManager.createAuthMiddleware()` — every new HTTP route uses `authenticateJWT` verbatim (same as Phase 20 routes). JWT cookie auth. |
| V3 Session Management | no | Handled by existing JWT infra; no new session semantics. |
| V4 Access Control | yes | New routes MUST filter identity/host queries by `req.userId` (mirrors identities.ts L74). `resolveHostById(hostId, userId)` already enforces cross-user isolation. |
| V5 Input Validation | yes | `IDENTITY_KEY_RE` = `/^[a-z0-9._=/+-]+$/` for identity keys. NEW: `ROLE_NAME_PATTERN = /^[a-z0-9-]+$/` (strictly kebab-case). Every new route validates BEFORE any SSH/DB work (per Phase 20 pattern at identity-exists-on-host.ts). |
| V6 Cryptography | no | Reuse existing MD5 avatar etag pattern; no new crypto primitives. |
| V7 Errors & Logging | yes | Reuse `sshLogger.error` + `databaseLogger.error` patterns (see identity-artifact-reader.ts + identity-birth.ts). Sanitize error messages before including in SSE `reason` fields (see `sanitizeError` at identity-birth-orchestrator.ts:169-176). |
| V10 Malicious Code | yes (shell interpolation) | All shell-interpolated values (identityKey, role, hostId) MUST pass regex gate before SSH command construction (Phase 20 pattern — see identity-exists-on-host.ts:86 and identity-artifact-reader.ts:246). |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell injection via unescaped role/identity name in SSH exec commands | Tampering | Two-layer defense: `ROLE_NAME_PATTERN` regex gate at route entry + validate again in artifact-reader helpers before interpolation. Match `identity-exists-on-host.ts:86` pattern verbatim. |
| Path traversal via `../` in role name | Tampering | `ROLE_NAME_PATTERN` (kebab-case) has no dots/slashes; blocked at regex. |
| Silent no-op on multipart write (Phase 20 patch #77 / SCRATCH-REPORT) | Denial of Truth | Ship clone endpoint as JSON body with `avatarCandidateId` (no multipart) — sidesteps the trap. |
| SSH connection resource leak on error | Denial of Service | Every new SSH-using handler MUST wrap in `try/finally` with `conn.end()` — match `claude-session-server.ts:1866-1880` pattern. |
| Cross-user role/identity access | Information Disclosure | `resolveHostById(hostId, userId)` already returns null for cross-user hosts. Every new HTTP route MUST call it, not raw SQL. |
| Role name collision race between two admin clients | Tampering | SSH-side `if [ -d ... ]` collision check is inherently racy. Accept the race — worst case is a duplicate mkdir which is idempotent. Not worth a distributed lock for MVP. |
| SFTP.rename EEXIST trap on role file overwrites | Data corruption (partial write survives) | MUST use `writeMarkdownFileAtomic` (which uses `ext_openssh_rename`) — never raw `sftp.rename`. |

## Project Constraints (from CLAUDE.md)

From `/home/ubuntu/skynet/CLAUDE.md`:

- **Every new backend route needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`, else it 200s with `index.html` and crashes the frontend on `.map`.** Load-bearing for SRIC-03 (`/identities/clone`) and SRIC-04 (`/roles/*`). WS routes (SRIC-01, SRIC-06) do NOT need new nginx blocks — they ride existing `/claude-session/websocket/`.
- **All work goes through a GSD workflow** (`/gsd-quick` for small; `/gsd-execute-phase` for planned phase work). No direct repo edits outside GSD.
- **Every `docker compose up -d --force-recreate skynet` runs behind the 15-min deadman rollback timer** — per-phase deploy gates apply.
- **Skynet stores host credentials + SSH keys in AES-encrypted SQLite (`skynet-data` volume). Backup is daily EBS DLM snapshot; no separate DB backup.** Clone endpoint MUST NOT touch `skynet-data` schema (adding a `role` column would). Consistent with CONTEXT.md lockdown.
- **Ashley never loses access to her fleet.** Bad clone or bad create-role must not brick the SSH gateway; every new route needs error paths that surface clear failures without breaking the rest of Skynet. Standard error handlers (`router.use((err, req, res, next) => ...)`) at the end of each route file, mirroring identities.ts L316-333.

## Sources

### Primary (HIGH confidence — direct source code inspection)

- `/home/ubuntu/skynet/.planning/phases/22-skynet-ui-parity-with-the-role-identity-paradigm/22-CONTEXT.md` — user decisions, LOCKED
- `/home/ubuntu/.claude/roles/box-maintainer/bounties/skynet-role-identity-crud-ui/design-and-waves.md` — design source-of-truth
- `/home/ubuntu/.claude/roles/box-maintainer/bounties/skynet-role-identity-crud-ui/bounty.json` — bounty metadata
- `/home/ubuntu/.claude/skills/id/SKILL.md` — id skill (fleet paradigm being mirrored)
- `/home/ubuntu/skynet/CLAUDE.md` — project constraints
- `/home/ubuntu/skynet/.planning/REQUIREMENTS.md` — project requirements (SRIC-XX not yet in this file — Phase 22 requirements are documented in CONTEXT.md and roadmap entry only)
- `/home/ubuntu/skynet/.planning/config.json` — GSD config (workflow flags)
- `/home/ubuntu/skynet/package.json` — dependency versions (js-yaml, ssh2, sharp, nanoid, drizzle-orm, react)
- `/home/ubuntu/skynet/src/ui/features/pretty-view/IdentityModal.tsx` (1360 lines) — modal + tab data flow
- `/home/ubuntu/skynet/src/ui/features/pretty-view/IdentityFileTab.tsx` — tab pattern mirror
- `/home/ubuntu/skynet/src/ui/features/pretty-view/HistoryTab.tsx` — tab pattern mirror
- `/home/ubuntu/skynet/src/ui/features/pretty-view/HandoffTab.tsx` — tab pattern mirror
- `/home/ubuntu/skynet/src/ui/features/pretty-view/PrettyView.tsx` — IdentityModal mount + hostId threading
- `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationRow.tsx` (592 lines) — context menu items builder location
- `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx` — item shape
- `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — panel + NewSessionDialog wiring
- `/home/ubuntu/skynet/src/ui/sidebar/NewSessionDialog.tsx` (916 lines) — host picker pattern, birth stream consumer
- `/home/ubuntu/skynet/src/ui/api/identities-api.ts` — HTTP client patterns
- `/home/ubuntu/skynet/src/ui/api/claude-session-api.ts` — WS wire shapes
- `/home/ubuntu/skynet/src/backend/claude-session/identity-artifact-reader.ts` (1743 lines) — LOCAL/REMOTE artifact read/write patterns, SFTP EEXIST trap fix
- `/home/ubuntu/skynet/src/backend/claude-session/claude-session-server.ts` (3564 lines) — WS handler patterns (esp. L1815-2050 for read handlers)
- `/home/ubuntu/skynet/src/backend/database/routes/identities.ts` — POST /identities contract
- `/home/ubuntu/skynet/src/backend/database/routes/identity-birth-orchestrator.ts` (455 lines) — birth orchestrator pattern
- `/home/ubuntu/skynet/src/backend/database/routes/identity-birth.ts` (291 lines) — birth route SSE pattern
- `/home/ubuntu/skynet/src/backend/database/routes/identity-avatar-batch.ts` (461 lines) — avatar batch + candidate cache pattern
- `/home/ubuntu/skynet/src/backend/database/routes/identity-exists-on-host.ts` — collision-probe pattern
- `/home/ubuntu/skynet/src/backend/database/database.ts` — route mount order at L1795-1810
- `/home/ubuntu/skynet/src/backend/ssh/ssh-one-shot.ts` — connectOneShot signature
- `/home/ubuntu/skynet/src/backend/ssh/tmux-helper.ts` — execCommand signature
- `/home/ubuntu/skynet/src/backend/ssh/host-resolver.ts` — resolveHostById signature
- `/home/ubuntu/skynet/src/backend/database/db/schema.ts` — identities table schema (L654-673)
- `/home/ubuntu/skynet/src/backend/ssh/opkssh-auth.ts:14` — js-yaml existing usage
- `/home/ubuntu/skynet/docker/nginx.conf` + `nginx-https.conf` — nginx location-block patterns for identity routes

### Secondary (MEDIUM — verbatim from linked design docs)

- Phase 20 CONTEXT and PLAN files (referenced in canonical_refs of Phase 22 CONTEXT.md) — establishes the identity-birth code path this phase extends
- Phase 18 IDMEDIT-01..08 requirements + implementation — establishes the tab-editor pattern this phase mirrors for the new Role tab

### Tertiary (LOW — none)

None — every finding is rooted in direct file inspection.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies verified present in `/home/ubuntu/skynet/package.json` and used in production code paths.
- Architecture: HIGH — every recommendation ports a proven Phase 18/20 pattern; the one novel piece (two-step) is a straightforward two-line addition to existing readers.
- Pitfalls: HIGH — every pitfall listed is documented in production code comments (SFTP EEXIST at identity-artifact-reader.ts:826-849) or verified from Phase 20 PLAN docs (multipart silent no-op).
- Birth orchestrator resolution (B4b(a) vs (b)): MEDIUM — A4 is the load-bearing assumption. Planner must confirm before Wave 1b. Both resolutions are technically viable; (a) is Skynet-contained and lower-risk.

**Research date:** 2026-08-04
**Valid until:** 2026-09-04 (30 days for stable Skynet fork surfaces; the fleet id skill can change independently and invalidate finding B4 if the id skill grows a `--role` flag before then).
