# Patch #TBD — Phase 44: Frontend skill editing (editor surface for skill folders on a host)

**Date drafted:** 2026-08-19 (planning date — maintainer adjusts to ship date at PIN time)
**Branch:** `feat/tab-title-from-tmux`
**Rebase risk:** LOW (additive backend + additive frontend + parallel nginx blocks; zero upstream Skynet surfaces disturbed)
**Deploy discipline:** mandatory 15-min deadman timer (`/opt/skynet/.tmp-revert.sh`); twin nginx blocks require full container rebuild + `--force-recreate`, NOT the css fast-path.

## Motivation

Ashley asked for a fast-path to make quick edits to a skill's files on any managed host from inside Skynet, mirroring the Phase 23 global-files editor surface she already uses daily. The trigger is fast-adjustment work — she notices a skill wants a small update while she's in the fleet UI and wants to fix it right there without leaving the browser or opening a full-fat editor. The design mandate (per the `/open` shape file at `.planning/shapes/shape-frontend-skill-editing.md`) is three selections max — menu → host → skill — then a tab click, and the whole UX is subordinate to that fast-path. The whole feature is invisible until the panel-header ⋮ menu is opened; no new top-level surface, no new keyboard shortcut, no new prop thread through AppShell.

## What shipped

- **Backend** — new Express router `src/backend/database/routes/skills-editor.ts` (1178 lines) mounted at `/skills-editor` in `src/backend/database/database.ts`, exposing 7 endpoints (list-skills, list-files, read, write with mtime-conflict 409, create with duplicate-409, delete-file, delete-skill). Backed by 816-line vitest coverage (`skills-editor.test.ts`, 39 tests).
- **Frontend** — 6 new files:
  - `src/ui/api/skills-api.ts` — 7 typed authApi helpers + `SkillFileMtimeConflictError` + `SkillFileAlreadyExistsError`
  - `src/ui/features/pretty-view/SkillsEditorModal.tsx` — modal shell + skill dropdown + horizontal-scroll tab strip + `+ Add file` header + delete-skill trigger + two `DeleteConfirmDialog` mounts
  - `src/ui/features/pretty-view/SkillFileTab.tsx` — text-file editor branch (verbatim `GlobalFileTab` shape) + non-text `AlertTriangle` placeholder branch + `Trash2` delete-file trigger
  - `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` — generic destructive-confirm Radix Dialog-in-Dialog (`z-[125]/z-[130]` above parent modal's `z-[110]/z-[120]`)
  - `src/ui/features/pretty-view/SkillsEditorModal.test.tsx` — 8 component tests (race regression + host→skill→files sequence + non-text branch + add-file + both delete flows + RDP filter)
  - `src/ui/features/pretty-view/SkillFileTab.test.tsx` — 10 component tests (loading / error / text / non-text / delete-trigger / mtime-reseed branches)
- **Frontend wiring** — 1 modified file:
  - `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` — 16-line delta: import + useState + portal-mounted `<SkillsEditorModal>` sibling to `<GlobalFilesModal>` + fourth menu item `Edit skills…` positioned after `Edit global files…` + KEEP ORDER guard comment
- **Nginx** — parallel `location ~ ^/skills-editor(/.*)?$` blocks in **both** `docker/nginx.conf` and `docker/nginx-https.conf` (patch #446 reflex — HTTPS conf parity is load-bearing; missing block would 200-return `index.html` and crash the frontend on `.map` parsing)

## Backend surface

| Method | Path                          | Body / Query                                            | 200 Response                                      | Notable Errors                                                                             |
|--------|-------------------------------|---------------------------------------------------------|---------------------------------------------------|--------------------------------------------------------------------------------------------|
| GET    | `/skills-editor/skills`       | `?hostId=<n>`                                           | `{skills: [{name}]}` sorted                       | 400 (invalid hostId) / 404 (cross-user host) / 502 (SSH fail)                              |
| GET    | `/skills-editor/files`        | `?hostId=<n>&skill=<s>`                                 | `{files: [{path}]}` sorted, path-relative         | 400 (invalid skill) / 404 / 502                                                            |
| POST   | `/skills-editor/read`         | `{hostId, skill, path}`                                 | `{content, mtime, size, isText}`                  | 400 / 401 / 404 / 502; `content:""` when `isText:false`                                    |
| PUT    | `/skills-editor/write`        | `{hostId, skill, path, content, expectedMtime?}`        | `{mtime}` server-authoritative                    | 409 `{error:"mtime mismatch", currentMtime, currentContent}` byte-identical to Phase 23    |
| POST   | `/skills-editor/create`       | `{hostId, skill, path}`                                 | `{path, mtime}`                                   | 409 `{error:"file exists"}` / 400 / 404 / 502                                              |
| DELETE | `/skills-editor/file`         | `{hostId, skill, path}` (axios `data:` body)            | `{ok: true}` (rm -f idempotent)                   | 400 / 404 / 502                                                                            |
| DELETE | `/skills-editor/skill`        | `{hostId, skill}` (axios `data:` body)                  | `{ok: true}` (rm -rf, life-critical path-gated)   | 400 (SKILL_NAME_RE fail — gate MUST fire BEFORE rm dispatches; SEC-8 test guards)          |

## Frontend surface

| File                                                       | Role                                                                                                    |
|------------------------------------------------------------|---------------------------------------------------------------------------------------------------------|
| `src/ui/api/skills-api.ts`                                 | axios helpers + typed 409 error classes (SkillFileMtimeConflictError, SkillFileAlreadyExistsError)      |
| `src/ui/features/pretty-view/SkillsEditorModal.tsx`        | Modal shell: host + skill selectors, `+ Add file`, delete-skill, horizontal-scroll tab strip            |
| `src/ui/features/pretty-view/SkillFileTab.tsx`             | Per-tab editor pane: textarea for text files, `AlertTriangle` placeholder for non-text, delete trigger  |
| `src/ui/features/pretty-view/DeleteConfirmDialog.tsx`      | Modal-in-modal destructive-confirm dialog (z-[130] over z-[120] parent, inset-4 overlay for local dim)  |
| `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` | Mount site: portal sibling of GlobalFilesModal + fourth menu item "Edit skills…"                |

## Path-safety design

Every user-supplied path or skill name runs a four-layer defense before any I/O:

1. **`SKILL_NAME_RE = /^[a-zA-Z0-9._-]{1,128}$/`** — regex gate on skill name. Rejects `/`, `\`, `..`, `.`, spaces, shell metachars, empty, over-128 chars.
2. **`isSafeRelativePath(p)`** — regex gate on file path. Rejects non-string, empty, over-512 chars, leading `/`, NUL byte (`\0`), any `..` / `.` / empty segment after `split("/")`.
3. **`buildAbsSkillFilePath(remoteHome, skill, relPath)`** — composes `${remoteHome}/.claude/skills/${skill}/${relPath}` and asserts `absPath.startsWith(skillRoot + "/")`. Returns `null` on violation; callers 400. Regex gates should make this unreachable but the assertion runs anyway.
4. **`shellEscape(s)`** — single-quote wraps every user-supplied value before any `cat`/`stat`/`find`/`rm`/`touch`/`mkdir` interpolation. Same idiom as Phase 23 (AUTH-gate/INJECTION-gate split).

**Life-critical check on `DELETE /skill`:** the `rm -rf` path is guarded by ALL four layers PLUS a second explicit assertion inside the handler (`skillRoot.startsWith(skillsPrefix)`). Dedicated SEC-8 test in `skills-editor.test.ts` asserts `skill: ".."` returns 400 with `connectOneShot` NEVER called AND no `execCommand` starting with `rm -rf` — the entire path is dead before any shell contact. Eight SEC-labeled attack-input tests total: SEC-1 through SEC-8 cover `skill:".."`, `skill:"../etc"`, `skill:"foo/bar"`, `path:"../../etc/passwd"`, `path:"/etc/passwd"` (leading slash), `path:"foo\0.txt"` (real NUL byte in string literal), `path:"foo/../bar"` (embedded `..`), and the delete-skill life-critical case.

## Files touched

**Created (8):**
- `src/backend/database/routes/skills-editor.ts` (1178 lines)
- `src/backend/database/routes/skills-editor.test.ts` (816 lines)
- `src/ui/api/skills-api.ts` (223 lines)
- `src/ui/features/pretty-view/SkillsEditorModal.tsx` (701 lines)
- `src/ui/features/pretty-view/SkillsEditorModal.test.tsx` (372 lines)
- `src/ui/features/pretty-view/SkillFileTab.tsx` (149 lines)
- `src/ui/features/pretty-view/SkillFileTab.test.tsx` (204 lines)
- `src/ui/features/pretty-view/DeleteConfirmDialog.tsx` (95 lines)

**Modified (5):**
- `src/backend/database/database.ts` (+7 lines — import + `app.use` mount)
- `docker/nginx.conf` (+21 lines — `/skills-editor` regex block)
- `docker/nginx-https.conf` (+21 lines — parity block)
- `src/ui/features/pretty-conversations/PrettyConversationsPanel.tsx` (+16 lines — import + useState + portal mount + menu item + KEEP ORDER comment)
- `src/ui/features/pretty-view/ComposeBox.test.tsx` (+4 -1 lines — pre-existing test-drift fix from patch #1503c40c; Rule-3 auto-fix during Wave 1 to unblock full-suite gate)

## Deploy note

**Deploy discipline (mandatory, per DEPLOY DISCIPLINE — no exceptions):**

1. Full container rebuild: `docker compose build skynet` (nginx conf changes are baked in at build; NOT a css fast-path).
2. `docker compose up -d --force-recreate skynet`.
3. Start the 15-min deadman timer BEFORE recreate completes: `/opt/skynet/.tmp-revert.sh 15m` (or your equivalent).
4. Verify HTTPS 200 on the new surface BEFORE the deadman fires. Verify-in-bundle byte checks (grep-friendly strings in the deployed HTML/bundle):
   - Frontend bundle should contain the literal `"Edit skills…"` (menu label).
   - Frontend bundle should contain the literal `"skills-editor/skills"` (URL path constant in `skills-api.ts`).
   - Frontend bundle should contain `"SkillsEditorModal"` (component display name / debug string; may be minified — fall back to `"Edit skills"` search).
5. Live-fire HTTPS check:
   ```bash
   TOKEN=$(cat ~/.claude/skynet-token-for-testing || echo "SET-ME")
   HOST_ID=<pick-a-real-hostId-from-Ashley's-fleet>
   curl -sS -H "Authorization: Bearer $TOKEN" \
     "https://gigaashley.click/skills-editor/skills?hostId=$HOST_ID" | jq
   # Expect: {"skills": [...]}  — NOT the frontend index.html payload.
   ```
   If the response is HTML instead of JSON, the nginx block is missing or misordered — ABORT and let the deadman fire.
6. If HTTPS 200 verified + JSON payload shape correct → cancel the deadman.
7. Post to coord-room announcing patch #TBD landed; drop the UAT checklist link so Ashley can walk it when she's ready.

## Rebase risk — LOW

- **Backend surface is additive.** New router file + 7-line delta to `database.ts` (import + `app.use`). Zero upstream Skynet surfaces touched.
- **Frontend surface is additive.** 6 new files + 16-line delta to `PrettyConversationsPanel.tsx`. The panel delta piggybacks on the Phase 23 wiring pattern (which itself lives above upstream code) — worst-case rebase conflict is a line-drift on `PrettyConversationsPanel.tsx` L60/L485/L1583/L1616 (already at Phase 23-modified positions upstream from `feat/tab-title-from-tmux`).
- **Nginx blocks are parallel to existing `/global-files` blocks.** patch #446 (layer-enumeration reflex) is honored — twin config parity was verified during Wave 1 and grepped again post-wire. Deploy note above reiterates the trap.
- **Reuse of shipped Phase 23 patterns.** `execWithTimeout` + `shellEscape` + lazy-load useEffect race-fix + modal chrome + host-tree filter (`.filter((h) => h.enableRdp !== true)`) are all fourth-instance duplications of existing shipped patterns; no new architectural surface introduced.
- **Full frontend + backend test suite green.** 2592 pass / 9 skipped / 1 todo / 0 fail on Wave 3's completion run (exit 0). Cleaner than Wave 1's baseline which had 4 pre-existing cross-identity contention flakes; Wave 3's run had zero flakes.

## Related

- **Phase 23 (`/global-files` editor)** — the direct byte-shape precedent for the entire cluster (backend router + frontend modal + tab pane + nginx block pattern). Phase 44 is a mirror-and-fork of Phase 23 with the skill dimension threaded through.
- **patch #446 (layer-enumeration reflex)** — every new backend route needs matching `location` blocks in BOTH `docker/nginx.conf` AND `docker/nginx-https.conf`, else it 200s with `index.html` and crashes the frontend on `.map`. Both twin blocks verified for Phase 44.
- **quick-260805-7rq (lazy-load useEffect race)** — the `SkillsEditorModal.tsx` `useEffect` at L173-217 has deps `[selectedHostId, selectedSkillName, activeTab]` (NO `tabData`) with the `eslint-disable-next-line react-hooks/exhaustive-deps` comment preserved byte-verbatim from `GlobalFilesModal.tsx` L143-149. The 700ms lazy-load infinite-spinner regression is guarded by `SkillsEditorModal.test.tsx` test #1.
- **patch #1503c40c (composebox opacity-30 fix)** — pre-existing test drift in `ComposeBox.test.tsx` was Rule-3 auto-fixed during Wave 1 to unblock the full-suite gate; regex swap from `rgba(240,235,224,0.3)` to `opacity-30` per the intent of that fix commit.

## Bounty tracker

Reference the box-maintainer's bounty tree at `~/.claude/roles/box-maintainer/bounties/frontend-skill-editing/` (maintainer's local path — orchestrator confirms and closes the bounty at PIN time). Bounty ships when Ashley signs off on the UAT checklist (`.planning/phases/44-.../44-UAT-CHECKLIST.md`).
