import type { RefObject } from "react";
import type { GuacamoleDisplayHandle } from "@/features/guacamole/GuacamoleDisplay";
import type {
  InputAdapter,
  ModifierName,
  ModifierState,
  Protocol,
  ToolbarKeyName,
} from "./inputAdapter";

const MODIFIER_KEYSYMS: Record<ModifierName, number> = {
  ctrl: 0xffe3,
  alt: 0xffe9,
  shift: 0xffe1,
  // Pre-existing quirk: 0xff67 is XK_Menu, not Super_L (0xffeb). Preserved
  // for behavioral parity with the prior GuacamoleToolbar; Win+L works
  // today on workstation-RDP with this keysym, so leave it.
  win: 0xff67,
};

const KEYSYM: Record<ToolbarKeyName, number> = {
  esc: 0xff1b,
  tab: 0xff09,
  home: 0xff50,
  end: 0xff57,
  pageUp: 0xff55,
  pageDown: 0xff56,
  insert: 0xff63,
  delete: 0xffff,
  arrowUp: 0xff52,
  arrowDown: 0xff54,
  arrowLeft: 0xff51,
  arrowRight: 0xff53,
  f1: 0xffbe,
  f2: 0xffbf,
  f3: 0xffc0,
  f4: 0xffc1,
  f5: 0xffc2,
  f6: 0xffc3,
  f7: 0xffc4,
  f8: 0xffc5,
  f9: 0xffc6,
  f10: 0xffc7,
  f11: 0xffc8,
  f12: 0xffc9,
};

const ALL_MODIFIERS: ReadonlySet<ModifierName> = new Set([
  "ctrl",
  "alt",
  "shift",
  "win",
]);

const RDP_VNC_MODIFIERS: ReadonlySet<ModifierName> = ALL_MODIFIERS;

const TELNET_MODIFIERS: ReadonlySet<ModifierName> = new Set([
  "ctrl",
  "alt",
  "shift",
]);

export function makeGuacamoleAdapter(
  displayRef: RefObject<GuacamoleDisplayHandle | null>,
  protocol: Protocol,
): InputAdapter {
  return {
    protocol,
    supportedModifiers:
      protocol === "telnet" ? TELNET_MODIFIERS : RDP_VNC_MODIFIERS,
    setModifierHeld: (mod, held) => {
      displayRef.current?.sendKey(MODIFIER_KEYSYMS[mod], held);
    },
    sendKey: (key, _mods) => {
      const display = displayRef.current;
      if (!display) return;
      const ks = KEYSYM[key];
      try {
        display.sendKey(ks, true);
      } finally {
        display.sendKey(ks, false);
      }
    },
  };
}

export const SYSTEM_COMBOS = {
  ctrlAltDel: (display: GuacamoleDisplayHandle) => {
    const ksList = [
      MODIFIER_KEYSYMS.ctrl,
      MODIFIER_KEYSYMS.alt,
      KEYSYM.delete,
    ];
    for (const k of ksList) display.sendKey(k, true);
    for (const k of [...ksList].reverse()) display.sendKey(k, false);
  },
  winL: (display: GuacamoleDisplayHandle) => {
    const ksList = [MODIFIER_KEYSYMS.win, 0x006c];
    for (const k of ksList) display.sendKey(k, true);
    for (const k of [...ksList].reverse()) display.sendKey(k, false);
  },
  winKey: (display: GuacamoleDisplayHandle) => {
    display.sendKey(MODIFIER_KEYSYMS.win, true);
    display.sendKey(MODIFIER_KEYSYMS.win, false);
  },
};
