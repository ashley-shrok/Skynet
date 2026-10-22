import { authApi, handleApiError } from "@/main-axios";
import { RenamedButEditsNotSavedError } from "./skills-api";

export { RenamedButEditsNotSavedError };

// Frontend API helpers for the role-skills-editor endpoints
// (`src/backend/database/routes/role-skills-editor.ts`; Phase 89). Mirrors
// `skills-api.ts` byte-shape (authApi + handleApiError pattern; typed 409 error
// classes for mtime-conflict + already-exists branches).
//
// `RoleSkillFileMtimeConflictError` is DUPLICATED from `SkillFileMtimeConflictError`
// rather than imported — the two features share zero runtime concern (matches the
// L8-11 posture in skills-api.ts). Same posture as Phase 23 duplicating
// execWithTimeout / shellEscape (fifth intentional instance in the codebase;
// skills-api was the fourth).

/** A role skill: its folder name and the one-line description from its
 *  SKILL.md frontmatter (absent when it has none or it can't be read). */
export type RoleSkillEntry = { name: string; description?: string };

export type RoleSkillFileEntry = { path: string };

export type RoleSkillFileReadResult = {
  content: string;
  mtime: number;
  size: number;
  isText: boolean;
};

export type RoleSkillFileWriteInput = {
  hostId: number;
  role: string;
  skill: string;
  path: string;
  content: string;
  expectedMtime?: number;
};

export type RoleSkillFileWriteResult = { mtime: number };

/**
 * Typed 409 mtime-conflict error.
 * Thrown by writeRoleSkillFile when the backend returns 409 with
 * { error: "mtime mismatch", currentMtime, currentContent }.
 * Byte-shape mirror of SkillFileMtimeConflictError (Phase 44 SKILLED-05);
 * intentionally duplicated rather than imported so the two features stay
 * runtime-decoupled.
 */
export class RoleSkillFileMtimeConflictError extends Error {
  constructor(
    public readonly currentMtime: number,
    public readonly currentContent: string,
  ) {
    super("mtime mismatch");
    this.name = "RoleSkillFileMtimeConflictError";
  }
}

/**
 * Typed 409 file-exists error.
 * Thrown by createRoleSkillFile when the backend returns 409 with
 * { error: "file exists" }.
 * Byte-shape mirror of SkillFileAlreadyExistsError; intentionally duplicated
 * rather than imported so the two features stay runtime-decoupled.
 */
export class RoleSkillFileAlreadyExistsError extends Error {
  constructor() {
    super("file exists");
    this.name = "RoleSkillFileAlreadyExistsError";
  }
}

/**
 * Lists the role skills for the given role on the given host
 * (`~/fleet/roles/<r>/skills/*`).
 * Returns [] when the role skills folder doesn't exist (200, not 404 — per Plan 89-02
 * D-15 "missing role skills folder within a valid role is empty-list-not-404";
 * D-15's 404 fires only when the role folder itself is absent).
 */
export async function listRoleSkills(
  hostId: number,
  roleName: string,
): Promise<RoleSkillEntry[]> {
  try {
    const response = await authApi.get("/role-skills-editor/skills", {
      params: { hostId, role: roleName },
    });
    return (response.data as { skills: RoleSkillEntry[] }).skills;
  } catch (error) {
    handleApiError(error, "list role skills for role");
    throw error; // unreachable — handleApiError throws; satisfies TS return type
  }
}

/**
 * Recursively lists files inside a role skill. Paths are relative to the role skill root
 * (e.g. `SKILL.md`, `avatar-prompts/amelia.md`) per D-03.
 * Returns [] when the role skill has zero files.
 */
export async function enumerateRoleSkillFiles(
  hostId: number,
  roleName: string,
  roleSkillName: string,
): Promise<RoleSkillFileEntry[]> {
  try {
    const response = await authApi.get("/role-skills-editor/files", {
      params: { hostId, role: roleName, skill: roleSkillName },
    });
    return (response.data as { files: RoleSkillFileEntry[] }).files;
  } catch (error) {
    handleApiError(error, "list files in role skill");
    throw error; // unreachable
  }
}

/**
 * Reads a role skill file's contents + metadata via SSH.
 * Returns { content, mtime, size, isText }.
 * When !isText, content is "" (backend saves bandwidth; frontend renders placeholder).
 */
export async function readRoleSkillFile(
  hostId: number,
  roleName: string,
  roleSkillName: string,
  path: string,
): Promise<RoleSkillFileReadResult> {
  try {
    const response = await authApi.post("/role-skills-editor/read", {
      hostId,
      role: roleName,
      skill: roleSkillName,
      path,
    });
    return response.data as RoleSkillFileReadResult;
  } catch (error) {
    handleApiError(error, "read role skill file");
    throw error; // unreachable
  }
}

/**
 * PUT /role-skills-editor/write-binary — replace a role skill file with raw bytes
 * (annotated PDFs etc.). Last-write-wins; no mtime check.
 */
export async function writeRoleSkillFileBinary(
  hostId: number,
  roleName: string,
  roleSkillName: string,
  path: string,
  bytes: Uint8Array,
): Promise<void> {
  try {
    await authApi.put("/role-skills-editor/write-binary", bytes, {
      params: { hostId, role: roleName, skill: roleSkillName, path },
      headers: { "Content-Type": "application/octet-stream" },
    });
  } catch (error) {
    handleApiError(error, "write role skill file");
    throw error; // unreachable
  }
}

/**
 * GET /role-skills-editor/download URL — synchronous, no network call. A
 * download link, or with `inline` a streamed src for viewers (media, PDF,
 * text; Range-capable). Relative, like downloadWorkspaceFileUrl.
 */
export function roleSkillFileUrl(
  hostId: number,
  roleName: string,
  roleSkillName: string,
  path: string,
  opts: { inline?: boolean } = {},
): string {
  return (
    `/role-skills-editor/download?hostId=${encodeURIComponent(String(hostId))}` +
    `&role=${encodeURIComponent(roleName)}` +
    `&skill=${encodeURIComponent(roleSkillName)}` +
    `&path=${encodeURIComponent(path)}` +
    (opts.inline ? "&inline=1" : "")
  );
}

/**
 * Writes content to a role skill file via SFTP atomic write.
 * If expectedMtime is set and the file changed since the read, throws
 * RoleSkillFileMtimeConflictError (409) with { currentMtime, currentContent }
 * so the caller can offer a reload-and-retry flow.
 * The input object carries { hostId, role, role skill, path, content, expectedMtime? }
 * and is sent verbatim as the PUT body.
 */
export async function writeRoleSkillFile(
  input: RoleSkillFileWriteInput,
): Promise<RoleSkillFileWriteResult> {
  try {
    const response = await authApi.put("/role-skills-editor/write", input);
    return response.data as RoleSkillFileWriteResult;
  } catch (error) {
    const err = error as {
      response?: {
        status?: number;
        data?: { error?: string; currentMtime?: number; currentContent?: string };
      };
    };
    // Only recognize the specific mtime-mismatch 409 shape. If the backend
    // ever adds a different 409 semantic (e.g. "concurrent write in progress")
    // we do NOT want to misinterpret it as a stale-mtime conflict — that
    // would trigger the wrong reload prompt at the user.
    if (
      err?.response?.status === 409 &&
      err.response.data?.error === "mtime mismatch"
    ) {
      throw new RoleSkillFileMtimeConflictError(
        err.response.data?.currentMtime ?? 0,
        err.response.data?.currentContent ?? "",
      );
    }
    handleApiError(error, "write role skill file");
    throw error; // unreachable
  }
}

/**
 * Creates a new empty file inside a role skill (subpaths allowed — backend
 * mkdir -p's the parent dir before touch).
 * If the file already exists, throws RoleSkillFileAlreadyExistsError (409).
 */
export async function createRoleSkillFile(
  hostId: number,
  roleName: string,
  roleSkillName: string,
  path: string,
): Promise<{ path: string; mtime: number }> {
  try {
    const response = await authApi.post("/role-skills-editor/create", {
      hostId,
      role: roleName,
      skill: roleSkillName,
      path,
    });
    return response.data as { path: string; mtime: number };
  } catch (error) {
    const err = error as {
      response?: { status?: number; data?: { error?: string } };
    };
    // Only recognize the specific file-exists 409 shape (same defense as
    // writeRoleSkillFile — a future 409 semantic on this endpoint shouldn't
    // misfire as an already-exists dialog).
    if (
      err?.response?.status === 409 &&
      err.response.data?.error === "file exists"
    ) {
      throw new RoleSkillFileAlreadyExistsError();
    }
    handleApiError(error, "create role skill file");
    throw error; // unreachable
  }
}

/**
 * Deletes a single file inside a role skill (rm -f — idempotent, no error on missing).
 * NOTE: axios requires `data` field for DELETE bodies (DELETE with a body is
 * unusual so axios wraps it explicitly rather than positional-arg).
 */
export async function deleteRoleSkillFile(
  hostId: number,
  roleName: string,
  roleSkillName: string,
  path: string,
): Promise<void> {
  try {
    await authApi.delete("/role-skills-editor/file", {
      data: { hostId, role: roleName, skill: roleSkillName, path },
    });
  } catch (error) {
    handleApiError(error, "delete role skill file");
    throw error; // unreachable
  }
}

/**
 * Deletes an entire role skill (rm -rf on the role skill folder). Life-critical
 * path-safety gate lives on the backend (three-layer belt-and-suspenders
 * assertion in Wave 2 proves the gate fires before any rm dispatches).
 */
export async function deleteRoleSkill(
  hostId: number,
  roleName: string,
  roleSkillName: string,
): Promise<void> {
  try {
    await authApi.delete("/role-skills-editor/skill", {
      data: { hostId, role: roleName, skill: roleSkillName },
    });
  } catch (error) {
    handleApiError(error, "delete role skill");
    throw error; // unreachable
  }
}

/**
 * POST /role-skills-editor/skill
 * Creates a role skill whose SKILL.md is seeded with `name` and `description`
 * frontmatter. Throws RoleSkillAlreadyExistsError when the name is taken.
 */
export async function createRoleSkill(
  hostId: number,
  roleName: string,
  name: string,
  description: string,
): Promise<{ slug: string; mtime: number }> {
  try {
    const response = await authApi.post("/role-skills-editor/skill", {
      hostId,
      role: roleName,
      skill: name,
      description,
    });
    return response.data as { slug: string; mtime: number };
  } catch (error) {
    const err = error as { response?: { status?: number; data?: { error?: string } } };
    if (err?.response?.status === 409 && err.response.data?.error === "skill exists") {
      throw new RoleSkillAlreadyExistsError();
    }
    handleApiError(error, "create role skill");
    throw error; // unreachable
  }
}

/** Typed 409 thrown by createRoleSkill / renameRoleSkill when the name is already a role skill. */
export class RoleSkillAlreadyExistsError extends Error {
  constructor() {
    super("skill exists");
    this.name = "RoleSkillAlreadyExistsError";
  }
}

/**
 * POST /role-skills-editor/rename
 * Renames a role skill's folder (retargeting any runbook forwarding links),
 * keeping SKILL.md's `name:` in step. With `draft`, that SKILL.md draft is saved
 * into the renamed role skill in the same request (`path` in the result is where
 * it now lives); `draft.expectedMtime` is checked before anything moves.
 * Throws RoleSkillAlreadyExistsError (409 taken), RoleSkillFileMtimeConflictError
 * (409 stale draft — nothing moved) or RenamedButEditsNotSavedError.
 */
export async function renameRoleSkill(
  hostId: number,
  role: string,
  roleSkill: string,
  newName: string,
  draft?: { path: string; content: string; expectedMtime: number },
): Promise<{ name: string; path?: string }> {
  try {
    const response = await authApi.post("/role-skills-editor/rename", {
      hostId,
      role,
      skill: roleSkill,
      newName,
      ...(draft ?? {}),
    });
    return response.data as { name: string; path?: string };
  } catch (error) {
    const err = error as {
      response?: {
        status?: number;
        data?: { error?: string; currentMtime?: number; currentContent?: string; renamed?: boolean };
      };
    };
    if (err?.response?.status === 409 && err.response.data?.error === "skill exists") {
      throw new RoleSkillAlreadyExistsError();
    }
    if (err?.response?.status === 409 && err.response.data?.error === "mtime mismatch") {
      throw new RoleSkillFileMtimeConflictError(
        err.response.data?.currentMtime ?? 0,
        err.response.data?.currentContent ?? "",
      );
    }
    if (err?.response?.data?.renamed === true) {
      throw new RenamedButEditsNotSavedError(newName);
    }
    handleApiError(error, "rename role skill");
    throw error; // unreachable
  }
}
