// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";

const engine = {
  isInstanceWide: vi.fn(async () => false),
  findClashes: vi.fn(async () => ({ clashes: [] as string[], unreachable: [] as string[] })),
  createItem: vi.fn(async () => {}),
  masterStore: { statFile: vi.fn(async () => ({ mtime: 5 })) },
};
vi.mock("./production.js", () => ({ getInstanceWide: () => engine }));
vi.mock("./admin.js", () => ({ callerIsAdmin: vi.fn(async () => true) }));

const { createInstanceSkill } = await import("./skill-files.js");

function call(body: Record<string, unknown>) {
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(c: number) {
      this.statusCode = c;
      return this;
    },
    json(b: unknown) {
      this.body = b;
      return this;
    },
  };
  return createInstanceSkill(
    { query: {}, body, userId: "u1" } as unknown as Request,
    res as unknown as Response,
    (slug, d) => `---\nname: ${slug}\ndescription: ${d}\n---\n`,
  ).then(() => res);
}

describe("createInstanceSkill (new shared skill)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates it when no machine has a skill by that name", async () => {
    const res = await call({ hostId: 0, skill: "deploy", description: "Ships it" });
    expect(res.statusCode).toBe(200);
    expect(engine.createItem).toHaveBeenCalled();
  });

  it("refuses when a machine already has one — sharing would replace it, no copy kept", async () => {
    engine.findClashes.mockResolvedValueOnce({ clashes: ["bob-laptop"], unreachable: [] });
    const res = await call({ hostId: 0, skill: "deploy", description: "Ships it" });
    expect(res.statusCode).toBe(409);
    expect(res.body).toMatchObject({ code: "clashes", clashes: ["bob-laptop"] });
    expect(engine.createItem).not.toHaveBeenCalled();
  });

  it("refuses when a machine couldn't be checked", async () => {
    engine.findClashes.mockResolvedValueOnce({ clashes: [], unreachable: ["thenasty"] });
    const res = await call({ hostId: 0, skill: "deploy", description: "Ships it" });
    expect(res.statusCode).toBe(409);
    expect(engine.createItem).not.toHaveBeenCalled();
  });

  it("refuses a blocked command name — it would be refused when typed in the composer", async () => {
    const res = await call({ hostId: 0, skill: "compact", description: "Squash it" });
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "That name can't be used for a skill." });
    expect(engine.createItem).not.toHaveBeenCalled();
  });
});
