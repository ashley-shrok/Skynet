import type { Terminal as XTerminal } from "@xterm/xterm";
import type {
  InputAdapter,
  ModifierName,
  ModifierState,
  ToolbarKeyName,
} from "./inputAdapter";

const ESC = "\x1B";

const PLAIN_BYTES: Partial<Record<ToolbarKeyName, string>> = {
  esc: ESC,
  pageUp: `${ESC}[5~`,
  pageDown: `${ESC}[6~`,
  insert: `${ESC}[2~`,
  delete: `${ESC}[3~`,
  f5: `${ESC}[15~`,
  f6: `${ESC}[17~`,
  f7: `${ESC}[18~`,
  f8: `${ESC}[19~`,
  f9: `${ESC}[20~`,
  f10: `${ESC}[21~`,
  f11: `${ESC}[23~`,
  f12: `${ESC}[24~`,
  f1: `${ESC}OP`,
  f2: `${ESC}OQ`,
  f3: `${ESC}OR`,
  f4: `${ESC}OS`,
};

const ARROW_LETTER: Record<
  "arrowUp" | "arrowDown" | "arrowRight" | "arrowLeft",
  string
> = {
  arrowUp: "A",
  arrowDown: "B",
  arrowRight: "C",
  arrowLeft: "D",
};

function modifierParam(mods: ModifierState): number {
  return (
    1 + (mods.shift ? 1 : 0) + (mods.alt ? 2 : 0) + (mods.ctrl ? 4 : 0)
  );
}

function isArrow(
  key: ToolbarKeyName,
): key is "arrowUp" | "arrowDown" | "arrowLeft" | "arrowRight" {
  return (
    key === "arrowUp" ||
    key === "arrowDown" ||
    key === "arrowLeft" ||
    key === "arrowRight"
  );
}

export interface EncodeKeyArgs {
  key: ToolbarKeyName;
  mods: ModifierState;
  appCursorMode: boolean;
}

export function encodeKey({ key, mods, appCursorMode }: EncodeKeyArgs): string {
  if (key === "tab") {
    return mods.shift ? `${ESC}[Z` : "\t";
  }

  if (isArrow(key)) {
    const letter = ARROW_LETTER[key];
    const param = modifierParam(mods);
    if (param === 1) {
      return appCursorMode ? `${ESC}O${letter}` : `${ESC}[${letter}`;
    }
    return `${ESC}[1;${param}${letter}`;
  }

  if (key === "home" || key === "end") {
    const letter = key === "home" ? "H" : "F";
    const param = modifierParam(mods);
    if (param === 1) {
      return `${ESC}[${letter}`;
    }
    return `${ESC}[1;${param}${letter}`;
  }

  return PLAIN_BYTES[key] ?? "";
}

const SSH_SUPPORTED_MODIFIERS: ReadonlySet<ModifierName> = new Set([
  "ctrl",
  "alt",
  "shift",
]);

export function makeSshAdapter(
  getTerminal: () => XTerminal | undefined,
  sendInput: (data: string) => void,
): InputAdapter {
  return {
    protocol: "ssh",
    supportedModifiers: SSH_SUPPORTED_MODIFIERS,
    setModifierHeld: () => {},
    sendKey: (key, mods) => {
      const appCursorMode =
        getTerminal()?.modes?.applicationCursorKeysMode ?? false;
      const bytes = encodeKey({ key, mods, appCursorMode });
      if (bytes) sendInput(bytes);
    },
  };
}
