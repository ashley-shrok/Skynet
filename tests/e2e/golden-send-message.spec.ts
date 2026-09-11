/**
 * Golden-path E2E — send a message in PrettyView and see it render as a bubble.
 *
 * Flow: seedFullAuth → shell paints → click first conversation row →
 *   type in compose textarea → click Send → assert new bubble contains the text.
 *
 * Skips gracefully if the test user has no conversations (fresh account).
 * The intent is to run this against a user seeded with at least one active
 * agent conversation — throwaway-tina fits when a conversation is pre-open.
 *
 * Selectors here favor role + accessible-name over CSS. If selectors drift
 * with UI changes, tune them but keep the flow shape (four steps + assert)
 * intact — that shape IS the golden path.
 */
import { test, expect } from "@playwright/test";
import { readCreds, seedFullAuth } from "./helpers/auth";

const BASE_URL =
  process.env.PLAYWRIGHT_BASE_URL ?? "https://term.example.com";

test.use({ trace: "retain-on-failure" });

test("golden: send a message and see it render as a bubble", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
  });
  await seedFullAuth(context, BASE_URL, readCreds());
  const page = await context.newPage();

  await page.goto("/", { waitUntil: "domcontentloaded" });
  // SPA hydrates.
  await expect(page.locator("body")).toBeVisible();
  await page.waitForTimeout(2000);

  // Find the first conversation row. PrettyConversationsPanel renders
  // rows with data-pv-conversation-row (see PrettyConversationRow.tsx).
  // Fall back to a role-based query if the testid isn't present.
  const firstRow = page
    .locator('[data-pv-conversation-row], [role="button"][data-pv-conversation-id]')
    .first();

  const rowCount = await page
    .locator('[data-pv-conversation-row], [role="button"][data-pv-conversation-id]')
    .count();

  test.skip(
    rowCount === 0,
    "test user has no conversations — seed at least one before running",
  );

  await firstRow.click();

  // The compose textarea is the tallest textarea in the pane; querying by
  // its accessible name — "Message" or via placeholder — is more robust
  // than tag-name lookups since the shell also has a search input.
  const compose =
    (await page.getByRole("textbox", { name: /message/i }).count()) > 0
      ? page.getByRole("textbox", { name: /message/i }).first()
      : page.locator("textarea").last();

  await expect(compose).toBeVisible({ timeout: 10_000 });

  const testMessage = `e2e-test-${Date.now()}`;
  await compose.fill(testMessage);

  // Send button — aria-label "Send" set in ComposeBox.tsx.
  const sendBtn = page.getByRole("button", { name: /^Send$/ }).first();
  await expect(sendBtn).toBeEnabled({ timeout: 5_000 });
  await sendBtn.click();

  // A user bubble containing testMessage should appear. Bubbles have
  // data-pv-bubble on their outer element per the pretty-view render
  // convention (see PrettyView.tsx).
  const bubble = page.locator("[data-pv-bubble]", { hasText: testMessage });
  await expect(bubble).toBeVisible({ timeout: 15_000 });

  await context.close();
});
