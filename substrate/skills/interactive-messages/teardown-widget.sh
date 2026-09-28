#!/usr/bin/env bash
# teardown-widget.sh — atomically remove an interactive widget.
# Inverse of create-widget.sh: stops + disables the systemd unit, removes the
# unit file, removes the widget directory, and runs daemon-reload so systemd
# forgets the freed port.
#
# ── Invocation forms ──────────────────────────────────────────────────────────
#
# Form A (positional):
#   teardown-widget.sh <slug>
#
# Form B (flag-based):
#   teardown-widget.sh --slug <slug>
#
# Additional flag:
#   --force   Skip the existence check (safe to call blindly on an already-
#             torn-down or never-created slug).
#
# ── Exit conditions ───────────────────────────────────────────────────────────
#
#   0   Teardown completed (all found pieces removed).
#   1   Slug missing or invalid.
#   1   Neither widget dir nor unit file exists AND --force not set.
#   1   Unknown flag passed.
#
# ── SKIP_SYSTEMCTL escape hatch ───────────────────────────────────────────────
#
#   Set SKIP_SYSTEMCTL=1 to bypass all `systemctl --user` calls (stop, disable,
#   daemon-reload). The filesystem removals still run. Used by the test harness
#   to avoid hitting real systemd in CI / ephemeral HOME environments.
#   Mirrors create-widget.sh's identical convention.
#
# ── Steps ─────────────────────────────────────────────────────────────────────
#   1. Parse argv (positional Form A or flag Form B; --force flag).
#   2. Validate slug (kebab-case, max 40 chars).
#   3. Resolve paths: WIDGET_DIR and UNIT_FILE.
#   4. Existence check (skipped under --force).
#   5. Stop + disable systemd unit (fail-soft; skipped when SKIP_SYSTEMCTL=1).
#   6. Remove unit file (rm -f, idempotent).
#   7. Remove widget dir (rm -rf, idempotent).
#   8. daemon-reload (fail-soft; skipped when SKIP_SYSTEMCTL=1).
#   9. Print TORN_DOWN=<slug> to stdout.

set -euo pipefail

log() { printf '[teardown-widget] %s\n' "$*" >&2; }
die() { printf '[teardown-widget] ERROR: %s\n' "$*" >&2; exit 1; }

SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# ── Arg parsing ───────────────────────────────────────────────────────────────
# Two-pass: detect whether argv starts with a bareword (positional Form A)
# or a -- flag (Form B).

if [ $# -lt 1 ]; then
    die "usage: teardown-widget.sh <slug> [--force]  OR  teardown-widget.sh --slug <slug> [--force]"
fi

SLUG=""
FORCE=0

if [[ "$1" == "--"* ]]; then
    # Form B: flag-based
    # Also accepts a bare slug positional after flags (e.g. --force <slug>).
    while [ $# -gt 0 ]; do
        case "$1" in
            --slug)
                [ $# -ge 2 ] || die "--slug requires a value"
                SLUG="$2"; shift 2 ;;
            --force)
                FORCE=1; shift ;;
            --*)
                die "unknown flag '$1' — usage: teardown-widget.sh --slug <slug> [--force]" ;;
            *)
                # Bare positional slug after flags (e.g. --force <slug>)
                [ -z "$SLUG" ] || die "unexpected argument '$1' — slug already set to '$SLUG'"
                SLUG="$1"; shift ;;
        esac
    done
else
    # Form A: positional — slug is first bareword arg, remaining may include --force
    SLUG="$1"
    shift
    while [ $# -gt 0 ]; do
        case "$1" in
            --force)
                FORCE=1; shift ;;
            *)
                die "unknown flag '$1' — usage: teardown-widget.sh <slug> [--force]" ;;
        esac
    done
fi

# ── Validate slug ─────────────────────────────────────────────────────────────

[ -n "$SLUG" ] || die "slug is required"

if ! [[ "$SLUG" =~ ^[a-z][a-z0-9-]*$ ]]; then
    die "slug must be kebab-case (lowercase letter start, then letters/digits/hyphens): got '$SLUG'"
fi
if [ "${#SLUG}" -gt 40 ]; then
    die "slug too long (max 40 chars): '$SLUG'"
fi

# ── Path resolution ───────────────────────────────────────────────────────────

WIDGET_DIR="$HOME/fleet/interactive-messages/$SLUG"
UNIT_FILE="$HOME/.config/systemd/user/im-$SLUG.service"

# ── Existence check (skipped under --force) ───────────────────────────────────

if [ "$FORCE" = "0" ]; then
    if [ ! -d "$WIDGET_DIR" ] && [ ! -f "$UNIT_FILE" ]; then
        die "no widget found for slug '$SLUG' — pass --force to skip existence check"
    fi
fi

# ── Systemd stop + disable (fail-soft) ────────────────────────────────────────

if [ "${SKIP_SYSTEMCTL:-0}" = "1" ]; then
    log "SKIP_SYSTEMCTL=1 — skipping systemd stop/disable/daemon-reload (test mode)"
else
    systemctl --user stop    "im-$SLUG.service" 2>/dev/null || true
    systemctl --user disable "im-$SLUG.service" 2>/dev/null || true
fi

# ── Unit file removal ─────────────────────────────────────────────────────────

rm -f "$UNIT_FILE"
log "removed unit file: $UNIT_FILE"

# ── Widget dir removal ────────────────────────────────────────────────────────

rm -rf "$WIDGET_DIR"
log "removed widget dir: $WIDGET_DIR"

# ── daemon-reload (fail-soft) ─────────────────────────────────────────────────

if [ "${SKIP_SYSTEMCTL:-0}" != "1" ]; then
    systemctl --user daemon-reload 2>/dev/null || true
fi

# ── Success output ────────────────────────────────────────────────────────────

printf 'TORN_DOWN=%s\n' "$SLUG"

log "done"
log "  slug:   $SLUG"
log "  dir:    $WIDGET_DIR (removed)"
log "  unit:   $UNIT_FILE (removed)"
