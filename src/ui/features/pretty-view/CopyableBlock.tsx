import React, { useRef, useState, useEffect } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

type CopyableBlockTag = "pre" | "blockquote";

type CopyableBlockProps = {
  as: CopyableBlockTag;
  className?: string;
  children?: React.ReactNode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

export function CopyableBlock({
  as: Tag,
  className,
  children,
  // Strip ReactMarkdown-internal props so they are not forwarded to the DOM element.
  node: _node,
  ...rest
}: CopyableBlockProps) {
  const wrapperRef = useRef<HTMLElement>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  // Clear the revert timer on unmount to avoid state updates on unmounted components.
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    // Extract plain text from the wrapper element's content children only —
    // exclude the copy button itself so its "Copy" / "Copied" label doesn't
    // bleed into the clipboard payload. We clone the wrapper, remove the
    // button (identified by data-testid), then read textContent.
    let text = "";
    if (wrapperRef.current) {
      const clone = wrapperRef.current.cloneNode(true) as HTMLElement;
      const btn = clone.querySelector("[data-testid='copyable-block-copy']");
      if (btn) btn.remove();
      text = clone.textContent ?? "";
    }

    try {
      // Prefer the Electron clipboard bridge when available (matches the
      // HostKeyVerificationDialog / WarpgateDialog / ConnectionLog pattern).
      if (window.electronClipboard?.writeText) {
        await window.electronClipboard.writeText(text);
      } else {
        await navigator.clipboard.writeText(text);
      }

      // Success: show the Copied affordance and schedule the revert.
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
      }
      setCopied(true);
      timerRef.current = window.setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, 1500);
    } catch {
      // Write failed — leave the button in idle state.
      // Swallowing the rejection here prevents an unhandled promise rejection.
    }
  };

  return (
    // The `group` class is required so that `group-hover:opacity-100` on the
    // button activates when the wrapper element is hovered.
    <Tag
      ref={wrapperRef as React.Ref<HTMLPreElement & HTMLQuoteElement>}
      className={cn("group relative", className)}
      {...rest}
    >
      {children}
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy"}
        data-testid="copyable-block-copy"
        onClick={handleCopy}
        className={cn(
          // Position: top-right corner inside the block.
          "absolute top-1.5 right-1.5",
          // Size and shape.
          "rounded p-1",
          // Glass-cohesive styling from the pv-* palette.
          "bg-white/[0.06] hover:bg-white/[0.12]",
          "border border-white/[0.08]",
          "text-[color:var(--color-pv-fg)]",
          // Visibility gate:
          //   - Desktop (hover:hover): dim at rest, reveal on group hover.
          //   - Touch (pointer:coarse): always visible.
          "opacity-0 group-hover:opacity-100",
          "[@media(pointer:coarse)]:opacity-100",
          "transition-opacity duration-150",
        )}
      >
        {copied ? (
          <>
            <Check
              size={14}
              data-testid="copyable-block-check"
              aria-hidden="true"
            />
            <span className="sr-only">Copied</span>
          </>
        ) : (
          <>
            <Copy size={14} aria-hidden="true" />
            <span className="sr-only">Copy</span>
          </>
        )}
      </button>
    </Tag>
  );
}
