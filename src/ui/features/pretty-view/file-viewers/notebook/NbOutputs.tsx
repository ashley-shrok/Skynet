import { memo, useEffect, useMemo, useRef, useState } from "react";
import Anser from "anser";
import { joinText, type MultilineString, type NbOutput } from "./nb-model";
import { NbMarkdown } from "./NbMarkdown";
import { formatCell } from "../data/cell-format";

/**
 * Cell outputs, richest safe representation first. Nothing a notebook
 * produced ever runs: HTML goes in a sandboxed frame without scripts,
 * SVG is shown as an image, and JavaScript / widget outputs fall back to
 * the static version Jupyter saved next to them.
 */

const MAX_LINES = 400;

type Chosen =
  | { kind: "html"; html: string }
  | { kind: "image"; src: string }
  | { kind: "markdown"; text: string }
  | { kind: "latex"; text: string }
  | { kind: "json"; value: unknown }
  | { kind: "text"; text: string }
  | { kind: "none" };

export function chooseOutput(data: Record<string, unknown>): Chosen {
  const text = (mime: string) => joinText(data[mime] as MultilineString);
  const has = (mime: string) => data[mime] !== undefined;
  const html = has("text/html") ? text("text/html") : null;
  // HTML that needs scripts (Plotly, Bokeh, widgets) renders blank without
  // them, so it only wins when there's no static fallback below.
  const scriptOnly = html !== null && /<script[\s>]/i.test(html);
  if (html !== null && !scriptOnly) return { kind: "html", html };
  const image = ["image/png", "image/jpeg", "image/gif"].find(has);
  if (has("image/svg+xml")) {
    return { kind: "image", src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text("image/svg+xml"))}` };
  }
  if (image) return { kind: "image", src: `data:${image};base64,${text(image).replace(/\s+/g, "")}` };
  if (has("text/markdown")) return { kind: "markdown", text: text("text/markdown") };
  if (has("text/latex")) return { kind: "latex", text: text("text/latex") };
  if (has("application/json")) return { kind: "json", value: data["application/json"] };
  if (has("text/plain")) return { kind: "text", text: text("text/plain") };
  if (html !== null) return { kind: "html", html };
  return { kind: "none" };
}

/** ANSI-coloured text (tracebacks, logs) → escaped HTML with inline colours. */
export function ansiHtml(text: string): string {
  return Anser.ansiToHtml(Anser.escapeForHtml(text), { use_classes: false });
}

function AnsiText({ text, tone }: { text: string; tone?: "error" | "stderr" }): JSX.Element {
  const [all, setAll] = useState(false);
  const lines = text.split("\n");
  const long = lines.length > MAX_LINES;
  const shown = long && !all ? lines.slice(0, MAX_LINES).join("\n") : text;
  const html = useMemo(() => ansiHtml(shown), [shown]);
  return (
    <div>
      <pre
        className={`nb-pre ${tone === "error" ? "bg-[#2a1515]" : tone === "stderr" ? "bg-[#2a2215]" : ""}`}
        // Escaped by Anser.escapeForHtml first; Anser only adds <span style> colours.
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {long && !all ? (
        <button type="button" onClick={() => setAll(true)} className="text-[11.5px] text-[#9fb4e8] hover:underline">
          Show all {lines.length.toLocaleString()} lines
        </button>
      ) : null}
    </div>
  );
}

const FRAME_STYLE = `<style>
html,body{margin:0;background:#fff;color:#1f1f1f;font:13px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
body{padding:6px 8px;overflow-x:auto}
table{border-collapse:collapse;font-size:12px}
th,td{border:1px solid #e3e3e3;padding:3px 8px;text-align:right}
th{background:#f5f5f5;font-weight:600}
tbody tr:nth-child(odd){background:#fafafa}
img{max-width:100%}
</style>`;

/** HTML output in a frame that can't run scripts; sized to its content. */
function HtmlFrame({ html }: { html: string }): JSX.Element {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(40);
  useEffect(() => {
    const frame = ref.current;
    if (!frame) return;
    let observer: ResizeObserver | null = null;
    const measure = () => {
      const doc = frame.contentDocument;
      if (!doc?.documentElement) return;
      setHeight(Math.min(2000, doc.documentElement.scrollHeight + 2));
    };
    const onLoad = () => {
      measure();
      const body = frame.contentDocument?.body;
      if (body) {
        observer = new ResizeObserver(measure);
        observer.observe(body);
      }
    };
    frame.addEventListener("load", onLoad);
    return () => {
      frame.removeEventListener("load", onLoad);
      observer?.disconnect();
    };
  }, [html]);
  return (
    <iframe
      ref={ref}
      title="Cell output"
      // No allow-scripts: notebook HTML is displayed, never executed.
      // allow-same-origin only lets us measure the content's height.
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><base target="_blank">${FRAME_STYLE}</head><body>${html}</body></html>`}
      className="block w-full rounded border-0 bg-white"
      style={{ height }}
      data-testid="nb-html-output"
    />
  );
}

function OutputView({ output }: { output: NbOutput }): JSX.Element | null {
  if (output.output_type === "stream") {
    return <AnsiText text={joinText(output.text)} tone={output.name === "stderr" ? "stderr" : undefined} />;
  }
  if (output.output_type === "error") {
    const tb = output.traceback?.length ? output.traceback.join("\n") : `${output.ename}: ${output.evalue}`;
    return <AnsiText text={tb} tone="error" />;
  }
  const chosen = chooseOutput(output.data ?? {});
  switch (chosen.kind) {
    case "html":
      return <HtmlFrame html={chosen.html} />;
    case "image":
      return <img src={chosen.src} alt="Output" className="max-w-full rounded bg-white" data-testid="nb-image-output" />;
    case "markdown":
      return <NbMarkdown text={chosen.text} />;
    case "latex":
      return <NbMarkdown text={chosen.text.trim().startsWith("$") ? chosen.text : `$$\n${chosen.text}\n$$`} />;
    case "json":
      return <pre className="nb-pre">{formatCell(chosen.value).slice(0, 20000)}</pre>;
    case "text":
      return <AnsiText text={chosen.text} />;
    default:
      return null;
  }
}

// Memoised: edits keep a cell's outputs array, so outputs don't re-render while typing.
export const NbOutputs = memo(function NbOutputs({ outputs }: { outputs: NbOutput[] }): JSX.Element | null {
  if (!outputs.length) return null;
  return (
    <div className="flex flex-col gap-1.5" data-testid="nb-outputs">
      {outputs.map((o, i) => (
        <OutputView key={i} output={o} />
      ))}
    </div>
  );
});
