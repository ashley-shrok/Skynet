#!/usr/bin/env bash
# app-units.sh — the one place that knows how an app is run under systemd.
#
# Every app created since conversation apps exist is run as five user units,
# all named after the app's slug:
#
#   app-<slug>.socket          holds the app's PUBLIC port (9501-9599) open
#   app-<slug>-relay.service   systemd-socket-proxyd: public port → private port;
#                              BindsTo the app, so it stops when the app stops
#   app-<slug>.service         the app itself, on its PRIVATE port (public+10000)
#   app-<slug>-marker.path     starts the app when <dir>/.may-sleep is added/removed
#   app-<slug>-boot.service    at boot, starts the app unless .may-sleep exists
#
# Whether an app may sleep is decided ONLY by the .may-sleep marker in its
# folder: the app's own server.js goes to sleep (exits cleanly) after 10 idle
# minutes when the marker is present, and these units react to the marker.
#
# Apps created before this layout ("old-style") have a single always-on
# app-<slug>.service listening on the public port. They are left exactly as
# they are; `uninstall`, `stash`, `port` and `find` understand both styles.
#
# Commands:
#   find <slug>                  print the live app folder (sidebar or conversation)
#   owner <slug>                 print the owning identity of a conversation app ("" for sidebar)
#   port <slug> [dir]            print the public port (installed units, else stashed in dir)
#   used-ports                   print every claimed public port (live, archived, stashed)
#   slug-taken <slug>            exit 0 if the slug is used anywhere on this box
#   install <slug> <dir> <port>  render + enable + start the five units
#   uninstall <slug>             stop + disable + delete all of the app's units
#   stash <slug> <dir>           copy the installed units into <dir> as *.archived
#   restore <slug> <dir>         reinstall from a stash in <dir>, then delete the stash
#
# Everything here is idempotent enough to re-run after a partial failure.

set -euo pipefail

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

log() { printf '[app-units] %s\n' "$*" >&2; }
die() { printf '[app-units] ERROR: %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
UNIT_TEMPLATES="$SCRIPT_DIR/templates/units"
UNIT_DIR="${APP_UNITS_UNIT_DIR:-$HOME/.config/systemd/user}"
FLEET="${APP_UNITS_FLEET_DIR:-$HOME/fleet}"
SYSTEMCTL="${APP_UNITS_SYSTEMCTL:-systemctl}"
PRIVATE_PORT_OFFSET=10000

check_slug() {
    [[ "${1:-}" =~ ^[a-z][a-z0-9-]*$ ]] || die "invalid slug: '${1:-}'"
}

# Unit file names for a slug, new-style first. The old-style app is just the
# .service, which is also the new-style app unit.
unit_names() {
    local s="$1"
    printf '%s\n' "app-$s.socket" "app-$s-relay.service" "app-$s.service" \
        "app-$s-marker.path" "app-$s-boot.service"
}

is_new_style() { [ -f "$UNIT_DIR/app-$1.socket" ]; }

cmd_find() {
    local s="$1" d
    if [ -d "$FLEET/apps/$s" ]; then printf '%s\n' "$FLEET/apps/$s"; return 0; fi
    for d in "$FLEET"/identities/*/apps/"$s"; do
        [ -d "$d" ] && { printf '%s\n' "$d"; return 0; }
    done
    return 1
}

cmd_owner() {
    local dir
    dir=$(cmd_find "$1") || die "no live app named '$1'"
    case "$dir" in
        "$FLEET"/identities/*/apps/*)
            local rest="${dir#"$FLEET"/identities/}"
            printf '%s\n' "${rest%%/*}" ;;
        *) printf '\n' ;;
    esac
}

# Public port from a socket file (ListenStream=127.0.0.1:NNNN) or an old-style
# service file (Environment=PORT=NNNN). Prints nothing if neither is present.
port_from_files() {
    local sock="$1" svc="$2"
    if [ -f "$sock" ]; then
        sed -n 's/^ListenStream=127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' "$sock" | head -1
    elif [ -f "$svc" ]; then
        sed -n 's/^Environment=PORT=\([0-9][0-9]*\)$/\1/p' "$svc" | head -1
    fi
}

cmd_port() {
    local s="$1" dir="${2:-}" p
    p=$(port_from_files "$UNIT_DIR/app-$s.socket" "$UNIT_DIR/app-$s.service")
    if [ -z "$p" ] && [ -n "$dir" ]; then
        p=$(port_from_files "$dir/app-$s.socket.archived" "$dir/app-$s.service.archived")
    fi
    [ -n "$p" ] || return 1
    printf '%s\n' "$p"
}

cmd_used_ports() {
    {
        local f
        for f in "$UNIT_DIR"/app-*.socket; do
            [ -f "$f" ] && sed -n 's/^ListenStream=127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' "$f"
        done
        # Old-style services carry the public port; new-style ones carry the
        # private port (19501-19599), which the 9501-9599 picker never matches.
        for f in "$UNIT_DIR"/app-*.service; do
            [ -f "$f" ] && sed -n 's/^Environment=PORT=\([0-9][0-9]*\)$/\1/p' "$f"
        done
        # Stashes reserve their port so a restore can reclaim the same slot:
        # archived sidebar apps, and apps of archived conversations.
        for f in "$FLEET"/apps-archive/*/app-*.socket.archived \
                 "$FLEET"/identities-archive/*/apps/*/app-*.socket.archived \
                 "$FLEET"/identities/*/apps/*/app-*.socket.archived; do
            [ -f "$f" ] && sed -n 's/^ListenStream=127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' "$f"
        done
        for f in "$FLEET"/apps-archive/*/app-*.service.archived; do
            [ -f "$f" ] && sed -n 's/^Environment=PORT=\([0-9][0-9]*\)$/\1/p' "$f"
        done
    } | sort -un
}

cmd_slug_taken() {
    local s="$1" d
    [ -e "$FLEET/apps/$s" ] && return 0
    [ -e "$FLEET/apps-archive/$s" ] && return 0
    for d in "$FLEET"/identities/*/apps/"$s" "$FLEET"/identities-archive/*/apps/"$s"; do
        [ -e "$d" ] && return 0
    done
    local u
    while read -r u; do
        [ -e "$UNIT_DIR/$u" ] && return 0
    done < <(unit_names "$s")
    return 1
}

render() {
    local tpl="$1" out="$2" s="$3" dir="$4" port="$5"
    local tmp
    tmp=$(mktemp "$UNIT_DIR/.app-$s.XXXXXX")
    sed -e "s|__SLUG__|$s|g" \
        -e "s|__APP_DIR__|$dir|g" \
        -e "s|__PORT__|$port|g" \
        -e "s|__PRIVATE_PORT__|$((port + PRIVATE_PORT_OFFSET))|g" \
        "$tpl" > "$tmp"
    mv "$tmp" "$out"
}

# Write the five unit files only (no systemctl). Used by install, and by
# create-app.sh to claim a port atomically under its lock.
cmd_write() {
    local s="$1" dir="$2" port="$3"
    [[ "$port" =~ ^95[0-9][0-9]$ ]] || die "port must be in 9501-9599: '$port'"
    mkdir -p "$UNIT_DIR"
    render "$UNIT_TEMPLATES/app-SLUG.socket.template"         "$UNIT_DIR/app-$s.socket"         "$s" "$dir" "$port"
    render "$UNIT_TEMPLATES/app-SLUG-relay.service.template"  "$UNIT_DIR/app-$s-relay.service"  "$s" "$dir" "$port"
    render "$UNIT_TEMPLATES/app-SLUG.service.template"        "$UNIT_DIR/app-$s.service"        "$s" "$dir" "$port"
    render "$UNIT_TEMPLATES/app-SLUG-marker.path.template"    "$UNIT_DIR/app-$s-marker.path"    "$s" "$dir" "$port"
    render "$UNIT_TEMPLATES/app-SLUG-boot.service.template"   "$UNIT_DIR/app-$s-boot.service"   "$s" "$dir" "$port"
}

cmd_install() {
    local s="$1" dir="$2" port="$3"
    [ -d "$dir" ] || die "app folder not found: $dir"
    cmd_write "$s" "$dir" "$port"
    "$SYSTEMCTL" --user daemon-reload
    "$SYSTEMCTL" --user enable "app-$s.socket" "app-$s-marker.path" "app-$s-boot.service" >/dev/null 2>&1
    "$SYSTEMCTL" --user start "app-$s.socket" "app-$s-marker.path"
    # The boot check starts the app now if it may not sleep — the same
    # decision it makes at every boot.
    "$SYSTEMCTL" --user start "app-$s-boot.service" || true
    log "installed app-$s (public $port, private $((port + PRIVATE_PORT_OFFSET)), folder $dir)"
}

cmd_uninstall() {
    local s="$1" u units=()
    while read -r u; do units+=("$u"); done < <(unit_names "$s")
    "$SYSTEMCTL" --user disable --now "${units[@]}" >/dev/null 2>&1 || true
    "$SYSTEMCTL" --user stop "${units[@]}" >/dev/null 2>&1 || true
    for u in "${units[@]}"; do rm -f "$UNIT_DIR/$u"; done
    "$SYSTEMCTL" --user daemon-reload
    "$SYSTEMCTL" --user reset-failed "${units[@]}" >/dev/null 2>&1 || true
    log "uninstalled app-$s"
}

cmd_stash() {
    local s="$1" dir="$2" u n=0
    while read -r u; do
        if [ -f "$UNIT_DIR/$u" ]; then cp "$UNIT_DIR/$u" "$dir/$u.archived"; n=$((n + 1)); fi
    done < <(unit_names "$s")
    log "stashed $n unit file(s) for app-$s into $dir"
}

cmd_restore() {
    local s="$1" dir="$2" port u
    if [ -f "$dir/app-$s.socket.archived" ]; then
        port=$(port_from_files "$dir/app-$s.socket.archived" /nonexistent) || true
        [ -n "$port" ] || die "stash in $dir has no readable port"
        cmd_install "$s" "$dir" "$port"
    elif [ -f "$dir/app-$s.service.archived" ]; then
        # Old-style: put the single unit back, pointing at the folder's current location.
        local old_dir
        old_dir=$(sed -n 's/^WorkingDirectory=//p' "$dir/app-$s.service.archived" | head -1)
        sed -e "s|$old_dir|$dir|g" "$dir/app-$s.service.archived" > "$UNIT_DIR/app-$s.service"
        "$SYSTEMCTL" --user daemon-reload
        "$SYSTEMCTL" --user enable --now "app-$s.service" >/dev/null 2>&1
        log "restored old-style app-$s"
    else
        die "no stashed units for app-$s in $dir"
    fi
    while read -r u; do rm -f "$dir/$u.archived"; done < <(unit_names "$s")
}

[ $# -ge 1 ] || die "usage: app-units.sh <find|owner|port|used-ports|slug-taken|write|install|uninstall|stash|restore> ..."
cmd="$1"; shift
case "$cmd" in
    find)       [ $# -eq 1 ] || die "usage: find <slug>";             check_slug "$1"; cmd_find "$1" ;;
    owner)      [ $# -eq 1 ] || die "usage: owner <slug>";            check_slug "$1"; cmd_owner "$1" ;;
    port)       [ $# -ge 1 ] || die "usage: port <slug> [dir]";       check_slug "$1"; cmd_port "$@" ;;
    used-ports) cmd_used_ports ;;
    slug-taken) [ $# -eq 1 ] || die "usage: slug-taken <slug>";       check_slug "$1"; cmd_slug_taken "$1" ;;
    write)      [ $# -eq 3 ] || die "usage: write <slug> <dir> <port>";   check_slug "$1"; cmd_write "$@" ;;
    install)    [ $# -eq 3 ] || die "usage: install <slug> <dir> <port>"; check_slug "$1"; cmd_install "$@" ;;
    uninstall)  [ $# -eq 1 ] || die "usage: uninstall <slug>";        check_slug "$1"; cmd_uninstall "$1" ;;
    stash)      [ $# -eq 2 ] || die "usage: stash <slug> <dir>";      check_slug "$1"; cmd_stash "$@" ;;
    restore)    [ $# -eq 2 ] || die "usage: restore <slug> <dir>";    check_slug "$1"; cmd_restore "$@" ;;
    *) die "unknown command: $cmd" ;;
esac
