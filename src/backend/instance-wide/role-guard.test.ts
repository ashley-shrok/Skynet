// instance-wide role guard — fails CLOSED when the write names no host.
import { describe, it, expect, vi, beforeEach } from "vitest";

const engine = {
  isInstanceWide: vi.fn(async () => true),
  markAdminSourced: vi.fn(),
  requestSync: vi.fn(),
};
const machineForHostRow = vi.fn();
vi.mock("./production.js", () => ({
  getInstanceWide: vi.fn(() => engine),
  machineForHostRow: (...a: unknown[]) => machineForHostRow(...a),
}));
const callerIsAdmin = vi.fn();
vi.mock("./admin.js", () => ({
  callerIsAdmin: (...a: unknown[]) => callerIsAdmin(...a),
}));
const warn = vi.fn();
vi.mock("../utils/logger.js", () => ({
  sshLogger: { warn: (...a: unknown[]) => warn(...a), info: vi.fn(), error: vi.fn() },
}));

import { checkInstanceWideRoleWrite } from "./role-guard.js";

const MACHINE = { machineId: "6", hostRowIds: ["6"], local: true };

beforeEach(() => {
  vi.clearAllMocks();
  engine.isInstanceWide.mockResolvedValue(true);
  machineForHostRow.mockResolvedValue(MACHINE);
});

describe("checkInstanceWideRoleWrite — missing hostId", () => {
  it.each([
    ["undefined", undefined],
    ["zero", 0],
    ["NaN", Number.NaN],
    ["negative", -3],
  ])("refuses a %s hostId for a non-admin, logs instance_wide_guard_missing_host", async (_l, hostId) => {
    callerIsAdmin.mockResolvedValue(false);
    const res = await checkInstanceWideRoleWrite("u1", hostId as number | undefined, "box-maintainer");
    expect(res).toEqual({ verdict: "refuse" });
    expect(machineForHostRow).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ operation: "instance_wide_guard_missing_host", userId: "u1", role: "box-maintainer" }),
    );
  });

  it("refuses a missing hostId even for an admin (no silent local-machine sync)", async () => {
    callerIsAdmin.mockResolvedValue(true);
    const res = await checkInstanceWideRoleWrite("admin", undefined, "box-maintainer");
    expect(res).toEqual({ verdict: "refuse" });
    expect(engine.markAdminSourced).not.toHaveBeenCalled();
  });

  it("refuses a missing hostId even when the role is not instance-wide", async () => {
    engine.isInstanceWide.mockResolvedValue(false);
    const res = await checkInstanceWideRoleWrite("u1", undefined, "plain-role");
    expect(res).toEqual({ verdict: "refuse" });
  });
});

describe("checkInstanceWideRoleWrite — with hostId", () => {
  it("non-admin is refused on an instance-wide role of a synced host", async () => {
    callerIsAdmin.mockResolvedValue(false);
    expect(await checkInstanceWideRoleWrite("u1", 6, "box-maintainer")).toEqual({ verdict: "refuse" });
    expect(machineForHostRow).toHaveBeenCalledWith(6);
  });

  it("admin write on a synced host returns admin + marks the machine", async () => {
    callerIsAdmin.mockResolvedValue(true);
    expect(await checkInstanceWideRoleWrite("admin", 6, "box-maintainer")).toEqual({ verdict: "admin", machineId: "6" });
    expect(engine.markAdminSourced).toHaveBeenCalledWith("6");
  });

  it("allows when the role is not instance-wide", async () => {
    engine.isInstanceWide.mockResolvedValue(false);
    expect(await checkInstanceWideRoleWrite("u1", 6, "plain-role")).toEqual({ verdict: "allow" });
  });

  it("allows when the host is not part of instance-wide sync", async () => {
    machineForHostRow.mockResolvedValue(null);
    expect(await checkInstanceWideRoleWrite("u1", 42, "box-maintainer")).toEqual({ verdict: "allow" });
  });
});
