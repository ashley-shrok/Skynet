# Phase 113: skill-creation-in-the-edit-skills-modal - Research

**Researched:** 2026-09-17
**Domain:** Frontend modal restructure + net-new secure backend route (SSH-mediated remote filesystem)
**Confidence:** HIGH (all findings verified against source files in this repo — no external library lookup was needed; every recommendation traces to an in-tree pattern the phase either extends or mirrors)

## Summary

This is a **near-total prior-art phase** — every single moving piece the plan needs (SSH route
scaffolding, path-safety gates, `writeMarkdownFileAtomic`, slugifier, modal chrome,
delete-confirm dialog, test bootstrap, nginx wildcard block, api-client error class) already
exists in the codebase and just needs mirrored or extended. There is nothing to invent, no
library to add, no version to pin.

The single genuine open question the shape flagged — YAML-safe description escaping — has a
straightforward "wrap-in-double-quotes-unconditionally-escape-`"` and `\`" answer that
CONTEXT D-07 already locks. The single genuine trap — nginx parity — has been **verified
present on both configs** during this research pass. The single genuine invariant —
`SKILL.md` cannot be deleted through this surface — needs a two-layer enforcement (backend
`path === "SKILL.md"` early-reject + frontend hide-affordance-when-path-is-SKILL.md).

**Primary recommendation:** Mirror Phase 44 SKILLED-01/05 patterns byte-for-byte for both the
new `POST /skills-editor/skill` route and the `handleNewSkill` modal callback. Reuse
`slugifyRoleName` from `CreateRoleDialog.tsx` (rename-only import, no behavior change).
Extend both existing test files rather than creating new ones. All external dependencies
(SSH, `writeMarkdownFileAtomic`, nginx wildcard, `authenticateJWT`, `resolveHostById`,
`connectOneShot`, `execWithTimeout`, `shellEscape`, `isValidSkillName`) are in place and
verified.

## User Constraints (from CONTEXT.md)

### Locked Decisions

All 29 decisions D-01 through D-29 in `.planning/phases/113-skill-creation-in-the-edit-skills-modal/113-CONTEXT.md`:

- **D-01** `+ New skill` button in header, AFTER skill picker. Order: title • host picker • skill picker • `+ New skill` • trash • X. Always visible once a host is picked.
- **D-02** Two chained `window.prompt`s (name → description). Cancel on either aborts the whole flow.
- **D-03** Name is silently slugified client-side (lowercase, hyphens for whitespace, strip out-of-`[a-z0-9._-]`, cap 128). Empty slug → `window.alert` + re-prompt name only.
- **D-04** Description is required (non-empty after trim). Empty → `window.alert` + re-prompt description only (name is retained).
- **D-05** Create endpoint returns new slug. Frontend refetches skills list, auto-selects new skill, tab strip opens on `SKILL.md`.
- **D-06** Seed `SKILL.md` shape (verbatim, LF line endings, 5 lines including trailing blank):
  ```
  ---
  name: <slug>
  description: <description-as-typed>
  ---

  ```
- **D-07** Description written raw as typed (trimmed). YAML-safe: wrap in double quotes unconditionally; escape embedded `"` and `\`.
- **D-08** Backend composes seed — frontend does NOT round-trip.
- **D-09** Every new skill has `SKILL.md`.
- **D-10** `SKILL.md` cannot be deleted through this surface. Backend: DELETE `/file` returns 400 `{error:"cannot delete SKILL.md"}` when `path === "SKILL.md"`. Frontend: `SkillFileTab` hides delete affordance when `file.path === "SKILL.md"`.
- **D-11** Forward-only — legacy skills not migrated.
- **D-12** Header `+ Add file` button is REMOVED.
- **D-13** `+ New file` tab at RIGHT END of tab strip. `Plus` icon size 18, label `New file` at `text-[10px]`. Pinned right regardless of scroll.
- **D-14** `+ New file` click runs existing `handleAddFile()` and does NOT change `activeTab`.
- **D-15** `+ New file` tab present the moment a skill is picked, INCLUDING empty-file-list state. Empty-state copy repointed at `+ New file`.
- **D-16** `+ New file` tab EXCLUDED from `activeTab` state — never default on skill load, never auto-selected on last-file delete (activeTab becomes `null`).
- **D-17** Host picker hidden entirely when `flatHosts.length === 1`.
- **D-18** Host picker reappears with 2+ entries.
- **D-19** Single-host-hides scoped to Edit Skills modal ONLY. GlobalFilesModal is OUT.
- **D-20** New route `POST /skills-editor/skill` — body `{hostId, skill, description}`; 8-step handler (validate → resolveHostById → connectOneShot → echo $HOME → compose+assert → test -d → mkdir -p → writeMarkdownFileAtomic).
- **D-21** Inherits STRIDE posture: 5s SSH connect timeout, 5s exec timeout, `authenticateJWT` BEFORE `express.json({limit:"32kb"})`, `shellEscape` on every user value, no stderr/path leakage.
- **D-22** DELETE `/skills-editor/file` adds hard-coded reject for `path === "SKILL.md"` → 400 `{error:"cannot delete SKILL.md"}`. Placement: immediately AFTER `isSafeRelativePath` gate (line 995-998 in current file), BEFORE `resolveHostById`.
- **D-23** New route served by existing wildcard `location ~ ^/skills-editor(/.*)?$` block — verify both nginx configs.
- **D-24** `skills-api.ts` gains `createSkill(hostId, name, description)` returning `Promise<{slug: string; mtime: number}>`. New error class `SkillAlreadyExistsError` for 409.
- **D-25** `SkillsEditorModal.tsx` gains `handleNewSkill` callback (chained prompts → `createSkill` → refetch → `setSelectedSkillName(newSlug)`). Failure via `window.alert`.
- **D-26** Backend tests cover: happy 200, duplicate 409, invalid name 400, empty desc 400, overlength desc 400, path escape 400, missing host 404, SSH connect fail 502.
- **D-27** Backend `SKILL.md`-guard tests: 400 with correct string, no SSH opened, `SKILL.md.bak`/`nested/SKILL.md` still delete.
- **D-28** Frontend `SkillsEditorModal.test.tsx` tests: `+ New skill` visibility, chained-prompt flow, cancellation, empty-desc re-prompt name retention, auto-select on success, `+ New file` tab position, `+ New file` click no `activeTab` change, single-host hides, multi-host shows, `SKILL.md` tab no delete.
- **D-29** Scoped-test discipline — executor runs `npx vitest related --run <touched files>`; full suite + playwright smoke are the deploy gate (orchestrator).

### Claude's Discretion

- Exact TypeScript signature and naming for `SkillAlreadyExistsError` / `createSkill` — mirror `SkillFileAlreadyExistsError` shape.
- `Plus` icon size + gap inside `+ New file` tab — starting values match `FileText` at 18 + `text-[10px]`, tune ±1-2 px if optically off.
- Whether `+ New skill` button uses `bg-[hsla(220,80%,60%,0.20)]` primary-accent style (recommendation: yes, matches retired `+ Add file`).
- Slug collision handling — collapse consecutive hyphens before length-cap (recommendation applies here; the existing `slugifyRoleName` already does `.replace(/[^a-z0-9]+/g, "-")` which collapses).
- Whether `+ New file` is an ARIA tab or a `<button>` styled as tab — recommendation: plain `<button>` (honest about action nature).

### Deferred Ideas (OUT OF SCOPE)

- Renaming a skill.
- Cloning / duplicating a skill.
- Template starter picker for new skills.
- Marketplace / import / share flow.
- Retroactive migration of existing `SKILL.md`-less skills.
- Extending single-host-hides to `GlobalFilesModal`.
- Upgrading chained `window.prompt` to a proper mini-dialog.
- Any change to `GlobalFilesModal` — host-picker chrome, `+ Add file`, whole surface untouched.

## Phase Requirements

No requirement IDs are tracked for Phase 113 in `REQUIREMENTS.md` — the phase is a Skynet-fork extension outside the patch #43 pretty-session-view v1 requirement set (which is the only requirement set REQUIREMENTS.md covers). Phase-113 acceptance is driven entirely by the 29 CONTEXT decisions above; the planner should map plans directly to decision IDs (D-01 … D-29), not to REQ-* IDs.

## Project Constraints (from CLAUDE.md)

`/home/ubuntu/skynet-apollo/CLAUDE.md` does not exist in this checkout. Project constraints inherit from the role file (`~/fleet/roles/box-maintainer/box-maintainer.md`) which CONTEXT.md § Role file directives already enumerates:

1. **Test discipline** — scoped `npx vitest related --run <touched files>` during dev; full suite + playwright smoke are the deploy gate (orchestrator, not executor).
2. **Container mutations serialize** — Ashley coordinates deploy manually.
3. **Never use worktrees.**
4. **Executor deploy scope** — code + commit + tests green; ship is orchestrator-owned.
5. **Multi-identity git** — pull `--rebase` before push (standing rule for the fleet monorepo).
6. **Nginx parity load-bearing** — every backend route touched under `/skills-editor` (or any nginx-proxied prefix) MUST have matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf` (patch #446 arc). This phase's `POST /skills-editor/skill` is covered by the existing wildcard block — VERIFIED present in both configs during this research pass (nginx.conf L445, nginx-https.conf L460).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Chained `window.prompt` name+description flow | Browser (React) | — | UX-level state machine; no persistence, no server work until the API call fires. |
| Client-side slugification | Browser (React) | — | User thinks in words; disk name is a machine concern the modal handles silently (D-03 philosophy). Backend re-validates for defense-in-depth. |
| Skill folder mkdir + `SKILL.md` seed | API / Backend (Express route) | SSH exec channel | Same-call `mkdir` + `writeMarkdownFileAtomic` = no partial-create window (D-08 rationale). Frontend round-trip would double SSH cost. |
| `SKILL.md` delete-guard (backend) | API / Backend (Express route) | — | Life-critical invariant. Client-side hide alone is bypassable via curl; backend early-reject is the load-bearing layer (D-10). |
| `SKILL.md` delete-affordance-hide (frontend) | Browser (React) | — | UX polish — the button that would 400 doesn't render at all. Backend is the authority; frontend is the ergonomics. |
| Host-picker `flatHosts.length === 1` hide | Browser (React) | — | Pure render decision on already-fetched host tree. No new backend work. |
| `+ New file` tab pinned right | Browser (React) | — | Pure DOM ordering — `<button>` appended after the file-map inside the tab-strip container. |
| Nginx routing to new endpoint | CDN / Edge (nginx) | — | Handled by existing `location ~ ^/skills-editor(/.*)?$` wildcard block. Zero-config move. |
| Per-user host isolation | API / Backend (Express + host-resolver) | — | `resolveHostById(hostId, userId)` — same authorization gate every other skills-editor route uses. |
| Path-safety gate for the new endpoint | API / Backend (Express route) | — | `isValidSkillName` gate runs BEFORE `resolveHostById` (zero SSH cost for rejection). `skillRoot.startsWith(skillsPrefix)` post-compose assertion for belt-and-suspenders. |

## Standard Stack

The stack is fully specified by what already ships. Nothing new gets installed. All entries below are `[VERIFIED: file:line]` — the file is checked in this checkout.

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `express` (already installed) | as-installed | Route handler for `POST /skills-editor/skill` | 5 existing skills-editor routes are Express Router handlers; identical pattern. `[VERIFIED: src/backend/database/routes/skills-editor.ts:66]` |
| `radix-ui` (already installed) | as-installed | Modal chrome, delete-confirm dialog primitive | Modal already built on Radix `Dialog`. `[VERIFIED: src/ui/features/pretty-view/SkillsEditorModal.tsx:3]` |
| `lucide-react` (already installed) | as-installed | `Plus` icon for the `+ New file` tab | `FileText`, `X`, `Trash2` already used from `lucide-react` in the same file; `Plus` is a peer icon. `[VERIFIED: src/ui/features/pretty-view/SkillsEditorModal.tsx:2]` |
| `axios` via `@/main-axios` (already installed) | as-installed | `createSkill` API call | `skills-api.ts` uses `authApi.get/post/put/delete` + `handleApiError` — new function slots in verbatim. `[VERIFIED: src/ui/api/skills-api.ts:1]` |
| `vitest` + `@testing-library/react` (already installed) | as-installed | Backend + frontend tests | Both existing test files use this stack. `[VERIFIED: skills-editor.test.ts:31, SkillsEditorModal.test.tsx:19-20]` |

### Supporting (backend seams, all verified in-tree)

| Helper | Location | Purpose |
|--------|----------|---------|
| `writeMarkdownFileAtomic` | `src/backend/claude-session/identity-artifact-reader.ts:1945` | SFTP tmp+rename (posix-rename via `ext_openssh_rename`) — the seed `SKILL.md` write uses this. Trap prologue at L1930-1943 documents the EEXIST → SSH2_FX_FAILURE issue; never call plain `sftp.rename` in its place. |
| `connectOneShot` | `src/backend/ssh/ssh-one-shot.ts` | SSH connect with per-call timeout. Every skills-editor route uses it. |
| `resolveHostById` | `src/backend/ssh/host-resolver.ts` | Per-user host isolation — 404 for cross-user / unknown hosts. |
| `execCommand` | `src/backend/ssh/tmux-helper.ts` | Underlying exec used inside `execWithTimeout`. |
| `authenticateJWT` | `AuthManager.getInstance().createAuthMiddleware()` (skills-editor.ts:76-77) | JWT gate — ALWAYS mounted before the body parser (see § Common Pitfalls Pitfall 2). |

### Supporting (frontend seams, all verified in-tree)

| Helper | Location | Purpose |
|--------|----------|---------|
| `slugifyRoleName` | `src/ui/sidebar/CreateRoleDialog.tsx:118` | Existing kebab-case slugifier: `.normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+\|-+$/g,"").slice(0,64).replace(/-+$/g,"")`. **REUSE this**; do not hand-roll a second slugifier. Note the two behavioral differences vs D-03: (a) it drops underscores and dots (only `[a-z0-9]` survives — output is kebab-case only, output matches `/^[a-z0-9-]+$/`, a strict subset of the backend's `SKILL_NAME_RE` which also allows `_` and `.`), and (b) it caps at 64 chars, not 128. Both differences are safe — the produced slug still passes `SKILL_NAME_RE` — but plan-time note: the phase's stated 128-char cap comes from `SKILL_NAME_RE`, and if that ceiling matters, `slugifyRoleName` is stricter. Recommendation: **reuse `slugifyRoleName` as-is**; 64 is a fine ceiling for a skill folder name and diacritic folding is the harder-to-write half. Extract to a shared module (`src/lib/slugify.ts`?) is a follow-up bounty, not this phase — third-instance-precedent from Phase 23/44 duplication comments applies. |
| `authApi` + `handleApiError` | `src/ui/main-axios.ts` (referenced by `skills-api.ts:1`) | The shared axios instance with JWT interceptor + shared error handler. New `createSkill` uses `authApi.post` verbatim. |
| `DeleteConfirmDialog` | `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` | Generic modal-in-modal confirm; NOT USED by this phase (chained `window.prompt` is deliberate per D-02) but referenced for pattern-completeness. |
| `SkillFileMtimeConflictError` / `SkillFileAlreadyExistsError` | `src/ui/api/skills-api.ts:42-62` | The pattern the new `SkillAlreadyExistsError` mirrors — see § Code Examples. |

### Alternatives Considered (and rejected — CONTEXT already locked)

| Instead of | Could Use | Why locked answer wins |
|------------|-----------|------------------------|
| Chained `window.prompt` | Proper mini-dialog (form fields, validation, cancel button) | D-02 deliberate consistency with the existing `+ Add file` UX; upgrade both flows together in a future polish pass. |
| Client-side seed write (round-trip through PUT `/write`) | Backend composes seed in same handler | D-08: doubling SSH cost + opening a partial-create window (folder exists, `SKILL.md` missing). |
| Delete-guard frontend-only | Backend guard as the load-bearing layer | Shape file: "the delete-file operation letting SKILL.md through because the check was only on the frontend" is called out as a failure mode. D-10 requires both layers. |
| Add a new nginx location block | Extend existing `location ~ ^/skills-editor(/.*)?$` wildcard | D-23: verified present on both configs during this research pass. Zero-config move. |
| Extract shared slugify module | Reuse `slugifyRoleName` in place, import from `CreateRoleDialog.tsx` | Third-duplication-precedent (see Phase 23 note in skills-editor.ts:115-118 about extraction being a Post-Planning-Gaps item, not a phase task). Cross-directory import (`@/sidebar/CreateRoleDialog`) is unusual but explicitly acceptable per Claude's Discretion. |

**Installation:** None — every dependency is already installed. No `npm install` step in this phase.

**Version verification:** Skipped — no new packages added. All dependencies (express, radix-ui, lucide-react, axios, vitest, @testing-library/react) are already at the repo's pinned versions and are directly used by the sibling code (`SkillsEditorModal.tsx`, `skills-editor.ts`) that this phase extends.

## Package Legitimacy Audit

**Not applicable.** This phase adds ZERO external packages. All dependencies (`express`, `radix-ui`, `lucide-react`, `axios`, `vitest`, `@testing-library/react`) are already in the repo's `package.json`, already used by sibling code (SkillsEditorModal.tsx, skills-editor.ts, skills-api.ts), and were legitimacy-audited in their respective introduction phases (Phase 23 / Phase 44 / Phase 88). slopcheck gate does not apply — nothing is being installed.

## Architecture Patterns

### System Architecture Diagram

```
Browser (SkillsEditorModal + skills-api.ts)
  |
  | 1. User clicks "+ New skill" (D-01)
  | 2. Chained window.prompt (name → desc)     [D-02]
  | 3. slugifyRoleName(name); validate desc     [D-03, D-04]
  | 4. authApi.post("/skills-editor/skill", {hostId, skill:slug, description})
  v
Nginx  (location ~ ^/skills-editor(/.*)?$)      [D-23 — verified both configs]
  |
  v
Express /skills-editor router (POST /skill — NEW)
  |
  | 5. authenticateJWT [before] express.json({limit:"32kb"})    [D-21]
  | 6. Validate hostId + isValidSkillName(skill) + description  [D-20 step 1]
  | 7. resolveHostById(hostId, userId)  → 404 on miss           [D-20 step 2]
  | 8. connectOneShot(host, 5000ms)                             [D-21]
  |
  v
Remote host (SSH exec + SFTP)
  |
  | 9. echo $HOME  (resolve remote HOME — Phase 44 pitfall #5) [D-20 step 3]
  | 10. Compose skillsRoot = $HOME/.claude/skills               [D-20 step 4]
  |     Compose skillRoot  = $skillsRoot/<slug>
  |     Assert skillRoot.startsWith(skillsPrefix)  (defense in depth)
  | 11. test -d skillRoot  → 409 {error:"skill exists"}         [D-20 step 5]
  | 12. mkdir -p skillRoot                                      [D-20 step 6]
  | 13. Compose SKILL.md seed:                                  [D-06, D-07]
  |       ---\nname: <slug>\ndescription: "<escaped>"\n---\n\n
  | 14. writeMarkdownFileAtomic(conn, skillRoot/SKILL.md, seed) [D-08, D-20 step 7]
  |     (SFTP tmp+rename via ext_openssh_rename)
  | 15. stat -c '%Y' skillRoot/SKILL.md  → mtime
  |
  v
Response: 200 { slug, mtime }                                   [D-20 step 8]
  |
  v
Browser refetches skills list → setSelectedSkillName(newSlug)   [D-05, D-25]
  |
  v
Existing skill-load effect (SkillsEditorModal:156-183) fetches files,
auto-selects SKILL.md as the first tab (already sorted alphabetically —
SKILL.md always comes first in the current sort), lazy-loads its content
via readSkillFile, tab strip renders with SKILL.md ready to edit.

Parallel-arc changes (independent of the create flow):
  A. DELETE /skills-editor/file gains a "path === 'SKILL.md'" early reject      [D-10, D-22]
     (400 {error:"cannot delete SKILL.md"}, BEFORE resolveHostById)
  B. SkillFileTab hides delete affordance when filename === "SKILL.md"          [D-10]
  C. Header host-picker <select> gets a flatHosts.length === 1 conditional      [D-17]
  D. Header `+ Add file` button REMOVED; header + New skill button ADDED        [D-01, D-12]
  E. Tab strip appends `+ New file` <button> after files.data.map              [D-13, D-14, D-15]
  F. Empty-file-list copy at L550-556 repointed at "+ New file"                [D-15]
```

### Component Responsibilities

| Component | File | Responsibility Added / Changed |
|-----------|------|--------------------------------|
| `POST /skills-editor/skill` handler | `src/backend/database/routes/skills-editor.ts` (NEW block between L960 end-of-`/create` and L963 start-of-`DELETE /file`) | The whole new endpoint per D-20 / D-21. |
| `DELETE /skills-editor/file` handler | `src/backend/database/routes/skills-editor.ts:970-1074` | Add `path === "SKILL.md"` early-reject at L998 (immediately after `isSafeRelativePath` gate at L995-998). |
| `SKILL_MD_SEED` composer | `src/backend/database/routes/skills-editor.ts` (NEW helper) | `function composeSkillMdSeed(slug: string, description: string): string` — builds the 5-line frontmatter block per D-06 with unconditional double-quote-wrap + `\\` + `"` escape per D-07. Belongs alongside `buildAbsSkillFilePath`. |
| `createSkill` API function | `src/ui/api/skills-api.ts` (NEW export ~end of file) | `createSkill(hostId, name, description) → {slug, mtime}` per D-24. |
| `SkillAlreadyExistsError` class | `src/ui/api/skills-api.ts` (NEW class, mirrors `SkillFileAlreadyExistsError` at L57-62) | 409 branch for the new endpoint. |
| `SkillsEditorModal.handleNewSkill` | `src/ui/features/pretty-view/SkillsEditorModal.tsx` (NEW callback ~L280, alongside `handleAddFile`) | Chained prompts, slug + desc validation loops, `createSkill` call, refetch, `setSelectedSkillName(newSlug)`. |
| `SkillsEditorModal` header row | `src/ui/features/pretty-view/SkillsEditorModal.tsx:404-514` | Remove `+ Add file` button (L462-469). Add `+ New skill` button between skill picker (ends L457) and delete-skill trash (L473). Wrap host-picker `<select>` (L413-427) in `{flatHosts.length > 1 && (…)}` conditional. |
| `SkillsEditorModal` tab strip | `src/ui/features/pretty-view/SkillsEditorModal.tsx:587-634` | Append a `<button type="button" onClick={handleAddFile}>` styled as tab AFTER the `files.data.map(...)` closes at L633. Same intrinsic-width + `shrink-0` treatment as the map'd tabs. |
| `SkillsEditorModal` empty-file-list branch | `src/ui/features/pretty-view/SkillsEditorModal.tsx:550-556` | Rewrite copy: `"This skill has no files."` + `"Use the '+ New file' tab below to create one."`. Also render the tab strip with only the `+ New file` tab (D-15) — this means the tab-strip block moves out of the else-branch and into a sibling of both the empty-file-list branch and the populated tabs branch. |
| `SkillsEditorModal` empty-file-list tab-strip | `src/ui/features/pretty-view/SkillsEditorModal.tsx` (structural) | The `+ New file` tab needs to render even when `files.data.length === 0` (D-15). Simplest structural fix: hoist the tab-strip render to fire whenever `selectedSkillName != null` regardless of `files.data.length`. Tab-strip's `files.data.map(...)` becomes a no-op iteration when data is empty; the `+ New file` `<button>` appended after it becomes the sole child. |
| `SkillFileTab` delete-affordance | `src/ui/features/pretty-view/SkillFileTab.tsx:150-158` | Wrap the Trash2 `<button>` in `{filename !== "SKILL.md" && (…)}` conditional. `filename` prop is already threaded (see L64-66). |

### Pattern 1: Two-Layer Path-Safety Gate

**What:** Every skills-editor endpoint runs `isValidSkillName(skill)` (regex + not-`.`/`..` check) BEFORE `resolveHostById` — no SSH cost for rejection — plus a post-compose `skillRoot.startsWith(skillsPrefix)` assertion as belt-and-suspenders defense.

**When to use:** Every user-supplied path or name that gets interpolated into a shell command. The regex is the AUTH gate; `shellEscape` is the INJECTION gate. Both required.

**Example (verbatim from existing DELETE /skill handler):**
```typescript
// Source: src/backend/database/routes/skills-editor.ts:1105-1170
if (!isValidSkillName(rawSkill)) {
  res.status(400).json({ error: "invalid skill name" });
  return;
}
// ...later, after echo $HOME resolves remoteHome...
const skillsPrefix = `${remoteHome}/${SKILL_ROOT_REL}/`;
const skillRoot = `${skillsPrefix}${skill}`;
if (!skillRoot.startsWith(skillsPrefix)) {
  res.status(400).json({ error: "path escape detected" });
  return;
}
const escapedSkillRoot = shellEscape(skillRoot);
await execWithTimeout(conn, `rm -rf ${escapedSkillRoot}`);
```

**For the new POST /skill route:** Same shape. `isValidSkillName(rawSkill)` gate, `resolveHostById`, `connectOneShot`, `echo $HOME`, compose `skillRoot`, `skillRoot.startsWith(skillsPrefix)` assertion, `shellEscape` before every interpolation.

### Pattern 2: Auth Before Body Parser

**What:** `authenticateJWT` runs BEFORE `express.json({limit:...})` on every write route.

**Why:** Unauthenticated attackers shouldn't get to send an arbitrary-shaped JSON body before we reject them (cheap DoS amplification vector). `authenticateJWT` reads only from cookie/header, so unread bodies are fine; Express drains the socket after the 401.

**Example:**
```typescript
// Source: src/backend/database/routes/skills-editor.ts:812-816
router.post(
  "/create",
  authenticateJWT, // BEFORE body parser
  express.json({ limit: "32kb" }),
  async (req, res) => { ... }
);
```

**For the new POST /skill route:** Same middleware order. 32kb limit is sufficient (hostId + skill + description, and description is length-capped ≤4KB per D-20 step 1).

### Pattern 3: STRIDE 5-Layer Route Structure

Every existing skills-editor route follows the same 5-layer structure (see § Standard Stack table above for line references):

1. **Body/query validate** — 400 BEFORE any I/O.
2. **Per-user host isolation** — `resolveHostById(hostId, userId)`, 404 on miss.
3. **SSH connect** — `connectOneShot(host, SSH_CONNECT_TIMEOUT_MS)`, 502 on failure.
4. **Remote HOME resolution** — `echo $HOME` via `execWithTimeout`, 502 if HOME cannot be resolved or starts with `~` (unexpanded tilde is the quick-260805-70q root cause; see Pitfall 4).
5. **Compose + assert + operation** — build absolute path, prefix-assert, `shellEscape`, exec/SFTP.

Plus a `finally { conn?.end() }` cleanup block on every route.

**For the new POST /skill route:** Mirror this shape verbatim. The composed `SKILL.md` seed goes to `writeMarkdownFileAtomic(conn, absPath, seed)` (SFTP tmp+rename); no separate exec step is needed for the write.

### Pattern 4: Slugifier Re-Use

`slugifyRoleName` at `src/ui/sidebar/CreateRoleDialog.tsx:118` produces `/^[a-z0-9-]+$/`-matching output — a strict subset of `SKILL_NAME_RE` (`/^[a-zA-Z0-9._-]{1,128}$/`). Every slug it produces passes the backend gate. Cross-directory import is unusual but explicitly allowed by CONTEXT Discretion; extracting to a shared `src/lib/slugify.ts` is a bounty, not a phase task.

**Empty-slug guard (D-03):**
```typescript
// After the client-side slugify
const slug = slugifyRoleName(rawName.trim());
if (slug.length === 0) {
  window.alert("Please pick a name with at least one letter or number.");
  return handleNewSkill(); // re-invoke to re-prompt name field only
}
```

Note the recursive re-invocation is deliberate; it means the description prompt from the aborted flow never appears. The retained-name-across-desc-reprompt case (D-04) needs a different shape — see § Code Examples.

### Anti-Patterns to Avoid

- **Client-side `SKILL.md` seed write** — round-tripping through `PUT /write` doubles the SSH cost and opens a partial-create window. D-08 explicitly rejects this.
- **Split path-safety gate** — regex-only or prefix-assert-only. Both are required; neither alone is enough. See Pitfall 1.
- **Missing `SKILL.md` frontend guard** — even with the backend guard, a stray Trash2 button that fires a 400 error toast is bad UX. Both layers required (D-10).
- **New nginx location block** — the existing wildcard `location ~ ^/skills-editor(/.*)?$` covers the new endpoint. Adding a new block is dead code and easy to drift between HTTP + HTTPS configs (patch #446 trap).
- **Body parser before auth** — see Pattern 2. Every existing route follows the reverse order.
- **Hand-rolled slugifier** — `slugifyRoleName` exists and works. See Pattern 4.
- **Making `+ New file` an ARIA tab** — Claude's Discretion. Plain `<button>` styled to match is more honest about its action nature and simpler to test.
- **Auto-selecting `+ New file` as the default `activeTab`** — D-16 explicitly excludes it from `activeTab` state transitions.
- **Extending `+ New file` semantics to the last-file-deleted case** — D-16 says `activeTab` becomes `null` and the body renders the empty-file-list branch. Do NOT auto-jump to `+ New file`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Slugify a free-text skill name | Custom regex + normalize logic | `slugifyRoleName` from `CreateRoleDialog.tsx:118` | Diacritic folding via `.normalize("NFKD").replace(/[̀-ͯ]/g,"")` is easy to write wrong; `slugifyRoleName` handles it and has test coverage. |
| Atomic file write to remote host | Direct SFTP `putFile` or `sftp.rename` | `writeMarkdownFileAtomic(conn, path, contents)` | Documented EEXIST → SSH2_FX_FAILURE trap in `identity-artifact-reader.ts:1930-1943` — plain `sftp.rename` is unsafe for existing-file overwrites. Even though `SKILL.md` is net-new (mkdir + write is a fresh path), reusing the helper keeps this route consistent with the existing 5 skills-editor routes that already use it. |
| Shell-escape a user-supplied value | Own `.replace(...)` implementation | `shellEscape` from `skills-editor.ts:142` | Single-quote wrap with the `'"'"'` embed-escape pattern is easy to get subtly wrong. |
| Path-relative + prefix-assert | Manual `path.join` + `startsWith` chain | `buildAbsSkillFilePath(remoteHome, skill, relPath)` from `skills-editor.ts:226` | Already handles the assertion; caller just checks for null return. |
| SSH exec with timeout | `execCommand` + manual `Promise.race` | `execWithTimeout(conn, cmd, 5000)` from `skills-editor.ts:119` | Same 5s ceiling every other route uses; matches nginx `proxy_read_timeout 15s`. |
| Skill-name validation | Own regex | `isValidSkillName` from `skills-editor.ts:151` | Rejects `.`, `..`, `/`, backslash, shell metachars, empty. Runs BEFORE any I/O. |
| Per-file relative-path validation | Own regex + segment walk | `isSafeRelativePath` from `skills-editor.ts:170` | Rejects leading `/`, NUL, `..`, `.`, empty segments, over-length. |
| API axios wrapper with JWT + error handling | Raw `axios.create` + interceptor | `authApi` + `handleApiError` from `@/main-axios` | Every other API helper in `src/ui/api/*.ts` uses this pair. |
| Modal chrome (overlay + portal + z-index ladder) | Custom Portal + fixed positioning | Radix `DialogPrimitive.Root/Portal/Overlay/Content` | Already threaded through `SkillsEditorModal.tsx`; extending the modal keeps the same structure. |
| Frontend delete-confirm dialog | Custom `<div>` + button pair | `DeleteConfirmDialog` from `pretty-view/DeleteConfirmDialog.tsx` | Not used by THIS phase (D-02 chooses `window.prompt`), noted for pattern awareness. |
| Frontend API error class | Bare `Error` with string message | `SkillFileAlreadyExistsError` shape at `skills-api.ts:57` | New `SkillAlreadyExistsError` mirrors this exactly. |

**Key insight:** This phase is a scaffolding-reuse phase. Every helper the new route needs already exists and is battle-tested via 5 existing skills-editor endpoints. Any "let me just quickly write..." for a slugifier, atomic writer, path-safety helper, or shell-escape is a red flag — check the existing code first.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Skills folder(s) on managed hosts under `~/.claude/skills/<slug>/` — the new endpoint creates new folders + a seed `SKILL.md`. Legacy skills without `SKILL.md` are explicitly **NOT** migrated (D-11 forward-only). | None (net-new folders only; no updates to existing data). |
| Live service config | None. The endpoint is served by the existing `/skills-editor` router mounted in `database.ts`; no new mount, no new service config, no new environment variable. | None. |
| OS-registered state | None. No systemd units, no launchd plists, no Windows Task Scheduler entries touch skills-editor. | None. |
| Secrets and env vars | None. `authenticateJWT` reads the existing JWT cookie/header; no new secret, no new env var. | None. |
| Build artifacts / installed packages | None. No new npm package; no new binary; no new compiled asset. Frontend build (Vite) picks up the new `handleNewSkill` + `+ New skill` button + tab-strip change automatically. Backend build (`npm run build:backend`) picks up the new route in `skills-editor.ts` automatically. Existing Vite/tsc pipelines cover both. **Nginx config parity is the one deploy-time concern** (patch #446 arc) — verified present on both configs during this research pass; no rebuild needed for the new endpoint. | None (nginx wildcard already covers the new endpoint per D-23; if nginx configs ever regress the parity, restoration is a plan-time task). |

**Nothing found in every category above:** All "None" entries are verified — a grep across `/home/ubuntu/skynet-apollo/` for `skills-editor` in `docker/`, systemd/launchd configs, and env-file templates returned only the nginx configs (both verified present) and the `database.ts` mount (unchanged for this phase).

## Common Pitfalls

### Pitfall 1: Regex gate without prefix-assert (or vice versa)

**What goes wrong:** A subtle regex mistake lets a `..`-containing name through and `rm -rf $HOME/.claude/skills/../..` — or the regex is right but a future refactor changes the compose step and the assertion catches it.

**Why it happens:** Defense-in-depth is easy to mistake for "belt AND suspenders → I only need one."

**How to avoid:** Every existing skills-editor route runs BOTH. Match the pattern verbatim on the new route.

**Warning signs:** A test titled "path escape via `..`" that passes without `buildAbsSkillFilePath` returning null → the prefix-assert isn't firing. Add explicit `expect(...).toBe(400)` on both the regex-blocked case AND the prefix-assert-blocked case (see § Testing).

### Pitfall 2: `express.json` before `authenticateJWT`

**What goes wrong:** Unauthenticated attackers get to parse 32kb JSON bodies before being rejected — cheap DoS amplification. Also, if `express.json` throws on malformed body, the 401 becomes a 400 — leaked information about auth requirements.

**Why it happens:** Copying a route skeleton from a framework tutorial that puts JSON parsing at the top.

**How to avoid:** `authenticateJWT` always first. See `skills-editor.ts:466, 612, 803, 961, 1084` — every write route follows the pattern.

**Warning signs:** Test that fires an unauthenticated POST with a huge JSON body and checks the response time — should be near-instant (401) not delayed by parsing.

### Pitfall 3: Missing `finally { conn.end() }`

**What goes wrong:** SSH connection leak. `connectOneShot` opens a real socket; without cleanup, the server accumulates dead connections.

**Why it happens:** Early-return branches inside the try block skip the finally without care.

**How to avoid:** Every existing route uses `finally { if (conn) { try { conn.end() } catch { ... } } }`. Match verbatim.

**Warning signs:** No `finally` block after the try/catch, or the `conn` is declared inside the try (so it can't be referenced in `finally`).

### Pitfall 4: Unexpanded tilde in `echo $HOME`

**What goes wrong:** SFTP and single-quote-escaped shell interpolation both suppress tilde expansion. If the remote shell's `$HOME` returns `~` (misconfigured account) or empty, subsequent paths become literal `~/.claude/skills/foo` — a filesystem-invalid path.

**Why it happens:** Root cause of quick-260805-70q. Some remote accounts have weird shell rc files that break `$HOME`.

**How to avoid:** Every existing route checks `!remoteHome || remoteHome.startsWith("~")` and 502s with `{error:"could not resolve remote HOME"}`.

**Warning signs:** No `startsWith("~")` guard in the new route.

### Pitfall 5: Missing nginx block in HTTPS config

**What goes wrong:** Route works in dev/staging (HTTP) but 200-returns index.html in production (HTTPS) → frontend crashes on `.map` of an HTML string. Patch #446 root cause.

**Why it happens:** `docker/nginx.conf` is edited but `docker/nginx-https.conf` is forgotten.

**How to avoid:** Patch #446 was mitigated by using a wildcard block: `location ~ ^/skills-editor(/.*)?$`. This block is method-agnostic and covers every sub-path. **Verified present in BOTH configs during this research pass**:
- `docker/nginx.conf:445` — `location ~ ^/skills-editor(/.*)?$`
- `docker/nginx-https.conf:460` — `location ~ ^/skills-editor(/.*)?$`

**No new nginx block is needed for this phase.** If either config regresses the parity (removes the wildcard, adds a narrower path-specific block), restoration is a plan task; but at the moment they are correct.

**Warning signs:** New `location /skills-editor/skill { ... }` block added to nginx.conf → wrong (it duplicates the wildcard). If a plan wants to add nginx changes, that's the red flag — no nginx changes are needed for Phase 113.

### Pitfall 6: Slug that passes regex but breaks disk

**What goes wrong:** User types `!!!` → slugify collapses to `""` → backend regex REJECTS empty (`SKILL_NAME_RE` requires 1+ char), so it 400s at the API layer — but the frontend already committed the description prompt round-trip. Bad UX (user answered a description prompt and got told "invalid name").

**Why it happens:** Empty-slug edge case not caught client-side before the description prompt fires.

**How to avoid:** Empty-slug check IMMEDIATELY after `slugifyRoleName(rawName)` — before the description prompt fires. If empty, `window.alert` + re-prompt name only. D-03 already prescribes this.

**Warning signs:** The plan puts description-prompt before empty-slug check.

### Pitfall 7: YAML injection via unquoted description

**What goes wrong:** User types `foo: bar` as description → seed becomes:
```
description: foo: bar
```
YAML parsers interpret this as `{description: {foo: "bar"}}` or reject it as invalid mapping. Runtime skill discovery breaks.

**Why it happens:** Colons, hashes, leading `!`/`&`/`*`/`@`, and other YAML special chars are ubiquitous in natural language.

**How to avoid:** D-07 locks the answer — wrap in double quotes unconditionally, escape embedded `"` and `\`. Simplest safe form:
```typescript
const yamlSafeDesc = `"${description.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
```
Test cases: description containing `:`, `#`, `!foo`, `"hello"`, `\path`, newline (`\n`) — all round-trip through a YAML parser to the original string. Multi-line descriptions with embedded newlines are a subtle case — YAML `"..."` supports `\n` escape but the frontend doesn't inject newlines from a single `window.prompt` (the prompt is single-line by browser convention). Recommendation: reject descriptions containing `\n` or `\r` at the backend as 400 `{error:"description must be single-line"}` for belt-and-suspenders; alternative is to accept them and escape as `\n` in the YAML string.

**Warning signs:** Seed composer without `.replace(/\\/g, '\\\\').replace(/"/g, '\\"')`.

### Pitfall 8: Skill-directory left partial on failure

**What goes wrong:** `mkdir -p` succeeds; `writeMarkdownFileAtomic` fails (SFTP error). Result: skill folder exists but `SKILL.md` doesn't — a broken skill in the "legacy" (D-11) shape that this phase's invariant is trying to eliminate.

**Why it happens:** Two-step operation with no rollback.

**How to avoid:** Best-effort cleanup on write failure — `rm -rf skillRoot` in the catch block before returning 502. If the cleanup itself fails, log and still 502 (the user gets a clean retry surface).

Alternative discussed but not prescribed: reorder as write-file-first-then-mkdir-parent — infeasible with SFTP because SFTP requires the parent directory to exist. Reversed order doesn't work; cleanup on failure is the right call.

**Warning signs:** Plan's create-skill handler has no cleanup path in the writeMarkdownFileAtomic failure branch.

### Pitfall 9: `+ New file` tab hijacking `activeTab`

**What goes wrong:** Clicking `+ New file` sets `activeTab` to a nonsense value (e.g., `"__new_file_action"`), then the file-content lazy-load effect (SkillsEditorModal.tsx:188-225) tries to `readSkillFile(hostId, skill, "__new_file_action")` and 400s.

**Why it happens:** Treating the `+ New file` as a real tab.

**How to avoid:** D-14 explicitly locks: click handler calls `handleAddFile()` and RETURNS without calling `setActiveTab`. D-16 excludes it from `activeTab` state entirely. Implement `+ New file` as a `<button>` that never touches `activeTab`.

**Warning signs:** Any `onClick={() => setActiveTab("+ new")}` shape.

### Pitfall 10: Skill's `distributed: true` skills are visible in the picker

**Not a phase-113 pitfall directly, but worth surfacing** — the existing `GET /skills-editor/skills` handler already filters out skills whose `SKILL.md` frontmatter carries `distributed: true` (see skills-editor.ts:308-321). The new `POST /skills-editor/skill` route does NOT stamp `distributed: true` on its seed (D-06 is explicit — only `name` + `description`), so newly-created skills are correctly visible in the list. Good; no action needed. But if a plan adds a "template picker" (deferred), the plan MUST NOT emit `distributed: true` in a template — that would break the round-trip (create the skill, then it disappears from the list).

## Code Examples

Verified patterns from in-tree sources — every URL below points to a real file in this checkout.

### The new POST /skills-editor/skill handler skeleton

```typescript
// Source: mirrors src/backend/database/routes/skills-editor.ts DELETE /skill (L1093-1193)
//         + POST /create (L812-960) — hybrid, since it's mkdir + write

router.post(
  "/skill",
  authenticateJWT, // BEFORE body parser (Pitfall 2)
  express.json({ limit: "32kb" }),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;

    // 1. Body validation — 400 BEFORE any I/O
    const body = (req.body ?? {}) as Record<string, unknown>;
    const rawHostId = body.hostId;
    const rawSkill = body.skill;
    const rawDescription = body.description;

    if (typeof rawHostId !== "number" || !Number.isInteger(rawHostId) || rawHostId <= 0) {
      res.status(400).json({ error: "hostId must be a positive integer" });
      return;
    }
    if (!isValidSkillName(rawSkill)) {
      res.status(400).json({ error: "invalid skill name" });
      return;
    }
    if (typeof rawDescription !== "string") {
      res.status(400).json({ error: "description must be a string" });
      return;
    }
    const description = rawDescription.trim();
    if (description.length === 0) {
      res.status(400).json({ error: "description is required" });
      return;
    }
    if (Buffer.byteLength(description, "utf-8") > 4096) {
      res.status(400).json({ error: "description must be ≤4096 bytes" });
      return;
    }
    // Multi-line description guard (Pitfall 7 belt-and-suspenders)
    if (description.includes("\n") || description.includes("\r")) {
      res.status(400).json({ error: "description must be single-line" });
      return;
    }

    const hostId = rawHostId;
    const skill = rawSkill;

    // 2. Per-user host isolation
    const host = await resolveHostById(hostId, userId);
    if (!host) {
      res.status(404).json({ error: "Host not found" });
      return;
    }

    let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
    try {
      // 3. SSH connect
      try {
        conn = await connectOneShot(host as unknown as Parameters<typeof connectOneShot>[0], SSH_CONNECT_TIMEOUT_MS);
      } catch (err) {
        sshLogger.warn("skills-editor create-skill: SSH connect failed", {
          operation: "skills_editor_create_skill_connect",
          hostId,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH connect failed" });
        return;
      }

      // 4. Resolve remote HOME (Pitfall 4)
      const remoteHome = (await execWithTimeout(conn, "echo $HOME")).trim();
      if (!remoteHome || remoteHome.startsWith("~")) {
        sshLogger.warn("skills-editor create-skill: could not resolve remote HOME", {
          operation: "skills_editor_create_skill_home",
          hostId,
          remoteHome,
        });
        res.status(502).json({ error: "could not resolve remote HOME" });
        return;
      }

      // 5. Compose + prefix-assert (Pitfall 1)
      const skillsPrefix = `${remoteHome}/${SKILL_ROOT_REL}/`;
      const skillRoot = `${skillsPrefix}${skill}`;
      if (!skillRoot.startsWith(skillsPrefix)) {
        res.status(400).json({ error: "path escape detected" });
        return;
      }
      const escapedSkillRoot = shellEscape(skillRoot);

      // 6. Existence check — 409 if skill folder already exists
      const dirCheck = (
        await execWithTimeout(conn, `test -d ${escapedSkillRoot} && echo exists || echo ok`)
      ).trim();
      if (dirCheck === "exists") {
        res.status(409).json({ error: "skill exists" });
        return;
      }

      // 7. mkdir -p
      await execWithTimeout(conn, `mkdir -p ${escapedSkillRoot}`);

      // 8. Compose seed + atomic write (Pitfall 7, Pitfall 8)
      const seed = composeSkillMdSeed(skill, description);
      const skillMdPath = `${skillRoot}/SKILL.md`;
      try {
        await writeMarkdownFileAtomic(conn, skillMdPath, seed);
      } catch (err) {
        // Best-effort cleanup — remove the empty skill folder we just created
        try {
          await execWithTimeout(conn, `rm -rf ${escapedSkillRoot}`);
        } catch { /* best-effort */ }
        sshLogger.error("skills-editor create-skill: SFTP write failed", {
          operation: "skills_editor_create_skill_sftp",
          hostId,
          skillMdPath,
          error: err instanceof Error ? err.message : "Unknown",
        });
        res.status(502).json({ error: "SSH exec failed" });
        return;
      }

      // 9. Stat for authoritative mtime
      const escapedSkillMdPath = shellEscape(skillMdPath);
      const mtimeStr = (
        await execWithTimeout(conn, `stat -c '%Y' ${escapedSkillMdPath} 2>/dev/null || echo 0`)
      ).trim();
      const mtime = parseInt(mtimeStr, 10) || 0;

      res.json({ slug: skill, mtime });
    } catch (err) {
      sshLogger.error("skills-editor create-skill: unexpected error", {
        operation: "skills_editor_create_skill_error",
        hostId,
        error: err instanceof Error ? err.message : "Unknown",
      });
      if (!res.headersSent) {
        res.status(500).json({ error: "internal" });
      }
    } finally {
      if (conn) {
        try { conn.end() } catch { /* best-effort cleanup */ }
      }
    }
  },
);

// Helper — belongs alongside buildAbsSkillFilePath at file-level
function composeSkillMdSeed(slug: string, description: string): string {
  // D-06 exact shape + D-07 unconditional double-quote wrap with \\ + " escape
  const yamlSafeDesc = description
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `---\nname: ${slug}\ndescription: "${yamlSafeDesc}"\n---\n\n`;
}
```

### The DELETE /skills-editor/file SKILL.md guard

```typescript
// Source: mirrors the invariant check pattern in skills-editor.ts DELETE /file
// Placement: immediately after isSafeRelativePath gate at L995-998, BEFORE resolveHostById

// ... existing body validation ends around L998 ...
if (!isSafeRelativePath(rawPath)) {
  res.status(400).json({ error: "invalid path" });
  return;
}
// D-22: SKILL.md invariant guard — runs before resolveHostById (zero SSH cost)
if (rawPath === "SKILL.md") {
  res.status(400).json({ error: "cannot delete SKILL.md" });
  return;
}
const hostId = rawHostId;
const skill = rawSkill;
const relPath = rawPath;
// ... existing resolveHostById continues at L1004 ...
```

### The createSkill API function

```typescript
// Source: src/ui/api/skills-api.ts — new export at end of file
// Mirrors createSkillFile at L163-197

/**
 * POST /skills-editor/skill
 * Creates a new skill folder plus a seed SKILL.md file with YAML frontmatter
 * carrying the name (slug) and description. Backend composes and writes the
 * seed server-side in the same call (D-08 — no round-trip through PUT /write).
 * If the skill folder already exists, throws SkillAlreadyExistsError (409).
 */
export async function createSkill(
  hostId: number,
  name: string,
  description: string,
): Promise<{ slug: string; mtime: number }> {
  try {
    const response = await authApi.post("/skills-editor/skill", {
      hostId,
      skill: name,
      description,
    });
    return response.data as { slug: string; mtime: number };
  } catch (error) {
    const err = error as {
      response?: { status?: number; data?: { error?: string } };
    };
    if (
      err?.response?.status === 409 &&
      err.response.data?.error === "skill exists"
    ) {
      throw new SkillAlreadyExistsError();
    }
    handleApiError(error, "create skill");
    throw error; // unreachable — handleApiError throws; satisfies TS return type
  }
}

/**
 * Typed 409 skill-exists error.
 * Thrown by createSkill when the backend returns 409 with { error: "skill exists" }.
 * Byte-shape mirror of SkillFileAlreadyExistsError (Phase 44 SKILLED-05).
 */
export class SkillAlreadyExistsError extends Error {
  constructor() {
    super("skill exists");
    this.name = "SkillAlreadyExistsError";
  }
}
```

### The handleNewSkill callback (chained prompts with description-retention-on-name-reprompt)

```typescript
// Source: new callback in SkillsEditorModal.tsx alongside handleAddFile at L280-306
// Uses slugifyRoleName from CreateRoleDialog.tsx:118

import { slugifyRoleName } from "@/sidebar/CreateRoleDialog";
import { createSkill, SkillAlreadyExistsError } from "@/api/skills-api";

// ... inside SkillsEditorModal component body ...
const handleNewSkill = useCallback(async (): Promise<void> => {
  if (selectedHostId == null) return;

  // Two-loop structure — outer loop re-prompts name on empty-slug;
  // inner loop re-prompts description on empty-description while
  // retaining the name from the outer loop (D-04).
  let name: string | null = null;
  while (name === null) {
    const rawName = window.prompt("New skill name:", "");
    if (rawName == null) return; // user cancelled name prompt — abort whole flow (D-02)
    const slug = slugifyRoleName(rawName.trim());
    if (slug.length === 0) {
      window.alert("Please pick a name with at least one letter or number.");
      // Loop back to name prompt (do NOT proceed to description).
      continue;
    }
    name = slug;
  }

  let description: string | null = null;
  while (description === null) {
    const rawDesc = window.prompt(`Description for "${name}":`, "");
    if (rawDesc == null) return; // user cancelled desc prompt — abort whole flow (D-02)
    const trimmed = rawDesc.trim();
    if (trimmed.length === 0) {
      window.alert("A description is required.");
      // Loop back to description prompt (name is preserved via outer closure).
      continue;
    }
    description = trimmed;
  }

  try {
    const result = await createSkill(selectedHostId, name, description);
    // Refetch skills list; auto-select the new skill on success (D-05).
    const entries = await listSkills(selectedHostId);
    setSkills({ status: "ready", data: entries });
    setSelectedSkillName(result.slug);
    // The existing selectedSkillName-change effect (L156-183) will
    // enumerateSkillFiles → auto-select the first file, which is SKILL.md
    // because the file list is sorted alphabetically and SKILL.md wins.
  } catch (err) {
    const msg =
      err instanceof SkillAlreadyExistsError
        ? `A skill named "${name}" already exists on this host.`
        : err instanceof Error
        ? `Couldn't create "${name}": ${err.message}`
        : `Couldn't create "${name}".`;
    window.alert(msg);
  }
}, [selectedHostId]);
```

### The `+ New file` tab (D-13, D-14, D-15)

```typescript
// Source: appended after the .map() at SkillsEditorModal.tsx:598-633

import { Plus } from "lucide-react";

// ... inside the tab-strip container's JSX, immediately after {files.data.map(...)} closes ...

<button
  key="__new_file_tab"
  type="button"
  onClick={() => { void handleAddFile(); }}
  // D-14 — no setActiveTab call; the click strictly runs handleAddFile
  className={cn(
    "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-[10px] cursor-pointer transition-colors shrink-0",
    "text-[#a89a80] hover:text-[#e8e4d8]",
    // NEVER selected — the tab is an action, not a state
  )}
>
  <Plus size={18} />
  <span className="text-center whitespace-nowrap">New file</span>
</button>
```

### The SkillFileTab SKILL.md delete-affordance guard (D-10 frontend)

```typescript
// Source: modify src/ui/features/pretty-view/SkillFileTab.tsx L150-158
// Wrap the Trash2 button in a conditional based on the existing `filename` prop.

<div className="flex justify-end gap-2 shrink-0 items-center">
  {filename !== "SKILL.md" && (
    <button
      type="button"
      title="Delete this file"
      onClick={() => onRequestDelete?.()}
      className="size-6 rounded-md hover:bg-white/[0.06] flex items-center justify-center text-[#a89a80] hover:text-[#f87171] cursor-pointer"
    >
      <Trash2 size={16} />
    </button>
  )}
  <button /* Save button unchanged */ />
</div>
```

### The host-picker `flatHosts.length === 1` conditional (D-17)

```typescript
// Source: modify SkillsEditorModal.tsx L413-427
// Wrap the entire <select> block in a conditional.

{flatHosts.length > 1 && (
  <select
    aria-label="Host"
    value={selectedHostId ?? ""}
    onChange={(e) => setSelectedHostId(e.target.value ? Number(e.target.value) : null)}
    className="ml-2 px-3 py-1.5 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] text-sm outline-none cursor-pointer"
  >
    <option value="" style={OPTION_STYLE}>Pick a host…</option>
    {flatHosts.map((h) => (
      <option key={h.id} value={h.id} style={OPTION_STYLE}>{h.name}</option>
    ))}
  </select>
)}
```

The single-host auto-select at L124 (`if (flatHosts.length === 1) setSelectedHostId(Number(flatHosts[0].id));`) is UNCHANGED — the modal opens with the single host already selected; the picker chrome is simply hidden.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Skills created by hand via SSH + `mkdir` + `vim SKILL.md` | Skills created via the modal (this phase) | Phase 113 | User can create + edit skills without leaving the pretty view. |
| Header `+ Add file` button | Tab-strip `+ New file` tab (this phase) | Phase 113 | Affordance lives where its output lives. |
| Host picker always visible | Host picker hidden on single-host installs (this phase) | Phase 113 | No chrome for a choice with one option. |
| `SKILL.md` optionally present on hand-created skills | `SKILL.md` invariant for modal-created skills (forward-only, this phase) | Phase 113 | Runtime skill discovery relies on `SKILL.md`; the modal preserves the invariant it depends on. |
| Buffered `/voice/speak` | Streaming `/voice/speak-stream` | Phase 19 (already shipped) | Unrelated to Phase 113 but noted because the streaming-vs-buffered lesson (patch #232 timeouts, nginx `proxy_buffering off`) inspired the "nginx parity is load-bearing" reflex the phase inherits. |
| Hash-based watchdog matching | Order-based FIFO matching | quick 260908-bqx | Unrelated to Phase 113 but noted because the shape's "shallow-failure-mode" thinking mirrors the state-machine discipline that fixed it. |

**Deprecated / outdated:** None applicable to this phase's scope.

## Assumptions Log

All claims in this research trace either to a `[VERIFIED: file:line]` reading of source in this checkout or to a `[CITED: file/section]` explicit reference in CONTEXT.md / the shape file. No claim requires the user's confirmation.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | (empty) | — | — |

**Table is empty — all recommendations are grounded in verified in-tree code.**

## Open Questions

1. **Is `slugifyRoleName`'s 64-char cap acceptable for a skill name?**
   - What we know: `SKILL_NAME_RE` allows up to 128 chars. `slugifyRoleName` caps at 64. Every existing hand-created skill on the reference box (`/home/ubuntu/.claude/skills/`) has a name well under 32 chars.
   - What's unclear: Whether the shape intended 128 as a soft ceiling or a hard target.
   - Recommendation: 64 is fine — reuse `slugifyRoleName` as-is. If Ashley wants 128, the plan can trivially fork the helper with a 128 cap into a new module. **No blocker.**

2. **Should the empty-file-list body copy live in a shared const or be inlined?**
   - What we know: Current copy at L552-554 is inlined. New copy per D-15 is short.
   - What's unclear: Nothing.
   - Recommendation: Keep inlined. `SkillsEditorModal.tsx` has no consts extracted for copy today; consistency wins.

3. **Should the `POST /skill` route also accept the description in multi-line form (with `\n` escaping in the YAML string)?**
   - What we know: D-06 shape is single-line. `window.prompt` is single-line by browser convention. Pitfall 7 recommends rejecting multi-line on the backend for belt-and-suspenders.
   - What's unclear: Whether a future paste-into-prompt flow (rare but possible on some browsers) could inject a `\n`. Chrome and Firefox both single-line-collapse pasted multi-line content in `window.prompt`, but Safari edge cases exist.
   - Recommendation: Backend early-rejects `\n`/`\r` with a 400 (locked into § Code Examples). Frontend can also `.replace(/[\r\n]/g, " ")` before submit as belt-and-suspenders. Safe either way; the backend guard is the load-bearing one.

## Environment Availability

Skipped — the phase has no external tool dependencies beyond what the existing skills-editor router already uses (SSH client library `ssh2`, `express`, `@testing-library/react`, `vitest`), all of which are already installed. No new CLI, runtime, service, or package manager is introduced.

## Validation Architecture

Skipped per `.planning/config.json` — `workflow.nyquist_validation` is explicitly `false`. Existing scoped-test discipline (D-29) is the plan-level verify gate: executor runs `npx vitest related --run <touched files>`; full suite + playwright smoke are the deploy gate owned by the orchestrator.

## Security Domain

`security_enforcement` is `true` in `.planning/config.json`; `security_asvs_level` is `1`.

### Applicable ASVS Categories (Level 1)

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | `authenticateJWT` middleware. VERIFIED in place on every existing skills-editor route (`skills-editor.ts:466, 612, 803, 961, 1084`) — the new POST `/skill` route uses the identical middleware order. |
| V3 Session Management | yes (indirect) | JWT + SSH connect per-request. `connectOneShot` opens a fresh SSH connection every call; no caching → no session pinning. Cleanup via `finally { conn.end() }` on every route. |
| V4 Access Control | yes | `resolveHostById(hostId, userId)` — per-user host isolation. Cross-user host access → 404 (indistinguishable from "unknown host"). |
| V5 Input Validation | yes | `isValidSkillName` (regex + not-`.`/`..` check) + `isSafeRelativePath` (segment walk, NUL check, length cap) + `Buffer.byteLength` cap on description. Both regex gates run BEFORE any I/O. |
| V6 Cryptography | not applicable | No new cryptographic material introduced. JWT verify uses the existing `AuthManager` singleton; SSH uses the existing `ssh2` library from `connectOneShot`. |
| V7 Error Handling | yes | Response bodies use fixed shapes (`{error:"..."}`) — never leak stderr, remote paths, or credential fragments (see fallback error handler at L1198-1210). New route mirrors this. |
| V13 API and Web Service | yes | REST semantics: 200 on happy path, 400 on validation error, 404 on cross-user host, 409 on duplicate skill, 502 on SSH failure, 500 on internal error. Nginx wildcard block routes the request. |
| V14 Configuration | yes | Nginx parity between `docker/nginx.conf` and `docker/nginx-https.conf` — VERIFIED present in both configs. |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `..` in skill name | Tampering | `isValidSkillName` regex + `skillRoot.startsWith(skillsPrefix)` prefix-assert. Two-layer defense. |
| Shell injection via skill name / description | Tampering | `shellEscape` single-quote wrap on every user-supplied value. Combined with regex gates as AUTH gate. |
| YAML injection via unquoted description | Tampering / Elevation of Privilege | D-07 unconditional double-quote wrap with `\\` + `"` escape (Pitfall 7). |
| Cross-user host access | Information Disclosure | `resolveHostById(hostId, userId)` returns null for cross-user hosts → 404 response (indistinguishable from unknown host). |
| DoS via massive JSON body pre-auth | Denial of Service | `authenticateJWT` runs BEFORE `express.json({limit:"32kb"})` (Pattern 2 / Pitfall 2). |
| DoS via hung remote host | Denial of Service | `connectOneShot(_, 5000ms)` + `execWithTimeout(_, 5000ms)` + nginx `proxy_read_timeout 15s`. |
| SSH connection leak | Denial of Service (resource exhaustion) | `finally { conn.end() }` cleanup on every route (Pitfall 3). |
| Partial-create window (folder without `SKILL.md`) | Repudiation / Integrity | Best-effort `rm -rf skillRoot` cleanup on write failure before 502 return (Pitfall 8). |
| `SKILL.md` deleted via API | Integrity | D-10 backend guard: 400 `{error:"cannot delete SKILL.md"}` early-reject in DELETE `/file` handler (Pitfall — covered by D-22 explicitly). |
| Legacy skill deletion still permitted | Not a threat, but noted | Legacy `SKILL.md`-less skills (D-11) can still be deleted via DELETE `/skill` (the whole-skill delete) — this is intentional. Only DELETE `/file` on `SKILL.md` is guarded. |
| Nginx path-drift (config parity regression) | Denial of Service | Wildcard `location ~ ^/skills-editor(/.*)?$` in BOTH configs — verified this pass. No new nginx block needed. |
| Slopsquat / typosquat | Malicious dependencies | Not applicable — this phase adds ZERO external packages. |

## Sources

### Primary (HIGH confidence)

- **In-tree source files** (all verified this pass):
  - `src/backend/database/routes/skills-editor.ts` — the router being extended. Prologue L1-63 documents the STRIDE posture; the 5 existing endpoints are the reference shape.
  - `src/backend/database/routes/skills-editor.test.ts` — 872 lines of existing test coverage; new tests slot in verbatim.
  - `src/ui/features/pretty-view/SkillsEditorModal.tsx` — the modal being extended. Header L404-514, tab strip L587-634, empty-file-list branch L550-556.
  - `src/ui/features/pretty-view/SkillFileTab.tsx` — the tab body. Delete affordance at L150-158; `filename` prop already threaded at L64-66.
  - `src/ui/features/pretty-view/SkillsEditorModal.test.tsx` — 409 lines of frontend test coverage; the new tests extend this file.
  - `src/ui/features/pretty-view/GlobalFilesModal.tsx` — the byte-shape sibling for host-picker chrome; referenced for pattern awareness only (out of scope per D-19).
  - `src/ui/api/skills-api.ts` — the API client; new `createSkill` + `SkillAlreadyExistsError` land here.
  - `src/backend/claude-session/identity-artifact-reader.ts:1945` — `writeMarkdownFileAtomic` (SFTP tmp+rename via `ext_openssh_rename`). Prologue L1930-1943 documents the EEXIST trap.
  - `src/ui/sidebar/CreateRoleDialog.tsx:118` — `slugifyRoleName` (the reusable client-side slugifier).
  - `docker/nginx.conf:445` and `docker/nginx-https.conf:460` — wildcard block for `/skills-editor` — VERIFIED present in both configs during this research pass.
  - `~/.claude/skills/*/SKILL.md` — real frontmatter samples from the reference box (build, explain, bounty, gsd-audit-fix). Confirms the `name:` + `description:` fields are the canonical shape.
- **Phase agreement:** `.planning/shapes/shape-skill-creation-in-edit-skills-modal.md` and `.planning/phases/113-skill-creation-in-the-edit-skills-modal/113-CONTEXT.md` — the two load-bearing spec files.
- **Config:** `.planning/config.json` — `workflow.nyquist_validation: false`, `security_enforcement: true`, `security_asvs_level: 1`.

### Secondary (MEDIUM confidence)

- None — every finding is HIGH-confidence in-tree source.

### Tertiary (LOW confidence)

- None — no WebSearch or external documentation was needed. All patterns are verified in-tree.

## Metadata

**Confidence breakdown:**

- **Standard stack:** HIGH — every helper, library, and pattern is already present in the codebase; nothing new is proposed.
- **Architecture:** HIGH — matches the 5 existing skills-editor endpoints byte-for-byte; sibling GlobalFilesModal for chrome patterns.
- **Pitfalls:** HIGH — 9 of 10 are directly derived from prologue comments and pattern documentation in `skills-editor.ts` and `identity-artifact-reader.ts`; the 10th (`distributed: true` awareness) is a code-observation.
- **Test bootstrap:** HIGH — extending existing 872-line backend test file and 409-line frontend test file; mocks and harness patterns are already established.
- **Nginx parity:** HIGH — verified present on both configs this pass.
- **Slugifier reuse:** HIGH — verified export at `CreateRoleDialog.tsx:118` with three test-file references confirming it's exercised.
- **Security domain:** HIGH — no new attack surfaces beyond what the 5 existing endpoints already inherit; STRIDE mitigations are documented in prologue.

**Research date:** 2026-09-17

**Valid until:** 2026-10-17 (30 days — the codebase is stable, dependencies are pinned, and no upstream library changes affect this phase). Nginx parity should be re-verified at plan time if any patches between now and execution touch `docker/nginx*.conf` — this is cheap (`grep -n skills-editor docker/nginx*.conf`) and belongs in the plan-check step.
