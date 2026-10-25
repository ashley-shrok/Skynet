// Markdown-level pieces of wealthy text (shape-wealthy-text).
//
// remarkDetails — the standard collapsible-section markup (<details> with a
//   <summary> line) becomes a real open/close section. It is the ONLY web
//   markup let in: every other tag in a reply still shows as the text it is.
//   The section's content is ordinary markdown when it sits on its own lines
//   (blank line after the summary, as the standard form has it); squeezed into
//   one HTML line it shows as plain text.
//
// remarkStrictMath — formulas in standard notation draw as math, but only the
//   strict single-dollar form: the opening $ is followed by a non-space, the
//   closing $ is preceded by one and not followed by a digit. "$5 to $10" and
//   "between $5-$10" stay prices. $$…$$ is always a formula.

interface MdNode {
  type: string;
  value?: string;
  children?: MdNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
  data?: Record<string, unknown>;
}

const OPEN_RE = /^<details(\s+open(?:\s*=\s*(?:"[^"]*"|'[^']*'|\S+))?)?\s*>/i;
const CLOSE_RE = /<\/details\s*>\s*$/i;
const SUMMARY_RE = /^\s*<summary\s*>([\s\S]*?)<\/summary\s*>/i;

function isOpen(n: MdNode): boolean {
  return n.type === "html" && OPEN_RE.test((n.value ?? "").trim());
}
function isClose(n: MdNode): boolean {
  return n.type === "html" && /^<\/details\s*>$/i.test((n.value ?? "").trim());
}

function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function detailsNode(open: boolean, summary: string, children: MdNode[]): MdNode {
  return {
    type: "richDetails",
    data: { hName: "details", hProperties: open ? { open: true } : {} },
    children: [
      { type: "richSummary", data: { hName: "summary" }, children: [{ type: "text", value: summary || "Details" }] },
      ...children,
    ],
  };
}

/** Parses an opening html node: whether it starts open, its summary, and any trailing text. */
function readOpening(value: string): { open: boolean; summary: string | null; rest: string } {
  const v = value.trim();
  const m = v.match(OPEN_RE)!;
  let rest = v.slice(m[0].length);
  let summary: string | null = null;
  const s = rest.match(SUMMARY_RE);
  if (s) {
    summary = plainText(s[1]);
    rest = rest.slice(s[0].length);
  }
  return { open: !!m[1], summary, rest: rest.trim() };
}

function transformChildren(children: MdNode[]): MdNode[] {
  const out: MdNode[] = [];
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.children) node.children = transformChildren(node.children);
    if (!isOpen(node)) {
      out.push(node);
      continue;
    }
    const opening = readOpening(node.value ?? "");
    // Whole section inside one HTML line/block.
    if (CLOSE_RE.test(opening.rest) || /^<\/details\s*>/i.test(opening.rest)) {
      const inner = plainText(opening.rest.replace(CLOSE_RE, ""));
      out.push(detailsNode(opening.open, opening.summary ?? "", inner ? [{ type: "paragraph", children: [{ type: "text", value: inner }] }] : []));
      continue;
    }
    // Find the matching close among the siblings (sections can nest).
    let depth = 1;
    let j = i + 1;
    for (; j < children.length; j++) {
      if (isOpen(children[j]) && !CLOSE_RE.test((children[j].value ?? "").trim())) depth++;
      else if (isClose(children[j]) && --depth === 0) break;
    }
    if (j >= children.length) {
      out.push(node);
      continue;
    }
    let body = children.slice(i + 1, j);
    let summary = opening.summary;
    if (summary === null && body[0]?.type === "html") {
      const s = (body[0].value ?? "").match(SUMMARY_RE);
      if (s) {
        summary = plainText(s[1]);
        const after = (body[0].value ?? "").trim().slice(s[0].length).trim();
        body = after ? [{ type: "paragraph", children: [{ type: "text", value: plainText(after) }] }, ...body.slice(1)] : body.slice(1);
      }
    }
    if (opening.rest) body = [{ type: "paragraph", children: [{ type: "text", value: plainText(opening.rest) }] }, ...body];
    out.push(detailsNode(opening.open, summary ?? "", transformChildren(body)));
    i = j;
  }
  return out;
}

export function remarkDetails() {
  return (tree: MdNode) => {
    if (tree.children) tree.children = transformChildren(tree.children);
  };
}

function revertLooseMath(node: MdNode, source: string): void {
  if (!node.children) return;
  node.children = node.children.map((child) => {
    if (child.type === "inlineMath") {
      const start = child.position?.start.offset;
      const end = child.position?.end.offset;
      if (start !== undefined && end !== undefined) {
        const raw = source.slice(start, end);
        if (raw.startsWith("$") && !raw.startsWith("$$")) {
          const inner = raw.slice(1, -1);
          const next = source.charAt(end);
          if (/^\s/.test(inner) || /\s$/.test(inner) || /\d/.test(next)) return { type: "text", value: raw };
        }
      }
      return child;
    }
    revertLooseMath(child, source);
    return child;
  });
}

export function remarkStrictMath() {
  return (tree: MdNode, file: { value?: unknown }) => {
    revertLooseMath(tree, String(file.value ?? ""));
  };
}
