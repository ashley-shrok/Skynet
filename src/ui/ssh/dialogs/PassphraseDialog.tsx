import React from "react";
import { Button } from "@/components/button.tsx";
import { PasswordInput } from "@/components/password-input.tsx";
import { KeyRound } from "lucide-react";
import { useTranslation } from "react-i18next";

interface PassphraseDialogProps {
  isOpen: boolean;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
  hostInfo: { ip: string; port: number; username: string; name?: string };
  backgroundColor?: string;
}

export function PassphraseDialog({
  isOpen,
  onSubmit,
  onCancel,
  hostInfo,
  backgroundColor,
}: PassphraseDialogProps) {
  const { t } = useTranslation();

  if (!isOpen) return null;

  const hostDisplay = hostInfo.name
    ? `${hostInfo.name} (${hostInfo.username}@${hostInfo.ip}:${hostInfo.port})`
    : `${hostInfo.username}@${hostInfo.ip}:${hostInfo.port}`;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const input = e.currentTarget.elements.namedItem(
      "passphrase",
    ) as HTMLInputElement;
    if (input?.value) {
      onSubmit(input.value);
    }
  };

  return (
    <div className="absolute inset-0 flex items-center justify-center z-500 animate-in fade-in duration-200">
      <div
        className="absolute inset-0 bg-[color:var(--color-pv-base)] rounded-md"
        style={{ backgroundColor: backgroundColor || undefined }}
      />
      <div className="bg-[linear-gradient(180deg,rgba(28,30,40,0.92),rgba(18,20,28,0.95))] border border-[color:var(--color-pv-border-quiet-strong)] rounded-[var(--radius-pv-card)] shadow-[0_30px_80px_rgba(0,0,0,0.7),inset_0_1px_0_rgba(220,225,245,0.08)] backdrop-blur-xl [backdrop-filter:blur(28px)_saturate(1.35)] w-full max-w-sm mx-4 relative z-10 animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 border-b border-[color:var(--color-pv-border-quiet)]">
          <div className="flex items-center gap-2">
            <KeyRound className="size-4 text-[color:var(--color-pv-code-fg)]" />
            <h3 className="text-xs font-bold uppercase tracking-widest text-[color:var(--color-pv-fg)]">
              {t("auth.passphraseRequired")}
            </h3>
          </div>
          <p className="text-[10px] font-mono font-bold tracking-tight text-[color:var(--color-pv-fg-muted)] mt-1">
            {hostDisplay}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="p-4 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <PasswordInput
              id="passphrase"
              name="passphrase"
              autoFocus
              placeholder={t("placeholders.keyPassword")}
              className="text-xs"
            />
            <p className="text-[10px] text-[color:var(--color-pv-fg-muted)]">
              {t("auth.passphraseRequiredDescription")}
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={onCancel}
              className="text-[10px] font-bold uppercase tracking-widest"
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="submit"
              variant="default"
              className="text-[10px] font-bold uppercase tracking-widest"
            >
              {t("common.connect")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
