#!/usr/bin/env bash
# archive-app.sh <slug> — retire an app by moving it to ~/fleet/apps-archive/.
#
# Steps:
#   1. Stash the systemd unit file INSIDE the app folder as
#      app-<slug>.service.archived so restore-app.sh can reinstall it later
#      with the same port. This is what makes restore stable across
#      archive/restore cycles.
#   2. Stop + disable the systemd unit and remove the installed unit file
#      from ~/.config/systemd/user/. daemon-reload.
#   3. Move ~/fleet/apps/<slug>/ to ~/fleet/apps-archive/<slug>/.
#
# Refuses if there's already an archived copy at the same slug — that would
# either indicate a name collision or a botched previous archive. In either
# case, human judgment is better than silent overwrite.

set -euo pipefail

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
UNIT_FILE="$HOME/.config/systemd/user/app-$SLUG.service"

# --- Pre-flight -------------------------------------------------------------

[ -d "$APP_DIR" ]     || die "app not found at $APP_DIR"
[ ! -e "$ARCHIVE_DIR" ] || die "archive slot already occupied at $ARCHIVE_DIR — rename or remove that first"

# --- Stash the unit file inside the folder ---------------------------------

if [ -f "$UNIT_FILE" ]; then
    cp "$UNIT_FILE" "$APP_DIR/app-$SLUG.service.archived"
    log "stashed unit file inside $APP_DIR/ for future restore"
else
    log "no installed unit file at $UNIT_FILE — proceeding without stash"
fi

# --- Stop + disable ---------------------------------------------------------

if systemctl --user list-unit-files 2>/dev/null | grep -q "^app-$SLUG.service"; then
    systemctl --user disable --now "app-$SLUG.service" 2>/dev/null || true
    log "stopped and disabled app-$SLUG.service"
else
    log "no active systemd unit for app-$SLUG (nothing to stop)"
fi

if [ -f "$UNIT_FILE" ]; then
    rm -f "$UNIT_FILE"
    log "removed installed unit file $UNIT_FILE"
fi

systemctl --user daemon-reload

# --- Move to archive --------------------------------------------------------

mv "$APP_DIR" "$ARCHIVE_DIR"
log "moved $APP_DIR -> $ARCHIVE_DIR"

log "done — $SLUG is archived. Recover with restore-app.sh if the user changes her mind."
