/**
 * instance-wide/host-ops.ts — shell operations on one machine's copies of
 * instance-wide items, over the SshChannel interface (SSH for remote hosts, a
 * local bash child for the co-located host). All paths are relative to the
 * channel user's $HOME, so the same commands work on both.
 *
 * Binary-safe: file bodies go down via stdin and come back base64-encoded.
 * Permission bits travel with each file (credential files stay 0600, scripts
 * stay executable); bodies are written under umask 077 so nothing is ever
 * briefly world-readable.
 *
 * Containment: every operation first resolves the item folder and refuses
 * unless it sits inside the real $HOME, and every file path is re-checked to
 * stay inside the item folder — a symlinked folder or file can never steer a
 * read, write or delete elsewhere (on the co-located host the shell runs in
 * the app container, next to the app's own data).
 *
 * When the command runs as root (the co-located host's container, or a root
 * SSH login) the item folder is re-owned to whoever owns $HOME afterwards, so
 * agents can keep editing natively.
 */
import type { SshChannel } from "../fleet-status/ssh-poll-orchestrator.js";
import type { Manifest } from "./model.js";

const EXEC_TIMEOUT_MS = 60_000;
/** Keep each command well under the remote argv cap (~128 KB). */
const MAX_PATHS_PER_COMMAND = 200;

export function shq(s: string): string {
  return `'${s.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Shell prelude: `iw_dir <rel>` sets $D to the real path of an item folder
 * inside $HOME (fails otherwise); `iw_in <path>` succeeds only when the path
 * (resolved, symlinks followed) stays inside $D.
 */
const PRELUDE =
  `H=$(realpath -- "$HOME") || exit 1; ` +
  `iw_dir() { case "$1" in /*|..|../*|*/../*|*/..) return 1;; esac; ` +
  `[ -L "$H/$1" ] && return 1; D=$(realpath -m -- "$H/$1") || return 1; ` +
  `case "$D" in "$H"/*) return 0;; *) return 1;; esac; }; ` +
  `iw_in() { local r; r=$(realpath -m -- "$1") || return 1; ` +
  `case "$r" in "$D"/*) return 0;; *) return 1;; esac; }; `;

async function run(ch: SshChannel, cmd: string, stdin?: Buffer): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      ch.exec(PRELUDE + cmd, stdin),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), EXEC_TIMEOUT_MS);
      }),
    ]);
    if (out === null) throw new Error(`host command failed: ${cmd.slice(0, 60)}`);
    return out;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function expectOk(out: string, what: string): void {
  if (!out.split("\n").includes("OK")) {
    throw new Error(`${what} failed${out.includes("UNSAFE") ? " (path leaves the item folder)" : ""}`);
  }
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Folders never synced (see model.ts ignore rules) are not even walked. */
const PRUNE = `\\( -name .git -o -name node_modules -o -name __pycache__ -o -name .cache \\) -prune -o`;

export interface HostFolderProbe {
  /** null when the folder does not exist on the machine. */
  manifest: Manifest | null;
  /** path → size in bytes (same keys as manifest). */
  sizes: Record<string, number>;
  /** path → permission bits, e.g. 0o600 (same keys as manifest). */
  modes: Record<string, number>;
  /** The folder exists but is not safely inside $HOME (e.g. a symlink). */
  unsafe?: boolean;
}

/**
 * Hash every regular file in each folder. One round trip for any number of
 * folders. Symlinks are never followed (find without -L skips symlinked
 * folders and files); paths sha256sum has to escape are skipped.
 */
export async function probeFolders(
  ch: SshChannel,
  relDirs: string[],
): Promise<Map<string, HostFolderProbe>> {
  const result = new Map<string, HostFolderProbe>();
  if (relDirs.length === 0) return result;
  const script =
    `for d in ${relDirs.map(shq).join(" ")}; do ` +
    `if [ ! -e "$H/$d" ] && [ ! -L "$H/$d" ]; then printf '@M %s\\n' "$d"; ` +
    `elif ! iw_dir "$d" || [ ! -d "$D" ]; then printf '@U %s\\n' "$d"; ` +
    `else printf '@D %s\\n' "$d"; ` +
    `( cd "$D" && find . ${PRUNE} -type f -printf 'S %s %m\\t%P\\n' 2>/dev/null; ` +
    `find . ${PRUNE} -type f -print0 2>/dev/null | xargs -0 -r sha256sum 2>/dev/null | sed 's/^/H /' ); ` +
    `fi; done; echo '@END'`;
  const out = await run(ch, script);
  if (!out.endsWith("@END")) throw new Error("folder probe output truncated");

  let current: HostFolderProbe | null = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("@D ")) {
      current = { manifest: {}, sizes: {}, modes: {} };
      result.set(line.slice(3), current);
    } else if (line.startsWith("@M ")) {
      current = null;
      result.set(line.slice(3), { manifest: null, sizes: {}, modes: {} });
    } else if (line.startsWith("@U ")) {
      current = null;
      result.set(line.slice(3), { manifest: {}, sizes: {}, modes: {}, unsafe: true });
    } else if (current && line.startsWith("S ")) {
      const m = /^S (\d+) ([0-7]+)\t(.+)$/.exec(line);
      if (!m) continue;
      current.sizes[m[3]] = parseInt(m[1], 10);
      current.modes[m[3]] = parseInt(m[2], 8);
    } else if (current && line.startsWith("H ")) {
      // "H <64 hex>  ./<path>"
      const m = /^H ([0-9a-f]{64}) {2}\.\/(.+)$/.exec(line);
      if (m && current.manifest) current.manifest[m[2]] = m[1];
    }
  }
  // Drop size/mode entries for paths that could not be hashed.
  for (const probe of result.values()) {
    if (!probe.manifest) continue;
    for (const p of Object.keys(probe.sizes)) {
      if (!(p in probe.manifest)) {
        delete probe.sizes[p];
        delete probe.modes[p];
      }
    }
  }
  return result;
}

/** Which of these folders exist on the machine. */
export async function existingFolders(ch: SshChannel, relDirs: string[]): Promise<Set<string>> {
  if (relDirs.length === 0) return new Set();
  const out = await run(
    ch,
    `for d in ${relDirs.map(shq).join(" ")}; do ` +
      `{ [ -e "$H/$d" ] || [ -L "$H/$d" ]; } && printf '%s\\n' "$d"; done; echo '@END'`,
  );
  return new Set(out.split("\n").filter((l) => l && l !== "@END"));
}

/** Read files; throws if any one of them can't be read (never yields empty bytes). */
export async function readFiles(
  ch: SshChannel,
  relDir: string,
  paths: string[],
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const batch of chunk(paths, MAX_PATHS_PER_COMMAND)) {
    const out = await run(
      ch,
      `iw_dir ${shq(relDir)} || { echo UNSAFE; exit 1; }; cd "$D" || exit 1; ` +
        `for f in ${batch.map(shq).join(" ")}; do ` +
        `if [ -f "$f" ] && [ ! -L "$f" ] && iw_in "$f" && b=$(base64 -w0 -- "$f"); then ` +
        `printf '@F %s\\n%s\\n' "$f" "$b"; else printf '@X %s\\n' "$f"; fi; done; echo '@END'`,
    );
    if (!out.endsWith("@END")) throw new Error(`could not read files in ${relDir}`);
    const lines = out.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith("@X ")) throw new Error(`could not read ${relDir}/${lines[i].slice(3)}`);
      if (!lines[i].startsWith("@F ")) continue;
      files.set(lines[i].slice(3), Buffer.from(lines[i + 1] ?? "", "base64"));
      i++;
    }
  }
  for (const p of paths) {
    if (!files.has(p)) throw new Error(`could not read ${relDir}/${p}`);
  }
  return files;
}

export async function writeFile(
  ch: SshChannel,
  relDir: string,
  rel: string,
  bytes: Buffer,
  mode: number,
): Promise<void> {
  const octal = (mode & 0o7777).toString(8);
  const out = await run(
    ch,
    `umask 077; iw_dir ${shq(relDir)} && mkdir -p -- "$D" && iw_dir ${shq(relDir)} || { echo UNSAFE; exit 1; }; ` +
      `f="$D"/${shq(rel)}; p=$(dirname -- "$f"); ` +
      `mkdir -p -- "$p" && iw_in "$p/x" || { echo UNSAFE; exit 1; }; ` +
      `[ -L "$f" ] && rm -f -- "$f"; ` +
      `t=$(mktemp -- "$p/.iw-XXXXXX") && cat > "$t" && chmod ${octal} -- "$t" && mv -f -T -- "$t" "$f" && echo OK || { rm -f -- "$t"; exit 1; }`,
    bytes,
  );
  expectOk(out, `writing ${relDir}/${rel}`);
}

export async function deleteFiles(ch: SshChannel, relDir: string, paths: string[]): Promise<void> {
  for (const batch of chunk(paths, MAX_PATHS_PER_COMMAND)) {
    const out = await run(
      ch,
      `iw_dir ${shq(relDir)} || { echo UNSAFE; exit 1; }; cd "$D" || exit 1; ` +
        `for f in ${batch.map(shq).join(" ")}; do iw_in "$(dirname -- "$f")/x" || { echo UNSAFE; exit 1; }; done; ` +
        `rm -f -- ${batch.map(shq).join(" ")} && { find . -mindepth 1 -type d -empty -delete 2>/dev/null; echo OK; }`,
    );
    expectOk(out, `deleting files in ${relDir}`);
  }
}

/** Copy a file aside under its conflict name (before it gets overwritten). */
export async function setAside(
  ch: SshChannel,
  relDir: string,
  rel: string,
  asideRel: string,
): Promise<void> {
  const out = await run(
    ch,
    `iw_dir ${shq(relDir)} || { echo UNSAFE; exit 1; }; cd "$D" || exit 1; ` +
      `[ -f ${shq(rel)} ] && [ ! -L ${shq(rel)} ] && iw_in ${shq(rel)} && iw_in ${shq(asideRel)} || { echo UNSAFE; exit 1; }; ` +
      `cp -p -- ${shq(rel)} ${shq(asideRel)} && echo OK`,
  );
  expectOk(out, `setting aside ${relDir}/${rel}`);
}

/** Remove an item folder (a symlink in its place is removed, never followed). */
export async function removeFolder(ch: SshChannel, relDir: string): Promise<void> {
  const out = await run(
    ch,
    `if [ -L "$H"/${shq(relDir)} ]; then rm -f -- "$H"/${shq(relDir)} && echo OK; ` +
      `elif [ ! -e "$H"/${shq(relDir)} ]; then echo OK; ` +
      `else iw_dir ${shq(relDir)} || { echo UNSAFE; exit 1; }; rm -rf -- "$D" && echo OK; fi`,
  );
  expectOk(out, `removing ${relDir}`);
}

/** When running as root, hand the folder back to the owner of $HOME. */
export async function fixOwnership(ch: SshChannel, relDir: string): Promise<void> {
  await run(
    ch,
    `iw_dir ${shq(relDir)} || exit 0; if [ "$(id -u)" = 0 ] && [ -d "$D" ]; then ` +
      `o=$(stat -c '%u:%g' "$H"); [ "$o" != "0:0" ] && chown -R -P "$o" -- "$D" 2>/dev/null; ` +
      `chown "$o" -- "$(dirname -- "$D")" 2>/dev/null; fi; echo OK`,
  );
}
