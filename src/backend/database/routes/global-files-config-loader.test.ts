import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn() },
}));

import {
  getFilesForHost,
  IMPLICIT_GLOBAL_FILE,
} from "./global-files-config-loader.js";

const host = { id: 7, name: "somebox" };

describe("getFilesForHost — implicit user CLAUDE.md", () => {
  it("returns the implicit entry for a host with no config at all", () => {
    expect(getFilesForHost({ hosts: {} }, host)).toEqual([IMPLICIT_GLOBAL_FILE]);
  });

  it("prepends the implicit entry alongside configured entries", () => {
    const files = getFilesForHost(
      { hosts: { somebox: [{ path: "/etc/foo.conf", label: "Foo" }] } },
      host,
    );
    expect(files).toEqual([
      IMPLICIT_GLOBAL_FILE,
      { path: "/etc/foo.conf", label: "Foo" },
    ]);
  });

  it("does not duplicate the path when the config already names it", () => {
    const files = getFilesForHost(
      { hosts: { somebox: [{ path: "~/.claude/CLAUDE.md", label: "Mine" }] } },
      host,
    );
    expect(files).toEqual([{ path: "~/.claude/CLAUDE.md", label: "Mine" }]);
  });

  it("still resolves via the numeric-id fallback key", () => {
    const files = getFilesForHost(
      { hosts: { "7": [{ path: "/etc/bar.conf" }] } },
      host,
    );
    expect(files).toEqual([IMPLICIT_GLOBAL_FILE, { path: "/etc/bar.conf" }]);
  });
});
