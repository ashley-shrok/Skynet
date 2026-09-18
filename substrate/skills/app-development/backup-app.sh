#!/usr/bin/env bash
# backup-app.sh <slug> — snapshot an app's folder + systemd unit before a
# risky edit, so it can be restored by hand if the edit corrupts data or
# loses work.
#
# Snapshot lands at ~/fleet/apps-backups/<slug>-<UTC-timestamp>/. Includes:
#   - the full app folder contents (code + db.sqlite* + drizzle/ etc.)
#   - the systemd unit file, copied inside as app-<slug>.service.snapshot
#
# The running app stays running — SQLite in WAL mode is safe to cp under
# concurrent writes. If a torn snapshot ever bites, it's a one-off recovery
# concern, not a data-loss risk on the live app.
#
# Restoring from a backup is a MANUAL step — this snapshot is a safety net,
# not a formal lifecycle state. To restore, stop the unit and cp -r the
# snapshot back over the app folder.

set -euo pipefail

log() { printf '[backup-app] %s\n' "$*"; }
die() { printf '[backup-app] ERROR: %s\n' "$*" >&2; exit 1; }

if [ $# -ne 1 ]; then
    die "usage: backup-app.sh <slug>"
fi
SLUG="$1"

if ! [[ "$SLUG" =~ ^[a-z][a-z0-9-]*$ ]]; then
    die "invalid slug: '$SLUG'"
fi

APP_DIR="$HOME/fleet/apps/$SLUG"
UNIT_FILE="$HOME/.config/systemd/user/app-$SLUG.service"

[ -d "$APP_DIR" ]           || die "app not found at $APP_DIR"
[ -d "$HOME/fleet/apps-backups" ] || die "~/fleet/apps-backups does not exist — run bootstrap.sh first"

TS=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$HOME/fleet/apps-backups/$SLUG-$TS"

if [ -e "$DEST" ]; then
    die "backup target already exists at $DEST (timestamp collision — retry in a second)"
fi

cp -a "$APP_DIR" "$DEST"
log "copied app folder -> $DEST"

# The raw cp above captures a potentially-torn snapshot of db.sqlite because
# SQLite in WAL mode has three coordinated files (main, -wal, -shm). Overwrite
# with a consistent snapshot via VACUUM INTO — SQLite's own online-backup
# primitive, which produces a WAL-checkpointed, corruption-safe copy even
# against a live writer.
if [ -f "$APP_DIR/db.sqlite" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
    if ! command -v bun >/dev/null 2>&1; then
        die "bun not on PATH — needed for consistent SQLite snapshot; run bootstrap.sh first"
    fi

    rm -f "$DEST/db.sqlite" "$DEST/db.sqlite-wal" "$DEST/db.sqlite-shm"

    tmp_backup_script=$(mktemp --suffix=.js)
    trap "rm -f '$tmp_backup_script'" RETURN 2>/dev/null || true
    cat > "$tmp_backup_script" <<'JSEOF'
import { Database } from "bun:sqlite";
const [, , srcPath, dstPath] = process.argv;
const src = new Database(srcPath, { readonly: true });
// Escape any single quotes in the destination path for the SQL literal.
const dstQuoted = dstPath.replace(/'/g, "''");
src.exec(`VACUUM INTO '${dstQuoted}'`);
src.close();
JSEOF

    if bun "$tmp_backup_script" "$APP_DIR/db.sqlite" "$DEST/db.sqlite"; then
        log "snapshotted db.sqlite via VACUUM INTO (WAL-checkpointed, consistent)"
    else
        rm -f "$tmp_backup_script"
        die "VACUUM INTO snapshot failed — the folder was copied but db.sqlite in the snapshot may be missing or inconsistent"
    fi
    rm -f "$tmp_backup_script"
fi

if [ -f "$UNIT_FILE" ]; then
    cp -a "$UNIT_FILE" "$DEST/app-$SLUG.service.snapshot"
    log "copied unit file -> $DEST/app-$SLUG.service.snapshot"
else
    log "no unit file at $UNIT_FILE — snapshot contains folder only"
fi

BYTES=$(du -sh "$DEST" 2>/dev/null | cut -f1)
log "done — snapshot at $DEST ($BYTES)"
log "restore manually: systemctl --user stop app-$SLUG && cp -a $DEST/* $APP_DIR/ && systemctl --user restart app-$SLUG"
