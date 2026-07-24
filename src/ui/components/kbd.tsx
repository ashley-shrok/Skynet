import * as React from "react";
import { cn } from "@/lib/utils";

export type KbdProps = React.HTMLAttributes<HTMLElement>;

const Kbd = React.forwardRef<HTMLElement, KbdProps>(
  ({ className, ...props }, ref) => {
    return (
      <kbd
        ref={ref}
        className={cn(
          "pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded-none border border-[color:var(--color-pv-border-quiet-strong)] bg-[color:var(--color-pv-surface-quiet)] px-1.5 font-mono text-[10px] font-medium text-[color:var(--color-pv-fg-muted)] opacity-100",
          className,
        )}
        {...props}
      />
    );
  },
);
Kbd.displayName = "Kbd";

const KbdKey = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("", className)} {...props} />
);
KbdKey.displayName = "KbdKey";

const KbdSeparator = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => (
  <span className={cn("text-[color:var(--color-pv-fg-dim)]", className)} {...props}>
    +
  </span>
);
KbdSeparator.displayName = "KbdSeparator";

export { Kbd, KbdKey, KbdSeparator };
