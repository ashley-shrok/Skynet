/**
 * harness-local.ts — Harness reconcile for the co-located host (Skynet's own
 * box, e.g. t1000), where SSH-to-self is off the table (see
 * local-fleet-install.ts for why).
 *
 * Two stages:
 *   1. Cheap in-container check through the bind-mounted host home: if
 *      ~/.local/bin/claude is a symlink to <host-home>/.local/share/claude/
 *      versions/<pin> and that file is executable, report `action=none`
 *      without touching the host's service manager. This is the path every
 *      restart of a converged box takes.
 *   2. Otherwise the installer must run ON THE HOST as the box user, not in
 *      the container (the container's home and filesystem are not the
 *      host's). Ask the host's systemd --user manager — over the same
 *      bind-mounted session bus local-fleet-install.ts already uses for
 *      restart hooks — to start a transient oneshot unit running the
 *      reconcile script (harness-script.ts) with a result-file argument.
 *      Poll that file through the bind mount until it appears.
 *
 * busctl must speak to the session bus AS the box user: dbus-daemon refuses
 * root's EXTERNAL auth on another user's bus. Skynet's backend already runs
 * as that user in production; when it doesn't (euid 0), the exec drops to
 * the owner of the bind-mounted home.
 *
 * Never throws — every failure becomes a `HARNESS_RESULT action=failed` line
 * so the reconciler's backoff and alerting handle it like a remote failure.
 */
import { execFile as execFileCb } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import {
  HARNESS_INSTALL_TIMEOUT_S,
  HARNESS_RECONCILE_SCRIPT,
} from "./harness-script.js";

const execFileP = promisify(execFileCb);

export interface LocalHarnessDeps {
  /** Container-side path of the host home (bind mount). */
  localHomeRoot: string;
  /** Host-side path of the same home (what host processes see). */
  hostHomeRoot: string;
  /** Session-bus runtime dir; absent → host-systemd override not enabled. */
  xdgRuntimeDir: string | undefined;
  execFile(
    file: string,
    args: string[],
    opts: { env: NodeJS.ProcessEnv; uid?: number; gid?: number },
  ): Promise<unknown>;
  readFile(p: string): Promise<string>;
  unlink(p: string): Promise<void>;
  lstat(p: string): Promise<{ isSymbolicLink(): boolean; uid: number; gid: number }>;
  readlink(p: string): Promise<string>;
  access(p: string, mode: number): Promise<void>;
  geteuid(): number;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Max wait for the result file (ms). */
  resultTimeoutMs?: number;
  pollIntervalMs?: number;
}

export function defaultLocalHarnessDeps(): LocalHarnessDeps {
  return {
    localHomeRoot: process.env.HOME_HOST_DIR || os.homedir(),
    hostHomeRoot: process.env.SKYNET_HOME_MOUNT_SRC || os.homedir(),
    xdgRuntimeDir: process.env.XDG_RUNTIME_DIR,
    execFile: (file, args, opts) => execFileP(file, args, opts),
    readFile: (p) => fs.readFile(p, "utf-8"),
    unlink: (p) => fs.unlink(p),
    lstat: (p) => fs.lstat(p),
    readlink: (p) => fs.readlink(p),
    access: (p, mode) => fs.access(p, mode),
    geteuid: () => (typeof process.geteuid === "function" ? process.geteuid() : -1),
    now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

function failLine(pin: string, reason: string, detail: string): string {
  const clean = detail.replace(/[\r\n\t]+/g, " ").slice(0, 300);
  return `HARNESS_RESULT action=failed wanted=${pin} found=unknown reason=${reason} detail=${clean}`;
}

/** Stage 1 — true when the box is already on the pin. */
async function alreadyOnPin(pin: string, d: LocalHarnessDeps): Promise<boolean> {
  try {
    const bin = path.join(d.localHomeRoot, ".local", "bin", "claude");
    const st = await d.lstat(bin);
    if (!st.isSymbolicLink()) return false;
    const target = await d.readlink(bin);
    const expected = path.join(d.hostHomeRoot, ".local", "share", "claude", "versions", pin);
    if (path.normalize(target) !== path.normalize(expected)) return false;
    await d.access(
      path.join(d.localHomeRoot, ".local", "share", "claude", "versions", pin),
      1, // X_OK
    );
    return true;
  } catch {
    return false;
  }
}

export async function runLocalHarnessReconcile(
  pin: string,
  d: LocalHarnessDeps = defaultLocalHarnessDeps(),
): Promise<string> {
  try {
    if (await alreadyOnPin(pin, d)) {
      return `HARNESS_RESULT action=none wanted=${pin} found=${pin} detail=already on pin`;
    }
    if (!d.xdgRuntimeDir) {
      return failLine(
        pin,
        "no-host-systemd",
        "XDG_RUNTIME_DIR unset — host-systemd compose override not enabled",
      );
    }

    const nonce = `${d.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const rel = path.join(".cache", "skynet-harness", `result-${nonce}`);
    const hostResult = path.join(d.hostHomeRoot, rel);
    const localResult = path.join(d.localHomeRoot, rel);
    const unit = `skynet-harness-${nonce}.service`;

    const opts: { env: NodeJS.ProcessEnv; uid?: number; gid?: number } = {
      env: { ...process.env, XDG_RUNTIME_DIR: d.xdgRuntimeDir },
    };
    if (d.geteuid() === 0) {
      const home = await d.lstat(d.localHomeRoot);
      opts.uid = home.uid;
      opts.gid = home.gid;
    }

    // StartTransientUnit(name, mode, properties a(sv), aux a(sa(sv))).
    // ExecStart is a(sasb): (path, argv, ignore-failure). `--` stops busctl
    // parsing the script's argv (`-c`) as its own options.
    await d.execFile(
      "busctl",
      [
        "--user",
        "call",
        "--",
        "org.freedesktop.systemd1",
        "/org/freedesktop/systemd1",
        "org.freedesktop.systemd1.Manager",
        "StartTransientUnit",
        "ssa(sv)a(sa(sv))",
        unit,
        "fail",
        "2",
        "Description",
        "s",
        `Skynet harness reconcile (pin ${pin})`,
        "ExecStart",
        "a(sasb)",
        "1",
        "/bin/bash",
        // argv count: /bin/bash -c <script> <$0> <$1=pin> <$2=result file>
        "6",
        "/bin/bash",
        "-c",
        HARNESS_RECONCILE_SCRIPT,
        "skynet-harness",
        pin,
        hostResult,
        "false",
        "0",
      ],
      opts,
    );

    const timeoutMs = d.resultTimeoutMs ?? (HARNESS_INSTALL_TIMEOUT_S + 120) * 1000;
    const pollMs = d.pollIntervalMs ?? 2000;
    const deadline = d.now() + timeoutMs;
    while (d.now() < deadline) {
      try {
        const out = await d.readFile(localResult);
        if (out.includes("HARNESS_RESULT ")) {
          await d.unlink(localResult).catch(() => {});
          return out;
        }
      } catch {
        /* not there yet */
      }
      await d.sleep(pollMs);
    }
    return failLine(pin, "local-timeout", `no result from ${unit} after ${Math.round(timeoutMs / 1000)}s`);
  } catch (err) {
    return failLine(
      pin,
      "local-exec-failed",
      err instanceof Error ? err.message : String(err),
    );
  }
}
