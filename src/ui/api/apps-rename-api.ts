import { authApi, handleApiError } from "@/main-axios";

// ─── renameApp — app-rename shape ───────────────────────────────────────────
//
// PATCH that rewrites the `title` field of the app's app.json on the owning
// host (title only — the slug is the app's identity and is not renameable).
// The backend route (apps-rename.ts) re-validates; validateAppTitle below
// gives the AppTile prompt the same verdict client-side before any request.
//
// Endpoint:  PATCH /apps/:hostId/:slug
// Body:      { title: string }
// Response:  { ok: true, title }   (title = trimmed, stored value)

/** Mirror of APP_TITLE_MAX_LEN in src/backend/claude-session/per-app-file.ts. */
export const APP_TITLE_MAX_LEN = 80;

const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f-\u009f]/;

// `never` on the off-branch fields keeps `.error` / `.title` readable
// without discriminant narrowing (the backend tsconfig doesn't narrow it).
export type AppTitleCheck =
  | { ok: true; title: string; error?: never }
  | { ok: false; error: string; title?: never };

/**
 * Client-side mirror of validateAppTitle in per-app-file.ts — keep the two in
 * lockstep (no shared module between the backend and UI builds).
 */
export function validateAppTitle(
  raw: string,
): AppTitleCheck {
  const title = raw.trim();
  if (title.length === 0) {
    return { ok: false, error: "Name can't be empty." };
  }
  if (title.length > APP_TITLE_MAX_LEN) {
    return {
      ok: false,
      error: `Name must be at most ${APP_TITLE_MAX_LEN} characters.`,
    };
  }
  if (CONTROL_CHAR_RE.test(title)) {
    return { ok: false, error: "Name can't contain line breaks or control characters." };
  }
  return { ok: true, title };
}

export async function renameApp(
  hostId: number,
  slug: string,
  title: string,
): Promise<{ ok: true; title: string }> {
  try {
    const url = `/apps/${hostId}/${encodeURIComponent(slug)}`;
    const response = await authApi.patch(url, { title });
    return response.data as { ok: true; title: string };
  } catch (error) {
    handleApiError(error, "rename app");
  }
}
