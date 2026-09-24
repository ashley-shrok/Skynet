# Phase 134: wake-ups-redesign campaign shape 2 (CRUD API) — Pattern Map

**Mapped:** 2026-09-21
**Files analyzed:** 15 (2-3 NEW + 8 MODIFIED + 4 DELETED + 2 SURGICAL-EDIT)
**Analogs found:** 15 / 15 (every new/modified file has a strong in-repo analog)

Every recommendation below is grounded in an existing file at a known line range. Excerpts are copy-paste-adapt targets — the planner references them by file:line so plan tasks can quote the exact bytes to mirror.

## File Classification

### NEW files (created this phase)

| New file (recommended) | Role | Data flow | Closest analog | Match quality |
|-------------------------|------|-----------|----------------|---------------|
| `src/backend/database/routes/wakeups-list.ts` | route (Express router, JWT-gated GET) | request-response — fleet-wide SSH fan-out, aggregated JSON | `src/backend/database/routes/conversation-search.ts` (fleet fan-out) + `src/backend/database/routes/roles-list-for-host.ts` (per-host SSH read + delimiter batching + JWT/hostId gate) | exact (fan-out) + exact (per-host delimiter batching) |
| `src/backend/database/routes/wakeups-write.ts` | route (Express router, JWT-gated POST/PATCH/DELETE) | request-response — per-host atomic write over SSH | `src/backend/database/routes/roles-create.ts` (JWT + resolveHostById + `getHostSemaphore(hostId).run(...)` + connectOneShot + `writeMarkdownFileAtomic` + collision probe + 502-on-SSH-fail) | exact |
| `src/backend/database/routes/wakeups-list.test.ts` | test (vitest, bare Express app, mocked SSH primitives) | request-response HTTP integration test | `src/backend/database/routes/roles-list-for-host.test.ts` (10-case coverage: 400/404/happy/empty/timeout/auth) | exact |
| `src/backend/database/routes/wakeups-write.test.ts` | test | request-response HTTP integration test | `src/backend/database/routes/roles-create.test.ts` (400/404/409/happy/atomic-write/auth) | exact |
| **Optional helper**: `getLocalWakeupsRoot()` inside `src/backend/claude-session/identity-artifact-reader.ts` | utility (path helper) | pure function — derives `<fleetRoot>/wakeups` | `getLocalIdentitiesRoot()` L276-288, `getLocalRolesRoot()` L288-304 in same file (both HOME_HOST_DIR-derived) | exact |

**Nginx location blocks** (paired, D-17) — additions inline in existing files, not new files:
- `docker/nginx.conf` — insert `location ~ ^/wakeups(/.*)?$` block near L440 (mirror `/roles` block L440-449)
- `docker/nginx-https.conf` — insert matching block near L455 (mirror `/roles` block L455-464)

**Router mount** (single new line, not a new file):
- `src/backend/database/database.ts` L2010-2015 pattern — chain `app.use("/wakeups", wakeupsListRoutes)` then `app.use("/wakeups", wakeupsWriteRoutes)` alongside the existing `/roles` chain, positioned BEFORE the `/identities` late catch-alls (line ~2015-2020 range).

### MODIFIED files (surgical deletions this phase)

| Modified file | Role | Change type | Analog (for what stays) |
|---------------|------|-------------|--------------------------|
| `src/backend/claude-session/identity-artifact-reader.ts` | service (SSH artifact reader + writer helpers) | **Remove** 6 exported functions per D-10; the file's other exports STAY unchanged | Same file — mirror-shape helpers stay live (`readIdentityWakeups` L1434, `writeIdentityWakeupCreate` L2359, `writeIdentityWakeupDelete` L2437, `writeIdentityWakeupUpdate` L2003, `humanizeWakeupSchedule` L116, `IDENTITY_SLUG_RE` L1431, `normalizeWakeupSlug` L2183, `writeMarkdownFileAtomic` L2583) |
| `src/backend/claude-session/claude-session-server.ts` | service (WebSocket wire-op dispatcher) | **Remove** 8 wire-op handlers + response types + wire-op JSDoc entries per D-11 | Same file — per-identity wake-up handlers (identity:list-wakeups, identity:update-wakeup, identity:create-wakeup, identity:delete-wakeup) STAY |
| `src/ui/api/claude-session-api.ts` | API surface (frontend WS client helpers) | **Remove** 5 role-wakeup helpers + their payload/event types per D-12; `WakeupSpecWire` L729 STAYS | Same file — per-identity wake-up helpers stay; the removed helpers L1499-1725 mirror the removed WS handlers 1:1 |
| `src/ui/features/pretty-view/RoleModal.tsx` | component (React modal with tabs) | **Remove** role-wakeups tab entry + state + effect + callbacks + imports per D-09 | Same file — role/runbooks/bounties tabs STAY; the deletions are surgical |
| `src/backend/database/database.ts` | config (Express app bootstrap) | **Add** two `app.use("/wakeups", ...)` chain mounts near L2010-2015 | Same file L2010-2015 (`/roles` chain) — 2 files mounted at same base path |
| `docker/nginx.conf` | config (nginx HTTP reverse proxy) | **Add** `location ~ ^/wakeups(/.*)?$` block | Same file L440-449 (`/roles` block) — exact copy with `/wakeups` substitution |
| `docker/nginx-https.conf` | config (nginx HTTPS reverse proxy) | **Add** paired location block | Same file L455-464 (`/roles` block) — exact copy with `/wakeups` substitution |

### DELETED files (wholesale — D-13)

| Deleted file | Role | Why delete wholesale |
|--------------|------|----------------------|
| `src/backend/claude-session/identity-artifact-reader.role-wakeups.test.ts` (445 lines) | test | Every test in file exercises one of the 6 functions being deleted from `identity-artifact-reader.ts` |
| `src/backend/claude-session/claude-session-server.role-wakeups.test.ts` (425 lines) | test | Every test exercises `identity:list-role-wakeups` / `identity:update-role-wakeup` / `identity:create-role-wakeup` / `identity:delete-role-wakeup` — all being removed |
| `src/backend/claude-session/claude-session-server.role-wakeup-crud.test.ts` (365 lines) | test | Every test exercises `role:list-wakeups` / `role:create-wakeup` / `role:update-wakeup` / `role:delete-wakeup` — all being removed |
| `src/ui/api/claude-session-api.role-wakeup-crud.test.ts` (268 lines) | test | Every test exercises `createRoleWakeupByName` / `updateRoleWakeupByName` / `deleteRoleWakeupByName` — all being removed |

### SURGICAL-EDIT files (audit results — D-13)

| File | Role | Precise edit |
|------|------|--------------|
| `src/ui/api/claude-session-api.role-reads.test.ts` (241 lines) | test | **Keep file. Delete lines ~180-241** (single `describe("listRoleWakeupsByName one-shot helper", ...)` block covering R5+R6 per header docstring). R1 (`getRoleFileByName` describe at L57) + R3 (`listBountiesForRoleName` describe at L115) STAY. |
| `src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` (357 lines) | test | **Keep file. Delete lines 82-85** (4 vi.mock stub lines: `listRoleWakeupsByName`, `createRoleWakeupByName`, `updateRoleWakeupByName`, `deleteRoleWakeupByName`). Test bodies (swap-coordination, L261+) STAY. |

---

## Pattern Assignments

### `src/backend/database/routes/wakeups-list.ts` (route, request-response fleet fan-out)

**Analog A (fleet fan-out shape):** `src/backend/database/routes/conversation-search.ts`
**Analog B (per-host SSH delimiter batching + JWT/hostId gate):** `src/backend/database/routes/roles-list-for-host.ts`
**Analog C (LOCAL/REMOTE branch selection + delimiter loop specifically for wakeups):** `src/backend/claude-session/identity-artifact-reader.ts` L1434-1536 (`readIdentityWakeups`)

**Imports pattern** — mirror `conversation-search.ts` L80-101 verbatim (adjust to point at `identity-artifact-reader.js` for the wakeup-specific helpers):

```typescript
// Source: src/backend/database/routes/conversation-search.ts:80-101
import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { hosts } from "../db/schema.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { sshLogger } from "../../utils/logger.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
// Wakeup-specific additions:
import {
  humanizeWakeupSchedule,
  isLocalHostId,
  getLocalIdentitiesRoot, // for deriving <fleetRoot>/wakeups until getLocalWakeupsRoot lands
} from "../../claude-session/identity-artifact-reader.js";
import fs from "fs/promises";
import path from "path";
```

**Router construction pattern** (L222-225 of `conversation-search.ts` — one-liner shared across every route file):
```typescript
// Source: conversation-search.ts:222-225 (and identical in roles-list-for-host.ts:56-58)
const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
```

**JWT + hostId gate pattern** (for the `/:slug` write endpoints; LIST does NOT need hostId — it's fleet-wide per D-02):

```typescript
// Source: src/backend/database/routes/roles-list-for-host.ts:108-128
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  // 1. Parse + validate hostId (only for host-scoped endpoints; LIST skips this)
  const rawHostId = req.query.hostId;
  if (rawHostId === undefined || rawHostId === "") {
    return res.status(400).json({ error: "hostId is required" });
  }
  const hostId = parseInt(String(rawHostId), 10);
  if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
    return res.status(400).json({ error: "hostId must be a positive integer" });
  }

  // 2. Verify host ownership — returns null for cross-user / unknown hosts.
  const host = await resolveHostById(hostId, userId);
  if (!host) {
    return res.status(404).json({ error: "Host not found" });
  }
  // ...
});
```

**Host candidate projection** (L542-563 of `conversation-search.ts`):
```typescript
// Source: conversation-search.ts:542-563
const rows = (await SimpleDBOps.select(
  db.select().from(hosts).where(eq(hosts.userId, userId)),
  "ssh_data",
  userId,
)) as Array<Record<string, unknown>>;
const candidates = rows.filter((h) => {
  if (!h.enableSsh) return false;
  let cfg: Record<string, unknown> = {};
  if (typeof h.terminalConfig === "string" && h.terminalConfig) {
    try { cfg = JSON.parse(h.terminalConfig as string); } catch { /* ignore */ }
  } else if (h.terminalConfig && typeof h.terminalConfig === "object") {
    cfg = h.terminalConfig as Record<string, unknown>;
  }
  return cfg.autoTmux !== false;
});
```

**Fleet fan-out with per-host timeout + graceful degradation** (L576-622 of `conversation-search.ts`):
```typescript
// Source: conversation-search.ts:576-622
const perHost = await Promise.all(
  candidates.map(async (h): Promise<WakeupListItem[]> => {
    const hostId = h.id as number;
    const hostName = ((h.name as string) || (h.ip as string) || "") as string;
    try {
      const resolved = await resolveHostById(hostId, userId);
      if (!resolved) return [];

      // LOCAL fast path — no SSH, uses bind-mount fs reads
      if (isLocalHostId(hostId)) {
        return readWakeupsLocal(hostId, hostName);
      }

      const conn = await connectOneShot(
        resolved as unknown as Parameters<typeof connectOneShot>[0],
        CONNECT_TIMEOUT_MS,
      );
      try {
        return await Promise.race<WakeupListItem[]>([
          readWakeupsRemote(conn, hostId, hostName),
          new Promise<WakeupListItem[]>((_, reject) =>
            setTimeout(
              () => reject(new Error("per_host_timeout")),
              PER_HOST_TIMEOUT_MS,
            ),
          ),
        ]);
      } finally {
        try { (conn as { end?: () => void }).end?.(); } catch { /* ignore */ }
      }
    } catch (e) {
      sshLogger.debug("wakeups-list: host skipped", {
        operation: "wakeups_list_host_skip",
        hostId,
        hostName,
        error: e instanceof Error ? e.message : "unknown",
      });
      return [];
    }
  }),
);
const flat = perHost.flat();
```

**Delimiter-batched SSH read for a single host** (L1486-1535 of `identity-artifact-reader.ts` — adapted from `readIdentityWakeups` REMOTE branch, but with `for d in */; do ... cat "$d/wakeup.json"` for the nested `<slug>/wakeup.json` shape):
```typescript
// Source: identity-artifact-reader.ts:1486-1535 (readIdentityWakeups REMOTE), adapted from
// per-identity `wakeups/*.json` to global `wakeups/<slug>/wakeup.json` layout.
const cmd =
  `cd "$HOME/fleet/wakeups" 2>/dev/null && ` +
  'for d in */; do slug="${d%/}"; echo "===SLUG:${slug}==="; cat "$d/wakeup.json" 2>/dev/null; done';
let stdout: string;
try {
  stdout = await execCommand(conn, cmd);
} catch {
  return []; // dir likely absent — treat as empty
}
if (!stdout) return [];

const chunks = stdout.split("===SLUG:");
const wakeups: WakeupListItem[] = [];
for (const chunk of chunks) {
  if (!chunk.trim()) continue;
  const sepIdx = chunk.indexOf("===");
  if (sepIdx === -1) continue;
  const slug = chunk.slice(0, sepIdx).trim();
  const jsonContent = chunk.slice(sepIdx + 3).trim();
  if (!jsonContent) continue;
  try {
    const parsed = JSON.parse(jsonContent) as Record<string, unknown>;
    // Extract global-wakeup-spec fields: prompt/roles/skills, NOT instruction.
    wakeups.push({
      slug,
      host: hostName,
      hostId,
      name: typeof parsed.name === "string" ? parsed.name : slug,
      enabled: typeof parsed.enabled === "boolean" ? parsed.enabled : true,
      schedule: parsed.schedule ?? null,
      scheduleHuman: humanizeWakeupSchedule(parsed.schedule),
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
      roles: Array.isArray(parsed.roles) ? (parsed.roles as string[]) : [],
      skills: Array.isArray(parsed.skills) ? (parsed.skills as string[]) : [],
    });
  } catch (err) {
    sshLogger.warn("wakeups-list: parse error for host slug", {
      operation: "wakeups_list_parse_error",
      hostId,
      hostName,
      slug,
    });
    // Skip poisoned entry — one bad file must not poison the list.
  }
}
return wakeups;
```

**LOCAL bind-mount branch** (L1438-1483 of `identity-artifact-reader.ts` — adapt path from `identities/<key>/wakeups` to `wakeups/<slug>/wakeup.json`):
```typescript
// Source: identity-artifact-reader.ts:1438-1483 (readIdentityWakeups LOCAL branch), adapted.
async function readWakeupsLocal(hostId: number, hostName: string): Promise<WakeupListItem[]> {
  // Phase 134: fleetRoot = path.dirname(getLocalIdentitiesRoot()) — same HOME_HOST_DIR-derived
  // resolution used by writeMarkdownFileAtomic's LOCAL branch at L2612-2624.
  // Consider adding a `getLocalWakeupsRoot()` helper for symmetry with
  // `getLocalIdentitiesRoot()` (L276-288) + `getLocalRolesRoot()` (L288-304).
  const fleetRoot = path.dirname(getLocalIdentitiesRoot());
  const wakeupsDir = path.join(fleetRoot, "wakeups");
  let slugs: string[];
  try {
    slugs = await fs.readdir(wakeupsDir);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: WakeupListItem[] = [];
  for (const slug of slugs) {
    if (slug === ".state" || slug.startsWith(".")) continue;
    const specPath = path.join(wakeupsDir, slug, "wakeup.json");
    try {
      const raw = await fs.readFile(specPath, "utf-8");
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      out.push({ /* same shape as REMOTE branch above */ });
    } catch (err) {
      sshLogger.error(
        "wakeups-list: failed to parse local wakeup JSON",
        err instanceof Error ? err : new Error(String(err)),
        { operation: "wakeups_list_local_parse_error", hostId, slug },
      );
      // Skip poisoned entry.
    }
  }
  return out;
}
```

**Error handling — trailing catch-all middleware** (L281-297 of `roles-list-for-host.ts`):
```typescript
// Source: roles-list-for-host.ts:281-297
router.use((
  err: Error,
  _req: Request,
  res: Response,
  _next: express.NextFunction,
) => {
  sshLogger.error("wakeups-list: unhandled error", {
    operation: "wakeups_list_error",
    error: err?.message,
  });
  return res.status(500).json({ error: "internal" });
});

export default router;
```

---

### `src/backend/database/routes/wakeups-write.ts` (route, request-response per-host atomic write)

**Analog A (POST-with-JWT + resolveHostById + semaphore + connectOneShot + atomic-write):** `src/backend/database/routes/roles-create.ts`
**Analog B (per-role wakeup writer being deleted — SHAPE ONLY, not the file):** `src/backend/claude-session/identity-artifact-reader.ts` L2215-2296 (`writeRoleWakeupCreate` — same clobber-check + atomic-write shape, adapted for the new nested `<slug>/wakeup.json` layout)
**Analog C (SFTP writeFile + ext_openssh_rename atomic overwrite):** `src/backend/claude-session/identity-artifact-reader.ts` L2583-2700 (`writeMarkdownFileAtomic`)

**Imports pattern** (mirror `roles-create.ts` L91-115, drop multer/multipart-origin-guard since wakeups CRUD is `application/json`):

```typescript
// Source: roles-create.ts:91-115 (multer + multipart bits dropped — this route is JSON)
import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import {
  writeMarkdownFileAtomic,
  humanizeWakeupSchedule,
  isLocalHostId,
  IDENTITY_SLUG_RE,
  getLocalIdentitiesRoot,
} from "../../claude-session/identity-artifact-reader.js";
import { sshLogger } from "../../utils/logger.js";
import { getHostSemaphore } from "../../ssh/host-semaphore-registry.js";
import fs from "fs/promises";
import path from "path";
```

**Slug normalization helper** — reuse `normalizeWakeupSlug` from identity-artifact-reader.ts:2183. Currently NOT exported — planner surfaces it (add `export` keyword; low-risk edit) OR duplicates as a local const inside `wakeups-write.ts`. Recommendation: export the helper since it's referenced from at least two files now (existing per-identity + new global). Byte-shape from `identity-artifact-reader.ts:2183-2185`:
```typescript
// Source: identity-artifact-reader.ts:2183-2185
function normalizeWakeupSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
```

**POST handler (CREATE) — full shape** (assembled from `roles-create.ts` L286-629 + `writeRoleWakeupCreate` L2215-2296):

```typescript
// Source: roles-create.ts:286-629 (structural) + writeRoleWakeupCreate L2215-2296 (wakeup body)
router.post(
  "/",
  express.json({ limit: "64kb" }),  // Mirrors conversation-search.ts:500's `express.json({limit:"16kb"})` guard
  authenticateJWT,
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    const { host: rawHostId, spec } = req.body as { host?: number; spec?: unknown };

    // 1. hostId gate
    if (typeof rawHostId !== "number" || !Number.isInteger(rawHostId) || rawHostId <= 0) {
      res.status(400).json({ error: "host must be a positive integer" });
      return;
    }
    const hostId = rawHostId;

    // 2. Spec validation — mirrors wakeup-scheduler.py's _load_specs_global() at L224-248:
    //    accepts any dict with `enabled != False` AND `prompt` AND `schedule`.
    //    Schedule must be an object; type must be one of interval|daily|weekly|one_shot.
    //    D-08 explicitly forbids adding constraints the scheduler doesn't have.
    const validationError = validateGlobalWakeupSpec(spec);
    if (validationError !== null) {
      res.status(400).json({ error: validationError });
      return;
    }
    const validSpec = spec as GlobalWakeupSpec;

    // 3. Derive slug + shell-safety gate. Mirror writeRoleWakeupCreate L2221-2224.
    const slug = normalizeWakeupSlug(validSpec.name);
    if (!IDENTITY_SLUG_RE.test(slug)) {
      res.status(400).json({ error: "name normalizes to empty or invalid slug" });
      return;
    }

    // 4. Host resolution — 404 for cross-user / unknown hosts. Mirror roles-create.ts L442-448.
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    // 5. Serialize per-host writes. Mirror roles-create.ts L455 + L618.
    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      await getHostSemaphore(hostId).run(async () => {
        if (isLocalHostId(hostId)) {
          await writeWakeupCreateLocal(slug, validSpec, res);
          return;
        }
        // REMOTE branch — mirror roles-create.ts L456-618
        try {
          conn = await connectOneShot(
            host as unknown as Parameters<typeof connectOneShot>[0],
            SSH_CONNECT_TIMEOUT_MS,
          );
        } catch (err) {
          sshLogger.warn("wakeups-create: SSH connect failed", {
            operation: "wakeups_create_connect", hostId,
            error: err instanceof Error ? err.message : "Unknown",
          });
          res.status(502).json({ error: "SSH connect failed" });
          return;
        }
        // 6. Clobber probe — mirror roles-create.ts L472-496 + writeRoleWakeupCreate L2270-2278
        const preCheck = (await execWithTimeout(
          conn,
          `[ -e "$HOME/fleet/wakeups/${slug}/wakeup.json" ] && echo EXISTS || echo OK`,
        )).trim();
        if (preCheck === "EXISTS") {
          res.status(409).json({ error: "wakeup with this name already exists" });
          return;
        }
        // 7. Provision dir + atomic write. Mirror writeRoleWakeupCreate L2272-2294 shape,
        //    but use writeMarkdownFileAtomic (SFTP writeFile + ext_openssh_rename) NOT python3
        //    — this is a full overwrite, no merge needed (RESEARCH.md § Anti-patterns).
        await execWithTimeout(conn, `mkdir -p "$HOME/fleet/wakeups/${slug}"`);
        const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
        const targetPath = `${remoteHome}/fleet/wakeups/${slug}/wakeup.json`;
        const body = JSON.stringify(validSpec, null, 2) + "\n";
        try {
          await writeMarkdownFileAtomic(conn, targetPath, body);
        } catch (err) {
          sshLogger.error("wakeups-create: SFTP write failed",
            err instanceof Error ? err : new Error(String(err)),
            { operation: "wakeups_create_sftp_write", hostId, slug, targetPath });
          res.status(502).json({ error: "SSH exec failed" });
          return;
        }
        res.status(201).json({ slug, host: hostId, spec: validSpec });
      }); // end getHostSemaphore(hostId).run(...)
    } finally {
      if (conn) {
        try { conn.end(); } catch { /* best-effort cleanup */ }
      }
    }
  },
);
```

**DELETE handler — hard delete + sentinel cleanup (D-06 + Pitfall 2)**:

```typescript
// The sentinel cleanup is the D-06 explicit requirement. RESEARCH.md § Pitfalls #2 spells out
// the exact command shape.
router.delete("/:slug", authenticateJWT, express.json({ limit: "1kb" }), async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const slug = req.params.slug;
  const { host: rawHostId } = req.body as { host?: number };

  // hostId + slug gates (mirror the CREATE handler)
  if (!IDENTITY_SLUG_RE.test(slug)) { /* 400 */ }
  if (typeof rawHostId !== "number" || !Number.isInteger(rawHostId) || rawHostId <= 0) { /* 400 */ }
  const host = await resolveHostById(rawHostId, userId);
  if (!host) { /* 404 */ }

  await getHostSemaphore(rawHostId).run(async () => {
    if (isLocalHostId(rawHostId)) {
      const fleetRoot = path.dirname(getLocalIdentitiesRoot());
      const dir = path.join(fleetRoot, "wakeups", slug);
      const sentinel = path.join(fleetRoot, "wakeups", ".state", `${slug}.fired`);
      await fs.rm(dir, { recursive: true, force: true });
      await fs.unlink(sentinel).catch(() => {}); // idempotent
      res.status(204).end();
      return;
    }
    const conn = await connectOneShot(host, SSH_CONNECT_TIMEOUT_MS);
    try {
      // ONE-shot combined cleanup — RESEARCH.md § Pitfalls #2 verbatim
      await execWithTimeout(
        conn,
        `rm -rf "$HOME/fleet/wakeups/${slug}" && rm -f "$HOME/fleet/wakeups/.state/${slug}.fired"`,
      );
      res.status(204).end();
    } finally {
      try { conn.end(); } catch {}
    }
  });
});
```

**Validation source of truth — `wakeup-scheduler.py`** (L224-248). D-08: API validates EXACTLY what the scheduler accepts, nothing more:
```python
# Source: substrate/scripts/wakeup-scheduler.py:224-248 (_load_specs_global)
# Accept:  isinstance(spec, dict) AND spec.get("enabled", True) != False
#          AND spec.get("prompt")           # truthy string
#          AND spec.get("schedule")         # truthy dict-like
# Schedule type gate: type ∈ {"interval", "daily", "weekly", "one_shot"} (per _due L180-205)
#                    "interval": requires `every` (parsed via _dur_secs L146)
#                    "daily":    requires `at`    (parsed via _slot_at L155)
#                    "weekly":   requires `day` + `at`
#                    "one_shot": requires `at`    (parsed via _parse_at_ts L160-177)
# Nothing else. `roles[]` and `skills[]` are unvalidated pass-through per D-04+D-08.
```

Translation to TS — the CREATE handler's `validateGlobalWakeupSpec()` MUST mirror the above exactly. **Do NOT add** min-length prompt caps, roles-count minimums, mimetype gates — every one is a drift bug per Pitfall #4.

---

### `src/backend/database/routes/wakeups-list.test.ts` + `wakeups-write.test.ts` (test files)

**Analog:** `src/backend/database/routes/roles-list-for-host.test.ts` (668 lines, 10 cases: 400 gates, 404, happy path, empty, timeout, auth). Same pattern for `wakeups-write.test.ts` — mirror `roles-create.test.ts` (703 lines: 400/404/409/happy/atomic-write/auth).

**Boilerplate — mocks + Express app setup** (L25-90 of `roles-list-for-host.test.ts`):
```typescript
// Source: roles-list-for-host.test.ts:25-90
import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

let mockUserId: string | null = "1";

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

vi.mock("../../ssh/ssh-one-shot.js", () => ({ connectOneShot: vi.fn() }));
vi.mock("../../ssh/tmux-helper.js", () => ({ execCommand: vi.fn() }));
vi.mock("../../ssh/host-resolver.js", () => ({ resolveHostById: vi.fn() }));

import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
```

**Test cases for `wakeups-list.test.ts`** (adapted from `roles-list-for-host.test.ts:11-22` — 10-15 cases):
1. 401 without JWT
2. LIST with 2 hosts, both happy — aggregated response with `host` field per item
3. LIST with 1 host down (connectOneShot rejects) — contributes `[]`; response still returns healthy host's rows
4. LIST with 1 host timeout (`Promise.race` fires) — same graceful degradation
5. LOCAL branch — `isLocalHostId(hostId)` true → reads via `fs/promises`
6. REMOTE branch — parses `===SLUG:<slug>===` delimiter one-liner correctly
7. Poisoned JSON on one host — skips that entry, returns others
8. Empty `~/fleet/wakeups/` — returns `[]` for that host
9. Cross-user host filtered out at the DB projection stage (`eq(hosts.userId, userId)`)
10. `humanizeWakeupSchedule` field populated per row

**Test cases for `wakeups-write.test.ts`** (adapted from `roles-create.test.ts` — 10-15 cases):
1. Missing `host` → 400
2. Invalid slug (empty spec.name → empty slug after normalizeWakeupSlug) → 400
3. Unknown host (resolveHostById → null) → 404
4. 409 clobber (existence probe returns "EXISTS")
5. Happy path CREATE — file lands via SFTP writeFile + ext_openssh_rename
6. LOCAL branch — writes via fs.writeFile + fs.rename
7. Semaphore serializes two concurrent CREATEs
8. Spec with missing `prompt` → 400 (scheduler-parity gate)
9. Spec with missing `schedule` → 400
10. Spec with `schedule.type` not in {interval, daily, weekly, one_shot} → 400
11. UPDATE + TOGGLE happy paths
12. DELETE + sentinel cleanup — single SSH exec verified via mock (Pitfall #2 regression pin)
13. 401 without JWT

---

### `src/backend/claude-session/identity-artifact-reader.ts` (MODIFIED — delete 6 functions per D-10)

**Analog for what STAYS:** Same file. The file's structure remains identical after deletions — the per-identity mirror functions (`readIdentityWakeups`, `writeIdentityWakeupCreate`, `writeIdentityWakeupUpdate`, `writeIdentityWakeupDelete`) STAY because per-identity wake-ups are still live per Phase 134 CONTEXT § D-09.

**Deletion targets** (exact line ranges from RESEARCH.md § Sources + verified this session):

| Function | Line range | Notes |
|----------|-----------|-------|
| `readRoleWakeups` | L1558-~1676 (ends before `readIdentityHandoff` at L1678) | Both LOCAL + REMOTE branches |
| `readRoleWakeupsByName` | ~L4042-4173 (before `writeRoleWakeupByName`) | Phase 90 Plan 90-07 role-name-keyed variant |
| `writeRoleWakeupUpdate` | L2098-~2168 | Two-step (resolveRoleForIdentity) + branch |
| `writeRoleWakeupCreate` | L2215-2296 | Full function including python3 REMOTE block |
| `writeRoleWakeupDelete` | L2309-~2345 (before `writeIdentityWakeupCreate` L2359) | |
| `writeRoleWakeupByName` | ~L4174-end | Phase 90 Plan 90-07 role-name-keyed writer |

**Companion helpers to audit for orphaning after deletion:**
- `normalizeWakeupSlug` L2183 — STAYS (still used by `writeIdentityWakeupCreate` L2365 + planner surfacing it as an export for the new global wakeups router).
- `validateWakeupSpec` L2190 — STAYS if still used by `writeIdentityWakeupCreate` L2364. **Planner audit:** confirm via grep.
- `resolveRoleForIdentity` L400 — STAYS (used by `readRoleFile` + others).

**Pattern for the potential new export** (`getLocalWakeupsRoot`):
```typescript
// Source: identity-artifact-reader.ts:276-304 (getLocalIdentitiesRoot + getLocalRolesRoot).
// Model the new helper on this shape verbatim.
export function getLocalIdentitiesRoot(): string {
  // HOME_HOST_DIR-derived resolution — the container's bind mount to the host's fleet subtree.
  // Test-override + native-fallback + container-primary paths all handled here.
  // ...
}
```

New helper (planner writes):
```typescript
// New — Phase 134 Plan 134-01. Mirror of getLocalIdentitiesRoot + getLocalRolesRoot.
export function getLocalWakeupsRoot(): string {
  return path.join(path.dirname(getLocalIdentitiesRoot()), "wakeups");
}
```

---

### `src/backend/claude-session/claude-session-server.ts` (MODIFIED — delete 8 handlers per D-11)

**Analog for what STAYS:** Same file. Per-identity handlers (identity:list-wakeups, identity:update-wakeup, identity:create-wakeup, identity:delete-wakeup) STAY — Phase 134 does NOT touch per-identity wake-ups.

**Deletion targets** (verified this session by grep):

**Imports (L81-89):**
```typescript
// Source: claude-session-server.ts:81-89 — REMOVE these 6 imports from the identity-artifact-reader import block
import {
  readRoleWakeupsByName,   // L81 — DELETE
  readRoleWakeups,         // L82 — DELETE
  writeRoleWakeupUpdate,   // L84 — DELETE
  writeRoleWakeupCreate,   // L85 — DELETE
  writeRoleWakeupDelete,   // L86 — DELETE
  writeRoleWakeupByName,   // L89 — DELETE
} from "./identity-artifact-reader.js";
```

**Wire-op JSDoc removal (2 blocks):**
- L124-131 (block documenting `identity:list-role-wakeups` + `identity:update-role-wakeup` + `identity:create-role-wakeup` + `identity:delete-role-wakeup` — Phase 72 Plan 01 four-tuple)
- L147-150 (block documenting `role:list-wakeups` + `role:create-wakeup` + `role:update-wakeup` + `role:delete-wakeup` — Phase 90 Plan 90-07 four-tuple)
- L186-192 (response-type JSDoc for identity:role-wakeups + identity:role-wakeup-updated + identity:role-wakeup-created + identity:role-wakeup-deleted)
- L208-211 (response-type JSDoc for role:wakeups-loaded + role:wakeup-created + role:wakeup-updated + role:wakeup-deleted)

**Handler removal targets (8 handlers):**
- Comment block at L1625-1650 documenting the Phase 90 Plan 90-07 quad — delete
- L1795-1832 — `role:list-wakeups` handler (`readRoleWakeupsByName` caller)
- L1833-1906 — `handleRoleWriteWakeup` (handles both `role:create-wakeup` + `role:update-wakeup` via `writeRoleWakeupByName`)
- L1918-1976 — `role:delete-wakeup` handler
- L1996-2003 — Phase 72 Plan 01 comment block preceding the identity:*-role-wakeup quad
- L2050-2108 — `identity:list-role-wakeups` handler (`readRoleWakeups` caller)
- L2117-2195 — `identity:update-role-wakeup` handler (`writeRoleWakeupUpdate` caller)
- L2225-2260 — `identity:create-role-wakeup` handler (`writeRoleWakeupCreate` caller)
- L2299-2325 — `identity:delete-role-wakeup` handler (`writeRoleWakeupDelete` caller)

**Pattern for what a handler deletion looks like** (`identity:list-role-wakeups`, L2075-2108):
```typescript
// Source: claude-session-server.ts:2075-2108 — DELETE THIS BLOCK
let wakeups: Awaited<ReturnType<typeof readRoleWakeups>>["wakeups"];
if (isLocalHostId(hostId)) {
  ({ wakeups } = await readRoleWakeups(null, identityKey));
  sshLogger.info("identity:list-role-wakeups", {
    operation: "identity_list_role_wakeups_local",
    identityKey, hostId,
  });
} else {
  const conn = await connectOneShot(host, SSH_CONNECT_TIMEOUT_MS);
  try {
    ({ wakeups } = await readRoleWakeups(conn, identityKey));
    // ...
  } finally { conn.end(); }
}
```

---

### `src/ui/api/claude-session-api.ts` (MODIFIED — delete 5 helpers + payload/event types per D-12)

**Analog for what STAYS:** Same file. `WakeupSpecWire` L729 STAYS (per D-12 — still used by per-identity wake-ups + upcoming global wake-up API's TS wire types when the shape-3 modal is built).

**Deletion targets** (verified this session by grep):

**Discriminated-union type deletions (L413-416)** — remove 4 members from the union:
```typescript
// Source: claude-session-api.ts:413-416 — DELETE these 4 members from the union
| IdentityRoleWakeupsEvent
| IdentityRoleWakeupUpdatedEvent
| IdentityRoleWakeupCreatedEvent
| IdentityRoleWakeupDeletedEvent
```

**JSDoc comment block (L710-713)** — DELETE:
```typescript
// Source: claude-session-api.ts:710-713 — DELETE
//   - identity:list-role-wakeups   / identity:role-wakeups         (list)
//   - identity:update-role-wakeup  / identity:role-wakeup-updated  (patch)
//   - identity:create-role-wakeup  / identity:role-wakeup-created  (create)
//   - identity:delete-role-wakeup  / identity:role-wakeup-deleted  (delete)
```

**Payload + event types (L738-787)** — DELETE:
- `IdentityListRoleWakeupsPayload` L738-743
- `IdentityRoleWakeupsEvent` L744-748
- `IdentityUpdateRoleWakeupPayload` L750-761
- `IdentityRoleWakeupUpdatedEvent` L763-767
- `IdentityCreateRoleWakeupPayload` L769-774
- `IdentityRoleWakeupCreatedEvent` L775-779
- `IdentityDeleteRoleWakeupPayload` L781-786
- `IdentityRoleWakeupDeletedEvent` L787-791

**JSDoc comment block (L1296-1299)** — DELETE.

**Phase 90 Plan 90-07 payload + event types (L1329-1373)** — DELETE:
- `RoleListWakeupsPayload` L1329-1332
- `RoleWakeupsLoadedEvent` L1333-1338
- `RoleCreateWakeupPayload` L1340-1344
- `RoleWakeupCreatedEvent` L1345-1350
- `RoleUpdateWakeupPayload` L1352-1356
- `RoleWakeupUpdatedEvent` L1357-1362
- `RoleDeleteWakeupPayload` L1364-1368
- `RoleWakeupDeletedEvent` L1370-1373

**Helper function deletions:**
- `listRoleWakeupsByName` L1499-1549
- `createRoleWakeupByName` L1556-1608
- `updateRoleWakeupByName` L1615-1667
- `deleteRoleWakeupByName` L1673-1725

**Also check:** `listRoleWakeups` — the older identity-key-keyed variant referenced in D-12. If present, delete alongside the 4 above.

**Pattern for what a helper looks like** (`listRoleWakeupsByName` L1499-1549):
```typescript
// Source: claude-session-api.ts:1499-1549 — DELETE. All 5 helpers share the same
// send-frame-and-wait-for-response shape; deletion is mechanical byte-drop.
export function listRoleWakeupsByName(args: {
  roleName: string;
  hostId?: number;
}): Promise<{ wakeups: Wakeup[] }> {
  return new Promise((resolve, reject) => {
    // ... WS.send({ type: "role:list-wakeups", ... }) + await "role:wakeups-loaded" reply
  });
}
```

**JSDoc header comment L194-195** — has stale references to the deleted helpers. Audit + delete stale mentions in the file-level docstring.

---

### `src/ui/features/pretty-view/RoleModal.tsx` (MODIFIED — remove role-wakeups tab per D-09)

**Analog for what STAYS:** Same file. The role/runbooks/bounties tabs STAY. `WakeupsTab` component (referenced from `./WakeupsTab`) STAYS UNTOUCHED because IdentityModal still consumes it.

**Deletion targets** (exact line ranges verified this session):

**Imports:**
- L46 (`AlarmClock` from lucide-react — only used by NAV_SECTIONS entry) — DELETE
- L64-67 (`listRoleWakeupsByName`, `createRoleWakeupByName`, `updateRoleWakeupByName`, `deleteRoleWakeupByName` from `@/api/claude-session-api`) — DELETE
- L74 (`WakeupsTab` from `./WakeupsTab`) — DELETE (only used by role-wakeups tab; after deletion, RoleModal no longer references WakeupsTab; IdentityModal keeps its own import)

**NAV_SECTIONS entry (L89):**
```tsx
// Source: RoleModal.tsx:85-90 — DELETE line 89 only. Keep the other 3 nav entries.
const NAV_SECTIONS = [
  { value: "role", label: "Role file", Icon: Users },
  { value: "runbooks", label: "Runbooks", Icon: BookOpen },
  { value: "bounties", label: "Bounties", Icon: Target },
  { value: "role-wakeups", label: "Wakeups", Icon: AlarmClock },  // DELETE
] as const;
```

**State block (L244-246):**
```tsx
// DELETE
const [roleWakeupsState, setRoleWakeupsState] = useState<TabState<Wakeup[]>>({
  status: "loading",
});
```

**Reset in the mount effect (L282):**
```tsx
// DELETE the setRoleWakeupsState({ status: "loading" }) line at L282.
```

**Fetch block (L307-321):**
```tsx
// Source: RoleModal.tsx:307-321 — DELETE the entire second `void (async () => { ... })()` invocation
void (async () => {
  try {
    const { wakeups } = await listRoleWakeupsByName({ roleName, hostId });
    if (!cancelled) setRoleWakeupsState({ status: "ready", data: wakeups });
  } catch (e) {
    if (!cancelled) setRoleWakeupsState({
      status: "error",
      error: e instanceof Error ? e.message : "Connection failed",
    });
  }
})();
```

**Callback block (L328-390):**
```tsx
// Source: RoleModal.tsx:328-390 — DELETE. The 3 callbacks: updateRoleWakeup / createRoleWakeup / deleteRoleWakeup.
// The comment block preceding them at L328-339 also comes out.
```

**TabsContent block (L656-669):**
```tsx
// Source: RoleModal.tsx:656-669 — DELETE the entire TabsContent block
<TabsContent value="role-wakeups" className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
  <WakeupsTab
    state={roleWakeupsState}
    hue={hue}
    scope="role"
    isCoordinator={false}
    onUpdate={updateRoleWakeup}
    onCreate={createRoleWakeup}
    onDelete={deleteRoleWakeup}
  />
</TabsContent>
```

**Type import cleanup** — Check whether `type Wakeup` (L69) is still used after the deletions. If ONLY consumed by `roleWakeupsState`, remove the import; if used elsewhere in the file, keep. `type WakeupSpecWire` (L68) similarly — audit.

---

### `docker/nginx.conf` + `docker/nginx-https.conf` (MODIFIED — add paired location blocks per D-17)

**Analog:** `docker/nginx.conf` L440-449 (`/roles` block) and `docker/nginx-https.conf` L455-464 (paired `/roles` block).

**Exact block to add in both files** (mirror the `/roles` shape verbatim — same 15s proxy_read_timeout since it caps SSH fan-out):

```nginx
# Phase 134: /wakeups regex block — method-agnostic so it covers BOTH the
# GET / list route (fleet-wide fan-out) AND the POST/PATCH/DELETE endpoints
# for per-host writes. Backing routers share the base path via chained
# app.use("/wakeups", ...) mounts in database.ts (mirrors /roles pattern).
# proxy_read_timeout 15s bounds the fleet SSH fan-out with per-host 15s
# race-timeout. client_max_body_size 64KB matches the express.json({limit:"64kb"})
# body cap in wakeups-write.ts (small spec payloads only).
# Parity between docker/nginx.conf and docker/nginx-https.conf is load-bearing
# per CLAUDE.md: missing this in the HTTPS conf means /wakeups 200-returns
# index.html and crashes the frontend on `.map` in production.
location ~ ^/wakeups(/.*)?$ {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 15s;
    client_max_body_size 64k;
}
```

**Positioning:** insert AFTER the `/roles` block, BEFORE the `/global-files` block in each file (so line ~450 in nginx.conf, line ~465 in nginx-https.conf).

---

### `src/backend/database/database.ts` (MODIFIED — add router mounts near L2010-2015)

**Analog:** `database.ts` L2010-2015 (`/roles` chained mounts). Mirror the pattern verbatim.

```typescript
// Source: database.ts:2010-2015 — model the new chained mounts on this pair
// Phase 22 (SRIC-02): /roles?hostId=<n> — target-host-side role directory
// enumeration. Standalone mount; kept ABOVE /identities to preserve match
// precedence should a future /roles subpath ever collide.
app.use("/roles", rolesListForHostRoutes);
// Phase 22 (SRIC-04): POST /roles — target-host-side role folder creation.
// Same base path as the list router; Express supports multiple routers at the
// same mount by chaining app.use. The list router only handles GET so POST
// falls through to this router. Both /roles mounts appear BEFORE /identities.
app.use("/roles", rolesCreateRoutes);
```

**New lines to insert** (position just before or after the `/roles` chain — planner picks; keep ABOVE the `/identities` late catch-alls at L1978+):

```typescript
// Phase 134 (wake-ups-redesign shape 2 CRUD API): /wakeups fleet-wide REST.
// Chained mounts follow /roles pattern (Phase 22): the list router only
// handles GET /; the write router handles POST/PATCH/DELETE — Express falls
// through so a single base path serves both. Matching nginx location blocks
// in BOTH docker/nginx.conf AND docker/nginx-https.conf (Phase 134 D-17
// — load-bearing per CLAUDE.md nginx caveat).
app.use("/wakeups", wakeupsListRoutes);
app.use("/wakeups", wakeupsWriteRoutes);
```

Plus paired imports at the top of `database.ts` — the analog is any of the L1941-2050 range mount groups' import declarations at the top of the file.

---

## Shared Patterns

### Pattern: JWT + resolveHostById auth gate (every endpoint)

**Source:** Universal — used by every routes/ file. Cleanest single reference: `roles-list-for-host.ts:108-128`.

```typescript
router.get("/", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  // hostId gate (for host-scoped endpoints) →
  //   parse + validate positive integer → 400
  //   resolveHostById(hostId, userId) → null → 404
});
```

**Apply to:** Every new endpoint in `wakeups-write.ts` (POST /, PATCH /:slug, PATCH /:slug/toggle-enabled, DELETE /:slug). The LIST endpoint in `wakeups-list.ts` uses ONLY `authenticateJWT` (no hostId — fleet-wide fan-out).

### Pattern: getHostSemaphore for per-host write serialization

**Source:** `roles-create.ts:455` + `roles-create.ts:618` (opening + closing braces).

```typescript
await getHostSemaphore(hostId).run(async () => {
  // ... all per-host writes go here — mkdir, existence probe, SFTP write ...
}); // end getHostSemaphore(hostId).run(...)
```

**Apply to:** Every WRITE handler (CREATE, UPDATE, TOGGLE, DELETE) in `wakeups-write.ts`.

### Pattern: Atomic write via writeMarkdownFileAtomic (SFTP + ext_openssh_rename)

**Source:** `identity-artifact-reader.ts:2583-2700` (`writeMarkdownFileAtomic`). Handles BOTH the LOCAL bind-mount branch (via `conn === null`) AND the REMOTE SFTP branch. The name says "markdown" but it's a byte-agnostic writer — pass a JSON string and it writes JSON bytes atomically.

**⚠️ Anti-pattern warning (RESEARCH.md § Anti-patterns):** the name says "markdown" — reviewers may push back. Two acceptable resolutions:
1. Reuse `writeMarkdownFileAtomic` and add a comment explaining "byte-agnostic despite the name; JSON body passes through unchanged" (lowest-touch).
2. Add a peer helper `writeJsonFileAtomic(conn, targetPath, obj)` that internally calls `writeMarkdownFileAtomic(conn, targetPath, JSON.stringify(obj, null, 2) + "\n")`. Cleaner naming; ~5 lines of new code.

**Do NOT reach for the `python3 -c ...` script pattern from `writeRoleWakeupCreate` L2279-2294** — that was for JSON-with-merge semantics (writeRoleWakeupUpdate PATCHed individual fields). The new global CRUD is full-overwrite; SFTP writeFile + ext_openssh_rename is enough.

**Apply to:** CREATE, UPDATE, TOGGLE handlers in `wakeups-write.ts`.

### Pattern: LOCAL/REMOTE branch selection via isLocalHostId

**Source:** `identity-artifact-reader.ts:233` (`isLocalHostId` export) + usage at every wakeup/identity read+write.

```typescript
if (isLocalHostId(hostId)) {
  // LOCAL branch — reads/writes via fs/promises against the container bind mount
  // fleetRoot = path.dirname(getLocalIdentitiesRoot())  (until getLocalWakeupsRoot lands)
} else {
  // REMOTE branch — SSH connectOneShot + execCommand or SFTP
}
```

**Apply to:** Both LIST fan-out (per-host branch decision) and every WRITE handler.

### Pattern: Slug shell-safety gate (IDENTITY_SLUG_RE)

**Source:** `identity-artifact-reader.ts:1431` (`export const IDENTITY_SLUG_RE = /^[a-z0-9_-]{1,80}$/i`).

```typescript
if (!IDENTITY_SLUG_RE.test(slug)) {
  return res.status(400).json({ error: "invalid wakeup slug" });
}
// After this gate, the slug is safe to interpolate into a double-quoted shell path.
```

**Apply to:** POST (post normalizeWakeupSlug), PATCH, DELETE — every handler that interpolates the slug into a shell command.

### Pattern: sshLogger with operation tags

**Source:** `roles-create.ts` L462-467 (warn on SSH connect), L570-580 (error on SFTP write).

```typescript
sshLogger.warn("wakeups-create: SSH connect failed", {
  operation: "wakeups_create_connect",
  hostId,
  error: err instanceof Error ? err.message : "Unknown",
});

sshLogger.error("wakeups-create: SFTP write failed",
  err instanceof Error ? err : new Error(String(err)),
  {
    operation: "wakeups_create_sftp_write",
    hostId, slug, targetPath,
  });
```

**Apply to:** Every SSH-touching path. Standard operation-tag convention: `<endpoint>_<step>` in snake_case.

### Pattern: Trailing catch-all error middleware

**Source:** `roles-list-for-host.ts:281-297`, `roles-create.ts:635-654`. Every route file ends with this shape.

```typescript
router.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
  sshLogger.error("<endpoint>: unhandled error", {
    operation: "<endpoint>_error",
    error: err?.message,
  });
  return res.status(500).json({ error: "internal" });
});

export default router;
```

**Apply to:** Both `wakeups-list.ts` and `wakeups-write.ts`.

### Pattern: 502 on SSH failure, 500 on unhandled, 400/404/409 on client-error

**Source:** every route in `routes/`. Universal HTTP status discipline:
- 400 — body validation (bad hostId, bad slug, missing/invalid spec)
- 401 — auth (handled by AuthManager middleware — no explicit code in handler)
- 404 — resolveHostById returned null (cross-user or unknown host)
- 409 — clobber probe hit an existing file (CREATE only)
- 502 — SSH connect or SSH exec failed
- 500 — anything else (trailing catch-all middleware)

**Apply to:** Every new endpoint.

---

## No Analog Found

**Every file in the phase has a close analog.** The bracketed row below is not a "no analog found" case but a specific structural note for downstream awareness:

| Case | Row | Reason |
|------|-----|--------|
| `validateGlobalWakeupSpec()` (new TS function inside `wakeups-write.ts` OR next to it) | validation | The existing `validateWakeupSpec` at `identity-artifact-reader.ts:2190` validates the PER-IDENTITY wake-up spec shape (`name`, `enabled`, `instruction`, `schedule`) — the new GLOBAL wake-up spec has different fields (`prompt`, `roles[]`, `skills[]`, `schedule`) per Phase 127 D-04. **Do NOT extend `validateWakeupSpec` — write a new sibling function.** Body derives from the Python scheduler at `substrate/scripts/wakeup-scheduler.py:224-248` (`_load_specs_global`). Assumption A5 in RESEARCH.md confirms this — keep the two types + validators distinct. |

---

## Downstream test files (audit results — surgical, not wholesale)

### `src/ui/api/claude-session-api.role-reads.test.ts` (241 lines)

**Audit result:** File contains 3 `describe` blocks per the file header (R1, R3, R5+R6). Grep verified:
- L57  `describe("getRoleFileByName one-shot helper", ...)` — R1. **KEEP.**
- L115 `describe("listBountiesForRoleName one-shot helper", ...)` — R3. **KEEP.**
- L180 `describe("listRoleWakeupsByName one-shot helper", ...)` — R5+R6. **DELETE (lines 179-241).**

**Excerpt of the block to delete** (L179-241):
```typescript
// ─── listRoleWakeupsByName ───────────────────────────────────────────────
describe("listRoleWakeupsByName one-shot helper", () => {
  // R5: happy path
  // R6: error envelope
  // ... test bodies ...
});
```

### `src/ui/features/pretty-view/PrettyView.role-modal-swap.test.tsx` (357 lines)

**Audit result:** File covers PrettyView role-modal-swap coordination (Phase 90 D-04). The 4 wakeup helpers appear ONLY as `vi.mock` stubs at L82-85. Test bodies (from L261 onward) exercise swap coordination, not wakeups. **KEEP file. DELETE lines 82-85 only.**

**Excerpt of the lines to delete** (L82-85):
```typescript
// Source: PrettyView.role-modal-swap.test.tsx:82-85 — DELETE
listRoleWakeupsByName: vi.fn().mockResolvedValue({ wakeups: [] }),
createRoleWakeupByName: vi.fn().mockResolvedValue({ wakeups: [] }),
updateRoleWakeupByName: vi.fn().mockResolvedValue({ wakeups: [] }),
deleteRoleWakeupByName: vi.fn().mockResolvedValue({ wakeups: [] }),
```

---

## Metadata

**Analog search scope:**
- `src/backend/database/routes/` (all 60+ route files scanned; conversation-search.ts, roles-list-for-host.ts, roles-create.ts identified as strongest analogs)
- `src/backend/claude-session/identity-artifact-reader.ts` (single file — home of atomic-write, SSH fan-out, slug helpers, humanization, LOCAL/REMOTE branch predicates)
- `src/backend/claude-session/claude-session-server.ts` (deletion targets)
- `src/ui/api/claude-session-api.ts` (deletion targets)
- `src/ui/features/pretty-view/RoleModal.tsx` (deletion targets)
- `docker/nginx.conf` + `docker/nginx-https.conf` (add paired blocks)
- `substrate/scripts/wakeup-scheduler.py` (validation source of truth per D-08)

**Files scanned:** 12 primary + 6 test-file audit targets = 18

**Pattern extraction date:** 2026-09-21
