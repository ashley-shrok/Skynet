# Phase 137: Preferences modal from sidebar gear — Pattern Map

**Mapped:** 2026-09-27
**Files analyzed:** 19 new/modified (7 new UI, 1 optional new util, 7 modified UI, 4 modified backend/schema, 2 deleted-optional)
**Analogs found:** 19 / 19 (every file has a strong precedent in the tree)

**Planner note on directory:** CONTEXT.md prompt lists new UI files under `src/ui/features/preferences/`, but RESEARCH.md recommends `src/ui/features/pretty-view/` because that directory already contains every sibling artifact (IdentityModal, GlobalFilesModal, MarkdownEditor, VoicePicker) and the "preferences" directory does not exist yet. Planner picks. This PATTERNS.md uses `pretty-view/` in file paths (fewer new-directory conventions to invent) but every pattern applies equally under `preferences/`.

---

## File Classification

### New files (7 UI + 1 optional util + 4 test files)

| New File | Role | Data Flow | Closest Analog | Match Quality |
|----------|------|-----------|----------------|---------------|
| `src/ui/features/pretty-view/PreferencesModal.tsx` | component (modal shell + nav) | request-response (opens/closes; renders panes) | `src/ui/features/pretty-view/IdentityModal.tsx` (chrome + `NAV_SECTIONS`) + `src/ui/features/pretty-view/GlobalFilesModal.tsx` (state atoms, header layout) | exact — same modal chrome family, same section-nav pattern (adapted vertical) |
| `src/ui/features/pretty-view/PreferencesGeneralPane.tsx` | component (pane, avatar UI) | file-I/O (upload multipart PUT) + request-response | `src/ui/api/identities-api.ts` L88-186 (multipart pattern) + `src/backend/database/routes/users.ts` L497 (backend PUT already exists) | role-match — no existing avatar-upload UI in the frontend today; multipart pattern is verbatim reusable |
| `src/ui/features/pretty-view/PreferencesVoicePane.tsx` | component (pane, autosave picker) | request-response (PUT on change) | `src/ui/features/pretty-view/IdentityModal.tsx` L1387-1410 (`<VoicePicker>` embedding site) + `src/ui/api/user-preferences-api.ts` L44-78 (`putPinnedIds` autosave shape) | exact — same picker component, same autosave-on-change wire |
| `src/ui/features/pretty-view/PreferencesNotificationsPane.tsx` | component (pane, folded-in flow) | event-driven (user click → sync permission-request) | `src/ui/features/notifications/EnableNotificationsModal.tsx` L88-115 (the entire onClick handler — copy verbatim) | exact — the interior of the modal is exactly what folds in |
| `src/ui/features/pretty-view/PreferencesAboutYouPane.tsx` | component (pane, editor + host/file fallbacks) | file-I/O (SSH read/write via global-files API) + request-response | `src/ui/features/pretty-view/GlobalFilesModal.tsx` L61-190 (state atoms + host picker + tabs + handleSave) + `src/ui/features/pretty-view/GlobalFileTab.tsx` L88-99, L130-151 (MDXEditor mount + wrapping flex) | exact — this pane IS the interior of GlobalFilesModal minus the DialogPrimitive wrap |
| `src/ui/api/user-preferences-api.ts` (EXTEND — file already exists) | api-client wrapper | request-response (JSON GET/PUT) | file already present; extend with `fallbackVoice` slice following the existing `putPinnedIds` shape | exact — same file, add sibling helper |
| `src/ui/features/notifications/push-support.ts` (OPTIONAL new file — recommended per RESEARCH Q2) | utility | pure feature detection | `src/ui/features/notifications/EnableNotificationsModal.tsx` L49-56 (`pushNotificationsSupported`) | exact — move the function verbatim to its own file |
| `src/ui/features/pretty-view/PreferencesModal.test.tsx` | test | test setup + assertions | `src/ui/features/notifications/EnableNotificationsModal.test.tsx` L20-116 (Notification/serviceWorker mock scaffolding) + `src/ui/features/pretty-view/GlobalFilesModal.test.tsx` (MDXEditor stub pattern) | exact — port both test-scaffolding shapes |

### Modified files (7 UI + 4 backend/schema)

| Modified File | Role | Data Flow | Closest Analog (for the ADD pattern) | Match Quality |
|---------------|------|-----------|--------------------------------------|---------------|
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | component (sidebar panel) | request-response (opens modal atoms) | itself — L901-919 (siblings of new `preferencesModalOpen` atom); L3251-3256 (mount shape for new modal); L3083-3125 (footer render) | exact (self-precedent) |
| `src/ui/AppShell.tsx` | component (root shell + state atoms) | request-response (fetches user info, threads props) | itself — L446 `meUsername` (sibling for `meAvatarPath`); L529-537 (getUserInfo populate); L361-363 (userPrefs seed — remove `reopenTabsOnLogin`); L1606 (dead read site) | exact (self-precedent) |
| `src/ui/features/pretty-view/PrettyView.tsx` | component (pane) | prop-threading | itself — L4269 `identityVoice={pvIdentity?.voice ?? null}` (extend `?? userPrefs.fallbackVoice`) | exact — one-line edit |
| `src/ui/features/pretty-view/ChatMessage.tsx` | component (leaf) | no change to interface; the resolution happens in caller | itself — L204, L256 already consume `identityVoice` prop; no signature change needed | exact — no edit if resolution is in PrettyView.tsx (recommended) |
| `src/ui/main-axios.ts` | type declaration + api wrapper | shape extension | itself L117-135 — add `avatarPath?: string \| null` to `UserInfo` (sibling of `mxid?: string \| null` at L134) | exact — same optional-field precedent |
| `src/ui/api/open-tabs-api.ts` | api-client type | shape extension + deletion | itself L94-100 — `UserPreferences` interface: add `fallbackVoice`, remove `reopenTabsOnLogin` | exact — same file |
| `src/backend/database/routes/user-preferences.ts` | backend route (Express handler) | CRUD (GET returns row; PUT accepts partial) | itself L63-75 `pickPreferences` (add slice, remove slice); L125-176 `handlePutPreferences` destructure + validation loop; L446-459 `DatabaseSaveTrigger.forceSave` invariant | exact (self-precedent) |
| `src/backend/database/routes/users.ts` | backend route | extend response shape | itself L1928-1944 `/users/me` response — add `avatarPath: user[0].avatarPath ?? null` (sibling of `mxid` at L1943) | exact — same optional-field pattern |
| `src/backend/database/db/schema.ts` | Drizzle schema | column add + drop | itself L832-846 `userPreferences` — mirror shape for new col; delete `reopenTabsOnLogin` col | exact (self-precedent) |
| `src/backend/database/db/index.ts` | schema migration | ALTER TABLE ADD + DROP | itself L779-804 (`addColumnIfNotExists`) + L937-940 (`runPinColumnDrop` verbatim shape for new `runReopenTabsColumnDrop`) + L1071-1079 (call site pattern in `migrateSchema`) + L540-549 (CREATE TABLE fresh-install line) | exact (self-precedent) |

### Deleted files (optional, post-fold-in)

| Deleted File | Reason | Preserve? |
|--------------|--------|-----------|
| `src/ui/features/notifications/EnableNotificationsModal.tsx` | folded into NotificationsPane | Export `pushNotificationsSupported` must survive — move to `push-support.ts` (see NEW row above) |
| `src/ui/features/pretty-view/GlobalFilesModal.tsx` | folded into AboutYouPane (globe button retired) | Verify no other importers via grep before deletion |

---

## Pattern Assignments

### `PreferencesModal.tsx` (component, request-response)

**Analog:** `src/ui/features/notifications/EnableNotificationsModal.tsx` (cleanest single-modal chrome) + `src/ui/features/pretty-view/IdentityModal.tsx` (NAV_SECTIONS)

**Imports pattern** (adapted from `EnableNotificationsModal.tsx` L30-39 + `IdentityModal.tsx` L25-31):
```typescript
import { useState } from "react";
import { X, User, Volume2, Bell, Sparkles } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogHeader, DialogTitle, DialogClose } from "@/components/dialog";
import { cn } from "@/lib/utils";
import { PreferencesGeneralPane } from "./PreferencesGeneralPane";
import { PreferencesVoicePane } from "./PreferencesVoicePane";
import { PreferencesNotificationsPane } from "./PreferencesNotificationsPane";
import { PreferencesAboutYouPane } from "./PreferencesAboutYouPane";
```

**Modal chrome pattern** — copy VERBATIM from `EnableNotificationsModal.tsx` L134-190. Two differences:
1. Size: `md:max-w-[760px] md:max-h-[600px]` instead of `md:max-w-[480px] md:max-h-[360px]` (per D-03)
2. `data-testid="preferences-modal"` instead of `data-testid="enable-notifications-modal"`

Concrete excerpt (from `EnableNotificationsModal.tsx` L134-191):
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
      onInteractOutside={(e) => e.preventDefault()}  // X + Esc are the close paths
      className={cn(
        "absolute inset-4 z-[120] outline-none",
        "flex flex-col overflow-hidden rounded-[24px]",
        "md:max-w-[760px] md:max-h-[600px] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2",
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
      data-testid="preferences-modal"
    >
      <DialogTitle className="sr-only">Preferences</DialogTitle>
      {/* left nav + content pane body */}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
```

**Glass close button pattern** — copy VERBATIM from `GlobalFilesModal.tsx` L252-276 (includes hover-behavior fidelity):
```tsx
<DialogClose asChild>
  <button
    type="button"
    aria-label="Close"
    title="Close"
    className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color,box-shadow] duration-200"
    style={{
      background: "rgba(255, 255, 255, 0.04)",
      border: "1px solid rgba(220, 225, 245, 0.10)",
    }}
    onMouseEnter={(e) => {
      e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
      e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.22)";
      e.currentTarget.style.boxShadow = "0 0 20px hsla(220, 60%, 50%, 0.25)";
    }}
    onMouseLeave={(e) => {
      e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
      e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.10)";
      e.currentTarget.style.boxShadow = "none";
    }}
  >
    <X className="size-4" />
  </button>
</DialogClose>
```

**NAV_SECTIONS pattern** — adapt shape from `IdentityModal.tsx` L308-314; render VERTICALLY on left instead of horizontally at bottom (RESEARCH § Pattern 2):
```tsx
const NAV_SECTIONS = [
  { value: "general",       label: "General",       Icon: User    },
  { value: "voice",         label: "Voice",         Icon: Volume2 },
  { value: "notifications", label: "Notifications", Icon: Bell    },
  { value: "about-you",     label: "About you",     Icon: Sparkles },
] as const;
const [activeSection, setActiveSection] = useState<(typeof NAV_SECTIONS)[number]["value"]>("general");
```

**State reset on close** (per D-05) — use `useState` INSIDE this modal component so unmount clears; do NOT lift `activeSection` to `PrettyConversationsPanel`. If the modal is unmounted when `open=false`, this is automatic. If it stays mounted, use a `useEffect(() => { if (!open) setActiveSection("general"); }, [open]);` — mirror the reset pattern from `EnableNotificationsModal.tsx` L72-82.

---

### `PreferencesGeneralPane.tsx` (component, file-I/O upload)

**Analog:** `src/ui/api/identities-api.ts` L88-186 (multipart pattern); no existing frontend UI for user-avatar upload — this is genuinely new UI over a fully-built backend.

**Multipart upload helper** (put in `user-preferences-api.ts` OR inline in the pane — adapt from `identities-api.ts` L88-93 + L176-183):
```typescript
export async function uploadUserAvatar(
  userId: string,
  file: File,
): Promise<{ avatarPath: string }> {
  const fd = new FormData();
  fd.append("avatar", file);
  const response = await authApi.put(
    `/users/${encodeURIComponent(userId)}/avatar`,
    fd,
    { headers: { "Content-Type": "multipart/form-data" } },
  );
  return response.data as { id: string; avatarPath: string };
}
```

**Local preview + cleanup pattern** (from VoicePicker.tsx L37-47 `URL.createObjectURL` + revoke cleanup pattern, adapted for image blob):
```tsx
const [previewUrl, setPreviewUrl] = useState<string | null>(null);
useEffect(() => {
  return () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
  };
}, [previewUrl]);

function onFileChosen(file: File) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  setPreviewUrl(URL.createObjectURL(file));
}
```

**Error revert pattern** (D-13 says on failure revert preview to previous; inline error, no toast) — mirror the local-state-revert shape used by `PreferencesVoicePane` below.

**Backend already exists** — DO NOT touch `src/backend/database/routes/users.ts` L497-623 (PUT /users/:id/avatar) or `src/backend/database/routes/user-avatar-storage.ts`. Both are fully built (Phase 85).

---

### `PreferencesVoicePane.tsx` (component, request-response autosave)

**Analog:** `src/ui/features/pretty-view/IdentityModal.tsx` L1387-1410 (VoicePicker embedding) + `src/ui/api/user-preferences-api.ts` L44-78 (`putPinnedIds` autosave shape).

**VoicePicker mount** (from `IdentityModal.tsx` L1402-1410):
```tsx
<VoicePicker
  id="preferences-voice-select"
  value={fallbackVoice ?? ""}
  onChange={handleVoiceChange}
  disabled={saving}
  ariaLabel="The voice your agents use to speak"
/>
```

**Autosave-on-change wire** (adapt shape from `user-preferences-api.ts` L44-78 — single PUT per change, no debounce, server echo is authoritative):
```tsx
const [fallbackVoice, setFallbackVoice] = useState<string>(userPrefs.fallbackVoice ?? "");
const [saving, setSaving] = useState(false);

const handleVoiceChange = useCallback(async (next: string) => {
  const prev = fallbackVoice;
  setFallbackVoice(next);                                // optimistic local update
  setSaving(true);
  try {
    await saveUserPreferences({ fallbackVoice: next || null });
    // Optional: refresh AppShell userPrefs from the response echo
  } catch {
    setFallbackVoice(prev);                              // revert on failure
    // TODO inline error UX (no toast — matches D-13 pattern for General pane)
  } finally {
    setSaving(false);
  }
}, [fallbackVoice]);
```

**IMPORTANT** (per RESEARCH Pitfall 5): Do NOT debounce. The picker is a `<select>` with 7 static options; each change fires once. Debounce adds latency for no gain.

---

### `PreferencesNotificationsPane.tsx` (component, event-driven, LOAD-BEARING sync-gesture)

**Analog:** `src/ui/features/notifications/EnableNotificationsModal.tsx` L67-131 (the interior, verbatim).

**Feature-gate + fallback branch** (D-20, adapt from EnableNotificationsModal.tsx L49-56):
```tsx
import { pushNotificationsSupported } from "@/features/notifications/push-support";

const supported = pushNotificationsSupported();
if (!supported) {
  return (
    <div className="text-[13px] text-[#c8c4b8]">
      Push notifications aren&apos;t supported in this browser.
    </div>
  );
}
```

**LOAD-BEARING synchronous permission-request** — copy VERBATIM from `EnableNotificationsModal.tsx` L84-115. Do NOT convert to `async onClick`. Do NOT add any `await` before `Notification.requestPermission()`:
```tsx
// LOAD-BEARING (Pitfall 4 — iOS PWA gesture-gate): the permission-request
// call below is the FIRST asynchronous operation in this handler. It fires
// synchronously in the click's task tick — the Promise it returns is chained
// via .then, not consumed via `await` that would introduce a boundary before it.
const onClick = useCallback(() => {
  if (typeof Notification === "undefined") {
    setStatus("failed");
    return;
  }
  setStatus("requesting");
  const permPromise = Notification.requestPermission();
  permPromise
    .then(async (perm) => {
      if (perm !== "granted") { setStatus("denied"); return; }
      const reg = await navigator.serviceWorker.ready;
      const vapidKey = await getVapidPublicKey();
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      });
      await postSubscription(sub);
      setStatus("enabled");
    })
    .catch((err: unknown) => {
      console.warn("[enable-notifications] setup failed", err);
      setStatus("failed");
    });
}, []);
```

**Initial-state effect** (from `EnableNotificationsModal.tsx` L72-82) — mirror the "already granted" detection:
```tsx
useEffect(() => {
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    setStatus("enabled");
  } else {
    setStatus("idle");
  }
}, []);
```

**Explainer paragraph + button + status text** — copy body markup from `EnableNotificationsModal.tsx` L193-238 verbatim (drop the DialogHeader wrap since we're inside a pane, not a modal).

---

### `PreferencesAboutYouPane.tsx` (component, file-I/O + editor)

**Analog:** `src/ui/features/pretty-view/GlobalFilesModal.tsx` L61-190 (interior state + save flow) + `src/ui/features/pretty-view/GlobalFileTab.tsx` L88-99, L130-151 (MDXEditor mount).

**State atoms** (copy from `GlobalFilesModal.tsx` L68-71):
```tsx
const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
const [files, setFiles] = useState<TabState<GlobalFileEntry[]>>({ status: "loading" });
const [activeTab, setActiveTab] = useState<string | null>(null);
const [tabData, setTabData] = useState<Map<string, TabState<GlobalFileTabData>>>(new Map());
```

**Host auto-select effect** (from `GlobalFilesModal.tsx` L78-94):
```tsx
useEffect(() => {
  if (defaultHostId != null && flatHosts.some((h) => Number(h.id) === defaultHostId)) {
    setSelectedHostId(defaultHostId);
    return;
  }
  if (flatHosts.length === 1) setSelectedHostId(Number(flatHosts[0].id));
}, [defaultHostId, flatHosts]);
```

**Files fetch effect** (from `GlobalFilesModal.tsx` L97-119) — copy verbatim, no changes.

**Lazy per-tab content load effect** (from `GlobalFilesModal.tsx` L121-155) — copy verbatim, including the intentional exhaustive-deps violation and its ESLint suppression comment.

**Save handler with 409 UX** (from `GlobalFilesModal.tsx` L157-189) — copy VERBATIM (D-26 invariant):
```tsx
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

**MDXEditor mount + wrapping flex/min-h-0** — copy from `GlobalFileTab.tsx` L130-151 (Pitfall 4 fix — MDXEditor needs a flex-col ancestor with `min-h-0` for the height cascade to work):
```tsx
<div className="flex flex-col h-full gap-2">
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
  <div className="flex-1 min-h-0">
    <MarkdownEditor
      filename={filename}
      content={draft}
      onChange={setDraft}
      disabled={saving}
    />
  </div>
  {saveError && <div className="text-sm text-red-400 px-1">{saveError}</div>}
</div>
```

**Multi-host / multi-file fallback fences** (per D-27, D-28):
- Host picker `<select>` only renders when `flatHosts.length > 1` — see `GlobalFilesModal.tsx` L235-248 for the `<select>` markup + OPTION_STYLE constant at L33.
- Tab strip only renders when `files.data.length > 1` — see `GlobalFilesModal.tsx` L326-375 for the bottom-nav tab strip markup. In the About-you fold-in, render as a TOP tab strip (or preserve bottom placement — planner picks). First tab label OVERRIDE = "About you" (per D-28) when the path matches `IMPLICIT_GLOBAL_FILE.path` (`~/.claude/CLAUDE.md`).

**Helper functions** — copy `isFolder` + `collectAllHosts` from `GlobalFilesModal.tsx` L38-48 (same duplication rationale — pending shared `HostPickerList` extraction).

---

### `PrettyConversationsPanel.tsx` (modified)

**Analog:** itself (self-precedent for state atom siblings + footer render + modal mount).

**Add `preferencesModalOpen` state atom** — sibling of existing atoms at L901-919. Insertion pattern:
```tsx
// Add near L916 (adjacent to `enableNotificationsModalOpen`):
const [preferencesModalOpen, setPreferencesModalOpen] = useState(false);
```

**Replace gear placeholder** at L3117-3124 — turn the inert `<span>` into a real `<button>`:
```tsx
// BEFORE (L3117-3124):
<span
  className="pv-footer-btn pv-footer-btn-inert"
  title="User preferences (coming soon)"
  data-testid="pv-footer-preferences-placeholder"
  aria-hidden="true"
>
  <Settings size={18} />
</span>

// AFTER:
<button
  type="button"
  className="pv-footer-btn"
  aria-label="User preferences"
  title="User preferences"
  data-testid="pv-footer-preferences-button"
  onClick={() => setPreferencesModalOpen(true)}
>
  <Settings size={18} />
</button>
```

**Remove Globe button** at L3103-3112 (D-29) — delete entire `<button data-testid="pv-footer-global-files-button">` block AND the `setGlobalFilesModalOpen` state atom + `<GlobalFilesModal>` mount at L3251-3256 if GlobalFilesModal is being deleted entirely.

**Sidebar footer avatar conditional render** at L3083-3091 — swap the `<span>` for a conditional `<img>`/`<span>`. Copy from RESEARCH.md Code Examples (Sidebar footer conditional avatar render):
```tsx
{avatarPath ? (
  <img
    className="pv-footer-initials"
    src={`/users/${encodeURIComponent(userId)}/avatar?f=${encodeURIComponent(avatarPath)}`}
    alt=""
    aria-hidden="true"
    data-testid="pv-footer-avatar-image"
  />
) : (
  <span className="pv-footer-initials" aria-hidden="true" data-testid="pv-footer-initials">
    {initial}
  </span>
)}
```
(Cache-buster `?f=${avatarPath}` per RESEARCH A3 — backend `writeUserAvatar` mints a new random filename per upload, so appending it as query param naturally busts cache.)

**Remove notifications kebab item** at L3437-3440 — delete the conditional entry:
```tsx
// DELETE:
...(notificationsSupported
  ? [{ label: "Enable notifications…", onClick: () => setEnableNotificationsModalOpen(true) }]
  : []),

// Also delete: L914-915 (setEnableNotificationsModalOpen state atom)
//              L916 (notificationsSupported const — but the fn is still needed for the new pane; import path may change)
//              L3301-3304 (<EnableNotificationsModal> mount)
//              L238-240 (EnableNotificationsModal import — but keep pushNotificationsSupported import via new path)
```

**Mount new `<PreferencesModal>`** — mirror the sibling mount pattern at L3251-3256 (GlobalFilesModal) or L3301-3304 (EnableNotificationsModal):
```tsx
<PreferencesModal
  open={preferencesModalOpen}
  onOpenChange={setPreferencesModalOpen}
  userId={userId}
  hostTree={hostTree ?? null}
  defaultHostId={/* current-focused session's host, if any */ null}
  onAvatarChanged={onAvatarChanged}  // callback threaded from AppShell → refresh meAvatarPath
  userPrefs={userPrefs}              // for VoicePane initial value
/>
```

**New prop:** `avatarPath?: string | null` — threaded from AppShell. Feeds the conditional footer render.

---

### `AppShell.tsx` (modified)

**Analog:** itself (self-precedent).

**Add `meAvatarPath` state atom** — sibling of `meUsername` at L446:
```tsx
const [meUsername, setMeUsername] = useState<string | null>(null);
const [meAvatarPath, setMeAvatarPath] = useState<string | null>(null);  // NEW
```

**Populate from `getUserInfo()`** — extend the effect at L528-538:
```tsx
useEffect(() => {
  getUserInfo()
    .then((info) => {
      setIsAdmin(info.is_admin);
      setMeUsername(info.username || null);
      setMeAvatarPath(info.avatarPath ?? null);  // NEW
    })
    .catch(() => {
      setIsAdmin(false);
      setMeUsername(null);
      setMeAvatarPath(null);  // NEW
    });
}, []);
```

**Thread `meAvatarPath` + `onAvatarChanged` to PrettyConversationsPanel** — at L3250-3282 add props:
```tsx
<PrettyConversationsPanel
  // ... existing props
  avatarPath={meAvatarPath}
  onAvatarChanged={setMeAvatarPath}  // panel forwards to PreferencesModal → GeneralPane
  userPrefs={userPrefs}              // panel forwards to PreferencesModal → VoicePane
  /* ... */
/>
```

**Delete `reopenTabsOnLogin` seed** at L361-363:
```tsx
// BEFORE:
const [userPrefs, setUserPrefs] = useState<UserPreferences>({
  reopenTabsOnLogin: false,
});

// AFTER:
const [userPrefs, setUserPrefs] = useState<UserPreferences>({});
// OR (if TS narrows to Partial<UserPreferences>):
const [userPrefs, setUserPrefs] = useState<UserPreferences>({ fallbackVoice: null });
```

**Delete `userPrefs.reopenTabsOnLogin` read** at L1606 — restructure the restore-tabs conditional. The tab-restoration mechanism is now driven differently; the whole `if (userPrefs.reopenTabsOnLogin && !pending?.only)` gate collapses to just the inner branch or an alternate gate (planner decides based on the surrounding context of L1595-1650).

---

### `PrettyView.tsx` (modified — one-line change)

**Analog:** itself L4266-4285.

**Edit at L4269** — extend the voice-resolution `??` chain:
```tsx
// BEFORE:
identityVoice={pvIdentity?.voice ?? null}

// AFTER:
identityVoice={pvIdentity?.voice ?? userPrefs.fallbackVoice ?? null}
```

**Prop plumbing:** `userPrefs` must be threaded from AppShell → wherever PrettyView is mounted → PrettyView props. If PrettyView doesn't already accept `userPrefs`, add it as a prop (`userPrefs: UserPreferences`).

---

### `main-axios.ts` (modified — type extension)

**Analog:** itself L117-135.

**Add `avatarPath` to `UserInfo`** — sibling of `mxid` at L134:
```tsx
export interface UserInfo {
  totp_enabled: boolean;
  userId: string;
  username: string;
  is_admin: boolean;
  is_oidc: boolean;
  data_unlocked: boolean;
  password_hash?: string;
  mxid?: string | null;
  /**
   * Phase 137 D-30: viewing user's avatar filename (populated from
   * users.avatar_path via /users/me). Frontend consumers use this to
   * conditionally render the sidebar footer avatar preview. Nullable —
   * users without an uploaded avatar surface here as `null`.
   */
  avatarPath?: string | null;  // NEW
}
```

---

### `open-tabs-api.ts` (modified — type extension + deletion)

**Analog:** itself L94-100.

**Edit `UserPreferences`** interface:
```tsx
// BEFORE:
export interface UserPreferences {
  reopenTabsOnLogin: boolean;
  theme?: string | null;
  fontSize?: string | null;
  accentColor?: string | null;
  language?: string | null;
}

// AFTER:
export interface UserPreferences {
  // reopenTabsOnLogin: DELETED per Phase 137 D-31
  theme?: string | null;
  fontSize?: string | null;
  accentColor?: string | null;
  language?: string | null;
  fallbackVoice?: string | null;  // NEW per Phase 137 D-14
}
```

**RESEARCH note (A10):** Consider migrating `getUserPreferences` + `saveUserPreferences` from `open-tabs-api.ts` to `user-preferences-api.ts` — the latter is the natural home for user-preferences helpers (`putPinnedIds` already lives there). Planner picks: extract (cleaner) or extend in place (min-diff).

---

### `user-preferences.ts` backend (modified)

**Analog:** itself L63-75, L125-176, L446-459.

**Edit `pickPreferences`** at L63-75:
```typescript
const pickPreferences = (row?: typeof userPreferences.$inferSelect) => ({
  // reopenTabsOnLogin: DELETED per Phase 137 D-31
  theme: row?.theme ?? null,
  fontSize: row?.fontSize ?? null,
  accentColor: row?.accentColor ?? null,
  language: row?.language ?? null,
  fallbackVoice: row?.fallbackVoice ?? null,  // NEW per Phase 137 D-14
});
```

**Edit `handlePutPreferences` destructure** at L125-146:
```typescript
const {
  // reopenTabsOnLogin: DELETED
  theme, fontSize, accentColor, language,
  fallbackVoice,  // NEW
  pinnedConversationIds,
  identityHosts: identityHostsRaw,
} = (body ?? {}) as {
  theme?: string | null;
  fontSize?: string | null;
  accentColor?: string | null;
  language?: string | null;
  fallbackVoice?: string | null;  // NEW
  pinnedConversationIds?: unknown;
  identityHosts?: unknown;
};
```

**Delete `reopenTabsOnLogin` validation block** at L152-159 (entirely) and add `fallbackVoice` to the string-validation loop at L161-170:
```typescript
for (const [key, value] of Object.entries({
  theme, fontSize, accentColor, language, fallbackVoice,  // ADD fallbackVoice
})) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    return res.status(400).json({ error: `${key} must be a string` });
  }
}

if (theme !== undefined) updates.theme = theme;
if (fontSize !== undefined) updates.fontSize = fontSize;
if (accentColor !== undefined) updates.accentColor = accentColor;
if (language !== undefined) updates.language = language;
if (fallbackVoice !== undefined) updates.fallbackVoice = fallbackVoice;  // ADD
```

**Update OpenAPI docs** at L505-544 — remove `reopenTabsOnLogin` schema field, add `fallbackVoice`.

**forceSave invariant** at L446-459 is UNCHANGED — the existing block already covers all user_preferences updates. Do NOT introduce a second forceSave.

---

### `users.ts` backend (modified — extend /users/me)

**Analog:** itself L1928-1944.

**Add `avatarPath` to response body**:
```typescript
res.json({
  userId: user[0].id,
  username: user[0].username,
  is_admin: !!user[0].isAdmin,
  is_oidc: !!user[0].isOidc,
  is_dual_auth: isDualAuth,
  totp_enabled: !!user[0].totpEnabled,
  data_unlocked: authManager.isUserUnlocked(userId),
  mxid: user[0].mxid ?? null,
  avatarPath: user[0].avatarPath ?? null,  // NEW per Phase 137 D-30
});
```

**PUT /users/:id/avatar** at L497-623 — UNCHANGED. Backend fully built in Phase 85.

---

### `schema.ts` (modified — Drizzle userPreferences)

**Analog:** itself L832-846.

**Edit userPreferences table**:
```typescript
export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  // reopenTabsOnLogin: DELETED per Phase 137 D-31 (dead fork holdover)
  theme: text("theme"),
  fontSize: text("font_size"),
  accentColor: text("accent_color"),
  language: text("language"),
  fallbackVoice: text("fallback_voice"),  // NEW per Phase 137 D-14 (nullable — null → DEFAULT_VOICE fallback)
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});
```

---

### `db/index.ts` (modified — migration + CREATE TABLE)

**Analog:** itself L779-804 (`addColumnIfNotExists`), L937-940 (`runPinColumnDrop`), L1070-1079 (call site in migrateSchema), L540-549 (CREATE TABLE), L1136-1139 (addColumnIfNotExists sweep).

**Remove `reopen_tabs_on_login` from CREATE TABLE** at L542 (per Pitfall 9):
```sql
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id TEXT PRIMARY KEY,
    -- reopen_tabs_on_login INTEGER NOT NULL DEFAULT 0,  ← DELETE this line
    theme TEXT,
    font_size TEXT,
    accent_color TEXT,
    language TEXT,
    fallback_voice TEXT,                                   -- NEW per Phase 137 D-14
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
);
```

**Add `runReopenTabsColumnDrop` helper** — byte-mirror of `runHiddenColumnDrop` at L959-962:
```typescript
/**
 * Phase 137 D-31 — drop the `reopen_tabs_on_login` column from
 * `user_preferences`. Dead fork holdover; tab-restoration is now driven by
 * a different mechanism. Phase 137 already retired every reader/writer in
 * src/ — this drop retires the dead storage.
 *
 * Idempotent via dropColumnIfExists (probes SELECT; ALTER TABLE DROP
 * COLUMN on hit; silent no-op on miss). Byte-mirror of runHiddenColumnDrop
 * at L959-962 — the only difference is the column name.
 */
export function runReopenTabsColumnDrop(sqliteDb: Database.Database): void {
  assertSqliteSupportsDropColumn(sqliteDb);
  dropColumnIfExists(sqliteDb, "user_preferences", "reopen_tabs_on_login");
}
```

**Call it in `migrateSchema`** — mirror the shape at L1092-1101 (runHiddenColumnDrop try/catch):
```typescript
try {
  runReopenTabsColumnDrop(sqlite);
} catch (preflightErr) {
  databaseLogger.error(
    "Phase 137 reopen-tabs-column drop preflight failed",
    preflightErr,
    { operation: "schema_migration_preflight" },
  );
  throw preflightErr;
}
```

**Add `fallback_voice` column** — sibling of the existing `addColumnIfNotExists` sweep at L1136-1139:
```typescript
addColumnIfNotExists("user_preferences", "theme", "TEXT");
addColumnIfNotExists("user_preferences", "font_size", "TEXT");
addColumnIfNotExists("user_preferences", "accent_color", "TEXT");
addColumnIfNotExists("user_preferences", "language", "TEXT");
addColumnIfNotExists("user_preferences", "fallback_voice", "TEXT");  // NEW per Phase 137 D-14
```

**Update the labeled forceSave** at L1162-1174 — either add a new labeled forceSave for `phase-137-reopen-tabs-column-drop`, OR (RESEARCH-recommended) rename the existing label to reflect the LATEST migration touching this file per the "one forceSave batches all prior mutations" precedent documented in the comment at L1156-1161. Planner picks.

---

### Test files

**Analog:** `src/ui/features/notifications/EnableNotificationsModal.test.tsx` L1-116 (test scaffolding for Notification + serviceWorker mocks) + `src/ui/features/pretty-view/GlobalFilesModal.test.tsx` (MDXEditor stub pattern; not read in full but referenced in RESEARCH § Sources).

**Load-bearing regression gate** — port case 4 from `EnableNotificationsModal.test.tsx` (the "LOAD-BEARING (Pitfall 4)" test that asserts `Notification.requestPermission()` is called synchronously in the same task-tick as the click) to `PreferencesModal.test.tsx` (whichever component holds the button after fold-in — `PreferencesNotificationsPane.test.tsx` or the parent modal test).

Reuse the mock helpers verbatim from `EnableNotificationsModal.test.tsx` L37-83:
- `installNotificationMock(perm)` — L37-48
- `installServiceWorkerReadyMock(subscribe)` — L50-66
- `makeFakeSubscription()` — L68-83

---

## Shared Patterns

### Authentication (backend)

**Source:** `src/backend/database/routes/user-preferences.ts` L22-24
**Apply to:** All new/modified backend routes (none — this phase adds no new backend routes; extends existing handlers only).

```typescript
const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
// ...
router.put("/", authenticateJWT, async (req, res) => { ... });
```

Existing `PUT /users/:id/avatar` already stacks `multipartOriginGuard + authenticateJWT + assertOwnOrAdminForAvatarChange + userAvatarUpload.single("avatar")` (users.ts L497). No changes.

---

### Frontend REST client

**Source:** `src/ui/api/user-preferences-api.ts` L44-78
**Apply to:** All new/modified frontend API helpers (`uploadUserAvatar`, extended `saveUserPreferences`).

Use `authApi` (from `@/main-axios`) — NOT raw `axios`/`fetch`. `authApi` routes through `stampedFetch` which stamps every request with `X-Skynet-Client-Build` for the version-drift hard-lock:
```typescript
import { authApi, handleApiError } from "@/main-axios";

export async function uploadUserAvatar(userId: string, file: File): Promise<{ avatarPath: string }> {
  try {
    const fd = new FormData();
    fd.append("avatar", file);
    const response = await authApi.put(
      `/users/${encodeURIComponent(userId)}/avatar`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return response.data;
  } catch (error) {
    throw new Error(handleApiError(error));
  }
}
```

---

### DB write persistence (backend crown-jewel)

**Source:** `src/backend/database/routes/user-preferences.ts` L446-459 (references identities.ts:264-273 as the reference)
**Apply to:** Every `db.insert/update/delete().run()` on `user_preferences` or `users.avatarPath`.

**Existing forceSave invocations that COVER Phase 137 writes without modification:**
- `user-preferences.ts` L446-459 — covers PUT /user-preferences (all slices including new `fallbackVoice`). Do NOT introduce a second forceSave in the same handler.
- `users.ts` L601-612 — covers PUT /users/:id/avatar (`phase-85-user-avatar-change` label). Unchanged.
- `db/index.ts` L1162-1174 — covers the migration sweep. Extend the label to reflect the Phase 137 drop (see `db/index.ts` section above).

Verbatim pattern (for reference):
```typescript
try {
  await DatabaseSaveTrigger.forceSave("user_preferences_updated");
} catch (saveErr) {
  databaseLogger.warn(
    "Force-save after user preferences update failed",
    {
      operation: "user_preferences_update_save_failed",
      userId,
      error: saveErr instanceof Error ? saveErr.message : "Unknown error",
    },
  );
}
```

---

### Modal chrome recipe (frontend)

**Source:** `src/ui/features/notifications/EnableNotificationsModal.tsx` L134-190 (cleanest single-modal example) + `src/ui/features/pretty-view/GlobalFilesModal.tsx` L191-277 (with header content + host picker + close button).

**Apply to:** New `PreferencesModal.tsx` only. Do NOT retrofit any other modal (per shape § Deferred).

Key invariants (documented at every existing modal site):
- `z-[110]` overlay, `z-[120]` content — ladder shared with IdentityModal patch #111
- Radial gradient background — literal `linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))` — do NOT parameterize
- `onInteractOutside={(e) => e.preventDefault()}` — X + Esc are the ONLY close paths (matches D-04 requirement that these three close paths work AND that outside-click is intentionally NOT one)
- `rounded-[24px]` — the app-wide modal border-radius
- `DialogTitle` must be `className="sr-only"` — a11y requirement for DialogPrimitive

---

### Feature-detection for browser Web Push

**Source:** `src/ui/features/notifications/EnableNotificationsModal.tsx` L49-56 (`pushNotificationsSupported`)
**Apply to:** `PreferencesNotificationsPane.tsx` (D-20 fallback branch); MOVE the function out of `EnableNotificationsModal.tsx` into new `src/ui/features/notifications/push-support.ts` per RESEARCH Q2 recommendation:
```typescript
// src/ui/features/notifications/push-support.ts (NEW FILE)
/**
 * Feature-detect Web Push support. Callers hide/replace UI on browsers
 * that can't subscribe (e.g. old Safari, in-app WebViews). Returns false
 * in SSR contexts because `window`/`navigator` are undefined there.
 *
 * Phase 137: relocated from EnableNotificationsModal.tsx (L49-56) as
 * that modal folded into PreferencesModal's NotificationsPane. Kept as
 * a standalone export so PreferencesNotificationsPane and any future
 * consumers can import it without pulling the modal component.
 */
export function pushNotificationsSupported(): boolean {
  if (typeof window === "undefined") return false;
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}
```

Existing consumers (grep before deleting EnableNotificationsModal.tsx):
- `PrettyConversationsPanel.tsx` L239 — update import to `@/features/notifications/push-support` OR remove the import entirely if the kebab-item is deleted before it's read.
- `EnableNotificationsModal.test.tsx` L25 — retire the test file alongside the modal.

---

### iOS PWA gesture-gate invariant (LOAD-BEARING)

**Source:** `src/ui/features/notifications/EnableNotificationsModal.tsx` L84-115
**Apply to:** `PreferencesNotificationsPane.tsx` onClick handler. Copy the handler VERBATIM. Do NOT convert to `async onClick`. Do NOT add ANY `await` before `Notification.requestPermission()`.

Regression gate: port test case 4 from `EnableNotificationsModal.test.tsx` (asserts synchronous invocation) to whichever test file hosts the new button.

---

### Autosave-on-change (single PUT per change, no debounce)

**Source:** `src/ui/api/user-preferences-api.ts` L44-78 (`putPinnedIds`)
**Apply to:** `PreferencesVoicePane.tsx` onChange handler.

Pattern: optimistic local update → PUT → on error, revert local state.

---

## No Analog Found

Files with no close match in the codebase (planner should use the RESEARCH.md § Standard Stack patterns or new-pattern justification):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Left-nav VERTICAL layout inside a modal | layout pattern | request-response | Skynet has no vertical-left-nav modal today — every existing multi-section modal (IdentityModal, GlobalFilesModal) uses a BOTTOM icon-bar. Locked to left-nav by CONTEXT.md D-02. Prototype (`~/fleet/identities/fable-box-maintainer/workspace/prototype-preferences/index.html`) is the visual anchor. Adapt the `NAV_SECTIONS` array shape from `IdentityModal.tsx` L308-314 verbatim but render vertically. This is the only genuinely-new pattern in the phase. |

Every other file has a strong analog cited above.

---

## Metadata

**Analog search scope:**
- `src/ui/features/pretty-view/` (modals, panes, editors, pickers)
- `src/ui/features/pretty-conversations/` (sidebar panel)
- `src/ui/features/notifications/` (folded-in modal + push-support)
- `src/ui/api/` (frontend API wrappers)
- `src/ui/` (AppShell, main-axios)
- `src/backend/database/routes/` (user-preferences, users)
- `src/backend/database/db/` (schema, migration)

**Files read (targeted excerpts, no re-reads):**
- `src/ui/features/notifications/EnableNotificationsModal.tsx` (full — 244 lines)
- `src/ui/features/pretty-view/VoicePicker.tsx` (full — 127 lines)
- `src/ui/features/pretty-view/MarkdownEditor.tsx` (full — 101 lines)
- `src/ui/features/pretty-view/GlobalFilesModal.tsx` (full — 382 lines)
- `src/ui/features/pretty-view/GlobalFileTab.tsx` (full — 157 lines)
- `src/ui/features/pretty-view/IdentityModal.tsx` (L300-380, L1380-1410, L1550-1610 — targeted)
- `src/ui/features/pretty-view/PrettyView.tsx` (L4260-4290 — targeted)
- `src/ui/features/pretty-view/ChatMessage.tsx` (L65-95, L248-278 — targeted)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (L895-919, L3060-3130, L3244-3306, L3430-3450 — targeted)
- `src/ui/AppShell.tsx` (L355-370, L440-450, L520-540, L1375-1395, L1595-1625, L3245-3285 — targeted)
- `src/ui/main-axios.ts` (L115-140 — targeted)
- `src/ui/api/user-preferences-api.ts` (full — 82 lines)
- `src/ui/api/open-tabs-api.ts` (L88-112 — targeted)
- `src/ui/api/identities-api.ts` (L85-186 — targeted)
- `src/ui/api/global-files-api.ts` (full — 99 lines)
- `src/backend/database/routes/user-preferences.ts` (full — 551 lines)
- `src/backend/database/routes/users.ts` (L490-624, L1895-1950 — targeted)
- `src/backend/database/db/schema.ts` (L826-846 — targeted)
- `src/backend/database/db/index.ts` (L530-560, L779-870, L870-970, L1010-1180 — targeted)
- `src/ui/features/notifications/EnableNotificationsModal.test.tsx` (L1-120 — targeted for test scaffolding)

**Pattern extraction date:** 2026-09-27
