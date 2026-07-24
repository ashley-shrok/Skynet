/* eslint-disable react-refresh/only-export-components */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

// Phase 14B Slice 3: shadcn Button rebased onto pretty-view tokens.
//
// Design language reference: src/ui/features/pretty-view/ComposeBox.tsx
// (send button, reset cell) + IdentityBadge lg (hue-glow surface).
// Palette source: --color-pv-* tokens declared in src/ui/index.css:117-146.
//
// Variant mapping (from Termix defaults to pv aesthetic):
//   - default: hue-glow primary — warm-cream text on a subtle warm gradient
//     with a warm-cream inset rim + hue outer glow. Matches the ComposeBox
//     send button treatment. `--pv-hue` inherited from ancestor context
//     (defaults to 35 amber if unset).
//   - outline: transparent surface + 1px cool-cream hairline + warm text.
//     Hover fills with a low-alpha warm hue tint.
//   - ghost: fully transparent at rest; hover picks up a low-alpha warm
//     wash + warm text. Used for icon buttons and inline actions.
//   - secondary: quiet cool surface (dimmer than default) + warm text.
//   - destructive: warm-coral hue-glow treatment (uses --color-pv-code-fg
//     coral palette). Mirrors the pv error language.
//   - link: warm text + underline on hover. Unchanged conceptually.
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-[8px] border border-transparent bg-clip-padding text-xs font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-[hsla(var(--pv-hue,35),70%,60%,0.55)] focus-visible:ring-1 focus-visible:ring-[hsla(var(--pv-hue,35),70%,55%,0.35)] active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-[#ff5555]/60 aria-invalid:ring-1 aria-invalid:ring-[#ff5555]/25 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: cn(
          "bg-[linear-gradient(160deg,hsla(var(--pv-hue,35),45%,25%,0.72),hsla(var(--pv-hue,35),40%,15%,0.82))]",
          "text-[#fbf5e8]",
          "border-[hsla(var(--pv-hue,35),65%,55%,0.40)]",
          "shadow-[0_4px_12px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,220,170,0.18),0_0_16px_hsla(var(--pv-hue,35),65%,55%,0.22)]",
          "hover:brightness-110 hover:shadow-[0_6px_16px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,220,170,0.24),0_0_24px_hsla(var(--pv-hue,35),65%,55%,0.32)]",
        ),
        outline: cn(
          "bg-transparent text-[color:var(--color-pv-fg)]",
          "border-[color:var(--color-pv-border-quiet-strong)]",
          "hover:bg-[hsla(var(--pv-hue,35),40%,25%,0.18)] hover:border-[hsla(var(--pv-hue,35),55%,50%,0.35)] hover:text-[color:var(--color-pv-fg)]",
          "aria-expanded:bg-[hsla(var(--pv-hue,35),40%,25%,0.22)] aria-expanded:border-[hsla(var(--pv-hue,35),55%,50%,0.42)]",
        ),
        ghost: cn(
          "bg-transparent text-[color:var(--color-pv-fg-muted)]",
          "hover:bg-[rgba(220,225,245,0.06)] hover:text-[color:var(--color-pv-fg)]",
          "aria-expanded:bg-[rgba(220,225,245,0.08)] aria-expanded:text-[color:var(--color-pv-fg)]",
        ),
        secondary: cn(
          "bg-[color:var(--color-pv-surface-quiet)] text-[color:var(--color-pv-fg)]",
          "border-[color:var(--color-pv-border-quiet)]",
          "hover:bg-[color:var(--color-pv-surface-quiet-alt)]",
          "aria-expanded:bg-[color:var(--color-pv-surface-quiet-alt)]",
        ),
        destructive: cn(
          "bg-[linear-gradient(160deg,rgba(180,60,55,0.55),rgba(120,35,30,0.65))]",
          "text-[#ffe0d5]",
          "border-[rgba(255,120,90,0.42)]",
          "shadow-[0_4px_12px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,200,180,0.20),0_0_18px_rgba(255,90,60,0.22)]",
          "hover:brightness-110",
          "focus-visible:border-[rgba(255,120,90,0.55)] focus-visible:ring-[rgba(255,120,90,0.30)]",
        ),
        link: "text-[color:var(--color-pv-fg)] underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-[6px] px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[6px] px-2.5 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs": "size-6 rounded-[6px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-[6px]",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export { Button, buttonVariants };
