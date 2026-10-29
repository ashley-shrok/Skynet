/**
 * dm-recorder.test.ts — an agent's DM becomes a per-user DM mark.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({
  systemLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
const store = { recordDm: vi.fn() };
vi.mock("./read-state-store.js", () => ({
  getReadStateStore: () => store,
  isValidIdentityName: (n: unknown) => typeof n === "string" && n.length > 0 && n.length <= 256,
}));
const publishToUser = vi.fn();
let canUse = true;
vi.mock("../notifications/notifications-access.js", () => ({
  userCanUseNotifications: () => canUse,
}));
vi.mock("../fleet-status/registry-holder.js", () => ({
  getRegistry: () => ({ publishToUser }),
}));

import { publishAgentNotification, recordAgentDm } from "./dm-recorder.js";

beforeEach(() => {
  canUse = true;
  store.recordDm.mockReset();
  publishToUser.mockReset();
});

describe("recordAgentDm", () => {
  it("records under the lowercased mxid local-part and tells the user's tabs", () => {
    const entry = { hostId: "7", identityName: "aspen-box-maintainer-3", lastDmAt: 1000, seenDmAt: 0 };
    store.recordDm.mockReturnValue(entry);
    recordAgentDm("u1", 7, "@Aspen-Box-Maintainer-3:t1000.example", 1000);
    expect(store.recordDm).toHaveBeenCalledWith("u1", "7", "aspen-box-maintainer-3", 1000);
    expect(publishToUser).toHaveBeenCalledWith("u1", { schemaVersion: 1, type: "dm-state-changed", ...entry });
  });

  it("does not push when the DM was already recorded", () => {
    store.recordDm.mockReturnValue(null);
    recordAgentDm("u1", 7, "@aspen:server", 1000);
    expect(publishToUser).not.toHaveBeenCalled();
  });

  it("ignores a malformed mxid", () => {
    recordAgentDm("u1", 7, "not-an-mxid", 1000);
    expect(store.recordDm).not.toHaveBeenCalled();
  });
});

describe("publishAgentNotification", () => {
  it("sends the words to the user's tabs, keyed by conversation", () => {
    publishAgentNotification("u1", {
      notificationId: "$ev1",
      agentMxid: "@Aspen:t1000.example",
      hostId: 7,
      title: "Aspen",
      body: "Done — the deploy is live.",
    });
    expect(publishToUser).toHaveBeenCalledWith("u1", {
      schemaVersion: 1,
      type: "agent-notified",
      notificationId: "$ev1",
      hostId: "7",
      identityName: "aspen",
      agentMxid: "@Aspen:t1000.example",
      title: "Aspen",
      body: "Done — the deploy is live.",
    });
  });

  it("sends nothing to a user without notifications access", () => {
    canUse = false;
    publishAgentNotification("u1", { notificationId: "$e", agentMxid: "@aspen:s", hostId: 7, title: "x", body: "y" });
    expect(publishToUser).not.toHaveBeenCalled();
  });

  it("ignores a malformed mxid", () => {
    publishAgentNotification("u1", { notificationId: "$e", agentMxid: "nope", hostId: 7, title: "x", body: "y" });
    expect(publishToUser).not.toHaveBeenCalled();
  });
});
