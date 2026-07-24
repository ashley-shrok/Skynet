import React from "react";
import { Button } from "@/components/button.tsx";
import { Shield, ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

interface OPKSSHDialogProps {
  isOpen: boolean;
  authUrl: string;
  requestId: string;
  stage: "chooser" | "waiting" | "authenticating" | "completed" | "error";
  error?: string;
  providers?: Array<{ alias: string; issuer: string }>;
  onCancel: () => void;
  onOpenUrl: () => void;
  onSelectProvider?: (alias: string) => void;
  backgroundColor?: string;
}

export function OPKSSHDialog({
  isOpen,
  authUrl,
  stage,
  error,
  providers,
  onCancel,
  onOpenUrl,
  onSelectProvider,
  backgroundColor,
}: OPKSSHDialogProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-[color:var(--color-pv-base)] rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-[linear-gradient(180deg,rgba(28,30,40,0.92),rgba(18,20,28,0.95))] border border-[color:var(--color-pv-border-quiet-strong)] rounded-[var(--radius-pv-card)] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(220,225,245,0.08)] backdrop-blur-xl [backdrop-filter:blur(28px)_saturate(1.35)] w-full max-w-md mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-[color:var(--color-pv-border-quiet)]">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-[color:var(--color-pv-code-fg)]" />
            <h3 className="text-xs font-bold uppercase tracking-widest">
              {t("terminal.opksshAuthRequired")}
            </h3>
          </div>
          {stage === "chooser" && (
            <p className="text-[10px] font-bold uppercase tracking-tight text-[color:var(--color-pv-fg-muted)] mt-1">
              {t("terminal.opksshAuthDescription")}
            </p>
          )}
        </div>
        <div className="p-4 flex flex-col gap-4">
          {stage === "chooser" && (
            <>
              {providers && providers.length > 0 && onSelectProvider ? (
                <div className="flex flex-col gap-2">
                  {providers.map((provider) => (
                    <Button
                      key={provider.alias}
                      type="button"
                      variant="outline"
                      onClick={() => onSelectProvider(provider.alias)}
                      className=" text-[10px] font-bold uppercase tracking-widest w-full flex items-center gap-2"
                    >
                      <ExternalLink className="size-3.5" />
                      {t("terminal.opksshSignInWith", {
                        provider:
                          provider.alias.charAt(0).toUpperCase() +
                          provider.alias.slice(1),
                      })}
                    </Button>
                  ))}
                </div>
              ) : authUrl ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onOpenUrl}
                  className=" text-[10px] font-bold uppercase tracking-widest w-full flex items-center gap-2"
                >
                  <ExternalLink className="size-3.5" />
                  {t("terminal.opksshOpenBrowser")}
                </Button>
              ) : null}
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onCancel}
                  className=" text-[10px] font-bold uppercase tracking-widest"
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          )}

          {(stage === "waiting" || stage === "authenticating") && (
            <>
              <div className="flex items-center gap-3 py-2">
                <Loader2 className="size-4 animate-spin text-[color:var(--color-pv-code-fg)] shrink-0" />
                <p className="text-xs text-[color:var(--color-pv-fg-muted)]">
                  {stage === "waiting"
                    ? t("terminal.opksshWaitingForAuth")
                    : t("terminal.opksshAuthenticating")}
                </p>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onCancel}
                  className=" text-[10px] font-bold uppercase tracking-widest"
                >
                  {t("common.cancel")}
                </Button>
              </div>
            </>
          )}

          {stage === "error" && error && (
            <>
              <div className="flex items-start gap-3 p-3 border border-destructive/20 bg-destructive/10">
                <AlertCircle className="size-4 text-[color:var(--color-pv-code-fg)] shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-code-fg)]">
                    {t("common.error")}
                  </p>
                  <p className="text-xs text-[color:var(--color-pv-code-fg)]/90 mt-1 whitespace-pre-wrap break-words">
                    {error}
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onCancel}
                  className=" text-[10px] font-bold uppercase tracking-widest"
                >
                  {t("common.close")}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
