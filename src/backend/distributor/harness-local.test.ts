/**
 * harness-local.test.ts — Co-located-host harness reconcile: the cheap
 * bind-mount check, the transient-unit launch shape, result polling, and
 * every failure path collapsing into a parseable `action=failed` line.
 */
import { describe, it, expect, vi } from "vitest";
import {
  escapeForSystemdExec,
  runLocalHarnessReconcile,
  type LocalHarnessDeps,
} from "./harness-local.js";
import { HARNESS_RECONCILE_SCRIPT, parseHarnessResult } from "./harness-script.js";

const PIN = "2.1.286";
const LOCAL = "/host-home";
const HOST = "/home/ubuntu";

function makeDeps(over: Partial<LocalHarnessDeps> = {}) {
  let clock = 0;
  const files = new Map<string, string>();
  const deps: LocalHarnessDeps = {
    localHomeRoot: LOCAL,
    hostHomeRoot: HOST,
    xdgRuntimeDir: "/run/user/1000",
    execFile: vi.fn(async () => ({})),
    readFile: vi.fn(async (p: string) => {
      const v = files.get(p);
      if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return v;
    }),
    unlink: vi.fn(async (p: string) => {
      files.delete(p);
    }),
    lstat: vi.fn(async () => {
      throw new Error("ENOENT");
    }),
    readlink: vi.fn(async () => {
      throw new Error("EINVAL");
    }),
    access: vi.fn(async () => undefined),
    geteuid: () => 1000,
    now: () => clock,
    sleep: vi.fn(async (ms: number) => {
      clock += ms;
    }),
    resultTimeoutMs: 10_000,
    pollIntervalMs: 1000,
    ...over,
  };
  return { deps, files };
}

/** Find the transient unit's argv inside the busctl call. */
function scriptArgv(execFile: LocalHarnessDeps["execFile"]) {
  const call = vi.mocked(execFile).mock.calls[0];
  const args = call[1];
  const i = args.indexOf("a(sasb)");
  // a(sasb): count(1) path argc argv... ignore-failure
  const argc = parseInt(args[i + 3], 10);
  const argv = args.slice(i + 4, i + 4 + argc);
  return { call, args, argc, argv, after: args.slice(i + 4 + argc) };
}

/** What systemd does to an ExecStart argument set over D-Bus: `$$` → `$`,
 *  `${NAME}` / `$NAME` → env value (empty here). Mirrors behaviour verified
 *  on systemd 255. */
function systemdExpand(arg: string): string {
  return arg.replace(/\$\$|\$\{[A-Za-z_][A-Za-z0-9_]*\}|\$[A-Za-z_][A-Za-z0-9_]*/g, (m) =>
    m === "$$" ? "$" : "",
  );
}

describe("escapeForSystemdExec", () => {
  it("makes the reconcile script survive systemd's argument expansion byte-for-byte", () => {
    // Unescaped, systemd would mangle it (sanity-check the emulation).
    expect(systemdExpand(HARNESS_RECONCILE_SCRIPT)).not.toBe(HARNESS_RECONCILE_SCRIPT);
    expect(systemdExpand(escapeForSystemdExec(HARNESS_RECONCILE_SCRIPT))).toBe(HARNESS_RECONCILE_SCRIPT);
  });
});

describe("runLocalHarnessReconcile", () => {
  it("reports none from the bind mount without touching the host service manager", async () => {
    const { deps } = makeDeps({
      lstat: vi.fn(async () => ({ isSymbolicLink: () => true, uid: 1000, gid: 1000 })),
      readlink: vi.fn(async () => `${HOST}/.local/share/claude/versions/${PIN}`),
    });
    const out = await runLocalHarnessReconcile(PIN, deps);
    expect(parseHarnessResult(out)).toMatchObject({ action: "none", found: PIN });
    expect(deps.execFile).not.toHaveBeenCalled();
    expect(deps.access).toHaveBeenCalledWith(`${LOCAL}/.local/share/claude/versions/${PIN}`, 1);
  });

  it("launches the reconcile script as a transient host unit and returns its result", async () => {
    const { deps, files } = makeDeps();
    vi.mocked(deps.execFile).mockImplementation(async (_f, args) => {
      // The unit writes its result to the HOST path; we read it via the mount.
      const { argv } = { argv: args.slice(args.indexOf("a(sasb)") + 4) };
      const hostResult = argv[5];
      files.set(hostResult.replace(HOST, LOCAL), `HARNESS_RESULT action=installed wanted=${PIN} found=none detail=ok\n`);
      return {};
    });

    const out = await runLocalHarnessReconcile(PIN, deps);
    expect(parseHarnessResult(out)).toMatchObject({ action: "installed" });

    const { call, args, argc, argv, after } = scriptArgv(deps.execFile);
    expect(call[0]).toBe("busctl");
    expect(args.slice(0, 3)).toEqual(["--user", "call", "--"]);
    expect(args).toContain("StartTransientUnit");
    expect(argc).toBe(argv.length);
    expect(argv[0]).toBe("/bin/bash");
    expect(argv[1]).toBe("-c");
    expect(argv[2]).toBe(escapeForSystemdExec(HARNESS_RECONCILE_SCRIPT));
    // The unit is capped so an orphaned run can't outlive the result poll.
    const props = args.slice(args.indexOf("fail") + 1);
    expect(props[0]).toBe("3");
    expect(props).toContain("RuntimeMaxUSec");
    expect(argv[4]).toBe(PIN);
    expect(argv[5]).toMatch(new RegExp(`^${HOST}/\\.cache/skynet-harness/result-`));
    expect(after).toEqual(["false", "0"]);
    expect(call[2].env?.XDG_RUNTIME_DIR).toBe("/run/user/1000");
    expect(call[2].uid).toBeUndefined();
    // Result file is cleaned up after reading.
    expect(deps.unlink).toHaveBeenCalledTimes(1);
  });

  it("drops to the home owner's uid/gid for busctl when running as root", async () => {
    const { deps, files } = makeDeps({
      geteuid: () => 0,
      lstat: vi.fn(async (p: string) => {
        if (p === LOCAL) return { isSymbolicLink: () => false, uid: 1000, gid: 1001 };
        throw new Error("ENOENT");
      }),
    });
    vi.mocked(deps.execFile).mockImplementation(async (_f, args) => {
      const hostResult = args.slice(args.indexOf("a(sasb)") + 4)[5];
      files.set(hostResult.replace(HOST, LOCAL), `HARNESS_RESULT action=none wanted=${PIN} found=${PIN}\n`);
      return {};
    });
    await runLocalHarnessReconcile(PIN, deps);
    const opts = vi.mocked(deps.execFile).mock.calls[0][2];
    expect(opts.uid).toBe(1000);
    expect(opts.gid).toBe(1001);
  });

  it("goes to the host when the link points at a different version", async () => {
    const { deps } = makeDeps({
      lstat: vi.fn(async () => ({ isSymbolicLink: () => true, uid: 1000, gid: 1000 })),
      readlink: vi.fn(async () => `${HOST}/.local/share/claude/versions/2.1.150`),
    });
    await runLocalHarnessReconcile(PIN, deps);
    expect(deps.execFile).toHaveBeenCalledTimes(1);
  });

  it("fails cleanly when the host-systemd bus isn't available", async () => {
    const { deps } = makeDeps({ xdgRuntimeDir: undefined });
    const out = await runLocalHarnessReconcile(PIN, deps);
    expect(parseHarnessResult(out)).toMatchObject({ action: "failed", reason: "no-host-systemd" });
    expect(deps.execFile).not.toHaveBeenCalled();
  });

  it("fails cleanly when busctl errors", async () => {
    const { deps } = makeDeps({
      execFile: vi.fn(async () => {
        throw new Error("Call failed: Transport endpoint is not connected");
      }),
    });
    const out = await runLocalHarnessReconcile(PIN, deps);
    expect(parseHarnessResult(out)).toMatchObject({
      action: "failed",
      reason: "local-exec-failed",
      detail: "Call failed: Transport endpoint is not connected",
    });
  });

  it("times out when the unit never writes a result", async () => {
    const { deps } = makeDeps();
    const out = await runLocalHarnessReconcile(PIN, deps);
    expect(parseHarnessResult(out)).toMatchObject({ action: "failed", reason: "local-timeout" });
    expect(vi.mocked(deps.sleep).mock.calls.length).toBe(10);
  });
});
