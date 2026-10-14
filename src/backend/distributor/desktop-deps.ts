/**
 * desktop-deps.ts — pre-install the agent virtual desktop's system packages.
 *
 * agent-desktop (substrate/scripts/agent-desktop) needs Xvnc, vncpasswd,
 * openbox, xdotool and ImageMagick's `import`. It installs them itself on
 * first use, but only when the agent's user has passwordless sudo — on a box
 * where it doesn't (or an image-based OS like Bazzite) the agent is stuck and
 * has to ask the user for admin rights. The sweep's SSH user is root or a
 * NOPASSWD sudoer, so the bootstrap installs them up front instead.
 *
 * DESKTOP_DEPS_CMD is one `sh` heredoc, sent once per host per sweep. The
 * install itself runs DETACHED on the host (setsid nohup, stdin /dev/null):
 * the sweep is serial across hosts, and an apt/rpm-ostree run can take
 * minutes — waiting would hold up every other host, and a timeout would kill
 * dpkg mid-unpack. The outcome is picked up by the next sweep from the state
 * dir ~/.cache/fleet-desktop-deps/ (install.log + install.pid) of the SSH user.
 *
 * Result line `__DESKTOP_DEPS__ <status> [missing commands...]`:
 *   present      every command found, no install log — steady state.
 *   installed    every command found and an install log exists: an earlier
 *                sweep's background install finished. State dir removed.
 *   running      an earlier sweep's background install is still going.
 *   started      background install launched for the listed commands. If an
 *                earlier attempt left them missing, the tail of its log is
 *                printed before the result line (the retry's `detail`).
 *   no-root      missing, and no root / passwordless sudo.
 *   unsupported  missing, and no rpm-ostree / apt-get / dnf.
 *
 * Installer choice: rpm-ostree --apply-live on image-based Fedora
 * (/run/ostree-booted; requests only the packages whose commands are missing,
 * since rpm-ostree refuses one the base image already ships), else apt-get
 * (after `apt-get update`, waiting out a held dpkg lock), else dnf.
 *
 * Remote hosts only: on the distributor's own box the container can't install
 * host packages, and agent-desktop's own first-use install covers it.
 */

/** Prefix of the single result line the remote script prints last. */
export const DESKTOP_DEPS_SENTINEL = "__DESKTOP_DEPS__";

export const DESKTOP_DEPS_CMD = `sh <<'__DESKTOP_DEPS_EOF__'
${String.raw`missing() {
  out=""
  for c in Xvnc vncpasswd openbox xdotool import; do
    command -v "$c" >/dev/null 2>&1 || out="$out $c"
  done
  printf '%s' "$out"
}
D="$HOME/.cache/fleet-desktop-deps"
LOG="$D/install.log"
PIDF="$D/install.pid"
M="$(missing)"
if [ -f "$PIDF" ] && [ -d "/proc/$(cat "$PIDF")" ]; then echo "__DESKTOP_DEPS__ running$M"; exit 0; fi
if [ -z "$M" ]; then
  if [ -f "$LOG" ]; then rm -rf "$D"; echo "__DESKTOP_DEPS__ installed"; else echo "__DESKTOP_DEPS__ present"; fi
  exit 0
fi
if [ "$(id -u)" = 0 ]; then SUDO=""
elif sudo -n true 2>/dev/null; then SUDO="sudo -n"
else echo "__DESKTOP_DEPS__ no-root$M"; exit 0; fi
if [ -e /run/ostree-booted ] && command -v rpm-ostree >/dev/null 2>&1; then
  PKGS=""
  for c in $M; do
    case "$c" in
      Xvnc|vncpasswd) p=tigervnc-server ;;
      openbox) p=openbox ;;
      xdotool) p=xdotool ;;
      import) p=ImageMagick ;;
    esac
    case " $PKGS " in *" $p "*) ;; *) PKGS="$PKGS $p" ;; esac
  done
  command -v xsetroot >/dev/null 2>&1 || PKGS="$PKGS xsetroot"
  INSTALL="rpm-ostree install --idempotent --apply-live$PKGS"
elif command -v apt-get >/dev/null 2>&1; then
  INSTALL="export DEBIAN_FRONTEND=noninteractive; apt-get update -q; apt-get install -y -q -o DPkg::Lock::Timeout=600 --no-install-recommends tigervnc-standalone-server tigervnc-tools openbox xdotool imagemagick x11-xserver-utils"
elif command -v dnf >/dev/null 2>&1; then
  INSTALL="dnf install -y -q tigervnc-server openbox xdotool ImageMagick xsetroot"
else
  echo "__DESKTOP_DEPS__ unsupported$M"; exit 0
fi
[ -f "$LOG" ] && tail -n 5 "$LOG"
mkdir -p "$D" || { echo "__DESKTOP_DEPS__ no-state-dir$M"; exit 0; }
setsid nohup $SUDO sh -c "$INSTALL" </dev/null >"$LOG" 2>&1 &
echo $! >"$PIDF"
echo "__DESKTOP_DEPS__ started$M"`}
__DESKTOP_DEPS_EOF__`;

export type DesktopDepsStatus =
  | "present"
  | "installed"
  | "running"
  | "started"
  | "no-root"
  | "unsupported";

export interface DesktopDepsOutcome {
  status: DesktopDepsStatus;
  /** Commands still missing (empty for present / installed). */
  missing: string[];
  /** For `started`: tail of the previous failed attempt's log, else "". */
  detail: string;
}

const STATUSES: ReadonlySet<string> = new Set<DesktopDepsStatus>([
  "present",
  "installed",
  "running",
  "started",
  "no-root",
  "unsupported",
]);

/**
 * Parse the script's output. The result line is the last line; anything
 * before it becomes `detail`. Returns null when no recognised result line is
 * present (channel/shell failure, or the state dir couldn't be created).
 */
export function parseDesktopDepsOutput(raw: string): DesktopDepsOutcome | null {
  const lines = raw.trimEnd().split("\n");
  const last = lines[lines.length - 1] ?? "";
  if (!last.startsWith(`${DESKTOP_DEPS_SENTINEL} `)) return null;
  const [status, ...missing] = last.slice(DESKTOP_DEPS_SENTINEL.length + 1).trim().split(/\s+/);
  if (!STATUSES.has(status)) return null;
  return {
    status: status as DesktopDepsStatus,
    missing,
    detail: lines.slice(0, -1).join("\n").slice(-500),
  };
}
