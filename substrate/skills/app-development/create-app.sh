#!/usr/bin/env bash
# create-app.sh <slug> [title] — scaffold a new app under ~/fleet/apps/<slug>.
#
# Steps:
#   1. Validate the slug and pre-flight the target paths (must not exist).
#   2. Under an exclusive flock, pick the next free port in 9501-9599 and
#      atomically claim it by writing the rendered systemd unit file. The
#      unit file's presence in ~/.config/systemd/user/app-*.service is what
#      future create-app scans see, so writing it under the lock closes the
#      "two agents pick the same port" race.
#   3. Copy the starter template into ~/fleet/apps/<slug>/ and substitute
#      slug + title in app.json + package.json.
#   4. bun install → drizzle-kit generate → bun run build.
#   5. daemon-reload + enable --now the systemd unit; verify active.
#
# On any failure after the port claim, a trap removes the partial unit file
# and app folder so the port is released.

set -euo pipefail

log()  { printf '[create-app] %s\n' "$*"; }
die()  { printf '[create-app] ERROR: %s\n' "$*" >&2; exit 1; }

# --- Args -------------------------------------------------------------------

if [ $# -lt 1 ] || [ $# -gt 2 ]; then
    die "usage: create-app.sh <slug> [title]"
fi
SLUG="$1"
TITLE="${2:-}"

if ! [[ "$SLUG" =~ ^[a-z][a-z0-9-]*$ ]]; then
    die "slug must be kebab-case (lowercase letter start, then letters/digits/hyphens): got '$SLUG'"
fi
if [ "${#SLUG}" -gt 40 ]; then
    die "slug too long (max 40 chars): '$SLUG'"
fi

# Derive a default title from the slug when none was given.
# "grocery-list" -> "Grocery List"
if [ -z "$TITLE" ]; then
    TITLE=$(printf '%s' "$SLUG" | awk -F- 'BEGIN{OFS=" "} {for(i=1;i<=NF;i++)$i=toupper(substr($i,1,1)) substr($i,2)} 1')
fi

# --- Paths ------------------------------------------------------------------

APP_DIR="$HOME/fleet/apps/$SLUG"
UNIT_FILE="$HOME/.config/systemd/user/app-$SLUG.service"
LOCK_FILE="$HOME/fleet/.create-lock"

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
TEMPLATE_DIR="$SCRIPT_DIR/templates/app-starter"

# --- Pre-flight -------------------------------------------------------------

[ -d "$HOME/fleet/apps" ]         || die "~/fleet/apps does not exist — run bootstrap.sh first"
[ -d "$HOME/fleet/apps-archive" ] || die "~/fleet/apps-archive does not exist — run bootstrap.sh first"
[ -d "$HOME/fleet/apps-backups" ] || die "~/fleet/apps-backups does not exist — run bootstrap.sh first"
[ -d "$TEMPLATE_DIR" ]            || die "starter template not found at $TEMPLATE_DIR"
[ ! -e "$APP_DIR" ]               || die "app already exists at $APP_DIR"
[ ! -e "$UNIT_FILE" ]             || die "systemd unit already exists at $UNIT_FILE"

# Make bun discoverable even if this script runs from a shell that hasn't
# sourced rc files (e.g. an SSH exec).
export PATH="$HOME/.bun/bin:$PATH"
command -v bun >/dev/null 2>&1 || die "bun not on PATH — run bootstrap.sh first"

# --- Port claim (under exclusive lock) --------------------------------------

log "slug:  $SLUG"
log "title: $TITLE"
log "dir:   $APP_DIR"

PORT=""
{
    # fd 200 -> lock file; flock blocks until we hold the exclusive lock.
    exec 200>"$LOCK_FILE"
    flock -x 200

    # Collect ports already claimed by existing systemd units on this box.
    USED_PORTS=""
    if compgen -G "$HOME/.config/systemd/user/app-*.service" > /dev/null; then
        USED_PORTS=$(grep -h '^Environment=PORT=' "$HOME"/.config/systemd/user/app-*.service 2>/dev/null \
                     | sed 's/^Environment=PORT=//' \
                     | sort -u)
    fi

    for candidate in $(seq 9501 9599); do
        if ! printf '%s\n' "$USED_PORTS" | grep -qx "$candidate"; then
            PORT=$candidate
            break
        fi
    done

    if [ -z "$PORT" ]; then
        die "no free port in 9501-9599 — archive some apps before creating another"
    fi

    log "port:  $PORT (claiming atomically)"

    # Render + install the systemd unit RIGHT NOW while we hold the lock.
    # Once this file exists, subsequent create-app scans will see this port
    # as taken.
    sed \
        -e "s|__SLUG__|$SLUG|g" \
        -e "s|__APP_DIR__|$APP_DIR|g" \
        -e "s|__PORT__|$PORT|g" \
        "$TEMPLATE_DIR/app-SLUG.service.template" > "$UNIT_FILE"

    log "wrote systemd unit: $UNIT_FILE"

    # Lock releases on subshell exit.
}

# From here on, the port is claimed by our unit file. Any failure needs to
# roll back the unit file + folder to release the port.
CLEANUP_ON_FAIL=1
cleanup() {
    if [ "$CLEANUP_ON_FAIL" = "1" ]; then
        log "cleaning up partial create (rolling back port claim)..."
        systemctl --user disable "app-$SLUG.service" 2>/dev/null || true
        systemctl --user stop    "app-$SLUG.service" 2>/dev/null || true
        rm -f  "$UNIT_FILE"
        rm -rf "$APP_DIR"
        systemctl --user daemon-reload 2>/dev/null || true
    fi
}
trap cleanup EXIT

# --- Scaffold the app folder -----------------------------------------------

cp -r "$TEMPLATE_DIR" "$APP_DIR"
log "scaffolded starter into $APP_DIR"

# Remove the systemd template from the scaffold (it's already been rendered
# into ~/.config/systemd/user/); we keep it in the template directory but
# don't need a copy in every app folder.
rm -f "$APP_DIR/app-SLUG.service.template"

# --- Substitutions ---------------------------------------------------------

# app.json — set title, leave description blank for the agent to fill in.
cat > "$APP_DIR/app.json" <<JSON
{
  "title": "$TITLE",
  "description": ""
}
JSON
log "wrote app.json (title=\"$TITLE\", description empty — fill it in when you know what the app is)"

# package.json — set the "name" field to the slug so it doesn't collide
# with the template's default name if bun install caches by name.
if [ -f "$APP_DIR/package.json" ]; then
    python3 - "$APP_DIR/package.json" "$SLUG" <<'PYEOF'
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
data = json.loads(p.read_text())
data["name"] = sys.argv[2]
p.write_text(json.dumps(data, indent=2) + "\n")
PYEOF
    log "updated package.json (name=$SLUG)"
fi

# --- Install deps ----------------------------------------------------------

log "installing dependencies (bun install)..."
(cd "$APP_DIR" && bun install 2>&1) | tail -3

# The starter template ships with its initial migration pre-generated under
# drizzle/ — no generate step needed here. If the agent later edits the
# schema, they'll run `bun run db:generate` themselves per the skill body.

# --- Build production output ----------------------------------------------

log "building production output (bun run build)..."
(cd "$APP_DIR" && bun run build 2>&1) | tail -5

if [ ! -f "$APP_DIR/build/index.js" ]; then
    die "build did not produce build/index.js — check the tail above"
fi

# --- Enable + start --------------------------------------------------------

systemctl --user daemon-reload
systemctl --user enable --now "app-$SLUG.service"
log "systemd unit enabled and started"

# Give it a beat to come up, then verify.
sleep 2
if systemctl --user is-active --quiet "app-$SLUG.service"; then
    log "app-$SLUG is active (running)"
else
    log "WARNING: app-$SLUG did not reach active state"
    log "  check: journalctl --user -u app-$SLUG -n 50 --no-pager"
    # Don't die here — leave the app in place so the agent can debug it.
    # The port claim stays valid; user can archive-app or delete manually.
fi

# --- Success ---------------------------------------------------------------

CLEANUP_ON_FAIL=0

cat <<EOF

[create-app] done
  slug:    $SLUG
  title:   $TITLE
  port:    $PORT (bound to 127.0.0.1)
  folder:  $APP_DIR
  logs:    journalctl --user -u app-$SLUG -f
  status:  systemctl --user status app-$SLUG

Next: edit the starter down to your app's actual shape.
  - src/lib/server/db/schema.ts  — the Drizzle schema (replace the starter table)
  - src/routes/+page.svelte       — the UI
  - src/routes/+page.server.ts    — server logic (load + form actions)
  - README.md                     — describe the app for future maintainers
  - app.json                      — fill in the "description" field

Iterate in dev mode:
    systemctl --user stop app-$SLUG
    cd $APP_DIR
    bun run dev

Then ship:
    bun run build && systemctl --user restart app-$SLUG
EOF
