/**
 * harness-script.ts — The host-side bash that moves one host onto the harness
 * pin, plus the parser for its one-line result.
 *
 * PURE-LIB: string building + parsing only. No SSH, no fs, no exec. The
 * reconciler (harness-reconciler.ts) ships this script to the host — over the
 * substrate SSH channel for remote hosts, through the host's systemd --user
 * manager for the co-located host — and parses what comes back.
 *
 * WHAT THE SCRIPT DOES (args: $1 = pin, $2 = optional result-file path):
 *   1. Not Linux → `action=skipped reason=not-linux`.
 *   2. ~/.local/bin/claude already links to versions/<pin> (and it's
 *      executable) → `action=none`. This is the cheap path every converged
 *      host takes: two stat-level checks, no download, no binary run.
 *   3. versions/<pin> already on disk and reports the pin when run →
 *      atomically repoint the link → `action=relinked`. Rollback to the
 *      previous version takes this path with no download at all (the
 *      official installer always downloads the latest build first to run its
 *      own install step, so it is NOT used when the bytes are already there).
 *   4. Otherwise run Anthropic's official installer for exactly the pin
 *      (`install.sh <pin>`), after preflighting disk space (a disk-full
 *      install truncates ~/.claude.json fleet-wide — refuse below
 *      MIN_FREE_KB instead) and a downloader. Verify the link + version
 *      afterwards → `action=installed`.
 *   5. After a successful relink/install, prune ~/.local/share/claude/versions/
 *      down to the pin plus the version the link pointed at before this run.
 *      Only entries named like a version are touched. Agents still running a
 *      pruned binary are unaffected (the inode lives until they exit).
 *
 * OUTPUT: exactly one `HARNESS_RESULT ...` line on stdout (installer chatter
 * goes to ~/.cache/skynet-harness/install.log). When $2 is given the same
 * line is also written there atomically (tmp + mv) — the co-located path has
 * no stdout to read. The script always exits 0; failure is in the line.
 *
 * Line grammar: `HARNESS_RESULT k=v k=v ... detail=<free text to EOL>`, keys
 * action, wanted, found, reason, pruned (comma list), detail. Values other
 * than detail never contain spaces.
 */

import { HARNESS_PIN_PATTERN } from "./harness-pin.js";

/** Refuse to install below this much free space in $HOME (KiB). The
 *  installer downloads the latest build (~240 MB) as a bootstrapper AND the
 *  pinned build (~240 MB); 1 GiB leaves headroom above both. */
export const HARNESS_MIN_FREE_KB = 1024 * 1024;

/** Hard ceiling on one installer run (seconds), enforced host-side with
 *  `timeout` when available so a wedged download can't hold the channel. */
export const HARNESS_INSTALL_TIMEOUT_S = 900;

export const HARNESS_INSTALLER_URL = "https://claude.ai/install.sh";

/**
 * The script body. Static — the pin and result path arrive as argv so the
 * same bytes run on every host and nothing is interpolated into shell code.
 */
export const HARNESS_RECONCILE_SCRIPT = `#!/bin/bash
set -u
PIN="\${1:-}"
RESULT_FILE="\${2:-}"
BIN="$HOME/.local/bin/claude"
VDIR="$HOME/.local/share/claude/versions"
TARGET="$VDIR/$PIN"
WORK="$HOME/.cache/skynet-harness"
LOG="$WORK/install.log"

emit() {
  line="HARNESS_RESULT $*"
  printf '%s\\n' "$line"
  if [ -n "$RESULT_FILE" ]; then
    mkdir -p "$(dirname "$RESULT_FILE")" 2>/dev/null
    printf '%s\\n' "$line" > "$RESULT_FILE.tmp.$$" && mv -f "$RESULT_FILE.tmp.$$" "$RESULT_FILE"
  fi
  exit 0
}

clean() { printf '%s' "$1" | tr '\\r\\n\\t' '   ' | cut -c1-300; }

if ! printf '%s' "$PIN" | grep -Eq '^[0-9]+\\.[0-9]+\\.[0-9]+$'; then
  emit "action=failed wanted=invalid found=unknown reason=bad-pin detail=pin must be MAJOR.MINOR.PATCH"
fi

if [ "$(uname -s)" != "Linux" ]; then
  emit "action=skipped wanted=$PIN found=unknown reason=not-linux detail=$(clean "$(uname -s)")"
fi

# Compare canonical paths so a symlinked $HOME can't make a converged host
# look unconverged.
canon() { readlink -f "$1" 2>/dev/null || printf '%s' "$1"; }
VDIR_R="$(canon "$VDIR")"
TARGET_R="$VDIR_R/$PIN"
CUR=""
if [ -L "$BIN" ]; then
  CUR="$(canon "$BIN")"
  case "$CUR" in
    "$VDIR_R"/*) FOUND="$(basename "$CUR")" ;;
    *) FOUND="unmanaged" ;;
  esac
elif [ -e "$BIN" ]; then
  FOUND="unmanaged"
else
  FOUND="none"
fi

if [ -n "$CUR" ] && [ "$CUR" = "$TARGET_R" ] && [ -x "$TARGET" ]; then
  emit "action=none wanted=$PIN found=$PIN detail=already on pin"
fi

# The version the link pointed at before this run — kept by the prune step so
# a rollback is a relink with no download.
PREV=""
case "$CUR" in
  "$VDIR_R"/*) [ -x "$CUR" ] && PREV="$(basename "$CUR")" ;;
esac

mkdir -p "$WORK" "$HOME/.local/bin"

# One reconcile at a time per host. A Skynet restart mid-install does not
# kill the host-side run (no tty, closed channel), so the next Skynet's
# startup sweep could otherwise start a second one racing on the same
# download + install paths. A busy host reports failed/busy and is retried
# on the normal backoff.
if command -v flock >/dev/null 2>&1; then
  exec 9>"$WORK/lock"
  flock -n 9 || emit "action=failed wanted=$PIN found=$FOUND reason=busy detail=another harness reconcile is running on this host"
else
  LOCKDIR="$WORK/lock.d"
  if ! mkdir "$LOCKDIR" 2>/dev/null; then
    # No flock: a lock dir older than the installer ceiling is stale.
    if [ -n "$(find "$LOCKDIR" -maxdepth 0 -mmin +${Math.ceil(HARNESS_INSTALL_TIMEOUT_S / 60) + 5} 2>/dev/null)" ]; then
      rm -rf "$LOCKDIR"; mkdir "$LOCKDIR" 2>/dev/null
    else
      emit "action=failed wanted=$PIN found=$FOUND reason=busy detail=another harness reconcile is running on this host"
    fi
  fi
  trap 'rmdir "$LOCKDIR" 2>/dev/null' EXIT
fi

reports_pin() {
  "$1" --version 2>/dev/null | head -n1 | grep -q "^$PIN "
}

relink() {
  ln -sfn "$TARGET" "$BIN.skynet-tmp.$$" && mv -Tf "$BIN.skynet-tmp.$$" "$BIN"
}

# A version is in use while any process is executing it. Deleting a running
# binary is NOT harmless for the harness: it re-execs itself for built-in
# tools (e.g. its embedded ripgrep), which breaks once the file is gone. So
# such a version is kept until a later prune finds it idle.
in_use() {
  f_r="$(canon "$1")"
  for p in /proc/[0-9]*; do
    [ "$(readlink "$p/exe" 2>/dev/null)" = "$f_r" ] && return 0
  done
  return 1
}

prune() {
  PRUNED=""
  for f in "$VDIR"/*; do
    [ -e "$f" ] || continue
    v="$(basename "$f")"
    case "$v" in
      "$PIN"|"$PREV") continue ;;
    esac
    printf '%s' "$v" | grep -Eq '^[0-9]+\\.[0-9]+\\.[0-9]+$' || continue
    in_use "$f" && continue
    if rm -f "$f" 2>/dev/null; then PRUNED="\${PRUNED:+$PRUNED,}$v"; fi
  done
  printf '%s' "$PRUNED"
}

if [ -x "$TARGET" ] && reports_pin "$TARGET"; then
  if relink; then
    P="$(prune)"
    emit "action=relinked wanted=$PIN found=$FOUND pruned=\${P:-none} detail=pinned version already on disk"
  fi
  emit "action=failed wanted=$PIN found=$FOUND reason=relink-failed detail=could not repoint $BIN"
fi

AVAIL_KB="$(df -Pk "$HOME" 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -n "$AVAIL_KB" ] && [ "$AVAIL_KB" -lt ${HARNESS_MIN_FREE_KB} ] 2>/dev/null; then
  emit "action=failed wanted=$PIN found=$FOUND reason=low-disk detail=\${AVAIL_KB}KiB free in $HOME, need ${HARNESS_MIN_FREE_KB}KiB"
fi

INSTALLER="$WORK/install.sh"
# Never run a leftover installer from an earlier, interrupted run.
rm -f "$INSTALLER"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL --connect-timeout 20 --max-time 120 "${HARNESS_INSTALLER_URL}" -o "$INSTALLER" >"$LOG" 2>&1
  DL=$?
elif command -v wget >/dev/null 2>&1; then
  wget -q --timeout=60 --tries=2 -O "$INSTALLER" "${HARNESS_INSTALLER_URL}" >"$LOG" 2>&1
  DL=$?
else
  emit "action=failed wanted=$PIN found=$FOUND reason=no-downloader detail=neither curl nor wget on PATH"
fi
if [ "$DL" -ne 0 ] || [ ! -s "$INSTALLER" ]; then
  rm -f "$INSTALLER"
  emit "action=failed wanted=$PIN found=$FOUND reason=download-failed detail=$(clean "$(tail -n 3 "$LOG" 2>/dev/null)")"
fi

TO=""
command -v timeout >/dev/null 2>&1 && TO="timeout ${HARNESS_INSTALL_TIMEOUT_S}"
$TO bash "$INSTALLER" "$PIN" </dev/null >>"$LOG" 2>&1
RC=$?
rm -f "$INSTALLER"
if [ "$RC" -ne 0 ]; then
  emit "action=failed wanted=$PIN found=$FOUND reason=installer-exit-$RC detail=$(clean "$(grep -v '^[[:space:]]*$' "$LOG" 2>/dev/null | tail -n 3)")"
fi

if [ -L "$BIN" ] && [ "$(canon "$BIN")" = "$(canon "$TARGET")" ] && [ -x "$TARGET" ] && reports_pin "$TARGET"; then
  P="$(prune)"
  emit "action=installed wanted=$PIN found=$FOUND pruned=\${P:-none} detail=installed via official installer"
fi
emit "action=failed wanted=$PIN found=$FOUND reason=verify-failed detail=installer exited 0 but $BIN does not run $PIN"
`;

export type HarnessAction =
  | "none"
  | "relinked"
  | "installed"
  | "skipped"
  | "failed";

export interface HarnessResult {
  action: HarnessAction;
  wanted: string;
  found: string;
  reason?: string;
  pruned?: string[];
  detail?: string;
}

const ACTIONS: ReadonlySet<string> = new Set([
  "none",
  "relinked",
  "installed",
  "skipped",
  "failed",
]);

/**
 * Find the LAST `HARNESS_RESULT` line in the output and parse it. Returns
 * null when there is no well-formed line (the caller treats that as a
 * failed attempt with reason "no-result").
 */
export function parseHarnessResult(output: string | null): HarnessResult | null {
  if (!output) return null;
  const lines = output.split("\n").filter((l) => l.startsWith("HARNESS_RESULT "));
  const line = lines[lines.length - 1];
  if (!line) return null;

  let body = line.slice("HARNESS_RESULT ".length);
  let detail: string | undefined;
  const d = body.indexOf("detail=");
  if (d >= 0) {
    detail = body.slice(d + "detail=".length).trim();
    body = body.slice(0, d);
  }
  const kv = new Map<string, string>();
  for (const tok of body.trim().split(/\s+/)) {
    const eq = tok.indexOf("=");
    if (eq > 0) kv.set(tok.slice(0, eq), tok.slice(eq + 1));
  }
  const action = kv.get("action");
  if (!action || !ACTIONS.has(action)) return null;

  const prunedRaw = kv.get("pruned");
  return {
    action: action as HarnessAction,
    wanted: kv.get("wanted") ?? "unknown",
    found: kv.get("found") ?? "unknown",
    ...(kv.has("reason") ? { reason: kv.get("reason") } : {}),
    ...(prunedRaw && prunedRaw !== "none"
      ? { pruned: prunedRaw.split(",").filter(Boolean) }
      : {}),
    ...(detail ? { detail } : {}),
  };
}

/**
 * The one-line remote command for the SSH path. The script travels base64'd
 * inside the command (well under the argv cap) and runs from a temp file with
 * stdin closed — NOT `bash -s`, because the installer's children would
 * otherwise inherit (and eat) the script on stdin.
 */
export function buildRemoteHarnessCommand(pin: string): string {
  // The pin is pasted into single quotes below — never accept anything but
  // an exact version, regardless of what the caller validated.
  if (!HARNESS_PIN_PATTERN.test(pin)) {
    throw new Error(`harness pin must be MAJOR.MINOR.PATCH, got "${pin}"`);
  }
  const b64 = Buffer.from(HARNESS_RECONCILE_SCRIPT, "utf-8").toString("base64");
  return (
    `S=$(mktemp) && printf '%s' '${b64}' | base64 -d > "$S" && ` +
    `bash "$S" '${pin}' </dev/null; rc=$?; rm -f "$S"; echo "HARNESS_EXIT:$rc"`
  );
}
