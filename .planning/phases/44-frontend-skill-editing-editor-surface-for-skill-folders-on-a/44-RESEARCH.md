# Phase 44: Frontend skill editing — Research

**Researched:** 2026-08-18
**Domain:** Skynet fork frontend + Express backend + SSH exec/SFTP fanout to a managed host's `~/.claude/skills/` folder tree
**Confidence:** HIGH — the entire phase is a mirror-and-fork of the Phase 23 global-files editor (surface, endpoints, plumbing, tests) with a single new dimension (a skill picker sitting between the host and the files). Every architectural question has an in-repo precedent.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Entry point**
- D-01 — Skill editing is reached from the same menu as the global-files editor — it's a sibling entry, NOT a new top-level surface.

**Modal chrome**
- D-02 — Reuses the existing global-files editor modal: same chrome, same host dropdown, same tab bar pattern, same editor pane.
- D-03 — One new selector sits next to the host dropdown: a skill dropdown. It populates from whichever host is currently picked.

**File navigation**
- D-04 — Once a skill is picked, the modal's tab bar shows the files inside that skill.
- D-05 — Files inside a skill's subfolders are listed flat as tabs whose label is the path relative to the skill root (e.g. `tests/basic.py`). No tree, no drill-down.
- D-06 — If a skill has more tabs than the tab bar can show, the tab bar becomes horizontally scrollable. Fallback for the rare crazy-file-count case.

**Editability**
- D-07 — Text files: open in the same editor pane global-files uses; fully editable; same save mechanics as global-files.
- D-08 — Non-text files: appear as tabs (not hidden) but the editor pane is replaced with a placeholder that says the file isn't text and cannot be edited.

**Mutations**
- D-09 — Add a new file to the currently-open skill (creates a new empty file at the skill's root).
- D-10 — Delete a file inside the currently-open skill. Must show a confirmation prompt.
- D-11 — Delete the currently-open skill entirely (removes the folder + everything under it).
- D-12 — No other guards: any visible file is deletable, any visible skill is deletable. The user is trusted.
- D-13 — Creating a brand-new skill from scratch is explicitly out-of-scope for this phase.

**Philosophy — plain-editor rule**
- D-14 — The editor is deliberately unaware of how skills are distributed, self-updated, or synced between hosts. Some skills fetch a fresh copy from a central server on every invocation; the editor does not know or care. If a local edit is later overwritten by a self-update, that is not this feature's problem.
- D-15 — The editor does NOT function as a general file manager. It does not browse the host's entire filesystem, it does not move files between skills, it does not rename anything. Scope is strictly "pick a skill, work on its files."

**Backend surface**
- D-16 — Backend endpoints are needed to: enumerate skills on a host, enumerate files inside a skill (recursively so subfolder files can appear as flat path-relative tabs), read a file's contents, write a file's contents, create a new empty file, delete a file, delete an entire skill. All scoped per-host (SSH into that host to read/write on its disk).

### Claude's Discretion
- Exact loading / error / empty states (spinner shape, error copy) — UI-phase will resolve.
- Confirm-dialog visual shape (inline confirmation, modal-in-modal, undo bar, etc.) — UI-phase will resolve.
- Keyboard shortcuts and focus behavior across the two dropdowns and the tab bar — UI-phase will resolve.
- How "new file" is expressed in the UI (button next to tab bar, plus-tab, menu action) — UI-phase will resolve.
- Save mechanics beyond "inherit from global-files editor" — implementation detail.
- Backend endpoint naming / paths — implementation detail.
- Where skill root lives on the target host (e.g. `~/.claude/skills/` for a user; may need to be a config or the same convention global-files uses) — implementation detail; align with how global-files editor targets user files.

### Deferred Ideas (OUT OF SCOPE)
- Creating a brand-new skill from scratch (scaffolding UI, template selection, etc.).
- Renaming skills or files.
- Moving files between skills.
- Any tree view, drill-down, or richer intra-skill navigation beyond flat tabs + horizontal scroll.
- Pushing edits back to a source-of-truth host for distributed skills (any distribution/self-update awareness).
- Better nav UI for skills with many nested files, beyond horizontal scroll.

**NOTE:** UI-SPEC (`44-UI-SPEC.md`) has already resolved several of the Claude's-Discretion items above (menu-order after "Edit global files…", copywriting for loading/error/empty branches, modal-in-modal confirmation shape, "+ Add file" button placement in the header row, keyboard/focus order). Planner MUST honor the UI-SPEC prescriptions — they are authoritative wherever they narrow a Claude's Discretion item.
</user_constraints>

## Summary

Phase 44 is a **mirror-and-fork** of Phase 23 (Global Files Editor). Every architectural decision is pre-answered by a shipped, tested, in-production precedent — the executor's job is to duplicate five files under `src/ui/features/pretty-view/` and `src/ui/api/`, add ~5 new endpoints to a new `src/backend/database/routes/skills-editor.ts` router (or two, if we split list/mutate the way Phase 23 split `global-files.ts` + `global-files-read-write.ts`), and wire a fifth menu item into `PrettyConversationsPanel.tsx` at line 1616. The Phase 23 surface *including its very-recent race-fix* (quick task `260805-7rq`) supplies every hook order, effect gating, and 409-conflict pattern.

Two dimensions are genuinely new versus Phase 23:

1. **A skill selector between host and files** — a second `<select>` in the header + a new "list skills" endpoint. Straightforward.
2. **Recursive file enumeration on a per-skill scope** — Phase 23 read from a fixed operator-authored whitelist (`/app/data/global-files.json`); Phase 44 has no such whitelist because the "whitelist" IS the skill folder. The AUTH gate shifts from "path in JSON" to "path is inside the resolved-absolute skill root and does not escape via `..`". This is a security-critical difference — the path-safety story needs its own audit (see `## Common Pitfalls` → Path Escape / SFTP Realpath).

The other five mutations (create empty file, delete file, delete skill) each have direct in-repo precedents (SFTP write via `writeMarkdownFileAtomic`, `rm -rf` via `execWithTimeout` with `shellEscape`).

**Primary recommendation:** Duplicate the Phase 23 file cluster verbatim, thread a `skill` layer into every request/response shape, and add a `computeSafeAbsolutePath(skillRoot, relPath)` helper that resolves to an absolute path and asserts it starts with `skillRoot + "/"` — call it on every path before ANY SSH or SFTP touches it. All other novelty is UX-scoped (skill dropdown, "+ Add file" prompt, delete-file/delete-skill confirmations) and is fully prescribed in `44-UI-SPEC.md`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Menu-entry trigger ("Edit skills…") | Browser / Client | — | Sits inside `PrettyConversationsPanel.tsx` L1613-1617 dropdown; opens a controlled React modal. Same tier as the existing "Edit global files…" trigger. |
| Modal shell / host dropdown / skill dropdown / tab strip | Browser / Client | — | React `Dialog` primitive + Radix Tabs; state (selectedHostId, selectedSkill, activeTab, per-tab TabState) lives in the modal component. Direct mirror of `GlobalFilesModal.tsx`. |
| Editor textarea + Save button + mtime-conflict reload prompt | Browser / Client | — | Reused from `GlobalFileTab.tsx` verbatim for text files; new placeholder branch for non-text. |
| Delete-file / Delete-skill confirmation dialogs | Browser / Client | — | UI-SPEC prescribes a modal-in-modal, not `window.confirm`. Rendered inside the parent `Dialog` portal with `z-[130]` above the parent's `z-[120]`. |
| HTTP client (axios via `authApi`) that speaks to the backend | Browser / Client | API / Backend | New `src/ui/api/skills-api.ts` mirrors `global-files-api.ts` — same axios instance, same `handleApiError` idiom, same typed 409 `MtimeConflictError` class. |
| Nginx location block routing `/skills-editor/*` to Express | Frontend Server (SSR) | API / Backend | New `location ~ ^/skills-editor(/.*)?$` block in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`. This is the layer-enumeration reflex — patch #446 arc's lesson: any new backend endpoint on this fork needs a corresponding in-container nginx `location` block or the frontend receives `index.html` and crashes on `.map` parsing. |
| Express router: enumerate skills / files, read/write file, create/delete file, delete skill | API / Backend | — | New `src/backend/database/routes/skills-editor.ts` (or split `-list.ts` + `-mutate.ts` mirroring Phase 23's split — planner's discretion). All routes: `authenticateJWT` → parse body → `resolveHostById(hostId, userId)` → `computeSafeAbsolutePath()` → SSH connect via `connectOneShot` → exec/SFTP → cleanup. |
| SSH exec channel (list skills, list files, mtime, cat, rm, mkdir, touch, rm -rf) | API / Backend | Storage (managed host) | Reuses `connectOneShot()` + `execCommand()` from `src/backend/ssh/{ssh-one-shot.ts,tmux-helper.ts}`. |
| SFTP write path (create empty file + atomic write on save) | API / Backend | Storage (managed host) | Reuses `writeMarkdownFileAtomic()` from `identity-artifact-reader.ts` — the shared `ext_openssh_rename` posix-rename helper. For "create empty file" a plain `sftp.writeFile(path, Buffer.alloc(0))` or a `touch` via `execCommand` will do; `writeMarkdownFileAtomic` also works if writing empty content. |
| Storage — the actual `~/.claude/skills/<skill>/**` tree on the managed host | Database / Storage | — | Filesystem on the SSH-reached host. No Skynet DB row for skills — filesystem IS the source of truth (mirrors D-14 plain-editor rule). |

## Standard Stack

### Core

| Library | Version (verified via package.json) | Purpose | Why Standard |
|---------|-------------------------------------|---------|--------------|
| `react` | 19.2.0 [VERIFIED: package.json + already loaded] | Modal shell + hooks | Skynet's core UI stack — do not introduce a competing framework. |
| `radix-ui` | already installed (used by `GlobalFilesModal.tsx` L3) [VERIFIED: import site] | `Dialog.Root`, `Dialog.Portal`, `Dialog.Overlay`, `Dialog.Content`, `Tabs` primitives | Already the modal primitive across pretty-view (`IdentityModal`, `GlobalFilesModal`, `NewSessionDialog`, `CreateRoleDialog`). Do not introduce shadcn `Dialog` wrapper as a peer — mirror the Phase 23 pattern exactly. |
| `lucide-react` | `^1.28.0` (per `44-UI-SPEC.md` § Registry Safety) [CITED: 44-UI-SPEC.md] | Icons: `FileText`, `X`, `Trash2`, `AlertTriangle` | Already in use — no new install. `Plus` icon not needed if we use the literal `+` character per UI-SPEC. |
| `ssh2` | already installed (used by `ssh-one-shot.ts`, `tmux-helper.ts`) [VERIFIED: import site] | SSH exec + SFTP channels to managed hosts | Skynet's ONLY SSH client. Do not introduce `node-ssh` or `simple-ssh` as a peer. |
| `express` | already installed [VERIFIED: import site] | Backend HTTP router | Existing routes use it exclusively. |
| `axios` (via `@/main-axios`) | already installed [VERIFIED: import site] | Frontend HTTP client with JWT interceptor | `authApi` instance auto-attaches `Authorization: Bearer ...`; `handleApiError` centralizes 401/network-drop toast handling. Do NOT `fetch()` — you lose auth. Exception: Phase 19 TTS streaming route uses `fetch()` because axios can't stream response bodies; that's the only in-repo exception and it does NOT apply here. |
| `drizzle-orm` (indirectly via `resolveHostById`) | already installed [VERIFIED: import site] | Host-row lookup in encrypted SQLite | Not a direct dependency — planner will import `resolveHostById` from `src/backend/ssh/host-resolver.ts` which handles ORM + credential resolution + per-user isolation. |

### Supporting (in-repo helpers — MUST be reused, not re-implemented)

| Helper | File | Purpose | Reuse Rule |
|--------|------|---------|-----------|
| `connectOneShot(host, timeoutMs)` | `src/backend/ssh/ssh-one-shot.ts` | Fresh short-lived SSH client for one-shot queries | Reuse. `timeoutMs = 5000` matches Phase 23. |
| `execCommand(conn, command)` | `src/backend/ssh/tmux-helper.ts` | Promise-wrapped exec channel returning stdout | Reuse. |
| `execWithTimeout(conn, command, timeoutMs)` | Local to `global-files-read-write.ts` L82-96 (duplicate the 15-line helper) | Bounds a hung remote | Duplicate the helper verbatim into the new router — Phase 23 also duplicated it from `roles-create.ts`/`roles-list-for-host.ts` (module-header comment L80-81). Extracting to a shared module is a Post-Planning-Gaps item, not a Phase 44 task. |
| `shellEscape(s)` | Local to `global-files-read-write.ts` L106-108 (duplicate the 3-line helper) | Single-quote escape for shell interpolation | Duplicate. Same pattern as Phase 23. |
| `resolveHostById(hostId, userId)` | `src/backend/ssh/host-resolver.ts` | Fetch host + resolved credentials with per-user isolation; returns `null` for cross-user/unknown | Reuse. Returns 404 upstream. |
| `AuthManager.getInstance().createAuthMiddleware()` | `src/backend/utils/auth-manager.js` | JWT gate | Reuse — every endpoint mounts this. |
| `writeMarkdownFileAtomic(conn, targetPath, contents)` | `src/backend/claude-session/identity-artifact-reader.ts` L1064-1118 | SFTP tmp+rename via `ext_openssh_rename` (posix-rename@openssh.com) | Reuse. THIS is the write path for save AND for create-empty-file (write empty buffer). Do NOT use `sftp.rename` — see prologue at L1039-1063 for the SSH2_FX_FAILURE trap on existing-target overwrites. |
| `authApi` + `handleApiError` | `src/ui/main-axios.ts` | Auth-attached axios instance + centralized error handling | Reuse. |
| `useHostTree` (via `hostTree` prop threading) | AppShell.tsx L242 (`realHostTree` state), L1568 (passed to `PrettyConversationsPanel`) | Fleet host list source | Reuse. The modal receives `hostTree` as a prop (same as `GlobalFilesModal` — L47 comment "Host tree from useHostTree() upstream — same source NewSessionDialog uses"). Skills-editor modal will accept the same prop. |
| `collectAllHosts(children)` + `isFolder(item)` | `GlobalFilesModal.tsx` L32-42 (duplicate the 11-line helper) | Flatten `HostFolder` tree + filter RDP-only hosts | Duplicate. Phase 23 also duplicated this from `NewSessionDialog.tsx` L83-100 + `CreateRoleDialog.tsx` L51-65 with an explicit note ("Third instance intentional — keeps plan 23-03 diff scoped to net-new files"). Fourth instance is same posture. |
| `TabState<T>` discriminated union | `IdentityFileTab.tsx` (imported by `GlobalFilesModal.tsx` L16) | `{ status: "loading" } \| { status: "ready", data: T } \| { status: "error", error: string }` | Import — do NOT redefine. |

### Alternatives Considered (and rejected)

| Instead of | Could Use | Why Rejected |
|------------|-----------|--------------|
| Adding endpoints to `global-files-read-write.ts` | Extending Phase 23's router with `?scope=skill` | Path validation model is fundamentally different (skills = per-user tree walk with `..` escape guard; global-files = static whitelist). Coupling them muddles the AUTH gate — better to keep separate routers with parallel structure. |
| Shadcn `<Select>` for skill picker | Radix `<Select>` primitive | UI-SPEC L237 explicitly locks native `<select>` (mirrors `GlobalFilesModal.tsx` L229-242). Preserves mobile behavior (iOS native picker sheet). |
| Custom recursive-walk in Node (`sftp.readdir` recursion) | Backend does a single `find` shell command | `find ~/.claude/skills/<skill> -type f -printf '%P\n'` gets flat path-relative labels in one round-trip. Faster + simpler than N recursive SFTP calls. Escape-safe when `<skill>` passes the AUTH gate (alphanumeric + `-` + `_`). |
| Client-side text detection via extension | Backend `file -b --mime` command | Extension-based is fastest but brittle (a `.txt` binary blob would still render); backend `file` is more accurate but the fleet may not have `file` installed. **Recommended path**: byte-sniffing in Node on the read response (see § Text Detection below) — no shell dependency, deterministic, cheap. |
| `window.confirm()` for delete-file/delete-skill | Modal-in-modal `Dialog` | UI-SPEC L182 explicitly prescribes modal-in-modal for user-initiated destruction; `window.confirm` is reserved for the inherited mtime-conflict flow (system-triggered clarification). |
| `fetch()` for API calls | Axios via `authApi` | `fetch()` loses the JWT auto-attach interceptor. Phase 19's streaming exception does not apply. |

**Installation (net-new packages):** NONE. Every dependency is already in the tree.

**Version verification:** No new packages, no npm install step. All existing package versions verified via `import` sites in reference files (`GlobalFilesModal.tsx`, `global-files-read-write.ts`, `identity-artifact-reader.ts`).

## Architecture Patterns

### System Architecture Diagram

```
[Ashley clicks "Edit skills…" in PrettyConversationsPanel header menu]
                                    │
                                    ▼
[SkillsEditorModal (React) — mounted with hostTree + defaultHostId props]
                                    │
                     ┌──────────────┴──────────────┐
                     │                              │
                     ▼                              │
              Host <select>                        │  (user picks a host)
              (flatHosts, non-RDP)                 │
                     │                              │
                     ▼                              │
              hostId set  ────────────────────────►│──────► GET /skills-editor/skills?hostId=<n>
                                                    │             │
                     ┌──────────────────────────────┘             ▼
                     │                                     [Express: skills-editor.ts]
                     ▼                                            │
              Skill <select>                                       │  authenticateJWT
              (populated from list-skills response)                │  resolveHostById(hostId, userId)
                     │                                             │  connectOneShot()
                     ▼                                             │  execCommand: `ls -1 ~/.claude/skills/`
              skill set  ─────────────────────────────────────────►│  (filter to directories only via find -maxdepth 1 -type d)
                                                                    │
                     ┌──────────────────────────────────────────────┘
                     │                     response: { skills: [{name}] }
                     ▼
              GET /skills-editor/files?hostId=<n>&skill=<s>
                              │
                              ▼
                    [Express: skills-editor.ts]
                              │  find ~/.claude/skills/<s> -type f -printf '%P\n'  (recursive, path-relative)
                              │
                              │  response: { files: [{ path }] }  (path is relative to skill root, e.g. "tests/basic.py")
                              │
                     ┌────────┘
                     ▼
              Tab strip renders (bottom of modal, horizontal-scroll wrapper)
              First tab auto-active
                     │
                     ▼
              POST /skills-editor/read      ─── per-tab lazy-load (identical timing to Phase 23's `readGlobalFile`)
              Body: { hostId, skill, path }
              Response: { content, mtime, size, isText }  ◄─── NEW: isText flag drives text-vs-placeholder branch
                     │
                     ▼
              SkillFileTab renders:
                     ├─ if isText → GlobalFileTab-analog (monospace textarea + Save button + mtime-conflict flow)
                     └─ if !isText → AlertTriangle + "Not a text file" placeholder
                     │
                     ▼
              [User edits text file, hits Save]
              PUT /skills-editor/write
              Body: { hostId, skill, path, content, expectedMtime }
              Response: 200 { mtime }  |  409 { error: "mtime mismatch", currentMtime, currentContent }
                     │
                     ▼
              [User clicks "+ Add file", enters name via window.prompt]
              POST /skills-editor/create
              Body: { hostId, skill, path }
              Response: 200 { path, mtime }  |  409 { error: "file exists" }
                     │
                     ▼
              [User clicks Trash2 next to Save → Delete file confirm dialog → Delete]
              DELETE /skills-editor/file
              Body: { hostId, skill, path }
              Response: 200 { ok: true }
                     │
                     ▼
              [User clicks Trash2 in header → Delete skill confirm dialog → Delete skill]
              DELETE /skills-editor/skill
              Body: { hostId, skill }
              Response: 200 { ok: true }
                     │
                     ▼
              [Every endpoint: connectOneShot → exec/SFTP → conn.end() in finally]
              [All paths pass through computeSafeAbsolutePath(skillRoot, relPath) with `..` escape guard]
              [Nginx: /skills-editor/* → proxy_pass http://127.0.0.1:30001 with proxy_read_timeout 15s + client_max_body_size 4M]
              [In BOTH docker/nginx.conf AND docker/nginx-https.conf — parity load-bearing per Phase 23 GEFM comments]
```

### Recommended Project Structure

```
src/
├── ui/
│   ├── api/
│   │   └── skills-api.ts                     # NEW — mirrors global-files-api.ts
│   └── features/
│       ├── pretty-view/
│       │   ├── SkillsEditorModal.tsx         # NEW — mirrors GlobalFilesModal.tsx
│       │   ├── SkillsEditorModal.test.tsx    # NEW — mirrors GlobalFilesModal.test.tsx
│       │   ├── SkillFileTab.tsx              # NEW — mirrors GlobalFileTab.tsx + non-text placeholder branch
│       │   ├── SkillFileTab.test.tsx         # NEW — mirrors GlobalFileTab.test.tsx
│       │   └── DeleteConfirmDialog.tsx       # NEW — generic destructive-confirm dialog (consumed by both delete-file + delete-skill flows)
│       └── pretty-conversations/
│           └── PrettyConversationsPanel.tsx  # MODIFIED — add `[skillsEditorModalOpen, ...]` state + `<SkillsEditorModal>` mount + menu item at L1616
├── backend/
│   └── database/
│       └── routes/
│           ├── skills-editor.ts              # NEW — single router with list-skills / list-files / read / write / create / delete-file / delete-skill (or split 2 files if planner prefers Phase 23 shape)
│           └── skills-editor.test.ts         # NEW — mirrors global-files-read-write.test.ts
docker/
├── nginx.conf                                # MODIFIED — add `location ~ ^/skills-editor(/.*)?$` block
└── nginx-https.conf                          # MODIFIED — same block, parity load-bearing
src/backend/database/database.ts              # MODIFIED — 2 lines: import + `app.use("/skills-editor", skillsEditorRoutes)`
```

### Pattern 1: The Phase 23 mirror-and-fork discipline

**What:** Every file in the Phase 44 file cluster has a direct precedent in the Phase 23 cluster. Byte-shape mirroring — copy the file, s/global-files/skills-editor/g, add the skill dimension, preserve every idiom (imports, error posture, hook order, JSX tree structure).

**When to use:** Every new file. The Phase 23 code is production-tested (in image `bb99f307bcb4` per STATE.md quick-260805-7rq) and its race conditions have already been debugged.

**Example** (from `GlobalFilesModal.tsx` L91-149, the lazy-load useEffect that the executor MUST preserve verbatim in `SkillsEditorModal.tsx` with `readGlobalFile` → `readSkillFile`):

```typescript
// Source: src/ui/features/pretty-view/GlobalFilesModal.tsx L116-149 (verbatim)
// Lazy-load content for the active tab (one at a time to avoid burning SSH connections)
useEffect(() => {
  if (selectedHostId == null || !activeTab) return;
  if (tabData.has(activeTab)) return; // already loaded
  let cancelled = false;
  setTabData((prev) => new Map(prev).set(activeTab, { status: "loading" }));
  readGlobalFile(selectedHostId, activeTab)
    .then((result) => {
      if (cancelled) return;
      setTabData((prev) =>
        new Map(prev).set(activeTab, {
          status: "ready",
          data: { content: result.content, mtime: result.mtime },
        }),
      );
    })
    .catch((err: unknown) => {
      if (cancelled) return;
      setTabData((prev) =>
        new Map(prev).set(activeTab, {
          status: "error",
          error: err instanceof Error ? err.message : "Failed to load",
        }),
      );
    });
  return () => {
    cancelled = true;
  };
  // Intentional exhaustive-deps violation: including `tabData` re-runs this effect after
  // `setTabData({loading})`, whose cleanup sets `cancelled = true` on the still-in-flight
  // `readGlobalFile` (see plan 260805-7rq). The `tabData.has(activeTab)` gate inside the
  // body is a deliberate stale-closure read — "if the currently-known map already tracks
  // this tab, skip".
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [selectedHostId, activeTab]);
```

**Critical:** The `eslint-disable` + comment MUST be preserved when copying — dropping `tabData` from the deps array is a load-bearing race fix from quick-260805-7rq (Ashley's 700ms SSH lazy-load infinite-spinner bug). Adding a third stateful selector layer (`selectedSkillName`) means the deps become `[selectedHostId, selectedSkillName, activeTab]` — still no `tabData` — same discipline.

### Pattern 2: Layer enumeration reflex (patch #446 arc)

**What:** Before shipping ANY request-path fix or new endpoint, name every layer the request traverses. STATE.md's `260814-mhd` entry and Phase 19 STATE lines both call out this lesson: `browser → Caddy → in-container nginx → Express`. Missing the in-container nginx block means the browser gets `index.html` and crashes on `.map`.

**When to use:** For every new backend route, add BOTH:
1. `docker/nginx.conf` — new `location ~ ^/skills-editor(/.*)?$` block
2. `docker/nginx-https.conf` — the same block (parity load-bearing)

**Example** (from `docker/nginx.conf` L286-306 — the Phase 23 exemplar):

```nginx
# Phase 44 SKILLED-01: /skills-editor regex block — method-agnostic so it covers
# GET (list-skills, list-files) + POST (read, create) + PUT (write) + DELETE
# (file, skill). Backing router is app.use("/skills-editor", ...) in database.ts.
# proxy_read_timeout 15s bounds the SSH round-trip (matches /global-files).
# client_max_body_size 4M accommodates PUT /write's full-file body.
# Parity between docker/nginx.conf and docker/nginx-https.conf is load-bearing
# per CLAUDE.md: missing in HTTPS conf means /skills-editor 200-returns
# index.html and crashes the frontend on `.map` in production.
location ~ ^/skills-editor(/.*)?$ {
    proxy_pass http://127.0.0.1:30001;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 15s;
    client_max_body_size 4M;
}
```

Add the identical block at the corresponding position in `docker/nginx-https.conf` (parallel L303 area near the existing `/global-files` block).

### Pattern 3: Path-safety gate (NEW — not present in Phase 23)

**What:** Phase 23 could rely on a static whitelist (`/app/data/global-files.json`); every user-supplied path had to appear verbatim in the operator-authored config, so `..` escapes were impossible. Phase 44 has no whitelist — the AUTH gate is instead "path is inside the resolved-absolute skill folder". This shifts responsibility from a JSON lookup to a robust path-normalization step.

**When to use:** On EVERY endpoint that accepts a `skill` or `path` argument, before ANY SSH exec or SFTP call.

**Recommended implementation** (place in the router's module scope):

```typescript
// SKILL name gate: alphanumeric, hyphen, underscore, dot; 1-128 chars.
// Rejects: `.`, `..`, empty, anything with a `/`, shell metacharacters.
const SKILL_NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;
function isValidSkillName(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (s === "." || s === "..") return false;
  return SKILL_NAME_RE.test(s);
}

// PATH gate: relative path with no leading slash, no `..` segment, no NUL byte.
// Empty string OK for "create" (would be a bug — reject upstream).
// Backslash tolerated (Linux fleet — see § Common Pitfalls).
function isSafeRelativePath(p: unknown): p is string {
  if (typeof p !== "string") return false;
  if (p.length === 0 || p.length > 512) return false;
  if (p.startsWith("/")) return false;
  if (p.includes("\0")) return false;
  const parts = p.split("/");
  for (const part of parts) {
    if (part === "" || part === "." || part === "..") return false;
  }
  return true;
}

/**
 * Build the absolute path to a file inside a skill on the remote host.
 * Requires `remoteHome` from `echo $HOME` (SFTP does not tilde-expand).
 * Returns `<remoteHome>/.claude/skills/<skill>/<relPath>` — plus a
 * post-hoc assertion that the resolved path starts with the skill root.
 * (The regex gates above make the assertion belt-and-suspenders — required
 * because path.join could in theory be surprised by future validation gaps.)
 */
function buildAbsSkillFilePath(remoteHome: string, skill: string, relPath: string): string {
  const skillRoot = `${remoteHome}/.claude/skills/${skill}`;
  const abs = `${skillRoot}/${relPath}`;
  // Defense-in-depth — the two regex gates above should already have
  // rejected any input capable of escaping, but assert the invariant.
  if (!abs.startsWith(skillRoot + "/")) {
    throw new Error("path escape detected");
  }
  return abs;
}
```

**Why this works vs. why alternatives fail:**
- **`path.resolve()`** — TEMPTING but wrong: `path` uses the *server's* OS conventions, not the target host's. On a Linux server calling into a Linux fleet this happens to work, but the invariant is coincidence. Prefer manual string composition + regex gate for auditability.
- **Passing raw user input to shell** — MUST be single-quote-escaped via `shellEscape()` even after the regex gate passes (defense-in-depth per Phase 23's AUTH-gate/INJECTION-gate split at `global-files-read-write.ts` L98-108).
- **SFTP `realpath()` check** — could ask the server to resolve symlinks and verify the result is inside the skill root. Adds one round-trip per operation. **Recommended follow-up** if any skill legitimately contains symlinks; for Phase 44 v1, the string-prefix assertion suffices.

### Pattern 4: SFTP for writes, SSH exec for everything else

**What:** Phase 23 established the two-channel pattern: SSH exec for read/mtime/directory-list queries (`cat`, `stat`, `find`, `ls`), SFTP for writes (`writeMarkdownFileAtomic` for atomic tmp+rename). Phase 44 inherits this.

**When to use:**
- **List skills:** exec `find ~/.claude/skills -mindepth 1 -maxdepth 1 -type d -printf '%f\n'`
- **List files inside skill:** exec `find <skillRoot> -type f -printf '%P\n' | sort` (path-relative + sorted for deterministic tab order)
- **Read file:** exec `cat <escapedPath>` + `stat -c '%Y'` + `stat -c '%s'` (unchanged from Phase 23) — but also detect isText (see § Text Detection)
- **Write file:** SFTP `writeMarkdownFileAtomic` (reuse)
- **Create empty file:** exec `touch <escapedPath>` or SFTP `writeFile(path, Buffer.alloc(0))` — either works; `touch` is cheaper because we're already using exec for the rest. **Recommendation:** `touch` + stat, mirrors read shape.
- **Delete file:** exec `rm -f <escapedPath>` (fails silently on missing — acceptable)
- **Delete skill:** exec `rm -rf <escapedSkillRoot>` (destructive; the safe-path assertion is critical)

### Anti-Patterns to Avoid

- **Introducing a new SSH helper module.** Reuse `connectOneShot` + `execCommand`. Duplicate `execWithTimeout` + `shellEscape` inline per Phase 23's precedent.
- **Storing skill list in Skynet DB.** Filesystem IS the source of truth. Do not add a `skills` table.
- **Caching `remoteHome` across requests.** Phase 23 re-runs `echo $HOME` per request (`global-files-read-write.ts` L200-216, L395-411) — Phase 44 must do the same. A cached HOME survives a host user change and produces a subtle write-to-wrong-user bug.
- **Optimistic UI updates on delete.** The tab strip / skill dropdown must refetch from the backend after any mutation succeeds — do NOT locally splice the deleted item. Mirrors Phase 23's server-echo-authoritative pattern for mtime.
- **Reusing `global-files.json` as the "skills whitelist."** There is no whitelist for skills. The whitelist IS the skill folder; the path-safety gate IS the AUTH gate.
- **Using `fetch()` for API calls.** Use `authApi` from `@/main-axios` for JWT auto-attach.
- **Using shadcn `<Select>` for the skill picker.** UI-SPEC L237 locks native `<select>`.
- **Missing the second nginx config block.** Patch #446 arc lesson.
- **Extracting `execWithTimeout` / `shellEscape` / `collectAllHosts` into a shared module as part of Phase 44.** This is Post-Planning-Gaps material — Phase 23 explicitly deferred it ("Third instance intentional — keeps plan 23-03 diff scoped to net-new files"). Fourth instance stays the same posture.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSH connection to a managed host | Custom `ssh2.Client` wrapper | `connectOneShot(host, 5000)` from `src/backend/ssh/ssh-one-shot.ts` | Handles password + key auth + timeout + `hostVerifier: () => true` (correct for tailnet-scoped fleet). |
| Atomic file write | Plain `sftp.writeFile` or `sftp.rename` | `writeMarkdownFileAtomic(conn, targetPath, contents)` from `identity-artifact-reader.ts` | `sftp.rename` fails with `SSH2_FX_FAILURE` when overwriting an existing target — see the 25-line prologue at L1039-1063. Ashley's "sometimes it works, sometimes it doesn't" saves were this exact trap. `ext_openssh_rename` (posix-rename@openssh.com) has POSIX rename(2) semantics and is universal on OpenSSH ≥5.1 (2008+). |
| Recursive directory walk over SFTP | JavaScript recursion with `sftp.readdir` per level | Backend `find <root> -type f -printf '%P\n'` shell command | One round-trip vs N. `%P` prints path relative to the starting point — exactly what D-05 requires for tab labels. |
| Host tree flattening + RDP filter | Custom recursion | Duplicate `collectAllHosts` + `isFolder` from `GlobalFilesModal.tsx` L32-42 | Phase 23 precedent. |
| Optimistic-concurrency conflict handling on save | Custom mtime comparison + custom error shape | Reuse Phase 23's 409 protocol: request carries `expectedMtime`; on mismatch backend returns `409 { error: "mtime mismatch", currentMtime, currentContent }`; frontend throws `GlobalFileMtimeConflictError`-shaped class and offers reload | Battle-tested end-to-end (patch #191 + quick-260805-70q + quick-260805-7rq stack). Do NOT invent a different shape for skills. Recommend: `SkillFileMtimeConflictError` class in `skills-api.ts` with byte-identical shape to `GlobalFileMtimeConflictError`. |
| Per-user host isolation | Custom SQL join | `resolveHostById(hostId, userId)` from `src/backend/ssh/host-resolver.ts` | Handles owner + credential resolution + shared credential + user override — 200 lines of subtlety already debugged. |
| JWT auth middleware | Custom bearer parsing | `AuthManager.getInstance().createAuthMiddleware()` | Same middleware every route in the codebase uses. |
| Text-vs-binary detection | Extension list | Byte-sniff on the read response (see § Text Detection below) | Extensions lie (a `.md` binary blob would false-positive). |
| Frontend HTTP client | `fetch()` | `authApi` from `@/main-axios` | JWT auto-attach + centralized error handling + `dbHealthMonitor` integration. |
| Modal shell | Custom overlay + focus trap | `radix-ui`'s `Dialog.Root/Portal/Overlay/Content` with the exact glass styling from `GlobalFilesModal.tsx` L186-217 | UI-SPEC mandates verbatim mirror. |

**Key insight:** This phase installs zero new dependencies. Every capability is already present. The plan should be characterized by "duplicate, s/global-files/skills-editor/g, add the skill dimension" — NOT "install X, write Y, integrate Z."

## Backend Endpoint Recommendations

The following is the recommended endpoint surface. Names/paths are Claude's Discretion per CONTEXT — planner may adjust, but these mirror the Phase 23 shape and are the least-surprise choice.

### Router: `src/backend/database/routes/skills-editor.ts` (single file — Phase 23 split into two because the list route was landed a wave earlier; Phase 44 doesn't need to)

Alternate: split into `skills-editor-list.ts` + `skills-editor-mutate.ts` if the planner prefers wave-parallel builds. Express chains routers on the same base path (Phase 23 precedent — `database.ts` L1852+L1857).

**Mount:** `app.use("/skills-editor", skillsEditorRoutes)` in `src/backend/database/database.ts` alongside the existing `/global-files` mounts (~L1852-1857).

### Endpoint 1 — `GET /skills-editor/skills?hostId=<n>`

- **Purpose:** Enumerate skills on the host.
- **Auth:** `authenticateJWT` + `resolveHostById(hostId, userId)`.
- **Body:** none (query string only).
- **SSH command:** `find ~/.claude/skills -mindepth 1 -maxdepth 1 -type d -printf '%f\n' 2>/dev/null | sort`
  - Tilde-expansion caveat: `find` DOES perform tilde expansion (it's a bash command, not shell-quoted). Verify with a smoke test; if the shell doesn't expand tilde in this context, do the `echo $HOME` two-step per Phase 23 precedent.
- **Response 200:** `{ skills: [{ name: string }] }`
  - Empty array when directory doesn't exist (not 404 — mirrors GEFM-03 "missing = empty state").
- **Response 400:** invalid `hostId`.
- **Response 404:** unknown/cross-user host.
- **Response 502:** SSH connect fail.

### Endpoint 2 — `GET /skills-editor/files?hostId=<n>&skill=<s>`

- **Purpose:** Recursively list files inside a skill; return path-relative labels for flat tabs (D-05).
- **Auth:** `authenticateJWT` + `resolveHostById(hostId, userId)` + `isValidSkillName(skill)`.
- **SSH command:** After `echo $HOME` → `remoteHome`, exec `find <escapedSkillRoot> -type f -printf '%P\n' 2>/dev/null | sort`
  - `%P` = path relative to the starting point (exactly what D-05 requires — a file at `<skill>/tests/basic.py` becomes `tests/basic.py`).
  - `sort` gives deterministic tab order (alphabetical).
- **Response 200:** `{ files: [{ path: string }] }`
  - Empty array when skill has zero files (renders the "This skill has no files. Use + Add file to create one." empty state per UI-SPEC).
- **Response 400:** invalid hostId or skill name.
- **Response 404:** unknown host OR skill doesn't exist on that host. Distinction not required — either returns empty file list, and the frontend already has to handle the skill dropdown drift case anyway.
- **Response 502:** SSH connect fail.

### Endpoint 3 — `POST /skills-editor/read`

- **Purpose:** Read a file's content + isText metadata.
- **Body:** `{ hostId: number, skill: string, path: string }`
- **Auth:** `authenticateJWT` + `resolveHostById` + `isValidSkillName(skill)` + `isSafeRelativePath(path)`.
- **SSH commands** (same shape as Phase 23):
  ```
  cat <escapedAbsPath> 2>/dev/null || true
  stat -c '%Y' <escapedAbsPath> 2>/dev/null || echo 0
  stat -c '%s' <escapedAbsPath> 2>/dev/null || echo 0
  ```
- **Text-detection:** Node-side sniff (see § Text Detection below); do NOT invoke `file` on the remote.
- **Response 200:** `{ content: string, mtime: number, size: number, isText: boolean }`
- **Response 400:** validation fail.
- **Response 404:** host not found.
- **Response 502:** SSH connect fail.

### Endpoint 4 — `PUT /skills-editor/write`

- **Purpose:** Save a file with optimistic-concurrency mtime check.
- **Body:** `{ hostId, skill, path, content: string, expectedMtime?: number }`
- **Auth:** `authenticateJWT` + `resolveHostById` + `isValidSkillName(skill)` + `isSafeRelativePath(path)` + `Buffer.byteLength(content, "utf-8") <= MAX_CONTENT_BYTES`.
- **SSH commands:** same as Phase 23 write handler (`global-files-read-write.ts` L279-501) — `echo $HOME` → build absPath → optional mtime check → `writeMarkdownFileAtomic(conn, absPath, content)` → re-stat.
- **Response 200:** `{ mtime: number }` (server-authoritative new mtime).
- **Response 409:** `{ error: "mtime mismatch", currentMtime, currentContent }` — byte-identical to Phase 23 shape so frontend can share the error class (or duplicate it).
- **Response 400 / 404 / 502:** as above.
- **Notes:**
  - Reject write on non-text file? **Recommended: NO.** The frontend gates via the isText flag; if a user finds a way to POST binary content (e.g., pasting from a hex editor), let them — mirrors D-12 trust-the-user posture. The MAX_CONTENT_BYTES cap is the only hard limit.
  - `writeMarkdownFileAtomic` accepts arbitrary UTF-8 content (its name is historical — see L1029-1030 "arbitrary UTF-8 content despite its name").

### Endpoint 5 — `POST /skills-editor/create`

- **Purpose:** Create a new empty file at the skill's root.
- **Body:** `{ hostId, skill, path: string }` (path is a filename; validated via `isSafeRelativePath` which accepts subdirectories too — but D-09 says "at the skill's root", so the planner may additionally reject paths containing `/`. Recommendation: allow subpath creation via prompt; if operator types `tests/basic.py`, honor it. If the required parent directory doesn't exist, `touch` will fail; surface the error).
- **Auth:** as read.
- **SSH commands:**
  ```
  # 1. Reject if already exists (idempotent-create is a bug — user would be confused)
  test -e <escapedAbsPath> && echo "exists" || echo "ok"
  # 2. Ensure parent dir exists (for subpaths)
  mkdir -p <escapedParentDir>
  # 3. Touch the file
  touch <escapedAbsPath>
  # 4. Stat for mtime
  stat -c '%Y' <escapedAbsPath>
  ```
- **Response 200:** `{ path: string, mtime: number }`
- **Response 409:** `{ error: "file exists" }` — file already exists at that path.
- **Response 400 / 404 / 502:** as above.

### Endpoint 6 — `DELETE /skills-editor/file`

- **Purpose:** Delete a single file inside a skill.
- **Body:** `{ hostId, skill, path: string }`
- **Auth:** as read.
- **SSH command:** `rm -f <escapedAbsPath>`
  - `-f` = don't error on missing (idempotent delete is safe).
- **Response 200:** `{ ok: true }`
- **Response 400 / 404 / 502:** as above.

### Endpoint 7 — `DELETE /skills-editor/skill`

- **Purpose:** Delete an entire skill (folder + all contents).
- **Body:** `{ hostId, skill: string }`
- **Auth:** `authenticateJWT` + `resolveHostById` + `isValidSkillName(skill)`.
- **SSH command:** `rm -rf <escapedSkillRoot>`
  - **CRITICAL:** the path-safety gate is life-critical here. A skill name that escapes validation and resolves to `~/` would `rm -rf ~/`. Every gate must fire before the SSH command runs.
- **Response 200:** `{ ok: true }`
- **Response 400 / 404 / 502:** as above.

## Text Detection

**Decision:** Node-side byte-sniffing on the read response — `isText` flag on the read endpoint's response.

**Why not extension-based:** Brittle. A `.md` binary blob (`file` header disguise) false-positives; a `.pyc` compiled Python file (which some skills may contain in `__pycache__`) is correctly detected as binary via bytes but ambiguous via extension.

**Why not remote `file` command:** Adds a shell dependency; not universal across fleet hosts; adds SSH round-trip.

**Recommended sniff heuristic** (place in the router, use on every `POST /read`):

```typescript
/**
 * Returns true when the content buffer appears to be UTF-8 text.
 * Heuristic (order matters):
 *   1. Empty file → text (harmless, editable).
 *   2. Any NUL byte in the first 8KB → binary. (Classic sniff — text files
 *      never contain NUL; binaries almost always do near the header.)
 *   3. Any byte in [0x01..0x08, 0x0E..0x1F] excluding common whitespace
 *      (0x09 tab, 0x0A LF, 0x0D CR) → binary. (These are non-printable
 *      control chars that legitimately never appear in text.)
 *   4. Attempt UTF-8 decode of first 8KB — if it throws or produces
 *      replacement chars (0xFFFD) → binary.
 *   5. Otherwise text.
 */
function detectIsText(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  const window = buf.slice(0, Math.min(8192, buf.length));
  for (let i = 0; i < window.length; i++) {
    const b = window[i];
    if (b === 0) return false;                          // NUL byte
    if (b <= 0x08) return false;                        // control chars
    if (b >= 0x0E && b <= 0x1F) return false;           // more control chars
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(window);
    if (decoded.includes("�")) return false;
    return true;
  } catch {
    return false;
  }
}
```

**Where to place it:**
- **Backend read endpoint** — run on the `cat` output before wrapping in the response. Return `{ content, mtime, size, isText }`. The frontend does zero sniffing; it just renders the placeholder when `!isText`.
- **Content field for non-text:** Return the content string anyway (from `cat`, which produces mostly-valid UTF-8 with lots of replacement chars) — but the frontend renders the placeholder, so the content is not shown. Alternative: return `content: ""` for `isText: false` to save bandwidth. **Recommendation:** return empty content for non-text — reduces payload + prevents accidental display bugs.

**Global-files precedent for text detection:** Global-files did NOT solve this problem because its whitelist was operator-authored to only include known-text files (`~/.claude/CLAUDE.md`, `~/.claude/settings.json`). Phase 44's "any file in the skill" scope introduces this need.

## The Menu Mount Site

**File:** `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx`

**Two edits:**

1. **State + modal mount** — after existing `[globalFilesModalOpen, setGlobalFilesModalOpen] = useState(false)` at L485, add a parallel `[skillsEditorModalOpen, setSkillsEditorModalOpen] = useState(false)`. After the existing `<GlobalFilesModal ... />` mount at L1583-1588, add a parallel `<SkillsEditorModal ... />` mount with `hostTree={hostTree ?? null}` and `defaultHostId={null}` (mirroring the existing wiring exactly — the panel header has no active-conversation context, so both modals fall through to their own host picker).

2. **Menu item** — at L1616 (inside the menu-items array), add a new entry AFTER the existing `"Edit global files…"` entry per UI-SPEC L112:
   ```typescript
   { label: "Edit global files…", onClick: () => setGlobalFilesModalOpen(true) },
   { label: "Edit skills…", onClick: () => setSkillsEditorModalOpen(true) },
   ```
   The menu already inflates on mobile via `max-md:py-[18px] max-md:px-[14px]` at L1623 — the new item inherits automatically.

**hostTree source:** already threaded from `AppShell.tsx` L1568 (`hostTree={realHostTree}`) which is `useState<HostFolder | null>(null)` at L242. Same source `GlobalFilesModal`, `NewSessionDialog`, and `CreateRoleDialog` all consume.

## Test Seam / In-Process Testing

**Framework:** Vitest 4.1.8 (verified via `package.json`) + `@testing-library/react` (already in dev deps — used by `GlobalFilesModal.test.tsx`).

**Existing pattern for Phase 23 tests:**

- `src/ui/features/pretty-view/GlobalFilesModal.test.tsx` — component-level in-process test that mocks `@/api/global-files-api` at the module boundary. Renders `GlobalFilesModal` with a fabricated `HostFolder`. Asserts on rendered DOM (textbox contents, spinner, error text). The exact pattern to mirror.
- `src/backend/database/routes/global-files-read-write.test.ts` — backend route tests that mock SSH and assert on response bodies + status codes.

**Recommended Phase 44 tests:**

| Test file | Mirrors | What it covers |
|-----------|---------|----------------|
| `src/ui/features/pretty-view/SkillsEditorModal.test.tsx` | `GlobalFilesModal.test.tsx` (racial-load regression + basic host-select-triggers-load) | Mock `skills-api.ts`. Assert: (a) modal opens with host `<select>` populated; (b) picking a host triggers `listSkills`; (c) picking a skill triggers `enumerateSkillFiles`; (d) auto-active first tab triggers `readSkillFile`; (e) 700ms-delayed `readSkillFile` still renders content (racial-load regression, verbatim from Phase 23's 260805-7rq); (f) `+ Add file` prompt round-trip creates + refetches; (g) delete-file confirm dialog appears + destructive path fires DELETE. |
| `src/ui/features/pretty-view/SkillFileTab.test.tsx` | `GlobalFileTab.test.tsx` | Assert: (a) text file renders textarea; (b) `isText: false` renders `AlertTriangle` + "Not a text file"; (c) Save button disabled when draft === state.data.content; (d) mtime-conflict flow (via mocked `onSave` throwing `SkillFileMtimeConflictError`). |
| `src/backend/database/routes/skills-editor.test.ts` | `global-files-read-write.test.ts` (the 533-line existing test file) | Mock `connectOneShot` + `execCommand` + `writeMarkdownFileAtomic`. Assert per endpoint: happy-path 200, 400 on invalid body, 404 on cross-user host, 502 on SSH fail. Critical additional coverage: path-escape rejection (`skill = "../etc/passwd"`, `path = "../../root/.ssh/id_rsa"`, etc.) — 400 with `path escape detected` or 400 from the regex gate. |

**In-process integration testing:** Skynet does NOT currently have a full-stack in-process harness (there is no VMS ViewModelShell equivalent). Test discipline is: (1) frontend component tests mock the API layer, (2) backend route tests mock the SSH layer. E2E is manual via Ashley UAT after deploy.

**Recommendation for Phase 44:** Match Phase 23's test posture exactly. Do NOT introduce a new integration harness — that would be a phase of its own. Component tests + route tests give sufficient coverage; the Ashley UAT after deploy validates end-to-end.

**Wave 0 note:** No fixture files, framework setup, or shared harness are needed — everything is in place. First test in each new test file inherits the mocking pattern from its mirror source.

## Runtime State Inventory

Phase 44 is a **greenfield feature addition** — it introduces new state (skill dropdown selection, per-skill tab data cache) rather than renaming or refactoring existing state. Therefore the runtime state inventory is minimal, but audited for completeness:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — filesystem on the managed host IS the source of truth for skills; no Skynet DB row is added. | None. |
| Live service config | None — no external service (n8n, Datadog, Tailscale) touched. | None. |
| OS-registered state | None — no Windows Task Scheduler, launchd, systemd, or pm2 process introduced. | None. |
| Secrets / env vars | None — reuses the SSH credential resolution (`resolveHostById`) that Phase 23 uses; no new secret keys. | None. |
| Build artifacts | None — no npm packages installed, no pyproject.toml, no compiled binaries. `npm run build` picks up the new frontend files automatically via Vite's file-glob discovery. | None. |

## Common Pitfalls

### Pitfall 1: Path escape via `..` or absolute paths

**What goes wrong:** A skill named `../etc` or a file path of `../../../etc/passwd` slips through validation, `rm -rf` obliterates the wrong tree, or `cat` reads a secret file.

**Why it happens:** Phase 23 could rely on a static whitelist — every path had to match a JSON entry verbatim. Phase 44 has no whitelist because the "whitelist" IS the skill folder. First time this codebase has a route where user input directly composes a filesystem path.

**How to avoid:**
- Regex gate for skill name: `/^[a-zA-Z0-9._-]{1,128}$/` + explicit reject of `.` and `..`.
- Regex gate for path: reject leading `/`, reject any `..` segment, reject empty segments, reject NUL bytes, reject anything over 512 chars.
- After compose, assert `abs.startsWith(skillRoot + "/")` as belt-and-suspenders.
- Single-quote `shellEscape` after regex gates (double defense).
- Test coverage: dedicated tests for `skill = ".."`, `skill = "../etc"`, `path = "../../../etc/passwd"`, `path = "/etc/passwd"`, `path = "foo\0.txt"` — ALL must return 400.

**Warning signs:** Any endpoint that touches `${skill}` or `${path}` without going through the gate is a bug. Grep the router file for `${skill` and `${path` — every hit must be inside the escape+assert path.

### Pitfall 2: Missing nginx location block (patch #446 layer-enumeration reflex)

**What goes wrong:** Backend routes work locally, but production requests to `/skills-editor/*` return `index.html` (the SPA catch-all), and the frontend crashes trying to parse it as JSON. Or in a subtler flavor: the browser gets HTML back where it expected JSON, and a `.split(".")` on the response body throws.

**Why it happens:** Skynet's nginx catches everything unmatched with a SPA fallback (`try_files $uri /index.html`). New backend paths need explicit `location` blocks. Skynet has TWO nginx configs (HTTP + HTTPS) and BOTH must have the block — a mismatch means dev works but prod breaks (or vice versa).

**How to avoid:**
- Add `location ~ ^/skills-editor(/.*)?$` to BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`.
- Match the Phase 23 block byte-shape (see § Pattern 2 above): `proxy_read_timeout 15s; client_max_body_size 4M;`.
- Verify with `grep -n "skills-editor" docker/nginx.conf docker/nginx-https.conf` — must be present in both.
- Add a plan verification task: nginx-syntax validation via `envsubst` + `docker run --rm nginx:1.27-alpine nginx -t` on both files (see Phase 19 STATE.md `19-BUILD-VERIFY-LOG.md` note for the exact incantation).

**Warning signs:** Any frontend request to a new backend route returning HTML instead of JSON. Any `Unexpected token '<'` runtime error in the browser console.

### Pitfall 3: SFTP `rename` trap on file overwrite (patch quick-260802-qrw)

**What goes wrong:** Save works the first time (file didn't exist yet) but fails on every subsequent save with a bare `Error: Failure` (code 4, empty error string).

**Why it happens:** SFTPv3's `SSH_FXP_RENAME` cannot atomically overwrite an existing target. OpenSSH's `process_rename` tries `link(old, new)` first; on `EEXIST` it falls through to `SSH2_FX_FAILURE`.

**How to avoid:** Use `writeMarkdownFileAtomic` (which uses `ext_openssh_rename` under the hood) for every write. See `identity-artifact-reader.ts` L1039-1063 prologue for the full 25-line explanation. Do NOT invoke `sftp.rename` directly. Do NOT introduce a competing write helper.

**Warning signs:** Any `sftp.rename(` in Phase 44 code. Any bare "Error: Failure" surfacing from a save.

### Pitfall 4: React useEffect race — lazy-load spinner-forever (quick-260805-7rq)

**What goes wrong:** After picking a skill/tab, the modal spins forever even though the network tab shows the read returning 200 with content.

**Why it happens:** If `tabData` is in the useEffect deps array, the effect re-runs after `setTabData({loading})`, whose cleanup sets `cancelled = true` on the still-in-flight `readSkillFile`. The result never lands.

**How to avoid:** COPY the Phase 23 useEffect verbatim including the `eslint-disable-next-line react-hooks/exhaustive-deps` and the multi-line comment explaining why. Deps array is `[selectedHostId, activeTab]` (Phase 44 adds `[selectedHostId, selectedSkillName, activeTab]` — still no `tabData`).

**Warning signs:** Any tuning of the deps array. Any "help I made it stricter" moment.

### Pitfall 5: Missing `echo $HOME` two-step (patch quick-260805-70q)

**What goes wrong:** Save silently 409s on every attempt even for a fresh unchanged file, because `stat -c '%Y' '~/.claude/skills/...'` returns 0 (literal `~` doesn't get shell-expanded when single-quoted).

**Why it happens:** SFTP does not tilde-expand paths. Single-quote shell escaping ALSO suppresses tilde expansion. Every path that starts with `~/` must be pre-resolved via `echo $HOME` before any shell interpolation.

**How to avoid:** Follow Phase 23's pattern (`global-files-read-write.ts` L200-216, L395-411) EXACTLY. `echo $HOME` runs first; if the result starts with `~` or is empty, bail with 502 (not a silent zero-mtime).

**Warning signs:** Any path constructed with `~/.claude/skills/...` that hits SFTP or shell-quoted stat/cat/rm without first resolving `$HOME`.

### Pitfall 6: File-count > tab-strip-width without horizontal scroll

**What goes wrong:** A skill with 40 files renders 40 tabs at 100+ pixels each in a flex-row without overflow — pushes the modal off-screen.

**Why it happens:** D-06 requires horizontal scroll on the tab bar for the crazy-file-count case. Phase 23's global-files editor never triggers this because a global-files.json rarely has > 5 entries.

**How to avoid:** UI-SPEC L257 prescribes wrapping the bottom tab bar in `overflow-x-auto` with `-webkit-overflow-scrolling: touch`. Verify: mount a test with a fabricated 50-file skill; assert the tab strip's container has `overflow-x-auto` class OR renders as horizontally scrollable.

### Pitfall 7: RDP-enabled host in the picker (Phase 23 filter)

**What goes wrong:** User picks an RDP-only host (a Windows box) and the SSH connect silently fails or times out.

**Why it happens:** RDP hosts don't have SSH configured. Phase 23 filters them out at `GlobalFilesModal.tsx` L68: `.filter((h) => h.enableRdp !== true)`.

**How to avoid:** Copy the filter verbatim in `SkillsEditorModal`.

**Warning signs:** Any host list without the `enableRdp !== true` filter.

### Pitfall 8: Menu-order regression via string-array shuffle

**What goes wrong:** The `"Edit skills…"` entry ends up above `"Edit global files…"`, or above `"New agent"` — subtle UX degradation not caught by tests.

**Why it happens:** UI-SPEC L112 locks position (after `"Edit global files…"`). Refactors that alphabetize the array or reshape the menu could silently violate this.

**How to avoid:** Add a test in `PrettyConversationsPanel.test.tsx` (if it exists — verify) that asserts menu item ordering. OR add a `// KEEP ORDER: New agent → New role → Edit global files… → Edit skills…` comment above the array.

### Pitfall 9: Backslash paths on Linux fleet

**What goes wrong:** A user creates a file named `foo\bar.py` — this is a valid Linux filename (backslash is legal) but might trip up validation code that assumes `\` means path separator.

**Why it happens:** Skynet's fleet is Debian/Ubuntu (per Phase 23 GEFM-06). Backslash in a Linux filename is just a character. But if the validation regex or the path split logic conflates it with `/`, weird bugs happen.

**How to avoid:** The recommended regex `/^[a-zA-Z0-9._-]{1,128}$/` for skill names rejects backslash. The `isSafeRelativePath` for file paths splits ONLY on `/`. Do NOT introduce a `\\` case.

## Code Examples

Verified patterns from the in-repo sources. Executor should copy these directly.

### Backend endpoint skeleton (mirror of `global-files-read-write.ts`)

```typescript
// Source: src/backend/database/routes/global-files-read-write.ts L119-266 (POST /read handler)
// SKILLS-EDITOR ADAPTATION: add skill validation, replace whitelist check with path-safety gate,
// add isText detection to response.

import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { writeMarkdownFileAtomic } from "../../claude-session/identity-artifact-reader.js";
import { sshLogger } from "../../utils/logger.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

const SSH_CONNECT_TIMEOUT_MS = 5000;
const SSH_EXEC_TIMEOUT_MS = 5000;
const MAX_PATH_LENGTH = 512;
const MAX_CONTENT_BYTES = 2_000_000;
const SKILL_NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/;

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

function execWithTimeout(conn: Awaited<ReturnType<typeof connectOneShot>>, command: string, timeoutMs = SSH_EXEC_TIMEOUT_MS): Promise<string> {
  return Promise.race([
    execCommand(conn, command),
    new Promise<string>((_, reject) => setTimeout(() => reject(new Error(`SSH exec timeout after ${timeoutMs}ms`)), timeoutMs)),
  ]);
}

function isValidSkillName(s: unknown): s is string {
  if (typeof s !== "string") return false;
  if (s === "." || s === "..") return false;
  return SKILL_NAME_RE.test(s);
}

function isSafeRelativePath(p: unknown): p is string {
  if (typeof p !== "string") return false;
  if (p.length === 0 || p.length > MAX_PATH_LENGTH) return false;
  if (p.startsWith("/")) return false;
  if (p.includes("\0")) return false;
  for (const part of p.split("/")) {
    if (part === "" || part === "." || part === "..") return false;
  }
  return true;
}

function detectIsText(buf: Buffer): boolean {
  if (buf.length === 0) return true;
  const window = buf.slice(0, Math.min(8192, buf.length));
  for (let i = 0; i < window.length; i++) {
    const b = window[i];
    if (b === 0) return false;
    if (b <= 0x08) return false;
    if (b >= 0x0E && b <= 0x1F) return false;
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(window);
    if (decoded.includes("�")) return false;
    return true;
  } catch {
    return false;
  }
}

// POST /skills-editor/read — mirror the shape of global-files-read-write.ts L119-266
router.post("/read", express.json({ limit: "32kb" }), authenticateJWT, async (req, res): Promise<void> => {
  const userId = (req as AuthenticatedRequest).userId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const rawHostId = body.hostId;
  const rawSkill = body.skill;
  const rawPath = body.path;

  if (typeof rawHostId !== "number" || !Number.isInteger(rawHostId) || rawHostId <= 0) {
    res.status(400).json({ error: "hostId must be a positive integer" });
    return;
  }
  if (!isValidSkillName(rawSkill)) {
    res.status(400).json({ error: "invalid skill name" });
    return;
  }
  if (!isSafeRelativePath(rawPath)) {
    res.status(400).json({ error: "invalid path" });
    return;
  }
  const hostId = rawHostId;
  const skill = rawSkill;
  const relPath = rawPath;

  const host = await resolveHostById(hostId, userId);
  if (!host) {
    res.status(404).json({ error: "Host not found" });
    return;
  }

  let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
  try {
    try {
      conn = await connectOneShot(host as unknown as Parameters<typeof connectOneShot>[0], SSH_CONNECT_TIMEOUT_MS);
    } catch (err) {
      sshLogger.warn("skills-editor read: SSH connect failed", { operation: "skills_editor_read_connect", hostId, error: err instanceof Error ? err.message : "Unknown" });
      res.status(502).json({ error: "SSH connect failed" });
      return;
    }

    // Resolve $HOME because SFTP + single-quoted shell interpolation both suppress tilde expansion
    const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
    if (!remoteHome || remoteHome.startsWith("~")) {
      res.status(502).json({ error: "could not resolve remote HOME" });
      return;
    }

    const skillRoot = `${remoteHome}/.claude/skills/${skill}`;
    const absPath = `${skillRoot}/${relPath}`;
    // Belt-and-suspenders assertion — the regex gates above should have made this unreachable
    if (!absPath.startsWith(skillRoot + "/")) {
      res.status(400).json({ error: "path escape detected" });
      return;
    }

    const escapedPath = shellEscape(absPath);
    const content = await execWithTimeout(conn, `cat ${escapedPath} 2>/dev/null || true`);
    const mtime = parseInt((await execWithTimeout(conn, `stat -c '%Y' ${escapedPath} 2>/dev/null || echo 0`)).trim(), 10);
    const size = parseInt((await execWithTimeout(conn, `stat -c '%s' ${escapedPath} 2>/dev/null || echo 0`)).trim(), 10);
    const isText = detectIsText(Buffer.from(content, "utf-8"));

    res.json({
      content: isText ? content : "",  // empty content for binary — placeholder rendered client-side
      mtime: Number.isFinite(mtime) ? mtime : 0,
      size: Number.isFinite(size) ? size : 0,
      isText,
    });
  } catch (err) {
    sshLogger.error("skills-editor read: unexpected error", { operation: "skills_editor_read_error", hostId, error: err instanceof Error ? err.message : "Unknown" });
    if (!res.headersSent) res.status(500).json({ error: "internal" });
  } finally {
    if (conn) { try { conn.end(); } catch { /* best-effort */ } }
  }
});
```

### Frontend API helper (mirror of `global-files-api.ts`)

```typescript
// Source: src/ui/api/global-files-api.ts L1-99 (byte-shape verbatim, s/global-files/skills-editor/g + skill dimension)

import { authApi, handleApiError } from "@/main-axios";

export type SkillEntry = { name: string };
export type SkillFileEntry = { path: string };
export type SkillFileReadResult = { content: string; mtime: number; size: number; isText: boolean };
export type SkillFileWriteInput = { hostId: number; skill: string; path: string; content: string; expectedMtime?: number };
export type SkillFileWriteResult = { mtime: number };

export class SkillFileMtimeConflictError extends Error {
  constructor(public readonly currentMtime: number, public readonly currentContent: string) {
    super("mtime mismatch");
    this.name = "SkillFileMtimeConflictError";
  }
}

export class SkillFileAlreadyExistsError extends Error {
  constructor() {
    super("file exists");
    this.name = "SkillFileAlreadyExistsError";
  }
}

export async function listSkills(hostId: number): Promise<SkillEntry[]> {
  try {
    const response = await authApi.get("/skills-editor/skills", { params: { hostId } });
    return (response.data as { skills: SkillEntry[] }).skills;
  } catch (error) {
    handleApiError(error, "list skills for host");
    throw error;
  }
}

export async function enumerateSkillFiles(hostId: number, skill: string): Promise<SkillFileEntry[]> {
  try {
    const response = await authApi.get("/skills-editor/files", { params: { hostId, skill } });
    return (response.data as { files: SkillFileEntry[] }).files;
  } catch (error) {
    handleApiError(error, "list files in skill");
    throw error;
  }
}

export async function readSkillFile(hostId: number, skill: string, path: string): Promise<SkillFileReadResult> {
  try {
    const response = await authApi.post("/skills-editor/read", { hostId, skill, path });
    return response.data as SkillFileReadResult;
  } catch (error) {
    handleApiError(error, "read skill file");
    throw error;
  }
}

export async function writeSkillFile(input: SkillFileWriteInput): Promise<SkillFileWriteResult> {
  try {
    const response = await authApi.put("/skills-editor/write", input);
    return response.data as SkillFileWriteResult;
  } catch (error) {
    const err = error as { response?: { status?: number; data?: { currentMtime?: number; currentContent?: string } } };
    if (err?.response?.status === 409) {
      throw new SkillFileMtimeConflictError(err.response.data?.currentMtime ?? 0, err.response.data?.currentContent ?? "");
    }
    handleApiError(error, "write skill file");
    throw error;
  }
}

export async function createSkillFile(hostId: number, skill: string, path: string): Promise<{ path: string; mtime: number }> {
  try {
    const response = await authApi.post("/skills-editor/create", { hostId, skill, path });
    return response.data as { path: string; mtime: number };
  } catch (error) {
    const err = error as { response?: { status?: number } };
    if (err?.response?.status === 409) throw new SkillFileAlreadyExistsError();
    handleApiError(error, "create skill file");
    throw error;
  }
}

export async function deleteSkillFile(hostId: number, skill: string, path: string): Promise<void> {
  try {
    await authApi.delete("/skills-editor/file", { data: { hostId, skill, path } });
  } catch (error) {
    handleApiError(error, "delete skill file");
    throw error;
  }
}

export async function deleteSkill(hostId: number, skill: string): Promise<void> {
  try {
    await authApi.delete("/skills-editor/skill", { data: { hostId, skill } });
  } catch (error) {
    handleApiError(error, "delete skill");
    throw error;
  }
}
```

### The recursive-listing shell command

```bash
# Source: recommended for GET /skills-editor/files
# `-type f`  → only regular files (no directories in the tab strip — they're implicit via path prefix)
# `-printf '%P\n'` → print path relative to the starting point (D-05 requirement)
# `2>/dev/null` → swallow permission errors (skills should be readable, but defensive)
# `sort` → deterministic tab order
find <escapedSkillRoot> -type f -printf '%P\n' 2>/dev/null | sort
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| SFTP `rename()` for atomic file writes | `ext_openssh_rename` (posix-rename@openssh.com) via `writeMarkdownFileAtomic` | Quick 260802-qrw (Phase 22 arc, 2026-08-02) | Fixes silent "Error: Failure" on overwriting existing files. Load-bearing for Phase 44 saves. |
| Static operator-authored whitelist for editable paths (`global-files.json`) | Per-user path-safety gate (regex + resolved-path assertion) | Phase 44 (this phase) | Enables Ashley to edit ANY file in ANY skill without operator involvement. Introduces new attack surface (path escape) — mitigated by the regex gates in § Pattern 3. |
| Extension-based text/binary detection | Byte-sniffing (NUL byte + control-char scan + UTF-8 decode) | Phase 44 (this phase) | Robust detection without shell dependency. |
| `useEffect` with `tabData` in deps | `useEffect` with intentional exhaustive-deps violation + comment | Quick 260805-7rq (Phase 23 arc, 2026-08-05) | Fixes 700ms-race infinite-spinner bug. MUST be preserved in Phase 44 mirror. |
| `window.confirm` for destructive user actions | Modal-in-modal `Dialog` confirmation | Phase 44 UI-SPEC | Better UX; still uses `window.confirm` for INHERITED mtime-conflict flow (system-triggered clarification, not user-initiated destruction). |

**Deprecated/outdated (do not use):**
- `sftp.rename()` — deprecated in favor of `sftp.ext_openssh_rename()` in this codebase.
- `fetch()` for authenticated calls — deprecated in favor of `authApi` (except Phase 19's streaming exception).
- Custom modal shells — deprecated in favor of `radix-ui` primitives.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Skill root convention is `~/.claude/skills/` on the target host | § Architecture, all endpoints | LOW — verified against Ashley's canonical dev-os layout (`/home/ubuntu/.claude/skills/build/`, `.../explain/` etc.). CONTEXT § Claude's Discretion explicitly says "align with how global-files editor targets user files" and global-files uses `~/.claude/CLAUDE.md` — same user-scope. If the convention differs on some hosts, the endpoint returns empty skill list and the fallback empty-state renders — no crash. Add a config-override env var if this becomes a problem. |
| A2 | `find` on the fleet Debian/Ubuntu hosts supports `-printf '%P\n'` | § Backend Endpoint 2, § Code Examples | LOW — GNU `find` (default on Debian/Ubuntu) has supported `-printf` since forever. Not a BSD `find` fleet. If a host has only BusyBox `find`, `-printf` fails silently and the file list returns empty; the empty-state renders. Not a crash, just a degraded feature on that host. |
| A3 | `find ~/.claude/skills -mindepth 1 -maxdepth 1 -type d` runs in a non-quoted shell context that tilde-expands | § Backend Endpoint 1 | MEDIUM — needs a smoke test. If tilde does not expand, use the `echo $HOME` two-step (same as endpoints 3+). Cheap to defensively adopt the two-step everywhere. |
| A4 | The isText byte-sniff heuristic correctly classifies typical skill files (`.py`, `.md`, `.sh`, `.json`) as text | § Text Detection | LOW — the heuristic is a well-known industry pattern (git uses similar logic). Skill files are overwhelmingly text; the binary case is `__pycache__/*.pyc` or an accidentally-committed image. Worst-case a text file mis-detected as binary shows a placeholder — user just re-tries or reports. |
| A5 | `resolveHostById` returns a host with a valid SSH credential for every host in `hostTree` (post the `.enableRdp !== true` filter) | § Endpoint auth flow | LOW — Phase 23 relies on the same assumption and hasn't produced credential-drift bugs since ship. If credentials go stale, the SSH connect fails and returns 502 gracefully. |
| A6 | The Phase 23 test file structure (mock at API-module boundary, render component, assert on DOM) is the ONLY in-process testing pattern in the codebase | § Test Seam | LOW — verified by inspection. No sign of a fuller integration harness (no VMS ViewModelShell, no MSW). If a richer pattern exists elsewhere I missed, it can be adopted later without changing Phase 44's plan. |
| A7 | Adding a second router at `/skills-editor` does not require touching CORS / rate-limit / security-middleware setup | § Mount instructions | LOW — Phase 23 mounted `/global-files` with only two `app.use()` lines in `database.ts` L1852+L1857 and shipped without middleware fiddling. Same posture expected. |

## Open Questions (RESOLVED)

1. **RESOLVED:** **Empty skill folder ("skill exists but has zero files") — how should the tab strip render?**
   - What we know: UI-SPEC L142 prescribes copy: heading "This skill has no files.", body 'Use "+ Add file" to create one.'
   - What's unclear: does the tab strip render as an empty flex row, or does the entire body of the modal show the empty-state message (mirroring the "empty state card" pattern from `GlobalFilesModal.tsx` L286-298)?
   - Recommendation: mirror Phase 23's empty state — replace the tab strip + editor pane with a centered card containing the copy. Matches UI-SPEC's copywriting alignment with GlobalFilesModal empty state (L142 explicitly parallels L134's `"No skills on this host."` shape).

2. **RESOLVED:** **"+ Add file" — allow subpath creation or restrict to skill root?**
   - What we know: D-09 says "creates a new empty file at the skill's root." UI-SPEC L176 says "New file name (relative to skill root)" prompt copy.
   - What's unclear: if user types `tests/basic.py`, do we honor it (create parent dir) or reject?
   - Recommendation: honor it — `isSafeRelativePath` accepts subpaths, backend `mkdir -p` on parent dir before `touch`. Simpler and matches user expectation. "At the skill's root" in D-09 is best read as "relative to the skill root", not "flat in the skill root." UI-SPEC L176 prompt copy already says "relative to skill root" which supports this reading. **Escalate to Ashley if planner disagrees.**

3. **RESOLVED:** **Skill dropdown — how does it behave when the currently-selected skill disappears (e.g., someone deleted it in another tab)?**
   - What we know: no explicit guidance in CONTEXT or UI-SPEC.
   - What's unclear: silent refetch on any focus event? Show "skill no longer exists" error? Just render empty tab strip?
   - Recommendation: no automatic refetch (matches Phase 7's snapshot-on-page-load pattern for fleet discovery). If the user hits Save and the skill has been rm'd, the backend returns 502 (SFTP fails) and the frontend shows the existing error branch. Simple, minimal magic. Refetch happens naturally on next skill-dropdown open cycle.

4. **RESOLVED:** **Deleted-file behavior when it was the active tab — which tab activates next?**
   - What we know: UI-SPEC L196: "if it was the active tab, select the next tab to the right (or previous, or none if it was the last)".
   - Recommendation: implement exactly as UI-SPEC prescribes. Straightforward.

5. **RESOLVED:** **Skills-editor and global-files sharing a mtime-conflict error class — should we import/re-export or duplicate?**
   - What we know: UI-SPEC L260 says "planner's call" — either import + re-export or duplicate.
   - Recommendation: duplicate as `SkillFileMtimeConflictError`. The two features share zero runtime concern; import-coupling creates a false dependency. If the two ever diverge (e.g., skill-write starts including additional 409 fields), duplication has already paid its way. Phase 23 also duplicated `execWithTimeout` + `shellEscape` for the same reason.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js (Skynet backend runtime) | All backend endpoints | ✓ | already installed | — |
| npm | Frontend build | ✓ | already installed | — |
| Docker + docker-compose | Deployment (nginx + node) | ✓ | already in use (Phase 23 deploys the same way) | — |
| Managed host reachable via SSH from the Skynet backend container | Every endpoint (list-skills, list-files, read, write, create, delete-file, delete-skill) | ✓ | validated during Phase 23 shipping | If SSH is down for a specific host, endpoints return 502 with `SSH connect failed` (mirrors Phase 23). Handled gracefully by the frontend error branch. |
| `find` (GNU with `-printf`) on managed hosts | List-skills, list-files endpoints | Assumed ✓ | not directly verified | If a host has BusyBox `find`, `-printf` fails and endpoint returns empty list. Frontend renders empty state. Feature is degraded but doesn't crash. |
| `stat -c` (GNU stat) on managed hosts | Read, create, write endpoints | ✓ | verified by Phase 23 (Debian/Ubuntu fleet per GEFM-06 note) | Same as Phase 23. |
| `rm` on managed hosts | Delete-file, delete-skill endpoints | ✓ | universal POSIX | — |
| `touch` on managed hosts | Create endpoint | ✓ | universal POSIX | Or use SFTP `writeFile(path, Buffer.alloc(0))` as fallback (same effect, no shell dep). |
| `mkdir -p` on managed hosts | Create endpoint (for subpath parent dir) | ✓ | universal POSIX | Or SFTP `mkdir` recursion — harder, but doable. |
| OpenSSH server ≥5.1 (for `ext_openssh_rename` / posix-rename@openssh.com) | Write endpoint (via `writeMarkdownFileAtomic`) | ✓ | universal on Ashley's fleet per `identity-artifact-reader.ts` L1054-1056 note | Fallback would be non-atomic writes — undesirable. If a host truly lacks the extension, `writeMarkdownFileAtomic` throws synchronously and endpoint returns 502. |
| nginx (both HTTP + HTTPS configs) | Frontend → backend routing in production | ✓ | already deploying via `docker/nginx.conf` + `docker/nginx-https.conf` | Missing block = broken feature in prod; verify presence via `grep skills-editor` on both files before ship. |
| vitest 4.1.8 + @testing-library/react | Frontend + backend tests | ✓ | package.json confirmed | — |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None truly missing — GNU `find` with `-printf` is the only assumption, and the fallback (empty file list) degrades gracefully.

## Security Domain

`workflow.security_enforcement` is `true` in `.planning/config.json` at `security_asvs_level: 1`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `AuthManager.getInstance().createAuthMiddleware()` on every route (existing JWT auth via cookie/header). Do NOT skip on any endpoint. |
| V3 Session Management | no | No new session state introduced. Cookie-based session already handled globally. |
| V4 Access Control | yes | `resolveHostById(hostId, userId)` provides per-user host isolation — returns null for cross-user/unknown hosts (404). Reused verbatim from Phase 23. |
| V5 Input Validation | yes | Regex gates on `hostId` (positive int), `skill` (`SKILL_NAME_RE`), `path` (`isSafeRelativePath`), `content` (byte cap). Every endpoint validates BEFORE opening SSH. See § Pattern 3. |
| V6 Cryptography | no | No net-new crypto. SSH auth reuses existing key/password paths via `resolveHostById`. |
| V8 Data Protection | yes | `content` bodies capped at `MAX_CONTENT_BYTES = 2_000_000` (mirrors Phase 23 IDMEDIT_MAX_MARKDOWN_BYTES). Prevents DoS via oversized writes. Response bodies never leak stderr/tailnet paths (error responses use fixed shapes: `{ error: "..." }`). |
| V12 Files & Resources | yes | Path escape defense (§ Pattern 3) is the critical control. Two-layer defense: regex gate + resolved-path prefix assertion. `shellEscape` for defense-in-depth on shell interpolation. |
| V13 API & Web Service | yes | Rate limiting — inherited from Skynet's global middleware; no per-route rate limit needed. Content-Type validation via `express.json()` limits (`32kb` for read, `4mb` for write — mirrors Phase 23). |

### Known Threat Patterns for the Skynet-fork stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal (`../../etc/passwd`) | Tampering | Two-layer regex gate + resolved-path prefix assertion (see § Pattern 3). Reject at input validation, then assert post-compose. **CRITICAL for delete-skill's `rm -rf` — a bypassed gate would obliterate `~/`.** |
| Command injection via `skill` or `path` in shell interpolation | Tampering | Regex gate rejects any shell metacharacter; `shellEscape` single-quotes every user-supplied value before interpolation. Defense-in-depth per Phase 23 AUTH-gate/INJECTION-gate split. |
| Cross-user host access | Elevation of privilege | `resolveHostById(hostId, userId)` returns null for cross-user hosts — 404 upstream. Reused verbatim from Phase 23. |
| DoS via oversized content | Denial of service | `express.json({ limit: "4mb" })` at ingress; `MAX_CONTENT_BYTES = 2_000_000` byte cap in body validation. Mirrors Phase 23. |
| DoS via slow SSH round-trip | Denial of service | `execWithTimeout` (5s), `connectOneShot` (5s), `proxy_read_timeout 15s` in nginx. Mirrors Phase 23. |
| Unauthenticated access | Elevation of privilege | `authenticateJWT` on every route — no anonymous access. Missing middleware on any endpoint is a plan-checker BLOCK. |
| Leaking stderr / remote paths in error responses | Information disclosure | Error responses use fixed shapes (`{ error: "internal" }`, `{ error: "SSH connect failed" }`) — never include raw error messages. Detailed error info logged server-side via `sshLogger` only. Mirrors Phase 23. |
| Symlink escape (skill contains a symlink pointing outside skill root) | Tampering | Not addressed in v1. String-prefix assertion happens BEFORE remote symlink resolution. If a symlink inside a skill points to `~/.ssh/id_rsa`, the read/write path resolves inside `~/.claude/skills/<skill>/foo` but SFTP/exec follows the symlink to the actual file. **Recommendation for a followup:** SFTP `realpath` check before every op, assert result starts with skill root. For v1, accept the risk (skills are user-authored — this would be self-inflicted). Document in Deferred Ideas. |

## Sources

### Primary (HIGH confidence)

- `src/ui/features/pretty-view/GlobalFilesModal.tsx` — modal shell, host picker, tab strip, lazy-load useEffect, save handler — direct mirror target
- `src/ui/features/pretty-view/GlobalFileTab.tsx` — editor pane, monospace textarea, Save button, mtime-conflict handling
- `src/ui/api/global-files-api.ts` — frontend API idiom + typed 409 error class
- `src/backend/database/routes/global-files.ts` — list-endpoint pattern (JWT + resolveHostById + response shape)
- `src/backend/database/routes/global-files-read-write.ts` — read/write endpoint pattern (validation + SSH + escape + tilde-expand + atomic write + 409 shape)
- `src/backend/database/routes/global-files-config-loader.ts` — schema/loader pattern (not directly reused but shows the fail-safe module pattern)
- `src/backend/ssh/ssh-one-shot.ts` — `connectOneShot` SSH client
- `src/backend/ssh/tmux-helper.ts` L21-54 — `execCommand` shell exec helper
- `src/backend/ssh/host-resolver.ts` — `resolveHostById` with per-user isolation
- `src/backend/claude-session/identity-artifact-reader.ts` L1027-1118 — `writeMarkdownFileAtomic` (atomic SFTP write with posix-rename)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` L1583-1617 — menu mount site + parallel modal mount
- `docker/nginx.conf` L286-306, `docker/nginx-https.conf` L303-323 — nginx location block pattern
- `src/backend/database/database.ts` L1849-1857 — router mount pattern
- `src/ui/features/pretty-view/GlobalFilesModal.test.tsx` — test pattern with race-regression coverage
- `.planning/config.json` — workflow config (nyquist_validation: false, security_enforcement: true)
- `.planning/STATE.md` — patch #446 layer-enumeration reflex; quick-260805-7rq useEffect race; quick-260805-70q tilde-expand bug
- `.planning/phases/44-.../44-CONTEXT.md` — locked decisions D-01..D-16
- `.planning/phases/44-.../44-UI-SPEC.md` — UX contract (menu-order, copywriting, modal-in-modal, "+ Add file" placement, focus order)
- `.planning/shapes/shape-frontend-skill-editing.md` — the /open product shape

### Secondary (MEDIUM confidence)

- `src/backend/ssh/file-manager-operation-routes.ts` L347-410 — `rm -rf` pattern with shellEscape (confirms the standard shape for delete-directory over SSH)
- `src/backend/ssh/file-manager-list-routes.ts` L80-160 — SFTP recursive-listing precedent (rejected in favor of `find` shell command — one round-trip vs N)
- Ashley's local `/home/ubuntu/.claude/skills/{build,explain}/` structure — confirms `~/.claude/skills/<skill>/SKILL.md` + `<skill>/*` file layout (representative of what a fleet host would have)

### Tertiary (LOW confidence)

- None — every claim in this research traces back to code in this repo. No WebSearch or external documentation consulted; the answer is entirely inside the codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dependency in-repo; no new packages
- Architecture: HIGH — direct mirror of Phase 23 with a well-scoped new dimension (skill selector)
- Backend surface: HIGH — 7 endpoints all have direct Phase 23 or file-manager precedents
- Path safety (only novel security concern): MEDIUM — regex gate + assertion is a standard pattern, but symlink escape is left for followup
- Pitfalls: HIGH — all pitfalls sourced from actual in-repo patches or STATE.md incident logs
- UI copy + placement: HIGH — UI-SPEC has already prescribed the entire surface

**Research date:** 2026-08-18
**Valid until:** ~2026-10-18 (30 days is conservative given this is a mirror-and-fork with no external deps — the only expiry risk is if Phase 23 itself gets refactored in a way that invalidates the mirror, and Phase 23 has been stable since 2026-08-05)
