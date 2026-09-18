# Phase 119: First-class apps — sidebar surface (shape 3) - Pattern Map

**Mapped:** 2026-09-18
**Files analyzed:** 11 (5 new + 6 modified)
**Analogs found:** 11 / 11 (every file has a strong in-repo analog — this is a pattern-extension phase, not an ecosystem-discovery phase)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| **NEW** `src/ui/features/pretty-conversations/AppTile.tsx` | component | frame-driven render + context-menu event | `PrettyConversationRow.tsx` (avatar-fallback block L1193-1220; context-menu block L1340-1431) | role-match (bubble+avatar+menu shape) |
| **NEW** `src/ui/state/app-tiles-store.ts` | store slice | pub-sub (WS frames → React `useSyncExternalStore`) | `src/ui/state/session-working-store.ts` (Map + Set of listeners + `useSyncExternalStore` reader) | exact (same store convention) |
| **NEW** `src/backend/database/routes/apps.ts` | backend route (Express router) | request-response, streams file bytes | `src/backend/database/routes/identities.ts` §849-966 (`GET /:identityKey/avatar`) | exact (D-06 explicit mirror) |
| **NEW** `readAppIconFile(conn, slug)` helper (append to `identity-artifact-reader.ts`) | utility (co-located helper) | file-I/O via SSH + local fs | `readAvatarSiblingFile` at `identity-artifact-reader.ts:2469-2580` | role-match (single-extension simplification; see Pitfall 5) |
| **NEW** `src/ui/features/pretty-conversations/AppTile.test.tsx` | test (component) | jsdom + @testing-library/react | any `*Row.test.tsx` sibling; use `PrettyConversationRow.test.tsx` render harness | role-match |
| **NEW** `src/ui/state/app-tiles-store.test.ts` | test (store) | vitest — publish → assert `getSnapshot()` | `session-working-store.test.ts` | exact (mirror store test) |
| **NEW** `src/backend/database/routes/apps.test.ts` | test (route) | supertest against mounted app | `identities.get-disk.test.ts` (route test template) | role-match |
| **MODIFY** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | component (integration site) | render composition | Archived-section chrome at L1995-2033 + state hook at L737 | exact (D-02 verbatim mirror; D-05 differs — see below) |
| **MODIFY** `src/ui/features/pretty-conversations/pretty-conversations.css` | css (design tokens) | style | `.pv-row` L337-391 + `.pv-avatar` L399-441 + `.pv-panel-group` L251-255 | exact (glass tile is a `.pv-row` derivative) |
| **MODIFY** `src/ui/api/fleet-status-types.ts` | api-types (frontend mirror) | type declaration | Session frame declarations at L293-338 (`FrontendSnapshotFrame` etc.) | exact (add three app arms) |
| **MODIFY** `src/ui/api/fleet-status-client.ts` | api-client (WS switch dispatch) | request-response (WS) | Session dispatch cases at L164-234 (snapshot/update/gone/identity-archived) | exact (add three cases + three optional callbacks) |
| **MODIFY** `src/backend/database/database.ts` | config (Express mount) | route mount | `/identities` and neighbours at L1890-1980 | exact (append one `app.use("/apps", appsRoutes)`) |
| **MODIFY** `src/ui/AppShell.tsx` | component (client bootstrap) | callback wiring | `createFleetStatusClient({...})` call at `AppShell.tsx:626-667` | exact (add three callbacks alongside existing five) |
| **MODIFY** `src/ui/features/pretty-conversations/PrettyConversationsPanel.test.tsx` | test (integration) | jsdom render + fireEvent | Archived-section tests at L2625-2733 (A10-A14) | exact (mirror the A10-A14 shape with `mockAppTiles`) |

---

## Pattern Assignments

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (MODIFY — Apps section chrome)

**Analog:** Archived section at `PrettyConversationsPanel.tsx:1995-2033` (chrome block) + `PrettyConversationsPanel.tsx:737-738` (state hook + subscription hook)

**State hook pattern** (L737-738 — copy verbatim, swap names):
```tsx
const [archivedExpanded, setArchivedExpanded] = useState(false);
const archivedRows = useArchivedFleetRows();
```
→ For Apps:
```tsx
const [appsExpanded, setAppsExpanded] = useState(false);
const appTiles = useAppTiles();  // from src/ui/state/app-tiles-store
```

**Chrome block pattern** (L1995-2033 — clone; D-05 REMOVES the outer `.length > 0` gate):
```tsx
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
        {archivedRows.map((r) => (
          <PrettyArchivedRow key={`${r.hostId}::${r.name}`} name={r.name} hostname={r.hostname} />
        ))}
      </div>
    )}
  </div>
)}
```
→ For Apps (D-05: **NO outer `.length > 0` gate** — always render section; D-04: empty-expanded prompt inside the gate):
```tsx
<div className="pv-panel-group pv-apps-section">
  <button
    type="button"
    onClick={() => setAppsExpanded((v) => !v)}
    className="flex items-center gap-2 px-4 pt-3 pb-1.5 w-full text-left"
    data-testid="pretty-conversations-apps-header"
    aria-expanded={appsExpanded}
    aria-controls="pv-apps-section-content"
  >
    <AppWindow className="size-3 text-[#5c6070]/85 shrink-0" aria-hidden="true" />
    <span className="text-[13px] font-semibold uppercase tracking-[0.08em] text-[#5c6070]/85 shrink-0">
      Apps
    </span>
    <span aria-hidden="true"
      className="flex-1 h-px bg-[linear-gradient(90deg,rgba(255,255,255,0.06),transparent)]" />
    <ChevronDown
      className={`size-3 text-[#5c6070]/85 shrink-0 transition-transform ${appsExpanded ? "rotate-180" : ""}`}
      aria-hidden="true"
    />
  </button>
  {appsExpanded && (
    <div id="pv-apps-section-content">
      {appTiles.length === 0 ? (
        <div className="pv-apps-empty px-4 py-2 text-[13px] italic text-[#5c6070]/85">
          Ask an agent to make an app for you.
        </div>
      ) : (
        appTiles.map((app) => (
          <AppTile key={`${app.hostId}:${app.slug}`} app={app} />
        ))
      )}
    </div>
  )}
</div>
```

**Insertion point** (CRITICAL — Pitfall 2 from RESEARCH.md):
- Insert BETWEEN the loading strip at L1809-1823 and the search-vs-three-zone ternary at L1833
- Same JSX indentation as `{!fleetSessionsLoaded && (…)}` at L1809 (NOT nested inside the ternary)
- This puts the Apps section ABOVE the ternary so it renders during BOTH search-active and three-zone-view branches (D-05 "always present" invariant)

**Import addition** (extend the lucide-react import at L59):
```tsx
import { Archive, ChevronDown, ..., AppWindow, ... } from "lucide-react";
```
Add `useAppTiles` import from the new store module.

---

### `src/ui/features/pretty-conversations/AppTile.tsx` (NEW — tile component)

**Analog:** `PrettyConversationRow.tsx` — three specific blocks

**Avatar-fallback pattern** (from `PrettyConversationRow.tsx:1193-1220`):
```tsx
<div className="pv-avatar" data-testid="pcrow-avatar">
  {identity ? (
    identity.avatarUrl ? (
      <img
        src={identity.avatarUrl}
        alt=""
        className="pv-avatar-img"
        style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: "999px" }}
        draggable={false}
      />
    ) : (
      <span className="pv-avatar-initial">{initialLetter}</span>
    )
  ) : (
    <span className="pv-avatar-fallback-icon" aria-hidden="true">
      {tabIcon(row.type)}
    </span>
  )}
  ...
</div>
```

Adapt for D-07 + D-08 (state-flip fallback per RESEARCH.md recommendation for `<img onError>`):
```tsx
const [imgFailed, setImgFailed] = useState(false);
const iconUrl = `/apps/${app.hostId}/${app.slug}/icon`;
const showFallback = !app.hasIcon || imgFailed;
const initialLetter = app.title.trim().charAt(0).toUpperCase() || "?";

<div className="pv-app-icon-slot">
  {showFallback ? (
    <span className="pv-app-icon-initial">{initialLetter}</span>
  ) : (
    <img
      src={iconUrl}
      alt=""
      className="pv-app-icon-img"
      onError={() => setImgFailed(true)}
      draggable={false}
    />
  )}
</div>
```

⚠️ **Pitfall 3 from RESEARCH.md:** `.pv-avatar-initial` has NO CSS rule of its own — the letter typography (`color: #fbf5e8; font-size: 15px; font-weight: 700; letter-spacing: -0.01em`) is inherited from parent `.pv-avatar` at `pretty-conversations.css:436-439`. Do the SAME for `.pv-app-icon-slot` — put the typography on the parent, not on `.pv-app-icon-initial`.

**Context-menu open pattern** (from `PrettyConversationRow.tsx:397-418` + `:1340-1431`):
```tsx
const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
const closeSelf = useCallback(() => setCtxMenu(null), []);
const onRowContextMenu = useCallback((e: MouseEvent<HTMLDivElement>) => {
  e.preventDefault();
  e.stopPropagation();
  notifyMenuOpened(closeSelf);
  setCtxMenu({ x: e.clientX, y: e.clientY });
}, [closeSelf]);

// ... later in render:
{ctxMenu !== null && (
  <PrettyConversationContextMenu
    x={ctxMenu.x}
    y={ctxMenu.y}
    items={[{ label: "Open in new tab", onClick: () => window.open(url, "_blank", "noopener,noreferrer") }]}
    onClose={() => { notifyMenuClosed(closeSelf); closeSelf(); }}
  />
)}
```

D-12 v1 items array is single-entry — `[{ label: "Open in new tab", onClick: ... }]`.
URL construction (Claude discretion — RESEARCH.md recommends `/apps/${app.hostId}/${app.slug}`).
Security defence-in-depth: add `"noopener,noreferrer"` to `window.open` (RESEARCH.md §Security).

**Long-press mobile pattern** (from `PrettyConversationRow.tsx:442-451` + L595-603 timer body):
```tsx
const longPressTimerRef = useRef<number | null>(null);
const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
const suppressNextClickRef = useRef<boolean>(false);

// In onTouchStart body (L595-603):
longPressTimerRef.current = window.setTimeout(() => {
  notifyMenuOpened(closeSelf);
  setCtxMenu({ x, y });
  navigator.vibrate?.(10);  // feature-check gates iOS Safari (Pitfall 4)
  suppressNextClickRef.current = true;
  longPressTimerRef.current = null;
}, 500);
```

⚠️ Pitfall 4 from RESEARCH.md: Even though D-13 makes left-click a no-op in v1, KEEP `suppressNextClickRef` so shape 4's eventual left-click wire doesn't double-fire on long-press.

**D-11 unhealthy two-line rendering** (NEW — no in-repo precedent for muted-red inline text):
```tsx
<div className="pv-app-body">
  <span className="pv-app-title">{app.title}</span>
  {!app.isHealthy && app.healthMessage && (
    <span className="pv-app-unhealthy-message">{app.healthMessage}</span>
  )}
</div>
```
React auto-escapes `{app.healthMessage}` → zero XSS surface (RESEARCH.md §Security).

**D-13 cursor override:** Add `cursor: default` in CSS override for `.pv-app-tile` (base `.pv-row` at `pretty-conversations.css:345` is `cursor: pointer`).

---

### `src/ui/features/pretty-conversations/pretty-conversations.css` (MODIFY — new tile selectors)

**Analog for tile bubble:** `.pv-row` at L337-391

**Analog for icon slot:** `.pv-avatar` at L399-441

**Row bubble pattern to derive `.pv-app-tile` from** (`pretty-conversations.css:337-391`):
```css
.pv-row {
  --pv-hue: 216;
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  color: #fbf5e8;
  cursor: pointer;
  -webkit-touch-callout: none;
  user-select: none;
  -webkit-user-select: none;
  border-radius: var(--radius-pv-bubble);
  overflow: hidden;
  background: linear-gradient(160deg,
    hsla(var(--pv-hue), 50%, 38%, 0.55),
    hsla(var(--pv-hue), 45%, 24%, 0.60));
  border: 1px solid hsla(var(--pv-hue), 65%, 55%, 0.32);
  box-shadow:
    0 8px 24px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 220, 170, 0.18),
    0 0 0 0.5px hsla(var(--pv-hue), 70%, 55%, 0.20),
    0 0 32px hsla(var(--pv-hue), 70%, 52%, 0.18);
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  transition:
    transform 140ms ease,
    box-shadow 140ms ease,
    border-color 140ms ease;
}
.pv-row:hover {
  transform: translateY(-1px);
  box-shadow:
    0 12px 28px rgba(0, 0, 0, 0.55), ... ;
  border-color: hsla(var(--pv-hue), 65%, 55%, 0.42);
}
```

→ For `.pv-app-tile`: inherit ALL of the above; override only `cursor: default` (D-13) and drop the `.selected` variant (no primary-click). Do **NOT** emit `--pv-hue` on the tile (D-09) — the `--pv-hue: 216` fallback at L338 IS the default.

**Icon-slot pattern to derive `.pv-app-icon-slot` from** (`.pv-avatar` L399-441):
```css
.pv-avatar {
  position: relative;
  overflow: visible;
  z-index: 1;
  width: 40px;
  height: 40px;
  border-radius: 999px;   /* app tile: change to 10px per Claude discretion */
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(160deg,
    hsla(var(--pv-hue), 45%, 25%, 0.72),
    hsla(var(--pv-hue), 40%, 15%, 0.82));
  border: 1px solid hsla(var(--pv-hue), 65%, 55%, 0.40);
  box-shadow:
    0 4px 12px rgba(0, 0, 0, 0.6),
    inset 0 2px 0 rgba(255, 235, 190, 0.35),
    0 0 24px hsla(var(--pv-hue), 65%, 55%, 0.40);
  color: #fbf5e8;         /* inherited by .pv-app-icon-initial letter */
  font-size: 15px;         /* inherited by .pv-app-icon-initial letter */
  font-weight: 700;
  letter-spacing: -0.01em;
  flex-shrink: 0;
}
```

→ For `.pv-app-icon-slot`: verbatim copy, change only `border-radius: 999px` → `border-radius: 10px` (D-10 rounded-square, Claude discretion picked 10px per RESEARCH.md). Letter typography lives on the parent so `<span className="pv-app-icon-initial">L</span>` inherits automatically (mirrors the `.pv-avatar-initial` hallucination-risk pattern from Pitfall 3).

**D-11 unhealthy-message selector (NEW — no precedent):**
```css
.pv-app-unhealthy-message {
  color: #f4a09b;
  font-style: italic;
  font-size: 11.5px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
```

**`.pv-panel-group` structural rule** (`pretty-conversations.css:251-255`) — apps section is a plain `.pv-panel-group`:
```css
.pv-panel-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
```
No changes needed; new `.pv-apps-section` gets the tile-list layout for free.

---

### `src/ui/state/app-tiles-store.ts` (NEW — client subscription slice)

**Analog:** `src/ui/state/session-working-store.ts` (in-memory Map + Set<listener> + `useSyncExternalStore` reader)

**Core store pattern** (from `session-working-store.ts:207-225`):
```typescript
let state: State = {
  map: new Map<string, WorkingRecord>(),
};
let snapshotVersion = 0;
const listeners = new Set<() => void>();

function notify(): void {
  snapshotVersion += 1;
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
```

**Publish pattern** (from `session-working-store.ts:731-751` — `publishFleetStatusSessionGone` shape for the `app-gone` handler):
```typescript
export function publishFleetStatusSessionGone(
  hostId: string,
  tmuxSession: string | null,
  sessionId: string,
): void {
  const key = `${hostId}:${tmuxSession ?? ""}`;
  if (!state.map.has(key)) return; // no-op
  console.info({ operation: "fleet_status_session_gone", hostId, tmuxSession, sessionId, key });
  const nextMap = new Map(state.map);
  nextMap.delete(key);
  state = { map: nextMap };
  notify();
}
```

**Hook pattern** (from `session-working-store.ts:946-953`):
```typescript
export function useSessionIsWorking(key: string | null): boolean {
  const getSnapshot = (): boolean => {
    if (key === null) return false;
    const record = state.map.get(key);
    if (record === undefined) return false;
    return record.isWorking;
  };
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
```

**Test-only reset pattern** (from `session-working-store.ts:1151-1154`):
```typescript
export function __resetForTest(): void {
  state = { map: new Map<string, WorkingRecord>() };
  notify();
}
```

**Apply to app-tiles-store:**
```typescript
import { useMemo, useSyncExternalStore } from "react";
import type { AppState } from "../api/fleet-status-types.js";

let state = { map: new Map<string, AppState>() };
let snapshotVersion = 0;
const listeners = new Set<() => void>();
function notify(): void { snapshotVersion += 1; for (const l of listeners) l(); }
function subscribe(cb: () => void): () => void { listeners.add(cb); return () => { listeners.delete(cb); }; }
function getMapSnapshot(): ReadonlyMap<string, AppState> { return state.map; }

export function publishAppSnapshot(apps: AppState[]): void {
  const nextMap = new Map<string, AppState>();
  for (const a of apps) nextMap.set(`${a.hostId}:${a.slug}`, a);
  state = { map: nextMap };
  notify();
}
export function publishAppUpdate(app: AppState): void {
  const key = `${app.hostId}:${app.slug}`;
  const nextMap = new Map(state.map);
  nextMap.set(key, app);
  state = { map: nextMap };
  notify();
}
export function publishAppGone(hostId: string, slug: string): void {
  const key = `${hostId}:${slug}`;
  if (!state.map.has(key)) return;
  const nextMap = new Map(state.map);
  nextMap.delete(key);
  state = { map: nextMap };
  notify();
}

// D-15 stable sort + tiebreak inside a memoised selector.
export function useAppTiles(): AppState[] {
  const snapshot = useSyncExternalStore(subscribe, getMapSnapshot, getMapSnapshot);
  return useMemo(() => {
    return Array.from(snapshot.values()).sort((a, b) => {
      const t = a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      if (t !== 0) return t;
      return `${a.hostId}:${a.slug}`.localeCompare(`${b.hostId}:${b.slug}`);
    });
  }, [snapshot]);
}

export function __resetForTest(): void {
  state = { map: new Map<string, AppState>() };
  notify();
}
void snapshotVersion;
```

D-15 stable sort with `${hostId}:${slug}` tiebreak is Pitfall 6 (sort thrash) mitigation.

---

### `src/ui/api/fleet-status-types.ts` (MODIFY — add three frame arms)

**Analog:** Existing frontend frame declarations at L293-338

**Pattern to mirror** (L293-338):
```typescript
export interface FrontendSnapshotFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "snapshot";
  states: SessionState[];
}
export interface FrontendUpdateFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "update";
  state: SessionState;
}
export interface FrontendGoneFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "gone";
  hostId: string;
  tmuxSession: string | null;
  sessionId: string;
}
export interface FrontendPongFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "pong";
}
export interface FrontendIdentityArchivedFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "identity-archived";
  name: string;
  hostId: string;
  hostname: string;
}
export type FrontendOutboundFrame =
  | FrontendSnapshotFrame
  | FrontendUpdateFrame
  | FrontendGoneFrame
  | FrontendPongFrame
  | FrontendIdentityArchivedFrame;
```

**Backend authoritative shape to mirror** (from `src/backend/fleet-status/wire-protocol.ts:632-663`):
```typescript
// AppState — seven data fields + hostId + slug
export const AppStateSchema = z.object({
  hostId: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  port: z.number().nullable(),
  hasIcon: z.boolean(),
  createdAtMs: z.number(),
  isHealthy: z.boolean(),
  healthMessage: z.string().nullable(),
});
// Three frames: app-snapshot { apps: AppState[] }, app-update { app: AppState }, app-gone { hostId, slug }
```

**Apply to fleet-status-types.ts** (add near the identity-archived block, widen the union):
```typescript
// Phase 119 Plan (mirrors wire-protocol.ts:632-644 AppStateSchema).
export interface AppState {
  hostId: string;
  slug: string;
  title: string;
  description: string;
  port: number | null;
  hasIcon: boolean;
  createdAtMs: number;
  isHealthy: boolean;
  healthMessage: string | null;
}

export interface FrontendAppSnapshotFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "app-snapshot";
  apps: AppState[];
}
export interface FrontendAppUpdateFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "app-update";
  app: AppState;
}
export interface FrontendAppGoneFrame {
  schemaVersion: typeof FRAME_SCHEMA_VERSION;
  type: "app-gone";
  hostId: string;
  slug: string;
}

export type FrontendOutboundFrame =
  | FrontendSnapshotFrame
  | FrontendUpdateFrame
  | FrontendGoneFrame
  | FrontendPongFrame
  | FrontendIdentityArchivedFrame
  | FrontendAppSnapshotFrame
  | FrontendAppUpdateFrame
  | FrontendAppGoneFrame;
```

⚠️ Pitfall 1 from RESEARCH.md: This IS the load-bearing extension. Without it, the switch in `fleet-status-client.ts` treats app frames as `default` and silently drops them.

---

### `src/ui/api/fleet-status-client.ts` (MODIFY — add three switch cases + three callbacks)

**Analog:** Session dispatch cases at L164-234

**Callback interface pattern** (from L66-82):
```typescript
export interface FleetStatusClientOptions {
  url: string;
  onSnapshot: (states: SessionState[]) => void;
  onUpdate: (state: SessionState) => void;
  onGone: (hostId: string, tmuxSession: string | null, sessionId: string) => void;
  onIdentityArchived?: (name: string, hostId: string, hostname: string) => void;
}
```

**Switch case pattern** (from L164-234, `identity-archived` case at L216-231 is the cleanest analog):
```typescript
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

**Apply to fleet-status-client.ts** (add three optional callbacks + three switch cases):
```typescript
// In FleetStatusClientOptions:
onAppSnapshot?: (apps: AppState[]) => void;
onAppUpdate?: (app: AppState) => void;
onAppGone?: (hostId: string, slug: string) => void;

// In onmessage switch (add after "identity-archived" case, before default):
case "app-snapshot":
  console.info({
    operation: "fleet_status_client_app_snapshot",
    url,
    appCount: parsed.apps.length,
  });
  onAppSnapshot?.(parsed.apps);
  break;
case "app-update":
  console.info({
    operation: "fleet_status_client_app_update",
    url,
    hostId: parsed.app.hostId,
    slug: parsed.app.slug,
    isHealthy: parsed.app.isHealthy,
  });
  onAppUpdate?.(parsed.app);
  break;
case "app-gone":
  console.info({
    operation: "fleet_status_client_app_gone",
    url,
    hostId: parsed.hostId,
    slug: parsed.slug,
  });
  onAppGone?.(parsed.hostId, parsed.slug);
  break;
```

Also destructure the three new callbacks at L100 (`const { url, onSnapshot, onUpdate, onGone, onIdentityArchived, onAppSnapshot, onAppUpdate, onAppGone } = opts;`).

---

### `src/ui/AppShell.tsx` (MODIFY — wire callbacks to publish fns)

**Analog:** `createFleetStatusClient({...})` at L626-667

**Pattern to extend** (L626-646):
```typescript
const client = createFleetStatusClient({
  url: fleetStatusUrl,
  onSnapshot: (states) => { for (const fleetState of states) applyFleetState(fleetState); },
  onUpdate: (fleetState) => { applyFleetState(fleetState); },
  onIdentityArchived: (name, hostIdRaw, hostname) => {
    const hostIdNum = parseInt(hostIdRaw, 10);
    if (!Number.isFinite(hostIdNum)) return;
    upsertArchivedFleetRow({ hostId: hostIdNum, name, hostname });
  },
  onGone: (hostId, tmuxSession, sessionId) => { /* ... */ },
});
```

**Apply for Phase 119** (add three callbacks alongside; import publish fns from new store):
```typescript
import {
  publishAppSnapshot,
  publishAppUpdate,
  publishAppGone,
} from "@/state/app-tiles-store";

// In createFleetStatusClient({...}) call:
onAppSnapshot: (apps) => { publishAppSnapshot(apps); },
onAppUpdate: (app) => { publishAppUpdate(app); },
onAppGone: (hostId, slug) => { publishAppGone(hostId, slug); },
```

---

### `src/backend/database/routes/apps.ts` (NEW — icon endpoint)

**Analog:** `src/backend/database/routes/identities.ts` §849-966 (`GET /:identityKey/avatar`)

**Import pattern** (from `identities.ts:1-53`):
```typescript
import express from "express";
import { createHash } from "crypto";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import {
  isLocalHostId,
  IDENTITY_KEY_RE,           // → planner adds APP_SLUG_RE parallel export
  // → planner adds readAppIconFile export from same module
} from "../../claude-session/identity-artifact-reader.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { resolveHostById } from "../../ssh/host-resolver.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
```

**Route body pattern** (from `identities.ts:852-966` — the WHOLE route; the icon route is a slug-and-hostId-in-path variant):
```typescript
router.get(
  "/:identityKey/avatar",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const identityKey = String(req.params.identityKey);
    if (!IDENTITY_KEY_RE.test(identityKey)) {
      return res.status(400).json({ error: "identityKey must match [a-z0-9_-]{1,64}" });
    }
    // hostId query validation
    const rawHost = req.query.hostId;
    const hostIdNum = typeof rawHost === "string" ? Number(rawHost) : Number.NaN;
    if (!Number.isFinite(hostIdNum) || !Number.isInteger(hostIdNum) || hostIdNum <= 0) {
      return res.status(400).json({ error: "hostId query required (positive integer)" });
    }
    const local = isLocalHostId(hostIdNum);
    let conn: import("ssh2").Client | null = null;
    if (!local) {
      try {
        const host = await resolveHostById(hostIdNum, userId);
        if (!host) return res.status(502).json({ error: "identity home box unreachable" });
        conn = await connectOneShot(host, 5_000);
      } catch {
        return res.status(502).json({ error: "identity home box unreachable" });
      }
    }
    try {
      const readResult = await readAvatarSiblingFile(conn, identityKey);
      if (readResult === null) return res.status(404).json({ error: "no avatar on disk for this identity" });
      const etag = `"disk-${createHash("md5").update(readResult.bytes).digest("hex")}"`;
      const ifNoneMatch = req.headers["if-none-match"];
      if (ifNoneMatch && ifNoneMatch === etag) return res.status(304).end();
      res.setHeader("Content-Type", readResult.mime);
      res.setHeader("Content-Length", String(readResult.bytes.byteLength));
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "no-store");
      return res.send(readResult.bytes);
    } catch {
      return res.status(502).json({ error: "identity home box unreachable" });
    } finally {
      if (conn) { try { conn.end(); } catch { /* ignore */ } }
    }
  },
);

export default router;
```

**Apply for `apps.ts`** — hostId moves from query to path per D-06 (`GET /apps/:hostId/:slug/icon`):
```typescript
router.get(
  "/:hostId/:slug/icon",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    // Slug validation — APP_SLUG_RE = /^[a-z0-9-]{1,64}$/ (kebab-case per shape 1)
    const slug = String(req.params.slug);
    if (!APP_SLUG_RE.test(slug)) {
      return res.status(400).json({ error: "slug must match [a-z0-9-]{1,64}" });
    }
    // hostId now in path (not query) — D-06
    const rawHost = req.params.hostId;
    const hostIdNum = Number(rawHost);
    if (!Number.isFinite(hostIdNum) || !Number.isInteger(hostIdNum) || hostIdNum <= 0) {
      return res.status(400).json({ error: "hostId must be a positive integer" });
    }
    const local = isLocalHostId(hostIdNum);
    let conn: import("ssh2").Client | null = null;
    if (!local) {
      try {
        const host = await resolveHostById(hostIdNum, userId);
        if (!host) return res.status(502).json({ error: "app home box unreachable" });
        conn = await connectOneShot(host, 5_000);
      } catch {
        return res.status(502).json({ error: "app home box unreachable" });
      }
    }
    try {
      const readResult = await readAppIconFile(conn, slug);
      if (readResult === null) {
        return res.status(404).json({ error: "no icon on disk for this app" });
      }
      const etag = `"disk-${createHash("md5").update(readResult.bytes).digest("hex")}"`;
      const ifNoneMatch = req.headers["if-none-match"];
      if (ifNoneMatch && ifNoneMatch === etag) return res.status(304).end();
      res.setHeader("Content-Type", readResult.mime);   // always "image/webp"
      res.setHeader("Content-Length", String(readResult.bytes.byteLength));
      res.setHeader("ETag", etag);
      res.setHeader("Cache-Control", "no-store");
      return res.send(readResult.bytes);
    } catch {
      return res.status(502).json({ error: "app home box unreachable" });
    } finally {
      if (conn) { try { conn.end(); } catch { /* ignore */ } }
    }
  },
);

export default router;
```

Security notes (from RESEARCH.md §Security):
- `APP_SLUG_RE` shell-safety gate — prevents `../` traversal and command injection in `${slug}` interpolation
- `resolveHostById(hostIdNum, userId)` returns null for cross-tenant hosts (V4 Access Control mitigation)
- `ETag` = MD5 identifier only, not authentication; matches identity-avatar discipline

---

### `readAppIconFile` helper (NEW — append near `readAvatarSiblingFile`)

**Analog:** `readAvatarSiblingFile` at `identity-artifact-reader.ts:2469-2580`

**Local-branch pattern to mirror** (L2502-2542):
```typescript
if (conn === null) {
  const root = getLocalIdentitiesRoot();
  const tryRead = async (ext: AvatarExt): Promise<Buffer | null> => {
    const filePath = path.join(root, identityKey, `${identityKey}.${ext}`);
    try {
      const bytes = await fs.readFile(filePath);
      if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
        throw new Error("avatar exceeds cap on disk");
      }
      return bytes;
    } catch (err: unknown) {
      if (typeof err === "object" && err !== null && (err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  };
  // 5-extension cascade — DROP for the app-icon helper (Pitfall 5)
  ...
}
```

**Remote-branch pattern to mirror** (L2544-2579 — uses an `ls` pre-check via `execWithTimeout`, then `sftpReadFile`):
```typescript
const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
// ... ls probe to find the right file ...
const targetPath = `${remoteHome}/fleet/identities/${identityKey}/${identityKey}.${extToRead}`;
const bytes = await sftpReadFile(conn, targetPath);
if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
  throw new Error("avatar exceeds cap on disk");
}
return { bytes, mime: AVATAR_MIME_FROM_EXT[extToRead], ext: extToRead };
```

**Apply for `readAppIconFile`** (Pitfall 5: single extension only — `icon.webp` per shape 1):
```typescript
// Add near IDENTITY_KEY_RE at L175:
export const APP_SLUG_RE = /^[a-z0-9-]{1,64}$/;

// Add near readAvatarSiblingFile at L2580:
export async function readAppIconFile(
  conn: SSHClientType | null,
  slug: string,
): Promise<{ bytes: Buffer; mime: "image/webp" } | null> {
  if (!APP_SLUG_RE.test(slug)) throw new Error("invalid slug");

  if (conn === null) {
    // LOCAL branch — analog: L2502-2542 tryRead pattern, single extension
    const filePath = path.join(os.homedir(), "fleet", "apps", slug, "icon.webp");
    try {
      const bytes = await fs.readFile(filePath);
      if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
        throw new Error("icon exceeds cap on disk");
      }
      return { bytes, mime: "image/webp" };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return null;
      throw err;
    }
  }

  // REMOTE branch — analog: L2551-2578 execWithTimeout + sftpReadFile
  // Planner: verify sftpReadFile's ENOENT error contract; may need an `ls`
  // pre-check like readAvatarSiblingFile does at L2561-2564.
  const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
  const targetPath = `${remoteHome}/fleet/apps/${slug}/icon.webp`;
  try {
    const lsCmd = `ls "${targetPath}" 2>/dev/null || true`;
    const found = (await execWithTimeout(conn, lsCmd)).trim();
    if (!found) return null;
    const bytes = await sftpReadFile(conn, targetPath);
    if (bytes.byteLength > IDMEDIT_MAX_AVATAR_BYTES) {
      throw new Error("icon exceeds cap on disk");
    }
    return { bytes, mime: "image/webp" };
  } catch (err) {
    if (String((err as Error)?.message ?? "").match(/no such file|ENOENT/i)) return null;
    throw err;
  }
}
```

Note: `os.homedir()` local path may need a `getLocalAppsRoot()` helper for parity with `getLocalIdentitiesRoot()` (RESEARCH.md Assumption A5) — planner verifies at implementation time.

---

### `src/backend/database/database.ts` (MODIFY — mount new router)

**Analog:** Route mounts at `database.ts:1890-1980` — look at L1976 for the `/identities` mount as the mirror

**Pattern to mirror** (`database.ts:1976`):
```typescript
app.use("/identities", identitiesRoutes);
```

**Apply for Phase 119** — append after the existing mounts (around L1985+, consistent with recent additions like `/agent-reset` at L1984):
```typescript
import appsRoutes from "./routes/apps.js";

// (later in the mount block, alongside /identities and neighbours)
// Phase 119 (D-06): GET /apps/:hostId/:slug/icon — serves ~/fleet/apps/<slug>/icon.webp
// from the target host via SSH. Mirrors /identities/:identityKey/avatar (identities.ts:849).
app.use("/apps", appsRoutes);
```

No mount-order conflicts — `/apps` prefix is new; no shadowing risk.

---

### Test analogs

#### `AppTile.test.tsx` (NEW — component test)

**Analog:** `PrettyConversationRow.test.tsx` — same jsdom + @testing-library/react harness

**D-18 coverage requirements:**
- Renders `<img src="/apps/1/scratch/icon">` when `hasIcon: true`
- Renders `.pv-app-icon-initial` fallback letter when `hasIcon: false`
- Renders `.pv-app-icon-initial` fallback letter when `<img onError>` fires
- Renders `.pv-app-unhealthy-message` two-line variant when `isHealthy: false`
- Context menu attach — `fireEvent.contextMenu()` opens the menu with "Open in new tab"
- Ordering stability across multiple frame updates (upsert an existing key does not shuffle)

#### `app-tiles-store.test.ts` (NEW — store test)

**Analog:** `src/ui/state/session-working-store.test.ts` — the sibling in the same directory (already exists per `ls src/ui/state/`)

**D-18 coverage requirements:**
- `publishAppSnapshot([...])` populates the store
- `publishAppUpdate({...})` upserts an existing key
- `publishAppUpdate({...})` inserts a new key
- `publishAppGone(hostId, slug)` removes by key
- Unknown-frame types are ignored not thrown on (handled by fleet-status-client's default case; store never sees them — but assert the store does not crash on empty inputs)
- Unmount cleans up the subscription (test the `subscribe()` returned disposer)
- Sort stability: two apps with same title on different hosts stay in stable order across an `app-update` frame (Pitfall 6 regression test)

#### `apps.test.ts` (NEW — backend route test)

**Analog:** `src/backend/database/routes/identities.get-disk.test.ts` (route test template using supertest)

**D-18 coverage requirements:**
- 400 on bad slug (fails `APP_SLUG_RE`)
- 400 on bad hostId (non-integer, negative, zero)
- 401 when auth JWT missing (authenticateJWT gate)
- 404 when icon file absent on disk
- 200 + `Content-Type: image/webp` + bytes when icon file present
- 304 on ETag match
- 502 when host is unreachable (mock `resolveHostById` → null)
- 502 when user has no access to hostId (mock `resolveHostById` → null — same 502 as unreachable; does NOT distinguish per identity-avatar discipline, RESEARCH.md §Security V4)

#### `PrettyConversationsPanel.test.tsx` extension (MODIFY — integration)

**Analog:** Archived-section tests at L2625-2733 (A10-A14)

**Mock pattern** (from L317-321 — module-level `mockArchivedFleetRows` swap):
```typescript
// At top of file, alongside mockArchivedFleetRows:
let mockAppTiles: AppState[] = [];

// In vi.mock for conversation-store — add sibling entry:
useArchivedFleetRows: () => mockArchivedFleetRows,
// New — add to vi.mock for @/state/app-tiles-store:
vi.mock("@/state/app-tiles-store", () => ({
  useAppTiles: () => mockAppTiles,
  publishAppSnapshot: vi.fn(),
  publishAppUpdate: vi.fn(),
  publishAppGone: vi.fn(),
}));
```

**Test structure to mirror** (L2625-2733):
```typescript
describe("PrettyConversationsPanel: Phase 119 Apps section", () => {
  // Mirror A10: header renders (D-05 — ALWAYS, even with 0 tiles)
  it("Apps section header renders when appTiles is empty (D-05)", () => { ... });
  // Mirror A11: lazy-render (D-03) — collapsed section has NO AppTile in DOM
  it("D-03 lazy — collapsed section renders zero AppTile instances", () => { ... });
  // Mirror A12: click header → expand → tiles mount
  it("click header → section expands → AppTile instances render", () => { ... });
  // NEW A15: empty-expanded prompt (D-04)
  it("expanded + zero tiles → renders 'Ask an agent to make an app for you.'", () => { ... });
  // NEW A16: search-active branch still shows Apps section (RESEARCH.md Pitfall 2)
  it("Apps section remains visible when search filter is active", () => { ... });
});
```

---

## Shared Patterns

### JSON-console structured logging
**Source:** `fleet-status-client.ts:110-114, 166-170, 200-206, 216-231` (every WS event logs a structured object)
**Apply to:** All new WS switch cases (the three app-frame cases follow the same `console.info({operation, url, ...})` shape)
```typescript
console.info({
  operation: "fleet_status_client_app_snapshot",  // or app_update, app_gone
  url,
  ...frameSpecificFields,
});
```

### Auth gate + hostId validation + host-resolution chain
**Source:** `identities.ts:854-899` (the top half of every SSH-backed route)
**Apply to:** New backend route `apps.ts`
- `authenticateJWT` middleware (line 854)
- Path/query validation → 400
- `isLocalHostId` → conn=null local branch, else `resolveHostById` + `connectOneShot(host, 5_000)` → 502 on failure
- `try { ... } finally { conn?.end() }` cleanup discipline (L960-964)

### `.pv-panel-group` structural wrapper for sidebar sections
**Source:** `pretty-conversations.css:251-255`; every sidebar section wraps in `<div className="pv-panel-group ...">`
**Apply to:** The Apps section root `<div className="pv-panel-group pv-apps-section">`
No CSS additions needed for the wrapper itself — the base rule provides `flex-column + gap: 8px` for free.

### `data-testid` naming convention for sidebar section headers
**Source:** `PrettyConversationsPanel.tsx:2001` (`data-testid="pretty-conversations-archived-header"`)
**Apply to:** Apps section header — `data-testid="pretty-conversations-apps-header"`
Also `aria-expanded={appsExpanded}` + `aria-controls="pv-apps-section-content"` (D-02 verbatim mirror).

### `useSyncExternalStore` reader for in-memory pub-sub stores
**Source:** `session-working-store.ts:946-954` (representative of the store-slice convention)
**Apply to:** New `app-tiles-store.ts` — same three-arg call `useSyncExternalStore(subscribe, getSnapshot, getSnapshot)` (third arg is the SSR snapshot; identity to `getSnapshot` when there's no SSR).

### Structured `finally { conn.end() }` cleanup for SSH connections
**Source:** `identities.ts:960-964` (byte-verbatim across every SSH-backed route in the file)
**Apply to:** New `apps.ts` route — same `finally { if (conn) { try { conn.end(); } catch { /* ignore */ } } }` block

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `.pv-app-unhealthy-message` CSS selector | css | style | No in-repo precedent for muted-red inline text. Grep found: `#ff9a8a` (context-menu danger), `#f4a09b` (from tasting), warm-amber `hsla(35, 65%, 55%, 0.85)` (trapped-work indicator). Neither is a semantic-error token. Use `#f4a09b` verbatim from D-11 tasting; leave a comment inviting a future palette-token pass (RESEARCH.md Open Question 4). |
| Empty-expanded prompt render branch (`.pv-apps-empty`) | component | render | Archived section short-circuits on empty (D-05 differentiator). The D-04 prompt is a NEW render branch — no direct precedent. Style tokens borrowed from the section-header muted tone (`text-[#5c6070]/85 italic`). |

---

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-conversations/*` (component + CSS + tests + context menu)
- `src/ui/state/*` (store slices)
- `src/ui/api/*` (WS client + type mirror)
- `src/ui/AppShell.tsx` (client bootstrap)
- `src/backend/database/routes/*` (Express routers)
- `src/backend/database/database.ts` (mount block)
- `src/backend/claude-session/identity-artifact-reader.ts` (SSH file readers)
- `src/backend/fleet-status/wire-protocol.ts` (backend authoritative frame shapes for AppState)

**Files scanned:** 15+ (each read at targeted line ranges — no full-file re-reads)
**Pattern extraction date:** 2026-09-18
