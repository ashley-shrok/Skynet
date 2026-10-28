// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";

vi.mock("../utils/logger.js", () => {
  const l = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() };
  return { sshLogger: l };
});

import { hangUpChannel, HANGUP_GRACE_MS } from "./channel-hangup.js";

function makeChannel(opts: { closesOnTerm?: boolean; signalThrows?: boolean } = {}) {
  const ch = Object.assign(new EventEmitter(), {
    order: [] as string[],
    signal: vi.fn((name: string) => {
      ch.order.push(`signal:${name}`);
      if (opts.signalThrows) throw new Error("unsupported");
      if (opts.closesOnTerm) queueMicrotask(() => ch.emit("close"));
    }),
    close: vi.fn(() => {
      ch.order.push("close");
    }),
    resume: vi.fn(() => {
      ch.order.push("resume");
    }),
  });
  return ch;
}

describe("hangUpChannel", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("server ends the channel on TERM (Tailscale SSH) — never closes from our side", async () => {
    const ch = makeChannel({ closesOnTerm: true });
    hangUpChannel(ch);
    expect(ch.signal).toHaveBeenCalledWith("TERM");
    await vi.advanceTimersByTimeAsync(HANGUP_GRACE_MS * 2);
    expect(ch.close).not.toHaveBeenCalled();
  });

  it("server ignores TERM (OpenSSH) — closes once the grace period is up", () => {
    const ch = makeChannel();
    hangUpChannel(ch);
    vi.advanceTimersByTime(HANGUP_GRACE_MS - 1);
    expect(ch.close).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(ch.close).toHaveBeenCalledTimes(1);
    expect(ch.order).toEqual(["resume", "signal:TERM", "close"]);
  });

  it("a throwing signal still ends in a close", () => {
    const ch = makeChannel({ signalThrows: true });
    expect(() => hangUpChannel(ch)).not.toThrow();
    vi.advanceTimersByTime(HANGUP_GRACE_MS);
    expect(ch.close).toHaveBeenCalledTimes(1);
  });

  it("is idempotent and tolerates a missing channel", () => {
    const ch = makeChannel();
    hangUpChannel(ch);
    hangUpChannel(ch);
    hangUpChannel(null);
    hangUpChannel(undefined);
    vi.advanceTimersByTime(HANGUP_GRACE_MS);
    expect(ch.signal).toHaveBeenCalledTimes(1);
    expect(ch.close).toHaveBeenCalledTimes(1);
  });
});
