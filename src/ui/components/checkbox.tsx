import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { CheckIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// Phase 14B Slice 3: Checkbox rebased onto pv tokens. Off: cool-cream 1px
// hairline on transparent surface. On: hue-anchored fill with warm-cream
// check glyph.

function Checkbox({
  className,
  ...props
}: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border shadow-xs transition-shadow outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "bg-transparent border-[color:var(--color-pv-border-quiet-strong)]",
        "data-[state=checked]:bg-[hsla(var(--pv-hue,35),55%,45%,0.9)] data-[state=checked]:border-[hsla(var(--pv-hue,35),65%,55%,0.65)] data-[state=checked]:text-[#fbf5e8]",
        "focus-visible:border-[hsla(var(--pv-hue,35),70%,60%,0.55)] focus-visible:ring-[3px] focus-visible:ring-[hsla(var(--pv-hue,35),70%,55%,0.25)]",
        "aria-invalid:border-[#ff5555]/60 aria-invalid:ring-[#ff5555]/25",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="flex items-center justify-center text-current transition-none"
      >
        <CheckIcon className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
