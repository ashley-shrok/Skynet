# Phase 117: projects — sidebar section with drag-and-drop membership, per-project context file, and id-skill amendment — Research

**Researched:** 2026-09-18
**Domain:** Skynet frontend (React/TS sidebar + DnD + store) + Skynet backend (identity artifact reader + Express routes + wire protocol) + fleet-substrate (id-skill body edit shipped via distributor)
**Confidence:** HIGH

## Summary

Phase 117 is a "how do we implement what's already been decided" research pass — CONTEXT.md D-01..D-40 are locked. The user's design decisions map cleanly onto four fully-existing mechanisms in this codebase that we can reuse verbatim rather than build from scratch:

1. **Archive cascade** — the Phase 115 identity-archive machinery (`POST /identities/:key/archive` → `.archive-requested` sentinel → agent-supervisor consumes → folder moves to `~/fleet/identities-archive/`) is a one-per-conversation call away from being an N-call cascade. The frontend helper (`archiveIdentity(hostId, identityKey)` in `identity-archive-api.ts`) is already fire-and-forget.
2. **Sidebar DnD wire contract** — the sidebar already has a `text/plain` + `application/x-skynet-row` DnD source in `PrettyConversationRow.tsx:949-973`, a coral overlay drop-target pattern in `PrettyConversationsPanel.tsx:1636-1647` (baseline-neutral, coral only on hover — palette `rgba(255, 184, 150, 0.22)` bg / `0.60` border / zIndex 30), and a canonical "hover-only coral, no baseline" example in `CollapsedPanelCloseLane.tsx`. Projects DnD is a fifth-tier consumer of the same wire.
3. **id-skill body edit → distributor sweep** — `substrate/skills/id/SKILL.md` is already a 4-row `bundled` catalog entry (`src/backend/distributor/catalog.ts:216-244`); the sweep composer (`run-sweep.ts`) byte-compares installed → source and re-pushes on mismatch. A body-edit to `SKILL.md` is a **zero-catalog-change** operation — the amendment ships automatically on the next sweep tick post-deploy.
4. **Identity artifact reader** — `identity-artifact-reader.ts` (4533 lines, ~50 exported functions) is the SINGLE audit surface for on-disk artifacts under `~/fleet/`. It has a well-established LOCAL (bind-mount) / REMOTE (SSH) branch pattern, an `IDENTITY_KEY_RE` shell-safety gate, an atomic tmp+rename write pattern (`writeMarkdownFileAtomic`), and a `yaml.dump` / `stringifyColorHueForYaml` frontmatter-write shape that projects can slot into for the `displayName:` frontmatter of `project.md`.

**Primary recommendation:** treat Phase 117 as five composable extensions, each cloning a byte-shape-parallel existing surface — no green-field mechanism needed. Structure the plans around these existing seams:

- **Backend project CRUD** — clone `runbooks-editor.ts`'s slug-directory + fixed-sentinel + role-scoping shape (that route is the closest structural parallel to `~/fleet/projects/<slug>/project.md`).
- **Session frontmatter read/write for `project:` field** — new methods on `identity-artifact-reader.ts` following the two-step `readIdentityFile` → `extractCosmeticsFromFrontmatter`-shaped `extractProjectFromMarkdown` gate + `writeIdentityFile` frontmatter-rewrite. NOTE: the `project:` field lives on the SESSION file (via `session-file-parser.ts`), not the identity's `<name>.md` — see § Concerns below.
- **Wire protocol `project-list-changed` event** — clone the Phase 115 `FrontendIdentityArchivedFrame` shape from `wire-protocol.ts:577-583` verbatim into a new `FrontendProjectListChangedFrame`.
- **Frontend store extension** — grow `conversation-store.ts` with a `projects: Project[]` slice, a `useProjects` hook (byte-shape parallel to `useArchivedFleetRows`), and a `useCollapsedProjectSlugs` localStorage-backed hook.
- **Sidebar rendering** — add project header rows + collapse state + per-project drop lanes to `PrettyConversationsPanel.tsx`, reusing the existing coral overlay via a per-section `isDragOverThisProject` state.
- **id-skill amendment** — a single markdown-body edit to `substrate/skills/id/SKILL.md`; no code changes anywhere else.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Project directory + `project.md` on disk | Fleet substrate (`~/fleet/projects/<slug>/`) | Backend (create/read via SSH or bind-mount) | Projects are a third first-class artifact tree sibling to `~/fleet/roles/` and `~/fleet/identities/`, not a Skynet-owned resource. Same layer as roles/identities today. |
| Session `project:` frontmatter | Fleet substrate (session file) | Backend (read/write via `identity-artifact-reader.ts`) | Membership IS the frontmatter per D-05; the frontmatter lives in the session file on disk (session-file-parser.ts). Backend just reads/writes it. |
| Project CRUD endpoints (create, archive-cascade) | Backend API (`src/backend/database/routes/`) | Frontend API client | Multipart write pattern per D-36; frontend hits REST. |
| `project-list-changed` wire event | Backend fleet-status (subscription-registry) | Backend ssh-poll-orchestrator + frontend fleet-status-client | Follows Phase 115 identity-archived pattern verbatim — backend authoritatively broadcasts; clients consume. |
| Sidebar project rendering (headers, DnD lanes, collapse) | Frontend (`PrettyConversationsPanel.tsx`) | Frontend store (`conversation-store.ts` derived selector) | Pure presentation on top of a projects-derived bucketing selector; store owns the shape, panel owns the paint. |
| Drag-and-drop wire | Frontend (`PrettyConversationRow.tsx` source, `PrettyConversationsPanel.tsx` sinks) | — | DnD is a browser-tier native mechanism; no backend involvement in the drag itself, only in the eventual write. |
| Create-project modal | Frontend (new component, sibling of `NewConversationModal`) | Backend (POST /projects) | New modal + one new POST endpoint. |
| id-skill body edit | Fleet substrate source (`substrate/skills/id/SKILL.md`) | Distributor (`catalog.ts` entry unchanged; sweep pushes on next tick) | Body-edit only; distributor picks up automatically. |
| localStorage collapse state | Browser | — | Per D-40, not server-synced; localStorage-backed hook. |

## Standard Stack

### Core (all already installed — no new dependencies)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | 19.x [ASSUMED — verify via `cat package.json | grep react`] | UI framework | Already the sidebar's framework |
| `lucide-react` | already installed | Project icon (D-12), section header chevron | Phase 115 verified `grep -c "lucide-react" package.json` returns 1; existing panel already imports `Archive`, `ChevronDown`, `Drama`, `Globe`, `Loader2`, `Monitor`, `MoreVertical`, `Search`, `SquarePen`, `X` |
| `js-yaml` | already installed | Parse + emit `project:` frontmatter | `identity-artifact-reader.ts` already imports `yaml from "js-yaml"` — same parse/dump helpers used for `role:`, `displayName:`, `task:`, etc. |
| `multer` | already installed | multipart/form-data parser for the create-project POST | `roles-create.ts` uses `multer.memoryStorage()` as the canonical multipart pattern; project create mirrors it |
| `express` | already installed | New backend routes | Standard `express.Router()` shape mirrors `identity-archive.ts` and `runbooks-editor.ts` |
| `zod` | already installed | Wire-protocol `FrontendProjectListChangedFrame` schema | `wire-protocol.ts` uses `z.object({...})` for every frame; discriminated union in `FrontendOutboundFrame` |
| `ssh2` | already installed | Remote SSH for hosts not in `IDENTITIES_LOCAL_HOST_IDS` | `identity-artifact-reader.ts`'s LOCAL/REMOTE branch pattern |

### Supporting (existing internal modules to reuse)

| Module | Path | Purpose | When to Use |
|--------|------|---------|-------------|
| `writeMarkdownFileAtomic` | `identity-artifact-reader.ts` | Atomic tmp+rename SFTP writer for `project.md` REMOTE branch | Every project.md write must be atomic — mirrors identity/role file writes |
| `execWithTimeout` | `identity-artifact-reader.ts` | 15s-bounded remote exec for `find`/`cat`/`mkdir` on projects dir | Every REMOTE branch operation |
| `resolveHostById(hostId, userId)` | `src/backend/ssh/host-resolver.ts` | Auth gate — 404 for cross-user / unknown hosts | Every project endpoint — mirrors `identity-archive.ts:108` |
| `connectOneShot(host, timeoutMs)` | `src/backend/ssh/ssh-one-shot.ts` | Per-request SSH connection with try/finally cleanup | REMOTE-branch project operations |
| `authenticateJWT` middleware | `AuthManager.getInstance().createAuthMiddleware()` | Auth gate on every route | Every project endpoint |
| `IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/` | `identity-artifact-reader.ts:175` | Reference for project-slug regex (widen to allow more chars OR reuse verbatim) | Slug validation before I/O |
| `stringifyColorHueForYaml` | `identity-artifact-reader.ts:2596` | YAML-quote pattern for MDXEditor round-trip parity | If the project.md frontmatter grows numeric fields later; not needed for v1 (only `displayName:` string) |
| `DatabaseSaveTrigger.forceSave(reason)` | `src/backend/database/db/index.ts` | Persist SQLite in-memory DB after any db.insert/update/delete | Required per D-38 for any project-related DB write; project state lives on disk under `~/fleet/`, so **may not be needed** — see § Concerns |
| `putPinnedIds([...ids], identityHosts)` | `src/ui/api/user-preferences-api.ts` [ASSUMED path] | Reference for existing sentinel-fanout pattern | Existing shape shows how per-identity file writes flow through user-preferences fanout |

### Existing test infrastructure

| Framework | Purpose |
|-----------|---------|
| `vitest` | Unit + integration tests for backend routes + store logic (`.test.ts` files everywhere) |
| `@testing-library/react` | React component tests (`.test.tsx` files — e.g. `PrettyConversationsPanel.test.tsx`, `NewConversationModal.flow.test.tsx`) |
| `supertest` [ASSUMED — verify via grep] | HTTP-level tests of Express routes; `identity-archive.test.ts:183` imports the router directly |
| jsdom | JSDOM-based DnD tests (Phase 115 patterns in `PrettyConversationsPanel.test.tsx`; `CollapsedPanelCloseLane` tests dispatch native `DragEvent`s via `Object.defineProperty` for clientX/Y) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| A separate `projects: Project[]` slice on `conversation-store.ts` | Reuse the existing snapshot builder to enrich rows with project | Rejected — mixing project-list state (hydration-authoritative) with row state (fleet-status-authoritative) confuses the reconciliation semantics. Keep them as two independent slices, join at the derived-selector level. |
| Multipart writes for project CRUD | JSON body | Per D-36 the role rule mandates multipart/form-data for write endpoints; JSON body silently 200-no-ops. Same rule Phase 115 hit for archive-endpoint shape (though archive uses JSON body per its route — verify this contradicts or is a Phase 115 deviation). **See § Concerns.** |
| Body-edit distributed via existing sweep | Ship a new companion file | Rejected per D-34 — the existing 4-row entry in `catalog.ts:216-244` already ships `SKILL.md`; adding a companion is not needed. |
| localStorage for collapse state | sessionWorking-store | Per D-40 localStorage is fine — collapse is personal, not shared, not per-tab-ephemeral. |
| Custom drop-lane component per project section | Reuse `CollapsedPanelCloseLane`'s pattern inline | The pattern is easier to inline into `PrettyConversationsPanel.tsx` because there's already a state-per-section discipline (`archivedExpanded` is per-section). One `isDragOverProjectSlug: string | null` state variable covers all projects. |

**Installation:** No packages to install. All required dependencies already in `package.json`.

**Version verification:** N/A — reusing existing installed packages.

## Package Legitimacy Audit

**Not applicable — Phase 117 installs ZERO external packages.** Every mechanism reuses existing internal modules or already-installed dependencies (`react`, `lucide-react`, `js-yaml`, `multer`, `express`, `zod`, `ssh2`, `vitest`, `@testing-library/react`).

Phase 115's supply-chain check confirmed `lucide-react` is already a dep (`grep -c "lucide-react" package.json` returns 1); Phase 116's package.json audit further confirms `js-yaml`, `express`, `multer`, `zod` are all pre-existing. No `slopcheck` or registry probe needed.

## Architecture Patterns

### System Architecture Diagram

```
                  ┌──────────────────────────────────────────┐
                  │           BROWSER / CLIENT                │
                  │                                          │
User drags row ──▶│ PrettyConversationRow (onDragStart)      │
                  │   sets text/plain + application/x-skynet-│
                  │   row (rich payload w/ session id)       │
                  │                                          │
User drops on ──▶│ PrettyConversationsPanel                  │
project section  │   (per-project drop lanes)                │
                  │   handleProjectDrop(slug, sessionId)     │
                  │      │                                    │
                  │      ▼                                    │
                  │ project-membership-api.setProjectField() │
                  │      │                                    │
                  │      ▼                                    │
                  │ POST /session/:sessionId/project (JSON   │
                  │   { hostId, project: <slug|null> })      │
                  └────────┬─────────────────────────────────┘
                           │
              ┌────────────▼────────────┐
              │      SKYNET BACKEND      │
              │                          │
              │  session-project-write.ts│ (new route file)
              │    resolveHostById       │
              │    connectOneShot        │
              │    ↓                     │
              │  identity-artifact-      │ (new methods)
              │  reader.ts:              │
              │    readSessionProject    │
              │    writeSessionProject   │
              │    listProjects          │
              │    readProjectFile       │
              │    createProject         │
              │    archiveProject        │
              │    ↓                     │
              │  SSH exec + SFTP OR      │
              │  LOCAL bind-mount fs     │
              │    ↓                     │
              │  subscription-registry   │
              │  .publishProjectList-    │
              │    Changed()             │────┐
              │                          │    │
              │  fleet-status wire:      │    │
              │  FrontendProjectList-    │    │
              │    ChangedFrame          │    │
              └──────────────────────────┘    │
                           │                   │
              ┌────────────▼────────────┐      │
              │  FLEET SUBSTRATE (host)  │      │
              │                          │      │
              │  ~/fleet/projects/<slug>/│      │
              │    project.md            │      │
              │  ~/fleet/projects/       │      │
              │    archive/<slug>/       │      │
              │                          │      │
              │  ~/fleet/identities/     │      │
              │    <name>/<name>.md      │      │
              │    (or session file —    │      │
              │     see § Concerns)      │      │
              │      frontmatter:        │      │
              │        project: <slug>   │      │
              │                          │      │
              │  ~/.claude/skills/id/    │      │
              │    SKILL.md              │      │
              │    (post-sweep, on next  │      │
              │     /id <name> load,     │      │
              │     reads project.md)    │      │
              └──────────────────────────┘      │
                           ▲                     │
                           │                     │
              ┌────────────┴────────────┐        │
              │      DISTRIBUTOR         │        │
              │                          │        │
              │  substrate/skills/id/    │        │
              │    SKILL.md (source)     │        │
              │    ↓                     │        │
              │  catalog.ts (4-row       │        │
              │    entry — no change)    │        │
              │    ↓                     │        │
              │  run-sweep.ts (composer) │        │
              │    ↓                     │        │
              │  ssh-push.ts (SFTP)      │        │
              └──────────────────────────┘        │
                                                   │
                        ┌──────────────────────────▼──┐
                        │  BROWSER (WS subscriber)      │
                        │  fleet-status-client.ts       │
                        │    onProjectListChanged?.()   │
                        │      ↓                        │
                        │  conversation-store           │
                        │    setProjects(...)           │
                        │      ↓                        │
                        │  PrettyConversationsPanel     │
                        │    re-derive projects buckets │
                        │    re-render                  │
                        └───────────────────────────────┘
```

### Recommended Project Structure (additions only)

```
src/
├── backend/
│   ├── claude-session/
│   │   └── identity-artifact-reader.ts    (+~400 LOC — new methods for project CRUD + session project: field)
│   ├── database/routes/
│   │   ├── project-list.ts                (NEW — GET /projects/:hostId, POST /projects/create, POST /projects/:slug/archive)
│   │   └── session-project-write.ts       (NEW — POST /session/:sessionId/project)
│   └── fleet-status/
│       └── wire-protocol.ts               (+ FrontendProjectListChangedFrame + makeProjectListChangedFrame helper)
│       └── subscription-registry.ts       (+ publishProjectListChanged() + projectListChanged cache for snapshot-on-subscribe)
├── ui/
│   ├── api/
│   │   ├── project-list-api.ts            (NEW — listProjects, createProject, archiveProject fetch wrappers)
│   │   ├── session-project-api.ts         (NEW — setSessionProject(hostId, sessionId, slug|null))
│   │   └── fleet-status-client.ts         (+ onProjectListChanged callback + switch case)
│   ├── features/pretty-conversations/
│   │   ├── PrettyConversationsPanel.tsx   (+ project sections render + drop lanes + collapse state + create-project button)
│   │   ├── PrettyProjectSectionHeader.tsx (NEW — one row per project header w/ icon, name, new-conversation button, DnD lane wrapper)
│   │   └── CreateProjectModal.tsx         (NEW — auto-slugify + duplicate-slug rejection)
│   └── state/
│       ├── conversation-store.ts          (+ projects slice + useProjects hook + snapshot builder extension for project buckets)
│       └── use-collapsed-project-slugs.ts (NEW — localStorage-backed hook for per-project collapse state)
└── substrate/
    └── skills/id/
        └── SKILL.md                       (+ ~20 lines: project-awareness clause after § 2 step 3 "Read any per-identity specialization")
```

### Pattern 1: LOCAL / REMOTE branch split on `isLocalHostId(hostId)`

**What:** Every artifact operation (read, write, list, exists, remove) branches on whether the host is in the `IDENTITIES_LOCAL_HOST_IDS` allowlist. LOCAL uses `node:fs/promises` against `IDENTITIES_HOST_DIR` bind-mount; REMOTE uses SSH exec + SFTP.

**When to use:** Every new method added to `identity-artifact-reader.ts`.

**Example (verified verbatim from existing code):**
```typescript
// Source: identity-artifact-reader.ts:441-475 (readIdentityFile)
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
  // REMOTE branch — direct interpolation is safe: identityKey validated by IDENTITY_KEY_RE
  const cmd = `cat "$HOME/fleet/identities/${identityKey}/${identityKey}.md" 2>/dev/null || true`;
  const stdout = await execWithTimeout(conn, cmd);
  return { markdown: stdout };
}
```

**Applied to projects:** `readProjectFile(conn, slug)` reads `~/fleet/projects/<slug>/project.md` via the identical shape.

### Pattern 2: Multipart write endpoints with `data` JSON field

**What:** POST/PUT endpoints for on-disk artifact writes are `multipart/form-data`, carrying a `data` field with the JSON payload (plus optional binary fields for avatars/etc.). A JSON body silently 200-no-ops per `box-map.md § Operating`.

**Example (verified from `roles-create.ts:286-317`):**
```typescript
router.post(
  "/",
  multipartOriginGuard,
  authenticateJWT,
  (req, res, next) => {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
      res.status(415).json({ error: "roles create requires multipart/form-data with `data` field" });
      return;
    }
    next();
  },
  upload.single("avatar"), // multer.memoryStorage()
  async (req, res) => {
    const payload = parseMultipartRolePayload(req); // parses req.body.data as JSON
    if (payload === null) return res.status(400).json({ error: "Invalid JSON in data field" });
    // ... validate + provision ...
  }
);
```

**Applied to projects:** `POST /projects/create` (multipart, field `data` = JSON `{hostId, displayName}`) — no binary fields needed for v1 per D-25.

**⚠️ INCONSISTENCY WITH PHASE 115:** The `identity-archive.ts:76-79` archive POST uses a **JSON body** (`{hostId: number}`), not multipart. This appears to contradict D-36's "multipart-only" rule but is presumably acceptable because sentinel-drop routes take a small payload without file uploads. **The planner should decide:** are project routes multipart (like roles-create) or JSON (like identity-archive)? See § Concerns.

### Pattern 3: Distinct wire message for a distinct pool

**What:** When a new class of frontend-visible entity emerges that doesn't share the interactive session pool's shape (activity, working status, etc.), give it its OWN frame kind in the `FrontendOutboundFrame` discriminated union rather than bolting fields onto `SessionState`.

**Example (verified from `wire-protocol.ts:577-644` + `subscription-registry.ts:61-65`):**
```typescript
// wire-protocol.ts
const FrontendIdentityArchivedFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("identity-archived"),
  name: z.string(),
  hostId: z.string(),
  hostname: z.string(),
});

export const FrontendOutboundFrame = z.discriminatedUnion("type", [
  FrontendSnapshotFrameSchema,
  FrontendUpdateFrameSchema,
  FrontendGoneFrameSchema,
  FrontendPongFrameSchema,
  FrontendIdentityArchivedFrameSchema, // new discriminant, additive
]);

export function makeIdentityArchivedFrame(name, hostId, hostname) {
  return { schemaVersion: FRAME_SCHEMA_VERSION, type: "identity-archived", name, hostId, hostname };
}

// subscription-registry.ts (idempotent publish + snapshot replay)
publishIdentityArchived(name, hostId, hostname) { ... }
```

**Applied to projects:** Add `FrontendProjectListChangedFrameSchema` with `{type: "project-list-changed", projects: Array<{slug, displayName, hostId, hostname, archived: boolean}>}`. Publish on any project create / archive / rename / session-project-field change. Registry maintains a cache and replays on subscribe. **FRAME_SCHEMA_VERSION HELD AT 1** per the additive-optional invariant established in Phase 41 and maintained through every subsequent extension.

### Pattern 4: Coral overlay drop-target (hover-only, no baseline)

**What:** Drop targets show **NO coral tint at rest** — coral only appears while the cursor is over the target during an active drag. `CollapsedPanelCloseLane.tsx` is the canonical example (per D-23 palette).

**Example (verified from `PrettyConversationsPanel.tsx:1636-1647`):**
```typescript
{isBadgeDragOver && (
  <div
    data-testid="convlist-drop-preview"
    className="absolute inset-0 pointer-events-none"
    style={{
      background: "rgba(255, 184, 150, 0.22)",   // hover fill
      border: "2px solid rgba(255, 184, 150, 0.60)", // hover border
      zIndex: 30,                                 // matches AppShell coral layer band
      transition: "opacity 120ms ease",
    }}
  />
)}
```

**Applied to projects:** Each project section renders this overlay when `dragOverProjectSlug === thisSlug`. The state machinery mirrors `isBadgeDragOver` — set `true` on `dragover` inside the section's outer div, clear on `dragleave` (bounding-rect guard against child crossings) and `dragend` (window-level for Escape-cancel).

**Load-bearing invariants** (from `CollapsedPanelCloseLane.tsx` file header):
- **Type-gate dragover FIRST**: only accept drags carrying `application/x-skynet-row`; row-drags without that MIME must fall through so browser default not-a-drop-target semantic is preserved.
- **Bounding-rect stateless guard on dragleave**: child boundary crossings fire spurious dragleave; check `stillInside = clientX/Y ∈ el.getBoundingClientRect()` before clearing state.
- **Window-level dragend listener**: Escape-cancel doesn't fire a dragleave; only dragend on the source is reliable. Mirror `PrettyConversationsPanel.tsx:1499-1510`.
- **`isolation: isolate`** on the overlay's parent to sandbox z-index (verified pattern from `SplitView.tsx:417`).

### Pattern 5: DnD source contract (row → drop target)

**What:** `PrettyConversationRow.tsx:949-973` writes TWO MIMEs to `dataTransfer` on `onDragStart`:
- `text/plain` = `row.id` (fallback for scaffold tests)
- `application/x-skynet-row` = JSON blob `{ id, host, targetTmuxSession, fleetOnly, rdpHostRow }` (rich payload)

**Verified example:**
```typescript
// Source: PrettyConversationRow.tsx:949-973 verbatim
const onRowDragStart = useCallback(
  (e: DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData("text/plain", row.id);
    e.dataTransfer.setData(
      "application/x-skynet-row",
      JSON.stringify({
        id: row.id,
        host: row.host ?? null,
        targetTmuxSession: row.targetTmuxSession ?? null,
        fleetOnly: row.fleetOnly === true,
        rdpHostRow: row.rdpHostRow === true,
      }),
    );
    e.dataTransfer.effectAllowed = "move";
  },
  [row.id, row.host, row.targetTmuxSession, row.fleetOnly, row.rdpHostRow],
);
```

**Applied to projects:**
- **No changes needed to the row-side DnD source** — the existing `application/x-skynet-row` payload already carries everything the project drop target needs (`host` for hostId, `targetTmuxSession` for identity name → session key, `rdpHostRow` for D-08 refuse-terminals gate).
- **Project drop lanes read the rich payload**, parse the JSON, and refuse if `rdpHostRow === true` (per D-08 terminal exclusion).

### Anti-Patterns to Avoid

- **Don't bolt `project: string | null` onto `SessionState`.** Session state carries live activity signals (working, dormant, recycling); project membership is an on-disk assignment. Distinct pools per Pattern 3 above.
- **Don't put project list in `state.identities`.** Per Phase 115's `archivedFleetRows` separation — inert/list-like data lives in its own slice.
- **Don't add a "Projects" divider chip** wrapping the individual project headers (D-10 explicit rejection). Each project header stands alone.
- **Don't emit YAML `null` or empty string for `project:`** when the field is cleared. Follow the absent-⇒-omit invariant used for `title`/`voice`/`avatar`/`task` in `buildIdentityFileBody` (`identity-birth-orchestrator.ts:495-586`) — delete the key entirely from the frontmatter dict, don't emit `project: null`.
- **Don't use `git`-based versioning for `.pinned` semantics on the project directory.** Project dirs contain freeform user content and grow (per shape: "screenshots, decision logs"); do not add any code path that enumerates the whole dir for cosmetics parsing.
- **Don't hand-edit installed `SKILL.md` copies on any managed host.** The distributor is the authority; any manual edit will be blown away on next sweep. Per D-34.
- **Don't add a `checkpoint:human-verify` before installing packages.** No packages install this phase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML frontmatter emit | Custom template string with hand-quoting | `yaml.dump(pairs, {sortKeys:false, lineWidth:-1, noRefs:true, forceQuotes:false})` per `identity-birth-orchestrator.ts:575` | Handles colons, quotes, newlines automatically. Testing `stringifyColorHueForYaml` proves the MDXEditor round-trip is stable. |
| YAML frontmatter parse | Regex + `String.split` | `extractCosmeticsFromFrontmatter`-shape helper + `yaml.load` on the frontmatter block via `identity-artifact-reader.ts:2487-2578` | Field narrowing, error-tolerant parse-failure logging, boolean-vs-string tolerance. |
| Atomic file write | Direct `fs.writeFile` on the final path | `writeMarkdownFileAtomic(conn, targetPath, contents)` (LOCAL: fs.writeFile tmp + fs.rename; REMOTE: SFTP tmp + `ext_openssh_rename@openssh.com`) | Non-atomic writes lose data on mid-write crashes. The atomic helper carries the EEXIST fix from patch 260802-qrw. |
| SSH command timeout | Raw `execCommand` without race | `execWithTimeout(conn, cmd)` — 15s Promise.race | Unresponsive SSH hangs the whole request until nginx `proxy_read_timeout` fires (15s). |
| Slug normalization | Regex + string ops scattered per call site | ONE `normalizeToSlug(input): string | null` helper — kebab-case, lowercase, reject empty/reserved | User's exact algorithm per D-25 spec: `lowercase → replace non-[a-z0-9] runs with '-' → trim leading/trailing '-'` |
| Duplicate-slug rejection | Race-prone check-then-write | Rely on `mkdir -p` failing on EEXIST OR probe via `find`/`ls` before writing — but do the probe on the same SSH connection as the write | Race is theoretical (single-user, single-writer) but the probe-then-write pattern is well-precedented in `roles-create.ts` |
| DnD state machine | Custom drag-tracking hook | Reuse the `isBadgeDragOver` / `isDragOverProjectSlug` local state pattern from `PrettyConversationsPanel.tsx:1490-1555` | Every existing drop target in Skynet uses this shape; introducing a new one fragments the mental model. |
| Wire event schema | Ad-hoc JSON | Add to `wire-protocol.ts` discriminated union with a `z.object` schema | Every wire frame goes through zod validation on ws.onmessage; adding an untyped frame breaks the client dispatcher. |
| Distributor changes to ship the SKILL.md amendment | Hand-edit installed copies OR add a new companion | Body-edit `substrate/skills/id/SKILL.md`; the existing catalog entry at `catalog.ts:216` picks it up on next sweep | Per D-34, distributor is authoritative. |
| Backend broadcast on project-list-change | Poll from client | `subscription-registry.publishProjectListChanged` (mirror `publishIdentityArchived`) with snapshot-on-subscribe replay | Consistent with Phase 115; frontend already handles WS reconnect + snapshot dispatch. |
| localStorage persistence for collapse state | Custom `window.localStorage.setItem` scattered | Use the existing `ACTIVE_SET_STORAGE_KEY`-style pattern (`conversation-store.ts:270`) — a small dedicated hook with hydrate-on-mount + set-on-toggle | Silent try/catch on all reads/writes required (mobile Safari private mode); the store already has the pattern. |

**Key insight:** Every mechanism this phase needs already exists in the codebase. The work is composition, not construction. If a plan proposes writing new atomic-file, SSH-exec, YAML-parse, DnD, wire-schema, or state-hook infrastructure, redirect to the existing helper.

## Runtime State Inventory

This is a **greenfield feature**, not a rename/refactor — no existing runtime state to migrate. Sessions without a `project:` field continue to load unchanged (D-35 backward-compat). Skipping the migration inventory categories.

**Nothing found in category — this is a new feature, not a rename/refactor.**

## Common Pitfalls

### Pitfall 1: Slug parse race between frontend and backend

**What goes wrong:** Frontend auto-slugifies "My Project!" → `my-project` and shows it to user; backend independently re-slugifies from the raw name and gets `my-project` too — but a small algorithm drift (e.g., how consecutive punctuation is compressed) produces different slugs, and the user's dupe-check pass on the client returns green while the backend rejects with 409.

**Why it happens:** Two independent implementations of the slugify rule.

**How to avoid:** The **backend is authoritative** for slug computation per D-25 (auto-slugify happens at submit). The frontend must EITHER (a) submit the raw display name and let backend derive the slug, and echo the slug back for display, OR (b) share a slugify function via a common module. Recommended: option (a) — one authoritative site.

**Warning signs:** Two `.replace(/[^a-z0-9]+/g, '-')`-style regexes in different files.

### Pitfall 2: Session `project:` field write path is unclear

**What goes wrong:** The CONTEXT says `project:` is a session-file frontmatter field (D-05), but the identity artifact reader has separate concepts of "identity file" (`~/fleet/identities/<name>/<name>.md`) and "session file" (JSONL under `~/.claude/projects/*/`). A row's `.session-file` is not what the id-skill reads on `/id <name>` load — the id-skill reads the IDENTITY file.

**Why it happens:** D-32 says the id-skill reads the identity file's frontmatter for `project:`, but D-05 says "membership lives in each session file's frontmatter." **The two disagree unless "session file" in D-05 means the identity file (which anchors an identity's conversation).**

**How to avoid:** The planner MUST resolve this. Reading D-05 in context with D-32 and the CONTEXT `<canonical_refs>` block ("`src/backend/claude-session/per-identity-file.ts` — per-identity file operations (frontmatter-aware read/write)"), the intended interpretation appears to be: **`project:` lives in the IDENTITY file's frontmatter** (`~/fleet/identities/<name>/<name>.md`), alongside the existing `role:`, `displayName:`, `task:`, `coordinator:` fields. This matches the "one conversation = one identity" mental model and is what `extractCosmeticsFromFrontmatter` is set up to read. **See § Concerns for the planner's decision surface.**

**Warning signs:** A plan step that says "write to session-file-parser.ts" — the JSONL-tail parser has no writer surface. If the planner is writing to session files, that's the wrong file.

### Pitfall 3: Terminal exclusion is more than a UI gate

**What goes wrong:** Per D-08, terminals are excluded from projects entirely — drop targets refuse them; they don't get a `project:` field on any file. The frontend gate is `canonicalArchiveIdForRow`-style refuse-if-rdpHostRow, but if a coordinator or other flow accidentally writes `project:` to a terminal's identity file, the id-skill's project-load clause will fire and load the project into a terminal identity's context — which is nonsensical.

**Why it happens:** The UI enforces the constraint, but the backend write endpoint doesn't.

**How to avoid:** Add a **backend gate** on `writeSessionProjectField` that refuses if the target identity's frontmatter carries `role: <terminal-role>` OR if the identity is otherwise identifiable as a terminal (e.g., `rdpHostRow`-shape lookup). At minimum, document the assumption that the frontend is the only writer and rely on the frontend gate; but if terminals ever gain a project field by accident, the id-skill load path already gracefully no-ops per D-33 as long as the slug points to a non-existent directory. **Verify the id-skill amendment specifies "load only if the project directory exists on disk" — D-33 does specify this.**

**Warning signs:** A plan step that says "write project: to terminal frontmatter." No plan step should ever propose this.

### Pitfall 4: Sidebar re-render cascade on any project write

**What goes wrong:** Backend broadcasts `project-list-changed` on every session-project-field write. If the frontend's `useProjects` hook triggers a full sidebar re-derivation (identities × projects × sessions × pins), a bulk drag operation (drag 20 conversations one-at-a-time) causes 20 full re-derivations. Existing snapshot memoization keys on `snapshotVersion` (bumps on every mutation) — 20 mutations = 20 snapshot rebuilds.

**Why it happens:** Store snapshot version bumps on every project write, invalidating the memo.

**How to avoid:** The existing `computeSnapshot` cache pattern (`conversation-store.ts:1028`) already handles this — a re-derivation is O(N conversations) which is fast for realistic N (~50 rows in Ashley's typical fleet, per Phase 41 shape). Do NOT try to micro-optimize by adding project-scoped selectors; the snapshot rebuild is cheap. **Warning sign:** any plan step that adds per-project `useSyncExternalStore` subscriptions.

### Pitfall 5: Frontmatter write clobbers other fields

**What goes wrong:** `writeSessionProjectField(hostId, sessionId, slug)` reads the identity file, sets `project: <slug>` in the frontmatter dict, dumps yaml, writes back. If the parse-then-emit round-trip drops a field (because `extractCosmeticsFromFrontmatter` is field-narrowing, not a full round-trip), other frontmatter fields silently disappear.

**Why it happens:** `extractCosmeticsFromFrontmatter` (`identity-artifact-reader.ts:2487`) accepts only the 7 known fields (displayName, title, colorHue, voice, avatar, coordinator, task). Any other frontmatter field (`role:`, `project:`, user-added fields) is dropped on the round-trip.

**How to avoid:** The project-field writer must NOT go through `extractCosmeticsFromFrontmatter`. Instead:
1. `readIdentityFile(conn, key)` → get raw markdown.
2. Parse the frontmatter block with a full `yaml.load` (not the narrowing extractor).
3. Mutate the ONE `project` key on the resulting dict (add / update / delete).
4. Emit via `yaml.dump` with `sortKeys: false` to preserve field order — same options as `identity-birth-orchestrator.ts:575`.
5. Concatenate `---\n${yamlBody}---\n${bodyAfterFrontmatter}` and write back atomically.

**Alternatively**, extend `extractCosmeticsFromFrontmatter` to preserve unknown fields via a spread — but this is a wider refactor. **Simpler:** implement a project-specific reader/writer that does the full round-trip locally without touching the narrowing extractor.

**Warning signs:** A plan step that calls `extractCosmeticsFromFrontmatter` before writing.

### Pitfall 6: Distributor sweep timing surprises

**What goes wrong:** Body-edit `SKILL.md` in the repo, push to origin, deploy Skynet backend. The distributor sweep is triggered by ssh-poll-orchestrator on some cadence (probably per-host per-poll-cycle) — the amendment may not land on every host immediately, especially hosts that are dormant or offline at deploy time.

**Why it happens:** Sweeps are per-host, per-tick; a dormant host doesn't sweep until it wakes.

**How to avoid:** Nothing to fix in code — this is a known deploy semantic (see canonical_refs `.notification to peer identities post-deploy`). Just be honest in the phase's deploy motion: peer identities need a relay DM one turn after successful deploy per shape file's Vehicle notes.

**Warning signs:** A plan step that asserts "post-deploy, every host has the amendment." That's aspirational, not guaranteed.

### Pitfall 7: DnD wire-contract type gate omission

**What goes wrong:** Project drop lanes accept `application/x-skynet-badge` drags (identity badges from open panes), which are meant for tab-close semantics, not project assignment. The drop fires, the badge tabId is treated as a session id, and either 400s at the backend or (worse) silently writes `project:` to a wrong session file.

**Why it happens:** The DnD wire has TWO MIMEs (`application/x-skynet-row` for row drags, `application/x-skynet-badge` for badge drags), and both are readable at drop time.

**How to avoid:** Project drop lanes must **type-gate on `application/x-skynet-row` ONLY** at dragover time. Badge drags fall through with no preventDefault (browser default not-a-drop-target semantic). This mirrors `CollapsedPanelCloseLane.tsx:152` which is the inverse (badge-only, refuse rows) — a symmetric type-gate.

**Warning signs:** A plan step that reads `application/x-skynet-badge` from a project drop handler.

## Code Examples

### Reading + Rewriting an Identity File's `project:` Frontmatter (preserving all other fields)

```typescript
// Source: pattern extracted from identity-artifact-reader.ts patterns; NEW method to add.
export async function writeSessionProjectField(
  conn: SSHClientType | null,
  identityKey: string,
  projectSlug: string | null,   // null clears the field
): Promise<void> {
  if (!IDENTITY_KEY_RE.test(identityKey)) throw new Error("invalid identityKey");
  if (projectSlug !== null && !PROJECT_SLUG_RE.test(projectSlug)) {
    throw new Error("invalid project slug");
  }

  // 1. Read the current identity file.
  const { markdown } = await readIdentityFile(conn, identityKey);
  if (markdown.length === 0) throw new Error(`identity ${identityKey} file missing`);

  // 2. Split into frontmatter + body.
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`identity ${identityKey} has no frontmatter`);
  const [, frontmatterRaw, bodyAfter] = match;

  // 3. Full yaml.load — preserves ALL fields (not the narrowing extractor).
  let parsed: Record<string, unknown>;
  try {
    parsed = (yaml.load(frontmatterRaw) as Record<string, unknown> | null) ?? {};
  } catch (err) {
    throw new Error(`identity ${identityKey} frontmatter parse failed: ${(err as Error).message}`);
  }

  // 4. Mutate the ONE `project` key.
  if (projectSlug === null) {
    delete parsed.project;
  } else {
    parsed.project = projectSlug;
  }

  // 5. Emit — sortKeys:false preserves field order.
  const yamlBody = yaml.dump(parsed, {
    sortKeys: false,
    lineWidth: -1,
    noRefs: true,
    forceQuotes: false,
  });

  // 6. Concatenate + atomic write via existing writeIdentityFile helper.
  const newContents = `---\n${yamlBody}---\n${bodyAfter}`;
  await writeIdentityFile(conn, identityKey, newContents);
  // ⚠️ writeIdentityFile in identity-artifact-reader.ts:2861 is the atomic-file
  // variant, DISTINCT from per-identity-file.ts's writeIdentityFile (which
  // targets sentinel-basename files under an allowlist). Use the atomic-file
  // one for full identity-md rewrites.
}
```

### Backend Route Shape for `POST /session/:sessionId/project`

```typescript
// Source: pattern from identity-archive.ts:76-159, adapted for project field write.
router.post(
  "/:key/project",  // ← naming: key mirrors identity-archive's :key convention
  multipartOriginGuard,        // if using multipart; else omit
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId, project } = req.body as { hostId?: unknown; project?: unknown };
    // ... validate hostId is positive integer ...
    // ... validate project is either string matching PROJECT_SLUG_RE or null ...
    const key = String(req.params.key ?? "");
    if (!key || !IDENTITY_KEY_RE.test(key)) return res.status(400).json({...});

    const host = await resolveHostById(hostId, userId);
    if (!host) return res.status(404).json({ error: "Host not found" });

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try { conn = await connectOneShot(host, 3000); }
      catch { return res.status(504).json({ error: "Host unreachable" }); }
    }
    try {
      await writeSessionProjectField(conn, key, project as string | null);
      // Broadcast project-list-changed so all sidebars re-render.
      registry.publishProjectListChanged(/* enumerate all projects */);
      return res.json({ ok: true });
    } catch (err) {
      databaseLogger.error(`session project write failed key=${key}: ${(err as Error).message}`);
      return res.status(500).json({ error: "failed to write session project" });
    } finally {
      if (conn) try { conn.end(); } catch {}
    }
  },
);
```

### Frontend Project Section w/ Coral Drop Lane

```typescript
// Source: pattern from PrettyConversationsPanel.tsx:1490-1647; NEW component.
function PrettyProjectSection({ project, rows, collapsed, onToggleCollapse, onDropRow }: Props) {
  const [isDragOver, setIsDragOver] = useState(false);
  const sectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const onDragEnd = () => setIsDragOver(false);
    window.addEventListener("dragend", onDragEnd);
    return () => window.removeEventListener("dragend", onDragEnd);
  }, []);

  const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer?.types;
    // Type-gate FIRST — only accept row drags, not badge drags.
    if (!(types && Array.from(types).indexOf("application/x-skynet-row") !== -1)) return;
    e.preventDefault();
    setIsDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    const types = e.dataTransfer?.types;
    if (!(types && Array.from(types).indexOf("application/x-skynet-row") !== -1)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const stillInside =
      e.clientX >= rect.left && e.clientX <= rect.right &&
      e.clientY >= rect.top && e.clientY <= rect.bottom;
    if (stillInside) return;
    setIsDragOver(false);
  };
  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    setIsDragOver(false);
    const raw = e.dataTransfer?.getData("application/x-skynet-row") ?? "";
    if (raw === "") return;
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { return; }
    if (typeof parsed !== "object" || parsed === null) return;
    const p = parsed as { id?: string; rdpHostRow?: boolean };
    if (p.rdpHostRow === true) return;  // D-08 refuse terminals
    if (typeof p.id !== "string" || p.id.length === 0) return;
    e.preventDefault();
    e.stopPropagation();
    onDropRow(project.slug, p.id);  // upstream: writes project: <slug> to identity frontmatter
  };

  return (
    <div
      ref={sectionRef}
      className="pv-panel-group pv-project-section relative isolate"
      data-project-slug={project.slug}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {isDragOver && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: "rgba(255, 184, 150, 0.22)",
            border: "2px solid rgba(255, 184, 150, 0.60)",
            zIndex: 30,
          }}
        />
      )}
      {/* Header row: [icon] Project: <displayName> [+ new conversation button] */}
      <button
        type="button"
        onClick={onToggleCollapse}
        className="flex items-center gap-2 px-4 pt-3 pb-1.5 w-full text-left"
        aria-expanded={!collapsed}
      >
        <FolderOpen className="size-3 text-[#5c6070]/85" aria-hidden="true" />
        <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">
          Project: {project.displayName}
        </span>
        {/* ... new-conversation button (D-27), chevron ... */}
      </button>
      {!collapsed && (
        <div>
          {rows.map((row) => <PrettyConversationRowLive key={row.id} row={row} {...rowProps} />)}
        </div>
      )}
    </div>
  );
}
```

### id-skill Amendment Draft

```markdown
<!-- Source: substrate/skills/id/SKILL.md, insertion point at end of § 2 step 3
     (after "Read any per-identity specialization from the slim identity file..."),
     before step 4 (deeper reference files). -->

4. **Read the project file, if any.** Check the identity file's frontmatter for a
   `project: <slug>` key. If present:
   - Read `~/fleet/projects/<slug>/project.md` into context — it names what this
     project is for, plus any shared conventions or references the project needs.
   - Silently enumerate the top-level contents of `~/fleet/projects/<slug>/`. Hold
     the names in context. Each file's contents load on demand via a normal Read
     tool call — same shape as the runbooks enumeration below.
   - If the frontmatter has no `project:` field, OR the slug points to a directory
     that doesn't exist on disk, OR points to an archived project at
     `~/fleet/projects/archive/<slug>/`, this step is a graceful no-op — continue
     without it.

<!-- Then the existing runbooks step becomes step 5 -->
```

## State of the Art

Not applicable — this is a green-field feature specific to the Skynet fleet-substrate model, not a library-adoption phase. No "old approach vs current approach" table.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `js-yaml`, `multer`, `express`, `zod`, `ssh2`, `lucide-react` are ALL already in package.json. | Standard Stack | Would need install step; verify at plan time via `grep -c` per Phase 115/116 discipline. |
| A2 | `session-file-parser.ts` is the SESSION JSONL file parser (read-only); `identity-artifact-reader.ts` is the identity/role artifact reader (read + write). Not both handling the same file. | Pitfall 2, Concerns | If wrong, the `project:` field write path is different than described. Verify by reading `session-file-parser.ts` full docblock before writing plans. |
| A3 | `putPinnedIds([...ids], identityHosts)` lives in `src/ui/api/user-preferences-api.ts`. | Standard Stack | Trivial — verify path at planning time. |
| A4 | The DatabaseSaveTrigger.forceSave rule (D-38) is NOT strictly required for project state — since projects live on disk under `~/fleet/`, not in the in-memory SQLite DB. The CONTEXT's D-38 says "safer to save-trigger unconditionally" — this is a conservative recommendation. | Standard Stack | If wrong, project routes need one forceSave call per write. Cheap to add; add it defensively. |
| A5 | The identity-birth-orchestrator's `buildIdentityFileBody` (`identity-birth-orchestrator.ts:495-586`) is the canonical reference for absent-⇒-omit frontmatter emit. | Pitfall 5, Anti-Patterns | Verify: this pattern is the one the planner should mirror for adding `project:` to an existing frontmatter dict. |
| A6 | `PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/` (kebab-case, lowercase — narrower than `IDENTITY_KEY_RE`'s `[a-z0-9_-]` because D-04 explicitly says kebab-case). Planner picks the length cap. | Pitfall 1, § Concerns | Consistency invariant — same slug regex on frontend + backend or Pitfall 1 fires. |
| A7 | The archive-cascade per D-28 uses the existing `POST /identities/:key/archive` endpoint one-per-conversation. The frontend `handleArchiveProject(slug)` enumerates project members, fires N `archiveIdentity(hostId, key)` calls in parallel or serial. | Architecture Patterns | If wrong, and the archive-cascade requires a batch endpoint, we need a new route. Verify with planner. |
| A8 | The `useCollapsedProjectSlugs` hook uses localStorage with a JSON-serialized array of slugs, silent try/catch on read/write. | Architecture Patterns | Alignment with `conversation-store.ts:270`'s existing `pv-conv-search-hidden-once` + `pv-conv-active-set` patterns. |
| A9 | The multipart-vs-JSON decision for project routes is genuinely ambiguous — Phase 115 uses JSON for sentinel-drop, roles-create uses multipart. Planner picks. | Architecture Patterns / Concerns | If wrong, the frontend API client shape differs (FormData vs axios.post JSON). Trivial to reverse at implementation time. |
| A10 | The `substrate/skills/id/SKILL.md` file body edit is a **body-only** change — no frontmatter change, no companion file change. The 4-row catalog entry stays. | id-skill Amendment | Verify: the SKILL.md frontmatter `distributed: true` stays; only the body between step 3 and step 5 gets a new step 4. |
| A11 | `identity-artifact-reader.ts`'s `writeIdentityFile` (the LONG-form 3-arg variant at :2861, NOT the SHORT-form 4-arg variant in `per-identity-file.ts:202`) is what a project-field write should use — the long-form is byte-shape-parity to `writeRoleFile`. | Code Examples | Two functions share a name across two modules. Planner must NOT confuse them. The `per-identity-file.ts` one is for sentinel basenames only (`.pinned`, `.archive-requested`, `relay.json`); the `identity-artifact-reader.ts` one is for full identity-md rewrites. |
| A12 | The user's on-disk fleet path is bind-mounted at `/fleet/` inside the Skynet container per `IDENTITIES_HOST_DIR` env, and `ROLES_HOST_DIR` mirrors it. Projects would need a new `PROJECTS_HOST_DIR` env (or defensively fall back to `os.homedir()/fleet/projects`). | Recommended Project Structure | Verify with operator at deploy time — if `/fleet/` is the bind-mount root and `projects/` is a sibling of `identities/`/`roles/` inside it, the same `.tld-mount` covers all three. |
| A13 | Phase 115's SUMMARY confirms `lucide-react` icons `FolderOpen`, `Folder`, `Layers` are available (per D-Claude-discretion "candidates"). All three are standard `lucide-react` glyphs. | Standard Stack | Trivial — icon choice is discretionary and swappable. |

## Open Questions

1. **Where does `project:` frontmatter actually live — the IDENTITY file (`<key>/<key>.md`) or the SESSION file (JSONL tail metadata)?**
   - **What we know:** D-05 says "session file's frontmatter"; D-32 says "identity file's frontmatter." The id-skill loads on `/id <name>` before any session is opened, so it can only read the identity file's frontmatter at that point.
   - **What's unclear:** Whether "session file" in D-05 is being used colloquially to mean the identity file (which anchors the conversation session).
   - **Recommendation:** The planner should ask the user for a clarification via `discuss-phase` OR default to the identity-file interpretation (which is what the id-skill amendment requires and what existing tooling supports). Flag this as a locked-decision resolution needed.

2. **Multipart vs JSON body for project write endpoints?**
   - **What we know:** D-36 says "multipart contract per role rule for write endpoints — must be `multipart/form-data` with field `data`, per `box-map.md § Operating`; JSON body silently 200-no-ops." Phase 115's identity-archive endpoint uses JSON body, contradicting this rule (verified in `identity-archive.ts:76-79`).
   - **What's unclear:** Whether the multipart rule applies to ALL write endpoints or only writes that carry file uploads (roles-create, avatar upload, etc.). Small JSON-only endpoints like sentinel-drop may be exempt.
   - **Recommendation:** Planner picks; both work. Recommend JSON for the small sentinel-drop-shaped writes (session project field, archive-project), multipart for the create-project endpoint IF it needs to accept an optional avatar/etc. in v2 (v1 doesn't per D-25 — v1 has only `displayName:` frontmatter and empty body).

3. **Should the archive-cascade fire N `archiveIdentity` calls (one per member conversation) sequentially or in parallel?**
   - **What we know:** D-28 says "CASCADED across every conversation currently in the project via that same mechanism." The mechanism is a fire-and-forget POST per identity.
   - **What's unclear:** UX-side, if 20 sequential POSTs take ~5s, the sidebar sees the disappearing rows over 5s; parallel Promise.all fires them in ~500ms.
   - **Recommendation:** Fire in **parallel** (`Promise.all(members.map(m => archiveIdentity(m.hostId, m.key)))`) — matches user expectation ("archive this project AND all conversations inside it" reads as one atomic action). Handle partial-failure by logging warns per-identity but not blocking the project-directory move.

4. **What's the wire event's exact payload shape — full project list or delta?**
   - **What we know:** D-37 names `project-list-changed` and D-39 wants a projects-derived selector. Phase 115's `identity-archived` frame carries per-row (name, hostId, hostname).
   - **What's unclear:** Whether the wire event carries the full projects array on every emit (simpler; ~10 rows × 3 fields = 300 bytes) or a delta (more complex; adds an "op" discriminator).
   - **Recommendation:** **Full array on every emit.** Projects are cheap (small count, small payload). Matches Phase 115 registry-cache-then-fanout discipline. Snapshot-on-subscribe replays the whole cache to reconnecting clients — same pattern.

5. **How is the project-list-changed event triggered — polling or on-write?**
   - **What we know:** Phase 115's `identity-archived` comes from ssh-poll-orchestrator's per-host sweep enumerating `~/fleet/identities-archive/`.
   - **What's unclear:** Do we grow the sweep to also enumerate `~/fleet/projects/` and `~/fleet/projects/archive/` per host? OR do project write endpoints directly call `registry.publishProjectListChanged()` in-process (skipping the sweep)?
   - **Recommendation:** **Both.** In-process publish on any write endpoint success gives ~immediate UI feedback. Sweep-side enumeration handles the reconciliation case (host restart, backend restart, out-of-band edit on disk) and the snapshot-on-subscribe path. Projects should be a per-host sweep concept OR a single-authoritative-host concept — planner decides based on the multi-host model (this codebase has Ashley as a single-user with multiple hosts; projects are per-host, not fleet-wide).

## Environment Availability

Not applicable — Phase 117 has no new external tool/service dependencies. Every dependency is either already in `package.json` (JS libs) or a fleet-substrate directory that will exist on every managed host post-first-project-create (via `mkdir -p ~/fleet/projects/` in the create-project endpoint).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (verify with `grep -c '"vitest"' package.json`) |
| Config file | vitest.config.ts (verify at plan time) |
| Quick run command | `npx vitest run <specific test files>` |
| Full suite command | `npm test` (verify) — orchestrator scope, not executor |

### Phase Requirements → Test Map

| Req ID (derived from CONTEXT.md) | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-01/D-02 | Project directory at `~/fleet/projects/<slug>/project.md` with fixed sentinel name | unit | `npx vitest run src/backend/claude-session/identity-artifact-reader.projects.test.ts` | ❌ Wave 0 |
| D-03/D-25 | `project.md` has YAML frontmatter `displayName:` and empty body on create | unit | as above | ❌ Wave 0 |
| D-04 | Slug is kebab-case, lowercased, stable | unit | slug validation test | ❌ Wave 0 |
| D-05 | Session frontmatter `project: <slug>` — read/write path | unit | identity-artifact-reader field read/write test | ❌ Wave 0 |
| D-07 | Dangling project reference: conversation falls into flat middle, no crash | integration | store snapshot test with dangling slug in frontmatter | ❌ Wave 0 |
| D-08 | Terminals refused by DnD drop lanes | UI | `PrettyConversationsPanel.test.tsx` — dispatch native DragEvent w/ rdpHostRow=true, assert no write | ❌ Wave 0 |
| D-15/D-16 | Alphabetical by display name — projects, then conversations within | unit | store snapshot test w/ 3 projects, verify order | ❌ Wave 0 |
| D-19 | Pinned + in-project floats to top of project section | unit | store snapshot test w/ pinned + project-tagged row | ❌ Wave 0 |
| D-22 | Three drop gestures work: onto section (assign), onto flat middle (clear), between projects (rewrite) | UI | panel test dispatching 3 different drops | ❌ Wave 0 |
| D-23 | Coral overlay uses verbatim palette values | UI | render test asserting style.background/border | ❌ Wave 0 |
| D-25 | Create-project modal auto-slugifies + rejects duplicate slug on submit | UI + integration | modal test + backend 409 test | ❌ Wave 0 |
| D-27 | New-conversation-inside-project pre-fills `project: <slug>` frontmatter | integration | mock NewSessionDialog onCreate, assert project field in payload | ❌ Wave 0 |
| D-28/D-29 | Archive-project confirms cascade, fires N archives + folder move | integration | mock archiveIdentity spy count = N; verify folder move | ❌ Wave 0 |
| D-30 | Archived project moves to `~/fleet/projects/archive/<slug>/` | unit | archive-project route test verifies rename destination | ❌ Wave 0 |
| D-32/D-33 | id-skill amendment: reads project.md silently on load, no-ops on missing | manual + docs | bash script test that runs `/id <name>` in a jail w/ + w/o project | ❌ Wave 0 |
| D-34 | Distributor sweep picks up amendment on next tick | manual (deploy verification) | orchestrator manual smoke post-deploy | N/A |
| D-35 | Identities without `project:` load unchanged | manual | `/id <name>` on pre-existing identity | N/A |
| D-36 | Backend project CRUD routes + `writeSessionProjectField` | unit | route-level tests mirroring `identity-archive.test.ts` shape | ❌ Wave 0 |
| D-37 | Wire event `project-list-changed` published on any project state change | unit | subscription-registry test + wire-protocol schema test | ❌ Wave 0 |
| D-38 | DatabaseSaveTrigger.forceSave called after each project-state DB write (if any DB writes) | unit | vi.mocked forceSave spy count assertion | ❌ Wave 0 |
| D-39 | Projects-derived selector produces correct buckets | unit | store snapshot test asserting bucket structure | ❌ Wave 0 |
| D-40 | Collapse state persists across reloads (localStorage-backed) | unit | localStorage read/write hook test | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched test files>` (executor scope — scoped runs only per fleet directive)
- **Per wave merge:** Same — scoped runs
- **Phase gate:** Full vitest suite + Playwright smoke run at DEPLOY motion (orchestrator scope), NOT executor scope

### Wave 0 Gaps
- [ ] `src/backend/claude-session/identity-artifact-reader.projects.test.ts` — new test file for project CRUD methods
- [ ] `src/backend/database/routes/project-list.test.ts` — new test file for project routes
- [ ] `src/backend/database/routes/session-project-write.test.ts` — new test file for session project field endpoint
- [ ] `src/backend/fleet-status/wire-protocol.test.ts` — extend with `project-list-changed` frame tests (existing file)
- [ ] `src/backend/fleet-status/subscription-registry.test.ts` — extend with `publishProjectListChanged` tests (existing file)
- [ ] `src/ui/api/project-list-api.test.ts` — new API client test file
- [ ] `src/ui/api/session-project-api.test.ts` — new API client test file
- [ ] `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` — extend with project section render + DnD tests (existing file)
- [ ] `src/ui/features/pretty-conversations/CreateProjectModal.test.tsx` — new modal test file
- [ ] `src/ui/state/conversation-store.projects.test.ts` — new store slice test file
- [ ] `src/ui/state/use-collapsed-project-slugs.test.ts` — new localStorage hook test file
- [ ] `substrate/skills/id/SKILL.md` — manual verification of amendment placement via a sandboxed `/id <name>` load test

No framework install needed. All test infrastructure exists.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `authenticateJWT` middleware on every project route (mirrors `identity-archive.ts:57`) |
| V3 Session Management | no | No new session concept — existing JWT session covers |
| V4 Access Control | yes | `resolveHostById(hostId, userId)` returns 404 (NOT 403) on cross-user / unknown hostId — prevents probe leakage. Mirrors `identity-archive.ts:105-111`. |
| V5 Input Validation | yes | `IDENTITY_KEY_RE` gate for identity keys; `PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/` for slug validation; length caps on displayName (recommend ≤80 chars per role convention) |
| V6 Cryptography | no | No new secrets or crypto primitives |
| V7 Error Handling | yes | Generic error messages returned to client (`{error: "failed to write session project"}`); underlying error logged server-side only. Mirrors `identity-archive.ts:143-147`. |
| V10 Malicious Code | yes | Slug regex prevents path traversal (no `.`, `..`, `/`, shell metacharacters); `shellEscape` on any user-supplied value that flows into remote exec |
| V13 API | yes | JSON body vs multipart posture consistent with existing routes; CSRF protection via `multipartOriginGuard` for multipart endpoints (per Phase 103 D-10) |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via slug (e.g., `../..`) | Tampering | `PROJECT_SLUG_RE` gate BEFORE any I/O; belt-and-suspenders `absPath.startsWith(root + "/")` assertion post-compose (mirror runbooks-editor.ts:49-51) |
| Shell injection via slug interpolation | Tampering | `shellSingleQuote` on every user-supplied value before shell exec; the slug regex is the AUTH gate, escape is the INJECTION gate. Mirror `runbooks-editor.ts:156-158`. |
| Cross-user project access | EoP | `resolveHostById(hostId, userId)` filters — cross-user hostId returns 404 (not 403) to avoid probe distinguisher |
| Info disclosure via error message | Info Disclosure | Fixed-shape error responses; underlying `err.message` logged server-side only. Mirror `identity-archive.ts:143-147`. |
| DoS via oversized project.md body | DoS | `IDMEDIT_MAX_MARKDOWN_BYTES = 2_000_000` byte-cap on any markdown write (already enforced by `writeIdentityFile` at :2880). Reuse verbatim. |
| Malicious `project:` value on session frontmatter poisoning archive tree | Tampering | Slug regex gate on WRITE path; on READ path (id-skill amendment) gracefully no-op if directory doesn't exist (D-33) — so a poisoned `project: ../..` slug can't traverse into an arbitrary directory read. |
| Race on duplicate-slug rejection | Concurrency | Since Ashley is single-user, race is theoretical. Rely on `mkdir` returning EEXIST as the atomic guard; fail with 409 on that error code. |
| Cascade archive orphaning identities | Data integrity | Frontend fires N `archiveIdentity` calls; backend endpoint is idempotent per (host, identity); partial-failure logs but doesn't rollback (matches Phase 115 semantics). |

## Project Constraints (from CLAUDE.md and role rules)

**No `./CLAUDE.md`** exists at the working directory root — the project-level directives come from the box-maintainer role file at `~/fleet/roles/box-maintainer/box-maintainer.md` referenced in CONTEXT canonical_refs. Key invariants (relevant to this phase):

1. **`DatabaseSaveTrigger.forceSave` after backend DB writes** — Skynet DB is in-memory SQLite. Per D-38 and the box-maintainer role § Load-bearing invariants, any `db.insert/update/delete().run()` MUST be followed by `await DatabaseSaveTrigger.forceSave(<reason>)`. **NOTE:** Project state lives on disk under `~/fleet/`, not in the DB — so most project operations don't need this. But if the plan introduces ANY DB write path (e.g., for cache/index/audit), forceSave is mandatory.
2. **Write endpoints are multipart/form-data with field `data`** — per D-36 + role § Operating. JSON body silently 200-no-ops. **Verified inconsistency:** Phase 115's `identity-archive.ts` uses JSON body. Planner picks.
3. **Deploy is orchestrator-only** — executor's remit stops at code + commit + scoped tests green. Full-suite tests + Playwright smoke run at DEPLOY motion, not executor.
4. **Rebase before every push** — multiple identities of box-maintainer run in parallel on same branch.
5. **Never hand-edit installed distributor copies** — always edit the source in `substrate/`.
6. **No `/tmp` for in-flight scratch** — always use a bounty folder.
7. **Slugs are kebab-case, stable** — matches D-04 project slug rule.
8. **`/id save` sweep discipline** — history line + bounty updates + handoff overwrite + trim — orthogonal to this phase but shapes expected save behavior.

## Concerns

> Per instructions: if I find something that suggests a locked decision is wrong, flag it here — do NOT propose alternatives.

### Concern 1: D-05 says "session file frontmatter" but D-32 references identity file frontmatter

D-05: *"Membership lives in each session file's frontmatter as `project: <slug>`. No parallel index, no lookup table anywhere else."*

D-32: *"On `/id <name>` load, after reading the role file and any handoff, the id-skill checks the identity file's frontmatter for a `project:` field."*

The CONTEXT canonical_refs points to `session-file-parser.ts` and `per-identity-file.ts` as if they're the same layer. In this codebase:
- `session-file-parser.ts` parses the **JSONL session file** written by the Claude Code harness (Claude's transcript, tool calls, etc.). It is read-only from Skynet's perspective — the harness writes it. Skynet does NOT edit session JSONL frontmatter/metadata.
- `identity-artifact-reader.ts` reads/writes the **identity file** (`~/fleet/identities/<name>/<name>.md`) — this is what has YAML frontmatter with `role:`, `displayName:`, `task:`, etc.
- `per-identity-file.ts` is a narrow primitive layer for sentinel-basename files under `~/fleet/identities/<name>/` (allowlist: `relay.json`, `.pinned`, `.archive-requested`).

D-05 as literally written cannot be implemented — Skynet has no write path to JSONL session file frontmatter, and JSONL doesn't have YAML frontmatter (it's a JSON-lines log). D-32's identity-file interpretation is the only one implementable end-to-end.

**Planner action:** verify with user before writing plans — either (a) D-05 is using "session file" colloquially to mean the identity file (which anchors an identity's set of sessions), OR (b) some new session-file writer needs to be built (much larger scope). Recommend (a).

### Concern 2: D-36 mandates multipart writes; Phase 115 uses JSON body

D-36: *"multipart contract per role rule for write endpoints — must be `multipart/form-data` with field `data`, per `box-map.md § Operating`; JSON body silently 200-no-ops."*

But `src/backend/database/routes/identity-archive.ts` (shipped in Phase 115) uses JSON body:
```typescript
router.post("/:key/archive", authenticateJWT, async (req, res) => {
  const rawHostId = (req.body as { hostId?: unknown } | undefined)?.hostId;
  // ... JSON body directly ...
});
```

Phase 115 ships and works. Either the multipart rule is scoped to writes-with-files, or Phase 115 shipped in violation of the rule. Not a blocker for Phase 117 — planner picks consistently.

### Concern 3: The archive-cascade may need a batch endpoint

D-28: *"CASCADED across every conversation currently in the project via that same mechanism, one per conversation."*

Fire-and-forget N POSTs is fine for small N (typical project ~2-10 members). For large N or if latency matters, a single batch endpoint would be one round-trip. Not a blocker — the frontend can do the fan-out.

### Concern 4: Sweep-side enumeration of `~/fleet/projects/` adds work to a hot path

The fleet-status sweep runs every ~2s per host (verified via ssh-poll-orchestrator). Enumerating `~/fleet/projects/` and `~/fleet/projects/archive/` each tick adds two `find` commands per host per poll. For 5 hosts × 2s cadence = 5 additional SSH round-trips per second. Should be trivial cost but worth measuring at deploy time.

An alternative — publish only on writes + snapshot-on-subscribe (skip sweep enumeration) — is simpler but doesn't reconcile if projects are mutated out-of-band. Planner picks based on the multi-writer risk (Ashley alone = low risk).

## Sources

### Primary (HIGH confidence — verified via direct code read)

- `.planning/phases/117-projects-sidebar-section-with-drag-and-drop-membership-per-p/117-CONTEXT.md` — D-01..D-40 locked decisions
- `.planning/shapes/shape-projects.md` — full shape agreement with philosophy + edges
- `src/backend/claude-session/identity-artifact-reader.ts:1-1140,2470-3050` — LOCAL/REMOTE branch pattern, frontmatter extract, atomic writers
- `src/backend/claude-session/per-identity-file.ts` — sentinel-basename primitive (`.archive-requested`, `.pinned`)
- `src/backend/database/routes/identity-archive.ts` — full Phase 115 archive endpoint shape
- `src/backend/database/routes/runbooks-editor.ts:1-180` — slug-directory + fixed-sentinel routing pattern
- `src/backend/database/routes/roles-create.ts:280-450` — multipart/form-data write pattern
- `src/backend/database/routes/identity-birth-orchestrator.ts:495-586` — YAML frontmatter emit with absent-⇒-omit
- `src/backend/distributor/catalog.ts:215-244` — 4-row id-skill catalog entry
- `src/backend/distributor/run-sweep.ts:1-100` — sweep composer, byte-compare-and-push discipline
- `src/backend/fleet-status/wire-protocol.ts:544-644` — Phase 115 distinct-frame pattern for `identity-archived`
- `src/backend/fleet-status/subscription-registry.ts:1-120` — publish + snapshot-on-subscribe + idempotent-cache pattern
- `src/ui/AppShell.tsx` — fleet-status-client wiring, onIdentityArchived → upsert
- `src/ui/api/identity-archive-api.ts` — frontend fetch wrapper for archive
- `src/ui/api/fleet-status-client.ts:60-236` — ws.onmessage switch dispatcher pattern
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:1-2100` — panel structure, DnD wire contract, coral overlay, header buttons, snapshot consumption, archived-section
- `src/ui/features/pretty-conversations/PrettyConversationRow.tsx:920-975` — DnD source contract (text/plain + application/x-skynet-row)
- `src/ui/features/pretty-conversations/PrettyArchivedRow.tsx` — inert-row pattern for archived section
- `src/ui/shell/CollapsedPanelCloseLane.tsx` — canonical coral-hover-only-no-baseline drop lane
- `src/ui/shell/SplitView.tsx:140-620` — pane drop handler pattern, hasSkynetDragPayload gate
- `src/ui/state/conversation-store.ts` — snapshot builder, hook exports (useConversations/usePinnedIds/useArchivedFleetRows), pin/unpin mutators
- `substrate/skills/id/SKILL.md` — full body — insertion point for the project-awareness clause is § 2 step 3-to-4
- `.planning/phases/115-identity-archiving-from-the-frontend/115-06-SUMMARY.md` — the reference implementation for wire-message + registry + orchestrator + frontend consumer end-to-end shape

### Secondary (MEDIUM confidence — inferred from patterns)

- Multipart-vs-JSON body convention drift between Phase 115 and D-36 — verified through direct grep but the rule interpretation is judgment
- The `session-file-parser.ts` vs `identity-artifact-reader.ts` layer split — verified via file names + docblocks but D-05 reads as if they're one layer

### Tertiary (LOW confidence — assumptions to verify at plan time)

- Exact version of react, vitest, lucide-react, js-yaml (didn't run `grep -c` — planner should verify)
- Existence of `putPinnedIds` in `user-preferences-api.ts` (referenced but not read)
- The exact command shape of `substrate/skills/id/coordinator-instructions.md` and whether it needs a matching amendment (D-32 doesn't say — but coordinators skip the role-file-load path per SKILL.md § Coordinator mode, so they likely don't need project awareness in v1)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every library is directly verified in existing imports; no version resolution needed
- Architecture: HIGH — every pattern has a Phase 115 reference implementation (identity-archive) or an in-repo verbatim example
- Pitfalls: HIGH for structural pitfalls (frontmatter round-trip, DnD type-gates), MEDIUM for behavioral pitfalls (cascade parallelism, sweep enumeration cost)
- id-skill amendment: HIGH — SKILL.md body edit is a single markdown insertion, the distributor catalog is unchanged
- Wire protocol: HIGH — Phase 115's distinct-frame pattern is a byte-for-byte template

**Research date:** 2026-09-18
**Valid until:** 2026-10-18 (30 days — stable phase, all decisions locked, no fast-moving dependencies)
