import { authApi, handleApiError } from "@/main-axios";

// Phase 89 Plan 03: Frontend API helpers for the seven runbooks-editor endpoints
// landed in Wave 2 (`src/backend/database/routes/runbooks-editor.ts`). Mirrors
// `skills-api.ts` byte-shape (authApi + handleApiError pattern; typed 409 error
// classes for mtime-conflict + already-exists branches).
//
// `RunbookFileMtimeConflictError` is DUPLICATED from `SkillFileMtimeConflictError`
// rather than imported — the two features share zero runtime concern (matches the
// L8-11 posture in skills-api.ts). Same posture as Phase 23 duplicating
// execWithTimeout / shellEscape (fifth intentional instance in the codebase;
// skills-api was the fourth).

export type RunbookEntry = { name: string };

export type RunbookFileEntry = { path: string };

export type RunbookFileReadResult = {
  content: string;
  mtime: number;
  size: number;
  isText: boolean;
};

export type RunbookFileWriteInput = {
  hostId: number;
  role: string;
  runbook: string;
  path: string;
  content: string;
  expectedMtime?: number;
};

export type RunbookFileWriteResult = { mtime: number };

/**
 * Typed 409 mtime-conflict error.
 * Thrown by writeRunbookFile when the backend returns 409 with
 * { error: "mtime mismatch", currentMtime, currentContent }.
 * Byte-shape mirror of SkillFileMtimeConflictError (Phase 44 SKILLED-05);
 * intentionally duplicated rather than imported so the two features stay
 * runtime-decoupled.
 */
export class RunbookFileMtimeConflictError extends Error {
  constructor(
    public readonly currentMtime: number,
    public readonly currentContent: string,
  ) {
    super("mtime mismatch");
    this.name = "RunbookFileMtimeConflictError";
  }
}

/**
 * Typed 409 file-exists error.
 * Thrown by createRunbookFile when the backend returns 409 with
 * { error: "file exists" }.
 * Byte-shape mirror of SkillFileAlreadyExistsError; intentionally duplicated
 * rather than imported so the two features stay runtime-decoupled.
 */
export class RunbookFileAlreadyExistsError extends Error {
  constructor() {
    super("file exists");
    this.name = "RunbookFileAlreadyExistsError";
  }
}

/**
 * Lists the runbooks for the given role on the given host
 * (`~/fleet/roles/<r>/runbooks/*`).
 * Returns [] when the runbooks folder doesn't exist (200, not 404 — per Plan 89-02
 * D-15 "missing runbooks folder within a valid role is empty-list-not-404";
 * D-15's 404 fires only when the role folder itself is absent).
 */
export async function listRunbooks(
  hostId: number,
  roleName: string,
): Promise<RunbookEntry[]> {
  try {
    const response = await authApi.get("/runbooks-editor/runbooks", {
      params: { hostId, role: roleName },
    });
    return (response.data as { runbooks: RunbookEntry[] }).runbooks;
  } catch (error) {
    handleApiError(error, "list runbooks for role");
    throw error; // unreachable — handleApiError throws; satisfies TS return type
  }
}

/**
 * Recursively lists files inside a runbook. Paths are relative to the runbook root
 * (e.g. `runbook.md`, `avatar-prompts/amelia.md`) per D-03.
 * Returns [] when the runbook has zero files.
 */
export async function enumerateRunbookFiles(
  hostId: number,
  roleName: string,
  runbookName: string,
): Promise<RunbookFileEntry[]> {
  try {
    const response = await authApi.get("/runbooks-editor/files", {
      params: { hostId, role: roleName, runbook: runbookName },
    });
    return (response.data as { files: RunbookFileEntry[] }).files;
  } catch (error) {
    handleApiError(error, "list files in runbook");
    throw error; // unreachable
  }
}

/**
 * Reads a runbook file's contents + metadata via SSH.
 * Returns { content, mtime, size, isText }.
 * When !isText, content is "" (backend saves bandwidth; frontend renders placeholder).
 */
export async function readRunbookFile(
  hostId: number,
  roleName: string,
  runbookName: string,
  path: string,
): Promise<RunbookFileReadResult> {
  try {
    const response = await authApi.post("/runbooks-editor/read", {
      hostId,
      role: roleName,
      runbook: runbookName,
      path,
    });
    return response.data as RunbookFileReadResult;
  } catch (error) {
    handleApiError(error, "read runbook file");
    throw error; // unreachable
  }
}

/**
 * Writes content to a runbook file via SFTP atomic write.
 * If expectedMtime is set and the file changed since the read, throws
 * RunbookFileMtimeConflictError (409) with { currentMtime, currentContent }
 * so the caller can offer a reload-and-retry flow.
 * The input object carries { hostId, role, runbook, path, content, expectedMtime? }
 * and is sent verbatim as the PUT body.
 */
export async function writeRunbookFile(
  input: RunbookFileWriteInput,
): Promise<RunbookFileWriteResult> {
  try {
    const response = await authApi.put("/runbooks-editor/write", input);
    return response.data as RunbookFileWriteResult;
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
      throw new RunbookFileMtimeConflictError(
        err.response.data?.currentMtime ?? 0,
        err.response.data?.currentContent ?? "",
      );
    }
    handleApiError(error, "write runbook file");
    throw error; // unreachable
  }
}

/**
 * Creates a new empty file inside a runbook (subpaths allowed — backend
 * mkdir -p's the parent dir before touch).
 * If the file already exists, throws RunbookFileAlreadyExistsError (409).
 */
export async function createRunbookFile(
  hostId: number,
  roleName: string,
  runbookName: string,
  path: string,
): Promise<{ path: string; mtime: number }> {
  try {
    const response = await authApi.post("/runbooks-editor/create", {
      hostId,
      role: roleName,
      runbook: runbookName,
      path,
    });
    return response.data as { path: string; mtime: number };
  } catch (error) {
    const err = error as {
      response?: { status?: number; data?: { error?: string } };
    };
    // Only recognize the specific file-exists 409 shape (same defense as
    // writeRunbookFile — a future 409 semantic on this endpoint shouldn't
    // misfire as an already-exists dialog).
    if (
      err?.response?.status === 409 &&
      err.response.data?.error === "file exists"
    ) {
      throw new RunbookFileAlreadyExistsError();
    }
    handleApiError(error, "create runbook file");
    throw error; // unreachable
  }
}

/**
 * Deletes a single file inside a runbook (rm -f — idempotent, no error on missing).
 * NOTE: axios requires `data` field for DELETE bodies (DELETE with a body is
 * unusual so axios wraps it explicitly rather than positional-arg).
 */
export async function deleteRunbookFile(
  hostId: number,
  roleName: string,
  runbookName: string,
  path: string,
): Promise<void> {
  try {
    await authApi.delete("/runbooks-editor/file", {
      data: { hostId, role: roleName, runbook: runbookName, path },
    });
  } catch (error) {
    handleApiError(error, "delete runbook file");
    throw error; // unreachable
  }
}

/**
 * Deletes an entire runbook (rm -rf on the runbook folder). Life-critical
 * path-safety gate lives on the backend (three-layer belt-and-suspenders
 * assertion in Wave 2 proves the gate fires before any rm dispatches).
 */
export async function deleteRunbook(
  hostId: number,
  roleName: string,
  runbookName: string,
): Promise<void> {
  try {
    await authApi.delete("/runbooks-editor/runbook", {
      data: { hostId, role: roleName, runbook: runbookName },
    });
  } catch (error) {
    handleApiError(error, "delete runbook");
    throw error; // unreachable
  }
}
