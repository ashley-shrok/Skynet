#!/usr/bin/env bash
# bootstrap.sh — first-app-on-a-box setup for the app-development skill.
#
# Idempotent. Safe to re-run. Verifies (installs if missing) Bun, creates the
# three top-level folders under ~/fleet/, and enables systemd --user linger
# so per-app units survive user logout.
#
# Run this once before creating your first app on any managed box. If it's
# already been run, this is a fast no-op.

set -euo pipefail

log() { printf '[bootstrap] %s\n' "$*"; }
die() { printf '[bootstrap] ERROR: %s\n' "$*" >&2; exit 1; }

# The bun installer writes to ~/.bun/bin/bun and appends PATH exports to the
# user's shell rc files — but this script runs in a fresh subprocess that
# doesn't source rc files. Add ~/.bun/bin to PATH up front so a previously-
# installed bun is discoverable and re-runs of this script are fast no-ops.
export PATH="$HOME/.bun/bin:$PATH"

# --- 1. Bun runtime ---------------------------------------------------------

if command -v bun >/dev/null 2>&1; then
    log "bun already installed: $(bun --version)"
else
    log "bun not found — installing from install.bun.sh"
    if ! command -v curl >/dev/null 2>&1; then
        die "curl is required to install bun but is not on PATH"
    fi
    curl -fsSL https://bun.sh/install | bash

    # PATH already has ~/.bun/bin from the export at the top of this script;
    # verify the install actually landed something there.
    if ! command -v bun >/dev/null 2>&1; then
        die "bun install completed but 'bun' is still not on PATH — check ~/.bun/bin/ and your shell rc"
    fi
    log "bun installed: $(bun --version)"
fi

# --- 2. Top-level folders ---------------------------------------------------

for dir in "$HOME/fleet/apps" "$HOME/fleet/apps-archive" "$HOME/fleet/apps-backups"; do
    if [ -d "$dir" ]; then
        log "already exists: $dir"
    else
        mkdir -p "$dir"
        log "created:        $dir"
    fi
done

# --- 3. systemd --user linger -----------------------------------------------
#
# Without linger, systemd --user units are torn down when the user logs out.
# Enabling linger keeps them running across logout and reboot — required for
# apps to stay up.

if ! command -v loginctl >/dev/null 2>&1; then
    die "loginctl not found — this box does not appear to use systemd"
fi

linger_state=$(loginctl show-user "$USER" -p Linger --value 2>/dev/null || echo "unknown")
if [ "$linger_state" = "yes" ]; then
    log "linger already enabled for user: $USER"
else
    log "enabling linger for user: $USER"
    if loginctl enable-linger "$USER" 2>/dev/null; then
        log "linger enabled"
    elif sudo -n loginctl enable-linger "$USER" 2>/dev/null; then
        log "linger enabled (via sudo)"
    else
        die "failed to enable linger — try: sudo loginctl enable-linger $USER"
    fi
fi

# --- 4. systemd --user daemon ready -----------------------------------------
#
# The per-app systemd unit will land in ~/.config/systemd/user/. Make sure
# that directory exists and the user's systemd instance is aware of it.

mkdir -p "$HOME/.config/systemd/user"
systemctl --user daemon-reload 2>/dev/null || true

log "bootstrap complete — ready to create apps under ~/fleet/apps/"
