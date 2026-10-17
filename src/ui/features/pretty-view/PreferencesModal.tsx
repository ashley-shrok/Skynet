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
 *   - Body: the shared <ModalSidebar> side list (drill-in on a phone) with
 *     the active pane in a <ModalBody>. About and Log out are pinned to the
 *     bottom of the list.
 *   - Foot: canonical <ModalFoot> with a single Close button.
 *   - Neutral blue-gray hue (220) preserved from pre-unification — settings
 *     aren't identity-scoped, so no dynamic hue.
 *
 * Log out — a plain action button under the side list; asks with a kit
 * confirm. Verified as the only UI logout path in the frontend (2026-09-29
 * grep).
 *
 * D-05 invariant preserved: useEffect resets activeSection to "general"
 * whenever open transitions true → false.
 *
 * Phone (agent-phone) — the nav entry only appears when the user already has
 * a number on file. The number is fetched each time the modal opens; a failed
 * fetch hides the entry. Removing the number hides it again and drops back
 * to General.
 *
 * Services — the user's own keys for agent services. The nav entry only
 * appears when GET /users/me/service-secrets returns at least one
 * user-managed secret; admin-managed (company) keys are never listed here.
 *
 * Notifications — gated server-side (users.notifications_enabled or admin).
 * The nav entry only appears when GET /push-subscriptions/telegram succeeds
 * on open; a 403 (or any failure) hides it.
 */

import { useEffect, useState } from "react";
import { User, Volume2, Bell, Sparkles, Phone, KeyRound, LogOut, Info } from "lucide-react";
import {
  Modal,
  ModalHead,
  ModalBody,
  ModalFoot,
  ModalSidebar,
  useModalDrillIn,
  type ModalSidebarTabDef,
} from "@/components/modal";
import { KitButton, kitConfirm } from "@/components/kit";
import { PreferencesGeneralPane } from "./PreferencesGeneralPane";
import { PreferencesVoicePane } from "./PreferencesVoicePane";
import { PreferencesNotificationsPane } from "./PreferencesNotificationsPane";
import { PreferencesAboutYouPane } from "./PreferencesAboutYouPane";
import { PreferencesPhonePane } from "./PreferencesPhonePane";
import { PreferencesServicesPane } from "./PreferencesServicesPane";
import { PreferencesAboutPane } from "./PreferencesAboutPane";
import { getMyPhone } from "@/api/user-phone-api";
import { getMyServiceSecrets, type ServiceSecret } from "@/api/service-secrets-api";
import { getTelegramStatus } from "@/features/notifications/telegram-setup-api";
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
  { value: "services",      label: "Services",      Icon: KeyRound  },
] as const;

type SectionValue = (typeof NAV_SECTIONS)[number]["value"] | "about";
type NavValue = SectionValue;

const PINNED_ITEMS: ReadonlyArray<ModalSidebarTabDef<NavValue>> = [
  { value: "about", label: "About", Icon: Info, pinned: true },
];

async function confirmLogout(): Promise<void> {
  const ok = await kitConfirm({
    title: "Log out?",
    body: "You'll need to sign in again to get back to your agents.",
    confirmLabel: "Log out",
  });
  if (!ok) return;
  void logoutUser()
    .catch(() => {})
    .finally(() => {
      window.dispatchEvent(new Event("skynet:logout"));
    });
}

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
  // Mobile (fullscreen modal): drill-in — nav list OR pane with a back bar.
  // Controlled here so it resets whenever the modal closes.
  const drill = useModalDrillIn<NavValue>(activeSection, false, open);
  const pickItem = (next: NavValue) => setActiveSection(next);

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

  // [] → no user-managed service secrets → Services section hidden.
  const [serviceSecrets, setServiceSecrets] = useState<ServiceSecret[]>([]);
  const [serviceSecretsVersion, setServiceSecretsVersion] = useState(0);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getMyServiceSecrets()
      .then((secrets) => {
        if (!cancelled) setServiceSecrets(secrets);
      })
      .catch(() => {
        if (!cancelled) setServiceSecrets([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, serviceSecretsVersion]);

  // false → no notifications access (403) → Notifications section hidden.
  const [notificationsAllowed, setNotificationsAllowed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getTelegramStatus()
      .then(() => {
        if (!cancelled) setNotificationsAllowed(true);
      })
      .catch(() => {
        if (!cancelled) setNotificationsAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const visibleSections = NAV_SECTIONS.filter(({ value }) => {
    if (value === "phone") return phoneE164 !== null;
    if (value === "services") return serviceSecrets.length > 0;
    if (value === "notifications") return notificationsAllowed;
    return true;
  });

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size={activeSection === "about-you" ? "editor" : "settings"}
      data-testid="preferences-modal"
    >
      <ModalHead title="Preferences" />

      <ModalSidebar<NavValue>
        tabs={[...visibleSections, ...PINNED_ITEMS]}
        value={activeSection}
        onValueChange={pickItem}
        testIdPrefix="preferences-nav"
        rowTestId="preferences-modal-nav"
        backLabel="Preferences"
        width={188}
        drill={drill}
        // Log out is an action, not a section: a plain button under the list
        // (no pressed state, no drill-in chevron).
        trailing={
          <button
            type="button"
            className="k-side-item"
            data-testid="preferences-nav-logout"
            onClick={() => void confirmLogout()}
          >
            <LogOut size={15} aria-hidden="true" />
            <span className="truncate">Log out</span>
          </button>
        }
      >
        {/* Right pane — renders the active section */}
        <ModalBody
          data-testid="preferences-modal-pane"
          className={activeSection === "about-you" ? "flex flex-col" : undefined}
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
          {activeSection === "notifications" && notificationsAllowed && (
            <PreferencesNotificationsPane userId={userId} />
          )}
          {activeSection === "about-you" && (
            <PreferencesAboutYouPane
              userId={userId}
              hostTree={hostTree ?? null}
              defaultHostId={defaultHostId ?? null}
            />
          )}
          {activeSection === "about" && <PreferencesAboutPane />}
          {activeSection === "services" && serviceSecrets.length > 0 && (
            <PreferencesServicesPane
              secrets={serviceSecrets}
              onChanged={() => setServiceSecretsVersion((v) => v + 1)}
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
        </ModalBody>
      </ModalSidebar>

      <ModalFoot>
        <KitButton
          onClick={() => onOpenChange(false)}
          data-testid="preferences-close-foot"
        >
          Close
        </KitButton>
      </ModalFoot>
    </Modal>
  );
}
