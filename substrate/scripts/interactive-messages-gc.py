#!/usr/bin/env python3
"""interactive-messages-gc.py — Seven-day backstop GC sweep for interactive widgets.

Phase 140 Plan 03. Ships the automatic lifecycle enforcement invariant from the
interactive-messages shape doc: any widget older than seven days is torn down by
this script, which runs daily via the interactive-messages-gc.timer systemd user
timer.

Distribution: this file is git-committed with the execute bit set. The substrate
distributor (catalog row "interactive-messages-gc") pushes it to
~/.local/bin/interactive-messages-gc on every fleet-substrate-managed host. The
matching .service and .timer units are also distributed; run-bootstrap.ts enables
and starts the timer on every host after the first distributor sweep.

Invocation (production):
    ~/.local/bin/interactive-messages-gc      # no args; uses defaults

Invocation (testable / manual):
    interactive-messages-gc --dry-run              # enumerate without tearing down
    interactive-messages-gc --age-days 3           # lower threshold for testing
    interactive-messages-gc --root /tmp/widgets    # alternate widget root

Log convention (LOUD teardown lines — grep-able via journalctl):
    [interactive-messages-gc] TEARDOWN slug=<slug> age_days=<n> created_at=<ts>
    [interactive-messages-gc] done. checked=N tore_down=M skipped=S

Every teardown line is intentionally designed so `journalctl --user -u
interactive-messages-gc | grep TEARDOWN` is a complete audit trail.

Atomic-teardown fallback invariant: this script shells out to teardown-widget.sh
--force so the sweep completes what a crashed create-widget.sh may have left
partial. The --force flag is load-bearing: it bypasses teardown-widget.sh's own
existence check, ensuring the cleanup is unconditional regardless of partial
filesystem state.

Constraints:
    * Python 3.6+ stdlib ONLY (no pip installs). Mirrors fleet-status-sweep.py
      and context-watch.py precedent — every managed box already has Python 3.
    * Exit 0 ALWAYS on normal paths. Individual widget failures never fail the
      whole sweep. The only non-zero exit is an unhandled top-level exception
      (unexpected error in the enumeration itself, not in a single widget).
"""

import argparse
import datetime
import json
import os
import pathlib
import subprocess
import sys

# ---------------------------------------------------------------------------
# Configurable constants
# ---------------------------------------------------------------------------

DEFAULT_AGE_DAYS = 7

# Env-var override for the teardown command path. The test harness sets this to
# a mock script; production leaves it unset (picks up the installed location).
TEARDOWN_CMD = os.environ.get(
    "INTERACTIVE_MESSAGES_TEARDOWN_CMD",
    os.path.expanduser("~/.claude/skills/interactive-messages/teardown-widget.sh"),
)


# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

def _log(msg: str) -> None:
    """Print a tagged log line to stdout, flushed immediately."""
    print(f"[interactive-messages-gc] {msg}", flush=True)


def _warn(msg: str) -> None:
    """Print a tagged warning to stderr, flushed immediately."""
    print(f"[interactive-messages-gc] WARN: {msg}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------------------
# ISO8601 parser — forgiving of both 'Z' suffix and offset forms
# ---------------------------------------------------------------------------

def _parse_created_at(raw: str) -> datetime.datetime | None:
    """Parse a created_at string to a naive UTC datetime, or None on failure.

    Accepts:
        "2026-09-01T12:34:56Z"
        "2026-09-01T12:34:56.789Z"
        "2026-09-01T12:34:56+00:00"
        "2026-09-01T12:34:56"        (assumed UTC, no offset)

    Returns a naive UTC datetime (timezone info stripped after normalization).
    Returns None on any parse error.
    """
    if not isinstance(raw, str) or not raw:
        return None
    s = raw.strip()
    try:
        # Normalize 'Z' suffix → Python fromisoformat-compatible form.
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        # datetime.fromisoformat is available from Python 3.7+.
        dt = datetime.datetime.fromisoformat(s)
        # Convert to naive UTC for comparison.
        if dt.tzinfo is not None:
            utc_offset = dt.utcoffset()
            if utc_offset is not None:
                dt = (dt - utc_offset).replace(tzinfo=None)
        return dt
    except (ValueError, AttributeError):
        pass

    # Fallback: try strptime with fractional-seconds Z form.
    for fmt in (
        "%Y-%m-%dT%H:%M:%S.%fZ",
        "%Y-%m-%dT%H:%M:%SZ",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
    ):
        try:
            return datetime.datetime.strptime(raw.strip(), fmt)
        except ValueError:
            continue

    return None


# ---------------------------------------------------------------------------
# Core sweep logic
# ---------------------------------------------------------------------------

def sweep(root: str, age_days: int, dry_run: bool) -> int:
    """Enumerate widgets under `root`, tear down those older than `age_days`.

    Returns 0 on success (individual widget failures are logged but do not
    propagate). Raises only on top-level unhandled exceptions.
    """
    root_path = pathlib.Path(root)

    if not root_path.exists():
        _log(f"no widgets root at {root_path}, nothing to sweep")
        _log("done. checked=0 tore_down=0 skipped=0")
        return 0

    checked = 0
    tore_down = 0
    skipped = 0

    now = datetime.datetime.utcnow()

    for entry in sorted(root_path.iterdir()):
        if not entry.is_dir():
            continue

        slug = entry.name
        checked += 1

        # Load metadata.json
        meta_path = entry / "metadata.json"
        if not meta_path.exists():
            _warn(f"slug={slug}: metadata.json missing — skipping")
            skipped += 1
            continue

        try:
            with open(meta_path, "r", encoding="utf-8") as fh:
                meta = json.load(fh)
        except (json.JSONDecodeError, OSError) as exc:
            _warn(f"slug={slug}: metadata.json unreadable ({exc}) — skipping")
            skipped += 1
            continue

        # Extract created_at
        created_at_raw = meta.get("created_at")
        if not created_at_raw:
            _warn(f"slug={slug}: metadata.json has no created_at field — skipping")
            skipped += 1
            continue

        created_at = _parse_created_at(created_at_raw)
        if created_at is None:
            _warn(f"slug={slug}: created_at='{created_at_raw}' could not be parsed — skipping")
            skipped += 1
            continue

        # Age computation
        age = now - created_at
        age_days_actual = age.days

        if age_days_actual < age_days:
            # Widget is fresh — leave it alone.
            continue

        # Widget is old — log LOUDLY and tear down (or dry-run).
        _log(
            f"TEARDOWN slug={slug} age_days={age_days_actual} created_at={created_at_raw}"
        )

        if dry_run:
            _log(f"DRY-RUN would-teardown slug={slug}")
            # In dry-run mode we do NOT count would-be teardowns against tore_down
            # (tore_down counts real, executed teardowns). The would-teardown log
            # line is the dry-run signal; the summary's tore_down=0 confirms no
            # actual teardowns ran.
        else:
            result = subprocess.run(
                ["bash", TEARDOWN_CMD, "--force", slug],
                check=False,
                capture_output=True,
                text=True,
            )
            if result.returncode != 0:
                _warn(
                    f"slug={slug}: teardown-widget.sh exited {result.returncode} — "
                    f"stderr: {result.stderr.strip()[:200]}"
                )
                # Continue to next widget — one failure must not stop the sweep.
                skipped += 1
                continue

            tore_down += 1

    _log(f"done. checked={checked} tore_down={tore_down} skipped={skipped}")
    return 0


# ---------------------------------------------------------------------------
# CLI entrypoint
# ---------------------------------------------------------------------------

def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Interactive-messages seven-day backstop GC sweep. "
            "Enumerates ~/fleet/interactive-messages/*/ and tears down any "
            "widget whose metadata.json.created_at is older than --age-days."
        )
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Enumerate and log would-be teardowns without actually shelling out.",
    )
    parser.add_argument(
        "--age-days",
        type=int,
        default=DEFAULT_AGE_DAYS,
        metavar="N",
        help=f"Age threshold in days (default: {DEFAULT_AGE_DAYS}).",
    )
    parser.add_argument(
        "--root",
        type=str,
        default=os.path.join(os.path.expanduser("~"), "fleet", "interactive-messages"),
        metavar="PATH",
        help="Widget root directory (default: ~/fleet/interactive-messages).",
    )
    args = parser.parse_args()

    try:
        return sweep(root=args.root, age_days=args.age_days, dry_run=args.dry_run)
    except Exception as exc:  # pylint: disable=broad-except
        print(
            f"[interactive-messages-gc] FATAL: unhandled exception: {exc}",
            file=sys.stderr,
            flush=True,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
