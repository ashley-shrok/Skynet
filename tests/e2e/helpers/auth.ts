import { Page, expect, APIRequestContext } from "@playwright/test";

export interface Creds {
  username: string;
  password: string;
}

export function readCreds(): Creds {
  const raw = process.env.SKYNET_TEST_CREDS;
  if (!raw) {
    throw new Error(
      "SKYNET_TEST_CREDS env var must be set as 'username:password'",
    );
  }
  const [username, ...rest] = raw.split(":");
  const password = rest.join(":");
  if (!username || !password) {
    throw new Error("SKYNET_TEST_CREDS must be 'username:password'");
  }
  return { username, password };
}

export async function loginViaUI(page: Page, creds: Creds): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  // SPA hydrates: wait for the login form label to appear (accessible-name,
  // not brittle #id — Radix/shadcn wrappers sometimes drop the id to inner
  // elements and #id selectors go strict-mode-ambiguous).
  const usernameField = page.getByLabel(/username/i);
  const passwordField = page.getByLabel(/^password$/i);
  await expect(usernameField).toBeVisible({ timeout: 20_000 });
  await usernameField.fill(creds.username);
  await passwordField.fill(creds.password);
  await page.getByRole("button", { name: /^login$|^sign in$/i }).click();
  // Post-login: URL leaves /login (if it was there); shell paints.
  await expect(usernameField).toBeHidden({ timeout: 15_000 });
}

export async function seedAuthCookie(
  request: APIRequestContext,
  baseURL: string,
  creds: Creds,
): Promise<void> {
  const res = await request.post(`${baseURL}/users/login`, {
    data: { ...creds, rememberMe: false },
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok()) {
    throw new Error(`login failed ${res.status()} ${await res.text()}`);
  }
}

/**
 * Full auth seed: jwt cookie (server-side gate) AND localStorage["skynet_auth"]
 * (client-side gate — the SPA checks this to decide whether to render the shell
 * vs the LoginPage). Missing the localStorage half leaves the app on the login
 * form even with a valid session cookie, since Auth.tsx#STORAGE_KEY drives the
 * initial render (see src/ui/auth/Auth.tsx:89).
 *
 * Call BEFORE creating the first page in the context.
 */
export async function seedFullAuth(
  context: import("@playwright/test").BrowserContext,
  baseURL: string,
  creds: Creds,
): Promise<void> {
  await seedAuthCookie(context.request, baseURL, creds);
  const storagePayload = JSON.stringify({ loggedIn: true, username: creds.username });
  await context.addInitScript((payload: string) => {
    try {
      window.localStorage.setItem("skynet_auth", payload);
    } catch {
      // localStorage may be blocked in some contexts — ignore
    }
  }, storagePayload);
}
