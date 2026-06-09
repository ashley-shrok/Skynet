import { describe, it, expect } from "vitest";
import { encodeKey } from "./sshAdapter";
import {
  EMPTY_MODIFIERS,
  type ModifierState,
  type ToolbarKeyName,
} from "./inputAdapter";

const ESC = "\x1B";

function mods(over: Partial<ModifierState> = {}): ModifierState {
  return { ...EMPTY_MODIFIERS, ...over };
}

describe("encodeKey - plain keys without modifiers", () => {
  const cases: Array<[ToolbarKeyName, string]> = [
    ["esc", `${ESC}`],
    ["tab", "\t"],
    ["pageUp", `${ESC}[5~`],
    ["pageDown", `${ESC}[6~`],
    ["insert", `${ESC}[2~`],
    ["delete", `${ESC}[3~`],
    ["f1", `${ESC}OP`],
    ["f2", `${ESC}OQ`],
    ["f3", `${ESC}OR`],
    ["f4", `${ESC}OS`],
    ["f5", `${ESC}[15~`],
    ["f6", `${ESC}[17~`],
    ["f7", `${ESC}[18~`],
    ["f8", `${ESC}[19~`],
    ["f9", `${ESC}[20~`],
    ["f10", `${ESC}[21~`],
    ["f11", `${ESC}[23~`],
    ["f12", `${ESC}[24~`],
  ];
  it.each(cases)("encodes %s as expected bytes", (key, expected) => {
    expect(encodeKey({ key, mods: mods(), appCursorMode: false })).toBe(
      expected,
    );
  });
});

describe("encodeKey - arrows in normal vs application cursor mode", () => {
  const cases: Array<
    [ToolbarKeyName, "normal" | "app", string]
  > = [
    ["arrowUp", "normal", `${ESC}[A`],
    ["arrowDown", "normal", `${ESC}[B`],
    ["arrowRight", "normal", `${ESC}[C`],
    ["arrowLeft", "normal", `${ESC}[D`],
    ["arrowUp", "app", `${ESC}OA`],
    ["arrowDown", "app", `${ESC}OB`],
    ["arrowRight", "app", `${ESC}OC`],
    ["arrowLeft", "app", `${ESC}OD`],
  ];
  it.each(cases)(
    "encodes %s in %s mode as expected bytes",
    (key, mode, expected) => {
      expect(
        encodeKey({
          key,
          mods: mods(),
          appCursorMode: mode === "app",
        }),
      ).toBe(expected);
    },
  );
});

describe("encodeKey - arrows with every modifier combo (bitmask)", () => {
  // param = 1 + shift + 2*alt + 4*ctrl
  const combos: Array<[Partial<ModifierState>, number]> = [
    [{}, 1],
    [{ shift: true }, 2],
    [{ alt: true }, 3],
    [{ shift: true, alt: true }, 4],
    [{ ctrl: true }, 5],
    [{ shift: true, ctrl: true }, 6],
    [{ alt: true, ctrl: true }, 7],
    [{ shift: true, alt: true, ctrl: true }, 8],
  ];
  const arrows: Array<["arrowUp" | "arrowDown" | "arrowRight" | "arrowLeft", string]> = [
    ["arrowUp", "A"],
    ["arrowDown", "B"],
    ["arrowRight", "C"],
    ["arrowLeft", "D"],
  ];
  for (const [arrow, letter] of arrows) {
    for (const [m, param] of combos) {
      const desc = Object.keys(m).length === 0 ? "no mods" : Object.keys(m).join("+");
      it(`encodes ${arrow} with ${desc} → param ${param}`, () => {
        const expected =
          param === 1 ? `${ESC}[${letter}` : `${ESC}[1;${param}${letter}`;
        expect(
          encodeKey({
            key: arrow,
            mods: mods(m),
            appCursorMode: false,
          }),
        ).toBe(expected);
      });
    }
  }
});

describe("encodeKey - Tab special cases", () => {
  it("Tab with no modifiers sends \\t", () => {
    expect(encodeKey({ key: "tab", mods: mods(), appCursorMode: false })).toBe(
      "\t",
    );
  });
  it("Tab + Shift sends CSI Z (Shift+Tab)", () => {
    expect(
      encodeKey({ key: "tab", mods: mods({ shift: true }), appCursorMode: false }),
    ).toBe(`${ESC}[Z`);
  });
  it("Tab + Ctrl ignores Ctrl (browser-reserved combo)", () => {
    // Per plan: Ctrl+Tab is browser-reserved; we don't try to encode it.
    // Plain \t is acceptable behavior.
    expect(
      encodeKey({ key: "tab", mods: mods({ ctrl: true }), appCursorMode: false }),
    ).toBe("\t");
  });
});

describe("encodeKey - Home/End with modifiers", () => {
  it("Home no mods → CSI H", () => {
    expect(encodeKey({ key: "home", mods: mods(), appCursorMode: false })).toBe(
      `${ESC}[H`,
    );
  });
  it("End no mods → CSI F", () => {
    expect(encodeKey({ key: "end", mods: mods(), appCursorMode: false })).toBe(
      `${ESC}[F`,
    );
  });
  it("Ctrl+Home → CSI 1;5 H", () => {
    expect(
      encodeKey({
        key: "home",
        mods: mods({ ctrl: true }),
        appCursorMode: false,
      }),
    ).toBe(`${ESC}[1;5H`);
  });
  it("Shift+Ctrl+End → CSI 1;6 F", () => {
    expect(
      encodeKey({
        key: "end",
        mods: mods({ shift: true, ctrl: true }),
        appCursorMode: false,
      }),
    ).toBe(`${ESC}[1;6F`);
  });
});

describe("encodeKey - app-cursor-mode does not affect non-arrow keys", () => {
  const keys: ToolbarKeyName[] = [
    "esc",
    "tab",
    "pageUp",
    "pageDown",
    "insert",
    "delete",
    "home",
    "end",
    "f1",
    "f5",
  ];
  for (const key of keys) {
    it(`${key} bytes are identical in normal and app mode`, () => {
      const normal = encodeKey({
        key,
        mods: mods(),
        appCursorMode: false,
      });
      const app = encodeKey({ key, mods: mods(), appCursorMode: true });
      expect(normal).toBe(app);
    });
  }
});
