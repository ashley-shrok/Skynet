import { useCallback, useEffect, useMemo, useState } from "react";
import { FileText, X, Trash2 } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogHeader, DialogTitle, DialogClose } from "@/components/dialog";
import { Tabs, TabsContent } from "@/components/tabs";
import { cn } from "@/lib/utils";
import type { Host, HostFolder } from "@/types/ui-types";
import {
  listSkills,
  enumerateSkillFiles,
  readSkillFile,
  writeSkillFile,
  createSkillFile,
  deleteSkillFile,
  deleteSkill,
  SkillFileMtimeConflictError,
  SkillFileAlreadyExistsError,
  type SkillEntry,
  type SkillFileEntry,
} from "@/api/skills-api";
import SkillFileTab, { type SkillFileTabData } from "./SkillFileTab";
import DeleteConfirmDialog from "./DeleteConfirmDialog";
import type { TabState } from "./IdentityFileTab";

// Phase 44 SKILLED-05: SkillsEditorModal — modal shell with host picker + skill
// picker + dynamic per-file tabs (horizontal-scroll) + lazy per-tab SSH read +
// save handler with 409 reload UX + add-file prompt + delete-file/delete-skill
// modal-in-modal confirmations.
//
// Byte-shape mirror of GlobalFilesModal.tsx (Phase 23 GEFM-05) with the skill
// dimension threaded through every effect + a second <select> in the header +
// `+ Add file` and delete-skill buttons + horizontal-scroll tab strip (D-06) +
// two DeleteConfirmDialog mounts inside the same Portal.
//
// Controlled component: callers own `open` + `onOpenChange` state. Wave 3
// mounts it and drives open state from the panel-header menu.

// NOTE: duplicated from GlobalFilesModal.tsx L32-42 (which itself is the third
// duplication instance from NewSessionDialog + CreateRoleDialog). Fourth
// intentional duplication — keeps plan 44-02 diff scoped to net-new files.
// Extracting a shared HostPickerList is Post-Planning-Gaps material.
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

export interface SkillsEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Host tree from useHostTree() upstream — same source NewSessionDialog + GlobalFilesModal use. */
  hostTree: HostFolder | null;
  /** Default host selection — the currently-focused session's host, if any. */
  defaultHostId: number | null;
  /** Optional portal container to match parent modal-portal pattern (see GlobalFilesModal). */
  container?: HTMLElement | null;
}

export default function SkillsEditorModal({
  open,
  onOpenChange,
  hostTree,
  defaultHostId,
  container,
}: SkillsEditorModalProps): JSX.Element {
  const [selectedHostId, setSelectedHostId] = useState<number | null>(null);
  const [selectedSkillName, setSelectedSkillName] = useState<string | null>(null);
  const [skills, setSkills] = useState<TabState<SkillEntry[]>>({ status: "loading" });
  const [files, setFiles] = useState<TabState<SkillFileEntry[]>>({ status: "loading" });
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabData, setTabData] = useState<Map<string, TabState<SkillFileTabData>>>(new Map());

  // Delete confirmation state (two dialogs — one for file, one for skill).
  const [deleteFileConfirm, setDeleteFileConfirm] = useState<{ path: string } | null>(null);
  const [deleteSkillConfirm, setDeleteSkillConfirm] = useState<boolean>(false);
  const [deleteInFlight, setDeleteInFlight] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Pitfall 7: RDP-only hosts don't have SSH — filter them out. Verbatim from
  // GlobalFilesModal.tsx L68 — this filter is load-bearing.
  const flatHosts = useMemo(
    () => collectAllHosts(hostTree?.children ?? []).filter((h) => h.enableRdp !== true),
    [hostTree],
  );

  // Auto-select host on open; reset state on close. Mirrors GlobalFilesModal L73-88.
  useEffect(() => {
    if (!open) {
      setSelectedHostId(null);
      setSelectedSkillName(null);
      setSkills({ status: "loading" });
      setFiles({ status: "loading" });
      setActiveTab(null);
      setTabData(new Map());
      setDeleteFileConfirm(null);
      setDeleteSkillConfirm(false);
      setDeleteInFlight(false);
      setDeleteError(null);
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

  // Fetch skills list when host changes. Also clears any downstream state
  // (skill selection, files, active tab, tab data) so we don't render stale
  // artifacts from the previous host.
  useEffect(() => {
    if (selectedHostId == null) return;
    let cancelled = false;
    setSkills({ status: "loading" });
    setSelectedSkillName(null);
    setFiles({ status: "loading" });
    setActiveTab(null);
    setTabData(new Map());
    listSkills(selectedHostId)
      .then((entries) => {
        if (cancelled) return;
        setSkills({ status: "ready", data: entries });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setSkills({
            status: "error",
            error: err instanceof Error ? err.message : "Failed to load skills",
          });
      });
    return () => {
      cancelled = true;
    };
  }, [selectedHostId]);

  // Fetch file list when skill changes.
  useEffect(() => {
    if (selectedHostId == null || selectedSkillName == null) {
      setFiles({ status: "loading" });
      setActiveTab(null);
      setTabData(new Map());
      return;
    }
    let cancelled = false;
    setFiles({ status: "loading" });
    setActiveTab(null);
    setTabData(new Map());
    enumerateSkillFiles(selectedHostId, selectedSkillName)
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
  }, [selectedHostId, selectedSkillName]);

  // Lazy-load content for the active tab (one at a time to avoid burning SSH connections).
  // Deps are [selectedHostId, selectedSkillName, activeTab] — NOT tabData — per
  // Phase 23's quick-260805-7rq race fix (see load-bearing comment below).
  useEffect(() => {
    if (selectedHostId == null || !selectedSkillName || !activeTab) return;
    if (tabData.has(activeTab)) return; // already loaded
    let cancelled = false;
    setTabData((prev) => new Map(prev).set(activeTab, { status: "loading" }));
    readSkillFile(selectedHostId, selectedSkillName, activeTab)
      .then((result) => {
        if (cancelled) return;
        setTabData((prev) =>
          new Map(prev).set(activeTab, {
            status: "ready",
            data: {
              content: result.content,
              mtime: result.mtime,
              isText: result.isText,
            },
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
    // `readSkillFile` (see plan 260805-7rq). The `tabData.has(activeTab)` gate inside the
    // body is a deliberate stale-closure read — "if the currently-known map already tracks
    // this tab, skip".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedHostId, selectedSkillName, activeTab]);

  // Save handler with 409 → confirm + reload UX (mirrors GlobalFilesModal L152-183).
  const handleSave = useCallback(
    async (path: string, content: string, expectedMtime: number): Promise<void> => {
      if (selectedHostId == null || selectedSkillName == null) return;
      try {
        const result = await writeSkillFile({
          hostId: selectedHostId,
          skill: selectedSkillName,
          path,
          content,
          expectedMtime,
        });
        // Update tab with server-authoritative mtime so next save doesn't spurious-409.
        // Preserve isText from the previously-loaded state (text files stay text).
        setTabData((prev) => {
          const prevEntry = prev.get(path);
          const prevIsText =
            prevEntry?.status === "ready" ? prevEntry.data.isText : true;
          return new Map(prev).set(path, {
            status: "ready",
            data: { content, mtime: result.mtime, isText: prevIsText },
          });
        });
      } catch (err) {
        if (err instanceof SkillFileMtimeConflictError) {
          const shouldReload = window.confirm(
            "The file changed on disk since you started editing. Reload from disk and lose your local edits?",
          );
          if (shouldReload) {
            setTabData((prev) => {
              const prevEntry = prev.get(path);
              const prevIsText =
                prevEntry?.status === "ready" ? prevEntry.data.isText : true;
              return new Map(prev).set(path, {
                status: "ready",
                data: {
                  content: err.currentContent,
                  mtime: err.currentMtime,
                  isText: prevIsText,
                },
              });
            });
            return;
          }
          throw err;
        }
        throw err;
      }
    },
    [selectedHostId, selectedSkillName],
  );

  // Add-file handler — window.prompt per UI-SPEC L176, then refetch file list.
  const handleAddFile = useCallback(async (): Promise<void> => {
    if (selectedHostId == null || selectedSkillName == null) return;
    const raw = window.prompt("New file name (relative to skill root):", "");
    if (raw == null) return;
    const relPath = raw.trim();
    if (relPath.length === 0) return;
    try {
      await createSkillFile(selectedHostId, selectedSkillName, relPath);
      // Refetch file list; auto-select the new tab on success.
      const entries = await enumerateSkillFiles(selectedHostId, selectedSkillName);
      setFiles({ status: "ready", data: entries });
      setActiveTab(relPath);
    } catch (err) {
      if (err instanceof SkillFileAlreadyExistsError) {
        setFiles({
          status: "error",
          error: "A file with that name already exists in this skill.",
        });
        return;
      }
      setFiles({
        status: "error",
        error: err instanceof Error ? err.message : "Failed to create file",
      });
    }
  }, [selectedHostId, selectedSkillName]);

  // Delete-file confirm handler.
  const handleDeleteFile = useCallback(async (): Promise<void> => {
    if (selectedHostId == null || selectedSkillName == null || deleteFileConfirm == null) return;
    const doomedPath = deleteFileConfirm.path;
    setDeleteInFlight(true);
    setDeleteError(null);
    try {
      await deleteSkillFile(selectedHostId, selectedSkillName, doomedPath);
      // Refetch file list.
      const entries = await enumerateSkillFiles(selectedHostId, selectedSkillName);
      setFiles({ status: "ready", data: entries });
      // Tab selection: if the deleted was active, pick next-right, else previous, else none.
      // Use the PREVIOUS file list to find the position, then map into the NEW list.
      if (activeTab === doomedPath) {
        // Simplest correct heuristic: pick the first file in the refetched list, or null.
        // (Preserving strict "next-right, then previous" order would require caching the
        // pre-delete list; the plan says "next-right or previous or none" but the fetched
        // list is post-delete, so grab the first remaining file — Ashley's fast-path bias
        // says any-remaining-tab is fine, and the first-tab default matches skill-load.)
        setActiveTab(entries.length > 0 ? entries[0].path : null);
      }
      // Drop the tab data for the deleted file (frees the closure).
      setTabData((prev) => {
        const next = new Map(prev);
        next.delete(doomedPath);
        return next;
      });
      setDeleteFileConfirm(null);
    } catch (err) {
      // Dialog stays open per UI-SPEC L195; error surfaces below the body.
      setDeleteError(
        err instanceof Error ? `Couldn't delete: ${err.message}` : "Couldn't delete",
      );
    } finally {
      setDeleteInFlight(false);
    }
  }, [selectedHostId, selectedSkillName, deleteFileConfirm, activeTab]);

  // Delete-skill confirm handler.
  const handleDeleteSkill = useCallback(async (): Promise<void> => {
    if (selectedHostId == null || selectedSkillName == null) return;
    setDeleteInFlight(true);
    setDeleteError(null);
    try {
      await deleteSkill(selectedHostId, selectedSkillName);
      // Refetch skills list, clear skill selection + tab list.
      const entries = await listSkills(selectedHostId);
      setSkills({ status: "ready", data: entries });
      setSelectedSkillName(null);
      setFiles({ status: "loading" });
      setActiveTab(null);
      setTabData(new Map());
      setDeleteSkillConfirm(false);
    } catch (err) {
      setDeleteError(
        err instanceof Error ? `Couldn't delete: ${err.message}` : "Couldn't delete",
      );
    } finally {
      setDeleteInFlight(false);
    }
  }, [selectedHostId, selectedSkillName]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal container={container ?? undefined}>
        {/* Overlay — same z-index ladder as GlobalFilesModal (patch #111) */}
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
          {/* Header — mirrors GlobalFilesModal L221-271 chrome pattern with Phase 44 additions */}
          <DialogHeader
            className="px-6 py-4 shrink-0 flex flex-row items-center gap-2 flex-wrap"
            style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <DialogTitle className="text-[15px] font-semibold text-[#f0ebe0]">
              Edit skills
            </DialogTitle>

            {/* Host picker — verbatim shape from GlobalFilesModal L228-242 */}
            <select
              aria-label="Host"
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

            {/* Skill picker — NEW for Phase 44. Three branches:
                (a) no host   → disabled, single option "Pick a host first…"
                (b) loading   → disabled, single option "Loading skills…"
                (c) ready     → placeholder + skill options
                (d) error     → disabled, error option (surfaces via body branch too) */}
            {selectedHostId == null ? (
              <select
                aria-label="Skill"
                disabled
                className="px-3 py-1.5 rounded-md bg-black/20 border border-white/10 text-[#a89a80] text-sm outline-none cursor-not-allowed"
              >
                <option>Pick a host first…</option>
              </select>
            ) : skills.status === "loading" ? (
              <select
                aria-label="Skill"
                disabled
                className="px-3 py-1.5 rounded-md bg-black/20 border border-white/10 text-[#a89a80] text-sm outline-none cursor-not-allowed"
              >
                <option>Loading skills…</option>
              </select>
            ) : skills.status === "error" ? (
              <select
                aria-label="Skill"
                disabled
                className="px-3 py-1.5 rounded-md bg-black/20 border border-white/10 text-[#a89a80] text-sm outline-none cursor-not-allowed"
              >
                <option>Couldn&apos;t load skills</option>
              </select>
            ) : (
              <select
                aria-label="Skill"
                value={selectedSkillName ?? ""}
                onChange={(e) =>
                  setSelectedSkillName(e.target.value ? e.target.value : null)
                }
                className="px-3 py-1.5 rounded-md bg-black/20 border border-white/10 text-[#e8e4d8] text-sm outline-none cursor-pointer"
              >
                <option value="">Pick a skill…</option>
                {skills.data.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            )}

            {/* + Add file — NEW for Phase 44. Header-row primary accent per
                UI-SPEC L173-178. Disabled when no skill picked OR file list
                isn't ready (so we don't allow-double-fetch during load/error). */}
            <button
              type="button"
              onClick={() => { void handleAddFile(); }}
              disabled={!selectedSkillName || files.status !== "ready"}
              className="ml-2 px-3 py-1.5 rounded-md bg-[hsla(220,80%,60%,0.20)] hover:bg-[hsla(220,80%,60%,0.30)] text-[#e8e4d8] text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              + Add file
            </button>

            {/* Delete-skill Trash2 — NEW for Phase 44. Only rendered when a
                skill is picked (UI-SPEC L202). */}
            {selectedSkillName && (
              <button
                type="button"
                title="Delete this skill"
                onClick={() => {
                  setDeleteError(null);
                  setDeleteSkillConfirm(true);
                }}
                className="size-6 rounded-md hover:bg-white/[0.06] flex items-center justify-center text-[#a89a80] hover:text-[#f87171] cursor-pointer"
              >
                <Trash2 size={16} />
              </button>
            )}

            <div className="flex-1" />

            {/* Glass X close button — verbatim from GlobalFilesModal L247-270 */}
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

          {/* Body — layered branches per UI-SPEC Copywriting Contract */}
          {selectedHostId == null ? (
            <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
              Pick a host to load its skills.
            </div>
          ) : skills.status === "loading" ? (
            <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
              Loading skills…
            </div>
          ) : skills.status === "error" ? (
            <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-6 text-center">
              Couldn&apos;t load skills: {skills.error}
            </div>
          ) : skills.data.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-[#a89a80] gap-2 text-sm text-center px-6">
              <div>No skills on this host.</div>
              <div className="text-xs opacity-70">
                Skills live in{" "}
                <code className="px-1 rounded bg-black/30">~/.claude/skills/</code>{" "}
                on the host. Nothing to edit here yet.
              </div>
            </div>
          ) : selectedSkillName == null ? (
            <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
              Pick a skill.
            </div>
          ) : files.status === "loading" ? (
            <div className="flex-1 flex items-center justify-center text-[#a89a80] text-sm">
              Loading files…
            </div>
          ) : files.status === "error" ? (
            <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-6 text-center">
              Couldn&apos;t load files: {files.error}
            </div>
          ) : files.data.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-[#a89a80] gap-2 text-sm text-center px-6">
              <div>This skill has no files.</div>
              <div className="text-xs opacity-70">
                Use &quot;+ Add file&quot; to create one.
              </div>
            </div>
          ) : (
            // Tabs — one TabsContent per file. Per-tab lazy load; horizontal-scroll tab strip.
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
                  <SkillFileTab
                    state={tabData.get(file.path) ?? { status: "loading" }}
                    onSave={(content, expectedMtime) =>
                      handleSave(file.path, content, expectedMtime)
                    }
                    onRequestDelete={() => {
                      setDeleteError(null);
                      setDeleteFileConfirm({ path: file.path });
                    }}
                  />
                </TabsContent>
              ))}

              {/* Bottom icon-bar section switcher — mirrors GlobalFilesModal L322-370
                  with the Phase 44 D-06 additions: overflow-x-auto + iOS scroll
                  momentum + intrinsic-width tabs (drop flex-1 + justify-around). */}
              <div
                className="shrink-0 flex items-stretch px-2 py-1 border-t overflow-x-auto"
                style={{
                  borderTopColor: "rgba(220, 225, 245, 0.10)",
                  background:
                    "linear-gradient(180deg, rgba(18,20,28,0.62), rgba(28,30,40,0.55))",
                  backdropFilter: "blur(12px)",
                  WebkitBackdropFilter: "blur(12px)",
                  WebkitOverflowScrolling: "touch",
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
                        // Intrinsic width — no flex-1 — so many tabs trigger
                        // horizontal scroll instead of squishing (D-06 fallback).
                        "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-[10px] cursor-pointer transition-colors shrink-0",
                        selected
                          ? "text-[#f0ebe0] font-semibold"
                          : "text-[#a89a80] hover:text-[#e8e4d8]",
                      )}
                      // Hue-tinted glassy pill matches GlobalFilesModal (hardcoded
                      // hue 220 — no per-identity context in this menu-triggered modal).
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
                      {/* D-05: tab label is the FULL path relative to skill root
                          (e.g. `tests/basic.py`), NOT split("/").pop(). */}
                      <span className="text-center whitespace-nowrap">
                        {file.path}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Tabs>
          )}
        </DialogPrimitive.Content>

        {/* Delete-file confirmation (modal-in-modal) */}
        <DeleteConfirmDialog
          open={deleteFileConfirm !== null}
          onOpenChange={(o) => {
            if (!o) {
              setDeleteFileConfirm(null);
              setDeleteError(null);
            }
          }}
          heading="Delete file?"
          body={
            <>
              <div>
                <code className="px-1 rounded bg-black/30 font-mono">
                  {selectedSkillName}/{deleteFileConfirm?.path ?? ""}
                </code>
              </div>
              <div className="mt-2">This can&apos;t be undone.</div>
            </>
          }
          primaryLabel="Delete"
          onConfirm={() => { void handleDeleteFile(); }}
          inFlight={deleteInFlight}
          error={deleteError}
          container={container ?? undefined}
        />

        {/* Delete-skill confirmation (modal-in-modal) */}
        <DeleteConfirmDialog
          open={deleteSkillConfirm}
          onOpenChange={(o) => {
            if (!o) {
              setDeleteSkillConfirm(false);
              setDeleteError(null);
            }
          }}
          heading="Delete skill?"
          body={
            <>
              <div>
                <code className="px-1 rounded bg-black/30 font-mono">
                  {selectedSkillName}
                </code>
              </div>
              <div className="mt-2">
                This removes the skill folder and every file inside it. This can&apos;t be undone.
              </div>
            </>
          }
          primaryLabel="Delete skill"
          onConfirm={() => { void handleDeleteSkill(); }}
          inFlight={deleteInFlight}
          error={deleteError}
          container={container ?? undefined}
        />
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
