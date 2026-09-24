// Phase 135 Plan 135-01 Task 1 — Front-end helpers for the shape-2 wake-ups
// REST surface (fleet-wide LIST + per-host CRUD + toggle-enabled).
//
// This file is the frontend counterpart to
// `src/backend/database/routes/wakeups-list.ts` (LIST) +
// `src/backend/database/routes/wakeups-write.ts` (CREATE / UPDATE / DELETE /
// toggle-enabled). Mounted server-side at bare `/wakeups` — NOT `/api/wakeups`
// (see `src/backend/database/database.ts:2036-2037`).
//
// Wire-type discipline (RESEARCH.md Pitfall #2): the older `WakeupSpecWire`
// exported from `@/api/claude-session-api` carries the retired per-identity
// field shape and MUST NOT be re-imported here. The new global wake-ups path
// uses `prompt`, `roles`, `skills`. `GlobalWakeupSpecWire` below is a fresh
// mirror of `wakeups-write.ts:136-152` `GlobalWakeupSpec`.
//
// DELETE-with-body (RESEARCH.md Pitfall #4): shape 2's DELETE `/wakeups/:slug`
// takes `{host}` in the request body, not the query string. Axios attaches a
// body to DELETE via the `data` config key — the helper below uses that
// pattern verbatim.
//
// Slug discipline (RESEARCH.md § Anti-Patterns): the server derives the slug
// from `spec.name` via `normalizeWakeupSlug`. Clients MUST NOT compute it.
// Every helper takes the slug back FROM the server response for CREATE, or
// pre-computed FROM the LIST for UPDATE / DELETE / toggle.

import { authApi, handleApiError } from "@/main-axios";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** Mirror of backend `WakeupListItem` (wakeups-list.ts:75-86). One row of the
 *  fleet-wide GET `/wakeups` response. `schedule` stays `unknown` — hydrate
 *  via `hydrateFormSchedule` from `@/features/pretty-view/WakeupFormShared`
 *  when the form view needs it. `scheduleHuman` is the pre-humanized string
 *  the server already computed. `skills` is populated only when hand-edited
 *  on disk per Phase 134 D-04 (the modal never writes it in v1). */
export type WakeupListItem = {
  slug: string;
  host: string;
  hostId: number;
  name: string;
  enabled: boolean;
  schedule: unknown;
  scheduleHuman: string;
  prompt: string;
  roles: string[];
  skills: string[];
};

/** Mirror of backend `GlobalWakeupSpec` (wakeups-write.ts:136-152). The
 *  wire-shape the server accepts for CREATE + UPDATE. `schedule` stays
 *  `Record<string, unknown>` — validation happens server-side via
 *  `validateGlobalWakeupSpec` (mirrors `wakeup-scheduler.py`'s parser). */
export type GlobalWakeupSpecWire = {
  name: string;
  enabled?: boolean;
  prompt: string;
  schedule: Record<string, unknown>;
  roles?: string[];
  skills?: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * GET `/wakeups` — fleet-wide LIST fan-out. No query params. Backend
 * response is `{items: WakeupListItem[]}`; this helper unwraps `.items` so
 * callers work with a plain array. Individual host failures contribute `[]`
 * to the flat array (per-host `Promise.race` with 15s timeout server-side);
 * a global 500 propagates through `handleApiError`.
 */
export async function listWakeups(): Promise<WakeupListItem[]> {
  try {
    const response = await authApi.get("/wakeups");
    return (response.data as { items: WakeupListItem[] }).items;
  } catch (error) {
    handleApiError(error, "list wake-ups");
  }
}

/**
 * POST `/wakeups` — create a wake-up on the target host. Body is
 * `{host, spec}`. Server returns `{slug, host, spec}` — the slug is
 * server-derived from `spec.name` via `normalizeWakeupSlug`; clients MUST
 * NOT precompute it. 409 on slug collision; 400 on validation reject; 502
 * on transport failure.
 */
export async function createWakeup(
  host: number,
  spec: GlobalWakeupSpecWire,
): Promise<{ slug: string; host: number; spec: GlobalWakeupSpecWire }> {
  try {
    const response = await authApi.post("/wakeups", { host, spec });
    return response.data as {
      slug: string;
      host: number;
      spec: GlobalWakeupSpecWire;
    };
  } catch (error) {
    handleApiError(error, "create wake-up");
  }
}

/**
 * PATCH `/wakeups/:slug` — full-spec overwrite on the target host. The
 * body's `spec.name` MUST kebab-normalize to the URL's `:slug` (server
 * rejects renames with 400 — see RESEARCH.md Pitfall #5). Renaming is a
 * delete-and-recreate workflow.
 */
export async function updateWakeup(
  slug: string,
  host: number,
  spec: GlobalWakeupSpecWire,
): Promise<{ slug: string; host: number; spec: GlobalWakeupSpecWire }> {
  try {
    const response = await authApi.patch(
      `/wakeups/${encodeURIComponent(slug)}`,
      { host, spec },
    );
    return response.data as {
      slug: string;
      host: number;
      spec: GlobalWakeupSpecWire;
    };
  } catch (error) {
    handleApiError(error, "update wake-up");
  }
}

/**
 * PATCH `/wakeups/:slug/toggle-enabled` — flip the enabled flag on a
 * wake-up. Reads-then-writes the spec on the target host; per-slug mutex
 * serializes concurrent writes server-side. Response echoes
 * `{slug, host, enabled}`.
 */
export async function toggleWakeupEnabled(
  slug: string,
  host: number,
  enabled: boolean,
): Promise<{ slug: string; host: number; enabled: boolean }> {
  try {
    const response = await authApi.patch(
      `/wakeups/${encodeURIComponent(slug)}/toggle-enabled`,
      { host, enabled },
    );
    return response.data as { slug: string; host: number; enabled: boolean };
  } catch (error) {
    handleApiError(error, "toggle wake-up enabled");
  }
}

/**
 * DELETE `/wakeups/:slug` — hard delete on the target host. Non-standard:
 * the `host` param travels in the REQUEST BODY (not the query string) per
 * shape 2's wire choice (consistency with POST/PATCH). Axios attaches a
 * body to DELETE via the `data` config key — see RESEARCH.md Pitfall #4.
 * Server also removes the `~/fleet/wakeups/.state/<slug>.fired` sentinel
 * so a future spec with the same slug doesn't inherit "already fired"
 * state. 204 on success (no body); 404 on unknown host; 502 on transport.
 */
export async function deleteWakeup(slug: string, host: number): Promise<void> {
  try {
    await authApi.delete(`/wakeups/${encodeURIComponent(slug)}`, { data: { host } });
  } catch (error) {
    handleApiError(error, "delete wake-up");
  }
}
