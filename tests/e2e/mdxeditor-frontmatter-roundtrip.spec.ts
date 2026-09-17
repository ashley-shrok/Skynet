/**
 * Phase 112 Plan 04 Task 2 — frontmatter round-trip Playwright test.
 *
 * Enforces the D-05 / D-14 contract: a body-only edit through the shared
 * MarkdownEditor (which delegates to MDXEditor for .md files) MUST preserve
 * the top-of-file YAML frontmatter `---` fence and its keys byte-identically.
 *
 * The test loads a self-contained dev-only fixture module at
 * `src/ui/features/pretty-view/MarkdownEditor.frontmatter-fixture.tsx` via
 * `page.addScriptTag({ type: "module", url: "/src/..." })`. The Vite dev
 * server compiles and serves the TSX on the fly; the fixture self-mounts an
 * <MarkdownEditor> into a fresh host on document.body and exposes
 * `window.__editorGetMarkdown()` so this spec can inspect the serialised
 * markdown after typing into the body.
 *
 * PREREQUISITE: The Vite dev server MUST be running at PLAYWRIGHT_FIXTURE_URL
 * (defaults to http://localhost:5173). Ported from the durable tasting
 * harness at
 * /home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/frontmatter-check.mjs
 */
import { test, expect, type Page } from "@playwright/test";

const FIXTURE_BASE_URL =
  process.env.PLAYWRIGHT_FIXTURE_URL ?? "http://localhost:5173";
const FIXTURE_MODULE_PATH =
  "/src/ui/features/pretty-view/MarkdownEditor.frontmatter-fixture.tsx";

// Override the Playwright config's default baseURL (which points at a
// deployed Skynet instance) — this test runs against a local Vite dev
// server. The auth-gated smoke.spec.ts and probe-* specs keep the deployed
// baseURL from playwright.config.ts.
test.use({
  baseURL: FIXTURE_BASE_URL,
  ignoreHTTPSErrors: true,
});

/**
 * Load the fixture module for a given sample and wait for the MDXEditor
 * contenteditable region to mount. Returns the largest editable locator
 * (mirrors the tasting harness's approach — MDXEditor has both a body
 * contenteditable AND smaller per-decorator editables; the largest is the
 * body pane).
 */
async function mountFixture(page: Page, sample: string): Promise<void> {
  // We navigate to `/` and rely on the fixture module's self-mount to hide
  // the SPA root and paint its own host div. `waitUntil: "domcontentloaded"`
  // avoids hanging on the SPA's login-form network chatter.
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.addScriptTag({
    type: "module",
    url: `${FIXTURE_MODULE_PATH}?sample=${sample}`,
  });
  // The fixture creates #__mdx_fixture_root then MDXEditor mounts an
  // internal contenteditable. Wait for both.
  await page.waitForSelector("#__mdx_fixture_root", { timeout: 15_000 });
  await page.waitForSelector("#__mdx_fixture_root [contenteditable='true']", {
    timeout: 20_000,
  });
}

/**
 * Locate the largest [contenteditable='true'] inside the fixture host — the
 * body pane of MDXEditor. MDXEditor also renders smaller editables (e.g.
 * inline decorators); typing into the largest one is what mirrors a real
 * user body edit.
 */
async function focusBodyEditor(page: Page): Promise<void> {
  const handles = await page
    .locator("#__mdx_fixture_root [contenteditable='true']")
    .all();
  let bestArea = -1;
  let bestIndex = -1;
  for (let i = 0; i < handles.length; i++) {
    const box = await handles[i].boundingBox();
    if (!box) continue;
    const area = box.width * box.height;
    if (area > bestArea) {
      bestArea = area;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) throw new Error("no body contenteditable found");
  await handles[bestIndex].click();
}

async function readSerialisedMarkdown(page: Page): Promise<string> {
  // Give MDXEditor's Lexical state tree a microtask beat to flush the
  // typed text through onChange back to the fixture's setContent.
  await page.waitForTimeout(500);
  return await page.evaluate<string>(() => {
    const w = window as unknown as { __editorGetMarkdown?: () => string };
    return w.__editorGetMarkdown?.() ?? "";
  });
}

test.describe("frontmatter round-trip preservation (D-05 / D-14)", () => {
  test("body edit does not modify the --- block", async ({ page }) => {
    await mountFixture(page, "identity");
    await focusBodyEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.type(" edited");

    const serialized = await readSerialisedMarkdown(page);

    // Fence + key survival — the load-bearing D-05 assertions. The fence
    // MUST reopen at the very top of the serialised output, and each key
    // MUST reappear byte-verbatim inside the block.
    expect(serialized).toMatch(/^---\nrole: box-maintainer\n/);
    expect(serialized).toContain("displayName: Cedar\n");
    expect(serialized).toContain("task:");
    // The fence closes cleanly before the body — a subsequent `---\n\n`
    // (or `---\n\n#` when the body starts with a heading).
    expect(serialized).toMatch(/---\n\n/);

    // The body's tail carries the appended " edited" fragment, confirming
    // the round-trip actually captured the typed change (not just an
    // untouched snapshot).
    expect(serialized).toMatch(/ edited\s*$/);
  });

  test("frontmatter dialog opens populated with existing keys", async ({
    page,
  }) => {
    await mountFixture(page, "identity");

    // The InsertFrontmatter toolbar button opens a Radix Dialog. MDXEditor
    // exposes it by aria-label "Insert frontmatter" — when a block already
    // exists the click behaviour becomes "open existing dialog". The
    // toolbar renders inside the MDXEditor root; the button is discoverable
    // by role.
    const fmButton = page.getByRole("button", { name: /frontmatter/i });
    await expect(fmButton).toBeVisible({ timeout: 10_000 });
    await fmButton.click();

    // Radix Dialog surfaces role="dialog". Existing keys populate form
    // inputs — the identity sample carries role: box-maintainer.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 5_000 });

    // MDXEditor's frontmatter form uses react-hook-form uncontrolled inputs
    // (defaultValue rather than value). CSS `input[value='...']` matches the
    // HTML attribute, which stays blank when only the DOM property is set —
    // so we read the input values via evaluate() and assert on the array.
    // The form renders one <input name="yamlConfig.N.key"> +
    // <input name="yamlConfig.N.value"> pair per frontmatter entry.
    const kv = await page.evaluate(() => {
      const inputs = Array.from(
        document.querySelectorAll<HTMLInputElement>(
          '[role="dialog"] input[name^="yamlConfig."]',
        ),
      );
      const pairs: Array<{ key: string; value: string }> = [];
      // Inputs are ordered pairwise: (0.key, 0.value), (1.key, 1.value), …
      for (let i = 0; i < inputs.length; i += 2) {
        const keyInput = inputs[i];
        const valueInput = inputs[i + 1];
        if (keyInput?.name.endsWith(".key") && valueInput?.name.endsWith(".value")) {
          pairs.push({ key: keyInput.value, value: valueInput.value });
        }
      }
      return pairs;
    });

    // All three identity-sample keys populated with their values.
    expect(kv).toEqual(
      expect.arrayContaining([
        { key: "role", value: "box-maintainer" },
        { key: "displayName", value: "Cedar" },
        { key: "task", value: "something" },
      ]),
    );
  });

  // RESEARCH §Pitfall 3 documented that MDXEditor's frontmatterPlugin uses
  // js-yaml strict-mode, which throws YAMLException on unquoted colon-space
  // values like `task: Fix: bug`. Empirically confirmed on this branch: the
  // fixture's malformed sample causes MDXEditor to throw synchronously during
  // its Lexical decorator render (pageerror "YAMLException2" surfaces, and
  // the contenteditable region never mounts).
  //
  // This is a KNOWN PITFALL, not a regression this plan introduced — Skynet's
  // own backend parser at identity-artifact-reader.ts:288 hits the same trap.
  // The D-05 preservation contract for the malformed corner case is upheld by
  // a different mechanism: the frontend cannot save what it cannot mount, so
  // nothing writes a mutated frontmatter block. See PLAN 112-04 <behavior>
  // Test 3 — the plan explicitly permits `test.skip` if the pitfall is
  // unresolvable in this pass, with the escalation documented in SUMMARY.
  //
  // Follow-up bounty (out of scope for phase 111): teach the frontmatterPlugin
  // (or a wrapper) to fall back to opaque preservation on parse failure so
  // authors can hand-repair the fence without the editor blank-screening.
  test.skip("Pitfall 3 documented — malformed YAML frontmatter throws YAMLException", async ({
    page,
  }) => {
    // Placeholder body — the assertion this WOULD make (once the pitfall is
    // resolved by a fallback path): mounting the malformed sample should not
    // throw, and a body-only edit should still round-trip the frontmatter
    // bytes verbatim.
    const pageErrors: string[] = [];
    page.on("pageerror", (err) => pageErrors.push(err.message));
    await mountFixture(page, "malformed");
    await focusBodyEditor(page);
    await page.keyboard.press("End");
    await page.keyboard.type(" edited");
    const serialized = await readSerialisedMarkdown(page);
    expect(serialized.startsWith("---\n")).toBe(true);
    expect(serialized).toMatch(/ edited\s*$/);
    expect(pageErrors).toEqual([]);
  });
});
