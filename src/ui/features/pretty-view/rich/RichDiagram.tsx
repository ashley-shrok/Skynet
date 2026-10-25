import { useEffect, useState } from "react";
import { Code2, Shapes } from "lucide-react";
import { CopyableBlock } from "../CopyableBlock";
import { SPEAK_SKIP_ATTR } from "../speakable-text";
import { renderDiagram, type DiagramKind } from "../file-viewers/diagram/diagram-render";
import { RichFallback } from "./RichFallback";
import { diagramSpeech } from "./rich-speech";
import { useNearView } from "./use-in-view";

// Diagram source in an agent reply, drawn as the diagram (shape-wealthy-text):
// flowcharts, sequences, timelines, schedules — whatever the diagram language
// supports — through the same safe renderer the file window uses (drawn as a
// picture, so nothing in it can run). Dark by default to sit in the bubble; a
// diagram that sets its own theme keeps it. A toggle shows the source.

const DARK_MERMAID = '%%{init: {"theme": "dark", "themeVariables": {"background": "transparent"}}}%%\n';
const DARK_GRAPHVIZ =
  'graph [bgcolor="transparent" fontcolor="#e8e4d8" color="#a8a397"]; node [color="#c9c4b5" fontcolor="#e8e4d8"]; edge [color="#a8a397" fontcolor="#e8e4d8"];';

/** The source as drawn: the app's dark look unless the diagram picks its own. */
export function themedSource(kind: DiagramKind, source: string): string {
  if (kind === "mermaid") {
    const header = source.match(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/)?.[0] ?? "";
    if (/%%\{\s*init/.test(source) || /^\s*theme:/m.test(header)) return source;
    // The theme line goes after a title/config header: the header must open the source.
    return header + DARK_MERMAID + source.slice(header.length);
  }
  // Defaults go first inside the graph body, so the diagram's own attributes win.
  return source.replace(/^((?:\s|\/\/[^\n]*\n|#[^\n]*\n|\/\*[\s\S]*?\*\/)*(?:strict\s+)?(?:di)?graph\b(?:\s*(?:"(?:[^"\\]|\\.)*"|[\w.]+))?\s*)\{/i, `$1{ ${DARK_GRAPHVIZ} `);
}

const MIN_READABLE_WIDTH = 480;

// One diagram at a time: the renderer keeps shared scratch state.
let queue: Promise<unknown> = Promise.resolve();
function renderQueued(kind: DiagramKind, source: string) {
  const job = queue.then(() => renderDiagram(kind, source));
  queue = job.catch(() => undefined);
  return job;
}

export function RichDiagram({ kind, lang, source }: { kind: DiagramKind; lang: string; source: string }) {
  const [box, setBox] = useState<HTMLDivElement | null>(null);
  const inView = useNearView(box);
  const [state, setState] = useState<{ svg: string; width: number } | { error: string } | null>(null);
  const [showSource, setShowSource] = useState(false);

  useEffect(() => {
    if (!inView) return;
    let live = true;
    renderQueued(kind, themedSource(kind, source))
      .then((out) => {
        if (live) setState({ svg: out.svg, width: out.width });
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[rich-diagram] draw failed kind=${kind} error=${msg.slice(0, 160)}`);
        if (live) setState({ error: msg });
      });
    return () => {
      live = false;
    };
  }, [kind, source, inView]);

  if (state && "error" in state) return <RichFallback what="diagram" lang={lang} source={source} reason={state.error} />;
  const drawn = state && "svg" in state ? state : null;
  return (
    <div ref={setBox} className="pv-rich-panel pv-rich-diagram" data-testid="rich-diagram">
      <button
        type="button"
        className="pv-rich-tool pv-rich-diagram-toggle"
        onClick={() => setShowSource((v) => !v)}
        aria-pressed={showSource}
        title={showSource ? "Show the diagram" : "Show the source"}
        {...{ [SPEAK_SKIP_ATTR]: "" }}
      >
        {showSource ? <Shapes aria-hidden="true" /> : <Code2 aria-hidden="true" />}
        <span>{showSource ? "Diagram" : "Source"}</span>
      </button>
      <div className="pv-rich-diagram-scroll" {...{ [SPEAK_SKIP_ATTR]: "" }}>
        {showSource ? (
          <CopyableBlock as="pre">
            <code className={`language-${lang}`}>{source}</code>
          </CopyableBlock>
        ) : drawn ? (
          <img
            className="pv-rich-diagram-img"
            alt=""
            draggable={false}
            src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawn.svg)}`}
            // Fits the bubble, but never shrinks below a readable size: a wide
            // diagram on a phone scrolls sideways instead.
            style={{ width: `max(min(100%, ${Math.round(drawn.width)}px), ${Math.round(Math.min(drawn.width, MIN_READABLE_WIDTH))}px)` }}
          />
        ) : (
          <div className="pv-rich-loading">Drawing…</div>
        )}
      </div>
      <span className="sr-only">{diagramSpeech(lang, source)}</span>
    </div>
  );
}
