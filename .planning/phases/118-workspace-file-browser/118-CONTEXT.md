# Phase 118: Workspace file browser - Context

**Gathered:** 2026-09-19
**Status:** Ready for planning

> **Provenance:** Decisions in this file were extracted during a `/build` → `/open` shaping session with the user. The full shape file (Ashley's-conceptual-model style, no code symbols) lives at `.planning/shape-workspace-file-browser.md` and is the load-bearing artifact for `/close workspace-file-browser` at the end of the build arc. A tasting prototype at `~/fleet/roles/box-maintainer/bounties/workspace-file-browser/prototype/modal.html` was iterated with the user and reflects the settled visual + interaction target — walk through it before drafting the plan.

<domain>
## Phase Boundary

A file-management surface embedded in the chat app that lets a user browse the working folder of whichever agent they are chatting with, no matter which host that agent lives on. Recursive tree, full CRUD (read, edit, create, delete, rename, upload, download). The workspace lives at `~/fleet/identities/<agent-name>/workspace/` on whichever host the agent runs on. The surface is a new tab inside the existing IdentityModal — the modal that already opens on left-click of the identity badge — joining the existing tabs via the same bottom icon-bar section-switcher pattern.

Multi-tenant: this ships on every Skynet deployment (t1000, T800, and any future ones), not tied to any single host or user.

</domain>

<decisions>
## Implementation Decisions

### Placement & entry

- **D-01:** The workspace lives as an additional tab inside `IdentityModal` (`src/ui/features/pretty-view/IdentityModal.tsx`), joining the existing `NAV_SECTIONS` array (Identity file / Wakeups / [Telegram]). Add a new entry `{ value: "workspace", label: "Workspace", Icon: Folder }` from `lucide-react`.
- **D-02:** The workspace tab is available to all users — not admin-gated like Telegram. See D-16 for the underlying permission model.
- **D-03:** Do NOT introduce a badge-click menu or a separate modal for this. The badge already opens IdentityModal on left-click (patch #87 wired this at `PrettyView.tsx:3540-3547`); the workspace becomes discoverable via the tab, not a new entry point.

### Change semantics — user → agent

- **D-04:** Blind. When the user creates, edits, deletes, uploads, renames, or moves a file, NO signal is sent to the agent. The next time the agent looks at its own workspace, it discovers the change. This is load-bearing to the "plain file manager" stance — any code path that ends up notifying the agent has broken the abstraction.

### Change semantics — agent → user (refresh model)

- **D-05:** Snapshot view with manual refresh. The tab shows what it fetched when opened (or when the user last clicked refresh). Agent-side writes that happen while the tab is open are NOT auto-surfaced. A refresh button in the tab toolbar re-fetches on demand.
- **D-06:** No websocket subscription, no polling, no live-tail. Manual refresh only.

### Safety rails

- **D-07:** Every delete (file OR folder) fires a generic "are you sure?" confirmation. Beyond that, no rails: no path-specific protection (no "you can't delete `.git`"), no size-based warnings, no "you're about to delete N items" smart-counting. A single confirm is the ceiling.

### File visibility

- **D-08:** Show everything. No hidden-file filtering, no dotfile demotion, no ignore-list of well-known-noisy folders. `.git`, `node_modules`, `.env`, `.DS_Store` all render inline with regular files, no distinction. Users see what's actually there.

### File open — how the viewer/editor is presented

- **D-09:** Clicking a text file, a markdown file, or an image file swaps the Workspace tab body from list-mode to viewer-mode INLINE — the tab body content changes, but the IdentityModal itself stays open and the Workspace tab stays selected. A back affordance (back button + clicking the folder's crumb in the breadcrumb) returns to list-mode.
- **D-10:** NO second modal is ever opened on top of IdentityModal from within this feature. This is load-bearing: the app's existing convention is that a modal-inside-a-modal never happens (modals replace, they don't stack). Inline-swap preserves that convention while ALSO preserving the file-browsing context (unlike modal replacement, which would close IdentityModal and lose the tab state).
- **D-11:** The inline viewer/editor reuses existing components: `MarkdownEditor` at `src/ui/features/pretty-view/MarkdownEditor.tsx` for `.md` files; the plain-text editor pattern from `EditableFileModal` at `src/ui/features/pretty-view/EditableFileModal.tsx` for other text/code files. NEITHER should be presented as a modal here — they mount inside the tab body. Image files render as a large `<img>` (view-only, no editing).
- **D-12:** File-type dispatch: extension-based. `.md` → MarkdownEditor. `.txt|.json|.ts|.tsx|.js|.jsx|.css|.html|.log|.yml|.yaml|.py|.sh` (and reasonable siblings) → text editor. Common image extensions (`.png|.jpg|.jpeg|.gif|.webp|.svg`) → image viewer. Anything else → "binary file, not previewable" empty state with a Download button.

### List style + sorting

- **D-13:** Single-pane breadcrumb navigation. One folder at a time. Click a folder to descend, click a crumb to go up.
- **D-14:** Column-based row layout: icon | name | size | modified | overflow (⋯). Columns are sortable — click a column header to sort ascending, click again to flip descending. Active sort key + direction shown by a small arrow next to the header label.
- **D-15:** Sort applies within groups; folders always stay above files. Within each group, sort by the active key/direction.

### Upload + creation

- **D-16:** Two upload paths, both wired: (a) toolbar "Upload" button opens native file picker; (b) drag-and-drop from OS into the folder area, with a visible drop-zone overlay while the user is dragging over the target. Both do the same thing — upload the file(s) into the currently-viewed folder.
- **D-17:** Toolbar also has "New folder" and "New file" buttons. New folder → inline prompt for name → creates empty folder. New file → inline prompt for name → creates empty file. Both take the current folder as parent.

### Cross-host reach

- **D-18:** The workspace lives on the host that the identity's agent runs on. The modal header carries a small chip showing the host name + reachability dot (green if reachable, red-ish if not) — so cross-host failure has a visible home rather than a silent blank state.
- **D-19:** Reuse the existing host-file network primitive from `src/ui/api/editable-file-api.ts` (`fetchHostFileUrl`) and its backend counterpart at `src/backend/pretty-view/pretty-view-fetch-host-file.ts`. It already handles the SSH-tunnel + error-classification (host_unreachable, permission_denied, not_found, too_large, path_forbidden, etc.). This feature builds a workspace-CRUD wire surface ON TOP of that same host-reach plumbing, not alongside it.
- **D-20:** Reuse the error-classification copy pattern from `EditableFileModal.tsx` (`FILE_URL_ERROR_COPY` map at L63-112) for user-visible error surfaces. Consumer-user register — never show raw HTTP status codes, stack traces, or shell errors (per T-40-05 invariant already documented in that file).

### Permissions

- **D-21:** Workspace access rides on top of Skynet's existing per-host access model. Users have hosts assigned to them; if a user has access to a host, they can chat with agents on it; if they can chat with an agent, they can open its Workspace tab. NO new permission layer — the tab visibility + backend authorization gate on the same host-access check that already governs chat access.
- **D-22:** Admin-only gating is NOT applied. Unlike Telegram (which is admin-gated at the tab level), Workspace is available to any user who can chat with the agent — because in the multi-tenant deployment model, non-admin users own hosts of their own and legitimately need to browse the workspaces of agents on their hosts.

### Audience + register

- **D-23:** Consumer-user register throughout. The target user does not know what SSH is, what a shell is, what a dotfile is, or what a repo is. Their fallback if this feels bad is "ask the agent," not a terminal. So: obvious buttons, plain-English error copy, no developer jargon anywhere in user-visible surfaces.
- **D-24:** Any element that requires knowing developer concepts to use is a sign the register drifted. Empty state, error copy, tooltip text, confirm dialogs — all must read naturally to a non-developer.

### Claude's Discretion

- Ordering when sort is on name/size/mtime and two rows tie: implementer's call (stable sort or secondary key by name is both fine).
- Exact keyboard behavior beyond browser defaults: implementer's call (no explicit keyboard-nav feature is required or forbidden as long as it doesn't add a power-user affordance surface).
- Whether the refresh button shows a spinner or just a subtle pulse during the re-fetch: implementer's call.
- Whether inline upload progress is a per-file percentage or a single indeterminate indicator: implementer's call.
- Whether download of a large file streams straight to browser download or fetches into memory first: implementer's call, but consider file-size implications.
- The exact wording of the delete confirmation prompt: implementer's call, subject to consumer register (D-23).
- Whether new-folder / new-file inline prompts are `window.prompt` (simplest) or a small in-tab input row (nicer): implementer's call, but note D-10 forbids opening a separate modal for this.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Shape agreement (load-bearing)

- `.planning/shape-workspace-file-browser.md` — The `/build` → `/open` shape file that governs the whole arc. Written in Ashley's-conceptual-model style. `/close workspace-file-browser` at the end verifies conformance against THIS file, not against 118-CONTEXT.md. Every decision in 118-CONTEXT.md traces back to a section in the shape file.
- `~/fleet/roles/box-maintainer/bounties/workspace-file-browser/prototype/modal.html` — Tasting prototype iterated with Ashley. Reflects the settled visual + interaction target down to the modal chrome, tab bar, list style, sortable columns, drag-drop upload zone, and inline-swap file view. Walk through before drafting the plan; it is the reference implementation for HOW this should look and feel. Served locally at `http://localhost:8901/modal.html` (or via `https://Skynet-8901.serve.term.gigaashley.click/modal.html` while the server is up).

### Existing modal + tab pattern (D-01, D-10)

- `src/ui/features/pretty-view/IdentityModal.tsx` — The modal this feature adds a tab to. `NAV_SECTIONS` array at L308-318 is where the new tab entry goes. Bottom icon-bar section switcher pattern at L1620-1653 (patch #191). Tab body renders via `TabsContent` at L1548-1610.
- `src/ui/features/pretty-view/PrettyView.tsx` L3540-3547 — Where the identity badge is wired to open IdentityModal (patch #87). Read-only reference — no changes here.
- `src/ui/components/dialog.tsx` — shadcn/radix dialog primitive used by IdentityModal. Note: IdentityModal uses `DialogPrimitive` directly (not the wrapper components) for its `absolute inset-4` layout; the new tab body sits inside that same content region.

### Editors to reuse (D-11)

- `src/ui/features/pretty-view/MarkdownEditor.tsx` — Existing markdown editor. Reuse for `.md` file open. Currently used by `IdentityFileTab` for the `<name>.md` render — same integration pattern applies here.
- `src/ui/features/pretty-view/MdxEditorImpl.tsx` — MarkdownEditor's underlying implementation. Reference only.
- `src/ui/features/pretty-view/EditableFileModal.tsx` — Existing text-file editor modal. DO NOT re-use its modal chrome (D-10 forbids nested modals); DO re-use its `GlobalFileTab` body component (imported at L15) + its save/dirty-guard patterns (L149-186 doc-block) + its error-classification copy map (L63-112).
- `src/ui/features/pretty-view/GlobalFileTab.tsx` — Body component EditableFileModal wraps around. Candidate for reuse inside the inline-swap view for text files, if the shape matches.

### Cross-host file plumbing (D-19, D-20)

- `src/ui/api/editable-file-api.ts` — `fetchHostFileUrl(url)` — the client-side call that hits the backend, which SSH-tunnels to the target host and reads the file. Full error-class flow documented in the file.
- `src/backend/pretty-view/pretty-view-fetch-host-file.ts` — Backend counterpart. Handles SSH channel, path validation (traversal, forbidden roots, absolute-path check), 2MB size cap, error classification. THIS is the pattern the new workspace-CRUD backend routes stand on. The workspace routes are additive — a `list-workspace`, `read-workspace-file`, `write-workspace-file`, `delete-workspace-entry`, `rename-workspace-entry`, `create-workspace-folder`, `upload-workspace-file` set — all reaching the same identity's workspace path on the same target host via the same SSH plumbing.

### Visual language (referenced by prototype, non-negotiable in impl)

- `src/ui/index.css` L100-176 — pv-* design tokens. Palette, radii, shadows, `--pv-id-hue` per-identity hue custom property. All new surfaces MUST consume these tokens rather than hard-coding.
- `src/ui/features/pretty-view/GlobalFilesModal.tsx` L190-277 — Reference for `absolute inset-4` modal chrome (glass gradient, backdrop-blur, rounded-24, inset warm rim, cool-blue outer glow). IdentityModal follows the same treatment. New tab body must fit inside without breaking the chrome.

### Backend routing + auth

- `src/backend/database.ts` — Where backend routes are mounted. New workspace routes register here.
- Existing per-host access-check middleware — reuse for D-21 authorization. Identify at plan time by looking at how host-file routes (D-19) are already gated.

### Identity workspace path (D-04, D-19)

- `~/.claude/skills/id/SKILL.md` § File locations — Documents that every identity's workspace lives at `~/fleet/identities/<name>/workspace/`. The backend needs to resolve `<name>` from the identity being viewed and construct the workspace root path for CRUD operations.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- **`IdentityModal` `NAV_SECTIONS` array** — Adding one entry adds one tab. No new modal shell, no new dialog primitive, no new close-button treatment. Existing icon-bar rendering (L1620-1653) handles selected-state hue tinting automatically via `--pv-id-hue`.
- **`MarkdownEditor` component** — Renders + edits markdown. Already handles frontmatter, live preview, save flow. Mount inside the inline-swap view without wrapping in a modal.
- **`GlobalFileTab` component (used by `EditableFileModal`)** — Text editor body with save/dirty-guard/mtime-monotonic-counter defenses. Candidate for reuse.
- **`fetchHostFileUrl` / backend `pretty-view-fetch-host-file.ts`** — Cross-host SSH-tunnel file fetch with error classification. New workspace routes extend this pattern (list/write/delete/rename/create/upload additions).
- **`FILE_URL_ERROR_COPY` map at `EditableFileModal.tsx:63-112`** — Verbatim user-friendly error copy for host_unreachable, permission_denied, not_found, too_large, path_forbidden, path_traversal, path_must_be_absolute, unknown_host, ssh_timeout, invalid_hostname, invalid_body, generic. Reuse (import, don't copy).
- **pv-* design tokens (`src/ui/index.css` L100-176)** — Consume via `var(--color-pv-*)` and `hsla(var(--pv-id-hue), ...)`. Automatically inherits per-identity hue tinting for the surface.
- **`lucide-react` `Folder` / `FolderPlus` / `Upload` / `File` / `Trash` / `Download`** — Icon primitives already available.

### Established Patterns

- **Bottom icon-bar section switcher** (patch #191) — Icon + tiny label, hue-tinted glassy pill on selected. Automatic if you register the new tab in `NAV_SECTIONS`. Do NOT reinvent.
- **`absolute inset-4` modal chrome** (from `GlobalFilesModal.tsx` L190-223) — Cool blue-gray gradient, backdrop-blur 28px + saturate 1.4, warm inset rim, cool outer glow. IdentityModal already applies this — the tab body just fills the content region.
- **Error copy pattern** — Never show raw error strings to users; classify at the backend, look up copy at the frontend via `FILE_URL_ERROR_COPY` (or an extended version if workspace-CRUD introduces new failure modes). Per T-40-05 invariant already enforced in `pretty-view-fetch-host-file.ts`.
- **`DatabaseSaveTrigger.forceSave` post-write** — Skynet's DB is in-memory SQLite; direct writes don't persist to disk. This feature's workspace-CRUD may or may not touch the DB — if it does, follow the pattern at `host-autostart-routes.ts:173-181` (role file § "Load-bearing invariants" — the recurring in-memory-flush trap).
- **Consumer-user copy register** — Every user-visible string across the app is written for non-developers. Match the tone of existing error copy in `FILE_URL_ERROR_COPY` and `IdentityModal`.

### Integration Points

- **`IdentityModal.tsx` `NAV_SECTIONS`** — Add one entry.
- **`IdentityModal.tsx` `<TabsContent value="workspace">`** — New tab body renders the workspace browser. Follow the same size + overflow pattern as the other TabsContent blocks (`flex-1 min-h-0 overflow-y-auto`).
- **Backend `database.ts` route mount** — Register the new `workspace-routes.ts` module.
- **Backend `pretty-view-fetch-host-file.ts`'s SSH primitives** — Factor out (if not already) the SSH-tunnel + path-validation helpers so the workspace routes can use them without duplicating.
- **Identity-name → workspace-path resolution** — New backend concern: given the identity the user is viewing (available at the frontend via IdentityModal's `identity` prop; passed to backend as identity key), map to `~/fleet/identities/<name>/workspace/` on the host the identity's agent runs on. Host discovery — likely already available via existing identity-metadata lookup used elsewhere in IdentityModal.

</code_context>

<specifics>
## Specific Ideas

- **Prototype is the visual + interaction reference.** The implementer walks through `~/fleet/roles/box-maintainer/bounties/workspace-file-browser/prototype/modal.html` (served at `https://Skynet-8901.serve.term.gigaashley.click/modal.html` while the server on t1000 is up, or the folder can be served with `python3 -m http.server 8901` from any peer) and treats it as the design target. Notably: the modal header layout (avatar + name + role + host-chip + close), the bottom tab bar (icon + label, hue-tinted selected pill), the toolbar (breadcrumb + Upload/New folder/New file), the list (sortable columns with arrows, hover-visible ⋯, right-click context menu), the drag-drop overlay (dashed hue-outlined + centered "Drop to upload" card), the inline-swap file viewer.
- **The visual chrome was sampled from real code**, not invented. Palette from `src/ui/index.css:100-176`. Modal chrome pattern from `GlobalFilesModal.tsx:190-277`. Tab bar pattern from `IdentityModal.tsx:1620-1653`. Prototype fidelity here means production impl can't drift without a reason.

</specifics>

<deferred>
## Deferred Ideas

**In-scope-for-later (not V1, but not ruled out):**

- Search across files (name-based or content-based grep).
- Multi-select and bulk operations (shift-click + delete-many, move-many).
- Explicit keyboard navigation beyond browser defaults (arrow keys, delete-key shortcut, Enter to open, etc.).
- Syntax highlighting inside the text editor (Monaco / CodeMirror / etc. — the current `EditableFileModal` doesn't have it either).
- Image thumbnails rendered inline in the file list (V1 shows a generic file icon and only renders the image on click).
- Copy/paste or drag-to-move files across folders.
- Git-aware view (diff, blame, history, status) — even though most workspaces will have git repos.
- Folder-as-zip download (currently the "download folder" action in the prototype is stubbed; can defer to server-side zip streaming or leave out entirely for V1).
- File counts on folder rows (like macOS Finder shows "24 items" on a folder).
- Any smart hidden-file filtering (V1 shows everything; a future "hide dotfiles" toggle could be added if a real need emerges).

**Explicitly out — violates the shape's stance, do NOT add:**

- Any notification-to-agent that the user acted on the workspace. Blind is load-bearing (D-04).
- Any protected-path or protected-file logic that refuses to delete something. A single generic confirm is the ceiling (D-07).
- Any second modal opened on top of IdentityModal from within this feature (D-10). Inline-swap only.
- Any auto-refresh / websocket / polling mechanism to surface agent-side changes live. Manual refresh only (D-05, D-06).

</deferred>

---

*Phase: 118-workspace-file-browser*
*Context gathered: 2026-09-19*
