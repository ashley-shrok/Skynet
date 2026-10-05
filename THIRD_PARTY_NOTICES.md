# Third-party notices

Skynet's own code is licensed under Apache-2.0 (`LICENSE`). The components
below are bundled into the web app and keep their own licences. This list
covers the document viewers and editors (LibreOffice runs in its own
container and is not part of the web app); the full dependency set and every
licence text are in `package.json` / `package-lock.json` and each package's
`LICENSE` file under `node_modules/`.

| Component | Used for | Licence | Source |
|---|---|---|---|
| SuperDoc (`superdoc`) | Word (.docx) editor | AGPL-3.0 (commercial licences available from SuperDoc) | https://github.com/superdoc-dev/superdoc |
| pdf.js viewer (vendored in `public/pdfjs/`) | PDF viewer and annotations | Apache-2.0 | https://github.com/mozilla/pdf.js |
| AG Grid Community (`ag-grid-community`, `ag-grid-react`) | CSV and Excel tables | MIT | https://github.com/ag-grid/ag-grid |
| ExcelJS (`exceljs`) | Excel workbook reader | MIT | https://github.com/exceljs/exceljs |
| SSF (`ssf`) | Excel number formatting | Apache-2.0 | https://github.com/SheetJS/ssf |
| PapaParse (`papaparse`) | CSV parsing and writing | MIT | https://github.com/mholt/PapaParse |
| Online3DViewer engine (`online-3d-viewer`) | 3D model viewer | MIT | https://github.com/kovacsv/Online3DViewer |
| three.js (`three`, via Online3DViewer) | 3D rendering | MIT | https://github.com/mrdoob/three.js |
| occt-import-js (served from `/vendor/3d/`, loaded on demand) | STEP / IGES / BREP import (OpenCascade, WebAssembly) | LGPL-2.1 | https://github.com/kovacsv/occt-import-js |
| rhino3dm (served from `/vendor/3d/`, loaded on demand) | Rhino .3dm import | MIT | https://github.com/mcneel/rhino3dm |
| web-ifc (served from `/vendor/3d/`, loaded on demand) | IFC (BIM) import | MPL-2.0 | https://github.com/ThatOpen/engine_web-ifc |
| Draco (`draco3d`, served from `/vendor/3d/`, loaded on demand) | Compressed glTF meshes | Apache-2.0 | https://github.com/google/draco |
| "Fisherman's Bastion" cube map by Emil Persson (Humus), from Online3DViewer | Lighting for 3D materials | CC-BY 3.0 | http://www.humus.name |
| sql.js (`sql.js`) | SQLite database viewer (SQLite compiled to WebAssembly) | MIT (SQLite itself: public domain) | https://github.com/sql-js/sql.js |
| hyparquet, hyparquet-compressors | Parquet reader | MIT | https://github.com/hyparam/hyparquet |
| Apache Arrow JS (`apache-arrow`) | Arrow / Feather reader | Apache-2.0 | https://github.com/apache/arrow-js |
| lz4js, fzstd | LZ4 / Zstandard decompression for Arrow files | ISC, MIT | https://github.com/Benzinga/lz4js, https://github.com/101arrowz/fzstd |
| UTIF.js (`utif`) | TIFF decoder | MIT | https://github.com/photopea/UTIF.js |
| ag-psd | Photoshop (.psd/.psb) reader | MIT | https://github.com/Agamnentzar/ag-psd |
| libheif (`libheif-js`, served from `/vendor/heif/`, loaded on demand) | HEIC / HEIF photo decoder (includes libde265) | LGPL-3.0 | https://github.com/catdad-experiments/libheif-js |
| exifr | Photo metadata (camera, exposure, orientation) | MIT | https://github.com/MikeKovarik/exifr |
| LibreOffice (separate `converter` container, from Ubuntu packages) | Converting .doc/.odt/.xls/.ods/.ppt/.pptx/.odp for viewing | MPL-2.0 | https://www.libreoffice.org/about-us/source-code/ |

## AGPL-3.0 and Skynet

Because SuperDoc is AGPL-3.0, Skynet as distributed is covered by the AGPL-3.0's
terms. Section 13 of the AGPL requires that users interacting with a modified
version over a network can get its corresponding source. Skynet shows a source
link in Preferences → About; instances running modified code must set
`SKYNET_SOURCE_URL` to where that modified source is published. See the
README's License section.

SuperDoc's document-open telemetry is disabled in Skynet.

The LGPL components — the OpenCascade-based STEP/IGES importer
(occt-import-js, LGPL-2.1) and libheif for HEIC photos (LGPL-3.0) — are served
as separate, unmodified files under `/vendor/3d/` and `/vendor/heif/` and loaded
by the browser only when such a file is opened, so they can be replaced
independently. Their licence texts ship alongside them
(`node_modules/occt-import-js/dist/license.*.txt`,
`/vendor/heif/libheif-js@1.23.5/libheif-wasm/LICENSE`). HEIC images use HEVC
compression, which is covered by patents in some jurisdictions.
