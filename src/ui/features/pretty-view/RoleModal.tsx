/**
 * Phase 90 Plan 90-04 Task 3 — RoleModal (Plan 90-10 shim-removal refactor)
 *
 * D-03 (LOCKED — Ashley 2026-09-09): the role modal is a GLOBAL modal —
 *   portals to `document.body`, no chat-region target, no portal-target
 *   prop threading. Matches GlobalFilesModal + SkillsEditorModal chrome
 *   pattern. Swap-not-stack transitions from RolesListModal + identity-modal
 *   title-line jump both close their surface first, then open this modal.
 *
 * D-06 (LOCKED — Ashley 2026-09-09): the DialogContent wears the role's own
 *   hue (roleCosmetics.colorHue ?? 190 fallback per D-05), mirroring the
 *   IdentityModal L1614-1621 pattern keyed on the role's hue instead of an
 *   identity's.
 *
 * D-09 (LOCKED SEMANTICS): RoleModal is a NEW component, not a re-
 *   parameterized IdentityModal. IdentityModal keeps identity-scope tabs
 *   only (post-Phase-90-06); RoleModal owns role-scope tabs (role file /
 *   runbooks / bounties / wakeups).
 *
 * D-08.3 (LOCKED — CONTEXT.md rejects the identity indirection): every
 *   read/write path on this modal is addressed BY ROLE NAME. Callers pass
 *   `roleName` + `hostId`; that pair fully identifies every artifact the
 *   modal touches. (Plan 90-10 dropped the earlier Wave-2 identity prop
 *   after Plan 90-09 shipped the 6 role-name-keyed helpers in
 *   claude-session-api.ts.)
 *
 * Save path (Plan 90-10 additions):
 *   1. If cosmeticDraft carries an `avatarFile` (raw File bytes from a
 *      manual upload or a picked generated candidate), upload via
 *      updateRoleAvatarByName BEFORE writing the markdown. On success, use
 *      the server-returned filename as the frontmatter's `avatar:` value
 *      (overwriting the local draft value if they differ). On failure,
 *      ABORT the markdown write and surface the error to the user — the
 *      modal stays open so the draft is preserved.
 *   2. mergeCosmeticsIntoMarkdown now accepts a `clearedKeys` set. Keys in
 *      that set are DELETED from the frontmatter (regardless of draft value),
 *      matching the semantic "user cleared this field in-session". Prior to
 *      Plan 90-10, an empty draft was indistinguishable from "field never
 *      touched" — the merge preserved the stale value and the user could
 *      not clear a title/voice/avatar once set.
 *   3. updateRoleFileByName (Plan 90-03, unchanged — already role-name-keyed).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlarmClock,
  BookOpen,
  Target,
  Users,
  X,
} from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "@/components/dialog";
import { Tabs, TabsContent } from "@/components/tabs";
import { cn } from "@/lib/utils";
import { roleAvatarUrl, updateRoleAvatarByName } from "@/api/identities-api";
import {
  updateRoleFileByName,
  getRoleFileByName,
  listRoleWakeupsByName,
  createRoleWakeupByName,
  updateRoleWakeupByName,
  deleteRoleWakeupByName,
  type WakeupSpecWire,
  type Wakeup,
} from "@/api/claude-session-api";
import type { TabState } from "./IdentityFileTab";
import { RoleFileTab } from "./RoleFileTab";
import { RunbooksTab } from "./RunbooksTab";
import { WakeupsTab } from "./WakeupsTab";
import { RoleBountiesTab } from "./RoleBountiesTab";
import { RoleCosmeticEditBlock } from "./RoleCosmeticEditBlock";

// D-05 fallback hue (app accent) — used when the role has no colorHue key.
const FALLBACK_HUE = 190;

// Bottom-nav icon bar entries. Order + labels mirror IdentityModal
// NAV_SECTIONS_ROLE (L351-361) but restated here to keep the file
// standalone. Default landing tab = "role" (D-CONTEXT §UX rules).
const NAV_SECTIONS = [
  { value: "role", label: "Role file", Icon: Users },
  { value: "runbooks", label: "Runbooks", Icon: BookOpen },
  { value: "bounties", label: "Bounties", Icon: Target },
  { value: "role-wakeups", label: "Wakeups", Icon: AlarmClock },
] as const;

// Title-case a kebab-case role slug — display-name fallback per D-05
// "displayName ?? titleCased(slug)".
function titleCase(slug: string): string {
  if (!slug) return "";
  return slug
    .split("-")
    .map((word) => (word.length === 0 ? word : word[0].toUpperCase() + word.slice(1)))
    .join(" ");
}

/**
 * Merge the cosmetic drafts into the frontmatter block of the current
 * role file markdown. Full-overwrite semantics per Plan 90-03: we don't
 * try to preserve arbitrary YAML formatting, but we DO preserve any
 * existing keys we don't own (like `description`).
 *
 * Rules:
 *   - If the body starts with a `---\n...\n---\n` block, splice inside.
 *   - Otherwise, prepend a fresh frontmatter block.
 *   - For each cosmetic key present in the draft AND non-empty, upsert.
 *   - For each key in `clearedKeys`, DELETE from the frontmatter regardless
 *     of the draft value. This is how the user clears a title/voice/avatar
 *     that was set on disk (Plan 90-10 MEDIUM fix).
 *   - For keys the draft doesn't touch and are NOT in clearedKeys, leave
 *     any existing value untouched (never-touched fields survive).
 *
 * `clearedKeys` is exported alongside via the RoleCosmeticEditBlock's
 * `cleared: "title" | "voice" | "avatar"` signal — the parent (this file)
 * accumulates the set and passes it here at save time.
 *
 * Exported for tests in RoleModal.test.tsx.
 */
export function mergeCosmeticsIntoMarkdown(
  currentBody: string,
  cosmetics: {
    title?: string;
    colorHue?: number;
    voice?: string;
    avatar?: string;
  },
  clearedKeys?: ReadonlySet<string>,
): string {
  const cosmeticKeys = ["title", "colorHue", "voice", "avatar"] as const;
  const cleared = clearedKeys ?? new Set<string>();
  // Detect a leading `---\n...\n---\n` frontmatter block.
  const fmRe = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
  const match = currentBody.match(fmRe);
  let existingLines: string[] = [];
  let restBody = currentBody;
  if (match) {
    existingLines = match[1].split(/\r?\n/);
    restBody = currentBody.slice(match[0].length);
  }

  // Build a new-lines list by upserting each draft key.
  const newLines: string[] = [];
  const seenKeys = new Set<string>();
  for (const line of existingLines) {
    const keyMatch = line.match(/^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (keyMatch) {
      const key = keyMatch[1];
      seenKeys.add(key);
      // Plan 90-10: cleared keys are DELETED (skip the line entirely).
      if (cleared.has(key)) {
        continue;
      }
      // Overwrite value if the caller passed a non-empty draft.
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
  // Append any draft keys the existing block didn't have. Cleared keys skip
  // the append too — a cleared key that had no existing line to delete is a
  // no-op (user pressed "clear" on a field that was never set).
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
  if (typeof value === "number") return String(value);
  // Quote strings that contain colons or start with special chars to keep
  // YAML happy. Simple heuristic — the pickers restrict input to safe
  // ASCII so this is defense-in-depth.
  if (/[:#\-\[\]{}&*!|>'"%@`]/.test(value) || /\s/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

// Phase 90 Plan 90-10: openOneShot + sendMutation helpers deleted. The 6
// role-name-keyed API helpers from Plan 90-09 (getRoleFileByName,
// listRoleWakeupsByName, createRoleWakeupByName, updateRoleWakeupByName,
// deleteRoleWakeupByName, updateRoleFileByName) all return Promises with the
// same connection lifecycle baked in, so the modal-local WS plumbing was pure
// duplication of what claude-session-api.ts already owns.

export interface RoleModalProps {
  /** Controlled — true = modal open. */
  open: boolean;
  /** Fires with `false` when the close X or Esc is triggered. Swap-not-stack
   *  callers (RolesListModal, PrettyView identity-title jump) hook this to
   *  clean up their own state. */
  onOpenChange: (open: boolean) => void;
  /** Role slug (kebab-case). Addresses ALL of: header avatar, role-file
   *  fetch/write, runbooks + role-wakeups scoping, bounty read, avatar upload.
   *  Phase 90 Plan 90-10: this is the ONLY addressing prop for role-scope
   *  reads/writes — the earlier Wave-2 identity prop was removed after Plan
   *  90-09 shipped 6 role-name-keyed API helpers (D-08.3 lock). */
  roleName: string;
  /** Role cosmetics from Plan 90-01's RoleSummary. All keys optional. */
  roleCosmetics: {
    title?: string;
    displayName?: string;
    colorHue?: number;
    voice?: string;
    avatar?: string;
  };
  /** SSH host id — pane's active host. Threaded through every role-name-keyed
   *  helper as `hostId`. */
  hostId: number;
  /** Fired when a Runbooks tab row is clicked. Parent (PrettyView in Plan
   *  90-06) owns swap-not-stack coordination — closes this RoleModal and
   *  opens RunbookEditorModal for {roleName, runbookName}. */
  onOpenRunbook: (runbookName: string) => void;
}

export function RoleModal({
  open,
  onOpenChange,
  roleName,
  roleCosmetics,
  hostId,
  onOpenRunbook,
}: RoleModalProps): JSX.Element {
  const hue = roleCosmetics.colorHue ?? FALLBACK_HUE;
  const displayName = roleCosmetics.displayName ?? titleCase(roleName);

  const [activeTab, setActiveTab] = useState<string>("role");
  const [roleFileState, setRoleFileState] = useState<TabState<string>>({
    status: "loading",
  });
  const [roleWakeupsState, setRoleWakeupsState] = useState<TabState<Wakeup[]>>({
    status: "loading",
  });

  // Cosmetic-edit-block draft. Accumulates onDraftChange patches so we can
  // splice them into the frontmatter at save time. Reset on modal close.
  const [cosmeticDraft, setCosmeticDraft] = useState<{
    title?: string;
    colorHue?: number;
    voice?: string;
    avatar?: string;
  }>({});
  // Phase 90 Plan 90-10 HIGH fix: retain the picked avatar File so we can
  // POST it to the backend via updateRoleAvatarByName BEFORE writing the
  // role markdown. Prior to this plan the file was discarded and the
  // frontmatter pointed at a filename with no bytes behind it.
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  // Phase 90 Plan 90-10 MEDIUM fix: track which cosmetic keys the user has
  // cleared in-session. mergeCosmeticsIntoMarkdown DELETES these keys from
  // the frontmatter regardless of draft value — otherwise an empty draft is
  // indistinguishable from "field never touched" and the merge preserves
  // stale on-disk values. The RoleCosmeticEditBlock signals via
  // `cleared: "title" | "voice" | "avatar"` on onDraftChange emissions.
  const [clearedKeys, setClearedKeys] = useState<Set<string>>(new Set());
  // Save-side errors are reported by throwing from handleRoleFileSave — the
  // RoleFileTab's own onSave promise handler catches the throw and renders
  // its saveError UI. The modal stays open so the draft is preserved. No
  // separate error state needed here.

  // ── Fetch role file + role-wakeups on open ────────────────────────────────
  //
  // Plan 90-10 shim removal: both reads route through role-name-keyed helpers
  // from claude-session-api.ts (Plan 90-09). The prior openOneShot plumbing
  // was pure duplication.
  useEffect(() => {
    if (!open) return;

    setRoleFileState({ status: "loading" });
    setRoleWakeupsState({ status: "loading" });
    setCosmeticDraft({});
    setAvatarFile(null);
    setClearedKeys(new Set());
    // (Errors surface via the throw path — RoleFileTab renders its own UI.)
    setActiveTab("role");

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

    void (async () => {
      try {
        const { wakeups } = await listRoleWakeupsByName({ roleName, hostId });
        if (!cancelled) {
          setRoleWakeupsState({ status: "ready", data: wakeups });
        }
      } catch (e) {
        if (!cancelled) {
          setRoleWakeupsState({
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

  // ── Role-scope wakeup CRUD (byte-shape mirror of IdentityModal L922-974) ──
  //
  // Plan 90-10 shim removal: mutations route through role-name-keyed helpers
  // from claude-session-api.ts (Plan 90-09). The updateRoleWakeupByName /
  // createRoleWakeupByName / deleteRoleWakeupByName helpers all resolve with
  // `{wakeups}` (the FRESH post-write list) so we can update state in one shot.
  //
  // Compatibility with WakeupsTab's onUpdate signature: the tab still calls
  // `onUpdate(wakeupSlug, updates)` — we rebuild the FULL WakeupSpecWire by
  // reading the current wakeup and applying the patch. This matches how
  // IdentityModal's L922-974 layer worked; the byName variant just replaces
  // the wire type.
  const updateRoleWakeup = useCallback(
    async (
      wakeupSlug: string,
      updates: {
        enabled?: boolean;
        schedule?: unknown;
        name?: string;
        instruction?: string;
      },
    ): Promise<void> => {
      // Locate the current wakeup so we can construct a full spec. The tab
      // passes a slug; the byName WS payload wants a full spec.
      const current =
        roleWakeupsState.status === "ready"
          ? roleWakeupsState.data.find((w) => w.name === wakeupSlug)
          : undefined;
      if (!current) {
        throw new Error(`wakeup not found: ${wakeupSlug}`);
      }
      const spec: WakeupSpecWire = {
        name: updates.name ?? current.name,
        enabled: updates.enabled ?? current.enabled,
        // WakeupSpecWire.schedule is the same shape the wakeup carries.
        schedule: (updates.schedule ?? current.schedule) as WakeupSpecWire["schedule"],
        instruction: updates.instruction ?? current.instruction,
      };
      const res = await updateRoleWakeupByName({ roleName, hostId, spec });
      setRoleWakeupsState({ status: "ready", data: res.wakeups });
    },
    [roleName, hostId, roleWakeupsState],
  );

  const createRoleWakeup = useCallback(
    async (spec: WakeupSpecWire): Promise<void> => {
      const res = await createRoleWakeupByName({ roleName, hostId, spec });
      setRoleWakeupsState({ status: "ready", data: res.wakeups });
    },
    [roleName, hostId],
  );

  const deleteRoleWakeup = useCallback(
    async (wakeupSlug: string): Promise<void> => {
      const res = await deleteRoleWakeupByName({
        roleName,
        hostId,
        wakeupName: wakeupSlug,
      });
      setRoleWakeupsState({ status: "ready", data: res.wakeups });
    },
    [roleName, hostId],
  );

  // ── Role-file save handler ────────────────────────────────────────────────
  //
  // Plan 90-10 additions:
  //   1. If cosmeticDraft carries an avatarFile, POST it via
  //      updateRoleAvatarByName BEFORE writing the markdown. On success,
  //      use the server-returned filename in the frontmatter's avatar field.
  //      On failure, ABORT the markdown write and surface the error.
  //   2. Pass clearedKeys through to mergeCosmeticsIntoMarkdown so cleared
  //      fields are DELETED (not preserved).
  const handleRoleFileSave = useCallback(
    async (fileBody: string): Promise<void> => {
      // (Errors surface via the throw path — RoleFileTab renders its own UI.)

      // Local copy of the cosmetic draft — we may overwrite `avatar` from
      // the server response before merging.
      let effectiveDraft = { ...cosmeticDraft };

      // Step 1: upload avatar bytes if the user picked / uploaded a File.
      // On failure, throw — RoleFileTab's onSave promise handler catches and
      // renders its own saveError UI. Modal stays open; drafts are preserved.
      if (avatarFile) {
        const { filename } = await updateRoleAvatarByName(
          hostId,
          roleName,
          avatarFile,
        );
        // Server owns the on-disk filename — overwrite the draft to match.
        effectiveDraft = { ...effectiveDraft, avatar: filename };
      }

      // Step 2: merge cosmetics (with any avatar overwrite from step 1) into
      // the frontmatter and write the markdown. updateRoleFileByName rejects
      // with Error(env.error) on write failure — that reject propagates to
      // the RoleFileTab which catches and renders the save-failed UI.
      const mergedMarkdown = mergeCosmeticsIntoMarkdown(
        fileBody,
        effectiveDraft,
        clearedKeys,
      );
      const res = await updateRoleFileByName(
        roleName,
        hostId,
        mergedMarkdown,
      );
      // Server-echo becomes the new source of truth.
      setRoleFileState({ status: "ready", data: res.markdown });
      setCosmeticDraft({});
      setAvatarFile(null);
      setClearedKeys(new Set());
    },
    [roleName, hostId, cosmeticDraft, clearedKeys, avatarFile],
  );

  // ── Cosmetic-block onDraftChange handler ──────────────────────────────────
  //
  // Plan 90-10: also accumulates clearedKeys from the block's `cleared` signal.
  const onCosmeticDraftChange = useCallback(
    (patch: {
      title?: string;
      colorHue?: number;
      voice?: string;
      avatar?: string;
      avatarFile?: File;
      cleared?: "title" | "voice" | "avatar";
    }) => {
      const { avatarFile: nextFile, cleared, ...cosmeticPatch } = patch;
      if (nextFile !== undefined) setAvatarFile(nextFile);
      setCosmeticDraft((prev) => ({ ...prev, ...cosmeticPatch }));
      if (cleared) {
        setClearedKeys((prev) => {
          const next = new Set(prev);
          next.add(cleared);
          return next;
        });
      } else if (cosmeticPatch.title !== undefined) {
        // Typing a non-empty title after a clear removes the "cleared" mark.
        // Same logic applies to voice via the else-if below.
        if (cosmeticPatch.title.trim().length > 0) {
          setClearedKeys((prev) => {
            if (!prev.has("title")) return prev;
            const next = new Set(prev);
            next.delete("title");
            return next;
          });
        }
      } else if (cosmeticPatch.voice !== undefined) {
        if (cosmeticPatch.voice.length > 0) {
          setClearedKeys((prev) => {
            if (!prev.has("voice")) return prev;
            const next = new Set(prev);
            next.delete("voice");
            return next;
          });
        }
      }
    },
    [],
  );

  // ── Initial cosmetics for the edit block (merge server frontmatter into
  // the RoleSummary passed in as a prop). Server-echo overrides the prop
  // once the read fetch resolves — but the block's local state was seeded
  // from `initial` on mount, so we rely on the prop-driven initial.
  const cosmeticEditInitial = useMemo(
    () => ({
      title: roleCosmetics.title,
      colorHue: roleCosmetics.colorHue,
      voice: roleCosmetics.voice,
      avatar: roleCosmetics.avatar,
    }),
    [roleCosmetics.title, roleCosmetics.colorHue, roleCosmetics.voice, roleCosmetics.avatar],
  );

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      {/* D-03: Portal receives no portal-target prop — defaults to document.body. */}
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-[110] bg-black/40",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        <DialogPrimitive.Content
          data-slot="role-modal-content"
          onInteractOutside={(e) => {
            // Same pattern as GlobalFilesModal / IdentityModal: prevent
            // click-outside from closing. X + Esc remain valid dismissal.
            e.preventDefault();
          }}
          className={cn(
            "fixed inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
          style={{
            // D-06 hue chrome keyed on the role's hue.
            background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.82), hsla(${hue}, 40%, 15%, 0.88))`,
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: `1px solid hsla(${hue}, 65%, 55%, 0.32)`,
            boxShadow: `0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(${hue}, 65%, 55%, 0.2)`,
            color: "#e8e4d8",
          }}
        >
          <DialogTitle className="sr-only">Role: {displayName}</DialogTitle>

          {/* Header — role avatar + display name + close button. NO scope
              switch (D-01, D-09). NO identity chip. NO coord watermark. NO
              stays-awake switch. NO pencil-toggle — those are identity-
              scope surfaces from IdentityModal that don't belong here. */}
          <DialogHeader
            className="shrink-0"
            style={{
              position: "relative",
              overflow: "hidden",
              borderBottom: `1px solid hsla(${hue}, 50%, 50%, 0.2)`,
            }}
          >
            <div className="px-6 py-4 flex flex-row items-center gap-3 overflow-x-auto">
              <img
                src={roleAvatarUrl(hostId, roleName)}
                alt=""
                data-testid="role-modal-header-avatar"
                className="shrink-0 object-cover"
                style={{
                  position: "relative",
                  zIndex: 1,
                  width: 40,
                  height: 40,
                  borderRadius: "50%",
                  boxShadow: `0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,235,190,0.35), 0 0 24px hsla(${hue}, 65%, 55%, 0.4)`,
                }}
                draggable={false}
              />
              <div
                className="flex flex-col min-w-0 flex-1"
                style={{ position: "relative", zIndex: 1 }}
              >
                <span className="font-semibold text-base text-[#f0ebe0] truncate leading-tight">
                  {displayName}
                </span>
                {roleCosmetics.title && (
                  <span className="text-xs text-[#a89a80] truncate leading-tight">
                    {roleCosmetics.title}
                  </span>
                )}
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  aria-label="Close"
                  title="Close"
                  className="shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color,box-shadow] duration-200"
                  style={{
                    position: "relative",
                    zIndex: 1,
                    background: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(220, 225, 245, 0.10)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "rgba(255, 255, 255, 0.10)";
                    e.currentTarget.style.border = "1px solid rgba(220, 225, 245, 0.22)";
                    e.currentTarget.style.boxShadow = `0 0 20px hsla(${hue}, 60%, 50%, 0.25)`;
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
            </div>
          </DialogHeader>

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="flex-1 min-h-0 flex flex-col"
          >
            <TabsContent
              value="role"
              className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
            >
              <RoleCosmeticEditBlock
                roleName={roleName}
                hostId={hostId}
                initial={cosmeticEditInitial}
                onDraftChange={onCosmeticDraftChange}
                saving={false}
              />
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

            <TabsContent
              value="bounties"
              className="flex-1 min-h-0 flex flex-col"
            >
              <RoleBountiesTab
                roleName={roleName}
                hostId={hostId}
                hue={hue}
              />
            </TabsContent>

            <TabsContent
              value="role-wakeups"
              className="flex-1 min-h-0 overflow-y-auto px-6 py-4"
            >
              <WakeupsTab
                state={roleWakeupsState}
                hue={hue}
                scope="role"
                isCoordinator={false}
                onUpdate={updateRoleWakeup}
                onCreate={createRoleWakeup}
                onDelete={deleteRoleWakeup}
              />
            </TabsContent>

            {/* Bottom icon-bar nav — mirrors IdentityModal L2557-2597
                shape. 4 items keyed off NAV_SECTIONS above. */}
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
              {NAV_SECTIONS.map(({ value, label, Icon }) => {
                const selected = activeTab === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setActiveTab(value)}
                    className={cn(
                      "flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-[10px] cursor-pointer transition-colors flex-1",
                      selected
                        ? "text-[#f0ebe0] font-semibold"
                        : "text-[#a89a80] hover:text-[#e8e4d8]",
                    )}
                    style={
                      selected
                        ? {
                            background: `hsla(${hue}, 80%, 60%, 0.18)`,
                            boxShadow: `inset 0 0 0 1px hsla(${hue}, 80%, 70%, 0.28)`,
                          }
                        : undefined
                    }
                  >
                    <Icon size={18} />
                    {label}
                  </button>
                );
              })}
            </div>
          </Tabs>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
