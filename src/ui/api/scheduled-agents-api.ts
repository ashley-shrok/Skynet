// Phase 135 Plan 135-01 Task 1 — Front-end helpers for the scheduled-agents
// REST surface (fleet-wide LIST + per-host CRUD + toggle-enabled + run-now).
//
// This file is the frontend counterpart to
// `src/backend/database/routes/scheduled-agents-list.ts` (LIST) +
// `src/backend/database/routes/scheduled-agents-write.ts` (CREATE / UPDATE /
// DELETE / toggle-enabled). Mounted server-side at bare `/scheduled-agents`
// — NOT `/api/scheduled-agents` (see `src/backend/database/database.ts`).
//
// Wire-type discipline (RESEARCH.md Pitfall #2): the older `WakeupSpecWire`
// exported from `@/api/claude-session-api` carries the per-identity wake-up
// field shape (a distinct fleet concept) and MUST NOT be re-imported here.
// The scheduled-agents path uses `prompt`, `roles`.
// `ScheduledAgentSpecWire` below is a fresh mirror of the backend
// `ScheduledAgentSpec` in `scheduled-agents-write.ts`.
//
// DELETE-with-body (RESEARCH.md Pitfall #4): DELETE `/scheduled-agents/:slug`
// takes `{host}` in the request body, not the query string. Axios attaches a
// body to DELETE via the `data` config key — the helper below uses that
// pattern verbatim.
//
// Slug discipline (RESEARCH.md § Anti-Patterns): the server derives the slug
// from `spec.name` via `normalizeSpecSlug`. Clients MUST NOT
// compute it. Every helper takes the slug back FROM the server response for
// CREATE, or pre-computed FROM the LIST for UPDATE / DELETE / toggle.

import { authApi, handleApiError } from "@/main-axios";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** Mirror of backend `ScheduledAgentListItem` (scheduled-agents-list.ts). One
 *  row of the fleet-wide GET `/scheduled-agents` response. `schedule` stays
 *  `unknown` — hydrate via `hydrateFormSchedule` from
 *  `@/features/pretty-view/WakeupFormShared` when the form view needs it (the
 *  shared form helpers are named for the per-identity wake-up concept but the
 *  hydration logic is schedule-shape-agnostic). `scheduleHuman` is the
 *  pre-humanized string the server already computed. */
export type ScheduledAgentListItem = {
  slug: string;
  host: string;
  hostId: number;
  name: string;
  enabled: boolean;
  schedule: unknown;
  scheduleHuman: string;
  prompt: string;
  roles: string[];
  /**
   * First-role's resolved colorHue from the OWNING host's role file
   * frontmatter. Piggybacks on a memoized per-host role-file read at
   * list-assembly time (see backend attachColorHuesForHost). Frontend row
   * uses this for the avatar-sm hue + `--row-hue` CSS custom-property;
   * falls back to 190 when null. */
  colorHue: number | null;
  /**
   * Last-fire epoch seconds (from `~/fleet/scheduled-agents/.state/<slug>.last`)
   * and computed next-fire epoch seconds (from the TS port of the Python
   * scheduler's `_due` logic — see backend `schedule-next-fire.ts`). Both are
   * attached per row at list-assembly time; the modal row renders them as
   * relative times beneath the humanized schedule. Either may be null when
   * the sentinel is absent or the schedule shape is unknown. */
  lastFiredAt: number | null;
  nextFireAt: number | null;
};

/** Mirror of backend `ScheduledAgentSpec` (scheduled-agents-write.ts). The
 *  wire-shape the server accepts for CREATE + UPDATE. `schedule` stays
 *  `Record<string, unknown>` — validation happens server-side via
 *  `validateScheduledAgentSpec` (mirrors `wakeup-scheduler.py`'s parser). */
export type ScheduledAgentSpecWire = {
  name: string;
  enabled?: boolean;
  prompt: string;
  schedule: Record<string, unknown>;
  roles?: string[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * GET `/scheduled-agents` — fleet-wide LIST fan-out. No query params. Backend
 * response is `{items: ScheduledAgentListItem[]}`; this helper unwraps
 * `.items` so callers work with a plain array. Individual host failures
 * contribute `[]` to the flat array (per-host `Promise.race` with 15s
 * timeout server-side); a global 500 propagates through `handleApiError`.
 */
export async function listScheduledAgents(): Promise<ScheduledAgentListItem[]> {
  try {
    const response = await authApi.get("/scheduled-agents");
    return (response.data as { items: ScheduledAgentListItem[] }).items;
  } catch (error) {
    handleApiError(error, "list scheduled agents");
  }
}

/**
 * POST `/scheduled-agents` — create a scheduled agent on the target host.
 * Body is `{host, spec}`. Server returns `{slug, host, spec}` — the slug is
 * server-derived from `spec.name` via `normalizeSpecSlug`; clients
 * MUST NOT precompute it. 409 on slug collision; 400 on validation reject;
 * 502 on transport failure.
 */
export async function createScheduledAgent(
  host: number,
  spec: ScheduledAgentSpecWire,
): Promise<{ slug: string; host: number; spec: ScheduledAgentSpecWire }> {
  try {
    const response = await authApi.post("/scheduled-agents", { host, spec });
    return response.data as {
      slug: string;
      host: number;
      spec: ScheduledAgentSpecWire;
    };
  } catch (error) {
    handleApiError(error, "create scheduled agent");
  }
}

/**
 * PATCH `/scheduled-agents/:slug` — full-spec overwrite on the target host.
 * The body's `spec.name` MUST kebab-normalize to the URL's `:slug` (server
 * rejects renames with 400 — see RESEARCH.md Pitfall #5). Renaming is a
 * delete-and-recreate workflow.
 */
export async function updateScheduledAgent(
  slug: string,
  host: number,
  spec: ScheduledAgentSpecWire,
): Promise<{ slug: string; host: number; spec: ScheduledAgentSpecWire }> {
  try {
    const response = await authApi.patch(
      `/scheduled-agents/${encodeURIComponent(slug)}`,
      { host, spec },
    );
    return response.data as {
      slug: string;
      host: number;
      spec: ScheduledAgentSpecWire;
    };
  } catch (error) {
    handleApiError(error, "update scheduled agent");
  }
}

/**
 * PATCH `/scheduled-agents/:slug/toggle-enabled` — flip the enabled flag on
 * a scheduled agent. Reads-then-writes the spec on the target host; per-slug
 * mutex serializes concurrent writes server-side. Response echoes
 * `{slug, host, enabled}`.
 */
export async function toggleScheduledAgentEnabled(
  slug: string,
  host: number,
  enabled: boolean,
): Promise<{ slug: string; host: number; enabled: boolean }> {
  try {
    const response = await authApi.patch(
      `/scheduled-agents/${encodeURIComponent(slug)}/toggle-enabled`,
      { host, enabled },
    );
    return response.data as { slug: string; host: number; enabled: boolean };
  } catch (error) {
    handleApiError(error, "toggle scheduled agent enabled");
  }
}

/**
 * POST `/scheduled-agents/:slug/run-now` — fire a scheduled agent once, now,
 * outside its schedule. The server drops a spawn-request on the target host
 * exactly as a clock fire would (the new identity appears once the spawn-scan
 * picks it up). The schedule itself is untouched — `lastFiredAt` /
 * `nextFireAt` don't move. Works on disabled specs; 400 on one_shot specs or
 * specs with no roles; 404 on unknown slug/host; 502 on transport.
 */
export async function runScheduledAgentNow(
  slug: string,
  host: number,
): Promise<{ slug: string; host: number; requestId: string }> {
  try {
    const response = await authApi.post(
      `/scheduled-agents/${encodeURIComponent(slug)}/run-now`,
      { host },
    );
    return response.data as { slug: string; host: number; requestId: string };
  } catch (error) {
    handleApiError(error, "run scheduled agent now");
  }
}

/**
 * DELETE `/scheduled-agents/:slug` — hard delete on the target host.
 * Non-standard: the `host` param travels in the REQUEST BODY (not the query
 * string) per the wire choice (consistency with POST/PATCH). Axios attaches
 * a body to DELETE via the `data` config key — see RESEARCH.md Pitfall #4.
 * Server also removes the `~/fleet/scheduled-agents/.state/<slug>.fired`
 * sentinel so a future spec with the same slug doesn't inherit "already
 * fired" state. 204 on success (no body); 404 on unknown host; 502 on
 * transport.
 */
export async function deleteScheduledAgent(slug: string, host: number): Promise<void> {
  try {
    await authApi.delete(`/scheduled-agents/${encodeURIComponent(slug)}`, { data: { host } });
  } catch (error) {
    handleApiError(error, "delete scheduled agent");
  }
}
