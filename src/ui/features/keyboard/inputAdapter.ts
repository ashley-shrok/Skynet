export type ModifierName = "ctrl" | "alt" | "shift" | "win";

export type FKey =
  | "f1"
  | "f2"
  | "f3"
  | "f4"
  | "f5"
  | "f6"
  | "f7"
  | "f8"
  | "f9"
  | "f10"
  | "f11"
  | "f12";

export type ToolbarKeyName =
  | FKey
  | "esc"
  | "tab"
  | "home"
  | "end"
  | "pageUp"
  | "pageDown"
  | "insert"
  | "delete"
  | "arrowUp"
  | "arrowDown"
  | "arrowLeft"
  | "arrowRight";

export type ModifierState = Record<ModifierName, boolean>;

export type Protocol = "rdp" | "vnc" | "telnet" | "ssh";

export interface InputAdapter {
  readonly protocol: Protocol;
  readonly supportedModifiers: ReadonlySet<ModifierName>;
  setModifierHeld(mod: ModifierName, held: boolean): void;
  sendKey(key: ToolbarKeyName, mods: ModifierState): void;
}

export const EMPTY_MODIFIERS: ModifierState = {
  ctrl: false,
  alt: false,
  shift: false,
  win: false,
};
