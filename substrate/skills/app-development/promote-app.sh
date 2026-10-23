#!/usr/bin/env bash
# promote-app.sh <slug> — move a conversation app to the sidebar.
#
# Run by the owning agent when the user picks "Move to sidebar" on one of its
# conversation apps (the request arrives as an event in the conversation).
#
# Steps:
#   1. Find the app under ~/fleet/identities/<name>/apps/<slug>/ and make sure
#      ~/fleet/apps/<slug>/ is free.
#   2. Note its public port, stop and remove its units.
#   3. Move the folder — code, database, icon, .may-sleep marker and all — to
#      ~/fleet/apps/<slug>/.
#   4. Reinstall the units for the new location on the SAME port, so the app's
#      address (host + slug) is unchanged: chips and open panes keep working.
#   5. Knock on the public port to confirm it answers.
#
# If anything fails after the units are removed, the folder is moved back and
# the units reinstalled at the old location, so the app keeps working where
# it was.
#
# The app keeps its sleep setting. app.json already exists for conversation
# apps, so the tile appears on the user's sidebar on the next fleet sweep.

set -euo pipefail

log() { printf '[promote-app] %s\n' "$*"; }
die() { printf '[promote-app] ERROR: %s\n' "$*" >&2; exit 1; }

[ $# -eq 1 ] || die "usage: promote-app.sh <slug>"
SLUG="$1"
[[ "$SLUG" =~ ^[a-z][a-z0-9-]*$ ]] || die "invalid slug: '$SLUG'"

UNITS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/app-units.sh"
DEST="$HOME/fleet/apps/$SLUG"

SRC=$(bash "$UNITS" find "$SLUG") || die "no app named '$SLUG' on this box"
OWNER=$(bash "$UNITS" owner "$SLUG")
[ -n "$OWNER" ] || die "'$SLUG' is already a sidebar app ($SRC)"
[ -d "$HOME/fleet/apps" ] || die "~/fleet/apps does not exist — run bootstrap.sh first"
[ ! -e "$DEST" ] || die "$DEST already exists — refusing to overwrite"
[ -f "$SRC/app.json" ] || die "$SRC/app.json is missing — the sidebar needs it (title + description)"

PORT=$(bash "$UNITS" port "$SLUG") || die "could not read app-$SLUG's port from its units"
log "promoting $SLUG (owner $OWNER, port $PORT): $SRC -> $DEST"

ROLLBACK=0
rollback() {
    if [ "$ROLLBACK" = 1 ]; then
        log "rolling back — putting $SLUG back in $OWNER's conversation"
        bash "$UNITS" uninstall "$SLUG" 2>/dev/null || true
        if [ -d "$DEST" ] && [ ! -e "$SRC" ]; then mv "$DEST" "$SRC"; fi
        bash "$UNITS" install "$SLUG" "$SRC" "$PORT" || log "WARNING: reinstall at $SRC failed — check: journalctl --user -u app-$SLUG"
    fi
}
trap rollback EXIT

# Hold the create lock from removing the units until they're back (and through
# any rollback), so a concurrent create-app.sh can't claim the port while no
# unit or stash is reserving it. Released when this script exits.
exec 200>"$HOME/fleet/.create-lock"
flock -x -w 60 200 || die "could not get ~/fleet/.create-lock within 60s — another app is being created; try again"

bash "$UNITS" uninstall "$SLUG"
ROLLBACK=1

mv "$SRC" "$DEST"
log "moved folder"

bash "$UNITS" install "$SLUG" "$DEST" "$PORT"

# Any HTTP answer counts — an app whose root page is a 404 or a 500 is still
# running at its new location; only no answer at all means the move broke it.
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 30 "http://127.0.0.1:$PORT/" || true)
if [ -z "$CODE" ] || [ "$CODE" = "000" ]; then
    die "app-$SLUG did not answer on 127.0.0.1:$PORT after the move"
fi

ROLLBACK=0
log "done — $SLUG is now a sidebar app at $DEST (same port $PORT). It appears on the user's sidebar within a few seconds."
