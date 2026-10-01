// SkewLockModal — shell-level, non-dismissible, framework-owned modal that
// renders when the skew-lock store transitions to `locked = true`. Mounted
// at App root as a sibling of <Toaster> at src/main.tsx so it paints above
// every app surface regardless of which lane fired the lock (axios
// interceptor, WS handshake refusal, WS message tag mismatch).
//
// Modal-unification 2026-09-29:
//   - Shell: canonical <Modal size="md" dismissible={false}>. Slate
//     shell — matches every other non-identity/non-role modal (2026-09-30
//     UAT: one canonical color for the class). Copy + Reload CTA carry
//     the "attention needed" signal.
//   - Head: canonical <ModalHead title="..." hideClose /> — non-dismissible
//     shells drop the close X.
//   - Foot: canonical <ModalFoot> with centered Reload button (or fatal-
//     mode: no button, contact-support message).
//   - Portal via Radix defaults to document.body — the modal sits OUTSIDE
//     #root so the `inert` attribute we set on #root (to freeze pointer +
//     keyboard events on the app subtree) doesn't also freeze the modal.
//
// D-11 through D-14 preserved:
//   - D-11: pure firm modal — no in-between state.
//   - D-12: non-dismissible — no X, no Esc, no click-outside (canonical
//     Modal blocks backdrop always; dismissible={false} + hideClose block
//     Esc + close-X).
//   - D-13: [Reload] calls window.location.reload() — no state carryover.
//   - D-14: fresh page fetches current shell → current assets → user is
//     approximately back at the same view.
//
// Reload-loop defense (RESEARCH.md §Pitfall 4): if `shouldSuppressReload()`
// returns true (>3 reload attempts within 60s), the modal renders a fatal-
// mode variant with a contact-support message and NO Reload button.

import { useSyncExternalStore, useEffect } from "react";

import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
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
    // Radix's focus-trap handles keyboard escape; `inert` is belt-and-
    // suspenders for pointer events on the shell (mouse-clicks on #root
    // shouldn't do anything even if the backdrop somehow lets them through).
    const root = document.getElementById("root");
    root?.setAttribute("inert", "");
    return () => {
      root?.removeAttribute("inert");
    };
  }, [snapshot.locked]);

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
    <Modal
      open={snapshot.locked}
      onOpenChange={() => {
        /* non-dismissible — canonical Modal blocks the paths here anyway */
      }}
      size="md"
      dismissible={false}
      data-testid="skew-lock-modal"
    >
      <ModalHead
        title={fatal ? "Something is wrong" : "Updates have been made"}
        hideClose
      />
      <ModalBody>
        {fatal ? "Please contact support." : "Reload to continue."}
      </ModalBody>
      {!fatal && (
        <ModalFoot className="justify-center">
          <button
            type="button"
            onClick={handleReload}
            data-testid="skew-lock-reload"
            className={
              "px-5 py-2 rounded-md text-[13px] font-medium cursor-pointer " +
              "bg-[hsla(var(--pv-id-hue),65%,55%,0.8)] text-[#fbf5e8] " +
              "border border-[hsla(var(--pv-id-hue),75%,65%,0.55)] " +
              "hover:bg-[hsla(var(--pv-id-hue),65%,55%,0.95)] transition-colors " +
              "min-w-[140px]"
            }
          >
            Reload
          </button>
        </ModalFoot>
      )}
    </Modal>
  );
}
