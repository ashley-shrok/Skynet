import { useEffect, useState } from "react";
import { SPEAK_SKIP_ATTR } from "../speakable-text";
import { mathSpeech } from "./rich-speech";

// A formula in an agent reply, drawn as math (shape-wealthy-text). The math
// typesetter loads on first use, so replies without formulas never pay for
// it; until it's ready (or if the formula has an error) the source shows.

type Katex = typeof import("katex").default;
let katexReady: Promise<Katex> | null = null;
function loadKatex(): Promise<Katex> {
  katexReady ??= Promise.all([import("katex"), import("./katex-css")]).then(([m]) => m.default);
  return katexReady;
}

export function RichMath({ tex, display }: { tex: string; display: boolean }) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadKatex()
      .then((katex) => {
        if (!live) return;
        try {
          // trust:false (default) keeps \href/\includegraphics and friends off.
          setHtml(katex.renderToString(tex, { displayMode: display, throwOnError: true, output: "htmlAndMathml", strict: "ignore" }));
          setFailed(false);
        } catch (err) {
          console.warn(`[rich-math] couldn't draw formula len=${tex.length} error=${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
          setFailed(true);
        }
      })
      .catch((err: unknown) => {
        console.warn(`[rich-math] typesetter failed to load error=${err instanceof Error ? err.message : String(err)}`);
        if (live) setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [tex, display]);

  const spoken = <span className="sr-only">{mathSpeech(tex)}</span>;
  if (html && !failed) {
    const Tag = display ? "div" : "span";
    return (
      <Tag className={display ? "pv-rich-math-display" : "pv-rich-math"} data-testid="rich-math" data-display={display || undefined}>
        {/* KaTeX output is generated markup from the formula, never the agent's HTML. */}
        <span aria-hidden="true" {...{ [SPEAK_SKIP_ATTR]: "" }} dangerouslySetInnerHTML={{ __html: html }} />
        {spoken}
      </Tag>
    );
  }
  const source = display ? `$$${tex}$$` : `$${tex}$`;
  return display ? (
    <div className="pv-rich-math-display pv-rich-math-src" data-testid="rich-math-source">{source}</div>
  ) : (
    <code className="pv-rich-math-src" data-testid="rich-math-source">{source}</code>
  );
}
