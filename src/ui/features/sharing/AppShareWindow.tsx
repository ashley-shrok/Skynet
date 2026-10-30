// AppShareWindow — the small window an app menu's "Share…" opens: the same
// ticked list as every other "Shared with", sitting in place, and Done.
//
// Like the kit's dialogs it renders into its own root on document.body, so
// both menus that offer it (the sidebar tile and the open app's bar) can open
// it from a plain menu item. The item only shows on a machine more than one
// person uses (useMultiUserMachine).
//
// Shape: .planning/shape-sharing-apps-tasks.closed.md

import * as React from "react";
import { createRoot } from "react-dom/client";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Modal } from "@/components/modal";
import { KitButton } from "@/components/kit";
import { isMultiUserMachine } from "@/api/sharing-api";
import { SharedWithButton } from "./SharedWithButton";

export interface AppShareTarget {
  hostId: number;
  slug: string;
  title: string;
}

let current: AppShareTarget | null = null;
let openCount = 0;
const listeners = new Set<() => void>();
let hostEl: HTMLElement | null = null;
let hostRoot: ReturnType<typeof createRoot> | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function ensureHost(): void {
  if (typeof document === "undefined") return;
  if (hostEl && document.body.contains(hostEl)) return;
  hostRoot?.unmount();
  const el = document.createElement("div");
  hostEl = el;
  el.setAttribute("data-app-share-host", "");
  document.body.appendChild(el);
  hostRoot = createRoot(el);
  hostRoot.render(<AppShareHost />);
}

export function openAppShareWindow(target: AppShareTarget): void {
  ensureHost();
  current = target;
  openCount += 1;
  console.info("[sharing] app share window opened", {
    operation: "app_share_window_opened",
    hostId: target.hostId,
    slug: target.slug,
  });
  emit();
}

function close(): void {
  current = null;
  emit();
}

function useCurrent(): { target: AppShareTarget | null; key: number } {
  const target = React.useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => current,
  );
  return { target, key: openCount };
}

function AppShareHost(): React.JSX.Element | null {
  const { target, key } = useCurrent();
  if (!target) return null;
  return (
    <Modal open onOpenChange={(o) => !o && close()} size="sm" data-testid="app-share-window" key={key}>
      <div className="k-dialog-body">
        <DialogPrimitive.Title className="k-dialog-title">Share {target.title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="k-dialog-text">Who sees this app in their sidebar.</DialogPrimitive.Description>
        <SharedWithButton
          inline
          hostId={target.hostId}
          kind="app"
          slug={target.slug}
          itemLabel={target.title}
          onGone={close}
          className="py-1"
        />
        <div className="k-dialog-acts">
          <KitButton variant="primary" onClick={close} data-testid="app-share-done">
            Done
          </KitButton>
        </div>
      </div>
    </Modal>
  );
}

/** True once a machine is known to have more than one person; false until then. */
export function useMultiUserMachine(hostId: number | null): boolean {
  const [multi, setMulti] = React.useState(false);
  React.useEffect(() => {
    if (hostId === null || !Number.isFinite(hostId)) return;
    let live = true;
    isMultiUserMachine(hostId).then(
      (m) => live && setMulti(m),
      (err: unknown) => {
        console.warn("[sharing] couldn't tell whether the machine has several people", {
          operation: "sharing_multi_user_check_failed",
          hostId,
          error: err instanceof Error ? err.message : String(err),
        });
      },
    );
    return () => {
      live = false;
    };
  }, [hostId]);
  return multi;
}

export function __resetAppShareWindowForTests(): void {
  current = null;
  hostRoot?.unmount();
  hostRoot = null;
  hostEl?.remove();
  hostEl = null;
}
