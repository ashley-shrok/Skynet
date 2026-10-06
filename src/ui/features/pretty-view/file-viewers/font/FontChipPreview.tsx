import { useEffect, useState } from "react";
import { useInView } from "../chip-fetch";
import type { ChipPreviewProps } from "../registry";

/** Chat-chip preview: "Aa" and a sample line drawn in the font, with its name. */

const MAX_BYTES = 10 * 1024 * 1024;

interface ChipFont {
  family: string;
  name: string;
  style: string;
  sample: string;
}

export function FontChipPreview({ url, onError }: ChipPreviewProps): JSX.Element {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  const visible = useInView(el);
  const [font, setFont] = useState<ChipFont | null>(null);

  useEffect(() => {
    if (!visible) return;
    const ctrl = new AbortController();
    let release: (() => void) | null = null;
    (async () => {
      const res = await fetch(url, { credentials: "same-origin", signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) throw new Error("too large");
      const { readFont, registerFont, sampleText } = await import("./font-model");
      const { info } = await readFont(bytes);
      const reg = await registerFont(bytes);
      release = reg.release;
      if (ctrl.signal.aborted) return reg.release();
      setFont({ family: reg.family, name: info.family, style: info.style, sample: sampleText(info.codePoints) });
    })().catch(() => !ctrl.signal.aborted && onError());
    return () => {
      ctrl.abort();
      release?.();
    };
    // onError is a fresh closure each render; the work depends on url.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, url]);

  return (
    <div ref={setEl} className="min-h-[64px]" data-testid="font-chip-preview">
      {font ? (
        <div className="flex items-center gap-3 px-3 py-2">
          <span className="shrink-0 text-[38px] leading-none text-[#fbf5e8]" style={{ fontFamily: `"${font.family}"` }}>Aa</span>
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium text-[#e8e4d8]">
              {font.name}
              {font.style ? <span className="ml-1.5 text-[#a89a80]">{font.style}</span> : null}
            </div>
            <div className="truncate text-[15px] text-[#cfc8b8]" style={{ fontFamily: `"${font.family}"` }}>{font.sample}</div>
          </div>
        </div>
      ) : (
        <div className="px-2.5 py-2 text-[11.5px] text-[#a89a80]">Reading font…</div>
      )}
    </div>
  );
}
