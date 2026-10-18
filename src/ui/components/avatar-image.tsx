import { useState, type CSSProperties } from "react";

/** First letter of `name`, upper-cased; "?" when there is none. */
export function initialOf(name: string | null | undefined): string {
  const ch = (name ?? "").trim()[0];
  return ch ? ch.toUpperCase() : "?";
}

/**
 * An agent's avatar image, or its initial when there is no image or the image
 * fails to load — e.g. an agent with no roles and no avatar of its own, whose
 * avatar URL has nothing to serve. The swap happens on the image's error, and
 * the empty `alt` keeps browsers from drawing a broken-image glyph meanwhile.
 * A new `src` gets a fresh attempt.
 *
 * The caller's circle (background, border, size) is either the container this
 * sits in, or `initialClassName` / `initialStyle` when the image itself is
 * the circle.
 */
export function AvatarImage({
  src,
  name,
  className,
  style,
  initialClassName,
  initialStyle,
}: {
  src: string | null | undefined;
  name: string | null | undefined;
  className?: string;
  style?: CSSProperties;
  initialClassName?: string;
  initialStyle?: CSSProperties;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!src || failedSrc === src) {
    return (
      <span data-testid="avatar-initial" className={initialClassName} style={initialStyle}>
        {initialOf(name)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      className={className}
      style={style}
      onError={() => setFailedSrc(src)}
    />
  );
}
