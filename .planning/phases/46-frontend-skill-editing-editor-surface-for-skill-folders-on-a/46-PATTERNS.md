# Phase 46: Frontend skill editing — Pattern Map

**Mapped:** 2026-08-18
**Files analyzed:** 10 (7 new + 3 modified)
**Analogs found:** 10 / 10 (all exact or role-match — this phase is a full mirror-and-fork of Phase 23)

**Discipline for the planner:** every new file has a byte-shape precedent in the Phase 23 global-files cluster. The pattern excerpts below are the exact code the executor should copy, then s/global-files/skills-editor/g and thread the skill dimension. Where Phase 46 genuinely diverges (path-safety gate, recursive enumeration, isText detection, modal-in-modal confirmations, delete-skill), the divergence is called out per file with its own excerpt or callout.

---

## File Classification

| File | New/Modified | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|---|
| `src/backend/database/routes/skills-editor.ts` | NEW | Express router (backend) | request-response over SSH exec + SFTP | `src/backend/database/routes/global-files-read-write.ts` (+ `global-files.ts` for GET-list) | exact (fork) |
| `src/backend/database/routes/skills-editor.test.ts` | NEW | Vitest backend route test | request-response mocking | `src/backend/database/routes/global-files-read-write.test.ts` | exact (fork) |
| `src/ui/api/skills-api.ts` | NEW | Frontend API client (axios) | request-response (JSON over HTTPS) | `src/ui/api/global-files-api.ts` | exact (fork) |
| `src/ui/features/pretty-view/SkillsEditorModal.tsx` | NEW | React modal component | event-driven UI + lazy SSH read | `src/ui/features/pretty-view/GlobalFilesModal.tsx` | exact (fork) |
| `src/ui/features/pretty-view/SkillsEditorModal.test.tsx` | NEW | Vitest component test | mocked API + DOM assertions | `src/ui/features/pretty-view/GlobalFilesModal.test.tsx` | exact (fork) |
| `src/ui/features/pretty-view/SkillFileTab.tsx` | NEW | React tab pane component | state-machine render (loading/error/ready/non-text) | `src/ui/features/pretty-view/GlobalFileTab.tsx` | exact (fork) + one new branch |
| `src/ui/features/pretty-view/SkillFileTab.test.tsx` | NEW | Vitest component test | branch coverage | `src/ui/features/pretty-view/GlobalFileTab.test.tsx` | exact (fork) |
| `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` | NEW | Generic destructive-confirm dialog | event-driven UI | (no direct mirror — UI-SPEC L212-220 prescribes shape) | role-match; visual mirror is `GlobalFilesModal.tsx` L186-217 chrome + `NewSessionDialog.tsx` focus pattern |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | MODIFIED | Panel component (mount site) | menu → modal open state | Own file — existing L484, L1583, L1616 wiring is the analog to duplicate parallel to | exact (parallel wiring) |
| `src/backend/database/database.ts` | MODIFIED | Express app assembly | router mount (2 lines) | Own file — existing L32-33 imports + L1852/L1857 `app.use()` mounts | exact (parallel wiring) |
| `docker/nginx.conf` | MODIFIED | Nginx location block | HTTP proxy_pass | Own file — existing L286-306 `/global-files` regex block | exact (parallel block) |
| `docker/nginx-https.conf` | MODIFIED | Nginx location block | HTTPS proxy_pass | Own file — existing L303-323 `/global-files` regex block | exact (parallel block) |

---

## Pattern Assignments

### `src/backend/database/routes/skills-editor.ts` (backend router, request-response over SSH)

**Primary analog:** `src/backend/database/routes/global-files-read-write.ts` (521 lines) + `src/backend/database/routes/global-files.ts` (105 lines).

**Divergence from analog:** replace the JSON whitelist gate (`loadGlobalFilesConfig` + `getFilesForHost`) with a **path-safety gate** (regex + resolved-path prefix assertion — see § Shared Patterns → Path Safety Gate). Add `isText` byte-sniff to `POST /read`. Add three new endpoints: `POST /create`, `DELETE /file`, `DELETE /skill`.

#### Imports + module-scope constants pattern

**Source:** `global-files-read-write.ts` L42-77 (verbatim shape). Executor removes the two `global-files-config-loader.js` imports (no whitelist here) and adds the two path-safety helpers.

```typescript
// Copy verbatim from global-files-read-write.ts L42-77, drop the loader imports:
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
const MAX_PATH_LENGTH = 512;
const MAX_CONTENT_BYTES = 2_000_000;
// NEW for Phase 46:
const SKILL_NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;
```

#### `execWithTimeout` + `shellEscape` helpers (duplicate verbatim)

**Source:** `global-files-read-write.ts` L78-108 (comment L80-81 documents the intentional duplication precedent from `roles-create.ts` / `roles-list-for-host.ts`).

```typescript
// Verbatim from global-files-read-write.ts L82-108:
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

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}
```

**PATTERNS trap #3 reminder** (from `global-files-read-write.ts` L98-108 comment): the regex gate is the AUTH gate; `shellEscape` is the INJECTION gate; **both are required**. In Phase 46 the AUTH gate shifts from a JSON whitelist to `isValidSkillName` + `isSafeRelativePath` + prefix assertion, but the same two-gate discipline applies.

#### Endpoint skeleton (validate → resolveHost → connect → exec → cleanup)

**Source:** `global-files-read-write.ts` L119-266 (`POST /read` — the canonical shape). Copy the outer scaffold verbatim; swap step 3 (whitelist check) for the path-safety gate; add `isText` sniff to the response.

Key structural landmarks the executor must preserve verbatim:

- **L119-123:** `router.post("/read", express.json({ limit: "32kb" }), authenticateJWT, async (req, res): Promise<void> => {`
- **L124:** `const userId = (req as AuthenticatedRequest).userId;` — always first.
- **L129-148:** Body validation returning 400 before any I/O.
- **L156-160:** `resolveHostById(hostId, userId)` returning 404 for cross-user/unknown host.
- **L177-192:** Outer `try` block opens with SSH-connect-in-inner-try (502 on failure, `conn = null` for cleanup safety).
- **L200-216:** `echo $HOME` two-step for tilde resolution (see § Shared Patterns → Tilde Expansion).
- **L227-240:** `shellEscape` + `cat`/`stat` exec pattern.
- **L247-263:** Outer `catch` (500 with sanitized `{ error: "internal" }`) + `finally` with best-effort `conn.end()`.

Verbatim `finally` block (mirror across all 7 endpoints):

```typescript
// global-files-read-write.ts L256-263:
} finally {
  if (conn) {
    try {
      conn.end();
    } catch {
      /* best-effort cleanup */
    }
  }
}
```

#### `PUT /write` (mtime-conflict flow) pattern

**Source:** `global-files-read-write.ts` L279-501. The 409 shape is byte-locked — do NOT invent a variant.

```typescript
// global-files-read-write.ts L423-445 — mtime pre-check + 409 shape (COPY VERBATIM):
if (typeof expectedMtime === "number") {
  const currentMtimeStr = (
    await execWithTimeout(
      conn,
      `stat -c '%Y' ${escapedPath} 2>/dev/null || echo 0`,
    )
  ).trim();
  const currentMtime = parseInt(currentMtimeStr, 10) || 0;

  if (currentMtime !== expectedMtime) {
    const currentContent = await execWithTimeout(
      conn,
      `cat ${escapedPath} 2>/dev/null || true`,
    );
    res.status(409).json({
      error: "mtime mismatch",
      currentMtime,
      currentContent,
    });
    return;
  }
}
```

**Atomic write:**

```typescript
// global-files-read-write.ts L453-464 — SFTP write via writeMarkdownFileAtomic:
try {
  await writeMarkdownFileAtomic(conn, absPath, content);
} catch (err) {
  sshLogger.error("global-files-write: SFTP write failed", {
    operation: "global_files_write_sftp",
    hostId,
    absPath,
    error: err instanceof Error ? err.message : "Unknown",
  });
  res.status(502).json({ error: "SSH exec failed" });
  return;
}
```

**Do NOT use `sftp.rename` directly** — see `identity-artifact-reader.ts` L1039-1063 prologue for the SSH2_FX_FAILURE / EEXIST trap. `writeMarkdownFileAtomic` uses `ext_openssh_rename` (posix-rename@openssh.com) for atomic overwrite.

#### `GET /skills` list-endpoint pattern

**Source:** `global-files.ts` L46-86 — the query-string variant of validate → resolveHost → return.

```typescript
// global-files.ts L46-86 (shape to mirror for GET /skills-editor/skills):
router.get(
  "/skills",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId
    const rawHostId = req.query.hostId;
    if (rawHostId === undefined || rawHostId === "") {
      return res.status(400).json({ error: "hostId is required" });
    }
    const hostId = parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }

    // 2. Per-user host isolation
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    // 3. SSH + enumerate skills (fork from Phase 23: this branch DOES SSH,
    //    unlike Phase 23's list route which was local-only. Use the connect+finally
    //    pattern from global-files-read-write.ts L177-263 here.)
    // ...
  },
);
```

**Recommended SSH command** (from RESEARCH.md § Backend Endpoint 1):

```bash
find ~/.claude/skills -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort
```

If the tilde is NOT expanded in this exec context, fall back to the `echo $HOME` two-step (same pattern as `global-files-read-write.ts` L200-216).

#### `DELETE` endpoints (rm patterns)

**Secondary analog** for the `rm -rf` shape (delete-skill): `src/backend/ssh/file-manager-operation-routes.ts` L376-380.

```typescript
// file-manager-operation-routes.ts L376-380 (reference for the delete command shape):
const escapedPath = itemPath.replace(/'/g, "'\"'\"'");
const deleteCommand = isDirectory
  ? `rm -rf '${escapedPath}'`
  : `rm -f '${escapedPath}'`;
```

**For Phase 46 use `shellEscape` (not the inline replace) for consistency with the rest of the router.** Two endpoints:

- `DELETE /skills-editor/file` → `rm -f ${shellEscape(absPath)}` (idempotent — `-f` swallows missing).
- `DELETE /skills-editor/skill` → `rm -rf ${shellEscape(skillRoot)}` — **the path-safety gate MUST fire first**. A skill name that escapes validation and resolves to `~/` would `rm -rf ~/`. See § Shared Patterns → Path Safety Gate.

#### Fallback 500 error handler

**Source:** `global-files-read-write.ts` L503-518 (copy verbatim):

```typescript
router.use(
  (
    err: Error,
    _req: Request,
    res: Response,
    _next: express.NextFunction,
  ) => {
    sshLogger.error("skills-editor: unhandled error", {
      operation: "skills_editor_error",
      error: err?.message,
    });
    return res.status(500).json({ error: "internal" });
  },
);

export default router;
```

---

### `src/backend/database/routes/skills-editor.test.ts` (backend route test)

**Primary analog:** `src/backend/database/routes/global-files-read-write.test.ts` (533 lines).

**Divergence:** drop the `global-files-config-loader` mock (no whitelist); add per-endpoint path-escape test cases (`skill = "../etc"`, `path = "../../etc/passwd"`, `path = "/etc/passwd"`, `path = "foo\0.txt"`).

#### Auth manager mock

**Source:** `global-files-read-write.test.ts` L46-66 (verbatim):

```typescript
let mockUserId: string | null = "1";

vi.mock("../../utils/auth-manager.js", () => {
  const AuthManager = {
    getInstance: () => ({
      createAuthMiddleware: () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (mockUserId === null) {
            return res.status(401).json({ error: "Unauthorized" });
          }
          (req as express.Request & { userId: string }).userId = mockUserId;
          next();
        },
    }),
  };
  return { AuthManager };
});
```

#### SSH primitive mocks + late-import pattern

**Source:** `global-files-read-write.test.ts` L68-120 (verbatim). Copy `vi.mock("../../ssh/ssh-one-shot.js", ...)`, `vi.mock("../../ssh/tmux-helper.js", ...)`, `vi.mock("../../ssh/host-resolver.js", ...)`, `vi.mock("../../claude-session/identity-artifact-reader.js", ...)`, and `vi.mock("../../utils/logger.js", ...)`. Then `const { default: router } = await import("./skills-editor.js");` AFTER the mocks (L197 pattern).

**Drop** the `vi.mock("./global-files-config-loader.js", ...)` block — no whitelist config in Phase 46.

#### HTTP request helper (verbatim)

**Source:** `global-files-read-write.test.ts` L124-172 — bare-Express + `node:http` pattern (no supertest dependency). Copy verbatim; documented comment L123 says "mirrors roles-list-for-host.test.ts / identity-clone.test.ts patterns".

#### `beforeEach`/`afterEach` scaffolding

**Source:** `global-files-read-write.test.ts` L201-231 (verbatim). Drop the `loadGlobalFilesConfig` + `getFilesForHost` mock setup (L215-220). Replace with default stubs for `execCommand("echo $HOME")` returning `"/home/testuser\n"` so every test has a resolved HOME baseline.

#### Test-case structure (per-endpoint happy-path + error-path)

**Source:** `global-files-read-write.test.ts` L237-533 has 8 named tests (B1-B4 read, W1-W4 write) — the shape to mirror.

**Phase 46 additional coverage (critical — see RESEARCH.md § Pitfall 1):**

```typescript
// Path-escape rejection — 400 responses for every attack input:
describe("path-safety gate", () => {
  it("rejects skill '..' with 400", async () => { /* body: { hostId: 1, skill: "..", path: "SKILL.md" } */ });
  it("rejects skill '../etc' with 400", async () => { /* ... */ });
  it("rejects path '../../etc/passwd' with 400", async () => { /* ... */ });
  it("rejects path '/etc/passwd' (leading slash) with 400", async () => { /* ... */ });
  it("rejects path 'foo\\0.txt' (NUL byte) with 400", async () => { /* ... */ });
  it("rejects path 'foo/../bar' (embedded ..) with 400", async () => { /* ... */ });
  // Assert: NO execCommand calls fired (SSH never opened).
});
```

---

### `src/ui/api/skills-api.ts` (frontend API client)

**Primary analog:** `src/ui/api/global-files-api.ts` (99 lines).

**Divergence:** add `SkillEntry`, `SkillFileEntry` types with the skill dimension; add `listSkills`, `enumerateSkillFiles`, `createSkillFile`, `deleteSkillFile`, `deleteSkill` functions; duplicate the `GlobalFileMtimeConflictError` class shape as `SkillFileMtimeConflictError`; add `SkillFileAlreadyExistsError` for `createSkillFile`'s 409 branch.

**Duplication decision** (from RESEARCH.md § Open Questions → 5): **duplicate** the mtime-conflict class rather than import — the two features share zero runtime concern, and Phase 23 also duplicated `execWithTimeout` + `shellEscape` for the same reason.

#### Imports + first-function pattern

**Source:** `global-files-api.ts` L1, L20-50 (verbatim shape):

```typescript
// global-files-api.ts L1 (verbatim):
import { authApi, handleApiError } from "@/main-axios";

// global-files-api.ts L26-34 (409 error class shape to duplicate):
export class GlobalFileMtimeConflictError extends Error {
  constructor(
    public readonly currentMtime: number,
    public readonly currentContent: string,
  ) {
    super("mtime mismatch");
    this.name = "GlobalFileMtimeConflictError";
  }
}

// global-files-api.ts L42-50 (list function shape):
export async function listGlobalFiles(hostId: number): Promise<GlobalFileEntry[]> {
  try {
    const response = await authApi.get("/global-files", { params: { hostId } });
    return (response.data as { files: GlobalFileEntry[] }).files;
  } catch (error) {
    handleApiError(error, "list global files for host");
    throw error; // unreachable — handleApiError throws; satisfies TS return type
  }
}
```

#### 409 branching pattern (writeGlobalFile → writeSkillFile)

**Source:** `global-files-api.ts` L77-99 (verbatim shape):

```typescript
// global-files-api.ts L77-99 — the 409-to-typed-error branch:
export async function writeGlobalFile(
  input: GlobalFileWriteInput,
): Promise<GlobalFileWriteResult> {
  try {
    const response = await authApi.put("/global-files/write", input);
    return response.data as GlobalFileWriteResult;
  } catch (error) {
    const err = error as {
      response?: {
        status?: number;
        data?: { currentMtime?: number; currentContent?: string };
      };
    };
    if (err?.response?.status === 409) {
      throw new GlobalFileMtimeConflictError(
        err.response.data?.currentMtime ?? 0,
        err.response.data?.currentContent ?? "",
      );
    }
    handleApiError(error, "write global file");
    throw error; // unreachable
  }
}
```

**Add for `createSkillFile`:** same shape, but branch on `err?.response?.status === 409` throwing `SkillFileAlreadyExistsError()`.

**Add for DELETE endpoints:** `authApi.delete("/skills-editor/file", { data: { hostId, skill, path } })` — note the `data` field for DELETE bodies (axios requires this because DELETE bodies are unusual).

Full expected file shape is spelled out in RESEARCH.md § Frontend API helper (L886-984).

---

### `src/ui/features/pretty-view/SkillsEditorModal.tsx` (frontend modal component)

**Primary analog:** `src/ui/features/pretty-view/GlobalFilesModal.tsx` (377 lines).

**Divergence:**
1. Add a **second `<select>`** (skill picker) between host `<select>` and glass X.
2. Add a **`+ Add file` button** in header row (only when skill is picked).
3. Add a **`Trash2` icon-button** in header row for delete-skill (only when skill is picked).
4. Wrap bottom tab bar in **horizontal-scroll container** (`overflow-x-auto` + `-webkit-overflow-scrolling: touch`) per UI-SPEC L257 + D-06.
5. Change lazy-load useEffect deps to `[selectedHostId, selectedSkillName, activeTab]` (still no `tabData` — RESEARCH.md Pattern 1 / Pitfall 4).
6. Mount `DeleteConfirmDialog` twice (delete-file + delete-skill flows).

#### Imports + helper duplication pattern

**Source:** `GlobalFilesModal.tsx` L1-42 (verbatim shape; `collectAllHosts` + `isFolder` are the fourth duplication instance — RESEARCH.md notes this is intentional posture).

```typescript
// GlobalFilesModal.tsx L1-16 (imports pattern; add Trash2, AlertTriangle to lucide-react):
import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, X, Trash2, AlertTriangle } from "lucide-react";  // +Trash2 +AlertTriangle for Phase 46
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogHeader, DialogTitle, DialogClose } from "@/components/dialog";
import { Tabs, TabsContent } from "@/components/tabs";
import { cn } from "@/lib/utils";
import type { Host, HostFolder } from "@/types/ui-types";
// (Skills-api imports — replace the global-files imports)
import type { TabState } from "./IdentityFileTab";

// GlobalFilesModal.tsx L29-42 (duplicated helpers — copy verbatim, fourth instance):
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
```

#### State + `flatHosts` memo

**Source:** `GlobalFilesModal.tsx` L62-70. Add `selectedSkillName` state + a `skills` state for the enumerate-skills TabState.

```typescript
// GlobalFilesModal.tsx L62-70 (state shape to fork; add skill layer):
const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
const [files, setFiles] = useState<TabState<GlobalFileEntry[]>>({ status: "loading" });
const [activeTab, setActiveTab] = useState<string | null>(null);
const [tabData, setTabData] = useState<Map<string, TabState<GlobalFileTabData>>>(new Map());

// Phase 46 additions:
// const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
// const [skills, setSkills] = useState<TabState<SkillEntry[]>>({ status: "loading" });

const flatHosts = useMemo(
  () => collectAllHosts(hostTree?.children ?? []).filter((h) => h.enableRdp !== true),
  [hostTree],
);
```

**RDP filter (L68)** — RESEARCH.md Pitfall 7: `.filter((h) => h.enableRdp !== true)` MUST be preserved verbatim.

#### The lazy-load useEffect (LOAD-BEARING — copy VERBATIM including comment + eslint-disable)

**Source:** `GlobalFilesModal.tsx` L115-149 — this is the quick-260805-7rq race fix. RESEARCH.md Pattern 1 + Pitfall 4 both call this out as non-negotiable.

```typescript
// GlobalFilesModal.tsx L116-149 (VERBATIM; the eslint-disable + comment are load-bearing):
useEffect(() => {
  if (selectedHostId == null || !activeTab) return;
  if (tabData.has(activeTab)) return; // already loaded
  let cancelled = false;
  setTabData((prev) => new Map(prev).set(activeTab, { status: "loading" }));
  readGlobalFile(selectedHostId, activeTab)
    .then((result) => {
      if (cancelled) return;
      setTabData((prev) =>
        new Map(prev).set(activeTab, {
          status: "ready",
          data: { content: result.content, mtime: result.mtime },
        }),
      );
    })
    .catch((err: unknown) => {
      if (cancelled) return;
      setTabData((prev) =>
        new Map(prev).set(activeTab, {
          status: "error",
          error: err instanceof Error ? err.message : "Failed to load",
        }),
      );
    });
  return () => {
    cancelled = true;
  };
  // Intentional exhaustive-deps violation: including `tabData` re-runs this effect after
  // `setTabData({loading})`, whose cleanup sets `cancelled = true` on the still-in-flight
  // `readGlobalFile` (see plan 260805-7rq). The `tabData.has(activeTab)` gate inside the
  // body is a deliberate stale-closure read — "if the currently-known map already tracks
  // this tab, skip".
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedHostId, activeTab]);
```

**Phase 46 change:** deps become `[selectedHostId, selectedSkillName, activeTab]` and `readGlobalFile(hostId, path)` becomes `readSkillFile(hostId, skill, path)`. The response type gains an `isText` field; store `{ content, mtime, isText }` in the tab data map. Everything else — including the comment and eslint-disable — is preserved.

**Phase 46 addition — non-text branch:** in the SkillFileTab render, switch on `state.data.isText` to render either the textarea (verbatim `GlobalFileTab`) or the `AlertTriangle` placeholder card.

#### The mtime-conflict save handler

**Source:** `GlobalFilesModal.tsx` L152-183 (`handleSave` callback, verbatim shape):

```typescript
// GlobalFilesModal.tsx L152-183 — 409 handling + window.confirm reload UX:
const handleSave = useCallback(
  async (path: string, content: string, expectedMtime: number): Promise<void> => {
    if (selectedHostId == null) return;
    try {
      const result = await writeGlobalFile({ hostId: selectedHostId, path, content, expectedMtime });
      setTabData((prev) =>
        new Map(prev).set(path, { status: "ready", data: { content, mtime: result.mtime } }),
      );
    } catch (err) {
      if (err instanceof GlobalFileMtimeConflictError) {
        const shouldReload = window.confirm(
          "The file changed on disk since you started editing. Reload from disk and lose your local edits?",
        );
        if (shouldReload) {
          setTabData((prev) =>
            new Map(prev).set(path, {
              status: "ready",
              data: { content: err.currentContent, mtime: err.currentMtime },
            }),
          );
          return;
        }
        throw err;
      }
      throw err;
    }
  },
  [selectedHostId],
);
```

**UI-SPEC L158 confirms** the `window.confirm` copy is inherited verbatim — the mtime-conflict flow uses `window.confirm` (system-triggered clarification), NOT the modal-in-modal Dialog (reserved for user-initiated destruction).

#### Modal chrome (Radix Dialog, portal, overlay, content)

**Source:** `GlobalFilesModal.tsx` L186-217 (verbatim; UI-SPEC L18 mandates verbatim mirror):

```typescript
// GlobalFilesModal.tsx L186-217 — copy VERBATIM (glass gradient, z-index ladder, animations):
<DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
  <DialogPrimitive.Portal container={container ?? undefined}>
    <DialogPrimitive.Overlay
      className={cn(
        "absolute inset-0 z-[110] bg-black/15",
        "supports-backdrop-filter:backdrop-blur-xs duration-100",
        "data-open:animate-in data-open:fade-in-0",
        "data-closed:animate-out data-closed:fade-out-0",
      )}
    />
    <DialogPrimitive.Content
      onInteractOutside={(e) => { e.preventDefault(); }}
      className={cn(
        "absolute inset-4 z-[120] outline-none",
        "flex flex-col overflow-hidden rounded-[24px]",
        "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
        "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
      )}
      style={{
        background: "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
        backdropFilter: "blur(28px) saturate(1.4)",
        WebkitBackdropFilter: "blur(28px) saturate(1.4)",
        border: "1px solid hsla(220, 65%, 55%, 0.32)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
        color: "#e8e4d8",
      }}
    >
```

#### Header row (host `<select>` + glass X)

**Source:** `GlobalFilesModal.tsx` L221-271 (verbatim shape; add second `<select>`, `+ Add file` button, and delete-skill `Trash2` button).

```typescript
// GlobalFilesModal.tsx L228-242 — host <select> shape (native, per UI-SPEC L237):
<select
  value={selectedHostId ?? ""}
  onChange={(e) =>
    setSelectedHostId(e.target.value ? Number(e.target.value) : null)
  }
  className="ml-2 px-3 py-1.5 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] text-sm outline-none cursor-pointer"
>
  <option value="">Pick a host…</option>
  {flatHosts.map((h) => (
    <option key={h.id} value={h.id}>
      {h.name}
    </option>
  ))}
</select>

// Phase 46 additions AFTER the host <select>:
// - Skill <select> with SAME className. Placeholder: "Pick a host first…" (disabled) or "Pick a skill…" (enabled).
// - "+ Add file" button — same width/height/border-radius; accent hover (hsla(220,80%,60%,0.20/0.30)); disabled when no skill or file list loading.
// - Trash2 icon-button (size-6 rounded-md hover:bg-white/[0.06]; text color #a89a80 → hover #f87171).
```

**Glass X close button** (L247-270) — copy verbatim.

#### Body branches (no host / loading / error / empty / content)

**Source:** `GlobalFilesModal.tsx` L273-298 (verbatim shape; copy the four-branch flow, translate copy per UI-SPEC L128-142):

```typescript
// GlobalFilesModal.tsx L274-298 — four-branch body pattern:
{selectedHostId == null ? (
  <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
    Pick a host to load its configured files.
  </div>
) : files.status === "loading" ? (
  <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
    Loading…
  </div>
) : files.status === "error" ? (
  <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-6 text-center">
    {files.error}
  </div>
) : files.data.length === 0 ? (
  <div className="flex-1 flex flex-col items-center justify-center text-[#a89a80] gap-2 text-sm text-center px-6">
    <div>No global files configured for this host.</div>
    {/* ... */}
  </div>
) : (
  // Tabs
)}
```

**Phase 46 branches (per UI-SPEC copy):**
- No host: "Pick a host to load its skills."
- Host picked, skills loading: "Loading skills…"
- Skills error: `Couldn't load skills: {err.message}`
- No skills: heading "No skills on this host." body "Skills live in `~/.claude/skills/` on the host. Nothing to edit here yet."
- Skill picked, files loading/error/empty (parallel copy per UI-SPEC L136-142).

#### Bottom tab strip (horizontal-scroll wrapper is the Phase 46 divergence)

**Source:** `GlobalFilesModal.tsx` L321-370 (verbatim pattern with one addition):

```typescript
// GlobalFilesModal.tsx L322-331 — tab-strip outer wrapper (glass surround):
<div
  className="shrink-0 flex items-stretch justify-around px-2 py-1 border-t"
  // Phase 46 addition per UI-SPEC L257 + D-06:
  //   className="shrink-0 flex items-stretch px-2 py-1 border-t overflow-x-auto"
  //   style={{ ...existing, WebkitOverflowScrolling: "touch" }}
  //   (drop justify-around because horizontal-scroll wants natural flex start alignment)
  style={{
    borderTopColor: "rgba(220, 225, 245, 0.10)",
    background:
      "linear-gradient(180deg, rgba(18,20,28,0.62), rgba(28,30,40,0.55))",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
  }}
>
  {files.data.map((file) => {
    const selected = activeTab === file.path;
    return (
      <button
        key={file.path}
        type="button"
        onClick={() => setActiveTab(file.path)}
        className={cn(
          // GlobalFilesModal.tsx L340-348 — pill classes (verbatim):
          "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-[10px] cursor-pointer transition-colors flex-1 min-w-0",
          selected
            ? "text-[#f0ebe0] font-semibold"
            : "text-[#a89a80] hover:text-[#e8e4d8]",
        )}
        style={
          selected
            ? {
                background: "hsla(220, 80%, 60%, 0.18)",
                boxShadow: "inset 0 0 0 1px hsla(220, 80%, 70%, 0.28)",
              }
            : undefined
        }
      >
        <FileText size={18} />
        <span className="truncate w-full text-center">
          {file.label ?? file.path.split("/").pop()}
        </span>
      </button>
    );
  })}
</div>
```

**Phase 46 label:** `<span>{file.path}</span>` (whole relative path per D-05 — e.g. `tests/basic.py`), not `.split("/").pop()`.

**Phase 46 flex change:** drop `flex-1` and `justify-around`; instead let tabs be intrinsic-width and let the wrapper's `overflow-x-auto` scroll them.

---

### `src/ui/features/pretty-view/SkillsEditorModal.test.tsx` (component test)

**Primary analog:** `src/ui/features/pretty-view/GlobalFilesModal.test.tsx` (109 lines).

**Divergence:** mock `@/api/skills-api` instead of `@/api/global-files-api`; test the skill dropdown → files load sequence; keep the 700ms-race regression test verbatim (renamed for skill fixture).

#### Module mock pattern (hoisted before component import)

**Source:** `GlobalFilesModal.test.tsx` L22-34 (verbatim shape):

```typescript
// GlobalFilesModal.test.tsx L22-34 — mock the API module before the component import:
vi.mock("@/api/global-files-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listGlobalFiles: vi.fn().mockResolvedValue([
      { path: "~/.claude/CLAUDE.md", label: "User CLAUDE.md" },
    ]),
    readGlobalFile: vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return { content: "MOCKED FILE CONTENT", mtime: 1_700_000_000, size: 20 };
    }),
  };
});
```

**Phase 46 mock target:** `@/api/skills-api` with `listSkills`, `enumerateSkillFiles`, `readSkillFile`, `writeSkillFile`, `createSkillFile`, `deleteSkillFile`, `deleteSkill`.

#### Host tree fixture (verbatim)

**Source:** `GlobalFilesModal.test.tsx` L44-75 — minimal HostFolder tree passing the `enableRdp !== true` filter. Copy verbatim.

#### Race regression test

**Source:** `GlobalFilesModal.test.tsx` L78-108 — the whole test body is a copy-paste target. Phase 46 version drives host+skill selection before asserting the textarea appears with mocked content.

```typescript
// GlobalFilesModal.test.tsx L87-108 — regression assertion pattern:
it("renders the READY textarea after an asynchronous readGlobalFile resolves (regression: lazy-load useEffect must not cancel its own in-flight read via tabData-in-deps re-run)", async () => {
  render(
    <GlobalFilesModal
      open={true}
      onOpenChange={vi.fn()}
      hostTree={HOST_TREE}
      defaultHostId={1}
      container={document.body}
    />,
  );
  await waitFor(
    () => expect(screen.queryByRole("textbox")).toBeTruthy(),
    { timeout: 2000 },
  );
  const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(textarea.value).toBe("MOCKED FILE CONTENT");
});
```

**Phase 46 additional coverage (RESEARCH.md § Test Seam):** (a) skill dropdown populated after host pick, (b) file list refetched after skill pick, (c) non-text branch renders AlertTriangle placeholder, (d) "+ Add file" prompt round-trip creates + refetches, (e) delete-file confirm modal-in-modal appears + DELETE fires + tab list updates.

---

### `src/ui/features/pretty-view/SkillFileTab.tsx` (tab pane component)

**Primary analog:** `src/ui/features/pretty-view/GlobalFileTab.tsx` (128 lines).

**Divergence:**
1. Add `isText: boolean` field to `TabData` shape.
2. Add **non-text branch** rendering `AlertTriangle` + heading + body per UI-SPEC L162-167.
3. Add **delete-file `Trash2` trigger** to the left of the Save button (UI-SPEC L188).

#### TabState import + data type

**Source:** `GlobalFileTab.tsx` L1-19 (verbatim shape; extend the data type):

```typescript
// GlobalFileTab.tsx L1-19 — import TabState from IdentityFileTab (don't redefine):
import { useCallback, useEffect, useState } from "react";
import { Skeleton } from "@/components/skeleton";
import type { TabState } from "./IdentityFileTab";

export type GlobalFileTabData = { content: string; mtime: number };
// Phase 46 additions:
// export type SkillFileTabData = { content: string; mtime: number; isText: boolean };
```

**TabState is a shared discriminated union** — do NOT redefine. Import from `IdentityFileTab` (RESEARCH.md § Standard Stack → Supporting).

#### Draft seeding useEffect (verbatim)

**Source:** `GlobalFileTab.tsx` L45-51 — mtime-keyed reseed pattern with the intentional eslint-disable:

```typescript
useEffect(() => {
  if (state.status === "ready") {
    setDraft(state.data.content);
    setSaveError(null);
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [state.status === "ready" ? state.data.mtime : null]);
```

#### handleSave (verbatim)

**Source:** `GlobalFileTab.tsx` L63-74:

```typescript
const handleSave = useCallback(async () => {
  if (state.status !== "ready") return;
  setSaving(true);
  setSaveError(null);
  try {
    await onSave(draft, state.data.mtime);
  } catch (err) {
    setSaveError(err instanceof Error ? err.message : "Save failed");
  } finally {
    setSaving(false);
  }
}, [state, draft, onSave]);
```

#### Loading + error render branches (verbatim)

**Source:** `GlobalFileTab.tsx` L76-94 — three-skeleton loading, single-line error copy:

```typescript
// GlobalFileTab.tsx L77-84 — loading branch:
if (state.status === "loading") {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
      <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
      <Skeleton className="h-32 w-full rounded-[var(--radius-pv-bubble)]" />
    </div>
  );
}

// GlobalFileTab.tsx L88-93 — error branch:
if (state.status === "error") {
  return (
    <div className="text-sm text-[color:var(--color-pv-code-fg)]">
      Couldn&apos;t load file: {state.error}
    </div>
  );
}
```

#### Ready branch: textarea + save button (near-verbatim)

**Source:** `GlobalFileTab.tsx` L104-126:

```typescript
// GlobalFileTab.tsx L104-126 — the editable textarea + save button:
return (
  <div className="flex flex-col h-full gap-2">
    <textarea
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      className="font-mono text-sm w-full h-full min-h-[400px] p-3 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] resize-none outline-none focus:border-[hsla(var(--pv-id-hue,220),80%,60%,0.5)]"
      spellCheck={false}
    />
    {saveError && (
      <div className="text-sm text-red-400 px-1">{saveError}</div>
    )}
    <div className="flex justify-end gap-2 shrink-0">
      <button
        type="button"
        onClick={() => { void handleSave(); }}
        disabled={saving || draft === state.data.content}
        className="px-4 py-2 rounded-md bg-[hsla(var(--pv-id-hue,220),80%,60%,0.2)] hover:bg-[hsla(var(--pv-id-hue,220),80%,60%,0.3)] text-[#e8e4d8] disabled:opacity-40 disabled:cursor-not-allowed text-sm cursor-pointer"
      >
        {saving ? "Saving…" : "Save"}
      </button>
    </div>
  </div>
);
```

**Phase 46 additions to this branch:**

1. **Guard: non-text file → placeholder instead of textarea.** Before rendering the textarea, check `state.data.isText`. If `false`, render:

```typescript
// UI-SPEC L162-167 — non-text placeholder (Phase 46 new branch):
return (
  <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[400px]">
    <AlertTriangle size={20} className="text-[#a89a80]" />
    <div className="text-sm font-semibold text-[#e8e4d8]">Not a text file</div>
    <div className="text-sm text-[#a89a80]">This file isn&apos;t text and can&apos;t be edited here.</div>
  </div>
);
```

2. **Delete-file `Trash2` trigger to the LEFT of the Save button** (UI-SPEC L188):

```typescript
// UI-SPEC L188 — delete-file trigger in action row:
<button
  type="button"
  title="Delete this file"
  onClick={() => onRequestDelete?.()}
  className="size-6 rounded-md hover:bg-white/[0.06] flex items-center justify-center text-[#a89a80] hover:text-[#f87171] cursor-pointer"
>
  <Trash2 size={16} />
</button>
```

`onRequestDelete` is a new prop that fires up to `SkillsEditorModal` to open the DeleteConfirmDialog.

---

### `src/ui/features/pretty-view/SkillFileTab.test.tsx` (tab component test)

**Primary analog:** `src/ui/features/pretty-view/GlobalFileTab.test.tsx` (156 lines).

**Divergence:** add test cases for the non-text branch (`isText: false` → AlertTriangle + no textarea) and the delete-file trigger (`Trash2` click fires `onRequestDelete`).

#### Branch-coverage test pattern

**Source:** `GlobalFileTab.test.tsx` L20-124 — tests 1-4 cover loading / error / ready-non-empty / ready-empty-editable branches. Test 5 is the regression gate for the "No content in this file yet." dead-end (deleted 2026-08-05).

Copy the test structure verbatim. Add:

```typescript
// Phase 46 test 8: isText false → placeholder, no textarea
it("non-text file → renders AlertTriangle placeholder, no textarea", () => {
  render(
    <SkillFileTab
      state={{ status: "ready", data: { content: "", mtime: 42, isText: false } }}
      onSave={vi.fn()}
    />,
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText(/not a text file/i)).toBeTruthy();
  expect(screen.getByText(/isn't text and can't be edited/i)).toBeTruthy();
});

// Phase 46 test 9: Trash2 click fires onRequestDelete
it("delete-file trigger fires onRequestDelete", () => {
  const onRequestDelete = vi.fn();
  render(
    <SkillFileTab
      state={{ status: "ready", data: { content: "x", mtime: 1, isText: true } }}
      onSave={vi.fn()}
      onRequestDelete={onRequestDelete}
    />,
  );
  fireEvent.click(screen.getByTitle(/delete this file/i));
  expect(onRequestDelete).toHaveBeenCalledTimes(1);
});
```

---

### `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` (new generic destructive-confirm dialog)

**Primary analog:** NONE (no direct in-repo mirror for a modal-in-modal destructive confirm). UI-SPEC L212-220 prescribes the visual shape.

**Secondary analog for the Radix Dialog scaffold:** `GlobalFilesModal.tsx` L186-217 (portal + overlay + content pattern) — same primitives, higher z-index, smaller rectangle.

**Secondary analog for focus behavior:** `NewSessionDialog.tsx` (primary-focus pattern per UI-SPEC L219).

#### Shape from UI-SPEC L212-220

```typescript
// Prescribed shape — synthesize from GlobalFilesModal.tsx L186-217 chrome + UI-SPEC L212-220 spec:
<DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
  <DialogPrimitive.Portal container={container ?? undefined}>
    <DialogPrimitive.Overlay
      className="absolute inset-4 z-[125] bg-black/40 data-open:animate-in data-open:fade-in-0"
      // Note: inset-4 not inset-0 — dim the parent modal only, not the full app.
    />
    <DialogPrimitive.Content
      className="absolute z-[130] outline-none max-w-[400px] w-[85%] rounded-[16px] p-6 flex flex-col gap-4"
      style={{
        top: "50%", left: "50%", transform: "translate(-50%, -50%)",
        background: "linear-gradient(160deg, hsla(220, 45%, 20%, 0.92), hsla(220, 40%, 12%, 0.94))",
        backdropFilter: "blur(28px) saturate(1.4)",
        border: "1px solid hsla(220, 65%, 55%, 0.32)",
        boxShadow: "0 24px 64px rgba(0,0,0,0.7)",
        color: "#e8e4d8",
      }}
    >
      <DialogTitle className="text-[15px] font-semibold text-[#f0ebe0]">{heading}</DialogTitle>
      <div className="text-sm text-[#e8e4d8]">{body}</div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          disabled={inFlight}
          className="px-4 py-2 rounded-md bg-transparent border border-white/10 text-[#e8e4d8] text-sm cursor-pointer"
        >
          Cancel
        </button>
        <button
          type="button"
          autoFocus
          onClick={onConfirm}
          disabled={inFlight}
          className="px-4 py-2 rounded-md bg-[hsla(0,75%,55%,0.20)] hover:bg-[hsla(0,75%,55%,0.30)] text-[#e8e4d8] text-sm cursor-pointer"
          style={{ boxShadow: "inset 0 0 0 1px hsla(0, 75%, 65%, 0.35)" }}
        >
          {inFlight ? "Deleting…" : primaryLabel}
        </button>
      </div>
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
```

**Props:** `open`, `onOpenChange`, `heading`, `body` (React node — includes monospace code inline), `primaryLabel`, `onConfirm`, `inFlight`, `error`, `container?`.

**Two consumers in `SkillsEditorModal.tsx`:**
- Delete-file: heading `"Delete file?"`, body `{skill}/{path}` in monospace + `"This can't be undone."`, primary `"Delete"`.
- Delete-skill: heading `"Delete skill?"`, body `{skill}` in monospace + `"This removes the skill folder and every file inside it. This can't be undone."`, primary `"Delete skill"`.

---

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (menu mount edit)

**Existing wiring is the analog:** parallel state + parallel modal mount + parallel menu item, alongside the existing `globalFilesModalOpen` wiring.

#### Import (add alongside L60)

**Source:** `PrettyConversationsPanel.tsx` L60 (existing):

```typescript
import GlobalFilesModal from "@/features/pretty-view/GlobalFilesModal";
// Phase 46 addition:
// import SkillsEditorModal from "@/features/pretty-view/SkillsEditorModal";
```

#### State declaration (add after L485)

**Source:** `PrettyConversationsPanel.tsx` L484-485 (existing):

```typescript
// Phase 23 (GEFM-05): GlobalFilesModal open/closed toggle (opened from menu item).
const [globalFilesModalOpen, setGlobalFilesModalOpen] = useState(false);
// Phase 46 addition:
// const [skillsEditorModalOpen, setSkillsEditorModalOpen] = useState(false);
```

#### Modal mount (add after L1583-1588)

**Source:** `PrettyConversationsPanel.tsx` L1578-1588 (existing):

```typescript
{/* Phase 23 (GEFM-05): GlobalFilesModal — portal-mounted sibling of the
    existing dialog mounts. Opened via the header MoreVertical menu's
    "Edit global files…" item. defaultHostId={null} is deliberate: the
    panel-header trigger has no active-conversation context (it renders
    a list), so the modal falls through to its own host picker. */}
<GlobalFilesModal
  open={globalFilesModalOpen}
  onOpenChange={setGlobalFilesModalOpen}
  hostTree={hostTree ?? null}
  defaultHostId={null}
/>
// Phase 46 addition — parallel sibling:
// <SkillsEditorModal
//   open={skillsEditorModalOpen}
//   onOpenChange={setSkillsEditorModalOpen}
//   hostTree={hostTree ?? null}
//   defaultHostId={null}
// />
```

#### Menu-item entry (add after L1616 — position matters per UI-SPEC L112)

**Source:** `PrettyConversationsPanel.tsx` L1613-1617 (existing menu items array):

```typescript
// PrettyConversationsPanel.tsx L1613-1617 (existing):
{[
  { label: "New agent", onClick: () => setNewSessionDialogOpen(true) },
  { label: "New role", onClick: () => setCreateRoleDialogOpen(true) },
  { label: "Edit global files…", onClick: () => setGlobalFilesModalOpen(true) },
  // Phase 46 addition — position AFTER "Edit global files…" per UI-SPEC L112:
  // { label: "Edit skills…", onClick: () => setSkillsEditorModalOpen(true) },
].map((item) => ( /* button rendering — verbatim */ ))}
```

**Menu-order lock (RESEARCH.md Pitfall 8):** consider adding a `// KEEP ORDER: New agent → New role → Edit global files… → Edit skills…` comment above the array to guard against alphabetization/refactor drift.

---

### `src/backend/database/database.ts` (router mount — 2 lines)

**Existing wiring is the analog:** `L32-33` (imports) + `L1849-1857` (`app.use` mounts).

**Source:** `database.ts` L32-33:

```typescript
import globalFilesListRoutes from "./routes/global-files.js";
import globalFilesReadWriteRoutes from "./routes/global-files-read-write.js";
// Phase 46 addition:
// import skillsEditorRoutes from "./routes/skills-editor.js";
```

**Source:** `database.ts` L1849-1857:

```typescript
// Phase 23 GEFM-03: GET /global-files?hostId=<n> ...
app.use("/global-files", globalFilesListRoutes);
// Phase 23 GEFM-04: POST /global-files/read + PUT /global-files/write ...
app.use("/global-files", globalFilesReadWriteRoutes);
// Phase 46 addition:
// app.use("/skills-editor", skillsEditorRoutes);
```

---

### `docker/nginx.conf` (nginx location block)

**Existing wiring is the analog:** L286-306 `/global-files` regex block.

**Source:** `docker/nginx.conf` L286-306 (verbatim shape — parallel block for `/skills-editor`):

```nginx
# Phase 23 GEFM-03 + GEFM-04: /global-files regex block — method-agnostic
# so it covers BOTH the GET list route (GEFM-03) AND the POST /read +
# PUT /write endpoints landing in wave 2 (GEFM-04). Backing routers share
# the base path via chained app.use("/global-files", ...) mounts in
# database.ts. proxy_read_timeout 15s bounds the SSH round-trip
# (matches /roles). client_max_body_size 4M matches /identities and
# accommodates the wave-2 write route's full-file body.
# Parity between docker/nginx.conf and docker/nginx-https.conf is
# load-bearing per CLAUDE.md: missing this in the HTTPS conf means
# /global-files 200-returns index.html and crashes the frontend on `.map`
# in production.
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

**Phase 46 block to add (RESEARCH.md § Pattern 2):**

```nginx
# Phase 46 SKILLED-01: /skills-editor regex block — method-agnostic so it covers
# GET (skills, files) + POST (read, create) + PUT (write) + DELETE (file, skill).
# Backing router is app.use("/skills-editor", skillsEditorRoutes) in database.ts.
# proxy_read_timeout 15s bounds the SSH round-trip (matches /global-files).
# client_max_body_size 4M accommodates PUT /write's full-file body.
# Parity between docker/nginx.conf and docker/nginx-https.conf is load-bearing
# per CLAUDE.md: missing in HTTPS conf means /skills-editor 200-returns
# index.html and crashes the frontend on `.map` in production.
location ~ ^/skills-editor(/.*)?$ {
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

---

### `docker/nginx-https.conf` (parallel HTTPS block — parity load-bearing)

**Existing wiring is the analog:** L303-323 `/global-files` regex block.

**Add the same `location ~ ^/skills-editor(/.*)?$` block** at the parallel position (near the existing `/global-files` block, L322-323).

**Verify command** (RESEARCH.md § Pitfall 2):

```bash
grep -n "skills-editor" docker/nginx.conf docker/nginx-https.conf
# Must return 2 hits in each file (the comment header + the location directive).
```

---

## Shared Patterns

Cross-cutting patterns applied across multiple new files.

### Authentication

**Source:** `AuthManager.getInstance().createAuthMiddleware()` — mounted on EVERY backend endpoint.

**Applied to:** All 7 endpoints in `skills-editor.ts`.

```typescript
// global-files-read-write.ts L56-58 — module-scope setup:
const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// Per-route mount:
router.post("/read", express.json({ limit: "32kb" }), authenticateJWT, async (req, res) => { /* ... */ });
```

**RESEARCH.md § Security Domain / V2 Authentication:** missing middleware on any endpoint is a plan-checker BLOCK.

### Per-user host isolation

**Source:** `resolveHostById(hostId, userId)` from `src/backend/ssh/host-resolver.ts` (200 lines of subtlety already debugged — reused verbatim from Phase 23).

**Applied to:** All 7 endpoints. Returns `null` for cross-user or unknown hosts → 404.

```typescript
// global-files-read-write.ts L156-160 — the pattern:
const host = await resolveHostById(hostId, userId);
if (!host) {
  res.status(404).json({ error: "Host not found" });
  return;
}
```

### Path safety gate (NEW for Phase 46 — not present in Phase 23)

**Source:** RESEARCH.md § Pattern 3 (§Common Pitfalls → Pitfall 1). Phase 23 could rely on a static whitelist; Phase 46 has no whitelist because the whitelist IS the skill folder.

**Applied to:** Every endpoint in `skills-editor.ts` that accepts a `skill` or `path` argument, BEFORE any SSH or SFTP call.

```typescript
// SKILL name gate — rejects `.`, `..`, empty, any shell metacharacter
const SKILL_NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;
function isValidSkillName(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (s === "." || s === "..") return false;
  return SKILL_NAME_RE.test(s);
}

// PATH gate — rejects leading slash, .. segments, NUL bytes, empty segments
function isSafeRelativePath(p: unknown): p is string {
  if (typeof p !== "string") return false;
  if (p.length === 0 || p.length > 512) return false;
  if (p.startsWith("/")) return false;
  if (p.includes("\0")) return false;
  for (const part of p.split("/")) {
    if (part === "" || part === "." || part === "..") return false;
  }
  return true;
}

// Belt-and-suspenders prefix assertion — post-compose, after regex gates:
const skillRoot = `${remoteHome}/.claude/skills/${skill}`;
const absPath = `${skillRoot}/${relPath}`;
if (!absPath.startsWith(skillRoot + "/")) {
  res.status(400).json({ error: "path escape detected" });
  return;
}
```

**Critical for `DELETE /skill`** (RESEARCH.md § Security Domain → Path traversal): a bypassed gate would `rm -rf ~/`. Two-layer defense (regex gate + prefix assertion) is mandatory. Backed by the dedicated `describe("path-safety gate", ...)` test group in `skills-editor.test.ts`.

### Tilde expansion (echo $HOME two-step)

**Source:** `global-files-read-write.ts` L200-216, L395-411. Cause: SFTP does not tilde-expand, and single-quote shell escaping suppresses tilde expansion too. Quick-260805-70q root-caused the false-409 bug this pattern prevents (RESEARCH.md § Pitfall 5).

**Applied to:** Every endpoint in `skills-editor.ts` that constructs a path under `~/.claude/skills/`.

```typescript
// global-files-read-write.ts L200-216 — the pattern (verbatim):
let absPath = path;
if (path.startsWith("~/")) {
  const remoteHome = (
    await execWithTimeout(conn, "echo $HOME")
  ).trim();
  if (!remoteHome || remoteHome.startsWith("~")) {
    sshLogger.warn("global-files-read: could not resolve remote HOME", {
      operation: "global_files_read_home",
      hostId,
      remoteHome,
    });
    res.status(502).json({ error: "could not resolve remote HOME" });
    return;
  }
  absPath = `${remoteHome}/${path.slice(2)}`;
}
```

**For Phase 46:** ALL endpoints construct paths from `~/.claude/skills/<skill>/...`, so ALL endpoints run the two-step. Cache-across-requests is a bug (RESEARCH.md § Anti-Patterns) — always re-run `echo $HOME` per request.

### SSH connect + cleanup lifecycle

**Source:** `global-files-read-write.ts` L177-263 — outer `try { inner try { connectOneShot } catch { 502 } ... } catch { 500 } finally { conn?.end() }`.

**Applied to:** Every endpoint.

```typescript
let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
try {
  try {
    conn = await connectOneShot(
      host as unknown as Parameters<typeof connectOneShot>[0],
      SSH_CONNECT_TIMEOUT_MS,
    );
  } catch (err) {
    sshLogger.warn("skills-editor: SSH connect failed", { /* ... */ });
    res.status(502).json({ error: "SSH connect failed" });
    return;
  }
  // ... exec/SFTP work
} catch (err) {
  sshLogger.error("skills-editor: unexpected error", { /* ... */ });
  if (!res.headersSent) {
    res.status(500).json({ error: "internal" });
  }
} finally {
  if (conn) {
    try { conn.end(); } catch { /* best-effort cleanup */ }
  }
}
```

### Frontend error handling (handleApiError)

**Source:** `global-files-api.ts` L46-49, L64-67, L96-98 — every function wraps in `try { ... } catch (error) { handleApiError(error, "..."); throw error; }`.

**Applied to:** Every function in `skills-api.ts`.

```typescript
try {
  const response = await authApi.get("/skills-editor/skills", { params: { hostId } });
  return (response.data as { skills: SkillEntry[] }).skills;
} catch (error) {
  handleApiError(error, "list skills for host");
  throw error; // unreachable — handleApiError throws; satisfies TS return type
}
```

**RESEARCH.md § Anti-Patterns:** Do NOT use `fetch()` — `handleApiError` centralizes 401/network-drop toast handling, and `authApi` auto-attaches JWT.

### TabState<T> discriminated union (shared type)

**Source:** `IdentityFileTab.tsx` L21-24 — `{ status: "loading" } | { status: "error"; error: string } | { status: "ready"; data: T }`.

**Applied to:** `SkillsEditorModal.tsx` (three uses: `files`, `skills`, per-tab `tabData` map), `SkillFileTab.tsx` (prop type).

**Do NOT redefine — import.** Every existing tab file in the codebase imports it (`IdentityFileTab.tsx` is the source of truth).

### Modal chrome (Radix Dialog + glass gradient)

**Source:** `GlobalFilesModal.tsx` L186-217 — the whole primitive stack (Root, Portal, Overlay, Content) with the specific z-index ladder (110/120), inset-4, rounded-[24px], glass gradient, backdrop-filter, border, box-shadow.

**Applied to:** `SkillsEditorModal.tsx` (parent modal — z-110/120) and `DeleteConfirmDialog.tsx` (child modal — z-125/130, inset-4 overlay for parent-only dim).

UI-SPEC L18 mandates verbatim mirror. `onInteractOutside` preventDefault is patch #111f — preserve.

### Nginx location block + parity guard

**Source:** `docker/nginx.conf` L286-306 + `docker/nginx-https.conf` L303-323 — the two-file parity requirement (RESEARCH.md § Pitfall 2 / patch #446 layer-enumeration reflex).

**Applied to:** BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`. Missing block in either → `/skills-editor/*` returns `index.html` and crashes the frontend on `.map` parsing.

**Verify:** `grep -n "skills-editor" docker/nginx.conf docker/nginx-https.conf` must return matching hits in both files.

### SFTP for writes, SSH exec for everything else

**Source:** RESEARCH.md § Pattern 4. Phase 23 established the two-channel discipline: SSH exec for `cat`/`stat`/`find`/`ls`/`rm`/`touch`/`mkdir`; SFTP (`writeMarkdownFileAtomic`) for atomic writes.

**Applied to:** All 7 endpoints in `skills-editor.ts`:

| Endpoint | Channel | Command / Helper |
|---|---|---|
| `GET /skills` | exec | `find ~/.claude/skills -mindepth 1 -maxdepth 1 -type d -printf '%f\n'` |
| `GET /files` | exec | `find <skillRoot> -type f -printf '%P\n' \| sort` |
| `POST /read` | exec | `cat <path>` + `stat -c '%Y'` + `stat -c '%s'` + Node-side `detectIsText(buf)` |
| `PUT /write` | exec + SFTP | mtime pre-check (exec `stat`); write (`writeMarkdownFileAtomic`); re-stat (exec) |
| `POST /create` | exec | `test -e ... && echo exists`, `mkdir -p <parent>`, `touch <path>`, `stat` |
| `DELETE /file` | exec | `rm -f <path>` |
| `DELETE /skill` | exec | `rm -rf <skillRoot>` — path-safety gate is life-critical |

**Do NOT introduce `sftp.rename`** (identity-artifact-reader.ts L1039-1063 prologue explains SSH2_FX_FAILURE trap).

### Text detection (Node-side byte sniff — new)

**Source:** RESEARCH.md § Text Detection (recommended heuristic, cited as A4 assumption).

**Applied to:** `POST /read` endpoint response — sets `isText` field on the response payload; frontend renders placeholder when `!isText`.

```typescript
function detectIsText(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  const window = buf.slice(0, Math.min(8192, buf.length));
  for (let i = 0; i < window.length; i++) {
    const b = window[i];
    if (b === 0) return false;
    if (b <= 0x08) return false;
    if (b >= 0x0E && b <= 0x1F) return false;
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(window);
    if (decoded.includes("�")) return false;
    return true;
  } catch {
    return false;
  }
}
```

**Response shape:** `{ content: isText ? content : "", mtime, size, isText }` — return empty content when binary to save bandwidth + prevent accidental display bugs.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` | destructive-confirm modal-in-modal | event-driven UI | No prior in-repo destructive-confirm dialog uses a Radix Dialog-in-Dialog pattern. Skynet's existing destructive flows all use `window.confirm` (mtime conflict), inline "type the name to confirm" (identity delete), or no confirm (file-manager delete). UI-SPEC L212-220 prescribes the visual shape — synthesized from the parent-modal chrome (`GlobalFilesModal.tsx` L186-217) with a smaller rectangle and higher z-index. See § Pattern Assignments → DeleteConfirmDialog for the assembled excerpt. |

**Consequence:** the planner has a single new-shape component in this phase. Everything else has a direct byte-shape precedent. Estimate: DeleteConfirmDialog is ~60 lines; consumed by two call sites in `SkillsEditorModal.tsx`.

---

## Metadata

**Analog search scope:**
- `src/backend/database/routes/` (Phase 23 backend cluster)
- `src/backend/ssh/` (SSH helpers + file-manager rm patterns)
- `src/backend/claude-session/identity-artifact-reader.ts` (`writeMarkdownFileAtomic`)
- `src/ui/features/pretty-view/` (Phase 23 modal + tab components + tests)
- `src/ui/api/` (Phase 23 API client)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (menu mount site)
- `docker/nginx.conf` + `docker/nginx-https.conf` (existing `/global-files` location blocks)

**Files scanned:** 14 (Phase 23 primary cluster) + 3 (mount sites) + 2 (nginx configs) + 4 (secondary helpers).

**Pattern extraction date:** 2026-08-18

**Coverage summary:**
- Files with exact byte-shape analog: 9 (backend router, backend test, frontend API, frontend modal, frontend modal test, frontend tab, frontend tab test, panel mount, DB mount, both nginx blocks)
- Files with partial-mirror analog (chrome + primitives only): 1 (DeleteConfirmDialog — chrome mirrors `GlobalFilesModal.tsx` L186-217, prescribed by UI-SPEC L212-220)
- Files with no analog: 0

**Key patterns identified:**
1. Every backend endpoint follows the same 6-step spine: JWT auth → body validation (400) → `resolveHostById` (404) → SSH connect (502) → exec/SFTP → cleanup in `finally`.
2. Every frontend API function follows the same `try { authApi.XXX } catch { handleApiError; throw }` shape, with typed error subclasses for 409 branches.
3. Every modal uses the same Radix Dialog primitive stack + `absolute inset-4` + `z-[110]`/`z-[120]` + glass gradient (hardcoded `hue 220` for modal-ambient blue).
4. Every backend route needs BOTH nginx configs updated (patch #446 layer-enumeration reflex).
5. The lazy-load useEffect's `[selectedHostId, activeTab]` deps array (excluding `tabData`) plus the eslint-disable + comment is the quick-260805-7rq race fix — non-negotiable, copy verbatim.
6. Phase 46's ONE novel pattern is the path-safety gate (regex + prefix assertion + shellEscape defense-in-depth), replacing Phase 23's JSON whitelist AUTH gate.
