/**
 * Unified-diff parser for the .diff / .patch viewer.
 *
 * Handles `git diff` / `git format-patch` output (file headers, new /
 * deleted / renamed / binary markers) and plain `diff -u` output. Anything
 * outside a file section — format-patch mail headers, the commit message,
 * the diffstat — is ignored.
 *
 * Hunk bodies are consumed by the line budget in their `@@` header, so a
 * removed line whose text starts with "-- " can't be mistaken for the next
 * file's `--- a/...` header.
 */

export type DiffLineKind = "add" | "del" | "ctx" | "note";

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export type DiffFileStatus = "modified" | "added" | "deleted" | "renamed" | "binary";

export interface DiffFile {
  oldPath: string | null;
  newPath: string | null;
  status: DiffFileStatus;
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface ParsedPatch {
  files: DiffFile[];
  additions: number;
  deletions: number;
  /** +/- lines left over after a hunk's stated counts ran out (not shown). */
  stray?: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const GIT_HEADER_RE = /^diff --git (?:"?a\/(.+?)"?) (?:"?b\/(.+?)"?)$/;

/** Strip the a/ b/ prefix and any tab-separated timestamp; /dev/null → null. */
function cleanPath(raw: string): string | null {
  const p = raw.split("\t")[0].trim().replace(/^"(.*)"$/, "$1");
  if (p === "/dev/null") return null;
  return p.replace(/^[ab]\//, "");
}

function newFile(): DiffFile {
  return { oldPath: null, newPath: null, status: "modified", additions: 0, deletions: 0, hunks: [] };
}

export function parsePatch(text: string): ParsedPatch {
  const lines = text.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo = 0;
  let newNo = 0;
  let oldLeft = 0;
  let newLeft = 0;
  let stray = 0;

  const startFile = (): DiffFile => {
    file = newFile();
    files.push(file);
    hunk = null;
    return file;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Inside a hunk: consume body lines until both budgets are spent.
    if (hunk && (oldLeft > 0 || newLeft > 0)) {
      const h: DiffHunk = hunk;
      const f = file as DiffFile | null;
      const mark = line[0];
      if (mark === "+") {
        h.lines.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: newNo++ });
        newLeft--;
        if (f) f.additions++;
        continue;
      }
      if (mark === "-") {
        h.lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo++, newNo: null });
        oldLeft--;
        if (f) f.deletions++;
        continue;
      }
      if (mark === " " || line === "") {
        // Some tools strip the leading space from blank context lines.
        h.lines.push({ kind: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
        oldLeft--;
        newLeft--;
        continue;
      }
      if (mark === "\\") {
        h.lines.push({ kind: "note", text: line.slice(1).trim(), oldNo: null, newNo: null });
        continue;
      }
      // Malformed hunk (budget overstated): fall through to header parsing.
      oldLeft = 0;
      newLeft = 0;
    }
    if (hunk && line.startsWith("\\")) {
      // "\ No newline at end of file" right after a hunk's last line.
      (hunk as DiffHunk).lines.push({ kind: "note", text: line.slice(1).trim(), oldNo: null, newNo: null });
      continue;
    }

    const git = GIT_HEADER_RE.exec(line);
    if (git) {
      const f = startFile();
      f.oldPath = git[1];
      f.newPath = git[2];
      continue;
    }

    if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      // Plain unified diffs have no `diff --git` line; a ---/+++ pair after
      // a file that already has hunks starts the next file.
      let f = file as DiffFile | null;
      if (!f || f.hunks.length > 0) f = startFile();
      const oldPath = cleanPath(line.slice(4));
      const newPath = cleanPath(lines[i + 1].slice(4));
      // /dev/null on one side marks an added / deleted file.
      f.oldPath = oldPath;
      f.newPath = newPath;
      if (oldPath === null) f.status = "added";
      else if (newPath === null) f.status = "deleted";
      i++;
      continue;
    }

    const hm = HUNK_RE.exec(line);
    if (hm) {
      const f = (file as DiffFile | null) ?? startFile();
      oldNo = Number(hm[1]);
      newNo = Number(hm[3]);
      oldLeft = hm[2] === undefined ? 1 : Number(hm[2]);
      newLeft = hm[4] === undefined ? 1 : Number(hm[4]);
      hunk = { header: line, lines: [] };
      f.hunks.push(hunk);
      continue;
    }

    if (hunk && (line[0] === "+" || line[0] === "-")) stray++;
    const f = file as DiffFile | null;
    if (!f) continue;
    if (line.startsWith("new file mode")) {
      f.status = "added";
      f.oldPath = null;
    } else if (line.startsWith("deleted file mode")) {
      f.status = "deleted";
      f.newPath = null;
    } else if (line.startsWith("rename from ")) {
      f.status = "renamed";
      f.oldPath = line.slice("rename from ".length);
    } else if (line.startsWith("rename to ")) {
      f.status = "renamed";
      f.newPath = line.slice("rename to ".length);
    } else if (line.startsWith("Binary files ") || line === "GIT binary patch") {
      f.status = "binary";
    }
  }

  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { files, additions, deletions, stray };
}

/**
 * Diff for a ```diff code block in a chat bubble. Agents hand-write these,
 * so `@@` counts can't be trusted: the body is read leniently — `---`/`+++`
 * pairs start a file, any `@@` line starts a hunk (numbered when it carries
 * numbers), and +/-/space lines are rows. A real git patch whose metadata
 * lines (index, mode, …) the lenient pass can't place still parses via
 * parsePatch, as long as that accounts for every changed line. Null when the
 * text doesn't read as a diff, so the caller falls back to a plain block.
 */
export function parseChatDiff(text: string): ParsedPatch | null {
  const body = text.replace(/\n$/, "");
  const lenient = parseLenient(body);
  if (lenient) return lenient.additions + lenient.deletions > 0 ? lenient : null;
  const strict = parsePatch(body);
  if (!strict.files.some((f) => f.hunks.length > 0)) return null;
  // Stated hunk counts that hid changed lines: show it as plain text instead.
  return strict.stray ? null : strict;
}

/** Hand-written diff body; null on any line that isn't diff-shaped. */
function parseLenient(body: string): ParsedPatch | null {
  const lines = body.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldNo: number | null = null;
  let newNo: number | null = null;

  const ensureHunk = (header: string): DiffHunk => {
    if (!file) {
      file = newFile();
      files.push(file);
    }
    const h: DiffHunk = { header, lines: [] };
    file.hunks.push(h);
    hunk = h;
    return h;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      const f: DiffFile = newFile();
      f.oldPath = cleanPath(line.slice(4));
      f.newPath = cleanPath(lines[i + 1].slice(4));
      if (f.oldPath === null) f.status = "added";
      else if (f.newPath === null) f.status = "deleted";
      files.push(f);
      file = f;
      hunk = null;
      oldNo = newNo = null;
      i++;
      continue;
    }
    if (line.startsWith("@@")) {
      const hm = HUNK_RE.exec(line);
      oldNo = hm ? Number(hm[1]) : null;
      newNo = hm ? Number(hm[3]) : null;
      ensureHunk(line);
      continue;
    }
    const mark = line[0];
    const h: DiffHunk = hunk ?? ensureHunk("");
    const f = file as DiffFile | null;
    if (mark === "+") {
      h.lines.push({ kind: "add", text: line.slice(1), oldNo: null, newNo: newNo === null ? null : newNo++ });
      if (f) f.additions++;
    } else if (mark === "-") {
      h.lines.push({ kind: "del", text: line.slice(1), oldNo: oldNo === null ? null : oldNo++, newNo: null });
      if (f) f.deletions++;
    } else if (mark === " " || line === "") {
      h.lines.push({
        kind: "ctx",
        text: line.slice(1),
        oldNo: oldNo === null ? null : oldNo++,
        newNo: newNo === null ? null : newNo++,
      });
    } else if (mark === "\\") {
      h.lines.push({ kind: "note", text: line.slice(1).trim(), oldNo: null, newNo: null });
    } else {
      return null;
    }
  }

  let additions = 0;
  let deletions = 0;
  for (const f of files) {
    additions += f.additions;
    deletions += f.deletions;
  }
  return { files, additions, deletions };
}

/** Path to show for a file: the new path, the old one for deletions, "old → new" for renames. */
export function displayPath(file: DiffFile): string {
  if (file.status === "renamed" && file.oldPath && file.newPath && file.oldPath !== file.newPath) {
    return `${file.oldPath} → ${file.newPath}`;
  }
  return file.newPath ?? file.oldPath ?? "(unknown file)";
}

export interface SplitRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

/**
 * Side-by-side rows for a hunk: context lines sit on both sides; a run of
 * removals followed by a run of additions is paired row by row.
 */
export function toSplitRows(hunk: DiffHunk): SplitRow[] {
  const rows: SplitRow[] = [];
  const { lines } = hunk;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.kind === "ctx" || line.kind === "note") {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < lines.length && lines[i].kind === "del") dels.push(lines[i++]);
    while (i < lines.length && lines[i].kind === "add") adds.push(lines[i++]);
    const n = Math.max(dels.length, adds.length);
    for (let k = 0; k < n; k++) rows.push({ left: dels[k] ?? null, right: adds[k] ?? null });
  }
  return rows;
}
