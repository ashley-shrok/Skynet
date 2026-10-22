import { beforeEach, describe, expect, it } from "vitest";
import { isRepeatComposeMqid, resetSeenInputMqidsForTests } from "./seen-input-mqids.js";

describe("isRepeatComposeMqid", () => {
  beforeEach(() => resetSeenInputMqidsForTests());

  it("flags a compose mqid seen again within the window", () => {
    expect(isRepeatComposeMqid("pv-optim-1-a", 1000)).toBe(false);
    expect(isRepeatComposeMqid("pv-optim-1-a", 2000)).toBe(true);
    expect(isRepeatComposeMqid("pv-optim-1-b", 2000)).toBe(false);
  });

  it("forgets a mqid after the window", () => {
    expect(isRepeatComposeMqid("pv-optim-1-a", 0)).toBe(false);
    expect(isRepeatComposeMqid("pv-optim-1-a", 11 * 60 * 1000)).toBe(false);
  });

  it("ignores missing and non-compose mqids", () => {
    expect(isRepeatComposeMqid(undefined)).toBe(false);
    expect(isRepeatComposeMqid("mq-42", 0)).toBe(false);
    expect(isRepeatComposeMqid("mq-42", 1)).toBe(false);
  });
});
