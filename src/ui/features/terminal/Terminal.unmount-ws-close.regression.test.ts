/**
 * Regression guard for commit 8f5d2a70 —
 *   fix(terminal): unconditional ws.close() on unmount — kills orphan WS +
 *   frozen-terminal-view bug
 *
 * Terminal.tsx historically gated its mount/unmount cleanup on
 * `currentHostIdRef.current !== currentHostId`, which silently skipped
 * `webSocketRef.current.close()` on the common case of a real unmount
 * where the host didn't change. The stranded WS's onmessage closure kept
 * a reference to the old xterm instance; frames arrived at ~13/sec and
 * `terminal.write()` succeeded silently into a DOM-detached buffer while
 * `xtermRef.current` was null. Symptom: terminal view "visually frozen but
 * accepts keys" every time the user switched to that tab.
 *
 * Because Terminal.tsx has heavy WS + xterm + i18n + ssh module wiring
 * that isn't practical to mount in a unit test with real fidelity
 * (existing tests in this dir use the same structural-grep pattern —
 * see Terminal.wiring.test.ts), the regression guard here is a source-
 * text assertion: the cleanup block MUST NOT re-introduce the guard,
 * AND MUST contain the ws.close() call.
 *
 * If a future refactor legitimately moves the ws close to a different
 * site, update this test to point at the new site — do not simply drop
 * the assertion, since the guarantee it protects (WS always closed on
 * unmount) is the load-bearing invariant.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const TERMINAL_SRC = fs.readFileSync(
  path.join(__dirname, "Terminal.tsx"),
  "utf-8",
);

describe("Terminal.tsx — ws.close() unmount regression guard (commit 8f5d2a70)", () => {
  it("cleanup block does NOT re-introduce the host-swap guard around the close", () => {
    // The specific anti-pattern the fix removed. Any re-introduction of
    // this guard around the WS close block would re-open the bug.
    //
    // NOTE: the string appears once in a HISTORICAL comment explaining
    // what was removed — that's expected and correct (documenting the
    // fix). What must NOT reappear is a live `if (currentHostIdRef.current
    // !== currentHostId ...)` check gating the cleanup body. We assert
    // the string appears at most once (the comment), never in an `if`.
    const guardComment = TERMINAL_SRC.match(
      /\/\/[^\n]*currentHostIdRef\.current[^\n]*!==[^\n]*currentHostId/g,
    );
    const guardLiveIf = TERMINAL_SRC.match(
      /if\s*\(\s*currentHostIdRef\.current\s*!==\s*currentHostId/g,
    );

    // Comment(s) documenting the removed guard: OK.
    expect(guardComment).not.toBeNull();
    // Live `if (currentHostIdRef.current !== currentHostId ...)` gate:
    // must NOT exist.
    expect(guardLiveIf).toBeNull();
  });

  it("cleanup block contains an unconditional webSocketRef.current.close() call", () => {
    // The load-bearing invariant: ws.close() runs on unmount, gated only
    // by a non-null check (`if (webSocketRef.current)`), NOT by a host-
    // swap comparison.
    const cleanClose = TERMINAL_SRC.match(
      /if\s*\(\s*webSocketRef\.current\s*\)\s*\{\s*\n?\s*webSocketRef\.current\.close\(\);/,
    );
    expect(cleanClose).not.toBeNull();
  });

  it("cleanup block sets isUnmountingRef.current = true (kills reconnect ladder)", () => {
    // Sister invariant: the reconnect ladder observes isUnmountingRef.
    // Without this flip the reconnect timer could re-open a fresh WS
    // even after ws.close() runs, re-orphaning.
    const flipSet = TERMINAL_SRC.match(
      /isUnmountingRef\.current\s*=\s*true;/,
    );
    expect(flipSet).not.toBeNull();
  });
});
