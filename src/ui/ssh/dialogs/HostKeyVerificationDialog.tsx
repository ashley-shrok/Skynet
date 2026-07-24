import React, { useState } from "react";
import { Button } from "@/components/button.tsx";
import { Shield, AlertTriangle, Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";

interface HostKeyVerificationDialogProps {
  isOpen: boolean;
  scenario: "new" | "changed";
  ip: string;
  port: number;
  hostname?: string;
  fingerprint: string;
  oldFingerprint?: string;
  keyType: string;
  oldKeyType?: string;
  algorithm: string;
  onAccept: () => void;
  onReject: () => void;
  backgroundColor?: string;
}

export function HostKeyVerificationDialog({
  isOpen,
  scenario,
  ip,
  port,
  hostname,
  fingerprint,
  oldFingerprint,
  algorithm,
  onAccept,
  onReject,
  backgroundColor,
}: HostKeyVerificationDialogProps) {
  const { t } = useTranslation();
  const [copiedFingerprint, setCopiedFingerprint] = useState(false);
  const [copiedOldFingerprint, setCopiedOldFingerprint] = useState(false);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, isOld: boolean = false) => {
    navigator.clipboard.writeText(text);
    if (isOld) {
      setCopiedOldFingerprint(true);
      setTimeout(() => setCopiedOldFingerprint(false), 2000);
    } else {
      setCopiedFingerprint(true);
      setTimeout(() => setCopiedFingerprint(false), 2000);
    }
  };

  const formatFingerprint = (fp: string) =>
    fp.match(/.{1,2}/g)?.join(":") || fp;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-[color:var(--color-pv-base)] rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-[linear-gradient(180deg,rgba(28,30,40,0.92),rgba(18,20,28,0.95))] border border-[color:var(--color-pv-border-quiet-strong)] rounded-[var(--radius-pv-card)] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(220,225,245,0.08)] backdrop-blur-xl [backdrop-filter:blur(28px)_saturate(1.35)] w-full max-w-lg mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-[color:var(--color-pv-border-quiet)]">
          <div className="flex items-center gap-2">
            {scenario === "new" ? (
              <Shield className="size-4 text-[color:var(--color-pv-code-fg)]" />
            ) : (
              <AlertTriangle className="size-4 text-[color:var(--color-pv-code-fg)]" />
            )}
            <h3 className="text-xs font-bold uppercase tracking-widest">
              {scenario === "new"
                ? t("hostKey.verifyNewHost")
                : t("hostKey.keyChangedWarning")}
            </h3>
          </div>
          <p className="text-[10px] font-mono font-bold tracking-tight text-[color:var(--color-pv-fg-muted)] mt-1">
            {hostname || ip}:{port}
          </p>
        </div>

        <div className="p-4 flex flex-col gap-4">
          {scenario === "new" ? (
            <>
              <div className="flex items-start gap-3 p-3 border border-[color:var(--color-pv-border-quiet)] bg-[color:var(--color-pv-surface-quiet)]">
                <Shield className="size-4 text-[color:var(--color-pv-code-fg)] shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest">
                    {t("hostKey.firstConnectionTitle")}
                  </p>
                  <p className="text-xs text-[color:var(--color-pv-fg-muted)] mt-1">
                    {t("hostKey.firstConnectionDescription")}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
                  {t("hostKey.fingerprint")} ({algorithm.toUpperCase()})
                </p>
                <div className="flex items-center gap-2">
                  <div className="flex-1  border border-[color:var(--color-pv-border-quiet)] p-3 font-mono text-xs break-all">
                    {formatFingerprint(fingerprint)}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(fingerprint)}
                    className=" shrink-0"
                  >
                    {copiedFingerprint ? (
                      <Check className="size-4 text-[color:var(--color-pv-code-fg)]" />
                    ) : (
                      <Copy className="size-4" />
                    )}
                  </Button>
                </div>
              </div>

              <p className="text-[10px] text-[color:var(--color-pv-fg-muted)]">
                {t("hostKey.verifyInstructions")}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3 p-3 border border-destructive/20 bg-destructive/10">
                <AlertTriangle className="size-4 text-[color:var(--color-pv-code-fg)] shrink-0 mt-0.5" />
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-code-fg)]">
                    {t("hostKey.securityWarning")}
                  </p>
                  <p className="text-xs text-[color:var(--color-pv-code-fg)] mt-1">
                    {t("hostKey.keyChangedDescription")}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
                    {t("hostKey.previousKey")}
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1  border border-[color:var(--color-pv-border-quiet)] p-3 font-mono text-xs break-all">
                      {formatFingerprint(oldFingerprint || "")}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() =>
                        copyToClipboard(oldFingerprint || "", true)
                      }
                      className=" shrink-0"
                    >
                      {copiedOldFingerprint ? (
                        <Check className="size-4 text-[color:var(--color-pv-code-fg)]" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-[color:var(--color-pv-fg-muted)]">
                    {t("hostKey.newFingerprint")}
                  </p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1  border border-[color:var(--color-pv-border-quiet)] p-3 font-mono text-xs break-all">
                      {formatFingerprint(fingerprint)}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(fingerprint)}
                      className=" shrink-0"
                    >
                      {copiedFingerprint ? (
                        <Check className="size-4 text-[color:var(--color-pv-code-fg)]" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="p-4 border-t border-[color:var(--color-pv-border-quiet)] flex justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onReject}
            className=" text-[10px] font-bold uppercase tracking-widest"
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            onClick={onAccept}
            variant="outline"
            className={
              scenario === "changed"
                ? "border-destructive/40 text-[color:var(--color-pv-code-fg)] hover:bg-destructive/10  text-[10px] font-bold uppercase tracking-widest"
                : " text-[10px] font-bold uppercase tracking-widest"
            }
          >
            {scenario === "new"
              ? t("hostKey.acceptAndContinue")
              : t("hostKey.acceptNewKey")}
          </Button>
        </div>
      </div>
    </div>
  );
}
