// The blocked-command list and matcher live in src/types (shared by the
// composer and the server); tested here because src/types has no test project.
import { describe, expect, it } from "vitest";
import {
  BLOCKED_COMMAND_NAMES,
  BLOCKED_COMMANDS_HARNESS_VERSION,
} from "../../types/blocked-commands.generated.js";
import { blockedCommandIn, isBlockedSkillName } from "../../types/blocked-commands.js";
import { HARNESS_PIN } from "../distributor/harness-pin.js";

describe("blockedCommandIn", () => {
  it.each([
    ["/clear", "clear"],
    ["/reset", "reset"],
    ["/new", "new"],
    ["/compact keep the plan", "compact"],
    ["  /resume", "resume"],
    ["\n/exit", "exit"],
    ["/Clear", "clear"],
    ["/COMPACT", "compact"],
    ["/id", "id"],
    ["/id save", "id"],
    ["/id some-other-agent", "id"],
    ["/desktop", "desktop"],
    ["/loop 5m check", "loop"],
    ["/schedule", "schedule"],
    ["/simplify", "simplify"],
    ["/model opus", "model"],
    ["/help", "help"],
    ["/clear\nand more", "clear"],
    ["/clear\tnow", "clear"],
  ])("refuses %j", (text, name) => {
    expect(blockedCommandIn(text)).toBe(name);
  });

  it.each([
    "clear the cache please",
    "see you tomorrow\n/clear",
    "/clearly not a command",
    "/clear-cache",
    "/identity",
    "/idle",
    "/home/ubuntu/notes.md is the file",
    "/run/user/1000 is where it lives",
    "/app/config.json",
    "/clear.",
    "/build add a button",
    "/queue look at the logs",
    "/open",
    "/close my-shape",
    "/",
    "/ clear",
    "",
    "   ",
    "```answer\nask: x\n```",
  ])("passes %j", (text) => {
    expect(blockedCommandIn(text)).toBeNull();
  });
});

describe("isBlockedSkillName", () => {
  it("refuses harness names and the identity command, ignoring capitals", () => {
    expect(isBlockedSkillName("clear")).toBe(true);
    expect(isBlockedSkillName("Compact")).toBe(true);
    expect(isBlockedSkillName("id")).toBe(true);
    expect(isBlockedSkillName(" loop ")).toBe(true);
  });

  it("allows other names", () => {
    expect(isBlockedSkillName("my-skill")).toBe(false);
    expect(isBlockedSkillName("clear-cache")).toBe(false);
    expect(isBlockedSkillName("build")).toBe(false);
  });
});

describe("the generated list", () => {
  it("records its Claude Code version and is sorted, lowercase and unique", () => {
    expect(BLOCKED_COMMANDS_HARNESS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    const sorted = [...BLOCKED_COMMAND_NAMES].sort();
    expect(BLOCKED_COMMAND_NAMES).toEqual(sorted);
    expect(new Set(BLOCKED_COMMAND_NAMES).size).toBe(BLOCKED_COMMAND_NAMES.length);
    for (const n of BLOCKED_COMMAND_NAMES) expect(n).toBe(n.toLowerCase());
  });

  it("was read from the fleet's pinned Claude Code version — rerun scripts/extract-harness-commands.py after a pin bump", () => {
    expect(BLOCKED_COMMANDS_HARNESS_VERSION).toBe(HARNESS_PIN);
  });

  it("covers the commands that split an agent's history", () => {
    for (const n of ["clear", "reset", "new", "resume", "continue", "branch", "fork", "rewind", "cd", "teleport", "compact", "exit", "id"]) {
      expect(BLOCKED_COMMAND_NAMES).toContain(n);
    }
  });

  it("leaves Skynet's own typed skills alone", () => {
    for (const n of ["build", "open", "close", "queue", "campaign", "explain", "keep-an-eye"]) {
      expect(BLOCKED_COMMAND_NAMES).not.toContain(n);
    }
  });
});
