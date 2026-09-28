/**
 * PreferencesModal — the user preferences modal shell with left-nav navigation.
 *
 * Phase 137 D-01..D-09: modal chrome + four-tab left-nav shell.
 *
 * Modal chrome pattern: byte-copy of the retired notifications modal with
 * two swaps:
 *   - Size: 760x600 px (D-03)
 *   - data-testid=preferences-modal
 *
 * Glass close button: verbatim from GlobalFilesModal L252-276.
 *
 * NAV_SECTIONS: adapted from IdentityModal L308-314, rendered VERTICALLY on the
 * left side (only genuinely new layout pattern in this phase — no existing
 * vertical-left-nav modal in Skynet).
 *
 * D-04 invariant: backdrop-click does NOT close the modal. X + Esc are
 * the only close paths (prevent-default on the outside-interact event).
 *
 * D-05 invariant: useEffect resets activeSection to "general" whenever open
 * transitions from true → false.
 */

import { useEffect, useState } from "react";
import { X, User, Volume2, Bell, Sparkles } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { DialogTitle, DialogClose } from "@/components/dialog";
import { cn } from "@/lib/utils";
import { PreferencesGeneralPane } from "./PreferencesGeneralPane";
import { PreferencesVoicePane } from "./PreferencesVoicePane";
import { PreferencesNotificationsPane } from "./PreferencesNotificationsPane";
import { PreferencesAboutYouPane } from "./PreferencesAboutYouPane";
import type { UserPreferences } from "@/api/open-tabs-api";
import type { HostFolder } from "@/types/ui-types";

// ─── Navigation sections ─────────────────────────────────────────────────────

const NAV_SECTIONS = [
  { value: "general",       label: "General",       Icon: User      },
  { value: "voice",         label: "Voice",         Icon: Volume2   },
  { value: "notifications", label: "Notifications", Icon: Bell      },
  { value: "about-you",     label: "About you",     Icon: Sparkles  },
] as const;

type SectionValue = (typeof NAV_SECTIONS)[number]["value"];

// ─── Props ───────────────────────────────────────────────────────────────────

export interface PreferencesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  /**
   * M6 fix: username threaded through to General pane so the initials-circle
   * fallback shows the same letter as the sidebar-footer initials-circle
   * (both derived from the trimmed username's first code point).
   */
  username?: string | null;
  avatarPath: string | null;
  onAvatarChanged: (path: string | null) => void;
  userPrefs: UserPreferences;
  /**
   * Phase 137 D-14/D-16 wire-through: called by Voice pane after a
   * successful save so the caller's UserPreferences atom updates and
   * downstream speak-flow consumers (PrettyView) re-render with the
   * new fallback voice without a page refresh.
   */
  onUserPrefsChanged?: (prefs: Partial<UserPreferences>) => void;
  hostTree?: HostFolder | null;
  defaultHostId?: number | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function PreferencesModal({
  open,
  onOpenChange,
  userId,
  username,
  avatarPath,
  onAvatarChanged,
  userPrefs,
  onUserPrefsChanged,
  hostTree,
  defaultHostId,
}: PreferencesModalProps): JSX.Element {
  const [activeSection, setActiveSection] = useState<SectionValue>("general");

  // D-05: reset the active tab to "general" whenever the modal closes so
  // reopening always starts on the General pane.
  useEffect(() => {
    if (!open) setActiveSection("general");
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={true}>
      <DialogPrimitive.Portal>
        {/* Overlay — same z-index ladder as IdentityModal (patch #111) */}
        <DialogPrimitive.Overlay
          className={cn(
            "absolute inset-0 z-[110] bg-black/40",
            "supports-backdrop-filter:backdrop-blur-xs duration-100",
            "data-open:animate-in data-open:fade-in-0",
            "data-closed:animate-out data-closed:fade-out-0",
          )}
        />
        {/* Content — D-04: backdrop-click does NOT close; X + Esc close */}
        <DialogPrimitive.Content
          onInteractOutside={(e) => {
            e.preventDefault();
          }}
          className={cn(
            "absolute inset-4 z-[120] outline-none",
            "flex flex-col overflow-hidden rounded-[24px]",
            "md:max-w-[760px] md:max-h-[600px] md:left-1/2 md:top-1/2 md:right-auto md:bottom-auto md:-translate-x-1/2 md:-translate-y-1/2",
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
          data-testid="preferences-modal"
        >
          {/* a11y: sr-only DialogTitle required by Radix DialogPrimitive */}
          <DialogTitle className="sr-only">Preferences</DialogTitle>

          {/* Glass close button — verbatim from GlobalFilesModal L252-276 */}
          <DialogClose asChild>
            <button
              type="button"
              aria-label="Close"
              title="Close"
              data-testid="preferences-close-button"
              className="absolute top-4 right-4 z-10 shrink-0 cursor-pointer size-9 rounded-full flex items-center justify-center text-[#a89a80] hover:text-[#f0ebe0] transition-[color,background-color,border-color,box-shadow] duration-200"
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

          {/* Body — two-column flex layout: left nav (~180px) + right pane */}
          <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Left nav */}
            <nav
              data-testid="preferences-modal-nav"
              className="shrink-0 flex flex-col py-4 gap-1"
              style={{
                width: 180,
                borderRight: "1px solid rgba(220, 225, 245, 0.08)",
              }}
            >
              {NAV_SECTIONS.map(({ value, label, Icon }) => {
                const isActive = activeSection === value;
                return (
                  <button
                    key={value}
                    type="button"
                    data-testid={`preferences-nav-${value}`}
                    aria-current={isActive ? "page" : undefined}
                    onClick={() => setActiveSection(value)}
                    className={cn(
                      "flex items-center gap-2.5 px-4 py-2 mx-2 rounded-lg text-[13px] cursor-pointer transition-[background-color,color] duration-150 text-left",
                      isActive
                        ? "bg-white/10 text-[#f0ebe0] font-medium"
                        : "text-[#a89a80] hover:text-[#d8d4c8] hover:bg-white/5",
                    )}
                  >
                    <Icon size={16} className="shrink-0" />
                    <span>{label}</span>
                  </button>
                );
              })}
            </nav>

            {/* Right pane — renders the active section */}
            <main
              data-testid="preferences-modal-pane"
              className="flex-1 min-w-0 overflow-auto"
            >
              {activeSection === "general" && (
                <PreferencesGeneralPane
                  userId={userId}
                  username={username ?? null}
                  avatarPath={avatarPath}
                  onAvatarChanged={onAvatarChanged}
                />
              )}
              {activeSection === "voice" && (
                <PreferencesVoicePane
                  userId={userId}
                  userPrefs={userPrefs}
                  onUserPrefsChanged={onUserPrefsChanged}
                />
              )}
              {activeSection === "notifications" && (
                <PreferencesNotificationsPane userId={userId} />
              )}
              {activeSection === "about-you" && (
                <PreferencesAboutYouPane
                  userId={userId}
                  hostTree={hostTree ?? null}
                  defaultHostId={defaultHostId ?? null}
                />
              )}
            </main>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
