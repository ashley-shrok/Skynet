/* eslint-disable react-refresh/only-export-components */
import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/button";
import { Input } from "@/components/input";
import { toast } from "sonner";
import {
  Eye,
  EyeOff,
  User,
  KeyRound,
  Shield,
  CheckCircle2,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  loginUser,
  registerUser,
  getUserInfo,
  getPasswordLoginAllowed,
  getOIDCConfig,
  getSetupRequired,
  getOIDCAuthorizeUrl,
  verifyTOTPLogin,
  getCurrentToken,
} from "@/main-axios";
import i18n from "@/i18n/i18n";
import {
  removeSilentSigninFromSearch,
  shouldTriggerSilentSignin,
} from "./silent-signin";
import { validateReturnUrl, parseReturnFromSearch } from "./return-url";
import { makeInitialAvatar } from "./initial-avatar";
// Phase 70 Plan 04: login header lockup (icon + wordmark, L1131-1142) now
// sourced from brandingConfig (Plan 70-03) so operator-provided assets
// unify with the conversation-list header per D-08's "same icon+wordmark"
// constraint.
import { useBrandingConfig } from "@/branding/branding-store";

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "af", label: "Afrikaans" },
  { code: "ar", label: "العربية" },
  { code: "bn", label: "বাংলা" },
  { code: "bg", label: "Български" },
  { code: "ca", label: "Català" },
  { code: "zh-CN", label: "中文 (简体)" },
  { code: "zh-TW", label: "中文 (繁體)" },
  { code: "cs", label: "Čeština" },
  { code: "da", label: "Dansk" },
  { code: "nl", label: "Nederlands" },
  { code: "fi", label: "Suomi" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "el", label: "Ελληνικά" },
  { code: "he", label: "עברית" },
  { code: "hi", label: "हिन्दी" },
  { code: "hu", label: "Magyar" },
  { code: "id", label: "Indonesia" },
  { code: "it", label: "Italiano" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "no", label: "Norsk" },
  { code: "pl", label: "Polski" },
  { code: "pt-PT", label: "Português (PT)" },
  { code: "pt-BR", label: "Português (BR)" },
  { code: "ro", label: "Română" },
  { code: "ru", label: "Русский" },
  { code: "sr", label: "Српски" },
  { code: "es-ES", label: "Español" },
  { code: "sv-SE", label: "Svenska" },
  { code: "th", label: "ไทย" },
  { code: "tr", label: "Türkçe" },
  { code: "uk", label: "Українська" },
  { code: "vi", label: "Tiếng Việt" },
];

const STORAGE_KEY = "skynet_auth";

export function getStoredAuth(): {
  loggedIn: boolean;
  username: string;
} | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function clearStoredAuth() {
  localStorage.removeItem(STORAGE_KEY);
}

function storeAuth(username: string) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ loggedIn: true, username }),
  );
}

/**
 * 260910-pf4: Attempt a validated return-URL redirect.
 * Uses window.location.hostname as parentDomain (guaranteed === SKYNET_COOKIE_DOMAIN
 * because /login is served on the primary domain per Phase 103 D-14).
 * Returns true if a redirect was initiated (caller should return early).
 */
function tryReturnUrlRedirect(): boolean {
  const parent = window.location.hostname;
  const raw = parseReturnFromSearch(window.location.search);
  const validated = validateReturnUrl(raw, parent);
  if (raw !== null && validated === null) {
    console.warn("[auth] rejecting invalid return url", { returnParam: raw, parentDomain: parent });
    return false;
  }
  if (validated !== null) {
    window.location.assign(validated);
    return true;
  }
  return false;
}

// "register" is only the first-admin setup on a brand-new instance; there is
// no open sign-up and no self-service password reset.
type AuthView = "login" | "register" | "totp" | "external";

interface AuthProps {
  onLogin: (username: string, userId?: string, isAdmin?: boolean) => void;
}

interface ExtendedWindow extends Window {
  ReactNativeWebView?: { postMessage: (msg: string) => void };
}

const isInMobileWebView = () =>
  !!(window as ExtendedWindow).ReactNativeWebView;

function PasswordInput({
  value,
  onChange,
  placeholder,
  disabled,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "••••••••"}
        disabled={disabled}
        className="pr-9 font-mono"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow((o) => !o)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[color:var(--color-pv-fg-muted)] hover:text-[color:var(--color-pv-fg)] transition-colors"
      >
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

function FieldLabel({
  htmlFor,
  children,
}: {
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <label
      htmlFor={htmlFor}
      className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]"
    >
      {children}
    </label>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <FieldLabel htmlFor={htmlFor}>{label}</FieldLabel>
      {children}
    </div>
  );
}

export function Auth({ onLogin }: AuthProps) {
  const { t } = useTranslation();
  // Phase 70 Plan 04: login header (icon + wordmark below at ~L1131) reads
  // from the branding store — falls back to the bundled Skynet defaults on
  // t1000, swaps to operator assets on AI+ deploys.
  const brandingConfig = useBrandingConfig();
  const [view, setView] = useState<AuthView>("login");
  const [loading, setLoading] = useState(false);
  const [oidcLoading, setOidcLoading] = useState(false);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [totpCode, setTotpCode] = useState("");
  const [totpTempToken, setTotpTempToken] = useState("");
  const totpInputRef = useRef<HTMLInputElement>(null);

  const [language, setLanguage] = useState(
    () => localStorage.getItem("i18nextLng") ?? "en",
  );

  function handleLanguageChange(code: string) {
    setLanguage(code);
    localStorage.setItem("i18nextLng", code);
    i18n.changeLanguage(code);
  }

  const [passwordLoginAllowed, setPasswordLoginAllowed] = useState(true);
  const [oidcConfigured, setOidcConfigured] = useState(false);
  const [oidcConfigLoaded, setOidcConfigLoaded] = useState(false);
  const silentSigninHandledRef = useRef(false);
  const [firstUser, setFirstUser] = useState(false);
  const [dbConnectionFailed, setDbConnectionFailed] = useState(false);
  const [dbHealthChecking, setDbHealthChecking] = useState(true);

  const [webviewAuthSuccess, setWebviewAuthSuccess] = useState(false);

  // 260910-pf4: already-authed + valid return= → redirect immediately before form renders.
  // Fires BEFORE the registration/OIDC/setup useEffects so expensive fetches are skipped.
  // Trusts getStoredAuth() (localStorage) for the redirect-decision; destination re-auths
  // via JWT cookie — no privilege escalation risk even if localStorage is forged (worst
  // case: a 302 back to /login on stale session). Do NOT block on getUserInfo() here.
  useEffect(() => {
    if (getStoredAuth()?.loggedIn) tryReturnUrlRedirect();
    // Note: no cleanup — window.location.assign navigates away; unmount is intentional.
  }, []);

  useEffect(() => {
    getPasswordLoginAllowed()
      .then((res) => setPasswordLoginAllowed(res.allowed))
      .catch(() => {});
    getOIDCConfig()
      .then((res) => setOidcConfigured(!!res))
      .catch(() => setOidcConfigured(false))
      .finally(() => setOidcConfigLoaded(true));
  }, []);

  useEffect(() => {
    setDbHealthChecking(true);
    getSetupRequired()
      .then((res) => {
        if (res.setup_required) {
          setFirstUser(true);
          setView("register");
        }
        setDbConnectionFailed(false);
      })
      .catch(() => setDbConnectionFailed(true))
      .finally(() => setDbHealthChecking(false));
  }, []);

  useEffect(() => {
    if (view === "totp" && totpInputRef.current) totpInputRef.current.focus();
  }, [view]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const success = urlParams.get("success");
    const error = urlParams.get("error");
    if (error) {
      if (error === "registration_disabled")
        toast.error(t("messages.registrationDisabled"));
      else if (error === "user_not_allowed")
        toast.error(t("messages.userNotAllowed"));
      else toast.error(`${t("errors.oidcAuthFailed")}: ${error}`);
      window.history.replaceState({}, document.title, window.location.pathname);
      return;
    }
    if (success) {
      if (isInMobileWebView()) {
        // The OIDC callback authenticated via an HttpOnly cookie on this origin,
        // so the token isn't in localStorage. Prefer a token passed in the URL
        // (skynet-mobile:-origin callbacks include one), otherwise read it back
        // from the cookie via /users/me/token before handing it to the app.
        const postToken = (token: string) => {
          (window as ExtendedWindow).ReactNativeWebView?.postMessage(
            JSON.stringify({ type: "AUTH_SUCCESS", token }),
          );
          setWebviewAuthSuccess(true);
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        };
        const urlToken = urlParams.get("token");
        if (urlToken) {
          postToken(urlToken);
        } else {
          getCurrentToken()
            .then((token) => postToken(token ?? ""))
            .catch(() => postToken(""));
        }
        return;
      }
      getUserInfo()
        .then((meRes) => {
          storeAuth(meRes.username || "");
          onLogin(
            meRes.username || "",
            meRes.userId || undefined,
            !!meRes.is_admin,
          );
          // 260910-pf4: redirect to validated return URL if present
          if (tryReturnUrlRedirect()) return;
          window.history.replaceState(
            {},
            document.title,
            window.location.pathname,
          );
        })
        .catch(() => {
          toast.error(t("errors.failedUserInfo"));
        });
    }
  }, [onLogin, t]);

  function resetAll() {
    setUsername("");
    setPassword("");
    setConfirmPassword("");
    setTotpCode("");
    setTotpTempToken("");
  }

  function switchView(v: AuthView) {
    resetAll();
    setView(v);
  }

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      toast.error(t("errors.requiredField"));
      return;
    }
    setLoading(true);
    try {
      const res = await loginUser(username.trim(), password);
      if (res.requires_totp) {
        setTotpTempToken(res.temp_token);
        setView("totp");
        return;
      }
      if (!res?.success) throw new Error(t("errors.loginFailed"));
      if (isInMobileWebView()) {
        // Native-app requests get the JWT in the login response body.
        const token = res?.token ?? "";
        (window as ExtendedWindow).ReactNativeWebView?.postMessage(
          JSON.stringify({ type: "AUTH_SUCCESS", token }),
        );
        setWebviewAuthSuccess(true);
        return;
      }
      const meRes = await getUserInfo();
      storeAuth(meRes.username || username.trim());
      toast.success(t("messages.loginSuccess"));
      onLogin(
        meRes.username || username.trim(),
        meRes.userId || undefined,
        !!meRes.is_admin,
      );
      // 260910-pf4: redirect to validated return URL if present
      if (tryReturnUrlRedirect()) return;
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string } };
      };
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("errors.unknownError"),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim()) {
      toast.error(t("errors.requiredField"));
      return;
    }
    if (password.length < 6) {
      toast.error(t("errors.minLength", { min: 6 }));
      return;
    }
    if (password !== confirmPassword) {
      toast.error(t("errors.passwordMismatch"));
      return;
    }
    setLoading(true);
    try {
      await registerUser(
        username.trim(),
        password,
        await makeInitialAvatar(username.trim()),
      );
      const res = await loginUser(username.trim(), password);
      if (res.requires_totp) {
        setTotpTempToken(res.temp_token);
        setView("totp");
        return;
      }
      const meRes = await getUserInfo();
      storeAuth(meRes.username || username.trim());
      toast.success(t("messages.registrationSuccess"));
      onLogin(
        meRes.username || username.trim(),
        meRes.userId || undefined,
        !!meRes.is_admin,
      );
      // 260910-pf4: redirect to validated return URL if present
      if (tryReturnUrlRedirect()) return;
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string } };
      };
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("errors.unknownError"),
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleTOTP(e: React.FormEvent) {
    e.preventDefault();
    if (totpCode.length !== 6) {
      toast.error(t("auth.enterCode"));
      return;
    }
    setLoading(true);
    try {
      const res = await verifyTOTPLogin(totpTempToken, totpCode);
      if (!res?.success) throw new Error(t("errors.loginFailed"));
      if (isInMobileWebView()) {
        // Native-app requests get the JWT in the login response body.
        const token = res?.token ?? "";
        (window as ExtendedWindow).ReactNativeWebView?.postMessage(
          JSON.stringify({ type: "AUTH_SUCCESS", token }),
        );
        setWebviewAuthSuccess(true);
        return;
      }
      storeAuth(res.username || username);
      toast.success(t("messages.loginSuccess"));
      onLogin(
        res.username || username,
        res.userId || undefined,
        !!res.is_admin,
      );
      // 260910-pf4: redirect to validated return URL if present
      if (tryReturnUrlRedirect()) return;
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string; code?: string } };
      };
      if (error?.response?.data?.code === "SESSION_EXPIRED") {
        setView("login");
        toast.error(t("errors.sessionExpired"));
        return;
      }
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("errors.invalidTotpCode"),
      );
    } finally {
      setLoading(false);
    }
  }

  const handleOIDCLogin = useCallback(async () => {
    setOidcLoading(true);
    try {
      const authResponse = await getOIDCAuthorizeUrl(false);
      const { auth_url: authUrl } = authResponse;
      if (!authUrl || authUrl === "undefined")
        throw new Error(t("errors.invalidAuthUrl"));
      window.location.replace(authUrl);
    } catch (err: unknown) {
      const error = err as {
        message?: string;
        response?: { data?: { error?: string } };
      };
      toast.error(
        error?.response?.data?.error ||
          error?.message ||
          t("errors.failedOidcLogin"),
      );
      setOidcLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!oidcConfigLoaded || silentSigninHandledRef.current) return;
    if (!shouldTriggerSilentSignin(window.location.search)) return;

    const nextSearch = removeSilentSigninFromSearch(window.location.search);
    window.history.replaceState(
      {},
      document.title,
      `${window.location.pathname}${nextSearch}${window.location.hash}`,
    );

    silentSigninHandledRef.current = true;
    if (oidcConfigured) {
      handleOIDCLogin();
      return;
    }

    toast.info(t("errors.silentSigninOidcUnavailable"));
  }, [handleOIDCLogin, oidcConfigLoaded, oidcConfigured, t]);

  if (webviewAuthSuccess)
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[color:var(--color-pv-base)]">
        <div className="text-center">
          <CheckCircle2 className="size-12 text-[color:var(--color-pv-code-fg)] mx-auto mb-4" />
          <p className="text-[color:var(--color-pv-fg-muted)]">{t("auth.redirectingToApp")}</p>
        </div>
      </div>
    );

  if (dbConnectionFailed)
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[color:var(--color-pv-base)] p-6">
        <div className="flex flex-col gap-5 p-6 border border-[color:var(--color-pv-border-quiet-strong)] bg-[color:var(--color-pv-surface-quiet)] max-w-sm w-full">
          <div className="flex flex-col gap-1">
            <p className="font-bold text-[color:var(--color-pv-code-fg)]">
              {t("errors.databaseConnection")}
            </p>
            <p className="text-sm text-[color:var(--color-pv-fg-muted)]">
              {t("messages.databaseConnectionFailed")}
            </p>
          </div>
          <Button onClick={() => window.location.reload()}>
            {t("common.refresh")}
          </Button>
          <div className="flex items-center justify-between pt-2 border-t border-[color:var(--color-pv-border-quiet)]">
            <span className="text-xs text-[color:var(--color-pv-fg-muted)]">
              {t("common.language")}
            </span>
            <select
              value={language}
              onChange={(e) => handleLanguageChange(e.target.value)}
              className="px-2.5 py-1.5 text-xs bg-[color:var(--color-pv-base)] border border-[color:var(--color-pv-border-quiet-strong)] text-[color:var(--color-pv-fg)] outline-none focus:ring-1 focus:ring-[hsla(var(--pv-hue,35),70%,55%,0.35)]"
            >
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {lang.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    );

  if (dbHealthChecking)
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-[color:var(--color-pv-base)]">
        <div className="w-5 h-5 border-2 border-[hsla(var(--pv-hue,35),65%,55%,0.7)] border-t-transparent rounded-full animate-spin" />
      </div>
    );

  return (
    <div
      className="fixed inset-0 flex flex-col bg-[color:var(--color-pv-base)] overflow-hidden"
      style={{ "--pv-hue": "190", "--color-pv-code-fg": "#92eafc" } as React.CSSProperties}
    >
      <div className="flex flex-1 overflow-hidden">
        {/* Right panel */}
        <div className="flex flex-1 items-center justify-center p-6 overflow-y-auto relative">
          <div className="w-full max-w-sm flex flex-col gap-6">
            {/* TOTP view */}
            {view === "totp" && (
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-1">
                  <h1 className="text-xl font-bold">
                    {t("auth.twoFactorAuth")}
                  </h1>
                  <p className="text-xs text-[color:var(--color-pv-fg-muted)]">
                    {t("auth.enterCode")}
                  </p>
                </div>
                <form onSubmit={handleTOTP} className="flex flex-col gap-4">
                  <Field label={t("auth.verifyCode")} htmlFor="totp-code">
                    <Input
                      ref={totpInputRef}
                      id="totp-code"
                      type="text"
                      placeholder="000000"
                      maxLength={6}
                      value={totpCode}
                      onChange={(e) =>
                        setTotpCode(e.target.value.replace(/\D/g, ""))
                      }
                      disabled={loading}
                      className="text-center text-2xl tracking-widest font-mono"
                      autoComplete="one-time-code"
                    />
                  </Field>
                  <Button
                    type="submit"
                    className="w-full font-bold"
                    disabled={loading || totpCode.length !== 6}
                  >
                    {loading ? t("common.loading") : t("auth.verifyCode")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full"
                    onClick={() => switchView("login")}
                    disabled={loading}
                  >
                    {t("common.cancel")}
                  </Button>
                </form>
              </div>
            )}

            {/* Login / Register / External */}
            {(view === "login" ||
              view === "register" ||
              view === "external") && (
              <div className="flex flex-col gap-5">
                <div className="flex items-center justify-center gap-3 select-none">
                  <img
                    src={brandingConfig.iconPath}
                    alt=""
                    className="h-12 w-12 shrink-0"
                    draggable={false}
                  />
                  <img
                    src={brandingConfig.wordmarkPath}
                    alt={brandingConfig.appName}
                    className="h-8 w-auto"
                    draggable={false}
                  />
                </div>

                {view === "external" && (
                  <div className="flex flex-col gap-4">
                    <Button
                      onClick={handleOIDCLogin}
                      disabled={oidcLoading}
                      className="w-full font-bold"
                    >
                      {oidcLoading
                        ? t("common.loading")
                        : t("auth.loginWithExternal")}
                    </Button>
                  </div>
                )}

                {view === "login" && (
                  <form onSubmit={handleLogin} className="flex flex-col gap-4">
                    <Field label={t("common.username")} htmlFor="login-user">
                      <div className="relative">
                        <User className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-[color:var(--color-pv-fg-muted)] pointer-events-none" />
                        <Input
                          id="login-user"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="username"
                          className="pl-8"
                          disabled={loading}
                          autoFocus
                          autoComplete="username"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                      </div>
                    </Field>
                    <Field label={t("common.password")} htmlFor="login-pass">
                      <PasswordInput
                        id="login-pass"
                        value={password}
                        onChange={setPassword}
                        disabled={loading}
                      />
                    </Field>
                    <Button
                      type="submit"
                      className="w-full font-bold h-10"
                      disabled={loading}
                    >
                      {loading ? (
                        t("common.loading")
                      ) : (
                        <span className="flex items-center gap-2">
                          <KeyRound className="size-4" />
                          {t("common.login")}
                        </span>
                      )}
                    </Button>
                  </form>
                )}

                {view === "register" && (
                  <form
                    onSubmit={handleRegister}
                    className="flex flex-col gap-4"
                  >
                    <Field label={t("common.username")} htmlFor="reg-user">
                      <div className="relative">
                        <User className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-[color:var(--color-pv-fg-muted)] pointer-events-none" />
                        <Input
                          id="reg-user"
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          placeholder="choose_a_username"
                          className="pl-8"
                          disabled={loading}
                          autoFocus
                          autoComplete="username"
                          autoCorrect="off"
                          autoCapitalize="none"
                          spellCheck={false}
                        />
                      </div>
                    </Field>
                    <Field label={t("common.password")} htmlFor="reg-pass">
                      <PasswordInput
                        id="reg-pass"
                        value={password}
                        onChange={setPassword}
                        placeholder={t("auth.minChars", {
                          min: 6,
                          defaultValue: "min. 6 characters",
                        })}
                        disabled={loading}
                      />
                    </Field>
                    <Field
                      label={t("common.confirmPassword")}
                      htmlFor="reg-confirm"
                    >
                      <PasswordInput
                        id="reg-confirm"
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                        disabled={loading}
                      />
                    </Field>
                    <Button
                      type="submit"
                      className="w-full font-bold h-10"
                      disabled={loading}
                    >
                      {loading ? (
                        t("common.loading")
                      ) : (
                        <span className="flex items-center gap-2">
                          <Shield className="size-4" />
                          {t("auth.signUp")}
                        </span>
                      )}
                    </Button>
                  </form>
                )}

              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
