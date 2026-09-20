# Phase 122: Conversation search modal — Research

**Researched:** 2026-09-20
**Domain:** Full-stack feature (backend content-search + cross-host fan-out + new frontend modal chrome + sidebar header wiring + filter removal)
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Search trigger + input behavior**
- **D-01:** Search fires on Enter key, NOT on keystroke. Content-grep across many hosts is not free; keystroke-firing would hammer hosts.
- **D-02:** Query is case-insensitive plain substring. No regex, no fuzzy matching, no per-field search (title-only vs body-only). All deferred.
- **D-03:** No keyboard shortcut to open the modal (e.g. no cmd-K). Button-click only. Search isn't the primary sidebar interaction.

**Modal lifecycle + state**
- **D-04:** Clicking a result closes the modal (jump-and-close pattern). Exception: archived-result click keeps the modal open (see D-11 / D-15).
- **D-05:** Modal REMEMBERS its state across opens — the last query AND accumulated results are still there when the user reopens. This is a workflow-enabler for "search → wrong click → come back → try another."
- **D-06:** Empty state is shown only on first-ever open or after the user clears the input.

**Corpus construction**
- **D-07:** Search corpus is the **latest transcript file per identity**, aggregated across ALL hosts in the fleet.
- **D-08:** Enumeration on each host walks BOTH the active identities directory (`~/fleet/identities/`) AND the archived identities directory (`~/fleet/identities-archive/`).
- **D-09:** The mapping "identity → latest transcript file" should reuse the existing code path that the pretty-view open-conversation flow uses today (do not reinvent).

**Results + sort + pagination**
- **D-10:** Results sort recency-first (most recent conversation at top). Relevance/ranking is deferred.
- **D-11:** Each result row shows: conversation title, identity + host, and a highlighted snippet of the matching text (so the user can see WHY it hit).
- **D-12:** Pagination is offset/limit — 20 results per fetch. First fetch is 0-19; "Load more" button at the bottom fires a second server call for 20-39; and so on. Load-more RE-runs the same query with the next offset (server does the grep again). No numbered page controls.
- **D-13:** Total wall time for a naive grep across the latest transcript per identity on t1000 (157 identities, ~1GB total) is ~600ms — sub-second regardless of query specificity. Not a bottleneck at current corpus size. Index-based search deferred.

**Click behavior**
- **D-14:** Clicking an ACTIVE result: opens the conversation (via the existing open-conversation flow), modal closes.
- **D-15:** Clicking an ARCHIVED result: shows a browser alert ("coming soon" / "opening archived conversations isn't wired up yet"). Modal stays open. The alert is deliberately blunt — no soft misdirection.
- **D-16:** Unarchiving does NOT ship in this phase.

**Sidebar filter removal**
- **D-17:** The existing filter-as-you-type input at the top of the sidebar is REMOVED as part of this same phase. The modal replaces it, not supplements it.
- **D-18:** **Ordering constraint:** the removal must NOT land before the modal is usable. A window where neither exists is a regression. Executor should either land both together or land modal first, remove filter second — never remove-first.

**Cross-host fan-out mechanism**
- **D-19:** Cross-host fan-out is implementation detail, not shape-level decision. Prefer whatever cross-host aggregation pattern the codebase already uses (fleet-status-client fan-out, host-API-key auth, etc.). Do NOT invent a new pattern for this feature.

### Claude's Discretion

- Exact endpoint URL and field names — planning decides.
- Frontend modal architecture (component hierarchy, state management approach) — planning decides.
- Snippet extraction algorithm (chars around hit, hits per result, highlight render) — planning decides, with the constraint that snippet + highlight is IN SCOPE.
- Server-side implementation language of the grep (spawn `grep`, use Node fs streams + regex, ripgrep, etc.) — planning decides. Current sub-second measurement was naive `grep`; any equally-fast approach is fine.

### Deferred Ideas (OUT OF SCOPE)

- Unarchiving. Whole separate design conversation and shape.
- Keyboard shortcut to open the modal (e.g. cmd-K / ctrl-K).
- Fuzzy matching.
- Relevance-ranked sort (query density, match count as ranking factors).
- Per-field search (title-only, body-only, participant-only).
- Regex query support.
- Search history (recent queries dropdown).
- "Search only archived" or "search only active" toggle. Explicitly rejected.
- Numbered page controls / page counters.
- Index-based search (inverted index built at write time).
- A dedicated "recently archived" panel next to search.
- "Read-only" opening of archived results.
</user_constraints>

<phase_requirements>
## Phase Requirements

Requirements are represented by D-01..D-19 as locked in CONTEXT.md and not by a numeric REQ list — the phase requirements ARE those decisions. Below maps each to the research finding that shows how to implement it.

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01 | Enter-only fire; no keystroke fire | Standard controlled-input pattern; local component state |
| D-02 | Case-insensitive plain substring | Snippet-extraction & Grep sections below |
| D-03 | Button-click only, no keyboard shortcut | Sidebar Header section — new `<Search>` icon button in `.pv-header-actions` |
| D-04 | Click active result → modal closes; archived → stays open | Frontend Click-Handler Routing section |
| D-05 | Modal state persists across opens | State Management section — module-scoped store via `useSyncExternalStore` (established pattern) |
| D-06 | Empty state only on first-open or after clear | State Management section |
| D-07 | Latest transcript per identity, per host | Prior Art: Identity → Latest Transcript Resolution section |
| D-08 | Walk both `~/fleet/identities/` AND `~/fleet/identities-archive/` | Identity Enumeration section |
| D-09 | Reuse existing identity → latest transcript mapping | Prior Art section — `discoverIdentitySessionFile` is the load-bearing helper |
| D-10 | Recency-first sort (most recent conversation on top) | Sort/Ordering section — sort by transcript file mtime desc |
| D-11 | Row shows title + identity + host + highlighted snippet | Result Row Shape section |
| D-12 | Offset/limit pagination, 20 per fetch, load-more | Pagination section — server re-runs with next offset |
| D-13 | Naive grep is fine at current scale | Grep Strategy section |
| D-14 | Active result → existing open flow | Click Routing: reuse `onDetachedRowClick` shape from `AppShell.tsx:3068` |
| D-15 | Archived result → `alert()`, modal stays open | Click Routing section |
| D-16 | Unarchiving deferred | Explicit no-op |
| D-17 | Remove existing sidebar filter-as-you-type input | Sidebar Filter Removal section — precise file locations identified |
| D-18 | Ordering: modal-first, filter-removal-second | Wave Ordering section |
| D-19 | Reuse existing cross-host fan-out pattern | Cross-Host Fan-Out section — `sessions.ts:319` `Promise.all(candidates.map(...))` is the pattern |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

There is no `CLAUDE.md` at the workspace root (`ls` confirms). Directives in `~/.claude/CLAUDE.md` (user-wide global) apply but are not project-scoped constraints. No project-level `.claude/skills/` or `.agents/skills/` directories were found.

## Summary

Phase 122 replaces the sidebar's local label-only filter-as-you-type input (PrettyConversationsPanel.tsx L2393–L2424) with a portal-mounted search modal, triggered by a new magnifying-glass button placed in the existing `.pv-header-actions` cluster (L2304). The modal fires a new backend content-search endpoint that fans out across the caller's managed hosts, walks BOTH `~/fleet/identities/` AND `~/fleet/identities-archive/` on each host, resolves each identity's latest transcript file via the **existing** `discoverIdentitySessionFile` helper (`src/backend/claude-session/discover-identity-session-file.ts`), greps that file for the query, extracts a snippet around each match, and returns paginated results.

Every load-bearing primitive already exists in the codebase:
- **Identity → latest transcript resolver:** `discoverIdentitySessionFile` (already used by `sessions.ts:489` to power `aiTitle` discovery). LOCAL branch reads via node fs from the container's `HOME_HOST_DIR` bind mount; REMOTE branch shells out over SSH.
- **Cross-host fan-out:** `sessions.ts:319` executes `Promise.all(candidates.map(async (h) => { ... resolveHostById → connectOneShot → per-host work ... }))` — the phase's endpoint should mirror this shape byte-for-byte.
- **Modal chrome:** `NewConversationModal.tsx` + `CreateProjectModal.tsx` (both in `src/ui/features/pretty-conversations/`) provide the pre-built glass-morphism modal recipe using Radix `DialogPrimitive.Root` from `radix-ui`, with `@/components/dialog` sub-exports and the `absolute inset-4` + `md:max-w-[560px]` responsive shell.
- **State persistence across opens (D-05):** the codebase's established "module-scoped store subscribed via `useSyncExternalStore`" pattern (see `conversation-store.ts`, `identities-store.ts`) is exactly the pattern needed for the search-store slice.
- **Archived-row awareness (D-15):** the client already knows which identities are archived via `useArchivedFleetRows()` (`conversation-store.ts:2418`), fed by the fleet-status `identity-archived` wire frame. Server response should include `isArchived: boolean` per result so client-side click-routing is trivial.

**Primary recommendation:** Build the endpoint as `POST /conversation-search` with `{ query, offset, limit }` body, colocated in `src/backend/database/routes/conversation-search.ts`, mounted in `database.ts`. Mirror `sessions.ts:294`'s handler shape verbatim: JWT auth → filter hosts by `userId` → `Promise.all(hosts.map(...))` per-host fan-out → per-host `connectOneShot` → `discoverIdentitySessionFile(conn, identityKey)` for each identity in both live + archive trees → one shell-side grep pipeline over the resolved paths per host → aggregate → sort by mtime desc → slice `[offset, offset+limit]` → return `{ results, hasMore }`. The frontend adds `ConversationSearchModal.tsx` alongside the existing sibling modals, opens via a new `<Search>` icon button in the panel header, and mounts a `search-store` slice for the persist-across-opens behavior.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Enumerate identities per host (live + archive) | API / Backend | Shell on managed host | The sweep script already enumerates both trees for other purposes; the endpoint reuses `discoverIdentitySessionFile` per identity |
| Resolve identity → latest JSONL file | API / Backend | Filesystem (mtime-desc sort) | LOAD-BEARING REUSE (D-09) of existing helper; do not fork |
| Cross-host fan-out | API / Backend | SSH via `connectOneShot` + `withConnection` | Established pattern in `sessions.ts:319`; no invention (D-19) |
| Grep + snippet extraction | API / Backend | Shell command on host OR node stream reader | Sub-second at current scale (D-13); planner picks between shell `grep` fan-out and node-side read |
| Search UI shell (modal chrome) | Browser / Client | Radix `DialogPrimitive.Portal` | Established pattern from `NewConversationModal.tsx` |
| Modal state persistence (D-05) | Browser / Client | Module-scoped store + `useSyncExternalStore` | Established two-tier pattern; store lives OUTSIDE the component so unmount preserves state |
| Route active vs archived click (D-14/D-15) | Browser / Client | `useArchivedFleetRows` slice or server-flagged `isArchived` | Backend flag is simpler (single source of truth); client joins isn't needed if response is authoritative |
| Sidebar filter-input removal (D-17) | Browser / Client | JSX edit in `PrettyConversationsPanel.tsx` | Bounded three-file edit; CSS class deletion in `pretty-conversations.css` |

## Standard Stack

### Core (all already installed — verified by grep in repo)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `express` | as installed | Backend route registration | Every existing backend route uses `express.Router()` [VERIFIED: workspace-routes.ts, sessions.ts] |
| `radix-ui` | as installed | Modal primitives (`DialogPrimitive.Root`, `Overlay`, `Portal`, `Content`) | Every existing modal in `src/ui/features/pretty-conversations/` and `src/ui/features/pretty-view/*Modal.tsx` uses this [VERIFIED: NewConversationModal.tsx, GlobalFilesModal.tsx, RoleModal.tsx, EditableFileModal.tsx] |
| `lucide-react` | as installed | `<Search>` icon (already imported at PrettyConversationsPanel.tsx L67), `<X>`, `<Loader2>` | Every icon in the panel comes from lucide-react [VERIFIED: existing import] |
| `axios` (via `authApi` from `@/main-axios`) | as installed | Frontend HTTP client with JWT | Every existing `src/ui/api/*.ts` module uses `authApi` [VERIFIED: workspace-api.ts, identity-archive-api.ts] |
| `zod` | as installed | Optional request body validation | Used across `src/backend/fleet-status/types.ts` and wire-protocol layers [VERIFIED: types.ts:30] |
| `vitest` v4.1.8 | as installed | Backend + frontend test runner (dual project config: `backend` node env, `frontend` jsdom env) | [VERIFIED: vitest.config.ts] |
| `@testing-library/react` v16.3.2 | as installed | Frontend component testing | [VERIFIED: package.json] |
| `@playwright/test` v1.63.0 | as installed | E2E smoke tests | Existing `tests/e2e/smoke.spec.ts` and probe specs [VERIFIED: playwright.config.ts] |

### Supporting (already-existing internal helpers to reuse — NOT rebuild)

| Helper | Location | Purpose | Reuse For |
|--------|----------|---------|-----------|
| `discoverIdentitySessionFile(conn, identityName)` | `src/backend/claude-session/discover-identity-session-file.ts:330` | Returns absolute path of the identity's most-recent transcript JSONL, or null | **THE** load-bearing D-09 primitive |
| `listIdentityKeysOnHost(conn)` | `src/backend/claude-session/identity-artifact-reader.ts:1144` | Returns identity keys under `~/fleet/identities/` on the host | Enumerate live-tree identities (D-08 first half) |
| `resolveHostById(hostId, userId)` | `src/backend/ssh/host-resolver.js` | Fetches decrypted host record with userId scope check | Every route's host-lookup step [VERIFIED: sessions.ts:324, workspace-routes.ts:468] |
| `connectOneShot(host, timeoutMs)` | `src/backend/ssh/ssh-one-shot.js` | Fire one SSH connection to a host and return the client | Every route's SSH-open step [VERIFIED: sessions.ts:326, workspace-routes.ts:487] |
| `withConnection(poolKey, factory, cb)` | `src/backend/ssh/ssh-connection-pool.js` | Pooled connection wrapper (preferred over raw connectOneShot for repeat calls) | Cross-host fan-out with reuse [VERIFIED: workspace-routes.ts:485] |
| `execCommand(conn, cmd)` | `src/backend/ssh/tmux-helper.js` | Run one shell command over an SSH exec channel and return stdout | Every SSH-side shell exec [VERIFIED: sessions.ts:332] |
| `AuthManager.getInstance().createAuthMiddleware()` | `src/backend/utils/auth-manager.js` | JWT authentication middleware | Every authenticated route [VERIFIED: workspace-routes.ts:75] |
| `PermissionManager.getInstance().canAccessHost(userId, hostId, "read")` | `src/backend/utils/permission-manager.js` | RBAC check per host | Every host-scoped route [VERIFIED: workspace-routes.ts:475] |
| `authApi.post(url, body)` + `handleApiError(err, ctx)` | `src/ui/main-axios.ts` | Frontend authenticated fetch with error-class propagation | Every `src/ui/api/*.ts` module [VERIFIED: workspace-api.ts:20, identity-archive-api.ts:1] |
| `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` | React built-in | Module-scoped state that survives component unmount | D-05 modal-state persistence — established two-tier pattern [VERIFIED: conversation-store.ts, identities-store.ts] |
| `useArchivedFleetRows()` | `src/ui/state/conversation-store.ts:2418` | Returns the current archived-identity slice | Frontend join for `isArchived` if backend doesn't flag results |
| `DialogPrimitive.Root` + `.Portal` + `.Overlay` + `.Content` pattern | `src/ui/features/pretty-conversations/NewConversationModal.tsx` | Full modal composition | Lift shape verbatim, including glass-morphism style block, portal z-index ladder (`z-[110]` overlay + `z-[120]` content), `onInteractOutside={e => e.preventDefault()}` guard |
| `sessions.ts`'s `Promise.all(candidates.map(async (h) => { ... }))` per-host block | `src/backend/database/routes/sessions.ts:319-566` | Cross-host aggregation with per-host try/finally + timeout race | **The** pattern D-19 requires |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shell-side `grep` per host | Node.js stream read + string.includes per file | Shell grep is what Ashley timed at ~600ms/157 identities on t1000. Node stream would require a REMOTE branch that ships the file (or its search hit) back. Prefer shell grep for parity with the timing evidence. |
| Node `child_process.spawn("grep", ...)` for LOCAL branch | Node fs.readFile + string.includes | Grep is measured-fast and consistent with the REMOTE branch. Recommended: use the SAME shell-side grep script on both branches (LOCAL branch invokes `sh -c` locally, REMOTE branch invokes it over SSH — mirrors the discovery module's split at `discover-identity-session-file.ts:334`). |
| New `POST /conversation-search` endpoint | Extend `/sessions/list` | Sessions/list has different semantics (per-session rows). A dedicated endpoint keeps the search body/response schema clean. |
| Backend flags `isArchived` per result | Frontend joins `useArchivedFleetRows()` post-fetch | Backend flagging is simpler (single source of truth) and avoids client-side race on WS-driven archive updates during the fetch. Recommend backend flag. |

**Installation:** No new packages needed. Zero-package phase.

**Version verification:** All packages listed above are already in `package.json` and in active use; grep confirmed. No `npm view` needed — no new installs.

## Package Legitimacy Audit

**Not required for this phase.** Zero new external packages are being added. Every dependency listed above is already installed and imported by multiple existing files.

## Architecture Patterns

### System Architecture Diagram

```
                     ┌───────────────────────────┐
                     │  User clicks 🔍 button    │
                     │  in .pv-header-actions    │
                     └────────────┬──────────────┘
                                  │ opens
                                  ▼
                     ┌───────────────────────────┐
                     │  ConversationSearchModal  │
                     │  (Radix DialogPrimitive)  │
                     │                           │
                     │  ┌─────────────────────┐  │
                     │  │ Search input        │◄─┼── initial value from
                     │  └─────────┬───────────┘  │   search-store (D-05)
                     │            │ Enter       │
                     │            ▼              │
                     │  ┌─────────────────────┐  │
                     │  │ Results list        │  │
                     │  │  • row              │──┼── click active → onDetachedRowClick
                     │  │  • row (archived)   │──┼── click archived → alert(), stay open
                     │  │  • row              │  │
                     │  └─────────────────────┘  │
                     │  ┌─────────────────────┐  │
                     │  │ Load more (offset+) │──┼── fetches next 20
                     │  └─────────────────────┘  │
                     └────────────┬──────────────┘
                                  │ POST /conversation-search { query, offset, limit }
                                  ▼
                     ┌───────────────────────────┐
                     │  Backend route handler    │
                     │  (JWT auth → RBAC filter) │
                     └────────────┬──────────────┘
                                  │
                                  ▼
                     ┌───────────────────────────┐
                     │  For each of caller's     │
                     │  SSH+autoTmux hosts:      │
                     │                           │
                     │  Promise.all(hosts.map(   │
                     │    async (h) => {         │
                     │      connectOneShot(h)    │
                     │      enumerate live-tree  │◄── ~/fleet/identities/*
                     │      enumerate archive    │◄── ~/fleet/identities-archive/*
                     │      for each identity:   │
                     │        discoverIdentity   │
                     │          SessionFile()    │◄── EXISTING helper (D-09)
                     │      ONE grep pipeline    │
                     │        over resolved      │
                     │        paths per host     │
                     │      return per-hit rows  │
                     │    }))                    │
                     └────────────┬──────────────┘
                                  │
                                  ▼
                     ┌───────────────────────────┐
                     │  Aggregate → sort by      │
                     │  transcript file mtime    │
                     │  desc → slice [off, off+  │
                     │  lim] → { results,        │
                     │  hasMore }                │
                     └───────────────────────────┘
```

### Recommended Project Structure

```
src/backend/database/routes/
  ├── conversation-search.ts              # NEW — the endpoint
  └── conversation-search.test.ts         # NEW — vitest coverage

src/backend/claude-session/
  └── (no new files — reuse discoverIdentitySessionFile)

src/ui/features/pretty-conversations/
  ├── ConversationSearchModal.tsx         # NEW — modal shell (lift NewConversationModal recipe)
  ├── ConversationSearchModal.test.tsx    # NEW — component tests
  ├── ConversationSearchRow.tsx           # NEW — result row (title + identity + host + snippet)
  ├── PrettyConversationsPanel.tsx        # EDIT — add <Search> header button; REMOVE inline .pv-search-container block (D-17)
  └── pretty-conversations.css            # EDIT — delete .pv-search-container / .pv-search-icon / .pv-search-input / .pv-search-clear rules

src/ui/api/
  └── conversation-search-api.ts          # NEW — authApi wrapper for POST /conversation-search

src/ui/state/
  └── search-store.ts                     # NEW — module-scoped store; query + accumulated results + hasMore + isFetching; useSyncExternalStore subscription (D-05)

src/backend/database/database.ts          # EDIT — mount app.use("/conversation-search", conversationSearchRoutes)

docker/nginx.conf                         # EDIT — new `location /conversation-search` block
docker/nginx-https.conf                   # EDIT — same
```

### Pattern 1: Cross-Host Fan-Out (D-19 REUSE)

**What:** Iterate caller's SSH-enabled hosts in parallel, per-host try/catch/finally so one bad host does not kill the aggregation.

**When to use:** Any route that must produce a whole-fleet answer.

**Example (verbatim shape from `sessions.ts:294-566`):**

```typescript
// Source: src/backend/database/routes/sessions.ts:294-566
router.post("/conversation-search", authenticateJWT, async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { query, offset = 0, limit = 20 } = req.body as { query: string; offset?: number; limit?: number };

  // Same host-filter idiom as sessions.ts:298-317 (drop enableSsh=false + autoTmux=false).
  const rows = await SimpleDBOps.select(
    db.select().from(hosts).where(eq(hosts.userId, userId)),
    "ssh_data",
    userId,
  );
  const candidates = rows.filter((h) => {
    if (!h.enableSsh) return false;
    let cfg = {};
    if (typeof h.terminalConfig === "string" && h.terminalConfig) {
      try { cfg = JSON.parse(h.terminalConfig); } catch { /* ignore */ }
    } else if (h.terminalConfig && typeof h.terminalConfig === "object") {
      cfg = h.terminalConfig;
    }
    return cfg.autoTmux !== false;
  });

  // The pattern: Promise.all with per-host try/finally + timeout race.
  const results = await Promise.all(
    candidates.map(async (h) => {
      const hostId = h.id as number;
      try {
        const resolved = await resolveHostById(hostId, userId);
        if (!resolved) return [];
        const conn = await connectOneShot(resolved, CONNECT_TIMEOUT_MS);
        try {
          // ... per-host work here: enumerate identities, discover per-identity latest transcript,
          //     run one shell-side grep pipeline over the resolved paths, return per-hit rows ...
          return perHostRows;
        } finally {
          try { conn.end(); } catch { /* ignore */ }
        }
      } catch (e) {
        sshLogger.debug("conversation-search: host skipped", {
          operation: "conversation_search_host_skip",
          hostId,
          error: e instanceof Error ? e.message : "unknown",
        });
        return [];
      }
    }),
  );

  const flat = results.flat();
  flat.sort((a, b) => b.transcriptMtime - a.transcriptMtime);   // recency-first, D-10
  const page = flat.slice(offset, offset + limit);
  res.json({ results: page, hasMore: flat.length > offset + limit });
});
```

**PER_HOST_TIMEOUT_MS:** already declared in `sessions.ts` (30_000ms). Copy the same constant into the new route file — the codebase's convention is file-local timeout constants (see `discover-identity-session-file.ts:113` for `DISCOVERY_EXEC_TIMEOUT_MS`).

### Pattern 2: Identity → Latest Transcript Resolution (D-09 REUSE)

**What:** For a given identity name + host, resolve the absolute path of the most-recent JSONL transcript that identity has been active in.

**When to use:** Anywhere in the phase's per-host code where the corpus is "the identity's latest transcript."

**Example (verbatim wire shape from `sessions.ts:488`):**

```typescript
// Source: src/backend/database/routes/sessions.ts:485-524
import { discoverIdentitySessionFile } from "../../claude-session/discover-identity-session-file.js";

// Per identity on this host:
const jsonlPath = await discoverIdentitySessionFile(conn, identityKey);
if (jsonlPath === null) {
  // no transcript for this identity on this host — skip
  continue;
}
// jsonlPath is an absolute path shape (~/.claude/projects/<slug>/<uuid>.jsonl)
// Safe to interpolate into a shell command — single-quote-wrap defensively.
```

**Semantics of "latest":** `discoverIdentitySessionFile` walks `~/.claude/projects/*/*.jsonl`, sorts by mtime descending, and returns the newest file whose FIRST user-role line invoked `/id <identityKey>`. This is stronger than "newest mtime" — it correctly identifies the transcript that BELONGS to this identity even when two identities share a cwd. LOCAL branch: node-fs walk of `getLocalClaudeProjectsRoot()` (HOME_HOST_DIR-derived bind mount). REMOTE branch: single SSH exec of a shell script that emits `mtime\tpath\n<first-user-line>\n---GSDR-32---\n` per file.

**Fail-safe contract:** returns `null` on any SSH throw, timeout, empty dir, or no-match. Caller must handle null (skip the identity).

### Pattern 3: Modal Composition (REUSE — do NOT invent new chrome)

**What:** Portal-mounted Radix Dialog with glass-morphism surface, `onInteractOutside={e => e.preventDefault()}` (X + Esc only close paths — patch #111f discipline), responsive `absolute inset-4` mobile + `md:max-w-[560px] md:max-h-[720px] md:left-1/2 ...` desktop.

**When to use:** THE modal for this phase.

**Example (verbatim from `NewConversationModal.tsx:268-441`):**

```tsx
// Source: src/ui/features/pretty-conversations/NewConversationModal.tsx:268-441
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogHeader, DialogTitle, DialogClose } from "@/components/dialog";
import { X, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function ConversationSearchModal({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // ... state, handlers ...
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "absolute inset-0 z-[110] bg-black/40",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          onInteractOutside={(e) => e.preventDefault()}
          className={cn(
            "absolute inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            "md:max-w-[560px] md:max-h-[720px] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2",
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
          <DialogTitle className="sr-only">Search conversations</DialogTitle>
          {/* header, body (input + results + load-more), footer */}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
```

### Pattern 4: Module-Scoped Store with `useSyncExternalStore` (D-05)

**What:** A store slice that lives OUTSIDE any component so it survives modal unmount and preserves last-query + accumulated-results across opens.

**When to use:** THE state layer for the search modal.

**Example (mirrors `conversation-store.ts` archived-slice pattern):**

```typescript
// Source: pattern from src/ui/state/conversation-store.ts:2345-2424 (archived-rows slice)
import { useSyncExternalStore } from "react";
import type { ConversationSearchResult } from "@/api/conversation-search-api";

type SearchState = {
  query: string;
  results: ConversationSearchResult[];
  hasMore: boolean;
  isFetching: boolean;
  hasEverOpened: boolean;   // D-06: empty state only on first-open or after clear
  error: string | null;
};

let state: SearchState = {
  query: "",
  results: [],
  hasMore: false,
  isFetching: false,
  hasEverOpened: false,
  error: null,
};
const listeners = new Set<() => void>();
function subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); }
function notify() { for (const l of listeners) l(); }
function getSnapshot() { return state; }

export function useSearchState() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function setSearchQuery(q: string): void {
  state = { ...state, query: q, hasEverOpened: true };
  notify();
}
export function clearSearch(): void {
  state = { ...state, query: "", results: [], hasMore: false, error: null };
  notify();
}
// ... etc for setFetching, appendResults, setError ...
```

### Anti-Patterns to Avoid

- **Inventing a new fan-out shape:** D-19 forbids this. Use the `sessions.ts:319` `Promise.all(candidates.map(...))` idiom byte-for-byte.
- **Forking the identity → latest transcript logic:** D-09 forbids this. Import `discoverIdentitySessionFile` from `src/backend/claude-session/discover-identity-session-file.ts` and use its LOCAL/REMOTE branch as-is.
- **Building a new modal system:** The codebase has 6+ modals all using `radix-ui` `DialogPrimitive.Root`. Lift the recipe.
- **Storing search state inside the modal component:** violates D-05 — modal unmount would erase the last query. State MUST live in a module-scoped store.
- **Fetching on every keystroke:** violates D-01. Enter-only fires the network call. Typing only updates the local input value; the enter-handler is the network trigger.
- **Removing the sidebar filter BEFORE the modal is usable:** violates D-18. Wave the removal AFTER the modal ships.
- **Client-side joining of `isArchived`:** Prefer server-authored flag in each result row. Client-side join against `useArchivedFleetRows()` risks race with the WS-driven archive slice updates during the fetch.
- **Passing user query through shell interpolation unescaped:** Anywhere the query goes into a shell command, it MUST be single-quote-wrapped via the codebase's `shellSingleQuote` idiom (`discover-identity-session-file.ts:247`). Better: pass the query as a positional argument to a shell heredoc that reads it from `$1`, so the query never touches the shell parser at all.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Identity → latest transcript resolution | Your own mtime-sort walker | `discoverIdentitySessionFile` | Already handles LOCAL vs REMOTE, fail-safe null returns, race between two identities sharing a cwd (via first-user-role match, not mtime alone) |
| Cross-host aggregation | Your own SSH loop | `Promise.all(candidates.map(...))` from `sessions.ts:319` | Already handles per-host try/finally, connection lifecycle, timeout race, silent-drop-on-error |
| SSH connection lifecycle | Raw ssh2 client instantiation | `resolveHostById` + `connectOneShot` (one-shot) OR `withConnection(poolKey, ...)` (pooled) | Established across every host-touching route |
| JWT + RBAC | Your own auth check | `authManager.createAuthMiddleware()` + `permissionManager.canAccessHost(userId, hostId, "read")` | Every route uses this shape |
| Modal chrome (portal, overlay, animation, glass) | Own modal system | `radix-ui` `DialogPrimitive.*` + copy the `NewConversationModal.tsx` shell | Six existing modals use this identical pattern |
| Modal state persistence across opens | Local component state + parent-hoisted prop | Module-scoped store + `useSyncExternalStore` | The archived-rows slice at `conversation-store.ts:2345-2424` is the copy-target |
| Frontend fetch wrapper | Raw fetch/axios | `authApi.post(url, body)` from `@/main-axios` + `handleApiError(err, ctx)` | Every existing `src/ui/api/*.ts` uses this shape |
| Error class propagation | JSON error stringification | Backend returns `{ error: "some_class_string" }`; frontend throws `Error(class)` in `catch (err) { if (axios.isAxiosError(err)) { ... rethrow class ... } }` | Established at `workspace-api.ts:63-80` |

**Key insight:** This phase is >90% composition. Every load-bearing primitive already exists. The single genuinely-new piece is the grep + snippet extraction (Claude's Discretion). Everything else is wiring.

## Runtime State Inventory

Skip — Phase 122 is greenfield feature work with no rename/refactor/migration component.

## Common Pitfalls

### Pitfall 1: `discoverIdentitySessionFile` returns `null` for archived identities

**What goes wrong:** The helper's shell script walks `~/.claude/projects/*/*.jsonl` and matches the first-user-role line against `/id <identityName>`. But identities in `~/fleet/identities-archive/` may have been renamed on retire (some retire flows append a timestamp), and even if they weren't, their JSONL transcript may have been archived alongside the identity — moved out of `~/.claude/projects/`.

**Why it happens:** The `.claude/projects/` directory is Claude Code's runtime scratch — archive of the fleet identity folder does NOT move the transcript file. But the transcript file might have been GC'd or moved by a separate process; and the identity's `.md` in `~/fleet/identities-archive/<name>/` may not match the historical `/id <name>` invocation exactly.

**How to avoid:**
- Investigate during Wave 0 whether an archived identity's JSONL survives at its original `~/.claude/projects/<slug>/<uuid>.jsonl` path.
- If it does: `discoverIdentitySessionFile` works unchanged for archived identities too — verify empirically on t1000 for at least 3 archived identities before locking the plan.
- If it doesn't: two options — (a) at retire time, record the transcript path in a sidecar file inside the archive folder; (b) fall back to mtime-only walk for archived identities (weaker, but visible-only-not-openable per D-15 lowers the correctness bar).
- Plan must include a Wave 0 checkpoint task: "Manually verify: pick 3 archived identities on t1000, confirm `discoverIdentitySessionFile(null, name)` returns a non-null absolute path, cat the first ~200 bytes of the returned file to confirm it's the right identity."

**Warning signs:** Zero archived rows in search results despite matching content in a known-archived identity's transcript.

### Pitfall 2: Cross-host fan-out timeout kills the whole endpoint

**What goes wrong:** One slow host stalls the whole `Promise.all(...)` for `PER_HOST_TIMEOUT_MS`, then the user sees a spinner for 30 seconds. Or worse: an unreachable host throws after the timeout and the top-level handler 500s.

**Why it happens:** Naive `Promise.all` waits for every promise. Naive per-host code without a `Promise.race([work, timeout])` never times out.

**How to avoid:** Copy the `sessions.ts:319-566` shape verbatim — every per-host block is wrapped in `try { ... } catch (e) { sshLogger.debug(...); return []; }` so one host's failure yields an empty slice from that host, not a global failure. Per-operation timeouts use `Promise.race([execCommand(...), new Promise((_, rej) => setTimeout(() => rej(...), PER_HOST_TIMEOUT_MS))])`. The endpoint returns `{ results: [], hasMore: false }` for a fully-empty aggregation — never 500.

**Warning signs:** 500 responses in vitest tests that mock one host as throwing. Long spinner in UAT when one host is offline.

### Pitfall 3: Search modal state leaks between different users on multi-tenant deploys

**What goes wrong:** The module-scoped store outlives page navigation and could theoretically show a previous session's cached results if the user logged out and back in.

**Why it happens:** Module-scoped state has whole-page-load lifetime, not per-user lifetime.

**How to avoid:** In the search-store slice, add a subscription to the auth-changed signal (whatever hook AppShell uses for auth state) and call `clearSearch()` on logout. Skynet is single-tenant per browser tab in practice, so this is defense-in-depth — but the discipline is documented at `NewConversationModal.tsx` (T-91-FE-02 tenant-scoping) and the phase should mirror it.

**Warning signs:** Stale results visible after a hypothetical logout + login sequence.

### Pitfall 4: Snippet extraction returns raw JSON tokens

**What goes wrong:** A grep hit inside a JSONL line returns 100 chars of `{"parentUuid":"a1b2","type":"user","message":{"content":[{"type":"text","text":"...actual match here..."}]}}` — the user sees curly braces and quote marks, not the human content.

**Why it happens:** JSONL transcripts are structured; each line is a JSON object whose `message.content[].text` is where the human-readable text lives. A raw grep hit spans JSON syntax.

**How to avoid:** After grep locates the matching line, parse the JSON on the backend (only for the hit-line, not the whole file) using the same `extractText(content)` logic from `src/backend/claude-session/session-file-parser.ts:150` — which returns the concatenated `text` field content. Then run substring-locate the query INSIDE that extracted text and window ±80 chars around the hit. If JSON parse fails (rare — malformed transcript line), fall back to raw-line snippet as a degraded but non-crashing case.

**Example:**
```typescript
// Source of extractText: src/backend/claude-session/session-file-parser.ts:150-167
function snippetForHit(line: string, query: string): string {
  try {
    const obj = JSON.parse(line);
    // obj.message.content is either a string or an array of content blocks.
    const rawText = extractText(obj?.message?.content);
    const idx = rawText.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return rawText.slice(0, 160);
    const start = Math.max(0, idx - 80);
    const end = Math.min(rawText.length, idx + query.length + 80);
    return (start > 0 ? "…" : "") + rawText.slice(start, end) + (end < rawText.length ? "…" : "");
  } catch {
    return line.slice(0, 160);  // degraded fallback
  }
}
```

**Warning signs:** Snippets showing `{"type":"text","text":"..."}` fragments in UAT.

### Pitfall 5: The existing label-only filter's `matchesSearch` and `searchMatches` derivations are STILL referenced after removing the input

**What goes wrong:** Removing only the JSX (`.pv-search-container` block at L2393-L2424) leaves the `searchQuery` state, `matchesSearch` callback, `searchMatches` useMemo, and the `searchMatches !== null` branch at L2529 orphaned but compiling. The dead code accumulates and the filter branch still runs on every render because `trimmedSearchQuery` is always "".

**Why it happens:** The filter is entangled across 5+ locations in `PrettyConversationsPanel.tsx` (L896 state, L926 scroll-hide ref, L1161-L1222 predicate, L1239-L1259 memo, L2393-L2424 input JSX, L2529-onwards ternary branch, plus `SEARCH_HIDDEN_SENTINEL_KEY` at L232). Also: `pretty-conversations.css` L265-L306 rules.

**How to avoid:** Plan a dedicated cleanup task for the D-17 removal. Explicit deliverable list:
1. Delete `searchQuery` useState (L896).
2. Delete `searchContainerRef` useRef (L906) and the one-shot cold-load scroll-hide useEffect (~L920-L935).
3. Delete `SEARCH_HIDDEN_SENTINEL_KEY` constant (L232) and any sessionStorage reads of it.
4. Delete `matchesSearch` useCallback (L1161-L1222).
5. Delete `trimmedSearchQuery` + `searchMatches` useMemo (L1239-L1259).
6. Delete the `searchMatches !== null` branch in JSX (L2529-L?) — restoring only the three-zone view.
7. Delete `.pv-search-container` block at L2393-L2424.
8. Delete CSS rules `.pv-search-container / .pv-search-icon / .pv-search-input / .pv-search-input::placeholder / .pv-search-clear` from `pretty-conversations.css` L265-L306.
9. Remove `Search`, `X` imports from `lucide-react` line at L67 IF and only IF no other consumer remains (the header button will re-add `Search`; likely `X` stays if used elsewhere).
10. Grep `data-testid="pretty-conversations-search-*"` and delete any tests that rely on the old selectors OR update them to the new modal's testids.

**Warning signs:** `npm run test` fails on `PrettyConversationsPanel.test.tsx` after the input JSX is removed but the state is still declared — dead-code assertions break. `tsc --noEmit` may or may not flag; TypeScript is tolerant of dead state.

### Pitfall 6: The user's grep query lands inside a shell-side command line unescaped

**What goes wrong:** A query like `foo; rm -rf ~` becomes shell-injected on every managed host.

**Why it happens:** Naive string interpolation into a shell command.

**How to avoid:**
- **Preferred:** Pass the query via stdin or as a positional argument that the shell reads from `$1`. Example: `sh -c 'grep -F -i -l "$1" ...' -- "$QUERY"` — the shell parser never sees the query's bytes as syntax.
- **Fallback:** Single-quote-wrap via the codebase's `shellSingleQuote` idiom (`discover-identity-session-file.ts:247`): `"'" + s.replace(/'/g, "'\\''") + "'"`. Still valid but less robust.
- Also: use `grep -F` (fixed-string), not `grep -E` — this eliminates regex interpretation on the shell side, honoring D-02.

**Warning signs:** Zero — silent security failure. **Include an explicit test in the plan**: "Test: query = `foo'; touch /tmp/OWNED; #` runs cleanly with zero side effects. Assert `/tmp/OWNED` does NOT exist post-call."

### Pitfall 7: Load-more re-runs the whole grep and pagination drifts

**What goes wrong:** Between the first fetch (offset=0) and the load-more (offset=20), a new turn lands in some transcript, its mtime updates, and its position in the sorted list shifts. The user sees the same result twice, or misses a result.

**Why it happens:** D-12 says load-more re-runs the same query with the next offset — this is a stateless server operation. There's no cursor.

**How to avoid:** Accepted as-is per D-12 ("server re-runs the same query with the next offset"). The plan should surface this as a known limitation in the phase's SHIP notes ("Corpus-mutation during pagination may cause visible dedupe/skip at the offset boundary"), NOT try to invent a cursor. Sub-second grep + the human-latency of "click load-more" makes visible drift rare in practice.

**Warning signs:** UAT reports of visibly-duplicate rows after clicking load-more — expected, not a bug.

## Code Examples

### Backend route skeleton (mount + handler)

```typescript
// Source: src/backend/database/database.ts:77 (imports pattern) + :2012 (mount pattern)
// NEW file: src/backend/database/routes/conversation-search.ts
import express from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { sshLogger } from "../../utils/logger.js";
import { db } from "../db.js";
import { hosts } from "../schema.js";
import { SimpleDBOps } from "../simple-db-ops.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { discoverIdentitySessionFile } from "../../claude-session/discover-identity-session-file.js";
import { listIdentityKeysOnHost } from "../../claude-session/identity-artifact-reader.js";
// NEW helper: enumerate archived identities via the identities-archive dir walk.
// Mirror listIdentityKeysOnHost shape but rooted at ~/fleet/identities-archive/.

const CONNECT_TIMEOUT_MS = 5_000;
const PER_HOST_TIMEOUT_MS = 30_000;

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

router.post(
  "/",
  express.json({ limit: "16kb" }),
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    // Validate body
    const body = req.body as { query?: unknown; offset?: unknown; limit?: unknown } | null;
    const query = typeof body?.query === "string" ? body.query.trim() : "";
    const offset = typeof body?.offset === "number" && Number.isInteger(body.offset) && body.offset >= 0 ? body.offset : 0;
    const limit = typeof body?.limit === "number" && Number.isInteger(body.limit) && body.limit > 0 && body.limit <= 100 ? body.limit : 20;
    if (query.length === 0) {
      return res.json({ results: [], hasMore: false });
    }
    // ... rest of handler — see Cross-Host Fan-Out pattern above ...
  },
);
export default router;
```

Then in `database.ts`:
```typescript
// Source: src/backend/database/database.ts:77, :2012
import conversationSearchRoutes from "./routes/conversation-search.js";
// ... elsewhere in the file, alongside other route mounts ...
app.use("/conversation-search", conversationSearchRoutes);
```

### Per-host grep script (Claude's Discretion — recommended shape)

The following shell script runs ONCE per host over a list of resolved transcript paths built from `discoverIdentitySessionFile`. It emits one line per hit with fields tab-separated:

```bash
# Executed via execCommand(conn, script). Emits:
#   <mtime>\t<path>\t<line-number>\t<raw-line>\n
# for each matching line in each path. Query passed via stdin/env to avoid shell interpolation.
IFS=$'\n'
QUERY="$1"   # bound in JS: `sh -c '<script>' -- <shellSingleQuote(query)>`
for path in "${PATHS[@]}"; do
  mtime=$(stat -c '%Y' "$path" 2>/dev/null || echo 0)
  grep -F -i -n --max-count=3 -- "$QUERY" "$path" 2>/dev/null | while IFS=: read -r lineno content; do
    printf '%s\t%s\t%s\t%s\n' "$mtime" "$path" "$lineno" "$content"
  done
done
```

Notes: `--max-count=3` caps hits per file (avoids one chatty transcript flooding the result set); `-F` = fixed-string (D-02 no regex); `-i` = case-insensitive (D-02); JS side accumulates the raw lines and runs the JSON-parse + `extractText` + window snippet extraction on the backend (see Pitfall 4 for the snippet function). Alternatively, run the full grep in Node's `child_process` on the LOCAL branch and use SSH exec on REMOTE — matches `discoverIdentitySessionFile`'s LOCAL/REMOTE split.

### Frontend API wrapper

```typescript
// Source: src/ui/api/workspace-api.ts pattern (verbatim shape)
// NEW file: src/ui/api/conversation-search-api.ts
import axios from "axios";
import { authApi, handleApiError } from "@/main-axios";

export type ConversationSearchResult = {
  transcriptPath: string;      // opaque; used as row key
  transcriptMtime: number;     // ms epoch, for sort verification
  identityKey: string;
  hostId: number;
  hostName: string;
  aiTitle: string | null;      // reuses the same aiTitle field the sidebar already displays
  snippet: string;             // pre-windowed, humanized (from Pitfall 4's snippetForHit)
  hitStart: number;            // char offset into snippet where the highlight starts
  hitLength: number;           // char length of the highlight
  isArchived: boolean;         // server-authored (Pattern 4 above)
};
export type ConversationSearchResponse = {
  results: ConversationSearchResult[];
  hasMore: boolean;
};

export async function searchConversations(
  query: string,
  offset: number,
  limit: number,
): Promise<ConversationSearchResponse> {
  try {
    const response = await authApi.post("/conversation-search", { query, offset, limit });
    return response.data as ConversationSearchResponse;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "ConversationSearchError";
        throw rich;
      }
    }
    handleApiError(error, "search conversations");
    throw error;
  }
}
```

### Modal → panel → header wiring

```tsx
// EDIT: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
// In the .pv-header-actions cluster (~L2304-L2370), add a new sibling button BEFORE
// the SquarePen "New conversation" button (or wherever the discretionary placement lands).
import { useState } from "react";
import { ConversationSearchModal } from "./ConversationSearchModal";

const [searchModalOpen, setSearchModalOpen] = useState(false);
// ... in the JSX header actions ...
<button
  type="button"
  className="pv-pencil"
  aria-label="Search conversations"
  title="Search conversations"
  data-testid="pv-header-search-button"
  onClick={() => setSearchModalOpen(true)}
>
  <Search size={18} />
</button>
// ... mount the modal alongside the other portal-mounted modals ...
<ConversationSearchModal
  open={searchModalOpen}
  onOpenChange={setSearchModalOpen}
  onOpenActiveConversation={(result) => {
    // Reuse onDetachedRowClick shape (AppShell.tsx:3068). AppShell passes the
    // handler in via a new prop mirroring how onDetachedRowClick / onRelayRoomRowClick
    // are already threaded through PrettyConversationsPanel props.
  }}
/>
```

The wiring in `AppShell.tsx` mirrors the existing `onDetachedRowClick` at L3068 verbatim — resolve `row.host` from the search result's `hostId`, call `openTab(host, "terminal", undefined, { targetTmuxSession, label, allowCreateTmux: false })`, then `selectConversationDeferred(newTabId)` and mobile navigation nudges.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Sidebar filter-as-you-type (label-only, in-memory) | Modal + backend content-search across fleet | This phase (122) | Weak filter replaced with real search; archive becomes browsable |
| Ashley's browse-the-archive expectation | Search IS the archive-browse mechanism | Phase 115 (archive) + this phase (search access) | No archive-section UI is being built; visibility comes exclusively through search |

**Deprecated/outdated:** Nothing — this phase adds a surface.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Archived identities retain a resolvable JSONL under `~/.claude/projects/` after archive | Pitfall 1 | If wrong, archived-branch of D-08 returns zero results silently. Wave 0 checkpoint proposed to verify empirically. |
| A2 | The naive per-file grep timing measured on t1000 (~600ms wall) extrapolates to the 4GB Graviton target minimum | D-13 (from CONTEXT.md) | If wrong on smaller boxes, first-fire may take multiple seconds. Loading spinner in the modal is required regardless. |
| A3 | The user's grep query is not persisted across page reloads (only across modal open/close within a page) | D-05 | CONTEXT.md is silent on cross-reload persistence. Planner may confirm. |
| A4 | Cross-user JWT scoping is sufficient for the endpoint's authorization (no additional RBAC beyond the caller's host-list filter) | Standard Stack — Auth | Skynet is single-tenant in practice; the `enableSsh + autoTmux` filter in `sessions.ts:304-317` is the effective host-scope. Following the same pattern is consistent with the app. If Skynet grows multi-tenancy, the pattern generalizes with per-host `canAccessHost` (already available). |
| A5 | Backend flagging `isArchived` on each result is preferable to client-side join against `useArchivedFleetRows()` | Pattern 4 / Architecture map | If wrong, plan can revert to client-side join with a small tweak to `ConversationSearchModal.tsx`. Low risk. |
| A6 | `discoverIdentitySessionFile` fail-safe null semantics are acceptable for search (a null-returning identity contributes zero rows and is not surfaced as an error) | Pattern 2 | Aligns with existing `sessions.ts:493` handling. No user-facing error needed for a missing transcript. |
| A7 | `--max-count=3` per file is a reasonable cap for D-11 "highlighted snippet" (single most-recent match is the intent) | Code Examples — grep script | The planner may want 1 (single hit per row) or 5. Cheap to change. |

## Open Questions

1. **Archived identity's transcript survival post-archive.**
   - What we know: `discoverIdentitySessionFile` walks `~/.claude/projects/` and matches first-user-role. Archive moves the identity folder from `~/fleet/identities/` to `~/fleet/identities-archive/`. What happens to the `.claude/projects/<slug>/<uuid>.jsonl` is not documented in the code paths I traced.
   - What's unclear: whether the transcript remains discoverable, whether the archive process moves/renames it, and whether the `/id <name>` first-user-role line still matches the archived identity's key.
   - Recommendation: Wave 0 checkpoint task before the endpoint plan lands — "manually run `discoverIdentitySessionFile` for 3 known-archived identities on t1000 and record the return values." If null, plan the archived-branch differently (see Pitfall 1 options a/b).

2. **Placement of the magnifying-glass button relative to existing header buttons.**
   - What we know: There are already 5 buttons in `.pv-header-actions` (New conversation, Create project, Edit roles, Edit global files, More menu — see L2309-L2370). All render behind a `showPencilButton` gate.
   - What's unclear: Whether the search button should sit inside the `showPencilButton` gate (right-side cluster) or as a always-visible left/right-of-title element. CONTEXT.md says "next to existing header buttons" — likely inside the same cluster, first position (leftmost) so it's discoverable.
   - Recommendation: Planner picks first-in-`.pv-header-actions` cluster and gates it identically to the other buttons. Ashley can UAT-move it in an inline follow-up.

3. **`aiTitle` availability at result-row rendering time.**
   - What we know: The sidebar rows display an ai-title derived from a JSONL tail-scan (`scanTailForLatestAiTitle` — see `sessions.ts:485-524`). That title is a whole separate discovery, distinct from grep.
   - What's unclear: whether the search endpoint should ALSO run `scanTailForLatestAiTitle` on each hit's transcript file to populate `aiTitle` (adds ~10-30ms per host, negligible), or whether the row should show the transcript filename / identity displayName instead.
   - Recommendation: Include `aiTitle` — the piggyback is cheap since we already have the file path and are already tail-reading it for grep. Falls back to identity displayName when `aiTitle` is null.

4. **Snippet HTML escape / render approach.**
   - What we know: Snippets contain arbitrary user + agent text. React text children auto-escape; the highlight can be achieved with `<span className="pv-search-hit">{hitText}</span>` split around the match indices.
   - What's unclear: nothing critical — this is standard "split string on match, render array of text and highlighted spans."
   - Recommendation: Return `{ snippet: string, hitStart: number, hitLength: number }` from the backend so the frontend can split cleanly. No `dangerouslyInnerHTML` anywhere.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Backend runtime | ✓ | as running Skynet | — |
| ssh2 (npm) | SSH transport | ✓ | as installed | — |
| `grep` on managed hosts | Backend per-host content-search | ✓ (assumed — every POSIX host has grep) | — | Fall back to Node `fs.readFile` + `string.includes` if grep is absent (unlikely) |
| `stat` on managed hosts | mtime lookup | ✓ (assumed) | — | Node `fs.stat` on LOCAL; parse `find -printf '%T@ %p'` on REMOTE (already used by `discover-identity-session-file.ts:231`) |
| SSH connectivity to managed hosts | fan-out | ✓ (in-use today) | — | — |
| `~/fleet/identities/` present on each host | Live-tree enumeration | ✓ (fleet-defined convention) | — | Empty dir → zero identities; `|| true` in shell handles missing dir |
| `~/fleet/identities-archive/` present on each host | Archive-tree enumeration | ✓ but may be absent on hosts with no archives | — | Missing dir → zero archived identities; graceful degradation via `find ... 2>/dev/null || true` pattern already used at `identity-artifact-reader.ts:1171` |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None material.

## Validation Architecture

Skipped: `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`. Test conventions instead:

- **Backend tests:** vitest with `environment: "node"`, include `src/backend/**/*.test.ts`. New file: `src/backend/database/routes/conversation-search.test.ts` — mirror `workspace-routes.test.ts` shape: mock `resolveHostById` + `discoverIdentitySessionFile` + `execCommand`; assert per-host fan-out, timeout race, error-class shape (`{ error: "..." }` never `err.message`), zero shell-injection when query contains `'`, `"`, `;`, `$`, backticks, `\n`.
- **Frontend tests:** vitest with `environment: "jsdom"`, include `src/ui/**/*.test.{ts,tsx}`. New file: `src/ui/features/pretty-conversations/ConversationSearchModal.test.tsx` — test enter-only fire (no keystroke fire), pagination via load-more, close-on-active-click (D-14), alert-and-stay-open on archived-click (D-15), empty-state gated on `hasEverOpened + query === ""` (D-06), state persistence across unmount (D-05).
- **API tests:** Mirror `workspace-api.ts` test pattern (colocated `.test.ts`) — assert error-class extraction, request-body shape, response-body shape.
- **Panel integration tests:** Extend `PrettyConversationsPanel.test.tsx` — assert new `<Search>` header button renders + onClick opens modal; assert old `.pv-search-container` block and its `data-testid`s are gone (D-17 removal proof); assert removed CSS rules by grepping the CSS import.
- **Playwright smoke:** Extend `tests/e2e/smoke.spec.ts` — new smoke test opens the modal, types a known-substring query, presses Enter, asserts at least one result row appears, clicks it, asserts the pretty view mounts. Optional: separate spec for archived-click alert dialog.

## Security Domain

`security_enforcement: true` in `.planning/config.json`; `security_asvs_level: 1`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `AuthManager.getInstance().createAuthMiddleware()` — reuse of existing JWT gate |
| V3 Session Management | yes | JWT-cookie session lifecycle owned by AuthManager; no new session state in this phase |
| V4 Access Control | yes | Route's host-list projection is scoped by `userId` (`SimpleDBOps.select(...where(eq(hosts.userId, userId))...)` per `sessions.ts:298-302`). Per-host `canAccessHost` from PermissionManager is optional here since the `userId` filter is authoritative for host visibility; add it if the plan wants defense-in-depth. |
| V5 Input Validation | yes | Zod optional; at minimum strict type-check of `{ query: string, offset: integer >= 0, limit: 1..100 }` in the handler prelude. Query length cap recommended (e.g. 500 chars) to bound grep argv. |
| V6 Cryptography | no | No cryptography in this phase — data-in-transit uses existing TLS termination; no data-at-rest beyond in-memory results. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell injection via user query | Tampering | `sh -c '...' -- "$QUERY"` OR `shellSingleQuote(query)` idiom. Include an explicit vitest test with `query = "foo'; touch /tmp/OWNED; #"` asserting `/tmp/OWNED` not created. See Pitfall 6. |
| Path-traversal via a malicious transcript path | Tampering | `discoverIdentitySessionFile` returns paths from a controlled walk of `~/.claude/projects/`; the query never touches path construction. No user-supplied path in this phase. |
| Cross-tenant data leak (results from another user's hosts) | Information Disclosure | Host-list projection scopes to `hosts.userId = userId` (per-user host visibility, established pattern). No new controls needed. |
| Denial of service via giant query fan-out | Denial of Service | `PER_HOST_TIMEOUT_MS = 30_000` + per-host try/catch/return-empty ensures a single slow host cannot stall the endpoint. Query-length cap bounds argv size. `--max-count=3` per file bounds per-host result-set memory. |
| Reflected XSS via snippet content | Tampering (client) | Snippets rendered via React text children (auto-escaped). Highlight applied via `<span>` split, NOT `dangerouslySetInnerHTML`. See Open Question 4. |
| Storage of last query in module-scoped store (privacy) | Information Disclosure | Store lives in memory only; dies on page reload. Explicit `clearSearch()` on auth-changed signal (Pitfall 3). |

## Sources

### Primary (HIGH confidence)
- `src/backend/database/routes/sessions.ts:294-566` — cross-host fan-out pattern
- `src/backend/database/routes/workspace-routes.ts:427-533` — route shape, auth pattern, body validation pattern
- `src/backend/database/routes/identity-archive.ts:76-` — narrow-endpoint pattern for single-purpose routes
- `src/backend/claude-session/discover-identity-session-file.ts:1-400` — identity → latest transcript resolver (LOCAL + REMOTE branches)
- `src/backend/claude-session/identity-artifact-reader.ts:1144-1178` — `listIdentityKeysOnHost` (adapt for archive-tree enumeration)
- `src/backend/claude-session/session-file-parser.ts:150-167` — `extractText` for snippet extraction from JSONL content blocks
- `src/backend/claude-session/session-file-range-reader.ts` — LOCAL/REMOTE branch idiom reference
- `src/ui/features/pretty-conversations/NewConversationModal.tsx:1-441` — modal chrome recipe (verbatim lift-target)
- `src/ui/features/pretty-conversations/CreateProjectModal.tsx` — second modal recipe
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:2277-2424` — sidebar header cluster (button placement) and inline filter block (D-17 removal target)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:1140-1259` — existing `matchesSearch` + `searchMatches` (also removed under D-17)
- `src/ui/features/pretty-conversations/pretty-conversations.css:265-306` — CSS rules for the input to be removed
- `src/ui/state/conversation-store.ts:2345-2424` — module-scoped store + `useSyncExternalStore` pattern for D-05
- `src/ui/api/workspace-api.ts:1-100` — frontend API wrapper pattern
- `src/ui/api/identity-archive-api.ts:1-32` — minimal-API-wrapper reference
- `src/ui/AppShell.tsx:3068-3118` — `onDetachedRowClick` shape for opening an active-session result
- `.planning/phases/122-conversation-search-modal/122-CONTEXT.md` — locked decisions
- `.planning/shapes/shape-conversation-search-modal.md` — /open shape file
- `.planning/config.json` — phase-config lookups (nyquist_validation, security_enforcement)
- `vitest.config.ts` — test project layout
- `package.json` — installed test/deps versions

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — project state header
- `substrate/scripts/fleet-status-sweep.py:1125-1156` — reference confirmation that `identities-archive/` is walked identically to `identities/` in the sweep (evidence D-08 is straightforwardly implementable)

### Tertiary (LOW confidence)
- None — every claim above is backed by direct file inspection in this session.

## Metadata

**Confidence breakdown:**
- Prior art (identity → latest transcript): HIGH — `discoverIdentitySessionFile` is documented with fail-safe contract and already-in-production for `aiTitle` (`sessions.ts:489`)
- Cross-host fan-out pattern: HIGH — `sessions.ts:319-566` is the canonical pattern, used verbatim by phase 122 per D-19
- Modal chrome + composition: HIGH — 6+ existing modals share the same recipe; lift `NewConversationModal.tsx` shell
- Sidebar filter removal (D-17): HIGH — the input's code is precisely located across 8 sites in PrettyConversationsPanel.tsx + 1 CSS block
- Snippet extraction approach: MEDIUM — proposed algorithm (JSON.parse hit-line → extractText → window ±80 chars) is well-defined; final tuning belongs in planning
- Grep security discipline: HIGH — `discover-identity-session-file.ts:247` `shellSingleQuote` idiom is the codebase convention
- Archived-identity JSONL survival post-archive: MEDIUM — assumption A1 flagged for Wave 0 empirical verification

**Research date:** 2026-09-20
**Valid until:** 2026-10-20 (30 days; code is stable, no fast-moving external deps in scope)
