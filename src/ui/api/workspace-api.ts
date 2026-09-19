/**
 * Phase 118 Plan 118-02 — Client-side surface to /workspace CRUD endpoints.
 *
 * This is the SOLE client-side surface for the /workspace backend router (Plan
 * 118-01). Every helper listed here is a 1:1 wrapper around one backend route.
 *
 * Error-class preservation (mirrors fetchHostFileUrl at editable-file-api.ts:131):
 * Each async helper catches axios errors and, when the response body carries a
 * backend error-class string (e.g. "permission_denied", "not_found",
 * "not_a_directory"), throws a plain Error whose .message IS that class string.
 * The caller (WorkspaceTab, Plan 118-03) can switch on err.message and look up
 * consumer-user copy from WORKSPACE_ERROR_COPY (Plan 118-02 Task 2 output).
 * Any axios error that does NOT carry a recognisable class falls through to
 * handleApiError (fleet-standard ApiError taxonomy for auth / network failures).
 *
 * NO React, NO UI, NO stateful side effects in this file.
 */

import axios from "axios";
import { authApi, handleApiError } from "@/main-axios";

// ---------------------------------------------------------------------------
// Wire types (exported for consumers)
// ---------------------------------------------------------------------------

export type WorkspaceEntry = {
  name: string;
  type: "file" | "directory" | "symlink";
  size: number | null; // null for directories
  mtimeMs: number; // Unix milliseconds (backend sends attrs.mtime * 1000)
  path: string; // relative path from workspace root
};

export type ListResponse = {
  entries: WorkspaceEntry[];
  path: string;
};

export type ReadFileResponse = {
  contentBase64: string;
  sizeBytes: number;
  filename: string;
  extension: string | null;
};

// ---------------------------------------------------------------------------
// List directory — POST /workspace/list
// ---------------------------------------------------------------------------

/**
 * List the contents of a workspace directory.
 *
 * @param identityKey  - Identity slug (e.g. "echo-box-maintainer")
 * @param hostId       - Numeric host ID (from IdentityModal.hostId)
 * @param relativePath - Path relative to workspace root; "" for root
 */
export async function listWorkspace(
  identityKey: string,
  hostId: number,
  relativePath: string,
): Promise<ListResponse> {
  try {
    const response = await authApi.post("/workspace/list", {
      identityKey,
      hostId,
      relativePath,
    });
    return response.data as ListResponse;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "WorkspaceError";
        throw rich;
      }
    }
    handleApiError(error, "list workspace");
    throw error; // unreachable — handleApiError throws; satisfies TS return type
  }
}

// ---------------------------------------------------------------------------
// Read file — POST /workspace/read-file
// ---------------------------------------------------------------------------

/**
 * Read a file from the workspace. Returns base64-encoded content.
 * The backend enforces a 2 MB size cap (returns "too_large" if exceeded).
 *
 * @param identityKey  - Identity slug
 * @param hostId       - Numeric host ID
 * @param relativePath - File path relative to workspace root
 */
export async function readWorkspaceFile(
  identityKey: string,
  hostId: number,
  relativePath: string,
): Promise<ReadFileResponse> {
  try {
    const response = await authApi.post("/workspace/read-file", {
      identityKey,
      hostId,
      relativePath,
    });
    return response.data as ReadFileResponse;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "WorkspaceError";
        throw rich;
      }
    }
    handleApiError(error, "read workspace file");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Write file — PUT /workspace/write-file
// ---------------------------------------------------------------------------

/**
 * Write UTF-8 text content to a file in the workspace (atomic tmp+rename).
 *
 * @param identityKey  - Identity slug
 * @param hostId       - Numeric host ID
 * @param relativePath - File path relative to workspace root
 * @param content      - UTF-8 string content to write
 */
export async function writeWorkspaceFile(
  identityKey: string,
  hostId: number,
  relativePath: string,
  content: string,
): Promise<void> {
  try {
    await authApi.put("/workspace/write-file", {
      identityKey,
      hostId,
      relativePath,
      content,
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "WorkspaceError";
        throw rich;
      }
    }
    handleApiError(error, "write workspace file");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Delete entry — DELETE /workspace/entry
// ---------------------------------------------------------------------------

/**
 * Delete a file or empty directory in the workspace.
 * Directory must be empty ("not_empty" error is returned otherwise).
 *
 * @param identityKey  - Identity slug
 * @param hostId       - Numeric host ID
 * @param relativePath - Path relative to workspace root
 */
export async function deleteWorkspaceEntry(
  identityKey: string,
  hostId: number,
  relativePath: string,
): Promise<void> {
  try {
    // axios.delete sends body via config.data option
    await authApi.delete("/workspace/entry", {
      data: { identityKey, hostId, relativePath },
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "WorkspaceError";
        throw rich;
      }
    }
    handleApiError(error, "delete workspace entry");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Rename — POST /workspace/rename
// ---------------------------------------------------------------------------

/**
 * Rename or move a workspace entry.
 *
 * @param identityKey - Identity slug
 * @param hostId      - Numeric host ID
 * @param from        - Source path relative to workspace root
 * @param to          - Destination path relative to workspace root
 */
export async function renameWorkspaceEntry(
  identityKey: string,
  hostId: number,
  from: string,
  to: string,
): Promise<void> {
  try {
    await authApi.post("/workspace/rename", {
      identityKey,
      hostId,
      from,
      to,
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "WorkspaceError";
        throw rich;
      }
    }
    handleApiError(error, "rename workspace entry");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Create directory — POST /workspace/mkdir
// ---------------------------------------------------------------------------

/**
 * Create a directory in the workspace.
 *
 * @param identityKey  - Identity slug
 * @param hostId       - Numeric host ID
 * @param relativePath - Path for the new directory, relative to workspace root
 */
export async function mkdirWorkspace(
  identityKey: string,
  hostId: number,
  relativePath: string,
): Promise<void> {
  try {
    await authApi.post("/workspace/mkdir", {
      identityKey,
      hostId,
      relativePath,
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "WorkspaceError";
        throw rich;
      }
    }
    handleApiError(error, "create workspace folder");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Create file — POST /workspace/create-file
// ---------------------------------------------------------------------------

/**
 * Create an empty file in the workspace.
 *
 * @param identityKey  - Identity slug
 * @param hostId       - Numeric host ID
 * @param relativePath - Path for the new file, relative to workspace root
 */
export async function createWorkspaceFile(
  identityKey: string,
  hostId: number,
  relativePath: string,
): Promise<void> {
  try {
    await authApi.post("/workspace/create-file", {
      identityKey,
      hostId,
      relativePath,
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "WorkspaceError";
        throw rich;
      }
    }
    handleApiError(error, "create workspace file");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Upload file — POST /workspace/upload (multipart)
// ---------------------------------------------------------------------------

/**
 * Upload a browser File object to the workspace.
 * Sends a multipart form-data body with identityKey/hostId/relativePath fields
 * plus the file payload. Calls onProgress during upload if supplied.
 *
 * @param identityKey  - Identity slug
 * @param hostId       - Numeric host ID
 * @param relativePath - Destination path relative to workspace root
 * @param file         - Browser File object from input or drag-drop
 * @param onProgress   - Optional progress callback: (loaded, total) => void
 */
export async function uploadWorkspaceFile(
  identityKey: string,
  hostId: number,
  relativePath: string,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const form = new FormData();
  form.append("identityKey", identityKey);
  form.append("hostId", String(hostId));
  form.append("relativePath", relativePath);
  form.append("file", file);

  try {
    await authApi.post("/workspace/upload", form, {
      // authApi defaults to application/json. Without an explicit
      // multipart/form-data header, axios v1's formDataToJSON transform
      // fires and drops the File field entirely, and multer returns
      // invalid_body with req.file undefined (regression documented at
      // identities-api.ts:519 — same failure mode, same fix).
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: onProgress
        ? (e) => onProgress(e.loaded, e.total ?? file.size)
        : undefined,
    });
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const backendClass = error.response?.data?.error;
      if (typeof backendClass === "string" && backendClass.length > 0) {
        const rich = new Error(backendClass);
        rich.name = "WorkspaceError";
        throw rich;
      }
    }
    handleApiError(error, "upload workspace file");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Download file URL builder — synchronous, no network call
// ---------------------------------------------------------------------------

/**
 * Build the URL for downloading a workspace file via the browser's native
 * download mechanism. Caller triggers by setting window.location.href or
 * creating an <a download> element.
 *
 * Uses a relative URL (no origin prefix) because the frontend and backend
 * share the same origin under the nginx reverse proxy.
 *
 * @param identityKey  - Identity slug
 * @param hostId       - Numeric host ID
 * @param relativePath - File path relative to workspace root
 * @returns Relative URL string pointing at GET /workspace/download
 */
export function downloadWorkspaceFileUrl(
  identityKey: string,
  hostId: number,
  relativePath: string,
): string {
  return (
    `/workspace/download` +
    `?identityKey=${encodeURIComponent(identityKey)}` +
    `&hostId=${encodeURIComponent(String(hostId))}` +
    `&relativePath=${encodeURIComponent(relativePath)}`
  );
}
