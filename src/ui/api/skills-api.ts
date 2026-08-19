import { authApi, handleApiError } from "@/main-axios";

// Phase 44 SKILLED-05: Frontend API helpers for the seven skills-editor endpoints
// landed in Wave 1 (src/backend/database/routes/skills-editor.ts). Mirrors
// global-files-api.ts byte-shape (authApi + handleApiError pattern; typed 409
// error classes for mtime-conflict + already-exists branches).
//
// SkillFileMtimeConflictError is DUPLICATED from GlobalFileMtimeConflictError
// rather than imported — the two features share zero runtime concern (RESEARCH.md
// § Open Question 5). Same posture as Phase 23 duplicating execWithTimeout /
// shellEscape (fourth intentional instance in the codebase).

export type SkillEntry = { name: string };

export type SkillFileEntry = { path: string };

export type SkillFileReadResult = {
  content: string;
  mtime: number;
  size: number;
  isText: boolean;
};

export type SkillFileWriteInput = {
  hostId: number;
  skill: string;
  path: string;
  content: string;
  expectedMtime?: number;
};

export type SkillFileWriteResult = { mtime: number };

/**
 * Typed 409 mtime-conflict error.
 * Thrown by writeSkillFile when the backend returns 409 with
 * { error: "mtime mismatch", currentMtime, currentContent }.
 * Byte-shape mirror of GlobalFileMtimeConflictError (Phase 23 GEFM-05);
 * intentionally duplicated rather than imported so the two features stay
 * runtime-decoupled.
 */
export class SkillFileMtimeConflictError extends Error {
  constructor(
    public readonly currentMtime: number,
    public readonly currentContent: string,
  ) {
    super("mtime mismatch");
    this.name = "SkillFileMtimeConflictError";
  }
}

/**
 * Typed 409 file-exists error.
 * Thrown by createSkillFile when the backend returns 409 with
 * { error: "file exists" }.
 */
export class SkillFileAlreadyExistsError extends Error {
  constructor() {
    super("file exists");
    this.name = "SkillFileAlreadyExistsError";
  }
}

/**
 * GET /skills-editor/skills?hostId=<n>
 * Returns the list of skills on the given host (~/.claude/skills/*).
 * Returns [] when the directory doesn't exist (200, not 404 — per SKILLED-01).
 */
export async function listSkills(hostId: number): Promise<SkillEntry[]> {
  try {
    const response = await authApi.get("/skills-editor/skills", {
      params: { hostId },
    });
    return (response.data as { skills: SkillEntry[] }).skills;
  } catch (error) {
    handleApiError(error, "list skills for host");
    throw error; // unreachable — handleApiError throws; satisfies TS return type
  }
}

/**
 * GET /skills-editor/files?hostId=<n>&skill=<s>
 * Recursively lists files inside a skill. Paths are relative to the skill root
 * (e.g. `SKILL.md`, `tests/basic.py`) per D-05.
 * Returns [] when the skill has zero files.
 */
export async function enumerateSkillFiles(
  hostId: number,
  skill: string,
): Promise<SkillFileEntry[]> {
  try {
    const response = await authApi.get("/skills-editor/files", {
      params: { hostId, skill },
    });
    return (response.data as { files: SkillFileEntry[] }).files;
  } catch (error) {
    handleApiError(error, "list files in skill");
    throw error; // unreachable
  }
}

/**
 * POST /skills-editor/read
 * Reads a file's contents + metadata via SSH. Returns { content, mtime, size, isText }.
 * When !isText, content is "" (backend saves bandwidth; frontend renders placeholder).
 */
export async function readSkillFile(
  hostId: number,
  skill: string,
  path: string,
): Promise<SkillFileReadResult> {
  try {
    const response = await authApi.post("/skills-editor/read", {
      hostId,
      skill,
      path,
    });
    return response.data as SkillFileReadResult;
  } catch (error) {
    handleApiError(error, "read skill file");
    throw error; // unreachable
  }
}

/**
 * PUT /skills-editor/write
 * Writes content to a skill file via SFTP atomic write.
 * If expectedMtime is set and the file changed since the read, throws
 * SkillFileMtimeConflictError (409) with { currentMtime, currentContent }
 * so the caller can offer a reload-and-retry flow.
 */
export async function writeSkillFile(
  input: SkillFileWriteInput,
): Promise<SkillFileWriteResult> {
  try {
    const response = await authApi.put("/skills-editor/write", input);
    return response.data as SkillFileWriteResult;
  } catch (error) {
    const err = error as {
      response?: {
        status?: number;
        data?: { currentMtime?: number; currentContent?: string };
      };
    };
    if (err?.response?.status === 409) {
      throw new SkillFileMtimeConflictError(
        err.response.data?.currentMtime ?? 0,
        err.response.data?.currentContent ?? "",
      );
    }
    handleApiError(error, "write skill file");
    throw error; // unreachable
  }
}

/**
 * POST /skills-editor/create
 * Creates a new empty file inside a skill (subpaths allowed per RESEARCH.md
 * § Open Question 2 — backend mkdir -p's the parent dir before touch).
 * If the file already exists, throws SkillFileAlreadyExistsError (409).
 */
export async function createSkillFile(
  hostId: number,
  skill: string,
  path: string,
): Promise<{ path: string; mtime: number }> {
  try {
    const response = await authApi.post("/skills-editor/create", {
      hostId,
      skill,
      path,
    });
    return response.data as { path: string; mtime: number };
  } catch (error) {
    const err = error as { response?: { status?: number } };
    if (err?.response?.status === 409) {
      throw new SkillFileAlreadyExistsError();
    }
    handleApiError(error, "create skill file");
    throw error; // unreachable
  }
}

/**
 * DELETE /skills-editor/file
 * Deletes a single file inside a skill (rm -f — idempotent, no error on missing).
 * NOTE: axios requires `data` field for DELETE bodies (DELETE with a body is
 * unusual so axios wraps it explicitly rather than positional-arg).
 */
export async function deleteSkillFile(
  hostId: number,
  skill: string,
  path: string,
): Promise<void> {
  try {
    await authApi.delete("/skills-editor/file", {
      data: { hostId, skill, path },
    });
  } catch (error) {
    handleApiError(error, "delete skill file");
    throw error; // unreachable
  }
}

/**
 * DELETE /skills-editor/skill
 * Deletes an entire skill (rm -rf on the skill folder). Life-critical
 * path-safety gate lives on the backend (SEC-8 test proves the gate fires
 * before any rm dispatches).
 */
export async function deleteSkill(
  hostId: number,
  skill: string,
): Promise<void> {
  try {
    await authApi.delete("/skills-editor/skill", {
      data: { hostId, skill },
    });
  } catch (error) {
    handleApiError(error, "delete skill");
    throw error; // unreachable
  }
}
