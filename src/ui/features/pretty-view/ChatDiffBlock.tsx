import { Fragment, useState } from "react";
import { CopyableBlock } from "./CopyableBlock";
import { UnifiedHunkRows } from "./file-viewers/diff/DiffView";
import {
  displayPath,
  parseChatDiff,
  type DiffFile,
  type ParsedPatch,
} from "./file-viewers/diff/parse-diff";

/**
 * A ```diff / ```patch code block in a chat bubble, drawn with the .diff
 * file viewer's red/green rows (unified only — bubbles are narrow). A long
 * diff folds to its first FOLDED_LINES lines behind a "Show all" toggle.
 * Copy puts the original block text on the clipboard.
 */

/** Diffs longer than this fold. */
const FOLD_OVER_LINES = 16;
const FOLDED_LINES = 12;

function lineCount(files: DiffFile[]): number {
  return files.reduce((n, f) => n + f.hunks.reduce((m, h) => m + h.lines.length, 0), 0);
}

/** The first `budget` lines of the patch, keeping file and hunk boundaries. */
function truncate(files: DiffFile[], budget: number): DiffFile[] {
  const out: DiffFile[] = [];
  let left = budget;
  for (const f of files) {
    if (left <= 0) break;
    const hunks = [];
    for (const h of f.hunks) {
      if (left <= 0) break;
      hunks.push({ ...h, lines: h.lines.slice(0, left) });
      left -= h.lines.length;
    }
    out.push({ ...f, hunks });
  }
  return out;
}

const DIFF_LANGS = new Set(["language-diff", "language-patch"]);

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function hastText(n: HastNode): string {
  return n.type === "text" ? (n.value ?? "") : (n.children ?? []).map(hastText).join("");
}

/**
 * The diff in a markdown `pre` node, when it's a ```diff / ```patch fence
 * whose body reads as a diff; null otherwise (render as a plain code block).
 */
export function chatDiffFromPre(pre: unknown): { text: string; patch: ParsedPatch } | null {
  const code = (pre as HastNode | undefined)?.children?.find(
    (c) => c.type === "element" && c.tagName === "code",
  );
  const cls = code?.properties?.className;
  if (!code || !Array.isArray(cls) || !cls.some((c) => DIFF_LANGS.has(String(c)))) return null;
  const text = hastText(code).replace(/\n$/, "");
  const patch = parseChatDiff(text);
  return patch ? { text, patch } : null;
}

function Counts({ add, del }: { add: number; del: number }): JSX.Element {
  return (
    <span className="shrink-0 font-mono">
      <span className="text-[#7fd49a]">+{add}</span>{" "}
      <span className="text-[#f08a8a]">−{del}</span>
    </span>
  );
}

export function ChatDiffBlock({ text, patch }: { text: string; patch: ParsedPatch }): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const total = lineCount(patch.files);
  const foldable = total > FOLD_OVER_LINES;
  const files = foldable && !expanded ? truncate(patch.files, FOLDED_LINES) : patch.files;
  const numbers = patch.files.some((f) => f.hunks.some((h) => h.lines.some((l) => l.oldNo !== null || l.newNo !== null)));
  const named = patch.files.some((f) => f.oldPath !== null || f.newPath !== null);

  return (
    <CopyableBlock
      as="div"
      copyText={text}
      className="not-prose my-2 rounded border border-white/[0.06] bg-[rgba(10,12,20,0.6)] shadow-[inset_0_2px_8px_rgba(0,0,0,0.4)] overflow-hidden"
      data-testid="chat-diff"
    >
      <div className="flex items-center gap-2 pl-2 pr-10 py-1 text-[11.5px] border-b border-white/[0.06] text-[#a89a80]">
        <span>{patch.files.length > 1 ? `${patch.files.length} files` : "diff"}</span>
        <span className="ml-auto">
          <Counts add={patch.additions} del={patch.deletions} />
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse font-[JetBrains_Mono_Variable,ui-monospace,monospace] text-[12px] leading-5">
          <tbody>
            {files.map((f, fi) => (
              <Fragment key={fi}>
                {named ? (
                  <tr className="bg-white/[0.04] text-[#e8e4d8]" data-testid="chat-diff-file">
                    <td colSpan={numbers ? 4 : 2} className="px-2 py-0.5 whitespace-pre">
                      {displayPath(f)}
                    </td>
                  </tr>
                ) : null}
                {f.hunks.map((h, hi) => (
                  <Fragment key={hi}>
                    {h.header ? (
                      <tr className="bg-[hsla(var(--pv-id-hue,220),40%,45%,0.16)] text-[#a89a80]">
                        <td colSpan={numbers ? 4 : 2} className="px-2 py-0.5 whitespace-pre">
                          {h.header}
                        </td>
                      </tr>
                    ) : null}
                    <UnifiedHunkRows hunk={h} numbers={numbers} />
                  </Fragment>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {foldable ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          data-testid="chat-diff-toggle"
          className="w-full px-2 py-1 text-[11.5px] text-left text-[#a89a80] hover:text-[#e8e4d8] border-t border-white/[0.06] hover:bg-white/[0.04]"
        >
          {expanded ? "Show less" : `Show all ${total} lines`}
        </button>
      ) : null}
    </CopyableBlock>
  );
}
