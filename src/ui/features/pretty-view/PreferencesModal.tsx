/**
 * PreferencesModal — the user's own settings, a side list and one section at
 * a time (apple-ux shape-preferences-modal).
 *
 *   - The list opens with the account card (picture, name) — the account
 *     section holds the picture and Log out. Then About you, Voice,
 *     Notifications, Phone, Services; About pinned at the bottom.
 *   - Every section saves as it changes, so there is no Close button at the
 *     bottom; About you carries its own Edit / Cancel / Save foot.
 *   - About you can hold unsaved writing: it registers a leave guard, asked
 *     before switching section, going back (phone) or closing.
 *   - Phone (full screen): "Preferences" over a grouped list — the account
 *     card in its own group, the sections, About — then one section with a
 *     back bar.
 *
 * Phone — the entry only appears when the user already has a number on file
 * (fetched each time the window opens; a failed fetch hides it). Removing
 * the number hides it again and drops back to the account.
 *
 * Services — only when GET /users/me/service-secrets returns at least one
 * user-managed secret; admin-managed (company) keys are never listed here.
 *
 * Notifications — gated server-side (users.notifications_enabled or admin);
 * only when GET /push-subscriptions/telegram succeeds on open.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Volume2, Bell, Sparkles, Phone, KeyRound, Info } from "lucide-react";
import {
  Modal,
  ModalHead,
  ModalBody,
  ModalSidebar,
  useModalDrillIn,
  type ModalSidebarTabDef,
} from "@/components/modal";
import { KitSectionHero } from "@/components/kit";
import { PreferencesAccountPane, PreferencesAccountCard } from "./PreferencesAccountPane";
import { PreferencesVoicePane } from "./PreferencesVoicePane";
import { PreferencesNotificationsPane } from "./PreferencesNotificationsPane";
import { PreferencesAboutYouPane } from "./PreferencesAboutYouPane";
import { PreferencesPhonePane } from "./PreferencesPhonePane";
import { PreferencesServicesPane } from "./PreferencesServicesPane";
import { PreferencesAboutPane } from "./PreferencesAboutPane";
import { getMyPhone } from "@/api/user-phone-api";
import { getMyServiceSecrets, type ServiceSecret } from "@/api/service-secrets-api";
import { getTelegramStatus } from "@/features/notifications/telegram-setup-api";
import type { UserPreferences } from "@/api/open-tabs-api";
import type { HostFolder } from "@/types/ui-types";

// ─── Sections ────────────────────────────────────────────────────────────────

const NAV_SECTIONS = [
  { value: "about-you",     label: "About you",     Icon: Sparkles },
  { value: "voice",         label: "Voice",         Icon: Volume2  },
  { value: "notifications", label: "Notifications", Icon: Bell     },
  { value: "phone",         label: "Phone",         Icon: Phone    },
  { value: "services",      label: "Services",      Icon: KeyRound },
] as const;

type SectionValue = (typeof NAV_SECTIONS)[number]["value"] | "account" | "about";

const PINNED_ITEMS: ReadonlyArray<ModalSidebarTabDef<SectionValue>> = [
  { value: "about", label: "About", Icon: Info, pinned: true },
];

/** What each section is for — the line under its name. */
const HERO_COPY: Partial<Record<SectionValue, string>> = {
  voice: "How your agents sound when they read replies aloud, and how voice mode listens.",
  notifications: "Where notifications from agents reach you when you're away from the app.",
  phone: "Agents can call you at this number when they need you.",
  services:
    "Keys your agents use when they call these services for you. Once saved, a key can be replaced or removed but not viewed.",
};

/** Asked before leaving a section; resolves false to stay. */
export type LeaveGuard = () => Promise<boolean>;

// ─── Props ───────────────────────────────────────────────────────────────────

export interface PreferencesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  /** Shown on the account card; its first letter stands in for a missing
   *  picture (same letter as the sidebar footer's circle). */
  username?: string | null;
  isAdmin?: boolean;
  avatarPath: string | null;
  onAvatarChanged: (path: string | null) => void;
  userPrefs: UserPreferences;
  /** Called by the Voice section after a save so the caller's preferences
   *  (and the speak flow reading them) update without a reload. */
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
  isAdmin = false,
  avatarPath,
  onAvatarChanged,
  userPrefs,
  onUserPrefsChanged,
  hostTree,
  defaultHostId,
}: PreferencesModalProps): JSX.Element {
  const [activeSection, setActiveSection] = useState<SectionValue>("account");
  const rawDrill = useModalDrillIn<SectionValue>(activeSection, false, open);

  // About you registers this while it has unsaved writing.
  const leaveGuard = useRef<LeaveGuard | null>(null);
  const registerLeaveGuard = useCallback((guard: LeaveGuard | null) => {
    leaveGuard.current = guard;
  }, []);
  const mayLeave = useCallback(async () => (leaveGuard.current ? leaveGuard.current() : true), []);

  const pickItem = useCallback(
    async (next: SectionValue) => {
      if (next === activeSection) {
        rawDrill.drillIn();
        return;
      }
      if (!(await mayLeave())) return;
      setActiveSection(next);
    },
    [activeSection, mayLeave, rawDrill],
  );
  const drill = {
    ...rawDrill,
    back: () => {
      void mayLeave().then((ok) => ok && rawDrill.back());
    },
  };

  const handleOpenChange = useCallback(
    async (next: boolean) => {
      if (next) return onOpenChange(true);
      if (!(await mayLeave())) return;
      onOpenChange(false);
    },
    [mayLeave, onOpenChange],
  );

  // Every open starts on the account.
  useEffect(() => {
    if (!open) {
      setActiveSection("account");
      leaveGuard.current = null;
    }
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

  const fullscreen = rawDrill.fullscreen;
  const section = NAV_SECTIONS.find((s) => s.value === activeSection);
  const hero =
    section && HERO_COPY[activeSection] ? (
      <KitSectionHero
        icon={<section.Icon />}
        title={section.label}
        description={HERO_COPY[activeSection]}
        className="mb-5"
        data-testid="preferences-section-hero"
      />
    ) : null;

  const accountCard = (
    <PreferencesAccountCard
      userId={userId}
      username={username ?? null}
      avatarPath={avatarPath}
      selected={activeSection === "account"}
      drill={fullscreen}
      onSelect={() => void pickItem("account")}
    />
  );

  // About you lays out its own body and foot (the editor fills the height).
  const body =
    activeSection === "about-you" ? (
      <PreferencesAboutYouPane
        hostTree={hostTree ?? null}
        defaultHostId={defaultHostId ?? null}
        registerLeaveGuard={registerLeaveGuard}
      />
    ) : (
      <ModalBody data-testid="preferences-modal-pane" className="pt-1 pb-7">
        <div className="max-w-[560px] mx-auto">
          {hero}
          {activeSection === "account" && (
            <PreferencesAccountPane
              userId={userId}
              username={username ?? null}
              isAdmin={isAdmin}
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
                if (phone === null) setActiveSection("account");
              }}
            />
          )}
        </div>
      </ModalBody>
    );

  return (
    <Modal
      open={open}
      onOpenChange={(next) => void handleOpenChange(next)}
      size={activeSection === "about-you" ? "editor" : "settings"}
      data-testid="preferences-modal"
    >
      {fullscreen && (
        <ModalHead
          title={
            rawDrill.drilled ? <span className="sr-only">Preferences</span> : "Preferences"
          }
          closeTestId="preferences-close"
          className={rawDrill.drilled ? "pb-0" : undefined}
        />
      )}
      <ModalSidebar<SectionValue>
        tabs={[...visibleSections, ...PINNED_ITEMS]}
        value={activeSection}
        onValueChange={(v) => void pickItem(v)}
        testIdPrefix="preferences-nav"
        rowTestId="preferences-modal-nav"
        backLabel="Preferences"
        width={224}
        drill={drill}
        grouped
        header={
          fullscreen ? (
            <div className="pb-4">{accountCard}</div>
          ) : (
            <div className="pt-4">
              <div className="px-2.5 pb-3 text-[13px] font-semibold text-[var(--k-t3)]">
                Preferences
              </div>
              <div className="pb-2.5">{accountCard}</div>
            </div>
          )
        }
        className={
          fullscreen
            ? undefined
            : "[&>aside]:border-r [&>aside]:border-[var(--k-hair)] [&>aside]:bg-white/[0.012]"
        }
      >
        {!fullscreen && (
          <ModalHead
            title={<span className="sr-only">Preferences</span>}
            closeTestId="preferences-close"
            className="pb-0 min-h-[52px]"
          />
        )}
        {body}
      </ModalSidebar>
    </Modal>
  );
}
