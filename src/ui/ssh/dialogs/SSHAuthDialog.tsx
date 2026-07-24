import React, { useState } from "react";
import { Button } from "@/components/button.tsx";
import { PasswordInput } from "@/components/password-input.tsx";
import { Label } from "@/components/label.tsx";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/tabs.tsx";
import { Shield, AlertCircle, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";
import CodeMirror from "@uiw/react-codemirror";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";

interface SSHAuthDialogProps {
  isOpen: boolean;
  reason: "no_keyboard" | "auth_failed" | "timeout";
  onSubmit: (credentials: {
    password?: string;
    sshKey?: string;
    keyPassword?: string;
  }) => void;
  onCancel: () => void;
  hostInfo: {
    ip: string;
    port: number;
    username: string;
    name?: string;
  };
  backgroundColor?: string;
}

export function SSHAuthDialog({
  isOpen,
  reason,
  onSubmit,
  onCancel,
  hostInfo,
  backgroundColor,
}: SSHAuthDialogProps) {
  const { t } = useTranslation();
  const [authTab, setAuthTab] = useState<"password" | "key">("password");
  const [password, setPassword] = useState("");
  const [sshKey, setSshKey] = useState("");
  const [keyPassword, setKeyPassword] = useState("");
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const hostDisplay = hostInfo.name
    ? `${hostInfo.name} (${hostInfo.username}@${hostInfo.ip}:${hostInfo.port})`
    : `${hostInfo.username}@${hostInfo.ip}:${hostInfo.port}`;

  const getReasonMessage = () => {
    switch (reason) {
      case "no_keyboard":
        return t("auth.sshNoKeyboardInteractive");
      case "auth_failed":
        return t("auth.sshAuthenticationFailed");
      case "timeout":
        return t("auth.sshAuthenticationTimeout");
      default:
        return t("auth.sshAuthenticationRequired");
    }
  };

  const getReasonDescription = () => {
    switch (reason) {
      case "no_keyboard":
        return t("auth.sshNoKeyboardInteractiveDescription");
      case "auth_failed":
        return t("auth.sshAuthFailedDescription");
      case "timeout":
        return t("auth.sshTimeoutDescription");
      default:
        return t("auth.sshProvideCredentialsDescription");
    }
  };

  const canSubmit = () =>
    authTab === "password" ? password !== "" : sshKey.trim() !== "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const credentials: {
        password?: string;
        sshKey?: string;
        keyPassword?: string;
      } = {};
      if (authTab === "password") {
        if (password !== "") credentials.password = password;
      } else {
        if (sshKey.trim()) {
          credentials.sshKey = sshKey;
          if (keyPassword.trim()) credentials.keyPassword = keyPassword;
        }
      }
      onSubmit(credentials);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyFileUpload = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      try {
        setSshKey(await file.text());
      } catch (error) {
        console.error("Failed to read SSH key file:", error);
      }
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-[color:var(--color-pv-base)] rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-[linear-gradient(180deg,rgba(28,30,40,0.92),rgba(18,20,28,0.95))] border border-[color:var(--color-pv-border-quiet-strong)] rounded-[var(--radius-pv-card)] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(220,225,245,0.08)] backdrop-blur-xl [backdrop-filter:blur(28px)_saturate(1.35)] w-full max-w-xl mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-[color:var(--color-pv-border-quiet)]">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-[color:var(--color-pv-code-fg)]" />
            <h3 className="text-xs font-bold uppercase tracking-widest">
              {t("auth.sshAuthenticationRequired")}
            </h3>
          </div>
          <p className="text-[10px] font-mono font-bold tracking-tight text-[color:var(--color-pv-fg-muted)] mt-1">
            {hostDisplay}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-4 flex flex-col gap-4">
            <div
              className={`flex items-start gap-3 p-3 border ${
                reason === "auth_failed"
                  ? "border-destructive/20 bg-destructive/10"
                  : "border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)]"
              }`}
            >
              <AlertCircle
                className={`size-4 shrink-0 mt-0.5 ${reason === "auth_failed" ? "text-[color:var(--color-pv-code-fg)]" : "text-[color:var(--color-pv-code-fg)]"}`}
              />
              <div>
                <p
                  className={`text-[10px] font-bold uppercase tracking-widest ${reason === "auth_failed" ? "text-[color:var(--color-pv-code-fg)]" : ""}`}
                >
                  {getReasonMessage()}
                </p>
                <p
                  className={`text-xs mt-1 ${reason === "auth_failed" ? "text-[color:var(--color-pv-code-fg)]" : "text-[color:var(--color-pv-fg-muted)]"}`}
                >
                  {getReasonDescription()}
                </p>
              </div>
            </div>

            <Tabs
              value={authTab}
              onValueChange={(v) => setAuthTab(v as "password" | "key")}
            >
              <TabsList className="w-full ">
                <TabsTrigger
                  value="password"
                  className="flex-1  text-[10px] font-bold uppercase tracking-widest"
                >
                  {t("credentials.password")}
                </TabsTrigger>
                <TabsTrigger
                  value="key"
                  className="flex-1  text-[10px] font-bold uppercase tracking-widest"
                >
                  {t("credentials.sshKey")}
                </TabsTrigger>
              </TabsList>

              <TabsContent
                value="password"
                className="mt-3 flex flex-col gap-2"
              >
                <Label className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
                  {t("credentials.password")}
                </Label>
                <PasswordInput
                  placeholder={t("placeholders.enterPassword")}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoFocus
                  className=" border-[color:var(--color-pv-border-quiet-strong)] text-xs"
                />
                <p className="text-[10px] text-[color:var(--color-pv-fg-muted)]">
                  {t("auth.sshPasswordDescription")}
                </p>
              </TabsContent>

              <TabsContent value="key" className="mt-3 flex flex-col gap-3">
                <div className="flex flex-col gap-2">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
                    {t("credentials.sshPrivateKey")}
                  </Label>
                  <div className="relative">
                    <input
                      id="key-upload"
                      type="file"
                      accept="*,.pem,.key,.txt,.ppk"
                      onChange={handleKeyFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="w-full justify-start  text-[10px] font-bold uppercase tracking-widest border-[color:var(--color-pv-border-quiet)]"
                    >
                      <Upload className="size-3.5 mr-2" />
                      <span className="truncate">
                        {t("credentials.uploadPrivateKeyFile")}
                      </span>
                    </Button>
                  </div>
                  <CodeMirror
                    value={sshKey}
                    onChange={(value) => setSshKey(value)}
                    placeholder={t("placeholders.pastePrivateKey")}
                    theme={oneDark}
                    className="border border-[color:var(--color-pv-border-quiet)] text-xs"
                    minHeight="160px"
                    maxHeight="260px"
                    basicSetup={{
                      lineNumbers: true,
                      foldGutter: false,
                      dropCursor: false,
                      allowMultipleSelections: false,
                      highlightSelectionMatches: false,
                      searchKeymap: false,
                      scrollPastEnd: false,
                    }}
                    extensions={[
                      EditorView.theme({
                        ".cm-scroller": {
                          overflow: "auto",
                          scrollbarWidth: "thin",
                          scrollbarColor:
                            "var(--scrollbar-thumb) var(--scrollbar-track)",
                        },
                      }),
                    ]}
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <Label className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
                    {t("credentials.keyPassword")} ({t("common.optional")})
                  </Label>
                  <PasswordInput
                    placeholder={t("placeholders.keyPassword")}
                    value={keyPassword}
                    onChange={(e) => setKeyPassword(e.target.value)}
                    className=" border-[color:var(--color-pv-border-quiet-strong)] text-xs"
                  />
                  <p className="text-[10px] text-[color:var(--color-pv-fg-muted)]">
                    {t("auth.sshKeyPasswordDescription")}
                  </p>
                </div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="p-4 border-t border-[color:var(--color-pv-border-quiet)] flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              disabled={loading}
              className=" text-[10px] font-bold uppercase tracking-widest"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="outline"
              disabled={!canSubmit() || loading}
              className=" text-[10px] font-bold uppercase tracking-widest"
            >
              {loading ? t("common.connecting") : t("common.connect")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
