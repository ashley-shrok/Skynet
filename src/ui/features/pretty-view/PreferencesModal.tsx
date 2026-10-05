/**
 * PreferencesModal — user preferences modal with left-nav navigation.
 *
 * Modal-unification 2026-09-29:
 *   - Shell: canonical <Modal>. Size is dynamic on the active pane — "editor"
 *     (up to 1200×80vh) when About you is active so the markdown editor has
 *     room; "settings" (720×640 cap) for every other pane. All non-editor
 *     panes are compact and look wrong at editor dimensions.
 *   - Head: canonical <ModalHead title="Preferences" /> — replaces the
 *     bare glass-close-button-only header of the pre-unification impl.
 *   - Body: two-column flex (~180px left nav + right pane). ModalBody
 *     overrides its default padding to p-0 so the nav's own darker
 *     sub-surface + right pane can span edge-to-edge.
 *   - Foot: canonical <ModalFoot> with a single Close button.
 *   - Neutral blue-gray hue (220) preserved from pre-unification — settings
 *     aren't identity-scoped, so no dynamic hue.
 *
 * Log out button — pinned to the bottom of the left nav below a divider;
 * verified as the only UI logout path in the frontend (2026-09-29 grep).
 *
 * D-05 invariant preserved: useEffect resets activeSection to "general"
 * whenever open transitions true → false.
 *
 * Phone (agent-phone) — the nav entry only appears when the user already has
 * a number on file. The number is fetched each time the modal opens; a failed
 * fetch hides the entry. Removing the number hides it again and drops back
 * to General.
 */

import { useEffect, useState } from "react";
import { User, Volume2, Bell, Sparkles, Phone, LogOut } from "lucide-react";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";
import { cn } from "@/lib/utils";
import { PreferencesGeneralPane } from "./PreferencesGeneralPane";
import { PreferencesVoicePane } from "./PreferencesVoicePane";
import { PreferencesNotificationsPane } from "./PreferencesNotificationsPane";
import { PreferencesAboutYouPane } from "./PreferencesAboutYouPane";
import { PreferencesPhonePane } from "./PreferencesPhonePane";
import { getMyPhone } from "@/api/user-phone-api";
import { logoutUser } from "@/main-axios";
import type { UserPreferences } from "@/api/open-tabs-api";
import type { HostFolder } from "@/types/ui-types";

// ─── Navigation sections ─────────────────────────────────────────────────────

const NAV_SECTIONS = [
  { value: "general",       label: "General",       Icon: User      },
  { value: "about-you",     label: "About you",     Icon: Sparkles  },
  { value: "voice",         label: "Voice",         Icon: Volume2   },
  { value: "notifications", label: "Notifications", Icon: Bell      },
  { value: "phone",         label: "Phone",         Icon: Phone     },
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

  // null → no number on file → Phone section hidden.
  const [phoneE164, setPhoneE164] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getMyPhone()
      .then((phone) => {
        if (!cancelled) setPhoneE164(phone);
      })
      .catch(() => {
        if (!cancelled) setPhoneE164(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const visibleSections = NAV_SECTIONS.filter(
    ({ value }) => value !== "phone" || phoneE164 !== null,
  );

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size={activeSection === "about-you" ? "editor" : "settings"}
      className="flex flex-col"
      data-testid="preferences-modal"
    >
      <ModalHead title="Preferences" />

      {/* Two-column body: 180px left nav + right pane. Override the
          canonical ModalBody's default px-5 py-3.5 padding so the nav's
          darker sub-surface + right pane span edge-to-edge. */}
      <ModalBody className="p-0 flex flex-row overflow-hidden">
        {/* Left nav */}
        <nav
          data-testid="preferences-modal-nav"
          className="shrink-0 flex flex-col py-3 gap-1"
          style={{
            width: 180,
            background: "rgba(0, 0, 0, 0.28)",
            borderRight: "1px solid hsla(var(--pv-id-hue), 60%, 55%, 0.22)",
          }}
        >
          {visibleSections.map(({ value, label, Icon }) => {
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
                    ? "bg-[hsla(var(--pv-id-hue),65%,55%,0.24)] text-[#fbf5e8] font-medium"
                    : "text-[hsla(var(--pv-id-hue),22%,88%,0.7)] hover:text-[#d8d4c8] hover:bg-white/5",
                )}
              >
                <Icon size={16} className="shrink-0" />
                <span>{label}</span>
              </button>
            );
          })}

          {/* Log out — pinned to the bottom of the nav below a divider,
              reachable from every tab. Confirmed only UI logout path in
              the frontend (2026-09-29 grep). */}
          <div
            className="mt-auto pt-2 mx-2"
            style={{
              borderTop:
                "1px solid hsla(var(--pv-id-hue), 60%, 55%, 0.22)",
            }}
          >
            <button
              type="button"
              data-testid="preferences-nav-logout"
              aria-label="Log out"
              onClick={() => {
                if (!window.confirm("Log out?")) return;
                void logoutUser()
                  .catch(() => {})
                  .finally(() => {
                    window.dispatchEvent(new Event("skynet:logout"));
                  });
              }}
              className={cn(
                "flex items-center gap-2.5 px-4 py-2 mt-2 rounded-lg text-[13px] cursor-pointer transition-[background-color,color] duration-150 text-left w-full",
                "text-[hsla(var(--pv-id-hue),22%,88%,0.6)] hover:text-[#f0ebe0] hover:bg-white/5",
              )}
            >
              <LogOut size={16} className="shrink-0" />
              <span>Log out</span>
            </button>
          </div>
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
          {activeSection === "phone" && phoneE164 !== null && (
            <PreferencesPhonePane
              phoneE164={phoneE164}
              onPhoneChanged={(phone) => {
                setPhoneE164(phone);
                if (phone === null) setActiveSection("general");
              }}
            />
          )}
        </main>
      </ModalBody>

      <ModalFoot>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          data-testid="preferences-close-foot"
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
