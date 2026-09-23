// ─── SkewLockModal (Phase 111 Plan 02) ───────────────────────────────────────
//
// Shell-level, non-dismissible, framework-owned modal that renders when the
// skew-lock store transitions to `locked = true`. Mounted at App root (as a
// sibling of <Toaster> at src/main.tsx:243) so it paints above every app
// surface regardless of which lane fired the lock (axios interceptor, WS
// handshake refusal, WS message tag mismatch).
//
// D-11 through D-14 (CONTEXT.md):
//   - D-11: pure firm modal — no in-between state.
//   - D-12: non-dismissible — no X, no escape, no click-outside. Single
//     [Reload] button.
//   - D-13: [Reload] calls window.location.reload() — no state carryover.
//   - D-14: fresh page fetches current shell → current assets → user is
//     approximately back at the same view.
//
// Reload-loop defense (RESEARCH.md §Pitfall 4): if `shouldSuppressReload()`
// returns true (>3 reload attempts within 60s), the modal renders a fatal-
// mode variant with a contact-support message and NO Reload button.
//
// Palette: existing `--color-pv-*` tokens used with direct `var()` (not
// `hsl(var(...))`, because Skynet's tokens are raw hex/rgba, not HSL
// triplets — see src/ui/index.css:143-159). Never the generic shadcn
// bg/fg tokens per role-file palette-authority rule.
//
// `inert` attribute on #root freezes underlying UI to pointer + keyboard
// events per D-12 non-dismissibility. React 19 supports `inert` as JSX
// prop, but we set it via document.getElementById("root") so the freeze
// covers the app-root's siblings too (not just this modal's parent tree).

import { useSyncExternalStore, useEffect } from "react";

import {
  getSkewLockedSnapshot,
  subscribeSkewLock,
} from "@/state/skew-lock-store";

import {
  recordReloadAttempt,
  shouldSuppressReload,
} from "./reload-loop-sentinel";

export function SkewLockModal() {
  const snapshot = useSyncExternalStore(
    subscribeSkewLock,
    getSkewLockedSnapshot,
    // useSyncExternalStore's server snapshot fallback — Skynet doesn't SSR,
    // but the API demands the third arg. Returning the same getter is safe
    // (both branches read the same module-scope state).
    getSkewLockedSnapshot,
  );

  useEffect(() => {
    if (!snapshot.locked) return;
    // Freeze the rest of the app from pointer / keyboard events. The `inert`
    // attribute is a browser-native gate on interaction into the subtree.
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    return () => {
      root?.removeAttribute("inert");
    };
  }, [snapshot.locked]);

  if (!snapshot.locked) return null;

  // Re-check on every render (cheap sessionStorage read). This is called
  // both for the top-level fatal-mode split AND inside the click handler
  // as a belt-and-suspenders race guard.
  const fatal = shouldSuppressReload();

  const handleReload = () => {
    recordReloadAttempt();
    // Race guard: if the record-attempt call itself pushed us into fatal-
    // mode (4th attempt inside the window), do NOT reload. The user gets
    // to see the fatal-mode variant on the next render — but they'd have
    // to close and reopen the tab to reach it (impossible from here), so
    // the guard is truly belt-and-suspenders.
    if (shouldSuppressReload()) return;
    window.location.reload();
  };

  return (
    <div
      className="skynet-skew-lock-backdrop fixed inset-0 z-[9999] flex items-center justify-center"
      style={{
        // Dark full-viewport backdrop above every surface. Palette-authority
        // rule (role file § Palette authority): pv tokens only — no
        // Skynet --background / --foreground / hardcoded hex. 92% opacity of
        // the darkest base-end token composited over transparent.
        backgroundColor:
          "color-mix(in srgb, var(--color-pv-base-end) 92%, transparent)",
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="skynet-skew-lock-title"
    >
      <div
        className="skynet-skew-lock-dialog max-w-md rounded-lg p-8"
        style={{
          backgroundColor: "var(--color-pv-base)",
          border: "1px solid var(--color-pv-border-quiet-strong)",
          boxShadow: "var(--shadow-pv-root)",
        }}
      >
        <h2
          id="skynet-skew-lock-title"
          className="skynet-skew-lock-title mb-4 text-lg font-semibold"
          style={{ color: "var(--color-pv-fg)" }}
        >
          {fatal ? "Something is wrong" : "A newer version is available"}
        </h2>
        <p
          className="skynet-skew-lock-body mb-6 text-sm"
          style={{ color: "var(--color-pv-fg-muted)" }}
        >
          {fatal ? "Please contact support." : "Reload to continue."}
        </p>
        {!fatal && (
          <button
            type="button"
            className="skynet-skew-lock-reload rounded-md px-4 py-2 text-sm font-medium"
            style={{
              backgroundColor: "var(--color-pv-fg)",
              color: "var(--color-pv-base)",
            }}
            onClick={handleReload}
          >
            Reload
          </button>
        )}
      </div>
    </div>
  );
}
