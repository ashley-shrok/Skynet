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
| LibreOffice (separate `converter` container, from Ubuntu packages) | Converting .doc/.odt/.xls/.ods/.ppt/.pptx/.odp for viewing | MPL-2.0 | https://www.libreoffice.org/about-us/source-code/ |

## AGPL-3.0 and Skynet

Because SuperDoc is AGPL-3.0, Skynet as distributed is covered by the AGPL-3.0's
terms. Section 13 of the AGPL requires that users interacting with a modified
version over a network can get its corresponding source. Skynet shows a source
link in Preferences → About; instances running modified code must set
`SKYNET_SOURCE_URL` to where that modified source is published. See the
README's License section.

SuperDoc's document-open telemetry is disabled in Skynet.
