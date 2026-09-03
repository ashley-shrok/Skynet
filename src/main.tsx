/* eslint-disable react-refresh/only-export-components */
import { prepareClientCacheVersion } from "@/lib/client-cache-version";
import { StrictMode, Suspense, lazy, useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import "./ui/index.css";
import "./ui/features/pretty-conversations/pretty-conversations.css";
import { ThemeProvider } from "@/components/theme-provider";
import "./ui/i18n/i18n";
import { isElectron } from "@/lib/electron";
import { Toaster } from "@/components/sonner";
import { Auth, getStoredAuth, clearStoredAuth } from "@/auth/Auth";
import { getUserInfo, getCurrentToken, appReadyPromise } from "@/main-axios";
import { applyAccentColor, applyFontSize } from "@/lib/theme";
import type { FontSizeId } from "@/types/ui-types";
import { useServiceWorker } from "@/hooks/use-service-worker";
import { useTranslation } from "react-i18next";
import { snapshotPendingTab } from "@/lib/tab-url";
import { initConsoleForwarder } from "@/lib/console-forwarder";
import { startDiagEmitter } from "@/lib/diag-emitter";
import { fetchBrandingConfig } from "@/branding/branding-fetch";

// Patch #146: install console-forwarder before anything else so all
// subsequent console.log/warn/error calls are intercepted and batched
// to /debug/console-log for server-side grep via docker exec.
initConsoleForwarder();

// Phase 31 D-02: PWA lifecycle structured logs at page level.
// Distinct from console-forwarder.ts's visibilitychange handler (which only
// calls flushBeacon) — different concerns. These emit [pwa] lines for
// diagnosis of "app hangs on page-restore", "tabs discarded by iOS", etc.
export function registerPwaLifecycleLogs(): void {
  window.addEventListener("visibilitychange", () => {
    console.info(`[pwa] visibility-change state=${document.visibilityState} hidden=${document.hidden}`);
  });
  window.addEventListener("pagehide", (e: PageTransitionEvent) => {
    console.info(`[pwa] pagehide persisted=${e.persisted}`);
  });
  window.addEventListener("pageshow", (e: PageTransitionEvent) => {
    console.info(`[pwa] pageshow persisted=${e.persisted}`);
  });
}
registerPwaLifecycleLogs();

// Phase 31 D-02: boot boundary log — surfaces whether the app init path
// fired at all and from which URL. UA truncated to 80 chars (T-31-14: UA is
// already public, sent on every HTTP request; no additional exposure).
console.info(`[pwa] boot ts=${Date.now()} ua="${navigator.userAgent.slice(0, 80)}" pathname=${window.location.pathname}`);

// Bounty pretty-view-per-pane-cost-diag: kick off the per-pane cost
// diag emitter. Rides the console-forwarder above — every 30s it walks
// the diag registry and console.logs one [DIAG-REPORT] envelope.
// Removable in ~5 min when the mitigation shape is chosen.
startDiagEmitter();

// Preserve ?tab=<spec> across the auth flow. Auth.tsx / LoginPage.tsx call
// replaceState in several branches that would otherwise strip the query
// string before AppShell mounts.
snapshotPendingTab();
console.info(`[pwa] snapshot-tab-restore result=no-pending`);

const AppShell = lazy(() =>
  import("@/AppShell").then((m) => ({ default: m.AppShell })),
);

// Full-screen apps opened via query params (e.g. from external links or Electron)
const TerminalApp = lazy(() =>
  import("@/features/terminal/TerminalApp").then((m) => ({
    default: m.default,
  })),
);
const GuacamoleApp = lazy(() =>
  import("@/features/guacamole/GuacamoleApp").then((m) => ({
    default: m.default,
  })),
);

const ElectronVersionCheck = lazy(() =>
  import("@/user/ElectronVersionCheck").then((module) => ({
    default: module.ElectronVersionCheck,
  })),
);

type Phase =
  | "verifying"
  | "idle-auth"
  | "fading-in"
  | "idle-app"
  | "fading-out";

function FullscreenApp() {
  const searchParams = new URLSearchParams(window.location.search);
  const view = searchParams.get("view");
  const hostId = searchParams.get("hostId");

  switch (view) {
    case "terminal":
      return <TerminalApp hostId={hostId || undefined} />;
    case "rdp":
    case "vnc":
    case "telnet":
      return <GuacamoleApp hostId={hostId || undefined} />;
    default:
      return null;
  }
}

function App() {
  const stored = getStoredAuth();
  const [phase, setPhase] = useState<Phase>(
    stored?.loggedIn ? "verifying" : "idle-auth",
  );
  const [authUsername, setAuthUsername] = useState(stored?.username ?? "");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const savedAccent = localStorage.getItem("skynet-accent");
    if (savedAccent) applyAccentColor(savedAccent);
    const savedSize = localStorage.getItem(
      "skynet-font-size",
    ) as FontSizeId | null;
    applyFontSize(savedSize ?? "lg");
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  // Verify stored session against the server before rendering AppShell.
  // Wait for API instances to be initialized with correct embedded/server config first.
  // In Electron, also repopulate localStorage["jwt"] so WebSocket connections can auth
  // after a session restore (the token is only written to localStorage during a fresh login).
  useEffect(() => {
    if (phase !== "verifying") return;
    appReadyPromise
      .then(() => getUserInfo())
      .then(() => {
        if (isElectron()) {
          getCurrentToken()
            .then((token) => {
              if (token) localStorage.setItem("jwt", token);
            })
            .catch(() => {});
        }
        setPhase("fading-in");
        timerRef.current = setTimeout(() => setPhase("idle-app"), 450);
      })
      .catch(() => {
        clearStoredAuth();
        setPhase("idle-auth");
      });
  }, [phase]);

  function handleLogin(u: string) {
    setAuthUsername(u);
    setPhase("fading-in");
    timerRef.current = setTimeout(() => setPhase("idle-app"), 450);
    if (isElectron()) {
      window.electronAPI?.startC2SAutoStartTunnels?.().catch(() => {});
    }
  }

  function handleLogout() {
    clearStoredAuth();
    setPhase("fading-out");
    timerRef.current = setTimeout(() => {
      setAuthUsername("");
      setPhase("idle-auth");
    }, 450);
  }

  const showApp =
    phase === "idle-app" || phase === "fading-in" || phase === "fading-out";
  const showAuth =
    phase === "idle-auth" || phase === "fading-in" || phase === "fading-out";
  const appOpacity = phase === "idle-app" ? 1 : 0;
  const authOpacity = phase === "idle-auth" ? 1 : 0;

  const { t } = useTranslation();
  const isTransitioning = phase === "fading-in" || phase === "fading-out";

  if (phase === "verifying") {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {isTransitioning && (
        <div className="fixed inset-0 z-0 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-4">
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-muted-foreground">
              {t("common.loading")}
            </p>
          </div>
        </div>
      )}

      {showApp && (
        <div
          className="fixed inset-0 z-10 transition-opacity duration-[450ms] ease-in-out"
          style={{
            opacity: appOpacity,
            pointerEvents: phase === "idle-app" ? "auto" : "none",
          }}
        >
          <Suspense fallback={null}>
            <AppShell username={authUsername} onLogout={handleLogout} />
          </Suspense>
        </div>
      )}

      {showAuth && (
        <div
          className="fixed inset-0 z-20 transition-opacity duration-[450ms] ease-in-out"
          style={{
            opacity: authOpacity,
            pointerEvents: phase === "idle-auth" ? "auto" : "none",
          }}
        >
          <Auth onLogin={handleLogin} />
        </div>
      )}

      <Toaster position="bottom-right" />
    </>
  );
}

function RootApp() {
  const [showVersionCheck, setShowVersionCheck] = useState(true);

  useServiceWorker();

  const searchParams = new URLSearchParams(window.location.search);
  const isFullscreen = searchParams.has("view");

  if (isFullscreen) {
    return (
      <Suspense fallback={null}>
        <FullscreenApp />
      </Suspense>
    );
  }

  if (isElectron() && showVersionCheck) {
    return (
      <Suspense fallback={null}>
        <ElectronVersionCheck onContinue={() => setShowVersionCheck(false)} />
      </Suspense>
    );
  }

  return <App />;
}

// Phase 70: hydrate the branding-store from /api/branding.
// Fire-and-forget: the store's initial state is a bundled-default sentinel
// (byte-for-byte match with docker/branding-defaults/branding.json), so
// first-paint is defensible even if this fetch never resolves — matches
// today's t1000 "Skynet" behavior (Pitfall 5 mitigation, D-14). Runs in
// parallel with prepareClientCacheVersion(); createRoot render is NOT
// gated on the branding promise.
void fetchBrandingConfig();

prepareClientCacheVersion().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ThemeProvider defaultTheme="dark" storageKey="vite-ui-theme">
        <RootApp />
      </ThemeProvider>
    </StrictMode>,
  );
});
