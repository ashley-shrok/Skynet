import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogHeader, DialogTitle, DialogClose } from "@/components/dialog";
import { Tabs, TabsContent } from "@/components/tabs";
import { cn } from "@/lib/utils";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  listGlobalFiles,
  readGlobalFile,
  writeGlobalFile,
  GlobalFileMtimeConflictError,
  type GlobalFileEntry,
} from "@/api/global-files-api";
import GlobalFileTab, { type GlobalFileTabData } from "./GlobalFileTab";
import type { TabState } from "./IdentityFileTab";

// Phase 23 GEFM-05: GlobalFilesModal — modal shell with host picker, dynamic
// per-file tabs, lazy per-tab SSH read, and save handler with 409 reload UX.
//
// Controlled component: callers own `open` + `onOpenChange` state.
// Plan 23-04 mounts it and drives open state from the panel-header menu.
//
// Modal chrome mirrors IdentityModal.tsx (DialogPrimitive + Tabs + glass close
// button). Host picker is a compact <select> (planner-locked in 23-03 plan).
// Uses --color-pv-* / literal glass hex per CONTEXT §GEFM-01 — no Skynet
// chrome tokens (bg-background, text-foreground, bg-popover).

// NOTE: duplicated from NewSessionDialog.tsx L83-100 + CreateRoleDialog.tsx L51-65
// pending shared HostPickerList extraction (RESEARCH F1). Third instance
// intentional — keeps plan 23-03 diff scoped to net-new files.
function isFolder(item: Host | HostFolder): item is HostFolder {
  return "children" in item;
}
function collectAllHosts(children: (Host | HostFolder)[]): Host[] {
  const out: Host[] = [];
  for (const child of children) {
    if (isFolder(child)) out.push(...collectAllHosts(child.children));
    else out.push(child);
  }
  return out;
}

export interface GlobalFilesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Host tree from useHostTree() upstream — same source NewSessionDialog uses. */
  hostTree: HostFolder | null;
  /** Default host selection — the currently-focused session's host, if any. */
  defaultHostId: number | null;
  /** Optional portal container to match parent modal-portal pattern (see IdentityModal). */
  container?: HTMLElement | null;
}

export default function GlobalFilesModal({
  open,
  onOpenChange,
  hostTree,
  defaultHostId,
  container,
}: GlobalFilesModalProps): JSX.Element {
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
  const [files, setFiles] = useState<TabState<GlobalFileEntry[]>>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabData, setTabData] = useState<Map<string, TabState<GlobalFileTabData>>>(new Map());

  const flatHosts = useMemo(
    () => collectAllHosts(hostTree?.children ?? []).filter((h) => h.enableRdp !== true),
    [hostTree],
  );

  // Auto-select host on open; reset state on close.
  useEffect(() => {
    if (!open) {
      setSelectedHostId(null);
      setFiles({ status: "loading" });
      setActiveTab(null);
      setTabData(new Map());
      return;
    }
    // Prefer defaultHostId if it's in the fleet
    if (defaultHostId != null && flatHosts.some((h) => Number(h.id) === defaultHostId)) {
      setSelectedHostId(defaultHostId);
      return;
    }
    // Auto-select sole host
    if (flatHosts.length === 1) setSelectedHostId(Number(flatHosts[0].id));
  }, [open, defaultHostId, flatHosts]);

  // Fetch file list when host changes
  useEffect(() => {
    if (selectedHostId == null) return;
    let cancelled = false;
    setFiles({ status: "loading" });
    setTabData(new Map());
    setActiveTab(null);
    listGlobalFiles(selectedHostId)
      .then((entries) => {
        if (cancelled) return;
        setFiles({ status: "ready", data: entries });
        if (entries.length > 0) setActiveTab(entries[0].path);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setFiles({
            status: "error",
            error: err instanceof Error ? err.message : "Failed to load files",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedHostId]);

  // Lazy-load content for the active tab (one at a time to avoid burning SSH connections)
  useEffect(() => {
    if (selectedHostId == null || !activeTab) return;
    if (tabData.has(activeTab)) return; // already loaded
    let cancelled = false;
    setTabData((prev) => new Map(prev).set(activeTab, { status: "loading" }));
    readGlobalFile(selectedHostId, activeTab)
      .then((result) => {
        if (cancelled) return;
        setTabData((prev) =>
          new Map(prev).set(activeTab, {
            status: "ready",
            data: { content: result.content, mtime: result.mtime },
          }),
        );
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setTabData((prev) =>
          new Map(prev).set(activeTab, {
            status: "error",
            error: err instanceof Error ? err.message : "Failed to load",
          }),
        );
      });
    return () => {
      cancelled = true;
    };
    // Intentional exhaustive-deps violation: including `tabData` re-runs this effect after
    // `setTabData({loading})`, whose cleanup sets `cancelled = true` on the still-in-flight
    // `readGlobalFile` (see plan 260805-7rq). The `tabData.has(activeTab)` gate inside the
    // body is a deliberate stale-closure read — "if the currently-known map already tracks
    // this tab, skip".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHostId, activeTab]);

  // Save handler with 409 → confirm + reload UX (planner-locked: minimal alert + refetch)
  const handleSave = useCallback(
    async (path: string, content: string, expectedMtime: number): Promise<void> => {
      if (selectedHostId == null) return;
      try {
        const result = await writeGlobalFile({ hostId: selectedHostId, path, content, expectedMtime });
        // Update tab with server-authoritative mtime so next save doesn't spurious-409
        setTabData((prev) =>
          new Map(prev).set(path, { status: "ready", data: { content, mtime: result.mtime } }),
        );
      } catch (err) {
        if (err instanceof GlobalFileMtimeConflictError) {
          const shouldReload = window.confirm(
            "The file changed on disk since you started editing. Reload from disk and lose your local edits?",
          );
          if (shouldReload) {
            setTabData((prev) =>
              new Map(prev).set(path, {
                status: "ready",
                data: { content: err.currentContent, mtime: err.currentMtime },
              }),
            );
            // Don't rethrow — the user chose to reload; tab is reset silently
            return;
          }
          // User chose to keep draft — rethrow so the tab shows the error inline
          throw err;
        }
        throw err;
      }
    },
    [selectedHostId],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal container={container ?? undefined}>
        {/* Overlay — same z-index ladder as IdentityModal (patch #111) */}
        <DialogPrimitive.Overlay
          className={cn(
            "absolute inset-0 z-[110] bg-black/15",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            // Patch #111f pattern: prevent modal from closing when clicking
            // outside (e.g. into the composer). X and Esc remain valid close paths.
            e.preventDefault();
          }}
          className={cn(
            "absolute inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
          style={{
            background: "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: "1px solid hsla(220, 65%, 55%, 0.32)",
            boxShadow: "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
            color: "#e8e4d8",
          }}
        >
          {/* a11y: sr-only title for screen readers */}
          <DialogTitle className="sr-only">Global files</DialogTitle>

          {/* Header — mirrors IdentityModal L953-1051 chrome pattern */}
          <DialogHeader
            className="px-6 py-4 shrink-0 flex flex-row items-center gap-3"
            style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <div className="text-[15px] font-semibold text-[#f0ebe0]">Global files</div>

            {/* Host picker: compact <select> (planner-locked: modal header is tight) */}
            <select
              value={selectedHostId ?? ""}
              onChange={(e) =>
                setSelectedHostId(e.target.value ? Number(e.target.value) : null)
              }
              className="ml-2 px-3 py-1.5 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] text-sm outline-none cursor-pointer"
            >
              <option value="">Pick a host…</option>
              {flatHosts.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>

            <div className="flex-1" />

            {/* Glass X close button — verbatim from IdentityModal L1027-1050 */}
            <DialogClose asChild>
              <button
                type="button"
                aria-label="Close"
                title="Close"
                className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color,box-shadow] duration-200"
                style={{
                  background: "rgba(255, 255, 255, 0.04)",
                  border: "1px solid rgba(220, 225, 245, 0.10)",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
                  e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.22)";
                  e.currentTarget.style.boxShadow = "0 0 20px hsla(220, 60%, 50%, 0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                  e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.10)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <X className="size-4" />
              </button>
            </DialogClose>
          </DialogHeader>

          {/* Body — four branches: no host / loading / error / content */}
          {selectedHostId == null ? (
            <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
              Pick a host to load its configured files.
            </div>
          ) : files.status === "loading" ? (
            <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
              Loading…
            </div>
          ) : files.status === "error" ? (
            <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-6 text-center">
              {files.error}
            </div>
          ) : files.data.length === 0 ? (
            // Empty-state card (mirrors IdentityModal empty-state pattern; per GEFM-02
            // "never fabricate a file that isn't in the config")
            <div className="flex-1 flex flex-col items-center justify-center text-[#a89a80] gap-2 text-sm text-center px-6">
              <div>No global files configured for this host.</div>
              <div className="text-xs opacity-70">
                Edit{" "}
                <code className="px-1 rounded bg-black/30">/app/data/global-files.json</code>{" "}
                on the Skynet server to add entries. See{" "}
                <code className="px-1 rounded bg-black/30">23-BOOTSTRAP.md</code> in the
                phase folder.
              </div>
            </div>
          ) : (
            // Tabs — one TabsContent per configured file (per-tab lazy load)
            <Tabs
              value={activeTab ?? ""}
              onValueChange={setActiveTab}
              className="flex-1 min-h-0 flex flex-col"
            >
              {files.data.map((file) => (
                <TabsContent
                  key={file.path}
                  value={file.path}
                  className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
                >
                  <GlobalFileTab
                    state={tabData.get(file.path) ?? { status: "loading" }}
                    onSave={(content, expectedMtime) =>
                      handleSave(file.path, content, expectedMtime)
                    }
                  />
                </TabsContent>
              ))}

              {/* Bottom icon-bar section switcher — patch #191 style from IdentityModal L1400-1426 */}
              <div
                className="shrink-0 flex items-stretch justify-around px-2 py-1 border-t"
                style={{
                  borderTopColor: "rgba(220, 225, 245, 0.10)",
                  background:
                    "linear-gradient(180deg, rgba(18,20,28,0.62), rgba(28,30,40,0.55))",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                }}
              >
                {files.data.map((file) => {
                  const selected = activeTab === file.path;
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => setActiveTab(file.path)}
                      className={cn(
                        // min-w-0 lets the button shrink below intrinsic content
                        // width so the span's `truncate` can kick in; without it
                        // the flex-1 share is overridden by the label's nowrap
                        // min-content and truncation never fires.
                        "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-[10px] cursor-pointer transition-colors flex-1 min-w-0",
                        selected
                          ? "text-[#f0ebe0] font-semibold"
                          : "text-[#a89a80] hover:text-[#e8e4d8]",
                      )}
                      // 2026-08-05: hue-tinted glassy pill on the selected tab
                      // matches the IdentityModal treatment (hardcoded hue 220
                      // here — no per-identity context in this modal, blue is
                      // the modal's ambient color per L210 background).
                      style={
                        selected
                          ? {
                              background: "hsla(220, 80%, 60%, 0.18)",
                              boxShadow:
                                "inset 0 0 0 1px hsla(220, 80%, 70%, 0.28)",
                            }
                          : undefined
                      }
                    >
                      <FileText size={18} />
                      <span className="truncate w-full text-center">
                        {file.label ?? file.path.split("/").pop()}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Tabs>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
