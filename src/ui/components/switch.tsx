import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";

import { cn } from "@/lib/utils";

// Phase 14B Slice 3: Switch rebased onto pv tokens. Off: quiet cool track,
// warm-cream thumb. On: hue-anchored track, warm-cream thumb.

function Switch({
  className,
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "peer inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-all outline-none disabled:cursor-not-allowed disabled:opacity-50",
        "data-[state=checked]:bg-[hsla(var(--pv-hue,35),55%,45%,0.9)] data-[state=checked]:border-[hsla(var(--pv-hue,35),65%,55%,0.55)]",
        "data-[state=unchecked]:bg-[color:var(--color-pv-surface-quiet)] data-[state=unchecked]:border-[color:var(--color-pv-border-quiet-strong)]",
        "focus-visible:border-[hsla(var(--pv-hue,35),70%,60%,0.55)] focus-visible:ring-[3px] focus-visible:ring-[hsla(var(--pv-hue,35),70%,55%,0.25)]",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full ring-0 transition-transform",
          "bg-[#fbf5e8]",
          "data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0",
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
