/**
 * server-substrate-integration.test.ts — End-to-end integration test suite
 * for the composed server-substrate wire-up. Phase 75 Plan 09.
 *
 * PURPOSE:
 *   Unit tests in 75-02 / 75-03 / 75-06 tested each module in isolation with
 *   mocked collaborators. This suite wires the real modules together (mocks
 *   pushed OUT to the DB/SSH/filesystem boundary only) and validates the four
 *   load-bearing behaviors from D-17 and D-18:
 *
 *     I-STARTUP  (D-17): startup pass enumerates all hosts serially, marks successes done,
 *                        leaves failures for retry.
 *     I-RETRY    (D-17): 30s tick re-sweeps failed hosts, skips already-succeeded hosts.
 *     I-PERSISTENT (D-06 / D-17): loud alert fires exactly ONCE when a host fails N times.
 *     I-ON-ADD   (D-18): POST /host/db/host with runsFleetSubstrate:true fires sweepOneHost
 *                        via the REAL singleton; response does not block.
 *
 * REAL CODE PATHS (not mocked here):
 *   - createServerSubstrateOrchestrator  (server-substrate-orchestrator.ts)
 *   - listSubstrateHosts                 (list-substrate-hosts.ts)
 *   - runSweepForHost                    (run-sweep.ts)
 *   - runBootstrapForHost                (run-bootstrap.ts)
 *   - decideItemAction / computeInstallMode  (sweep-logic.ts)
 *   - logSweepHookError / logPersistentFailure / logSweepResult  (log-tags.ts)
 *   - setSubstrateOrchestrator / getSubstrateOrchestrator / __resetSubstrateOrchestrator
 *                                        (substrate-orchestrator-singleton.ts)
 *
 * MOCKED SURFACE (outermost I/O boundary only):
 *   - ../utils/logger.js         — suppress output noise; assert on log calls
 *   - ../utils/system-crypto.js  — inject fake CSKEK Buffer
 *   - ../utils/field-crypto.js   — return canned plaintext; avoid real AES
 *   - ./bundled-reader.js        — return { bytes, mode } without touching disk
 *   (No mock for run-sweep.js or log-tags.js — they are under test)
 *
 * EXEC MOCK SENTINEL CONTRACT:
 *   The channel.exec mock must return the exact sentinels expected by each caller:
 *   - run-bootstrap is-enabled check: string ending "EXIT:0"
 *   - run-bootstrap daemon-reload: string ending "__RELOAD_OK__"
 *   - run-bootstrap settings patch: string ending "__SETTINGS_OK__"
 *   - run-bootstrap cleanup: string ending "__CLEANUP_OK__"
 *   - ssh-push readInstalledBytes: string ending "__READ_ENOENT__" (file absent)
 *     IMPORTANT: must NOT return an unknown shape — that triggers
 *     retryOnTransport with setTimeout(200ms) which fake timers block.
 *   - ssh-push writeInstalledBytesWithMode: string ending "__WRITE_OK__"
 *   - ssh-push restartUserUnit: string ending "__RESTART_OK__"
 *
 * FOR I-ON-ADD: the host.ts router is imported real (with its own mock scaffold
 *   for auth/db/multer/etc.) but the substrate-orchestrator-singleton.js is NOT
 *   mocked in this file, so the real singleton state is exercised.
 */
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  beforeAll,
} from "vitest";

// ---------------------------------------------------------------------------
// Module-level mocks — hoisted before all imports
// ---------------------------------------------------------------------------

// Logger — suppress noise, allow assertion on calls
vi.mock("../utils/logger.js", () => ({
  systemLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  databaseLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
  sshLogger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  },
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

// System crypto — inject a deterministic fake CSKEK
const FAKE_CSKEK = Buffer.from("00".repeat(32), "hex");
vi.mock("../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: vi.fn(() => ({
      getCredentialSharingKey: vi.fn(async () => FAKE_CSKEK),
    })),
  },
}));

// Field crypto — return deterministic plaintext for any ciphertext
vi.mock("../utils/field-crypto.js", () => ({
  FieldCrypto: {
    decryptField: vi.fn(
      (_ct: string, _key: Buffer, id: string, field: string) =>
        `plaintext-${field}-${id}`,
    ),
    encryptField: vi.fn(
      (plain: string, _key: Buffer, id: string, field: string) =>
        `encrypted-${field}-${id}:${plain}`,
    ),
  },
}));

// Bundled-reader — return known bytes without touching disk
vi.mock("./bundled-reader.js", () => ({
  bundledReaderFromDisk: vi.fn(async (_path: string) => ({
    bytes: Buffer.from("test-substrate-bytes"),
    mode: 0o644,
  })),
}));

// ---------------------------------------------------------------------------
// Mocks needed only for the I-ON-ADD route-invocation harness
// (mirrors the scaffold in host.test.ts)
// ---------------------------------------------------------------------------

vi.mock("../database/db/index.js", () => {
  const selectChain = {
    from: vi.fn(() => selectChain),
    where: vi.fn(() => selectChain),
    limit: vi.fn(() => Promise.resolve([])),
  };
  return {
    db: {
      select: vi.fn(() => selectChain),
      delete: vi.fn(() => ({ where: vi.fn(() => Promise.resolve()) })),
    },
    DatabaseSaveTrigger: { forceSave: vi.fn(async () => {}) },
    getDb: vi.fn(() => ({ select: vi.fn(() => selectChain) })),
  };
});

vi.mock("../utils/simple-db-ops.js", () => ({
  SimpleDBOps: {
    insert: vi.fn(async () => ({
      id: 777,
      userId: "user-1",
      ip: "10.0.0.99",
      port: 22,
      name: "integration-host",
      connectionType: "ssh",
      runsFleetSubstrate: true,
      credentialId: 999,
      authType: "password",
    })),
    update: vi.fn(async () => {}),
    select: vi.fn(async () => [
      {
        id: 777,
        userId: "user-1",
        ip: "10.0.0.99",
        port: 22,
        name: "integration-host",
        connectionType: "ssh",
        runsFleetSubstrate: true,
        credentialId: 999,
        authType: "password",
      },
    ]),
  },
}));

const passthroughMiddleware = (
  _req: unknown,
  _res: unknown,
  next: () => void,
) => next();

vi.mock("../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: vi.fn(() => ({
      verifyToken: vi.fn(async () => ({ userId: "user-1", valid: true })),
      createAuthMiddleware: vi.fn(() => passthroughMiddleware),
      createDataAccessMiddleware: vi.fn(() => passthroughMiddleware),
    })),
  },
}));

vi.mock("../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: vi.fn(() => ({
      canAccessHost: vi.fn(async () => ({ hasAccess: true, isOwner: true })),
    })),
  },
}));

vi.mock("../utils/data-crypto.js", () => ({
  DataCrypto: {
    getUserDataKey: vi.fn(async () => Buffer.from("a".repeat(32))),
  },
}));

vi.mock("../ssh/host-resolver.js", () => ({
  resolveHostById: vi.fn(async () => null),
  resolveHostCredentials: vi.fn(async (host: unknown) => host),
}));

vi.mock("../utils/ssh-key-utils.js", () => ({
  parseSSHKey: vi.fn(() => ({ success: true })),
}));

vi.mock("../database/routes/host-normalizers.js", () => ({
  isNonEmptyString: (v: unknown) => typeof v === "string" && v.length > 0,
  isValidPort: (v: unknown) =>
    typeof v === "number" && v > 0 && v <= 65535,
  stripSensitiveFields: (h: unknown) => h,
  transformHostResponse: (h: unknown) => h,
}));

vi.mock("../database/routes/host-opkssh-routes.js", () => ({
  registerHostOpksshRoutes: vi.fn(),
}));
vi.mock("../database/routes/host-folder-routes.js", () => ({
  registerHostFolderRoutes: vi.fn(),
}));
vi.mock("../database/routes/host-file-manager-bookmark-routes.js", () => ({
  registerHostFileManagerBookmarkRoutes: vi.fn(),
}));
vi.mock("../database/routes/host-command-history-routes.js", () => ({
  registerHostCommandHistoryRoutes: vi.fn(),
}));
vi.mock("../database/routes/host-autostart-routes.js", () => ({
  registerHostAutostartRoutes: vi.fn(),
}));
vi.mock("../database/routes/host-internal-routes.js", () => ({
  registerHostInternalRoutes: vi.fn(),
}));
vi.mock("../database/routes/host-network-routes.js", () => ({
  registerHostNetworkRoutes: vi.fn(),
}));
vi.mock("../database/routes/host-bulk-routes.js", () => ({
  registerHostBulkRoutes: vi.fn(),
}));

vi.mock("../ssh/ssh-one-shot.js", () => ({
  connectOneShot: vi.fn(async () => null),
}));
vi.mock("../ssh/tmux-helper.js", () => ({
  execCommand: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
}));
vi.mock("axios", () => ({
  default: {
    post: vi.fn(async () => ({ data: {} })),
    get: vi.fn(async () => ({ data: {} })),
  },
}));
vi.mock("multer", () => {
  const multerFn = () => ({
    single: () =>
      (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
    array: () =>
      (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
    fields: () =>
      (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
    none: () =>
      (_req: unknown, _res: unknown, next: (err?: unknown) => void) => next(),
  });
  (multerFn as unknown as { memoryStorage: () => unknown }).memoryStorage = () =>
    ({});
  return { default: multerFn };
});

vi.mock("../utils/stats-monitor.js", () => ({
  notifyStatsHostUpdated: vi.fn(),
}));

// NOTE: substrate-orchestrator-singleton.js is intentionally NOT mocked here.
// The I-ON-ADD test exercises the REAL singleton state — that is the whole point.

// ---------------------------------------------------------------------------
// Imports — after vi.mock declarations so mocks are in place
// ---------------------------------------------------------------------------

import { createServerSubstrateOrchestrator } from "./server-substrate-orchestrator.js";
import { listSubstrateHosts } from "./list-substrate-hosts.js";
import {
  setSubstrateOrchestrator,
  getSubstrateOrchestrator,
  __resetSubstrateOrchestrator,
} from "./substrate-orchestrator-singleton.js";
import { systemLogger } from "../utils/logger.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";

// ---------------------------------------------------------------------------
// Stub DB helpers — mirrors list-substrate-hosts.test.ts
// ---------------------------------------------------------------------------

type MockRow = {
  id: number;
  name: string | null;
  credentialId: number | null;
  ip: string;
  port: number;
  username: string;
  authType: string;
  cred_id: number | null;
  cred_userId: string | null;
  cred_systemPassword: string | null;
  cred_systemKey: string | null;
  cred_systemKeyPassword: string | null;
  cred_keyType: string | null;
  cred_username: string | null;
};

function makeRow(overrides: Partial<MockRow> = {}): MockRow {
  return {
    id: 1,
    name: "host-one",
    credentialId: 10,
    ip: "10.0.0.1",
    port: 22,
    username: "root",
    authType: "password",
    cred_id: 10,
    cred_userId: "user-abc",
    cred_systemPassword:
      '{"data":"aabbcc","iv":"deadbeef","tag":"cafecafe","salt":"11223344","recordId":"10"}',
    cred_systemKey: null,
    cred_systemKeyPassword: null,
    cred_keyType: null,
    cred_username: null,
    ...overrides,
  };
}

/**
 * Build a minimal stubbed drizzle-like chain.
 * Simulates: db.select({...}).from(hosts).leftJoin(sshCreds, ...).where(...) -> rows
 */
function makeDb(rows: MockRow[]): { getDb: () => unknown } {
  const whereStub = vi.fn(() => Promise.resolve(rows));
  const leftJoinStub = vi.fn(() => ({ where: whereStub }));
  const fromStub = vi.fn(() => ({ leftJoin: leftJoinStub }));
  const selectStub = vi.fn(() => ({ from: fromStub }));
  const db = { select: selectStub };
  return { getDb: () => db };
}

/**
 * Build a mock SshChannel whose exec() returns sentinel strings that satisfy
 * all callers in run-bootstrap.ts and ssh-push.ts.
 *
 * SENTINEL CONTRACT — each caller checks the END of the returned string:
 *
 *   run-bootstrap.ts step 1 (is-enabled check):
 *     cmd contains "is-enabled" and "EXIT:$?"
 *     needs: string ending with "EXIT:0" (alreadyEnabled path, skips linger+enable)
 *
 *   run-bootstrap.ts step 1 (daemon-reload after is-enabled=true):
 *     cmd contains "daemon-reload" and "__RELOAD_OK__"
 *     needs: string ending with "__RELOAD_OK__"
 *
 *   run-bootstrap.ts step 2 (settings.json patch):
 *     cmd contains "__SETTINGS_OK__"
 *     needs: string ending with "__SETTINGS_OK__"
 *
 *   run-bootstrap.ts step 3 (gsd-context-monitor cleanup):
 *     cmd contains "__CLEANUP_OK__"
 *     needs: string ending with "__CLEANUP_OK__"
 *
 *   ssh-push.ts readInstalledBytes:
 *     cmd contains "__READ_OK__" or "__READ_ENOENT__"
 *     returning "__READ_ENOENT__" means file absent (first-install)
 *     CRITICAL: any other return triggers "transport" path in retryOnTransport
 *     with setTimeout(200ms) which is blocked by fake timers -> timeout.
 *
 *   ssh-push.ts writeInstalledBytesWithMode:
 *     cmd contains "__WRITE_OK__" or "__WRITE_FAIL__"
 *     needs: string ending with "__WRITE_OK__"
 *
 *   ssh-push.ts restartUserUnit:
 *     cmd contains "__RESTART_OK__" or "__RESTART_FAIL__"
 *     needs: string ending with "__RESTART_OK__"
 */
function makeSuccessChannel(): SshChannel {
  return {
    exec: vi.fn(async (cmd: string): Promise<string | null> => {
      // run-bootstrap Step 1: is-enabled check with EXIT:$? sentinel
      if (cmd.includes("is-enabled") && cmd.includes("EXIT:$?")) {
        return "enabled\nEXIT:0";
      }
      // run-bootstrap Step 1: unconditional daemon-reload sentinel
      if (cmd.includes("__RELOAD_OK__")) {
        return "__RELOAD_OK__";
      }
      // run-bootstrap Step 1: linger+enable sequence (only when not already enabled)
      if (cmd.includes("__BOOTSTRAP_OK__")) {
        return "__BOOTSTRAP_OK__";
      }
      // run-bootstrap Step 2: settings.json patch
      if (cmd.includes("__SETTINGS_OK__")) {
        return "__SETTINGS_OK__";
      }
      // run-bootstrap Step 3: gsd-context-monitor cleanup
      if (cmd.includes("__CLEANUP_OK__")) {
        return "__CLEANUP_OK__";
      }
      // ssh-push readInstalledBytes:
      // Returns "__READ_ENOENT__" so bytes===null (file absent, first-install path).
      // readOk:true -> NOT transient -> retryOnTransport exits immediately (no setTimeout).
      if (cmd.includes("__READ_OK__") || cmd.includes("__READ_ENOENT__")) {
        return "__READ_ENOENT__";
      }
      // ssh-push writeInstalledBytesWithMode: heredoc write + chmod
      if (cmd.includes("__WRITE_OK__") || cmd.includes("__WRITE_FAIL__")) {
        return "__WRITE_OK__";
      }
      // ssh-push restartUserUnit: systemctl --user restart <unit>
      if (cmd.includes("__RESTART_OK__") || cmd.includes("__RESTART_FAIL__")) {
        return "__RESTART_OK__";
      }
      // Safety fallback: return non-null empty string.
      // If a new exec path is added that checks a specific sentinel and we
      // return "" here, it may result in an error-logged path (not a timeout).
      return "";
    }),
  };
}

/**
 * Build a null channel — simulates unreachable host.
 * The orchestrator treats acquireChannel returning null as a sweep failure.
 */
function makeNullChannel(): null {
  return null;
}

// ---------------------------------------------------------------------------
// POST route handler extraction for I-ON-ADD
// ---------------------------------------------------------------------------

let postHandler:
  | ((req: unknown, res: unknown) => Promise<void>)
  | null = null;

async function loadHostPostHandler() {
  const mod = await import("../database/routes/host.js");
  const router = mod.default;
  for (const layer of (
    router as unknown as {
      stack: {
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ handle: unknown }>;
        };
      }[];
    }
  ).stack) {
    if (!layer.route) continue;
    const route = layer.route;
    if (route.path === "/db/host" && route.methods["post"]) {
      const handlers = route.stack.map((h) => h.handle);
      postHandler = handlers[handlers.length - 1] as typeof postHandler;
      break;
    }
  }
}

function makePostReq(body: Record<string, unknown>, userId = "user-1") {
  return {
    userId,
    body,
    file: undefined,
    headers: {},
    params: {},
    query: {},
  };
}

function makeMockRes() {
  const res = {
    _status: 200 as number,
    _body: null as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return res;
}

// Load the route handler once before any tests
beforeAll(async () => {
  await loadHostPostHandler();
}, 60_000);

// ---------------------------------------------------------------------------
// Suite setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  __resetSubstrateOrchestrator();

  // Restore CSKEK mock after clearAllMocks
  (SystemCrypto.getInstance as ReturnType<typeof vi.fn>).mockReturnValue({
    getCredentialSharingKey: vi.fn(async () => FAKE_CSKEK),
  });

  // Restore FieldCrypto mock after clearAllMocks
  (FieldCrypto.decryptField as ReturnType<typeof vi.fn>).mockImplementation(
    (_ct: string, _key: Buffer, id: string, field: string) =>
      `plaintext-${field}-${id}`,
  );
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Integration test suite
// ---------------------------------------------------------------------------

describe("Phase 75 — server-substrate integration", () => {
  // -------------------------------------------------------------------------
  // I-STARTUP (D-17): startup pass end-to-end
  // -------------------------------------------------------------------------

  describe("I-STARTUP (D-17): startup pass end-to-end", () => {
    it("walks all 3 fixture substrate hosts serially and marks each done on clean sweep", async () => {
      // 3 fixture hosts in the stubbed DB
      const rows = [
        makeRow({
          id: 1,
          name: "host1",
          credentialId: 100,
          cred_id: 100,
          cred_systemPassword: "ct1",
        }),
        makeRow({
          id: 2,
          name: "host2",
          credentialId: 101,
          cred_id: 101,
          cred_systemPassword: "ct2",
        }),
        makeRow({
          id: 3,
          name: "host3",
          credentialId: 102,
          cred_id: 102,
          cred_systemPassword: "ct3",
        }),
      ];
      const stubDb = makeDb(rows);

      const acquireCallOrder: number[] = [];
      const acquireChannel = vi.fn(async (host: { id: string }) => {
        acquireCallOrder.push(parseInt(host.id, 10));
        return makeSuccessChannel();
      });

      const orch = createServerSubstrateOrchestrator({
        listSubstrateHosts: () =>
          listSubstrateHosts(
            stubDb as Parameters<typeof listSubstrateHosts>[0],
          ),
        acquireChannel,
        releaseChannel: vi.fn(),
        setInterval,
        clearInterval,
        now: () => Date.now(),
        retryIntervalMs: 30000,
        persistentFailureThreshold: 3,
      });

      // start() is the startup pass — awaited, serial
      await orch.start();
      await Promise.resolve();
      await Promise.resolve();

      // All 3 hosts should have had acquireChannel called
      expect(acquireChannel).toHaveBeenCalledTimes(3);

      // Serial order — hosts swept in the order returned by listSubstrateHosts
      expect(acquireCallOrder).toEqual([1, 2, 3]);

      // sweepTickCount incremented for the startup pass
      expect(orch.getSweepTickCount()).toBe(1);

      orch.stop();
    });

    it("startup pass with password-auth and key-auth hosts succeeds for both", async () => {
      const rows = [
        makeRow({
          id: 10,
          name: "pw-host",
          credentialId: 200,
          cred_id: 200,
          cred_systemPassword: "ct-pw",
          cred_systemKey: null,
        }),
        makeRow({
          id: 11,
          name: "key-host",
          credentialId: 201,
          cred_id: 201,
          cred_systemPassword: null,
          cred_systemKey: "ct-key",
        }),
      ];
      const stubDb = makeDb(rows);
      const acquireChannel = vi.fn(async () => makeSuccessChannel());

      const orch = createServerSubstrateOrchestrator({
        listSubstrateHosts: () =>
          listSubstrateHosts(
            stubDb as Parameters<typeof listSubstrateHosts>[0],
          ),
        acquireChannel,
        releaseChannel: vi.fn(),
        setInterval,
        clearInterval,
        now: () => Date.now(),
        retryIntervalMs: 30000,
        persistentFailureThreshold: 3,
      });

      await orch.start();
      await Promise.resolve();

      expect(acquireChannel).toHaveBeenCalledTimes(2);
      expect(orch.getSweepTickCount()).toBe(1);

      orch.stop();
    });
  });

  // -------------------------------------------------------------------------
  // I-RETRY (D-17): retry loop picks up failures, skips successes
  // -------------------------------------------------------------------------

  describe("I-RETRY (D-17): 30s retry tick re-sweeps failed hosts, skips succeeded hosts", () => {
    it("30s tick re-sweeps failed host, skips already-succeeded host", async () => {
      // 2 hosts: host 1 succeeds, host 2 fails (acquireChannel returns null)
      const rows = [
        makeRow({
          id: 1,
          name: "ok-host",
          credentialId: 100,
          cred_id: 100,
          cred_systemPassword: "ct1",
        }),
        makeRow({
          id: 2,
          name: "fail-host",
          credentialId: 101,
          cred_id: 101,
          cred_systemPassword: "ct2",
        }),
      ];
      const stubDb = makeDb(rows);

      const acquireCallsPerHost = new Map<string, number>();
      const acquireChannel = vi.fn(async (host: { id: string }) => {
        const prev = acquireCallsPerHost.get(host.id) ?? 0;
        acquireCallsPerHost.set(host.id, prev + 1);
        if (host.id === "2") return makeNullChannel(); // always fail
        return makeSuccessChannel();
      });

      // Capture the retry interval callback for manual firing
      let capturedTickFn: (() => Promise<void> | void) | null = null;
      const setIntervalMock = vi.fn(
        (fn: () => Promise<void> | void, _ms: number) => {
          capturedTickFn = fn;
          return 1 as unknown as ReturnType<typeof setInterval>;
        },
      );
      const clearIntervalMock = vi.fn();

      const orch = createServerSubstrateOrchestrator({
        listSubstrateHosts: () =>
          listSubstrateHosts(
            stubDb as Parameters<typeof listSubstrateHosts>[0],
          ),
        acquireChannel,
        releaseChannel: vi.fn(),
        setInterval: setIntervalMock,
        clearInterval: clearIntervalMock,
        now: () => Date.now(),
        retryIntervalMs: 30000,
        persistentFailureThreshold: 10, // high threshold so no alert fires
      });

      // Startup pass: host 1 succeeds (marked done), host 2 fails
      await orch.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(acquireCallsPerHost.get("1")).toBe(1);
      expect(acquireCallsPerHost.get("2")).toBe(1);
      expect(orch.getSweepTickCount()).toBe(1);

      // Fire the 30s retry tick manually
      expect(capturedTickFn).not.toBeNull();
      await capturedTickFn!();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // host 1 stays at 1 (already marked done — NOT re-swept)
      expect(acquireCallsPerHost.get("1")).toBe(1);
      // host 2 gets another attempt (still failing)
      expect(acquireCallsPerHost.get("2")).toBe(2);
      // tick count advanced
      expect(orch.getSweepTickCount()).toBe(2);

      orch.stop();
    });
  });

  // -------------------------------------------------------------------------
  // I-PERSISTENT (D-06): loud alert fires exactly once at N failures
  // -------------------------------------------------------------------------

  describe("I-PERSISTENT (D-06 / D-17): loud alert fires once at N consecutive failures", () => {
    it("3 consecutive failures -> logPersistentFailure fires once; 4th failure does not re-alert", async () => {
      const rows = [
        makeRow({
          id: 1,
          name: "h1",
          credentialId: 100,
          cred_id: 100,
          cred_systemPassword: "ct1",
        }),
      ];
      const stubDb = makeDb(rows);

      // acquireChannel always returns null -> channel acquire failure = sweep failure
      const acquireChannel = vi.fn(async () => makeNullChannel());

      let capturedTickFn: (() => Promise<void> | void) | null = null;
      const setIntervalMock = vi.fn(
        (fn: () => Promise<void> | void, _ms: number) => {
          capturedTickFn = fn;
          return 1 as unknown as ReturnType<typeof setInterval>;
        },
      );

      const orch = createServerSubstrateOrchestrator({
        listSubstrateHosts: () =>
          listSubstrateHosts(
            stubDb as Parameters<typeof listSubstrateHosts>[0],
          ),
        acquireChannel,
        releaseChannel: vi.fn(),
        setInterval: setIntervalMock,
        clearInterval: vi.fn(),
        now: () => Date.now(),
        retryIntervalMs: 30000,
        persistentFailureThreshold: 3,
      });

      // Startup pass: failure #1
      await orch.start();
      await Promise.resolve();

      // Tick 1: failure #2
      await capturedTickFn!();
      await Promise.resolve();
      await Promise.resolve();

      // Tick 2: failure #3 -> alert fires
      await capturedTickFn!();
      await Promise.resolve();
      await Promise.resolve();

      // Assert: logPersistentFailure (via systemLogger.warn) fired exactly once
      const warnMock = systemLogger.warn as ReturnType<typeof vi.fn>;
      const persistentCalls = warnMock.mock.calls.filter(
        (call: unknown[]) =>
          (call[1] as Record<string, unknown>)?.operation ===
          "fleet_substrate_host_persistent_failure",
      );
      expect(persistentCalls.length).toBe(1);
      expect(
        (persistentCalls[0][1] as Record<string, unknown>).consecutiveFailures,
      ).toBe(3);
      expect(
        (persistentCalls[0][1] as Record<string, unknown>).hostName,
      ).toBe("h1");

      // Tick 3: failure #4 — should NOT re-alert
      await capturedTickFn!();
      await Promise.resolve();
      await Promise.resolve();

      const persistentCallsAfter = warnMock.mock.calls.filter(
        (call: unknown[]) =>
          (call[1] as Record<string, unknown>)?.operation ===
          "fleet_substrate_host_persistent_failure",
      );
      expect(persistentCallsAfter.length).toBe(1); // still 1, not 2

      orch.stop();
    });

    it("two hosts each failing 3 times -> logPersistentFailure fires twice (once per host)", async () => {
      const rows = [
        makeRow({
          id: 1,
          name: "h1",
          credentialId: 100,
          cred_id: 100,
          cred_systemPassword: "ct1",
        }),
        makeRow({
          id: 2,
          name: "h2",
          credentialId: 101,
          cred_id: 101,
          cred_systemPassword: "ct2",
        }),
      ];
      const stubDb = makeDb(rows);

      const acquireChannel = vi.fn(async () => makeNullChannel());

      let capturedTickFn: (() => Promise<void> | void) | null = null;
      const setIntervalMock = vi.fn(
        (fn: () => Promise<void> | void, _ms: number) => {
          capturedTickFn = fn;
          return 1 as unknown as ReturnType<typeof setInterval>;
        },
      );

      const orch = createServerSubstrateOrchestrator({
        listSubstrateHosts: () =>
          listSubstrateHosts(
            stubDb as Parameters<typeof listSubstrateHosts>[0],
          ),
        acquireChannel,
        releaseChannel: vi.fn(),
        setInterval: setIntervalMock,
        clearInterval: vi.fn(),
        now: () => Date.now(),
        retryIntervalMs: 30000,
        persistentFailureThreshold: 3,
      });

      await orch.start();
      await Promise.resolve();

      await capturedTickFn!();
      await Promise.resolve();
      await Promise.resolve();

      await capturedTickFn!();
      await Promise.resolve();
      await Promise.resolve();

      // Both hosts hit threshold on tick 2
      const warnMock = systemLogger.warn as ReturnType<typeof vi.fn>;
      const persistentCalls = warnMock.mock.calls.filter(
        (call: unknown[]) =>
          (call[1] as Record<string, unknown>)?.operation ===
          "fleet_substrate_host_persistent_failure",
      );
      expect(persistentCalls.length).toBe(2);

      const firedForHostIds = persistentCalls.map(
        (c: unknown[]) =>
          (c[1] as Record<string, unknown>).fleetHostId,
      );
      expect(firedForHostIds).toContain("1");
      expect(firedForHostIds).toContain("2");

      orch.stop();
    });
  });

  // -------------------------------------------------------------------------
  // I-ON-ADD (D-18): POST route -> real singleton -> real orchestrator
  // -------------------------------------------------------------------------

  describe("I-ON-ADD (D-18): POST /db/host -> real singleton -> real orchestrator -> real sweepOneHost", () => {
    it("POST with runsFleetSubstrate:true fires sweep via real singleton, response does not block", async () => {
      // Build a real orchestrator with a slow acquireChannel (500ms fake-timer setTimeout)
      const rows = [
        makeRow({
          id: 777,
          name: "integration-host",
          credentialId: 999,
          cred_id: 999,
          cred_systemPassword: "ct-integration",
        }),
      ];
      const stubDb = makeDb(rows);

      let sweepCompleted = false;

      // acquireChannel is "slow" via setTimeout(500) — blocked by fake timers.
      // This means sweepOneHost starts (listSubstrateHosts is called, acquireChannel
      // is called) but the 500ms wait never resolves unless we advance fake timers.
      const acquireChannel = vi.fn(async (_host: { id: string }) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
        sweepCompleted = true;
        return makeSuccessChannel();
      });

      const orch = createServerSubstrateOrchestrator({
        listSubstrateHosts: () =>
          listSubstrateHosts(
            stubDb as Parameters<typeof listSubstrateHosts>[0],
          ),
        acquireChannel,
        releaseChannel: vi.fn(),
        setInterval,
        clearInterval,
        now: () => Date.now(),
        retryIntervalMs: 30000,
        persistentFailureThreshold: 3,
      });

      // Register in the REAL singleton — this is what the route handler reads
      setSubstrateOrchestrator(orch);

      // Verify the singleton round-trip
      expect(getSubstrateOrchestrator()).toBe(orch);

      // Invoke the POST handler
      const req = makePostReq({
        ip: "10.0.0.99",
        port: 22,
        runsFleetSubstrate: true,
        credentialId: 999,
        name: "integration-host",
        connectionType: "ssh",
      });
      const res = makeMockRes();

      const startTime = Date.now();
      await postHandler!(req, res);
      const elapsed = Date.now() - startTime;

      // Response resolves fast — sweep is async (500ms via setTimeout which
      // is blocked by fake timers, so it never fires during postHandler await)
      expect(res._status).toBe(200);
      // Elapsed is near 0 in fake-timer mode
      expect(elapsed).toBeLessThan(100);

      // Drain microtasks:
      //   - postHandler queueMicrotask fires sweepOneHost
      //   - sweepOneHost calls listSubstrateHosts (async), then queueMicrotask
      //   - that microtask calls executeSweeForHost -> acquireChannel
      //   - acquireChannel's setTimeout(500) is BLOCKED by fake timers
      // After draining microtasks, acquireChannel should have been called once.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      // acquireChannel was called with host id "777"
      expect(acquireChannel).toHaveBeenCalledTimes(1);
      expect(acquireChannel.mock.calls[0][0].id).toBe("777");

      // Sweep not yet complete (fake timer blocks the 500ms setTimeout)
      expect(sweepCompleted).toBe(false);

      orch.stop();
    });

    it("singleton round-trip: setSubstrateOrchestrator then getSubstrateOrchestrator returns same instance", () => {
      const mockOrch = {
        start: vi.fn(),
        stop: vi.fn(),
        sweepOneHost: vi.fn(),
        getSweepTickCount: vi.fn(() => 0),
      };

      setSubstrateOrchestrator(mockOrch);
      const retrieved = getSubstrateOrchestrator();

      expect(retrieved).toBe(mockOrch);
    });

    it("POST with runsFleetSubstrate:false does NOT trigger sweepOneHost on the real orchestrator", async () => {
      const rows = [
        makeRow({
          id: 888,
          name: "non-substrate-host",
          credentialId: 999,
          cred_id: 999,
          cred_systemPassword: "ct-nonsub",
        }),
      ];
      const stubDb = makeDb(rows);

      const acquireChannel = vi.fn(async () => makeSuccessChannel());

      const orch = createServerSubstrateOrchestrator({
        listSubstrateHosts: () =>
          listSubstrateHosts(
            stubDb as Parameters<typeof listSubstrateHosts>[0],
          ),
        acquireChannel,
        releaseChannel: vi.fn(),
        setInterval,
        clearInterval,
        now: () => Date.now(),
        retryIntervalMs: 30000,
        persistentFailureThreshold: 3,
      });
      setSubstrateOrchestrator(orch);

      // SimpleDBOps.insert returns runsFleetSubstrate:false
      const { SimpleDBOps } = await import("../utils/simple-db-ops.js");
      (SimpleDBOps.insert as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        id: 888,
        userId: "user-1",
        ip: "10.0.0.88",
        port: 22,
        name: "non-substrate-host",
        connectionType: "ssh",
        runsFleetSubstrate: false,
        credentialId: 999,
        authType: "password",
      });

      const req = makePostReq({
        ip: "10.0.0.88",
        port: 22,
        runsFleetSubstrate: false,
        credentialId: 999,
        name: "non-substrate-host",
        connectionType: "ssh",
      });
      const res = makeMockRes();

      await postHandler!(req, res);
      await Promise.resolve();
      await Promise.resolve();

      // No acquireChannel call — not a substrate host
      expect(acquireChannel).not.toHaveBeenCalled();

      orch.stop();
    });
  });
});
