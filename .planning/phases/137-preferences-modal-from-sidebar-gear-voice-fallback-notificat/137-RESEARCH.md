# Phase 137: Preferences modal from sidebar gear — voice fallback, notifications, avatar, about-you - Research

**Researched:** 2026-09-27
**Domain:** React (Vite) UI + Radix Dialog + Drizzle SQLite backend, in-app preferences consolidation and MDXEditor reuse
**Confidence:** HIGH — every claim below is verified against the actual codebase files listed in `## Sources`; no library-doc lookup was necessary because every pattern already exists somewhere in the Skynet tree

## Summary

Phase 137 is a **consolidation phase**, not a greenfield one. Almost every subsystem it touches (avatar backend, user_preferences REST + SQLite, MDXEditor wrapper, VoicePicker, EnableNotificationsModal, GlobalFilesModal, `dropColumnIfExists` migration helper, `DatabaseSaveTrigger.forceSave` after DB writes, iOS PWA gesture-gate invariant) is already built and shipping. The phase composes them behind one new modal, adds one new frontend-only voice resolution site, extends `UserInfo` + `user_preferences` with two small slices (`avatarPath`, `fallbackVoice`), retires one dead column (`reopen_tabs_on_login`), and deletes three obsolete entry points (globe button, notifications kebab item, decorative gear placeholder).

The two genuinely load-bearing risks: (1) the iOS PWA gesture-gate invariant (D-19 / EnableNotificationsModal comment L84-87) — `Notification.requestPermission()` must fire synchronously in an `onClick`, no `await` boundary before it — must survive the fold-in, and (2) the sidebar footer avatar preview (D-30) requires **new plumbing** because the frontend currently does not consume `avatarPath` anywhere (verified — the field appears only in backend routes + `delete-user-data`, never in `src/ui/`).

The single largest planner decision is **phase split**: shell + General/Voice/Notifications may reasonably ship in one wave; About-you fold-in (MDXEditor embed inside a non-tab pane with host-picker + tab-strip fallbacks) is roughly the same again in complexity. CONTEXT.md leaves this to the planner.

**Primary recommendation:** Ship as **one phase in two waves**. Wave A: shell + General + Voice + Notifications + reopen-tabs cleanup + globe-button removal + kebab-item removal (all foundation + all deletions, no MDXEditor). Wave B: About-you fold-in with MDXEditor + host/file fallbacks. Both waves ship in Phase 137; no need for a Phase 138 split unless plan-checker surfaces graph edges suggesting otherwise. Modal state lives in `PrettyConversationsPanel.tsx` alongside the existing four modal open-state atoms (verified — least-invasive integration).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Preferences modal chrome + left-nav | Browser (React) | — | Pure client render, portal-mounted DialogPrimitive |
| Modal open/close state | Browser (React, `PrettyConversationsPanel` local `useState`) | — | Sibling atom to existing `globalFilesModalOpen`, `enableNotificationsModalOpen`, `skillsEditorModalOpen`, `newConversationModalOpen`, `searchModalOpen` |
| Avatar file selection + preview | Browser | — | `URL.createObjectURL(file)` for local preview; `<img>` for saved-avatar preview via authenticated GET |
| Avatar upload | Browser | Backend `PUT /users/:id/avatar` (Phase 85, exists) | Multipart FormData; backend already validates MIME, size, magic bytes, and forceSave-persists |
| Sidebar footer avatar live-sync | Browser (state atom in AppShell) | Backend `GET /users/me` (needs `avatarPath` field added) | AppShell owns `meUsername` state today; extend to `meAvatarPath`, refresh callback after successful upload |
| Fallback voice picker + autosave | Browser | Backend `PUT /user-preferences` (extend) | Autosave-on-change following `putPinnedIds` shape reference |
| Voice resolution in speak flow | Browser only (D-16) | — | `postSpeakStream(text, identityVoice ?? userPrefs.fallbackVoice ?? undefined)` at `PrettyView.tsx:4269` — backend voice route unchanged |
| Notifications enable button | Browser | Backend `POST /push-subscriptions` (exists) | Fold-in only — no backend or SW change; **synchronous permission-request invariant** carries |
| About-you editor | Browser (MDXEditor lazy) | Backend `GET/POST /global-files*` (exists) | Reuses `listGlobalFiles` + `readGlobalFile` + `writeGlobalFile` + mtime-optimistic-concurrency + 409 conflict UX verbatim from GlobalFilesModal |
| `fallbackVoice` column | Backend SQLite (`user_preferences`, extend) | Drizzle mirror in `schema.ts` | `addColumnIfNotExists("user_preferences", "fallback_voice", "TEXT")` in `migrateSchema()` per `ssh_data` precedent (index.ts L1873-1939) |
| `reopen_tabs_on_login` column drop | Backend SQLite | — | `runReopenTabsColumnDrop(sqliteDb)` following `runPinColumnDrop` / `runHiddenColumnDrop` verbatim shape (index.ts L937-960) |
| Reopen-tabs code deletion | Browser (AppShell) + Backend routes/types | — | Read site L1606 + seed L361-363 + `pickPreferences` L64 + PUT handler L152-159 + `UserPreferences` type L94-100 + `handleGetPreferences` payload |

## Standard Stack

### Core — all verified present in `/home/ubuntu/fleet/identities/fable-box-maintainer/workspace/skynet/package.json`

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | ^19.2.5 | UI runtime | Already the app's runtime — no new dep |
| radix-ui | ^1.4.3 | `Dialog.Root / .Portal / .Overlay / .Content` — modal chrome primitive | Every modal in Skynet uses this; IdentityModal / GlobalFilesModal / EnableNotificationsModal all import `Dialog as DialogPrimitive` |
| @mdxeditor/editor | ^4.2.5 | WYSIWYG markdown editor for About-you | Already wrapped by `MarkdownEditor.tsx` (lazy Suspense boundary); IdentityFileTab + RoleFileTab + GlobalFileTab consume it via the wrapper |
| lucide-react | ^1.28.0 | Icons — User, Volume2, Bell, Sparkles, Settings, X | Every icon in the prototype is already imported somewhere in the tree |
| drizzle-orm | ^0.45.2 | `user_preferences` schema mirror + typed selects | Already the ORM for `userPreferences` at `schema.ts:832` |
| better-sqlite3 | 12.9.0 | Underlying SQLite driver | Already the driver; supports SQLite 3.35+ ALTER TABLE DROP COLUMN (verified via existing `assertSqliteSupportsDropColumn` preflight) |
| axios | ^1.15.2 | REST client (`authApi`) | Already used by every `*-api.ts` file |
| multer | ^2.1.1 | Multipart body parser (avatar upload backend) | Already used by `userAvatarUpload` — frontend uses `FormData` per `identities-api.ts:88-93` pattern; no client-side dep |

### Supporting — patterns and helpers to reuse verbatim

| Helper | Location | Purpose | When to Use |
|--------|----------|---------|-------------|
| `DatabaseSaveTrigger.forceSave(<label>)` | `src/backend/database/db/index.ts` | Persist in-memory SQLite writes to disk | **MANDATORY** after every `db.insert/update/delete().run()` on `userPreferences` or `users.avatarPath`, wrapped in try/catch per `user-preferences.ts:446-459` reference |
| `dropColumnIfExists(sqliteDb, table, column)` | `db/index.ts:841-869` | Idempotent column drop (probes SELECT, DROP on hit, no-op on miss) | For D-32 reopen-tabs column drop; wrap in `runReopenTabsColumnDrop(sqliteDb)` per `runPinColumnDrop` / `runHiddenColumnDrop` shape |
| `assertSqliteSupportsDropColumn(sqliteDb)` | `db/index.ts:812-831` | Preflight SQLite ≥ 3.35 | Call once inside `runReopenTabsColumnDrop` before any drops (as `runIdentitiesCosmeticDrops` does) |
| `addColumnIfNotExists(table, column, definition)` | `db/index.ts:779-804` | Idempotent column add (probes SELECT, ALTER on miss) | For `fallback_voice` column add in `migrateSchema()` — pattern: `addColumnIfNotExists("user_preferences", "fallback_voice", "TEXT")` |
| `stampedFetch` / `authApi` | `src/lib/stamped-fetch.ts` / `src/ui/main-axios.ts` | Every REST call carries `X-Skynet-Client-Build` for version-drift lock | All new API helpers must use `authApi` (not raw `axios`/`fetch`) |
| `multipartOriginGuard` | `src/backend/utils/multipart-origin-guard.js` | CORS-simple content-type protection on multipart routes | Already applied to `PUT /users/:id/avatar` (users.ts:497) — no changes required for this phase |
| `pushNotificationsSupported()` | `src/ui/features/notifications/EnableNotificationsModal.tsx:49-56` | Feature-detect Web Push in the browser | Reuse verbatim for D-20 fallback branch in Notifications pane |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Left-nav (D-02) | Bottom icon-bar (IdentityModal/GlobalFilesModal pattern) | Bottom icon-bar is what every existing multi-section modal in Skynet uses — left-nav is **new to Skynet** and adds a novel layout pattern. Locked to left-nav by CONTEXT.md D-02; planner must copy the `NAV_SECTIONS` array shape from `IdentityModal.tsx:308-314` but render it vertically on the left rather than horizontally at the bottom. Prototype (`~/fleet/identities/fable-box-maintainer/workspace/prototype-preferences/index.html`) is the visual anchor. |
| Autosave on Voice pane change | Debounced autosave | Not needed — the picker is a `<select>` with 7 static options; the onChange fires once per selection. No debounce needed. Match `putPinnedIds` shape (single PUT per change, no debounce). |
| New `preferences-api.ts` file | Extend `open-tabs-api.ts` (where `getUserPreferences` / `saveUserPreferences` currently live) | The current file placement is an accident of history — `open-tabs-api.ts` is where the user-preferences GET/PUT wrappers live because they were siblings of open-tabs at introduction. Planner may either extend it (min-diff) or extract a new `user-preferences-api.ts` (cleaner) — CONTEXT.md doesn't lock this. Recommend extracting because `pinnedIds` slice already lives in `user-preferences-api.ts` and it's the natural home for a new `fallbackVoice` helper. |
| Persistent modal state (tab remembered across close) | Reset on close (D-05) | Locked by D-05: "Panes remember state within a session but reset on modal close." — implementation: `useState` inside the modal component (not `PrettyConversationsPanel`'s parent) so unmount clears. |

**Installation:** No new dependencies required. Every library needed is already in the tree.

**Version verification:** All package versions confirmed via `package.json` grep — no npm registry lookup needed because no new packages are being added.

## Package Legitimacy Audit

**Not applicable — this phase installs zero new packages.** Every dependency (React 19, Radix, MDXEditor, Drizzle, better-sqlite3, multer, axios, lucide-react) is already present in the tree. Skipping slopcheck / registry verification because there is nothing to check.

## Architecture Patterns

### System Architecture Diagram

```
                          ┌─────────────────────────────────────┐
                          │  PrettyConversationsPanel.tsx       │
                          │                                     │
                          │  (owns modal open state atoms)      │
                          │                                     │
                          │  sidebar-footer                     │
                          │  ├─ pv-footer-initials (<img|span>) │◄── avatarPath prop (from AppShell)
                          │  ├─ pv-footer-username              │
                          │  ├─ [Globe button — DELETED]        │
                          │  └─ Settings gear button (NEW)  ────┼──► setPreferencesModalOpen(true)
                          │                                     │
                          │  kebab menu                         │
                          │  ├─ New group conversation          │
                          │  ├─ Edit global skills…             │
                          │  └─ [Enable notifications — DEL]    │
                          └─────────┬───────────────────────────┘
                                    │
                                    │ preferencesModalOpen state atom
                                    ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  PreferencesModal.tsx (NEW)                                     │
   │  Dialog.Root → Portal → Overlay → Content                       │
   │  ┌──────────────┬─────────────────────────────────────────────┐ │
   │  │ Left nav     │ Content pane (per active section)           │ │
   │  │              │                                             │ │
   │  │ ● General ───┼─► GeneralPane                               │ │
   │  │   Voice      │   ├─ current-avatar <img> (from GET)        │ │
   │  │   Notif.     │   ├─ Choose image button (file input)       │ │
   │  │   About you  │   └─ Remove button                          │ │
   │  │              │        │                                    │ │
   │  │              │        ▼ FormData(avatar)                   │ │
   │  │              │        PUT /users/:id/avatar                │ │
   │  │              │        │                                    │ │
   │  │              │        ▼ success                            │ │
   │  │              │        onAvatarChanged(newPath) callback ───┼─► AppShell setMeAvatarPath
   │  │              │                                             │ │
   │  │              │─► VoicePane                                 │ │
   │  │              │   └─ VoicePicker (reuse) — onChange:        │ │
   │  │              │        PUT /user-preferences fallbackVoice  │ │
   │  │              │                                             │ │
   │  │              │─► NotificationsPane                         │ │
   │  │              │   ├─ pushNotificationsSupported() gate      │ │
   │  │              │   ├─ Explainer paragraph                    │ │
   │  │              │   └─ Enable button                          │ │
   │  │              │        └─► onClick — SYNCHRONOUS —          │ │
   │  │              │            Notification.requestPermission() │ │
   │  │              │            .then → subscribe → POST /push-… │ │
   │  │              │                                             │ │
   │  │              │─► AboutYouPane                              │ │
   │  │              │   ├─ [host picker if hosts > 1]             │ │
   │  │              │   ├─ [tab strip if files > 1]               │ │
   │  │              │   └─ MarkdownEditor (lazy MDXEditor)        │ │
   │  │              │        │  ↕ content, mtime state            │ │
   │  │              │        │                                    │ │
   │  │              │        ▼ Save button — explicit             │ │
   │  │              │        PUT /global-files/write (mtime opt.) │ │
   │  │              │        (409 → confirm reload UX verbatim)   │ │
   │  └──────────────┴─────────────────────────────────────────────┘ │
   └─────────────────────────────────────────────────────────────────┘

              [PrettyView.tsx voice resolution site — D-16]
              postSpeakStream(text,
                identityVoice ?? userPrefs.fallbackVoice ?? undefined)
              ▲
              │ userPrefs from AppShell → threaded to PrettyView
```

### Component Responsibilities

| Component | File | Responsibility |
|-----------|------|----------------|
| PreferencesModal | `src/ui/features/pretty-view/PreferencesModal.tsx` (NEW) | Dialog chrome, left-nav rendering, active-section state, panel dispatch |
| GeneralPane | inline in PreferencesModal or `PreferencesModalGeneralPane.tsx` (NEW) | Avatar UI, local preview, upload trigger |
| VoicePane | inline in PreferencesModal or `PreferencesModalVoicePane.tsx` (NEW) | VoicePicker mount, autosave-on-change wire |
| NotificationsPane | inline in PreferencesModal or `PreferencesModalNotificationsPane.tsx` (NEW) | pushNotificationsSupported gate; **preserves synchronous permission-request invariant** (D-19) |
| AboutYouPane | inline in PreferencesModal or `PreferencesModalAboutYouPane.tsx` (NEW) | Host picker (if 2+), file tab-strip (if 2+), MarkdownEditor mount, mtime-optimistic save + 409 UX |
| MarkdownEditor | `src/ui/features/pretty-view/MarkdownEditor.tsx` (EXISTS — no change) | MDXEditor lazy wrapper; `.md` gate; verbatim raw textarea fallback |
| VoicePicker | `src/ui/features/pretty-view/pickers/VoicePicker.tsx` (EXISTS — no change) | Voice dropdown + sample-play button |
| PrettyConversationsPanel | `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | Footer button wiring; kebab item removal; initials-circle → `<img>` conditional |
| AppShell | `src/ui/AppShell.tsx` | `meAvatarPath` state atom (NEW, sibling of `meUsername`); `userPrefs.fallbackVoice` thread to PrettyView; delete `reopenTabsOnLogin` read + seed |
| user-preferences.ts (backend) | `src/backend/database/routes/user-preferences.ts` | Add `fallbackVoice` to `pickPreferences` + `handlePutPreferences`; delete `reopenTabsOnLogin` field |
| open-tabs-api.ts OR user-preferences-api.ts | `src/ui/api/*.ts` | Add `fallbackVoice` to `UserPreferences` type + wrapper for autosave |
| users.ts `/users/me` (backend) | `src/backend/database/routes/users.ts:1909` | Add `avatarPath: user[0].avatarPath ?? null` to response |
| main-axios.ts | `src/ui/main-axios.ts:117` | Extend `UserInfo` interface with `avatarPath?: string \| null` |
| schema.ts | `src/backend/database/db/schema.ts:832` | Add `fallbackVoice: text("fallback_voice")` col; delete `reopenTabsOnLogin` col |
| index.ts (schema) | `src/backend/database/db/index.ts` | Add `addColumnIfNotExists("user_preferences", "fallback_voice", "TEXT")` in `migrateSchema()`; add `runReopenTabsColumnDrop(sqliteDb)` following existing helper shape and call from `migrateSchema()` |

### Recommended Project Structure

Files that will be **created**:

```
src/ui/features/pretty-view/
├── PreferencesModal.tsx                       # NEW — modal chrome + left-nav + section dispatch
├── PreferencesModal.test.tsx                  # NEW — open/close/nav-switch smoke coverage
├── PreferencesModalGeneralPane.tsx            # NEW — OR inline in PreferencesModal
├── PreferencesModalVoicePane.tsx              # NEW — OR inline
├── PreferencesModalNotificationsPane.tsx      # NEW — OR inline
└── PreferencesModalAboutYouPane.tsx           # NEW — OR inline
```

Files that will be **modified**:

```
src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx
  - Replace inert <span> gear (L3113-3124) with real <button>
  - Remove Globe <button> (L3103-3112) — data-testid="pv-footer-global-files-button"
  - Remove "Enable notifications…" kebab item (L3437-3440)
  - Remove enableNotificationsModalOpen state + <EnableNotificationsModal> mount (L914, L3301-3303)
  - Change pv-footer-initials rendering to conditional <img>/<span> based on avatarPath prop
  - Add preferencesModalOpen state atom (sibling of globalFilesModalOpen)
  - Add avatarPath prop threaded from AppShell

src/ui/AppShell.tsx
  - Add meAvatarPath state atom (sibling of meUsername, L446)
  - Populate meAvatarPath from getUserInfo() response (L529-537)
  - Thread meAvatarPath into <PrettyConversationsPanel> props (L3250-3282)
  - Thread userPrefs.fallbackVoice into wherever PrettyView is mounted so it flows to ChatMessage
  - Delete reopenTabsOnLogin from UserPreferences seed (L361-363)
  - Delete reopenTabsOnLogin from getUserPreferences → setUserPrefs branch (L1377-1393) — leave setUserPrefs for other prefs
  - Delete reopenTabsOnLogin read at L1606 + surrounding restore-tabs conditional restructure

src/ui/features/pretty-view/PrettyView.tsx
  - L4269: postSpeakStream chain — add userPrefs.fallbackVoice into the ?? chain; caller must expose it (thread from AppShell)

src/ui/features/pretty-view/GlobalFilesModal.tsx (POSSIBLY DELETE)
  - Consider retiring after About-you fold-in complete. Verify no other callers.

src/ui/features/notifications/EnableNotificationsModal.tsx (POSSIBLY DELETE)
  - Delete component after fold-in verified. pushNotificationsSupported() export must survive
    (still consumed by PrettyConversationsPanel kebab-support gate before its item is removed;
    also consumed by the new NotificationsPane for D-20 fallback). Move the export to a new
    thin util file OR keep the modal component skeleton around as export-only.
  - RECOMMENDED: keep pushNotificationsSupported exported from a new file
    (`src/ui/features/notifications/push-support.ts`) and delete EnableNotificationsModal.tsx entirely.

src/ui/api/open-tabs-api.ts (OR src/ui/api/user-preferences-api.ts)
  - Add fallbackVoice?: string | null to UserPreferences interface
  - Delete reopenTabsOnLogin: boolean from UserPreferences interface
  - Add updateFallbackVoice(voice: string | null) helper (or ensure saveUserPreferences supports it)

src/ui/main-axios.ts
  - UserInfo interface (L117-135): add avatarPath?: string | null

src/backend/database/db/schema.ts
  - userPreferences (L832): add fallbackVoice: text("fallback_voice"); delete reopenTabsOnLogin

src/backend/database/db/index.ts
  - CREATE TABLE for user_preferences (L540-549): remove reopen_tabs_on_login line (only affects fresh installs; migration handles upgrades); optionally add fallback_voice TEXT column here
  - migrateSchema() (~L1007): add addColumnIfNotExists("user_preferences", "fallback_voice", "TEXT")
  - Add runReopenTabsColumnDrop(sqliteDb) helper (mirror runPinColumnDrop/runHiddenColumnDrop shape at L937-960)
  - migrateSchema(): call runReopenTabsColumnDrop(sqliteDb)

src/backend/database/routes/user-preferences.ts
  - pickPreferences (L63-75): add fallbackVoice: row?.fallbackVoice ?? null; DELETE reopenTabsOnLogin
  - handlePutPreferences (L125-490): destructure fallbackVoice from body; validate as string | null; add to updates map; DELETE reopenTabsOnLogin destructure + validation + assign
  - OpenAPI docs (L493-544): update

src/backend/database/routes/users.ts
  - /users/me response (L1928-1944): add avatarPath: user[0].avatarPath ?? null
```

### Pattern 1: Modal chrome (verbatim from existing modals)

**What:** DialogPrimitive + Portal + Overlay (z-110) + Content (z-120), radial-gradient background, glass X close button.
**When to use:** For the PreferencesModal shell.
**Source:** Copy verbatim from `EnableNotificationsModal.tsx:134-190` (smallest modal, cleanest chrome-only example) OR `GlobalFilesModal.tsx:191-277` (with host-picker in header — closer to what About-you needs).

```tsx
// Source: src/ui/features/notifications/EnableNotificationsModal.tsx:134-190
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
        // Size: 760x600 per D-03 — differs from EnableNotifs' 480x360
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
      {/* Body: left-nav + content pane */}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
</DialogPrimitive.Root>
```

### Pattern 2: Left-nav vs bottom icon-bar

**What:** The existing IdentityModal/GlobalFilesModal pattern is a **bottom** icon-bar (`IdentityModal.tsx:1563-1604`). CONTEXT.md D-02 locks the Preferences modal to a **left-nav** layout. There is no existing left-nav modal in Skynet — this is a new layout pattern.

**When to use:** Only for this modal (the prototype `~/fleet/identities/fable-box-maintainer/workspace/prototype-preferences/index.html` is the visual anchor). Do NOT retrofit other modals — CONTEXT.md § Deferred lists that as an out-of-scope refactor.

**Adapt the NAV_SECTIONS array shape from IdentityModal**:

```tsx
// Adapted from src/ui/features/pretty-view/IdentityModal.tsx:308-314
const NAV_SECTIONS = [
  { value: "general", label: "General", Icon: User },
  { value: "voice", label: "Voice", Icon: Volume2 },
  { value: "notifications", label: "Notifications", Icon: Bell },
  { value: "about-you", label: "About you", Icon: Sparkles },
] as const;
const [activeSection, setActiveSection] = useState<typeof NAV_SECTIONS[number]["value"]>("general");
```

Render vertically on the left (≈180px wide per D-02) instead of horizontally at the bottom. The prototype uses lucide-react icons User/Volume2/Bell/Sparkles — CONTEXT.md § Claude's Discretion says planner may swap; recommend keeping.

### Pattern 3: Autosave-on-change (Voice pane)

**What:** Fire PUT immediately on onChange, no debounce, no save button.
**When to use:** Voice pane picker.
**Source pattern:** `putPinnedIds` in `user-preferences-api.ts:44-78` (single PUT per action, no debounce, server-echoed value drives eventual consistency).

```tsx
// Voice pane pseudocode
const [fallbackVoice, setFallbackVoice] = useState<string>(userPrefs.fallbackVoice ?? "");
<VoicePicker
  value={fallbackVoice}
  onChange={async (next) => {
    setFallbackVoice(next);  // optimistic local update
    try {
      await saveUserPreferences({ fallbackVoice: next || null });
    } catch (err) {
      // revert on failure — pattern reference: identities-store hidden-toggle handler
      setFallbackVoice(userPrefs.fallbackVoice ?? "");
      // TODO error UX
    }
  }}
/>
```

### Pattern 4: Explicit save + mtime-optimistic-concurrency (About-you pane)

**What:** Textarea/editor holds a draft; explicit Save button submits with expected mtime; 409 conflict handled with confirm+reload UX.
**When to use:** About-you pane (per D-25, D-26).
**Source:** `GlobalFileTab.tsx:88-99` for save handler shape; `GlobalFilesModal.tsx:157-189` for 409 handler shape.

Fold in **verbatim**. Do NOT rebuild the save flow — extract the interior of `GlobalFilesModal` (state atoms + effects + handleSave) into a shared hook OR inline the same logic in AboutYouPane. Recommend a lightweight refactor: extract `useGlobalFilesEditor(hostId, defaultHostId)` returning `{ files, activeTab, setActiveTab, tabData, handleSave, ... }` so both `GlobalFilesModal` (if kept) and `AboutYouPane` consume the same hook.

**Simpler alternative for planner:** if `GlobalFilesModal` is being retired anyway (D-29 removes the globe button — the only entry point), move all its interior code into `AboutYouPane` directly. Then delete `GlobalFilesModal.tsx`. Fewer files, less abstraction. CONTEXT.md doesn't lock this — planner picks.

### Pattern 5: Avatar upload multipart

**What:** `FormData` with `avatar` field; PUT to `/users/:id/avatar`; response has `{ id, avatarPath }`.
**When to use:** General pane upload button.
**Source pattern:** `identities-api.ts:88-93` (buildFormData) + `identities-api.ts:161-186` (updateIdentity with FormData PUT).

```tsx
// Avatar upload helper
async function uploadUserAvatar(userId: string, file: File): Promise<{ avatarPath: string }> {
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

**Local preview (before upload):**

```tsx
// URL.createObjectURL for local preview; cleanup on unmount + on new selection
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

### Pattern 6: Feature-gated Notifications pane (D-20)

**What:** `pushNotificationsSupported()` returns false → render "Push notifications aren't supported in this browser" message instead of the button.
**When to use:** Notifications pane render branch.
**Source:** `EnableNotificationsModal.tsx:49-56` for the detection function; existing kebab-menu gate at `PrettyConversationsPanel.tsx:3438` is the branch pattern.

### Pattern 7: **LOAD-BEARING** synchronous permission-request invariant (D-19)

**What:** `Notification.requestPermission()` MUST fire synchronously inside the button's `onClick` — no `await` boundary before it.
**Why it matters:** iOS PWAs silently block permission requests that don't sit directly inside a user gesture. This is documented at `EnableNotificationsModal.tsx:11-16` (component-level comment) and `L84-87` (inline comment above the call site).
**Verbatim from `EnableNotificationsModal.tsx:88-115`:**

```tsx
const onClick = useCallback(() => {
  if (typeof Notification === "undefined") {
    setStatus("failed");
    return;
  }
  setStatus("requesting");
  const permPromise = Notification.requestPermission();  // ← FIRST async op in handler; NO await before this line
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

**When you fold this into NotificationsPane, do NOT:**
- Convert to `async onClick` with `await Notification.requestPermission()` — this introduces a microtask boundary that iOS may reject.
- Add `await` between the click and the call (e.g. `await sw ready` first, then `await requestPermission`).
- Wrap in an outer React state check that awaits something before firing.

**Test regression gate:** `EnableNotificationsModal.test.tsx` case 4 is a "LOAD-BEARING (Pitfall 4)" test that asserts `Notification.requestPermission()` is called synchronously in the same task-tick as the click. **Port this test** to whatever component holds the button after fold-in.

### Pattern 8: Sidebar footer avatar live-sync (D-30)

**What:** After successful avatar upload, the sidebar footer must reflect the new avatar without a page reload.

**Current state (verified):** `pv-footer-initials` at `PrettyConversationsPanel.tsx:3086-3091` renders a `<span>` with the first initial. No `<img>` code path exists today. `avatarPath` is not consumed anywhere in `src/ui/*` (verified via grep).

**Least-invasive plumbing:**

1. **AppShell** — add `meAvatarPath` state atom (sibling of `meUsername` at L446). Populate from `getUserInfo()` response (L529-537) — REQUIRES `/users/me` backend endpoint to include `avatarPath` field (currently omits it — see users.ts:1928-1944).
2. **AppShell** — expose a `onAvatarChanged(path: string | null)` setter that PreferencesModal calls after successful upload. Or lift avatar upload state to AppShell.
3. **PrettyConversationsPanel** — accept `avatarPath?: string | null` prop; conditional render at L3085-3091:

```tsx
{avatarPath ? (
  <img
    className="pv-footer-initials"  // reuse existing circle styling
    src={`/users/${encodeURIComponent(userId)}/avatar`}  // authenticated GET
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

**Cache-busting:** The GET route (`users.ts:633`) emits an ETag per response (MD5 of bytes), but the URL is the same across avatar changes. After a successful upload, the `<img>` will not necessarily refetch because the URL hasn't changed. Two options:
- **Option A (simple):** Append a cache-buster query param `?v=${lastAvatarChangeTimestamp}` — increment on upload.
- **Option B (correct):** Use the returned `avatarPath` filename as the URL query (`?f=${avatarPath}`) — filename changes on upload because `writeUserAvatar` mints a new random name.

Recommend Option B — the backend already generates a new random filename per upload (verified by reading `user-avatar-storage.ts` mime→ext logic + `PUT /users/:id/avatar` L559-563 which stores the new name atomically). So `?f=${avatarPath}` naturally busts cache without additional plumbing.

**Alternative:** Use the returned filename directly as the URL — but the GET route is keyed on user ID (`/users/:id/avatar`), not filename. Keep the ID URL and append filename as cache-buster.

### Anti-Patterns to Avoid

- **Do NOT** put modal state in a global Zustand store — every other modal in `PrettyConversationsPanel` uses local `useState`; adding a store atom for one modal is inconsistent and heavier than needed.
- **Do NOT** debounce the fallback-voice PUT — the picker is a `<select>` with 7 options; each change fires once. Debounce adds latency to a save that already blocks nothing.
- **Do NOT** call `Notification.requestPermission()` inside `useEffect` on modal open — this is exactly the gesture-gate violation the D-19 invariant guards against.
- **Do NOT** wrap avatar upload in a state store — use component-local state + callback prop; matches identity avatar upload pattern.
- **Do NOT** re-implement mtime-optimistic-concurrency in AboutYouPane — extract or reuse the flow from GlobalFilesModal/GlobalFileTab verbatim.
- **Do NOT** delete the CREATE TABLE `reopen_tabs_on_login` line at `index.ts:542` for fresh installs UNLESS you also add the drop-column migration — otherwise fresh installs will still have the dead column. Actually recommend: remove the line from CREATE TABLE AND add the drop migration; both are idempotent.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Modal chrome (portal, overlay, escape, backdrop-click) | Custom modal wrapper | Radix DialogPrimitive with the verbatim chrome recipe from `EnableNotificationsModal.tsx` | Every existing Skynet modal uses this; the radial-gradient + glass close button + z-110/z-120 ladder is the app's modal contract |
| Markdown editor for About-you | Raw textarea or a fresh MDXEditor mount | `src/ui/features/pretty-view/MarkdownEditor.tsx` (lazy Suspense boundary, filetype gate, byte-tuned raw-textarea fallback) | D-24 locks reuse; the wrapper handles the ~1.5MB lazy chunk correctly and the styling has 8+ callers |
| Voice picker | Custom `<select>` with the 7 voice IDs | `src/ui/features/pretty-view/pickers/VoicePicker.tsx` verbatim | D-15 locks reuse; already handles sample-play with proper Audio unmount cleanup |
| Multipart avatar upload backend | Custom multer setup | `userAvatarUpload` in `user-avatar-storage.ts` already provides memoryStorage + 5MB cap + mime whitelist (png/jpeg/webp) + magic-byte sniffing | Backend was fully shipped in Phase 85; nothing new needed |
| Push subscription flow | Custom SW registration + subscribe | `EnableNotificationsModal.tsx` onClick handler verbatim (or ported into NotificationsPane) | Includes VAPID key fetch, urlBase64ToUint8Array, POST /push-subscriptions, error handling, and the load-bearing synchronous gesture invariant |
| SQLite column add | Manual `ALTER TABLE ADD COLUMN` | `addColumnIfNotExists(table, column, definition)` in `db/index.ts:779-804` | Idempotent (probes SELECT before ALTER), silent on missing table, logs warn on failure |
| SQLite column drop | Manual `ALTER TABLE DROP COLUMN` | `dropColumnIfExists(sqliteDb, table, column)` + `assertSqliteSupportsDropColumn(sqliteDb)` preflight | Requires SQLite ≥ 3.35 (present per Phase 66 preflight); non-fatal on failure; **already the tested pattern** used by `runPinColumnDrop` / `runHiddenColumnDrop` / `runIdentitiesCosmeticDrops` |
| DB write persistence | Fire-and-forget `db.update()...run()` | Always follow with `await DatabaseSaveTrigger.forceSave("<labeled-reason>")` in try/catch | Skynet's in-memory-decrypted SQLite means raw writes reach RAM only; the 5-min isDirty poller does not observe direct writes. This is a **crown-jewel invariant** per role-file directives and CONTEXT.md § Code Context |
| Feature-detection for Web Push | Inline typeof checks | `pushNotificationsSupported()` export from `EnableNotificationsModal.tsx:49-56` | Already used at 2 sites; **must survive** the fold-in — either re-export from a new util file or keep the old file as export-only |
| mtime-optimistic-concurrency save with 409 conflict UX | Custom retry logic | Verbatim from `GlobalFilesModal.tsx:157-189` handleSave — window.confirm + reload-on-yes + rethrow-on-no | D-26 locks preservation of this flow; tested in production |
| Local file preview | Base64 data URL | `URL.createObjectURL(file)` with cleanup on unmount + on new selection | Simpler, no memory bloat; VoicePicker.tsx uses the same pattern for audio blobs |

**Key insight:** This phase is 90% composition of existing verified patterns. The two genuinely new pieces of code are (1) the left-nav layout inside a modal (adapted from IdentityModal's bottom-nav array shape) and (2) the avatar `<img>` render path inside the sidebar footer (which requires new plumbing because no consumer of `avatarPath` exists in the frontend today).

## Runtime State Inventory

This phase involves **column drop** (`reopen_tabs_on_login`) and **rebrand** ("Global files" → "About you"). Runtime state audit:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | `user_preferences.reopen_tabs_on_login` column with existing rows | Column drop via `runReopenTabsColumnDrop(sqliteDb)` — data destruction is the intent (dead column). No data migration needed — the field's semantic (auto-reopen tabs) is no longer supported at all. |
| **Stored data** | No live storage of `fallbackVoice` yet — column is new | Add column via `addColumnIfNotExists`; existing rows default to NULL (which frontend/backend both treat as "use `DEFAULT_VOICE = 'Joanna'` fallback"). No data migration. |
| **Live service config** | None — no external services own state related to this phase | None |
| **OS-registered state** | None | None |
| **Secrets/env vars** | None | None |
| **Build artifacts / installed packages** | None — no packages added or renamed | None |
| **Rebrand: "Global files" → "About you"** | UI-only reframe per D-22, D-23. Backend routes (`/global-files*`), config file (`global-files.json`), schema type (`GlobalFileEntry`), and the `IMPLICIT_GLOBAL_FILE` constant all keep their names. | **Nothing to migrate** — the rename is strictly UI-facing labels (nav item label, pane blurb). The `IMPLICIT_GLOBAL_FILE.label = "User CLAUDE.md"` may be reframed to "About you" at the UI display level, or left as-is (the label is displayed in the file tab strip when there are 2+ files). CONTEXT.md doesn't lock this. Recommend: leave the backend label unchanged; the first tab in the multi-file case is rendered with a UI-side friendly label "About you" per D-28 ("First tab is 'About you'"). |
| **Dead code identification** | AppShell reopenTabsOnLogin references (L361-363 seed, L1606 read, L1564-1573 restore block); `open-tabs-api.ts:94-100` UserPreferences.reopenTabsOnLogin type field; `user-preferences.ts` GET response (L64) + PUT validation (L131, L152-159, L529) | Delete all references. Verified via grep: 6 files reference `reopenTabsOnLogin`; all must be scrubbed. Test file `user-preferences.test.ts` also references it (per grep) — delete related test cases OR update to assert the field is absent from the GET response. |
| **Localstorage / sessionstorage** | Not directly relevant — `reopenTabsOnLogin` was DB-only. No corresponding localStorage key to clean up. | None |

**Grep-verified reopenTabsOnLogin references** (6 files):
- `src/ui/AppShell.tsx` — L362, L1606 (usage in restore-tabs branch)
- `src/ui/lib/tab-url.ts` — check what uses it
- `src/backend/database/routes/user-preferences.test.ts` — test cases
- `src/backend/database/routes/user-preferences.ts` — L64, L131, L152-159
- `src/backend/database/db/schema.ts` — L836-838
- `src/ui/api/open-tabs-api.ts` — L95

Planner should include a **task-level grep gate**: after all deletions, `grep -r "reopenTabsOnLogin\|reopen_tabs_on_login" src/` returns zero (aside from a possible narrative comment breadcrumb in the migration file).

## Common Pitfalls

### Pitfall 1: iOS PWA gesture-gate violation (D-19)

**What goes wrong:** Notification permission prompt never appears on iOS PWA, or appears once and never again after the initial silent block.
**Why it happens:** iOS requires the `Notification.requestPermission()` call to sit directly inside a user-gesture handler with no microtask boundary before it. Any `await` before the call violates this.
**How to avoid:** Copy the onClick handler shape from `EnableNotificationsModal.tsx:88-115` verbatim. Do NOT rewrite as async/await. Do NOT precede the requestPermission call with `await navigator.serviceWorker.ready` or `await getVapidPublicKey()` — those go inside the `.then` chain.
**Warning signs:** iOS PWA users report "the enable button does nothing" or the prompt appears once then never again. Also: any code review comment suggesting "modernize this to async/await" is an alarm.
**Regression gate:** Port test case 4 from `EnableNotificationsModal.test.tsx` (the "LOAD-BEARING (Pitfall 4)" test that asserts synchronous invocation) to whatever component owns the button after fold-in.

### Pitfall 2: Sidebar footer avatar not refreshing after upload

**What goes wrong:** User uploads new avatar, upload succeeds, but the sidebar footer still shows the initial letter (or old avatar) until the user refreshes the page.
**Why it happens:** AppShell owns `meUsername` state today; if `meAvatarPath` isn't a sibling atom that gets updated after upload, the footer prop stays stale. Additionally, if the `<img>` URL doesn't change on upload (same `/users/:id/avatar` URL), the browser cache serves the old image.
**How to avoid:**
1. Add `meAvatarPath` state atom in AppShell (sibling of `meUsername` at L446).
2. Populate from `getUserInfo()` on mount (REQUIRES backend `/users/me` to expose `avatarPath`).
3. Provide a `refreshMeAvatar(newPath)` callback to PreferencesModal — call it on successful upload with the response's `avatarPath` field.
4. Thread `meAvatarPath` as a prop into `<PrettyConversationsPanel>`.
5. Use `?f=${avatarPath}` cache-buster in the `<img>` src.

Alternative (simpler but heavier): re-invoke `getUserInfo()` after upload — same effect, one extra roundtrip.

**Warning signs:** D-30 test case ("sidebar avatar reflects newly-uploaded image without page refresh") fails.

### Pitfall 3: Column drop breaks existing users on downgrade

**What goes wrong:** User upgrades to Phase 137, `reopen_tabs_on_login` column dropped. If they then downgrade to a pre-137 build, backend PUT/GET on user_preferences will crash because Drizzle expects the column.
**Why it happens:** Downgrade path isn't tested; drop is one-way.
**How to avoid:** This is Skynet policy — the existing `runPinColumnDrop` and `runHiddenColumnDrop` both do the same thing and downgrade tolerance is not a project constraint (verified — no downgrade test infrastructure exists). Ship the drop; document in commit message that this is one-way.
**Warning signs:** None — this is accepted policy per prior column drops.

### Pitfall 4: MDXEditor embedded in non-tab context has sizing issues

**What goes wrong:** MDXEditor renders inside AboutYouPane but with 0 height, or overflows the pane, because the parent isn't a flex column with `min-h-0`.
**Why it happens:** MDXEditor uses `h-full` internally; requires an explicit flex column ancestor with `min-h-0` for the height cascade to work. GlobalFileTab already uses `flex flex-col h-full gap-2` + `flex-1 min-h-0` on the editor's immediate parent (see L131-151).
**How to avoid:** Copy the wrapping div structure from `GlobalFileTab.tsx:130-151` verbatim. The AboutYouPane should have `flex flex-col h-full` and the MarkdownEditor should be wrapped in `flex-1 min-h-0`.
**Warning signs:** Editor appears as a thin strip or overflows the modal.

### Pitfall 5: Autosave race — user changes picker fast, second PUT overtakes first

**What goes wrong:** User clicks Voice A → clicks Voice B before A's PUT resolves. PUT-A response arrives after PUT-B response; stale value overwrites disk state.
**Why it happens:** No sequence tracking; `saveUserPreferences({ fallbackVoice: A })` and `saveUserPreferences({ fallbackVoice: B })` race.
**How to avoid:** For a `<select>` this is extraordinarily rare (user would need to click faster than network latency), so simplest fix is: don't guard. Second-best: track a request sequence number and ignore stale responses. Recommend: don't guard for v1; document as known-acceptable.
**Warning signs:** Only manifests under intentional stress-clicking; not observable in normal use.

### Pitfall 6: Voice fallback resolution site inconsistency

**What goes wrong:** User sets fallback voice to "Ruth". Agent with no bound voice speaks — but frontend still uses backend default "Joanna" because the wire-up at `PrettyView.tsx:4269` wasn't updated.
**Why it happens:** D-16 is a frontend-only wire change — it looks trivial but requires plumbing `userPrefs.fallbackVoice` from AppShell through PrettyView props to ChatMessage props.
**How to avoid:** Include a plan task specifically for the plumb: AppShell → wherever PrettyView is instantiated → PrettyView's `identityVoice` line at L4269. Verify with a test: mock `userPrefs.fallbackVoice = "Ruth"`, `pvIdentity.voice = null`, assert `postSpeakStream` called with `"Ruth"`.
**Warning signs:** Manual test — set fallback in preferences, speak an unbound-voice message, listen for the voice change. `ChatMessage.tsx:204` also logs `voice="${identityVoice ?? "default"}"` — will show `default` if the plumb is missing.

### Pitfall 7: Kebab menu breakage when notifications item is removed

**What goes wrong:** Removing the `notificationsSupported` conditional entry from the kebab-menu spread at `PrettyConversationsPanel.tsx:3437-3440` also strips the `pushNotificationsSupported` import if the file has no other use — but the new NotificationsPane still needs it for the D-20 fallback branch.
**Why it happens:** Aggressive lint/knip removal after the kebab-item deletion.
**How to avoid:** The pushNotificationsSupported function will live somewhere (either kept in `EnableNotificationsModal.tsx` if that file survives as export-only, or moved to `src/ui/features/notifications/push-support.ts`). Ensure the NotificationsPane imports from the new location and PrettyConversationsPanel stops importing it (since kebab-item is gone).

### Pitfall 8: About-you host picker doesn't remember selection across modal close

**What goes wrong:** User in multi-host case selects host B in About-you pane. Closes modal. Reopens — sees host A again (default).
**Why it happens:** D-05 locks pane state to reset on modal close. This is the intended behavior.
**How to avoid:** N/A — this is the spec. Document in the pane blurb OR the host-picker tooltip so it's not surprising.
**Warning signs:** User complaint. If it becomes a real problem post-ship, revisit D-05 as follow-up.

### Pitfall 9: Fresh install vs. upgrade in CREATE TABLE

**What goes wrong:** Removing `reopen_tabs_on_login INTEGER NOT NULL DEFAULT 0` from the CREATE TABLE at `index.ts:542` breaks fresh installs — because the migration's `dropColumnIfExists` is a no-op on a column that never existed, and NOW production users lose the column on fresh install but retain it on upgrade.
**Why it happens:** Two entry points for schema evolution: CREATE TABLE (fresh installs) and migrateSchema (upgrades). Must be updated consistently.
**How to avoid:** For column deletion: update BOTH CREATE TABLE (remove the column line) AND add the migration drop. This matches how `pinned_conversation_ids` and `hidden_conversation_ids` were dropped historically. Grep for existing CREATE TABLE column drops as reference.
**Warning signs:** `index.migration.test.ts` should have a "fresh install has no reopen_tabs_on_login column" test case.

## Code Examples

### Adding fallbackVoice column (Drizzle schema + migration)

```typescript
// Source pattern: src/backend/database/db/schema.ts:832 (userPreferences existing) + Phase 92 fallbackVoice-style additions
export const userPreferences = sqliteTable("user_preferences", {
  userId: text("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  // reopenTabsOnLogin: DELETED per Phase 137 D-31
  theme: text("theme"),
  fontSize: text("font_size"),
  accentColor: text("accent_color"),
  language: text("language"),
  fallbackVoice: text("fallback_voice"),  // NEW per Phase 137 D-14 — nullable, null → DEFAULT_VOICE
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Source pattern: src/backend/database/db/index.ts:779-804 (addColumnIfNotExists) + L1873-1939 (usage examples)
// Inside migrateSchema():
addColumnIfNotExists("user_preferences", "fallback_voice", "TEXT");

// Source pattern: src/backend/database/db/index.ts:937-940 (runPinColumnDrop shape)
export function runReopenTabsColumnDrop(sqliteDb: Database.Database): void {
  assertSqliteSupportsDropColumn(sqliteDb);
  dropColumnIfExists(sqliteDb, "user_preferences", "reopen_tabs_on_login");
}

// Inside migrateSchema() call:
runReopenTabsColumnDrop(sqlite);
```

### Backend GET/PUT handler updates

```typescript
// Source: src/backend/database/routes/user-preferences.ts:63-75 (pickPreferences)
const pickPreferences = (row?: typeof userPreferences.$inferSelect) => ({
  // reopenTabsOnLogin: DELETED
  theme: row?.theme ?? null,
  fontSize: row?.fontSize ?? null,
  accentColor: row?.accentColor ?? null,
  language: row?.language ?? null,
  fallbackVoice: row?.fallbackVoice ?? null,  // NEW
});

// Source: src/backend/database/routes/user-preferences.ts:125-176 (handlePutPreferences destructure + validation)
const {
  // reopenTabsOnLogin: DELETED from destructure + validation block
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

// Validation loop — add fallbackVoice to the string-check group:
for (const [key, value] of Object.entries({
  theme, fontSize, accentColor, language, fallbackVoice,  // NEW
})) {
  if (value !== undefined && value !== null && typeof value !== "string") {
    return res.status(400).json({ error: `${key} must be a string` });
  }
}
if (fallbackVoice !== undefined) updates.fallbackVoice = fallbackVoice;

// (Existing DatabaseSaveTrigger.forceSave block at L446-459 handles persistence — no change)
```

### Voice resolution wire-up (D-16)

```typescript
// Source: src/ui/features/pretty-view/PrettyView.tsx:4269
// BEFORE:
identityVoice={pvIdentity?.voice ?? null}
// AFTER (voice resolves frontend-side, no backend change):
identityVoice={pvIdentity?.voice ?? userPrefs.fallbackVoice ?? null}
// (userPrefs prop threaded from AppShell)
```

### /users/me response extension

```typescript
// Source: src/backend/database/routes/users.ts:1928-1944
res.json({
  userId: user[0].id,
  username: user[0].username,
  is_admin: !!user[0].isAdmin,
  is_oidc: !!user[0].isOidc,
  is_dual_auth: isDualAuth,
  totp_enabled: !!user[0].totpEnabled,
  data_unlocked: authManager.isUserUnlocked(userId),
  mxid: user[0].mxid ?? null,
  avatarPath: user[0].avatarPath ?? null,  // NEW per Phase 137 (feeds sidebar footer avatar preview)
});
```

### Sidebar footer conditional avatar render

```tsx
// Source: src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx:3083-3099
// BEFORE:
<span className="pv-footer-initials" aria-hidden="true" data-testid="pv-footer-initials">{initial}</span>

// AFTER:
{avatarPath ? (
  <img
    className="pv-footer-initials"  // reuse same circle styling class
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

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Notifications enable button as its own modal (opened from kebab menu) | Notifications pane inside PreferencesModal | Phase 137 (this phase) | Consolidation — kebab-menu path retires |
| Global files editor as its own modal (opened from footer globe button) | About-you pane inside PreferencesModal | Phase 137 | Consolidation — globe button retires |
| Voice bound per-identity; app-wide default "Joanna" when unbound | Per-identity + per-user-fallback + app-wide default | Phase 137 | Frontend resolves; no backend change |
| Reopen-tabs-on-login DB preference (fork holdover) | (deleted — different mechanism drives tab restoration now) | Phase 137 | Column drop; migration one-way |
| No user avatar UI (backend built in Phase 85) | User avatar upload/remove UI in Preferences → General pane | Phase 137 | New user-facing capability |
| `initials-circle` always renders as `<span>` with letter | Conditional `<img>` (has avatar) or `<span>` (no avatar) | Phase 137 | New render branch in sidebar footer |

**Deprecated / outdated:**
- `EnableNotificationsModal.tsx` (whole file) — folded into PreferencesModal's NotificationsPane. Delete after fold-in. `pushNotificationsSupported()` export must survive relocation.
- `GlobalFilesModal.tsx` (whole file) — folded into PreferencesModal's AboutYouPane. Consider deletion; verify no other importers first (grep — most likely zero).
- `reopenTabsOnLogin` preference in every layer (schema, backend route, frontend type, AppShell read/seed) — full purge.
- Globe button in sidebar footer — `data-testid="pv-footer-global-files-button"` (`PrettyConversationsPanel.tsx:3103-3112`) — delete.
- "Enable notifications…" kebab-menu item — `PrettyConversationsPanel.tsx:3437-3440` conditional entry — delete.
- Decorative Settings gear placeholder — `PrettyConversationsPanel.tsx:3117-3124` inert `<span>` — replace with real button.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GlobalFilesModal has zero non-panel callers beyond the footer globe button | Recommended Project Structure | If a rogue importer exists (highly unlikely — grep hint suggests only PrettyConversationsPanel mounts it), deleting the file breaks that surface. Planner should include a task-level grep gate: `grep -rn "GlobalFilesModal" src/` returns only the panel and the About-you fold-in code. |
| A2 | The frontend `getUserInfo()` response is safe to extend with `avatarPath` without breaking cached-response consumers | Sidebar footer avatar plumbing | Very low — the interface already permits `mxid?: string \| null` as optional; adding another optional field is backward-compatible. But confirm no test asserts strict-shape equality. |
| A3 | The `?f=${avatarPath}` cache-buster is sufficient because `writeUserAvatar` mints a new random filename per upload | Sidebar footer avatar cache-bust | Verified via reading `user-avatar-storage.ts` — `writeUserAvatar` generates a new filename each call (mime+random). If for some reason the same-name overwrite path is hit (D-16 write-same-name branch), cache-buster fails. Alternative: use timestamp query param. |
| A4 | `pushNotificationsSupported()` can be moved to a new `push-support.ts` file without breaking the existing test that imports it from `EnableNotificationsModal.tsx` | Kebab-item removal Pitfall 7 | Low — tests reference the function; a re-export or file-relocation with import-fix is mechanical. Grep for `pushNotificationsSupported` imports to confirm the surface. |
| A5 | The About-you pane can inline the entire GlobalFilesModal interior (host picker + tab strip + save flow) without needing a shared hook extraction | Pattern 4 Simpler alternative | Depends on planner's stylistic preference. Inlining is the min-diff path if GlobalFilesModal is being deleted anyway. Extraction is cleaner but adds a file. |
| A6 | Notification button as folded-in pane still satisfies iOS gesture-gate — the click still lives inside a synchronous onClick handler; the enclosing modal-open state does not introduce an await boundary | D-19 Pitfall 1 | Verified by inspection of EnableNotificationsModal.tsx — the sync invariant is about the handler's task-tick, not the component context. Fold-in is safe as long as no `await` is added before `Notification.requestPermission()`. |
| A7 | Skynet does not require downgrade-compatibility for schema changes | Pitfall 3 | Verified by precedent — `runPinColumnDrop` and `runHiddenColumnDrop` both ship one-way drops with no downgrade path documented. If a downgrade policy exists elsewhere (e.g., docs/ folder), planner should re-check. |
| A8 | The `pv-footer-initials` CSS class can be applied to an `<img>` element (or the styling adapts) without visual regression | Sidebar footer conditional render | The class defines a circle (border-radius, background, dimensions, centering). Applied to an `<img>` it should still render as a circle, but the child-centering rules (flex/text-align) that apply to a `<span>` with a letter may need adjustment. Recommend: separate class `pv-footer-avatar-img` inheriting circle geometry, OR verify visually in the plan. Prototype HTML is the visual anchor. |
| A9 | Phase 137 will not require any new WebSocket routes | Standard Stack (version-drift hard-lock note) | Verified — every operation this phase needs (avatar upload, user prefs GET/PUT, global-files list/read/write, push-subscription POST) is REST. No WS handshake changes needed. |
| A10 | `open-tabs-api.ts` is the correct current home for `getUserPreferences` / `saveUserPreferences`; extracting to a new `user-preferences-api.ts` file is optional cleanup | Alternatives Considered | Verified — these helpers currently live at `open-tabs-api.ts:102-111`. Extraction is stylistic. |

Assumptions A2, A6, A7, A9 are structural — if any of them is wrong, planner needs to know before execution. Assumptions A1, A3, A4, A5, A8, A10 are stylistic or verifiable via grep during plan execution.

## Open Questions

1. **Should GlobalFilesModal be deleted after About-you fold-in, or kept as export-only for the interior extraction?**
   - What we know: D-29 removes the globe button, which is the only trigger. No other importers surfaced in initial grep.
   - What's unclear: Whether the plan-checker or lint tooling flags orphaned components as errors.
   - Recommendation: Delete outright once fold-in is complete; verify with a grep task that GlobalFilesModal has no importers post-fold-in.

2. **Should EnableNotificationsModal be deleted after fold-in, or kept as export-only for `pushNotificationsSupported`?**
   - What we know: Kebab-item removal cuts its only trigger; NotificationsPane needs `pushNotificationsSupported`.
   - What's unclear: Cleanest way to preserve the function export.
   - Recommendation: Move `pushNotificationsSupported` to a new `src/ui/features/notifications/push-support.ts` file; delete `EnableNotificationsModal.tsx` entirely. Cleaner than a rump file.

3. **Should the "About you" first-tab label override the IMPLICIT_GLOBAL_FILE.label ("User CLAUDE.md") in the multi-file case?**
   - What we know: D-28 says "First tab is 'About you' (the CLAUDE.md, treated specially with the friendly label)."
   - What's unclear: Whether "About you" applies only in the single-file case (where there's no tab strip anyway) or also in the multi-file case as the first tab's label.
   - Recommendation: In multi-file case, first tab label = "About you"; other tab labels = per-file `label ?? filename`. Backend `IMPLICIT_GLOBAL_FILE.label` unchanged (that's a backend concept; UI overrides for display).

4. **Should the phase split into 137 (shell + General + Voice + Notifications + cleanups) and 138 (About-you)?**
   - What we know: CONTEXT.md § Claude's Discretion explicitly leaves this to the planner. Both halves are non-trivial.
   - What's unclear: Task-graph size threshold for splitting.
   - Recommendation: **One phase, two waves** (Wave A: shell + General + Voice + Notifications + cleanups; Wave B: About-you fold-in). One phase reduces plan-check ceremony; two waves preserve the natural fault line.

5. **Should the plan include a task to verify the multi-host fallback UX with the two hosts on the user's real setup?**
   - What we know: CONTEXT.md § D-27 says multi-host is a rare fallback; single-host is the 99% path. The user's live production has 10 hosts, but every host has only one file → the fallback UI (host picker + tab strip) is real code but rarely exercised end-to-end.
   - What's unclear: Whether human UAT should include manually walking through the multi-host case.
   - Recommendation: Include a manual-verify task in the plan for the multi-host case; the plan's automated tests can mock 2+ hosts, but end-to-end confidence requires touching real hosts.

6. **Backend `/users/me` currently omits `avatarPath` — is adding it a breaking change?**
   - What we know: The `UserInfo` frontend type is optional-safe (`mxid?: string | null` precedent). Backend response is a plain object; adding a field is additive.
   - What's unclear: Whether any code path asserts strict shape.
   - Recommendation: Verify via grep for `getUserInfo` result-shape assertions; if none, the addition is safe.

## Environment Availability

Phase 137 is pure code — no new external tools, services, runtimes, databases, or package managers required. All dependencies (Node, npm, better-sqlite3, MDXEditor bundle, browser Notification API, browser Push API, service worker infrastructure) are already installed and exercised by other phases. **Section skipped (no external dependencies identified beyond what's already in the build).**

## Security Domain

Security enforcement is enabled per `.planning/config.json` (`security_enforcement: true`, `security_asvs_level: 1`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | Yes (indirectly) | All new API calls use `authApi` which routes through `AuthManager.createAuthMiddleware()` (JWT cookie). No changes to auth flow. |
| V3 Session Management | No (no session flow changes) | — |
| V4 Access Control | Yes | `PUT /users/:id/avatar` already gated by `assertOwnOrAdminForAvatarChange` middleware (users.ts:497) — self or admin. `PUT /user-preferences` gated by `authenticateJWT` — user updates own row only (userId from JWT, not body). No changes needed. |
| V5 Input Validation | Yes | `fallbackVoice` string validation added to `handlePutPreferences` (`typeof !== "string"` → 400). Body destructuring pattern already established. Avatar upload: multer MIME whitelist + magic-byte sniffing already enforced. |
| V6 Cryptography | No | — |

### Known Threat Patterns for React (Vite) + Radix + Drizzle SQLite stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via user-typed markdown in About-you | Tampering | MDXEditor sanitizes rendered HTML by default; the raw markdown stored on disk is never rendered as HTML in a chat surface — About-you is a private user-scope file consumed by agents, not other users. Server-side write goes through existing `/global-files/write` which is a whitelisted-path SFTP write (already gated). |
| CSRF on state-changing PUT/POST | Tampering | Skynet uses JWT in HTTP-only cookie + explicit `Authorization: Bearer` header via `authApi`. Multipart routes additionally protected by `multipartOriginGuard` (users.ts:497). No changes needed. |
| Uploaded avatar file MIME spoofing | Tampering | Backend already sniffs magic bytes (`sniffAvatarMime` in `user-avatar-storage.ts:230-236`); rejects declared-vs-sniffed mismatch as 400. No frontend responsibility. |
| Avatar file exhaustion | Denial of Service | Multer 5 MB cap (user-avatar-storage.ts:101); old file unlinked after new upload (users.ts:586-598). No changes needed. |
| Voice preference injection (arbitrary string stored as voice) | Tampering | Weak — backend accepts any string. `postSpeak` call downstream will fail gracefully if the voice isn't a valid Polly voice ID (existing backend voice route validates). Recommend: frontend picker constrains to the 7 known IDs (already true — `VoicePicker.tsx:11-19` inline catalog); backend validation is defense-in-depth only. Low-severity finding. |
| Push subscription endpoint tampering | Tampering | Existing backend accepts any subscription URL. Threat is minimal (attacker can only DoS themselves by feeding a fake endpoint). No changes needed. |

**No high-severity or blocking security findings for this phase.** Every state-changing surface (avatar PUT, prefs PUT, push subscription POST, global-files write) is either already hardened (avatar, global-files) or trivially wired to existing hardened patterns (prefs PUT — same handler as pin fanout). Add `fallbackVoice` string-type validation to the existing validation loop and the surface is closed.

## Sources

### Primary (HIGH confidence — verified in codebase)

- `src/ui/features/notifications/EnableNotificationsModal.tsx` (L1-244) — canonical modal chrome recipe; canonical synchronous permission-request handler; `pushNotificationsSupported()` export
- `src/ui/features/pretty-view/GlobalFilesModal.tsx` (L1-382) — canonical mtime-optimistic-concurrency save flow with 409 UX; canonical host-picker header pattern; canonical `Tabs` + `TabsContent` per-file lazy-load pattern
- `src/ui/features/pretty-view/IdentityModal.tsx` (L308-314, L1550-1608) — canonical `NAV_SECTIONS` array shape (adapted for left-nav)
- `src/ui/features/pretty-view/MarkdownEditor.tsx` (L1-101) — canonical MDXEditor lazy wrapper; filetype gate; verbatim raw-textarea fallback styling
- `src/ui/features/pretty-view/MdxEditorImpl.tsx` — the underlying MDXEditor impl (not read but referenced by MarkdownEditor L31)
- `src/ui/features/pretty-view/pickers/VoicePicker.tsx` (L1-127) — reusable voice picker with sample-play + proper Audio cleanup
- `src/ui/features/pretty-view/GlobalFileTab.tsx` (L1-157) — mtime-concurrency handleSave + MDXEditor mount shape + wrapping flex/min-h-0 structure
- `src/ui/features/pretty-view/ChatMessage.tsx` (L69-256) — canonical `identityVoice` prop threading + `postSpeakStream` call site
- `src/ui/features/pretty-view/PrettyView.tsx` (L4266-4285) — the D-16 wire-up site
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (L895-916, L3063-3126, L3298-3305, L3437-3440) — modal-state atoms, sidebar footer, kebab menu — all mutation sites for this phase
- `src/ui/AppShell.tsx` (L361-364, L446, L528-538, L1377-1394, L1563-1608, L3250-3282) — user prefs seed + fetch, `meUsername` sibling for `meAvatarPath` addition, reopenTabsOnLogin read site
- `src/ui/api/open-tabs-api.ts` (L94-111) — `UserPreferences` type + `getUserPreferences` + `saveUserPreferences` — extend these
- `src/ui/api/user-preferences-api.ts` (L1-82) — `putPinnedIds` autosave-shape reference
- `src/ui/api/global-files-api.ts` (L1-99) — `listGlobalFiles`, `readGlobalFile`, `writeGlobalFile`, `GlobalFileMtimeConflictError` — About-you reuses verbatim
- `src/ui/api/identities-api.ts` (L88-186) — `FormData` multipart-upload pattern for avatar reference
- `src/ui/main-axios.ts` (L117-135, L1827-1835) — `UserInfo` interface (extend with `avatarPath`), `getUserInfo()` — extend
- `src/backend/database/routes/users.ts` (L487-623, L1909-1949) — canonical `PUT /users/:id/avatar` (Phase 85, no change) + `/users/me` (add `avatarPath` field)
- `src/backend/database/routes/user-preferences.ts` (L1-551) — canonical GET/PUT handlers, `pickPreferences`, `DatabaseSaveTrigger.forceSave` invocation pattern
- `src/backend/database/routes/user-avatar-storage.ts` (multer setup + magic-byte sniff + 5MB cap) — backend avatar infrastructure (no change)
- `src/backend/database/db/schema.ts` (L832-846) — `userPreferences` Drizzle definition
- `src/backend/database/db/index.ts` (L540-549, L779-869, L900-960, L1007-1042, L1873-1939) — CREATE TABLE; `addColumnIfNotExists`; `dropColumnIfExists`; `assertSqliteSupportsDropColumn`; `runPinColumnDrop` / `runHiddenColumnDrop` / `runIdentitiesCosmeticDrops` — canonical schema evolution patterns
- `src/backend/database/routes/global-files-config-loader.ts` (L59-217) — `IMPLICIT_GLOBAL_FILE = { path: "~/.claude/CLAUDE.md", label: "User CLAUDE.md" }` — the file About-you points at in single-file case
- `src/ui/features/pretty-view/GlobalFilesModal.test.tsx` (L1-80+) — test-file MDXEditor stub pattern (reuse in PreferencesModal tests)
- `src/ui/features/notifications/EnableNotificationsModal.test.tsx` (L1-80+) — test-file Notification/serviceWorker mock pattern; case 4 = load-bearing synchronous invocation regression gate
- `package.json` — confirmed React 19.2.5, radix-ui 1.4.3, @mdxeditor/editor 4.2.5, lucide-react 1.28.0, drizzle-orm 0.45.2, better-sqlite3 12.9.0, multer 2.1.1, axios 1.15.2
- `.planning/config.json` — confirmed `nyquist_validation: false` (no test-map section required); `security_enforcement: true`, `security_asvs_level: 1`
- `.planning/phases/137-.../137-CONTEXT.md` — decisions D-01 through D-32 locked
- `.planning/shapes/shape-preferences-modal.md` — the source-of-truth agreement from `/open`

### Secondary (MEDIUM confidence — patterns inferred from consistent precedent)

- Skynet's "in-memory-decrypted SQLite + forceSave" invariant documented at multiple sites (user-preferences.ts:439-459 with pattern reference to identities.ts:264-273); can safely infer the same pattern applies to the new `fallbackVoice` PUT path
- Version-drift hard-lock (`X-Skynet-Client-Build` in `stampedFetch`) applies to REST calls; new API additions using `authApi` inherit this automatically

### Tertiary (LOW confidence — assumptions flagged in Assumptions Log)

- A1, A3, A4, A5, A8, A10 — stylistic/verifiable-during-execution assumptions listed in the Assumptions Log

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep already in package.json, verified
- Architecture: HIGH — every pattern has a shipping precedent in the codebase, cited with file:line
- Pitfalls: HIGH — pitfalls 1, 2, 4, 6, 7, 9 are grounded in actual code inspection; pitfalls 3, 5, 8 are policy/spec-derived
- Runtime state inventory: HIGH — grep-verified all 6 `reopenTabsOnLogin` reference sites
- Security: HIGH — no new attack surface introduced beyond what Phase 85 (avatar) and existing user_preferences already handle
- Left-nav layout: MEDIUM — this is a new pattern for Skynet; prototype HTML file is the only visual reference. Copying `NAV_SECTIONS` array shape from IdentityModal is straightforward; the vertical vs. horizontal rendering is where planner needs to be careful

**Research date:** 2026-09-27
**Valid until:** 2026-10-27 (30 days — stable stack, no fast-moving dependencies)
