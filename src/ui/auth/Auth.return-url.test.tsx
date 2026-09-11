/**
 * Bounty 260910-pf4-serve-url-login-return-honor-make-skynet — Integration tests.
 *
 * Verifies that Auth.tsx and main.tsx are wired to consume the validated
 * return URL after login and on mount (when a stored session is already valid).
 *
 * Strategy: primarily structural (source-grep) per AppShell.new-conversation.test.tsx
 * pattern, plus lightweight React Testing Library behavioral tests for the
 * mount-time redirect branch (B1-B3). The structural tests catch regressions in
 * wiring without requiring a full component mount; the behavioral tests verify
 * the redirect side-effect fires (or doesn't) at the right moment.
 *
 * Origin: 103-10-SUMMARY.md GAP 4 — after login, users land on app root
 * instead of the serve URL they intended to reach.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { render, screen } from "@testing-library/react";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const authSrc = readFileSync(resolve(__dirname, "Auth.tsx"), "utf8");
const mainSrc = readFileSync(resolve(__dirname, "../../main.tsx"), "utf8");

// ---------------------------------------------------------------------------
// Structural tests — verify wiring in Auth.tsx source
// ---------------------------------------------------------------------------
describe("Structural: Auth.tsx wiring (S1-S9)", () => {
  it("S1 Auth.tsx imports validateReturnUrl and parseReturnFromSearch from ./return-url", () => {
    expect(authSrc).toMatch(/import\s*\{[^}]*validateReturnUrl[^}]*\}\s*from\s*['"]\.\/return-url['"]/);
    expect(authSrc).toMatch(/import\s*\{[^}]*parseReturnFromSearch[^}]*\}\s*from\s*['"]\.\/return-url['"]/);
  });

  it("S2 handleLogin body contains tryReturnUrlRedirect() call after onLogin(...)", () => {
    // Extract handleLogin function block
    const loginIdx = authSrc.indexOf("async function handleLogin(");
    expect(loginIdx).toBeGreaterThan(-1);
    const loginBlock = authSrc.slice(loginIdx, authSrc.indexOf("\n  async function handleRegister(", loginIdx));
    expect(loginBlock).toContain("tryReturnUrlRedirect()");
    expect(loginBlock).toContain("onLogin(");
    // tryReturnUrlRedirect must come after onLogin
    expect(loginBlock.indexOf("tryReturnUrlRedirect()")).toBeGreaterThan(loginBlock.indexOf("onLogin("));
  });

  it("S3 handleRegister body contains tryReturnUrlRedirect() call after onLogin(...)", () => {
    const registerIdx = authSrc.indexOf("async function handleRegister(");
    expect(registerIdx).toBeGreaterThan(-1);
    const registerBlock = authSrc.slice(registerIdx, authSrc.indexOf("\n  async function handleTOTP(", registerIdx));
    expect(registerBlock).toContain("tryReturnUrlRedirect()");
    expect(registerBlock).toContain("onLogin(");
    expect(registerBlock.indexOf("tryReturnUrlRedirect()")).toBeGreaterThan(registerBlock.indexOf("onLogin("));
  });

  it("S4 handleTOTP body contains tryReturnUrlRedirect() call after onLogin(...)", () => {
    const totpIdx = authSrc.indexOf("async function handleTOTP(");
    expect(totpIdx).toBeGreaterThan(-1);
    const totpBlock = authSrc.slice(totpIdx, authSrc.indexOf("\n  async function handleReset", totpIdx));
    expect(totpBlock).toContain("tryReturnUrlRedirect()");
    expect(totpBlock).toContain("onLogin(");
    expect(totpBlock.indexOf("tryReturnUrlRedirect()")).toBeGreaterThan(totpBlock.indexOf("onLogin("));
  });

  it('S5 OIDC-success useEffect contains tryReturnUrlRedirect() call inside .then((meRes)=>{...})', () => {
    // The OIDC useEffect is identified by `success = urlParams.get("success")`
    const oidcIdx = authSrc.indexOf('urlParams.get("success")');
    expect(oidcIdx).toBeGreaterThan(-1);
    // Find the getUserInfo().then block that follows
    const thenIdx = authSrc.indexOf('getUserInfo()', oidcIdx);
    expect(thenIdx).toBeGreaterThan(-1);
    const thenBlock = authSrc.slice(thenIdx, authSrc.indexOf('}, [onLogin', thenIdx));
    expect(thenBlock).toContain("tryReturnUrlRedirect()");
    // validateReturnUrl is used inside tryReturnUrlRedirect() — confirm it is called from Auth.tsx overall
    expect(authSrc).toContain("validateReturnUrl(");
  });

  it("S6 There is at least one window.location.assign( call in Auth.tsx (post-login redirect)", () => {
    expect(authSrc).toContain("window.location.assign(");
  });

  it('S7 There is at least one console.warn("[auth] rejecting invalid return url" in Auth.tsx', () => {
    expect(authSrc).toContain('console.warn("[auth] rejecting invalid return url"');
  });

  it("S8 The mount-time useEffect for already-authed redirect exists — grep for getStoredAuth()?.loggedIn inside Auth.tsx", () => {
    expect(authSrc).toContain("getStoredAuth()?.loggedIn");
  });

  it("S9 Auth.tsx contains window.location.hostname at least twice (already-authed useEffect + post-login handler)", () => {
    const matches = authSrc.match(/window\.location\.hostname/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Structural tests — verify wiring in main.tsx source
// ---------------------------------------------------------------------------
describe("Structural: main.tsx wiring (S10)", () => {
  it("S10 main.tsx imports/uses validateReturnUrl and parseReturnFromSearch", () => {
    const count = (mainSrc.match(/validateReturnUrl|parseReturnFromSearch/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Behavioral tests — React Testing Library (B1-B3)
// ---------------------------------------------------------------------------

// Mock all the @/main-axios imports Auth.tsx uses so it can mount cleanly.
vi.mock("@/main-axios", () => ({
  loginUser: vi.fn().mockResolvedValue({ success: true }),
  registerUser: vi.fn().mockResolvedValue({}),
  getUserInfo: vi.fn().mockResolvedValue({ username: "alice", userId: "u1", is_admin: false }),
  getRegistrationAllowed: vi.fn().mockResolvedValue({ allowed: true }),
  getPasswordLoginAllowed: vi.fn().mockResolvedValue({ allowed: true }),
  getPasswordResetAllowed: vi.fn().mockResolvedValue(true),
  getOIDCConfig: vi.fn().mockResolvedValue(null),
  getSetupRequired: vi.fn().mockResolvedValue({ setup_required: false }),
  initiatePasswordReset: vi.fn(),
  verifyPasswordResetCode: vi.fn(),
  completePasswordReset: vi.fn(),
  getOIDCAuthorizeUrl: vi.fn(),
  verifyTOTPLogin: vi.fn(),
  getServerConfig: vi.fn().mockResolvedValue(null),
  saveServerConfig: vi.fn(),
  isElectron: vi.fn().mockReturnValue(false),
  getEmbeddedServerStatus: vi.fn().mockResolvedValue(null),
  getCurrentToken: vi.fn().mockResolvedValue(null),
  appReadyPromise: Promise.resolve(),
}));

vi.mock("@/branding/branding-store", () => ({
  useBrandingConfig: vi.fn().mockReturnValue({ logoPath: null, wordmarkPath: null, wordmarkText: null, faviconPath: null }),
}));

vi.mock("@/i18n/i18n", () => ({ default: { language: "en" } }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  initReactI18next: { type: "3rdParty", init: () => {} },
}));

vi.mock("@/auth/ElectronServerConfig", () => ({
  ElectronServerConfig: () => null,
}));

vi.mock("@/auth/ElectronLoginForm", () => ({
  ElectronLoginForm: () => null,
}));

vi.mock("@/components/button", () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<React.ButtonHTMLAttributes<HTMLButtonElement>>) =>
    <button {...props}>{children}</button>,
}));

vi.mock("@/components/input", () => ({
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock("@/components/separator", () => ({
  Separator: () => <hr />,
}));

vi.mock("@/components/checkbox", () => ({
  Checkbox: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input type="checkbox" {...props} />,
}));

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("lucide-react", () => ({
  Eye: () => null,
  EyeOff: () => null,
  User: () => null,
  KeyRound: () => null,
  ArrowLeft: () => null,
  Shield: () => null,
  CheckCircle2: () => null,
}));

vi.mock("./silent-signin", () => ({
  removeSilentSigninFromSearch: vi.fn(),
  shouldTriggerSilentSignin: vi.fn().mockReturnValue(false),
}));

// Helper: reset window.location with custom values for each test
function setupLocation(hostname: string, search: string) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      hostname,
      search,
      pathname: "/login",
      href: `https://${hostname}/login${search}`,
      assign: vi.fn(),
      replace: vi.fn(),
      reload: vi.fn(),
    },
    writable: true,
  });
}

describe("Behavioral: mount-time redirect (B1-B3)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("B1 already-authed + valid same-parent-domain return= → window.location.assign called on mount with validated URL, form not initially rendered", async () => {
    setupLocation(
      "term.example.com",
      "?return=https%3A%2F%2Ffoo-8899.serve.term.example.com%2F",
    );
    localStorage.setItem("skynet_auth", JSON.stringify({ loggedIn: true, username: "alice" }));

    const { Auth } = await import("./Auth");
    render(<Auth onLogin={vi.fn()} />);

    // assign must have been called with the validated URL
    expect(window.location.assign).toHaveBeenCalledWith(
      "https://foo-8899.serve.term.example.com/"
    );
    // L-02 code-review: fulfill the test name's "form not initially rendered" guarantee.
    // The redirect fires synchronously in the mount effect, so no login form should be visible.
    expect(screen.queryByPlaceholderText(/username/i)).toBeNull();
  });

  it("B2 already-authed + invalid cross-domain return= → assign NOT called, console.warn IS called", async () => {
    setupLocation(
      "term.example.com",
      "?return=https%3A%2F%2Fevil.com%2F",
    );
    localStorage.setItem("skynet_auth", JSON.stringify({ loggedIn: true, username: "alice" }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { Auth } = await import("./Auth");
    render(<Auth onLogin={vi.fn()} />);

    expect(window.location.assign).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      "[auth] rejecting invalid return url",
      expect.objectContaining({ returnParam: "https://evil.com/" })
    );
  });

  it("B3 already-authed + no return= → window.location.assign NOT called (regression guard)", async () => {
    setupLocation("term.example.com", "");
    localStorage.setItem("skynet_auth", JSON.stringify({ loggedIn: true, username: "alice" }));

    const { Auth } = await import("./Auth");
    render(<Auth onLogin={vi.fn()} />);

    expect(window.location.assign).not.toHaveBeenCalled();
  });
});
