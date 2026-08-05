import { authApi, handleApiError } from "@/main-axios";

// Phase 23 GEFM-05: Frontend API helpers for the three global-files endpoints
// landed in waves 1-2. Mirrors identities-api.ts shape (authApi + handleApiError
// pattern; typed 409 error class mirrors RoleAlreadyExistsError L154-159 shape).

export type GlobalFileEntry = { path: string; label?: string };

export type GlobalFileReadResult = { content: string; mtime: number; size: number };

export type GlobalFileWriteInput = {
  hostId: number;
  path: string;
  content: string;
  expectedMtime?: number;
};

export type GlobalFileWriteResult = { mtime: number };

/**
 * Typed 409 mtime-conflict error.
 * Thrown by writeGlobalFile when the backend returns 409 with
 * { error: "mtime mismatch", currentMtime, currentContent }.
 * Mirrors RoleAlreadyExistsError shape from identities-api.ts L154-159.
 */
export class GlobalFileMtimeConflictError extends Error {
  constructor(
    public readonly currentMtime: number,
    public readonly currentContent: string,
  ) {
    super("mtime mismatch");
    this.name = "GlobalFileMtimeConflictError";
  }
}

/**
 * GET /global-files?hostId=<n>
 * Returns the list of configured files for the given host.
 * Returns [] when the host has no entries in global-files.json (200, not 404 — per GEFM-03).
 * Mirrors listRolesForHost at identities-api.ts L132-139.
 */
export async function listGlobalFiles(hostId: number): Promise<GlobalFileEntry[]> {
  try {
    const response = await authApi.get("/global-files", { params: { hostId } });
    return (response.data as { files: GlobalFileEntry[] }).files;
  } catch (error) {
    handleApiError(error, "list global files for host");
    throw error; // unreachable — handleApiError throws; satisfies TS return type
  }
}

/**
 * POST /global-files/read
 * Reads the content of a whitelisted file on the given host via SSH.
 * Returns { content, mtime, size }.
 */
export async function readGlobalFile(
  hostId: number,
  path: string,
): Promise<GlobalFileReadResult> {
  try {
    const response = await authApi.post("/global-files/read", { hostId, path });
    return response.data as GlobalFileReadResult;
  } catch (error) {
    handleApiError(error, "read global file");
    throw error; // unreachable
  }
}

/**
 * PUT /global-files/write
 * Writes content to a whitelisted file on the given host via SFTP atomic write.
 * If expectedMtime is set and the file changed since the read, throws
 * GlobalFileMtimeConflictError (409) with { currentMtime, currentContent }
 * so the caller can offer a reload-and-retry flow.
 */
export async function writeGlobalFile(
  input: GlobalFileWriteInput,
): Promise<GlobalFileWriteResult> {
  try {
    const response = await authApi.put("/global-files/write", input);
    return response.data as GlobalFileWriteResult;
  } catch (error) {
    const err = error as {
      response?: {
        status?: number;
        data?: { currentMtime?: number; currentContent?: string };
      };
    };
    if (err?.response?.status === 409) {
      throw new GlobalFileMtimeConflictError(
        err.response.data?.currentMtime ?? 0,
        err.response.data?.currentContent ?? "",
      );
    }
    handleApiError(error, "write global file");
    throw error; // unreachable
  }
}
