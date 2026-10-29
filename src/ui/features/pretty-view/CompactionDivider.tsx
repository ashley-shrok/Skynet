import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { ChevronDown, Minimize2 } from "lucide-react";

// Where a conversation was compacted: one slim divider in place of the
// summary, the compact command and its output. Closed it reads "Conversation
// compacted · <time>", with the guidance (if any) under it cut to one line;
// opened it shows the full guidance, then the summary. The summary was written
// for the agent — it's here for the curious moment, so it starts closed.
// Styles: .pv-condense in conversation.css.

const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
// Links in a summary open beside the app, never in place of it.
const MARKDOWN_COMPONENTS: Components = {
  a: ({ node: _node, ...props }) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

export interface CompactionDividerProps {
  summary: string;
  guidance: string | null;
  ts: number;
}

function compactedAt(ts: number): string {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return time;
  const date = d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  });
  return `${date}, ${time}`;
}

export const CompactionDivider = memo(function CompactionDivider({ summary, guidance, ts }: CompactionDividerProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="pv-condense" data-open={open ? "true" : "false"} data-testid="compaction-divider">
      <button
        type="button"
        className="pv-condense-bar"
        aria-expanded={open}
        title={new Date(ts).toLocaleString()}
        onClick={() => {
          console.info(`[compaction-divider] toggle open=${!open} summaryLen=${summary.length} hasGuidance=${guidance !== null}`);
          setOpen((o) => !o);
        }}
      >
        <span className="pv-condense-rule" aria-hidden="true" />
        <span className="pv-condense-label">
          <Minimize2 aria-hidden="true" />
          Conversation compacted · {compactedAt(ts)}
          <ChevronDown aria-hidden="true" className="pv-condense-chev" />
        </span>
        <span className="pv-condense-rule" aria-hidden="true" />
      </button>
      {guidance !== null && !open && (
        <div className="pv-condense-guidance" data-testid="compaction-guidance">
          “{guidance}”
        </div>
      )}
      {open && (
        <div className="pv-condense-body" data-testid="compaction-summary">
          {guidance !== null && <p className="pv-condense-guidance-full">“{guidance}”</p>}
          <div className="prose prose-invert max-w-none">
            <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={MARKDOWN_COMPONENTS}>
              {summary}
            </ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
});
