import type { SVGProps } from "react";

// Skynet logo (light-blue triangle with three inward cuts) hand-transcribed
// from scripts/brand-source/logo-v2.svg — keep the two in sync if the source
// changes. Inline JSX (rather than svgr `?react` import) so tests under vitest
// don't need the vite-plugin-svgr transform in their config.
export default function SkynetLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 400 400" {...props}>
      <defs>
        <mask
          id="skynet-logo-cuts"
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="400"
          height="400"
        >
          <rect width="400" height="400" fill="black" />
          <polygon
            points="200,50 49.9,310 350.1,310"
            fill="white"
            stroke="white"
            strokeWidth="10"
            strokeLinejoin="round"
          />
          <line
            x1="98.95"
            y1="165"
            x2="200"
            y2="223.33"
            stroke="black"
            strokeWidth="28"
          />
          <line
            x1="301.05"
            y1="165"
            x2="200"
            y2="223.33"
            stroke="black"
            strokeWidth="28"
          />
          <line
            x1="200"
            y1="340"
            x2="200"
            y2="223.33"
            stroke="black"
            strokeWidth="28"
          />
        </mask>
      </defs>
      <polygon
        points="200,50 49.9,310 350.1,310"
        fill="#92eafc"
        stroke="#92eafc"
        strokeWidth="10"
        strokeLinejoin="round"
        mask="url(#skynet-logo-cuts)"
      />
    </svg>
  );
}
