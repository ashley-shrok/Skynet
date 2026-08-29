/**
 * Unit tests for `detectIdReset` — the pure predicate exported alongside
 * `detectRelayOutbound` / `detectRelayInbound` in `session-file-parser.ts`.
 *
 * Phase 30 Plan 30-02 (PS30-02, revised per plan-checker B1): detection of
 * `/id reset` in user turns is a PURE OBSERVATION CHANNEL. It emits a
 * `pane_state: holding` transition via the emitter from Plan 30-01 (wired in
 * `claude-session-server.ts` onLine), independently of whether the /id turn
 * renders as a bubble.
 *
 * ⚠️ Slash-command visibility policy REVERSED 2026-08-29 (Ashley, quick-260829-r9i):
 * the pre-existing HARD LOCK that required `/id` user turns to render as normal
 * chat bubbles has been dropped. `/id` invocations are session-lifecycle noise
 * and now SKIP (`kind:"skip", why:"slash_id"`). The observation channel is
 * unaffected — `detectIdReset` still fires on the same line; the pane_state
 * transition still emits. See `session-file-parser.ts` skip block for the
 * `slash_id` predicate; see the Ashley-said prose in the r9i quick-task PLAN.md.
 *
 * This file is a SIBLING to `session-file-parser.test.ts` (per
 * `30-CONTEXT.md § canonical_refs`: extend, don't rewrite the existing
 * 700+ line suite).
 *
 * Test roster:
 *   1-2:  bare + freeform /id reset → detectIdReset === true
 *   3-5:  non-reset /id subcommands (/id save / list / tanya) → false
 *   6:    assistant turn quoting /id reset text → false
 *   7:    tool_result user turn carrying /id reset markup → false
 *   8:    non-user, non-assistant type (attachment) → false
 *   12:   round-trip invariant with layer1-detect.ts:isIdResetUserTurn
 *   13:   orthogonality proof — detection fires (channel intact) while
 *         parseSessionLine skips the same line as `slash_id` (post-r9i
 *         behavior — the two channels are independent, which is the
 *         load-bearing invariant of the B1-revised design)
 */

import { describe, expect, it } from "vitest";
import {
  detectIdReset,
  parseSessionLine,
} from "./session-file-parser.js";
import { isIdResetUserTurn } from "./layer1-detect.js";

// Helpers — mirror session-file-parser.test.ts's `line()` shape so the two
// files feel consistent when read side-by-side.
function line(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}

// A real /id reset user-turn JSONL line (bare form — no explanatory text
// after "reset"). Byte-shape matches what Claude Code writes: type:"user",
// message.content is a STRING containing the <command-name>/<command-args>
// markup that layer1-detect.ts:isIdResetUserTurn already recognizes.
function bareIdResetLine(): string {
  return line({
    type: "user",
    uuid: "u-bare",
    timestamp: "2026-08-10T00:00:00.000Z",
    message: {
      content:
        "<command-name>/id</command-name>\n<command-args>reset</command-args>",
    },
  });
}

// A freeform /id reset user-turn JSONL line — Ashley typed `/id reset because
// I want to change roles`. The `<command-args>reset` prefix still matches
// per the isIdResetUserTurn behavior at layer1-detect.ts:104 (prefix match,
// not exact).
function freeformIdResetLine(): string {
  return line({
    type: "user",
    uuid: "u-freeform",
    timestamp: "2026-08-10T00:00:01.000Z",
    message: {
      content:
        "<command-name>/id</command-name>\n<command-args>reset because I want to change roles</command-args>",
    },
  });
}

// A non-reset /id subcommand (/id save) — real user turn that must render
// as a bubble AND NOT trigger detectIdReset.
function idSaveLine(): string {
  return line({
    type: "user",
    uuid: "u-save",
    timestamp: "2026-08-10T00:00:02.000Z",
    message: {
      content:
        "<command-name>/id</command-name>\n<command-args>save</command-args>",
    },
  });
}

describe("detectIdReset — pure predicate over parsed JSONL objects", () => {
  // ── Positive cases ────────────────────────────────────────────────────────

  it("Test 1: bare /id reset user turn → detectIdReset returns true", () => {
    const obj = {
      type: "user",
      message: {
        content:
          "<command-name>/id</command-name>\n<command-args>reset</command-args>",
      },
    };
    expect(detectIdReset(obj)).toBe(true);
  });

  it("Test 2: freeform /id reset with explanation → detectIdReset returns true (prefix match)", () => {
    const obj = {
      type: "user",
      message: {
        content:
          "<command-name>/id</command-name>\n<command-args>reset because I want to change roles</command-args>",
      },
    };
    expect(detectIdReset(obj)).toBe(true);
  });

  // ── Negative cases: other /id subcommands ─────────────────────────────────

  it("Test 3: /id save user turn → detectIdReset returns false", () => {
    const obj = {
      type: "user",
      message: {
        content:
          "<command-name>/id</command-name>\n<command-args>save</command-args>",
      },
    };
    expect(detectIdReset(obj)).toBe(false);
  });

  it("Test 4: /id list user turn → detectIdReset returns false", () => {
    const obj = {
      type: "user",
      message: {
        content:
          "<command-name>/id</command-name>\n<command-args>list</command-args>",
      },
    };
    expect(detectIdReset(obj)).toBe(false);
  });

  it("Test 5: /id tanya (identity switch, not reset) → detectIdReset returns false", () => {
    const obj = {
      type: "user",
      message: {
        content:
          "<command-name>/id</command-name>\n<command-args>tanya</command-args>",
      },
    };
    expect(detectIdReset(obj)).toBe(false);
  });

  // ── Negative cases: spoof-vector defenses ─────────────────────────────────

  it("Test 6: assistant turn quoting /id reset markup → detectIdReset returns false", () => {
    // Mirrors layer1-detect.ts:isUserTurn — assistant turns cannot spoof the
    // recycle signal even when they echo the exact command-name/args
    // strings back to the user (e.g. summarizing an earlier /id reset
    // request).
    const obj = {
      type: "assistant",
      message: {
        content:
          "summarizing your earlier request: <command-name>/id</command-name>\n<command-args>reset</command-args>",
      },
    };
    expect(detectIdReset(obj)).toBe(false);
  });

  it("Test 7: tool_result user turn with /id reset markup in inner content → detectIdReset returns false", () => {
    // Mirrors layer1-detect.ts:isUserTurn's `line.includes('"tool_result"')`
    // exclusion — implemented at the object level here: user turns with
    // ARRAY-shaped content is where tool_result feedback lives, and those
    // are agent-side synthetic, never real user speech. Ashley empirically
    // observed this spoof-vector during /id reset processing: each
    // tool_result during the save flow would false-clear the overlay
    // ~1s after /id reset if we let it through (2026-08-08, patch #350
    // followup).
    const obj = {
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_A",
            content:
              "<command-name>/id</command-name>\n<command-args>reset</command-args>",
          },
        ],
      },
    };
    expect(detectIdReset(obj)).toBe(false);
  });

  it("Test 8: non-user, non-assistant type (attachment) → detectIdReset returns false", () => {
    // Only real user turns matter — attachments, system frames, and any
    // other non-user type never carry a recycle signal.
    const obj = {
      type: "attachment",
      attachment: {
        type: "queued_command",
        prompt:
          "<command-name>/id</command-name>\n<command-args>reset</command-args>",
      },
    };
    expect(detectIdReset(obj)).toBe(false);
  });
});

// Tests 9-11 (the "HARD LOCK preservation" describe block that required
// /id reset / freeform /id reset / /id save user turns to parse as
// kind:"message" bubbles) were REMOVED 2026-08-29 as part of quick-260829-r9i.
// Ashley reversed the slash-command visibility policy: /id invocations are
// session-lifecycle noise and now skip via `slash_id`. Post-r9i, the
// bubble-skip behavior is asserted inside session-file-parser.test.ts
// (§ session-lifecycle noise skips). Test 13 below has been updated to
// prove orthogonality under the new policy (detection fires + bubble skips).

describe("Cross-detector invariants (parser observation channel + Layer 1 tail-state reducer must agree)", () => {
  it("Test 12: round-trip invariant — detectIdReset agrees with isIdResetUserTurn on the same input", () => {
    // The emitter dedupe (Plan 30-01) collapses back-to-back identical emits
    // to ONE wire frame. For that to be safe, the two detection paths (parser
    // observation via detectIdReset, and Layer 1 tail-state reducer via
    // isIdResetUserTurn) must AGREE on truth for every input — otherwise
    // one path could fire without the other, breaking dedupe.
    const positiveLines = [bareIdResetLine(), freeformIdResetLine()];
    const negativeLines = [
      idSaveLine(),
      // /id list
      line({
        type: "user",
        uuid: "u-list",
        message: {
          content:
            "<command-name>/id</command-name>\n<command-args>list</command-args>",
        },
      }),
      // assistant echo
      line({
        type: "assistant",
        uuid: "u-asst",
        message: {
          content:
            "<command-name>/id</command-name>\n<command-args>reset</command-args>",
        },
      }),
      // tool_result user turn
      line({
        type: "user",
        uuid: "u-tr",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_B",
              content:
                "<command-name>/id</command-name>\n<command-args>reset</command-args>",
            },
          ],
        },
      }),
    ];

    for (const raw of positiveLines) {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      expect(detectIdReset(obj)).toBe(true);
      expect(isIdResetUserTurn(raw)).toBe(true);
    }
    for (const raw of negativeLines) {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      expect(detectIdReset(obj)).toBe(false);
      expect(isIdResetUserTurn(raw)).toBe(false);
    }
  });

  it("Test 13: orthogonality proof — detection channel fires while message-emission skips (post-r9i policy reversal 2026-08-29)", () => {
    // The load-bearing invariant of the B1-revised design: for a real /id
    // reset user turn, the TWO channels fire independently on the same line —
    //   (a) detectIdReset(JSON.parse(rawLine)) === true (observation channel;
    //       emits pane_state:holding — UNCHANGED by r9i)
    //   (b) parseSessionLine(rawLine).kind === "skip", why === "slash_id"
    //       (message-emission; was "message" pre-r9i, now skipped as
    //       session-lifecycle noise per Ashley 2026-08-29)
    // The two paths remain orthogonal: one produces a pane_state:holding
    // transition, the other produces (or in the new policy, suppresses)
    // a chat bubble. Neither suppresses the other. Both must run to
    // completion on every /id reset line.
    for (const raw of [bareIdResetLine(), freeformIdResetLine()]) {
      const obj = JSON.parse(raw) as Record<string, unknown>;
      expect(detectIdReset(obj)).toBe(true);
      const parsed = parseSessionLine(raw);
      expect(parsed.kind).toBe("skip");
      if (parsed.kind !== "skip") throw new Error("unreachable");
      expect(parsed.why).toBe("slash_id");
    }
  });
});
