# Phase 23: Skynet editable global files + panel header menu consolidation — Pattern Map

**Mapped:** 2026-08-05
**Files analyzed:** 9 files to create/modify (2 backend routes, 1 backend router mount + 1 nginx pair + 1 docker-compose, 3 frontend, 1 config seed, 1 docs)
**Analogs found:** 9 / 9

## Preamble — the Big Insight (do not miss)

SRIC-06's role-file **read/write is a WebSocket handler**, not an HTTP route.
Look at `/home/ubuntu/skynet/src/backend/claude-session/claude-session-server.ts` L659–808. Phase 23 must
**NOT** copy that shape — it must copy the **HTTP-route SSH-exec-channel** shape used by
`roles-list-for-host.ts` and `roles-create.ts`. The upstream context brief incorrectly
implies a role-file HTTP route exists; it does not. What Phase 23 mirrors is:

- **HTTP-route shell:** `roles-list-for-host.ts` (GET pattern) + `roles-create.ts` (POST pattern with `express.json({ limit })` + body validation).
- **SSH exec-channel plumbing:** the `connectOneShot` + `execWithTimeout` idiom copied verbatim from those two route files.
- **Atomic write helper:** `writeMarkdownFileAtomic` from `identity-artifact-reader.ts` L1059 (SFTP tmp+rename via `ext_openssh_rename`) — **already reusable, do not re-implement**.
- **Two-step read-then-write pattern:** conceptual mirror of `readRoleFile` / `writeRoleFile` at `identity-artifact-reader.ts` L384 and L1257 — but scoped to whitelisted paths per host instead of role-derived paths.

Everything else (frontend modal chrome, host picker, tabs, save button) is a straight structural copy of the analogs listed below.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/database/routes/global-files.ts` (GEFM-03) | backend HTTP route | request-response (JSON) | `src/backend/database/routes/roles-list-for-host.ts` | exact (GET route reading a config file from disk) |
| `src/backend/database/routes/global-files-read-write.ts` (GEFM-04) | backend HTTP route | request-response + SSH exec-channel | `src/backend/database/routes/roles-create.ts` (POST + SSH exec) + `identity-artifact-reader.ts` `readRoleFile`/`writeRoleFile` (read/write helpers) | exact (HTTP route with connectOneShot + execWithTimeout + writeMarkdownFileAtomic) |
| `src/backend/database/database.ts` (add mount lines) | wiring | (mount config) | Existing `app.use("/roles", rolesListForHostRoutes); app.use("/roles", rolesCreateRoutes)` L1820-1825 | exact |
| `docker/nginx.conf` + `docker/nginx-https.conf` (add `/global-files` location) | infra config | (nginx proxy) | Existing `/roles` block in `docker/nginx.conf` L275-284 mirrored in `docker/nginx-https.conf` L292-301 | exact (dual-conf pattern) |
| `docker/docker-compose.yml` (no change likely — volume already mounted) | infra config | (volume) | `services.skynet.volumes: - skynet-data:/app/data` L8-9 | already present (planner confirms — no change needed) |
| `src/ui/features/pretty-view/GlobalFilesModal.tsx` (GEFM-05) | frontend modal component | request-response (fetches per-tab) | `src/ui/features/pretty-view/IdentityModal.tsx` (modal chrome, Tabs, DialogHeader+Close, tab-content data-loading) | exact (same shadcn Tabs + DialogPrimitive + glass close button) |
| `src/ui/features/pretty-view/GlobalFileTab.tsx` (GEFM-05, per-file tab body) | frontend component | request-response | `src/ui/features/pretty-view/RoleFileTab.tsx` | exact (byte-shape mirror; same TabState + onSave shape) |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (GEFM-01, header edit) | frontend component | (UI state) | Existing header layout in same file L700-776 + `PrettyConversationContextMenu.tsx` (portal menu chrome, no shadcn DropdownMenu prior art exists) | role-match (existing header is the target of modification; PrettyConversationContextMenu is the visual analog for the dropdown menu itself) |
| `src/ui/api/identities-api.ts` (add global-files functions) OR new `src/ui/api/global-files-api.ts` | frontend API | request-response | `listRolesForHost` L132 + `createRole` L199 in `identities-api.ts` | exact (same authApi.get/post + handleApiError shape) |
| `.planning/phases/23-*/23-BOOTSTRAP.md` (GEFM-06 docs) | doc | (docs) | (no direct analog — planner writes fresh) | no analog |
| Seed `global-files.json` (GEFM-06) | infra config data | (JSON seed) | (no direct analog — content is a bootstrap seed) | no analog |

## Pattern Assignments

---

### `src/backend/database/routes/global-files.ts` (GEFM-03: `GET /global-files?hostId=<n>`)

**Analog:** `/home/ubuntu/skynet/src/backend/database/routes/roles-list-for-host.ts`

**What to reuse verbatim:**
- Imports (auth, resolveHostById, express) — this GET route does NOT need `connectOneShot` (it reads a LOCAL JSON file, no SSH).
- Router setup + `authenticateJWT` middleware placement.
- 400 (missing/invalid hostId) → 404 (host not found for user) → 200 (empty array on missing config or host key) error ladder.
- Trailing generic 500 fallback handler.

**Imports pattern** (L37-48):
```typescript
import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
// NOTE: NO connectOneShot import — GEFM-03 reads a LOCAL file only.
import { sshLogger } from "../../utils/logger.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
```

**Route handler shape** (mirrors L106-232 but LOCAL-only, no SSH):
```typescript
router.get(
  "/",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId (verbatim from roles-list-for-host L112-120)
    const rawHostId = req.query.hostId;
    if (rawHostId === undefined || rawHostId === "") {
      return res.status(400).json({ error: "hostId is required" });
    }
    const hostId = parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }

    // 2. Host ownership check (verbatim from L123-126)
    const host = await resolveHostById(hostId, userId);
    if (!host) return res.status(404).json({ error: "Host not found" });

    // 3. Read /app/data/global-files.json — planner uses same DATA_DIR fallback
    //    idiom as database.ts L84: `process.env.DATA_DIR || "./db/data"`.
    //    ENOENT → return { files: [] } (empty array per CONTEXT GEFM-03 "not a 404").
    //    Missing host key → also { files: [] }.
  },
);

// Generic 500 fallback (verbatim from L236-251)
router.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
  sshLogger.error("global-files: unhandled error", { operation: "global_files_error", error: err?.message });
  return res.status(500).json({ error: "internal" });
});

export default router;
```

**Data-dir pattern** (from `src/backend/database/database.ts` L84):
```typescript
const dataDir = process.env.DATA_DIR || "./db/data";
// Config path:
const configPath = path.join(dataDir, "global-files.json");
```

**What to adapt:**
- No `connectOneShot` — read is LOCAL only.
- Response shape is `{ files: [{path, label}] }` NOT `[{name, description}]`.
- Empty array on ENOENT is normal (200, not 404) — the modal shows an empty state.

---

### `src/backend/database/routes/global-files-read-write.ts` (GEFM-04: `POST /global-files/read` + `PUT /global-files/write`)

**Analog A (route shell + body validation):** `/home/ubuntu/skynet/src/backend/database/routes/roles-create.ts`

**Analog B (SSH read):** `readRoleFile` at `/home/ubuntu/skynet/src/backend/claude-session/identity-artifact-reader.ts` L384-420

**Analog C (SSH write via SFTP atomic):** `writeRoleFile` at `identity-artifact-reader.ts` L1257-1298 + `writeMarkdownFileAtomic` at L1059-1113

**Imports pattern** (from `roles-create.ts` L80-88):
```typescript
import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { writeMarkdownFileAtomic } from "../../claude-session/identity-artifact-reader.js";
import { sshLogger } from "../../utils/logger.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const SSH_CONNECT_TIMEOUT_MS = 5000;
const SSH_EXEC_TIMEOUT_MS = 5000;
```

**`execWithTimeout` helper — copy verbatim** (from `roles-create.ts` L127-141, identical to `roles-list-for-host.ts` L86-100):
```typescript
function execWithTimeout(
  conn: Awaited<ReturnType<typeof connectOneShot>>,
  command: string,
  timeoutMs: number = SSH_EXEC_TIMEOUT_MS,
): Promise<string> {
  return Promise.race([
    execCommand(conn, command),
    new Promise<string>((_, reject) =>
      setTimeout(
        () => reject(new Error(`SSH exec timeout after ${timeoutMs}ms`)),
        timeoutMs,
      ),
    ),
  ]);
}
```

**Whitelist enforcement pattern** (NEW for Phase 23 — but modeled on `roles-create.ts` name validation L163-176):
```typescript
// After parsing body, before opening SSH:
// 1. Load /app/data/global-files.json (share loader with GEFM-03 route)
// 2. Look up entry for this hostId (or hostName — planner picks host-key format)
// 3. Reject if requested `path` is not in the whitelist:
if (!whitelistedPaths.includes(path)) {
  res.status(403).json({ error: "path not in whitelist" });
  return;
}
```
Per CONTEXT §specifics: `{ error: "path not in whitelist" }` — match this shape exactly.

**SSH connect pattern** (from `roles-create.ts` L212-227):
```typescript
let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
try {
  try {
    conn = await connectOneShot(
      host as unknown as Parameters<typeof connectOneShot>[0],
      SSH_CONNECT_TIMEOUT_MS,
    );
  } catch (err) {
    sshLogger.warn("global-files-read: SSH connect failed", {
      operation: "global_files_read_connect",
      hostId,
      error: err instanceof Error ? err.message : "Unknown",
    });
    res.status(502).json({ error: "SSH connect failed" });
    return;
  }
  // ... exec calls ...
} finally {
  if (conn) { try { conn.end(); } catch { /* ignore */ } }
}
```

**Read pattern** (adapted from `readRoleFile` L417 + `roles-create.ts` L289):
```typescript
// Read: cat with || true for missing-file resilience, plus stat for mtime.
// SAFETY: `path` is whitelist-validated above but STILL escape single quotes
// before interpolation (belt-and-suspenders — the whitelist could contain
// shell-special chars like $, backticks, quotes since it's operator-authored).
// Use single-quoted bash strings + escape ' → '"'"' idiom, OR shell-escape lib.
//
// For mtime: `stat -c '%Y' path` returns Unix epoch seconds (portable Linux).
const escaped = path.replace(/'/g, `'"'"'`);
const contentCmd = `cat '${escaped}' 2>/dev/null || true`;
const mtimeCmd = `stat -c '%Y' '${escaped}' 2>/dev/null || echo 0`;
const sizeCmd = `stat -c '%s' '${escaped}' 2>/dev/null || echo 0`;
const content = await execWithTimeout(conn, contentCmd);
const mtime = parseInt((await execWithTimeout(conn, mtimeCmd)).trim(), 10);
const size = parseInt((await execWithTimeout(conn, sizeCmd)).trim(), 10);
res.json({ content, mtime, size });
```

**Write pattern** (adapted from `writeRoleFile` L1291-1297 — REUSE `writeMarkdownFileAtomic`):
```typescript
// Optimistic concurrency: if expectedMtime is set, stat first and compare.
if (typeof expectedMtime === "number") {
  const currentMtime = parseInt(
    (await execWithTimeout(conn, `stat -c '%Y' '${escaped}' 2>/dev/null || echo 0`)).trim(),
    10,
  );
  if (currentMtime !== expectedMtime) {
    // Also grab current content so the modal can offer "reload + retry"
    const currentContent = await execWithTimeout(conn, `cat '${escaped}' 2>/dev/null || true`);
    res.status(409).json({
      error: "mtime mismatch",
      currentMtime,
      currentContent,
    });
    return;
  }
}

// SFTP atomic write — writeMarkdownFileAtomic wants an ABSOLUTE path (no tilde
// expansion via SFTP). If the whitelisted path starts with ~ we must expand it
// via `echo $HOME` first (mirrors roles-create.ts L289 idiom).
let absPath = path;
if (path.startsWith("~/")) {
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  absPath = `${remoteHome}/${path.slice(2)}`;
}
await writeMarkdownFileAtomic(conn, absPath, content);
// Re-stat to return the new mtime so the client can seed its next write's
// expectedMtime (mirrors the server-echo-authoritative pattern from
// identity:update-role-file re-read).
const newMtime = parseInt(
  (await execWithTimeout(conn, `stat -c '%Y' '${escaped}' 2>/dev/null || echo 0`)).trim(),
  10,
);
res.json({ mtime: newMtime });
```

**Body-size cap** (from `roles-create.ts` L150):
```typescript
router.post(
  "/read",
  express.json({ limit: "32kb" }),  // read body is tiny (just hostId + path)
  authenticateJWT,
  async (req, res) => { /* ... */ },
);

router.put(
  "/write",
  express.json({ limit: "4mb" }),  // write body can carry full file content — 4MB matches nginx /identities cap
  authenticateJWT,
  async (req, res) => { /* ... */ },
);
```

**What to adapt:**
- **Whitelist** replaces the `ROLE_NAME_PATTERN` gate — operator-authored config, not a regex.
- **`~/` expansion** is new — role paths hardcoded `$HOME/.claude/roles/...` directly, but user-configurable paths may or may not start with `~`.
- **`stat` for mtime + size** is new — no analog does exactly this (file-manager-content-routes has `stat -c%s` but not `%Y`).
- **Single-quote escape defense** is new — role paths were shell-safe by construction (kebab-case only), but user paths need escaping.

---

### `src/backend/database/database.ts` (mount two new routers)

**Analog:** L1820-1825 (the two `/roles` mounts)

**Pattern to copy** (add adjacent to `/roles` mounts, BEFORE `/identities`):
```typescript
// Phase 23 GEFM-03: GET /global-files?hostId=<n> — reads the per-host
// configured file list from /app/data/global-files.json.
app.use("/global-files", globalFilesListRoutes);
// Phase 23 GEFM-04: POST /global-files/read + PUT /global-files/write —
// SSH read/write of whitelisted files. Same base path as the list router;
// Express chains routers so GET falls through the list router and POST/PUT
// fall through to the read-write router.
app.use("/global-files", globalFilesReadWriteRoutes);
```

Add matching import statements at top:
```typescript
import globalFilesListRoutes from "./routes/global-files.js";
import globalFilesReadWriteRoutes from "./routes/global-files-read-write.js";
```

**What to adapt:**
- Same "two routers on same mount path" trick used by `/roles` (SRIC-02 list + SRIC-04 create) — L1820-1825 comment explicitly notes this.

---

### `docker/nginx.conf` + `docker/nginx-https.conf` (dual `/global-files` location blocks)

**Analog:** `/roles` block in `docker/nginx.conf` L267-284 (with identical mirror in `docker/nginx-https.conf` L281-301).

**Pattern to copy** (identical block in BOTH files — this is the CLAUDE.md-L43 fleet caveat; missing one file = frontend crash on `.map`):
```nginx
# Phase 23 GEFM-03 + GEFM-04: /global-files regex block — method-agnostic
# so it covers BOTH the GET list route (GEFM-03) AND the POST /read +
# PUT /write endpoints (GEFM-04). Backing routers share the base path
# via chained app.use("/global-files", ...) mounts in database.ts.
# proxy_read_timeout 15s bounds the SSH round-trip (matches /roles).
# client_max_body_size 4M matches /identities and accommodates the write
# route's full-file body (per-file cap; backend also validates).
# Parity between docker/nginx.conf and docker/nginx-https.conf is load-
# bearing per CLAUDE.md L43-46: missing this file means /global-files
# 200-returns index.html and crashes the frontend on `.map` in production.
location ~ ^/global-files(/.*)?$ {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 15s;
    client_max_body_size 4M;
}
```

**Placement:** Insert adjacent to the existing `/roles` block (before `/identities`) in **both** files.

---

### `docker/docker-compose.yml` (no changes needed)

**Analog:** `/home/ubuntu/skynet/docker/docker-compose.yml` L8-9

**Existing mount:**
```yaml
services:
  skynet:
    volumes:
      - skynet-data:/app/data
```

**What to note in the plan:**
- The `skynet-data` volume already mounts to `/app/data` — GEFM-02's config file at `/app/data/global-files.json` requires ZERO docker-compose change. The plan should call this out explicitly so a planner doesn't invent a change here.
- Host-side path for GEFM-02's SSH-edit workflow doc (via `docker volume inspect skynet-data`): `/var/lib/docker/volumes/docker_skynet-data/_data/global-files.json` typically, but planner must SSH into skynet-ec2 and run `docker volume inspect skynet-data` to confirm the exact path (compose-project prefix depends on docker-compose file location — may be `skynet_skynet-data` or `docker_skynet-data`).

---

### `src/ui/features/pretty-view/GlobalFilesModal.tsx` (GEFM-05, modal shell)

**Analog:** `/home/ubuntu/skynet/src/ui/features/pretty-view/IdentityModal.tsx`

**Modal chrome pattern** (from L883-1051):
```typescript
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogHeader, DialogTitle, DialogClose } from "@/components/dialog";
import { Tabs, TabsContent } from "@/components/tabs";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// Structure:
<DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
  <DialogPrimitive.Portal container={container ?? undefined}>
    <DialogPrimitive.Overlay className={cn(
      "absolute inset-0 z-[110] bg-black/15",
      "supports-backdrop-filter:backdrop-blur-xs duration-100",
      "data-open:animate-in data-open:fade-in-0",
      "data-closed:animate-out data-closed:fade-out-0",
    )} />
    <DialogPrimitive.Content
      onInteractOutside={(e) => e.preventDefault()}  // patch #111f — preserve chat region
      className={cn(
        "absolute inset-4 z-[120] outline-none",
        "flex flex-col overflow-hidden rounded-[24px]",
        "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
      )}
      style={{ /* glass gradient, backdrop-filter, border */ }}
    >
      <DialogTitle className="sr-only">Global files</DialogTitle>
      <DialogHeader className="px-6 py-4 shrink-0 flex flex-row items-center gap-3">
        {/* Title, host picker, close button */}
        <DialogClose asChild>
          <button {/* glass X button pattern from L1027-1050 */} />
        </DialogClose>
      </DialogHeader>
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 min-h-0 flex flex-col">
        {/* One TabsContent per configured file */}
        <TabsContent value={file.path} className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <GlobalFileTab state={fileState} onSave={saveFile} />
        </TabsContent>
        {/* Bottom icon-bar section switcher — patch #191 style, from L1400-1426 */}
        <div className="shrink-0 flex items-stretch justify-around px-2 py-1 border-t" style={{ /* glass strip */ }}>
          {files.map(file => (
            <button
              key={file.path}
              onClick={() => setActiveTab(file.path)}
              className={cn(
                "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-[10px] cursor-pointer transition-colors flex-1",
                activeTab === file.path ? "text-[#f0ebe0]" : "text-[#a89a80] hover:text-[#e8e4d8]",
              )}
            >
              <FileText size={18} />
              {file.label ?? basename(file.path)}
            </button>
          ))}
        </div>
      </Tabs>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
```

**Data-loading pattern** (from L237-296, adapted to fetch-not-WS):
- IdentityModal's inline `openOneShot` pattern is WebSocket-based.
- GEFM-05 uses **HTTP fetch** (via `authApi`) since GEFM-03/04 are HTTP routes.
- Simpler: one `useEffect` fires `GET /global-files?hostId=<n>` on modal open → for each returned file, kick off a `POST /global-files/read` → set per-file `TabState<{ content, mtime }>`.

**Loading / error / empty states** — mirror `RoleFileTab` and `IdentityFileTab` `TabState<T>` shape verbatim:
```typescript
// Import the shared discriminated union from IdentityFileTab.
import { type TabState } from "./IdentityFileTab";  // export type TabState<T> = { status: "loading" } | { status: "error"; error } | { status: "ready"; data }
```

**Host picker** — see `GlobalFilesModal` host-picker section below.

**What to adapt:**
- No pencil / edit drawer / avatar / hue — this modal has no identity concept. Header is title + host picker + close only.
- No `--pv-id-hue` — use `--color-pv-*` neutral tokens throughout per CONTEXT §GEFM-01 "same visual language".
- Tab count is dynamic (0..N per host); IdentityModal has fixed 6 tabs.
- Empty state (no files configured for host): render a neutral empty-state card in place of `<Tabs>` entirely (not a "no data" tab).

---

### `src/ui/features/pretty-view/GlobalFileTab.tsx` (GEFM-05, per-file tab body)

**Analog:** `/home/ubuntu/skynet/src/ui/features/pretty-view/RoleFileTab.tsx` (full file, 178 lines)

**What to reuse verbatim:**
- Function signature `({ state, onSave }: { state: TabState<string>; onSave?: (contents: string) => Promise<void> })` — L22-28.
- `useState` set: `editing`, `draft`, `saving`, `saveError` — L29-32.
- `handleSave` + `handleCancel` — L34-58 (unmodified).
- Loading / error / empty branches — L60-84.
- Save-button-disabled predicate: `disabled={saving || draft === state.data}` — L111.
- Textarea styling **verbatim** (this is the "do NOT reinvent, it's tuned" per CONTEXT §specifics) — L134:
  ```typescript
  className="font-mono text-sm w-full h-full min-h-[400px] p-3 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] resize-none outline-none focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]"
  ```

**Import (share the TabState shape):**
```typescript
import type { TabState } from "./IdentityFileTab";
// Comment per Phase 18 IDMEDIT-01 convention: each tab file self-contained,
// TabState imported not duplicated.
```

**What to adapt:**
- **Widen `TabState<string>` to `TabState<{ content: string; mtime: number }>`** so the tab holds mtime for optimistic-concurrency writes. Or: keep `TabState<string>` and pass mtime via a separate prop / ref. Planner picks — the former keeps the tab self-contained; the latter avoids widening the shared type.
- **Skip the `ReactMarkdown` preview mode** — CONTEXT §GEFM-05 says "plain monospace textarea — whole-file edit". No preview / no view-mode toggle. Save button always visible, textarea always editable. Delete the entire `!editing` branch (RoleFileTab.tsx L145-174).
- **On save**, `onSave(draft)` must pass the mtime the tab was seeded with, so the modal's `onSave` handler can forward it as `expectedMtime` in the PUT body. If mtime is threaded via prop, `onSave` signature becomes `(contents: string, expectedMtime: number) => Promise<void>`.
- **On 409 conflict** (backend returns `{currentMtime, currentContent}`), planner picks UX — CONTEXT §deferred says "MVP is reload + retry", so a minimal alert + refetch is fine.
- **Fallback empty state** ("No content in this file yet") — RoleFileTab L78-84 is the pattern.

---

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (GEFM-01, header consolidation)

**Analog A (existing header layout):** Same file, L700-776 (the `.pv-panel-header-row` + `.pv-header-actions` block).

**Analog B (popover chrome — since no `DropdownMenu` prior art in Skynet):** `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationContextMenu.tsx` (full file, 165 lines). This is a **custom portal-mounted menu** with the exact glass/pretty-view aesthetic Ashley wants.

**Existing header — what to remove** (L742-774):
```typescript
// REMOVE the pencil button + the `+ New role` button (both currently rendered
// inside .pv-header-actions):
{showPencilButton && (
  <button onClick={() => setNewSessionDialogOpen(true)} className="pv-pencil">
    <Plus />
  </button>
)}
{showPencilButton && (
  <button onClick={() => setCreateRoleDialogOpen(true)} className="pv-pencil" data-testid="pv-new-role-button">
    <Users />
  </button>
)}
```

**Existing header — what to keep**:
- The `<span className="pv-title">` block (SkynetLogo + wordmark) — L709-722.
- The Filter button — L728-741 (currently gated by `false &&` per patch #317, but the JSX + state stays intact).
- `<WeeklyUsageMeter />` — L780.

**New Menu button — planner picks between two shapes**:

**Option A: shadcn `DropdownMenu`** (component exists at `src/ui/components/dropdown-menu.tsx` but has ZERO usages elsewhere in Skynet — the shadcn base styling likely won't match the pretty-view glass aesthetic without heavy override; L45 uses `bg-popover` neutral tokens, not `--color-pv-*`).

**Option B: `PrettyConversationContextMenu`-style custom portal** — matches Skynet visual language exactly (Ashley-approved glass gradient L112-124, hover hue-glow, portal-mount to `document.body` to escape overflow clipping).

**Recommendation from analog analysis:** **Option B**. There is no existing DropdownMenu usage in Skynet, and `PrettyConversationContextMenu` is proof that Skynet already implements popup menus by hand for the pretty-view surface. Reuse its glass pattern.

**Menu chrome pattern to copy** (from `PrettyConversationContextMenu.tsx` L98-163):
```typescript
// Portal to document.body (escapes overflow clipping from pv-panel-header).
createPortal(
  <div
    ref={menuRef}
    role="menu"
    style={{
      position: "fixed",
      left: pos.left,
      top: pos.top,
      minWidth: 168,
      zIndex: 200,
      padding: 4,
      borderRadius: 12,
      background: "linear-gradient(160deg, rgba(20,21,32,0.94), rgba(10,11,18,0.94))",
      border: "1px solid rgba(255,240,215,0.12)",
      boxShadow: "0 12px 32px rgba(0,0,0,0.55), inset 0 1px 0 rgba(255,240,215,0.08)",
      backdropFilter: "blur(20px) saturate(1.6)",
      color: "#e8e4d8",
    }}
  >
    {items.map((item, i) => (
      <button
        key={i}
        role="menuitem"
        onClick={(e) => { e.stopPropagation(); item.onClick(); onClose(); }}
        className="py-[8px] px-[12px] max-md:py-[18px] max-md:px-[14px]"
        style={{ display: "block", width: "100%", textAlign: "left", fontSize: 14, borderRadius: 8, background: "transparent", border: "none", color: "#e8e4d8", cursor: "pointer" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,240,215,0.08)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
      >
        {item.label}
      </button>
    ))}
  </div>,
  document.body,
)
```

**Menu trigger button** — planner picks icon (CONTEXT §GEFM-01 lists `MoreHorizontal` / `MoreVertical` / `Plus` as candidates; `MoreVertical` is the conventional "overflow menu" glyph and fits Ashley's "collapse into one button" framing). Use the `.pv-pencil` CSS class for chrome parity with the (now-removed) sibling buttons — see `src/ui/features/pretty-conversations/pretty-conversations.css` L102 for the class definition.

**Menu items (three):**
1. **New agent** (formerly the pencil `+` button) → `setNewSessionDialogOpen(true)`
2. **New role** (formerly the Users button) → `setCreateRoleDialogOpen(true)`
3. **Edit global files** (NEW for GEFM-05) → `setGlobalFilesModalOpen(true)` (new state var)

**Trigger-menu-open state pattern** — add adjacent to L385-388:
```typescript
const [menuOpen, setMenuOpen] = useState(false);
const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number } | null>(null);
// On trigger click: read triggerButtonRef.current.getBoundingClientRect(), position menu below.
```

**Dialog mounts** — the existing `NewSessionDialog` (L1063) and `CreateRoleDialog` (L1095) mounts stay **unchanged** — only the buttons that open them change. Add a `<GlobalFilesModal>` mount adjacent, gated on `showPencilButton` (same predicate — the panel-header dropdown only shows when there's a session-creation seam).

**What to adapt:**
- The Filter button is behind a `false &&` guard (L728) per patch #317 (Ashley hid it for the identity-creation UAT). CONTEXT §GEFM-01 says "Filter button stays separate" — do NOT re-enable, but do NOT fold into the dropdown either. Leave the guard as-is.
- The pinned-count badge is not present in the visible header today (it lives inside conversation rows, not the header). CONTEXT §GEFM-01 says "Pinned count badge stays where it is (badge, not button)" — no action needed on it.

---

### `src/ui/api/identities-api.ts` (or new `src/ui/api/global-files-api.ts`)

**Analog:** `listRolesForHost` L132-139 (GET pattern) and `createRole` L199-217 (POST + typed error pattern) in `/home/ubuntu/skynet/src/ui/api/identities-api.ts`.

**GET pattern** (copy L132-139):
```typescript
export type GlobalFileEntry = { path: string; label?: string };

export async function listGlobalFiles(hostId: number): Promise<GlobalFileEntry[]> {
  try {
    const response = await authApi.get("/global-files", { params: { hostId } });
    return (response.data as { files: GlobalFileEntry[] }).files;
  } catch (error) {
    handleApiError(error, "list global files for host");
  }
}
```

**POST read pattern**:
```typescript
export type GlobalFileReadResult = { content: string; mtime: number; size: number };

export async function readGlobalFile(hostId: number, path: string): Promise<GlobalFileReadResult> {
  try {
    const response = await authApi.post("/global-files/read", { hostId, path });
    return response.data as GlobalFileReadResult;
  } catch (error) {
    handleApiError(error, "read global file");
  }
}
```

**PUT write pattern with typed 409 mtime-conflict error** (mirrors `RoleAlreadyExistsError` at L154-159 and `IdentityCloneCollisionError` at L192-197):
```typescript
export class GlobalFileMtimeConflictError extends Error {
  constructor(public readonly currentMtime: number, public readonly currentContent: string) {
    super("mtime mismatch");
    this.name = "GlobalFileMtimeConflictError";
  }
}

export async function writeGlobalFile(input: {
  hostId: number;
  path: string;
  content: string;
  expectedMtime?: number;
}): Promise<{ mtime: number }> {
  try {
    const response = await authApi.put("/global-files/write", input);
    return response.data as { mtime: number };
  } catch (error) {
    const err = error as { response?: { status?: number; data?: { currentMtime?: number; currentContent?: string } } };
    if (err?.response?.status === 409) {
      throw new GlobalFileMtimeConflictError(
        err.response.data?.currentMtime ?? 0,
        err.response.data?.currentContent ?? "",
      );
    }
    handleApiError(error, "write global file");
  }
}
```

**What to adapt:**
- Whether this lives in `identities-api.ts` or a new `global-files-api.ts` is a planner call. Given GEFM-05's modal is orthogonal to identities, a **new file** is cleaner. But `identities-api.ts` already grew to hold `listRolesForHost` + `createRole` (which are only tangentially related to identities), so adding here matches the current sprawl.

---

### Host picker for GEFM-05

**Analog:** `collectAllHosts` + `isFolder` at `/home/ubuntu/skynet/src/ui/sidebar/NewSessionDialog.tsx` L83-100 (also duplicated verbatim in `CreateRoleDialog.tsx` L51-65 — comment at L46-49 says "duplicated pending F1 recommendation `extract into reusable HostPickerList`").

**What to reuse:**
```typescript
function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}
function collectAllHosts(children: (Host | HostFolder)[]): Host[] {
  const out: Host[] = [];
  for (const child of children) {
    if (isFolder(child)) out.push(...collectAllHosts(child.children));
    else out.push(child);
  }
  return out;
}
// Then:
const flatHosts = useMemo(
  () => collectAllHosts(hostTree?.children ?? []).filter((h) => h.enableRdp !== true),
  [hostTree],
);
```

**Auto-select single host on open** (from `CreateRoleDialog.tsx` L146-161):
```typescript
useEffect(() => {
  if (open) {
    if (flatHosts.length === 1) setSelectedHost(flatHosts[0]);
  } else {
    setSelectedHost(null);
    setSearch("");
  }
}, [open, flatHosts]);
```

**Prop shape** — `GlobalFilesModal` should accept `hostTree: HostFolder | null` just like NewSessionDialog + CreateRoleDialog (L237 + L82).

**Default to currently-selected session's host** (CONTEXT §GEFM-05 "defaults to the currently-selected session's host if any"):
- Planner threads a new prop `defaultHostId: number | null` from the panel to the modal.
- Use it in the auto-select useEffect: `if (defaultHostId && flatHosts.find(h => Number(h.id) === defaultHostId)) setSelectedHost(that host);` before the length-1 fallback.

**What to adapt:**
- The **third** copy of `collectAllHosts` is scope creep — RESEARCH F1 flags it for extraction. The planner MAY choose to extract to a shared `src/ui/sidebar/host-picker-utils.ts` in this phase (small opportunistic refactor) OR duplicate a third time (matches current pattern, defers refactor). Planner picks.

## Shared Patterns

### Cookie auth (all three backend routes)

**Source:** `AuthManager.getInstance().createAuthMiddleware()` — pattern used at `roles-list-for-host.ts` L48 and `roles-create.ts` L92.

**Apply to:** `global-files.ts`, `global-files-read-write.ts`.

**Pattern:**
```typescript
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
// Then mount as second arg in each route:
router.get("/", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;  // typed access
  // ...
});
```

CONTEXT §GEFM-03/GEFM-04 says "Cookie auth using the existing admin cookie — no new auth surface." That is exactly what `authenticateJWT` provides (the JWT rides in an httpOnly cookie).

### Host ownership check (per-user isolation)

**Source:** `resolveHostById(hostId, userId)` — used at `roles-list-for-host.ts` L123 and `roles-create.ts` L203.

**Apply to:** All three GEFM-03/04 endpoints. **CRITICAL:** Even though CONTEXT §GEFM-04 says "anyone with admin cookie can read/write", `resolveHostById` still gates per-USER host visibility (a user can only touch hosts THEY own). This is the correct Ashley-intent — she owns all fleet hosts, so she has full access; a hypothetical second user on ceo-skynet would only see their own hosts.

**Pattern:**
```typescript
const host = await resolveHostById(hostId, userId);
if (!host) return res.status(404).json({ error: "Host not found" });
```

### SSH connect + exec + finally cleanup (GEFM-04 only)

**Source:** `roles-list-for-host.ts` L129-231 (also `roles-create.ts` L212-390).

**Apply to:** `global-files-read-write.ts`.

**Pattern (invariant across every SSH-exec route in the codebase):**
```typescript
let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
try {
  try {
    conn = await connectOneShot(host as unknown as Parameters<typeof connectOneShot>[0], SSH_CONNECT_TIMEOUT_MS);
  } catch (err) {
    sshLogger.warn("<route>: SSH connect failed", { operation: "<op>_connect", hostId, error: err instanceof Error ? err.message : "Unknown" });
    return res.status(502).json({ error: "SSH connect failed" });
  }
  // ... exec calls, each wrapped in try/catch → 502 with generic message ...
} finally {
  if (conn) { try { conn.end(); } catch { /* ignore */ } }
}
```

### Nginx dual-file mirror (fleet caveat)

**Source:** CLAUDE.md L43-46 (project constraint):
> **Nginx caveat**: Every new backend route needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`, else it 200s with `index.html` and crashes the frontend on `.map`.

**Apply to:** Any plan touching backend routes.

**Verification pattern:** After adding a location block to `nginx.conf`, `grep -n "location.*global-files" docker/nginx*.conf` MUST return two hits (one per file). Missing one = plan-checker BLOCK.

### Frontend API error handling

**Source:** `identities-api.ts` L215 (`createRole`), L179 (`cloneIdentity`) — use `handleApiError(error, "<verb noun>")` for non-typed failures, and throw typed error classes for expected non-2xx codes the caller wants to render inline.

**Apply to:** Global-files API functions above.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.planning/phases/23-*/23-BOOTSTRAP.md` | doc | (docs) | Planner drafts the SSH-edit workflow doc fresh. Reference: CONTEXT §GEFM-06 lists the specific hosts to seed (thenasty, workstation, ashley-beelink, ZoeyBattlestation, aither-cloud, aither-cloud2, aither-sftp, skynet-ec2 — omit Windows GIGAASHLEYPC). |
| Seed `global-files.json` (bootstrap data) | infra config data | (JSON seed) | Content is Ashley-specific (fleet host list × `~/.claude/CLAUDE.md`); no reusable template exists. Ship the file as an operator-authored asset (probably deployed by ssh-ing into skynet-ec2 and writing it into `/var/lib/docker/volumes/skynet_skynet-data/_data/global-files.json`; no in-repo template needed since the config is per-Skynet-instance per CONTEXT §non-negotiables). |

## Metadata

**Analog search scope:**
- `/home/ubuntu/skynet/src/backend/database/routes/` (all 43 route files)
- `/home/ubuntu/skynet/src/backend/claude-session/` (WS handlers + identity-artifact-reader.ts)
- `/home/ubuntu/skynet/src/backend/ssh/` (host-resolver, ssh-one-shot, tmux-helper)
- `/home/ubuntu/skynet/src/ui/features/pretty-view/` (all 30+ modal + tab files)
- `/home/ubuntu/skynet/src/ui/features/pretty-conversations/` (panel + context menu + row files)
- `/home/ubuntu/skynet/src/ui/sidebar/` (all 4 dialog files)
- `/home/ubuntu/skynet/src/ui/api/` (all 30+ frontend API files)
- `/home/ubuntu/skynet/src/ui/components/` (shadcn UI primitives)
- `/home/ubuntu/skynet/docker/` (nginx.conf, nginx-https.conf, docker-compose.yml)
- `/home/ubuntu/skynet/CLAUDE.md` (fleet caveats)

**Files scanned:** ~90 (targeted greps + Read on the top ~15 hottest analog candidates).

**Pattern extraction date:** 2026-08-05

**Notes for planner:**
1. **Big trap:** The upstream context brief implies SRIC-06's read/write is an HTTP route (`src/backend/database/routes/role-file-routes.ts`). That file does **not exist**. SRIC-06 lives in `claude-session-server.ts` as WebSocket handlers. Phase 23 is HTTP-route-shaped like SRIC-02 (`roles-list-for-host.ts`) and SRIC-04 (`roles-create.ts`), NOT WebSocket-shaped. The read/write **helpers** (`readRoleFile`, `writeRoleFile`, `writeMarkdownFileAtomic`) in `identity-artifact-reader.ts` are reusable and are the "same SSH exec-channel plumbing SRIC-06 uses" that CONTEXT §GEFM-04 refers to — those helpers are what to reuse, not the WS wire shape.
2. **DropdownMenu prior art:** The shadcn `dropdown-menu.tsx` component exists but has **zero call sites** in the codebase. `PrettyConversationContextMenu.tsx` is the closest visual analog (portal-mounted, glass-styled, matches pretty-view aesthetic). Recommend the planner uses `PrettyConversationContextMenu`'s pattern rather than adopting shadcn `DropdownMenu` — the latter would introduce a token/theming mismatch with the surrounding `.pv-*` chrome.
3. **Path escaping is new territory:** Neither `readRoleFile` nor `writeRoleFile` shell-escapes their path arguments because role names pass `IDENTITY_KEY_RE` (`[a-z0-9_-]{1,64}`, no shell-special chars). Global-file paths are operator-authored and can contain `$`, backticks, quotes, spaces — the planner MUST apply single-quote escaping (`path.replace(/'/g, "'\"'\"'")`) or use a shell-escape utility before interpolating into `cat` / `stat` commands. Whitelist-enforcement alone does not remove this obligation (whitelist gates auth, escaping gates injection).
4. **mtime for optimistic concurrency:** No exact analog in the codebase — `file-manager-content-routes.ts` uses `stat -c%s` for size but not `%Y` for mtime. Planner uses `stat -c '%Y'` (Linux) which returns Unix epoch seconds. If the fleet includes non-GNU stat targets (BSD/macOS), fallback needed — but CONTEXT §GEFM-06 lists only Linux hosts (Windows explicitly omitted).
5. **Volume host-side path for GEFM-06:** `docker volume inspect skynet-data` on skynet-ec2 gives the answer. Compose-project prefix depends on the directory name where `docker-compose.yml` lives (`/opt/skynet/` → likely `skynet_skynet-data` or `docker_skynet-data`). Planner MUST ssh in and confirm before finalizing the bootstrap doc — don't hardcode a guessed path.
