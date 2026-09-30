import axios from "axios";
import { authApi, handleApiError } from "@/main-axios";

// ─── Phase 143 Plan 143-05 (D-03 / D-17) — unarchiveRole ────────────────────
//
// One-shot POST that drops the `.unarchive-requested` sentinel inside the
// role's ARCHIVE folder. The backend route (143-04) handles the sentinel drop
// + precondition checks; this frontend helper parallels `role-archive-api.ts`.
//
// Endpoint:  POST /roles/:name/unarchive
// Body:      { hostId: number }
// Response:  { ok: true }
//
// Structured 409 failure reasons (D-03):
//   name_collision    — a live role with the same name already exists.
//   archive_not_found — the archived folder for this role doesn't exist.
//   (missing_roles does NOT apply to roles per D-02, but we surface it
//    as-is from the server if the endpoint ever returns it — defense-in-depth
//    for future evolution.)
//
// UnarchiveError + UnarchiveFailureReason are defined in identity-unarchive-api.ts
// (single source of truth). Imported here — NOT redeclared.

import {
  UnarchiveError,
  type UnarchiveFailureReason,
} from "@/api/identity-unarchive-api";

// Re-export so downstream consumers can import from either module.
export { UnarchiveError, type UnarchiveFailureReason };

// ─── Internal 409 body shape ─────────────────────────────────────────────────

interface Unarchive409Body {
  reason?: string;
  missingRoles?: string[];
}

// ─── 409 parser ──────────────────────────────────────────────────────────────

function parseUnarchive409OrRethrow(error: unknown): never {
  if (axios.isAxiosError(error) && error.response?.status === 409) {
    const body = error.response.data as Unarchive409Body;
    const reason = body?.reason;

    if (reason === "missing_roles") {
      // Not expected for roles (D-02) but surface faithfully for defense-in-depth.
      throw new UnarchiveError(
        `Un-archive blocked: missing roles — ${(body.missingRoles ?? []).join(", ")}`,
        "missing_roles",
        body.missingRoles ?? [],
      );
    }
    if (reason === "name_collision") {
      throw new UnarchiveError(
        "Un-archive blocked: a live role with the same name already exists.",
        "name_collision",
        undefined,
      );
    }
    if (reason === "archive_not_found") {
      throw new UnarchiveError(
        "Un-archive blocked: archive folder not found.",
        "archive_not_found",
        undefined,
      );
    }
    throw new UnarchiveError(
      `Un-archive blocked: ${reason ?? "unknown reason"}.`,
      "unknown",
      undefined,
    );
  }
  throw error;
}

// ─── unarchiveRole ────────────────────────────────────────────────────────────

export async function unarchiveRole(
  hostId: number,
  roleName: string,
): Promise<{ ok: true }> {
  const url = `/roles/${encodeURIComponent(roleName)}/unarchive`;
  try {
    const response = await authApi.post(url, { hostId });
    return response.data as { ok: true };
  } catch (error) {
    try {
      parseUnarchive409OrRethrow(error);
    } catch (typed) {
      if (typed instanceof UnarchiveError) throw typed;
      handleApiError(typed, "un-archive role");
    }
  }
}
