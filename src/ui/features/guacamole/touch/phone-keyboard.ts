/**
 * phone-keyboard — raises the phone's on-screen keyboard for a remote desktop
 * and turns what's typed into key presses on the remote.
 *
 * A hidden text field takes focus (which is what makes a phone show its
 * keyboard). Phone keyboards rarely report real key codes — Android sends
 * "composition" keys and autocorrects whole words — so typing is read by
 * comparing the field's text before and after each change: removed
 * characters become Backspaces, added ones are typed. The field starts from a
 * few invisible characters so a Backspace on "empty" still has something to
 * delete, and is reset to that whenever no word is being composed.
 *
 * Keys that never change the text (arrows, Escape, Tab, hardware-keyboard
 * shortcuts) are read from the key events themselves.
 *
 * Modifiers held on the key strip are already down on the remote, so phone
 * typing combines with them; `onTyped` lets the strip release them after the
 * key, the same as a strip key does.
 */

import { systemLogger } from "@/lib/frontend-logger";

export const SENTINEL = "​​​​";

export const KEYSYM_BACKSPACE = 0xff08;
export const KEYSYM_RETURN = 0xff0d;

const SPECIAL_KEYS: Record<string, number> = {
  Backspace: KEYSYM_BACKSPACE,
  Enter: KEYSYM_RETURN,
  Tab: 0xff09,
  Escape: 0xff1b,
  Delete: 0xffff,
  Insert: 0xff63,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  F1: 0xffbe,
  F2: 0xffbf,
  F3: 0xffc0,
  F4: 0xffc1,
  F5: 0xffc2,
  F6: 0xffc3,
  F7: 0xffc4,
  F8: 0xffc5,
  F9: 0xffc6,
  F10: 0xffc7,
  F11: 0xffc8,
  F12: 0xffc9,
};

const KEYSYM_CTRL = 0xffe3;
const KEYSYM_ALT = 0xffe9;

/** The X keysym for a typed character (null for ones nothing should type). */
export function keysymForChar(ch: string): number | null {
  const code = ch.codePointAt(0);
  if (code === undefined) return null;
  if (code === 0x0a || code === 0x0d) return KEYSYM_RETURN;
  if (code === 0x09) return 0xff09;
  if (code === 0x200b) return null;
  if (code < 0x20 || (code >= 0x7f && code < 0xa0)) return null;
  if (code <= 0xff) return code;
  return 0x01000000 | code;
}

/**
 * What changed between two versions of the field: Backspaces, then text.
 * The invisible starting characters only count as Backspaces when nothing
 * was typed in their place — a keyboard that swaps them out along with a
 * corrected word hasn't deleted anything on the remote.
 */
export function diffTyping(prev: string, next: string): { deletes: number; insert: string } {
  const a = [...prev];
  const b = [...next];
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const removed = a.slice(i);
  const insert = b.slice(i).filter((ch) => ch !== "\u200b").join("");
  const real = removed.filter((ch) => ch !== "\u200b").length;
  const filler = removed.length - real;
  return { deletes: real + (insert.length === 0 ? filler : 0), insert };
}

/** Typographic quotes a phone substitutes, back to what was typed. */
const PLAIN_QUOTES: Record<string, string> = {
  "\u2018": "'",
  "\u2019": "'",
  "\u201a": "'",
  "\u201c": '"',
  "\u201d": '"',
  "\u201e": '"',
};

/** Whether the phone's keyboard is on screen (the visible area is well short of the window). */
export function softKeyboardVisible(): boolean {
  const vv = typeof window !== "undefined" ? window.visualViewport : null;
  if (!vv) return true;
  return window.innerHeight - vv.height > 150;
}

export interface PhoneKeyboardOptions {
  /** Where the hidden field lives (inside the desktop's box). */
  host: HTMLElement;
  sendKey: (keysym: number, pressed: boolean) => void;
  /** A non-modifier key was typed (so held strip modifiers can be released). */
  onTyped?: () => void;
  /** The keyboard was raised or put away. */
  onShownChange?: (shown: boolean) => void;
}

export class PhoneKeyboard {
  readonly field: HTMLTextAreaElement;
  private readonly opts: PhoneKeyboardOptions;
  private prev = SENTINEL;
  private composing = false;
  private shown = false;
  /** A Backspace/Enter already sent from its key event — skip the same text change. */
  private sentFromKey: { keysym: number; at: number } | null = null;
  private readonly cleanups: Array<() => void> = [];

  constructor(opts: PhoneKeyboardOptions) {
    this.opts = opts;
    const f = document.createElement("textarea");
    f.setAttribute("aria-label", "Type on the remote desktop");
    f.setAttribute("autocapitalize", "off");
    f.setAttribute("autocomplete", "off");
    f.setAttribute("autocorrect", "off");
    f.setAttribute("spellcheck", "false");
    f.setAttribute("data-testid", "phone-keyboard-field");
    f.tabIndex = -1;
    Object.assign(f.style, {
      position: "absolute",
      left: "0",
      top: "0",
      width: "1px",
      height: "1px",
      opacity: "0",
      border: "0",
      padding: "0",
      margin: "0",
      resize: "none",
      // 16px stops iOS zooming the page when the field takes focus.
      fontSize: "16px",
      pointerEvents: "none",
      caretColor: "transparent",
    } satisfies Partial<CSSStyleDeclaration>);
    f.value = SENTINEL;
    this.field = f;
    opts.host.appendChild(f);

    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
    ) => {
      f.addEventListener(type, fn as EventListener);
      this.cleanups.push(() => f.removeEventListener(type, fn as EventListener));
    };
    on("keydown", (e) => this.onKeyDown(e));
    on("input", () => this.onInput());
    on("compositionstart", () => {
      this.composing = true;
    });
    on("compositionend", () => {
      this.composing = false;
      this.onInput();
    });
    on("focus", () => this.setShown(true));
    on("blur", () => this.setShown(false));
  }

  get isShown(): boolean {
    return this.shown;
  }

  /** Raise the keyboard. Must run inside the tap's own handler (iOS rule). */
  show(): void {
    this.reset();
    this.field.focus({ preventScroll: true });
  }

  hide(): void {
    this.field.blur();
  }

  toggle(): void {
    if (document.activeElement !== this.field) {
      this.show();
      return;
    }
    if (softKeyboardVisible()) {
      this.hide();
      return;
    }
    // Focused but put away (Android's Back key): focusing again doesn't
    // bring it back, so let go and take focus again inside this tap.
    this.field.blur();
    this.show();
  }

  destroy(): void {
    for (const c of this.cleanups) c();
    this.cleanups.length = 0;
    if (document.activeElement === this.field) this.field.blur();
    this.field.remove();
  }

  private setShown(shown: boolean): void {
    if (this.shown === shown) return;
    this.shown = shown;
    systemLogger.info(`[touch-input] keyboard ${shown ? "raised" : "put away"}`, {
      operation: shown ? "touch_keyboard_raise" : "touch_keyboard_lower",
    });
    this.opts.onShownChange?.(shown);
  }

  private press(keysym: number): void {
    this.opts.sendKey(keysym, true);
    this.opts.sendKey(keysym, false);
  }

  private onKeyDown(e: KeyboardEvent): void {
    // Composition keys (Android) carry no key; the text change says what happened.
    if (e.isComposing || e.keyCode === 229) return;
    const special = SPECIAL_KEYS[e.key];
    // Option+letter on an iPad keyboard types an accented letter — text, not a shortcut.
    const optionText =
      e.altKey && !e.ctrlKey && !e.metaKey && e.key.length === 1 && e.key.charCodeAt(0) > 0x7e;
    const chord = (e.ctrlKey || e.altKey || e.metaKey) && e.key.length === 1 && !optionText;
    if (special === undefined && !chord) return;
    e.preventDefault();
    const mods: number[] = [];
    if (e.ctrlKey || e.metaKey) mods.push(KEYSYM_CTRL);
    if (e.altKey) mods.push(KEYSYM_ALT);
    const keysym = special ?? keysymForChar(e.key);
    if (keysym === null) return;
    for (const m of mods) this.opts.sendKey(m, true);
    this.press(keysym);
    for (const m of [...mods].reverse()) this.opts.sendKey(m, false);
    if (mods.length === 0 && (keysym === KEYSYM_BACKSPACE || keysym === KEYSYM_RETURN)) {
      this.sentFromKey = { keysym, at: Date.now() };
    }
    this.opts.onTyped?.();
  }

  private onInput(): void {
    const next = this.field.value;
    let { deletes, insert } = diffTyping(this.prev, next);
    // Some Android keyboards change the text even after their Backspace or
    // Enter key event was handled — don't send it twice.
    const fromKey = this.sentFromKey;
    this.sentFromKey = null;
    if (fromKey && Date.now() - fromKey.at < 200) {
      if (fromKey.keysym === KEYSYM_BACKSPACE && deletes === 1 && insert === "") deletes = 0;
      if (fromKey.keysym === KEYSYM_RETURN && deletes === 0 && insert === "\n") insert = "";
    }
    let typed = false;
    for (let i = 0; i < deletes; i++) {
      this.press(KEYSYM_BACKSPACE);
      typed = true;
    }
    for (const raw of insert) {
      const ch = PLAIN_QUOTES[raw] ?? raw;
      const ks = keysymForChar(ch);
      if (ks === null) continue;
      this.press(ks);
      typed = true;
    }
    this.prev = next;
    if (!this.composing) this.reset();
    if (typed) this.opts.onTyped?.();
  }

  private reset(): void {
    if (this.field.value !== SENTINEL) this.field.value = SENTINEL;
    this.prev = SENTINEL;
    const end = SENTINEL.length;
    try {
      this.field.setSelectionRange(end, end);
    } catch {
      // Not focusable yet — the next focus puts the caret at the end anyway.
    }
  }
}
