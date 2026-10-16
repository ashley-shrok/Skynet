import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import type { Client } from "ssh2";
import {
  DEFAULT_EXEC_TIMEOUT_MS,
  ExecTimeoutError,
  execCommand,
  execCommandWithStdin,
} from "./tmux-helper.js";

// Regression: an execCommand promise that is dropped by the losing side of a
// Promise.race([exec, timeout]) must NOT trigger process 'unhandledRejection'.
// Otherwise starter.ts's unhandledRejection handler calls process.exit(1) and
// the whole backend crashes any time an SSH channel closes with code=undefined
// after a race timeout wins — which is exactly the shape of a normal channel
// teardown during a mid-flight browser disconnect.

// Minimal fake ssh2 stream that a caller can trigger to close with a given
// exit code. Extends EventEmitter for on/data/error/close plumbing; adds
// stderr as its own EventEmitter (matches ssh2's ClientChannel shape).
class FakeStream extends EventEmitter {
  stderr = new EventEmitter();
}

// Minimal fake ssh2 Client whose .exec callback we can drive from a test.
// Only implements the surface execCommand/execCommandWithStdin need.
// `closeDelayMs` controls when the fake stream fires its "close" event so
// tests can simulate a race timeout winning BEFORE the exec finishes.
function makeFakeClient(
  driver: (stream: FakeStream) => void,
  closeDelayMs = 0,
): Client {
  return {
    exec(_cmd: string, cb: (err: Error | null, stream: FakeStream) => void) {
      const stream = new FakeStream();
      queueMicrotask(() => {
        cb(null, stream);
        if (closeDelayMs > 0) {
          setTimeout(() => driver(stream), closeDelayMs);
        } else {
          queueMicrotask(() => driver(stream));
        }
      });
    },
  } as unknown as Client;
}

describe("execCommand — unhandled-rejection guard", () => {
  it("does not trigger process 'unhandledRejection' when the promise is orphaned by a race timeout", async () => {
    const seenReasons: unknown[] = [];
    const handler = (reason: unknown) => seenReasons.push(reason);
    process.on("unhandledRejection", handler);

    try {
      // Close with code=undefined + no stdout → rejects with
      // "Command exited with code undefined" — the exact crash shape.
      // Delay the close so the race timeout wins first and the exec promise
      // is orphaned when it later rejects.
      const client = makeFakeClient((stream) => {
        stream.emit("close", undefined as unknown as number);
      }, 20);

      // Simulate the classic Promise.race([exec, timeout]) shape where the
      // timeout wins and the exec promise is left to reject later, unattended.
      const raced = await Promise.race([
        execCommand(client, "some command that will 'close' with no code"),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("race timeout")), 5),
        ),
      ]).catch((err) => err);

      expect(raced).toBeInstanceOf(Error);
      expect((raced as Error).message).toBe("race timeout");

      // Give any late rejection a chance to bubble up to the unhandledRejection
      // handler if the guard is broken.
      await new Promise((r) => setTimeout(r, 30));

      expect(seenReasons).toEqual([]);
    } finally {
      process.off("unhandledRejection", handler);
    }
  });

  it("does not trigger 'unhandledRejection' when the promise is truly fire-and-forget (no await, no race)", async () => {
    const seenReasons: unknown[] = [];
    const handler = (reason: unknown) => seenReasons.push(reason);
    process.on("unhandledRejection", handler);

    try {
      const client = makeFakeClient((stream) => {
        stream.emit("close", undefined as unknown as number);
      });
      // No await, no .catch — the promise is orphaned from the moment it
      // returns. Without the source-level guard this fires unhandledRejection.
      void execCommand(client, "fire and forget");
      await new Promise((r) => setTimeout(r, 30));
      expect(seenReasons).toEqual([]);
    } finally {
      process.off("unhandledRejection", handler);
    }
  });

  it("still surfaces the rejection to callers that await normally", async () => {
    const client = makeFakeClient((stream) => {
      stream.emit("close", undefined as unknown as number);
    });
    await expect(execCommand(client, "will fail")).rejects.toThrow(
      "Command exited with code undefined",
    );
  });
});

describe("execCommandWithStdin — unhandled-rejection guard", () => {
  it("does not trigger process 'unhandledRejection' when orphaned by a race timeout", async () => {
    const seenReasons: unknown[] = [];
    const handler = (reason: unknown) => seenReasons.push(reason);
    process.on("unhandledRejection", handler);

    try {
      // Fake stream with an .end() so execCommandWithStdin's stream.end(body)
      // call doesn't blow up. Delay close so the race timeout wins first.
      const client = {
        exec(_cmd: string, cb: (err: Error | null, stream: unknown) => void) {
          const stream = Object.assign(new FakeStream(), {
            end: (_body: Buffer) => {
              /* no-op */
            },
          });
          queueMicrotask(() => {
            cb(null, stream);
            setTimeout(() => {
              stream.emit("close", undefined as unknown as number);
            }, 20);
          });
        },
      } as unknown as Client;

      const raced = await Promise.race([
        execCommandWithStdin(client, "stdin cmd", Buffer.from("payload")),
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error("race timeout")), 5),
        ),
      ]).catch((err) => err);

      expect(raced).toBeInstanceOf(Error);
      expect((raced as Error).message).toBe("race timeout");
      await new Promise((r) => setTimeout(r, 30));
      expect(seenReasons).toEqual([]);
    } finally {
      process.off("unhandledRejection", handler);
    }
  });
});

describe("exec timeout", () => {
  class ClosableStream extends FakeStream {
    closed = 0;
    close() {
      this.closed++;
      queueMicrotask(() => this.emit("close", undefined as unknown as number));
    }
    end() {}
  }

  // `openAfterMs` < 0 = sshd never answers the channel open.
  function makeStuckClient(openAfterMs: number): { client: Client; streams: ClosableStream[] } {
    const streams: ClosableStream[] = [];
    const client = {
      exec(_cmd: string, cb: (err: Error | null, stream: ClosableStream) => void) {
        if (openAfterMs < 0) return;
        setTimeout(() => {
          const s = new ClosableStream();
          streams.push(s);
          cb(null, s);
        }, openAfterMs);
      },
    } as unknown as Client;
    return { client, streams };
  }

  it("rejects with phase=open when the channel never opens", async () => {
    const { client } = makeStuckClient(-1);
    const err = await execCommand(client, "true", { timeoutMs: 20 }).catch((e) => e);
    expect(err).toBeInstanceOf(ExecTimeoutError);
    expect(err.phase).toBe("open");
  });

  it("rejects with phase=run and closes the channel when the command never exits", async () => {
    const { client, streams } = makeStuckClient(0);
    const err = await execCommand(client, "sleep 999", { timeoutMs: 30 }).catch((e) => e);
    expect(err).toBeInstanceOf(ExecTimeoutError);
    expect(err.phase).toBe("run");
    expect(streams[0].closed).toBe(1);
  });

  it("closes a channel that opens after the timeout already fired", async () => {
    const { client, streams } = makeStuckClient(40);
    const err = await execCommand(client, "true", { timeoutMs: 10 }).catch((e) => e);
    expect(err.phase).toBe("open");
    await new Promise((r) => setTimeout(r, 60));
    expect(streams).toHaveLength(1);
    expect(streams[0].closed).toBe(1);
  });

  it("does not fire once the command has finished", async () => {
    const client = makeFakeClient((stream) => {
      stream.emit("data", Buffer.from("ok\n"));
      stream.emit("close", 0);
    });
    await expect(execCommand(client, "echo ok", { timeoutMs: 30 })).resolves.toBe("ok");
    await new Promise((r) => setTimeout(r, 50));
  });

  it("execCommandWithStdin times out the same way", async () => {
    const { client, streams } = makeStuckClient(0);
    const err = await execCommandWithStdin(client, "cat", Buffer.from("x"), { timeoutMs: 30 }).catch((e) => e);
    expect(err).toBeInstanceOf(ExecTimeoutError);
    expect(err.phase).toBe("run");
    expect(streams[0].closed).toBe(1);
  });

  it("defaults to a ceiling above the harness attempt deadline", () => {
    expect(DEFAULT_EXEC_TIMEOUT_MS).toBeGreaterThan(20 * 60 * 1000);
  });
});
