// RoleModal — per-role editor + record view.
//
// Modal-unification 2026-09-29:
//   - Shell: canonical <Modal hue={roleCosmetics.colorHue ?? 190}
//     blocking={false}>. Global portal target (document.body via canonical
//     Modal's default) — D-03 (LOCKED user 2026-09-09) preserved via
//     canonical shell.
//   - Head: role avatar with a pencil overlay (bottom-right; opens file
//     picker for avatar upload) + display name (no pencil — roles are not
//     renamable via UI 2026-09-29) + role slug meta + color chip pinned
//     top-right + voice chip pinned top-right + close X.
//   - Two section-tabs at TOP: Role file / Runbooks. Cosmetics tab
//     retired entirely — cosmetic edits happen via the head chips + the
//     avatar pencil overlay. RoleCosmeticEditBlock retired.
//   - Foot: canonical <ModalFoot> with a single Close button.
//
// Save flow — per-field cosmetic saves via frontmatter merge:
//   - Voice chip → popover → VoicePicker onChange → merge {voice: X}
//     into current server-echoed markdown → updateRoleFileByName.
//   - Color chip → popover → ColorPicker onChange updates local
//     colorHueDraft (visual) → on picker close, merge {colorHue: X}
//     into current server-echoed markdown → updateRoleFileByName.
//     (Draft-then-commit avoids spamming the backend on every slider
//     tick during a drag.)
//   - Avatar pencil overlay → file picker → updateRoleAvatarByName
//     (upload bytes) → merge {avatar: <server filename>} into current
//     markdown → updateRoleFileByName.
//   - Role file tab Save → updateRoleFileByName directly (no merge —
//     cosmetics are their own save-path now).
//
// Chip interactions no-op when the initial file fetch hasn't completed
// (roleFileState.status !== "ready") — the merge needs server-echoed
// body to work from.

import { useCallback, useEffect, useRef, useState } from "react";
import type React from "react";
import {
  BookOpen,
  ChevronDown,
  Folder,
  Mic,
  Pencil,
  Users,
  X,
} from "lucide-react";
import { Modal, ModalFoot } from "@/components/modal";
import { Tabs, TabsContent } from "@/components/tabs";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { roleAvatarUrl, updateRoleAvatarByName } from "@/api/identities-api";
import {
  updateRoleFileByName,
  getRoleFileByName,
} from "@/api/claude-session-api";
import type { TabState } from "./IdentityFileTab";
import { RoleFileTab } from "./RoleFileTab";
import { RunbooksTab } from "./RunbooksTab";
import { VoicePicker } from "./pickers/VoicePicker";
import { ColorPicker } from "./pickers/ColorPicker";
import WorkspaceTab from "./WorkspaceTab";
import { roleDisplayName } from "@/lib/role-display-name";

// D-05 fallback hue (app accent) — used when the role has no colorHue key.
const FALLBACK_HUE = 190;

const NAV_SECTIONS = [
  { value: "role", label: "Role file", Icon: Users },
  { value: "runbooks", label: "Runbooks", Icon: BookOpen },
  { value: "files", label: "Files", Icon: Folder },
] as const;

/**
 * Names hidden from the Files tab's root listing. The role's own `<slug>.md`
 * has a dedicated editor on the Role File tab, so surfacing it in Files too
 * would be a redundant second edit path — hide it here. Frontend-only filter
 * (backend still returns it if hit directly); this is a UX affordance, not an
 * access control.
 */
function filesTabHiddenNames(roleName: string): readonly string[] {
  return [`${roleName}.md`];
}

/**
 * Merge cosmetic drafts into the frontmatter block of the current role
 * file markdown. Full-overwrite semantics: preserve any keys we don't own
 * (like `description`), upsert keys the caller passes, and delete keys in
 * `clearedKeys`.
 *
 * Exported for tests.
 */
export function mergeCosmeticsIntoMarkdown(
  currentBody: string,
  cosmetics: {
    displayName?: string;
    title?: string;
    colorHue?: number;
    voice?: string;
    avatar?: string;
  },
  clearedKeys?: ReadonlySet<string>,
): string {
  const cosmeticKeys = ["displayName", "title", "colorHue", "voice", "avatar"] as const;
  const cleared = clearedKeys ?? new Set<string>();
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = currentBody.match(fmRe);
  let existingLines: string[] = [];
  let restBody = currentBody;
  if (match) {
    existingLines = match[1].split(/\r?\n/);
    restBody = currentBody.slice(match[0].length);
  }

  const newLines: string[] = [];
  const seenKeys = new Set<string>();
  for (const line of existingLines) {
    const keyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1];
      seenKeys.add(key);
      if (cleared.has(key)) {
        continue;
      }
      if (cosmeticKeys.includes(key as typeof cosmeticKeys[number])) {
        const draftVal = cosmetics[key as keyof typeof cosmetics];
        if (draftVal !== undefined && draftVal !== "") {
          newLines.push(`${key}: ${yamlScalar(draftVal)}`);
          continue;
        }
      }
    }
    newLines.push(line);
  }
  for (const key of cosmeticKeys) {
    if (seenKeys.has(key)) continue;
    if (cleared.has(key)) continue;
    const val = cosmetics[key];
    if (val !== undefined && val !== "") {
      newLines.push(`${key}: ${yamlScalar(val)}`);
    }
  }

  const frontmatterBlock = `---\n${newLines.join("\n")}\n---\n`;
  return frontmatterBlock + restBody;
}

function yamlScalar(value: string | number): string {
  if (typeof value === "number") return `'${String(value)}'`;
  if (/[:#\-\[\]{}&*!|>'"%@`]/.test(value) || /\s/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

export interface RoleModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  roleName: string;
  roleCosmetics: {
    title?: string;
    displayName?: string;
    colorHue?: number;
    voice?: string;
    avatar?: string;
  };
  hostId: number;
  onOpenRunbook: (runbookName: string) => void;
  container?: HTMLElement | null;
}

export function RoleModal({
  open,
  onOpenChange,
  roleName,
  roleCosmetics,
  hostId,
  onOpenRunbook,
  container,
}: RoleModalProps): JSX.Element {
  const initialHue = roleCosmetics.colorHue ?? FALLBACK_HUE;
  const [colorHueDraft, setColorHueDraft] = useState<number>(initialHue);
  const hue = colorHueDraft;
  const displayName = roleDisplayName(roleName, roleCosmetics.displayName);

  const [activeTab, setActiveTab] = useState<string>("role");
  const [roleFileState, setRoleFileState] = useState<TabState<string>>({
    status: "loading",
  });

  // Chip state
  const [voicePickerOpen, setVoicePickerOpen] = useState(false);
  const [colorPickerOpen, setColorPickerOpen] = useState(false);
  const [voiceDraft, setVoiceDraft] = useState<string>(
    roleCosmetics.voice ?? "",
  );
  // Committed hue — what's currently persisted on disk (updated on save
  // success). `colorHueDraft` may lead this during a drag; on picker
  // close we save the draft and this state catches up.
  const [committedHue, setCommittedHue] = useState<number>(initialHue);
  const voicePickerRef = useRef<HTMLDivElement | null>(null);
  const colorPickerRef = useRef<HTMLDivElement | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement | null>(null);

  const roleFileStateRef = useRef(roleFileState);
  roleFileStateRef.current = roleFileState;

  // Reset on open.
  useEffect(() => {
    if (!open) return;
    setRoleFileState({ status: "loading" });
    setActiveTab("role");
    setVoicePickerOpen(false);
    setColorPickerOpen(false);
    setVoiceDraft(roleCosmetics.voice ?? "");
    setColorHueDraft(roleCosmetics.colorHue ?? FALLBACK_HUE);
    setCommittedHue(roleCosmetics.colorHue ?? FALLBACK_HUE);
  }, [open, roleName, roleCosmetics.voice, roleCosmetics.colorHue]);

  // Fetch role file on open.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const { markdown } = await getRoleFileByName({ roleName, hostId });
        if (!cancelled) {
          setRoleFileState({ status: "ready", data: markdown });
        }
      } catch (e) {
        if (!cancelled) {
          setRoleFileState({
            status: "error",
            error: e instanceof Error ? e.message : "Connection failed",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, roleName, hostId]);

  // Click-outside for voice popover.
  useEffect(() => {
    if (!voicePickerOpen) return;
    function onDown(e: MouseEvent) {
      if (!voicePickerRef.current) return;
      if (voicePickerRef.current.contains(e.target as Node)) return;
      setVoicePickerOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [voicePickerOpen]);

  // Click-outside for color popover — commits the drafted hue on close.
  useEffect(() => {
    if (!colorPickerOpen) return;
    function onDown(e: MouseEvent) {
      if (!colorPickerRef.current) return;
      if (colorPickerRef.current.contains(e.target as Node)) return;
      setColorPickerOpen(false);
      // Commit the drafted hue on close if it differs from committed.
      if (colorHueDraft !== committedHue) {
        void saveColorHue(colorHueDraft);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [colorPickerOpen, colorHueDraft, committedHue]);

  // ── Save handlers ────────────────────────────────────────────────────────

  const saveCosmeticField = useCallback(
    async (
      patch: {
        displayName?: string;
        title?: string;
        colorHue?: number;
        voice?: string;
        avatar?: string;
      },
      clearedField?: string,
    ): Promise<void> => {
      const current = roleFileStateRef.current;
      if (current.status !== "ready") {
        toast.error("Role file not loaded yet — try again in a moment.");
        return;
      }
      const merged = mergeCosmeticsIntoMarkdown(
        current.data,
        patch,
        clearedField ? new Set([clearedField]) : undefined,
      );
      const res = await updateRoleFileByName(roleName, hostId, merged);
      setRoleFileState({ status: "ready", data: res.markdown });
    },
    [roleName, hostId],
  );

  async function saveVoice(nextVoice: string): Promise<void> {
    const prev = voiceDraft;
    setVoiceDraft(nextVoice);
    try {
      await saveCosmeticField(
        { voice: nextVoice === "" ? undefined : nextVoice },
        nextVoice === "" ? "voice" : undefined,
      );
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Voice save failed: ${err.message}`
          : "Voice save failed",
      );
      setVoiceDraft(prev);
    }
  }

  async function saveColorHue(nextHue: number): Promise<void> {
    const prev = committedHue;
    setCommittedHue(nextHue);
    try {
      await saveCosmeticField({ colorHue: nextHue });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Color save failed: ${err.message}`
          : "Color save failed",
      );
      setColorHueDraft(prev);
      setCommittedHue(prev);
    }
  }

  async function onAvatarPick(
    e: React.ChangeEvent<HTMLInputElement>,
  ): Promise<void> {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (roleFileStateRef.current.status !== "ready") {
      toast.error("Role file not loaded yet — try again in a moment.");
      return;
    }
    try {
      const { filename } = await updateRoleAvatarByName(hostId, roleName, file);
      await saveCosmeticField({ avatar: filename });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? `Avatar upload failed: ${err.message}`
          : "Avatar upload failed",
      );
    }
  }

  // Role-file tab save — plain overwrite (cosmetics don't merge here
  // anymore; they own their own save path via chips + avatar pencil).
  const handleRoleFileSave = useCallback(
    async (fileBody: string): Promise<void> => {
      const res = await updateRoleFileByName(roleName, hostId, fileBody);
      setRoleFileState({ status: "ready", data: res.markdown });
    },
    [roleName, hostId],
  );

  const chipsDisabled = roleFileState.status !== "ready";

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      hue={hue}
      blocking={false}
      container={container ?? undefined}
      size="xl"
      className="max-h-[90vh] flex flex-col"
      data-testid="role-modal"
    >
      {/* Head — avatar (with pencil overlay) + display name + role slug +
          color chip + voice chip + close X. Custom head shape (not
          <ModalHead>) because it holds chip-triggered popovers + an
          avatar-with-overlay layout. */}
      <div
        className="px-5 py-4 flex flex-row items-start gap-3 flex-shrink-0"
        style={{
          borderBottom: `1px solid hsla(${hue}, 50%, 50%, 0.22)`,
        }}
      >
        {/* Avatar with pencil overlay */}
        <div className="relative shrink-0">
          <img
            src={roleAvatarUrl(hostId, roleName)}
            alt=""
            draggable={false}
            data-testid="role-modal-header-avatar"
            className="shrink-0 object-cover"
            style={{
              width: 44,
              height: 44,
              borderRadius: "50%",
              boxShadow: `0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,220,190,0.25), 0 0 20px hsla(${hue}, 65%, 55%, 0.35)`,
            }}
          />
          <button
            type="button"
            aria-label="Upload new role avatar"
            title="Upload new role avatar"
            onClick={() => avatarFileInputRef.current?.click()}
            data-testid="role-modal-avatar-pencil"
            className={cn(
              "absolute -bottom-0.5 -right-0.5 size-5 rounded-full",
              "flex items-center justify-center cursor-pointer",
              "border transition-colors",
            )}
            style={{
              background: "rgba(0,0,0,0.72)",
              borderColor: `hsla(${hue}, 65%, 55%, 0.55)`,
              color: "#fbf5e8",
            }}
          >
            <Pencil size={10} />
          </button>
          <input
            ref={avatarFileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              void onAvatarPick(e);
            }}
          />
        </div>
        <div className="flex flex-col flex-1 min-w-0 gap-1">
          <span className="font-semibold text-[16px] text-[#f0ebe0] truncate leading-tight">
            {displayName}
          </span>
          <div className="text-[11.5px] font-medium tracking-[0.06em] text-[hsla(var(--pv-id-hue),35%,90%,0.65)]">
            {roleName}
          </div>
        </div>
        {/* Chips + close X — pinned to top-right. */}
        <div className="flex items-start gap-1 shrink-0">
          {/* Color chip */}
          <div className="relative" ref={colorPickerRef}>
            <button
              type="button"
              aria-label="Role color — click to pick"
              title="Role color — click to pick"
              disabled={chipsDisabled}
              onClick={() => setColorPickerOpen((v) => !v)}
              data-testid="role-modal-color-chip"
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium cursor-pointer",
                "border transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                colorPickerOpen
                  ? "bg-[hsla(var(--pv-id-hue),55%,45%,0.7)] border-[hsla(var(--pv-id-hue),65%,60%,0.55)] text-[#fbf5e8]"
                  : "bg-[hsla(var(--pv-id-hue),55%,40%,0.55)] border-[hsla(var(--pv-id-hue),65%,55%,0.45)] text-[#fbf5e8] hover:bg-[hsla(var(--pv-id-hue),55%,45%,0.65)]",
              )}
            >
              <span
                className="inline-block shrink-0"
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: "50%",
                  background: `hsl(${colorHueDraft}, 65%, 55%)`,
                  border: `1px solid hsla(${colorHueDraft}, 75%, 70%, 0.65)`,
                  boxShadow: "inset 0 1px 0 rgba(255,220,190,0.25)",
                }}
              />
              <span>Color</span>
              <ChevronDown size={12} className="opacity-70" />
            </button>
            {colorPickerOpen && (
              <div
                role="dialog"
                aria-label="Color picker"
                data-testid="role-modal-color-popover"
                className={cn(
                  "absolute right-0 top-[calc(100%+6px)] z-20 min-w-[280px] p-3 rounded-lg flex flex-col gap-2",
                  "border border-[hsla(var(--pv-id-hue),60%,55%,0.32)]",
                )}
                style={{
                  background: `linear-gradient(160deg, hsla(${hue}, 40%, 22%, 0.98), hsla(${hue}, 40%, 15%, 0.98))`,
                  boxShadow: "0 10px 32px rgba(0, 0, 0, 0.55)",
                }}
              >
                <div className="text-[10.5px] font-medium tracking-[0.14em] uppercase text-[hsla(var(--pv-id-hue),30%,88%,0.72)]">
                  Color
                </div>
                <ColorPicker
                  value={colorHueDraft}
                  onChange={(next) => setColorHueDraft(next)}
                />
              </div>
            )}
          </div>
          {/* Voice chip */}
          <div className="relative" ref={voicePickerRef}>
            <button
              type="button"
              aria-label="Voice — click to pick"
              title={
                voiceDraft
                  ? `Voice: ${voiceDraft} — click to change`
                  : "Voice — click to pick"
              }
              disabled={chipsDisabled}
              onClick={() => setVoicePickerOpen((v) => !v)}
              data-testid="role-modal-voice-chip"
              className={cn(
                "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium cursor-pointer",
                "border transition-colors",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                voicePickerOpen
                  ? "bg-[hsla(var(--pv-id-hue),55%,45%,0.7)] border-[hsla(var(--pv-id-hue),65%,60%,0.55)] text-[#fbf5e8]"
                  : "bg-[hsla(var(--pv-id-hue),55%,40%,0.55)] border-[hsla(var(--pv-id-hue),65%,55%,0.45)] text-[#fbf5e8] hover:bg-[hsla(var(--pv-id-hue),55%,45%,0.65)]",
              )}
            >
              <Mic size={12} className="opacity-85" />
              {voiceDraft ? (
                <span>{voiceDraft}</span>
              ) : (
                <span className="italic opacity-75">default</span>
              )}
              <ChevronDown size={12} className="opacity-70" />
            </button>
            {voicePickerOpen && (
              <div
                role="dialog"
                aria-label="Voice picker"
                data-testid="role-modal-voice-popover"
                className={cn(
                  "absolute right-0 top-[calc(100%+6px)] z-20 min-w-[260px] p-3 rounded-lg flex flex-col gap-1.5",
                  "border border-[hsla(var(--pv-id-hue),60%,55%,0.32)]",
                )}
                style={{
                  background: `linear-gradient(160deg, hsla(${hue}, 40%, 22%, 0.98), hsla(${hue}, 40%, 15%, 0.98))`,
                  boxShadow: "0 10px 32px rgba(0, 0, 0, 0.55)",
                }}
              >
                <div className="text-[10.5px] font-medium tracking-[0.14em] uppercase text-[hsla(var(--pv-id-hue),30%,88%,0.72)]">
                  Voice
                </div>
                <VoicePicker
                  value={voiceDraft}
                  onChange={(v) => {
                    void saveVoice(v);
                  }}
                  ariaLabel="Voice"
                />
              </div>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={() => onOpenChange(false)}
            data-testid="role-modal-close"
            className={cn(
              "size-9 rounded-full flex items-center justify-center cursor-pointer",
              "text-[hsla(var(--pv-id-hue),22%,88%,0.65)] hover:text-[#f0ebe0]",
              "hover:bg-white/10 transition-colors",
            )}
          >
            <X size={16} />
          </button>
        </div>
      </div>

      {/* Section tabs — top. Two tabs. */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="flex-1 min-h-0 flex flex-col"
      >
        <div
          className={cn(
            "shrink-0 flex items-stretch gap-1 px-2 py-1.5",
            "border-b border-[hsla(var(--pv-id-hue),60%,55%,0.18)]",
            "bg-black/25",
          )}
          data-testid="role-modal-nav"
        >
          {NAV_SECTIONS.map(({ value, label, Icon }) => {
            const selected = activeTab === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => setActiveTab(value)}
                aria-pressed={selected}
                data-testid={`role-modal-nav-${value}`}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] cursor-pointer",
                  "transition-colors duration-150",
                  selected
                    ? "text-[#fbf5e8] bg-[hsla(var(--pv-id-hue),65%,55%,0.28)] border border-[hsla(var(--pv-id-hue),65%,60%,0.42)]"
                    : "text-[hsla(var(--pv-id-hue),22%,88%,0.65)] hover:text-[#e8e4d8] hover:bg-white/[0.04] border border-transparent",
                )}
              >
                <Icon size={13} /> {label}
              </button>
            );
          })}
        </div>

        <TabsContent
          value="role"
          className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
        >
          <RoleFileTab
            state={roleFileState}
            onSave={handleRoleFileSave}
          />
        </TabsContent>

        <TabsContent
          value="runbooks"
          className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
        >
          <RunbooksTab
            hostId={hostId}
            roleName={roleName}
            onOpenRunbook={onOpenRunbook}
          />
        </TabsContent>

        {/* Files tab — parallels IdentityModal's Files tab. WorkspaceTab
            owns its own padding + scroll, so we drop the parent's
            overflow-y-auto/px/py in favor of overflow-hidden flex flex-col.
            Role scope: target points at ~/fleet/roles/<slug>/, hiddenNames
            hides the role file itself (edited on the Role file tab). */}
        <TabsContent
          value="files"
          className="flex-1 min-h-0 overflow-hidden flex flex-col"
        >
          <WorkspaceTab
            target={{ kind: "role", roleSlug: roleName }}
            hostId={hostId}
            hue={hue}
            hiddenNames={filesTabHiddenNames(roleName)}
            introCopy="Files inside this role's folder — reference material, runbooks, per-role standing knowledge. Every identity holding this role sees the same set."
          />
        </TabsContent>
      </Tabs>

      <ModalFoot>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          data-testid="role-modal-close-foot"
          className={cn(
            "px-3 py-1.5 rounded-md text-[12.5px] cursor-pointer",
            "bg-black/20 border border-white/10",
            "hover:bg-black/30",
            "text-[#e8e4d8]",
          )}
        >
          Close
        </button>
      </ModalFoot>
    </Modal>
  );
}
