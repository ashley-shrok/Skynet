/**
 * Phase 90 Plan 90-04 Task 3 — RoleModal
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
 * Wave-2 identity-shim: bounties + role-scope wakeups + role-file read all
 * still route through identity-keyed WS wire types in this plan. RoleModal
 * accepts an `identityShimKey` prop from its caller (RolesListModal, or
 * PrettyView's identity-modal title-line jump). This is a wire-shim only —
 * the modal never displays identity data. Future phases can add role-name-
 * keyed WS variants.
 *
 * Save path: `handleRoleFileSave` merges the cosmetic drafts from
 * RoleCosmeticEditBlock into the frontmatter block of the RoleFileTab body
 * and pushes the merged markdown via Plan 90-03's `updateRoleFileByName`
 * (role-name-keyed WS wire type — no identity indirection).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { roleAvatarUrl } from "@/api/identities-api";
import {
  openClaudeSessionSocket,
  updateRoleFileByName,
  type IdentityGetRoleFilePayload,
  type IdentityRoleFileEvent,
  type IdentityListRoleWakeupsPayload,
  type IdentityRoleWakeupsEvent,
  type IdentityUpdateRoleWakeupPayload,
  type IdentityRoleWakeupUpdatedEvent,
  type IdentityCreateRoleWakeupPayload,
  type IdentityRoleWakeupCreatedEvent,
  type IdentityDeleteRoleWakeupPayload,
  type IdentityRoleWakeupDeletedEvent,
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
 *   - For each cosmetic key present in the draft, upsert. For keys the
 *     draft doesn't touch, leave any existing value untouched.
 */
function mergeCosmeticsIntoMarkdown(
  currentBody: string,
  cosmetics: {
    title?: string;
    colorHue?: number;
    voice?: string;
    avatar?: string;
  },
): string {
  const cosmeticKeys = ["title", "colorHue", "voice", "avatar"] as const;
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
      // Overwrite value if the caller passed a draft for this key.
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
  // Append any draft keys the existing block didn't have.
  for (const key of cosmeticKeys) {
    if (seenKeys.has(key)) continue;
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

// ── Single-shot WS helper (mirrors IdentityModal openOneShot at L434-467) ────
function openOneShot<Req extends { type: string }, Res extends { type: string }>(
  request: Req,
  expectedType: string,
  onSuccess: (data: Res) => void,
  onError: (err: string) => void,
  isCancelled: () => boolean,
): WebSocket {
  let responded = false;
  const sock = openClaudeSessionSocket();
  sock.onopen = () => {
    if (isCancelled()) return;
    try {
      sock.send(JSON.stringify(request));
    } catch {
      /* ignore */
    }
  };
  sock.onmessage = (event: MessageEvent<string>) => {
    if (isCancelled() || responded) return;
    try {
      const raw = JSON.parse(event.data) as { type?: string };
      if (raw.type !== expectedType) return;
      responded = true;
      onSuccess(raw as Res);
      try {
        sock.close();
      } catch {
        /* ignore */
      }
    } catch {
      /* ignore */
    }
  };
  const handleFail = () => {
    if (isCancelled() || responded) return;
    responded = true;
    onError("Connection failed");
  };
  sock.onerror = handleFail;
  sock.onclose = () => {
    if (!responded) handleFail();
  };
  return sock;
}

// Wakeup CRUD mutation helper (mirrors IdentityModal sendIdentityMutation
// L828-855). Returns a Promise that resolves on the matching response.
function sendMutation<Req, Res extends { error?: string; type: string }>(
  request: Req,
  expectedType: string,
): Promise<Res> {
  return new Promise<Res>((resolve, reject) => {
    const sock = openClaudeSessionSocket();
    let settled = false;
    const finish = (val: Res | Error) => {
      if (settled) return;
      settled = true;
      try {
        sock.close();
      } catch {
        /* ignore */
      }
      if (val instanceof Error) reject(val);
      else resolve(val);
    };
    sock.onopen = () => {
      try {
        sock.send(JSON.stringify(request));
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    };
    sock.onmessage = (event: MessageEvent<string>) => {
      try {
        const raw = JSON.parse(event.data) as { type?: string };
        if (raw.type !== expectedType) return;
        finish(raw as Res);
      } catch {
        /* ignore */
      }
    };
    sock.onerror = () => finish(new Error("Connection failed"));
    sock.onclose = () => finish(new Error("Connection closed before response"));
  });
}

export interface RoleModalProps {
  /** Controlled — true = modal open. */
  open: boolean;
  /** Fires with `false` when the close X or Esc is triggered. Swap-not-stack
   *  callers (RolesListModal, PrettyView identity-title jump) hook this to
   *  clean up their own state. */
  onOpenChange: (open: boolean) => void;
  /** Role slug (kebab-case). Addresses ALL of: header avatar, role-file
   *  fetch/write, runbooks + role-wakeups scoping. */
  roleName: string;
  /** Role cosmetics from Plan 90-01's RoleSummary. All keys optional. */
  roleCosmetics: {
    title?: string;
    displayName?: string;
    colorHue?: number;
    voice?: string;
    avatar?: string;
  };
  /** SSH host id — pane's active host. */
  hostId: number;
  /** Wave-2 identity-shim — an identity holding the target role on the
   *  selected host, used for identity-keyed READ paths (bounties, role-
   *  wakeups, role-file read). Never displayed. */
  identityShimKey: string;
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
  identityShimKey,
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
  // Held separately so the file object can (later) be shipped in a
  // multipart write. Not consumed by updateRoleFileByName in this plan —
  // avatar-file write is a follow-up phase (planner scope note).
  const [, setAvatarFile] = useState<File | null>(null);

  const openSocketsRef = useRef<WebSocket[]>([]);

  // ── Fetch role file + role-wakeups on open ────────────────────────────────
  useEffect(() => {
    if (!open || !identityShimKey) return;

    setRoleFileState({ status: "loading" });
    setRoleWakeupsState({ status: "loading" });
    setCosmeticDraft({});
    setAvatarFile(null);
    setActiveTab("role");

    let cancelled = false;
    const cancelledRef = () => cancelled;
    const sockets: WebSocket[] = [];

    sockets.push(
      openOneShot<IdentityGetRoleFilePayload, IdentityRoleFileEvent>(
        {
          type: "identity:get-role-file",
          identityKey: identityShimKey,
          hostId,
        },
        "identity:role-file",
        (ev) =>
          setRoleFileState(
            ev.error
              ? { status: "error", error: ev.error }
              : { status: "ready", data: ev.markdown },
          ),
        (e) => setRoleFileState({ status: "error", error: e }),
        cancelledRef,
      ),
    );

    sockets.push(
      openOneShot<IdentityListRoleWakeupsPayload, IdentityRoleWakeupsEvent>(
        {
          type: "identity:list-role-wakeups",
          identityKey: identityShimKey,
          hostId,
        },
        "identity:role-wakeups",
        (ev) =>
          setRoleWakeupsState(
            ev.error
              ? { status: "error", error: ev.error }
              : { status: "ready", data: ev.wakeups },
          ),
        (e) => setRoleWakeupsState({ status: "error", error: e }),
        cancelledRef,
      ),
    );

    openSocketsRef.current = sockets;

    return () => {
      cancelled = true;
      for (const s of sockets) {
        try {
          s.close();
        } catch {
          /* ignore */
        }
      }
      openSocketsRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identityShimKey, hostId]);

  // ── Role-scope wakeup CRUD (byte-shape mirror of IdentityModal L922-974) ──
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
      const payload: IdentityUpdateRoleWakeupPayload = {
        type: "identity:update-role-wakeup",
        identityKey: identityShimKey,
        hostId,
        wakeupSlug,
        updates,
      };
      const res = await sendMutation<
        IdentityUpdateRoleWakeupPayload,
        IdentityRoleWakeupUpdatedEvent
      >(payload, "identity:role-wakeup-updated");
      if (res.error) throw new Error(res.error);
      setRoleWakeupsState({ status: "ready", data: res.wakeups });
    },
    [identityShimKey, hostId],
  );

  const createRoleWakeup = useCallback(
    async (spec: WakeupSpecWire): Promise<void> => {
      const payload: IdentityCreateRoleWakeupPayload = {
        type: "identity:create-role-wakeup",
        identityKey: identityShimKey,
        hostId,
        spec,
      };
      const res = await sendMutation<
        IdentityCreateRoleWakeupPayload,
        IdentityRoleWakeupCreatedEvent
      >(payload, "identity:role-wakeup-created");
      if (res.error) throw new Error(res.error);
      setRoleWakeupsState({ status: "ready", data: res.wakeups });
    },
    [identityShimKey, hostId],
  );

  const deleteRoleWakeup = useCallback(
    async (wakeupSlug: string): Promise<void> => {
      const payload: IdentityDeleteRoleWakeupPayload = {
        type: "identity:delete-role-wakeup",
        identityKey: identityShimKey,
        hostId,
        wakeupSlug,
      };
      const res = await sendMutation<
        IdentityDeleteRoleWakeupPayload,
        IdentityRoleWakeupDeletedEvent
      >(payload, "identity:role-wakeup-deleted");
      if (res.error) throw new Error(res.error);
      setRoleWakeupsState({ status: "ready", data: res.wakeups });
    },
    [identityShimKey, hostId],
  );

  // ── Role-file save handler ────────────────────────────────────────────────
  // Splices the accumulated cosmeticDraft into the RoleFileTab body's
  // frontmatter block, then pushes via updateRoleFileByName (Plan 90-03).
  const handleRoleFileSave = useCallback(
    async (fileBody: string): Promise<void> => {
      const mergedMarkdown = mergeCosmeticsIntoMarkdown(fileBody, cosmeticDraft);
      const res = await updateRoleFileByName(roleName, hostId, mergedMarkdown);
      // Server-echo becomes the new source of truth.
      setRoleFileState({ status: "ready", data: res.markdown });
      setCosmeticDraft({});
      setAvatarFile(null);
    },
    [roleName, hostId, cosmeticDraft],
  );

  // ── Cosmetic-block onDraftChange handler ──────────────────────────────────
  const onCosmeticDraftChange = useCallback(
    (patch: {
      title?: string;
      colorHue?: number;
      voice?: string;
      avatar?: string;
      avatarFile?: File;
    }) => {
      const { avatarFile: nextFile, ...cosmeticPatch } = patch;
      if (nextFile !== undefined) setAvatarFile(nextFile);
      setCosmeticDraft((prev) => ({ ...prev, ...cosmeticPatch }));
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
                identityShimKey={identityShimKey}
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
