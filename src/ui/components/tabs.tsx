import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";

import { cn } from "@/lib/utils";

// Phase 14B Slice 3: Tabs rebased onto pv tokens. List rests as a quiet
// glass strip; active trigger picks up a hue-anchored fill.

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        "inline-flex h-9 w-fit items-center justify-center rounded-[8px] p-[3px]",
        "bg-[color:var(--color-pv-surface-quiet)] text-[color:var(--color-pv-fg-muted)]",
        "border border-[color:var(--color-pv-border-quiet)]",
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-[6px] border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow,background] duration-200 disabled:pointer-events-none disabled:opacity-50",
        "text-[color:var(--color-pv-fg-muted)]",
        "data-[state=active]:bg-[hsla(var(--pv-hue,35),45%,28%,0.55)] data-[state=active]:text-[color:var(--color-pv-fg)] data-[state=active]:border-[hsla(var(--pv-hue,35),55%,50%,0.28)] data-[state=active]:shadow-[inset_0_1px_0_rgba(255,220,170,0.14)]",
        "focus-visible:border-[hsla(var(--pv-hue,35),70%,60%,0.55)] focus-visible:ring-[3px] focus-visible:ring-[hsla(var(--pv-hue,35),70%,55%,0.25)] focus-visible:outline-1",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn(
        "flex-1 outline-none",
        "data-[state=active]:animate-in data-[state=inactive]:animate-out",
        "data-[state=inactive]:fade-out-0 data-[state=active]:fade-in-0",
        "duration-150",
        className,
      )}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
