// Patch #156: gate helper for the patch #143 v2 (Terminal.tsx) and patch #148
// (PrettyView.tsx) visibilitychange force-reconnect useEffects. Those effects
// are the correct behavior on iOS PWA — the OS silently kills WebSockets during
// backgrounding and Navigator.readyState continues to report OPEN on the dead
// socket for some period after resume, so we must force a fresh connection on
// every hidden→visible transition. On every other environment (Chrome desktop,
// Android, non-PWA Safari) WebSockets actually stay alive across tab-switches,
// and force-reconnecting them creates a session-attachment race in the backend
// (see `src/backend/ssh/terminal.ts` ws.on("close") + terminal-session-manager
// detachWs/destroySession) that surfaces as the Reconnect/Close overlay. This
// helper narrows the effects to iOS-PWA-only so desktop tab-switches are inert.

export function isIosPwa(): boolean {
  if (typeof window === "undefined") return false;
  // Navigator.standalone is iOS-Safari-only and not in the standard
  // lib.dom.d.ts Navigator type — the cast is deliberate.
  const standalone =
    (window.navigator as { standalone?: boolean }).standalone === true;
  const isIosUa = /iP(hone|ad|od)/.test(window.navigator.userAgent);
  return standalone && isIosUa;
}
