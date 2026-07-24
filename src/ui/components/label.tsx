import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";

import { cn } from "@/lib/utils";

// Phase 14B Slice 3: Label rebased onto pv-fg (warm off-white) so form
// labels sit visually with the rest of the pv aesthetic.

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none text-[color:var(--color-pv-fg)] group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
