import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { getVersionInfo } from "@/api/system-status-api";
import { KitSettingsGroup, KitSettingsRow } from "@/components/kit";

/**
 * Preferences → About: version, licence, and where this instance's source
 * code is published. The source link is required by the AGPL-3.0 (Skynet
 * builds include SuperDoc, the Word editor): users of an instance must be
 * able to get the source of exactly what it runs. The URL comes from the
 * server (SKYNET_SOURCE_URL), so deployers with local patches point it at
 * their public fork.
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

export function PreferencesAboutPane(): JSX.Element {
  const [version, setVersion] = useState<string | null>(null);
  const [sourceUrl, setSourceUrl] = useState<string>(DEFAULT_SOURCE_URL);

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

  return (
    <div className="text-[13px] text-[var(--k-t1)]" data-testid="preferences-about-pane">
      <KitSettingsGroup>
        <KitSettingsRow
          label={<span className="font-semibold">Skynet</span>}
          value={version ? `Version ${version}` : "Version unknown"}
        />
      </KitSettingsGroup>

      <KitSettingsGroup title="Source code">
        <KitSettingsRow
          label={
            <a
              href={sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="preferences-about-source-link"
              className="inline-flex items-center gap-1.5 w-fit text-[var(--k-acc-text)] hover:underline break-all"
            >
              {sourceUrl}
              <ExternalLink size={13} aria-hidden className="shrink-0" />
            </a>
          }
        />
      </KitSettingsGroup>

      <KitSettingsGroup
        title="Licence"
        footer={
          <>
            In practice: anyone using this instance can get its source code from the link above. If this
            instance runs a modified Skynet, that link must point to the modified source (for example a
            public fork); the server setting <code className="text-[12px]">SKYNET_SOURCE_URL</code> controls it.
          </>
        }
      >
        <div className="px-3.5 py-3 leading-relaxed text-[var(--k-t2)]">
          Skynet is open source under the Apache License 2.0. It includes SuperDoc, the Word document
          editor, which is licensed under the GNU AGPL-3.0, so Skynet as distributed is covered by the
          AGPL-3.0 terms.
        </div>
      </KitSettingsGroup>

      <KitSettingsGroup title="Included components">
        {COMPONENTS.map(([name, role, licence]) => (
          <KitSettingsRow
            key={name}
            label={name}
            description={role}
            value={<span className="font-mono text-[12px]">{licence}</span>}
          />
        ))}
      </KitSettingsGroup>
    </div>
  );
}
