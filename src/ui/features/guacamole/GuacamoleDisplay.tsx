import {
  useEffect,
  useRef,
  useState,
  useImperativeHandle,
  forwardRef,
  useCallback,
} from "react";
import Guacamole from "guacamole-common-js";
import { useTranslation } from "react-i18next";
import { getGuacamoleToken } from "@/main-axios.ts";
import { SimpleLoader } from "@/lib/SimpleLoader.tsx";
import { useIsTouchDevice } from "@/hooks/use-is-touch-device";
import type { GestureMode } from "./touch/gestures";
import { PhoneKeyboard } from "./touch/phone-keyboard";
import { TouchController } from "./touch/touch-controller";
import { useTouchMode } from "./touch/touch-mode";
import { FITTED_VIEW, fitScale, type Box, type ViewState } from "./touch/viewport";

export type GuacamoleConnectionType = "rdp" | "vnc" | "telnet";

// The Guacamole container box can extend past the visible viewport when
// an ancestor's overflow-hidden clips it (e.g. FullScreenAppWrapper's
// h-screen overflowing AppShell's tab cell by the topbar's height).
// getBoundingClientRect reports the full box, so guacd ends up rendering
// at a size larger than the user can see. Clamp to the visible portion.
function measureVisibleSize(el: HTMLElement): {
  width: number;
  height: number;
} {
  const rect = el.getBoundingClientRect();
  const left = Math.max(rect.left, 0);
  const top = Math.max(rect.top, 0);
  const right = Math.min(rect.right, window.innerWidth);
  const bottom = Math.min(rect.bottom, window.innerHeight);
  return {
    width: Math.max(0, right - left),
    height: Math.max(0, bottom - top),
  };
}

export interface GuacamoleConnectionConfig {
  token?: string;
  protocol?: GuacamoleConnectionType;
  type?: GuacamoleConnectionType;
  hostname?: string;
  port?: number;
  username?: string;
  password?: string;
  domain?: string;
  width?: number;
  height?: number;
  dpi?: number;
  [key: string]: unknown;
}

export interface GuacamoleDisplayHandle {
  disconnect: () => void;
  sendKey: (keysym: number, pressed: boolean) => void;
  sendMouse: (x: number, y: number, buttonMask: number) => void;
  setClipboard: (data: string) => void;
  /** Touch screens: raise the phone's keyboard, or put it away. Call from the tap's own handler. */
  toggleKeyboard: () => void;
}

interface GuacamoleDisplayProps {
  connectionConfig: GuacamoleConnectionConfig;
  isVisible: boolean;
  onConnect?: () => void;
  onDisconnect?: () => void;
  onError?: (error: string) => void;
  /**
   * Watch only: no mouse/keyboard capture, and no clipboard or file exchange
   * in either direction (the viewer's clipboard is never read, the remote
   * clipboard never written to it). Pair with guacd's `read-only` setting in
   * the token, which enforces the same thing server-side.
   */
  viewOnly?: boolean;
  /**
   * Never ask the remote to change its screen size — not on connect, not when
   * the container resizes. The picture is only scaled to fit the container.
   * For screens that belong to someone else (an agent's own desktop), where
   * resizing would re-lay-out their windows and leave the viewer scaled for
   * the old size.
   */
  fixedRemoteSize?: boolean;
  /**
   * Touch screens: where the zoomed view is kept, so it survives this display
   * being remounted (a reconnect). The parent holds it for the session.
   */
  touchView?: { current: ViewState };
  /** Touch screens: a key was typed on the phone keyboard (lets the key strip release held modifiers). */
  onPhoneTyped?: () => void;
}

const isDev = import.meta.env.DEV;

export const GuacamoleDisplay = forwardRef<
  GuacamoleDisplayHandle,
  GuacamoleDisplayProps
>(function GuacamoleDisplay(
  {
    connectionConfig,
    isVisible,
    onConnect,
    onDisconnect,
    onError,
    viewOnly = false,
    fixedRemoteSize = false,
    touchView,
    onPhoneTyped,
  },
  ref,
) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const displayRef = useRef<HTMLDivElement>(null);
  const displayElementRef = useRef<HTMLElement | null>(null);
  const clientRef = useRef<Guacamole.Client | null>(null);
  const keyboardRef = useRef<Guacamole.Keyboard | null>(null);
  const scaleRef = useRef<number>(1);
  const resizeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasKeyboardFocusRef = useRef(false);
  const windowFocusedRef = useRef(
    typeof document === "undefined" ? true : document.hasFocus(),
  );
  const [isReady, setIsReady] = useState(false);
  const [hasError, setHasError] = useState(false);
  const fixedRemoteSizeRef = useRef(fixedRemoteSize);
  fixedRemoteSizeRef.current = fixedRemoteSize;

  // Touch input: on a touch screen, an interactive display takes touches as
  // mouse input (trackpad or direct; telnet only scrolls), pinch-zooms, and
  // can raise the phone's keyboard.
  const isTouchDevice = useIsTouchDevice();
  const touchMode = useTouchMode();
  const protocolForTouch = connectionConfig.protocol ?? connectionConfig.type;
  const gestureMode: GestureMode =
    protocolForTouch === "telnet" ? "scroll-only" : touchMode;
  const touchEnabled = isTouchDevice && !viewOnly;
  const touchEnabledRef = useRef(touchEnabled);
  touchEnabledRef.current = touchEnabled;
  const gestureModeRef = useRef(gestureMode);
  gestureModeRef.current = gestureMode;
  const touchControllerRef = useRef<TouchController | null>(null);
  const phoneKeyboardRef = useRef<PhoneKeyboard | null>(null);
  const keyboardShownRef = useRef(false);
  const ownTouchViewRef = useRef<ViewState>({ ...FITTED_VIEW });
  const touchViewRef = touchView ?? ownTouchViewRef;
  const onPhoneTypedRef = useRef(onPhoneTyped);
  onPhoneTypedRef.current = onPhoneTyped;
  // Keys held down through the handle (the key strip's modifiers) — let go
  // before disconnecting, or the remote keeps them pressed (hand-back).
  const heldKeysRef = useRef<Set<number>>(new Set());

  useImperativeHandle(ref, () => ({
    disconnect: () => {
      if (clientRef.current) {
        clientRef.current.disconnect();
      }
    },
    sendKey: (keysym: number, pressed: boolean) => {
      if (clientRef.current) {
        clientRef.current.sendKeyEvent(pressed ? 1 : 0, keysym);
        if (pressed) heldKeysRef.current.add(keysym);
        else heldKeysRef.current.delete(keysym);
      }
    },
    sendMouse: (x: number, y: number, buttonMask: number) => {
      if (clientRef.current) {
        clientRef.current.sendMouseState(
          new Guacamole.Mouse.State({
            x,
            y,
            left: !!(buttonMask & 1),
            middle: !!(buttonMask & 2),
            right: !!(buttonMask & 4),
          }),
        );
      }
    },
    toggleKeyboard: () => {
      phoneKeyboardRef.current?.toggle();
    },
    setClipboard: (data: string) => {
      if (clientRef.current) {
        const stream = clientRef.current.createClipboardStream("text/plain");
        const writer = new Guacamole.StringWriter(stream);
        writer.sendText(data);
        writer.sendEnd();
      }
    },
  }));

  const getWebSocketUrl = useCallback(
    async (
      containerWidth: number,
      containerHeight: number,
    ): Promise<string | null> => {
      try {
        let token: string;
        const protocol = connectionConfig.protocol ?? connectionConfig.type;

        if (connectionConfig.token) {
          token = connectionConfig.token;
        } else {
          const data = await getGuacamoleToken({
            protocol: protocol ?? "rdp",
            hostname: String(connectionConfig.hostname ?? ""),
            port: connectionConfig.port,
            username: connectionConfig.username,
            password: connectionConfig.password,
            domain: connectionConfig.domain,
            security:
              typeof connectionConfig.security === "string"
                ? connectionConfig.security
                : undefined,
            ignoreCert:
              typeof connectionConfig.ignoreCert === "boolean"
                ? connectionConfig.ignoreCert
                : undefined,
            guacamoleConfig: connectionConfig.guacamoleConfig as Parameters<
              typeof getGuacamoleToken
            >[0]["guacamoleConfig"],
          });
          token = data.token;
        }

        const width = connectionConfig.width ?? containerWidth ?? 1280;
        const height = connectionConfig.height ?? containerHeight ?? 720;

        const wsBase = isDev
          ? `ws://localhost:30008`
          : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/guacamole/websocket/`;

        const params = new URLSearchParams({
          token,
          width: String(width),
          height: String(height),
        });
        return `${wsBase}?${params.toString()}`;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        onError?.(errorMessage);
        return null;
      }
    },
    [connectionConfig, onError],
  );

  const refreshKeyboardHandlers = useCallback(() => {
    const keyboard = keyboardRef.current;
    const client = clientRef.current;
    const displayElement = displayElementRef.current;

    if (!keyboard) return;

    const documentVisible =
      typeof document === "undefined" || document.visibilityState === "visible";
    const displayIsFocused =
      !!displayElement &&
      typeof document !== "undefined" &&
      document.activeElement === displayElement;
    const shouldCaptureInput =
      !!client &&
      !!displayElement &&
      isVisible &&
      documentVisible &&
      windowFocusedRef.current &&
      (hasKeyboardFocusRef.current || displayIsFocused);

    if (!shouldCaptureInput) {
      keyboard.onkeydown = null;
      keyboard.onkeyup = null;
      keyboard.reset();
      return;
    }

    keyboard.onkeydown = (keysym: number) => {
      if (!clientRef.current) return;
      if (!isVisible || !windowFocusedRef.current) return;

      const activeDisplay = displayElementRef.current;
      const stillFocused =
        !!activeDisplay &&
        typeof document !== "undefined" &&
        document.activeElement === activeDisplay;

      if (!hasKeyboardFocusRef.current && !stillFocused) return;
      clientRef.current.sendKeyEvent(1, keysym);
    };

    keyboard.onkeyup = (keysym: number) => {
      if (!clientRef.current) return;
      if (!isVisible || !windowFocusedRef.current) return;

      const activeDisplay = displayElementRef.current;
      const stillFocused =
        !!activeDisplay &&
        typeof document !== "undefined" &&
        document.activeElement === activeDisplay;

      if (!hasKeyboardFocusRef.current && !stillFocused) return;
      clientRef.current.sendKeyEvent(0, keysym);
    };
  }, [isVisible]);

  // The visible part of the display area in client coordinates — shorter
  // while the phone keyboard covers the bottom of the screen.
  const getTouchBox = useCallback((): Box => {
    const el = containerRef.current;
    if (!el) return { left: 0, top: 0, width: 0, height: 0 };
    const rect = el.getBoundingClientRect();
    let top = rect.top;
    let bottom = rect.bottom;
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (keyboardShownRef.current && vv) {
      // The page may also have scrolled up under the keyboard.
      top = Math.max(top, vv.offsetTop);
      bottom = Math.min(bottom, vv.offsetTop + vv.height);
    }
    return {
      left: rect.left,
      top,
      width: rect.width,
      height: Math.max(0, bottom - top),
    };
  }, []);

  const rescaleDisplay = useCallback((immediate: boolean = false) => {
    if (!clientRef.current || !containerRef.current) return;

    const performRescale = () => {
      if (!clientRef.current || !containerRef.current) return;

      const display = clientRef.current.getDisplay();
      if (touchEnabledRef.current) {
        // Touch: fit to the visible box, then the zoomed view on top.
        const box = getTouchBox();
        const remote = { width: display.getWidth(), height: display.getHeight() };
        if (remote.width > 0 && remote.height > 0 && box.width > 0 && box.height > 0) {
          const view = touchViewRef.current;
          const scale = fitScale(box, remote) * view.zoom;
          scaleRef.current = scale;
          display.scale(scale);
          const wrapper = displayRef.current;
          if (wrapper) {
            // Centre in the visible box, which may start below the container's top.
            const dy = box.top - containerRef.current.getBoundingClientRect().top;
            wrapper.style.height = keyboardShownRef.current ? `${box.height}px` : "";
            const ty = view.ty + dy;
            wrapper.style.transform =
              view.tx || ty ? `translate(${view.tx}px, ${ty}px)` : "";
          }
        }
        return;
      }
      // No touch (or it was switched off mid-session): no zoom offsets.
      const wrapper = displayRef.current;
      if (wrapper && (wrapper.style.transform || wrapper.style.height)) {
        wrapper.style.transform = "";
        wrapper.style.height = "";
      }
      const cWidth = containerRef.current.clientWidth;
      const cHeight = containerRef.current.clientHeight;
      const displayWidth = display.getWidth();
      const displayHeight = display.getHeight();

      if (displayWidth > 0 && displayHeight > 0 && cWidth > 0 && cHeight > 0) {
        const scale = Math.min(cWidth / displayWidth, cHeight / displayHeight);
        scaleRef.current = scale;
        display.scale(scale);
        if (fixedRemoteSizeRef.current) {
          console.info("[guacamole] rescale (fixed remote size)", {
            remote: `${displayWidth}x${displayHeight}`,
            container: `${cWidth}x${cHeight}`,
            scale: Number(scale.toFixed(3)),
          });
        }
      }
    };

    if (immediate) {
      performRescale();
    } else {
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      resizeTimeoutRef.current = setTimeout(performRescale, 200);
    }
  }, [getTouchBox, touchViewRef]);

  // Touch input for an interactive display on a touch screen: gestures to
  // the remote mouse and zoomed view, plus the phone keyboard. Attached on
  // connect, or later if touch support turns on mid-session.
  const attachTouchInput = useCallback(() => {
    const container = containerRef.current;
    const client = clientRef.current;
    const displayElement = displayElementRef.current;
    if (!touchEnabledRef.current || !container || !client || !displayElement) return;
    touchControllerRef.current?.destroy();
    touchControllerRef.current = new TouchController({
      element: container,
      mode: gestureModeRef.current,
      getRemote: () => ({
        width: client.getDisplay().getWidth(),
        height: client.getDisplay().getHeight(),
      }),
      getBox: getTouchBox,
      view: touchViewRef.current,
      onViewChange: (view) => {
        touchViewRef.current = view;
        rescaleDisplay(true);
      },
      sendMouse: (x, y, b) => {
        client.sendMouseState(
          new Guacamole.Mouse.State(x, y, b.left, b.middle, b.right, b.up, b.down) as Guacamole.Mouse.State,
        );
      },
      // A tablet's hardware keyboard types into the display once it's touched.
      onTouchStart: () => {
        if (!keyboardShownRef.current) displayElement.focus({ preventScroll: true });
      },
    });
    phoneKeyboardRef.current?.destroy();
    phoneKeyboardRef.current = new PhoneKeyboard({
      host: container,
      sendKey: (keysym, pressed) => client.sendKeyEvent(pressed ? 1 : 0, keysym),
      onTyped: () => onPhoneTypedRef.current?.(),
      onShownChange: (shown) => {
        keyboardShownRef.current = shown;
        // The phone's keyboard animates in; settle once the screen has.
        touchControllerRef.current?.refit();
        rescaleDisplay(true);
        setTimeout(() => {
          touchControllerRef.current?.refit();
          rescaleDisplay(true);
        }, 350);
      },
    });
  }, [getTouchBox, rescaleDisplay, touchViewRef]);

  const detachTouchInput = useCallback(() => {
    touchControllerRef.current?.destroy();
    touchControllerRef.current = null;
    phoneKeyboardRef.current?.destroy();
    phoneKeyboardRef.current = null;
    keyboardShownRef.current = false;
  }, []);

  const connect = useCallback(async () => {
    if (isConnectingRef.current) return;
    isConnectingRef.current = true;
    setIsReady(false);
    setHasError(false);

    // Wait two frames so the container is fully laid out before measuring.
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );

    const size = containerRef.current
      ? measureVisibleSize(containerRef.current)
      : { width: 0, height: 0 };
    let containerWidth = size.width;
    let containerHeight = size.height;

    if (containerWidth < 100 || containerHeight < 100) {
      containerWidth = window.innerWidth || 1280;
      containerHeight = window.innerHeight || 720;
    }

    const wsUrl = await getWebSocketUrl(containerWidth, containerHeight);
    if (!wsUrl) {
      isConnectingRef.current = false;
      return;
    }

    const tunnel = new Guacamole.WebSocketTunnel(wsUrl);
    const client = new Guacamole.Client(tunnel);
    clientRef.current = client;

    const display = client.getDisplay();
    const displayElement = display.getElement();
    displayElementRef.current = displayElement;

    if (displayRef.current) {
      displayRef.current.innerHTML = "";
      displayRef.current.appendChild(displayElement);
    }

    displayElement.setAttribute("tabindex", "0");
    displayElement.style.outline = "none";

    display.onresize = () => {
      // A new remote size: keep the zoomed view inside the new picture.
      touchControllerRef.current?.refit();
      rescaleDisplay(true);
      setIsReady(true);
    };

    const protocol = connectionConfig.protocol ?? connectionConfig.type;
    if (protocol === "telnet") {
      setIsReady(true);
    }

    if (!viewOnly) {
      const mouse = new Guacamole.Mouse(displayElement);
      // Guacamole.Mouse positions the pointer by summing offsetLeft/offsetTop
      // up the offsetParent chain, which ignores CSS transforms — inside a
      // modal centred with translate(-50%,-50%) every click landed offset by
      // that translation. Record the real client position (capture phase, so
      // before Guacamole.Mouse's own handlers) and measure it against the
      // display's on-screen box instead.
      const lastClient = { x: NaN, y: NaN };
      const recordPointer = (e: MouseEvent) => {
        lastClient.x = e.clientX;
        lastClient.y = e.clientY;
      };
      for (const type of ["mousemove", "mousedown", "mouseup", "wheel"]) {
        displayElement.addEventListener(type, recordPointer as EventListener, true);
      }
      const sendMouseState = (state: Guacamole.Mouse.State) => {
        displayElement.focus({ preventScroll: true });
        const scale = scaleRef.current;
        let x = state.x;
        let y = state.y;
        if (Number.isFinite(lastClient.x)) {
          const rect = displayElement.getBoundingClientRect();
          x = lastClient.x - rect.left;
          y = lastClient.y - rect.top;
        }
        const adjustedX = Math.round(x / scale);
        const adjustedY = Math.round(y / scale);

        const adjustedState = new Guacamole.Mouse.State(
          adjustedX,
          adjustedY,
          state.left,
          state.middle,
          state.right,
          state.up,
          state.down,
        ) as Guacamole.Mouse.State;

        client.sendMouseState(adjustedState);
      };
      mouse.onmousedown = mouse.onmouseup = mouse.onmousemove = sendMouseState;

      const keyboard = new Guacamole.Keyboard(displayElement);
      keyboardRef.current = keyboard;

      const handleDisplayFocus = () => {
        hasKeyboardFocusRef.current = true;
        refreshKeyboardHandlers();
      };

      const handleDisplayBlur = () => {
        hasKeyboardFocusRef.current = false;
        refreshKeyboardHandlers();
      };

      displayElement.addEventListener("focus", handleDisplayFocus);
      displayElement.addEventListener("blur", handleDisplayBlur);
      displayElement.addEventListener("mousedown", handleDisplayFocus);
      refreshKeyboardHandlers();

      attachTouchInput();
    }

    client.onstatechange = (state: number) => {
      switch (state) {
        case 0:
          break;
        case 1:
          break;
        case 2:
          break;
        case 3:
          isConnectingRef.current = false;
          setIsReady(true);
          onConnect?.();
          if (!fixedRemoteSizeRef.current && containerRef.current) {
            const { width, height } = measureVisibleSize(containerRef.current);
            const w = Math.round(width);
            const h = Math.round(height);
            if (w > 0 && h > 0) client.sendSize(w, h);
          }
          rescaleDisplay(false);
          break;
        case 4:
          break;
        case 5:
          setIsReady(false);
          hasKeyboardFocusRef.current = false;
          refreshKeyboardHandlers();
          // Skip the disconnect callback during unmount — cleanup calls
          // client.disconnect() which fires state 5 asynchronously, and we
          // don't want the parent to schedule a reconnect for a tab that's
          // gone. isMountedRef is flipped to false before disconnect().
          if (isMountedRef.current) onDisconnect?.();
          break;
      }
    };

    client.onerror = (error: Guacamole.Status) => {
      const errorMessage = error.message || t("guacamole.connectionError");
      setIsReady(false);
      setHasError(true);
      isConnectingRef.current = false;
      onError?.(errorMessage);
    };

    if (!viewOnly) {
      client.onclipboard = (
        stream: Guacamole.InputStream,
        mimetype: string,
      ) => {
        if (mimetype === "text/plain") {
          const reader = new Guacamole.StringReader(stream);
          let data = "";
          reader.ontext = (text: string) => {
            data += text;
          };
          reader.onend = () => {
            navigator.clipboard?.writeText?.(data).catch(() => {});
          };
        }
      };

      client.onaudio = (stream: Guacamole.InputStream, mimetype: string) => {
        Guacamole.AudioPlayer.getInstance(stream, mimetype);
      };

      client.onfile = (
        stream: Guacamole.InputStream,
        mimetype: string,
        filename: string,
      ) => {
        const reader = new Guacamole.BlobReader(stream, mimetype);
        reader.onend = () => {
          const blob = reader.getBlob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          a.click();
          URL.revokeObjectURL(url);
        };
        stream.sendAck("OK", Guacamole.Status.Code.SUCCESS);
      };
    }

    client.connect();
  }, [
    getWebSocketUrl,
    onConnect,
    onDisconnect,
    onError,
    refreshKeyboardHandlers,
    rescaleDisplay,
    connectionConfig.protocol,
    connectionConfig.type,
    t,
    viewOnly,
    attachTouchInput,
  ]);

  const hasInitiatedRef = useRef(false);
  const isMountedRef = useRef(false);
  const isConnectingRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;

    if (isVisible && !hasInitiatedRef.current) {
      hasInitiatedRef.current = true;
      connect();
    }
  }, [isVisible, connect]);

  useEffect(() => {
    if (!isVisible) {
      hasKeyboardFocusRef.current = false;
    }

    refreshKeyboardHandlers();
  }, [isVisible, refreshKeyboardHandlers]);

  useEffect(() => {
    const handleWindowFocus = () => {
      windowFocusedRef.current = true;
      refreshKeyboardHandlers();
    };

    const handleWindowBlur = () => {
      windowFocusedRef.current = false;
      hasKeyboardFocusRef.current = false;
      refreshKeyboardHandlers();
    };

    const handleVisibilityChange = () => {
      windowFocusedRef.current =
        document.visibilityState === "visible" && document.hasFocus();
      if (document.visibilityState !== "visible") {
        hasKeyboardFocusRef.current = false;
      }
      refreshKeyboardHandlers();
    };

    window.addEventListener("focus", handleWindowFocus);
    window.addEventListener("blur", handleWindowBlur);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("focus", handleWindowFocus);
      window.removeEventListener("blur", handleWindowBlur);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshKeyboardHandlers]);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
      hasInitiatedRef.current = false;
      isConnectingRef.current = false;
      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
      }
      touchControllerRef.current?.destroy();
      touchControllerRef.current = null;
      phoneKeyboardRef.current?.destroy();
      phoneKeyboardRef.current = null;
      if (clientRef.current) {
        for (const k of heldKeysRef.current) clientRef.current.sendKeyEvent(0, k);
        heldKeysRef.current.clear();
        clientRef.current.disconnect();
        clientRef.current = null;
      }
      displayElementRef.current = null;
    };
  }, []);

  useEffect(() => {
    touchControllerRef.current?.setMode(gestureMode);
  }, [gestureMode]);

  // Touch support can change mid-session (a mouse attached to a tablet).
  useEffect(() => {
    if (touchEnabled) {
      if (!touchControllerRef.current && clientRef.current) attachTouchInput();
    } else if (touchControllerRef.current) {
      detachTouchInput();
    } else {
      return;
    }
    rescaleDisplay(true);
  }, [touchEnabled, attachTouchInput, detachTouchInput, rescaleDisplay]);

  // The phone keyboard (and rotation, and browser bars) change the visible
  // part of the screen without resizing the display's box.
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!touchEnabled || !vv) return;
    const onViewport = () => {
      touchControllerRef.current?.refit();
      rescaleDisplay(true);
    };
    vv.addEventListener("resize", onViewport);
    vv.addEventListener("scroll", onViewport);
    return () => {
      vv.removeEventListener("resize", onViewport);
      vv.removeEventListener("scroll", onViewport);
    };
  }, [touchEnabled, rescaleDisplay]);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver(() => {
      // Fixed-size remote: only the picture's scale follows the container.
      if (fixedRemoteSizeRef.current) {
        touchControllerRef.current?.refit();
        rescaleDisplay(false);
        return;
      }
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current);
      resizeTimeoutRef.current = setTimeout(() => {
        if (clientRef.current && containerRef.current) {
          const { width, height } = measureVisibleSize(containerRef.current);
          const w = Math.round(width);
          const h = Math.round(height);
          if (w > 0 && h > 0) {
            clientRef.current.sendSize(w, h);
          }
        }
      }, 150);
    });

    resizeObserver.observe(containerRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [rescaleDisplay]);

  const syncClipboard = useCallback(() => {
    const client = clientRef.current;
    if (viewOnly || !client || !navigator.clipboard?.readText) return;
    navigator.clipboard
      .readText()
      .then((text) => {
        if (text) {
          const stream = client.createClipboardStream("text/plain");
          const writer = new Guacamole.StringWriter(stream);
          writer.sendText(text);
          writer.sendEnd();
        }
      })
      .catch(() => {});
  }, [viewOnly]);

  useEffect(() => {
    if (isVisible && isReady) {
      syncClipboard();
    }
  }, [isVisible, isReady, syncClipboard]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isReady) return;

    const handleFocus = () => syncClipboard();
    container.addEventListener("mouseenter", handleFocus);

    return () => {
      container.removeEventListener("mouseenter", handleFocus);
    };
  }, [isReady, syncClipboard]);

  const connectingMessage = t("guacamole.connecting", {
    type: (
      connectionConfig.protocol ||
      connectionConfig.type ||
      "remote"
    ).toUpperCase(),
  });

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      data-testid="guacamole-display"
      // Touch: the desktop takes every touch — no page scroll or zoom, and
      // the swipe back to the list never starts here.
      {...(touchEnabled ? { "data-no-swipe-to-list": "" } : {})}
      style={{
        backgroundColor: "var(--bg-base)",
        ...(touchEnabled ? { touchAction: "none" } : {}),
      }}
    >
      <div
        ref={displayRef}
        // A fixed-size remote (an agent's desktop) is letterboxed when its
        // aspect differs from the box, so center it both ways; a resizing
        // remote fills the box and stays top-aligned. Touch zoom works
        // about the centre, so touch always centres.
        className={`relative w-full h-full flex ${fixedRemoteSize || touchEnabled ? "items-center" : "items-start"} justify-center`}
        style={{
          cursor: isReady && !viewOnly ? "none" : "default",
          visibility: isReady ? "visible" : "hidden",
        }}
      />

      <SimpleLoader
        visible={!isReady && !hasError}
        message={connectingMessage}
      />
    </div>
  );
});
