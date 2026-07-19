import { describe, it, expect } from "vitest";
import React from "react";
import {
  preprocessCommandTriplets,
  splitMarkers,
  CMD_MARKER_RE,
} from "./commandTags";

describe("preprocessCommandTriplets", () => {
  it("passes through text with no command tags unchanged", () => {
    expect(preprocessCommandTriplets("some text")).toBe("some text");
  });

  it("replaces a full triplet (message + name + args) with ⟨cmd:...⟩", () => {
    const input =
      "<command-message>id</command-message><command-name>/id</command-name><command-args>tina</command-args>";
    expect(preprocessCommandTriplets(input)).toBe("⟨cmd:/id tina⟩");
  });

  it("collapses empty args to name-only", () => {
    const input =
      "<command-name>/help</command-name><command-args></command-args>";
    expect(preprocessCommandTriplets(input)).toBe("⟨cmd:/help⟩");
  });

  it("handles a name-only run (no args tag at all)", () => {
    const input = "<command-name>/help</command-name>";
    expect(preprocessCommandTriplets(input)).toBe("⟨cmd:/help⟩");
  });

  it("leaves a lone <command-args> unchanged (malformed, no name)", () => {
    const input = "<command-args>x</command-args>";
    expect(preprocessCommandTriplets(input)).toBe(input);
  });

  it("matches name-first vs message-first orderings", () => {
    // name-first (newer)
    const nameFirst =
      "<command-name>/id</command-name><command-message>id</command-message><command-args>tina</command-args>";
    expect(preprocessCommandTriplets(nameFirst)).toBe("⟨cmd:/id tina⟩");
    // message-first (older CC-2.1.x)
    const messageFirst =
      "<command-message>id</command-message><command-name>/id</command-name><command-args>tina</command-args>";
    expect(preprocessCommandTriplets(messageFirst)).toBe("⟨cmd:/id tina⟩");
  });

  it("replaces two triplets separated by prose with prose preserved", () => {
    const input =
      "<command-name>/id</command-name><command-args>tina</command-args> then <command-name>/help</command-name>";
    expect(preprocessCommandTriplets(input)).toBe(
      "⟨cmd:/id tina⟩ then ⟨cmd:/help⟩",
    );
  });

  it("preserves multi-word args verbatim inside the marker", () => {
    const input =
      "<command-name>/id</command-name><command-args>tina and pippi</command-args>";
    expect(preprocessCommandTriplets(input)).toBe("⟨cmd:/id tina and pippi⟩");
  });
});

describe("CMD_MARKER_RE", () => {
  it("matches ⟨cmd:/id tina⟩ and captures /id tina in group 1", () => {
    const re = new RegExp(CMD_MARKER_RE.source, CMD_MARKER_RE.flags);
    const m = re.exec("⟨cmd:/id tina⟩");
    expect(m).not.toBeNull();
    expect(m![1]).toBe("/id tina");
  });

  it("is a global regex (has 'g' flag) so matchAll works safely", () => {
    expect(CMD_MARKER_RE.flags).toContain("g");
  });
});

describe("splitMarkers", () => {
  it("returns children unchanged when there are no markers", () => {
    const children = "just plain text";
    const result = splitMarkers(children);
    // React.Children.map preserves the single string as-is (may be wrapped in an array)
    const arr = React.Children.toArray(result);
    expect(arr).toEqual(["just plain text"]);
  });

  it("splits a single-string child with one marker into text/chip/text", () => {
    const children = "prefix ⟨cmd:/id tina⟩ suffix";
    const result = splitMarkers(children);
    const arr = React.Children.toArray(result);
    // Flatten because React.Children.map may wrap the returned array
    const flat: React.ReactNode[] = [];
    const walk = (node: React.ReactNode) => {
      if (Array.isArray(node)) node.forEach(walk);
      else flat.push(node);
    };
    arr.forEach(walk);
    expect(flat).toHaveLength(3);
    expect(flat[0]).toBe("prefix ");
    expect(React.isValidElement(flat[1])).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((flat[1] as any).props.cmd).toBe("/id tina");
    expect(flat[2]).toBe(" suffix");
  });

  it("splits multiple markers in one string", () => {
    const children = "a ⟨cmd:/id tina⟩ b ⟨cmd:/help⟩ c";
    const result = splitMarkers(children);
    const arr = React.Children.toArray(result);
    const flat: React.ReactNode[] = [];
    const walk = (node: React.ReactNode) => {
      if (Array.isArray(node)) node.forEach(walk);
      else flat.push(node);
    };
    arr.forEach(walk);
    expect(flat).toHaveLength(5);
    expect(flat[0]).toBe("a ");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((flat[1] as any).props.cmd).toBe("/id tina");
    expect(flat[2]).toBe(" b ");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((flat[3] as any).props.cmd).toBe("/help");
    expect(flat[4]).toBe(" c");
  });

  it("passes through non-string children untouched (no recursion)", () => {
    const em = React.createElement("em", { key: "e" }, "x");
    const result = splitMarkers(em);
    const arr = React.Children.toArray(result);
    expect(arr).toHaveLength(1);
    expect(React.isValidElement(arr[0])).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((arr[0] as any).type).toBe("em");
  });

  it("handles an array of mixed children (string with marker + jsx sibling)", () => {
    const em = React.createElement("em", { key: "e" }, "italic");
    const children = ["hello ⟨cmd:/help⟩ world", em];
    const result = splitMarkers(children);
    const arr = React.Children.toArray(result);
    const flat: React.ReactNode[] = [];
    const walk = (node: React.ReactNode) => {
      if (Array.isArray(node)) node.forEach(walk);
      else flat.push(node);
    };
    arr.forEach(walk);
    // "hello " + <CommandChip> + " world" + <em>
    expect(flat).toHaveLength(4);
    expect(flat[0]).toBe("hello ");
    expect(React.isValidElement(flat[1])).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((flat[1] as any).props.cmd).toBe("/help");
    expect(flat[2]).toBe(" world");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((flat[3] as any).type).toBe("em");
  });
});
