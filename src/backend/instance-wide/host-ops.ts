/**
 * instance-wide/host-ops.ts — shell operations on one machine's copies of
 * instance-wide items, over the SshChannel interface (SSH for remote hosts, a
 * local bash child for the co-located host). All paths are relative to the
 * channel user's $HOME, so the same commands work on both.
 *
 * Binary-safe: file bodies go down via stdin and come back base64-encoded.
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

async function run(ch: SshChannel, cmd: string, stdin?: Buffer): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const out = await Promise.race([
      ch.exec(cmd, stdin),
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

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export interface HostFolderProbe {
  /** null when the folder does not exist on the machine. */
  manifest: Manifest | null;
  /** path → size in bytes (same keys as manifest). */
  sizes: Record<string, number>;
}

/**
 * Hash every file in each folder. One round trip for any number of folders.
 * Paths that sha256sum has to escape (backslash, newline) are skipped.
 */
export async function probeFolders(
  ch: SshChannel,
  relDirs: string[],
): Promise<Map<string, HostFolderProbe>> {
  const result = new Map<string, HostFolderProbe>();
  if (relDirs.length === 0) return result;
  const script =
    `cd "$HOME" || exit 1; ` +
    `for d in ${relDirs.map(shq).join(" ")}; do ` +
    `if [ -d "$d" ]; then printf '@D %s\\n' "$d"; ` +
    `( cd "$d" && find . -type f -printf 'S %s\\t%P\\n' 2>/dev/null; ` +
    `find . -type f -print0 2>/dev/null | xargs -0 -r sha256sum 2>/dev/null | sed 's/^/H /' ); ` +
    `else printf '@M %s\\n' "$d"; fi; done; echo '@END'`;
  const out = await run(ch, script);
  if (!out.endsWith("@END")) throw new Error("folder probe output truncated");

  let current: HostFolderProbe | null = null;
  for (const line of out.split("\n")) {
    if (line.startsWith("@D ")) {
      current = { manifest: {}, sizes: {} };
      result.set(line.slice(3), current);
    } else if (line.startsWith("@M ")) {
      current = null;
      result.set(line.slice(3), { manifest: null, sizes: {} });
    } else if (current && line.startsWith("S ")) {
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      const size = parseInt(line.slice(2, tab), 10);
      current.sizes[line.slice(tab + 1)] = Number.isFinite(size) ? size : 0;
    } else if (current && line.startsWith("H ")) {
      // "H <64 hex>  ./<path>"
      const m = /^H ([0-9a-f]{64}) {2}\.\/(.+)$/.exec(line);
      if (m && current.manifest) current.manifest[m[2]] = m[1];
    }
  }
  // Drop size entries for paths that could not be hashed.
  for (const probe of result.values()) {
    if (!probe.manifest) continue;
    for (const p of Object.keys(probe.sizes)) {
      if (!(p in probe.manifest)) delete probe.sizes[p];
    }
  }
  return result;
}

/** Which of these folders exist on the machine. */
export async function existingFolders(ch: SshChannel, relDirs: string[]): Promise<Set<string>> {
  if (relDirs.length === 0) return new Set();
  const out = await run(
    ch,
    `cd "$HOME" || exit 1; for d in ${relDirs.map(shq).join(" ")}; do ` +
      `[ -d "$d" ] && printf '%s\\n' "$d"; done; echo '@END'`,
  );
  return new Set(out.split("\n").filter((l) => l && l !== "@END"));
}

export async function readFiles(
  ch: SshChannel,
  relDir: string,
  paths: string[],
): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  for (const batch of chunk(paths, MAX_PATHS_PER_COMMAND)) {
    const out = await run(
      ch,
      `cd "$HOME"/${shq(relDir)} || exit 1; for f in ${batch.map(shq).join(" ")}; do ` +
        `printf '@F %s\\n' "$f"; base64 -w0 -- "$f" 2>/dev/null; printf '\\n'; done; echo '@END'`,
    );
    const lines = out.split("\n");
    for (let i = 0; i < lines.length; i++) {
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
): Promise<void> {
  const target = `${relDir}/${rel}`;
  await run(
    ch,
    `cd "$HOME" || exit 1; f=${shq(target)}; ` +
      `mkdir -p -- "$(dirname -- "$f")" && cat > "$f.iw-tmp" && mv -f -- "$f.iw-tmp" "$f" && echo OK`,
    bytes,
  );
}

export async function deleteFiles(ch: SshChannel, relDir: string, paths: string[]): Promise<void> {
  for (const batch of chunk(paths, MAX_PATHS_PER_COMMAND)) {
    await run(
      ch,
      `cd "$HOME"/${shq(relDir)} || exit 1; rm -f -- ${batch.map(shq).join(" ")}; ` +
        `find . -mindepth 1 -type d -empty -delete 2>/dev/null; echo OK`,
    );
  }
}

/** Copy a file aside under its conflict name (before it gets overwritten). */
export async function setAside(
  ch: SshChannel,
  relDir: string,
  rel: string,
  asideRel: string,
): Promise<void> {
  await run(
    ch,
    `cd "$HOME"/${shq(relDir)} || exit 1; cp -p -- ${shq(rel)} ${shq(asideRel)} && echo OK`,
  );
}

export async function removeFolder(ch: SshChannel, relDir: string): Promise<void> {
  await run(ch, `cd "$HOME" || exit 1; rm -rf -- ${shq(relDir)}; echo OK`);
}

/** When running as root, hand the folder back to the owner of $HOME. */
export async function fixOwnership(ch: SshChannel, relDir: string): Promise<void> {
  await run(
    ch,
    `cd "$HOME" || exit 1; if [ "$(id -u)" = 0 ] && [ -d ${shq(relDir)} ]; then ` +
      `o=$(stat -c '%u:%g' "$HOME"); [ "$o" != "0:0" ] && chown -R "$o" -- ${shq(relDir)} 2>/dev/null; fi; echo OK`,
  );
}
