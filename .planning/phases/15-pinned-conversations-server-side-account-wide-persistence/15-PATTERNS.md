# Phase 15: Pinned conversations — server-side account-wide persistence - Pattern Map

**Mapped:** 2026-07-27
**Files analyzed:** 6 new-or-modified files (2 backend, 3 frontend, 1 config)
**Analogs found:** 6 / 6 — every anticipated file has a strong exact-shape analog already living in the repo.

**Bottom line for the planner:** every non-negotiable decision (endpoint shape, auth wiring, storage table type, nginx location block, store-mutator persistence pattern, panel mount-effect pattern, and both test harnesses) has a working exemplar in the codebase within the last three months of patches. The planner does not need to design any of this from scratch — the choice between Option A (new table) vs Option B (JSON column on `user_preferences`) and Option A (extend `/user-preferences`) vs Option B (new `/user/pins`) reduces cleanly to picking between two equally-well-worn paths, both of which are documented below with concrete code.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/database/db/schema.ts` (MODIFY — add column OR add table) | schema/migration | CRUD | `user_preferences` table @ L735-749 OR `file_manager_pinned` table @ L199-212 | **exact** (both patterns pre-exist in this exact file) |
| `src/backend/database/routes/user-preferences.ts` (MODIFY, endpoint Option A) OR `src/backend/database/routes/user-pins.ts` (NEW, endpoint Option B) | route/controller | request-response | `src/backend/database/routes/user-preferences.ts` (full file) | **exact** (per-user JSON PUT/GET with JWT auth already exists here — this IS the analog whether we extend or clone) |
| `src/backend/database/routes/user-pins.test.ts` (NEW, only if Option B is picked) | test | request-response | `src/backend/database/routes/debug.test.ts` (full file) | **exact** (patch #146 pattern — direct handler call, no Express harness, no AuthManager init) |
| `src/backend/database/database.ts` (MODIFY, only if Option B is picked — add import + `app.use()` line) | config/wiring | — | Existing `app.use("/user-preferences", ...)` @ L1793 + `app.use("/debug", debugRoutes)` @ L1794 | **exact** |
| `docker/nginx.conf` + `docker/nginx-https.conf` (MODIFY, only if Option B is picked with a fresh top-level prefix) | config | — | `location ~ ^/user-preferences(/.*)?$` @ nginx.conf L258-265 / nginx-https.conf L265-272 | **exact** (five-line proxy block; direct copy-and-rename) |
| `src/ui/state/conversation-store.ts` (MODIFY — augment `pinConversation` / `unpinConversation` / add fetch + hydrate primitive) | state | pub-sub + request-response | `addToActiveSet` @ L709-725 + `hydrateActiveSetFromStorage` @ L121-134 + `selectConversation` @ L652-682 | **exact** (patch #137 pattern — augmenting a Zustand-style mutator with a persistence-layer call is exactly what activeSet already does) |
| `src/ui/api/pins-api.ts` (NEW) OR extension to `src/ui/api/open-tabs-api.ts` (MODIFY — the file already holds user-preferences client fns) | client/api | request-response | `src/ui/api/compose-drafts-api.ts` (full file, 68 lines) OR `open-tabs-api.ts:94-103` for user-preferences | **exact** |
| `src/ui/state/conversation-store.test.ts` (MODIFY — add Tests 30j+, per CONTEXT.md numbering baseline) | test | pub-sub | Test 30 @ L951-981 (fleet-only-row pinnable — the closest existing pin test) + Tests 30f-30i @ L1098-1189 (active-set-set add/remove idempotency) + Test @ L1391-1443 (selectConversation → sessionStorage write parallel) | **exact** |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (MODIFY — add mount-effect fetch) | component/effect | request-response | Existing `useEffect(() => { if (selectedId) addToActiveSet(selectedId); }, [selectedId])` @ L182-184 | **exact** (same file, same shape, same-scope mount effect) |

---

## Pattern Assignments

### 1. `schema.ts` change (schema/migration, CRUD) — planner picks A vs. B

**Analog file:** `/home/ubuntu/skynet/src/backend/database/db/schema.ts`

**Import + type-export patterns** (L1-2, module-level, load-bearing):
```typescript
import { sqliteTable, text, integer, blob } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
```

Every table below uses `export const <camelCaseName> = sqliteTable("<snake_case_name>", { ... });`. The route layer imports the exported const AND reads `.$inferSelect` / `.$inferInsert` off it (see `user-preferences.ts` L14 for `.$inferSelect` and L90 for `.$inferInsert`). No separate type export needed — Drizzle's inferred types are the wire contract at the route boundary.

#### Option A — new `pinned_conversations` table

**Analog:** `file_manager_pinned` @ L199-212 (proves the pattern is already used in this file for a per-user pinned-things-collection):
```typescript
export const fileManagerPinned = sqliteTable("file_manager_pinned", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  hostId: integer("host_id")
    .notNull()
    .references(() => hosts.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  path: text("path").notNull(),
  pinnedAt: text("pinned_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
```

Direct adaptation for pinnedIds (Ashley's pins are opaque conversation ids, not host+path tuples — so a leaner row):
```typescript
export const pinnedConversations = sqliteTable("pinned_conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  conversationId: text("conversation_id").notNull(),
  pinnedAt: text("pinned_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
```

**Note:** `file_manager_pinned` does NOT have a unique constraint on `(userId, conversationId)` — insertion of a duplicate would silently succeed and produce two rows. If Option A is picked, the planner MUST decide whether to add a `.unique()` composite constraint or handle dedup at the route layer (INSERT-OR-IGNORE via raw SQL, mirroring `compose-drafts.ts` L106-111's raw-SQL upsert pattern). Recommend the raw-SQL upsert path — safer at scale, matches existing convention.

#### Option B — JSON column on `user_preferences`

**Analog:** existing `user_preferences` table @ L735-749:
```typescript
export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  reopenTabsOnLogin: integer("reopen_tabs_on_login", { mode: "boolean" })
    .notNull()
    .default(false),
  theme: text("theme"),
  fontSize: text("font_size"),
  accentColor: text("accent_color"),
  language: text("language"),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
```

Extension adds one column:
```typescript
  pinnedConversationIds: text("pinned_conversation_ids"), // JSON-serialized string[]; null = never set
```

**Load-bearing observation for the planner:** the existing `user_preferences` row has NO existing JSON blob column. Every existing field is a discrete scalar (boolean or nullable string). Adding `pinnedConversationIds` as a JSON-serialized text column is a NEW pattern for this table (though it exists elsewhere in the schema — `identities.tags`, `snippets.tags`, etc. are all `text` columns holding JSON strings). If Option B is picked, the route layer must add JSON.parse / JSON.stringify explicitly at the boundary (existing `user-preferences.ts` doesn't do this because it has no JSON fields yet).

**Recommendation on Option A vs. Option B** (planner has final say): **Option B (JSON column on `user_preferences`)** requires no schema migration if the drizzle-orm setup auto-adds the column on next boot (which SQLite CREATE TABLE IF NOT EXISTS + Drizzle's schema-sync typically does not — planner MUST verify how migrations are applied by grep'ing for `migrate(` or looking at `db/index.ts`). Option A (new table) is heavier infrastructure but zero-risk migration-wise (a new table is always additive). Given Ashley's single-tenant + set-size-1 reality AND that the endpoint contract already treats pinnedIds as a bare `string[]` (per CONTEXT.md § scope-fences: no per-pin metadata, no ordering), the JSON blob semantically fits — it's a flat opaque set.

---

### 2. Backend endpoint (route/controller, request-response)

**Analog file:** `/home/ubuntu/skynet/src/backend/database/routes/user-preferences.ts` (154 lines, exact shape). This IS the primary analog whether the planner picks Option A (extend this file) or Option B (clone into `user-pins.ts`).

**Auth-middleware invocation pattern** (L1-12, verbatim reusable header):
```typescript
import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import { userPreferences } from "../db/schema.js";
import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
```

**Route registration site** (`database.ts` L1793):
```typescript
app.use("/user-preferences", userPreferencesRoutes);
app.use("/debug", debugRoutes);   // patch #146 — this is where Option B's `app.use("/user-pins", userPinsRoutes)` line lands
```

The import block that adds a router @ `database.ts` L21-22:
```typescript
import userPreferencesRoutes from "./routes/user-preferences.js";
import debugRoutes from "./routes/debug.js";
```

**GET handler shape** (`user-preferences.ts` L40-57):
```typescript
router.get("/", authenticateJWT, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  try {
    const rows = db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .all();

    return res.json(pickPreferences(rows[0]));
  } catch (e) {
    databaseLogger.error("Failed to get user preferences", e, {
      operation: "get_user_preferences",
      userId,
    });
    return res.status(500).json({ error: "Failed to get user preferences" });
  }
});
```

**PUT handler shape with 400-guard + upsert branch** (`user-preferences.ts` L79-152):
```typescript
router.put("/", authenticateJWT, (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { reopenTabsOnLogin, theme, fontSize, accentColor, language } =
    req.body as {
      reopenTabsOnLogin?: boolean;
      // ...
    };

  const updates: Partial<typeof userPreferences.$inferInsert> = {
    updatedAt: new Date().toISOString(),
  };

  if (reopenTabsOnLogin !== undefined) {
    if (typeof reopenTabsOnLogin !== "boolean") {
      return res
        .status(400)
        .json({ error: "reopenTabsOnLogin must be a boolean" });
    }
    updates.reopenTabsOnLogin = reopenTabsOnLogin;
  }
  // ... more validation ...

  if (Object.keys(updates).length === 1) {
    return res.status(400).json({ error: "No preferences provided" });
  }

  try {
    const existing = db
      .select()
      .from(userPreferences)
      .where(eq(userPreferences.userId, userId))
      .all();

    if (existing.length === 0) {
      db.insert(userPreferences)
        .values({
          userId,
          ...updates,
        })
        .run();
    } else {
      db.update(userPreferences)
        .set(updates)
        .where(eq(userPreferences.userId, userId))
        .run();
    }

    return res.json({ success: true, ...updates });
  } catch (e) {
    databaseLogger.error("Failed to update user preferences", e, {
      operation: "update_user_preferences",
      userId,
    });
    return res.status(500).json({ error: "Failed to update user preferences" });
  }
});
```

**Response body echoes persisted state** — see the PUT return `{ success: true, ...updates }` at L144. This is the JSON-body-advantage pattern from CONTEXT.md § Specific Ideas — client can reconcile from PUT response alone, no separate GET-verify needed. **This is the shape Phase 15's pin endpoint should use** (whether Option A or B).

**Function-level export for direct testing** — `user-preferences.ts` does NOT extract the handler function (it defines router.get/put inline). If the planner wants patch #146's testability pattern to avoid the 5s AuthManager singleton init timeout in Vitest, extract the handler body like debug.ts does:

**`debug.ts` L61-120 — function-level exported handler pattern:**
```typescript
// --- core handler (exported for direct testing without Express harness) ---

export function handleConsoleLog(req: Request, res: Response): Response {
  // 1. Validate entries array
  const rawEntries: unknown = (req.body as Record<string, unknown>)?.entries;
  if (!Array.isArray(rawEntries)) {
    return res.status(400).json({ error: "entries array required" });
  }
  // ... rest of handler body ...
  return res.status(204).end();
}

// --- Express router ---

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

router.post(
  "/console-log",
  authenticateJWT,
  (req: Request, res: Response) => {
    const authReq = req as AuthenticatedRequest;
    void authReq; // userId is validated by authenticateJWT middleware
    return handleConsoleLog(req, res);
  },
);
```

Note: `handleConsoleLog` in debug.ts does NOT read `userId` — it's a pure ring-buffer + file-mirror handler. For pins, the extracted handler MUST take `userId` as a parameter since it's a per-user endpoint. Signature would be:
```typescript
export function handleGetPins(userId: string, res: Response): Response { ... }
export function handlePutPins(userId: string, body: unknown, res: Response): Response { ... }
```

...and the route callback extracts `userId` from `req` then delegates. This is the same seam the debug.test.ts pattern exploits (see § 6 below).

**401 semantics** — `authenticateJWT` middleware at `auth-manager.ts` L806-820:
```typescript
createAuthMiddleware() {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    let token = authReq.cookies?.jwt;
    if (!token) {
      const authHeader = authReq.headers["authorization"];
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.split(" ")[1];
      }
    }
    if (!token) {
      return res.status(401).json({ error: "Missing authentication token" });
    }
    // ... JWT verify + session lookup ...
  };
}
```

The 401 for PIN-07 is inherited for free by wrapping every handler with `authenticateJWT` — no additional 401 branch needed in the handler itself.

**JSON shape (this is a JSON endpoint, NOT multipart — no PATCH #77 silent-200 risk):** the existing `user-preferences.ts` uses `bodyParser.json()` (wired globally in `database.ts` L210) and reads `req.body` as a plain object. PIN-08's multipart-defense clause does not apply to this shape. Optimistic client-side reconciliation from the PUT response body (per § Specific Ideas) is safe.

---

### 3. Nginx location block (config)

**Analog files:** `docker/nginx.conf` L258-265 + `docker/nginx-https.conf` L265-272 (both MUST be edited — CLAUDE.md § "Nginx caveat" constraint).

**Exemplar location block** (nginx.conf L258-265, verbatim reusable for a new prefix like `/user-pins`):
```nginx
        location ~ ^/user-preferences(/.*)?$ {
            proxy_pass http://127.0.0.1:30001;
            proxy_http_version 1.1;
            proxy_set_header Host $http_host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
```

The nginx-https.conf L265-272 block is byte-identical. To add a new prefix, copy verbatim and rename the URI path (e.g. `^/user-pins(/.*)?$`).

**Nginx-skip case:** If the planner picks Option A endpoint (extend `/user-preferences`), the existing location block already matches — NO nginx changes needed. This is the strongest argument for Option A endpoint-shape.

---

### 4. Zustand-style store persistence pattern (state, pub-sub + request-response)

**Analog file:** `/home/ubuntu/skynet/src/ui/state/conversation-store.ts` — the primary file being modified in this phase.

**Silent-catch storage-write pattern for augmenting a mutator with persistence** (L709-725, `addToActiveSet`):
```typescript
export function addToActiveSet(id: string): void {
  if (state.activeSet.has(id)) return;
  const nextActiveSet = new Set(state.activeSet);
  nextActiveSet.add(id);
  try {
    if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(
        ACTIVE_SET_STORAGE_KEY,
        JSON.stringify([...nextActiveSet]),
      );
    }
  } catch {
    // Silent — do not block state update on storage failure.
  }
  state = { ...state, activeSet: nextActiveSet };
  notify();
}
```

**Load-bearing observation:** in this pattern, the state mutation + `notify()` land AFTER the persistence write, but the try/catch means a storage failure DOES NOT block the in-memory update. This is exactly the optimistic-UI semantics CONTEXT.md § Persistence semantics locks in (§ Locked, "The UI update is optimistic and synchronous; the server write is asynchronous but verified before the next fetch trusts the round-trip").

**For a server call this becomes async** — the shape morphs slightly. Two acceptable variants for `pinConversation` (planner picks — both are equally valid, but Variant B better matches the sessionStorage precedent):

**Variant A — fire-and-forget promise, state mutation first:**
```typescript
export function pinConversation(id: string): void {
  if (state.pinnedIds.has(id)) return;
  const nextPinnedIds = new Set(state.pinnedIds);
  nextPinnedIds.add(id);
  state = { ...state, pinnedIds: nextPinnedIds };
  notify();
  // Fire server write; failures are silently logged and retried on next mount.
  void putPinnedIds([...nextPinnedIds]).catch(() => {
    // Silent — optimistic update stands, next mount will reconcile.
  });
}
```

**Variant B — mirror addToActiveSet shape, fire-and-forget with sync-first ordering:**
```typescript
export function pinConversation(id: string): void {
  if (state.pinnedIds.has(id)) return;
  const nextPinnedIds = new Set(state.pinnedIds);
  nextPinnedIds.add(id);
  try {
    void putPinnedIds([...nextPinnedIds]);
  } catch {
    // Silent — do not block state update on network failure.
  }
  state = { ...state, pinnedIds: nextPinnedIds };
  notify();
}
```

Variant B matches the `addToActiveSet` pattern literally. Variant A is slightly more defensive against the case where `putPinnedIds` throws synchronously (which for an axios `.put()` returning a Promise it should not — but Variant A is still safer). The `unpinConversation` mirror follows the same shape.

**Rehydration-on-module-load pattern** (L121-134, `hydrateActiveSetFromStorage`):
```typescript
function hydrateActiveSetFromStorage(): Set<string> {
  try {
    if (typeof sessionStorage === "undefined") return new Set<string>();
    const raw = sessionStorage.getItem(ACTIVE_SET_STORAGE_KEY);
    if (!raw) return new Set<string>();
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set<string>();
    const out = new Set<string>();
    for (const v of parsed) if (typeof v === "string") out.add(v);
    return out;
  } catch {
    return new Set<string>();
  }
}
```

...consumed at module-init inside the initial state literal (L175-183):
```typescript
let state: State = {
  hostTree: null,
  openTabs: [],
  pinnedIds: new Set<string>(),
  selectedId: null,
  fleetSessions: [],
  hostsFlat: new Map<number, Host>(),
  activeSet: hydrateActiveSetFromStorage(),
};
```

**This pattern DOES NOT directly translate to Phase 15** — CONTEXT.md § "No sessionStorage/localStorage fallback layer" LOCKS out any client-side persistence cache. The pinnedIds initial state STAYS `new Set<string>()`; the server fetch on mount is the sole source of rehydration. So the analog above is a NEGATIVE guide — its SHAPE (module-init call with defensive try/catch and validation) is the mental model, but the CALL SITE moves from module-init to a panel-mount effect. See § 5 (mount-effect pattern).

**Reconciliation helper (new function)** — the store needs a new imperative setter that replaces `pinnedIds` from a fetched server response, e.g.:
```typescript
// Called by PrettyConversationsPanel's mount effect after a successful GET.
// Replaces the entire pinnedIds set with server-authoritative state; drops
// any stale in-memory pins the server doesn't know about.
export function hydratePinnedIdsFromServer(ids: string[]): void {
  const nextPinnedIds = new Set(ids);
  // Cheap same-content check to avoid gratuitous notify()
  if (nextPinnedIds.size === state.pinnedIds.size) {
    let allSame = true;
    for (const id of nextPinnedIds) {
      if (!state.pinnedIds.has(id)) {
        allSame = false;
        break;
      }
    }
    if (allSame) return;
  }
  state = { ...state, pinnedIds: nextPinnedIds };
  notify();
}
```

The same-content check mirrors `updateFleetSessions`'s guard at L611-625 — the store's convention for "no gratuitous notify() on ref-equal or same-content inputs."

**Test-only reset export (mirror `__resetActiveSetForTest` @ L868-871):**
```typescript
export function __resetPinnedIdsForTest(): void {
  state = { ...state, pinnedIds: new Set<string>() };
  notify();
}
```

Add to the `beforeEach` alongside `__resetActiveSetForTest()`.

---

### 5. Panel mount-effect pattern (component/effect, request-response)

**Analog file:** `/home/ubuntu/skynet/src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`

**Exact analog effect** (L182-184, the patch #144 Fix (d) effect that CONTEXT.md § Specific Ideas explicitly names as the reference site):
```typescript
useEffect(() => {
  if (selectedId) addToActiveSet(selectedId);
}, [selectedId]);
```

**Adaptation for Phase 15** — the effect fires on initial mount (with empty deps or with a stable deps list — the planner picks) and dispatches to a fetch helper:
```typescript
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const ids = await getPinnedIds();
      if (cancelled) return;
      hydratePinnedIdsFromServer(ids);
    } catch {
      // Silent — server unreachable, pinnedIds stays empty (first-render UX
      // is "empty pinned tier hydrates on fetch-complete" per CONTEXT.md).
    }
  })();
  return () => { cancelled = true; };
}, []); // mount only; a re-mount on identity/auth change happens naturally
        // when the parent AppShell remounts the panel
```

**Cancel-token pattern** — the `cancelled` boolean guards against a stale response landing after the panel unmounts (React 18 StrictMode double-mount in dev). No existing effect in this file uses this pattern (the addToActiveSet effect is synchronous), but it's standard React and the planner should adopt it.

**Alternative — module-init fetch instead of mount-effect** — CONTEXT.md § Claude's Discretion notes both are acceptable. The mount-effect pattern is preferred because:
1. It fires after AuthManager is initialized (auth cookie / JWT are guaranteed present)
2. It doesn't need to wait on an axios instance being ready at module-load time
3. It matches the existing `addToActiveSet(selectedId)` neighbor effect

---

### 6. Client-side API layer (client/api, request-response)

**Analog file:** `/home/ubuntu/skynet/src/ui/api/compose-drafts-api.ts` (68 lines, closest match — a per-user JSON GET+PUT with authApi). Also relevant: `/home/ubuntu/skynet/src/ui/api/open-tabs-api.ts` L82-103 for the existing `getUserPreferences` / `saveUserPreferences` functions if extending Option A.

**Full-file shape** (`compose-drafts-api.ts`):
```typescript
import { authApi, handleApiError } from "@/main-axios";

// [Doc comment describing the pattern]

export interface ComposeDraft {
  body: string;
}

export async function getComposeDraft(
  hostId: number,
  tmuxSession: string | null,
): Promise<ComposeDraft> {
  try {
    const params: Record<string, string> = { hostId: String(hostId) };
    if (tmuxSession != null) params.tmuxSession = tmuxSession;
    const response = await authApi.get("/compose-drafts", { params });
    return { body: response.data?.body ?? "" };
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

export async function putComposeDraft(
  hostId: number,
  tmuxSession: string | null,
  body: string,
): Promise<void> {
  try {
    await authApi.put("/compose-drafts", {
      hostId,
      tmuxSession,
      body,
    });
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}
```

**Adaptation for Phase 15** (whether new file or extension to `open-tabs-api.ts`):
```typescript
export interface PinnedIdsResponse {
  pinnedIds: string[];
}

export async function getPinnedIds(): Promise<string[]> {
  try {
    const response = await authApi.get("/user-pins"); // or "/user-preferences" if Option A
    return Array.isArray(response.data?.pinnedIds) ? response.data.pinnedIds : [];
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}

export async function putPinnedIds(ids: string[]): Promise<string[]> {
  try {
    const response = await authApi.put("/user-pins", { pinnedIds: ids });
    // Response echoes the persisted state — return it for optimistic reconciliation
    return Array.isArray(response.data?.pinnedIds) ? response.data.pinnedIds : ids;
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}
```

**Also note the keepalive-flush precedent** (`compose-drafts-api.ts` L50-68 — `flushComposeDraftKeepalive`). NOT needed for Phase 15 v1 (CONTEXT.md § Deferred: no offline queue, no durable client-side retry beyond next-sync) but worth flagging as available if a later scope wants pagehide/visibilitychange persistence for in-flight mutations.

---

### 7. Backend test pattern (test, request-response)

**Analog file:** `/home/ubuntu/skynet/src/backend/database/routes/debug.test.ts` (150 lines, patch #146). CONTEXT.md § canonical_refs names this explicitly as the reference.

**Full pattern** — imports at L14-20:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";

import { handleConsoleLog } from "./debug.js";
```

**Minimal Express Request/Response mocks** (L22-58):
```typescript
type MockRes = {
  _status: number;
  _body: unknown;
  _ended: boolean;
  status: (code: number) => MockRes;
  json: (body: unknown) => MockRes;
  end: () => MockRes;
};

function makeReq(body: unknown) {
  return { body } as unknown as import("express").Request;
}

function makeRes(): MockRes {
  const res: MockRes = {
    _status: 200,
    _body: undefined,
    _ended: false,
    status(code) {
      this._status = code;
      return this;
    },
    json(body) {
      this._body = body;
      return this;
    },
    end() {
      this._ended = true;
      return this;
    },
  };
  return res as unknown as MockRes;
}
```

**Test case shape** (L86-116):
```typescript
describe("handleConsoleLog", () => {
  it("returns 204 and writes one JSON line to the mirror file for a valid entry", () => {
    const entry = { /* ... */ };
    const req = makeReq({ entries: [entry] });
    const res = makeRes();

    handleConsoleLog(req, res as unknown as import("express").Response);

    expect(res._status).toBe(204);
    expect(res._ended).toBe(true);
    // ... more assertions on file side-effects ...
  });

  it("returns 400 for malformed body with missing entries field", () => {
    const req = makeReq({});
    const res = makeRes();
    handleConsoleLog(req, res as unknown as import("express").Response);
    expect(res._status).toBe(400);
    expect((res._body as { error: string }).error).toBe("entries array required");
    expect(fs.existsSync(tmpLogPath)).toBe(false);
  });
  // ... more 400 branches ...
});
```

**Load-bearing test-harness observations for the planner:**
1. **No Express server harness** — the handler is called directly with mock req/res. Zero mocking of AuthManager, zero DB init, zero HTTP listener. The 5s AuthManager singleton timeout that patch #146 was solving is bypassed entirely.
2. **The auth gate is verified by CONSTRUCTION, not by test** — see comment at L4-7: "The auth gate is verified by construction: the route wires authenticateJWT before the handler, same as compose-drafts.ts." Phase 15 tests should do the same — do NOT try to write a "401 unauthenticated" test at the handler level (there's no auth middleware in the harness); a smoke check of `router.get("/", authenticateJWT, ...)` line existence in the source is the auth guarantee. If the planner wants an actual 401 assertion, that needs a full Express harness which this file rejects.
3. **Per-test isolation via env vars** — debug.ts reads `SKYNET_CONSOLE_FORWARD_LOG_PATH` lazily so per-test overrides work without `vi.resetModules()`. Phase 15's DB-backed handlers can NOT use this pattern directly (they hit `db.select().from(pinnedConversations)` — not env-configurable). The planner has two options:
   - **Option A (test):** mock the `db` import at the top of the test file via `vi.mock("../db/index.js", () => ({ db: mockDb }))` with an in-memory Map, verify handler behavior against the mock.
   - **Option B (test):** use a real in-memory SQLite via `better-sqlite3` and run the Drizzle schema against it in `beforeEach`. Heavier but tests the actual SQL.
   
   Recommend Option A for parity with the debug.test.ts spirit (unit-level, fast, zero infra) — mock the 3-4 Drizzle chains the handler uses.

**Test cases to cover per PIN-01..08:**
- `GET returns empty array when no row exists` (401 branch skipped per note 2)
- `PUT with valid ids array persists and echoes back`
- `PUT with malformed body (non-array pinnedIds) returns 400`
- `PUT with empty array persists (unpin-all)`
- `GET after PUT reflects the persisted state`
- (if Option B/JSON: `GET returns { pinnedIds: [] } for user with no preferences row yet`)

---

### 8. Store test pattern (test, pub-sub)

**Analog file:** `/home/ubuntu/skynet/src/ui/state/conversation-store.test.ts` (1516 lines, active file with 44+ tests). Baseline count per CONTEXT.md § Test coverage: **619/619 post-gm3**. New tests slot in as **Test 30j+** following the existing numbering convention (Tests 30f-30i are the most recent additions from quick-260727-gm3).

**Test-setup imports and beforeEach** (L1-87):
```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  updateHostTree,
  updateOpenTabs,
  updateFleetSessions,
  updateHostsFlat,
  selectConversation,
  selectConversationDeferred,
  pinConversation,
  unpinConversation,
  togglePinConversation,
  addToActiveSet,
  removeFromActiveSet,
  useConversations,
  useSelectedConversationId,
  usePinnedIds,
  useActiveSet,
  __subscribeForTest,
  __getSnapshotForTest,
  __getPendingSelectIdForTest,
  __getFleetOnlyRowsForTest,
  __resetActiveSetForTest,
  type FleetSession,
} from "./conversation-store.js";
import type { Tab, Host, HostFolder } from "@/types/ui-types";

// [Fixture helpers makeHost, makeTab]

beforeEach(() => {
  sessionStorage.clear();
  __resetActiveSetForTest();
  updateOpenTabs([]);
  selectConversation(null);
  updateHostTree(null);
  updateFleetSessions([]);
  updateHostsFlat(new Map());
});
```

Phase 15's beforeEach needs to append `__resetPinnedIdsForTest()` (new helper — see § 4) AND mock the axios calls the store now makes:
```typescript
vi.mock("@/api/pins-api", () => ({
  getPinnedIds: vi.fn().mockResolvedValue([]),
  putPinnedIds: vi.fn().mockResolvedValue([]),
}));
```

**Closest existing pin-related test — Test 30 @ L951-981** (fleet-only rows are pinnable):
```typescript
describe("conversation-store (Patch #149 A): fleet-only rows are pinnable", () => {
  it("pinConversation on a fleet-only row id adds the id to pinnedIds", () => {
    const hostA = makeHost("1", "hostA");
    const tree: HostFolder = { name: "root", children: [hostA] };

    act(() => {
      updateHostTree(tree);
      updateHostsFlat(new Map([[1, hostA]]));
      updateFleetSessions([
        { hostId: 1, hostName: "hostA", sessionName: "work", created: 100 },
      ]);
    });

    // Sanity: the fleet-only row exists, nothing pinned
    const snap1 = __getSnapshotForTest();
    expect(snap1.grouped[0].rows[0].id).toBe("fleet::1::work");
    expect(snap1.pinnedIds.size).toBe(0);

    // Patch #149 A: pinning a fleet-only row now succeeds
    act(() => pinConversation("fleet::1::work"));

    const snap2 = __getSnapshotForTest();
    expect(snap2.pinnedIds.has("fleet::1::work")).toBe(true);
    // ...
    expect(snap2.pinned.length).toBe(1);
    expect(snap2.pinned[0].id).toBe("fleet::1::work");
  });
});
```

**Closest existing pattern for asserting a mutator triggered a persistence write — Test @ L1391-1412** (selectConversation → sessionStorage write):
```typescript
describe("conversation-store (patch #137): selectConversation → activeSet + sessionStorage", () => {
  it("selectConversation(id) adds id to activeSet AND writes to sessionStorage", () => {
    const hostA = makeHost("hA", "nasty");
    act(() => {
      updateOpenTabs([makeTab("t-A", "terminal", hostA)]);
    });

    act(() => {
      selectConversation("t-A");
    });

    const { result } = renderHook(() => useActiveSet());
    expect(result.current.has("t-A")).toBe(true);

    // Persistence: sessionStorage carries the same id under the canonical key.
    const raw = sessionStorage.getItem("pv-conv-active-set");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toContain("t-A");
  });
});
```

**Adaptation for Phase 15** — replace the sessionStorage assertion with a spy on the mocked `putPinnedIds`:
```typescript
describe("conversation-store (Phase 15): pinConversation → server PUT", () => {
  it("pinConversation(id) adds id to pinnedIds AND fires putPinnedIds with the new set", async () => {
    const { putPinnedIds } = await import("@/api/pins-api");
    const putSpy = vi.mocked(putPinnedIds);
    putSpy.mockClear();

    const hostA = makeHost("hA", "alpha");
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([makeTab("t-A", "terminal", hostA)]);
    });

    act(() => pinConversation("t-A"));

    // In-memory mutation happened
    const snap = __getSnapshotForTest();
    expect(snap.pinnedIds.has("t-A")).toBe(true);

    // Server write was fired with the new set
    expect(putSpy).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledWith(["t-A"]);
  });
});
```

**Test cases to cover per PIN-01..08 (planner scopes final list):**
- Test 30j: `pinConversation → putPinnedIds fires with new set` (PIN-03)
- Test 30k: `unpinConversation → putPinnedIds fires with reduced set` (PIN-03)
- Test 30l: `pin on already-pinned id → putPinnedIds does NOT fire (idempotent)` — mirrors Test @ L1415-1443 shape
- Test 30m: `hydratePinnedIdsFromServer replaces stale pinnedIds` (PIN-04)
- Test 30n: `putPinnedIds rejection → pinnedIds stays optimistically pinned, no rollback` (PIN-05)
- Test 30o: `hydratePinnedIdsFromServer same-content no-op does NOT bump notify()` — mirrors L611-625 update-guard pattern
- (integration side, likely in `PrettyConversationsPanel.test.tsx`): panel mount fires getPinnedIds and calls hydrate on success (PIN-04)

Numbering suggestion: **Test 30j through Test 30o for the store-level tests**, keeping the 30-series convention that quick-260727-gm3 established with Tests 30f-30i.

---

## Shared Patterns

### Authentication (backend)
**Source:** `src/backend/utils/auth-manager.ts` L806-820 + `src/backend/database/routes/user-preferences.ts` L10-12 + L40 route wiring
**Apply to:** The pins endpoint (whether extending `user-preferences.ts` or new `user-pins.ts`)

```typescript
// Header (verbatim copy)
import { AuthManager } from "../../utils/auth-manager.js";
const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

// Every route (verbatim copy — auth is the second argument to router.<verb>)
router.get("/", authenticateJWT, (req, res) => { ... });
router.put("/", authenticateJWT, (req, res) => { ... });

// Inside every handler (userId extraction, verbatim)
const userId = (req as AuthenticatedRequest).userId;
```

This handles PIN-07 (401-for-unauthenticated) entirely for free.

### Error handling (backend)
**Source:** `src/backend/database/routes/user-preferences.ts` L50-56 (try/catch + databaseLogger + 500 JSON)
**Apply to:** Every DB-touching handler branch

```typescript
try {
  // db work
  return res.json({ ... });
} catch (e) {
  databaseLogger.error("Failed to <verb> <resource>", e, {
    operation: "<verb>_<resource>",
    userId,
  });
  return res.status(500).json({ error: "Failed to <verb> <resource>" });
}
```

### Silent-catch on client-side storage/network writes (frontend)
**Source:** `src/ui/state/conversation-store.ts` L713-722 (`addToActiveSet` try/catch on sessionStorage)
**Apply to:** `pinConversation` / `unpinConversation` server-call sites — the network-write must NEVER block the in-memory state mutation or throw uncaught

```typescript
try {
  void putPinnedIds([...nextPinnedIds]);
} catch {
  // Silent — optimistic update stands, next mount reconciles.
}
```

### JSON-body response echoes persisted state (backend + frontend)
**Source:** `user-preferences.ts` L144 (`return res.json({ success: true, ...updates });`)
**Apply to:** Pin PUT handler — the response must include the current `pinnedIds` array so the client can reconcile from the response alone (PIN-08's JSON-shape branch, no separate GET-verify needed on each write)

### Ref-equal / same-content no-op guard (frontend state)
**Source:** `updateFleetSessions` @ L611-625 (shallow same-content check to skip notify)
**Apply to:** `hydratePinnedIdsFromServer` — server fetch on remount that returns the identical set should NOT bump snapshotVersion + fire listeners

---

## No Analog Found

None. Every anticipated file in this phase has an exact or near-exact analog already in the codebase, most of them within 3-6 months of patches. This is a plumbing-and-persistence change on already-well-worn rails.

---

## Metadata

**Analog search scope:**
- `src/backend/database/routes/` (all 33 route files enumerated; user-preferences.ts + debug.ts + compose-drafts.ts read in full; identities.ts avoided per CONTEXT.md § C endpoint rejection)
- `src/backend/database/db/schema.ts` (full file scanned; users, userPreferences, fileManagerPinned, composeDrafts inspected)
- `src/backend/database/database.ts` L1770-1800 (route registration site)
- `src/backend/utils/auth-manager.ts` L800-870 (createAuthMiddleware body)
- `src/ui/state/conversation-store.ts` (full file — this is the primary file being modified)
- `src/ui/state/conversation-store.test.ts` (full outline + Test 3 + Test 30 + Tests 30f-30i + Test @ L1391 read in full)
- `src/ui/api/compose-drafts-api.ts` (full file)
- `src/ui/api/open-tabs-api.ts` (full file)
- `src/ui/main-axios.ts` L1-80 + L296-375 (authApi + Bearer header wiring)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` L1-200
- `docker/nginx.conf` L220-275 + `docker/nginx-https.conf` L230-285
- `src/types/index.ts` L775-790 (AuthenticatedRequest shape)

**Files scanned:** ~15 (targeted reads, no whole-file dumps of files > 1000 lines except the analog files themselves)

**Pattern extraction date:** 2026-07-27
