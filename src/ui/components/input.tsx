import * as React from "react";

import { cn } from "@/lib/utils";

// Phase 14B Slice 3: Input rebased onto pv tokens.
//
// Rest: transparent surface + 1px cool-cream hairline (~10% alpha) + warm
// off-white text. Focus: identity-hue border + hue ring so the input picks
// up the pane's identity color at focus time. Disabled: quiet cool surface
// with dimmed text.
//
// Placeholder color: --color-pv-fg-dim (warm-dim off-white); the default
// muted-foreground was too gray for the pv palette.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 rounded-[6px] px-2.5 py-1 text-xs transition-colors outline-none",
        "bg-transparent text-[color:var(--color-pv-fg)]",
        "border border-[color:var(--color-pv-border-quiet-strong)]",
        "placeholder:text-[color:var(--color-pv-fg-dim)]",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-xs file:font-medium file:text-[color:var(--color-pv-fg)]",
        "focus-visible:border-[hsla(var(--pv-hue,35),70%,60%,0.55)] focus-visible:ring-1 focus-visible:ring-[hsla(var(--pv-hue,35),70%,55%,0.35)]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-[color:var(--color-pv-surface-quiet)] disabled:opacity-60",
        "aria-invalid:border-[#ff5555]/60 aria-invalid:ring-1 aria-invalid:ring-[#ff5555]/25",
        "md:text-xs",
        type === "number" &&
          "[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
