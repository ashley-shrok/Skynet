import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ExternalLink } from "lucide-react";
import { getVersionInfo } from "@/api/system-status-api";
import { useBrandingConfig } from "@/branding/branding-store";
import { escBelongsElsewhere } from "@/components/modal";
import { KitSettingsGroup, KitSettingsRow } from "@/components/kit";

/**
 * Preferences → About: the instance's own name and logo (from its branding),
 * its version, and where its source code is published, with the licence and
 * the bundled components one level deeper.
 *
 * The source link is required by the AGPL-3.0 (builds include SuperDoc, the
 * Word editor): users of an instance must be able to get the source of
 * exactly what it runs. The URL comes from the server (SKYNET_SOURCE_URL),
 * so deployers with local patches point it at their public fork.
 *
 * Branding wins everywhere here except the licence page, which names Skynet
 * once — the licence covers that software whatever the instance is called —
 * and carries the copyright and no-warranty notices the AGPL asks an
 * interactive interface to show.
 */

const DEFAULT_SOURCE_URL = "https://github.com/ashley-shrok/Skynet";

const COMPONENTS: Array<[string, string, string]> = [
  ["SuperDoc", "Word document editor", "AGPL-3.0"],
  ["pdf.js", "PDF viewer", "Apache-2.0"],
  ["AG Grid Community", "CSV and Excel tables", "MIT"],
  ["ExcelJS", "Excel workbook reader", "MIT"],
  ["PapaParse", "CSV parser", "MIT"],
  ["Online3DViewer + three.js", "3D model viewer", "MIT"],
  ["occt-import-js", "STEP / IGES import", "LGPL-2.1"],
  ["sql.js", "SQLite database viewer", "MIT"],
  ["hyparquet", "Parquet reader", "MIT"],
  ["Apache Arrow", "Arrow / Feather reader", "Apache-2.0"],
  ["UTIF.js", "TIFF decoder", "MIT"],
  ["ag-psd", "Photoshop reader", "MIT"],
  ["libheif", "HEIC photo decoder", "LGPL-3.0"],
  ["KaTeX", "Maths in notebooks", "MIT"],
  ["foliate-js", "Ebook reader", "MIT"],
  ["Mermaid · Viz.js", "Text diagrams", "MIT"],
  ["Excalidraw", "Drawing editor", "MIT"],
  ["draw.io viewer", "draw.io diagrams", "Apache-2.0"],
  ["postal-mime", "Email reader", "MIT-0"],
  ["msgreader", "Outlook .msg reader", "Apache-2.0"],
  ["ical.js", "Calendar and contacts", "MPL-2.0"],
  ["fontkit", "Font viewer", "MIT"],
  ["ass-compiler", "ASS subtitles", "MIT"],
  ["LibreOffice", "Document converter (server)", "MPL-2.0"],
];

type Sub = "licence" | "components";

const SUB_TITLES: Record<Sub, string> = {
  licence: "Licence",
  components: "Included components",
};

export function PreferencesAboutPane(): JSX.Element {
  const branding = useBrandingConfig();
  const [version, setVersion] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string>(DEFAULT_SOURCE_URL);
  const [sub, setSub] = useState<Sub | null>(null);

  useEffect(() => {
    let cancelled = false;
    getVersionInfo(false)
      .then((info) => {
        if (cancelled || !info) return;
        if (typeof info.localVersion === "string") setVersion(info.localVersion);
        if (typeof info.sourceUrl === "string" && info.sourceUrl) setSourceUrl(info.sourceUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Esc on a deeper page goes back to About instead of closing the window.
  const subRef = useRef(sub);
  subRef.current = sub;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== "Escape" || e.defaultPrevented || !subRef.current) return;
      if (escBelongsElsewhere(e)) return;
      e.preventDefault();
      e.stopPropagation();
      setSub(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (sub) {
    return (
      <div data-testid={`preferences-about-${sub}`}>
        <div className="flex items-center gap-2 pb-4">
          <button
            type="button"
            onClick={() => setSub(null)}
            className="inline-flex items-center gap-0.5 -ml-1 py-1.5 pr-1.5 text-[14px] font-[550] text-[var(--k-acc-text)] cursor-pointer"
            data-testid="preferences-about-back"
            data-modal-back=""
          >
            <ChevronLeft size={18} aria-hidden="true" />
            About
          </button>
          <h3 className="m-0 text-[15px] font-semibold text-[var(--k-t1)]">{SUB_TITLES[sub]}</h3>
        </div>
        {sub === "licence" ? (
          <KitSettingsGroup
            footer={
              <>
                In practice: anyone using this instance can get its source code from the Source code
                link. If this instance runs a modified version, that link must point to the modified
                source (for example a public fork); the server setting{" "}
                <code className="text-[12px]">SKYNET_SOURCE_URL</code> controls it.
              </>
            }
          >
            <div className="px-3.5 py-3 flex flex-col gap-2.5 leading-relaxed text-[var(--k-t1)]">
              <p className="m-0">
                This app is built on Skynet, which is open source under the Apache License 2.0. It
                includes SuperDoc, the Word document editor, which is licensed under the GNU
                AGPL-3.0, so the app as distributed is covered by the AGPL-3.0 terms.
              </p>
              <p className="m-0 text-[var(--k-t2)]" data-testid="preferences-about-copyright">
                Copyright 2025 Luke Gustafson and contributors. This program comes with absolutely
                no warranty, to the extent permitted by law.
              </p>
            </div>
          </KitSettingsGroup>
        ) : (
          <KitSettingsGroup footer="Open-source pieces that ship inside this app, with their licences.">
            {COMPONENTS.map(([name, role, licence]) => (
              <KitSettingsRow
                key={name}
                label={name}
                description={role}
                value={<span className="font-mono text-[12px]">{licence}</span>}
              />
            ))}
          </KitSettingsGroup>
        )}
      </div>
    );
  }

  return (
    <div data-testid="preferences-about-pane">
      <div className="flex flex-col items-center text-center gap-1.5 pt-2 pb-6">
        <span className="size-[84px] rounded-[22px] bg-[var(--k-s2)] border border-[var(--k-hair)] grid place-items-center">
          <img src={branding.iconPath} alt="" className="size-[46px] object-contain" />
        </span>
        <h2
          className="m-0 mt-2 text-[24px] font-bold tracking-[-0.025em] text-[var(--k-t1)]"
          data-testid="preferences-about-name"
        >
          {branding.appName}
        </h2>
        <p className="m-0 text-[13.5px] text-[var(--k-t2)]" data-testid="preferences-about-version">
          {version ? `Version ${version}` : "Version unknown"}
        </p>
      </div>

      <KitSettingsGroup>
        <KitSettingsRow
          label="Source code"
          control={
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="preferences-about-source-link"
              className="inline-flex items-center gap-1.5 min-w-0 text-[13px] text-[var(--k-acc-text)] hover:underline"
            >
              <span className="truncate">{sourceUrl.replace(/^https?:\/\//, "")}</span>
              <ExternalLink size={13} aria-hidden className="shrink-0" />
            </a>
          }
        />
        <KitSettingsRow
          label="Licence"
          value="Apache 2.0 · AGPL-3.0"
          onClick={() => setSub("licence")}
          data-testid="preferences-about-licence-row"
        />
        <KitSettingsRow
          label="Included components"
          value={String(COMPONENTS.length)}
          onClick={() => setSub("components")}
          data-testid="preferences-about-components-row"
        />
      </KitSettingsGroup>
    </div>
  );
}
