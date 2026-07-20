import { useIdentities } from "@/state/identities-store";

export interface IdentityBadgeProps {
  identityKey: string | null;
  // "md" (default) = patch #17/#38 terminal-pane treatment: 120px pill,
  // 80px round avatar, name + title stacked BELOW the avatar.
  // "lg" = Phase 4 pretty-view Glass treatment: bigger pill with a
  // 56px avatar on the LEFT, name + title stacked to the RIGHT of the
  // avatar, backdrop-blur, identity-hue rim/glow accents, ~5s subtle
  // breathing brightness animation.
  //
  // Patch #38 hover-fade rule: the md branch preserves the hover-opacity-fade
  // class BYTE-IDENTICAL. The lg branch replaces it with a click affordance
  // (cursor-pointer + hover scale + hover glow bump) when `onClick` is
  // provided. See patch #87 for rationale.
  size?: "md" | "lg";
  // lg-only: when provided, the badge renders as a <button> element with
  // click affordance (cursor-pointer, hover scale, aria-label). When absent,
  // the badge renders as a <div aria-hidden> (backward-compat for callers
  // that don't wire the click).
  onClick?: () => void;
}

export function IdentityBadge({
  identityKey,
  size = "md",
  onClick,
}: IdentityBadgeProps) {
  const { byKey } = useIdentities();
  const identity = identityKey ? byKey.get(identityKey.toLowerCase()) : null;
  if (!identity) return null;

  if (size === "lg") {
    // Phase 4 pretty-view treatment. Identity hue drives border + inset
    // rim + outer glow; NULL colorHue falls back to hue 35 (warm amber,
    // matches the neutral fallback PrettyView uses for its root
    // --pv-id-hue). Font stack Inter for the name/title (matches
    // ChatMessage's font override — pretty view is a prose surface).
    // Breathing animation is applied via inline animation shorthand
    // AND the `.pv-identity-breathe` class marker so the
    // prefers-reduced-motion @media rule in index.css can disable it.
    //
    // Patch #87: when `onClick` is provided, the badge is interactive —
    // rendered as <button> with cursor-pointer, hover scale, active scale,
    // hover glow bump, and aria-label. When `onClick` is absent, behavior
    // is backward-compatible: plain <div aria-hidden> with no click affordance.
    // The hover-opacity-fade class is REMOVED from the lg branch in this patch
    // (patch #38 byte-preservation is on the md branch only — see md return).
    const hue = identity.colorHue ?? 35;
    const lgClassName = `pv-identity-breathe absolute top-4 right-5 z-[101] flex flex-row items-center gap-3 select-none font-[Inter_Variable,ui-sans-serif,system-ui,sans-serif] transition-transform hover:scale-[1.015] active:scale-[0.995] hover:shadow-[0_8px_24px_rgba(0,0,0,0.6),_inset_0_1px_0_rgba(255,220,170,0.22),_0_0_56px_hsla(${hue},65%,55%,0.42)]`;
    const lgStyle = {
      // Pill shape (mock reference): border-radius 36 with padding 8 16 8 8
      // makes a proper capsule where the 56px avatar circle sits concentric
      // to the pill's left semicircle inner curve. Background carries the
      // identity hue (deep warm-tinted gradient) — per-pane color anchor.
      borderRadius: 36,
      padding: "8px 18px 8px 8px",
      background: `linear-gradient(160deg, hsla(${hue}, 45%, 25%, 0.72), hsla(${hue}, 40%, 15%, 0.82))`,
      backdropFilter: "blur(24px) saturate(1.4)",
      WebkitBackdropFilter: "blur(24px) saturate(1.4)",
      border: `1px solid hsla(${hue}, 65%, 55%, 0.4)`,
      boxShadow: `0 8px 24px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,220,170,0.18), 0 0 40px hsla(${hue}, 65%, 55%, 0.28)`,
      color: "#e8e4d8",
      animation: "pv-identity-breathe 5s ease-in-out infinite",
    };
    const lgInner = (
      <>
        <img
          src={identity.avatarUrl}
          alt=""
          className="object-cover shrink-0"
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            boxShadow: `0 4px 12px rgba(0,0,0,0.6), inset 0 2px 0 rgba(255,235,190,0.35), 0 0 24px hsla(${hue}, 65%, 55%, 0.4)`,
          }}
          draggable={false}
        />
        <div className="flex flex-col min-w-0">
          <span
            className="font-semibold truncate leading-tight"
            style={{ fontSize: 15, color: "#f0ebe0" }}
          >
            {identity.displayName}
          </span>
          {identity.title && (
            <span
              className="truncate leading-tight"
              style={{ fontSize: 12, color: "#a89a80" }}
            >
              {identity.title}
            </span>
          )}
        </div>
      </>
    );
    if (onClick) {
      // Patch #89: explicit cursor-pointer on the interactive branch.
      // Tailwind v4 does NOT default `<button>` to cursor: pointer (v3
      // preflight did; v4 dropped it), so the hover cursor stayed as the
      // default arrow after patch #87 shipped. `cursor-pointer` on the
      // button className fixes it without touching the aria-hidden div
      // fallback branch (where a pointer cursor would falsely advertise
      // a click target).
      return (
        <button
          type="button"
          onClick={onClick}
          aria-label="Open identity info"
          title="Identity info"
          className={`${lgClassName} cursor-pointer`}
          style={lgStyle}
        >
          {lgInner}
        </button>
      );
    }
    return (
      <div
        aria-hidden="true"
        className={lgClassName}
        style={lgStyle}
      >
        {lgInner}
      </div>
    );
  }

  // size === "md" — patch #17 initial + patch #38 hover-fade BYTE-PRESERVED.
  // Do NOT alter any pixel here without an explicit patch update; terminal
  // panes render this exact treatment across every mounted tab.
  return (
    <div
      aria-hidden="true"
      className="absolute top-2 right-2 z-[101] flex flex-col items-center gap-1.5 bg-card border border-border px-2.5 py-2.5 select-none transition-opacity duration-150 hover:opacity-0"
      style={{ width: 120 }}
    >
      <img
        src={identity.avatarUrl}
        alt=""
        className="object-cover"
        style={{ width: 80, height: 80, borderRadius: "50%" }}
        draggable={false}
      />
      <span
        className="font-bold text-foreground truncate max-w-full leading-tight"
        style={{ fontSize: 15 }}
      >
        {identity.displayName}
      </span>
      {identity.title && (
        <span
          className="text-muted-foreground truncate max-w-full leading-tight text-center"
          style={{ fontSize: 13 }}
        >
          {identity.title}
        </span>
      )}
    </div>
  );
}
