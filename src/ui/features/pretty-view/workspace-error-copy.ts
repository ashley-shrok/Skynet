/**
 * Phase 118 Plan 118-02 Task 2 — Consumer-user error copy for workspace CRUD.
 *
 * D-23 + D-24 (consumer-user register): every heading and body in this map must
 * be readable by a non-developer. The target user's fallback when something
 * goes wrong is "ask the agent" — not a terminal or a help page.
 *
 * Register rules (enforced by the grep gate in 118-02-PLAN.md Task 2 verify):
 *   - No raw protocol names, no technical jargon, no numeric error codes
 *   - No file paths, no command-line strings
 *   - Body sentences are complete English with a trailing period
 *   - Tone: friendly, short, actionable (matches the existing modal error copy)
 *
 * Overlapping entries (host_unreachable, not_found, etc.) are RE-DECLARED here
 * rather than imported from EditableFileModal.tsx. FILE_URL_ERROR_COPY is not
 * exported from that module, and touching an existing file out of scope carries
 * risk. Zero-risk option per RESEARCH.md Pattern 8 / PATTERNS.md Pattern 8.
 *
 * NO React imports. NO component code. Pure data + one 3-line resolver.
 */

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export type WorkspaceErrorCopy = { heading: string; body: string };

// ---------------------------------------------------------------------------
// WORKSPACE_ERROR_COPY — all error classes the backend produces (Plan 118-01)
// ---------------------------------------------------------------------------

/**
 * Keyed by backend error-class string (matches Error.message thrown by
 * workspace-api.ts helpers). WorkspaceTab resolves copy via
 * resolveWorkspaceErrorCopy(err.message).
 *
 * Classes shared with EditableFileModal's FILE_URL_ERROR_COPY:
 *   host_unreachable, not_found, too_large, not_a_file, path_forbidden,
 *   path_traversal, permission_denied, unknown_host, ssh_timeout,
 *   invalid_hostname, invalid_body, generic
 *
 * Workspace-specific additions:
 *   not_a_directory, already_exists, not_empty, invalid_identity_key
 */
export const WORKSPACE_ERROR_COPY: Record<string, WorkspaceErrorCopy> = {
  // -------------------------------------------------------------------------
  // Host/connection errors
  // -------------------------------------------------------------------------

  "host_unreachable": {
    heading: "Host unreachable",
    body: "The box may be offline or the connection is down. Try again in a moment.",
  },

  "ssh_timeout": {
    heading: "Connection timed out",
    body: "The box is slow or unreachable. Try again in a moment.",
  },

  "unknown_host": {
    heading: "Unknown host",
    body: "That box isn't registered, or you don't have access to it.",
  },

  "invalid_hostname": {
    heading: "Something went wrong",
    body: "The address looks wrong. Refresh and try again.",
  },

  // -------------------------------------------------------------------------
  // Access / permission errors
  // -------------------------------------------------------------------------

  "permission_denied": {
    heading: "Permission denied",
    body: "You don't have access to that file or folder.",
  },

  "path_forbidden": {
    heading: "Off limits",
    body: "That location is not accessible.",
  },

  // -------------------------------------------------------------------------
  // Path / naming errors
  // -------------------------------------------------------------------------

  "path_traversal": {
    heading: "Invalid name",
    body: "That name contains characters that aren't allowed.",
  },

  "not_found": {
    heading: "File not found",
    body: "No such file or folder here.",
  },

  "already_exists": {
    heading: "Already exists",
    body: "Something with that name already exists here. Choose a different name.",
  },

  "not_empty": {
    heading: "Folder not empty",
    body: "Remove everything inside the folder first, then delete it.",
  },

  // -------------------------------------------------------------------------
  // Type mismatch errors
  // -------------------------------------------------------------------------

  "not_a_file": {
    heading: "Not a file",
    body: "That's a folder, not a file.",
  },

  "not_a_directory": {
    heading: "Not a folder",
    body: "That's a file, not a folder.",
  },

  // -------------------------------------------------------------------------
  // Size errors
  // -------------------------------------------------------------------------

  "too_large": {
    heading: "File too large",
    body: "This file is too large to open in the editor. Use the Download button instead.",
  },

  // -------------------------------------------------------------------------
  // Request / configuration errors
  // -------------------------------------------------------------------------

  "invalid_identity_key": {
    heading: "Something went wrong",
    body: "Could not identify the agent. Try closing and reopening.",
  },

  "invalid_body": {
    heading: "Something went wrong",
    body: "The request was malformed. Refresh and try again.",
  },

  // -------------------------------------------------------------------------
  // Catch-all
  // -------------------------------------------------------------------------

  "generic": {
    heading: "Something went wrong",
    body: "An unexpected error occurred. Try again, or refresh the page.",
  },
};

// ---------------------------------------------------------------------------
// Resolver helper
// ---------------------------------------------------------------------------

/**
 * Look up consumer-user copy for a backend error-class string.
 * Returns WORKSPACE_ERROR_COPY.generic if the class is unknown or undefined.
 *
 * Usage in WorkspaceTab:
 *   const copy = resolveWorkspaceErrorCopy(err.message);
 *   // render copy.heading + copy.body
 */
export function resolveWorkspaceErrorCopy(
  errorClass: string | undefined,
): WorkspaceErrorCopy {
  return WORKSPACE_ERROR_COPY[errorClass ?? ""] ?? WORKSPACE_ERROR_COPY.generic;
}
