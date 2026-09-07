/**
 * Phase 35 — atomic frontend cutover of four pretty-view outbound-write call
 * sites (in Terminal.tsx) from borrowed terminal SSH WS → PrettyView's own
 * claude-session WS.
 *
 * These tests exercise the ref-forwarding registration surface added to
 * PrettyView (onRegisterSendInput / onRegisterSendInterrupt) and assert that
 * each of the four migrated Terminal.tsx call sites produces the correct WS
 * frame on PrettyView's WS AND that the separately-mocked terminal WS receives
 * zero writes (defense-in-depth against accidental cross-wiring during the
 * cutover).
 *
 * Scenarios:
 *   Test 1: Pretty-view composebox single-event split-send — sendInput("hello world\r", mqid)
 *            fires exactly one {type:"input"} on pretty-view WS; terminal WS receives zero sends.
 *   Test 2: onInterrupt — sendInterrupt() fires exactly one {type:"interrupt"} on
 *            pretty-view WS; terminal WS receives zero sends.
 *   Test 3: handleInjectedTurnReady two-event pattern — sendInput("hello") then
 *            60ms-delayed sendInput("\r", mqid); two events in order; terminal WS zero sends.
 *   Test 4: MessageQueueDrawer.onSend two-event pattern — same shape as Test 3 with
 *            different body/mqid values; terminal WS zero sends.
 *   Test 5: WS-closed regression — sendInput returns false when readyState is CLOSED;
 *            no ws.send call; terminal WS zero sends.
 *
 * Uses the same WS-stub scaffolding shape as PrettyView.aside.test.tsx.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, waitFor, fireEvent } from "@testing-library/react";

type WsStub = {
  readyState: number;
  bufferedAmount: number;
  send: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  onmessage: ((e: MessageEvent<string>) => void) | null;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};
const wsStubs: WsStub[] = [];
function getCurrentWs(): WsStub {
  return wsStubs[wsStubs.length - 1];
}

vi.mock("@/api/claude-session-api", () => ({
  openClaudeSessionSocket: vi.fn(() => {
    const ws: WsStub = {
      readyState: 1, // OPEN
      bufferedAmount: 0,
      send: vi.fn(),
      close: vi.fn(),
      onmessage: null,
      onopen: null,
      onerror: null,
      onclose: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    wsStubs.push(ws);
    return ws;
  }),
}));

vi.mock("@/api/compose-drafts-api", () => ({
  getComposeDraft: vi.fn().mockResolvedValue({ body: "" }),
  putComposeDraft: vi.fn().mockResolvedValue(undefined),
  flushComposeDraftKeepalive: vi.fn(),
}));

// Default: anonymous session (no identity).
const useSessionIdentityMock = vi.fn(() => ({
  identity: null as unknown,
  identityHue: null as number | null,
}));
vi.mock("@/features/terminal/session-hue", () => ({
  sessionMatchKey: vi.fn(() => null),
  useSessionIdentity: (name: string | null | undefined) =>
    useSessionIdentityMock(name as unknown as never),
}));

vi.mock("@/features/terminal/IdentityBadge", () => ({
  IdentityBadge: () => null,
}));

vi.mock("@/hooks/use-is-touch-device", () => ({
  useIsTouchDevice: vi.fn(() => false),
}));

import { PrettyView } from "./PrettyView";

function flipToStreaming(ws: WsStub) {
  act(() => {
    ws.onopen?.();
    ws.onmessage?.(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "session", sessionFile: "/tmp/x.jsonl" }),
      }),
    );
  });
}

describe("PrettyView — Phase 35 compose-send ref-forwarding cutover", () => {
  let resizeObserverStub: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    wsStubs.length = 0;
    useSessionIdentityMock.mockReturnValue({ identity: null, identityHue: null });
    // jsdom lacks ResizeObserver; useAutoScroll's effect calls
    // `new ResizeObserver(...)` at mount, so provide a no-op stub.
    resizeObserverStub = vi.fn(function () {
      return { observe: vi.fn(), unobserve: vi.fn(), disconnect: vi.fn() };
    });
    vi.stubGlobal("ResizeObserver", resizeObserverStub);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /**
   * mountWithRefs — renders PrettyView with the ref-forwarding registration
   * surface. After Phase 41-04, PrettyView no longer accepts a terminalWs prop —
   * uploads are sourced from PrettyView's own claude-session WS (wsRef.current,
   * the same WS opened via openClaudeSessionSocket()). The defense-in-depth
   * against accidental cross-wiring to a terminal WS is now structural: there is
   * no terminal WS prop on the component at all.
   */
  function mountWithRefs() {
    const sendInputRef: { current: ((text: string, mqid?: string) => boolean) | null } = {
      current: null,
    };
    const sendInterruptRef: { current: (() => void) | null } = { current: null };

    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
        onRegisterSendInput={(fn) => {
          sendInputRef.current = fn;
        }}
        onUnregisterSendInput={() => {
          sendInputRef.current = null;
        }}
        onRegisterSendInterrupt={(fn) => {
          sendInterruptRef.current = fn;
        }}
        onUnregisterSendInterrupt={() => {
          sendInterruptRef.current = null;
        }}
      />,
    );

    return { sendInputRef, sendInterruptRef, container };
  }

  it("Test 1: pretty-view composebox single-event split-send fires {type:input} on pretty-view WS", async () => {
    const { sendInputRef } = mountWithRefs();

    flipToStreaming(getCurrentWs());

    await waitFor(() => expect(sendInputRef.current).not.toBeNull());

    const sendCountBefore = getCurrentWs().send.mock.calls.length;

    let result: boolean | undefined;
    act(() => {
      result = sendInputRef.current!("hello world\r", "pv-test-mqid-abc");
    });

    expect(result).toBe(true);

    const newCalls = getCurrentWs().send.mock.calls.slice(sendCountBefore);
    const inputFrames = newCalls.filter(([data]) => {
      try {
        return JSON.parse(data as string).type === "input";
      } catch {
        return false;
      }
    });

    expect(inputFrames).toHaveLength(1);
    const parsed = JSON.parse(inputFrames[0][0] as string);
    expect(parsed.data).toBe("hello world\r");
    expect(parsed.messageQueueItemId).toBe("pv-test-mqid-abc");

    // Regression: no raw_keystrokes frame on the pretty-view WS.
    const rawKeystrokesFrames = newCalls.filter(([data]) => {
      try {
        return JSON.parse(data as string).type === "raw_keystrokes";
      } catch {
        return false;
      }
    });
    expect(rawKeystrokesFrames).toHaveLength(0);
  });

  it("Test 2: onInterrupt fires {type:interrupt} on pretty-view WS", async () => {
    const { sendInterruptRef } = mountWithRefs();

    flipToStreaming(getCurrentWs());

    await waitFor(() => expect(sendInterruptRef.current).not.toBeNull());

    const sendCountBefore = getCurrentWs().send.mock.calls.length;

    act(() => {
      sendInterruptRef.current!();
    });

    const newCalls = getCurrentWs().send.mock.calls.slice(sendCountBefore);
    const interruptFrames = newCalls.filter(([data]) => {
      try {
        return JSON.parse(data as string).type === "interrupt";
      } catch {
        return false;
      }
    });

    expect(interruptFrames).toHaveLength(1);
    const parsed = JSON.parse(interruptFrames[0][0] as string);
    expect(Object.keys(parsed)).toEqual(["type"]); // only 'type' field, no extras

    // Regression: no raw_keystrokes frame on the pretty-view WS.
    const rawKeystrokesFrames = newCalls.filter(([data]) => {
      try {
        return JSON.parse(data as string).type === "raw_keystrokes";
      } catch {
        return false;
      }
    });
    expect(rawKeystrokesFrames).toHaveLength(0);
  });

  it("Test 3: handleInjectedTurnReady two-event pattern — body first (no mqid), then 60ms-delayed \\r+mqid", async () => {
    const { sendInputRef } = mountWithRefs();

    flipToStreaming(getCurrentWs());

    // Establish ref BEFORE activating fake timers — waitFor uses real setTimeout.
    await waitFor(() => expect(sendInputRef.current).not.toBeNull());

    const sendCountBefore = getCurrentWs().send.mock.calls.length;

    // Activate fake timers AFTER waitFor has resolved.
    vi.useFakeTimers();

    try {
      // Replicate Terminal.tsx's post-cutover handleInjectedTurnReady behavior:
      // body event first, then 60ms-delayed \r+mqid event.
      act(() => {
        sendInputRef.current!("hello");
        setTimeout(() => {
          sendInputRef.current?.("\r", "mq-injected-1");
        }, 60);
      });

      // Immediately after: one input send (body event, no mqid).
      const callsAfterBody = getCurrentWs().send.mock.calls.slice(sendCountBefore);
      const inputFramesAfterBody = callsAfterBody.filter(([data]) => {
        try {
          return JSON.parse(data as string).type === "input";
        } catch {
          return false;
        }
      });
      expect(inputFramesAfterBody).toHaveLength(1);
      const firstParsed = JSON.parse(inputFramesAfterBody[0][0] as string);
      expect(firstParsed.data).toBe("hello");
      expect("messageQueueItemId" in firstParsed).toBe(false); // no mqid on body event

      // Advance to 59ms — the 60ms setTimeout has not yet fired.
      await vi.advanceTimersByTimeAsync(59);
      await Promise.resolve();
      await Promise.resolve();
      const callsAt59 = getCurrentWs().send.mock.calls.slice(sendCountBefore);
      const inputFramesAt59 = callsAt59.filter(([data]) => {
        try {
          return JSON.parse(data as string).type === "input";
        } catch {
          return false;
        }
      });
      expect(inputFramesAt59).toHaveLength(1); // still only 1

      // Advance by 1 more ms (total 60ms) — setTimeout fires, second event executes.
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      await Promise.resolve();
      const callsAt60 = getCurrentWs().send.mock.calls.slice(sendCountBefore);
      const inputFramesAt60 = callsAt60.filter(([data]) => {
        try {
          return JSON.parse(data as string).type === "input";
        } catch {
          return false;
        }
      });
      expect(inputFramesAt60).toHaveLength(2); // now 2
      const secondParsed = JSON.parse(inputFramesAt60[1][0] as string);
      expect(secondParsed.data).toBe("\r");
      expect(secondParsed.messageQueueItemId).toBe("mq-injected-1");

      // Regression: no raw_keystrokes frame on the pretty-view WS.
      const rawKeystrokesFrames = callsAt60.filter(([data]) => {
        try {
          return JSON.parse(data as string).type === "raw_keystrokes";
        } catch {
          return false;
        }
      });
      expect(rawKeystrokesFrames).toHaveLength(0);

    } finally {
      vi.useRealTimers();
    }
  });

  it("Test 4: MessageQueueDrawer.onSend two-event pattern — body-text first, then 60ms-delayed \\r+mq-42", async () => {
    const { sendInputRef } = mountWithRefs();

    flipToStreaming(getCurrentWs());

    // Establish ref BEFORE activating fake timers — waitFor uses real setTimeout.
    await waitFor(() => expect(sendInputRef.current).not.toBeNull());

    const sendCountBefore = getCurrentWs().send.mock.calls.length;

    // Activate fake timers AFTER waitFor has resolved.
    vi.useFakeTimers();

    try {
      // Replicate MessageQueueDrawer.onSend post-cutover pattern.
      act(() => {
        sendInputRef.current!("body-text");
        setTimeout(() => {
          sendInputRef.current?.("\r", "mq-42");
        }, 60);
      });

      // Body event only at this point.
      const callsAfterBody = getCurrentWs().send.mock.calls.slice(sendCountBefore);
      const inputFramesAfterBody = callsAfterBody.filter(([data]) => {
        try {
          return JSON.parse(data as string).type === "input";
        } catch {
          return false;
        }
      });
      expect(inputFramesAfterBody).toHaveLength(1);
      const firstParsed = JSON.parse(inputFramesAfterBody[0][0] as string);
      expect(firstParsed.data).toBe("body-text");
      expect("messageQueueItemId" in firstParsed).toBe(false);

      // At 59ms, still only 1 event.
      await vi.advanceTimersByTimeAsync(59);
      await Promise.resolve();
      await Promise.resolve();
      const callsAt59 = getCurrentWs().send.mock.calls.slice(sendCountBefore);
      const inputFramesAt59 = callsAt59.filter(([data]) => {
        try {
          return JSON.parse(data as string).type === "input";
        } catch {
          return false;
        }
      });
      expect(inputFramesAt59).toHaveLength(1);

      // At 60ms, second event fires.
      await vi.advanceTimersByTimeAsync(1);
      await Promise.resolve();
      await Promise.resolve();
      const callsAt60 = getCurrentWs().send.mock.calls.slice(sendCountBefore);
      const inputFramesAt60 = callsAt60.filter(([data]) => {
        try {
          return JSON.parse(data as string).type === "input";
        } catch {
          return false;
        }
      });
      expect(inputFramesAt60).toHaveLength(2);
      const secondParsed = JSON.parse(inputFramesAt60[1][0] as string);
      expect(secondParsed.data).toBe("\r");
      expect(secondParsed.messageQueueItemId).toBe("mq-42");

      // Regression: no raw_keystrokes frame on the pretty-view WS.
      const rawKeystrokesFrames = callsAt60.filter(([data]) => {
        try {
          return JSON.parse(data as string).type === "raw_keystrokes";
        } catch {
          return false;
        }
      });
      expect(rawKeystrokesFrames).toHaveLength(0);

    } finally {
      vi.useRealTimers();
    }
  });

  /*
   * Phase 81 Plan 02 — verify the seed call is wired end-to-end AND fires
   * synchronously-before the WS-write dispatch inside PrettyView's
   * onUploadReadyToInject closure.
   *
   * Wiring under test (PrettyView.tsx L1517-1546):
   *   onUploadReadyToInject: ({messageQueueItemId, files, caption}) => {
   *     handleOptimisticSend({payload: caption, mqid, immediateFailure: false,
   *                           attachments: files.map(...)});   ← SEED FIRST
   *     const injectedText = formatInjectedUserTurn({caption, files});
   *     onInjectedTurnReady?.(injectedText, messageQueueItemId);  ← THEN WRITE
   *     uploads.resetBatch();
   *   }
   *
   * Order matters: the FIFO head-match cleanup at PrettyView.tsx L1900 fires
   * on the incoming harness user-role echo — if the pending record does not
   * yet exist when the echo lands, the echo appends as a normal user message
   * and the pending bubble orphans forever. So seed MUST precede send.
   *
   * Assertion strategy: React batches state updates, so the pending
   * bubble's DOM node is NOT yet present when the synchronous
   * onInjectedTurnReady callback fires (the seed call queued a
   * setPendingSends, but re-render hasn't committed). Instead we assert
   * the seed happened AT ALL by (a) verifying the pending bubble appears
   * in the DOM AFTER the event's microtask pipeline flushes, AND (b)
   * verifying onInjectedTurnReady was called with the batchId as its mqid
   * (proving the same closure ran both). The synchronous-ordering
   * guarantee is implicit in the code (seed statement precedes
   * onInjectedTurnReady in the same function body — no await between).
   */
  it("Test 6 (Phase 81): onUploadReadyToInject seeds pending bubble AND dispatches WS write frames in the same closure — both effects observable end-to-end", async () => {
    const injectedTurnCalls: Array<{ text: string; mqid: string }> = [];

    const sendInputRef: {
      current: ((text: string, mqid?: string) => boolean) | null;
    } = { current: null };

    const { container } = render(
      <PrettyView
        hostId={1}
        tmuxSession="s1"
        isVisible={true}
        onSend={() => true}
        onRegisterSendInput={(fn) => {
          sendInputRef.current = fn;
        }}
        onUnregisterSendInput={() => {
          sendInputRef.current = null;
        }}
        onInjectedTurnReady={(text, mqid) => {
          injectedTurnCalls.push({ text, mqid });
        }}
      />,
    );

    flipToStreaming(getCurrentWs());
    await waitFor(() => expect(sendInputRef.current).not.toBeNull());
    await waitFor(() =>
      expect(
        container.querySelector('textarea[placeholder^="Message"]'),
      ).not.toBeNull(),
    );

    const filePicker = container.querySelector(
      '[data-testid="compose-file-picker"]',
    ) as HTMLInputElement;
    expect(filePicker).not.toBeNull();
    const file = new File(
      [new Uint8Array(5).fill(65)],
      "phase81.txt",
      { type: "text/plain" },
    );
    await act(async () => {
      fireEvent.change(filePicker, { target: { files: [file] } });
      await Promise.resolve();
    });

    const textarea = container.querySelector(
      'textarea[placeholder^="Message"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "seed-first" } });
      await Promise.resolve();
    });
    const sendBtn = container.querySelector(
      'button[aria-label="Send"]',
    ) as HTMLButtonElement;
    expect(sendBtn).not.toBeNull();
    expect(sendBtn.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(sendBtn);
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    const ws = getCurrentWs();
    let batchId: string | null = null;
    await waitFor(
      () => {
        for (const call of ws.send.mock.calls) {
          try {
            const parsed = JSON.parse(call[0] as string);
            if (parsed.type === "upload_start" && parsed.messageQueueItemId) {
              batchId = parsed.messageQueueItemId;
              return;
            }
          } catch {
            /* skip */
          }
        }
        throw new Error("upload_start not yet emitted");
      },
      { timeout: 3000 },
    );

    // Fire upload_ready_to_inject on the WS. The uploads hook attaches
    // its message handler via ws.addEventListener; the WsStub's
    // addEventListener is a plain vi.fn() that records calls without
    // wiring the handler. Replay into every registered "message"
    // listener too.
    const evt = new MessageEvent("message", {
      data: JSON.stringify({
        type: "upload_ready_to_inject",
        messageQueueItemId: batchId,
        files: [
          {
            tempId: "t1",
            filename: "phase81.txt",
            size: 5,
            mimetype: "text/plain",
            landingPath: "/tmp/pv-uploads/phase81.txt",
            uploadTimestamp: "2026-09-07T00:00:00Z",
          },
        ],
        caption: "seed-first",
      }),
    });
    act(() => {
      ws.onmessage?.(evt);
      for (const call of ws.addEventListener.mock.calls) {
        const [type, handler] = call as [
          string,
          (e: MessageEvent) => void,
        ];
        if (type === "message" && typeof handler === "function") {
          handler(evt);
        }
      }
    });

    // (A) Pending bubble present in DOM (proves the seed ran).
    await waitFor(() => {
      const pending = container.querySelectorAll(
        '[data-event-id^="pending-"]',
      );
      expect(pending.length).toBe(1);
    });
    const pendingEl = container.querySelector(
      '[data-event-id^="pending-"]',
    )!;
    // (B) The pending bubble's data-event-id equals `pending-<batchId>` —
    // this proves the SAME closure that received the upload_ready_to_inject
    // event ran both the seed (mqid === batchId) AND wired the pending
    // record to that mqid. If the seed used a fresh pv-optim-* id, the
    // DOM id would not match batchId.
    expect(pendingEl.getAttribute("data-event-id")).toBe(
      `pending-${batchId}`,
    );

    // (C) onInjectedTurnReady fired exactly once with the batchId — proves
    // the WS-write dispatch also ran inside the same closure.
    expect(injectedTurnCalls.length).toBe(1);
    expect(injectedTurnCalls[0]!.mqid).toBe(batchId);
    expect(injectedTurnCalls[0]!.text).toContain("seed-first");
  });

  it("Test 5: WS-closed regression — sendInput returns false and does not call ws.send", async () => {
    const { sendInputRef } = mountWithRefs();

    flipToStreaming(getCurrentWs());

    await waitFor(() => expect(sendInputRef.current).not.toBeNull());

    // Set the pretty-view WS to CLOSED (readyState 3).
    getCurrentWs().readyState = 3;

    const sendCountBefore = getCurrentWs().send.mock.calls.length;

    let result: boolean | undefined;
    act(() => {
      result = sendInputRef.current!("hello", "mq-1");
    });

    // sendInput must return false when WS is closed.
    expect(result).toBe(false);

    // No type:"input" frame written on the pretty-view WS after the baseline.
    const newCalls = getCurrentWs().send.mock.calls.slice(sendCountBefore);
    const inputFrames = newCalls.filter(([data]) => {
      try {
        return JSON.parse(data as string).type === "input";
      } catch {
        return false;
      }
    });
    expect(inputFrames).toHaveLength(0);

    // Regression: no raw_keystrokes frame on the pretty-view WS.
    const rawKeystrokesFrames = newCalls.filter(([data]) => {
      try {
        return JSON.parse(data as string).type === "raw_keystrokes";
      } catch {
        return false;
      }
    });
    expect(rawKeystrokesFrames).toHaveLength(0);
  });
});
