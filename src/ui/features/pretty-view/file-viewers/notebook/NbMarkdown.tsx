import { memo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { joinText, type NbCell } from "./nb-model";

/**
 * Markdown as Jupyter renders it: GitHub flavour, $math$ via KaTeX, and the
 * inline HTML notebooks are full of (<br>, <img>, <center>…) — sanitized,
 * so no scripts, handlers or styles that escape the cell. Images attached
 * to the cell (`attachment:name.png`) resolve to the embedded data.
 */

const schema = {
  ...defaultSchema,
  protocols: { ...defaultSchema.protocols, src: [...(defaultSchema.protocols?.src ?? []), "attachment"] },
  attributes: {
    ...defaultSchema.attributes,
    code: [["className", /^language-./, "math-inline", "math-display"]],
    img: [...(defaultSchema.attributes?.img ?? []), "width", "height", "align"],
    "*": [...(defaultSchema.attributes?.["*"] ?? []), "align"],
  },
  tagNames: [...(defaultSchema.tagNames ?? []), "center", "u", "font"],
};

/**
 * Jupyter shows `$$…$$` as display maths even on one line; remark-math only
 * does when the $$ fences sit on their own lines, so split those out.
 */
export function normaliseDisplayMath(text: string): string {
  return text.replace(/^([ \t]*)\$\$(.+?)\$\$[ \t]*$/gm, "$1$$$$\n$1$2\n$1$$$$");
}

// Memoised: typing in one cell re-renders the notebook, and re-parsing every
// markdown cell on each keystroke would be wasted work.
export const NbMarkdown = memo(function NbMarkdown({
  text,
  attachments,
}: {
  text: string;
  attachments?: NbCell["attachments"];
}): JSX.Element {
  const urlTransform = (url: string) => {
    if (url.startsWith("attachment:")) {
      const bundle = attachments?.[decodeURIComponent(url.slice("attachment:".length))];
      const mime = bundle && Object.keys(bundle).find((m) => m.startsWith("image/") && m !== "image/svg+xml");
      return mime ? `data:${mime};base64,${joinText(bundle[mime]).replace(/\s+/g, "")}` : "";
    }
    return defaultUrlTransform(url);
  };
  return (
    <div className="nb-markdown" data-testid="nb-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema], rehypeKatex]}
        urlTransform={urlTransform}
        components={{ a: ({ node: _n, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" /> }}
      >
        {normaliseDisplayMath(text)}
      </ReactMarkdown>
    </div>
  );
});
