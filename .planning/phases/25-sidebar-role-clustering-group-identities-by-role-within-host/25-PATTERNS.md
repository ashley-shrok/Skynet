# Phase 25: Sidebar role-clustering — Pattern Map

**Mapped:** 2026-08-05
**Files analyzed:** 7 new/modified files
**Analogs found:** 6 / 7

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/backend/database/routes/identities.ts` | route (list endpoint) | CRUD + per-row async enrichment | `src/backend/database/routes/sessions.ts` (Promise.all per-row SSH) | role+flow match |
| `src/ui/api/identities-api.ts` | wire type | request-response | itself (add field to existing `Identity` interface) | self-modification |
| `src/ui/state/identities-store.ts` | store | request-response | itself (no change needed — `byKey` already surfaces `Identity`) | self (no-op) |
| `src/ui/state/conversation-store.ts` — `ConversationRow` type | model type | — | `ConversationRow` itself (add `role` field parallel to `fleetOnly`, `rdpHostRow`) | self-modification |
| `src/ui/state/conversation-store.ts` — `rowFromTab` + `fleetSyntheticRows` | data plumb | CRUD | itself (`fleetOnly` + `rdpHostRow` fields show the prior plumb pattern) | self-modification |
| `src/ui/state/conversation-store.ts` — comparator | utility / sort | transform | `compareByLabel` itself (replace in-place) | self-modification |
| `src/ui/state/conversation-store.test.ts` | test | — | existing sort test `quick-260730-wfy` (lines 1042-1067) | exact |

## Pattern Assignments

---

### `src/backend/database/routes/identities.ts` — add `role` to list endpoint

**Analog:** `src/backend/database/routes/sessions.ts` (per-row parallel enrichment)

**Imports to add** (mirroring sessions.ts lines 1-13, identity-clone.ts lines 105-109):
```typescript
import {
  resolveRoleForIdentity,
  isLocalHostId,
  IDENTITY_KEY_RE,
} from "../../claude-session/identity-artifact-reader.js";
```

**Core enrichment pattern — Promise.all per-row** (`src/backend/database/routes/sessions.ts` lines 63-118):
```typescript
const results = await Promise.all(
  candidates.map(async (h): Promise<TmuxSessionRow[]> => {
    try {
      // ... per-row SSH work ...
      return enrichedRow;
    } catch (e) {
      sshLogger.debug("sessions/list: host skipped", { ... });
      return [];          // swallow-and-skip pattern
    }
  }),
);
const flat = results.flat();
```

**Adapted pattern for identity role resolution** — identities are user-scoped with no `hostId`; resolution always uses LOCAL branch (`conn = null`):
```typescript
// In router.get("/", ...) — after fetching rows:
const rows = db.select().from(identities).where(eq(identities.userId, userId)).all();

const enriched = await Promise.all(
  rows.map(async (row) => {
    let role: string | null = null;
    try {
      role = await resolveRoleForIdentity(null, row.identityKey);
    } catch (e) {
      databaseLogger.warn("Failed to resolve role for identity", {
        operation: "list_identities_resolve_role",
        userId,
        identityKey: row.identityKey,
      });
      // swallow — null-role identity sorts to bottom (CONTEXT.md §Null-role handling)
    }
    return publicIdentity(row, role);
  }),
);
return res.json(enriched);
```

**`publicIdentity()` shape change** (`src/backend/database/routes/identities.ts` lines 52-66 — current shape, add `role`):
```typescript
// CURRENT (lines 52-66):
function publicIdentity(row: typeof identities.$inferSelect) {
  return {
    id: row.id,
    identityKey: row.identityKey,
    displayName: row.displayName,
    title: row.title,
    colorHue: row.colorHue,
    voice: row.voice,
    avatarMime: row.avatarMime,
    avatarUrl: `/identities/${row.id}/avatar`,
    avatarEtag: row.avatarEtag,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// TARGET — add role parameter:
function publicIdentity(row: typeof identities.$inferSelect, role: string | null = null) {
  return {
    id: row.id,
    identityKey: row.identityKey,
    displayName: row.displayName,
    title: row.title,
    colorHue: row.colorHue,
    voice: row.voice,
    avatarMime: row.avatarMime,
    avatarUrl: `/identities/${row.id}/avatar`,
    avatarEtag: row.avatarEtag,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    role,         // <-- new field
  };
}
```

**Error handling pattern** (identities.ts lines 78-83, matching logger call shape):
```typescript
} catch (e) {
  databaseLogger.error("Failed to list identities", e, {
    operation: "list_identities",
    userId,
  });
  return res.status(500).json({ error: "Failed to list identities" });
}
```

**resolveRoleForIdentity throw-and-null pattern** (identity-clone.ts lines 353-368 — same catch-and-log shape; Phase 25 uses warn instead of error because a missing role is non-fatal for the list):
```typescript
// identity-clone.ts lines 353-368 — existing try/catch around resolveRoleForIdentity:
let sourceRole: string;
try {
  sourceRole = await resolveRoleForIdentity(conn, sourceIdentityKey);
} catch (err) {
  databaseLogger.error(
    "identity-clone: source has no role frontmatter",
    err,
    {
      operation: "identity_clone_role_resolve",
      userId,
      sourceIdentityKey,
    },
  );
  res.status(500).json({ error: "source has no role frontmatter" });
  return;
}
// Phase 25 diverges here: catch → log.warn + role = null (not a 500)
```

---

### `src/ui/api/identities-api.ts` — add `role` to `Identity` interface

**Current shape** (lines 3-15):
```typescript
export interface Identity {
  id: string;
  identityKey: string;
  displayName: string;
  title: string | null;
  colorHue: number | null;
  voice: string | null;
  avatarMime: string;
  avatarUrl: string;
  avatarEtag: string;
  createdAt: string;
  updatedAt: string;
}
```

**Target — add one field after `voice`:**
```typescript
  voice: string | null;
  role: string | null;   // <-- new (Phase 25)
```

No other changes to this file. All consumers that do `identity.role` will compile once the field is present. `listIdentities()` (line 32-39) is a plain GET — the enriched payload flows through transparently.

---

### `src/ui/state/identities-store.ts` — no code change needed

`useIdentities()` returns `{ byKey: Map<string, Identity> }` (lines 63-84). Once `Identity` gains `role: string | null`, `byKey.get(key)?.role` resolves the role from any consumer. No change to the store.

**Existing hook shape** (lines 63-84) — planner reads this to confirm no store change is needed:
```typescript
export function useIdentities(): {
  identities: Identity[];
  byKey: Map<string, Identity>;
  loaded: boolean;
  refresh: () => Promise<void>;
} {
  // ...
  return {
    identities: state.identities,
    byKey: state.byKey,      // keyed by identityKey.toLowerCase()
    loaded: state.loaded,
    refresh: refreshIdentities,
  };
}
```

**Key used for byKey lookup** (line 21): `i.identityKey.toLowerCase()`. At sort time, derive a role lookup key via `sessionMatchKey(row.targetTmuxSession)` — that returns `name.toLowerCase()` (session-hue.ts lines 4-10), which matches the byKey keying convention.

---

### `src/ui/state/conversation-store.ts` — `ConversationRow` type, add `role`

**Current type** (lines 41-67) — add `role` as an optional field parallel to `fleetOnly` and `rdpHostRow`:
```typescript
export type ConversationRow = {
  id: string;
  type: TabType;
  label: string;
  host: Host | undefined;
  targetTmuxSession: string | null;
  fleetOnly?: boolean;     // existing optional internal marker
  rdpHostRow?: boolean;    // existing optional internal marker
  // ADD:
  role?: string | null;    // Phase 25: from identity.role; undefined = no identity resolved
};
```

**Precedent for optional internal fields** — `fleetOnly` (line 56) comment: "deliberately OMITTED, not set to `false`, so the row-shape stays as close as possible to the Phase 6 5-key contract." Phase 25 follows the same pattern: `role` is omitted (not set to null) when the row has no identity, keeping the ConversationRow shape minimal.

---

### `src/ui/state/conversation-store.ts` — `rowFromTab` plumb

**Current `rowFromTab`** (lines 237-245):
```typescript
function rowFromTab(tab: Tab): ConversationRow {
  return {
    id: tab.id,
    type: tab.type,
    label: tab.label,
    host: tab.host,
    targetTmuxSession: tab.targetTmuxSession ?? null,
  };
}
```

**Target** — `rowFromTab` needs a `byKey` argument to resolve role at construction time. This keeps the comparator pure (no Map lookup inside the sort predicate):
```typescript
function rowFromTab(tab: Tab, byKey: Map<string, Identity>): ConversationRow {
  const matchKey = sessionMatchKey(tab.targetTmuxSession);
  const role = matchKey ? (byKey.get(matchKey)?.role ?? null) : null;
  return {
    id: tab.id,
    type: tab.type,
    label: tab.label,
    host: tab.host,
    targetTmuxSession: tab.targetTmuxSession ?? null,
    ...(role !== null ? { role } : {}),  // omit field when null (matches fleetOnly pattern)
  };
}
```

**`fleetSyntheticRows` construction** (lines 323-337) — same pattern; the synthetic row already has `targetTmuxSession: session.sessionName` which is the identity key:
```typescript
const syntheticRow: ConversationRow = {
  id: fleetRowId(session.hostId, session.sessionName),
  type: "terminal",
  label: session.sessionName,
  host: resolvedHost,
  targetTmuxSession: session.sessionName,
  fleetOnly: true,
  // ADD:
  ...(role !== null ? { role } : {}),
};
```

**Where `computeSnapshot` gets `byKey`** — `computeSnapshot()` currently takes no arguments (line 295). The planner must decide: (a) pass `byKey` as a parameter and thread it from a call site that already has it, OR (b) use a module-level `identitiesByKey` state reference that `useIdentities` can populate. Option (a) is simpler but requires the call site to have access to the identity store. Option (b) mirrors how `state.hostsFlat` is a module-level input updated by `updateHostsFlat`. The planner should model `role` injection after `hostsFlat`: add an `updateIdentitiesByKey(map)` mutation that PrettyConversationsPanel (which already calls `useIdentities()`) can drive on identity store change, or pass byKey into computeSnapshot at call sites.

**Existing call sites of `rowFromTab`** (lines 357, 394, 412, 413) — all are inside `computeSnapshot`. Update each call to pass `byKey`.

---

### `src/ui/state/conversation-store.ts` — comparator replacement

**Current comparator** (lines 289-293 — the surgical change target):
```typescript
// Shared alphabetical comparator for all four row-bucket sort sites in
// computeSnapshot. Locale-aware, case-insensitive, numeric-natural —
// so "host10" sorts after "host9" and "Alpha" equals "alpha".
const compareByLabel = (a: ConversationRow, b: ConversationRow): number =>
  a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
```

**Four call sites** (all are the only sort call sites in computeSnapshot):
- Line 365: `activeSetRows.sort(compareByLabel)` — Tier 1
- Line 403: `pinned.sort(compareByLabel)` — Tier 2
- Line 431: `rows.sort(compareByLabel)` — Tier 3 known-host bucket
- Line 458: `rows.sort(compareByLabel)` — Tier 3 orphan-host bucket

**Target comparator** (implements `(host, role, label)` tuple per CONTEXT.md §Sort semantics):
```typescript
const compareByHostRoleLabel = (a: ConversationRow, b: ConversationRow): number => {
  // Outer: host name (case-insensitive, numeric-natural)
  const hostA = a.host?.name ?? "";
  const hostB = b.host?.name ?? "";
  const hostCmp = hostA.localeCompare(hostB, undefined, { sensitivity: "base" });
  if (hostCmp !== 0) return hostCmp;

  // Middle: role (null/undefined sorts AFTER any real role)
  const roleA = a.role ?? null;
  const roleB = b.role ?? null;
  if (roleA !== roleB) {
    if (roleA === null) return 1;   // null role → sort later
    if (roleB === null) return -1;
    const roleCmp = roleA.localeCompare(roleB, undefined, { sensitivity: "base" });
    if (roleCmp !== 0) return roleCmp;
  }

  // Inner: label (case-insensitive, numeric-natural — same as compareByLabel)
  return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
};
```

**localeCompare options note**: `sensitivity: "base"` for role + label (case-insensitive per CONTEXT.md). Host uses same. The existing `numeric: true` on label is retained; role and host comparison do not need `numeric: true` since role names are `[a-z0-9_-]` (IDENTITY_KEY_RE) and host names rarely have numeric-natural-sort relevance.

**Whether to keep `compareByLabel`**: it is used only at the four sites above (all now replaced) plus `rdpRows.sort(compareByLabel)` at line 523. If RDP rows don't have roles (they don't — they're host-level rows without identity), leave `compareByLabel` in place for line 523 and remove only the four `compareByLabel` calls being replaced. Or replace all five with `compareByHostRoleLabel` (harmless for RDP rows since their role will be undefined/null → sorts to bottom within their already-separate RDP sentinel bucket).

---

### `src/ui/state/conversation-store.test.ts` — new sort tests

**Test scaffolding pattern** (lines 1042-1067 — `quick-260730-wfy` block):
```typescript
describe("conversation-store (quick-260730-wfy): pinned tier alphabetical ordering", () => {
  it("pinned tier is alphabetically sorted by row.label regardless of source", () => {
    const hostA = makeHost("hA", "alpha");
    // Two openTabs with labels ["z", "m"] in that order
    const tabZ = makeTab("t-z", "terminal", hostA, null, "z");
    const tabM = makeTab("t-m", "terminal", hostA, null, "m");
    // Two fleet sessions with labels ["a", "n"] in that order (sessionName IS the label)
    act(() => {
      updateHostTree({ name: "root", children: [hostA] });
      updateOpenTabs([tabZ, tabM]);
      updateFleetSessions([...]);
      pinConversation("t-z");
      // ...
    });

    const snap = __getSnapshotForTest();
    expect(snap.pinned.map((r) => r.label)).toEqual(["a", "m", "n", "z"]);
  });
});
```

**Key test helpers** (lines 13-40, beforeEach lines 80-108):
- `makeHost(id, name, overrides?)` — line 49
- `makeTab(id, type, host?, targetTmuxSession?, label?)` — line 57
- `__getSnapshotForTest()` — imported from store, returns `ConversationList & { selectedId, pinnedIds, hiddenIds }`
- `act(() => { ... })` — wraps all state mutations
- `updateOpenTabs`, `updateFleetSessions`, `updateHostTree`, `pinConversation` — all imported from store

**New test scenarios required** (per CONTEXT.md §Specific Ideas):
1. Role-clustering within a host bucket (same host, two roles → role A rows before role B rows)
2. Host outer sort in ActiveSet/Pinned (two hosts, rows from host B sort after host A rows)
3. Null-role rows sort last within their host
4. Case-insensitivity: `"Box-Maintainer"` and `"box-maintainer"` cluster together
5. Same-role different-label sorts by label
6. Same-everything: stable (labels tie-break within role)

**`makeTab` currently has no `role` awareness** — tests will need to drive `role` onto rows via the `updateIdentitiesByKey` (or equivalent) mechanism that Phase 25 introduces. The planner must decide how the test injects role onto rows (since `makeTab` only creates a Tab, and role comes from identity resolution at row-construction time). Pattern: call `updateIdentitiesByKey(new Map([["session-name", { role: "architect", ... }]]))` in the `act()` block before the snapshot assertion. The map key must match `sessionMatchKey(targetTmuxSession)` = `targetTmuxSession.toLowerCase()`.

---

## Shared Patterns

### `resolveRoleForIdentity` invocation (LOCAL branch — null conn)

**Source:** `src/backend/claude-session/identity-artifact-reader.ts` lines 227-244
**Apply to:** `GET /identities` list handler

Signature: `resolveRoleForIdentity(conn: SSHClientType | null, identityKey: string): Promise<string>`

Passing `null` as `conn` triggers the LOCAL branch (reads from IDENTITIES_HOST_DIR bind-mount via `fs.readFile`). This is the correct choice for the list endpoint: identities are user-scoped with no hostId in the DB; the canonical file is always on the LOCAL host that mounts the identities directory.

The function THROWS (never returns null) when role frontmatter is missing. The list endpoint wraps each call in try/catch and treats the throw as `role = null` (swallow-and-null pattern). This diverges from identity-clone.ts (which 500s on throw) — intentional per CONTEXT.md §Mechanism ("swallow-and-null so a single bad identity file doesn't 500 the list endpoint; log at warn level").

### `sessionMatchKey` for identity lookup at sort time

**Source:** `src/ui/features/terminal/session-hue.ts` lines 4-10
**Apply to:** `rowFromTab()` and `fleetSyntheticRows` construction in `conversation-store.ts`

```typescript
export function sessionMatchKey(
  name: string | null | undefined,
): string | null {
  if (!name) return null;
  const key = name.toLowerCase();
  return key || null;
}
```

`byKey` in identities-store is keyed by `identityKey.toLowerCase()` (identities-store.ts line 21). `targetTmuxSession` (which equals the identity key) lowercased via `sessionMatchKey` produces the exact lookup key. No transform needed.

### `localeCompare` options for case-insensitive sort

**Source:** `src/ui/state/conversation-store.ts` line 293 (existing `compareByLabel`)

```typescript
a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" })
```

`sensitivity: "base"` makes the comparison case-insensitive (treats A === a). `numeric: true` enables natural-number ordering ("host10" after "host9"). Use `sensitivity: "base"` for both role and label comparisons. Role comparison does NOT need `numeric: true` (role names are `[a-z0-9_-]`, no multi-digit numbers that matter).

### Logger warn pattern for swallowed errors

**Source:** `src/backend/utils/logger.js` — imported as `databaseLogger` in identities.ts (line 10)

Existing error call shape in identities.ts (lines 78-81):
```typescript
databaseLogger.error("Failed to list identities", e, {
  operation: "list_identities",
  userId,
});
```

For swallowed role-resolution failures, use `databaseLogger.warn` (not error) with `operation: "list_identities_resolve_role"` and add `identityKey` to context so failures are traceable without alarming monitoring.

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/backend/database/routes/identities.ts` (route test) | test | — | No existing backend route test for `identities.ts`. The closest pattern is `identity-clone.test.ts` (in-memory DB shim + mocked auth + mocked SSH + mocked `resolveRoleForIdentity`). Planner should decide whether to add a backend test for the list endpoint enrichment or treat it as integration-only. If adding a test, mirror `identity-clone.test.ts` mocking scaffold (lines 57-197). |

---

## Key Planner Decisions (undecided in CONTEXT.md)

1. **How `computeSnapshot` accesses `byKey`**: two options —
   - (a) Add `updateIdentitiesByKey(map)` mutation (mirrors `updateHostsFlat` pattern, lines 478+) and have `PrettyConversationsPanel` call it when identity store updates. `computeSnapshot` reads from module-level state.
   - (b) Pass `byKey` into `computeSnapshot` as a parameter (requires threading it through all call sites — currently only one: the `snapshot` derivation).
   Option (a) is architecturally consistent with how `hostsFlat` is plumbed. Option (b) is simpler if `computeSnapshot` is only called from one place.

2. **Whether to test the backend list-endpoint enrichment**: `identity-clone.test.ts` shows the full test scaffold. The planner should add a minimal backend test (happy path: role resolved; sad path: resolveRoleForIdentity throws → null role in output) if it wants regression protection.

3. **`compareByLabel` at line 523** (`rdpRows.sort(compareByLabel)`): RDP rows have no identity, so their `role` will be `undefined`. The new comparator handles this via null-role-last. Safe to replace line 523 too for consistency, or leave it unchanged.

---

## Metadata

**Analog search scope:** `src/backend/database/routes/`, `src/ui/state/`, `src/ui/api/`, `src/ui/features/`, `src/backend/claude-session/`
**Files scanned:** ~15 files
**Pattern extraction date:** 2026-08-05
