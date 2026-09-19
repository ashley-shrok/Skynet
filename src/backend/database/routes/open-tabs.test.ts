/**
 * Phase 120 follow-up fix pass (2026-09-19): DatabaseSaveTrigger.forceSave
 * call-site coverage for the open-tabs write handlers.
 *
 * The in-memory-decrypted SQLite invariant (role-file box-maintainer 2026-08-19)
 * requires that every db.insert / db.update / db.delete on user-scoped rows be
 * followed by an explicit DatabaseSaveTrigger.forceSave call — the 5-min isDirty
 * poller is gated on _dirty=true which only triggerSave/forceSave set, and an
 * unclean shutdown (SIGKILL, OOM, host reboot) silently loses direct-only writes.
 *
 * Pattern reference: user-preferences.test.ts / host-autostart-routes.ts:173-181.
 *
 * Coverage (one test per write handler):
 *   SAVE-POST-1  : POST / (upsert — insert branch) → forceSave("open_tabs_upsert")
 *   SAVE-POST-2  : POST / (upsert — update branch) → forceSave("open_tabs_upsert")
 *   SAVE-PUT-1   : PUT / (bulk replace, non-empty)  → forceSave("open_tabs_sync")
 *   SAVE-PUT-2   : PUT / (bulk replace, empty tabs) → forceSave("open_tabs_sync")
 *   SAVE-PATCH-1 : PATCH /:id (found)               → forceSave("open_tabs_patch")
 *   SAVE-PATCH-2 : PATCH /:id (not found — 404)     → forceSave NOT called
 *   SAVE-DELETE-1: DELETE /:id                      → forceSave("open_tabs_delete")
 *
 * Storage layer isolation: mocks ../db/index.js with a hand-rolled Drizzle-shape
 * mock (matches user-preferences.test.ts pattern) so handlers exercise real
 * chain semantics without booting SQLite.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

// ---------------------------------------------------------------------------
// Auth manager mock — every request is authenticated as USER_ID
// ---------------------------------------------------------------------------

const USER_ID = "user-1";

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware: () =>
        (
          req: express.Request,
          _res: express.Response,
          next: express.NextFunction,
        ) => {
          (req as express.Request & { userId: string }).userId = USER_ID;
          next();
        },
    }),
  },
}));

// ---------------------------------------------------------------------------
// In-memory Drizzle-shape mock db
// ---------------------------------------------------------------------------

type TabRow = {
  id: string;
  userId: string;
  tabType: string;
  hostId: number | null;
  label: string;
  tabOrder: number;
  backendSessionId: string | null;
  targetTmuxSession: string | null;
  appSlug: string | null;
  updatedAt: string;
};

const rows: TabRow[] = [];

// Track which delete/update predicate applies — the mock reads back these
// flags after eq() invocations record them.
let pendingWhereUserId: string | null = null;
let pendingWhereId: string | null = null;

const selectChain = {
  from(_table: unknown) {
    void _table;
    return this;
  },
  where(_predicate: unknown) {
    void _predicate;
    return this;
  },
  orderBy(_col: unknown) {
    void _col;
    return this;
  },
  all(): TabRow[] {
    const userId = pendingWhereUserId;
    const id = pendingWhereId;
    pendingWhereUserId = null;
    pendingWhereId = null;
    return rows.filter(
      (r) =>
        (userId == null || r.userId === userId) &&
        (id == null || r.id === id),
    );
  },
};

const insertChain = {
  values(v: TabRow | TabRow[]) {
    return {
      run() {
        if (Array.isArray(v)) {
          rows.push(...v);
        } else {
          rows.push(v);
        }
      },
    };
  },
};

const updateChain = {
  set(patch: Partial<TabRow>) {
    return {
      where(_predicate: unknown) {
        void _predicate;
        return {
          run(): { changes: number } {
            const userId = pendingWhereUserId;
            const id = pendingWhereId;
            pendingWhereUserId = null;
            pendingWhereId = null;
            let changes = 0;
            for (let i = 0; i < rows.length; i++) {
              if (
                (userId == null || rows[i].userId === userId) &&
                (id == null || rows[i].id === id)
              ) {
                rows[i] = { ...rows[i], ...patch };
                changes++;
              }
            }
            return { changes };
          },
        };
      },
    };
  },
};

const deleteChain = {
  where(_predicate: unknown) {
    void _predicate;
    return {
      run() {
        const userId = pendingWhereUserId;
        const id = pendingWhereId;
        pendingWhereUserId = null;
        pendingWhereId = null;
        for (let i = rows.length - 1; i >= 0; i--) {
          if (
            (userId == null || rows[i].userId === userId) &&
            (id == null || rows[i].id === id)
          ) {
            rows.splice(i, 1);
          }
        }
      },
    };
  },
};

const mockDb = {
  select() {
    return selectChain;
  },
  insert(_table: unknown) {
    void _table;
    return insertChain;
  },
  update(_table: unknown) {
    void _table;
    return updateChain;
  },
  delete(_table: unknown) {
    void _table;
    return deleteChain;
  },
};

vi.mock("../db/index.js", () => ({
  get db() {
    return mockDb;
  },
  DatabaseSaveTrigger: {
    forceSave: vi.fn(async () => {}),
  },
}));

// eq() smuggles either userId (string keyed off userOpenTabs.userId column)
// or id (string keyed off userOpenTabs.id column) into the pending where
// flags. The mock treats them the same — record whichever column signature
// we recognise. We disambiguate by looking at the column object shape.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>(
    "drizzle-orm",
  );
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => {
      // The schema column carries a `.name` field; we use it to route.
      const colName =
        typeof col === "object" &&
        col !== null &&
        "name" in col &&
        typeof (col as { name?: unknown }).name === "string"
          ? (col as { name: string }).name
          : "";
      if (colName === "user_id") {
        pendingWhereUserId = typeof val === "string" ? val : null;
      } else if (colName === "id") {
        pendingWhereId = typeof val === "string" ? val : null;
      }
      return { col, val };
    },
    and: (..._args: unknown[]) => ({ _args }),
    sql: (strings: TemplateStringsArray, ..._exprs: unknown[]) => ({
      strings,
      _exprs,
    }),
  };
});

// databaseLogger.error is called on 500 branches; stub so tests do not
// pollute the console.
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

// sessionManager is imported at module load but only used on GET
// /active-sessions — stub to a no-op shape.
vi.mock("../../ssh/terminal-session-manager.js", () => ({
  sessionManager: {
    getUserSessions: () => [],
  },
}));

// ---------------------------------------------------------------------------
// Import router AFTER mocks
// ---------------------------------------------------------------------------

const { default: router } = await import("./open-tabs.js");
const { DatabaseSaveTrigger } = await import("../db/index.js");

let server: http.Server;

beforeEach(() => {
  rows.length = 0;
  pendingWhereUserId = null;
  pendingWhereId = null;
  (DatabaseSaveTrigger.forceSave as ReturnType<typeof vi.fn>).mockClear();

  const app = express();
  app.use(express.json());
  app.use("/open-tabs", router);

  server = http.createServer(app);
  server.listen(0);
});

afterEach(() => {
  return new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Tiny HTTP helper — sends a request to the server on its ephemeral port.
// ---------------------------------------------------------------------------

function request(opts: {
  method: string;
  path: string;
  body?: unknown;
}): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : "";
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers: {
          "content-type": "application/json",
          "content-length": Buffer.byteLength(bodyStr).toString(),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });
        res.on("end", () => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = data;
          }
          resolve({ status: res.statusCode ?? 0, body: parsed });
        });
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests — DatabaseSaveTrigger.forceSave call sites
// ---------------------------------------------------------------------------

describe("open-tabs: DatabaseSaveTrigger.forceSave call sites", () => {
  it("SAVE-POST-1: POST / (insert branch) fires forceSave('open_tabs_upsert')", async () => {
    const res = await request({
      method: "POST",
      path: "/open-tabs",
      body: {
        id: "tab-1",
        tabType: "app",
        label: "Test",
        tabOrder: 0,
        hostId: 5,
        appSlug: "todo",
      },
    });

    expect(res.status).toBe(200);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledWith(
      "open_tabs_upsert",
    );
  });

  it("SAVE-POST-2: POST / (update branch — row exists) fires forceSave('open_tabs_upsert')", async () => {
    rows.push({
      id: "tab-1",
      userId: USER_ID,
      tabType: "app",
      hostId: 5,
      label: "Old",
      tabOrder: 0,
      backendSessionId: null,
      targetTmuxSession: null,
      appSlug: "todo",
      updatedAt: new Date().toISOString(),
    });

    const res = await request({
      method: "POST",
      path: "/open-tabs",
      body: {
        id: "tab-1",
        tabType: "app",
        label: "New",
        tabOrder: 1,
        hostId: 5,
        appSlug: "todo",
      },
    });

    expect(res.status).toBe(200);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledWith(
      "open_tabs_upsert",
    );
  });

  it("SAVE-PUT-1: PUT / (bulk replace, non-empty) fires forceSave('open_tabs_sync')", async () => {
    const res = await request({
      method: "PUT",
      path: "/open-tabs",
      body: {
        tabs: [
          {
            id: "tab-1",
            tabType: "app",
            label: "A",
            tabOrder: 0,
            hostId: 5,
            appSlug: "todo",
          },
          {
            id: "tab-2",
            tabType: "terminal",
            label: "B",
            tabOrder: 1,
            hostId: 5,
          },
        ],
      },
    });

    expect(res.status).toBe(200);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledWith(
      "open_tabs_sync",
    );
  });

  it("SAVE-PUT-2: PUT / (bulk replace, empty tabs) still fires forceSave('open_tabs_sync')", async () => {
    // Empty replace still deletes existing rows for the user — the durability
    // gate must fire so the delete is persisted (otherwise a user who clears
    // all tabs on box A silently re-inherits them on reboot).
    rows.push({
      id: "tab-1",
      userId: USER_ID,
      tabType: "app",
      hostId: 5,
      label: "Old",
      tabOrder: 0,
      backendSessionId: null,
      targetTmuxSession: null,
      appSlug: "todo",
      updatedAt: new Date().toISOString(),
    });

    const res = await request({
      method: "PUT",
      path: "/open-tabs",
      body: { tabs: [] },
    });

    expect(res.status).toBe(200);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledWith(
      "open_tabs_sync",
    );
  });

  it("SAVE-PATCH-1: PATCH /:id (found) fires forceSave('open_tabs_patch')", async () => {
    rows.push({
      id: "tab-1",
      userId: USER_ID,
      tabType: "app",
      hostId: 5,
      label: "Old",
      tabOrder: 0,
      backendSessionId: null,
      targetTmuxSession: null,
      appSlug: "todo",
      updatedAt: new Date().toISOString(),
    });

    const res = await request({
      method: "PATCH",
      path: "/open-tabs/tab-1",
      body: { label: "New" },
    });

    expect(res.status).toBe(200);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledWith(
      "open_tabs_patch",
    );
  });

  it("SAVE-PATCH-2: PATCH /:id (404 — no matching row) does NOT fire forceSave", async () => {
    // Zero-changes update must not fire forceSave — nothing was written, so
    // the RAM state is unchanged and the on-disk state is already in sync.
    const res = await request({
      method: "PATCH",
      path: "/open-tabs/tab-does-not-exist",
      body: { label: "New" },
    });

    expect(res.status).toBe(404);
    expect(DatabaseSaveTrigger.forceSave).not.toHaveBeenCalled();
  });

  it("SAVE-DELETE-1: DELETE /:id fires forceSave('open_tabs_delete')", async () => {
    rows.push({
      id: "tab-1",
      userId: USER_ID,
      tabType: "app",
      hostId: 5,
      label: "Old",
      tabOrder: 0,
      backendSessionId: null,
      targetTmuxSession: null,
      appSlug: "todo",
      updatedAt: new Date().toISOString(),
    });

    const res = await request({
      method: "DELETE",
      path: "/open-tabs/tab-1",
    });

    expect(res.status).toBe(200);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledTimes(1);
    expect(DatabaseSaveTrigger.forceSave).toHaveBeenCalledWith(
      "open_tabs_delete",
    );
  });
});
