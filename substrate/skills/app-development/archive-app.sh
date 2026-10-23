#!/usr/bin/env bash
# archive-app.sh <slug> — retire an app by moving it to ~/fleet/apps-archive/.
#
# Steps:
#   1. Stash the app's systemd units INSIDE the app folder as
#      <unit>.archived (app-units.sh stash) so the un-archive path
#      (agent-supervisor's scan_app_unarchive_requested_sentinels) can
#      reinstall them later with the same port. This is what makes restore
#      stable across archive/restore cycles.
#   2. Stop, disable and remove the units (app-units.sh uninstall).
#   3. Move ~/fleet/apps/<slug>/ to ~/fleet/apps-archive/<slug>/.
#
# Sidebar apps only. Conversation apps are archived together with their
# conversation (the agent-supervisor's identity retire path).
#
# Refuses if there's already an archived copy at the same slug — that would
# either indicate a name collision or a botched previous archive. In either
# case, human judgment is better than silent overwrite.

set -euo pipefail

# systemctl --user needs the user bus; agent shells don't always export it.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

log() { printf '[archive-app] %s\n' "$*"; }
die() { printf '[archive-app] ERROR: %s\n' "$*" >&2; exit 1; }

if [ $# -ne 1 ]; then
    die "usage: archive-app.sh <slug>"
fi
SLUG="$1"

if ! [[ "$SLUG" =~ ^[a-z][a-z0-9-]*$ ]]; then
    die "invalid slug: '$SLUG'"
fi

APP_DIR="$HOME/fleet/apps/$SLUG"
ARCHIVE_DIR="$HOME/fleet/apps-archive/$SLUG"
UNITS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/app-units.sh"

# --- Pre-flight -------------------------------------------------------------

if [ ! -d "$APP_DIR" ] && OWNED_DIR=$(bash "$UNITS" find "$SLUG" 2>/dev/null); then
    die "'$SLUG' is a conversation app ($OWNED_DIR). Conversation apps are archived together with their conversation — there is no separate archive for them."
fi
[ -d "$APP_DIR" ]     || die "app not found at $APP_DIR"
[ ! -e "$ARCHIVE_DIR" ] || die "archive slot already occupied at $ARCHIVE_DIR — rename or remove that first"

# --- Stash the units inside the folder (before anything moves) -------------
# Copies every unit the app has (one for old-style apps, five for current
# ones) as <unit>.archived, so un-archiving reinstalls them on the same port.

bash "$UNITS" stash "$SLUG" "$APP_DIR"

# --- Stop + remove the units BEFORE the folder move ------------------------
# Stopping first means when we move the folder the process has already
# released any open handles under it (SQLite in particular).

bash "$UNITS" uninstall "$SLUG"

# --- Move to archive — the destructive commit step -------------------------
# If mv fails (cross-filesystem, permissions, disk-full, name-collision race),
# reinstall the units from the stash so the app is left running rather than
# dead under a torn-down archive.

if ! mv "$APP_DIR" "$ARCHIVE_DIR"; then
    log "ERROR: mv failed. Reinstalling app-$SLUG so the app keeps running..."
    bash "$UNITS" restore "$SLUG" "$APP_DIR" || true
    die "archive failed: could not move $APP_DIR to $ARCHIVE_DIR. App restored to running state."
fi
log "moved $APP_DIR -> $ARCHIVE_DIR"

log "done — $SLUG is archived. Recover by dropping .unarchive-requested inside ~/fleet/apps-archive/$SLUG/ if the user changes her mind."
