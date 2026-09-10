// Phase 91 Plan 05 — NewConversationModal.tsx
//
// Modal shell composing hook + sub-components for the "New conversation" flow.
// Radix DialogPrimitive.Root with onInteractOutside prevention (X + Esc only
// close paths — patch #111f discipline from GlobalFilesModal.tsx).
//
// Mobile/desktop parity: `absolute inset-4` fills the viewport on mobile;
// on desktop the modal is capped at 560×720 and centered via
// `md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2`.
//
// Data sources (T-91-FE-02 tenant scoping):
//   - Humans: getUsersListBasic() (JWT-scoped, widened with mxid by Plan 00)
//   - Agents: useIdentities() (fleet-local)
//   - Self: useViewingUserMxid() (for self-exclusion + serverName extraction)
//
// Security:
//   - T-91-FE-01: submitting-gate debounce — setSubmitting(true) BEFORE the
//     createRelayRoom call; second click within same tick hits gate.ok===false.
//   - T-91-FE-02: grep gate — no other user-listing import present.
//   - T-91-05-T2: XSS prevention — displayName/roomName/error rendered as
//     React text children only. No raw HTML injection.
//   - Structured log discipline: console.info/warn with extracted plain-object fields,
//     not raw event or error serialization.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogHeader, DialogTitle, DialogClose } from "@/components/dialog";
import { Button } from "@/components/button";
import { cn } from "@/lib/utils";
import type { CreateRelayRoomResponse } from "./participant-types";
import type { PickedParticipant } from "./participant-types";
import { useNewConversationForm } from "./useNewConversationForm";
import { ParticipantChipStrip } from "./ParticipantChipStrip";
import { ParticipantSearchInput } from "./ParticipantSearchInput";
import { ParticipantList } from "./ParticipantList";
import { createRelayRoom } from "@/api/relay-room-create-api";
import { getUsersListBasic } from "@/api/user-management-api";
import { useIdentities } from "@/state/identities-store";
import { useViewingUserMxid } from "@/state/viewing-user-store";
import { MXID_REGEX } from "@/features/pretty-view/relay-mxid-resolve";
import { hueFromSessionName } from "@/features/terminal/session-hue";
import type { BasicUser } from "@/api/user-management-api";

// ─── Hint text per gate reason (shape §Shape) ────────────────────────────────

function gateHint(
  gate: ReturnType<typeof useNewConversationForm>["gate"],
): string | null {
  if (gate.ok) return null;
  switch (gate.reason) {
    case "no-room-name":
      return "Enter a name for this conversation";
    case "no-participants":
      return "Pick at least one participant";
    case "single-agent-only":
      return "A single-agent conversation already exists in your list";
    case "submitting":
      return "Creating…";
  }
}

// ─── NewConversationModal (public export) ─────────────────────────────────────

export function NewConversationModal({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (result: CreateRelayRoomResponse) => void;
}) {
  // ─── Data sourcing ──────────────────────────────────────────────────────────

  // T-91-FE-02: ONLY these three data sources are used for the picker.
  const viewingUserMxid = useViewingUserMxid();
  const { identities } = useIdentities();
  const [basicUsers, setBasicUsers] = useState<BasicUser[] | null>(null);

  // serverName derivation — extract group 2 from viewingUserMxid via MXID_REGEX.
  // When null (fetch pending or malformed mxid), agents cannot be mxid-shaped
  // and are omitted from the picker (Test 16 — agent filter when mxid null).
  const serverName = useMemo(() => {
    if (!viewingUserMxid) return null;
    const m = viewingUserMxid.match(MXID_REGEX);
    return m ? m[2] : null;
  }, [viewingUserMxid]);

  // Fetch humans when modal opens (not on every render — open gate).
  // M2: AbortController per open-cycle to cancel in-flight requests on close
  // or re-open. basicUsers is cleared on close so stale data never populates
  // a re-opened modal.
  useEffect(() => {
    if (!open) {
      // Clear stale users on close so re-open starts fresh (M2 fix).
      setBasicUsers(null);
      return;
    }
    // eslint-disable-next-line no-console
    console.info({ operation: "new_conversation_modal_opened" });
    const controller = new AbortController();
    getUsersListBasic()
      .then((users) => {
        if (!controller.signal.aborted) {
          setBasicUsers(users);
        }
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return; // ignore cancelled fetches
        setBasicUsers([]);
        // eslint-disable-next-line no-console
        console.warn({
          operation: "new_conversation_modal_users_fetch_failed",
          err: err instanceof Error ? err.message : "unknown",
        });
      });
    return () => {
      controller.abort();
    };
  }, [open]);

  // Humans: filter out null-mxid users (Test 14), derive colorHue via
  // hueFromSessionName(mxid) (Test 13). No persisted colorHue on BasicUser today.
  const humans = useMemo<PickedParticipant[]>(() => {
    if (!basicUsers) return [];
    return basicUsers
      .filter(
        (u): u is BasicUser & { mxid: string } =>
          typeof u.mxid === "string" && u.mxid.length > 0,
      )
      .map((u) => ({
        mxid: u.mxid,
        displayName: u.username,
        colorHue: hueFromSessionName(u.mxid), // djb2 mod 360 per Test 13
        avatarUrl: null, // humans have no persisted avatar today
        role: "human" as const,
        userId: u.id,
      }));
  }, [basicUsers]);

  // Agents: derive mxid from identityKey.toLowerCase() + serverName (Test 15).
  // Omit all agents when serverName is null (Test 16).
  const agents = useMemo<PickedParticipant[]>(() => {
    if (!serverName) return []; // serverName not yet resolved (Test 16)
    return identities.map((id) => ({
      // canonical agent mxid derivation — same convention as bridge-config-writer.ts:214.
      mxid: `@${id.identityKey.toLowerCase()}:${serverName}`,
      displayName: id.displayName,
      colorHue: id.colorHue,
      avatarUrl: id.avatarUrl ?? null,
      role: "agent" as const,
      identityKey: id.identityKey,
      subtitle: id.title ?? id.role ?? undefined,
    }));
  }, [identities, serverName]);

  // ─── Form hook ──────────────────────────────────────────────────────────────
  const form = useNewConversationForm({ humans, agents, viewingUserMxid });

  // M1: Reset form state when the modal closes so the next open sees a clean
  // slate (no stale roomName, picked participants, searchQuery, or error).
  // The effect fires when `open` transitions false → true as well, but
  // reset() on open is a harmless no-op (state is already empty on first open).
  useEffect(() => {
    if (!open) {
      form.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // T-91-FE-01 debounce guard — a ref-based in-flight lock so the second
  // rapid click is a no-op even before React flushes the setSubmitting(true)
  // state update. The ref fires synchronously; the gate check is a redundant
  // safety net for any caller that has already computed gate.ok=true.
  const submitInFlightRef = useRef(false);

  // ─── Submit handler (T-91-FE-01 debounce: gate.ok is false while submitting) ─
  const handleSubmit = useCallback(async () => {
    if (!form.gate.ok) return; // sync guard — catches React-batched state path
    if (submitInFlightRef.current) return; // ref guard — debounces double-click (Test 7)
    submitInFlightRef.current = true;
    form.setSubmitting(true);
    form.setError(null);
    // eslint-disable-next-line no-console
    console.info({
      operation: "new_conversation_modal_submit_start",
      roomName: form.roomName.trim(),
      humanCount: form.picked.filter((p) => p.role === "human").length,
      agentCount: form.picked.filter((p) => p.role === "agent").length,
    });
    try {
      const result = await createRelayRoom({
        roomName: form.roomName.trim(),
        humanMxids: form.picked
          .filter((p) => p.role === "human")
          .map((p) => p.mxid),
        agentMxids: form.picked
          .filter((p) => p.role === "agent")
          .map((p) => p.mxid),
      });
      // eslint-disable-next-line no-console
      console.info({
        operation: "new_conversation_modal_submit_ok",
        roomId: result.roomId,
        roomTitle: result.roomTitle,
      });
      onCreated(result);
      onOpenChange(false);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to create conversation";
      // eslint-disable-next-line no-console
      console.warn({
        operation: "new_conversation_modal_submit_error",
        err: err instanceof Error ? err.message : "unknown",
      });
      form.setError(msg);
    } finally {
      form.setSubmitting(false);
      submitInFlightRef.current = false;
    }
  }, [form, onCreated, onOpenChange]);

  const hint = gateHint(form.gate);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        {/* Overlay — mirrors GlobalFilesModal.tsx L195-201 z-index ladder */}
        <DialogPrimitive.Overlay
          className={cn(
            "absolute inset-0 z-[110] bg-black/15",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        {/*
         * Content — mobile: absolute inset-4 (fills viewport minus 16px margin).
         * Desktop: centered at 560×720 max via left/top-1/2 + -translate-x/y-1/2.
         * The prior anchored-both-vertical-edges pattern (see git log for the
         * Phase 91 initial ship) produced a super-narrow full-height modal on
         * 4K viewports — bounty new-conversation-modal-narrow-on-wide-viewport.
         * CSS-only breakpoint — no dual component tree. Shape §Mobile-vs-Desktop.
         */}
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            // Patch #111f pattern: prevent modal from closing when clicking
            // outside. X and Esc remain the only valid close paths (Test 11).
            e.preventDefault();
          }}
          className={cn(
            "absolute inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            // Desktop refinement — centers at 560×720 max (Tests 18 + 19).
            "md:max-w-[560px] md:max-h-[720px] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2",
            "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 duration-100",
            "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          )}
          style={{
            background:
              "linear-gradient(160deg, hsla(220, 45%, 25%, 0.82), hsla(220, 40%, 15%, 0.88))",
            backdropFilter: "blur(28px) saturate(1.4)",
            WebkitBackdropFilter: "blur(28px) saturate(1.4)",
            border: "1px solid hsla(220, 65%, 55%, 0.32)",
            boxShadow:
              "0 24px 64px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,220,170,0.15), 0 0 80px hsla(220, 65%, 55%, 0.2)",
            color: "#e8e4d8",
          }}
        >
          {/* a11y: sr-only title for screen readers */}
          <DialogTitle className="sr-only">New conversation</DialogTitle>

          {/* ─── Header ───────────────────────────────────────────────────── */}
          <DialogHeader
            className="px-6 py-4 shrink-0 flex flex-row items-center gap-3"
            style={{ borderBottom: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <h2 className="text-[15px] font-semibold text-[#f0ebe0] flex-1">
              New conversation
            </h2>

            {/* Glass X close button — verbatim from GlobalFilesModal.tsx L253-276 */}
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
                  e.currentTarget.style.border =
                    "1px solid rgba(220, 225, 245, 0.22)";
                  e.currentTarget.style.boxShadow =
                    "0 0 20px hsla(220, 60%, 50%, 0.25)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.04)";
                  e.currentTarget.style.border =
                    "1px solid rgba(220, 225, 245, 0.10)";
                  e.currentTarget.style.boxShadow = "none";
                }}
              >
                <X className="size-4" />
              </button>
            </DialogClose>
          </DialogHeader>

          {/* ─── Body ─────────────────────────────────────────────────────── */}
          <div className="flex flex-col flex-1 min-h-0 overflow-y-auto px-6 py-4 gap-3">
            {/* 1. Room name field — mandatory (Test 3 gate transition) */}
            <div className="flex flex-col gap-1">
              <label
                htmlFor="new-conversation-room-name"
                className="text-xs font-medium text-[color:var(--color-pv-fg-muted)]"
              >
                Room name
              </label>
              <input
                id="new-conversation-room-name"
                type="text"
                value={form.roomName}
                onChange={(e) => form.setRoomName(e.target.value)}
                placeholder="e.g. Design review"
                aria-required="true"
                autoFocus
                className={cn(
                  "w-full px-3 py-2 rounded-lg text-sm text-[#e8e4d8]",
                  "bg-black/20 border border-white/10 outline-none",
                  "focus:border-[hsla(220,65%,55%,0.5)] focus:bg-black/30",
                  "placeholder:text-[color:var(--color-pv-fg-dim)]",
                  "transition-colors duration-150",
                )}
              />
            </div>

            {/* 2. Chips strip — selected participants */}
            <ParticipantChipStrip
              picked={form.picked}
              onRemove={form.remove}
            />

            {/* 3. Search input */}
            <ParticipantSearchInput
              value={form.searchQuery}
              onChange={form.setSearchQuery}
            />

            {/* 4. Participant list — sectioned (Humans / Agents) */}
            <div className="flex-1 min-h-0 overflow-y-auto">
              <ParticipantList
                humans={form.availableHumans}
                agents={form.availableAgents}
                pickedMxids={new Set(form.picked.map((p) => p.mxid))}
                onToggle={form.toggle}
                filterActive={form.searchQuery.trim() !== ""}
                humansTotal={humans.length}
                agentsTotal={agents.length}
              />
            </div>
          </div>

          {/* ─── Footer (Create button + hint) ───────────────────────────── */}
          <div
            className="px-6 py-4 shrink-0 flex flex-col gap-2"
            style={{ borderTop: "1px solid rgba(220, 225, 245, 0.10)" }}
          >
            <Button
              type="button"
              disabled={!form.gate.ok}
              onClick={() => {
                void handleSubmit();
              }}
              className="w-full"
            >
              Create
            </Button>
            {hint && (
              <p className="text-xs text-center text-[color:var(--color-pv-fg-muted)]">
                {hint}
              </p>
            )}
            {form.error && (
              <p
                role="alert"
                className="text-xs text-center text-red-400"
              >
                {form.error}
              </p>
            )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
