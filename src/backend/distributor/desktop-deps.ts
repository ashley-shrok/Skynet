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
 * DESKTOP_DEPS_CMD is one `sh` heredoc, sent once per host per sweep:
 *   - Every command present → prints `present`, nothing else happens. This is
 *     the steady state: five `command -v` probes.
 *   - Missing + no root/NOPASSWD sudo → `no-root`.
 *   - Image-based Fedora (/run/ostree-booted) → `rpm-ostree install
 *     --idempotent --apply-live`, requesting only the packages whose commands
 *     are missing (rpm-ostree refuses a package the base image already ships).
 *   - Otherwise apt-get, then dnf. Neither → `unsupported`.
 *   - Re-probes afterwards: `installed`, or `failed` with the still-missing
 *     commands and the tail of the installer's output.
 *   Each installer run is capped by `timeout` so one slow host can't stall the
 *   serial sweep indefinitely.
 *
 * Remote hosts only: on the distributor's own box the container can't install
 * host packages, and agent-desktop's own first-use install covers it.
 */

/** Prefix of the single result line the remote script prints last. */
export const DESKTOP_DEPS_SENTINEL = "__DESKTOP_DEPS__";

/** Seconds each installer invocation may run before it is killed. */
export const DESKTOP_DEPS_INSTALL_TIMEOUT_S = 600;

export const DESKTOP_DEPS_CMD = `sh <<'__DESKTOP_DEPS_EOF__'
${String.raw`missing() {
  out=""
  for c in Xvnc vncpasswd openbox xdotool import; do
    command -v "$c" >/dev/null 2>&1 || out="$out $c"
  done
  printf '%s' "$out"
}
M="$(missing)"
if [ -z "$M" ]; then echo "__DESKTOP_DEPS__ present"; exit 0; fi
if [ "$(id -u)" = 0 ]; then SUDO=""
elif sudo -n true 2>/dev/null; then SUDO="sudo -n"
else echo "__DESKTOP_DEPS__ no-root$M"; exit 0; fi
LOG="$(mktemp 2>/dev/null || echo /tmp/desktop-deps.$$.log)"
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
  $SUDO timeout ${DESKTOP_DEPS_INSTALL_TIMEOUT_S} rpm-ostree install --idempotent --apply-live $PKGS >"$LOG" 2>&1
elif command -v apt-get >/dev/null 2>&1; then
  $SUDO env DEBIAN_FRONTEND=noninteractive timeout ${DESKTOP_DEPS_INSTALL_TIMEOUT_S} apt-get install -y -q --no-install-recommends \
    tigervnc-standalone-server tigervnc-tools openbox xdotool imagemagick x11-xserver-utils >"$LOG" 2>&1
elif command -v dnf >/dev/null 2>&1; then
  $SUDO timeout ${DESKTOP_DEPS_INSTALL_TIMEOUT_S} dnf install -y -q tigervnc-server openbox xdotool ImageMagick xsetroot >"$LOG" 2>&1
else
  rm -f "$LOG"; echo "__DESKTOP_DEPS__ unsupported$M"; exit 0
fi
M2="$(missing)"
if [ -z "$M2" ]; then rm -f "$LOG"; echo "__DESKTOP_DEPS__ installed$M"; exit 0; fi
tail -n 5 "$LOG" 2>/dev/null; rm -f "$LOG"
echo "__DESKTOP_DEPS__ failed$M2"`}
__DESKTOP_DEPS_EOF__`;

export type DesktopDepsOutcome =
  | { status: "present" }
  | { status: "installed" | "no-root" | "unsupported"; missing: string[] }
  | { status: "failed"; missing: string[]; detail: string };

/**
 * Parse the script's output. The result line is the last line; for `failed`,
 * the installer-output tail printed before it becomes `detail`. Returns null
 * when no result line is present (channel/shell failure).
 */
export function parseDesktopDepsOutput(raw: string): DesktopDepsOutcome | null {
  const lines = raw.trimEnd().split("\n");
  const last = lines[lines.length - 1] ?? "";
  if (!last.startsWith(`${DESKTOP_DEPS_SENTINEL} `)) return null;
  const [status, ...missing] = last.slice(DESKTOP_DEPS_SENTINEL.length + 1).trim().split(/\s+/);
  switch (status) {
    case "present":
      return { status };
    case "installed":
    case "no-root":
    case "unsupported":
      return { status, missing };
    case "failed":
      return { status, missing, detail: lines.slice(0, -1).join("\n").slice(-500) };
    default:
      return null;
  }
}
