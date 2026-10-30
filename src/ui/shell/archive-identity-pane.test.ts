// The task pill's Archive item and the drop lane's archive zone share this
// confirm; it names the wake-ups that would stop.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { kitConfirmSpy, archiveIdentitySpy } = vi.hoisted(() => ({
  kitConfirmSpy: vi.fn(
    async (_o: { title: string; body: string; ready?: Promise<{ body?: string }> }) => false,
  ),
  archiveIdentitySpy: vi.fn(async () => ({ ok: true })),
}));

vi.mock("@/shell/archive-wakeup-check", async (o) =>
  (await import("@/shell/archive-wakeup-check.test-mocks")).archiveWakeupCheck(o),
);
vi.mock("@/components/kit", () => ({ kitConfirm: kitConfirmSpy, kitAlert: vi.fn() }));
vi.mock("@/api/identity-archive-api", () => ({ archiveIdentity: archiveIdentitySpy }));
vi.mock("@/features/archived-view/archived-identity", () => ({ announceAgentArchived: vi.fn() }));
vi.mock("@/state/identities-store", () => ({ applyIdentityChange: vi.fn() }));
vi.mock("@/state/conversation-store", () => ({
  markPendingArchive: vi.fn(),
  clearPendingArchive: vi.fn(),
  removeFleetSession: vi.fn(),
}));

import { confirmAndArchiveIdentityPane } from "./archive-identity-pane";
import { resetWakeupCheckMock, wakeupCheckMock } from "./archive-wakeup-check.test-mocks";

describe("confirmAndArchiveIdentityPane — wake-ups", () => {
  beforeEach(() => {
    resetWakeupCheckMock();
    kitConfirmSpy.mockClear();
    archiveIdentitySpy.mockClear();
  });

  it("opens the confirm at once; once the check is back it names the wake-ups", async () => {
    wakeupCheckMock.impl = async () => ({
      status: "checked",
      active: [{ slug: "s", name: "Standup check", scheduleHuman: "Daily at 09:00" }],
    });
    const closePane = vi.fn();
    confirmAndArchiveIdentityPane({ hostId: 3, identityKey: "wren", label: "Wren", closePane });
    await vi.waitFor(() => expect(kitConfirmSpy).toHaveBeenCalledTimes(1));
    expect(wakeupCheckMock.calls).toEqual([[3, "wren"]]);
    const o = kitConfirmSpy.mock.calls[0][0];
    expect(o.title).toBe('Archive "Wren"?');
    expect(o.body).toBe(
      "The agent is retired and its conversation leaves the sidebar. You can't undo this here.",
    );
    expect((await o.ready)?.body).toContain(
      "It has 1 wake-up that will never fire again:\n• Standup check — Daily at 09:00",
    );
    expect(closePane).not.toHaveBeenCalled();
    expect(archiveIdentitySpy).not.toHaveBeenCalled();
  });

  it("a second Archive on the same agent while the first is open is ignored", async () => {
    let release!: () => void;
    wakeupCheckMock.impl = () =>
      new Promise((r) => {
        release = () => r({ status: "checked", active: [] });
      });
    kitConfirmSpy.mockImplementation(async () => true);
    const args = { hostId: 3, identityKey: "wren", label: "Wren", closePane: vi.fn() };
    confirmAndArchiveIdentityPane(args);
    confirmAndArchiveIdentityPane(args);
    release();
    await vi.waitFor(() => expect(archiveIdentitySpy).toHaveBeenCalledTimes(1));
    expect(wakeupCheckMock.calls).toHaveLength(1);
    expect(kitConfirmSpy).toHaveBeenCalledTimes(1);
    kitConfirmSpy.mockImplementation(async () => false);
  });

  it("a failed check still archives on yes", async () => {
    wakeupCheckMock.impl = async () => ({ status: "unknown", reason: "timeout" });
    kitConfirmSpy.mockImplementationOnce(async () => true);
    const closePane = vi.fn();
    confirmAndArchiveIdentityPane({ hostId: 3, identityKey: "wren", label: "Wren", closePane });
    await vi.waitFor(() => expect(archiveIdentitySpy).toHaveBeenCalledWith(3, "wren"));
    expect((await kitConfirmSpy.mock.calls[0][0].ready)?.body).toContain("Couldn't check this agent's wake-ups");
    expect(closePane).toHaveBeenCalled();
  });
});
