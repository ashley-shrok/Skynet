import React, {
  useState,
  useRef,
  useCallback,
  useLayoutEffect,
  useEffect,
} from "react";
import {
  GripVertical,
  Monitor,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  ChevronsLeftRight,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/tooltip.tsx";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import type { GuacamoleDisplayHandle } from "@/features/guacamole/GuacamoleDisplay.tsx";
import { SYSTEM_COMBOS } from "./guacamoleAdapter";
import type {
  InputAdapter,
  ModifierName,
  ModifierState,
  ToolbarKeyName,
} from "./inputAdapter";

const ALL_FKEYS: ToolbarKeyName[] = [
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
];

const MOD_LABELS: Record<ModifierName, string> = {
  ctrl: "guacamole.toolbar.ctrl",
  alt: "guacamole.toolbar.alt",
  shift: "guacamole.toolbar.shift",
  win: "guacamole.toolbar.win",
};

const MOD_ORDER: ModifierName[] = ["ctrl", "alt", "shift", "win"];

const BTN_BASE =
  "flex items-center justify-center gap-1 h-7 px-2 text-[10px] font-medium text-[color:var(--color-pv-fg-muted)] hover:text-[color:var(--color-pv-fg)] hover:bg-[color:var(--color-pv-surface-quiet)] transition-colors rounded-sm whitespace-nowrap select-none";

const BTN_ICON =
  "flex items-center justify-center size-7 text-[color:var(--color-pv-fg-muted)] hover:text-[color:var(--color-pv-fg)] hover:bg-[color:var(--color-pv-surface-quiet)] transition-colors rounded-sm select-none";

const SEP = "w-px h-5 bg-[color:var(--color-pv-border-quiet-strong)] mx-0.5 shrink-0";

interface ToolbarProps {
  adapter: InputAdapter;
  /**
   * Optional escape hatch for system combos that the adapter cannot model
   * via {key, mods} (Ctrl+Alt+Del, Win+L, lone Win). Only used when
   * adapter.protocol is "rdp" or "vnc". If omitted, the system combo row
   * is hidden even on RDP/VNC.
   */
  guacamoleDisplayRef?: React.RefObject<GuacamoleDisplayHandle | null>;
  /**
   * Fires whenever the toolbar's sticky-modifier UI state changes. Lets
   * the parent (Terminal.tsx) intercept iOS soft-keyboard letter presses
   * and combine them with the active stickies. Optional — Guacamole
   * doesn't need it (modifiers are held on the wire).
   */
  onStickyChange?: (mods: ModifierState) => void;
  /**
   * Called once on mount with a clear() function the parent can use to
   * reset all sticky modifiers (after a chord fires through soft-keyboard).
   * Optional.
   */
  registerClearSticky?: (clear: () => void) => void;
}

function TipBtn({
  tooltip,
  onClick,
  className,
  children,
}: {
  tooltip: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(BTN_BASE, className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function TipIconBtn({
  tooltip,
  onClick,
  className,
  children,
}: {
  tooltip: string;
  onClick: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={onClick}
          className={cn(BTN_ICON, className)}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

export const Toolbar: React.FC<ToolbarProps> = ({
  adapter,
  guacamoleDisplayRef,
  onStickyChange,
  registerClearSticky,
}) => {
  const { t } = useTranslation();
  const [position, setPosition] = useState({ x: 0, y: 12 });
  const [collapsed, setCollapsed] = useState(true);
  const [showFKeys, setShowFKeys] = useState(false);
  const [stickyKeys, setStickyKeys] = useState<Record<ModifierName, boolean>>({
    ctrl: false,
    alt: false,
    shift: false,
    win: false,
  });

  const stickyKeysRef = useRef(stickyKeys);
  stickyKeysRef.current = stickyKeys;
  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;
  const onStickyChangeRef = useRef(onStickyChange);
  onStickyChangeRef.current = onStickyChange;

  useEffect(() => {
    onStickyChangeRef.current?.(stickyKeys);
  }, [stickyKeys]);

  useEffect(() => {
    if (!registerClearSticky) return;
    registerClearSticky(() => {
      const held = stickyKeysRef.current;
      for (const m of MOD_ORDER) {
        if (held[m] && adapterRef.current.supportedModifiers.has(m)) {
          adapterRef.current.setModifierHeld(m, false);
        }
      }
      setStickyKeys({ ctrl: false, alt: false, shift: false, win: false });
    });
  }, [registerClearSticky]);

  const toolbarRef = useRef<HTMLDivElement>(null);
  const dragOriginRef = useRef({
    pointerX: 0,
    pointerY: 0,
    posX: 0,
    posY: 0,
  });
  const dragPointerIdRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const isRdpVnc =
    adapter.protocol === "rdp" || adapter.protocol === "vnc";
  const showSystemCombos = isRdpVnc && !!guacamoleDisplayRef;

  // Center horizontally on collapsed/expand changes. If the toolbar is
  // wider than its parent (e.g. iPhone width with full toolbar expanded),
  // pin it to the left edge — its inner container has overflow-x: auto so
  // the user can scroll within it.
  useLayoutEffect(() => {
    const el = toolbarRef.current;
    if (!el) return;
    const parent = el.offsetParent as HTMLElement | null;
    if (!parent) return;
    const parentW = parent.clientWidth;
    const toolbarW = el.offsetWidth;
    setPosition((p) => ({
      ...p,
      x: Math.max(0, (parentW - toolbarW) / 2),
    }));
  }, [collapsed, showFKeys]);

  // Pointer-event drag — works for mouse, touch, pen alike.
  useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== dragPointerIdRef.current) return;
      const parent = toolbarRef.current?.offsetParent as HTMLElement | null;
      const parentW = parent?.clientWidth ?? Infinity;
      const parentH = parent?.clientHeight ?? Infinity;
      const toolbarW = toolbarRef.current?.offsetWidth ?? 0;
      const toolbarH = toolbarRef.current?.offsetHeight ?? 0;
      const dx = e.clientX - dragOriginRef.current.pointerX;
      const dy = e.clientY - dragOriginRef.current.pointerY;
      setPosition({
        x: Math.max(
          0,
          Math.min(dragOriginRef.current.posX + dx, parentW - toolbarW),
        ),
        y: Math.max(
          0,
          Math.min(dragOriginRef.current.posY + dy, parentH - toolbarH),
        ),
      });
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== dragPointerIdRef.current) return;
      dragPointerIdRef.current = null;
      setIsDragging(false);
      document.body.style.userSelect = "";
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onUp);
    };
  }, [isDragging]);

  // Release any held modifiers on unmount or adapter swap. Without this,
  // a stuck Ctrl on the Guacamole wire would survive a reconnect.
  useEffect(() => {
    return () => {
      const held = stickyKeysRef.current;
      const a = adapterRef.current;
      for (const m of MOD_ORDER) {
        if (held[m] && a.supportedModifiers.has(m)) {
          a.setModifierHeld(m, false);
        }
      }
    };
  }, [adapter]);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragPointerIdRef.current = e.pointerId;
      dragOriginRef.current = {
        pointerX: e.clientX,
        pointerY: e.clientY,
        posX: position.x,
        posY: position.y,
      };
      document.body.style.userSelect = "none";
      setIsDragging(true);
    },
    [position],
  );

  const sendKey = useCallback(
    (key: ToolbarKeyName) => {
      const mods = stickyKeysRef.current;
      adapter.sendKey(key, mods);
      // Release-after-combo: matches current Guacamole toolbar semantics.
      const updated: Record<ModifierName, boolean> = {
        ctrl: false,
        alt: false,
        shift: false,
        win: false,
      };
      let anyHeld = false;
      for (const m of MOD_ORDER) {
        if (mods[m]) {
          anyHeld = true;
          if (adapter.supportedModifiers.has(m)) {
            adapter.setModifierHeld(m, false);
          }
        }
      }
      if (anyHeld) {
        setStickyKeys(updated);
      }
    },
    [adapter],
  );

  const toggleStickyModifier = useCallback(
    (mod: ModifierName) => {
      setStickyKeys((prev) => {
        const newHeld = !prev[mod];
        adapter.setModifierHeld(mod, newHeld);
        return { ...prev, [mod]: newHeld };
      });
    },
    [adapter],
  );

  const runSystemCombo = useCallback(
    (combo: (display: GuacamoleDisplayHandle) => void) => {
      const display = guacamoleDisplayRef?.current;
      if (!display) return;
      try {
        combo(display);
      } catch (e) {
        console.error("system combo failed", e);
      }
    },
    [guacamoleDisplayRef],
  );

  const containerStyle: React.CSSProperties = {
    position: "absolute",
    left: position.x,
    top: position.y,
    zIndex: 20,
    maxWidth: "100%",
  };

  return (
    <TooltipProvider delayDuration={500}>
      <div
        ref={toolbarRef}
        style={containerStyle}
        onPointerDown={(e) => e.preventDefault()}
      >
        {collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center bg-[rgba(20,21,32,0.88)] backdrop-blur-sm border border-[color:var(--color-pv-border-quiet-strong)] shadow-lg rounded-sm overflow-hidden">
                <button
                  type="button"
                  onPointerDown={startDrag}
                  style={{ touchAction: "none" }}
                  className="flex items-center justify-center size-7 text-[color:var(--color-pv-fg-muted)] hover:text-[color:var(--color-pv-fg)] hover:bg-[color:var(--color-pv-surface-quiet)] transition-colors cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="size-3" />
                </button>
                <div className="w-px h-4 bg-[color:var(--color-pv-border-quiet-strong)]" />
                <button
                  type="button"
                  onClick={() => setCollapsed(false)}
                  className="flex items-center justify-center size-7 text-[color:var(--color-pv-fg-muted)] hover:text-[color:var(--color-pv-fg)] hover:bg-[color:var(--color-pv-surface-quiet)] transition-colors"
                >
                  <Monitor className="size-3.5" />
                </button>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t("guacamole.toolbar.expand")}
            </TooltipContent>
          </Tooltip>
        ) : (
          <div className="flex items-center bg-[rgba(20,21,32,0.88)] backdrop-blur-sm border border-[color:var(--color-pv-border-quiet-strong)] shadow-lg rounded-sm px-0.5 py-0.5 gap-0 max-w-full overflow-x-auto">
            {/* Drag handle */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onPointerDown={startDrag}
                  style={{ touchAction: "none" }}
                  className="flex items-center justify-center h-7 px-1 text-[color:var(--color-pv-fg-muted)] hover:text-[color:var(--color-pv-fg)] hover:bg-[color:var(--color-pv-surface-quiet)] transition-colors rounded-sm cursor-grab active:cursor-grabbing"
                >
                  <GripVertical className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {t("guacamole.toolbar.dragHandle")}
              </TooltipContent>
            </Tooltip>

            {/* System combos — RDP/VNC only and only when a display ref is wired */}
            {showSystemCombos && (
              <>
                <div className={SEP} />
                <TipBtn
                  tooltip={t("guacamole.toolbar.ctrlAltDel")}
                  onClick={() => runSystemCombo(SYSTEM_COMBOS.ctrlAltDel)}
                >
                  CAD
                </TipBtn>
                <TipBtn
                  tooltip={t("guacamole.toolbar.winL")}
                  onClick={() => runSystemCombo(SYSTEM_COMBOS.winL)}
                >
                  Win+L
                </TipBtn>
                <TipBtn
                  tooltip={t("guacamole.toolbar.winKey")}
                  onClick={() => runSystemCombo(SYSTEM_COMBOS.winKey)}
                >
                  Win
                </TipBtn>
              </>
            )}

            {/* Sticky modifiers */}
            {adapter.supportedModifiers.size > 0 && (
              <>
                <div className={SEP} />
                {MOD_ORDER.filter((m) =>
                  adapter.supportedModifiers.has(m),
                ).map((m) => (
                  <Tooltip key={m}>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={() => toggleStickyModifier(m)}
                        className={cn(
                          BTN_BASE,
                          stickyKeys[m] &&
                            "bg-[hsla(var(--pv-hue,35),45%,28%,0.42)] text-[color:var(--color-pv-fg)] border border-[hsla(var(--pv-hue,35),55%,50%,0.35)]",
                        )}
                      >
                        {t(MOD_LABELS[m])}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={6}>
                      {stickyKeys[m]
                        ? t("guacamole.toolbar.stickyActive", {
                            key: t(MOD_LABELS[m]),
                          })
                        : t("guacamole.toolbar.stickyInactive", {
                            key: t(MOD_LABELS[m]),
                          })}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </>
            )}

            {/* Function key toggle */}
            <div className={SEP} />
            <TipBtn
              tooltip={t("guacamole.toolbar.fnToggle")}
              onClick={() => setShowFKeys((v) => !v)}
              className={cn(
                showFKeys &&
                  "bg-[hsla(var(--pv-hue,35),45%,28%,0.42)] text-[color:var(--color-pv-fg)] border border-[hsla(var(--pv-hue,35),55%,50%,0.35)]",
              )}
            >
              Fn
            </TipBtn>

            {/* F1-F12 row */}
            {showFKeys &&
              ALL_FKEYS.map((fk, i) => (
                <TipBtn
                  key={fk}
                  tooltip={`F${i + 1}`}
                  onClick={() => sendKey(fk)}
                >
                  F{i + 1}
                </TipBtn>
              ))}

            {/* Navigation */}
            <div className={SEP} />
            <TipBtn
              tooltip={t("guacamole.toolbar.esc")}
              onClick={() => sendKey("esc")}
            >
              Esc
            </TipBtn>
            <TipBtn
              tooltip={t("guacamole.toolbar.tab")}
              onClick={() => sendKey("tab")}
            >
              Tab
            </TipBtn>
            <TipBtn
              tooltip={t("guacamole.toolbar.home")}
              onClick={() => sendKey("home")}
            >
              Home
            </TipBtn>
            <TipBtn
              tooltip={t("guacamole.toolbar.end")}
              onClick={() => sendKey("end")}
            >
              End
            </TipBtn>
            <TipBtn
              tooltip={t("guacamole.toolbar.pageUp")}
              onClick={() => sendKey("pageUp")}
            >
              PgUp
            </TipBtn>
            <TipBtn
              tooltip={t("guacamole.toolbar.pageDown")}
              onClick={() => sendKey("pageDown")}
            >
              PgDn
            </TipBtn>

            {/* Arrow cluster */}
            <div className="flex flex-col ml-0.5">
              <div className="flex justify-center">
                <TipIconBtn
                  tooltip={t("guacamole.toolbar.arrowUp")}
                  onClick={() => sendKey("arrowUp")}
                >
                  <ChevronUp className="size-3" />
                </TipIconBtn>
              </div>
              <div className="flex">
                <TipIconBtn
                  tooltip={t("guacamole.toolbar.arrowLeft")}
                  onClick={() => sendKey("arrowLeft")}
                >
                  <ChevronLeft className="size-3" />
                </TipIconBtn>
                <TipIconBtn
                  tooltip={t("guacamole.toolbar.arrowDown")}
                  onClick={() => sendKey("arrowDown")}
                >
                  <ChevronDown className="size-3" />
                </TipIconBtn>
                <TipIconBtn
                  tooltip={t("guacamole.toolbar.arrowRight")}
                  onClick={() => sendKey("arrowRight")}
                >
                  <ChevronRight className="size-3" />
                </TipIconBtn>
              </div>
            </div>

            {/* Collapse */}
            <div className="w-px h-5 bg-[color:var(--color-pv-border-quiet-strong)] mx-0.5 shrink-0" />
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => setCollapsed(true)}
                  className={cn(BTN_ICON)}
                >
                  <ChevronsLeftRight className="size-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {t("guacamole.toolbar.collapse")}
              </TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
};
