// ─── SettingsRow ─────────────────────────────────────────────────────────────
// Mobile settings-row component surfacing the destinations the MobileBottomBar
// used to route to. Created in Plan 06-02; positioned inside the mobile list
// layout by Plan 06-03.
//
// This plan (06-02) OWNS the component + its routing logic. Plan 06-03 owns
// where it MOUNTS on the mobile viewport (its consumer chooses position —
// bottom-of-list per the shape's "does not compete for prime attention"
// guidance is the current planner recommendation).
//
// Also consumed by ConversationsPanel's desktop gear icon on the same
// menu-item set — the DropdownMenu items are extracted here as
// `renderSettingsMenuItems` so both surfaces share one canonical list of
// destinations + route handlers.
//
// Zero touches to pretty-view / terminal / guacamole (Phase 6 scope-fence).
// No new npm dependencies; consumes the existing DropdownMenu + lucide-react.

import type { JSX } from "react";
import { useTranslation } from "react-i18next";
import {
  Clock,
  Hammer,
  KeyRound,
  LayoutPanelLeft,
  Play,
  Plug,
  Server,
  Settings,
  Shield,
  User,
  Zap,
} from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/dropdown-menu";
import type { RailView } from "@/sidebar/AppRail";

// Canonical menu-item shape shared by the desktop gear + the mobile row.
type SettingsMenuItem = {
  view: RailView;
  labelKey: string;
  defaultLabel: string;
  icon: JSX.Element;
  adminOnly?: boolean;
};

const SETTINGS_MENU_ITEMS: SettingsMenuItem[] = [
  {
    view: "hosts",
    labelKey: "nav.conversations.settingsMenuHostManager",
    defaultLabel: "Host Manager",
    icon: <Server size={14} />,
  },
  {
    view: "credentials",
    labelKey: "nav.conversations.settingsMenuCredentials",
    defaultLabel: "Credentials",
    icon: <KeyRound size={14} />,
  },
  {
    view: "connections",
    labelKey: "nav.conversations.settingsMenuConnections",
    defaultLabel: "Connections",
    icon: <Plug size={14} />,
  },
  {
    view: "quick-connect",
    labelKey: "nav.conversations.settingsMenuQuickConnect",
    defaultLabel: "Quick Connect",
    icon: <Zap size={14} />,
  },
  {
    view: "ssh-tools",
    labelKey: "nav.conversations.settingsMenuSshTools",
    defaultLabel: "SSH Tools",
    icon: <Hammer size={14} />,
  },
  {
    view: "snippets",
    labelKey: "nav.conversations.settingsMenuSnippets",
    defaultLabel: "Snippets",
    icon: <Play size={14} />,
  },
  {
    view: "history",
    labelKey: "nav.conversations.settingsMenuHistory",
    defaultLabel: "History",
    icon: <Clock size={14} />,
  },
  {
    view: "split-screen",
    labelKey: "nav.conversations.settingsMenuSplitScreen",
    defaultLabel: "Split Screen",
    icon: <LayoutPanelLeft size={14} />,
  },
  {
    view: "user-profile",
    labelKey: "nav.conversations.settingsMenuUserProfile",
    defaultLabel: "User Profile",
    icon: <User size={14} />,
  },
  {
    view: "admin-settings",
    labelKey: "nav.conversations.settingsMenuAdminSettings",
    defaultLabel: "Admin Settings",
    icon: <Shield size={14} />,
    adminOnly: true,
  },
];

// Shared menu-item renderer for both the desktop gear icon (inside
// ConversationsPanel) and the mobile settings row (inside AppShell's mobile
// list layout via Plan 06-03). One canonical set of destinations, one place
// to change them.
//
// Not a component (deliberate: it's a plain array-of-JSX helper the caller
// composes into its own DropdownMenuContent). The caller is responsible for
// providing `t` from its own `useTranslation()` — this keeps this file
// hook-free and lets it be used inside multiple DropdownMenu instances at
// arbitrary nesting depths without hook-order concerns.
export function renderSettingsMenuItems({
  onRailClick,
  isAdmin,
  t,
}: {
  onRailClick: (view: RailView) => void;
  isAdmin: boolean;
  t: (key: string, options?: { defaultValue?: string }) => string;
}): JSX.Element[] {
  const items = SETTINGS_MENU_ITEMS.filter(
    (item) => !item.adminOnly || isAdmin,
  );
  const out: JSX.Element[] = [];
  items.forEach((item, i) => {
    // Insert a separator before the last group (user-profile / admin-settings)
    // to visually separate operational destinations from personal ones.
    if (item.view === "user-profile" && i > 0) {
      out.push(<DropdownMenuSeparator key={`sep-${item.view}`} />);
    }
    out.push(
      <DropdownMenuItem
        key={item.view}
        onClick={() => onRailClick(item.view)}
      >
        {item.icon}
        {t(item.labelKey, { defaultValue: item.defaultLabel })}
      </DropdownMenuItem>,
    );
  });
  return out;
}

// Mobile-list settings row. Plan 06-03 positions this at the bottom of the
// mobile ConversationsPanel scroll region (or wherever fits the "not
// competing for prime attention" constraint — planner-discretion per the
// shape).
export function SettingsRow({
  onRailClick,
  isAdmin,
}: {
  onRailClick: (view: RailView) => void;
  isAdmin: boolean;
}): JSX.Element {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="group/settings-row flex items-stretch w-full cursor-pointer select-none transition-colors text-foreground hover:bg-muted/40 border-t border-border/40"
          aria-label={t("nav.conversations.settings", {
            defaultValue: "Settings & Admin",
          })}
        >
          <div className="flex items-center justify-center w-7 shrink-0">
            <Settings className="size-4 text-muted-foreground/80" />
          </div>
          <div className="flex flex-col flex-1 min-w-0 px-2 pt-2 pb-1.5 gap-0.5 items-start">
            <span className="text-[13px] font-medium truncate leading-none">
              {t("nav.conversations.settings", {
                defaultValue: "Settings & Admin",
              })}
            </span>
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-56">
        {renderSettingsMenuItems({ onRailClick, isAdmin, t })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
