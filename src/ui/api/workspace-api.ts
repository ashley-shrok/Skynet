/**
 * Phase 118 Plan 118-02 — Client-side surface to /workspace CRUD endpoints.
 *
 * This is the SOLE client-side surface for the /workspace backend router (Plan
 * 118-01). Every helper listed here is a 1:1 wrapper around one backend route.
 *
 * Target model: every helper takes a WorkspaceTarget as its first param — either
 *   { kind: "identity", identityKey } → resolves to ~/fleet/identities/<key>/workspace
 *   { kind: "role", roleSlug }        → resolves to ~/fleet/roles/<slug>
 * Wire shape stays byte-identical for identity requests (no `kind` field sent);
 * role requests carry { kind: "role", roleSlug } instead of { identityKey }.
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

/**
 * Discriminated target passed to every workspace helper. `identity` maps to
 * ~/fleet/identities/<identityKey>/workspace; `role` maps to
 * ~/fleet/roles/<roleSlug>. Backend `extractTarget` mirrors this shape.
 */
export type WorkspaceTarget =
  | { kind: "identity"; identityKey: string }
  | { kind: "role"; roleSlug: string };

/**
 * Serialize a target into the wire fields the backend expects. Identity
 * requests omit `kind` so the wire is byte-identical to pre-role-support
 * callers; role requests send `{ kind: "role", roleSlug }`.
 */
function targetToWireFields(t: WorkspaceTarget): Record<string, string> {
  if (t.kind === "role") return { kind: "role", roleSlug: t.roleSlug };
  return { identityKey: t.identityKey };
}

/** URL-encoded target query fragment for GET endpoints (currently /download). */
function targetToQueryString(t: WorkspaceTarget): string {
  if (t.kind === "role") {
    return `kind=role&roleSlug=${encodeURIComponent(t.roleSlug)}`;
  }
  return `identityKey=${encodeURIComponent(t.identityKey)}`;
}

// ---------------------------------------------------------------------------
// List directory — POST /workspace/list
// ---------------------------------------------------------------------------

/**
 * List the contents of a workspace directory.
 *
 * @param target       - Identity workspace or role folder
 * @param hostId       - Numeric host ID (from IdentityModal.hostId)
 * @param relativePath - Path relative to workspace root; "" for root
 */
export async function listWorkspace(
  target: WorkspaceTarget,
  hostId: number,
  relativePath: string,
): Promise<ListResponse> {
  try {
    const response = await authApi.post("/workspace/list", {
      ...targetToWireFields(target),
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
 */
export async function readWorkspaceFile(
  target: WorkspaceTarget,
  hostId: number,
  relativePath: string,
): Promise<ReadFileResponse> {
  try {
    const response = await authApi.post("/workspace/read-file", {
      ...targetToWireFields(target),
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
 */
export async function writeWorkspaceFile(
  target: WorkspaceTarget,
  hostId: number,
  relativePath: string,
  content: string,
): Promise<void> {
  try {
    await authApi.put("/workspace/write-file", {
      ...targetToWireFields(target),
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
 */
export async function deleteWorkspaceEntry(
  target: WorkspaceTarget,
  hostId: number,
  relativePath: string,
): Promise<void> {
  try {
    // axios.delete sends body via config.data option
    await authApi.delete("/workspace/entry", {
      data: { ...targetToWireFields(target), hostId, relativePath },
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
 */
export async function renameWorkspaceEntry(
  target: WorkspaceTarget,
  hostId: number,
  from: string,
  to: string,
): Promise<void> {
  try {
    await authApi.post("/workspace/rename", {
      ...targetToWireFields(target),
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
 */
export async function mkdirWorkspace(
  target: WorkspaceTarget,
  hostId: number,
  relativePath: string,
): Promise<void> {
  try {
    await authApi.post("/workspace/mkdir", {
      ...targetToWireFields(target),
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
 */
export async function createWorkspaceFile(
  target: WorkspaceTarget,
  hostId: number,
  relativePath: string,
): Promise<void> {
  try {
    await authApi.post("/workspace/create-file", {
      ...targetToWireFields(target),
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
 * Sends a multipart form-data body with target + hostId + relativePath fields
 * plus the file payload. Calls onProgress during upload if supplied.
 */
export async function uploadWorkspaceFile(
  target: WorkspaceTarget,
  hostId: number,
  relativePath: string,
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const form = new FormData();
  for (const [k, v] of Object.entries(targetToWireFields(target))) {
    form.append(k, v);
  }
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
 */
export function downloadWorkspaceFileUrl(
  target: WorkspaceTarget,
  hostId: number,
  relativePath: string,
  opts: { inline?: boolean } = {},
): string {
  return (
    `/workspace/download` +
    `?${targetToQueryString(target)}` +
    `&hostId=${encodeURIComponent(String(hostId))}` +
    `&relativePath=${encodeURIComponent(relativePath)}` +
    // inline=1: served in place (media / PDF / text) for viewers to use as
    // a src, with Range support. html / js / svg still download.
    (opts.inline ? "&inline=1" : "")
  );
}
