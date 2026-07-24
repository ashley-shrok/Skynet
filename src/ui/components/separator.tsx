import * as React from "react";
import { Separator as SeparatorPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// Phase 14B Slice 3: Separator rebased onto the pv cool-cream border quiet
// token so hairlines match the pv-panel / pv-panel-header rims.

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-[color:var(--color-pv-border-quiet)] data-horizontal:h-px data-horizontal:w-full data-vertical:w-px data-vertical:self-stretch",
        className,
      )}
      {...props}
    />
  );
}

export { Separator };
