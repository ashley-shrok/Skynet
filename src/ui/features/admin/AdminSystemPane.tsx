/**
 * Admin → System: running version and update check, database health, and
 * the backend log level.
 */

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { getAdminDbHealth, getVersionInfo } from "@/api/system-status-api";
import { getLogLevel, updateLogLevel } from "@/api/settings-api";
import {
  AdminButton,
  AdminError,
  AdminRow,
  AdminSection,
  adminErrorMessage,
  adminInputClass,
} from "./admin-ui";

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
      className="flex flex-col gap-6 px-6 py-5"
      data-testid="admin-system-pane"
    >
      <AdminSection title="Version">
        <div className="flex flex-col">
          <AdminRow
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
                            className="inline-flex items-center gap-1 text-[hsla(var(--pv-id-hue),80%,75%,1)] hover:underline"
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
              <AdminButton
                data-testid="admin-system-check-updates"
                disabled={checking}
                onClick={() => void loadVersion(true)}
              >
                {checking ? "Checking…" : "Check for updates"}
              </AdminButton>
            }
          />
          <AdminRow
            label="Database"
            control={
              <span
                data-testid="admin-system-db-status"
                className="text-[12.5px]"
                style={{
                  color:
                    dbStatus === "ok"
                      ? "#8fd39e"
                      : dbStatus === "error"
                        ? "#d38f8f"
                        : "#a89a80",
                }}
              >
                {dbStatus === "ok"
                  ? "Healthy"
                  : dbStatus === "error"
                    ? "Not reachable"
                    : "Checking…"}
              </span>
            }
          />
        </div>
        {versionError && (
          <AdminError testId="admin-system-version-error">
            {versionError}
          </AdminError>
        )}
      </AdminSection>

      <AdminSection title="Logging">
        <AdminRow
          label="Log level"
          description="How much detail the backend writes to its logs. Takes effect immediately."
          control={
            <select
              data-testid="admin-system-log-level"
              aria-label="Log level"
              value={logLevel ?? ""}
              disabled={logLevel === null || logBusy}
              onChange={(e) => void changeLogLevel(e.target.value)}
              className={`${adminInputClass} font-sans cursor-pointer`}
            >
              {logLevel === null && <option value="">Loading…</option>}
              {LOG_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          }
        />
        {logError && (
          <AdminError testId="admin-system-log-error">{logError}</AdminError>
        )}
      </AdminSection>
    </div>
  );
}
