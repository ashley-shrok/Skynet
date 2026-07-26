import { describe, it, expect } from "vitest";
import {
  BTW_PROMPT,
  ASIDE_END_MARKER,
  __asideShellQuoteForTests,
  extractBtwAnswer,
  __asideStateForTests,
  __activeViewersForTests,
  __sessionKeyForTests,
  __broadcastAsideDismissedForTests,
  // Phase 14 Plan 05 Task 1: asideState is exported directly (not just via
  // the __asideStateForTests alias) so Wave 5's cross-tab state-coherence
  // integration tests can observe the source-of-truth Map without a helper.
  // Per CONTEXT.md § Backend per-connection state LOCK — the Map IS the
  // source of truth; observing it is a legitimate integration seam, not a
  // test-only export.
  asideState,
} from "./claude-session-server.js";

// Phase 14 Plan 01 Task 1 — RED-gate tests for the Wave 1 primitives.
//
// These tests validate the LOCKED contract from
// .planning/phases/14-plain-language-translation-asides/14-CONTEXT.md § Injection
// (BTW_PROMPT byte-for-byte) and § Specific Ideas (ASIDE_END_MARKER),
// plus the shellQuote parity with src/backend/ssh/terminal.ts L123.
//
// A `__asideShellQuoteForTests` re-export lets us verify the local helper
// without duplicating its 2-line body here. The two definitions (this file's
// consumer + terminal.ts L123) MUST remain byte-identical; if either shifts,
// this test file is one of the fail-loud tripwires.

describe("Phase 14 aside primitives — module-scope constants", () => {
  it("BTW_PROMPT is the EXACT literal from CONTEXT.md § Injection (character-for-character)", () => {
    // Do NOT paraphrase, do NOT tune, do NOT add framing (CONTEXT.md § Specifics).
    // The em-dash MUST be U+2014, not U+2013 or a hyphen-minus.
    expect(BTW_PROMPT).toBe(
      "/btw Re-explain whatever's currently going on to me without using code symbols, in a conceptual model style. Not a metaphor — explain the actual thing, don't recast it as an extended analogy.",
    );
  });

  it("BTW_PROMPT contains a real U+2014 em-dash (not U+2013 en-dash or hyphen-minus)", () => {
    expect(BTW_PROMPT.includes("—")).toBe(true);
    expect(BTW_PROMPT.includes("–")).toBe(false);
  });

  it("BTW_PROMPT starts with the exact `/btw ` slash-command prefix", () => {
    expect(BTW_PROMPT.startsWith("/btw ")).toBe(true);
  });

  it("ASIDE_END_MARKER is the literal substring `Esc to close`", () => {
    expect(ASIDE_END_MARKER).toBe("Esc to close");
  });
});

describe("Phase 14 aside primitives — shellQuote parity with terminal.ts L123", () => {
  it("wraps a plain string in single quotes", () => {
    expect(__asideShellQuoteForTests("hello")).toBe("'hello'");
  });

  it("escapes embedded single quotes via POSIX '\\'' idiom", () => {
    // Input:  it's
    // Output: 'it'\''s'  — closes the wrap, escapes literal ', re-opens the wrap.
    expect(__asideShellQuoteForTests("it's")).toBe("'it'\\''s'");
  });

  it("wraps empty string as ''", () => {
    expect(__asideShellQuoteForTests("")).toBe("''");
  });

  it("preserves other shell metacharacters inside the single-quoted string (they are literal inside single quotes)", () => {
    expect(__asideShellQuoteForTests("$FOO;rm -rf /")).toBe("'$FOO;rm -rf /'");
  });
});

// Phase 14 Plan 01 Task 2 — extractBtwAnswer pure-string helper.
//
// Cases A-E enumerated in the plan's <behavior> block. The extractor is
// pure — no side effects, no I/O — so we test purely by feeding synthetic
// capture-pane output strings and asserting the returned string / null.
//
// Anchor semantics under test:
//   - LAST-occurrence rule on the end marker (scrollback may contain prior
//     invocations' markers).
//   - LAST-occurrence rule on the `/btw ` echo BEFORE the end marker (same
//     reason — prior BTW echoes still visible in the pane buffer).
//   - `/^\s*(>\s*)?\/btw\b/` regex allows tmux prompt prefixes like `> ` in
//     front of the echoed slash-command.

describe("Phase 14 aside primitives — extractBtwAnswer", () => {
  it("CASE A: returns null when the end marker is not present (answer still streaming)", () => {
    const paneOutput = [
      "> /btw Re-explain whatever's currently going on to me…",
      "",
      "Sure — here is the current situation, still being written…",
    ].join("\n");
    expect(extractBtwAnswer(paneOutput, ASIDE_END_MARKER)).toBeNull();
  });

  it("CASE B: single-line answer between echoed /btw line and end-marker line, trimmed", () => {
    const paneOutput = [
      "> /btw Re-explain whatever's currently going on to me…",
      "",
      "The agent is currently reviewing the diff you pasted.",
      "",
      "↑/↓ to scroll · f to fork · Esc to close",
    ].join("\n");
    expect(extractBtwAnswer(paneOutput, ASIDE_END_MARKER)).toBe(
      "The agent is currently reviewing the diff you pasted.",
    );
  });

  it("CASE C: multi-line answer with scrollback lines above the /btw echo — last-occurrence anchor picks the CURRENT invocation", () => {
    const paneOutput = [
      // A prior BTW invocation still in scrollback:
      "> /btw earlier question…",
      "the prior answer",
      "↑/↓ to scroll · f to fork · Esc to close",
      // Normal conversation between the two invocations:
      "",
      "some intervening conversation",
      "",
      // The CURRENT invocation:
      "> /btw Re-explain whatever's currently going on to me…",
      "",
      "line one of the current answer",
      "line two of the current answer",
      "line three of the current answer",
      "",
      "↑/↓ to scroll · f to fork · Esc to close",
    ].join("\n");
    expect(extractBtwAnswer(paneOutput, ASIDE_END_MARKER)).toBe(
      [
        "line one of the current answer",
        "line two of the current answer",
        "line three of the current answer",
      ].join("\n"),
    );
  });

  it("CASE D: end marker present but no /btw echo found → returns null (malformed, do not emit garbage)", () => {
    const paneOutput = [
      "some assistant text with no /btw echo above the marker",
      "another line",
      "↑/↓ to scroll · f to fork · Esc to close",
    ].join("\n");
    expect(extractBtwAnswer(paneOutput, ASIDE_END_MARKER)).toBeNull();
  });

  it("CASE E: end marker present, /btw echo found, no lines between them → returns empty string", () => {
    const paneOutput = [
      "> /btw Re-explain whatever's currently going on to me…",
      "↑/↓ to scroll · f to fork · Esc to close",
    ].join("\n");
    expect(extractBtwAnswer(paneOutput, ASIDE_END_MARKER)).toBe("");
  });
});

// Phase 14 Plan 02 Task 2 — RED-gate tests for the backend aside subsystem.
//
// These tests validate the LOCKED architecture from CONTEXT.md:
//   § Backend per-connection state (2026-07-26 lock): asideState + activeViewers
//     MUST live at module scope, NOT inside wss.on("connection") closure.
//   § Dismiss / § State model: broadcastAsideDismissed MUST be atomic —
//     BOTH send the dismiss frame to every peer AND flip each peer's
//     asideState.displayed = false. Missing step (b) silently breaks the
//     v1 overlap policy (ASIDE-08) across tabs.
//
// The `__*ForTests` re-exports are internal test seams — underscore-prefix
// marks them as private. No production caller should reference them.

describe("Phase 14 Wave 2 — backend aside subsystem module-scope state", () => {
  it("asideState is a Map (module-scope, per CONTEXT.md § Backend per-connection state lock)", () => {
    expect(__asideStateForTests).toBeInstanceOf(Map);
  });

  it("activeViewers is a Map (module-scope, per CONTEXT.md § Dismiss / cross-tab broadcast)", () => {
    expect(__activeViewersForTests).toBeInstanceOf(Map);
  });

  it("sessionKey builds a `${hostId}::${tmuxSession}` composite key", () => {
    expect(__sessionKeyForTests(7, "identity-session")).toBe("7::identity-session");
    expect(__sessionKeyForTests(1, "a")).toBe("1::a");
  });

  it("sessionKey survives colons inside the tmux session name (they land in the value half)", () => {
    // The frontend already sanitizes tmux session names to tmux-safe (alphanumeric
    // + dash + underscore), so colons should never appear in practice; but if they
    // did, the composite key would still be deterministic and unique per (hostId,
    // tmuxSession) pair — collisions would require the SAME hostId AND the SAME
    // exact string after the ::. Not a security concern; just a correctness spot-check.
    expect(__sessionKeyForTests(7, "a:b")).toBe("7::a:b");
  });
});

describe("Phase 14 Wave 2 — broadcastAsideDismissed atomic BOTH-STEPS rule", () => {
  // Minimal WebSocket stub — mimics the fields broadcastAsideDismissed reads.
  // We only need `readyState` (must equal ws.OPEN sentinel = 1) and `send`.
  const OPEN = 1;

  function makeStubWs() {
    const sent: string[] = [];
    return {
      readyState: OPEN,
      send: (frame: string) => sent.push(frame),
      _sent: sent,
    };
  }

  it("iterates activeViewers.get(key) peers, sending aside_dismissed to each", () => {
    // Setup: two peer WSes registered for the same session key.
    const wsA = makeStubWs();
    const wsB = makeStubWs();
    const key = __sessionKeyForTests(42, "test-session-broadcast-1");
    __activeViewersForTests.set(
      key,
      new Set<unknown>([wsA, wsB]) as Set<import("ws").WebSocket>,
    );
    __asideStateForTests.set(
      wsA as unknown as import("ws").WebSocket,
      { armed: false, displayed: true },
    );
    __asideStateForTests.set(
      wsB as unknown as import("ws").WebSocket,
      { armed: false, displayed: true },
    );

    __broadcastAsideDismissedForTests(key);

    // Step (a): both peers received the dismiss frame.
    expect(wsA._sent).toHaveLength(1);
    expect(wsB._sent).toHaveLength(1);
    expect(JSON.parse(wsA._sent[0])).toEqual({ type: "aside_dismissed" });
    expect(JSON.parse(wsB._sent[0])).toEqual({ type: "aside_dismissed" });

    // Step (b): both peers' asideState.displayed flipped to false — MANDATORY
    // per CONTEXT.md § Backend per-connection state. Without this, the peer's
    // overlap-ignore gate stays stuck on displayed:true and ASIDE-08 silently
    // breaks across tabs.
    expect(
      __asideStateForTests.get(wsA as unknown as import("ws").WebSocket)?.displayed,
    ).toBe(false);
    expect(
      __asideStateForTests.get(wsB as unknown as import("ws").WebSocket)?.displayed,
    ).toBe(false);

    // Cleanup so this test doesn't leak state into others.
    __activeViewersForTests.delete(key);
    __asideStateForTests.delete(wsA as unknown as import("ws").WebSocket);
    __asideStateForTests.delete(wsB as unknown as import("ws").WebSocket);
  });

  it("is a no-op when the sessionKey has no peers registered", () => {
    // Uses a fresh key that no test set up.
    __broadcastAsideDismissedForTests(__sessionKeyForTests(999, "no-peers-here"));
    // No throw = pass. No state to inspect.
    expect(true).toBe(true);
  });

  it("skips peers whose readyState is not OPEN (does not send, does not flip)", () => {
    const wsClosed = { readyState: 3 /* CLOSED */, _sent: [] as string[], send(f: string) { this._sent.push(f); } };
    const wsOpen = makeStubWs();
    const key = __sessionKeyForTests(43, "test-session-broadcast-2");
    __activeViewersForTests.set(
      key,
      new Set<unknown>([wsClosed, wsOpen]) as Set<import("ws").WebSocket>,
    );
    __asideStateForTests.set(
      wsClosed as unknown as import("ws").WebSocket,
      { armed: false, displayed: true },
    );
    __asideStateForTests.set(
      wsOpen as unknown as import("ws").WebSocket,
      { armed: false, displayed: true },
    );

    __broadcastAsideDismissedForTests(key);

    // Closed peer got nothing.
    expect(wsClosed._sent).toHaveLength(0);
    // Open peer got the frame.
    expect(wsOpen._sent).toHaveLength(1);
    // Open peer's displayed flipped; closed peer's did NOT (readyState guard
    // short-circuits before the state flip — matches the plan spec's "if
    // readyState !== OPEN continue" branch position).
    expect(
      __asideStateForTests.get(wsClosed as unknown as import("ws").WebSocket)?.displayed,
    ).toBe(true);
    expect(
      __asideStateForTests.get(wsOpen as unknown as import("ws").WebSocket)?.displayed,
    ).toBe(false);

    __activeViewersForTests.delete(key);
    __asideStateForTests.delete(wsClosed as unknown as import("ws").WebSocket);
    __asideStateForTests.delete(wsOpen as unknown as import("ws").WebSocket);
  });
});

// Phase 14 Plan 05 Task 1 — asideState is exported directly (RED-gate test).
//
// The Wave 5 integration test suite needs to `import { asideState } from
// "../claude-session-server"` to inspect cross-tab peer-state-flip coherence
// (the atomic BOTH-STEPS rule from CONTEXT.md § Backend per-connection state).
// Adding `export` to the const declaration (or a named-export getter) is the
// minimal source change; this assertion locks the export shape so a future
// refactor that removes it fails loudly.
describe("Phase 14 Plan 05 Task 1 — asideState is a named export", () => {
  it("asideState is the SAME Map instance as __asideStateForTests (single source of truth)", () => {
    expect(asideState).toBe(__asideStateForTests);
    expect(asideState).toBeInstanceOf(Map);
  });
});
