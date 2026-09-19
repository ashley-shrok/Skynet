# Phase 121: Workspace File Browser - Pattern Map

**Mapped:** 2026-09-19
**Files analyzed:** 8 new/modified files
**Analogs found:** 8 / 8

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/database/routes/workspace-routes.ts` | route | CRUD + file-I/O | `src/backend/database/routes/pretty-view-fetch-host-file.ts` | exact |
| `src/ui/api/workspace-api.ts` | utility | request-response | `src/ui/api/editable-file-api.ts` | exact |
| `src/ui/features/pretty-view/WorkspaceTab.tsx` | component | CRUD + event-driven | `src/ui/features/pretty-view/IdentityModal.tsx` (WakeupsTab / IdentityFileTab tabs) | role-match |
| `src/ui/features/pretty-view/IdentityModal.tsx` (modified) | component | request-response | same file — NAV_SECTIONS L308-318, TabsContent L1560-1609 | in-place |
| `src/backend/database/routes/workspace-routes.test.ts` | test | — | `src/backend/database/routes/pretty-view-fetch-host-file.test.ts` | exact |
| `docker/nginx.conf` (modified) | config | — | existing `location ~ ^/runbooks-editor` block at L466 | exact |
| `docker/nginx-https.conf` (modified) | config | — | existing `location ~ ^/runbooks-editor` block at L481 | exact |
| `src/ui/features/pretty-view/workspace-error-copy.ts` | utility | — | `src/ui/features/pretty-view/EditableFileModal.tsx` L63-112 | role-match |

---

## Pattern Assignments

### `src/backend/database/routes/workspace-routes.ts` (route, CRUD + file-I/O)

**Analog:** `src/backend/database/routes/pretty-view-fetch-host-file.ts`

**Imports pattern** (lines 46-57):
```typescript
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { sshLogger } from "../../utils/logger.js";
import { withConnection } from "../../ssh/ssh-connection-pool.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { IDENTITY_KEY_RE } from "../../claude-session/identity-artifact-reader.js";
import type { SSHHost } from "../../../types/index.js";
import type { Client as SSHClientType } from "ssh2";
```

**Note on `resolveHostById` vs `resolveHostByName`:** The existing analog (`pretty-view-fetch-host-file.ts`) uses `resolveHostByName` because it accepts a hostname string from the URL. Workspace routes receive a numeric `hostId` from the frontend (same as how `IdentityModal` threads `hostId: number` — see L192-193). Use `resolveHostById(hostId, userId)` from `src/backend/ssh/host-resolver.ts` L16-19.

**Note on `IDENTITY_KEY_RE`:** The canonical export is at `src/backend/claude-session/identity-artifact-reader.ts` L175:
```typescript
export const IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/;
```
Import this directly — do NOT redeclare locally. Other routes that declare their own copies (`identity-birth.ts:79`, `identity-archive.ts`) are pre-export workarounds; the artifact-reader export is the authoritative one.

**Auth/middleware wire-up pattern** (lines 111-113):
```typescript
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();
```

**SFTP promise wrappers** — copy the four wrappers from `pretty-view-fetch-host-file.ts` lines 125-184 verbatim as a local `SftpLike` duck type + `openSftp`, `sftpRealpath`, `sftpStat`, `sftpReadFile`. For workspace-specific operations add `sftpReaddir`, `sftpWriteFile`, `sftpMkdir`, `sftpUnlink`, `sftpRename` following the same callback-to-promise pattern.

**Tilde expansion — CRITICAL** (pattern from `src/backend/ssh/pretty-view-upload.ts` L420-431, referenced in RESEARCH.md):
```typescript
// Inside the withConnection callback, after openSftp(client):
const sftp = await openSftp(client);
const homeDir = await sftpRealpath(sftp, ".");   // "." resolves to SSH user home
const workspaceRoot = `${homeDir}/fleet/identities/${identityKey}/workspace`;
```
Never use `~/fleet/...` as an SFTP path — SFTP is tilde-blind.

**Path traversal guard** (lines 213-225 from analog):
```typescript
// Static pre-SFTP check
if (
  relativePath.includes("/../") ||
  relativePath.endsWith("/..") ||
  relativePath.startsWith("../") ||
  relativePath === ".."
) {
  return res.status(400).json({ error: "path_traversal" });
}
// Post-realpath check (after sftp.realpath resolves absolutePath):
const resolved = await sftpRealpath(sftp, absolutePath);
if (!resolved.startsWith(workspaceRoot + "/") && resolved !== workspaceRoot) {
  return res.status(400).json({ error: "path_traversal" });
}
// Also re-check FORBIDDEN_PATH_RE on the resolved path (symlink escape defense)
const FORBIDDEN_PATH_RE = /^\/(proc|sys|dev)(\/|$)/;
if (FORBIDDEN_PATH_RE.test(resolved)) {
  return res.status(400).json({ error: "path_forbidden" });
}
```

**Per-endpoint body validation pattern** (lines 341-360 from analog):
```typescript
const body = req.body;
if (
  body === null ||
  typeof body !== "object" ||
  Array.isArray(body) ||
  typeof (body as Record<string, unknown>).identityKey !== "string" ||
  typeof (body as Record<string, unknown>).hostId !== "number"
) {
  res.status(400).json({ error: "invalid_body" });
  return;
}
const { identityKey, hostId, relativePath = "" } = body as {
  identityKey: string;
  hostId: number;
  relativePath?: string;
};
const userId = (req as Request & { userId: string }).userId;
```

**Core CRUD route pattern** (lines 239-276 from analog, adapted):
```typescript
// All 8 endpoints follow this exact shape:
router.post("/list", express.json({ limit: "8kb" }), authenticateJWT, async (req, res) => {
  // 1. Body validation (invalid_body → 400)
  // 2. IDENTITY_KEY_RE.test(identityKey) (invalid_identity_key → 400)
  // 3. resolveHostById(Number(hostId), userId) (unknown_host → 404)
  // 4. permissionManager.canAccessHost(userId, Number(hostId), "read") (permission_denied → 403)
  // 5. const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`
  // 6. withConnection(poolKey, () => connectOneShot(host, 5000), async (client) => {
  //      sftp = await openSftp(client)
  //      homeDir = await sftpRealpath(sftp, ".")
  //      workspaceRoot = `${homeDir}/fleet/identities/${identityKey}/workspace`
  //      [path traversal check]
  //      [operation-specific SFTP call]
  //    })
  // 7. res.json(result) on success
  // 8. catch: classifyErrorToStatus + classifyErrorToClass → res.status(N).json({ error })
  //    NEVER include err.message / absolutePath / stack (T-40-05 invariant)
});
```

**Error classification helpers** — copy `classifyErrorToStatus` and `classifyErrorToClass` from `pretty-view-fetch-host-file.ts` lines 475-513. Extend `classifyErrorToStatus` and `classifyErrorToClass` with workspace-specific classes:
```typescript
if (msg === "not_a_directory") return 400;   // status
if (msg === "not_a_directory") return "not_a_directory";  // class
if (msg === "already_exists") return 409;
if (msg === "already_exists") return "already_exists";
if (msg === "not_empty") return 409;
if (msg === "not_empty") return "not_empty";
```

**Upload endpoint — dedicated multer instance** (RESEARCH Pitfall 6):
```typescript
// At the top of workspace-routes.ts (NOT imported from database.ts):
import multer from "multer";
const workspaceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
});

router.post("/upload",
  workspaceUpload.single("file"),
  authenticateJWT,
  async (req, res) => {
    const { identityKey, hostId, relativePath } = req.body;
    const fileBuffer = req.file?.buffer;
    if (!fileBuffer) return res.status(400).json({ error: "invalid_body" });
    // ... same auth chain, then SFTP createWriteStream
  }
);
```

**Download endpoint — separate GET with `Content-Disposition`** (RESEARCH Pitfall 7):
```typescript
// GET (not POST) so browser can be directed to it for native download trigger:
router.get("/download", authenticateJWT, async (req, res) => {
  const { identityKey, hostId, relativePath } = req.query;
  // ... auth chain, then SFTP readFile ...
  const filename = relativePath.split("/").pop() ?? "file";
  res.set({
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Type": "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.status(200).send(bytes);
});
```

**Router export pattern** (lines 563-577 from analog):
```typescript
export const workspaceRoutes = express.Router();
// Each endpoint registered below on workspaceRoutes
// Exported as a named export (not default) following the prettyViewFetchHostFileRoutes convention
```

---

### `src/ui/api/workspace-api.ts` (utility, request-response)

**Analog:** `src/ui/api/editable-file-api.ts`

**Imports pattern** (lines 1-2 from analog):
```typescript
import axios from "axios";
import { authApi, handleApiError } from "@/main-axios";
```

**Core fetch helper pattern** (lines 131-163 from analog — error-class preservation):
```typescript
export async function listWorkspace(
  identityKey: string,
  hostId: number,
  relativePath: string,
): Promise<ListResponse> {
  try {
    const response = await authApi.post("/workspace/list", {
      identityKey,
      hostId,
      relativePath,
    });
    return response.data as ListResponse;
  } catch (error) {
    // Preserve backend error-class string (same pattern as fetchHostFileUrl L147-161)
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "WorkspaceError";
        throw rich;
      }
    }
    handleApiError(error, "list workspace");
    throw error; // unreachable — satisfies TS return type
  }
}
```

**Wire types** (to export from this file):
```typescript
export type WorkspaceEntry = {
  name: string;
  type: "file" | "directory" | "symlink";
  size: number | null;   // null for directories
  mtimeMs: number;       // attrs.mtime * 1000
  path: string;          // relative path from workspace root
};

export type ListResponse = { entries: WorkspaceEntry[]; path: string };
```

All other API helpers (`readWorkspaceFile`, `writeWorkspaceFile`, `deleteWorkspaceEntry`, `renameWorkspaceEntry`, `mkdirWorkspace`, `createWorkspaceFile`, `uploadWorkspaceFile`) follow the identical pattern: `authApi.post/put/delete(url, body)`, catch block with `WorkspaceError` throw, then `handleApiError` fallthrough.

---

### `src/ui/features/pretty-view/WorkspaceTab.tsx` (component, CRUD + event-driven)

**Analog:** `src/ui/features/pretty-view/IdentityModal.tsx` — specifically the `WakeupsTab` and `IdentityFileTab` TabsContent bodies (lines 1560-1609), and `GlobalFileTab` for inline viewer.

**Props signature** (from RESEARCH.md Code Examples, verified against IdentityModal.tsx L188-214):
```typescript
interface WorkspaceTabProps {
  identity: Identity;   // includes identity.identityKey
  hostId: number;       // the pane's SSH host id (IdentityModal.tsx L202)
  hue: number;          // for --pv-id-hue tinting
}
```

**Inline mode-swap pattern** (no second modal — D-10, pattern from RESEARCH.md Pattern 7):
```typescript
export default function WorkspaceTab({ identity, hostId, hue }: WorkspaceTabProps) {
  const [viewMode, setViewMode] = useState<"list" | "viewer">("list");
  const [currentPath, setCurrentPath] = useState<string[]>([]);
  const [openFile, setOpenFile] = useState<OpenFileState | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  if (viewMode === "viewer" && openFile) {
    return (
      <WorkspaceFileViewer
        file={openFile}
        onBack={() => { setViewMode("list"); }}
        identity={identity}
        hostId={hostId}
        hue={hue}
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
      hue={hue}
      refreshKey={refreshKey}
      onRefresh={() => setRefreshKey(k => k + 1)}
    />
  );
}
```

**Fetch-on-mount + refreshKey pattern** (addresses RESEARCH Pitfall 8):
```typescript
// Inside WorkspaceListView:
const [listState, setListState] = useState<ListState>({ status: "loading" });

useEffect(() => {
  if (!identity.identityKey) return;
  let cancelled = false;
  setListState({ status: "loading" });
  listWorkspace(identity.identityKey, hostId, currentPath.join("/"))
    .then((data) => {
      if (!cancelled) setListState({ status: "ready", data });
    })
    .catch((err) => {
      if (!cancelled) {
        const errorClass = err instanceof Error ? err.message : "host_unreachable";
        setListState({ status: "error", errorClass });
      }
    });
  return () => { cancelled = true; };
}, [identity.identityKey, hostId, currentPath, refreshKey]);
// refreshKey in deps means the refresh button re-runs this effect (D-05)
```

**Reuse MarkdownEditor (`.md` files, D-11):**
```typescript
// From IdentityModal.tsx pattern — MarkdownEditor is lazy-loaded with Suspense
// in IdentityFileTab. Use the same lazy-load + Suspense boundary pattern.
// Mount directly inside the tab body; do NOT wrap in Dialog chrome (D-10).
import { MarkdownEditor } from "./MarkdownEditor";
// Props: <MarkdownEditor filename={file.name} state={editorState} onSave={handleSave} />
```

**Reuse GlobalFileTab (text files, D-11):**
```typescript
// From EditableFileModal.tsx L15 — GlobalFileTab is the body component.
// Mount directly; do NOT use EditableFileModal (that adds modal chrome, violates D-10).
import GlobalFileTab, { type GlobalFileTabData } from "./GlobalFileTab";
// Props: <GlobalFileTab state={tabState} onSave={handleSave} filename={file.name} />
```

**Design token application** (from `src/ui/index.css` L100-176):
```typescript
// All new surfaces consume pv-* tokens, not hard-coded colors:
style={{ background: "var(--color-pv-surface)" }}
style={{ color: "hsla(var(--pv-id-hue, 220), 70%, 75%, 1)" }}
// Selected tab pill pattern from IdentityModal.tsx L1636-1645:
style={selected ? {
  background: "hsla(var(--pv-id-hue, 220), 80%, 60%, 0.18)",
  boxShadow: "inset 0 0 0 1px hsla(var(--pv-id-hue, 220), 80%, 70%, 0.28)",
} : undefined}
```

**File-type dispatch** (extension-based, D-12):
```typescript
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

**Drag-and-drop upload** (D-16, dragCounter pattern from RESEARCH.md):
```typescript
// dragCounter prevents false dragleave fires when hovering over child elements
let dragCounter = 0;
const onDragEnter = (e: React.DragEvent) => {
  if (!e.dataTransfer?.types.includes("Files")) return;
  e.preventDefault();
  dragCounter++;
  setDragActive(true);
};
const onDragLeave = () => {
  dragCounter--;
  if (dragCounter <= 0) { dragCounter = 0; setDragActive(false); }
};
const onDrop = (e: React.DragEvent) => {
  e.preventDefault();
  dragCounter = 0;
  setDragActive(false);
  const files = Array.from(e.dataTransfer?.files ?? []);
  // call uploadWorkspaceFile for each
};
```

**Sorting algorithm** (D-15 — folders always above files):
```typescript
function sortEntries(
  entries: WorkspaceEntry[],
  sortKey: "name" | "size" | "mtime",
  sortDir: "asc" | "desc",
): WorkspaceEntry[] {
  return [...entries].sort((a, b) => {
    // Folders before files — always
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

### `src/ui/features/pretty-view/IdentityModal.tsx` (modified — NAV_SECTIONS + TabsContent)

**What changes:** Two targeted additions only — no other code touched.

**NAV_SECTIONS addition** (at lines 308-318):
```typescript
// Current array (L308-318):
const NAV_SECTIONS = [
  { value: "identity", label: "Identity file", Icon: User },
  { value: "identity-wakeups", label: "Wakeups", Icon: AlarmClock },
  ...(isAdmin
    ? [{ value: "telegram", label: "Telegram", Icon: Send } as const]
    : []),
] as const;

// Add before the isAdmin spread:
  { value: "workspace", label: "Workspace", Icon: Folder },
// Icon: Folder from lucide-react (already imported via other lucide icons in this file)
```

**TabsContent addition** (after L1608 — after the isAdmin Telegram block, before the icon-bar div at L1611):
```tsx
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

Pattern source for className: the other TabsContent blocks use `flex-1 min-h-0 overflow-y-auto px-6 py-4`; WorkspaceTab manages its own internal padding/scroll, so `overflow-hidden flex flex-col` is correct (the list or viewer inside handles scrolling).

---

### `src/ui/features/pretty-view/workspace-error-copy.ts` (utility)

**Analog:** `src/ui/features/pretty-view/EditableFileModal.tsx` lines 62-112

**Pattern:** `FILE_URL_ERROR_COPY` in `EditableFileModal.tsx` is NOT currently exported (module-private). Redeclare all overlapping entries + add workspace-specific ones in a new file (zero risk — no existing file touched):

```typescript
// src/ui/features/pretty-view/workspace-error-copy.ts
type ErrorCopy = { heading: string; body: string };

export const WORKSPACE_ERROR_COPY: Record<string, ErrorCopy> = {
  // Inherited from FILE_URL_ERROR_COPY (EditableFileModal.tsx L63-112):
  host_unreachable: {
    heading: "Host unreachable",
    body: "The box may be offline or the connection is down. Try again in a moment.",
  },
  not_found: {
    heading: "File not found",
    body: "No such file or folder at that path.",
  },
  too_large: {
    heading: "File too large",
    body: "This file is too large to open in the editor. Use the Download button instead.",
  },
  not_a_file: {
    heading: "Not a file",
    body: "That path points to a folder, not a file.",
  },
  path_forbidden: {
    heading: "Path forbidden",
    body: "That path is not accessible.",
  },
  path_traversal: {
    heading: "Invalid path",
    body: "That path contains characters that aren't allowed.",
  },
  permission_denied: {
    heading: "Permission denied",
    body: "You don't have access to that file or folder.",
  },
  unknown_host: {
    heading: "Unknown host",
    body: "That host is not registered, or you don't have access to it.",
  },
  ssh_timeout: {
    heading: "Connection timed out",
    body: "The host is slow or unreachable. Try again in a moment.",
  },
  // Workspace-specific additions:
  not_a_directory: {
    heading: "Not a folder",
    body: "That path is a file, not a folder.",
  },
  already_exists: {
    heading: "Already exists",
    body: "Something with that name already exists here. Choose a different name.",
  },
  not_empty: {
    heading: "Folder not empty",
    body: "Remove everything inside the folder first, then delete it.",
  },
  invalid_identity_key: {
    heading: "Something went wrong",
    body: "Could not identify the agent. Try closing and reopening.",
  },
  invalid_body: {
    heading: "Something went wrong",
    body: "The request was malformed. Refresh and try again.",
  },
  generic: {
    heading: "Something went wrong",
    body: "An unexpected error occurred. Try again, or refresh the page.",
  },
};
```

Consumer register check: every heading and body above is readable by a non-developer (D-23, D-24). No HTTP codes, shell terms, or path strings.

---

### `src/backend/database/routes/workspace-routes.test.ts` (test)

**Analog:** `src/backend/database/routes/pretty-view-fetch-host-file.test.ts`

**Mock scaffolding** (lines 36-200 from analog):

```typescript
// Vitest suite — bare Express app + node http module + vi.mock for 5 modules

// 1. Auth mock (lines 53-74 from analog):
let mockUserId: string | null = "user-A";
vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware: () => (req, res, next) => {
        if (mockUserId === null) return res.status(401).json({ error: "Unauthorized" });
        (req as express.Request & { userId: string }).userId = mockUserId;
        next();
      },
    }),
  };
  return { AuthManager };
});

// 2. PermissionManager mock (lines 80-93):
let mockCanAccessHost = async () => ({ hasAccess: true });
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: (userId, hostId, action) => mockCanAccessHost(userId, hostId, action),
    }),
  },
}));

// 3. Logger mock (lines 99-121):
vi.mock("../../utils/logger.js", () => ({ sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), success: vi.fn() } }));

// 4. Host resolver mock (lines 127-129):
vi.mock("../../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(),
}));

// 5. SSH pool + SFTP stub (lines 139-200) — key structure for workspace:
interface StubSftp {
  realpath: Mock;
  readdir: Mock;   // workspace adds readdir
  stat: Mock;
  readFile: Mock;
  writeFile: Mock; // workspace adds writeFile
  mkdir: Mock;     // workspace adds mkdir
  unlink: Mock;    // workspace adds unlink
  rename: Mock;    // workspace adds rename
  createWriteStream: Mock; // workspace adds for upload
}
```

**Critical test cases to cover** (from RESEARCH.md Validation Architecture):
- `POST /workspace/list` → 200 + `{ entries: [], path: "" }` on success
- `POST /workspace/list` with no auth → 401
- `POST /workspace/list` with `canAccessHost` returning false → 403 `permission_denied`
- `POST /workspace/list` with `relativePath: "../../etc"` → 400 `path_traversal`
- `POST /workspace/list` with `identityKey: "../../etc"` → 400 `invalid_identity_key`
- `resolveHostById` returning null → 404 `unknown_host`
- SFTP error on list → 502 `host_unreachable` (never `err.message` in body — T-40-05)
- `DELETE /workspace/entry` auth check — uses "write" permission
- Upload endpoint — multer memoryStorage, no `.skynet-export.sqlite` filter

---

### `docker/nginx.conf` (modified) + `docker/nginx-https.conf` (modified)

**CRITICAL: Both files MUST be edited in the same commit. Missing one causes the feature to 502 on HTTPS-only production. (RESEARCH Pitfall 2.)**

**Analog for the new block:** `location ~ ^/runbooks-editor(/.*)?$` at `docker/nginx.conf` L466-475 and `docker/nginx-https.conf` L481-489.

**Block to add in BOTH files** (insert after the `/runbooks-editor` block in each file):
```nginx
# Phase 121: /workspace CRUD router — 8 endpoints (list, read-file, write-file,
# delete, rename, mkdir, create-file, upload, download). method-agnostic regex
# covers GET (download) + POST (list, read, rename, mkdir, create-file, upload)
# + PUT (write-file) + DELETE (delete). Backing router is
# app.use("/workspace", workspaceRoutes) in database.ts.
# proxy_read_timeout 15s bounds SFTP round-trip.
# client_max_body_size 50m: workspace upload accepts arbitrary user files
# (D-16 — "Upload from OS"); the /pretty-view cap (4M) is too small.
# Parity between docker/nginx.conf and docker/nginx-https.conf is
# load-bearing per CLAUDE.md nginx caveat.
location ~ ^/workspace(/.*)?$ {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 15s;
    client_max_body_size 50m;
}
```

**Route mount in `database.ts`** (following the pattern at L1992-1994):
```typescript
// Phase 121: /workspace CRUD router — 8 endpoints (list/read-file/write-file/
// delete/rename/mkdir/create-file/upload/download). Matching nginx location
// blocks land in BOTH docker/nginx.conf AND docker/nginx-https.conf per
// CLAUDE.md nginx caveat (missing in HTTPS conf → /workspace returns
// index.html and crashes the frontend).
import workspaceRoutes from "./routes/workspace-routes.js";
// ...then in the mount block:
app.use("/workspace", workspaceRoutes);
```

---

## Shared Patterns

### Authentication Middleware
**Source:** `src/backend/database/routes/pretty-view-fetch-host-file.ts` lines 111-113
**Apply to:** `workspace-routes.ts` (all 8 endpoints)
```typescript
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();
```

### Per-User Per-Host RBAC
**Source:** `src/backend/database/routes/pretty-view-fetch-host-file.ts` lines 231-239
**Apply to:** All workspace CRUD endpoints in `workspace-routes.ts`
```typescript
const accessInfo = await permissionManager.canAccessHost(userId, host.id, "read");
if (!accessInfo.hasAccess) {
  throw new Error("permission_denied");
}
// For write endpoints (write-file, delete, rename, mkdir, create-file, upload):
// use "write" permission level, not "read"
```

### Error-Class Info-Leak Invariant (T-40-05)
**Source:** `src/backend/database/routes/pretty-view-fetch-host-file.ts` lines 388-390
**Apply to:** All catch blocks in `workspace-routes.ts`
```typescript
// NEVER include err.message, absolutePath, or stack traces in response body
res.status(classifyErrorToStatus(err)).json({ error: classifyErrorToClass(err) });
```

### SSH Timeout + AbortController
**Source:** `src/backend/database/routes/pretty-view-fetch-host-file.ts` lines 241-248
**Apply to:** All SFTP operations in `workspace-routes.ts` (use same 8s timeout pattern, wrap with `runWithAbort`)

### Connection Pool Key
**Source:** `src/backend/database/routes/pretty-view-fetch-host-file.ts` line 249
**Apply to:** All `withConnection` calls in `workspace-routes.ts`
```typescript
const poolKey = `${host.ip}:${host.port ?? 22}:${host.username}`;
```

### Error Copy Client-Side
**Source:** `src/ui/features/pretty-view/EditableFileModal.tsx` lines 62-112 (FILE_URL_ERROR_COPY shape)
**Apply to:** `WorkspaceTab.tsx` error rendering — use `WORKSPACE_ERROR_COPY` from `workspace-error-copy.ts`
```typescript
const copy = WORKSPACE_ERROR_COPY[errorClass] ?? WORKSPACE_ERROR_COPY["generic"];
// Render copy.heading + copy.body — never the raw errorClass string to the user
```

### pv-* Design Tokens
**Source:** `src/ui/index.css` lines 100-176
**Apply to:** All new UI surfaces in `WorkspaceTab.tsx`
- Use `var(--color-pv-*)` for palette
- Use `hsla(var(--pv-id-hue, 220), ...)` for per-identity tinting
- Never hard-code hex/rgb colors

---

## No Analog Found

All files have close analogs. No entries in this section.

---

## Metadata

**Analog search scope:** `src/backend/database/routes/`, `src/ui/api/`, `src/ui/features/pretty-view/`, `src/backend/ssh/`, `docker/`
**Files scanned:** 14 files read directly; 6 bash searches across codebase
**Pattern extraction date:** 2026-09-19
