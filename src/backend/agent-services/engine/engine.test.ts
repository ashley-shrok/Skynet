import { describe, it, expect, vi } from "vitest";
import { z } from "zod";

vi.mock("../../utils/logger.js", () => {
  const stub = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    success: vi.fn(),
  };
  return { systemLogger: stub, sshLogger: stub };
});

import { createAgentServiceEngine } from "./engine.js";
import type { HostRequestIo, OutgoingFile } from "./host-io.js";
import { defineService, fail, ok, type ServiceDefinition } from "./types.js";

const UUID = "0b5c2f9e-1a2b-4c3d-8e9f-001122334455";
const HOST = { id: "7", idNum: 7 };
const NOW = Date.parse("2026-10-08T12:00:00Z");

interface Written {
  hostIdNum: number;
  uuid: string;
  files: OutgoingFile[];
  responseFilename: string;
  response: Record<string, any>;
}

function setup(
  services: ServiceDefinition[],
  opts: { env?: Record<string, string>; now?: number } = {},
) {
  const written: Written[] = [];
  let done: () => void = () => {};
  const engine = createAgentServiceEngine({
    services,
    now: () => opts.now ?? NOW,
    env: opts.env ?? {},
    writeResponse: async (hostIdNum, uuid, files, responseFilename, json) => {
      written.push({
        hostIdNum,
        uuid,
        files,
        responseFilename,
        response: JSON.parse(json),
      });
      done();
    },
  });
  const io = (
    attachments: Record<string, Buffer | "missing" | "too_large"> = {},
  ): HostRequestIo => ({
    claim: async () => [],
    readAttachment: async (filename) => attachments[filename] ?? "missing",
  });
  /** Submit one request and wait for its response. */
  const submit = async (
    body: unknown,
    attachments?: Record<string, Buffer | "missing" | "too_large">,
  ) => {
    const answered = new Promise<void>((r) => (done = r));
    await engine.intake(HOST, io(attachments), [
      {
        uuid: UUID,
        body: typeof body === "string" ? body : JSON.stringify(body),
      },
    ]);
    await answered;
    return written[written.length - 1];
  };
  return { engine, written, submit };
}

const echo = defineService({
  name: "echo",
  description: "test",
  input: z.strictObject({ text: z.string().min(1) }),
  ttlMs: 60_000,
  async handle(input, ctx) {
    return ok({ text: input.text, host: ctx.host.idNum });
  },
});

const envelope = (input: unknown, extra: Record<string, unknown> = {}) => ({
  service: "echo",
  requested_at: new Date(NOW - 1000).toISOString(),
  input,
  ...extra,
});

describe("agent-services engine", () => {
  it("runs the handler and writes the response to the origin host", async () => {
    const { submit } = setup([echo]);
    const w = await submit(envelope({ text: "hi" }));
    expect(w.hostIdNum).toBe(7);
    expect(w.uuid).toBe(UUID);
    expect(w.responseFilename).toBe(`${UUID}.response.json`);
    expect(w.response).toEqual({
      ok: true,
      service: "echo",
      result: { text: "hi", host: 7 },
      files: [],
    });
  });

  it("writes output files under <uuid>.out.<i>.<ext> and lists them", async () => {
    const svc = defineService({
      ...echo,
      handle: async () =>
        ok({}, [
          { ext: "png", bytes: Buffer.from("a") },
          { ext: "txt", bytes: Buffer.from("b") },
        ]),
    });
    const w = await setup([svc]).submit(envelope({ text: "x" }));
    expect(w.files.map((f) => f.filename)).toEqual([
      `${UUID}.out.0.png`,
      `${UUID}.out.1.txt`,
    ]);
    expect(w.response.files).toEqual([
      `${UUID}.out.0.png`,
      `${UUID}.out.1.txt`,
    ]);
  });

  it("passes service failures through with details merged", async () => {
    const svc = defineService({
      ...echo,
      handle: async () => fail("busy", "line busy", { seconds: 4 }),
    });
    const w = await setup([svc]).submit(envelope({ text: "x" }));
    expect(w.response).toEqual({
      ok: false,
      service: "echo",
      error: { code: "busy", message: "line busy", seconds: 4 },
    });
  });

  it.each([
    ["a broken envelope", "{nope", null, /invalid JSON/],
    [
      "an unknown service",
      { ...envelope({}), service: "nope" },
      "nope",
      /no agent service named "nope"/,
    ],
  ])(
    "answers %s without running anything",
    async (_n, body, service, message) => {
      const code = service === "nope" ? "unknown_service" : "malformed";
      const w = await setup([echo]).submit(body);
      expect(w.response.ok).toBe(false);
      expect(w.response.service).toBe(service);
      expect(w.response.error.code).toBe(code);
      expect(w.response.error.message).toMatch(message);
    },
  );

  it("rejects input that fails the schema, naming the field", async () => {
    const handle = vi.fn();
    const w = await setup([{ ...echo, handle }]).submit(envelope({ text: "" }));
    expect(w.response.error.code).toBe("malformed");
    expect(w.response.error.message).toMatch(/^text: /);
    expect(handle).not.toHaveBeenCalled();
  });

  it("rejects unknown input fields via strictObject", async () => {
    const w = await setup([echo]).submit(envelope({ text: "x", txet: "typo" }));
    expect(w.response.error.code).toBe("malformed");
    expect(w.response.error.message).toMatch(/txet/);
  });

  it("answers expired when dequeued past the TTL", async () => {
    const handle = vi.fn();
    const w = await setup([{ ...echo, handle }], { now: NOW + 120_000 }).submit(
      envelope({ text: "x" }),
    );
    expect(w.response.error.code).toBe("expired");
    expect(handle).not.toHaveBeenCalled();
  });

  it("answers not_configured when a declared secret is unset, and passes it when set", async () => {
    const seen: Record<string, string>[] = [];
    const svc = defineService({
      ...echo,
      secrets: ["API_KEY"],
      handle: async (_i, ctx) => {
        seen.push(ctx.secrets);
        return ok({});
      },
    });
    const missing = await setup([svc]).submit(envelope({ text: "x" }));
    expect(missing.response.error).toEqual({
      code: "not_configured",
      message: "API_KEY is not set on the Skynet backend",
    });
    await setup([svc], { env: { API_KEY: "k" } }).submit(
      envelope({ text: "x" }),
    );
    expect(seen).toEqual([{ API_KEY: "k" }]);
  });

  it("answers internal when the handler throws", async () => {
    const svc = defineService({
      ...echo,
      handle: async () => {
        throw new Error("kaboom");
      },
    });
    const w = await setup([svc]).submit(envelope({ text: "x" }));
    expect(w.response.error).toEqual({ code: "internal", message: "kaboom" });
  });

  describe("attachments", () => {
    const withRef = defineService({
      ...echo,
      attachments: { ref: { extensions: ["png"], maxBytes: 10 } },
      handle: async (_i, ctx) =>
        ok({ got: ctx.attachments.ref?.bytes.toString() ?? null }),
    });
    const ref = `${UUID}.in.ref.png`;

    it("reads declared attachments and hands them to the handler", async () => {
      const w = await setup([withRef]).submit(
        envelope({ text: "x" }, { attachments: { ref } }),
        {
          [ref]: Buffer.from("img"),
        },
      );
      expect(w.response.result).toEqual({ got: "img" });
    });

    it.each([
      [
        "an undeclared slot",
        { other: `${UUID}.in.other.png` },
        {},
        /unexpected attachment: other/,
      ],
      [
        "a foreign request's file",
        { ref: "7d1e2f3a-4b5c-4d6e-9f00-aabbccddeeff.in.ref.png" },
        {},
        /must be named/,
      ],
      ["a missing file", { ref }, {}, /missing or empty/],
      [
        "an oversized file",
        { ref },
        { [ref]: "too_large" as const },
        /exceeds 10 bytes/,
      ],
    ])("rejects %s", async (_n, attachments, files, message) => {
      const w = await setup([withRef]).submit(
        envelope({ text: "x" }, { attachments }),
        files,
      );
      expect(w.response.error.code).toBe("malformed");
      expect(w.response.error.message).toMatch(message);
    });

    it("rejects a request missing a required attachment", async () => {
      const svc = {
        ...withRef,
        attachments: {
          ref: { extensions: ["png"], maxBytes: 10, required: true },
        },
      };
      const w = await setup([svc]).submit(envelope({ text: "x" }));
      expect(w.response.error.message).toMatch(/ref is required/);
    });
  });

  it("answers queue_full past maxQueueDepth", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const svc = defineService({
      ...echo,
      maxQueueDepth: 1,
      handle: async () => {
        await gate;
        return ok({});
      },
    });
    const { engine, written } = setup([svc]);
    const io: HostRequestIo = {
      claim: async () => [],
      readAttachment: async () => "missing",
    };
    const body = JSON.stringify(envelope({ text: "x" }));
    const uuids = ["a", "b", "c"].map(
      (c) => `${c.repeat(8)}-1111-4111-8111-111111111111`,
    );
    await engine.intake(
      HOST,
      io,
      uuids.map((uuid) => ({ uuid, body })),
    );
    // one running, one pending, one rejected
    expect(written.map((w) => [w.uuid, w.response.error?.code])).toEqual([
      [uuids[2], "queue_full"],
    ]);
    release();
  });

  it("waits on the rate limiter before calling the handler", async () => {
    const acquire = vi.fn(async () => {});
    const createTokenBucket = vi.fn(() => ({
      acquire,
      getState: () => ({}) as any,
    }));
    const svc = defineService({ ...echo, rateLimitPerMinute: () => 12 });
    const written: unknown[] = [];
    let done!: () => void;
    const answered = new Promise<void>((r) => (done = r));
    const engine = createAgentServiceEngine({
      services: [svc],
      now: () => NOW,
      env: {},
      createTokenBucket,
      writeResponse: async (...args) => {
        written.push(args);
        done();
      },
    });
    await engine.intake(
      HOST,
      { claim: async () => [], readAttachment: async () => "missing" },
      [{ uuid: UUID, body: JSON.stringify(envelope({ text: "x" })) }],
    );
    await answered;
    expect(createTokenBucket).toHaveBeenCalledWith(12);
    expect(acquire).toHaveBeenCalledOnce();
  });

  it("refuses duplicate service names", () => {
    expect(() => setup([echo, echo])).toThrow(/duplicate/);
  });
});
