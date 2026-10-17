/**
 * Admin → System: running version and update check, database health, the
 * backend log level, and the read-aloud services the server is configured
 * with (read-only).
 */

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { getAdminDbHealth, getVersionInfo } from "@/api/system-status-api";
import { getLogLevel, updateLogLevel } from "@/api/settings-api";
import { getTtsProviders, type TtsProviderStatus } from "@/api/voice-api";
import {
  KitBanner,
  KitButton,
  KitChip,
  KitSelect,
  KitSettingsGroup,
  KitSettingsRow,
} from "@/components/kit";
import { adminErrorMessage } from "./admin-ui";

const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

interface VersionState {
  localVersion?: string;
  status?: string;
  remoteVersion?: string;
  releaseUrl?: string;
}

const UPDATE_STATUS_TEXT: Record<string, string> = {
  up_to_date: "Up to date",
  requires_update: "Update available",
  beta: "Ahead of the latest release",
  update_check_disabled: "Not checked",
};

export function AdminSystemPane() {
  const [version, setVersion] = useState<VersionState | null>(null);
  const [checking, setChecking] = useState(false);
  const [versionError, setVersionError] = useState<string | null>(null);

  const [dbStatus, setDbStatus] = useState<"checking" | "ok" | "error">(
    "checking",
  );

  const [logLevel, setLogLevel] = useState<string | null>(null);
  const [logBusy, setLogBusy] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  const [tts, setTts] = useState<{
    primary: TtsProviderStatus;
    backup: TtsProviderStatus;
  } | null>(null);
  const [ttsError, setTtsError] = useState<string | null>(null);

  const loadVersion = async (checkRemote: boolean) => {
    setChecking(true);
    setVersionError(null);
    try {
      const info = await getVersionInfo(checkRemote);
      const release = info.latest_release as { html_url?: string } | undefined;
      setVersion({
        localVersion:
          typeof info.localVersion === "string" ? info.localVersion : undefined,
        status: typeof info.status === "string" ? info.status : undefined,
        remoteVersion:
          typeof info.remoteVersion === "string"
            ? info.remoteVersion
            : undefined,
        releaseUrl: release?.html_url,
      });
    } catch (err) {
      setVersionError(adminErrorMessage(err, "Couldn't check for updates."));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void loadVersion(false);
    getAdminDbHealth()
      .then((r) => setDbStatus(r.status === "ok" ? "ok" : "error"))
      .catch(() => setDbStatus("error"));
    getTtsProviders()
      .then(setTts)
      .catch((err) =>
        setTtsError(adminErrorMessage(err, "Failed to load voice services.")),
      );
    getLogLevel()
      .then((r) => setLogLevel(r.level))
      .catch((err) =>
        setLogError(adminErrorMessage(err, "Failed to load log level.")),
      );
  }, []);

  const changeLogLevel = async (next: string) => {
    const prev = logLevel;
    setLogLevel(next);
    setLogBusy(true);
    setLogError(null);
    try {
      await updateLogLevel(next);
    } catch (err) {
      setLogLevel(prev);
      setLogError(adminErrorMessage(err, "Failed to save log level."));
    } finally {
      setLogBusy(false);
    }
  };

  const statusText = version?.status
    ? (UPDATE_STATUS_TEXT[version.status] ?? version.status)
    : null;

  return (
    <div
      className="flex flex-col gap-[22px] px-6 py-5 max-sm:px-5"
      data-testid="admin-system-pane"
    >
      <div className="flex flex-col gap-2">
        <KitSettingsGroup title="Version">
          <KitSettingsRow
            label={
              version?.localVersion
                ? `Skynet ${version.localVersion}`
                : "Skynet"
            }
            description={
              <span data-testid="admin-system-update-status">
                {statusText}
                {version?.status === "requires_update" &&
                  version.remoteVersion && (
                    <>
                      {" "}
                      · {version.remoteVersion} is out
                      {version.releaseUrl && (
                        <>
                          {" "}
                          <a
                            href={version.releaseUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[var(--k-acc-text)] hover:underline"
                          >
                            Release notes
                            <ExternalLink size={12} aria-hidden />
                          </a>
                        </>
                      )}
                    </>
                  )}
              </span>
            }
            control={
              <KitButton
                size="sm"
                data-testid="admin-system-check-updates"
                busy={checking}
                onClick={() => void loadVersion(true)}
              >
                {checking ? "Checking…" : "Check for updates"}
              </KitButton>
            }
          />
          <KitSettingsRow
            label="Database"
            control={
              <KitChip
                dot
                data-testid="admin-system-db-status"
                tone={
                  dbStatus === "ok"
                    ? "ok"
                    : dbStatus === "error"
                      ? "danger"
                      : "neutral"
                }
              >
                {dbStatus === "ok"
                  ? "Healthy"
                  : dbStatus === "error"
                    ? "Not reachable"
                    : "Checking…"}
              </KitChip>
            }
          />
        </KitSettingsGroup>
        {versionError && (
          <KitBanner tone="danger" data-testid="admin-system-version-error">
            {versionError}
          </KitBanner>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <KitSettingsGroup title="Logging">
          <KitSettingsRow
            label="Log level"
            description="How much detail the backend writes to its logs. Takes effect immediately."
            control={
              <KitSelect
                data-testid="admin-system-log-level"
                aria-label="Log level"
                value={logLevel ?? ""}
                disabled={logLevel === null || logBusy}
                onChange={(e) => void changeLogLevel(e.target.value)}
              >
                {logLevel === null && <option value="">Loading…</option>}
                {LOG_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </KitSelect>
            }
          />
        </KitSettingsGroup>
        {logError && (
          <KitBanner tone="danger" data-testid="admin-system-log-error">
            {logError}
          </KitBanner>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <KitSettingsGroup
          title="Voice"
          data-testid="admin-system-voice"
          footer="The services that read replies aloud. Set in the server configuration; when the main service fails or freezes, the backup reads the rest of the reply."
        >
          <KitSettingsRow
            label="Main service"
            description={tts?.primary.error}
            control={
              <TtsServiceName
                testId="admin-system-tts-primary"
                status={tts?.primary}
                loading={tts === null && ttsError === null}
              />
            }
          />
          <KitSettingsRow
            label="Backup service"
            description={tts?.backup.error}
            control={
              <TtsServiceName
                testId="admin-system-tts-backup"
                status={tts?.backup}
                loading={tts === null && ttsError === null}
              />
            }
          />
        </KitSettingsGroup>
        {ttsError && (
          <KitBanner tone="danger" data-testid="admin-system-tts-error">
            {ttsError}
          </KitBanner>
        )}
      </div>
    </div>
  );
}

function TtsServiceName({
  status,
  loading,
  testId,
}: {
  status: TtsProviderStatus | undefined;
  loading: boolean;
  testId: string;
}) {
  const text = loading
    ? "Loading…"
    : !status
      ? "—"
      : status.label ?? (status.error ? "Not in use" : "None");
  return (
    <span
      data-testid={testId}
      className="k-row-value"
      style={status?.error ? { color: "var(--k-danger-text)" } : undefined}
    >
      {text}
    </span>
  );
}
