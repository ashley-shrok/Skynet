#!/usr/bin/env bash
# restore-app.sh <slug> — un-archive an app.
#
# Steps:
#   1. Confirm ~/fleet/apps-archive/<slug>/ exists and the target
#      ~/fleet/apps/<slug>/ does NOT exist.
#   2. Read the stashed unit file (app-<slug>.service.archived) to figure
#      out which port the app originally used. If that port is now in use
#      by another running app on the box, refuse — restoring with a
#      silently-changed port would break bookmarks and confuse the user.
#   3. Move the folder back, reinstall the unit file, daemon-reload,
#      enable + start.

set -euo pipefail

log() { printf '[restore-app] %s\n' "$*"; }
die() { printf '[restore-app] ERROR: %s\n' "$*" >&2; exit 1; }

if [ $# -ne 1 ]; then
    die "usage: restore-app.sh <slug>"
fi
SLUG="$1"

if ! [[ "$SLUG" =~ ^[a-z][a-z0-9-]*$ ]]; then
    die "invalid slug: '$SLUG'"
fi

APP_DIR="$HOME/fleet/apps/$SLUG"
ARCHIVE_DIR="$HOME/fleet/apps-archive/$SLUG"
UNIT_FILE="$HOME/.config/systemd/user/app-$SLUG.service"
STASHED_UNIT="$ARCHIVE_DIR/app-$SLUG.service.archived"

# --- Pre-flight -------------------------------------------------------------

[ -d "$ARCHIVE_DIR" ] || die "no archived app at $ARCHIVE_DIR"
[ ! -e "$APP_DIR" ]   || die "app already exists at $APP_DIR — resolve the collision before restoring"
[ ! -e "$UNIT_FILE" ] || die "systemd unit already exists at $UNIT_FILE — remove it or resolve the collision"
[ -f "$STASHED_UNIT" ] || die "no stashed unit file at $STASHED_UNIT — cannot restore without the original port; you may need to re-create instead"

# --- Port collision check ---------------------------------------------------

ARCHIVED_PORT=$(grep -m1 '^Environment=PORT=' "$STASHED_UNIT" | sed 's/^Environment=PORT=//' || true)
if [ -z "$ARCHIVED_PORT" ]; then
    die "could not read PORT from stashed unit $STASHED_UNIT"
fi

log "archived port: $ARCHIVED_PORT"

USED_PORTS=""
if compgen -G "$HOME/.config/systemd/user/app-*.service" > /dev/null; then
    USED_PORTS=$(grep -h '^Environment=PORT=' "$HOME"/.config/systemd/user/app-*.service 2>/dev/null \
                 | sed 's/^Environment=PORT=//' \
                 | sort -u)
fi

if printf '%s\n' "$USED_PORTS" | grep -qx "$ARCHIVED_PORT"; then
    die "port $ARCHIVED_PORT is now in use by another app on this box — archive that one first, or create a fresh app instead of restoring"
fi

# --- Move + install ---------------------------------------------------------

mv "$ARCHIVE_DIR" "$APP_DIR"
log "moved $ARCHIVE_DIR -> $APP_DIR"

# Reinstall the stashed unit file, then remove the stash copy from the app folder.
cp "$APP_DIR/app-$SLUG.service.archived" "$UNIT_FILE"
rm -f "$APP_DIR/app-$SLUG.service.archived"
log "reinstalled unit file to $UNIT_FILE"

systemctl --user daemon-reload
systemctl --user enable --now "app-$SLUG.service"
log "systemd unit enabled and started"

sleep 2
if systemctl --user is-active --quiet "app-$SLUG.service"; then
    log "app-$SLUG is active (running) on port $ARCHIVED_PORT"
else
    log "WARNING: app-$SLUG did not reach active state — check: journalctl --user -u app-$SLUG -n 50 --no-pager"
fi
