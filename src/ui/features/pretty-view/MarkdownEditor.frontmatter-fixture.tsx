/**
 * MarkdownEditor.frontmatter-fixture — self-contained dev-only fixture module
 * for the Phase 112 Plan 04 Playwright round-trip test.
 *
 * DO NOT import this file from anywhere else in the app. It is orphan in the
 * import graph on purpose — production builds tree-shake it out (nothing pulls
 * it in). The Playwright test at
 * `tests/e2e/mdxeditor-frontmatter-roundtrip.spec.ts` loads it via
 * `page.addScriptTag({ type: "module", url: "/src/ui/features/pretty-view/
 * MarkdownEditor.frontmatter-fixture.tsx?sample=..." })` which asks the Vite
 * dev server to compile + serve the module. On load, the module self-mounts
 * an <MarkdownEditor> into a fresh host element on document.body and exposes
 * `window.__editorGetMarkdown()` so the test can read the currently-serialised
 * markdown. Both effects are gated behind `import.meta.env.DEV` as a
 * defence-in-depth guard — even if this file somehow leaked into a production
 * bundle, the mount block would be dead code under `false`.
 *
 * The samples cover the three cases the Phase 112 Plan 04 test exercises:
 *   - `identity`: canonical frontmatter shape used by Skynet identity files
 *     (role / displayName / task — the same load-bearing keys the tasting
 *     harness at
 *     `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-
 *     editing-in-frontend/tasting/frontmatter-check.mjs` exercised).
 *   - `malformed`: unquoted colon-space value that triggers Pitfall 3
 *     (js-yaml strict parse failure). Confirms the editor does not crash
 *     and the on-wire content still round-trips.
 *   - `default`: minimal frontmatter block for a smoke case.
 *
 * See PLAN 112-04 §Task 2 for the full contract this fixture enables.
 */

import { StrictMode, useEffect, useState } from "react";
import type { JSX } from "react";
import { createRoot } from "react-dom/client";
import { MarkdownEditor } from "./MarkdownEditor";

const SAMPLES: Record<string, string> = {
  identity:
    "---\nrole: box-maintainer\ndisplayName: Cedar\ntask: something\n---\n\n# Hello\n\nbody here\n",
  malformed:
    "---\nrole: box-maintainer\ndisplayName: Cedar\ntask: Fix: bug\n---\n\n# Hello\n\nbody here\n",
  default: "---\nkey: value\n---\n\n# Default\n",
};

/**
 * Pick a sample keyed by the `sample=` query param. We look at TWO places
 * because Playwright's page.addScriptTag can attach the query to EITHER the
 * script URL (import.meta.url picks it up) OR the page URL (window.location
 * picks it up). Falling back through both keeps the fixture robust to both
 * loading paths.
 */
function pickSample(): string {
  let sampleKey: string | null = null;
  try {
    sampleKey = new URL(import.meta.url).searchParams.get("sample");
  } catch {
    // import.meta.url may be undefined in some non-Vite contexts — swallow
  }
  if (!sampleKey) {
    try {
      sampleKey = new URLSearchParams(window.location.search).get("sample");
    } catch {
      // window.location.search access may throw in exotic contexts — swallow
    }
  }
  return SAMPLES[sampleKey ?? "identity"] ?? SAMPLES.identity;
}

function Fixture(): JSX.Element {
  const [content, setContent] = useState(pickSample);

  useEffect(() => {
    // Expose the current serialised markdown as a global so the Playwright
    // spec can read what MDXEditor would emit on save — the round-trip
    // check for D-05 / D-14.
    (window as unknown as { __editorGetMarkdown?: () => string }).__editorGetMarkdown =
      () => content;
    return () => {
      delete (window as unknown as { __editorGetMarkdown?: () => string })
        .__editorGetMarkdown;
    };
  }, [content]);

  // Fixed synthetic filename — forces the D-06 pretty branch in MarkdownEditor.
  return (
    <MarkdownEditor
      filename="fixture.md"
      content={content}
      onChange={setContent}
    />
  );
}

// Self-mount block — gated on:
//   1. import.meta.env.DEV — Vite dev server only. Defence-in-depth guard
//      even though the module is orphan in the import graph and therefore
//      never bundled into production. Rollup / Vite tree-shakes unimported
//      modules aggressively.
//   2. !document.getElementById("__mdx_fixture_root") — protects against
//      double-mount if Playwright calls addScriptTag twice.
if (
  import.meta.env.DEV &&
  typeof document !== "undefined" &&
  !document.getElementById("__mdx_fixture_root")
) {
  // Hide the main app so only the fixture is visible on the page — keeps
  // Playwright's `[contenteditable="true"]` locator unambiguous.
  const appRoot = document.getElementById("root");
  if (appRoot) {
    appRoot.style.display = "none";
  }
  const host = document.createElement("div");
  host.id = "__mdx_fixture_root";
  host.style.cssText =
    "position:fixed;inset:0;background:#0b0e14;z-index:9999;padding:24px;overflow:auto;";
  document.body.appendChild(host);
  createRoot(host).render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
}
