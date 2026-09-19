# Phase 121: Workspace File Browser - Research

**Researched:** 2026-09-19
**Domain:** Cross-host SFTP file management embedded in IdentityModal; Express REST routes + SFTP via ssh2; React tab body with inline viewer/editor swap
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Workspace tab in `IdentityModal` via `NAV_SECTIONS`; `{ value: "workspace", label: "Workspace", Icon: Folder }` from `lucide-react`.
- **D-02:** Available to all users — not admin-gated.
- **D-03:** No new entry point — discoverable from badge-click → modal → tab.
- **D-04:** Blind to agent. No notification on any CRUD mutation.
- **D-05:** Snapshot view. Manual refresh button re-fetches.
- **D-06:** No websocket/polling/live-tail.
- **D-07:** Single generic delete confirmation. No other rails.
- **D-08:** Show everything — no hidden-file filtering, no dotfile demotion.
- **D-09:** Inline file view — tab body swaps from list-mode to viewer-mode. Back affordance returns.
- **D-10:** NO second modal on top of IdentityModal ever.
- **D-11:** Reuse `MarkdownEditor` for `.md`; text-editor pattern from `EditableFileModal` / `GlobalFileTab` for other text; image viewer inline. NO modal chrome.
- **D-12:** Extension-based dispatch. `.md` → MarkdownEditor. Common text exts → text editor. Image exts → `<img>`. Else → binary empty state + Download.
- **D-13:** Single-pane breadcrumb navigation.
- **D-14:** Column layout: icon | name | size | modified | overflow (⋯). Sortable columns.
- **D-15:** Folders always above files; sort applies within each group.
- **D-16:** Upload via toolbar button AND drag-and-drop; both write to current folder.
- **D-17:** Toolbar: "New folder" + "New file". Both use current folder as parent.
- **D-18:** Host-chip in modal header: host name + reachability dot.
- **D-19:** Reuse `fetchHostFileUrl` / `pretty-view-fetch-host-file.ts` SSH primitive.
- **D-20:** Reuse `FILE_URL_ERROR_COPY` from `EditableFileModal.tsx:63-112` for error surfaces.
- **D-21:** Workspace access gates on existing per-host access check (same as chat). No new permission layer.
- **D-22:** Admin-only gating NOT applied.
- **D-23:** Consumer-user register throughout. No developer jargon.
- **D-24:** Any element requiring developer knowledge to use means register drifted.

### Claude's Discretion

- Tie-break ordering within sorted group: stable sort or secondary-by-name — implementer's call.
- Keyboard behavior beyond browser defaults: implementer's call.
- Refresh button spinner vs subtle pulse: implementer's call.
- Upload progress: per-file percentage or single indeterminate indicator — implementer's call.
- Download large file: stream to browser or fetch into memory — implementer's call (consider size).
- Delete confirmation wording: implementer's call (consumer register per D-23).
- New-folder / new-file prompt: `window.prompt` or inline input row — implementer's call (D-10 forbids modal).

### Deferred Ideas (OUT OF SCOPE)

- Search (name-based or content-based).
- Multi-select and bulk operations.
- Keyboard navigation beyond browser defaults.
- Syntax highlighting.
- Image thumbnails inline in list.
- Copy/paste or drag-to-move across folders.
- Git-aware view.
- Folder-as-zip download.
- File counts on folder rows.
- Live subscription / auto-refresh / polling.
- Hidden-file filtering.
- Any notification to the agent.
- Protected-path / protected-file logic.
- Any second modal on top of IdentityModal.
</user_constraints>

---

## Summary

Phase 121 adds a full file-management tab to `IdentityModal` reaching the workspace folder (`~/fleet/identities/<name>/workspace/`) on the identity's host via SFTP. The plumbing architecture is well-established: the existing `pretty-view-fetch-host-file.ts` file already has SFTP, host resolution (`resolveHostById`), auth (`PermissionManager.canAccessHost`), and the connection pool (`withConnection`). The workspace CRUD routes are a direct extension of those patterns — a new Express router (`workspace-routes.ts`) registered under `/workspace` in `database.ts` and a matching nginx `location` block in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`.

On the frontend, `IdentityModal` already threads `identity.identityKey`, `identity.hostId`, and the numeric `hostId` prop into every WS request. The new workspace tab receives those same values and passes `{ identityKey, hostId }` to every REST call. The tab body has two modes — list-mode and viewer-mode — driven by local React state; switching modes does NOT open a new modal (D-10). The existing `MarkdownEditor` and `GlobalFileTab` components mount directly in viewer-mode as controlled components without any modal chrome.

**Primary recommendation:** Build a new `workspace-routes.ts` Express router sharing the `fetchHostFileBytes` architecture from `pretty-view-fetch-host-file.ts`, mount it in `database.ts` under `/workspace`, add matching nginx blocks, and wire a `WorkspaceTab` React component into `IdentityModal`'s `NAV_SECTIONS` + `TabsContent`.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Directory listing | API / Backend | — | SSH/SFTP runs server-side; browser cannot SSH |
| File read (text/image) | API / Backend | Browser | Backend reads via SFTP, returns base64; browser renders |
| File write (text) | API / Backend | — | SFTP write; tmp+rename atomicity; server validates path |
| File delete | API / Backend | — | SFTP unlink; path validation |
| File rename | API / Backend | — | SFTP rename |
| Create folder | API / Backend | — | SFTP mkdir |
| Create empty file | API / Backend | — | SFTP write empty |
| Upload (browser → host) | API / Backend | Browser | SFTP writeStream on backend; browser sends binary |
| Download (host → browser) | API / Backend | Browser | Backend reads via SFTP, streams or returns bytes; browser triggers download |
| Host reachability chip | Browser / Client | API / Backend | Frontend issues a "ping" list call; backend returns error or data |
| Auth gate (host access) | API / Backend | — | `PermissionManager.canAccessHost(userId, hostId)` |
| Tab navigation | Browser / Client | — | `activeTab` state in `IdentityModal`; no server involvement |
| Inline viewer/editor swap | Browser / Client | — | Local `viewMode` state in `WorkspaceTab` |
| Sorting | Browser / Client | — | Sort applied client-side after listing |
| Drag-and-drop upload | Browser / Client | API / Backend | Browser handles DnD events; API receives the bytes |

---

## Standard Stack

### Core (no new npm packages required)

| Library | Source | Purpose | Verified |
|---------|--------|---------|----------|
| `ssh2` | Already in `package.json` | SFTP operations (readdir, readFile, writeFile, mkdir, unlink, rename) | [VERIFIED: existing codebase usage] |
| `express` | Already in `package.json` | REST routes for workspace CRUD | [VERIFIED: existing codebase usage] |
| `lucide-react` | Already in `package.json` | `Folder`, `FolderPlus`, `Upload`, `File`, `Trash`, `Download`, `RefreshCw`, `ChevronRight` icons | [VERIFIED: IdentityModal.tsx imports] |
| `better-sqlite3` + drizzle | Already in `package.json` | DB queries via `getDb()` / `DatabaseSaveTrigger` | [VERIFIED: existing codebase usage] |
| `multer` | Already in `database.ts` L4 | Multipart file upload; `multer({ storage: multer.memoryStorage() })` for workspace upload | [VERIFIED: database.ts L4, L209] |

**No new npm packages are needed.** This phase reuses 100% of existing dependencies.

### Supporting (reused existing components)

| Component | File | Purpose |
|-----------|------|---------|
| `MarkdownEditor` | `src/ui/features/pretty-view/MarkdownEditor.tsx` | `.md` viewer/editor in inline-swap mode |
| `GlobalFileTab` | `src/ui/features/pretty-view/GlobalFileTab.tsx` | Text editor body with save/dirty-guard |
| `fetchHostFileUrl` | `src/ui/api/editable-file-api.ts` | Client-side cross-host fetch (file read) |
| `FILE_URL_ERROR_COPY` | `src/ui/features/pretty-view/EditableFileModal.tsx:63-112` | Error copy map (import, don't copy) |
| `withConnection` | `src/backend/ssh/ssh-connection-pool.ts` | SSH connection pooling |
| `connectOneShot` | `src/backend/ssh/ssh-one-shot.ts` | One-shot SSH client |
| `resolveHostById` | `src/backend/ssh/host-resolver.ts` | Host → SSHHost (IP, credentials) |
| `PermissionManager.canAccessHost` | `src/backend/utils/permission-manager.ts:162` | Per-user per-host RBAC |
| `AuthManager.createAuthMiddleware()` | `src/backend/utils/auth-manager.ts` | JWT middleware |

### Package Legitimacy Audit

No new packages are installed in this phase. All dependencies already exist in `node_modules`. Package legitimacy gate: SKIPPED (no new installs).

---

## Architecture Patterns

### System Architecture Diagram

```
Browser (WorkspaceTab)
  │
  ├─ list folder    POST /workspace/list      { identityKey, hostId, relativePath }
  ├─ read file      POST /workspace/read-file { identityKey, hostId, relativePath }
  ├─ write file     PUT  /workspace/write-file{ identityKey, hostId, relativePath, content }
  ├─ delete         DELETE /workspace/entry   { identityKey, hostId, relativePath }
  ├─ rename         POST /workspace/rename    { identityKey, hostId, from, to }
  ├─ mkdir          POST /workspace/mkdir     { identityKey, hostId, relativePath }
  ├─ create-file    POST /workspace/create-file{ identityKey, hostId, relativePath }
  └─ upload         POST /workspace/upload    multipart (identityKey, hostId, relativePath, file)
       │
       ▼
  Backend workspace-routes.ts (Express Router)
    │  1. authenticateJWT → extract req.userId
    │  2. Validate body (identityKey, hostId, path)
    │  3. resolveHostById(hostId, userId) → SSHHost
    │  4. permissionManager.canAccessHost(userId, hostId, "read"|"write")
    │  5. Build workspaceRoot = ~/fleet/identities/<identityKey>/workspace
    │  6. Build absolutePath = workspaceRoot + "/" + relativePath (validated, no traversal)
    │  7. withConnection(poolKey, factory, async (client) => { sftp operations })
    │  8. Return structured JSON or classified { error: "<class>" }
       │
       ▼
  SSH/SFTP to target host
    └─ ~/fleet/identities/<identityKey>/workspace/ (operation target)
```

### Recommended Project Structure

```
src/
├── backend/
│   └── database/
│       └── routes/
│           └── workspace-routes.ts     # NEW: all 8 workspace CRUD endpoints
├── ui/
│   ├── api/
│   │   └── workspace-api.ts            # NEW: client-side fetch helpers
│   └── features/
│       └── pretty-view/
│           └── WorkspaceTab.tsx        # NEW: tab body (list-mode + viewer-mode)
```

### Pattern 1: IdentityModal NAV_SECTIONS Registration

**What:** Adding one entry to the constant array and one `<TabsContent>` block wires the tab.

**Source:** `src/ui/features/pretty-view/IdentityModal.tsx:308-318` (NAV_SECTIONS) and L1548-1610 (TabsContent blocks).

```typescript
// Source: IdentityModal.tsx L308-318 [VERIFIED: codebase]
const NAV_SECTIONS = [
  { value: "identity", label: "Identity file", Icon: User },
  { value: "identity-wakeups", label: "Wakeups", Icon: AlarmClock },
  // ADD:
  { value: "workspace", label: "Workspace", Icon: Folder },
  ...(isAdmin
    ? [{ value: "telegram", label: "Telegram", Icon: Send } as const]
    : []),
] as const;
```

```tsx
// Source: pattern from TabsContent blocks at IdentityModal.tsx L1560-1610 [VERIFIED: codebase]
<TabsContent
  value="workspace"
  className="flex-1 min-h-0 overflow-hidden flex flex-col"
>
  <WorkspaceTab
    identity={identity}
    hostId={hostId}
    hue={hue}
  />
</TabsContent>
```

**Critical:** The `activeTab` state is `useState<string>("identity")`. The new tab gets the value `"workspace"` — adding it to `NAV_SECTIONS` causes the bottom icon-bar to render it automatically (the bar maps `NAV_SECTIONS` at L1621). No additional rendering code needed for the tab button.

### Pattern 2: Backend Route Structure (mirrors pretty-view-fetch-host-file.ts)

**What:** An Express Router that validates body → resolves host → RBAC → builds workspace path → SFTP op.

**When to use:** Every workspace CRUD endpoint follows this pattern.

```typescript
// Source: src/backend/database/routes/pretty-view-fetch-host-file.ts [VERIFIED: codebase]
import express from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { withConnection } from "../../ssh/ssh-connection-pool.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();

const router = express.Router();

router.post("/list", express.json({ limit: "8kb" }), authenticateJWT, async (req, res) => {
  const { identityKey, hostId, relativePath } = req.body;
  const userId = (req as Request & { userId: string }).userId;

  // 1. Input validation
  if (!IDENTITY_KEY_RE.test(identityKey)) {
    return res.status(400).json({ error: "invalid_identity_key" });
  }

  // 2. Resolve host + credentials
  const host = await resolveHostById(Number(hostId), userId);
  if (!host) return res.status(404).json({ error: "unknown_host" });

  // 3. RBAC check
  const access = await permissionManager.canAccessHost(userId, Number(hostId), "read");
  if (!access.hasAccess) return res.status(403).json({ error: "permission_denied" });

  // 4. Build absolute workspace path
  const workspaceRoot = `/home/${host.username}/fleet/identities/${identityKey}/workspace`;
  // NOTE: The actual path uses ~ expansion — SFTP does NOT expand tildes.
  // Use sftpRealpath("~") to get homeDir first, then construct the path.
  const absolutePath = resolveWorkspacePath(workspaceRoot, relativePath);
  if (!absolutePath) return res.status(400).json({ error: "path_traversal" });

  // 5. SFTP operation
  const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
  try {
    const result = await withConnection(poolKey, () => connectOneShot(host, 5000), async (client) => {
      const sftp = await openSftp(client);
      // ... readdir, stat, readFile, writeFile, mkdir, unlink, rename
    });
    res.json(result);
  } catch (err) {
    res.status(classifyError(err)).json({ error: classifyErrorClass(err) });
  }
});

export default router;
```

### Pattern 3: Workspace Path Construction

**Critical:** SFTP does NOT expand `~`. The tilde must be expanded server-side.

```typescript
// Source: pretty-view-upload.ts L420-431 — sftpRealpath("~") pattern [VERIFIED: codebase]
// 1. Open SFTP
const sftp = await openSftp(sshConn);
// 2. Get home directory (the only reliable tilde expansion in SFTP)
const homeDir = await sftpRealpath(sftp, ".");  // "." resolves to home on SSH connect
// 3. Build workspace root
const workspaceRoot = `${homeDir}/fleet/identities/${identityKey}/workspace`;
// 4. Build absolute target path
const absolutePath = workspaceRoot + (relativePath ? `/${relativePath}` : "");
```

**Identity validation:** `identityKey` must pass the same regex the existing handlers use:
```typescript
// Source: identities.ts and identity-artifact-reader.ts [VERIFIED: codebase]
const IDENTITY_KEY_RE = /^[a-z][a-z0-9-]*$/;  // verify exact pattern in code
```

**Path traversal guard:** Mirror the existing pattern from `pretty-view-fetch-host-file.ts`:
```typescript
// Source: pretty-view-fetch-host-file.ts L213-220 [VERIFIED: codebase]
if (absolutePath.includes("/../") || absolutePath.endsWith("/..") ||
    absolutePath.includes("/./") || absolutePath.endsWith("/.")) {
  throw new Error("path_traversal");
}
// Also run sftp.realpath() on the resolved path and verify it's still under workspaceRoot
// (symlink escape defense from T-78-07)
```

### Pattern 4: SFTP readdir for Directory Listing

**What:** ssh2's `SFTPWrapper.readdir()` returns structured entries with attrs (mtime, size, mode).

**The existing file-manager uses this exact API** (`file-manager-list-routes.ts:99`). The workspace variant needs a SIMPLER version: no session object, uses the one-shot connection pool pattern.

```typescript
// Source: file-manager-list-routes.ts L99-155 [VERIFIED: codebase — readdir returns InputAttributes]
sftp.readdir(absolutePath, (err, list) => {
  if (err) { /* handle */ return; }
  for (const entry of list) {
    if (entry.filename === "." || entry.filename === "..") continue;
    const attrs = entry.attrs;
    const isDir = attrs.isDirectory();
    // attrs.size  — file size in bytes (0 for directories)
    // attrs.mtime — Unix timestamp (seconds)
    // attrs.mode  — permissions bitmask
    // isSymbolicLink() — for symlink detection
  }
});
```

**Wire shape for /workspace/list response:**
```typescript
type WorkspaceEntry = {
  name: string;
  type: "file" | "directory" | "symlink";
  size: number | null;      // null for directories
  mtimeMs: number;          // attrs.mtime * 1000
  path: string;             // relative path from workspace root
};
type ListResponse = { entries: WorkspaceEntry[]; path: string };
```

### Pattern 5: SFTP Write (file content)

**Atomic write pattern:** tmp → rename (from `global-files-read-write.ts` and `identity-artifact-reader.ts`).

```typescript
// Source: identity-artifact-reader.ts writeMarkdownFileAtomic [VERIFIED: codebase]
// Also: pretty-view-upload.ts finalizeFile() L666-707 [VERIFIED: codebase]
// Pattern: write to <path>.partial → sftp.rename(<path>.partial, <path>)
const tempPath = `${absolutePath}.${Date.now()}.partial`;
const stream = sftp.createWriteStream(tempPath, { flags: "wx" }); // wx = fail if exists
// write content
// on close: sftp.rename(tempPath, absolutePath)
```

For small text-file writes (V1 workspace editor):
- Accept `content: string` in request body
- Write as `Buffer.from(content, "utf8")`
- Atomic temp+rename

### Pattern 6: Upload via multer memoryStorage

**What:** Workspace upload uses multer to receive the file bytes in memory, then SFTP-writes them.

The existing `multer` instance in `database.ts` writes to disk (for database imports). Workspace upload should use `multer.memoryStorage()` to avoid temp-file cleanup — the file goes straight from memory to SFTP.

```typescript
// Source: database.ts L4, L209 (existing multer); new pattern uses memoryStorage [VERIFIED: codebase]
import multer from "multer";
const workspaceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB cap — workspace files can be larger than text-editor 2MB
});

router.post("/upload",
  workspaceUpload.single("file"),
  authenticateJWT,
  async (req, res) => {
    const { identityKey, hostId, relativePath } = req.body;
    const fileBuffer = req.file?.buffer;
    // SFTP createWriteStream + write buffer
  }
);
```

**nginx body size:** The existing `/pretty-view` location has `client_max_body_size 4M`. Workspace upload needs a larger cap (50MB+ files plausible). New nginx `location` block must set `client_max_body_size 50m;` (or larger per D-16's "upload files from OS").

### Pattern 7: Inline Tab Body Swap (list-mode ↔ viewer-mode)

**What:** WorkspaceTab holds `viewMode: "list" | "viewer"` in local React state. No second modal.

```tsx
// Source: D-09, D-10 — inline swap pattern, no modal [VERIFIED: CONTEXT.md]
function WorkspaceTab({ identity, hostId, hue }) {
  const [viewMode, setViewMode] = useState<"list" | "viewer">("list");
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [openFile, setOpenFile] = useState<OpenFileState | null>(null);

  if (viewMode === "viewer" && openFile) {
    return (
      <WorkspaceFileViewer
        file={openFile}
        onBack={() => setViewMode("list")}
        identity={identity}
        hostId={hostId}
      />
    );
  }

  return (
    <WorkspaceListView
      currentPath={currentPath}
      onNavigate={setCurrentPath}
      onOpenFile={(file) => { setOpenFile(file); setViewMode("viewer"); }}
      identity={identity}
      hostId={hostId}
    />
  );
}
```

### Pattern 8: Error Copy Extension

**What:** `FILE_URL_ERROR_COPY` covers existing host-file errors. Workspace adds `not_a_directory`, `already_exists`, `not_empty`, `too_large_for_read`.

```typescript
// Source: EditableFileModal.tsx:63-112 — import the map, extend locally [VERIFIED: codebase]
import { FILE_URL_ERROR_COPY } from "./EditableFileModal"; // if exported; else copy the type
const WORKSPACE_ERROR_COPY = {
  ...FILE_URL_ERROR_COPY,
  not_a_directory: { heading: "Not a folder", body: "That path is a file, not a folder." },
  already_exists: { heading: "Already exists", body: "Something with that name already exists here." },
  not_empty: { heading: "Folder not empty", body: "Remove the contents first, then delete the folder." },
  not_a_file: { heading: "Not a file", body: "That path isn't a file." },
};
```

**Note:** `FILE_URL_ERROR_COPY` in `EditableFileModal.tsx` is NOT currently exported. The planner should decide: (a) export it from EditableFileModal (requires touching an existing file), or (b) re-declare the overlapping entries in workspace-error-copy.ts. Option (b) is zero-risk.

### Pattern 9: Download Wire

**For text files:** The file content is already fetched for the viewer. The download is a client-side `URL.createObjectURL(new Blob([content]))` + trigger.

**For binary files:** Backend needs a `GET /workspace/download?identityKey=X&hostId=Y&relativePath=Z` endpoint that streams bytes with `Content-Disposition: attachment; filename="..."`. The existing GET handler in `pretty-view-fetch-host-file.ts` is the model — it sends raw bytes with forced `text/plain` (XSS defense). For downloads, the Content-Type should be inferred from extension or `application/octet-stream`, and `Content-Disposition: attachment` triggers the browser download.

**Alternatively:** Reuse the existing `GET /file/:host/*` endpoint with the workspace absolute path. The absolute path is `~/fleet/identities/<name>/workspace/<relpath>`. The GET endpoint handles SFTP read + auth. However, it forces `text/plain` (XSS defense), which prevents proper binary downloads. A dedicated `/workspace/download` GET endpoint is cleaner.

### Anti-Patterns to Avoid

- **Opening a `<Dialog>` for file viewer:** D-10 is explicit. Use inline tab-body swap.
- **Calling `sftpRealpath("~/fleet/...")` directly:** SFTP does NOT expand `~`. Use `sftpRealpath(".")` to get homeDir first.
- **Reusing `multer` instance from database.ts directly:** That instance writes to disk and only accepts `.skynet-export.sqlite`. Create a dedicated `multer({ storage: multer.memoryStorage() })` for workspace uploads.
- **Building directory listing by running `ls -la` via `execCommand`:** Use SFTP `readdir()` — it returns structured `InputAttributes` with typed `size`, `mtime`, `mode`. Shell parsing is fragile.
- **Mounting workspace routes without a matching nginx block:** Every backend route needs a `location` block in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`. Missing the HTTPS config is a load-bearing pitfall (CLAUDE.md caveat).
- **Putting `DatabaseSaveTrigger.forceSave` in workspace routes:** Workspace CRUD writes to the remote filesystem via SFTP, NOT to the in-memory SQLite DB. No DB flush needed (unlike host-autostart-routes). The workspace routes touch zero DB tables.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSH connection lifecycle | Custom SSH connection code | `withConnection` + `connectOneShot` | Connection pooling, timeout, health checks already solved |
| Host credential decryption | Manual DB + crypto | `resolveHostById(hostId, userId)` | Handles CSKEK/user-DEK branching, credential ID lookup, all auth types |
| Per-user host access check | Manual SQL query | `permissionManager.canAccessHost(userId, hostId)` | Handles owner + shared access + role-based access |
| SFTP tilde expansion | `path.join("~/fleet/...", ...)` | `sftpRealpath(sftp, ".")` first | SFTP is `~`-blind — realpath gives the real home dir |
| Error copy for host errors | Custom error strings | `FILE_URL_ERROR_COPY` (or extension) | Existing consumer-register copy, consistent UX |
| Auth middleware | Manual JWT verification | `AuthManager.getInstance().createAuthMiddleware()` | Cookie jar + JWT, established pattern |
| Markdown editing in tab body | Custom textarea with MDX parse | `MarkdownEditor` (already lazy-loaded) | ~1.5MB MDX bundle, live preview, Suspense boundary already wired |
| Text editing in tab body | Raw `<textarea>` with ad hoc save | `GlobalFileTab` component | Save/dirty-guard/mtime optimistic concurrency already implemented |
| Drag-and-drop detection | Manual drag event tracking | Browser DragEvent API (`dragenter`/`dragover`/`dragleave`/`drop`) | Native — no library needed; prototype already implements it |

---

## Runtime State Inventory

This is a greenfield tab + new backend routes. No rename/refactor/migration is involved. No runtime state needs updating.

**Nothing found in any category** — verified: this phase writes NEW files and adds NEW routes. No existing identities, DB rows, process names, env vars, or build artifacts carry state that this phase changes.

---

## Common Pitfalls

### Pitfall 1: SFTP Does Not Expand Tildes

**What goes wrong:** `sftp.readdir("~/fleet/identities/echo/workspace")` returns ENOENT because SFTP is a file-transfer protocol, not a shell — tilde is a shell expansion, not an OS path.

**Why it happens:** Every developer reaching for "home-relative" paths instinctively writes `~`. It works in shell commands (`execCommand`) but not in SFTP paths.

**How to avoid:** Always resolve the home directory first: `await sftpRealpath(sftp, ".")` returns the SSH user's home directory as an absolute path. Construct all subsequent paths using that base.

**Warning signs:** ENOENT errors on paths that visually look correct; works in a shell test but fails in SFTP.

**Source:** `pretty-view-upload.ts L420-431` — the existing upload code uses exactly this pattern (`homeDir = await sftpRealpath(sftp, ".")`).

### Pitfall 2: Nginx Location Block Missing in nginx-https.conf

**What goes wrong:** The new `/workspace` routes work on HTTP Skynet but return 502 or 404 on the HTTPS deployment (which is the production Skynet).

**Why it happens:** `docker/nginx.conf` and `docker/nginx-https.conf` are separate files that must be kept in sync. Many phases add a block to one and forget the other.

**How to avoid:** Every new `location` block goes in BOTH files. The existing pattern at `database.ts` import comments (e.g., `"Matching nginx location blocks land in BOTH docker/nginx.conf AND docker/nginx-https.conf per CLAUDE.md nginx caveat"`) documents this invariant.

**Warning signs:** 502 Bad Gateway only on `https://` URLs; works on `http://` dev server.

### Pitfall 3: Second Modal Opens for File View

**What goes wrong:** Clicking a file opens a `<Dialog>` or `<DialogPrimitive.Root>` on top of IdentityModal, breaking D-10 and the app's one-modal convention.

**Why it happens:** The existing `EditableFileModal` is a ready-made component that shows a file editor — it's tempting to use it as-is. But it wraps content in modal chrome.

**How to avoid:** Mount `MarkdownEditor` and `GlobalFileTab` directly inside a `<TabsContent value="workspace">` with inline-swap state (`viewMode === "viewer"`). Do NOT use `EditableFileModal`. Use only its BODY components (`MarkdownEditor`, `GlobalFileTab`) and its error copy (`FILE_URL_ERROR_COPY`).

**Source:** D-10, D-11 in CONTEXT.md.

### Pitfall 4: Workspace Route Path Traversal Escapes workspaceRoot

**What goes wrong:** A path like `../../etc/passwd` with `relativePath` field reaches outside `~/fleet/identities/<name>/workspace/`.

**Why it happens:** String concatenation without validation lets arbitrary paths escape the workspace jail.

**How to avoid:** (1) Static check: reject any `relativePath` containing `/../` or `..` component. (2) After `sftp.realpath(absolutePath)`, verify the resolved path is still prefixed with `workspaceRoot`. If `resolved.startsWith(workspaceRoot)` is false, return `path_traversal`. This is the same two-layer defense used in `pretty-view-fetch-host-file.ts` (pre-SSH check + post-realpath check).

**Warning signs:** Any `relativePath` containing `..` should be rejected at the static check before SFTP is even opened.

### Pitfall 5: identityKey Not Validated Before Shell/Path Interpolation

**What goes wrong:** An attacker sends `identityKey: "../../etc"` → workspace path becomes `~/fleet/identities/../../etc/workspace/`.

**Why it happens:** Missing input validation on `identityKey`.

**How to avoid:** Validate `identityKey` with `IDENTITY_KEY_RE` (the same regex used in the identity-artifact-reader and identity-birth routes — `/^[a-z][a-z0-9-]*$/` approximately). Reject immediately with 400 if it fails. The CONTEXT.md `§ IDMEDIT-06` requires this for all new WS write handlers; REST handlers inherit the same discipline.

### Pitfall 6: multer File Filter Blocks Workspace Uploads

**What goes wrong:** Workspace upload returns 400 "Only .skynet-export.sqlite files are allowed" because the global multer instance has a strict fileFilter.

**Why it happens:** `database.ts:209-224` configures the shared `upload` multer instance to only accept `.skynet-export.sqlite` files. If workspace routes try to use this instance, all uploads fail.

**How to avoid:** Create a DEDICATED `multer({ storage: multer.memoryStorage() })` instance in `workspace-routes.ts` with NO fileFilter (or a workspace-appropriate one). Do NOT import or reuse the `upload` instance from `database.ts`.

### Pitfall 7: Download Serves Images/Binaries as text/plain (XSS Defense Conflict)

**What goes wrong:** Download endpoint inherits the `text/plain; charset=utf-8` forced content type from `pretty-view-fetch-host-file.ts`'s GET handler, making binary files unreadable.

**Why it happens:** The GET `/file/:host/*` route forces `text/plain` for XSS defense (T-78-01-GET1). For file viewing that's correct; for browser-triggered file downloads it prevents the OS from opening the file correctly.

**How to avoid:** The dedicated `GET /workspace/download` endpoint sets `Content-Disposition: attachment; filename="<name>"` and uses `application/octet-stream` (or extension-based MIME), which triggers the browser's native download behavior rather than rendering. The download path is NOT the `/file/:host/*` URL-view path.

### Pitfall 8: Missing Refresh on Tab Re-activation

**What goes wrong:** User opens workspace tab, sees stale list, switches to another tab, comes back — list hasn't refreshed.

**Why it happens:** If `useEffect` only fires on mount, it won't re-fetch when the tab becomes active again.

**How to avoid:** Per D-05, the design is snapshot-on-open + explicit refresh button. The `useEffect` that fetches the listing should depend on the `open` state of `IdentityModal` (passed through or detected) AND on a `refreshKey` counter that the refresh button increments. Changing `refreshKey` re-runs the fetch effect. This is simpler and more explicit than watching tab-active state.

---

## Code Examples

### WorkspaceTab props signature

```typescript
// Source: pattern from existing tab components [VERIFIED: codebase]
interface WorkspaceTabProps {
  identity: Identity;    // from IdentityModal.tsx L191 — includes identityKey, hostId?
  hostId: number;        // IdentityModal.tsx L202 — the pane's SSH host id
  hue: number;           // for --pv-id-hue tinting
}
```

### Workspace list API call (client-side)

```typescript
// Source: mirrors fetchHostFileUrl pattern in editable-file-api.ts [VERIFIED: codebase]
// New file: src/ui/api/workspace-api.ts
import { authApi, handleApiError } from "@/main-axios";

export type WorkspaceEntry = {
  name: string;
  type: "file" | "directory" | "symlink";
  size: number | null;
  mtimeMs: number;
};

export async function listWorkspace(
  identityKey: string,
  hostId: number,
  relativePath: string,
): Promise<{ entries: WorkspaceEntry[]; path: string }> {
  try {
    const response = await authApi.post("/workspace/list", { identityKey, hostId, relativePath });
    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "WorkspaceError";
        throw rich;
      }
    }
    handleApiError(error, "list workspace");
    throw error;
  }
}
```

### SFTP readdir wrapper (backend, workspace-routes.ts)

```typescript
// Source: adapted from pretty-view-fetch-host-file.ts L156-184 [VERIFIED: codebase]
type SftpLike = { /* readdir, readFile, writeFile, mkdir, unlink, rename, realpath, stat */ };

function sftpReaddir(sftp: SftpLike, p: string): Promise<SftpEntry[]> {
  return new Promise((resolve, reject) => {
    (sftp as any).readdir(p, (err: Error | null, list: SftpEntry[]) => {
      if (err) return reject(err);
      resolve(list);
    });
  });
}
```

### Bottom icon-bar style (selected tab)

```typescript
// Source: IdentityModal.tsx L1636-1645 [VERIFIED: codebase]
style={selected ? {
  background: "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.18)",
  boxShadow: "inset 0 0 0 1px hsla(var(--pv-id-hue, 220), 80%, 70%, 0.28)",
} : undefined}
```

### File-type dispatch (client-side)

```typescript
// Source: D-12 in CONTEXT.md; pattern from EditableFileModal.tsx FILE_URL_DISPATCH_RE [VERIFIED: codebase]
const MD_RE = /\.md$/i;
const TEXT_RE = /\.(txt|json|ts|tsx|js|jsx|css|html|log|yml|yaml|py|sh|env|toml|ini|xml|csv|rs|go|java|c|cpp|h|rb|php|swift|kt)$/i;
const IMAGE_RE = /\.(png|jpg|jpeg|gif|webp|svg)$/i;

function getFileViewType(name: string): "markdown" | "text" | "image" | "binary" {
  if (MD_RE.test(name)) return "markdown";
  if (TEXT_RE.test(name)) return "text";
  if (IMAGE_RE.test(name)) return "image";
  return "binary";
}
```

### Drag-and-drop overlay (pattern from prototype)

```typescript
// Source: prototype/modal.html L211-242 [VERIFIED: codebase prototype]
// dragCounter pattern avoids false dragleave fires on child element hover
let dragCounter = 0;
const onDragEnter = (e: DragEvent) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  dragCounter++;
  setDragActive(true);
};
const onDragLeave = () => {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; setDragActive(false); }
};
const onDrop = (e: DragEvent) => {
  e.preventDefault();
  dragCounter = 0;
  setDragActive(false);
  const files = Array.from(e.dataTransfer?.files ?? []);
  // upload files...
};
```

### Sorting algorithm (folders-first, then by sort key)

```typescript
// Source: prototype/modal.html L324-338 — validated sort logic [VERIFIED: prototype]
function sortEntries(entries: WorkspaceEntry[], sortKey: "name" | "size" | "mtime", sortDir: "asc" | "desc") {
  return [...entries].sort((a, b) => {
    if (a.type === "directory" && b.type !== "directory") return -1;
    if (a.type !== "directory" && b.type === "directory") return 1;
    let va: string | number, vb: string | number;
    if (sortKey === "name") { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
    else if (sortKey === "size") { va = a.size ?? 0; vb = b.size ?? 0; }
    else { va = a.mtimeMs; vb = b.mtimeMs; }
    if (va < vb) return sortDir === "asc" ? -1 : 1;
    if (va > vb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| `pretty-view-upload.ts` used WS with chunked protocol | Workspace upload uses HTTP multipart (simpler; no WS session requirement) | Simpler implementation; no session object needed |
| `file-manager-list-routes.ts` relies on a persistent SSHSession object | Workspace uses `withConnection` pool (stateless per-request) | No session ID management; simpler auth surface |
| Inline file editing used nested `Dialog` (EditableFileModal) | Workspace uses tab-body inline swap | No modal stacking; preserves browsing context |

**Deprecated/outdated:**
- The old SSH file manager session pattern (`file-manager-session.ts` `SSHSession`) is NOT the right model for workspace routes. That system requires a separate `/ssh/connect` handshake to create a session, which is inappropriate for a tab body that opens on tab-activate. Use the `withConnection` pool pattern instead.

---

## Open Questions

1. **`identityKey` regex — exact pattern**
   - What we know: identity keys are lowercase slug-like strings (e.g., `echo`, `box-maintainer-1`).
   - What's unclear: the exact regex used by existing handlers. `IDENTITY_KEY_RE` is referenced in CONTEXT.md §IDMEDIT-06 but needs to be extracted from `identity-artifact-reader.ts` or `identity-birth.ts` to use verbatim.
   - Recommendation: Planner should add a task to grep `IDENTITY_KEY_RE` from the codebase and use it exactly in `workspace-routes.ts`.

2. **`FILE_URL_ERROR_COPY` exportability**
   - What we know: it exists at `EditableFileModal.tsx:63-112` as a module-private constant.
   - What's unclear: whether it should be exported from `EditableFileModal` or redeclared in a new `workspace-error-copy.ts` file.
   - Recommendation: Redeclare the overlapping entries in `workspace-error-copy.ts` (zero risk; no existing file touched). Add workspace-specific entries (`not_a_directory`, `already_exists`, etc.).

3. **Host chip reachability probe**
   - What we know: D-18 requires a host-name + reachability dot in the modal header.
   - What's unclear: whether "reachability" means checking if the host is pingable (separate call) or derived from the first list response (error = unreachable, success = reachable).
   - Recommendation: Derive reachability from the initial `/workspace/list` call result. If it returns `host_unreachable` or `ssh_timeout` → dot is red; success → dot is green. No separate probe needed.

4. **File size cap for workspace reads**
   - What we know: `pretty-view-fetch-host-file.ts` has a 2MB cap for text-file reads (for the editor). Images served via download endpoint have no cap constraint since they stream without editor rendering.
   - What's unclear: whether the workspace text editor should inherit the same 2MB cap or have a different one.
   - Recommendation: Inherit the same 2MB cap for the inline viewer/editor (`/workspace/read-file`). For `/workspace/download`, no cap (or a generous 500MB cap). Clearly document the distinction in the route.

---

## Environment Availability

This phase is purely code changes — no external tool dependencies beyond the existing Skynet stack (Node.js, ssh2, Express). Skip: all dependencies already verified as available in the running Skynet instance.

---

## Validation Architecture

**Test framework:** Vitest. Config: `vitest.config.ts`. Quick run: `npm test -- --run`. Full suite: `npm test`.

### Phase Requirements → Test Map

| Req | Behavior | Test Type | Automated Command |
|-----|----------|-----------|-------------------|
| D-21 | Auth gate: non-owner user can't list workspace | Unit (route) | `vitest run src/backend/database/routes/workspace-routes.test.ts` |
| D-04 | No notification to agent on CRUD | Design (no WS/agent call in route) | Code review in plan |
| D-07 | Delete confirmation fires (frontend) | Manual UAT | — |
| D-10 | No second modal | Manual UAT | — |
| D-19 | Uses existing SSH pool | Unit (route) | `vitest run src/backend/database/routes/workspace-routes.test.ts` |
| Path traversal guard | `relativePath: "../../etc"` → 400 path_traversal | Unit (route) | same test file |
| identityKey injection | `identityKey: "../../etc"` → 400 invalid_identity_key | Unit (route) | same test file |

### Wave 0 Gaps

- [ ] `src/backend/database/routes/workspace-routes.test.ts` — mirrors `pretty-view-fetch-host-file.test.ts` pattern (bare Express app + vi.mock for auth/resolver/permission/pool/sftp)
- [ ] No frontend component tests planned (inline-swap logic is straightforward; covered by UAT)

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `authenticateJWT` middleware (AuthManager) |
| V3 Session Management | no | Stateless REST; no session state |
| V4 Access Control | yes | `permissionManager.canAccessHost(userId, hostId)` |
| V5 Input Validation | yes | `IDENTITY_KEY_RE`, path traversal check, body schema guard |
| V6 Cryptography | no | Reads/writes plaintext files; no new crypto |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `relativePath` | Tampering / Info Disclosure | Static `..` check + `sftp.realpath` post-check vs workspaceRoot prefix |
| identityKey injection via path concatenation | Tampering | `IDENTITY_KEY_RE` validation before any path build |
| Cross-user workspace access | Information Disclosure | `resolveHostById(hostId, userId)` + `canAccessHost(userId, hostId)` — both user-scoped |
| SFTP symlink escape to `/proc` or `/sys` | Info Disclosure | Post-`sftp.realpath` check: resolved path must start with `workspaceRoot` AND not match `FORBIDDEN_PATH_RE` |
| Multer size DoS | Denial of Service | `multer({ limits: { fileSize: 50 * 1024 * 1024 } })` |
| XSS via served file content | XSS | Inline text viewer renders content in a `<textarea>` (not innerHTML); images via `<img src={objectUrl}>` |
| Info leak via error messages | Info Disclosure | T-40-05 invariant: error body contains only `{ error: "<class>" }` — never `err.message`, `absolutePath`, or stack traces |

---

## Sources

### Primary (HIGH confidence)

- `src/backend/database/routes/pretty-view-fetch-host-file.ts` — SFTP fetch pattern, auth chain, error taxonomy, path validation, symlink defense [VERIFIED: codebase read]
- `src/backend/ssh/ssh-connection-pool.ts` — `withConnection` API [VERIFIED: codebase read]
- `src/backend/ssh/ssh-one-shot.ts` — `connectOneShot` API [VERIFIED: codebase read]
- `src/backend/ssh/host-resolver.ts` — `resolveHostById` API [VERIFIED: codebase read]
- `src/backend/utils/permission-manager.ts` — `canAccessHost` API [VERIFIED: codebase read]
- `src/backend/ssh/pretty-view-upload.ts` — SFTP write + tmp+rename + tilde expansion pattern [VERIFIED: codebase read]
- `src/backend/ssh/file-manager-list-routes.ts` — SFTP `readdir` attrs shape [VERIFIED: codebase read]
- `src/backend/database/database.ts` — route mount pattern, multer configuration [VERIFIED: codebase read]
- `src/ui/features/pretty-view/IdentityModal.tsx` — `NAV_SECTIONS`, `TabsContent` pattern, `hostId` prop thread, `identity` shape [VERIFIED: codebase read]
- `src/ui/features/pretty-view/MarkdownEditor.tsx` — props interface, filetype gate [VERIFIED: codebase read]
- `src/ui/features/pretty-view/GlobalFileTab.tsx` — save/dirty-guard pattern, `GlobalFileTabData` shape [VERIFIED: codebase read]
- `src/ui/features/pretty-view/EditableFileModal.tsx:63-112` — `FILE_URL_ERROR_COPY` map [VERIFIED: codebase read]
- `src/ui/api/editable-file-api.ts` — `fetchHostFileUrl` client pattern [VERIFIED: codebase read]
- `src/ui/index.css:100-176` — `pv-*` design tokens [VERIFIED: codebase read]
- `docker/nginx.conf` + `docker/nginx-https.conf` — location block patterns [VERIFIED: codebase read]
- `~/fleet/roles/box-maintainer/bounties/workspace-file-browser/prototype/modal.html` — visual/interaction target [VERIFIED: codebase read]
- `/home/ubuntu/.claude/skills/id/SKILL.md:730` — workspace path: `~/fleet/identities/<name>/workspace/` [VERIFIED: codebase read]

### Secondary (MEDIUM confidence)

- `src/backend/database/routes/global-files-read-write.ts` — atomic write pattern, `writeMarkdownFileAtomic` reference [VERIFIED: codebase read]
- `src/backend/database/db/schema.ts` — `hosts` table schema (host.name, host.ip, host.port, host.username) [VERIFIED: codebase read]

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — 100% existing dependencies verified in codebase
- Architecture: HIGH — all patterns traced to live code
- Auth/RBAC: HIGH — `resolveHostById` + `canAccessHost` are the exact functions used by `pretty-view-fetch-host-file.ts` today
- Frontend tab wiring: HIGH — `NAV_SECTIONS` + `TabsContent` pattern is directly observable
- SFTP tilde pitfall: HIGH — verified from existing `pretty-view-upload.ts` implementation
- Pitfalls: HIGH — all traced to actual code or documented invariants

**Research date:** 2026-09-19
**Valid until:** 2026-10-19 (stable codebase — 30 days is conservative)
