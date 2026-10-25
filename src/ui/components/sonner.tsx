"use client";

import { useTheme } from "@/components/theme-provider";
import { Toaster as Sonner } from "sonner";

// Toasts in the kit look: a solid raised surface, hairline border, kit text;
// the action button is a kit primary, cancel a kit secondary. Errors get a
// red border and kit danger text.

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
            "group toast group-[.toaster]:rounded-[14px]! group-[.toaster]:shadow-[0_8px_24px_rgba(0,0,0,0.5)]! group-[.toaster]:font-[family-name:var(--font-sans)]",
          description: "group-[.toast]:text-[color:var(--k-t2)]!",
          // Sonner's own (unlayered) button styles beat Tailwind's layered
          // utilities, and they colour the label with --normal-bg. `!` makes
          // ours win.
          actionButton:
            "bg-[var(--k-acc)]! text-white! font-semibold! rounded-[8px]!",
          cancelButton:
            "bg-[var(--k-s3)]! text-[color:var(--k-t1)]! rounded-[8px]!",
        },
      }}
      style={
        {
          "--radius": "14px",
          "--normal-bg": "var(--k-s2)",
          "--normal-border": "var(--k-hair2)",
          "--normal-text": "var(--k-t1)",
          "--success-bg": "var(--k-s2)",
          "--success-border": "var(--k-hair2)",
          "--success-text": "var(--k-t1)",
          "--info-bg": "var(--k-s2)",
          "--info-border": "var(--k-hair2)",
          "--info-text": "var(--k-t1)",
          "--warning-bg": "var(--k-s2)",
          "--warning-border": "var(--k-hair2)",
          "--warning-text": "var(--k-t1)",
          "--error-bg": "var(--k-s2)",
          "--error-border": "rgba(229, 85, 76, 0.45)",
          "--error-text": "var(--k-danger-text)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
