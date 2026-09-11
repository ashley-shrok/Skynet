# Phase 80: id skill revamp Phase A — Pattern Map

**Mapped:** 2026-09-06
**Files analyzed:** 21 (14 existing extended + 6 net-new + 1 Dockerfile edit)
**Analogs found:** 21 / 21 (100% coverage — this phase is an additive extension of well-established patterns)

---

## File Classification

### Backend — files to extend

| File | Role | Data Flow | Closest Analog | Match Quality |
|------|------|-----------|----------------|---------------|
| `src/backend/claude-session/identity-artifact-reader.ts` (extend `extractCosmeticsFromFrontmatter`) | utility (frontmatter parser) | transform | itself (existing narrowing chain L2095-2145) | exact — additive scalar |
| `src/backend/database/routes/identities.ts` (extend `publicIdentity`) | route/serializer | request-response | itself (existing cosmetics arg L109-143) | exact — additive scalar |
| `src/backend/database/routes/identity-birth-orchestrator.ts` (extend `BirthOptions` + `buildIdentityFileBody`) | service (orchestrator) | event-driven (SSE steps) | itself (existing frontmatter pairs L345-380) | exact — additive scalar |
| `src/backend/database/routes/identity-birth.ts` (extend body validation) | controller/route | request-response | itself (existing validation L84-127) | exact |
| `src/backend/matrix/matrix-admin-client.ts` (add `countUsersMatching`) | service (matrix admin proxy) | request-response | itself (existing `loginAsUser` L127-171) | exact — one more primitive |
| `src/backend/database/database.ts` (add `/identities/pool` mount) | config (route wiring) | request-response | itself (existing `/identities/avatar` mount L1832) | exact |
| `src/backend/database/routes/identity-clone.ts` (add `task` support) | route/service | request-response | itself + `identity-birth.ts` for `task` field pattern | exact |

### Backend — new files

| File | Role | Data Flow | Closest Analog | Match Quality |
|------|------|-----------|----------------|---------------|
| `src/backend/pool/pool-loader.ts` (new) | utility (JSON seed loader) | file-I/O (read-only, memoized) | `src/backend/branding/branding-config-loader.ts` | exact — direct byte-shape mirror |
| `src/backend/pool/pool-routes.ts` (new) | route/controller | request-response | `src/backend/database/routes/roles-list-for-host.ts` | exact — same auth/host-resolve gate |
| `docker/pool-defaults/pool.json` (new) | config (seed data) | file-I/O (baked into image) | `docker/branding-defaults/branding.json` | exact — same COPY pattern |
| `docker/Dockerfile` (add `COPY` line) | config | build-time | existing branding-defaults COPY L78 | exact |
| `src/backend/pool/pool-loader.test.ts` (new) | test | — | `src/backend/branding/branding-config-loader.test.ts` | exact — same `vi.mock("node:fs")` pattern |
| `src/backend/pool/pool-routes.test.ts` (new) | test | — | existing route tests in `src/backend/database/routes/*.test.ts` | role-match |

### Frontend — files to extend

| File | Role | Data Flow | Closest Analog | Match Quality |
|------|------|-----------|----------------|---------------|
| `src/ui/api/identities-api.ts` (add `task` to `Identity` + `BirthRequest`, add `pickPoolName`) | api-client | request-response | itself (existing `Identity` L3-23 + `openBirthStream` L401+) | exact — additive scalar |
| `src/ui/sidebar/NewSessionDialog.tsx` (add task input + pool prefill + fix role-select bug) | component (form) | request-response | itself (existing identity-mode branch + role-dropdown L961-1010) | exact — extend, don't rewrite |
| `src/ui/sidebar/CloneAgentDialog.tsx` (repurpose or delete) | component (form) | request-response | `NewSessionDialog.tsx` chain-prefill mechanism L397-410 | exact — reuse existing chain hook |
| `src/ui/features/pretty-view/PrettyView.tsx` (add task pill sibling to IdentityBadge L3011-3019) | component (chat surface) | request-response | `src/ui/features/terminal/IdentityBadge.tsx` L102-116 | exact — copy glass formula |
| `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` (swap `.pv-body` markup L1273-1288 + rename "Clone" menu L1352) | component (list row) | request-response | itself (existing markup gated on `identity.task`) | exact — additive gate |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (rewire `handleRowClone` L1248) | component (panel) | request-response | itself (existing chain-hook seed to NewSessionDialog) | exact |
| `src/ui/features/pretty-conversations/pretty-conversations.css` | style | — | itself (existing `.pv-label` / `.pv-ai-title` L686-756) | exact — reuse verbatim per D-03 |

### Frontend — new components

| File | Role | Data Flow | Closest Analog | Match Quality |
|------|------|-----------|----------------|---------------|
| `src/ui/features/terminal/TaskPill.tsx` (new, optional extract) | component | request-response | `src/ui/features/terminal/IdentityBadge.tsx` | exact — glass-treatment sibling |
| `src/ui/sidebar/NewSessionDialog.task-input.test.tsx` (new) | test | — | `src/ui/sidebar/NewSessionDialog.role-dropdown.test.tsx` | exact |
| `src/ui/features/pretty-view/PrettyView.task-pill.test.tsx` (new) | test | — | existing PrettyView test files (colocated) | role-match |
| `src/ui/features/pretty-conversations/PrettyConversationRow.task-primary.test.tsx` (new) | test | — | `src/ui/features/pretty-conversations/PrettyConversationRow.test.tsx` | exact |

---

## Pattern Assignments

### Backend Extensions

---

#### `src/backend/claude-session/identity-artifact-reader.ts` — extend `extractCosmeticsFromFrontmatter`

**Analog:** itself (this function is the pattern — extend the narrowing chain by one scalar).

**Location:** `identity-artifact-reader.ts:2095-2145`

**Existing narrowing pattern (copy exactly for `task`):**
```typescript
// L2121-2140 — existing string / number / boolean narrowing chain
if (typeof src.displayName === "string" && src.displayName.length > 0) {
  out.displayName = src.displayName;
}
if (typeof src.title === "string" && src.title.length > 0) {
  out.title = src.title;
}
// ... colorHue (number + range guard) ...
if (typeof src.voice === "string" && src.voice.length > 0) {
  out.voice = src.voice;
}
if (typeof src.avatar === "string" && src.avatar.length > 0) {
  out.avatar = src.avatar;
}
if (typeof src.coordinator === "boolean") {
  out.coordinator = src.coordinator;
}
```

**Phase 80 addition (mirror `voice`/`title` shape):**
```typescript
// After the existing avatar / coordinator narrowing lines:
if (typeof src.task === "string" && src.task.length > 0) {
  out.task = src.task;
}
```

**Return-type addition (L2095-2102 + L2113-2120):** add `task?: string` to both the JSDoc return-type union and the local `out` type declaration.

**Landmine preserved (RESEARCH §5):** the outer `try { parsed = yaml.load(...) } catch { return {}; }` (L2106-2110) MUST stay — do not harden to throw. GET /identities depends on the swallow semantic so a single malformed identity file does not cascade to a 500.

---

#### `src/backend/database/routes/identities.ts` — extend `publicIdentity`

**Analog:** itself (existing serializer L109-143).

**Existing shape (copy pattern):**
```typescript
// L109-143 — publicIdentity emits: identityKey, displayName, title, colorHue,
// voice, avatarMime, avatarUrl, avatarEtag, coordinator, role
export function publicIdentity(
  identityKey: string,
  hostId: number,
  cosmetics: {
    displayName?: string;
    title?: string;
    colorHue?: number;
    voice?: string;
    avatarMime?: string;
    avatarEtag?: string;
    coordinator?: boolean;
  } = {},
  role: string | null = null,
) {
  return {
    identityKey,
    displayName: /* ... capitalizeFirst fallback ... */,
    title: typeof cosmetics.title === "string" ? cosmetics.title : null,
    colorHue: typeof cosmetics.colorHue === "number" ? cosmetics.colorHue : null,
    voice: typeof cosmetics.voice === "string" ? cosmetics.voice : null,
    // ... avatarMime, avatarUrl, avatarEtag, coordinator ...
    role,
  };
}
```

**Phase 80 addition:**
1. Add `task?: string` to the `cosmetics` type arg.
2. Emit `task: typeof cosmetics.task === "string" ? cosmetics.task : null` on the returned object (matches the `voice`/`title` null-fallback shape).
3. Downstream call site at L219-221 (`extractCosmeticsFromFrontmatter → publicIdentity`) picks up the new field automatically since `cosmetics` is spread by name.

---

#### `src/backend/database/routes/identity-birth-orchestrator.ts` — extend `BirthOptions` + `buildIdentityFileBody`

**Analog:** itself (existing frontmatter emitter L345-380).

**Existing pattern (copy for `task`):**
```typescript
// L345-380 — buildIdentityFileBody builds ordered pairs then yaml.dump()
function buildIdentityFileBody(
  opts: BirthOptions,
  displayName: string,
  avatarFilename: string,
): string {
  const pairs: Array<[string, string | number]> = [];
  pairs.push(["role", opts.role]);
  pairs.push(["displayName", displayName]);
  // title: skip if null OR empty-after-trim (absent-⇒-omit)
  if (typeof opts.title === "string" && opts.title.trim().length > 0) {
    pairs.push(["title", opts.title]);
  }
  // colorHue: skip if null (integer 0 is a valid hue — do NOT skip on falsy)
  if (opts.colorHue !== null && opts.colorHue !== undefined) {
    pairs.push(["colorHue", opts.colorHue]);
  }
  if (typeof opts.voice === "string" && opts.voice.trim().length > 0) {
    pairs.push(["voice", opts.voice]);
  }
  pairs.push(["avatar", avatarFilename]);

  const yamlBody = yaml.dump(Object.fromEntries(pairs), {
    sortKeys: false,     // preserve insertion order
    lineWidth: -1,       // no line-wrapping
    noRefs: true,        // no yaml anchors
    forceQuotes: false,  // yaml.dump auto-quotes when needed (T-66-01-04)
  });
  return `---\n${yamlBody}---\n\n${IDENTITY_FILE_SEED_COMMENT}\n\n# ${opts.name}\n`;
}
```

**Phase 80 addition (mirror `voice`/`title` gate; task lives AFTER avatar per RESEARCH):**
```typescript
// After the avatar push, before yaml.dump:
if (typeof opts.task === "string" && opts.task.trim().length > 0) {
  pairs.push(["task", opts.task]);
}
```

**`BirthOptions` interface addition (L111-130):** add `task?: string` (optional; write-once-at-creation per D-05).

**Landmine preserved (RESEARCH §12):** `buildIdentityFileBody` returns ONE atomic string. `writeMarkdownFileAtomic` uses `ext_openssh_rename` for atomic overwrite — no half-written state possible. Preserve this. Do NOT split task into a separate write step.

---

#### `src/backend/database/routes/identity-birth.ts` — accept `task` in request body

**Analog:** itself (existing body validation L84-127).

**Existing validation pattern:**
```typescript
// L96-127 — one typeof + trim guard per field, 400 with distinct error string
if (typeof name !== "string" || !name.trim()) {
  res.status(400).json({ error: "name is required" });
  return;
}
if (typeof title !== "string" || !title.trim()) {
  res.status(400).json({ error: "title is required" });
  return;
}
// colorHue / voice: optional nullable — allow null OR undefined:
if (colorHue !== null && colorHue !== undefined && typeof colorHue !== "number") {
  res.status(400).json({ error: "colorHue must be a number or null" });
  return;
}
```

**Phase 80 addition (mirror the `voice`/`colorHue` nullable-optional shape):**
```typescript
// After voice validation, before parsed* coercion:
if (task !== null && task !== undefined && typeof task !== "string") {
  res.status(400).json({ error: "task must be a string or null" });
  return;
}
// Task cap: reject > 500 chars (defense; frontend soft-caps ~200 chars).
if (typeof task === "string" && task.length > 500) {
  res.status(400).json({ error: "task must be ≤500 chars" });
  return;
}
const parsedTask = (typeof task === "string" ? task.trim() : null) as string | null;

// Then in birthIdentity() call at L233-247:
await birthIdentity(
  {
    userId, hostId,
    name: name.trim(),
    title: title.trim(),
    path: parsedPath,
    colorHue: parsedColorHue,
    voice: parsedVoice,
    task: parsedTask ?? undefined,  // omit-empty to match BirthOptions optional shape
    avatarCandidateId: avatarCandidateId.trim(),
    role: role.trim(),
  },
  emit,
  deps,
);
```

**Landmine preserved (RESEARCH §7):** the `getMatrixAdminCreds()` 503 fail-early gate at L158-165 stays untouched. Any new task-related validation must land BEFORE the SSE `flushHeaders()` at L174 so 400 errors surface as JSON, not as an SSE stream with a failed event.

---

#### `src/backend/matrix/matrix-admin-client.ts` — add `countUsersMatching`

**Analog:** itself (existing `loginAsUser` L127-171 — byte-shape mirror).

**Existing primitive shape (copy every line except URL/method/response parse):**
```typescript
// L127-171 loginAsUser — same discriminated union return, same timeout,
// same error taxonomy (ERR_CREDS_MISSING / ERR_NON_2XX / ERR_TIMEOUT / ERR_PROXY)
export async function loginAsUser(
  mxid: string,
  validUntilMs?: number,
): Promise<LoginAsUserOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const url = `${creds.homeserverBase}/_synapse/admin/v1/users/${encodeURIComponent(mxid)}/login`;
  const body = validUntilMs !== undefined ? { valid_until_ms: validUntilMs } : {};

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { ok: false, status: response.status, error: ERR_NON_2XX };
    }
    const parsed = (await response.json()) as { access_token?: string };
    // ... field extraction + validation ...
    return { ok: true, accessToken };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_login_as_user",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}
```

**Phase 80 new primitive (drop into same file, mirror discipline):**
```typescript
// countUsersMatching — GET /_synapse/admin/v2/users?user_id=<pattern>&deactivated=true&limit=1
//
// Substring filter on user_id; deactivated=true INCLUDES deactivated accounts
// (crucial — Synapse deactivates but never deletes; deactivated usernames stay
// reserved per shape file §Naming). limit=1 because we only need `total`.

export type CountUsersOk = AdminOk<{ total: number }>;

export async function countUsersMatching(
  prefix: string,
): Promise<CountUsersOk | AdminErr> {
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return { ok: false, status: 500, error: ERR_CREDS_MISSING };
  }

  const url = `${creds.homeserverBase}/_synapse/admin/v2/users?user_id=${encodeURIComponent(prefix)}&deactivated=true&limit=1`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${creds.accessToken}`,
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      return { ok: false, status: response.status, error: ERR_NON_2XX };
    }
    const parsed = (await response.json()) as { total?: number };
    return { ok: true, total: typeof parsed.total === "number" ? parsed.total : 0 };
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof DOMException && err.name === "AbortError") {
      return { ok: false, status: 504, error: ERR_TIMEOUT };
    }
    databaseLogger.error("matrix admin proxy error", err, {
      operation: "matrix_admin_count_users",
    });
    return { ok: false, status: 502, error: ERR_PROXY };
  }
}
```

**Discipline points (mirror existing):**
- `encodeURIComponent()` on every path arg (defense per T-75-05).
- Never log admin token, never log response bodies.
- `clearTimeout(timeoutId)` in BOTH success + error paths.
- Discriminated-union return; caller narrows via `if (result.ok)`.

---

#### `src/backend/database/database.ts` — mount pool router

**Analog:** existing `/identities/avatar` mount L1832 (mount-before-generic pattern).

**Existing mount pattern (L1829-1877):**
```typescript
// Phase 20 (IDUI-04): identity avatar batch — mount BEFORE /identities so
// /identities/avatar/batch and /identities/avatar/candidate/:id don't collide
// with the generic /identities/:id/* routes in identitiesRoutes.
app.use("/identities/avatar", identityAvatarBatchRoutes);
// Phase 20 (IDUI-06): compound birth endpoint with SSE progress stream — mount
// at /identities/birth BEFORE the general /identities mount ...
app.use("/identities/birth", identityBirthRoutes);
// Phase 22 (SRIC-03): identity clone endpoint — mounted at /identities/clone
// BEFORE the general /identities mount so the exact path wins.
app.use("/identities/clone", identityCloneRoutes);
// ... (identity-exists-on-host, no-dormancy, roles) ...
app.use("/identities", identitiesRoutes);  // Generic catch-all — LAST
```

**Phase 80 addition (drop next to the other /identities/xxx mounts, BEFORE L1877 generic):**
```typescript
// Phase 80: pool-name picker — mount BEFORE /identities so
// /identities/pool/pick resolves here and does not fall through to the
// generic identitiesRoutes /:identityKey handler (which would 400 "identityKey
// must match [a-z0-9_-]{1,64}" because "pool" fails the pattern).
app.use("/identities/pool", identityPoolRoutes);
```

**Landmine preserved (RESEARCH §4):** mount ordering is load-bearing. `/identities/pool` MUST land above `app.use("/identities", identitiesRoutes)` at L1877.

---

#### `src/backend/database/routes/identity-clone.ts` — decide task inheritance

**Analog:** `identity-birth.ts` for the `task` body-validation pattern.

**Recommendation (RESEARCH §4 Stream 4 A3):** clone gets a fresh task, does NOT inherit from source. Task is the WHY of THIS new spawn.

**Steps:**
1. Add `task` to body-validation block (same shape as `identity-birth.ts` addition above).
2. Add `task` to the frontmatter written by `writeMarkdownFileAtomic` — mirror `buildIdentityFileBody` pattern (typeof + trim guard, absent-⇒-omit).
3. Do NOT read `source.task` and copy — always take the request's `task` value.

---

### Backend New Files

---

#### `src/backend/pool/pool-loader.ts` (NEW)

**Analog:** `src/backend/branding/branding-config-loader.ts` — direct byte-shape mirror.

**Copy pattern (branding-config-loader.ts L118-155 `getBundledDefaults`):**
```typescript
// Module-scope memoization; sync readFileSync inside; never throws.
let cachedBundledDefaults: BrandingConfig | null = null;

export function getBundledDefaults(): BrandingConfig {
  if (cachedBundledDefaults !== null) return cachedBundledDefaults;
  const defaultsPath = path.join(getBundledDefaultsDir(), BRANDING_CONFIG_FILENAME);
  try {
    const raw = readFileSync(defaultsPath, "utf-8");
    const parsed: unknown = JSON.parse(raw);
    if (isValidBrandingShape(parsed)) {
      cachedBundledDefaults = parsed as BrandingConfig;
      return cachedBundledDefaults;
    }
    sshLogger.error("branding-config-loader: bundled defaults shape invalid", { ... });
  } catch (err) {
    sshLogger.error("branding-config-loader: bundled defaults read error", { ... });
  }
  cachedBundledDefaults = HARDCODED_FALLBACK;
  return cachedBundledDefaults;
}
```

**Phase 80 shape (drop-in mirror):**
```typescript
import { readFileSync } from "node:fs";
import path from "node:path";
import { sshLogger } from "../utils/logger.js";

export const POOL_FILENAME = "pool.json";

function getPoolDir(): string {
  return "/app/pool-defaults";
}

interface PoolFile {
  names: string[];
}

let cachedPool: string[] | null = null;

/**
 * Read the vetted pool JSON on first call; memoize result. File is baked into
 * the image at Dockerfile COPY time and never changes at runtime (D-01 lock:
 * "loaded on boot" — runtime hot-reload NOT supported; redeploy to change).
 * Never throws — returns [] on ANY failure (ENOENT, parse, shape-invalid).
 */
export function getVettedPool(): string[] {
  if (cachedPool !== null) return cachedPool;
  const poolPath = path.join(getPoolDir(), POOL_FILENAME);
  try {
    const raw = readFileSync(poolPath, "utf-8");
    const parsed = JSON.parse(raw) as { names?: unknown };
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      Array.isArray((parsed as PoolFile).names) &&
      (parsed as PoolFile).names.every((n) => typeof n === "string" && n.length > 0)
    ) {
      cachedPool = (parsed as PoolFile).names;
      return cachedPool;
    }
    sshLogger.error("pool-loader: shape invalid, returning []", {
      operation: "pool_loader_shape",
      path: poolPath,
    });
    cachedPool = [];
    return cachedPool;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      sshLogger.error("pool-loader: read failed", {
        operation: "pool_loader_read",
        error: err instanceof Error ? err.message : String(err),
        path: poolPath,
      });
    }
    cachedPool = [];
    return cachedPool;
  }
}
```

**Discipline points (mirror branding-config-loader):**
- Module-scope `let cachedXxx: T | null = null` memoization.
- Sync `readFileSync` (fine — called once at first request, results memoized).
- Every error branch returns `[]` (safe default). NEVER throws.
- `sshLogger.error` for surprising errors; ENOENT is silent (missing pool.json is normal for legacy deploys).

**Landmine (RESEARCH §6):** memoization means hot-edits to `/app/pool-defaults/pool.json` require a container restart. Document this in the ship runbook.

---

#### `src/backend/pool/pool-routes.ts` (NEW)

**Analog:** `src/backend/database/routes/roles-list-for-host.ts` L37-233 — same auth/host-resolve/logger discipline.

**Copy pattern:**
```typescript
// roles-list-for-host.ts L37-49 — imports + router setup
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { sshLogger } from "../../utils/logger.js";
import type { AuthenticatedRequest } from "../../../types/index.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const ROLE_NAME_PATTERN = /^[a-z0-9-]+$/;  // kebab-case-lowercase
```

**Handler validation pattern (roles-list-for-host.ts L110-127):**
```typescript
// hostId parse + validate: positive integer or 400
const rawHostId = req.query.hostId;
if (rawHostId === undefined || rawHostId === "") {
  return res.status(400).json({ error: "hostId is required" });
}
const hostId = parseInt(String(rawHostId), 10);
if (!Number.isFinite(hostId) || hostId <= 0 || !Number.isInteger(hostId)) {
  return res.status(400).json({ error: "hostId must be a positive integer" });
}

// Cross-user isolation gate (defense-in-depth per T-22-03-03):
const host = await resolveHostById(hostId, userId);
if (!host) {
  return res.status(404).json({ error: "Host not found" });
}
```

**Phase 80 pool-pick shape (POST body, not query):**
```typescript
import { getVettedPool } from "./pool-loader.js";
import { countUsersMatching } from "../matrix/matrix-admin-client.js";
import { getMatrixAdminCreds } from "../matrix/matrix-admin-creds-store.js";

router.post("/pick", express.json(), authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  const { role, hostId } = req.body as Record<string, unknown>;

  // 1. hostId validation (mirror roles-list-for-host)
  if (typeof hostId !== "number" || !Number.isInteger(hostId) || hostId <= 0) {
    return res.status(400).json({ error: "hostId must be a positive integer" });
  }
  // 2. role validation — kebab-case-lowercase
  if (typeof role !== "string" || !ROLE_NAME_PATTERN.test(role.trim())) {
    return res.status(400).json({
      error: "role is required and must be kebab-case-lowercase",
    });
  }

  // 3. Fail-early on missing matrix admin creds (mirror identity-birth.ts L158-165):
  const creds = await getMatrixAdminCreds();
  if (!creds) {
    return res.status(503).json({
      error: "matrix_admin_foundation_not_ingested",
      detail: "matrix admin foundation not ingested — see deploy runbook",
    });
  }

  // 4. Cross-user host isolation (defense-in-depth):
  const host = await resolveHostById(hostId, userId);
  if (!host) {
    return res.status(404).json({ error: "Host not found" });
  }

  // 5. Load pool (never throws; returns [] if pool.json missing/malformed):
  const pool = getVettedPool();
  if (pool.length === 0) {
    return res.status(503).json({ error: "pool is empty — see deploy runbook" });
  }

  // 6. Pick algorithm (Shape A per RESEARCH §8 recommendation):
  //    - Shuffle pool. For each candidate: countUsersMatching(`@<candidate.lowercase()>:<serverHost>`).
  //    - First candidate with total==0 → return `{ name: candidate.toLowerCase() }`.
  //    - All busy → return the first pool name; birth-orchestrator's ordinal
  //      derivation step will append a suffix at creation time.
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  const serverHost = new URL(creds.homeserverBase).host;  // e.g. "matrix.example.com"

  for (const candidate of shuffled) {
    const mxid = `@${candidate.toLowerCase()}:${serverHost}`;
    const result = await countUsersMatching(mxid);
    if (!result.ok) {
      // Admin API failure — surface a 502 (do NOT leak the pool state).
      return res.status(502).json({ error: "admin API failure" });
    }
    if (result.total === 0) {
      return res.json({ name: candidate.toLowerCase() });
    }
  }
  // All pool names busy on this server — fall back to the first candidate.
  return res.json({ name: shuffled[0].toLowerCase() });
});

// Generic 500 fallback (mirror roles-list-for-host.ts L236-251)
router.use((err: Error, _req: Request, res: Response, _next: express.NextFunction) => {
  sshLogger.error("pool-routes: unhandled error", {
    operation: "pool_routes_error",
    error: err?.message,
  });
  return res.status(500).json({ error: "internal" });
});

export default router;
```

**Discipline points (all mirrored from analog):**
- JWT auth via `AuthManager.getInstance().createAuthMiddleware()`.
- Cross-user host isolation via `resolveHostById(hostId, userId)` — 404 on unowned.
- 503 fail-early on missing matrix admin creds (mirror `identity-birth.ts:158-165`).
- Generic 500 error handler at router base.
- NEVER log admin token or synapse response bodies.

---

#### `docker/pool-defaults/pool.json` (NEW)

**Analog:** `docker/branding-defaults/branding.json`.

**Analog (whole file):**
```json
{
  "appName": "SKYNET",
  "shortName": "SKYNET",
  ... (branding config keys)
}
```

**Phase 80 shape:**
```json
{
  "names": ["Willow", "Cinder", "Aster", "Vega", "Onyx", "Sable", "Fig"]
}
```

Alice's vetted list is being finalized in parallel; ship whatever is landed at ship time (D-01 + shape §Naming). Casing = PascalCase (the pool-pick endpoint lowercases per request).

---

#### `docker/Dockerfile` — add `COPY` line

**Analog:** L78 branding-defaults COPY.

**Existing line (L78):**
```dockerfile
COPY --chown=node:node docker/branding-defaults /app/branding-defaults
```

**Phase 80 addition (insert immediately after L78):**
```dockerfile
COPY --chown=node:node docker/pool-defaults /app/pool-defaults
```

---

#### `src/backend/pool/pool-loader.test.ts` (NEW)

**Analog:** `src/backend/branding/branding-config-loader.test.ts` L1-100 — same `vi.mock("node:fs")` mock-fs pattern.

**Analog test-setup pattern (branding-config-loader.test.ts L60-82):**
```typescript
const state: {
  configJson: unknown | undefined;
  configError: NodeJS.ErrnoException | null;
} = {
  configJson: undefined,
  configError: { code: "ENOENT" } as NodeJS.ErrnoException,
};

vi.mock("node:fs", () => {
  return {
    promises: {
      stat: async () => { if (state.configError) throw state.configError; return { size: 1024 }; },
      readFile: async () => { if (state.configError) throw state.configError; return JSON.stringify(state.configJson); },
    },
    readFileSync: () => JSON.stringify(bundledDefaultJson),
  };
});
```

**Phase 80 test cases (mirror branding-config-loader.test.ts case shape):**
1. Happy path: pool.json exists with valid `{ names: ["Willow", ...] }` → `getVettedPool()` returns array.
2. ENOENT (missing pool.json) → returns `[]` silently (no error log).
3. Malformed JSON → returns `[]` + `sshLogger.error` called.
4. Shape invalid (`names` not array) → returns `[]` + error logged.
5. Shape invalid (`names` contains non-strings) → returns `[]` + error logged.
6. Memoization: two calls only trigger one `readFileSync`.

---

#### `src/backend/pool/pool-routes.test.ts` (NEW)

**Analog:** existing route tests (search for `*routes.test.ts` in `src/backend/database/routes/`).

**Test cases (mirror shape of `roles-list-for-host.test.ts` analog):**
1. Missing JWT → 401.
2. Missing `hostId` in body → 400.
3. Non-numeric `hostId` → 400.
4. Missing `role` → 400.
5. Invalid `role` (uppercase, special chars) → 400.
6. Cross-user hostId spoof → 404.
7. `getMatrixAdminCreds()` returns null → 503 `matrix_admin_foundation_not_ingested`.
8. Empty pool → 503 `pool is empty`.
9. Happy path with `total: 0` on first candidate → returns that name lowercased.
10. All candidates have `total > 0` → returns first pool name lowercased.
11. Admin API failure mid-loop → 502.

---

### Frontend Extensions

---

#### `src/ui/api/identities-api.ts` — add `task` + `pickPoolName`

**Analog:** itself (existing `Identity` interface L3-23 + `openBirthStream` L401+).

**Existing type (copy pattern for `task`):**
```typescript
// L3-23
export interface Identity {
  identityKey: string;
  displayName: string;
  title: string | null;
  colorHue: number | null;
  voice: string | null;
  role: string | null;
  avatarMime: string;
  avatarUrl: string;
  avatarEtag: string;
  coordinator: boolean;
}
```

**Phase 80 addition:**
```typescript
export interface Identity {
  // ... existing fields ...
  coordinator: boolean;
  /** Phase 80: task string from identity file frontmatter. Null when absent
   *  (existing pre-Phase-80 identities; coord-spawned identities without task).
   *  Present-and-truthy gates the task-primary UI treatment on chat + list
   *  surfaces (D-06 fallback semantics). */
  task: string | null;
}
```

**Existing BirthRequest (L374-384) — copy pattern:**
```typescript
export interface BirthRequest {
  hostId: number;
  name: string;
  title: string;
  path: string;
  colorHue: number | null;
  voice: string | null;
  avatarCandidateId: string;
  role: string;
}
```

**Phase 80 addition:**
```typescript
export interface BirthRequest {
  // ... existing fields ...
  role: string;
  /** Phase 80: optional task string ("what will this agent work on?").
   *  Frontend soft-caps ~200 chars; backend hard-caps 500 chars. */
  task?: string;
}
```

**New API call (add near other identity-api exports):**
```typescript
/**
 * Phase 80: fetch an unused pool name for the given role on the given host.
 * Backend picks a bare pool name (lowercase) not currently in use as a Matrix
 * account on the target server. User can edit thereafter (pool is a suggestion
 * source, not a restriction).
 */
export async function pickPoolName(
  role: string,
  hostId: number,
): Promise<{ name: string }> {
  try {
    const response = await authApi.post("/identities/pool/pick", { role, hostId });
    return response.data as { name: string };
  } catch (error) {
    handleApiError(error, "pick pool name");
  }
}
```

---

#### `src/ui/sidebar/NewSessionDialog.tsx` — unified modal rebuild

**Analog:** itself. **Extend, do not rewrite** (RESEARCH §10 landmine — 1400 lines, multiple test files must be preserved).

**Existing chain-prefill mechanism (copy for pool-pick trigger):**
```typescript
// L397-410 — on-open effect seeds initialHost + initialRole from chain props
useEffect(() => {
  if (open) {
    if (initialHost) {
      setSelectedHost(initialHost);
      if (initialRole && identityMode) {
        setSelectedRole(initialRole);
      }
    } else if (flatHosts.length === 1) {
      setSelectedHost(flatHosts[0]);
    }
    if (initialBrief && identityMode) {
      setBrief(initialBrief);
    }
  } else {
    // ... reset state ...
  }
}, [open, initialHost, initialRole, initialBrief]);
```

**Existing role dropdown (L961-1010) — copy pattern for task input:**
```typescript
// L961-1010 — role dropdown gated on selectedHost !== null
{selectedHost !== null && (
  <div className="flex flex-col gap-1.5">
    <label
      htmlFor="new-identity-role"
      className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
    >
      Role
    </label>
    <select
      id="new-identity-role"
      aria-label="Role"
      value={selectedRole}
      onChange={(e) => setSelectedRole(e.target.value)}
      disabled={formDisabled || rolesLoading}
      className="w-full rounded-sm border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)] px-3 py-2 text-xs text-[color:var(--color-pv-fg)] outline-none disabled:opacity-50"
    >
      {/* ... options ... */}
    </select>
    {/* ... error/no-roles hint ... */}
  </div>
)}
```

**Phase 80 additions:**

1. **New state:** `const [task, setTask] = useState<string>("");`

2. **Task input (textarea)** — position above the Name input in the identity cluster, gated on `identityMode`:
```typescript
{identityMode && (
  <div className="flex flex-col gap-1.5">
    <label
      htmlFor="new-identity-task"
      className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
    >
      What will this agent work on?
    </label>
    <textarea
      id="new-identity-task"
      aria-label="Task"
      value={task}
      onChange={(e) => setTask(e.target.value)}
      maxLength={200}  /* soft-cap — executor pins exact number at implementation time (D-Claude's Discretion) */
      rows={2}
      disabled={formDisabled}
      className="w-full rounded-sm border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)] px-3 py-2 text-xs text-[color:var(--color-pv-fg)] outline-none disabled:opacity-50 resize-none"
      placeholder="Describe the task in 15-20 words…"
    />
  </div>
)}
```

3. **Pool auto-prefill on role change** — new useEffect keyed on `[selectedRole, selectedHost, identityMode]`:
```typescript
useEffect(() => {
  if (!identityMode || !selectedRole || !selectedHost) return;
  const hostIdNum = parseInt(String(selectedHost.id), 10);
  if (!Number.isFinite(hostIdNum)) return;
  let cancelled = false;
  (async () => {
    try {
      const { name: poolName } = await pickPoolName(selectedRole, hostIdNum);
      if (!cancelled && name === "") {   // only prefill if user hasn't typed yet
        setName(poolName);
      }
    } catch {
      // silent: pool endpoint failure just means no prefill — user types manually
    }
  })();
  return () => { cancelled = true; };
}, [selectedRole, selectedHost, identityMode]);
```

4. **Role-select bug fix (RESEARCH §2 landmine):** the role dropdown is gated on `selectedHost !== null` (L961). Fix candidates for Alice to confirm:
   - Default-select local Skynet host when `identityMode` is on AND no host chosen (widens the auto-pick condition beyond the existing `flatHosts.length === 1` case).
   - OR render a "pick a host first" hint outside the current `{selectedHost !== null && (...)}` wrap.

5. **Pass task to birth request:**
```typescript
// At openBirthStream call site — add `task: task.trim() || undefined` to the request body.
```

**Preserve landmines:**
- All existing tests: `NewSessionDialog.test.tsx`, `NewSessionDialog.chain.test.tsx`, `NewSessionDialog.role-dropdown.test.tsx` must continue passing.
- Reset state on close (L440-459) — add `setTask("")`.
- Chain-hook mechanism (initialHost/initialRole/initialBrief) stays.

---

#### `src/ui/sidebar/CloneAgentDialog.tsx` — repurpose or delete

**Analog:** `NewSessionDialog.tsx` chain-prefill mechanism L397-410 + `PrettyConversationsPanel.handleRowClone` L1248-1263.

**Recommendation (RESEARCH §11):** delete CloneAgentDialog entirely; rewire `handleRowClone` to open NewSessionDialog with `initialHost = row.host`, `initialRole = identity.role`.

**Existing panel handler (PrettyConversationsPanel.tsx L1248-1263):**
```typescript
const handleRowClone = (row: ConversationRowShape) => {
  const matchKey = sessionMatchKey(row.targetTmuxSession);
  if (!matchKey) return;
  const identity = identitiesByKey.get(matchKey);
  if (!identity) return;
  if (!row.host) return;
  const hostIdNum = parseInt(row.host.id, 10);
  if (!Number.isFinite(hostIdNum)) return;
  setCloneDialogState({
    sourceIdentity: identity,
    hostId: hostIdNum,
    sourceHost: row.host,
  });
};
```

**Phase 80 rewire (chain into NewSessionDialog instead):**
```typescript
const handleRowClone = (row: ConversationRowShape) => {
  const matchKey = sessionMatchKey(row.targetTmuxSession);
  if (!matchKey) return;
  const identity = identitiesByKey.get(matchKey);
  if (!identity || !identity.role) return;
  if (!row.host) return;
  setNewSessionDialogState({
    initialHost: row.host,
    initialRole: identity.role,
    // task deliberately NOT prefilled — clone is spawn-under-role with fresh task (A3)
  });
};
```

**Rename context-menu label (PrettyConversationRow.tsx L1352):**
```typescript
// Existing:
items.push({ label: "Clone", onClick: onClone });
// Phase 80:
items.push({ label: "Spawn under this role", onClick: onClone });
```

**Test file impact:**
- `CloneAgentDialog.test.tsx` — delete if CloneAgentDialog is deleted, or rewrite to assert opens NewSessionDialog.
- `PrettyConversationsPanel.clone-dialog.test.tsx` — rewrite to assert new chain flow.
- `PrettyConversationRow.clone-menu.test.tsx` — update expected label.

---

#### `src/ui/features/pretty-view/PrettyView.tsx` — add task pill

**Analog:** `src/ui/features/terminal/IdentityBadge.tsx` L102-116 (glass treatment formula).

**Existing IdentityBadge glass formula (copy exactly, adjust sizing):**
```typescript
// IdentityBadge.tsx L101-116
const hue = identity.colorHue ?? 35;
const rootClassName = `pv-identity-breathe absolute top-4 right-5 z-[101] flex flex-row items-center gap-3 select-none font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif] transition-transform hover:scale-[1.015] active:scale-[0.995] hover:shadow-[0_8px_24px_rgba(0,0,0,0.6),_inset_0_1px_0_rgba(255,220,170,0.22),_0_0_56px_hsla(${hue},65%,55%,0.42)]`;
const rootStyle: React.CSSProperties = {
  borderRadius: 36,
  overflow: "hidden",
  padding: "8px 18px 8px 8px",
  background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.72), hsla(${hue}, 40%, 15%, 0.82))`,
  backdropFilter: "blur(24px) saturate(1.4)",
  WebkitBackdropFilter: "blur(24px) saturate(1.4)",
  border: `1px solid hsla(${hue}, 65%, 55%, 0.4)`,
  boxShadow: `0 8px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,220,170,0.18), 0 0 40px hsla(${hue}, 65%, 55%, 0.28)`,
  color: "#e8e4d8",
  animation: "pv-identity-breathe 5s ease-in-out infinite",
};
```

**Existing PrettyView mount point (PrettyView.tsx L3011-3019):**
```typescript
{pvIdentityKey && (
  <IdentityBadge
    identityKey={pvIdentityKey}
    hostId={hostId}
    onClick={() => setIsIdentityModalOpen(true)}
    onLongPress={onTogglePrettyMode}
    tabId={tabId}
  />
)}
```

**Phase 80 addition (sibling to IdentityBadge, absolute-centered top, gated on `pvIdentity?.task`):**
```typescript
{pvIdentity?.task && (
  <div
    className="absolute top-4 left-1/2 -translate-x-1/2 z-[100] pv-identity-breathe select-none font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif]"
    style={{
      borderRadius: 20,
      padding: "6px 14px",
      maxWidth: "50%",
      // Copy IdentityBadge glass formula — same hsla(hue, ...) values;
      // hue reads from pvIdentity.colorHue (per-identity today, per-role post-B).
      background: `linear-gradient(160deg, hsla(${pvIdentity.colorHue ?? 35}, 45%, 25%, 0.72), hsla(${pvIdentity.colorHue ?? 35}, 40%, 15%, 0.82))`,
      backdropFilter: "blur(24px) saturate(1.4)",
      WebkitBackdropFilter: "blur(24px) saturate(1.4)",
      border: `1px solid hsla(${pvIdentity.colorHue ?? 35}, 65%, 55%, 0.4)`,
      boxShadow: `0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,170,0.14), 0 0 24px hsla(${pvIdentity.colorHue ?? 35}, 65%, 55%, 0.24)`,
      color: "#e8e4d8",
      fontSize: 13,
      fontWeight: 500,
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      animation: "pv-identity-breathe 5s ease-in-out infinite",
    }}
  >
    {pvIdentity.task}
  </div>
)}
```

**z-index discipline (RESEARCH §Stream 7):** IdentityBadge is `z-[101]`; pill goes `z-[100]` (below so drag/click on badge stays priority).

**Alternative:** extract to `src/ui/features/terminal/TaskPill.tsx` for test-in-isolation. Signature: `{ task: string; colorHue: number | null }`.

---

#### `src/ui/features/pretty-conversations/PrettyConversationRow.tsx` — task-primary body swap

**Analog:** itself (existing `.pv-body` markup L1273-1288). D-03 locks reuse of `.pv-label` and `.pv-ai-title` classes verbatim.

**Existing markup (L1273-1288 — becomes the fallback branch):**
```typescript
<div className="pv-body">
  <span className="pv-label">
    {identity ? identity.displayName : row.label}
    {(identity?.title || row.host?.name) && (
      <span className="pv-hostname-suffix">
        {" "}
        ({identity?.title || row.host?.name})
      </span>
    )}
  </span>
  {aiTitle !== null ? (
    <span className="pv-ai-title">{aiTitle}</span>
  ) : (
    <span className="pv-ai-title pv-ai-title--placeholder">…</span>
  )}
</div>
```

**Existing CSS classes (pretty-conversations.css L686-756) — REUSE verbatim:**
- `.pv-body` — column flex container.
- `.pv-body .pv-label` — top-line typography (14px, weight 600, cream color, fade-truncation).
- `.pv-body .pv-label .pv-hostname-suffix` — muted parens on the top line (alpha 0.85).
- `.pv-body .pv-ai-title` — subtitle-line typography (13.5px, weight 500, brighter cream).

**Phase 80 swap (gate on `identity?.task` truthy; fallback preserved verbatim per D-06):**
```typescript
<div className="pv-body">
  {identity?.task ? (
    <>
      {/* Top line: task inherits .pv-label style (D-03 no-new-vocabulary) */}
      <span className="pv-label">{identity.task}</span>
      {/* Subtitle: role prominent + (name) muted parens.
          Reuses .pv-ai-title styling; role prominence via <strong>; name uses
          existing .pv-hostname-suffix muted-parens style. */}
      <span className="pv-ai-title">
        <strong>{identity.role}</strong>
        {" "}
        <span className="pv-hostname-suffix">({identity.displayName})</span>
      </span>
    </>
  ) : (
    // Fallback (D-06) — current markup preserved verbatim:
    <>
      <span className="pv-label">
        {identity ? identity.displayName : row.label}
        {(identity?.title || row.host?.name) && (
          <span className="pv-hostname-suffix">
            {" "}
            ({identity?.title || row.host?.name})
          </span>
        )}
      </span>
      {aiTitle !== null ? (
        <span className="pv-ai-title">{aiTitle}</span>
      ) : (
        <span className="pv-ai-title pv-ai-title--placeholder">…</span>
      )}
    </>
  )}
</div>
```

**Rename context-menu (L1352):** `label: "Clone"` → `label: "Spawn under this role"` (shape §Frontend creation flow).

**Escape hatch (D-03):** if executor discovers the role-prominent subtitle needs pixel tuning (role weight vs the current 500), add a small sibling class like `.pv-role-prominent` to `pretty-conversations.css`. Not required at plan time.

---

#### `src/ui/features/pretty-conversations/pretty-conversations.css` — no new selectors (per D-03)

**Analog:** existing `.pv-body` L686-756.

**Phase 80 stance:** REUSE VERBATIM. D-03 explicitly locks "reuse the existing top-line and subtitle-line typographic behavior — no new vocabulary invented." The `<strong>` tag inside `.pv-ai-title` inherits weight naturally.

**Only add a new class if executor discovers a pixel-level mismatch during implementation (D-03 "any pixel-level tuning surfaces as executor decision, not planning question").**

---

## Shared Patterns

### Authentication (all new backend endpoints)

**Source:** `src/backend/utils/auth-manager.js` via `AuthManager.getInstance().createAuthMiddleware()`.

**Apply to:** `pool-routes.ts POST /pick`, any new endpoint added in Phase 80.

**Pattern (from roles-list-for-host.ts L46-49):**
```typescript
const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

router.post("/pick", express.json(), authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  // ...
});
```

---

### Host ownership isolation (any endpoint taking hostId)

**Source:** `src/backend/ssh/host-resolver.ts` — `resolveHostById(hostId, userId)`.

**Apply to:** `pool-routes.ts` (defense-in-depth per T-22-03-03).

**Pattern (from roles-list-for-host.ts L122-126):**
```typescript
const host = await resolveHostById(hostId, userId);
if (!host) {
  return res.status(404).json({ error: "Host not found" });
}
```

Cross-user hostId spoofing returns 404 (not 200 with empty data, not 403).

---

### Matrix admin creds fail-early gate

**Source:** `src/backend/matrix/matrix-admin-creds-store.ts` — `getMatrixAdminCreds()`.

**Apply to:** `pool-routes.ts` (needs creds for `countUsersMatching`).

**Pattern (from identity-birth.ts L158-165):**
```typescript
const creds = await getMatrixAdminCreds();
if (!creds) {
  return res.status(503).json({
    error: "matrix_admin_foundation_not_ingested",
    detail: "matrix admin foundation not ingested — see deploy runbook",
  });
}
```

503 lands BEFORE any SSE or long-running work opens. Non-ingested deployment gets a clear signal rather than a mid-stream failure.

---

### Frontmatter scalar narrowing (any new cosmetics-like field)

**Source:** `src/backend/claude-session/identity-artifact-reader.ts:2121-2143`.

**Apply to:** `task` field addition in `extractCosmeticsFromFrontmatter`.

**Pattern:**
```typescript
if (typeof src.FIELD === "string" && src.FIELD.length > 0) {
  out.FIELD = src.FIELD;
}
```

- Non-empty string → keep.
- Everything else → drop (do NOT default; caller distinguishes present-with-value from absent).
- YAML parse errors swallowed at the outer `try/catch` → return `{}`. Preserve this discipline (RESEARCH §5).

---

### Frontmatter scalar emission (any new field on birth)

**Source:** `src/backend/database/routes/identity-birth-orchestrator.ts:345-380`.

**Apply to:** `task` field addition in `buildIdentityFileBody`.

**Pattern:**
```typescript
if (typeof opts.FIELD === "string" && opts.FIELD.trim().length > 0) {
  pairs.push(["FIELD", opts.FIELD]);
}
```

- Empty / whitespace-only → omit key entirely from frontmatter (absent-⇒-omit invariant).
- `yaml.dump` with `forceQuotes: false` correctly auto-quotes strings containing colons/newlines (T-66-01-04). Task strings CAN contain colons and quotes; do NOT hand-quote — let `yaml.dump` handle it.

---

### Discriminated-union return from matrix admin primitives

**Source:** `src/backend/matrix/matrix-admin-client.ts:40-42` (`AdminOk<T>` / `AdminErr`).

**Apply to:** new `countUsersMatching` primitive.

**Pattern:**
```typescript
type AdminOk<T> = { ok: true } & T;
type AdminErr = { ok: false; status: number; error: string };

// Caller narrows via ok:
const result = await countUsersMatching(mxid);
if (!result.ok) {
  // handle error using result.status / result.error
  return;
}
// TypeScript narrows result to { ok: true; total: number } here
console.log(result.total);
```

Error taxonomy shared across all primitives: `matrix_admin_creds_missing` / `admin_api_non_2xx` / `admin_api_timeout` / `admin_api_proxy_error`. Reuse existing constants.

---

### JSON seed loader (any new baked-in-image JSON)

**Source:** `src/backend/branding/branding-config-loader.ts:118-155`.

**Apply to:** new `pool-loader.ts`.

**Pattern:**
- Module-scope `let cachedX: T | null = null` memoization.
- Sync `readFileSync` (once, at first request — memoized).
- ENOENT branch returns safe default silently (no error log).
- Malformed / shape-invalid / other errors log via `sshLogger.error` and return safe default.
- NEVER throws.
- Requires Dockerfile `COPY` line to bake the source directory into `/app/xxx-defaults/`.

---

### Glass-treatment inline-style (any new hue-tinted UI element)

**Source:** `src/ui/features/terminal/IdentityBadge.tsx:102-116`.

**Apply to:** task pill on chat surface (PrettyView).

**Pattern (Phase 80 pill uses same hsla ratios, smaller padding + shadow):**
```typescript
const hue = identity.colorHue ?? 35;  // fallback hue matches PrettyView's --pv-id-hue
background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.72), hsla(${hue}, 40%, 15%, 0.82))`,
backdropFilter: "blur(24px) saturate(1.4)",
WebkitBackdropFilter: "blur(24px) saturate(1.4)",
border: `1px solid hsla(${hue}, 65%, 55%, 0.4)`,
boxShadow: `0 4px 12px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,220,170,0.14), 0 0 24px hsla(${hue}, 65%, 55%, 0.24)`,
color: "#e8e4d8",
animation: "pv-identity-breathe 5s ease-in-out infinite",
```

Keep the same `animation: "pv-identity-breathe"` name so the pill breathes in sync with the badge.

---

### Route mount ordering discipline

**Source:** `src/backend/database/database.ts:1829-1877`.

**Apply to:** new `/identities/pool` mount.

**Rule:** any subpath router under `/identities/xxx` MUST mount BEFORE the generic `app.use("/identities", identitiesRoutes)` at L1877. Otherwise Express matches the generic `/:identityKey` handler first and rejects with 400 because "pool" (or "avatar", "birth", "clone") fails the `IDENTITY_KEY_RE` pattern.

---

## No Analog Found

None. Every file in Phase 80 has a clear existing analog. This phase is an additive extension of well-established patterns from Phases 22 (SRIC identity modal + roles), 66 (disk-authoritative cosmetics), 68/69 (identities DB table killed), 70 (branding-config seed loader), 75/77 (matrix admin foundation + birth-orchestrator).

---

## Landmines Referenced (from RESEARCH.md §Landmines)

| # | Landmine | Preserved by | Where to look |
|---|----------|--------------|---------------|
| 1 | Skynet in-memory SQLite `forceSave` | Task is disk-only (D-05); no DB writes | identity-birth-orchestrator L191-193 comment |
| 2 | Role select gated on host | Fix in NewSessionDialog rebuild | NewSessionDialog.tsx L961 |
| 3 | Identity cross-user access | `resolveHostById(hostId, userId)` on pool-pick | pool-routes.ts step 4 |
| 4 | Route mount ordering | `/identities/pool` before generic `/identities` | database.ts L1877 |
| 5 | Frontmatter YAML parse-error swallow | Preserve outer try/catch return `{}` | identity-artifact-reader.ts L2106-2110 |
| 6 | Pool memoization + hot-reload | Redeploy required; document in ship runbook | pool-loader.ts (this file, comment) |
| 7 | Matrix admin creds gate | 503 fail-early at pool-routes entry | mirror identity-birth.ts L158-165 |
| 8 | Pool exhaustion / all-taken race | Shape A picker: never fail, birth-orchestrator handles ordinal | pool-routes.ts step 6 |
| 9 | Identity key vs MXID localpart divergence | Locked (A1) → planner confirm with Alice in discuss-phase | shape §Naming |
| 10 | Modal rebuild regression risk | Extend NewSessionDialog, preserve all existing tests | NewSessionDialog.tsx (whole file) |
| 11 | `initialRole` chain-prefill exists | Reuse chain mechanism for clone-modal repurpose | NewSessionDialog.tsx L399-407 |
| 12 | Birth-orchestrator Q2 no-rollback | Task write is part of atomic buildIdentityFileBody → writeMarkdownFileAtomic | identity-birth-orchestrator.ts L345-380 + L660-671 |

---

## Metadata

**Analog search scope:**
- `src/backend/{branding,matrix,pool,claude-session,database/routes,ssh,utils}/`
- `src/ui/{api,sidebar,features/{pretty-view,pretty-conversations,terminal},components,state}/`
- `docker/{Dockerfile,branding-defaults,pool-defaults}/`

**Files scanned (representative):** ~40 (10 backend + 20 frontend + 10 test/config).

**Files read for pattern extraction:** 14 (all HIGH-confidence, all traced to specific line numbers per RESEARCH.md §Sources).

**Pattern extraction date:** 2026-09-06

---

*Phase: 80-id-skill-revamp-phase-a-skynet-frontend-and-backend-for-pool*
*Patterns mapped: 2026-09-06*
