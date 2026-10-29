import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  KEYSYM_BACKSPACE,
  KEYSYM_RETURN,
  PhoneKeyboard,
  SENTINEL,
  diffTyping,
  keysymForChar,
} from "./phone-keyboard";

describe("keysymForChar", () => {
  it("maps Latin-1 directly, the rest to Unicode keysyms, newline to Return", () => {
    expect(keysymForChar("a")).toBe(0x61);
    expect(keysymForChar("é")).toBe(0xe9);
    expect(keysymForChar("€")).toBe(0x010020ac);
    expect(keysymForChar("\n")).toBe(KEYSYM_RETURN);
    expect(keysymForChar("​")).toBeNull();
  });
});

describe("diffTyping", () => {
  it("appended text is typed", () => {
    expect(diffTyping("ab", "abcd")).toEqual({ deletes: 0, insert: "cd" });
  });
  it("an autocorrected word is backspaced and retyped", () => {
    expect(diffTyping("teh", "the ")).toEqual({ deletes: 2, insert: "he " });
  });
  it("invisible filler swapped out with a corrected word isn't a Backspace", () => {
    expect(diffTyping(SENTINEL + "teh", "the ")).toEqual({ deletes: 3, insert: "the " });
  });
  it("a deletion is backspaces", () => {
    expect(diffTyping("abc", "a")).toEqual({ deletes: 2, insert: "" });
  });
});

describe("PhoneKeyboard", () => {
  let host: HTMLElement;
  let keys: Array<[number, boolean]>;
  let typed: number;
  let shown: boolean[];
  let kb: PhoneKeyboard;

  const pressed = () => keys.filter(([, p]) => p).map(([k]) => k);

  function input(value: string) {
    kb.field.value = value;
    kb.field.dispatchEvent(new Event("input"));
  }

  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    keys = [];
    typed = 0;
    shown = [];
    vi.spyOn(console, "info").mockImplementation(() => {});
    kb = new PhoneKeyboard({
      host,
      sendKey: (k, p) => keys.push([k, p]),
      onTyped: () => typed++,
      onShownChange: (s) => shown.push(s),
    });
  });
  afterEach(() => {
    kb.destroy();
    host.remove();
    vi.restoreAllMocks();
  });

  it("toggle raises and puts away the keyboard by focusing a hidden field", () => {
    kb.toggle();
    expect(document.activeElement).toBe(kb.field);
    expect(kb.isShown).toBe(true);
    kb.toggle();
    expect(kb.isShown).toBe(false);
    expect(shown).toEqual([true, false]);
  });

  it("the field is big enough text that iOS doesn't zoom the page", () => {
    expect(kb.field.style.fontSize).toBe("16px");
  });

  it("typed characters are pressed and released on the remote", () => {
    kb.show();
    input(SENTINEL + "h");
    input(SENTINEL + "i");
    expect(keys).toEqual([
      [0x68, true],
      [0x68, false],
      [0x69, true],
      [0x69, false],
    ]);
    expect(typed).toBe(2);
  });

  it("Backspace on an empty field still reaches the remote", () => {
    kb.show();
    input(SENTINEL.slice(1));
    expect(pressed()).toEqual([KEYSYM_BACKSPACE]);
  });

  it("composed words (Android) type as they grow and replace when corrected", () => {
    kb.show();
    kb.field.dispatchEvent(new Event("compositionstart"));
    input(SENTINEL + "t");
    input(SENTINEL + "te");
    input(SENTINEL + "teh");
    input(SENTINEL + "the");
    kb.field.value = SENTINEL + "the";
    kb.field.dispatchEvent(new Event("compositionend"));
    expect(pressed()).toEqual([0x74, 0x65, 0x68, KEYSYM_BACKSPACE, KEYSYM_BACKSPACE, 0x68, 0x65]);
    expect(kb.field.value).toBe(SENTINEL);
  });

  it("Enter types Return", () => {
    kb.show();
    input(SENTINEL + "\n");
    expect(pressed()).toEqual([KEYSYM_RETURN]);
  });

  it("keys that don't change the text come from the key event", () => {
    kb.show();
    const e = new KeyboardEvent("keydown", { key: "ArrowLeft", cancelable: true });
    kb.field.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(pressed()).toEqual([0xff51]);
  });

  it("hardware-keyboard shortcuts send the chord", () => {
    kb.show();
    kb.field.dispatchEvent(new KeyboardEvent("keydown", { key: "c", ctrlKey: true, cancelable: true }));
    expect(keys).toEqual([
      [0xffe3, true],
      [0x63, true],
      [0x63, false],
      [0xffe3, false],
    ]);
  });

  it("composition key events are left to the text change", () => {
    kb.show();
    const e = new KeyboardEvent("keydown", { key: "Unidentified", keyCode: 229, cancelable: true });
    kb.field.dispatchEvent(e);
    expect(keys).toEqual([]);
    expect(e.defaultPrevented).toBe(false);
  });

  it("destroy removes the field", () => {
    kb.destroy();
    expect(host.querySelector("textarea")).toBeNull();
  });

  it("curly quotes from the phone arrive as plain quotes", () => {
    kb.show();
    input(SENTINEL + "\u2019");
    input(SENTINEL + "\u201c");
    expect(pressed()).toEqual([0x27, 0x22]);
  });

  it("an Option-key accented letter is typed, not sent as Alt", () => {
    kb.show();
    const e = new KeyboardEvent("keydown", { key: "å", altKey: true, cancelable: true });
    kb.field.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
    input(SENTINEL + "å");
    expect(pressed()).toEqual([0xe5]);
  });

  it("a Backspace sent from its key isn't sent again by the text change", () => {
    kb.show();
    kb.field.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", cancelable: true }));
    input(SENTINEL.slice(1));
    expect(pressed()).toEqual([KEYSYM_BACKSPACE]);
  });

  it("Android Back put the keyboard away: the button raises it again in one tap", () => {
    kb.show();
    // Field still focused, but the visible area is the whole window again.
    vi.stubGlobal("visualViewport", { height: window.innerHeight, offsetTop: 0 });
    const blur = vi.spyOn(kb.field, "blur");
    kb.toggle();
    expect(blur).toHaveBeenCalled();
    expect(document.activeElement).toBe(kb.field);
    vi.unstubAllGlobals();
  });
});
