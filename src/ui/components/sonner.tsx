"use client";

import { useTheme } from "@/components/theme-provider";
import { Toaster as Sonner } from "sonner";

// Phase 14B Slice 3: Sonner toast rebased onto pv tokens. Warm-dark glass
// gradient card, warm off-white text, cool-cream border, hue-accent success/
// info states (uses the ambient --pv-hue), warm-coral error state (uses the
// pv code-fg coral palette for consistency).

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:rounded-[var(--radius-pv-card)]! group-[.toaster]:shadow-[0_8px_24px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(220,225,245,0.06)] group-[.toaster]:font-mono",
          description:
            "group-[.toast]:text-[color:var(--color-pv-fg-muted)]",
          actionButton:
            "group-[.toast]:bg-[hsla(var(--pv-hue,35),55%,45%,0.9)] group-[.toast]:text-[#fbf5e8] group-[.toast]:font-semibold",
          cancelButton:
            "group-[.toast]:bg-[color:var(--color-pv-surface-quiet)] group-[.toast]:text-[color:var(--color-pv-fg-muted)]",
        },
      }}
      style={
        {
          "--radius": "10px",
          "--normal-bg":
            "linear-gradient(180deg, rgba(28,30,40,0.92), rgba(18,20,28,0.95))",
          "--normal-border": "var(--color-pv-border-quiet-strong)",
          "--normal-text": "var(--color-pv-fg)",
          "--success-bg":
            "linear-gradient(180deg, rgba(28,30,40,0.92), rgba(18,20,28,0.95))",
          "--success-border": "var(--color-pv-border-quiet-strong)",
          "--success-text": "hsla(var(--pv-hue, 35), 65%, 60%, 0.95)",
          "--info-bg":
            "linear-gradient(180deg, rgba(28,30,40,0.92), rgba(18,20,28,0.95))",
          "--info-border": "var(--color-pv-border-quiet-strong)",
          "--info-text": "hsla(var(--pv-hue, 35), 65%, 60%, 0.95)",
          "--error-bg":
            "linear-gradient(180deg, rgba(28,30,40,0.92), rgba(18,20,28,0.95))",
          "--error-border": "rgba(255,120,90,0.42)",
          "--error-text": "var(--color-pv-code-fg)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
