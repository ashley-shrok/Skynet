import type { ReactElement } from "react";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import remarkMath from "remark-math";
import type { Components } from "react-markdown";
import { CHART_LANGS } from "./chart-spec";
import { GRAPHVIZ_LANGS, MERMAID_LANGS } from "./rich-speech";
import { remarkDetails, remarkStrictMath } from "./remark-rich";
import { RichChart } from "./RichChart";
import { RichDiagram } from "./RichDiagram";
import { RichMath } from "./RichMath";
import { RichTable } from "./RichTable";
import "./rich.css";

// Wealthy text (shape-wealthy-text): what an agent reply can show beyond plain
// prose — charts, workable tables, diagrams, collapsible sections, math. All
// of it comes from things agents already write; this module is the markdown
// plugins plus the element overrides that draw them. Agent text only: a
// user's own message keeps the plain rendering.

/** Plugins for an agent reply (module scope: a stable pipeline per render). */
export const RICH_REMARK_PLUGINS = [remarkGfm, remarkBreaks, remarkMath, remarkStrictMath, remarkDetails];

type HastLike = { type?: string; tagName?: string; value?: string; properties?: { className?: unknown }; children?: HastLike[] };

function hastText(n: HastLike | undefined): string {
  if (!n) return "";
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(hastText).join("");
}
function classes(n: HastLike | undefined): string[] {
  const c = n?.properties?.className;
  return Array.isArray(c) ? c.map(String) : [];
}

/** The drawn block for a fenced `pre` (chart, diagram, display formula), or null. */
export function richPre(pre: unknown): ReactElement | null {
  const code = (pre as HastLike | undefined)?.children?.find((c) => c.type === "element" && c.tagName === "code");
  if (!code) return null;
  const cls = classes(code);
  const text = hastText(code).replace(/\n$/, "");
  if (cls.includes("math-display")) return <RichMath tex={text} display />;
  const lang = cls.find((c) => c.startsWith("language-"))?.slice("language-".length).toLowerCase();
  if (!lang) return null;
  if (CHART_LANGS.has(lang)) return <RichChart source={text} />;
  if (MERMAID_LANGS.has(lang)) return <RichDiagram kind="mermaid" lang={lang} source={text} />;
  if (GRAPHVIZ_LANGS.has(lang)) return <RichDiagram kind="graphviz" lang={lang} source={text} />;
  return null;
}

/** Overrides for an agent reply, beyond `pre` (which the caller composes). */
export const RICH_COMPONENTS: Pick<Components, "table" | "code"> = {
  table: ({ node, children, ...props }) => (
    <RichTable node={node} {...props}>
      {children}
    </RichTable>
  ),
  code: ({ node, children, className, ...props }) => {
    if (classes(node as HastLike).includes("math-inline")) return <RichMath tex={hastText(node as HastLike)} display={false} />;
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
};
