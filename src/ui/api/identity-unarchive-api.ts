import axios from "axios";
import { authApi, handleApiError } from "@/main-axios";

// ─── Phase 143 Plan 143-05 (D-03 / D-17) — unarchiveIdentity ────────────────
//
// One-shot POST that drops the `.unarchive-requested` sentinel inside the
// identity's ARCHIVE folder. The backend route (143-04) handles the sentinel
// drop + precondition checks; this frontend helper is a thin fetch wrapper
// paralleling `identity-archive-api.ts`.
//
// Endpoint:  POST /identities/:key/unarchive
// Body:      { hostId: number }
// Response:  { ok: true }
//
// Structured 409 failure reasons (D-03):
//   missing_roles     — identity depends on still-archived roles; missingRoles
//                       carries the names so the surface can name them in the
//                       alert (D-17).
//   name_collision    — a live-tree identity with the same key already exists.
//   archive_not_found — the archived folder for this key doesn't exist.
//   no_roles          — the archived identity file has no readable `roles:`.
//
// Non-409 errors flow through handleApiError (main-axios.ts) so callers see
// the same ApiError / message shape the rest of the codebase produces.
//
// UnarchiveError + UnarchiveFailureReason are defined ONCE here and re-imported
// by the sibling role-unarchive-api.ts + apps-unarchive-api.ts (single source
// of truth — never redefine them there).

// ─── Typed reason union ──────────────────────────────────────────────────────

export type UnarchiveFailureReason =
  | "missing_roles"
  | "name_collision"
  | "archive_not_found"
  | "no_roles"
  | "unknown";

export class UnarchiveError extends Error {
  constructor(
    message: string,
    public readonly reason: UnarchiveFailureReason,
    public readonly missingRoles?: string[],
  ) {
    super(message);
    this.name = "UnarchiveError";
  }
}

// ─── Internal 409 body shape ─────────────────────────────────────────────────

interface Unarchive409Body {
  reason?: string;
  missingRoles?: string[];
}

// ─── Shared 409 parser ───────────────────────────────────────────────────────
//
// Parses a raw error from authApi.post. If the HTTP status is 409 and the
// response body carries a `reason` field, throws an UnarchiveError. Otherwise
// rethrows the error unchanged so the caller can pass it to handleApiError.

function parseUnarchive409OrRethrow(error: unknown): never {
  if (axios.isAxiosError(error) && error.response?.status === 409) {
    const body = error.response.data as Unarchive409Body;
    const reason = body?.reason;

    if (reason === "missing_roles") {
      throw new UnarchiveError(
        `Un-archive blocked: missing roles — ${(body.missingRoles ?? []).join(", ")}`,
        "missing_roles",
        body.missingRoles ?? [],
      );
    }
    if (reason === "name_collision") {
      throw new UnarchiveError(
        "Un-archive blocked: a live object with the same name already exists.",
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
    if (reason === "no_roles") {
      throw new UnarchiveError(
        "Un-archive blocked: the archived identity file lists no roles.",
        "no_roles",
        undefined,
      );
    }
    // Unknown 409 reason — surface it as UnarchiveError with "unknown" reason
    // so callers always receive a typed error for 409s, regardless of reason.
    throw new UnarchiveError(
      `Un-archive blocked: ${reason ?? "unknown reason"}.`,
      "unknown",
      undefined,
    );
  }
  // Non-409 — rethrow for the caller to pass to handleApiError.
  throw error;
}

// ─── unarchiveIdentity ────────────────────────────────────────────────────────

export async function unarchiveIdentity(
  hostId: number,
  identityKey: string,
): Promise<{ ok: true }> {
  const url = `/identities/${encodeURIComponent(identityKey)}/unarchive`;
  try {
    const response = await authApi.post(url, { hostId });
    return response.data as { ok: true };
  } catch (error) {
    try {
      parseUnarchive409OrRethrow(error);
    } catch (typed) {
      if (typed instanceof UnarchiveError) throw typed;
      handleApiError(typed, "un-archive identity");
    }
  }
}
