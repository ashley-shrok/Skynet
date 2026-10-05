import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { getVersionInfo } from "@/api/system-status-api";

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
    <div className="flex flex-col gap-5 px-6 py-5 text-[13px] text-[#e8e4d8]" data-testid="preferences-about-pane">
      <section className="flex flex-col gap-1">
        <h2 className="text-[15px] font-semibold text-[#fbf5e8]">Skynet</h2>
        <div className="text-[#a89a80]">{version ? `Version ${version}` : "Version unknown"}</div>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[12px] uppercase tracking-wide text-[#a89a80]">Source code</h3>
        <a
          href={sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="preferences-about-source-link"
          className="inline-flex items-center gap-1.5 w-fit text-[hsla(var(--pv-id-hue),80%,75%,1)] hover:underline break-all"
        >
          {sourceUrl}
          <ExternalLink size={13} aria-hidden className="shrink-0" />
        </a>
      </section>

      <section className="flex flex-col gap-2 leading-relaxed">
        <h3 className="text-[12px] uppercase tracking-wide text-[#a89a80]">Licence</h3>
        <p>
          Skynet is open source under the Apache License 2.0. It includes SuperDoc, the Word document
          editor, which is licensed under the GNU AGPL-3.0, so Skynet as distributed is covered by the
          AGPL-3.0 terms.
        </p>
        <p className="text-[#cfc8b8]">
          In practice: anyone using this instance can get its source code from the link above. If this
          instance runs a modified Skynet, that link must point to the modified source (for example a
          public fork); the server setting <code className="text-[12px]">SKYNET_SOURCE_URL</code> controls it.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[12px] uppercase tracking-wide text-[#a89a80]">Included components</h3>
        <ul className="flex flex-col gap-1">
          {COMPONENTS.map(([name, role, licence]) => (
            <li key={name} className="flex gap-2">
              <span className="font-medium">{name}</span>
              <span className="text-[#a89a80]">{role}</span>
              <span className="ml-auto text-[#a89a80] font-mono text-[12px]">{licence}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
