import { cn } from "@/lib/utils";

// Phase 14B Slice 3: Skeleton rebased onto pv tokens — cool-cream low-alpha
// shimmer on transparent surface.

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-[6px] bg-[rgba(220,225,245,0.06)]",
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
