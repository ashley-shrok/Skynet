// ElectronVersionCheck — required-shell modal that gates the app on
// launch when running under Electron until either (a) version-check
// completes with the running version up-to-date, or (b) the user
// dismisses the update-required notice via Continue.
//
// Modal-unification 2026-09-29:
//   - Shell: canonical <Modal hue={40} size="md" dismissible={false}>.
//     Same "required-shell" pattern as SkewLockModal — warm amber hue,
//     non-dismissible (only path forward is the Continue button OR a
//     completed up-to-date check auto-firing onContinue).
//   - Head: canonical <ModalHead title="..." hideClose />.
//   - Foot: canonical <ModalFoot> with Continue button (or checking-
//     state: no foot, spinner in body).
//
// This modal was not sketched in the tasting reference, but the identity
// file lists it as arc scope paired with SkewLockModal ("required-shell
// pair"). It inherits SkewLockModal's shell shape.

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/button.tsx";
import { VersionAlert } from "@/components/version-alert.tsx";
import { useTranslation } from "react-i18next";
import { isElectron } from "@/lib/electron";
import { checkElectronUpdate } from "@/main-axios.ts";
import { Modal, ModalHead, ModalBody, ModalFoot } from "@/components/modal";

interface VersionCheckModalProps {
  onContinue: () => void;
}

type ElectronWindow = Window & {
  electronAPI?: {
    getAppVersion?: () => Promise<string | undefined>;
  };
};

export function ElectronVersionCheck({ onContinue }: VersionCheckModalProps) {
  const { t } = useTranslation();
  const [versionInfo, setVersionInfo] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [versionChecking, setVersionChecking] = useState(false);
  const [versionDismissed] = useState(false);

  const versionModalTitle =
    versionInfo?.status === "beta"
      ? t("versionCheck.betaVersion")
      : t("versionCheck.updateRequired");

  const checkForUpdates = useCallback(async () => {
    setVersionChecking(true);
    try {
      const updateInfo = await checkElectronUpdate();
      setVersionInfo(updateInfo);

      const currentVersion = await (
        window as ElectronWindow
      ).electronAPI?.getAppVersion?.();
      const dismissedVersion = localStorage.getItem(
        "electron-version-check-dismissed",
      );

      if (dismissedVersion === currentVersion) {
        onContinue();
        return;
      }

      if (updateInfo?.status === "up_to_date") {
        if (currentVersion) {
          localStorage.setItem(
            "electron-version-check-dismissed",
            currentVersion,
          );
        }
        onContinue();
        return;
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
      setVersionInfo({ success: false, error: "Check failed" });
    } finally {
      setVersionChecking(false);
    }
  }, [onContinue]);

  useEffect(() => {
    const updateCheckDisabled =
      localStorage.getItem("disableUpdateCheck") === "true";
    if (updateCheckDisabled) {
      onContinue();
      return;
    }
    if (isElectron()) {
      checkForUpdates();
    } else {
      onContinue();
    }
  }, [checkForUpdates, onContinue]);

  const handleDownloadUpdate = () => {
    if (versionInfo?.latest_release?.html_url) {
      window.open(versionInfo.latest_release.html_url, "_blank");
    }
  };

  const handleContinue = async () => {
    const currentVersion = await (
      window as ElectronWindow
    ).electronAPI?.getAppVersion?.();
    if (currentVersion) {
      localStorage.setItem("electron-version-check-dismissed", currentVersion);
    }
    onContinue();
  };

  if (!isElectron()) {
    return null;
  }

  // Checking state — spinner, no foot.
  if (versionChecking && !versionInfo) {
    return (
      <Modal
        open={true}
        onOpenChange={() => {
          /* non-dismissible */
        }}
        hue={40}
        size="md"
        dismissible={false}
        data-testid="electron-version-check-modal"
      >
        <ModalHead title={t("versionCheck.checkingUpdates")} hideClose />
        <ModalBody className="flex items-center justify-center py-8">
          <div className="w-5 h-5 border-2 border-[hsla(var(--pv-id-hue),65%,55%,0.6)] border-t-transparent rounded-full animate-spin" />
        </ModalBody>
      </Modal>
    );
  }

  const bodyContent =
    !versionInfo || versionDismissed ? (
      <>
        {versionInfo && !versionDismissed && (
          <VersionAlert
            updateInfo={versionInfo}
            onDownload={handleDownloadUpdate}
          />
        )}
      </>
    ) : (
      <VersionAlert
        updateInfo={versionInfo}
        onDownload={handleDownloadUpdate}
      />
    );

  const title =
    !versionInfo || versionDismissed
      ? t("versionCheck.checkUpdates")
      : versionModalTitle;

  return (
    <Modal
      open={true}
      onOpenChange={() => {
        /* non-dismissible */
      }}
      hue={40}
      size="md"
      dismissible={false}
      data-testid="electron-version-check-modal"
    >
      <ModalHead title={title} hideClose />
      <ModalBody>{bodyContent}</ModalBody>
      <ModalFoot className="justify-center">
        <Button
          onClick={handleContinue}
          className="w-full font-bold"
          data-testid="electron-version-check-continue"
        >
          {t("common.continue")}
        </Button>
      </ModalFoot>
    </Modal>
  );
}
