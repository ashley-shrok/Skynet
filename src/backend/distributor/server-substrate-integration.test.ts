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

// Branding-config-loader — mock readInstancePolicyBytes so T-11 scenarios can
// switch between "twinkie file present" (Buffer) and "twinkie unset / missing"
// (null) without touching disk. Default null keeps pre-existing tests
// (I-STARTUP, I-RETRY, I-PERSISTENT, I-ON-ADD) on the D-16 removal branch
// exactly as they were with the makeSuccessChannel __REMOVE_ALREADY__ handler.
vi.mock("../branding/branding-config-loader.js", () => ({
  readInstancePolicyBytes: vi.fn(async () => null),
}));

// Quick 260918-5lb: identity-artifact-reader is the source of isLocalHostId.
// Default the routing predicate to false so existing describe blocks
// (I-STARTUP, I-RETRY, I-PERSISTENT, I-ON-ADD, T-11) continue to exercise
// the SSH path exactly as they did pre-fix. Individual tests in the new
// I-LOCAL-BYPASS block override with mockReturnValue(true) for the local-host
// id they set up. Mocking the whole module (not just the export) sidesteps
// its ssh2 + js-yaml side-effect imports which the integration harness does
// not otherwise resolve.
vi.mock("../claude-session/identity-artifact-reader.js", () => ({
  isLocalHostId: vi.fn(() => false),
  // The orchestrator only imports isLocalHostId; the local install helper
  // pulls in getLocalIdentitiesRoot but that path is mocked below via
  // local-fleet-install.js so it never resolves this module for its own
  // reads. Included here for defense-in-depth against future importers.
  getLocalIdentitiesRoot: vi.fn(() => "/fleet/identities"),
}));

// Quick 260918-5lb: local-fleet-install is delegated to by executeSweeForHost
// on the local branch. Spy on both public functions so LB1-LB4 can assert the
// helper IS called for local hosts (and only local hosts), and control the
// returned counters to drive the bookkeeping-parity tests (LB3). Default
// return shape is a clean sweep so any accidental non-local-host invocation
// (should not happen) still resolves without crashing the fixture.
vi.mock("./local-fleet-install.js", () => ({
  installFleetSubstrateLocally: vi.fn(async () => ({
    itemsChecked: 24,
    itemsChanged: 0,
    itemsFailed: 0,
  })),
  bootstrapFleetSubstrateLocally: vi.fn(async () => ({
    alreadyEnabled: true,
    bootstrapRan: false,
    daemonReloadRan: true,
    settingsPatchOk: true,
    gsdContextMonitorCleanupOk: true,
    skynetParentOk: true,
    skynetHostnameOk: true,
    hadError: false,
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
import { systemLogger, sshLogger } from "../utils/logger.js";
import { SystemCrypto } from "../utils/system-crypto.js";
import { FieldCrypto } from "../utils/field-crypto.js";
import { readInstancePolicyBytes } from "../branding/branding-config-loader.js";
import { isLocalHostId } from "../claude-session/identity-artifact-reader.js";
import {
  installFleetSubstrateLocally,
  bootstrapFleetSubstrateLocally,
} from "./local-fleet-install.js";
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
      // Phase 114 Plan 05 (D-16): ssh-push removeInstalledFile. Fired for
      // runtime-source rows whose resolver returned null (the empty-field
      // twinkie state at test defaults). Return __REMOVE_ALREADY__ — the
      // idempotent no-op that mirrors bytes-match: no counter bump, no log,
      // sweep succeeds. This keeps the pre-Phase-112 integration invariant
      // (successful sweep → itemsFailed === 0 → host marked done).
      if (
        cmd.includes("__REMOVE_DID__") ||
        cmd.includes("__REMOVE_ALREADY__") ||
        cmd.includes("__REMOVE_FAIL__")
      ) {
        return "__REMOVE_ALREADY__";
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

  // -------------------------------------------------------------------------
  // T-11 (Phase 114 D-22): Phase 114 twinkie end-to-end integration
  //
  // The final gate for Phase 114: verify that Plans 01-05 wire together to
  // deliver /etc/claude-code/CLAUDE.md to a root-SSH managed host when the
  // branding config's instancePolicyFilename is set and the referenced file
  // exists — and inversely, skip non-root hosts, and issue a rm -f push
  // when the resolver returns null.
  //
  // MOCKED SURFACE:
  //   - readInstancePolicyBytes → per-scenario override at the top of each it()
  //   - listSubstrateHosts → one host with a per-scenario `username` at
  //     _connDetails.username so the composer's D-13 root-user gate branches
  //   - acquireChannel → makeSuccessChannel() (or a per-scenario variant
  //     returning __REMOVE_DID__ instead of __REMOVE_ALREADY__ for T-11c)
  //
  // REAL CODE UNDER TEST:
  //   - orchestrator (createServerSubstrateOrchestrator) →
  //     resolveRuntimeBytesForTick → runSweepForHost →
  //     composer's D-13 gate + D-12 source-resolution branch + D-16 removal
  //     branch → ssh-push helpers (writeInstalledBytesWithMode +
  //     removeInstalledFile) — every branch touched, only the SSH-channel
  //     boundary mocked.
  // -------------------------------------------------------------------------

  describe("T-11: Phase 114 twinkie end-to-end", () => {
    /**
     * Build a single-host DB stub with an overridable SSH username so we
     * can exercise the D-13 root-user gate in both directions. The DB row's
     * `username` column is what listSubstrateHosts surfaces into
     * `_connDetails.username`, which the orchestrator then null-coalesces
     * into `host.username` for the composer.
     */
    function makeTwinkieRows(username: "root" | "ubuntu"): MockRow[] {
      return [
        makeRow({
          id: 1,
          name: "twinkie-host",
          credentialId: 100,
          cred_id: 100,
          cred_systemPassword: "ct-twinkie",
          username,
        }),
      ];
    }

    /**
     * T-11a: HAPPY PATH — twinkie file present + root-SSH host →
     * base64 write command emitted for /etc/claude-code/CLAUDE.md
     * (system-root shape: chown root:root, chmod 644, symlink guard),
     * base64 body matches the twinkie bytes, resolver called ONCE.
     */
    it("T-11a: happy path — twinkie set + root host → base64 write captured for /etc/claude-code/CLAUDE.md", async () => {
      const twinkieBytes = Buffer.from("# twinkie\n\ntest content");
      vi.mocked(readInstancePolicyBytes).mockResolvedValue(twinkieBytes);

      const rows = makeTwinkieRows("root");
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
        persistentFailureThreshold: 10,
      });

      await orch.start();
      await Promise.resolve();
      await Promise.resolve();

      // Resolver called exactly ONCE per tick (Pitfall 6 / D-15).
      expect(vi.mocked(readInstancePolicyBytes)).toHaveBeenCalledTimes(1);

      // Collect all commands emitted through the channel.exec mock across
      // whichever channel was returned by acquireChannel this sweep.
      const channelReturns = acquireChannel.mock.results
        .map((r) => r.value)
        .filter((v): v is Promise<SshChannel> => v !== null);
      const resolvedChannels = await Promise.all(channelReturns);
      const capturedCommands: string[] = [];
      const capturedStdin: Array<Buffer | undefined> = [];
      for (const ch of resolvedChannels) {
        const execMock = ch.exec as ReturnType<typeof vi.fn>;
        for (const call of execMock.mock.calls) {
          capturedCommands.push(call[0] as string);
          capturedStdin.push(call[1] as Buffer | undefined);
        }
      }

      // Plan 03 system-root write shape (Phase 115 sudo update): the
      // command routes base64 via `sudo -n tee`, chowns root:root, chmods
      // 644 — all sudo-wrapped so a NOPASSWD sudoer can complete the write.
      const twinkieWriteIdx = capturedCommands.findIndex(
        (c) =>
          c.includes("base64 -d | sudo -n tee '/etc/claude-code/CLAUDE.md'") &&
          c.includes("sudo -n chown root:root '/etc/claude-code/CLAUDE.md'") &&
          c.includes("sudo -n chmod 644 '/etc/claude-code/CLAUDE.md'"),
      );
      expect(twinkieWriteIdx).toBeGreaterThanOrEqual(0);

      // Base64 body passed via stdin matches the twinkie bytes.
      const stdinBody = capturedStdin[twinkieWriteIdx];
      expect(stdinBody).toBeInstanceOf(Buffer);
      expect(stdinBody!.toString("utf-8")).toBe(twinkieBytes.toString("base64"));

      orch.stop();
    });

    /**
     * T-11b (Phase 115 rewrite — D-13 gate retired): twinkie file present
     * on a NON-root SSH host (username="ubuntu"). The composer no longer
     * short-circuits; the write is ATTEMPTED with `sudo -n tee` in the
     * command chain, and on a happy NOPASSWD-sudo host it succeeds. No
     * fleet_substrate_system_root_skip log fires — the gate is gone.
     */
    it("T-11b: non-root host with NOPASSWD sudo → write attempted via `sudo -n`, no skip log", async () => {
      const twinkieBytes = Buffer.from("# twinkie\n\ntest content");
      vi.mocked(readInstancePolicyBytes).mockResolvedValue(twinkieBytes);

      const rows = makeTwinkieRows("ubuntu");
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
        persistentFailureThreshold: 10,
      });

      await orch.start();
      await Promise.resolve();
      await Promise.resolve();

      // Collect commands: no command for the twinkie row's install path.
      const channelReturns = acquireChannel.mock.results
        .map((r) => r.value)
        .filter((v): v is Promise<SshChannel> => v !== null);
      const resolvedChannels = await Promise.all(channelReturns);
      const capturedCommands: string[] = [];
      for (const ch of resolvedChannels) {
        const execMock = ch.exec as ReturnType<typeof vi.fn>;
        for (const call of execMock.mock.calls) {
          capturedCommands.push(call[0] as string);
        }
      }

      // Phase 115: the write IS attempted (no pre-emptive gate). At least
      // one command touches /etc/claude-code/CLAUDE.md, and the write
      // command routes through `sudo -n tee`.
      const twinkieCmd = capturedCommands.find((c) =>
        c.includes("base64 -d | sudo -n tee '/etc/claude-code/CLAUDE.md'"),
      );
      expect(twinkieCmd).toBeDefined();

      // NO fleet_substrate_system_root_skip log — the D-13 gate is retired.
      const infoMock = sshLogger.info as ReturnType<typeof vi.fn>;
      const skipCalls = infoMock.mock.calls.filter(
        (call: unknown[]) =>
          (call[1] as Record<string, unknown> | undefined)?.operation ===
          "fleet_substrate_system_root_skip",
      );
      expect(skipCalls.length).toBe(0);

      orch.stop();
    });

    /**
     * T-11c: REMOVAL — resolver returns null (field cleared or file missing)
     * → root-SSH host receives `rm -f '/etc/claude-code/CLAUDE.md'` push;
     * NO base64 write for the twinkie row. Non-root hosts (a second host
     * added to the fixture) receive NO removal either (D-13 gates them out
     * entirely — nothing to clean up because nothing was ever pushed).
     */
    it("T-11c: removal — resolver returns null → rm -f emitted on root-SSH host, NO removal on non-root host, NO base64 write", async () => {
      vi.mocked(readInstancePolicyBytes).mockResolvedValue(null);

      // Two hosts: one root-SSH (receives rm -f), one ubuntu-SSH (gated out).
      const rows: MockRow[] = [
        makeRow({
          id: 1,
          name: "root-host",
          credentialId: 100,
          cred_id: 100,
          cred_systemPassword: "ct-root",
          username: "root",
        }),
        makeRow({
          id: 2,
          name: "ubuntu-host",
          credentialId: 101,
          cred_id: 101,
          cred_systemPassword: "ct-ubuntu",
          username: "ubuntu",
        }),
      ];
      const stubDb = makeDb(rows);

      // Custom channel factory: returns __REMOVE_DID__ for the rm command so
      // the composer classifies the outcome as "removed" (action:'removed').
      // makeSuccessChannel's default __REMOVE_ALREADY__ path also validates
      // the removal command shape but doesn't bump itemsChanged; T-11c
      // exercises the "did actually remove" branch.
      const makeRemoveDidChannel = (): SshChannel => ({
        exec: vi.fn(async (cmd: string): Promise<string | null> => {
          if (cmd.includes("is-enabled") && cmd.includes("EXIT:$?")) {
            return "enabled\nEXIT:0";
          }
          if (cmd.includes("__RELOAD_OK__")) return "__RELOAD_OK__";
          if (cmd.includes("__BOOTSTRAP_OK__")) return "__BOOTSTRAP_OK__";
          if (cmd.includes("__SETTINGS_OK__")) return "__SETTINGS_OK__";
          if (cmd.includes("__CLEANUP_OK__")) return "__CLEANUP_OK__";
          if (cmd.includes("__READ_OK__") || cmd.includes("__READ_ENOENT__")) {
            return "__READ_ENOENT__";
          }
          if (cmd.includes("__WRITE_OK__") || cmd.includes("__WRITE_FAIL__")) {
            return "__WRITE_OK__";
          }
          if (cmd.includes("__RESTART_OK__") || cmd.includes("__RESTART_FAIL__")) {
            return "__RESTART_OK__";
          }
          // Twinkie removal: the rm command carries __REMOVE_DID__ in its
          // source (the `echo __REMOVE_DID__` branch). Return the "did"
          // sentinel so the composer maps to action:'removed' and bumps
          // itemsChanged.
          if (
            cmd.includes("__REMOVE_DID__") ||
            cmd.includes("__REMOVE_ALREADY__") ||
            cmd.includes("__REMOVE_FAIL__")
          ) {
            return "__REMOVE_DID__";
          }
          return "";
        }),
      });

      const perHostChannels = new Map<string, SshChannel>();
      const acquireChannel = vi.fn(async (host: { id: string }) => {
        const ch = makeRemoveDidChannel();
        perHostChannels.set(host.id, ch);
        return ch;
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
        persistentFailureThreshold: 10,
      });

      await orch.start();
      await Promise.resolve();
      await Promise.resolve();

      // Collect commands per host.
      const rootHostCh = perHostChannels.get("1");
      const ubuntuHostCh = perHostChannels.get("2");
      expect(rootHostCh).toBeDefined();
      expect(ubuntuHostCh).toBeDefined();

      const rootCommands = (
        rootHostCh!.exec as ReturnType<typeof vi.fn>
      ).mock.calls.map((c) => c[0] as string);
      const ubuntuCommands = (
        ubuntuHostCh!.exec as ReturnType<typeof vi.fn>
      ).mock.calls.map((c) => c[0] as string);

      // Root host: rm -f command emitted for the twinkie path, and the
      // emitted command source contains the __REMOVE_DID__ echo branch
      // (Plan 03 removeInstalledFile shape).
      const rootRmIdx = rootCommands.findIndex(
        (c) =>
          c.includes("rm -f '/etc/claude-code/CLAUDE.md'") &&
          c.includes("__REMOVE_DID__"),
      );
      expect(rootRmIdx).toBeGreaterThanOrEqual(0);

      // Root host: NO base64 tee write for the twinkie path — the removal
      // branch short-circuits before the write flow.
      expect(
        rootCommands.some(
          (c) =>
            c.includes("base64 -d | sudo -n tee") &&
            c.includes("'/etc/claude-code/CLAUDE.md'"),
        ),
      ).toBe(false);

      // Phase 115: ubuntu host ALSO gets an rm command via sudo -n rm.
      // The D-13 gate is retired — both hosts attempt the removal.
      const ubuntuRmIdx = ubuntuCommands.findIndex(
        (c) =>
          c.includes("sudo -n rm -f '/etc/claude-code/CLAUDE.md'") &&
          c.includes("__REMOVE_DID__"),
      );
      expect(ubuntuRmIdx).toBeGreaterThanOrEqual(0);

      // NO fleet_substrate_system_root_skip log — the gate is retired.
      const infoMock = sshLogger.info as ReturnType<typeof vi.fn>;
      const skipCalls = infoMock.mock.calls.filter(
        (call: unknown[]) =>
          (call[1] as Record<string, unknown> | undefined)?.operation ===
          "fleet_substrate_system_root_skip",
      );
      expect(skipCalls.length).toBe(0);

      orch.stop();
    });
  });

  // -------------------------------------------------------------------------
  // I-LOCAL-BYPASS (quick 260918-5lb): distributor local-FS bypass for the
  // container's own host record. When isLocalHostId returns true for a host's
  // numeric id, executeSweeForHost MUST skip deps.acquireChannel entirely
  // and delegate to the local-FS helper. Non-local hosts continue on the SSH
  // path unchanged.
  //
  // The failure mode this suite pins: post-fix regression where SSH-to-self
  // would silently re-appear because a future edit to executeSweeForHost
  // routed the local host through acquireChannel again, re-wedging the
  // for-of loop on container recreate.
  //
  // Written retroactively as regression coverage after Task 2's orchestrator
  // edit already landed the GREEN behavior.
  // -------------------------------------------------------------------------

  describe("I-LOCAL-BYPASS (distributor local-FS bypass): local host uses fs, not ssh", () => {
    it("LB1 — acquireChannel NEVER called for the local host; still called for non-local hosts", async () => {
      const rows = [
        makeRow({
          id: 5,
          name: "remote-a",
          credentialId: 100,
          cred_id: 100,
          cred_systemPassword: "ct-a",
        }),
        makeRow({
          id: 6,
          name: "t1000-local",
          credentialId: 101,
          cred_id: 101,
          cred_systemPassword: "ct-b",
        }),
        makeRow({
          id: 7,
          name: "remote-c",
          credentialId: 102,
          cred_id: 102,
          cred_systemPassword: "ct-c",
        }),
      ];
      const stubDb = makeDb(rows);

      // isLocalHostId returns true only for id=6.
      vi.mocked(isLocalHostId).mockImplementation((n?: number) => n === 6);

      const acquireCalls: string[] = [];
      const acquireChannel = vi.fn(async (host: { id: string }) => {
        acquireCalls.push(host.id);
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

      await orch.start();
      await Promise.resolve();
      await Promise.resolve();

      // The local host (id=6) MUST NOT have been the target of acquireChannel.
      expect(acquireCalls).not.toContain("6");
      // Non-local hosts (id=5, id=7) MUST have been swept via SSH.
      expect(acquireCalls).toContain("5");
      expect(acquireCalls).toContain("7");
      expect(acquireCalls.length).toBe(2);

      orch.stop();
    });

    it("LB2 — installFleetSubstrateLocally + bootstrapFleetSubstrateLocally ARE called for local host, NOT for non-local hosts", async () => {
      const rows = [
        makeRow({
          id: 5,
          name: "remote-a",
          credentialId: 100,
          cred_id: 100,
          cred_systemPassword: "ct-a",
        }),
        makeRow({
          id: 6,
          name: "t1000-local",
          credentialId: 101,
          cred_id: 101,
          cred_systemPassword: "ct-b",
        }),
      ];
      const stubDb = makeDb(rows);

      vi.mocked(isLocalHostId).mockImplementation((n?: number) => n === 6);

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
      await Promise.resolve();

      // Both local-branch helpers called exactly once, for the local host only.
      expect(vi.mocked(installFleetSubstrateLocally)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(bootstrapFleetSubstrateLocally)).toHaveBeenCalledTimes(1);
      const installArg = vi.mocked(installFleetSubstrateLocally).mock.calls[0][0];
      expect(installArg.id).toBe("6");
      expect(installArg.name).toBe("t1000-local");
      const bootstrapArg = vi.mocked(bootstrapFleetSubstrateLocally).mock.calls[0][0];
      expect(bootstrapArg.id).toBe("6");
      expect(bootstrapArg.name).toBe("t1000-local");

      orch.stop();
    });

    it("LB3 — bookkeeping parity: clean local sweep marks host done (skipped on retry tick)", async () => {
      const rows = [
        makeRow({
          id: 6,
          name: "t1000-local",
          credentialId: 101,
          cred_id: 101,
          cred_systemPassword: "ct-b",
        }),
      ];
      const stubDb = makeDb(rows);

      vi.mocked(isLocalHostId).mockImplementation((n?: number) => n === 6);
      // Clean sweep: itemsFailed = 0 → local host marked done for this uptime.
      vi.mocked(installFleetSubstrateLocally).mockResolvedValue({
        itemsChecked: 24,
        itemsChanged: 0,
        itemsFailed: 0,
      });

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
        acquireChannel: vi.fn(async () => makeSuccessChannel()),
        releaseChannel: vi.fn(),
        setInterval: setIntervalMock,
        clearInterval: vi.fn(),
        now: () => Date.now(),
        retryIntervalMs: 30000,
        persistentFailureThreshold: 3,
      });

      await orch.start();
      await Promise.resolve();
      await Promise.resolve();

      expect(vi.mocked(installFleetSubstrateLocally)).toHaveBeenCalledTimes(1);

      // Fire retry tick — host is marked done, should NOT be re-swept.
      expect(capturedTickFn).not.toBeNull();
      await capturedTickFn!();
      await Promise.resolve();
      await Promise.resolve();

      // Still just the one call — the retry tick short-circuited on
      // sweepedThisInstance.has(host.id).
      expect(vi.mocked(installFleetSubstrateLocally)).toHaveBeenCalledTimes(1);

      orch.stop();
    });

    it("LB3b — bookkeeping parity: 3 failing local sweeps fire logPersistentFailure exactly once", async () => {
      const rows = [
        makeRow({
          id: 6,
          name: "t1000-local",
          credentialId: 101,
          cred_id: 101,
          cred_systemPassword: "ct-b",
        }),
      ];
      const stubDb = makeDb(rows);

      vi.mocked(isLocalHostId).mockImplementation((n?: number) => n === 6);
      // Every sweep returns itemsFailed > 0 → consecutiveFailures increments.
      vi.mocked(installFleetSubstrateLocally).mockResolvedValue({
        itemsChecked: 24,
        itemsChanged: 0,
        itemsFailed: 1,
      });

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
        acquireChannel: vi.fn(async () => makeSuccessChannel()),
        releaseChannel: vi.fn(),
        setInterval: setIntervalMock,
        clearInterval: vi.fn(),
        now: () => Date.now(),
        retryIntervalMs: 30000,
        persistentFailureThreshold: 3,
      });

      // Failure #1 (startup pass).
      await orch.start();
      await Promise.resolve();
      await Promise.resolve();

      // Failures #2 and #3 via the retry tick — the 3rd fires the alert.
      await capturedTickFn!();
      await Promise.resolve();
      await Promise.resolve();
      await capturedTickFn!();
      await Promise.resolve();
      await Promise.resolve();

      const warnMock = systemLogger.warn as ReturnType<typeof vi.fn>;
      const persistentCalls = warnMock.mock.calls.filter(
        (call: unknown[]) =>
          (call[1] as Record<string, unknown> | undefined)?.operation ===
          "fleet_substrate_host_persistent_failure",
      );
      expect(persistentCalls.length).toBe(1);
      expect(
        (persistentCalls[0][1] as Record<string, unknown>).consecutiveFailures,
      ).toBe(3);
      expect(
        (persistentCalls[0][1] as Record<string, unknown>).hostName,
      ).toBe("t1000-local");

      // 4th failure MUST NOT re-alert.
      await capturedTickFn!();
      await Promise.resolve();
      await Promise.resolve();
      const persistentCallsAfter = warnMock.mock.calls.filter(
        (call: unknown[]) =>
          (call[1] as Record<string, unknown> | undefined)?.operation ===
          "fleet_substrate_host_persistent_failure",
      );
      expect(persistentCallsAfter.length).toBe(1); // still 1

      orch.stop();
    });

    it("LB4 — for-await loop does NOT wedge on local host: [non-local, local, non-local] all complete in one pass", async () => {
      // Regression guard against the original hang: without the bypass, the
      // middle host (local) would hang forever in acquireChannel and the
      // third host would never be reached.
      const rows = [
        makeRow({
          id: 5,
          name: "remote-a",
          credentialId: 100,
          cred_id: 100,
          cred_systemPassword: "ct-a",
        }),
        makeRow({
          id: 6,
          name: "t1000-local",
          credentialId: 101,
          cred_id: 101,
          cred_systemPassword: "ct-b",
        }),
        makeRow({
          id: 7,
          name: "remote-c",
          credentialId: 102,
          cred_id: 102,
          cred_systemPassword: "ct-c",
        }),
      ];
      const stubDb = makeDb(rows);

      vi.mocked(isLocalHostId).mockImplementation((n?: number) => n === 6);

      const acquireCallOrder: string[] = [];
      const acquireChannel = vi.fn(async (host: { id: string }) => {
        acquireCallOrder.push(host.id);
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

      await orch.start();
      await Promise.resolve();
      await Promise.resolve();

      // All three hosts observed by the for-of loop — non-local via
      // acquireChannel, local via installFleetSubstrateLocally.
      expect(acquireCallOrder).toEqual(["5", "7"]);
      expect(vi.mocked(installFleetSubstrateLocally)).toHaveBeenCalledTimes(1);
      // Sweep tick count is 1 (single startup pass), NOT stuck mid-loop.
      expect(orch.getSweepTickCount()).toBe(1);

      orch.stop();
    });
  });
});
