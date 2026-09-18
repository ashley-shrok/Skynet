# Phase 117: projects — Pattern Map

**Mapped:** 2026-09-18
**Files analyzed:** 15 new + 8 modified = 23 total
**Analogs found:** 22 / 23

Every new file except the Matrix account_data layer has a byte-shape-parallel Phase 115 or Runbook analog in the current tree. The Matrix layer extends `matrix-admin-client.ts`'s fetch shape rather than copying an account_data analog (none exists yet). Extract patterns concretely rather than abstractly — the planner should reference these excerpts with file path + line number verbatim.

## File Classification

### Backend surface

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/database/routes/project-list.ts` (NEW) | route (Express router) | request-response | `src/backend/database/routes/runbooks-editor.ts` (slug-directory, fixed-sentinel, role-scoping) | role-match |
| `src/backend/database/routes/session-project-write.ts` (NEW) | route (Express router) | request-response | `src/backend/database/routes/identity-archive.ts` (sentinel-drop shape, hostId+key body) | exact |
| `src/backend/database/routes/relay-room-project-tag.ts` (NEW) | route (Express router) | request-response | `src/backend/database/routes/identity-archive.ts` (POST + JSON body + JWT auth) | role-match |
| `src/backend/claude-session/identity-artifact-reader.ts` (MODIFIED) | utility (artifact reader) | file-I/O | Self — extends existing LOCAL/REMOTE branch pattern | exact (self-extension) |
| `src/backend/matrix/matrix-room-tag-client.ts` (NEW, sibling of matrix-admin-client) | service (Matrix HTTP client) | request-response | `src/backend/matrix/matrix-admin-client.ts` (fetch + AbortController + AdminOk/AdminErr) | role-match |
| `src/backend/fleet-status/wire-protocol.ts` (MODIFIED) | config (zod schemas) | event-driven | Self — `FrontendIdentityArchivedFrameSchema` at :577-583 | exact (self-extension) |
| `src/backend/fleet-status/subscription-registry.ts` (MODIFIED) | service (in-memory registry) | pub-sub | Self — `publishIdentityArchived` at :292-312 | exact (self-extension) |

### Frontend API clients

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/api/project-list-api.ts` (NEW) | api client | request-response | `src/ui/api/identity-archive-api.ts` (thin fetch wrapper + `handleApiError`) | exact |
| `src/ui/api/session-project-api.ts` (NEW) | api client | request-response | `src/ui/api/identity-archive-api.ts` (POST with `{hostId, ...}` body, `{ok: true}` return) | exact |
| `src/ui/api/fleet-status-client.ts` (MODIFIED) | api client (WS dispatcher) | event-driven | Self — `case "identity-archived"` at :216-231 | exact (self-extension) |

### Frontend state + UI

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/state/conversation-store.ts` (MODIFIED) | store (useSyncExternalStore) | event-driven | Self — `archivedFleetRows` slice at :391-432, :1888-1967 | exact (self-extension) |
| `src/ui/state/use-collapsed-project-slugs.ts` (NEW) | hook (localStorage) | file-I/O | `src/ui/state/conversation-store.ts` `hydrateActiveSetFromStorage` (`ACTIVE_SET_STORAGE_KEY`) at :270 | role-match |
| `src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` (NEW) | component (React) | request-response | Panel's Archived section render at `PrettyConversationsPanel.tsx:1995-2033` | role-match |
| `src/ui/features/pretty-conversations/CreateProjectModal.tsx` (NEW) | component (React modal) | request-response | `src/ui/features/pretty-conversations/NewConversationModal.tsx` (controlled `open`, `onOpenChange`, `onCreated`, JSON POST inside) | role-match |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (MODIFIED) | component (React) | request-response | Self — coral overlay at :1636-1647, drag machinery at :1490-1600 | exact (self-extension) |
| `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` (READ-ONLY) | component (React) | request-response | No modification needed — DnD source contract at :949-973 already carries the payload | N/A |
| `src/ui/AppShell.tsx` (MODIFIED) | shell (React) | event-driven | Self — `onIdentityArchived` wiring at :636-646 | exact (self-extension) |

### Fleet substrate + tests

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `substrate/skills/id/SKILL.md` (MODIFIED) | doc (markdown) | N/A | Self — insertion at § 2 "Loading an existing identity" step 3→4 (:200-215) | exact (self-extension) |
| `src/backend/claude-session/identity-artifact-reader.projects.test.ts` (NEW) | test (vitest) | N/A | `src/backend/database/routes/identity-archive.test.ts` shape | role-match |
| `src/backend/database/routes/project-list.test.ts` (NEW) | test (vitest+supertest) | N/A | `src/backend/database/routes/identity-archive.test.ts` at :180-247 | exact |
| `src/backend/database/routes/session-project-write.test.ts` (NEW) | test (vitest+supertest) | N/A | `src/backend/database/routes/identity-archive.test.ts` at :180-247 | exact |
| `src/ui/state/conversation-store.projects.test.ts` (NEW) | test (vitest) | N/A | existing `conversation-store.test.ts` snapshot-builder shape | role-match |
| `src/ui/features/pretty-conversations/CreateProjectModal.test.tsx` (NEW) | test (@testing-library) | N/A | `NewConversationModal.test.tsx` + `NewConversationModal.flow.test.tsx` | role-match |

---

## Pattern Assignments

### `src/backend/database/routes/session-project-write.ts` (route, request-response)

**Analog:** `src/backend/database/routes/identity-archive.ts`

**Imports pattern** (identity-archive.ts:42-53):
```typescript
import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { databaseLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import {
  isLocalHostId,
  IDENTITY_KEY_RE,
} from "../../claude-session/identity-artifact-reader.js";
```

**Router + auth setup** (identity-archive.ts:55-60):
```typescript
const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

/** SSH connect timeout — matches sibling identity-no-dormancy.ts. */
const SSH_CONNECT_TIMEOUT_MS = 3000;
```

**Handler shape — hostId parse + regex gate + host resolve + LOCAL/REMOTE branch** (identity-archive.ts:76-158):
```typescript
router.post(
  "/:key/archive",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId (body).
    const rawHostId = (req.body as { hostId?: unknown } | undefined)?.hostId;
    if (rawHostId === undefined || rawHostId === null || rawHostId === "") {
      return res.status(400).json({ error: "hostId is required" });
    }
    const hostId =
      typeof rawHostId === "number" ? rawHostId : parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }

    // 2. Validate identity key via IDENTITY_KEY_RE.
    const key = String(req.params.key ?? "");
    if (!key || !IDENTITY_KEY_RE.test(key)) {
      return res.status(400).json({ error: "identity key must match [a-z0-9_-]{1,64}" });
    }

    // 3. Verify host ownership — 404 (NOT 403) on cross-user to avoid probe.
    const host = await resolveHostById(hostId, userId);
    if (!host) return res.status(404).json({ error: "Host not found" });

    // 4. LOCAL vs REMOTE branch on isLocalHostId(hostId).
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    if (!isLocalHostId(hostId)) {
      try {
        conn = await connectOneShot(host as unknown as Parameters<typeof connectOneShot>[0], SSH_CONNECT_TIMEOUT_MS);
      } catch {
        return res.status(504).json({ error: "Host unreachable" });
      }
    }

    // 5. Delegate to the artifact primitive with try/catch/finally.
    try {
      await writeIdentityFile(key, ".archive-requested", "", { hostId, conn });
      databaseLogger.info(`identity archive requested: userId=${userId}, hostId=${hostId}, key=${key}`);
      return res.json({ ok: true });
    } catch (err) {
      databaseLogger.error(`failed ... key=${key} hostId=${hostId}: ${err instanceof Error ? err.message : String(err)}`);
      return res.status(500).json({ error: "failed to drop archive sentinel" });
    } finally {
      if (conn) { try { conn.end(); } catch { /* ignore */ } }
    }
  },
);
```

**Adaptations for the new file:**
- Endpoint: `POST /:key/project` body `{hostId: number, project: string | null}`
- Instead of `writeIdentityFile(key, ".archive-requested", "", ...)`, call the new `writeSessionProjectField(conn, key, project)` from `identity-artifact-reader.ts` (see § "identity-artifact-reader extension" below)
- After successful write: `registry.publishProjectListChanged()` — see subscription-registry pattern
- Additionally validate `project` value: null OR string matching `PROJECT_SLUG_RE` (see § "PROJECT_SLUG_RE" below)
- Generic 500 fallback handler (identity-archive.ts:162-172) attached at bottom

---

### `src/backend/database/routes/project-list.ts` (route, request-response)

**Primary analog:** `src/backend/database/routes/runbooks-editor.ts` (slug-directory + fixed-sentinel + host isolation)
**Secondary analog:** `src/backend/database/routes/identity-archive.ts` (sentinel-drop + JSON body posture per D-36a)

**Slug regex + shellEscape gates** (runbooks-editor.ts:107-158):
```typescript
/** Runbook-name gate: alphanumeric, hyphen, underscore, dot; 1-128 chars. */
const RUNBOOK_NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;

// (For PROJECT_SLUG_RE we narrow to lowercase per D-04:)
// const PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/;

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

function isValidRunbookName(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v === "." || v === "..") return false;
  return RUNBOOK_NAME_RE.test(v);
}
```

**GET list — role-scope check + find + sort** (runbooks-editor.ts:251-386):
```typescript
router.get(
  "/runbooks",
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Parse + validate hostId.
    const rawHostId = req.query.hostId;
    if (rawHostId === undefined || rawHostId === "") {
      res.status(400).json({ error: "hostId is required" });
      return;
    }
    const hostId = parseInt(String(rawHostId), 10);
    if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    // ... regex gate on role/slug ...

    // 3. Per-user host isolation — 404 for cross-user / unknown hosts.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      conn = await connectOneShot(host as unknown as Parameters<typeof connectOneShot>[0], SSH_CONNECT_TIMEOUT_MS);
      // 5. Resolve $HOME (SFTP doesn't expand shell vars).
      const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
      // ...
      // 7. Existence check via `test -d ... && echo ok || echo missing`.
      const check = (await execWithTimeout(conn, `test -d ${escapedRoot} && echo ok || echo missing`)).trim();
      // 9. `find <root> -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null | sort`
      const output = await execWithTimeout(conn, listCmd);
      const items = output.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
      res.json({ items });
    } finally {
      if (conn) try { conn.end(); } catch { /* ignore */ }
    }
  },
);
```

**Adaptations for the new file:**
- Endpoints:
  - `GET /projects?hostId=<n>` → `{ projects: [{slug, displayName, archived: false}] }` — list `~/fleet/projects/` (excluding `archive/` subdir per D-30)
  - `POST /projects` body `{hostId, displayName}` — mint `~/fleet/projects/<slug>/project.md` per D-25 (with 409 duplicate-slug rejection). **JSON body per D-36a** (small sentinel-drop-shaped payload, no file uploads)
  - `POST /projects/:slug/archive` body `{hostId}` — move `~/fleet/projects/<slug>/` → `~/fleet/projects/archive/<slug>/` per D-30
- **Duplicate-slug rejection:** probe via `test -d <path>` before write; return 409 `{error: "slug exists"}` on hit
- **Slugify happens backend-side** per Pitfall 1: `displayName` in the body, backend derives + echoes back the slug
- After each successful write: `registry.publishProjectListChanged(hostId)` for the wire event

---

### `src/backend/database/routes/relay-room-project-tag.ts` (route, request-response)

**Analog:** `src/backend/database/routes/identity-archive.ts` (JWT + hostId + JSON body posture)

Reuses the same handler shape as `session-project-write.ts` (see above) but instead of the LOCAL/REMOTE SSH branch, calls into the new `matrix-room-tag-client.ts` (see below). Body: `{roomId: string, project: string | null}`. Endpoint: `POST /relay-rooms/:roomId/project`. No SSH connection — the Matrix HTTP client owns the read-modify-write cycle per D-05a.

---

### `src/backend/matrix/matrix-room-tag-client.ts` (service, request-response)

**Analog:** `src/backend/matrix/matrix-admin-client.ts`

**Fetch + AbortController + AdminOk/AdminErr wrapper** (matrix-admin-client.ts:1-125):
```typescript
import { databaseLogger } from "../utils/logger.js";
import { getMatrixAdminCreds } from "./matrix-admin-creds-store.js";

const REQUEST_TIMEOUT_MS = 30_000;
const ERR_CREDS_MISSING = "matrix_admin_creds_missing";
const ERR_NON_2XX = "admin_api_non_2xx";
const ERR_TIMEOUT = "admin_api_timeout";
const ERR_PROXY = "admin_api_proxy_error";

type AdminOk<T> = { ok: true } & T;
export type AdminErr = { ok: false; status: number; error: string };

export async function createOrUpdateUser(
  mxid: string,
  password: string,
  displayname?: string,
): Promise<CreateOrUpdateUserOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) return { ok: false, status: 500, error: ERR_CREDS_MISSING };

  const url = `${creds.homeserverBase}/_synapse/admin/v2/users/${encodeURIComponent(mxid)}`;
  const body: Record<string, unknown> = { password, admin: false, deactivated: false };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) return { ok: false, status: response.status, error: ERR_NON_2XX };
    return { ok: true, mxid, password, status: response.status };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, { operation: "matrix_admin_create_or_update_user" });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}
```

**Per-user token cache pattern for act-as-user calls** (matrix-admin-client.ts:1226-1288):
```typescript
const TOKEN_CACHE_TTL_MS = 60 * 60 * 1000;
interface CachedUserToken { token: string; expiresAt: number; }
const userTokenCache = new Map<string, CachedUserToken>();

async function ensureUserToken(mxid: string): Promise<{ ok: true; token: string } | AdminErr> {
  const now = Date.now();
  const cached = getCachedUserToken(mxid, now);
  if (cached !== null) return { ok: true, token: cached };
  const login = await loginAsUser(mxid, now + TOKEN_CACHE_TTL_MS);
  if (login.ok === false) return login;
  putCachedUserToken(mxid, login.accessToken, now);
  return { ok: true, token: login.accessToken };
}
```

**Adaptations for the new file — read-modify-write on `m.tag` per D-05a:**

Two new functions with the byte-shape above:

1. `getRoomTags(userMxid, roomId)` — `GET /_matrix/client/v3/user/{userId}/rooms/{roomId}/account_data/m.tag`
   - Uses `ensureUserToken(userMxid)` (loginAsUser flow, NOT admin token — tags are per-user)
   - Returns `{ok: true, tags: Record<string, unknown>} | AdminErr`
   - 404 from Matrix → `{ok: true, tags: {}}` (no tags is a valid state)

2. `setRoomProjectTag(userMxid, roomId, projectSlug: string | null)` — read-modify-write:
   - Step 1: call `getRoomTags(userMxid, roomId)` to fetch current `tags` blob (per D-05a step 1)
   - Step 2: preserve all non-project keys (per D-05a step 2)
   - Step 3: strip every key matching `/^u\.project\./` (single-project invariant per D-06 + D-05a step 3)
   - Step 4: if `projectSlug !== null`, set `newTags["u.project." + projectSlug] = {}` (per D-05a step 4)
   - Step 5: `PUT /_matrix/client/v3/user/{userId}/rooms/{roomId}/account_data/m.tag` body `{tags: newTags}` (per D-05a step 5)

**Path-traversal defense (matrix-admin-client.ts:1315-1316):**
```typescript
// encodeURIComponent on BOTH roomId AND txnId
```
Apply to userId AND roomId in the URL.

---

### `src/backend/claude-session/identity-artifact-reader.ts` (utility extension)

**Analog:** Self — extends the existing LOCAL/REMOTE branch pattern.

**LOCAL/REMOTE branch template** (identity-artifact-reader.ts:441-475):
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
  // REMOTE branch — patch #95: direct interpolation is safe because identityKey is
  // validated by IDENTITY_KEY_RE = /^[a-z0-9_-]{1,64}$/ — none of those characters
  // are shell-special inside double quotes.
  const cmd = `cat "$HOME/fleet/identities/${identityKey}/${identityKey}.md" 2>/dev/null || true`;
  const stdout = await execWithTimeout(conn, cmd);
  return { markdown: stdout };
}
```

**LOCAL/REMOTE list-directory template** (identity-artifact-reader.ts:506-540):
```typescript
export async function listIdentityKeysOnHost(conn: SSHClientType | null): Promise<string[]> {
  if (conn === null) {
    const root = getLocalIdentitiesRoot();
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(root, { withFileTypes: true });
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    return entries
      .filter((e) => e.isDirectory() && IDENTITY_KEY_RE.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  const cmd = `find "$HOME/fleet/identities" -mindepth 1 -maxdepth 1 -type d -printf '%f\\n' 2>/dev/null || true`;
  const stdout = await execWithTimeout(conn, cmd);
  return stdout.split("\n").map((l) => l.trim()).filter((n) => n.length > 0 && IDENTITY_KEY_RE.test(n)).sort();
}
```

**Atomic write template — writeMarkdownFileAtomic** (identity-artifact-reader.ts:1945-2073):
```typescript
export async function writeMarkdownFileAtomic(
  conn: SSHClientType | null,
  targetPath: string,
  contents: string,
): Promise<void> {
  const tmpPath = targetPath + ".tmp";
  const buf = Buffer.from(contents, "utf-8");

  if (conn === null) {
    // LOCAL branch: fs.writeFile(tmp) + fs.rename(tmp, final) — mode 0o644
    // Handles $HOME/ prefix via IDENTITIES_HOST_DIR + os.homedir fallback.
    // ... (see full :1968-2005 for $HOME resolution logic) ...
    await fs.writeFile(localTmpPath, buf, { mode: 0o644 });
    await fs.rename(localTmpPath, localPath);
    return;
  }

  // REMOTE branch: SFTP tmp+rename via ext_openssh_rename@openssh.com
  // (POSIX atomic-overwrite; plain sftp.rename EEXISTs on existing target
  //  per the 2026-08-02 patch #qrw incident).
  const sftp: SFTPWrapper = await new Promise<SFTPWrapper>((resolve, reject) => {
    conn.sftp((err, s) => { if (err) return reject(err); resolve(s); });
  });
  // ... resolve $HOME via sftp.realpath(".") if targetPath starts with $HOME/ ...
  try {
    await new Promise<void>((resolve, reject) => {
      sftp.writeFile(resolvedTmp, buf, { mode: 0o644 }, (err) => { if (err) return reject(err); resolve(); });
    });
    await new Promise<void>((resolve, reject) => {
      sftp.ext_openssh_rename(resolvedTmp, resolvedTarget, (err) => { if (err) return reject(err); resolve(); });
    });
  } catch (err) {
    sftp.unlink(resolvedTmp, () => {});  // best-effort cleanup
    throw err;
  } finally {
    sftp.end();
  }
}
```

**Full-round-trip frontmatter rewrite (per Pitfall 5 in RESEARCH.md § Common Pitfalls) — DO NOT go through `extractCosmeticsFromFrontmatter` (identity-artifact-reader.ts:2487) because it is field-narrowing and drops unknown keys.** Use RESEARCH.md § Code Examples `writeSessionProjectField` shape:

```typescript
export async function writeSessionProjectField(
  conn: SSHClientType | null,
  identityKey: string,
  projectSlug: string | null,   // null clears the field
): Promise<void> {
  if (!IDENTITY_KEY_RE.test(identityKey)) throw new Error("invalid identityKey");
  if (projectSlug !== null && !PROJECT_SLUG_RE.test(projectSlug)) {
    throw new Error("invalid project slug");
  }

  const { markdown } = await readIdentityFile(conn, identityKey);
  if (markdown.length === 0) throw new Error(`identity ${identityKey} file missing`);

  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error(`identity ${identityKey} has no frontmatter`);
  const [, frontmatterRaw, bodyAfter] = match;

  // Full yaml.load — preserves ALL fields (NOT the narrowing extractor).
  let parsed: Record<string, unknown>;
  try {
    parsed = (yaml.load(frontmatterRaw) as Record<string, unknown> | null) ?? {};
  } catch (err) {
    throw new Error(`identity ${identityKey} frontmatter parse failed: ${(err as Error).message}`);
  }

  // Mutate the ONE `project` key. Absent-⇒-omit: DELETE the key, don't emit null.
  if (projectSlug === null) delete parsed.project;
  else parsed.project = projectSlug;

  const yamlBody = yaml.dump(parsed, {
    sortKeys: false, lineWidth: -1, noRefs: true, forceQuotes: false,
  });

  const newContents = `---\n${yamlBody}---\n${bodyAfter}`;
  // Use the atomic writer from :1945 — routes LOCAL/REMOTE via conn===null.
  const targetPath = `$HOME/fleet/identities/${identityKey}/${identityKey}.md`;
  await writeMarkdownFileAtomic(conn, targetPath, newContents);
}
```

**Adaptations for new methods added to `identity-artifact-reader.ts`:**

1. `PROJECT_SLUG_RE` constant — mirror `IDENTITY_KEY_RE` at :175, narrower charset:
   ```typescript
   export const PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/;
   ```

2. `getLocalProjectsRoot(): string` — mirror `getLocalIdentitiesRoot` at :218:
   ```typescript
   export function getLocalProjectsRoot(): string {
     return process.env.PROJECTS_HOST_DIR || path.join(os.homedir(), "fleet", "projects");
   }
   ```

3. `readSessionProjectField(conn, key): Promise<string | null>` — mirrors `extractRoleFromMarkdown` at :280:
   - Read identity file, match frontmatter regex, `yaml.load`, extract `project` key
   - Return null if missing / non-string / empty

4. `writeSessionProjectField(conn, key, slug)` — full snippet above

5. `listProjects(conn): Promise<Array<{slug: string}>>` — mirrors `listIdentityKeysOnHost` at :506, root at `$HOME/fleet/projects` (excluding `archive/`):
   ```typescript
   // REMOTE find:
   `find "$HOME/fleet/projects" -mindepth 1 -maxdepth 1 -type d ! -name archive -printf '%f\\n' 2>/dev/null || true`
   ```

6. `readProjectFile(conn, slug): Promise<{markdown: string}>` — mirror `readIdentityFile` at :441, path `$HOME/fleet/projects/<slug>/project.md`

7. `createProject(conn, slug, displayName)` — mint the directory + write bare `project.md`:
   - REMOTE: `mkdir -p "$HOME/fleet/projects/<slug>"` via `execWithTimeout`; then `writeMarkdownFileAtomic(conn, "$HOME/fleet/projects/<slug>/project.md", body)`
   - LOCAL: `fs.mkdir(root, {recursive: true})` + `writeMarkdownFileAtomic(null, absPath, body)`
   - `body` shape uses `buildIdentityFileBody`-style YAML emit (see § "Shared Patterns — YAML frontmatter emit")

8. `archiveProject(conn, slug)` — move directory:
   - REMOTE: `mkdir -p "$HOME/fleet/projects/archive" && mv "$HOME/fleet/projects/<slug>" "$HOME/fleet/projects/archive/<slug>"` via `execWithTimeout`
   - LOCAL: `fs.mkdir(archiveRoot, {recursive: true})` + `fs.rename(src, dest)`

---

### `src/backend/fleet-status/wire-protocol.ts` (config extension)

**Analog:** Self — extends the `FrontendIdentityArchivedFrameSchema` pattern.

**Frame schema template** (wire-protocol.ts:577-591):
```typescript
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
  FrontendIdentityArchivedFrameSchema,
]);
```

**Frame-builder helper template** (wire-protocol.ts:632-644):
```typescript
export function makeIdentityArchivedFrame(
  name: string,
  hostId: string,
  hostname: string,
): FrontendOutboundFrameType {
  return {
    schemaVersion: FRAME_SCHEMA_VERSION,
    type: "identity-archived",
    name,
    hostId,
    hostname,
  };
}
```

**Adaptations for the new frame:**

Per D-37 + RESEARCH.md § Open Questions #4 (full-array-on-every-emit):

```typescript
// New schema after FrontendIdentityArchivedFrameSchema
const FrontendProjectListChangedFrameSchema = z.object({
  schemaVersion: z.literal(FRAME_SCHEMA_VERSION),
  type: z.literal("project-list-changed"),
  projects: z.array(z.object({
    slug: z.string(),
    displayName: z.string(),
    hostId: z.string(),
    hostname: z.string(),
    archived: z.boolean(),
  })),
});

// Append to the discriminatedUnion — FRAME_SCHEMA_VERSION HELD AT 1 (additive, forward-compatible)
export const FrontendOutboundFrame = z.discriminatedUnion("type", [
  FrontendSnapshotFrameSchema,
  FrontendUpdateFrameSchema,
  FrontendGoneFrameSchema,
  FrontendPongFrameSchema,
  FrontendIdentityArchivedFrameSchema,
  FrontendProjectListChangedFrameSchema,  // new
]);

export function makeProjectListChangedFrame(
  projects: Array<{slug: string; displayName: string; hostId: string; hostname: string; archived: boolean}>,
): FrontendOutboundFrameType {
  return {
    schemaVersion: FRAME_SCHEMA_VERSION,
    type: "project-list-changed",
    projects,
  };
}
```

Header comment block (mirror the rationale block at wire-protocol.ts:544-575 for why a distinct frame kind is used vs bolting onto SessionState).

---

### `src/backend/fleet-status/subscription-registry.ts` (service extension)

**Analog:** Self — extends `publishIdentityArchived` + `archivedIdentities` cache pattern.

**Registry interface method template** (subscription-registry.ts:52-65):
```typescript
/**
 * Phase 115 Plan 115-06 (D-06, D-18): publish an `identity-archived`
 * frame ... Snapshot-on-subscribe behavior: archived rows are re-emitted
 * on every subscribe via the archivedIdentities map maintained here.
 */
publishIdentityArchived(
  name: string,
  hostId: string,
  hostname: string,
): void;
```

**Cache map + idempotent publish template** (subscription-registry.ts:175-178, 292-312):
```typescript
const archivedIdentities = new Map<
  string,
  { name: string; hostId: string; hostname: string }
>();

// ...

publishIdentityArchived(name, hostId, hostname): void {
  const key = `${hostId}::${name}`;
  const existing = archivedIdentities.get(key);
  // Idempotent: no fanout if byte-identical to cache.
  if (existing !== undefined &&
      existing.name === name && existing.hostId === hostId && existing.hostname === hostname) {
    return;
  }
  archivedIdentities.set(key, { name, hostId, hostname });
  fanOut(subscribers, makeIdentityArchivedFrame(name, hostId, hostname));
},
```

**Snapshot-on-subscribe replay template** (subscription-registry.ts:210-230):
```typescript
// Re-emit every archived identity as an `identity-archived` frame so a
// reconnecting client re-hydrates from the registry's cached map.
for (const entry of archivedIdentities.values()) {
  try {
    sendFrame(makeIdentityArchivedFrame(entry.name, entry.hostId, entry.hostname));
  } catch (err) {
    systemLogger.warn("...", { operation: "...", error: err instanceof Error ? err.message : "unknown" });
  }
}
```

**Adaptations for the new methods:**

Add:
- `publishProjectListChanged(projects: Array<...>): void` — replaces the entire cached projects array on every write (per D-37 + RESEARCH § Open Q #4 "full array on every emit"). Idempotent: if the array is byte-equal to the cached one, no fanout.
- Cache field: `let projectListCache: Array<{slug, displayName, hostId, hostname, archived}> | null = null` (single-cell cache — the whole array replaces on every publish).
- Subscribe replay: after archived-identities loop, if `projectListCache !== null`, `sendFrame(makeProjectListChangedFrame(projectListCache))`.

---

### `src/ui/api/session-project-api.ts` (api client, request-response)

**Analog:** `src/ui/api/identity-archive-api.ts` (byte-shape mirror)

**Full file template** (identity-archive-api.ts:1-33):
```typescript
import { authApi, handleApiError } from "@/main-axios";

// ─── Phase 115 Plan 115-06 (D-07 / D-08 / D-17) — archiveIdentity ───────────
//
// One-shot POST that drops the `.archive-requested` intent sentinel on the
// identity's home host. The backend route (115-03) handles the fanout via
// writeIdentityFile; this frontend helper is a thin fetch wrapper mirroring
// the sibling identities-api.ts shape.
//
// Endpoint:  POST /identities/:key/archive
// Body:      { hostId: number }
// Response:  { ok: true }
//
// Errors are surfaced through handleApiError (main-axios.ts) so the caller
// sees the same ApiError / message shape every other API surface produces.

export async function archiveIdentity(
  hostId: number,
  identityKey: string,
): Promise<{ ok: true }> {
  try {
    const url = `/identities/${encodeURIComponent(identityKey)}/archive`;
    const response = await authApi.post(url, { hostId });
    return response.data as { ok: true };
  } catch (error) {
    handleApiError(error, "archive identity");
  }
}
```

**Adaptations for the new file:**

```typescript
export async function setSessionProject(
  hostId: number,
  identityKey: string,
  projectSlug: string | null,
): Promise<{ ok: true }> {
  try {
    const url = `/identities/${encodeURIComponent(identityKey)}/project`;
    const response = await authApi.post(url, { hostId, project: projectSlug });
    return response.data as { ok: true };
  } catch (error) {
    handleApiError(error, "set session project");
  }
}
```

Plus a `setRelayRoomProject(roomId, projectSlug)` sibling for the Matrix path.

---

### `src/ui/api/project-list-api.ts` (api client, request-response)

**Analog:** `src/ui/api/identity-archive-api.ts` (thin fetch wrapper style)

**Adaptations — three fetch wrappers, all following the byte-shape template above:**

```typescript
export async function listProjects(hostId: number): Promise<{ projects: ProjectSummary[] }> {
  try {
    const response = await authApi.get(`/projects?hostId=${encodeURIComponent(String(hostId))}`);
    return response.data as { projects: ProjectSummary[] };
  } catch (error) {
    handleApiError(error, "list projects");
  }
}

export async function createProject(hostId: number, displayName: string): Promise<{ ok: true; slug: string }> {
  try {
    const response = await authApi.post("/projects", { hostId, displayName });
    return response.data as { ok: true; slug: string };
  } catch (error) {
    handleApiError(error, "create project");
  }
}

export async function archiveProject(hostId: number, slug: string): Promise<{ ok: true }> {
  try {
    const url = `/projects/${encodeURIComponent(slug)}/archive`;
    const response = await authApi.post(url, { hostId });
    return response.data as { ok: true };
  } catch (error) {
    handleApiError(error, "archive project");
  }
}
```

Cascade caller wraps `Promise.all(members.map(m => archiveIdentity(m.hostId, m.identityKey)))` before `archiveProject` per RESEARCH § Open Q #3 recommendation.

---

### `src/ui/api/fleet-status-client.ts` (extension)

**Analog:** Self — extend the `switch (parsed.type)` dispatcher.

**Optional callback template + dispatch template** (fleet-status-client.ts:71-82, 216-231):
```typescript
// In FleetStatusClientOptions:
onIdentityArchived?: (
  name: string,
  hostId: string,
  hostname: string,
) => void;

// In switch:
case "identity-archived":
  console.info({
    operation: "fleet_status_client_identity_archived",
    url,
    hostId: parsed.hostId,
    name: parsed.name,
  });
  onIdentityArchived?.(parsed.name, parsed.hostId, parsed.hostname);
  break;
```

**Adaptations:**
- Add `onProjectListChanged?: (projects: ProjectRow[]) => void` to options
- Add `case "project-list-changed":` in the switch with the same structured `console.info` shape then `onProjectListChanged?.(parsed.projects)`

---

### `src/ui/state/conversation-store.ts` (extension)

**Analog:** Self — extend `archivedFleetRows` slice pattern verbatim.

**Slice type + initial state template** (conversation-store.ts:391-432):
```typescript
export type ArchivedFleetRow = {
  hostId: number;
  name: string;
  hostname: string;
};

// In State type:
archivedFleetRows: ArchivedFleetRow[];

// In state init:
archivedFleetRows: [],
```

**Setter + hook template** (conversation-store.ts:1903-1967):
```typescript
export function setArchivedFleetRows(rows: ArchivedFleetRow[]): void {
  // Identity-equal skip: if same length AND every entry is field-equal, no mutation.
  const cur = state.archivedFleetRows;
  if (rows.length === cur.length) {
    let equal = true;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].hostId !== cur[i].hostId || rows[i].name !== cur[i].name || rows[i].hostname !== cur[i].hostname) {
        equal = false;
        break;
      }
    }
    if (equal) return;
  }
  state = { ...state, archivedFleetRows: rows.slice() };
  notify();
}

export function upsertArchivedFleetRow(row: ArchivedFleetRow): void {
  const cur = state.archivedFleetRows;
  const idx = cur.findIndex((r) => r.hostId === row.hostId && r.name === row.name);
  const next = cur.slice();
  if (idx >= 0) {
    if (cur[idx].hostname === row.hostname && cur[idx].name === row.name && cur[idx].hostId === row.hostId) {
      return;  // identity-equal no-op
    }
    next[idx] = row;
  } else {
    next.push(row);
  }
  state = { ...state, archivedFleetRows: next };
  notify();
}

function getArchivedFleetRowsSnapshot(): readonly ArchivedFleetRow[] {
  return state.archivedFleetRows;
}

export function useArchivedFleetRows(): readonly ArchivedFleetRow[] {
  return useSyncExternalStore(subscribe, getArchivedFleetRowsSnapshot, getArchivedFleetRowsSnapshot);
}
```

**Adaptations for the new slice:**
- `ProjectRow` type: `{slug, displayName, hostId, hostname, archived: boolean}`
- Setter: `setProjects(rows: ProjectRow[])` — full-array replace with identity-equal skip (backend authoritative per D-37 wire event)
- Hook: `useProjects(): readonly ProjectRow[]`
- **Derived-selector extension** in the panel-consumed snapshot builder: given `useConversations()` + `usePinnedIds()` + `useProjects()`, produce `{pinned, projectBuckets: Map<slug, Row[]>, middle, rdp}` — see D-39. Attach the derived-selector into the existing snapshot memo path (`computeSnapshot` around :1028; snapshotVersion bumps on `setProjects` calls).

---

### `src/ui/state/use-collapsed-project-slugs.ts` (NEW hook, file-I/O to localStorage)

**Analog:** `src/ui/state/conversation-store.ts` `hydrateActiveSetFromStorage` at :270

**localStorage hydrate pattern** (conversation-store.ts around :270):
```typescript
const ACTIVE_SET_STORAGE_KEY = "pv-conv-active-set";

function hydrateActiveSetFromStorage(): Set<string> {
  try {
    const raw = window.localStorage.getItem(ACTIVE_SET_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();  // silent on private-mode / quota-exceeded
  }
}
```

**Adaptations for the new hook:**

```typescript
const COLLAPSED_PROJECT_SLUGS_STORAGE_KEY = "pv-collapsed-project-slugs";

function hydrateFromStorage(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_PROJECT_SLUGS_STORAGE_KEY);
    if (raw === null) return new Set();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v): v is string => typeof v === "string"));
  } catch {
    return new Set();
  }
}

function persistToStorage(slugs: Set<string>): void {
  try {
    window.localStorage.setItem(COLLAPSED_PROJECT_SLUGS_STORAGE_KEY, JSON.stringify([...slugs]));
  } catch {
    /* silent */
  }
}

export function useCollapsedProjectSlugs(): {
  collapsed: ReadonlySet<string>;
  toggle: (slug: string) => void;
} {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => hydrateFromStorage());
  const toggle = useCallback((slug: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug); else next.add(slug);
      persistToStorage(next);
      return next;
    });
  }, []);
  return { collapsed, toggle };
}
```

Silent try/catch on all reads/writes per RESEARCH § Don't Hand-Roll table entry ("mobile Safari private mode").

---

### `src/ui/features/pretty-conversations/PrettyProjectSectionHeader.tsx` (NEW component)

**Primary analog:** Panel's existing Archived section render at `PrettyConversationsPanel.tsx:1995-2033`
**Secondary analog:** `CollapsedPanelCloseLane.tsx` — coral-hover-only, no baseline coral, drop-lane discipline

**Header row template** (PrettyConversationsPanel.tsx:1995-2020):
```typescript
{archivedRows.length > 0 && (
  <div className="pv-panel-group pv-archived-section">
    <button
      type="button"
      onClick={() => setArchivedExpanded((v) => !v)}
      className="flex items-center gap-2 px-4 pt-3 pb-1.5 w-full text-left"
      data-testid="pretty-conversations-archived-header"
      aria-expanded={archivedExpanded}
      aria-controls="pv-archived-section-content"
    >
      <Archive className="size-3 text-[#5c6070]/85 shrink-0" aria-hidden="true" />
      <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">
        Archived
      </span>
      <span aria-hidden="true"
        className="flex-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]" />
      <ChevronDown
        className={`size-3 text-[#5c6070]/85 shrink-0 transition-transform ${archivedExpanded ? "rotate-180" : ""}`}
        aria-hidden="true"
      />
    </button>
    {archivedExpanded && (
      <div id="pv-archived-section-content">
        {archivedRows.map((r) => ( <PrettyArchivedRow ... /> ))}
      </div>
    )}
  </div>
)}
```

**Coral overlay drop lane — hover-only, no baseline** (CollapsedPanelCloseLane.tsx:147-179, PrettyConversationsPanel.tsx:1636-1647):
```typescript
// State
const [isDragOver, setIsDragOver] = useState(false);

// dragover — TYPE-GATE FIRST on application/x-skynet-row (NOT badge)
const onDragOver = (e: React.DragEvent<HTMLDivElement>) => {
  const types = e.dataTransfer?.types;
  if (!(types && Array.from(types).indexOf("application/x-skynet-row") !== -1)) return;
  e.preventDefault();
  e.stopPropagation();  // prevents outer panel handler from also firing
  setIsDragOver(true);
};

// dragleave — bounding-rect stateless guard against child crossings
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

// window-level dragend for Escape-cancel path
useEffect(() => {
  const onDragEnd = () => setIsDragOver(false);
  window.addEventListener("dragend", onDragEnd);
  return () => window.removeEventListener("dragend", onDragEnd);
}, []);

// Overlay — verbatim palette
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
```

**Drop handler — payload extraction + terminal-refuse gate** (CollapsedPanelCloseLane.tsx:181-224 + D-08):
```typescript
const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
  setIsDragOver(false);
  const raw = e.dataTransfer?.getData("application/x-skynet-row") ?? "";
  if (raw === "") return;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return; }
  if (parsed === null || typeof parsed !== "object") return;
  const p = parsed as { id?: string; host?: number | null; targetTmuxSession?: string | null; rdpHostRow?: boolean };
  if (p.rdpHostRow === true) return;   // D-08: refuse terminals
  if (typeof p.id !== "string" || p.id.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  console.info(`[project-drop] slug=${slug} rowId=${p.id}`);
  onDropRow(slug, p.id, p);  // upstream writes project: <slug>
};
```

**Adaptations:**
- Header text: `Project: {displayName}` (literal "Project:" prefix per Specific Ideas)
- Icon: `FolderOpen` from lucide-react (Claude's Discretion pick from CONTEXT)
- Small new-conversation button on the right, mirroring `SquarePen` header icon at :1711
- `data-project-slug={slug}` attribute for testability
- Wrap outer div with `isolation: isolate` (CollapsedPanelCloseLane.tsx:40)

---

### `src/ui/features/pretty-conversations/CreateProjectModal.tsx` (NEW component)

**Analog:** `src/ui/features/pretty-conversations/NewConversationModal.tsx`

**Modal shape** (NewConversationModal.tsx:65-72):
```typescript
export function NewConversationModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: CreateRelayRoomResponse) => void;
}) {
  // ...
}
```

**Adaptations:**
- Props: `{open, onOpenChange, onCreated: (result: {slug: string, displayName: string}) => void, hostId: number}`
- Single text input for `displayName`
- Submit calls `createProject(hostId, displayName)` from `project-list-api.ts`
- On 409 duplicate-slug: display inline error, keep modal open
- On success: `onCreated({slug: response.slug, displayName})`, close modal
- No client-side slug preview per D-26 — backend is slugify authority (Pitfall 1)

---

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (extension)

**Analog:** Self — extends the existing three-zone layout by inserting project sections between pinned zone and flat middle.

**Existing three-zone snapshot render + Archived section render** at :1616-2033 is the insertion point. The projects zone slots BETWEEN the pinned section and the flat middle per D-09.

**Header button integration point** at :1701-1745 (the pencil/drama/globe/kebab cluster) — add `<button aria-label="Create project" onClick={() => setCreateProjectModalOpen(true)}><FolderOpen size={18} /></button>` per Claude's Discretion.

**Coral overlay pattern to reuse verbatim** at :1636-1647 (single-source verbatim palette) — but move it from panel-scope to per-section scope in the project section header component (see previous section).

**Drop-handler pattern for the flat-middle "clear project" gesture (D-22 gesture #2):** attach an outer drop listener to the flat-middle container. When a row is dropped there AND the row is currently in a project, call `setSessionProject(hostId, key, null)` to clear the frontmatter field.

**Type-gate discipline** (PrettyConversationsPanel.tsx:1512-1530 + CollapsedPanelCloseLane.tsx:152): project drop lanes MUST type-gate on `application/x-skynet-row` ONLY. Row drags + OS file drags + badge drags all fall through with no `preventDefault` unless the exact MIME is present.

---

### `src/ui/AppShell.tsx` (extension)

**Analog:** Self — extend the `createFleetStatusClient` options object.

**Wiring template** (AppShell.tsx:626-660):
```typescript
const client = createFleetStatusClient({
  url: fleetStatusUrl,
  onSnapshot: (states) => { /* ... */ },
  onUpdate: (fleetState) => { /* ... */ },
  onIdentityArchived: (name, hostIdRaw, hostname) => {
    const hostIdNum = parseInt(hostIdRaw, 10);
    if (!Number.isFinite(hostIdNum)) return;
    upsertArchivedFleetRow({ hostId: hostIdNum, name, hostname });
  },
  onGone: (hostId, tmuxSession, sessionId) => { /* ... */ },
});
```

**Adaptations:**
- Import `setProjects` from `@/state/conversation-store`
- Add `onProjectListChanged: (projects) => setProjects(projects)` to the options

---

### `substrate/skills/id/SKILL.md` (body edit — one insertion)

**Insertion point:** § 2 "Loading an existing identity", between existing step 3 (line ~205) and existing step 4 (line ~207).

**Text of new step 4** (draft from RESEARCH.md § id-skill Amendment Draft):
```markdown
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
```

Existing step 4 (runbooks) becomes step 5. Steps in the coordinator-mode block at :230-236 do NOT change (coordinators skip role-file-load per D-32 note).

**No `catalog.ts` change** — SKILL.md is already a 4-row catalog entry at `src/backend/distributor/catalog.ts:216-244`; the distributor's byte-compare sweep picks up the body edit automatically on next tick.

---

### Test file assignments

**`src/backend/database/routes/identity-archive.test.ts`** at :180-247 is the template for all new route tests. Full pattern:

```typescript
// Rebuild app per test
const app = express();
app.use(express.json());
app.use("/identities", router);
server = http.createServer(app);
server.listen(0);
```

Per-test happy LOCAL / happy REMOTE / bad hostId / unknown host / SSH-fail patterns at :229-...  (see file for full test coverage).

**vi.mock() targets** for the new route tests:
- `../../ssh/host-resolver.js` (for `resolveHostById`)
- `../../ssh/ssh-one-shot.js` (for `connectOneShot`)
- `../../claude-session/identity-artifact-reader.js` (for `isLocalHostId`, `writeSessionProjectField`, `listProjects`, `createProject`, `archiveProject`)
- `../fleet-status/subscription-registry.js` (for `publishProjectListChanged`)

---

## Shared Patterns

### Authentication (JWT middleware on every route)

**Source:** `src/backend/database/routes/identity-archive.ts:56-57` (via `AuthManager.getInstance().createAuthMiddleware()`)
**Apply to:** `project-list.ts`, `session-project-write.ts`, `relay-room-project-tag.ts`

```typescript
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
// ...
router.post("/:key/archive", authenticateJWT, async (req, res) => { ... });
```

### Host isolation gate — 404-not-403 on cross-user

**Source:** `src/backend/database/routes/identity-archive.ts:105-111`
**Apply to:** every project route that takes a `hostId` (all of `project-list.ts` + `session-project-write.ts`)

```typescript
const host = await resolveHostById(hostId, userId);
if (!host) {
  return res.status(404).json({ error: "Host not found" });
}
```

**Rationale (verbatim from identity-archive.ts:105-107):** 404 (not 403) on cross-user / unknown hostId → prevents probe distinguisher.

### YAML frontmatter emit — absent-⇒-omit invariant

**Source:** `src/backend/database/routes/identity-birth-orchestrator.ts:495-586`
**Apply to:** `identity-artifact-reader.ts` new methods `createProject` (writing `project.md` bare frontmatter) and `writeSessionProjectField` (rewriting identity file frontmatter)

```typescript
const pairs: Array<[string, string | number]> = [];
pairs.push(["displayName", displayName]);
// project: skip if null / undefined (absent-⇒-omit — DELETE the key, don't emit null)

const yamlBody = yaml.dump(
  stringifyColorHueForYaml(Object.fromEntries(pairs)),
  {
    sortKeys: false,       // preserve insertion order
    lineWidth: -1,         // no wrapping
    noRefs: true,          // no & anchors
    forceQuotes: false,    // yaml.dump auto-quotes colons/newlines
  },
);
return `---\n${yamlBody}---\n\n`;  // empty body per D-25
```

**Anti-pattern:** never call `extractCosmeticsFromFrontmatter` (identity-artifact-reader.ts:2487) on the frontmatter round-trip — it is field-narrowing and drops any keys not in the 7-key allowlist (`role`, `project`, and user-added fields would all be silently lost — see RESEARCH § Common Pitfalls #5).

### Slug + shell safety gate

**Source:** `src/backend/database/routes/runbooks-editor.ts:107-158` + `src/backend/claude-session/identity-artifact-reader.ts:175`
**Apply to:** all new backend files handling project slugs

```typescript
// New constant in identity-artifact-reader.ts
export const PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/;  // per D-04 kebab-case-lowercase

// Runtime gate (mirrors isValidRunbookName pattern)
function isValidProjectSlug(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v === "." || v === "..") return false;
  return PROJECT_SLUG_RE.test(v);
}

// Shell single-quote escape for interpolation (identity-artifact-reader.ts:357-359)
function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}
```

Both gates fire BEFORE resolveHostById + SSH connect. Belt-and-suspenders `absPath.startsWith(projectsRoot + "/")` post-compose assertion (runbooks-editor.ts:49-51) is dead code in the normal path but defensive.

### Atomic file write

**Source:** `src/backend/claude-session/identity-artifact-reader.ts:1945` `writeMarkdownFileAtomic`
**Apply to:** every new file write path (creating `project.md`, rewriting identity file frontmatter for `project:` field, moving archive)

Reuse verbatim — LOCAL routes to fs.writeFile + fs.rename; REMOTE routes to SFTP + `ext_openssh_rename@openssh.com`. Do NOT hand-roll SFTP rename semantics — the plain `sftp.rename` has an EEXIST trap on existing targets (see :1930-1943 for the 2026-08-02 patch qrw incident).

### Wire event registry publish — idempotent + snapshot-on-subscribe

**Source:** `src/backend/fleet-status/subscription-registry.ts:292-312` (publish) + :210-230 (snapshot replay)
**Apply to:** `publishProjectListChanged` extension

Byte-identity-equal skip prevents per-tick churn; snapshot-on-subscribe re-emits the cached state so reconnecting clients rehydrate without a round-trip.

### DnD wire contract type-gate

**Source:** `src/ui/shell/CollapsedPanelCloseLane.tsx:147-179` + `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:1512-1555`
**Apply to:** every project drop lane

- Type-gate on `application/x-skynet-row` FIRST (before preventDefault)
- Row drags + badge drags (`application/x-skynet-badge`) + OS file drags all fall through unless the exact MIME is present
- Bounding-rect stateless dragleave guard against child boundary crossings
- Window-level `dragend` listener for Escape-cancel (Escape doesn't fire dragleave)
- Verbatim palette: `rgba(255, 184, 150, 0.22)` bg / `rgba(255, 184, 150, 0.60)` border / `zIndex: 30`
- `isolation: isolate` on outer wrapper to sandbox z-index

### Error handling — generic 500 to client, server-side detailed log

**Source:** `src/backend/database/routes/identity-archive.ts:141-148` + `:162-172`
**Apply to:** all new backend routes

```typescript
} catch (err) {
  databaseLogger.error(
    `failed to <op> for key=${key} hostId=${hostId}: ${err instanceof Error ? err.message : String(err)}`,
  );
  return res.status(500).json({ error: "failed to <op>" });  // FIXED shape, no err.message leak
}

// Generic 500 fallback at bottom of file:
router.use((err: Error, _req, res, _next) => {
  return res.status(500).json({ error: err?.message ?? "route error" });
});
```

### Frontend API client shape — `handleApiError` uniform surface

**Source:** `src/ui/api/identity-archive-api.ts:24-32`
**Apply to:** `project-list-api.ts`, `session-project-api.ts`

```typescript
try {
  const response = await authApi.<method>(url, body);
  return response.data as SuccessType;
} catch (error) {
  handleApiError(error, "<operation>");
}
```

### localStorage silent try/catch

**Source:** `src/ui/state/conversation-store.ts:270` (`hydrateActiveSetFromStorage`)
**Apply to:** `use-collapsed-project-slugs.ts`

Wrap every read + write in try/catch — mobile Safari private mode + quota-exceeded browsers make localStorage throw. Empty-set fallback is correct.

### DatabaseSaveTrigger.forceSave (defensive per D-38)

**Source:** RESEARCH § Standard Stack table row for `DatabaseSaveTrigger.forceSave(reason)`
**Apply to:** every project write path (defensively — projects live on disk under `~/fleet/`, but D-38 mandates unconditional save-trigger)

```typescript
import { DatabaseSaveTrigger } from "../db/index.js";
// ... after each successful write:
await DatabaseSaveTrigger.forceSave("project state changed");
```

Per RESEARCH Assumption A4: probably not strictly needed since projects live on disk not in the in-memory DB — but D-38 recommends unconditional. Cheap to add; add it after each write path.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/backend/matrix/matrix-room-tag-client.ts` | service (account_data GET/PUT) | request-response | No existing code path calls `/user/{userId}/rooms/{roomId}/account_data/m.tag`. Grep `account_data` and `m.tag` in `src/backend/matrix/*.ts` returned zero hits. The file extends `matrix-admin-client.ts`'s fetch shape (verbatim: AbortController + AdminOk/AdminErr + `encodeURIComponent` + `ensureUserToken` cache) rather than copying an account_data analog. |

**One partial gap:** `matrix-room-tag-client.ts` should reuse the `ensureUserToken`/`loginAsUser` machinery from `matrix-admin-client.ts:1226-1288` because `m.tag` is a **per-user** account_data event (tags belong to the acting user, not the admin). Per matrix-admin-client.ts:1290-1300's `sendMessageAsUser` precedent, the tag write must go via a user-scoped token, not the admin token — otherwise the tag would attach to `@skynet-admin`'s account_data, not the user's. See the `senderMxid` extract for the "act as user" discipline.

---

## Metadata

**Analog search scope:**
- `src/backend/database/routes/` — 40+ route files scanned; runbooks-editor + identity-archive selected as closest structural mirrors
- `src/backend/claude-session/` — identity-artifact-reader.ts (4533 LOC) + per-identity-file.ts scanned; both extend for the new methods
- `src/backend/fleet-status/` — wire-protocol.ts + subscription-registry.ts scanned; Phase 115 identity-archived frame at :544-644 is the byte-shape mirror
- `src/backend/matrix/` — matrix-admin-client.ts (1785 LOC) scanned for account_data patterns; none found — extension needed
- `src/ui/api/` — identity-archive-api.ts + fleet-status-client.ts scanned
- `src/ui/state/` — conversation-store.ts (2000+ LOC) scanned; archived-rows slice + localStorage hydrate patterns extracted
- `src/ui/features/pretty-conversations/` — PrettyConversationsPanel.tsx (2100+ LOC), PrettyArchivedRow, PrettyConversationRow, NewConversationModal scanned
- `src/ui/shell/CollapsedPanelCloseLane.tsx` scanned for coral-hover-only drop-lane discipline
- `substrate/skills/id/SKILL.md` (941 lines) scanned for insertion point

**Pattern extraction date:** 2026-09-18

**Files scanned:** ~15 primary analog files, plus grep passes across 100+ files for pattern verification.

**Ranking rationale:**
1. Phase 115's identity-archive stack is the byte-shape template for the archive-cascade + wire event + store slice patterns (RESEARCH primary recommendation)
2. `runbooks-editor.ts` is the parallel for slug-directory + fixed-sentinel filename storage
3. `identity-artifact-reader.ts` has LOCAL/REMOTE branch discipline, atomic writes, YAML dump helpers — all reused
4. `CollapsedPanelCloseLane.tsx` is the canonical hover-only-no-baseline drop lane pattern for the coral overlay per D-23
5. `matrix-admin-client.ts` is the Matrix HTTP client the new m.tag account_data layer extends
