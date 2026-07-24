"use client";

import * as React from "react";
import { Tooltip as TooltipPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

// Phase 14B Slice 3: Tooltip rebased onto pv tokens. Warm-dark glass surface
// (echoes Dialog / Sheet) + warm off-white text so tooltips read as part of
// the same visual family instead of the inverted white-on-dark shadcn default.

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  );
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return <TooltipPrimitive.Root data-slot="tooltip" {...props} />;
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        className={cn(
          "z-50 inline-flex w-fit max-w-xs origin-(--radix-tooltip-content-transform-origin) items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-xs",
          "bg-[linear-gradient(180deg,rgba(28,30,40,0.95),rgba(18,20,28,0.97))]",
          "text-[color:var(--color-pv-fg)]",
          "border border-[color:var(--color-pv-border-quiet-strong)]",
          "shadow-[0_6px_16px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(220,225,245,0.06)]",
          "backdrop-blur-md supports-backdrop-filter:[backdrop-filter:blur(16px)_saturate(1.3)]",
          "has-data-[slot=kbd]:pr-1.5",
          "data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
          "**:data-[slot=kbd]:relative **:data-[slot=kbd]:isolate **:data-[slot=kbd]:z-50 **:data-[slot=kbd]:rounded-[4px]",
          "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[1px] bg-[rgba(22,24,32,0.97)] fill-[rgba(22,24,32,0.97)]" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger };
