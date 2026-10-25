import * as React from "react";

import { cn } from "@/lib/utils";

// LEGACY — the pre-redesign textarea (old palette). Kept only for screens not
// yet restyled. New UI: the kit's fields (@/components/kit).

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          "flex min-h-[80px] w-full rounded-[6px] px-3 py-2 text-sm transition-[color,box-shadow] duration-200 outline-none",
          "bg-transparent text-[color:var(--color-pv-fg)]",
          "border border-[color:var(--color-pv-border-quiet-strong)]",
          "placeholder:text-[color:var(--color-pv-fg-dim)]",
          "focus-visible:border-[hsla(var(--pv-hue,35),70%,60%,0.55)] focus-visible:ring-[3px] focus-visible:ring-[hsla(var(--pv-hue,35),70%,55%,0.25)]",
          "disabled:cursor-not-allowed disabled:opacity-60 disabled:pointer-events-none",
          "aria-invalid:border-[#ff5555]/60 aria-invalid:ring-[#ff5555]/25",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Textarea.displayName = "Textarea";

export { Textarea };
