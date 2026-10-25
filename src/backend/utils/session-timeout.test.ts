import { describe, it, expect, vi, beforeEach } from "vitest";

const setting = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("../database/db/index.js", () => ({
  db: {
    $client: {
      prepare: () => ({
        get: () => (setting.value === undefined ? undefined : { value: setting.value }),
      }),
    },
  },
}));

import { getSessionTimeoutHours, getSessionlessTokenHours } from "./session-timeout.js";

describe("sign-in length", () => {
  beforeEach(() => {
    setting.value = undefined;
  });

  it("is 30 days when the admin hasn't set one", () => {
    expect(getSessionTimeoutHours()).toBe(720);
  });

  it("follows the admin setting", () => {
    setting.value = "48";
    expect(getSessionTimeoutHours()).toBe(48);
  });

  it("ignores a broken setting", () => {
    setting.value = "nonsense";
    expect(getSessionTimeoutHours()).toBe(720);
  });

  it("keeps the server's own internal tokens at their old 20 hours", () => {
    expect(getSessionlessTokenHours()).toBe(20);
    setting.value = "48";
    expect(getSessionlessTokenHours()).toBe(48);
  });
});
