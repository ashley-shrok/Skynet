/**
 * End to end: the real host-side wrappers (substrate/scripts/image-gen,
 * agent-phone → skynet-service) against the real engine, local-host request
 * I/O and atomic writers, in a temp HOME. Only the third-party calls (OpenAI,
 * Bland, the users table) are faked.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../utils/logger.js", () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  };
  return {
    systemLogger: stub,
    sshLogger: stub,
    databaseLogger: stub,
    fileLogger: stub,
  };
});
vi.mock("../database/db/index.js", () => ({ getDb: vi.fn() }));

import { createAgentServiceEngine } from "./engine/engine.js";
import { createResponseWriter, localRequestIo } from "./engine/host-io.js";
import { createImageGenService } from "./services/image-gen/service.js";
import { createAgentPhoneService } from "./services/agent-phone/service.js";
import {
  writeBinaryFileAtomic,
  writeMarkdownFileAtomic,
} from "../claude-session/identity-artifact-reader.js";

const SCRIPTS = path.resolve(__dirname, "../../../substrate/scripts");

let home: string;
let savedIdentitiesDir: string | undefined;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "agent-services-e2e-"));
  savedIdentitiesDir = process.env.IDENTITIES_HOST_DIR;
  // Local fleet root = dirname(IDENTITIES_HOST_DIR) = $home/fleet, which is
  // exactly ~/fleet for the helper running with HOME=$home.
  process.env.IDENTITIES_HOST_DIR = path.join(home, "fleet", "identities");
});

afterEach(() => {
  if (savedIdentitiesDir === undefined) delete process.env.IDENTITIES_HOST_DIR;
  else process.env.IDENTITIES_HOST_DIR = savedIdentitiesDir;
  fs.rmSync(home, { recursive: true, force: true });
});

function makeEngine() {
  const openAi = vi.fn(async () => ({
    ok: true as const,
    images: [Buffer.from("PNG-0"), Buffer.from("PNG-1")],
    generation_time_ms: 5,
  }));
  const placeCall = vi.fn(async () => ({
    outcome: "completed" as const,
    transcript: "voice: hello\nuser: got it",
    call_length_seconds: 9,
  }));
  const engine = createAgentServiceEngine({
    services: [
      createImageGenService(openAi),
      createAgentPhoneService({
        getUserByUsername: async () => ({
          id: "u1",
          phoneE164: "+15555550100",
        }),
        userHasRegisteredHost: async () => true,
        placeCallAndAwait: placeCall,
        sleep: async () => {},
      }),
    ],
    env: { OPENAI_API_KEY: "k", BLAND_API_KEY: "k" },
    createTokenBucket: () => ({
      acquire: async () => {},
      getState: () => ({}) as never,
    }),
    writeResponse: createResponseWriter({
      isLocalHostId: () => true,
      getHostOwnerUserId: async () => null,
      resolveHostById: async () => null,
      connect: async () => {
        throw new Error("no SSH in this test");
      },
      writeTextAtomic: writeMarkdownFileAtomic,
      writeBinaryAtomic: writeBinaryFileAtomic,
    }),
  });
  return { engine, openAi, placeCall };
}

/** Run a helper while acting as the backend scan loop, until it exits. */
async function runWithBackend(script: string, args: string[], stdin?: string) {
  const { engine, ...fakes } = makeEngine();
  const child = spawn(path.join(SCRIPTS, script), args, {
    env: {
      ...process.env,
      HOME: home,
      IMAGE_GEN_TIMEOUT_SEC: "20",
      AGENT_PHONE_TIMEOUT_SEC: "20",
    },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  if (stdin !== undefined) child.stdin.end(stdin);
  else child.stdin.end();
  const exited = new Promise<number>((r) =>
    child.on("exit", (code) => r(code ?? -1)),
  );

  let code: number | null = null;
  void exited.then((c) => (code = c));
  const io = localRequestIo();
  while (code === null) {
    const claimed = await io.claim();
    if (claimed.length > 0)
      await engine.intake({ id: "1", idNum: 1 }, io, claimed);
    await new Promise((r) => setTimeout(r, 50));
  }
  return { code, stdout, stderr, ...fakes };
}

const wireDir = () => path.join(home, "fleet", "service-requests");

describe("agent services end to end", () => {
  it("image-gen: reference image in, two PNGs out, wire folder left clean", async () => {
    const ref = path.join(home, "base.webp");
    fs.writeFileSync(ref, "REF");
    const r = await runWithBackend("image-gen", [
      "a cat in a hat",
      "--n",
      "2",
      "--ref",
      ref,
    ]);

    expect(r.stderr).not.toMatch(/"reason"/);
    expect(r.code).toBe(0);
    expect(r.openAi).toHaveBeenCalledOnce();
    const [body, refBytes] = r.openAi.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Buffer,
    ];
    expect(body).toMatchObject({ prompt: "a cat in a hat", n: 2 });
    expect(body.ref).toMatch(/\.in\.ref\.webp$/);
    expect(refBytes.toString()).toBe("REF");

    const paths = r.stdout.trim().split("\n");
    expect(paths).toHaveLength(2);
    expect(paths.map((p) => fs.readFileSync(p, "utf-8"))).toEqual([
      "PNG-0",
      "PNG-1",
    ]);
    for (const p of paths)
      expect(p.startsWith(path.join(home, "fleet", "image-gen-outputs"))).toBe(
        true,
      );
    expect(JSON.parse(r.stderr.trim())).toMatchObject({
      model: "gpt-image-1",
      n: 2,
    });
    expect(fs.readdirSync(wireDir())).toEqual([]);
  }, 30_000);

  it("image-gen: schema failure comes back as malformed", async () => {
    const r = await runWithBackend("image-gen", ["x", "--n", "50"]);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe("");
    expect(JSON.parse(r.stderr.trim())).toMatchObject({
      reason: "malformed",
      message: expect.stringMatching(/^n: /),
    });
    expect(r.openAi).not.toHaveBeenCalled();
  }, 30_000);

  it("agent-phone: message from stdin, transcript out", async () => {
    const message = 'Deploy "prod" failed; $HOME is fine.\nCall back?';
    const r = await runWithBackend(
      "agent-phone",
      ["--to", "alice", "--from", "Clipper", "-"],
      message,
    );
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("voice: hello\nuser: got it\n");
    const [, task] = r.placeCall.mock.calls[0] as unknown as [string, string];
    // The prompt template folds newlines into spaces; everything else survives.
    expect(task).toContain('Deploy "prod" failed; $HOME is fine. Call back?');
    expect(JSON.parse(r.stderr.trim())).toMatchObject({
      outcome: "completed",
      call_length_seconds: 9,
    });
    expect(fs.readdirSync(wireDir())).toEqual([]);
  }, 30_000);
});
