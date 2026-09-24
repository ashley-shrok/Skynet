# Phase 135: wake-ups-redesign campaign shape 3 (UI modal) — Pattern Map

**Mapped:** 2026-09-24
**Files analyzed:** 5 new/modified files
**Analogs found:** 5 / 5 (100% coverage — this is unusually high because sibling modals cover every pattern)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/ui/api/wakeups-api.ts` (NEW) | api-helper | request-response (CRUD over REST) | `src/ui/api/identities-api.ts` (`listRolesForHost` block at :299-328) | exact — identical `authApi` + `handleApiError` shape |
| `src/ui/features/pretty-conversations/WakeupsModal.tsx` (NEW) | component / modal | request-response + client-state | `src/ui/features/pretty-conversations/ConversationSearchModal.tsx` (chrome) + `CreateProjectModal.tsx` (host picker + error mapping) | exact — dual-analog triangulation |
| `src/ui/features/pretty-conversations/WakeupsModal.test.tsx` (NEW) | test | vitest + @testing-library | `src/ui/features/pretty-conversations/ConversationSearchModal.test.tsx` + `CreateProjectModal.test.tsx` | exact |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (MODIFIED) | component / panel | event-driven (onClick → useState open) | Existing 6 header-cluster buttons at `PrettyConversationsPanel.tsx:2226-2286` + sibling modal mount block at `:2939-2945` (`ConversationSearchModal`) | exact — inline insertion, copy neighbor |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.wakeups-button.test.tsx` (NEW) | test | vitest + @testing-library | `src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` | exact |

**No modification of `src/ui/api/claude-session-api.ts`** — RESEARCH.md Pitfall #3 explicitly redirects new helpers to a fresh `wakeups-api.ts` file. `WakeupSpecWire` at line 719 has the wrong shape (has `instruction`, not `prompt`) and MUST NOT be reused. See § Shared Patterns / Anti-patterns below.

---

## Pattern Assignments

### `src/ui/api/wakeups-api.ts` (NEW — api-helper, request-response)

**Analog:** `src/ui/api/identities-api.ts` (specifically the `listRolesForHost` helper at :321-328)

**Imports pattern** (from `identities-api.ts:1`):
```typescript
import { authApi, handleApiError } from "@/main-axios";
```

**Wire-type export pattern** (from `identities-api.ts:311-319`):
```typescript
export type RoleSummary = {
  name: string;
  description: string;
  title?: string;
  displayName?: string;
  colorHue?: number;
  voice?: string;
  avatar?: string;
};
```

**GET helper pattern** (from `identities-api.ts:321-328`) — copy verbatim, swap URL + return-shape unwrap:
```typescript
export async function listRolesForHost(hostId: number): Promise<RoleSummary[]> {
  try {
    const response = await authApi.get("/roles", { params: { hostId } });
    return response.data as RoleSummary[];
  } catch (error) {
    handleApiError(error, "list roles for host");
  }
}
```

For `listWakeups` (no query params, wraps response into `{items:[]}`):
```typescript
export async function listWakeups(): Promise<WakeupListItem[]> {
  try {
    const response = await authApi.get("/wakeups");
    return (response.data as { items: WakeupListItem[] }).items;
  } catch (error) {
    handleApiError(error, "list wake-ups");
  }
}
```

**POST helper pattern** (from `identities-api.ts` PATCH-style, e.g. line 287-291 stays-awake sentinel):
```typescript
const response = await authApi.post<{present: boolean}>(
  `/identities/${identityKey}/stays-awake`,
  { present },
  { params: { hostId } },
);
```

For `createWakeup` (body is `{host, spec}`, response echoes `{slug, host, spec}`):
```typescript
export async function createWakeup(
  host: number,
  spec: GlobalWakeupSpecWire,
): Promise<{ slug: string; host: number; spec: GlobalWakeupSpecWire }> {
  try {
    const response = await authApi.post("/wakeups", { host, spec });
    return response.data as { slug: string; host: number; spec: GlobalWakeupSpecWire };
  } catch (error) {
    handleApiError(error, "create wake-up");
  }
}
```

**PATCH helper pattern** (URL-encoded slug + body):
```typescript
export async function updateWakeup(
  slug: string,
  host: number,
  spec: GlobalWakeupSpecWire,
): Promise<{ slug: string; host: number; spec: GlobalWakeupSpecWire }> {
  try {
    const response = await authApi.patch(
      `/wakeups/${encodeURIComponent(slug)}`,
      { host, spec },
    );
    return response.data as { slug: string; host: number; spec: GlobalWakeupSpecWire };
  } catch (error) {
    handleApiError(error, "update wake-up");
  }
}

export async function toggleWakeupEnabled(
  slug: string,
  host: number,
  enabled: boolean,
): Promise<{ slug: string; host: number; enabled: boolean }> {
  try {
    const response = await authApi.patch(
      `/wakeups/${encodeURIComponent(slug)}/toggle-enabled`,
      { host, enabled },
    );
    return response.data as { slug: string; host: number; enabled: boolean };
  } catch (error) {
    handleApiError(error, "toggle wake-up enabled");
  }
}
```

**DELETE-with-body pattern** — non-standard; `data` config key is how axios attaches a body to DELETE (RESEARCH Pitfall #4):
```typescript
export async function deleteWakeup(slug: string, host: number): Promise<void> {
  try {
    await authApi.delete(`/wakeups/${encodeURIComponent(slug)}`, {
      data: { host },
    });
  } catch (error) {
    handleApiError(error, "delete wake-up");
  }
}
```

**New wire types** (RESEARCH Standard Stack § Frontend Types — do NOT reuse `WakeupSpecWire`):
```typescript
export type WakeupListItem = {
  slug: string;
  host: string;
  hostId: number;
  name: string;
  enabled: boolean;
  schedule: unknown;         // raw — hydrate via WakeupFormShared.hydrateFormSchedule
  scheduleHuman: string;
  prompt: string;
  roles: string[];
  skills: string[];
};

export type GlobalWakeupSpecWire = {
  name: string;
  enabled?: boolean;
  prompt: string;
  schedule: Record<string, unknown>;
  roles?: string[];
  skills?: string[];
};
```

---

### `src/ui/features/pretty-conversations/WakeupsModal.tsx` (NEW — component, request-response + client-state)

**Primary chrome analog:** `src/ui/features/pretty-conversations/ConversationSearchModal.tsx` (verified 385 lines, closest sibling in the same directory)
**Secondary analog for host picker + error mapping:** `src/ui/features/pretty-conversations/CreateProjectModal.tsx` (verified 415 lines)

**Imports pattern** (from `ConversationSearchModal.tsx:47-63`):
```typescript
import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { X, Search, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { /* API helpers */ } from "@/api/wakeups-api";
```

For Phase 135, extend with:
```typescript
import { AlarmClock, MoreHorizontal } from "lucide-react";
import { Skeleton } from "@/components/skeleton";
import { Button } from "@/components/button";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  type FormSchedule,
  buildSchedule,
  detectBrowserTimezone,
  hydrateFormSchedule,
  validateForm,
} from "@/features/pretty-view/WakeupFormShared";
import { listRolesForHost, type RoleSummary } from "@/api/identities-api";
import {
  listWakeups,
  createWakeup,
  updateWakeup,
  toggleWakeupEnabled,
  deleteWakeup,
  type WakeupListItem,
  type GlobalWakeupSpecWire,
} from "@/api/wakeups-api";
```

**Props shape** (mirror `ConversationSearchModal.tsx:75-85`):
```typescript
export interface WakeupsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hostTree: HostFolder | null;
}
```

**Dialog shell pattern** (verbatim from `ConversationSearchModal.tsx:209-244` — ONLY change `md:max-w-[560px]` to `md:max-w-[640px]` per RESEARCH Chrome Token Dictionary):
```tsx
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
      onInteractOutside={(e) => {
        e.preventDefault();   // Patch #111f: X + Esc are the only close paths
      }}
      className={cn(
        "absolute inset-4 z-[120] outline-none",
        "flex flex-col overflow-hidden rounded-[24px]",
        "md:max-w-[640px] md:max-h-[720px] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2",
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
      <DialogPrimitive.Title className="sr-only">Wake-ups</DialogPrimitive.Title>
      {/* header, body, footer */}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
```

**Header (X close button) pattern** (from `ConversationSearchModal.tsx:249-306` — do NOT use `Dialog.Close asChild`; use direct `onClick` per RESEARCH Anti-Patterns):
```tsx
<div
  className="px-4 py-3 shrink-0 flex flex-row items-center gap-2"
  style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
>
  <h2 className="text-[15px] font-semibold text-[#f0ebe0] flex-1">
    {view === "list" ? "Wake-ups" : editingSlug ? "Edit wake-up" : "New wake-up"}
  </h2>
  {/* "+" button visible only in list view (per D-19) */}
  {view === "list" && (
    <button
      type="button"
      aria-label="New wake-up"
      onClick={() => enterCreateMode()}
      /* pv-pencil-style chrome */
    >
      <Plus size={18} />
    </button>
  )}
  <button
    type="button"
    aria-label="Close"
    title="Close"
    onClick={() => onOpenChange(false)}
    data-testid="wakeups-modal-close-button"
    className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-colors duration-150"
    style={{
      background: "rgba(255, 255, 255, 0.04)",
      border: "1px solid rgba(220, 225, 245, 0.10)",
    }}
  >
    <X className="size-4" />
  </button>
</div>
```

**Fetch-on-open + reset-on-close pattern** (adapt from `ConversationSearchModal.tsx:107-115` open-transition + `CreateProjectModal.tsx:133-141` on-close reset):
```tsx
useEffect(() => {
  if (!open) {
    // D-17: filter state resets on close
    setItems(null);
    setLoadError(null);
    setSearch("");
    setRoleFilter("ALL");
    setHostFilter("ALL");
    setView("list");
    setEditingSlug(null);
    return;
  }
  const controller = new AbortController();
  listWakeups()
    .then((rows) => {
      if (!controller.signal.aborted) setItems(rows);
    })
    .catch((err: unknown) => {
      if (controller.signal.aborted) return;
      setItems([]);
      setLoadError(err instanceof Error ? err.message : "Couldn't load wake-ups");
    });
  return () => controller.abort();
}, [open]);
```

**Host-tree flatten helper + auto-select-single-host pattern** (verbatim from `CreateProjectModal.tsx:55-69` + `:113-151`):
```tsx
function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}
function collectAllHosts(children: (Host | HostFolder)[]): Host[] {
  const out: Host[] = [];
  for (const child of children) {
    if (isFolder(child)) {
      out.push(...collectAllHosts(child.children));
    } else {
      out.push(child);
    }
  }
  return out;
}
// ─── inside component ───
const flatHosts = useMemo(
  () => collectAllHosts(hostTree?.children ?? []).filter((h) => h.enableRdp !== true),
  [hostTree],
);
useEffect(() => {
  if (open && flatHosts.length === 1 && selectedHost === null) {
    setSelectedHost(flatHosts[0]);
  }
}, [open, flatHosts, selectedHost]);
```

**Loading skeleton pattern** (verbatim from `RoleFileTab.tsx:67-74` — RESEARCH Pitfall #1: MATCH SHIPPED PATTERN, NOT D-15's "loading text" phrasing):
```tsx
if (items === null) {
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
      <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
      <Skeleton className="h-24 w-full rounded-[var(--radius-pv-bubble)]" />
    </div>
  );
}
```

**Error mapping (statusOf + interpretError) pattern** (verbatim from `CreateProjectModal.tsx:76-97`):
```typescript
function statusOf(err: unknown): number | undefined {
  if (err !== null && typeof err === "object" && "status" in err) {
    const s = (err as { status?: unknown }).status;
    if (typeof s === "number") return s;
  }
  return undefined;
}
function interpretError(err: unknown, rawName: string): string {
  const status = statusOf(err);
  if (status === 409) {
    return `A wake-up named "${rawName}" already exists on this host — pick a different name.`;
  }
  if (status === 400) {
    const msg = err instanceof Error ? err.message : "";
    return msg || "Wake-up schedule is malformed — check the fields.";
  }
  return "Couldn't save wake-up — try again.";
}
```

**Inline error banner pattern** (verbatim from `CreateProjectModal.tsx:385-393`):
```tsx
{error !== null && (
  <div
    role="alert"
    className="text-xs text-red-400"
    data-testid="wakeups-modal-error"
  >
    {error}
  </div>
)}
```

**In-flight ref guard for Save** (from `NewConversationModal.tsx:193-199`):
```tsx
const submitInFlightRef = useRef(false);
const onSave = useCallback(async () => {
  if (submitInFlightRef.current) return;   // debounce rapid clicks
  submitInFlightRef.current = true;
  setInFlight(true);
  setError(null);
  try {
    // ... createWakeup or updateWakeup ...
    const fresh = await listWakeups();
    setItems(fresh);
    setView("list");
  } catch (err) {
    setError(interpretError(err, rawName));
  } finally {
    submitInFlightRef.current = false;
    setInFlight(false);
  }
}, [/* deps */]);
```

**Row click + stopPropagation pattern** (RESEARCH § Code Examples, D-11):
```tsx
<div
  className="wakeup-row"
  onClick={() => enterEditMode(row)}
  role="button"
  tabIndex={0}
>
  <div className="wakeup-name">{row.name}</div>
  <div className="wakeup-meta">
    <span>{row.scheduleHuman}</span>
    <span className="host-chip">{row.host}</span>
  </div>
  <div className="wakeup-actions">
    <button
      onClick={(e) => {
        e.stopPropagation();     // D-11: don't bubble to row
        void handleToggle(row);
      }}
    >{/* switch */}</button>
    <button
      onClick={(e) => {
        e.stopPropagation();     // D-11: don't bubble to row
        setKebabOpen(row.slug);
      }}
    ><MoreHorizontal size={16} /></button>
  </div>
</div>
```

**Pessimistic toggle pattern** (RESEARCH § Code Examples, D-12):
```tsx
async function handleToggle(row: WakeupListItem) {
  setToggleError(null);
  try {
    await toggleWakeupEnabled(row.slug, row.hostId, !row.enabled);
    const fresh = await listWakeups();       // D-03: refetch after write
    setItems(fresh);
  } catch (err) {
    setToggleError(err instanceof Error ? err.message : "Toggle failed");
    // NOTE: no local state flip — visual state stays in original position
  }
}
```

**Native confirm() delete pattern** (RESEARCH § Code Examples, D-14):
```tsx
async function handleDelete(row: WakeupListItem) {
  // eslint-disable-next-line no-alert
  const ok = window.confirm(`Delete wake-up "${row.name}"?`);
  if (!ok) return;
  try {
    await deleteWakeup(row.slug, row.hostId);
    const fresh = await listWakeups();
    setItems(fresh);
  } catch (err) {
    setDeleteError(err instanceof Error ? err.message : "Delete failed");
  }
}
```

**Schedule form via WakeupFormShared** (13 exports at `src/ui/features/pretty-view/WakeupFormShared.tsx`):
- `hydrateFormSchedule(row.schedule)` → seed edit-mode form state (line 88-137).
- `buildSchedule(fs, tz)` → produce the `schedule: {...}` object shape 2's API accepts (line 143-164).
- `validateForm(fs)` → client-side pre-Save gate (line 167-184).
- `detectBrowserTimezone()` → IANA tz name (line 59-66).
- **Weekly picker** — RESEARCH Assumption A4: v1 = single-day segmented control (Mon/Tue/…/Sun). Do NOT render `RestrictToDaysChips`.

**Reset PATCH name-vs-slug pitfall** (RESEARCH Pitfall #5): in edit-mode, disable the Name input:
```tsx
<input
  disabled={mode === "edit"}
  value={name}
  onChange={(e) => setName(e.target.value)}
/>
{mode === "edit" && (
  <p className="text-xs text-[color:var(--color-pv-fg-dim)]">
    To rename, delete this wake-up and create a new one.
  </p>
)}
```

---

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (MODIFIED — component, event-driven)

**Analog:** existing 6 header-cluster buttons at `PrettyConversationsPanel.tsx:2226-2286` (guarded by `showPencilButton`) + sibling modal mount at `:2939-2945` (`ConversationSearchModal`).

**Icon import addition** (extend `PrettyConversationsPanel.tsx:67`):
```typescript
// BEFORE:
import { AppWindow, Archive, ChevronDown, Drama, FolderOpen, Globe, Loader2, MessageSquare, MessagesSquare, Monitor, MoreVertical, Pin, Search, SquarePen, X } from "lucide-react";
// AFTER — add AlarmClock:
import { AlarmClock, AppWindow, Archive, ChevronDown, Drama, FolderOpen, Globe, Loader2, MessageSquare, MessagesSquare, Monitor, MoreVertical, Pin, Search, SquarePen, X } from "lucide-react";
```

**Import the modal component** (mirror `PrettyConversationsPanel.tsx:138` CreateProjectModal import):
```typescript
import { WakeupsModal } from "./WakeupsModal";
```

**State hook addition** (mirror `PrettyConversationsPanel.tsx:868` `searchModalOpen` — add near line 897 next to `rolesListModalOpen`):
```typescript
// Phase 135 (shape 3): WakeupsModal open/closed toggle. Opened via the
// clock-icon button in .pv-header-actions below (added after Globe, before
// the feedback + kebab buttons). No preserved query state — modal
// refetches on every open (D-03) and resets filter state on close (D-17).
const [wakeupsModalOpen, setWakeupsModalOpen] = useState(false);
```

**Header-button insertion** (verbatim shape of Globe button at `PrettyConversationsPanel.tsx:2275-2284`) — insert AFTER Globe (`:2284`) and BEFORE the closing `</>` fragment (`:2285`):
```tsx
<button
  type="button"
  className="pv-pencil"
  aria-label="Wake-ups"
  title="Wake-ups"
  data-testid="pv-header-wakeups-button"
  onClick={() => setWakeupsModalOpen(true)}
>
  <AlarmClock size={18} />
</button>
```

**Modal mount insertion** (verbatim shape of ConversationSearchModal mount at `PrettyConversationsPanel.tsx:2939-2945`) — insert after ConversationSearchModal block (`:2945`):
```tsx
{/* Phase 135 (shape 3, wake-ups-redesign) — WakeupsModal: portal-mounted
    sibling of ConversationSearchModal. Opened via the AlarmClock button
    in .pv-header-actions above (after Globe, before feedback). Owns its
    own list + form + refetch lifecycle; controlled open state only. */}
<WakeupsModal
  open={wakeupsModalOpen}
  onOpenChange={setWakeupsModalOpen}
  hostTree={hostTree ?? null}
/>
```

**Comment update** (`PrettyConversationsPanel.tsx:2213-2225` header docstring) — add wake-ups to the "Header icon buttons, left-to-right" comment; bump the numbering from 7 to 8 total buttons and record the new position (Wake-ups is #6, between Edit-global-files #5 and Send-feedback #7).

---

### `src/ui/features/pretty-conversations/WakeupsModal.test.tsx` (NEW — test)

**Analog:** `src/ui/features/pretty-conversations/ConversationSearchModal.test.tsx` (verified, well-structured T-01..T-13 layout) + `CreateProjectModal.test.tsx` (for host picker + 409/500 error mapping tests).

**Imports pattern** (from `ConversationSearchModal.test.tsx:29-52`):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

// ─── Mocks BEFORE imports ────────────────────────────────────────────────
const listWakeupsMock = vi.fn();
const createWakeupMock = vi.fn();
const updateWakeupMock = vi.fn();
const toggleWakeupEnabledMock = vi.fn();
const deleteWakeupMock = vi.fn();

vi.mock("@/api/wakeups-api", () => ({
  listWakeups: (...args: unknown[]) => listWakeupsMock(...args),
  createWakeup: (...args: unknown[]) => createWakeupMock(...args),
  updateWakeup: (...args: unknown[]) => updateWakeupMock(...args),
  toggleWakeupEnabled: (...args: unknown[]) => toggleWakeupEnabledMock(...args),
  deleteWakeup: (...args: unknown[]) => deleteWakeupMock(...args),
}));

vi.mock("@/api/identities-api", () => ({
  listRolesForHost: vi.fn().mockResolvedValue([]),
}));

// Component AFTER mocks
import { WakeupsModal } from "./WakeupsModal";
```

**Setup/teardown pattern** (from `ConversationSearchModal.test.tsx:78-85`):
```typescript
beforeEach(() => {
  listWakeupsMock.mockReset();
  createWakeupMock.mockReset();
  updateWakeupMock.mockReset();
  toggleWakeupEnabledMock.mockReset();
  deleteWakeupMock.mockReset();
});

afterEach(() => {
  cleanup();
});
```

**Test structure** (from `ConversationSearchModal.test.tsx:91-119`) — 15 tests per RESEARCH § Test Pattern Reference:
```typescript
describe("WakeupsModal: closed vs open", () => {
  it("T-01: open={false} mounts nothing visible", () => {
    render(<WakeupsModal open={false} onOpenChange={vi.fn()} hostTree={null} />);
    expect(screen.queryByTestId("wakeups-modal-close-button")).toBeNull();
  });

  it("T-02: open={true} triggers listWakeups once + shows skeletons then rows", async () => {
    listWakeupsMock.mockResolvedValue([{
      slug: "morning",
      host: "host-a",
      hostId: 1,
      name: "Morning triage",
      enabled: true,
      schedule: { type: "daily", at: "09:00" },
      scheduleHuman: "Daily at 9:00",
      prompt: "check inbox",
      roles: ["assistant"],
      skills: [],
    }]);
    render(<WakeupsModal open={true} onOpenChange={vi.fn()} hostTree={null} />);
    await waitFor(() => expect(listWakeupsMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("Morning triage")).toBeInTheDocument());
  });
});
```

**Error interpretation test pattern** (from `CreateProjectModal.test.tsx:219-256`):
```typescript
class FakeApiError extends Error {
  constructor(msg: string, public status: number, public code: string) {
    super(msg);
  }
}
it("T-13: Save 409 → inline banner with server message, form stays open", async () => {
  createWakeupMock.mockRejectedValueOnce(new FakeApiError("Conflict", 409, "CONFLICT"));
  // ... setup form, click Save ...
  expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/i);
  // modal still open
  expect(screen.getByTestId("wakeups-modal-close-button")).toBeInTheDocument();
});
```

**Test IDs to expose (contract with tests)**:
- `pv-header-wakeups-button` (header button)
- `wakeups-modal-close-button`
- `wakeups-modal-list` (list container)
- `wakeups-modal-row-{slug}` (each row)
- `wakeups-modal-row-{slug}-toggle`
- `wakeups-modal-row-{slug}-kebab`
- `wakeups-modal-row-{slug}-edit`
- `wakeups-modal-row-{slug}-delete`
- `wakeups-modal-add-button` (the "+" in header, list view only)
- `wakeups-modal-form` (form container)
- `wakeups-modal-form-name`
- `wakeups-modal-form-prompt`
- `wakeups-modal-form-save`
- `wakeups-modal-form-cancel`
- `wakeups-modal-error` (inline error banner)
- `wakeups-modal-filter-search`
- `wakeups-modal-filter-role`
- `wakeups-modal-filter-host`
- `wakeups-modal-footer-count`

---

### `src/ui/features/pretty-conversations/PrettyConversationsPanel.wakeups-button.test.tsx` (NEW — test)

**Analog:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.new-role-button.test.tsx` (verified 277 lines — the panel-button-test pattern).

**Mock boilerplate** (verbatim copy from `PrettyConversationsPanel.new-role-button.test.tsx:22-158`) — the setup is ~140 lines of `vi.mock(...)` stubs for stores + sibling modals. Copy the entire mock block, then add:

```typescript
// Additional mock for the new WakeupsModal — stub so this test suite
// doesn't pull the full modal dep tree.
vi.mock("./WakeupsModal", () => ({
  WakeupsModal: (props: { open: boolean }) =>
    props.open ? <div data-testid="wakeups-modal-stub" /> : null,
}));

// Wakeups API is not called by the button itself, but stubbed defensively
vi.mock("@/api/wakeups-api", () => ({
  listWakeups: vi.fn().mockResolvedValue([]),
  createWakeup: vi.fn(),
  updateWakeup: vi.fn(),
  toggleWakeupEnabled: vi.fn(),
  deleteWakeup: vi.fn(),
}));
```

**Test body pattern** (verbatim from `PrettyConversationsPanel.new-role-button.test.tsx:204-276`):
```typescript
describe("PrettyConversationsPanel: Wake-ups header button", () => {
  it("Test 1: pv-header-wakeups-button renders with correct chrome + a11y attrs", () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );
    const btn = screen.getByTestId("pv-header-wakeups-button");
    expect(btn).toBeTruthy();
    expect(btn.getAttribute("aria-label")).toBe("Wake-ups");
    expect(btn.getAttribute("title")).toBe("Wake-ups");
  });

  it("Test 2: button absent when onCreateSession is undefined (showPencilButton guard)", () => {
    render(
      <PrettyConversationsPanel variant="desktop" onDeactivateRow={() => {}} />,
    );
    expect(screen.queryByTestId("pv-header-wakeups-button")).toBeNull();
  });

  it("Test 3: clicking pv-header-wakeups-button opens WakeupsModal", async () => {
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );
    // stub modal is unmounted before click
    expect(screen.queryByTestId("wakeups-modal-stub")).toBeNull();
    fireEvent.click(screen.getByTestId("pv-header-wakeups-button"));
    await waitFor(() => {
      expect(screen.getByTestId("wakeups-modal-stub")).toBeInTheDocument();
    });
  });

  it("Test 4: button position — appears after Globe, before Send-feedback+kebab", () => {
    // Optional structural test; verifies the header cluster order.
    render(
      <PrettyConversationsPanel
        variant="desktop"
        hostTree={ONE_HOST_TREE}
        onCreateSession={vi.fn()}
        onDeactivateRow={() => {}}
      />,
    );
    const globe = screen.getByTestId("pv-header-global-files-button");
    const wakeup = screen.getByTestId("pv-header-wakeups-button");
    const kebab = screen.getByTestId("pv-header-menu-button");
    // documentPosition: PRECEDING=2, FOLLOWING=4
    expect(globe.compareDocumentPosition(wakeup) & 4).toBeTruthy(); // wakeup follows globe
    expect(wakeup.compareDocumentPosition(kebab) & 4).toBeTruthy(); // kebab follows wakeup
  });
});
```

---

## Shared Patterns

### Chrome tokens (glass-morphism modal recipe)
**Source:** `src/ui/features/pretty-conversations/ConversationSearchModal.tsx:229-244` (verbatim style block)
**Apply to:** `WakeupsModal.tsx` (change ONLY `md:max-w-[560px]` to `md:max-w-[640px]`)
**Full table:** RESEARCH.md § Chrome Token Dictionary (lines 756-785) — 24 tokens verified against ConversationSearchModal + prototype.html.

### Refetch discipline (D-03)
**Source pattern:** RESEARCH § Code Examples (Fetching on open, lines 656-686).
**Apply to:** every write path in `WakeupsModal.tsx`:
```typescript
// After every successful write:
const fresh = await listWakeups();
setItems(fresh);
```
Trigger points: create success, update success, toggle success, delete success, and on-open transition.

### API error mapping (statusOf + interpretError)
**Source:** `src/ui/features/pretty-conversations/CreateProjectModal.tsx:76-97`
**Apply to:** `WakeupsModal.tsx` Save + Toggle + Delete error handlers.

### Authentication (JWT via authApi)
**Source:** `src/ui/api/identities-api.ts:1` — `import { authApi, handleApiError } from "@/main-axios";`
**Apply to:** every helper in `wakeups-api.ts` — JWT header is auto-attached; no explicit auth wiring per-call.

### `data-testid` convention for header buttons
**Source:** `PrettyConversationsPanel.tsx:2226-2286` — every button uses `data-testid="pv-header-<verb>-button"`.
**Apply to:** the new button → `data-testid="pv-header-wakeups-button"`.

### `.pv-pencil` chrome class
**Source:** `pretty-conversations.css:105-131` — 32×32 pixel button, 18px SVG icon, transparent bg with hover.
**Apply to:** the new header button, VERBATIM class use — no custom styling.

### `onInteractOutside={(e) => e.preventDefault()}` (RESEARCH Pitfall #7)
**Source:** `ConversationSearchModal.tsx:223`, `NewConversationModal.tsx:289`, `CreateProjectModal.tsx:197-200`
**Apply to:** `WakeupsModal.tsx` Dialog.Content — MANDATORY. Do NOT allow click-outside close.

### Refetch-then-setItems pattern (no optimistic UI)
**Source:** RESEARCH § Code Examples "Pessimistic toggle" (lines 690-703).
**Apply to:** all mutations. Never flip local state before server ack; always refetch fresh list on success.

### Vitest module-level mock convention
**Source:** `ConversationSearchModal.test.tsx:43-51` — `vi.mock(...)` BEFORE `import { WakeupsModal }` for hoist correctness.
**Apply to:** `WakeupsModal.test.tsx` + `PrettyConversationsPanel.wakeups-button.test.tsx`.

---

## Anti-Patterns (from RESEARCH)

Copy these into the plan as "DO NOT" instructions:

- **Do NOT reuse `WakeupSpecWire` from `claude-session-api.ts:719`** — its `instruction` field is the retired per-identity shape. Wire types are fresh in `wakeups-api.ts`.
- **Do NOT modify `WakeupsTab.tsx`** — still consumed by IdentityModal per phase 128 D-09.
- **Do NOT use `Dialog.Close asChild`** for the X button — use direct `onClick={() => onOpenChange(false)}` (matches `ConversationSearchModal.tsx:292-305`).
- **Do NOT client-derive the slug** — server derives it via `normalizeWakeupSlug`.
- **Do NOT client-cache the LIST across modal-open cycles** — D-03 explicit; refetch every open.
- **Do NOT add helpers to `claude-session-api.ts`** — that file is 1400+ lines and its scope is WS/legacy per-identity wire; the new HTTP-REST global-wake-up surface belongs in its own `wakeups-api.ts`.
- **Do NOT use query params for DELETE** — RESEARCH Pitfall #4; DELETE takes body via axios `data:` config.
- **Do NOT enable the Name input in edit-mode** — RESEARCH Pitfall #5; PATCH rejects name-vs-slug divergence. Disable + show helper text.
- **Do NOT expose `RestrictToDaysChips` in v1** — RESEARCH Assumption A4; v1 Weekly form is single-day segmented only.
- **Do NOT use loading text** — RESEARCH Pitfall #1; use `<Skeleton>` bars per shipped WakeupsTab / RoleFileTab / IdentityFileTab pattern.
- **Do NOT add streaming affordances** — D-28; no spinners that linger, no typing indicators, no "creating..." states.

---

## No Analog Found

None — every new file has a strong analog in the codebase. This phase's build-vs-borrow bar is unusually low.

---

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-conversations/` (13 sibling modal + panel + test files scanned)
- `src/ui/features/pretty-view/` (WakeupFormShared, WakeupsTab, RoleFileTab, RoleModal reference reads)
- `src/ui/api/` (identities-api, claude-session-api reference reads)
- `src/ui/components/skeleton.tsx` (verified exists at import path `@/components/skeleton`)

**Files read into context:**
- `ConversationSearchModal.tsx` (385 lines — chrome + fetch-on-open + reset-on-close + X-button pattern)
- `CreateProjectModal.tsx` (415 lines — host-picker + error mapping + inline banner + Radix Dialog with `onInteractOutside`)
- `NewConversationModal.tsx` (excerpt lines 180-260 — in-flight ref guard for double-click debounce)
- `WakeupFormShared.tsx` (246 lines — all 13 exports reusable by the new modal)
- `RoleFileTab.tsx` (excerpt lines 1-100 — Skeleton loading pattern)
- `PrettyConversationsPanel.tsx` (excerpts: `:830-905` state hooks, `:2210-2325` header cluster, `:2880-3095` sibling modal mounts, `:67` icon imports)
- `identities-api.ts` (excerpt lines 290-330 — `listRolesForHost` reference)
- `claude-session-api.ts` (excerpt lines 700-780 — `WakeupSpecWire` do-not-reuse rationale)
- `ConversationSearchModal.test.tsx` (excerpt lines 1-140 — test structure)
- `PrettyConversationsPanel.new-role-button.test.tsx` (excerpt lines 1-280 — panel-button test structure)
- `pretty-conversations.css` (excerpt lines 100-141 — `.pv-pencil` chrome class)

**Pattern extraction date:** 2026-09-24
