import { CopyableBlock } from "../CopyableBlock";
import { SPEAK_SKIP_ATTR } from "../speakable-text";

/**
 * A chart or diagram that couldn't be drawn: its source as the ordinary code
 * block it would have been, under a quiet "couldn't draw" line. Nothing the
 * agent wrote is lost, and copy still works.
 */
export function RichFallback({ what, lang, source, reason }: { what: string; lang: string; source: string; reason?: string }) {
  return (
    <div className="pv-rich-fallback" data-testid="rich-fallback">
      <div className="pv-rich-fallback-note" title={reason} {...{ [SPEAK_SKIP_ATTR]: "" }}>
        Couldn't draw this {what}.
      </div>
      <CopyableBlock as="pre">
        <code className={`language-${lang}`}>{source}</code>
      </CopyableBlock>
    </div>
  );
}
