# Phase 113: skill-creation-in-the-edit-skills-modal - Pattern Map

**Mapped:** 2026-09-17
**Files analyzed:** 8 (6 modified, 0 created, 2 test files extended)
**Analogs found:** 8 / 8 (100% — every file has a byte-shape in-tree analog; no new file archetypes introduced)

## File Classification

| File | Modified/Created | Role | Data Flow | Closest Analog | Match Quality |
|------|------------------|------|-----------|----------------|---------------|
| `src/backend/database/routes/skills-editor.ts` (add POST `/skill` + guard in DELETE `/file`) | modified | route (controller) | request-response (RPC over SSH) | Same file — POST `/create` handler (L812-960) + DELETE `/skill` handler (L1093-1193) | exact (same router, same shape) |
| `src/ui/api/skills-api.ts` (add `createSkill` + `SkillAlreadyExistsError`) | modified | api-client (service) | request-response | Same file — `createSkillFile` (L169-197) + `SkillFileAlreadyExistsError` (L57-62) | exact (same file, same 409 pattern) |
| `src/ui/features/pretty-view/SkillsEditorModal.tsx` (add `handleNewSkill`, `+ New skill` button, `+ New file` tab, host-picker conditional, empty-file-list copy repoint, tab-strip hoist) | modified | component (React modal) | event-driven / request-response | Same file — `handleAddFile` (L280-306) + header chrome (L404-514) + tab strip (L587-634) | exact (same file, same modal) |
| `src/ui/features/pretty-view/SkillFileTab.tsx` (guard delete affordance when `filename === "SKILL.md"`) | modified | component (React tab body) | event-driven | Same file — existing Trash2 button (L150-158); the `filename` prop is already threaded (L64-66) | exact (same file, prop already exists) |
| `src/backend/database/routes/skills-editor.test.ts` (extend with POST `/skill` + `SKILL.md` guard cases) | modified | test (backend integration) | request-response | Same file — POST `/create` block (L591-668) + DELETE `/file` block (L674-720) + path-safety block (L770-...) | exact (same file, same harness) |
| `src/ui/features/pretty-view/SkillsEditorModal.test.tsx` (extend with `+ New skill` + `+ New file` + single-host + `SKILL.md` no-delete cases) | modified | test (frontend RTL) | event-driven | Same file — `+ Add file` block (L283-323), delete-file block (L325-357), RDP-filter block (L392-408) | exact (same file, same harness) |
| `docker/nginx.conf` + `docker/nginx-https.conf` | UNCHANGED (verify only) | edge config | request-forwarding | Existing wildcard block at nginx.conf:445 + nginx-https.conf:460 (`location ~ ^/skills-editor(/.*)?$`) covers new route | exact (already covers) |

**Slugifier reuse (import-only, no modification):** `slugifyRoleName` from `src/ui/sidebar/CreateRoleDialog.tsx:118` — imported into `SkillsEditorModal.tsx`, no changes to `CreateRoleDialog.tsx`.

## Pattern Assignments

### `src/backend/database/routes/skills-editor.ts` — new `POST /skills-editor/skill` handler

**Role:** Express route handler (controller, request-response over SSH exec + SFTP).

**Closest analog:** `POST /skills-editor/create` at lines 812-960 in the same file. Both are write-side mkdir+touch/write handlers; the new route swaps `touch` for `writeMarkdownFileAtomic(SKILL.md-seed)` and gates on skill-folder non-existence (409) instead of skill-folder existence (404). Secondary reference: `DELETE /skills-editor/skill` (L1093-1193) for the `skillsPrefix` / `skillRoot.startsWith(skillsPrefix)` prefix-assert pattern that operates on the skill-root path (not a file-inside-skill path), since the new endpoint composes the skill root directly (mkdir target).

**Imports pattern** (L65-73):
```typescript
import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { resolveHostById } from "../../ssh/host-resolver.js";
import { connectOneShot } from "../../ssh/ssh-one-shot.js";
import { execCommand } from "../../ssh/tmux-helper.js";
import { writeMarkdownFileAtomic } from "../../claude-session/identity-artifact-reader.js";
import { sshLogger } from "../../utils/logger.js";
```
No new imports needed — `writeMarkdownFileAtomic`, `connectOneShot`, `execCommand`, `resolveHostById`, `sshLogger` are all already in scope.

**Reusable helpers already in file** (L119-237, verbatim):
- `execWithTimeout(conn, cmd, ms)` — L119-133
- `shellEscape(s)` — L142-144
- `isValidSkillName(s)` — L151-155 (accepts `SKILL_NAME_RE` `/^[a-zA-Z0-9._-]{1,128}$/`, rejects `.`/`..`)
- Constants: `SSH_CONNECT_TIMEOUT_MS = 5000` (L80), `SKILL_ROOT_REL = ".claude/skills"` (L109)

**Auth + body-parser pattern** (verbatim copy from L812-816 POST `/create`):
```typescript
router.post(
  "/skill",
  authenticateJWT, // BEFORE body parser — Pitfall 2
  express.json({ limit: "32kb" }),
  async (req: Request, res: Response): Promise<void> => {
    const userId = (req as AuthenticatedRequest).userId;
    // ...
  },
);
```

**Body-validation pattern** (adapted from L820-843 in POST `/create`):
```typescript
const body = (req.body ?? {}) as Record<string, unknown>;
const rawHostId = body.hostId;
const rawSkill = body.skill;
const rawDescription = body.description;

if (
  typeof rawHostId !== "number" ||
  !Number.isInteger(rawHostId) ||
  rawHostId <= 0
) {
  res.status(400).json({ error: "hostId must be a positive integer" });
  return;
}
if (!isValidSkillName(rawSkill)) {
  res.status(400).json({ error: "invalid skill name" });
  return;
}
// NEW for /skill: description validation (no counterpart in /create)
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
if (description.includes("\n") || description.includes("\r")) {
  res.status(400).json({ error: "description must be single-line" });
  return;
}
const hostId = rawHostId;
const skill = rawSkill;
```

**Per-user host isolation** (verbatim copy from L845-850 in POST `/create`):
```typescript
const host = await resolveHostById(hostId, userId);
if (!host) {
  res.status(404).json({ error: "Host not found" });
  return;
}
```

**SSH connect + HOME resolve pattern** (verbatim copy from L852-880 in POST `/create`):
```typescript
let conn: Awaited<ReturnType<typeof connectOneShot>> | null = null;
try {
  try {
    conn = await connectOneShot(
      host as unknown as Parameters<typeof connectOneShot>[0],
      SSH_CONNECT_TIMEOUT_MS,
    );
  } catch (err) {
    sshLogger.warn("skills-editor create-skill: SSH connect failed", {
      operation: "skills_editor_create_skill_connect",
      hostId,
      error: err instanceof Error ? err.message : "Unknown",
    });
    res.status(502).json({ error: "SSH connect failed" });
    return;
  }

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
```

**Compose + prefix-assert on skill ROOT (not file inside)** — copy from DELETE `/skill` at L1163-1170 (not POST `/create` — this endpoint composes the skill root itself, so the "root of skill" prefix-assert form applies):
```typescript
const skillsPrefix = `${remoteHome}/${SKILL_ROOT_REL}/`;
const skillRoot = `${skillsPrefix}${skill}`;
if (!skillRoot.startsWith(skillsPrefix)) {
  res.status(400).json({ error: "path escape detected" });
  return;
}
const escapedSkillRoot = shellEscape(skillRoot);
```

**Existence gate — 409 (inverted from POST `/create`'s 404)** — mirror the check shape from L896-905 but invert semantics (skill folder must NOT exist for create-skill, MUST exist for create-file):
```typescript
const dirCheck = (
  await execWithTimeout(conn, `test -d ${escapedSkillRoot} && echo exists || echo ok`)
).trim();
if (dirCheck === "exists") {
  res.status(409).json({ error: "skill exists" });
  return;
}
```

**mkdir + writeMarkdownFileAtomic + best-effort cleanup on partial-write failure** (Pitfall 8 — no direct analog; compose from POST `/create` L925 `mkdir -p` and PUT `/write` L747-ish `writeMarkdownFileAtomic` call, plus a new try/catch around the SFTP call):
```typescript
await execWithTimeout(conn, `mkdir -p ${escapedSkillRoot}`);

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
```

**Stat for mtime + response shape** (copy from L931-940 in POST `/create`):
```typescript
const escapedSkillMdPath = shellEscape(skillMdPath);
const mtimeStr = (
  await execWithTimeout(conn, `stat -c '%Y' ${escapedSkillMdPath} 2>/dev/null || echo 0`)
).trim();
const mtime = parseInt(mtimeStr, 10) || 0;

res.json({ slug: skill, mtime });
```

**Error handling + finally cleanup** (verbatim copy from L941-958 in POST `/create`):
```typescript
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
    try {
      conn.end();
    } catch {
      /* best-effort cleanup */
    }
  }
}
```

**New helper — `composeSkillMdSeed`** — goes alongside `buildAbsSkillFilePath` (L226-237). No direct analog in the file; the function is small and self-contained (D-06 shape + D-07 escape rules):
```typescript
function composeSkillMdSeed(slug: string, description: string): string {
  // D-06 exact shape (LF line endings, trailing blank line intentional).
  // D-07 unconditional double-quote wrap; escape embedded \ then " (order matters).
  const yamlSafeDesc = description
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return `---\nname: ${slug}\ndescription: "${yamlSafeDesc}"\n---\n\n`;
}
```

**Placement:** insert the new `router.post("/skill", ...)` block between line 960 (end of POST `/create`) and line 962 (`// -----` divider before DELETE `/file`). Place `composeSkillMdSeed` alongside `buildAbsSkillFilePath` at file-top (near L226-237) so all helpers cluster together.

---

### `src/backend/database/routes/skills-editor.ts` — `SKILL.md` guard inside DELETE `/file`

**Role:** Invariant gate added to the existing DELETE `/file` handler.

**Closest analog:** The `isSafeRelativePath` gate at L995-998 in the same handler (a body-level input-validation gate that runs before `resolveHostById`, zero SSH cost on rejection).

**Placement:** immediately after the `isSafeRelativePath` gate at L995-998, before `const hostId = rawHostId` at L999. The rawPath-based check runs before `resolveHostById` at L1004 so no SSH cost is incurred on rejection.

**Pattern:**
```typescript
// existing gate (L995-998, unchanged):
if (!isSafeRelativePath(rawPath)) {
  res.status(400).json({ error: "invalid path" });
  return;
}
// D-22: SKILL.md invariant guard — hard-reject the sentinel file. Runs
// BEFORE resolveHostById so a wrong-user attacker can't distinguish
// this rejection from an unknown-host 404. Zero SSH cost either way.
if (rawPath === "SKILL.md") {
  res.status(400).json({ error: "cannot delete SKILL.md" });
  return;
}
const hostId = rawHostId;
// ... rest unchanged from L999+
```

---

### `src/ui/api/skills-api.ts` — new `createSkill` function + `SkillAlreadyExistsError` class

**Role:** API client function (service, request-response).

**Closest analog:** `createSkillFile` at L169-197 + `SkillFileAlreadyExistsError` at L57-62 in the same file. Byte-shape mirror — same 409 branch, same `authApi.post` call shape, same `handleApiError` fallthrough.

**Imports pattern** (L1, already in file):
```typescript
import { authApi, handleApiError } from "@/main-axios";
```
No new imports needed.

**Error-class pattern** (verbatim mirror of L52-62 `SkillFileAlreadyExistsError`):
```typescript
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

**API function pattern** (adapted from L163-197 `createSkillFile` — same 409-shape recognition + `handleApiError` fallthrough):
```typescript
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
```

**Placement:** append at end of file (after `deleteSkill` at L226-238). Add error class either at end of file (alongside `createSkill`) or grouped with `SkillFileAlreadyExistsError` at L52-62. Recommendation: append both at end so the diff is a clean tail-append.

---

### `src/ui/features/pretty-view/SkillsEditorModal.tsx` — `handleNewSkill` callback, header chrome changes, tab-strip changes

**Role:** React modal component (event-driven UI + state machine).

**Closest analog:** Same file — `handleAddFile` at L280-306 for the callback shape (chained `window.prompt` + refetch + auto-select + `window.alert` on error), header at L404-514 for the button/select chrome, tab strip at L586-633 for the tab-strip layout.

**New import — slugifier from sidebar** (cross-directory but explicitly allowed per Discretion):
```typescript
import { Plus } from "lucide-react"; // add Plus to existing L2 lucide import block
import { slugifyRoleName } from "@/sidebar/CreateRoleDialog";
```

**New import from `@/api/skills-api`** — extend the existing L8-20 import block by adding `createSkill` and `SkillAlreadyExistsError`:
```typescript
import {
  listSkills,
  enumerateSkillFiles,
  readSkillFile,
  writeSkillFile,
  createSkillFile,
  createSkill,               // NEW
  deleteSkillFile,
  deleteSkill,
  SkillFileMtimeConflictError,
  SkillFileAlreadyExistsError,
  SkillAlreadyExistsError,   // NEW
  type SkillEntry,
  type SkillFileEntry,
} from "@/api/skills-api";
```

**`handleAddFile` reference pattern** (existing, L280-306 — the callback shape being mirrored):
```typescript
const handleAddFile = useCallback(async (): Promise<void> => {
  if (selectedHostId == null || selectedSkillName == null) return;
  const raw = window.prompt("New file name (relative to skill root):", "");
  if (raw == null) return;
  const relPath = raw.trim();
  if (relPath.length === 0) return;
  try {
    await createSkillFile(selectedHostId, selectedSkillName, relPath);
    const entries = await enumerateSkillFiles(selectedHostId, selectedSkillName);
    setFiles({ status: "ready", data: entries });
    setActiveTab(relPath);
  } catch (err) {
    const msg =
      err instanceof SkillFileAlreadyExistsError
        ? `A file named "${relPath}" already exists in this skill.`
        : err instanceof Error
        ? `Couldn't create "${relPath}": ${err.message}`
        : `Couldn't create "${relPath}".`;
    window.alert(msg);
  }
}, [selectedHostId, selectedSkillName]);
```

**New `handleNewSkill` callback** — adapt the `handleAddFile` shape with two-loop structure to preserve name across empty-description re-prompt (D-04) and re-prompt on empty-slug (D-03). Insert alongside `handleAddFile` (~L280) inside the component body:
```typescript
const handleNewSkill = useCallback(async (): Promise<void> => {
  if (selectedHostId == null) return;

  // Outer loop — re-prompts name until slugify yields non-empty (D-03).
  let name: string | null = null;
  while (name === null) {
    const rawName = window.prompt("New skill name:", "");
    if (rawName == null) return; // D-02: cancel on name prompt aborts the whole flow
    const slug = slugifyRoleName(rawName.trim());
    if (slug.length === 0) {
      window.alert("Please pick a name with at least one letter or number.");
      continue; // re-prompt name
    }
    name = slug;
  }

  // Inner loop — re-prompts description until non-empty (D-04). Name is
  // preserved across re-prompts via the closure over `name` above.
  let description: string | null = null;
  while (description === null) {
    const rawDesc = window.prompt(`Description for "${name}":`, "");
    if (rawDesc == null) return; // D-02: cancel on description prompt aborts the whole flow
    const trimmed = rawDesc.trim();
    if (trimmed.length === 0) {
      window.alert("A description is required.");
      continue; // re-prompt description ONLY (name is retained per D-04)
    }
    description = trimmed;
  }

  try {
    const result = await createSkill(selectedHostId, name, description);
    // D-05: refetch skills list + auto-select new skill; the existing
    // selectedSkillName-change effect (L156-183) enumerates files and
    // auto-selects the first file, which is SKILL.md (alphabetical sort).
    const entries = await listSkills(selectedHostId);
    setSkills({ status: "ready", data: entries });
    setSelectedSkillName(result.slug);
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

**Header change 1: host-picker conditional** (D-17 — modify L413-427). Wrap the existing `<select aria-label="Host">` in `{flatHosts.length > 1 && (…)}`. No structural rewrite — just a wrapping conditional:
```typescript
{flatHosts.length > 1 && (
  <select
    aria-label="Host"
    value={selectedHostId ?? ""}
    onChange={(e) =>
      setSelectedHostId(e.target.value ? Number(e.target.value) : null)
    }
    className="ml-2 px-3 py-1.5 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] text-sm outline-none cursor-pointer"
  >
    <option value="" style={OPTION_STYLE}>Pick a host…</option>
    {flatHosts.map((h) => (
      <option key={h.id} value={h.id} style={OPTION_STYLE}>{h.name}</option>
    ))}
  </select>
)}
```

**Header change 2: remove `+ Add file` button** (D-12) — delete lines L459-469 entirely:
```typescript
// DELETE THIS BLOCK (L459-469):
<button
  type="button"
  onClick={() => { void handleAddFile(); }}
  disabled={!selectedSkillName || files.status !== "ready"}
  className="ml-2 px-3 py-1.5 rounded-md bg-[hsla(220,80%,60%,0.20)] hover:bg-[hsla(220,80%,60%,0.30)] text-[#e8e4d8] text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
>
  + Add file
</button>
```
Note: `handleAddFile` is retained — it's still called from the new tab-strip `+ New file` button.

**Header change 3: add `+ New skill` button** (D-01) — insert between skill picker (ends L457) and delete-skill trash (begins L473). Use the same `bg-[hsla(220,80%,60%,0.20)]` primary-accent style as the removed `+ Add file` button:
```typescript
{/* + New skill — Phase 113 D-01. Same primary-accent style as the retired
    + Add file button. Enabled whenever a host is picked. */}
<button
  type="button"
  onClick={() => { void handleNewSkill(); }}
  disabled={selectedHostId == null}
  className="ml-2 px-3 py-1.5 rounded-md bg-[hsla(220,80%,60%,0.20)] hover:bg-[hsla(220,80%,60%,0.30)] text-[#e8e4d8] text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
>
  + New skill
</button>
```

**Empty-file-list copy repoint** (D-15 — modify L550-556):
```typescript
) : files.data.length === 0 ? (
  <div className="flex-1 flex flex-col items-center justify-center text-[#a89a80] gap-2 text-sm text-center px-6">
    <div>This skill has no files.</div>
    <div className="text-xs opacity-70">
      Use the &quot;+ New file&quot; tab below to create one.
    </div>
  </div>
) : (
```

**Tab-strip changes: hoist tab-strip render + append `+ New file` action-tab** (D-13, D-14, D-15, D-16).

**Structural change:** the tab strip at L587-634 currently renders only inside the populated-tabs branch (L557's `<Tabs>`). D-15 requires the tab-strip render (with `+ New file` as sole child) even when `files.data.length === 0`. Recommended structural fix: keep the `<Tabs>` block for the populated case, but factor the tab-strip container so it renders on both the empty-file-list body branch AND the populated-tabs body branch. Simplest implementation: the `+ New file` tab is always the last child of the tab strip regardless of `files.data.length`.

**`+ New file` `<button>` tab** (D-13, D-14 — appended after `files.data.map(...)` at L633, styled as tab but never selected). Uses `Plus` icon at size 18 to match existing `FileText` icon at size 18 (L625):
```typescript
{/* + New file — Phase 113 D-13. Styled as a tab, honestly a button.
    Never selected (D-14); never in activeTab state (D-16). Pinned right
    as the last child of the tab-strip container regardless of scroll. */}
<button
  key="__new_file_tab"
  type="button"
  onClick={() => { void handleAddFile(); }}
  className={cn(
    // Match the file-tab intrinsic-width + shrink-0 treatment so overflow-x-auto
    // parent scrolls the map'd tabs; the + New file stays as last-child pinned right.
    "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-[10px] cursor-pointer transition-colors shrink-0",
    "text-[#a89a80] hover:text-[#e8e4d8]",
  )}
>
  <Plus size={18} />
  <span className="text-center whitespace-nowrap">New file</span>
</button>
```

**Existing `+ Add file` handler retention:** `handleAddFile` (L280-306) is retained verbatim. Only the header button that invoked it is removed; the new `+ New file` tab uses the same callback. No change to `handleAddFile`'s body.

---

### `src/ui/features/pretty-view/SkillFileTab.tsx` — `SKILL.md` delete-affordance guard

**Role:** React tab body component (event-driven UI).

**Closest analog:** Same file — the existing Trash2 button at L150-158 (the delete-file trigger). The `filename` prop is already threaded through the component at L64-66 and used by `MarkdownEditor` at L142 — no prop-plumbing needed.

**Pattern — wrap the Trash2 button in a `filename !== "SKILL.md"` conditional** (D-10 frontend layer). Modify L150-158:
```typescript
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
  {/* Save button unchanged (L159-166) */}
```

---

### `src/backend/database/routes/skills-editor.test.ts` — extend with POST `/skill` + `SKILL.md` guard cases

**Role:** Vitest integration tests (backend, bare Express + node http harness).

**Closest analog:** Same file — the POST `/create` block (L591-668) is the byte-shape mirror for the new POST `/skill` block (same harness, same mocks, same `httpRequest` helper). The DELETE `/file` block (L674-720) is the analog for the `SKILL.md` guard tests. Path-safety block (L770+) is the analog for path-escape 400 tests.

**Harness pattern is verbatim reusable** — no new mocks or setup needed. The existing setup (L211-233) already mocks `connectOneShot`, `execCommand`, `resolveHostById`, and `writeMarkdownFileAtomic`. The `defaultExecImpl` at L191-208 already handles `test -d` / `mkdir -p` / `stat -c '%Y'` — needs one addition to differentiate "skill exists" (409 case) from "skill does not exist" (happy path).

**Test block structure — mirror POST `/create` L591-668:**

Happy-path test (mirror L592-611 in POST `/create`):
```typescript
describe("POST /skills-editor/skill", () => {
  it("200 with { slug, mtime } on new skill; mkdir + writeMarkdownFileAtomic called", async () => {
    // Default: test -d returns "exists" — override to "ok" (not exists) for this create case.
    (execCommand as Mock).mockImplementation(async (_conn: unknown, cmd: string) => {
      if (cmd === "echo $HOME") return "/home/testuser\n";
      if (cmd.startsWith("test -d ")) return "ok"; // skill folder does NOT exist yet
      if (cmd.startsWith("mkdir -p")) return "";
      if (cmd.includes("stat -c '%Y'")) return "1700000042";
      return "";
    });
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/skill",
      body: JSON.stringify({ hostId: 1, skill: "new-skill", description: "A test skill." }),
    });
    expect(res.status).toBe(200);
    const body = res.body as { slug: string; mtime: number };
    expect(body.slug).toBe("new-skill");
    expect(body.mtime).toBe(1700000042);
    // Verify mkdir -p + writeMarkdownFileAtomic invocations
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    expect(calls.find(([, c]) => c.startsWith("mkdir -p"))).toBeDefined();
    expect(writeMarkdownFileAtomic).toHaveBeenCalledWith(
      expect.anything(),
      "/home/testuser/.claude/skills/new-skill/SKILL.md",
      expect.stringContaining('name: new-skill'),
    );
    // Assert the seed content shape (D-06 + D-07)
    const seedArg = (writeMarkdownFileAtomic as Mock).mock.calls[0][2] as string;
    expect(seedArg).toBe('---\nname: new-skill\ndescription: "A test skill."\n---\n\n');
  });
```

Duplicate 409 (mirror L613-632 in POST `/create`):
```typescript
  it("409 with { error: 'skill exists' } when skill folder already exists", async () => {
    // Default mock has test -d → "exists" — no override needed.
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/skill",
      body: JSON.stringify({ hostId: 1, skill: "build", description: "hi" }),
    });
    expect(res.status).toBe(409);
    expect((res.body as { error: string }).error).toBe("skill exists");
    // Should NOT have called mkdir or writeMarkdownFileAtomic.
    const calls = (execCommand as Mock).mock.calls as [unknown, string][];
    expect(calls.find(([, c]) => c.startsWith("mkdir -p"))).toBeUndefined();
    expect(writeMarkdownFileAtomic).not.toHaveBeenCalled();
  });
```

Invalid-name 400, empty-description 400, overlength-description 400 (mirror L634-641 in POST `/create`):
```typescript
  it("400 on invalid skill name", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/skill",
      body: JSON.stringify({ hostId: 1, skill: "bad name", description: "hi" }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("400 on empty description", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/skill",
      body: JSON.stringify({ hostId: 1, skill: "new-skill", description: "   " }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("description is required");
  });

  it("400 on overlength description (>4KB)", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/skill",
      body: JSON.stringify({ hostId: 1, skill: "new-skill", description: "x".repeat(5000) }),
    });
    expect(res.status).toBe(400);
  });
```

Path-escape 400 + missing-host 404 + SSH-connect-fail 502 (mirror L634-641 + L708-719 + L282-289 pattern):
```typescript
  it("400 on path escape attempt via '..'", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/skill",
      body: JSON.stringify({ hostId: 1, skill: "..", description: "hi" }),
    });
    expect(res.status).toBe(400);
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
  });

  it("404 on cross-user / unknown host", async () => {
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/skill",
      body: JSON.stringify({ hostId: 999, skill: "new-skill", description: "hi" }),
    });
    expect(res.status).toBe(404);
  });

  it("502 on SSH connect fail", async () => {
    (connectOneShot as Mock).mockRejectedValueOnce(new Error("connect refused"));
    const res = await httpRequest(server, {
      method: "POST",
      path: "/skills-editor/skill",
      body: JSON.stringify({ hostId: 1, skill: "new-skill", description: "hi" }),
    });
    expect(res.status).toBe(502);
    expect((res.body as { error: string }).error).toBe("SSH connect failed");
  });
});
```

**DELETE `/file` `SKILL.md` guard tests** — extend the existing `describe("DELETE /skills-editor/file", ...)` block at L674-720 with three new cases (D-27):
```typescript
  it("400 with { error: 'cannot delete SKILL.md' } when path === 'SKILL.md'; no SSH opened", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/skills-editor/file",
      body: JSON.stringify({ hostId: 1, skill: "build", path: "SKILL.md" }),
    });
    expect(res.status).toBe(400);
    expect((res.body as { error: string }).error).toBe("cannot delete SKILL.md");
    // Guard runs BEFORE resolveHostById — no SSH opened, no exec fired.
    expect((connectOneShot as Mock).mock.calls).toHaveLength(0);
    expect((execCommand as Mock).mock.calls).toHaveLength(0);
  });

  it("SKILL.md.bak (sibling filename) is NOT guarded; deletes normally", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/skills-editor/file",
      body: JSON.stringify({ hostId: 1, skill: "build", path: "SKILL.md.bak" }),
    });
    expect(res.status).toBe(200);
    const rmCall = ((execCommand as Mock).mock.calls as [unknown, string][])
      .find(([, cmd]) => cmd.startsWith("rm -f "));
    expect(rmCall).toBeDefined();
    expect(rmCall![1]).toContain("SKILL.md.bak");
  });

  it("nested/SKILL.md (nested filename) is NOT guarded; deletes normally", async () => {
    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/skills-editor/file",
      body: JSON.stringify({ hostId: 1, skill: "build", path: "nested/SKILL.md" }),
    });
    expect(res.status).toBe(200);
    const rmCall = ((execCommand as Mock).mock.calls as [unknown, string][])
      .find(([, cmd]) => cmd.startsWith("rm -f "));
    expect(rmCall).toBeDefined();
    expect(rmCall![1]).toContain("nested/SKILL.md");
  });
```

**Note on existing test at L675-693:** the existing happy-path DELETE `/file` test deletes `path: "SKILL.md"` and asserts 200. After this phase's D-22 guard lands, that test must be updated — change `path: "SKILL.md"` to another filename (`README.md` or similar) so the pre-existing happy-path assertion still passes. This is a required companion edit, not a new test.

---

### `src/ui/features/pretty-view/SkillsEditorModal.test.tsx` — extend with `+ New skill` + `+ New file` + single-host + `SKILL.md` no-delete cases

**Role:** Vitest + @testing-library/react integration tests (frontend RTL).

**Closest analog:** Same file — the `+ Add file` block at L283-323 for the chained-prompt pattern; the delete-file block at L325-357 for the `SKILL.md` no-delete case; the RDP-filter block at L392-408 for the single-host-hides-picker case.

**Existing mock — already covers listSkills / enumerateSkillFiles / createSkillFile / deleteSkillFile / deleteSkill.** Extend the `vi.mock("@/api/skills-api", ...)` hoisted block at L25-51 to also mock `createSkill` and re-export `SkillAlreadyExistsError`:
```typescript
vi.mock("@/api/skills-api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    listSkills: vi.fn().mockResolvedValue([
      { name: "build" },
      { name: "explain" },
    ]),
    enumerateSkillFiles: vi.fn().mockResolvedValue([
      { path: "SKILL.md" },
      { path: "tests/basic.py" },
    ]),
    readSkillFile: vi.fn().mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return {
        content: "MOCKED SKILL FILE CONTENT",
        mtime: 1_700_000_042,
        size: 26,
        isText: true,
      };
    }),
    writeSkillFile: vi.fn().mockResolvedValue({ mtime: 1_700_000_099 }),
    createSkillFile: vi.fn().mockResolvedValue({ path: "new.md", mtime: 1_700_000_101 }),
    createSkill: vi.fn().mockResolvedValue({ slug: "new-skill", mtime: 1_700_000_200 }), // NEW
    deleteSkillFile: vi.fn().mockResolvedValue(undefined),
    deleteSkill: vi.fn().mockResolvedValue(undefined),
  };
});
```

**Chained-prompt pattern reference** — extend `+ Add file` test at L283-323 (existing prompt-spy pattern for chained flows):

`+ New skill` chained-prompt happy path (mirror L292-322 shape):
```typescript
it("+ New skill: chained prompt (name → description) calls createSkill and auto-selects", async () => {
  const promptSpy = vi.spyOn(window, "prompt")
    .mockReturnValueOnce("My Cool Skill")     // name prompt
    .mockReturnValueOnce("A cool skill.");    // description prompt
  // createSkill returns slug "my-cool-skill" — the slugified form.
  (skillsApi.createSkill as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    slug: "my-cool-skill",
    mtime: 1_700_000_200,
  });
  // listSkills second call (after create) — includes the new skill.
  (skillsApi.listSkills as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce([{ name: "build" }, { name: "explain" }])
    .mockResolvedValueOnce([{ name: "build" }, { name: "explain" }, { name: "my-cool-skill" }]);

  render(<SkillsEditorModal open={true} onOpenChange={vi.fn()} hostTree={HOST_TREE} defaultHostId={1} container={document.body} />);

  await waitFor(() => expect(screen.getByRole("button", { name: /\+ new skill/i })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /\+ new skill/i }));

  await waitFor(() => {
    expect(skillsApi.createSkill).toHaveBeenCalledWith(1, "my-cool-skill", "A cool skill.");
  });
  promptSpy.mockRestore();
});
```

`+ New skill` visibility test (mirror L392-408 shape):
```typescript
it("+ New skill button is hidden when no host is picked, visible when host is picked", async () => {
  render(<SkillsEditorModal open={true} onOpenChange={vi.fn()} hostTree={HOST_TREE} defaultHostId={null} container={document.body} />);

  // With defaultHostId=null and multi-host tree, host isn't auto-picked → button disabled.
  const btn = screen.getByRole("button", { name: /\+ new skill/i }) as HTMLButtonElement;
  expect(btn.disabled).toBe(true);
});
```

Cancellation-on-first-prompt (D-02):
```typescript
it("+ New skill: cancel on name prompt → no createSkill call, no state change", async () => {
  const promptSpy = vi.spyOn(window, "prompt").mockReturnValueOnce(null); // cancel

  render(<SkillsEditorModal open={true} onOpenChange={vi.fn()} hostTree={HOST_TREE} defaultHostId={1} container={document.body} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /\+ new skill/i })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /\+ new skill/i }));

  // Only one prompt fires (name); description prompt never fires; createSkill never called.
  await waitFor(() => expect(promptSpy).toHaveBeenCalledTimes(1));
  expect(skillsApi.createSkill).not.toHaveBeenCalled();
  promptSpy.mockRestore();
});
```

Cancellation-on-second-prompt (D-02):
```typescript
it("+ New skill: cancel on description prompt → no createSkill call", async () => {
  const promptSpy = vi.spyOn(window, "prompt")
    .mockReturnValueOnce("My Skill")   // name — accept
    .mockReturnValueOnce(null);         // description — cancel

  render(<SkillsEditorModal open={true} onOpenChange={vi.fn()} hostTree={HOST_TREE} defaultHostId={1} container={document.body} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /\+ new skill/i })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /\+ new skill/i }));

  await waitFor(() => expect(promptSpy).toHaveBeenCalledTimes(2));
  expect(skillsApi.createSkill).not.toHaveBeenCalled();
  promptSpy.mockRestore();
});
```

Empty-description re-prompt retains name (D-04):
```typescript
it("+ New skill: empty description re-prompts description ONLY; name is retained", async () => {
  const alertSpy = vi.spyOn(window, "alert").mockImplementation(() => {});
  const promptSpy = vi.spyOn(window, "prompt")
    .mockReturnValueOnce("My Skill")   // name (accepted, slugifies to "my-skill")
    .mockReturnValueOnce("   ")         // description (empty after trim → re-prompt)
    .mockReturnValueOnce("Fine desc");  // description retry

  render(<SkillsEditorModal open={true} onOpenChange={vi.fn()} hostTree={HOST_TREE} defaultHostId={1} container={document.body} />);
  await waitFor(() => expect(screen.getByRole("button", { name: /\+ new skill/i })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /\+ new skill/i }));

  await waitFor(() => {
    expect(skillsApi.createSkill).toHaveBeenCalledWith(1, "my-skill", "Fine desc");
  });
  // Name prompt fired ONCE (not twice); description prompt fired twice.
  const nameCall = promptSpy.mock.calls.find((c) => (c[0] as string).includes("skill name"));
  const descCalls = promptSpy.mock.calls.filter((c) => (c[0] as string).includes("Description"));
  expect(nameCall).toBeDefined();
  expect(descCalls).toHaveLength(2);
  expect(alertSpy).toHaveBeenCalledWith(expect.stringMatching(/description is required/i));
  promptSpy.mockRestore();
  alertSpy.mockRestore();
});
```

Single-host hides picker (D-17 — mirror L392-408 shape):
```typescript
it("single-host: host picker <select> is hidden entirely", async () => {
  // HOST_TREE has exactly one SSH host — flatHosts.length === 1.
  render(<SkillsEditorModal open={true} onOpenChange={vi.fn()} hostTree={HOST_TREE} defaultHostId={1} container={document.body} />);
  // Host <select> should NOT be present. Only skill <select> is a combobox now.
  const comboboxes = screen.queryAllByRole("combobox");
  expect(comboboxes).toHaveLength(1); // only the skill picker
  expect(screen.queryByRole("combobox", { name: /host/i })).toBeNull();
});

it("multi-host (2+ SSH hosts): host picker <select> is visible", async () => {
  const multi: HostFolder = {
    name: "root",
    children: [
      HOST_TREE.children[0],
      { ...HOST_TREE.children[0], id: "2", name: "second-host" },
    ],
  };
  render(<SkillsEditorModal open={true} onOpenChange={vi.fn()} hostTree={multi} defaultHostId={null} container={document.body} />);
  expect(screen.queryByRole("combobox", { name: /host/i })).toBeTruthy();
});
```

`+ New file` tab position + no-activeTab-change (D-13, D-14, D-16):
```typescript
it("+ New file tab is the LAST child of the tab strip", async () => {
  render(<SkillsEditorModal open={true} onOpenChange={vi.fn()} hostTree={HOST_TREE} defaultHostId={1} container={document.body} />);
  await selectSkill("build");
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeTruthy());
  // Find the tab strip container's last button — should be "New file".
  const tabButtons = screen.getAllByRole("button").filter((b) => /new file|skill\.md|tests\/basic\.py/i.test(b.textContent ?? ""));
  const last = tabButtons[tabButtons.length - 1];
  expect(last.textContent).toMatch(/new file/i);
});

it("+ New file tab click does NOT change activeTab (existing file tab stays selected)", async () => {
  const promptSpy = vi.spyOn(window, "prompt").mockReturnValue("new-file.md");
  render(<SkillsEditorModal open={true} onOpenChange={vi.fn()} hostTree={HOST_TREE} defaultHostId={1} container={document.body} />);
  await selectSkill("build");
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeTruthy());
  // Note the currently-active tab — SKILL.md (first file, auto-selected).
  const newFileBtn = screen.getByRole("button", { name: /new file/i });
  fireEvent.click(newFileBtn);
  // handleAddFile fires createSkillFile via the mocked API, not setActiveTab-to-new-file-tab.
  await waitFor(() => expect(skillsApi.createSkillFile).toHaveBeenCalled());
  // The "New file" pseudo-tab is never highlighted — it has no font-semibold class + no active pill style.
  const btnClasses = newFileBtn.className;
  expect(btnClasses).not.toMatch(/font-semibold/);
  promptSpy.mockRestore();
});
```

`SKILL.md` tab has no delete affordance (D-10 frontend):
```typescript
it("SKILL.md tab has NO delete (Trash2) affordance", async () => {
  render(<SkillsEditorModal open={true} onOpenChange={vi.fn()} hostTree={HOST_TREE} defaultHostId={1} container={document.body} />);
  await selectSkill("build");
  // SKILL.md is auto-selected as the first file. Verify no delete-file trigger.
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeTruthy());
  expect(screen.queryByTitle(/delete this file/i)).toBeNull();
});

it("Non-SKILL.md tab retains delete affordance", async () => {
  render(<SkillsEditorModal open={true} onOpenChange={vi.fn()} hostTree={HOST_TREE} defaultHostId={1} container={document.body} />);
  await selectSkill("build");
  // Switch to tests/basic.py tab.
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /tests\/basic\.py/i }));
  await waitFor(() => expect(screen.queryByTitle(/delete this file/i)).toBeTruthy());
});
```

**Companion edit to existing delete-file test:** the existing delete-file confirm test at L325-357 targets `SKILL.md` (see `expect(skillsApi.deleteSkillFile).toHaveBeenCalledWith(1, "build", "SKILL.md")` at L355). After D-10 frontend lands, that Trash2 button is never rendered on the `SKILL.md` tab — the test must switch to a non-SKILL.md tab first (e.g., `fireEvent.click(screen.getByRole("button", { name: /tests\/basic\.py/i }))` before the delete trigger click), and update the assertion to `deleteSkillFile(1, "build", "tests/basic.py")`.

---

### `docker/nginx.conf` + `docker/nginx-https.conf` — verify only, no edit

**Role:** Edge / nginx config.

**Verification:** Both files carry the wildcard block that already covers `POST /skills-editor/skill` — no new location block needed:
- `docker/nginx.conf:445` → `location ~ ^/skills-editor(/.*)?$`
- `docker/nginx-https.conf:460` → `location ~ ^/skills-editor(/.*)?$`

**Confirmed present** via `grep -n 'location.*skills-editor' docker/nginx*.conf`. No modification required for this phase. Restoration is a plan task only if a patch between pattern-map time and execution time regresses either config (unlikely — verify at plan-check).

---

## Shared Patterns

### STRIDE 5-layer route posture (verbatim across all 5 existing routes + the new POST `/skill`)

**Source:** `src/backend/database/routes/skills-editor.ts` prologue L36-55 + every existing `router.*(...)` handler.

**Apply to:** the new `POST /skill` route.

**Pattern:**
1. `authenticateJWT` BEFORE `express.json({limit:"32kb"})` — Pattern 2 / Pitfall 2.
2. Body validate → 400 BEFORE any I/O (`isValidSkillName` + typed hostId + description size/content).
3. `resolveHostById(hostId, userId)` → 404 on cross-user / unknown.
4. `connectOneShot(host, SSH_CONNECT_TIMEOUT_MS)` inside try/catch → 502 on connect failure; sshLogger.warn with `operation: "..._connect"`.
5. `execWithTimeout(conn, "echo $HOME")` + `!remoteHome || remoteHome.startsWith("~")` guard → 502 on unresolved HOME.
6. Compose `skillsPrefix` + `skillRoot`; assert `skillRoot.startsWith(skillsPrefix)` → 400 on failure; `shellEscape` every user value before interpolation.
7. Exec / SFTP the operation.
8. `finally { conn.end() }` cleanup with try/catch.

### 409-shape API error class

**Source:** `src/ui/api/skills-api.ts` L57-62 (`SkillFileAlreadyExistsError`).

**Apply to:** `SkillAlreadyExistsError` on the new `createSkill`.

**Pattern:**
```typescript
export class SkillAlreadyExistsError extends Error {
  constructor() {
    super("skill exists");
    this.name = "SkillAlreadyExistsError";
  }
}
```
Only recognize the specific 409 shape (`status === 409 && data.error === "skill exists"`) — a future 409 semantic on this endpoint should NOT misfire as an already-exists dialog. Fall through to `handleApiError(error, "create skill")` for all other error shapes.

### Chained `window.prompt` UX register

**Source:** `src/ui/features/pretty-view/SkillsEditorModal.tsx` L280-306 (`handleAddFile`).

**Apply to:** new `handleNewSkill` callback.

**Pattern:**
- Guard on `selectedHostId == null` / `selectedSkillName == null` at entry.
- `window.prompt` returns `null` on cancel → return early (no side effect, no state change).
- `.trim()` before non-empty check.
- On success: refetch list + auto-select the new item via `setActiveTab` (for files) or `setSelectedSkillName` (for skills — new).
- On failure: `window.alert` with a targeted message; recognize the typed 409 error class first, then generic `Error.message`, then generic fallback.

### Body branch chain in the modal

**Source:** `src/ui/features/pretty-view/SkillsEditorModal.tsx` L517-556 (existing branched ternary).

**Apply to:** the empty-file-list branch (D-15 copy repoint) and the tab-strip structural change.

**Pattern:** modal body is a chain of `?:` ternaries, each guarding on a state (`selectedHostId == null` → `skills.status === "loading"` → `skills.status === "error"` → `skills.data.length === 0` → `selectedSkillName == null` → `files.status === "loading"` → `files.status === "error"` → `files.data.length === 0` → populated). The `files.data.length === 0` branch renders the empty-state copy; the populated branch renders `<Tabs>` with `<TabsContent>` per file and the tab-strip button row. D-15 requires the tab-strip button row to render on the empty-file-list branch too (with `+ New file` as its sole child).

### Auth mock harness for backend tests

**Source:** `src/backend/database/routes/skills-editor.test.ts` L42-93 (auth manager mock + SSH primitives mock + logger mock).

**Apply to:** the new POST `/skill` and DELETE `/file` guard tests.

**Pattern:** verbatim reuse of the module-level mocks + `defaultExecImpl` + `stubHost` + `httpRequest` helper. No new mock setup needed. Extend the `defaultExecImpl` at L191-208 to handle `test -d ${skillRoot}` returning "ok" (non-exists) when the test wants the create-skill happy path.

### Frontend test mock hoisting pattern

**Source:** `src/ui/features/pretty-view/SkillsEditorModal.test.tsx` L23-51 (`vi.mock("@/api/skills-api", async (importOriginal) => { ... })`).

**Apply to:** extending mock to include `createSkill`.

**Pattern:** hoisted `vi.mock` with `importOriginal` spread + per-function `vi.fn().mockResolvedValue(...)`. Extend rather than replace — the existing 8 mocked functions stay; add `createSkill: vi.fn().mockResolvedValue({ slug: "...", mtime: ... })`.

---

## No Analog Found

All files have strong analogs in-tree. Zero files require RESEARCH.md fallback patterns.

| File | Reason |
|------|--------|
| — | — |

The single novel piece (`composeSkillMdSeed` helper) is a 5-line pure function with no analog needed — it's a straightforward string builder implementing the D-06 shape + D-07 escape.

---

## Metadata

**Analog search scope:**
- `src/backend/database/routes/` — for backend route analogs (skills-editor.ts + skills-editor.test.ts).
- `src/ui/api/` — for API client analog (skills-api.ts).
- `src/ui/features/pretty-view/` — for modal + tab component analogs (SkillsEditorModal.tsx, SkillsEditorModal.test.tsx, SkillFileTab.tsx).
- `src/ui/sidebar/` — for slugifier reuse (CreateRoleDialog.tsx).
- `src/backend/claude-session/` — for `writeMarkdownFileAtomic` helper (identity-artifact-reader.ts:1945; already imported by skills-editor.ts).
- `docker/` — for nginx parity verification (nginx.conf, nginx-https.conf).

**Files scanned:** 8 primary analogs + 2 nginx configs + 1 helper (identity-artifact-reader.ts, spot-verified via existing skills-editor.ts import).

**Pattern extraction date:** 2026-09-17

**Confidence:** HIGH — every pattern is verbatim from an in-tree file with 5+ existing use sites (the 5 skills-editor endpoints + the corresponding API-client + modal + tests). No hand-rolled patterns; no "propose a new shape" moves.
