// Splits a unified git patch (as the /workspace/git/diff route returns it)
// into one section per file, so a commit can list its files and a single
// changed file can show just its own diff.

export type PatchFile = {
  /** The file's path after the change (its old path when it was deleted). */
  path: string;
  /** Set when the file was renamed. */
  oldPath: string | null;
  added: number;
  removed: number;
  /** This file's part of the patch, starting at its `diff --git` line. */
  patch: string;
};

/** Unquote a path git wrote in C-style quotes ("a/x y" → a/x y). */
function unquote(p: string): string {
  if (!(p.startsWith('"') && p.endsWith('"'))) return p;
  return p.slice(1, -1).replace(/\\(["\\])/g, "$1").replace(/\\t/g, "\t").replace(/\\n/g, "\n");
}

/** A ---/+++ path: git ends it with a tab when it has spaces; drop that and the a/ or b/ side. */
function stripSide(p: string): string {
  const u = unquote(p.replace(/\t+$/, ""));
  return u.replace(/^[ab]\//, "");
}

export function splitPatch(patch: string): PatchFile[] {
  const out: PatchFile[] = [];
  const lines = patch.split("\n");
  let cur: { lines: string[] } | null = null;
  const flush = (): void => {
    if (!cur) return;
    let plus: string | null = null;
    let minus: string | null = null;
    let renameFrom: string | null = null;
    let renameTo: string | null = null;
    let added = 0;
    let removed = 0;
    let inHunk = false;
    for (const l of cur.lines) {
      if (!inHunk) {
        if (l.startsWith("+++ ")) plus = l.slice(4);
        else if (l.startsWith("--- ")) minus = l.slice(4);
        else if (l.startsWith("rename from ")) renameFrom = l.slice(12);
        else if (l.startsWith("rename to ")) renameTo = l.slice(10);
        else if (l.startsWith("@@")) inHunk = true;
        continue;
      }
      if (l.startsWith("+")) added++;
      else if (l.startsWith("-")) removed++;
    }
    const header = cur.lines[0].slice("diff --git ".length);
    // Fallback for diffs with no ---/+++ lines (binary, mode-only): the
    // header's second half. Paths with " b/" inside are rare enough here.
    const headerPath = header.includes(" b/") ? header.slice(header.lastIndexOf(" b/") + 1) : header;
    const newSide = plus && plus.trim() !== "/dev/null" ? plus : null;
    const oldSide = minus && minus.trim() !== "/dev/null" ? minus : null;
    // rename from/to lines carry no a/ b/ side, so only unquote them.
    const path = renameTo !== null ? unquote(renameTo) : stripSide(newSide ?? oldSide ?? headerPath);
    out.push({
      path,
      oldPath: renameFrom !== null ? unquote(renameFrom) : null,
      added,
      removed,
      patch: cur.lines.join("\n").replace(/\n+$/, "") + "\n",
    });
    cur = null;
  };
  for (const l of lines) {
    if (l.startsWith("diff --git ")) {
      flush();
      cur = { lines: [l] };
    } else if (cur) {
      cur.lines.push(l);
    }
  }
  flush();
  return out;
}
