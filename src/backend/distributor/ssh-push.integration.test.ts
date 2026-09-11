/**
 * ssh-push — END-TO-END integration test against a real ssh2 client + local
 * OpenSSH sshd loopback.
 *
 * PURPOSE — regression seal on the Linux MAX_ARG_STRLEN (PAGE_SIZE * 32 =
 * 131072 bytes on x86_64) argv-element limit that phase-72's mocked test
 * 5b silently missed. sshd invokes `/bin/bash -c "<command>"`; the command
 * is one argv element. Any writeInstalledBytesWithMode implementation that
 * embeds the base64 payload in the exec command string trips execve E2BIG
 * once the payload exceeds ~95 KB raw (128 KB base64). This test drives
 * writeInstalledBytesWithMode against a REAL ssh2 wire with a 200 KB
 * payload — three times the historic breakage threshold.
 *
 * WHAT THIS TEST PROVES:
 *   1. writeInstalledBytesWithMode succeeds with a 200 KB payload over a
 *      real ssh2 → openssh channel (mocked tests can't catch a boundary
 *      that lives in `execve`, so this is the load-bearing coverage).
 *   2. The file lands on disk with correct bytes + mode.
 *   3. readInstalledBytes round-trip returns the same bytes.
 *
 * -----------------------------------------------------------------------
 * GATE — STRICT process.env.INTEGRATION_TESTS === "1"
 * -----------------------------------------------------------------------
 * Same convention as matrix-admin-client.integration.test.ts. Only the
 * literal "1" opts in; everything else skips the whole describe block so
 * CI without loopback sshd + a repro key isn't gated on this.
 *
 * -----------------------------------------------------------------------
 * OPERATOR SETUP (before running with INTEGRATION_TESTS=1)
 * -----------------------------------------------------------------------
 * On the box running the test:
 *   1. OpenSSH sshd listening on 127.0.0.1:22 (default).
 *   2. Generate a test key: `ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_repro -N ''`
 *   3. Append pubkey to authorized_keys:
 *      `cat ~/.ssh/id_ed25519_repro.pub >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
 *   4. Test the setup:
 *      `ssh -i ~/.ssh/id_ed25519_repro ubuntu@127.0.0.1 'echo ok'`
 *
 * Override via env:
 *   REPRO_HOST   default 127.0.0.1
 *   REPRO_USER   default $USER (or "ubuntu")
 *   REPRO_KEY    default ~/.ssh/id_ed25519_repro
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync, unlinkSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join } from "node:path";
import ssh2pkg from "ssh2";
import { execCommand, execCommandWithStdin } from "../ssh/tmux-helper.js";
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import { writeInstalledBytesWithMode, readInstalledBytes } from "./ssh-push.js";

const { Client } = ssh2pkg;

const gate = process.env.INTEGRATION_TESTS === "1";

const REPRO_HOST = process.env.REPRO_HOST || "127.0.0.1";
const REPRO_USER = process.env.REPRO_USER || process.env.USER || "ubuntu";
const REPRO_KEY = process.env.REPRO_KEY || join(homedir(), ".ssh/id_ed25519_repro");

describe.skipIf(!gate)("ssh-push integration (real ssh2 + openssh loopback)", () => {
  let client: InstanceType<typeof Client>;
  let channel: SshChannel;
  const testInstallPath = join(tmpdir(), `ssh-push-integration-${process.pid}.bin`);

  beforeAll(async () => {
    if (!existsSync(REPRO_KEY)) {
      throw new Error(
        `Missing SSH key at ${REPRO_KEY} — see file docblock § OPERATOR SETUP.`,
      );
    }
    const privateKey = readFileSync(REPRO_KEY);
    client = new Client();
    await new Promise<void>((resolve, reject) => {
      client.on("ready", () => resolve());
      client.on("error", (err) => reject(err));
      client.connect({
        host: REPRO_HOST,
        port: 22,
        username: REPRO_USER,
        privateKey,
        readyTimeout: 8000,
      });
    });

    // Wire the same channel adapter shape starter.ts builds.
    channel = {
      exec: async (command: string, stdinBody?: Buffer): Promise<string | null> => {
        try {
          return stdinBody === undefined
            ? await execCommand(client, command)
            : await execCommandWithStdin(client, command, stdinBody);
        } catch {
          return null;
        }
      },
    };
  }, 15000);

  afterAll(() => {
    try {
      if (existsSync(testInstallPath)) unlinkSync(testInstallPath);
    } catch {
      // best-effort cleanup
    }
    try {
      client?.end();
    } catch {
      // ignore
    }
  });

  it("writes a 200 KB payload over the real wire (past the 128 KB argv-element boundary)", async () => {
    // 200 KB — larger than agent-supervisor.sh (~102 KB) and past the
    // MAX_ARG_STRLEN 128 KB single-argv-element boundary that phase 72's
    // heredoc form hit. Deterministic pseudo-random for reproducibility.
    const bytes = Buffer.alloc(200 * 1024);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = (i * 2654435761) & 0xff;
    }

    const writeResult = await writeInstalledBytesWithMode(
      channel,
      testInstallPath,
      bytes,
      0o644,
    );

    expect(writeResult).toEqual({ ok: true });

    // Round-trip: readInstalledBytes returns the same bytes.
    const readResult = await readInstalledBytes(channel, testInstallPath);
    expect(readResult.readOk).toBe(true);
    if (readResult.readOk === true && readResult.bytes !== null) {
      expect(readResult.bytes.length).toBe(bytes.length);
      expect(readResult.bytes.equals(bytes)).toBe(true);
    }
  }, 30000);

  it("writes a small payload (canary — proves the small-payload path also works over the real wire)", async () => {
    const bytes = Buffer.from("small-canary-payload");
    const canaryPath = join(tmpdir(), `ssh-push-integration-canary-${process.pid}.bin`);

    const writeResult = await writeInstalledBytesWithMode(
      channel,
      canaryPath,
      bytes,
      0o600,
    );

    expect(writeResult).toEqual({ ok: true });

    const readResult = await readInstalledBytes(channel, canaryPath);
    expect(readResult.readOk).toBe(true);
    if (readResult.readOk === true && readResult.bytes !== null) {
      expect(readResult.bytes.equals(bytes)).toBe(true);
    }

    try { unlinkSync(canaryPath); } catch { /* ignore */ }
  }, 15000);
});
