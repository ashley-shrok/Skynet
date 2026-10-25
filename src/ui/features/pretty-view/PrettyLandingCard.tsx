// The idle card in the main pane when no conversation is open (rendered by
// tabUtils.tsx for the fallback tab). Same floating-control look as the
// conversation view's pill and status cards (.pv-float). No motion.

import { MessagesSquare } from "lucide-react";

export function PrettyLandingCard() {
  return (
    <div
      data-pv-landing-card="true"
      className="flex flex-col flex-1 items-center justify-center px-6 py-10"
    >
      <div
        role="status"
        aria-label="Select an agent"
        className="pv-float flex items-center gap-2.5 px-4 py-3 rounded-[16px] text-[14px] font-semibold"
      >
        <MessagesSquare
          className="size-[18px] shrink-0 text-[color:var(--k-t2)]"
          aria-hidden="true"
        />
        <span>Select an agent</span>
      </div>
    </div>
  );
}
