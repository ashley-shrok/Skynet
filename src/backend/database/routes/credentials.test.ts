/**
 * credentials.test.ts — Quick 260910-0h6 regression tests.
 *
 * Asserts that DatabaseSaveTrigger.triggerSave fires for the 4 raw-db.update
 * sites fixed in credentials.ts (Sites 1-4: DELETE /:id, POST apply-to-host
 * hosts-write, POST apply-to-host usage-bump, PUT /folders/rename). Before the
 * fix, these calls bypassed SimpleDBOps entirely, so `_dirty` stayed false and
 * container restarts wiped the changes.
 *
 * Strategy: spin an express http server with the router mounted, mock all I/O
 * layers (db, crypto, save-trigger, shared-cred-manager), invoke endpoints via
 * node http, assert triggerSave fired with the correct reason string.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";

// ---------------------------------------------------------------------------
// In-memory row stores (Map-backed, shared across mock chains)
// ---------------------------------------------------------------------------

type HostRow = {
  id: number;
  userId: string;
  credentialId: number | null;
  username: string | null;
  authType: string | null;
  password: string | null;
  key: string | null;
  keyPassword: string | null;
  keyType: string | null;
  updatedAt: string | null;
  name?: string;
  ip?: string;
  port?: number;
};

type CredentialRow = {
  id: number;
  userId: string;
  authType: string;
  username: string | null;
  password: string | null;
  key: string | null;
  keyPassword: string | null;
  usageCount: number;
  lastUsed: string | null;
  updatedAt: string;
  folder: string | null;
  name?: string;
  description?: string | null;
  tags?: string;
  keyType?: string | null;
  detectedKeyType?: string | null;
  certPublicKey?: string | null;
  privateKey?: string | null;
  publicKey?: string | null;
};

const hostsMap = new Map<number, HostRow>();
const credentialsMap = new Map<number, CredentialRow>();
const hostAccessMap = new Map<number, { id: number; hostId: number }>();
const credentialUsageRows: unknown[] = [];

// ---------------------------------------------------------------------------
// Drizzle predicate evaluator
// ---------------------------------------------------------------------------

type Predicate =
  | { __kind: "eq"; colName: string; val: unknown }
  | { __kind: "and"; preds: Predicate[] }
  | { __kind: "sql"; strings: TemplateStringsArray; values: unknown[] };

function evalPred(pred: unknown, row: Record<string, unknown>): boolean {
  if (!pred || typeof pred !== "object") return true;
  const p = pred as Predicate;
  if (p.__kind === "eq") {
    return row[p.colName] === p.val;
  }
  if (p.__kind === "and") {
    return p.preds.every((sub) => evalPred(sub, row));
  }
  return true;
}

function applyWhere<T extends Record<string, unknown>>(
  rows: T[],
  where: unknown,
): T[] {
  if (!where) return rows;
  return rows.filter((r) => evalPred(where, r));
}

// ---------------------------------------------------------------------------
// Mock drizzle-orm — lightweight predicate objects + sql fragment stub
// ---------------------------------------------------------------------------

vi.mock("drizzle-orm", () => ({
  eq: (col: { name?: string; fieldName?: string; columnName?: string } | string, val: unknown) => {
    const colName =
      typeof col === "string"
        ? col
        : col?.name ?? col?.fieldName ?? col?.columnName ?? String(col);
    return { __kind: "eq", colName, val };
  },
  and: (...preds: unknown[]) => ({ __kind: "and", preds }),
  desc: (c: unknown) => c,
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    __kind: "sql",
    strings,
    values,
  }),
}));

// ---------------------------------------------------------------------------
// Mock database-save-trigger — spy on triggerSave
// ---------------------------------------------------------------------------

vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    triggerSave: vi.fn(),
    forceSave: vi.fn(async () => {}),
    markClean: vi.fn(),
    isDirty: false,
    initialize: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock data-crypto — passthrough (no encryption overhead in tests)
// ---------------------------------------------------------------------------

vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    validateUserAccess: (_userId: string) => Buffer.from("dummy-key"),
    getUserDataKey: (_userId: string) => Buffer.from("dummy-key"),
    canUserAccessData: (_userId: string) => true,
    encryptRecord: (
      _tableName: string,
      data: Record<string, unknown>,
      _userId: string,
      _key: Buffer,
    ) => ({ ...data }),
    decryptRecord: <T>(
      _tableName: string,
      data: T,
      _userId: string,
      _key: Buffer,
    ) => data,
    decryptRecords: <T>(
      _tableName: string,
      records: T[],
      _userId: string,
      _key: Buffer,
    ) => records,
    encryptRecordWithSystemKey: async (
      _tableName: string,
      data: Record<string, unknown>,
      _key: Buffer,
    ) => ({ ...data }),
  },
}));

// ---------------------------------------------------------------------------
// Mock system-crypto — return dummy buffer for credential sharing key
// ---------------------------------------------------------------------------

vi.mock("../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getCredentialSharingKey: async () => Buffer.from("dummy-system-key"),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock auth-manager — inject userId="u1" for all authenticated requests
// ---------------------------------------------------------------------------

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (
          req: express.Request & { userId?: string },
          _res: express.Response,
          next: express.NextFunction,
        ) => {
          req.userId = "u1";
          next();
        },
      createDataAccessMiddleware:
        () =>
        (
          _req: express.Request,
          _res: express.Response,
          next: express.NextFunction,
        ) => {
          next();
        },
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock shared-credential-manager — no-ops for delete + update propagation
// ---------------------------------------------------------------------------

vi.mock("../../utils/shared-credential-manager.js", () => ({
  SharedCredentialManager: {
    getInstance: () => ({
      deleteSharedCredentialsForOriginal: vi.fn().mockResolvedValue(undefined),
      updateSharedCredentialsForOriginal: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock logger
// ---------------------------------------------------------------------------

vi.mock("../../utils/logger.js", () => ({
  authLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock ssh-key-utils (not needed in these test paths)
// ---------------------------------------------------------------------------

vi.mock("../../utils/ssh-key-utils.js", () => ({
  parseSSHKey: vi.fn(() => ({ success: true, keyType: "rsa", privateKey: "pk", publicKey: "pub" })),
}));

// ---------------------------------------------------------------------------
// Mock credential-key-routes and credential-deploy-routes (sub-routers)
// ---------------------------------------------------------------------------

vi.mock("./credential-key-routes.js", () => ({
  registerCredentialKeyRoutes: vi.fn(),
}));

vi.mock("./credential-deploy-routes.js", () => ({
  registerCredentialDeployRoutes: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Build mock db — in-memory Map-backed drizzle shape
// ---------------------------------------------------------------------------

function buildMockDb() {
  const makeSelectChain = (tableMap: Map<number, Record<string, unknown>>) => {
    let pendingWhere: unknown = null;

    const chain: Record<string, unknown> = {
      from(_table: unknown) {
        return chain;
      },
      where(pred: unknown) {
        pendingWhere = pred;
        return chain;
      },
      orderBy(_order: unknown) {
        return chain;
      },
      then(resolve: (rows: unknown[]) => void) {
        const all = Array.from(tableMap.values());
        const filtered = pendingWhere ? applyWhere(all, pendingWhere) : all;
        pendingWhere = null;
        return Promise.resolve(filtered).then(resolve);
      },
    };

    // Make it awaitable (Promise-like)
    Object.defineProperty(chain, Symbol.toStringTag, { value: "SelectChain" });
    return chain;
  };

  const makeUpdateChain = (tableMap: Map<number, Record<string, unknown>>) => {
    let pendingSet: Record<string, unknown> = {};
    let pendingWhere: unknown = null;

    const innerChain = {
      where(pred: unknown) {
        pendingWhere = pred;
        return {
          returning() {
            const all = Array.from(tableMap.values());
            const targets = pendingWhere ? applyWhere(all, pendingWhere) : all;
            for (const row of targets) {
              const patch = { ...pendingSet };
              // Handle sql fragments for usageCount: just increment numerically
              for (const [k, v] of Object.entries(patch)) {
                if (v && typeof v === "object" && (v as Record<string, unknown>).__kind === "sql") {
                  const current = row[k];
                  patch[k] = typeof current === "number" ? current + 1 : 1;
                }
              }
              Object.assign(row, patch);
            }
            pendingWhere = null;
            pendingSet = {};
            return Promise.resolve(targets);
          },
        };
      },
    };

    return {
      set(data: Record<string, unknown>) {
        pendingSet = data;
        return innerChain;
      },
    };
  };

  const makeDeleteChain = (tableMap: Map<number, Record<string, unknown>>) => {
    let pendingWhere: unknown = null;

    return {
      where(pred: unknown) {
        pendingWhere = pred;
        return {
          returning(_fields?: unknown) {
            const all = Array.from(tableMap.values());
            const targets = pendingWhere ? applyWhere(all, pendingWhere) : all;
            for (const row of targets) {
              tableMap.delete(row.id as number);
            }
            pendingWhere = null;
            return Promise.resolve(targets);
          },
        };
      },
    };
  };

  const makeInsertChain = (rows: unknown[]) => ({
    values(v: unknown) {
      return {
        returning() {
          const row = { ...(v as Record<string, unknown>), id: Date.now() };
          rows.push(row);
          return Promise.resolve([row]);
        },
      };
    },
  });

  // Schema table name mapping (used by update/delete/select dispatch)
  const tableMapFor = (table: unknown): Map<number, Record<string, unknown>> => {
    // We identify table by reference — we pass the schema objects
    // from credentials.ts. Since those are mocked in db/schema.js,
    // we match by identity via a WeakMap registered at mock time.
    return tableRegistrar.get(table as object) ?? hostsMap as unknown as Map<number, Record<string, unknown>>;
  };

  const mockDb = {
    select() {
      // Returns a proxy that defers table selection to .from()
      return {
        from(table: unknown): unknown {
          const map = tableMapFor(table);
          return makeSelectChain(map as Map<number, Record<string, unknown>>);
        },
      };
    },
    update(table: unknown) {
      const map = tableMapFor(table);
      return makeUpdateChain(map as Map<number, Record<string, unknown>>);
    },
    delete(table: unknown) {
      const map = tableMapFor(table);
      return makeDeleteChain(map as Map<number, Record<string, unknown>>);
    },
    insert(table: unknown) {
      // sshCredentialUsage rows
      void table;
      return makeInsertChain(credentialUsageRows);
    },
  };

  return mockDb;
}

// Table reference → Map registry (populated after schema mock resolves)
const tableRegistrar = new WeakMap<object, Map<number, Record<string, unknown>>>();

// ---------------------------------------------------------------------------
// Mock db/schema — minimal table shape objects (name-keyed for predicate eval)
// ---------------------------------------------------------------------------

// The drizzle-orm eq() mock captures col.name. We name our schema fields to
// match the actual column names the route uses.
const hostsTable = {
  id: { name: "id" },
  userId: { name: "userId" },
  credentialId: { name: "credentialId" },
  username: { name: "username" },
  authType: { name: "authType" },
  password: { name: "password" },
  key: { name: "key" },
  keyPassword: { name: "keyPassword" },
  keyType: { name: "keyType" },
  updatedAt: { name: "updatedAt" },
  usageCount: { name: "usageCount" },
  folder: { name: "folder" },
};

const sshCredentialsTable = {
  id: { name: "id" },
  userId: { name: "userId" },
  authType: { name: "authType" },
  username: { name: "username" },
  password: { name: "password" },
  key: { name: "key" },
  keyPassword: { name: "keyPassword" },
  usageCount: { name: "usageCount" },
  lastUsed: { name: "lastUsed" },
  updatedAt: { name: "updatedAt" },
  folder: { name: "folder" },
  name: { name: "name" },
  tags: { name: "tags" },
  description: { name: "description" },
  keyType: { name: "keyType" },
  detectedKeyType: { name: "detectedKeyType" },
  certPublicKey: { name: "certPublicKey" },
  privateKey: { name: "privateKey" },
  publicKey: { name: "publicKey" },
};

const hostAccessTable = {
  id: { name: "id" },
  hostId: { name: "hostId" },
};

const sshCredentialUsageTable = {
  credentialId: { name: "credentialId" },
  hostId: { name: "hostId" },
  userId: { name: "userId" },
};

// Register tables in the WeakMap
tableRegistrar.set(hostsTable as unknown as object, hostsMap as unknown as Map<number, Record<string, unknown>>);
tableRegistrar.set(sshCredentialsTable as unknown as object, credentialsMap as unknown as Map<number, Record<string, unknown>>);
tableRegistrar.set(hostAccessTable as unknown as object, hostAccessMap as unknown as Map<number, Record<string, unknown>>);

vi.mock("../db/schema.js", () => ({
  hosts: hostsTable,
  sshCredentials: sshCredentialsTable,
  hostAccess: hostAccessTable,
  sshCredentialUsage: sshCredentialUsageTable,
}));

// ---------------------------------------------------------------------------
// Mock db/index.js — wire up mock db + re-export DatabaseSaveTrigger
// ---------------------------------------------------------------------------

const mockDbInstance = buildMockDb();

vi.mock("../db/index.js", async () => {
  const { DatabaseSaveTrigger } = await import("../../utils/database-save-trigger.js");
  return {
    db: mockDbInstance,
    getDb: () => mockDbInstance,
    DatabaseSaveTrigger,
  };
});

// ---------------------------------------------------------------------------
// Import the router + spy AFTER mocks are declared
// ---------------------------------------------------------------------------

import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";

// Deferred router import so mocks are applied first
let credentialsRouter: express.Router;

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

function httpRequest(
  server: http.Server,
  opts: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: unknown;
  },
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : "";
    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(bodyStr).toString();
    }
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        method: opts.method,
        path: opts.path,
        headers,
      },
      (res) => {
        let data = "";
        res.on("data", (chunk: Buffer) => { data += chunk.toString(); });
        res.on("end", () => {
          let body: unknown;
          try { body = JSON.parse(data); } catch { body = data; }
          resolve({ status: res.statusCode ?? 0, body });
        });
      },
    );
    req.on("error", reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Server harness
// ---------------------------------------------------------------------------

const mockedTriggerSave = vi.mocked(DatabaseSaveTrigger.triggerSave);

let server: http.Server;

beforeEach(async () => {
  vi.clearAllMocks();
  hostsMap.clear();
  credentialsMap.clear();
  hostAccessMap.clear();
  credentialUsageRows.length = 0;

  // Lazy-import router (ensures mocks are applied before module resolves)
  if (!credentialsRouter) {
    const mod = await import("./credentials.js");
    credentialsRouter = mod.default;
  }

  const app = express();
  app.use(express.json());
  app.use("/credentials", credentialsRouter);

  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, () => resolve()));
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// T1: DELETE /credentials/:id — persist on host cred-field clear
// ---------------------------------------------------------------------------

describe("T1: DELETE /credentials/:id — DatabaseSaveTrigger.triggerSave fires on hosts update", () => {
  it("triggerSave fires with update_ssh_data when hosts using the credential are cleared", async () => {
    // Seed: credential id=42 + host using it
    credentialsMap.set(42, {
      id: 42,
      userId: "u1",
      authType: "key",
      username: "root",
      password: null,
      key: "ssh-rsa ...",
      keyPassword: null,
      usageCount: 1,
      lastUsed: null,
      updatedAt: new Date().toISOString(),
      folder: null,
      name: "test-cred",
      tags: "",
    });
    hostsMap.set(7, {
      id: 7,
      userId: "u1",
      credentialId: 42,
      username: "root",
      authType: "key",
      password: null,
      key: null,
      keyPassword: null,
      keyType: null,
      updatedAt: null,
    });

    const res = await httpRequest(server, {
      method: "DELETE",
      path: "/credentials/42",
    });

    expect(res.status).toBe(200);

    // triggerSave must have been called with update_ssh_data (Site 1 — hosts update)
    const calls = mockedTriggerSave.mock.calls.map((c) => c[0]);
    expect(calls).toContain("update_ssh_data");

    // Behavior preservation: hosts row now has credentialId: null
    const hostRow = hostsMap.get(7);
    expect(hostRow?.credentialId).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T2: POST /:id/apply-to-host/:hostId — persist on hosts write AND usage bump
// ---------------------------------------------------------------------------

describe("T2: POST /:id/apply-to-host/:hostId — triggerSave fires for both writes", () => {
  it("triggerSave fires with update_ssh_data (Site 2) AND update_ssh_credentials (Site 3)", async () => {
    // Seed: credential id=42, host id=7
    credentialsMap.set(42, {
      id: 42,
      userId: "u1",
      authType: "key",
      username: "root",
      password: null,
      key: "ssh-rsa ...",
      keyPassword: null,
      usageCount: 3,
      lastUsed: null,
      updatedAt: new Date().toISOString(),
      folder: null,
      name: "test-cred",
      tags: "",
    });
    hostsMap.set(7, {
      id: 7,
      userId: "u1",
      credentialId: null,
      username: null,
      authType: "password",
      password: "oldpass",
      key: null,
      keyPassword: null,
      keyType: null,
      updatedAt: null,
    });

    const res = await httpRequest(server, {
      method: "POST",
      path: "/credentials/42/apply-to-host/7",
    });

    expect(res.status).toBe(200);

    const calls = mockedTriggerSave.mock.calls.map((c) => c[0]);

    // Site 2 — hosts row update
    expect(calls).toContain("update_ssh_data");
    // Site 3 — sshCredentials usage-count bump
    expect(calls).toContain("update_ssh_credentials");

    // Behavior preservation: host now linked to credential 42
    const hostRow = hostsMap.get(7);
    expect(hostRow?.credentialId).toBe(42);
    expect(hostRow?.authType).toBe("key");
  });
});

// ---------------------------------------------------------------------------
// T3: PUT /folders/rename — persist on bulk folder rename
// ---------------------------------------------------------------------------

describe("T3: PUT /credentials/folders/rename — triggerSave fires with update_ssh_credentials", () => {
  it("triggerSave fires and only matching-folder rows are renamed", async () => {
    // Seed: 3 credentials — 2 in folder "old", 1 in "other"
    credentialsMap.set(1, {
      id: 1,
      userId: "u1",
      authType: "key",
      username: null,
      password: null,
      key: null,
      keyPassword: null,
      usageCount: 0,
      lastUsed: null,
      updatedAt: new Date().toISOString(),
      folder: "old",
      name: "cred-1",
      tags: "",
    });
    credentialsMap.set(2, {
      id: 2,
      userId: "u1",
      authType: "password",
      username: null,
      password: null,
      key: null,
      keyPassword: null,
      usageCount: 0,
      lastUsed: null,
      updatedAt: new Date().toISOString(),
      folder: "old",
      name: "cred-2",
      tags: "",
    });
    credentialsMap.set(3, {
      id: 3,
      userId: "u1",
      authType: "password",
      username: null,
      password: null,
      key: null,
      keyPassword: null,
      usageCount: 0,
      lastUsed: null,
      updatedAt: new Date().toISOString(),
      folder: "other",
      name: "cred-3",
      tags: "",
    });

    const res = await httpRequest(server, {
      method: "PUT",
      path: "/credentials/folders/rename",
      body: { oldName: "old", newName: "new" },
    });

    expect(res.status).toBe(200);

    // triggerSave fires for Site 4 (sshCredentials update)
    const calls = mockedTriggerSave.mock.calls.map((c) => c[0]);
    expect(calls).toContain("update_ssh_credentials");

    // Only "old" → "new", "other" untouched
    expect(credentialsMap.get(1)?.folder).toBe("new");
    expect(credentialsMap.get(2)?.folder).toBe("new");
    expect(credentialsMap.get(3)?.folder).toBe("other");
  });
});

// ---------------------------------------------------------------------------
// T4: Source-string invariant — no raw db.update() remains in credentials.ts
// ---------------------------------------------------------------------------

describe("T4: Source-string invariant — credentials.ts has no raw db.update() calls", () => {
  it("grep gate: credentials.ts must not contain db.update(", () => {
    const src = fs.readFileSync(
      "src/backend/database/routes/credentials.ts",
      "utf8",
    );
    expect(src).not.toMatch(/\bdb\.update\(/);
  });
});
