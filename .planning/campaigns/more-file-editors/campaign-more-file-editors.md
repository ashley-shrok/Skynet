# Campaign: More file-type editors on the front end

**Opened:** 2026-09-27
**Status:** in_progress
**Workspace:** /home/ubuntu/fleet/identities/champion-box-maintainer/workspace/skynet/.planning/campaigns/more-file-editors/

## Concept

Today the Skynet front end knows how to show three flavors of file content:
plain text in a textarea, code with syntax highlighting in a code editor, and
markdown in a markdown editor. Anything else — an image, a PDF, a spreadsheet,
a video, a diff — either falls back to unusable binary-as-text in the file
modal, or in one place (the workspace file browser inside the identity modal)
lands as a partial special case for images alone. The concept of this
campaign is to expand the set of file types the front end knows how to
render, and where reasonable to edit — so that when an agent or a user
opens an image, a PDF, a spreadsheet, a video, an audio clip, an SVG, or a
diff, they get a real viewer or editor instead of a link to unreadable bytes.

A second, related move: message bubbles today only ever render a plain link
when an agent serves a file URL, even for content the browser could inline
happily. Where the file is an image, audio clip, or video, the bubble should
show the content inline so the user doesn't have to click through to see it,
while still keeping the underlying link available.

Two constraints decide which types make it into scope: performance (nothing
so heavy it makes the surrounding app sluggish, either at load time or at
render time) and the availability of good existing rendering libraries so
we're not building renderers from scratch.

## Success criteria

- Every file type on the agreed list is either supported end-to-end in the
  file-URL modal, or explicitly deferred with a reason.
- Users get a real viewer or editor experience for the supported types —
  image, SVG, audio, video, PDF, Word documents (read-only), CSV/TSV
  spreadsheets, and diffs — rather than the binary-as-text fallback.
- Message bubbles auto-render image, audio, and video content inline when
  the URL points to a supported type, with the plain link still available
  alongside the inline render.
- Unsupported types still fall back gracefully to the existing textarea
  and plain-link paths — no regression on the "we don't know how to view
  this" case.
- No perceptible performance regression in the common case (opening a
  small text file, rendering a short message with no media).
- Whether a given new viewer also lands in the workspace file browser
  inside the identity modal is a per-shape decision made with the user,
  not a blanket rule.

## Shapes

Ordering below is a starting-point, not locked. Each entry is marked
[declared] as of concept-open; discovered work joins as [discovered].

- **[declared] shape-native-viewers-in-modal** — Unified file-chip
  pattern: every file URL in every bubble (user attachments and
  assistant file shares) renders as an interactive chip that opens the
  existing modal on click. Chip has plain and media variants; media
  variant (image, audio, video, rendered SVG) shows the file inline in
  the chip; SVG gets a view-source-code toggle inside the modal.
  Download action lives on the chip; middle-click / Command-click
  preserved via anchor-with-intercept. Drops the pencil affordance.
  Absorbs the originally-declared shape 2 (inline media in bubbles) —
  the chip IS the inline preview. Medium lift. — in_progress
- **[discovered] shape-shared-file-view** — (2026-10-05) One registry
  (`src/ui/features/pretty-view/file-viewers/registry.ts`) decides how a
  file type is shown; one `<FileView>` body renders it on every
  arbitrary-file surface: chat file modal, skills editor, runbooks
  editor, workspace file browser. File chips read their icon and inline
  preview from the same registry. Includes the binary fallback: known
  binary extensions skip the fetch; unknown extensions are byte-sniffed
  (server sniff where sent, else the shared client sniff) and non-text
  shows a "Can't preview this file" notice with Download where the
  surface has a download URL. Guard test
  `file-viewers/no-adhoc-file-viewers.test.ts` fails if a surface wires
  editors by hand. Every later shape plugs in as a registry entry, and
  each shape decides its modal view and its chip preview with the user
  before building. — in_progress
- **[declared] shape-diff-viewer** — Side-by-side rendering for
  patch/diff files. Small library. Agreed 2026-10-05: registry entry for
  .diff/.patch with Unified (default) / Side-by-side / Raw (editable)
  modes; own unified-diff parser (no new dependency); a dropdown picks
  the file in multi-file patches ("All files (N)" first, per-file +/−
  counts; hidden for single-file patches) — dropdown everywhere rather
  than a sidebar list; side-by-side falls back to unified under 640px.
  Chip preview: "N files · +A −D" plus the first 6 changed lines,
  fetched when the chip scrolls into view, capped at 256 KB. — built,
  awaiting user check
- **[declared] shape-csv-table-editor** — Table view with a raw-text
  toggle for CSV and TSV files. Moderate lift, needs a table library.
  Agreed 2026-10-05: PapaParse (parse + format-preserving unparse) and
  AG Grid Community (chosen over react-data-grid for the "never leave
  the app" goal: built-in sort, filter, resize, undo/redo), lazy-loaded
  (~261 KB gzipped chunk, only fetched when a delimited file opens).
  .csv/.tsv/.psv; Table (editable; add/delete rows + columns, rename
  column, search, "First row is headers" toggle on by default) + Raw.
  Saves keep delimiter, line endings, BOM, trailing newline and
  quote-every-field style; only unneeded quotes can drop. Not in
  Community: block paste from Excel, fill handle (Enterprise only).
  Chip: header + first 4 rows + "N rows × M columns". — built,
  awaiting user check
- **[declared] shape-docx-viewer** — Read-only rendering for Word
  documents. Moderate lift, needs a document rendering library. Upgraded
  2026-10-05 to full editing with SuperDoc (`superdoc` 2.x, AGPL-3.0 —
  user accepted the licence after weighing it: Skynet is public; a
  deployer with patches satisfies §13 by publishing them, e.g. a public
  fork, and setting SKYNET_SOURCE_URL). .docx/.dotx open in Editing, with
  Suggesting (tracked changes) and Viewing; comments; save exports .docx
  through the BinaryDraft path on every surface. SuperDoc telemetry is
  off (verified: no external requests). Round-trip checked on a test doc
  (comments, footnotes, header/footer, numbering, table shading, image,
  tracked changes, two sections, formatting all preserved). Chip: title +
  opening paragraphs from the XML. Licence work: Preferences → About
  (above Log out) with version + server-provided source link, README
  licence section, THIRD_PARTY_NOTICES.md. — built, awaiting user check
- **[declared] shape-pdf-viewer** — Rendering for PDF files. Heaviest
  bundle weight of the set, so ordered last. Agreed 2026-10-05: Mozilla's
  complete pdf.js viewer (Firefox's), vendored legacy build under
  public/pdfjs/v<ver>/ (scripts/vendor-pdfjs-viewer.mjs; not on npm),
  embedded in a same-origin iframe, dark theme; annotation editors on
  incl. signature + comment. Annotate-and-save on every surface: FileView
  BinaryDraft (bytes captured from pdf.js's own save path) → chat stages
  the edited PDF, workspace writes via upload, skills/runbooks via new
  PUT /write-binary (atomic, under-root checked). Chip: page-1 thumbnail
  + page count via the same vendored pdf.js (Range-fetched). nginx gets a
  /pdfjs/ block (explicit .mjs type, immutable cache). — built, awaiting
  user check

- **[discovered] shape-xlsx-viewer** — (2026-10-05) Excel workbooks
  (.xlsx/.xlsm/.xltx/.xltm), VIEW-ONLY by the rule below. ExcelJS parses,
  AG Grid shows each sheet on a white Excel-like theme: sheet tabs (hidden
  sheets skipped), fonts/fills/borders/alignment/wrap incl. theme colours
  and tints, merges, column widths / row heights, frozen panes (dropped
  when one would cut a merge), number formats via `ssf`, formula bar,
  images, row filter, cell text selection. Charts / pivot tables are
  counted and flagged with a Download hint. Chip: first sheet rows +
  sheet count (≤4 MB). Rejected: SheetJS (npm copy stuck on a CVE'd
  0.18.5), Univer (.xlsx I/O is paid Pro), HyperFormula (GPL-3 vs our
  Apache-2.0), FortuneSheet (round-trip fidelity risk). — built,
  awaiting user check
- **[discovered] shape-office-converter** — (2026-10-05) LibreOffice in a
  separate locked-down sidecar (`docker/converter`, compose service
  `converter`): internal-only network shared with Skynet alone,
  read-only rootfs + tmpfs, no capabilities, no-new-privileges,
  memory/CPU/pid caps. One-shot `soffice --convert-to` per request with a
  throwaway copy of a pre-warmed hardened profile (macros off, links never
  updated), killed past 60 s; ~0.9 s each, 2 concurrent. (unoserver was
  tried first and dropped: LibreOffice 24.2 crashes in UNO-server mode on
  any .docx with comments.) Backend `/document-convert` (auth, 50 MB,
  in-memory LRU by sha256+target, shared in-flight jobs, `/status`).
  Registry: .doc/.odt → .docx in the Word editor, Save converts back and
  overwrites the original (if that fails: error + "Save as .docx" download
  so edits aren't lost); .xls/.ods → .xlsx in the Excel viewer;
  .ppt/.pptx/.odp → PDF in the pdf.js viewer, read-only (annotation tools
  off). Chip thumbnails for presentations only. No converter → notice +
  Download. — built, awaiting user check

- **[discovered] shape-3d-viewer** — (2026-10-05) 3D models, view-only:
  glb/gltf/stl/obj/ply/3mf/fbx/dae/3ds/off/amf/wrl + CAD step/stp/iges/
  igs/brep/brp/fcstd + 3dm + ifc/bim. Online3DViewer engine (MIT, three.js)
  driven at the Viewer/ThreeModelLoader level — its EmbeddedViewer puts
  importer error text (which can quote the file) into innerHTML. Toolbar:
  fit, Y/Z-up (STEP/IGES start Z-up), edges, ortho, light/dark, PNG
  snapshot; stats (vertices, triangles, bbox). Missing companion files
  (.mtl, .bin, textures) are named in a banner. Uncaught importer errors /
  3-min watchdog fail the load cleanly. Decoders (OpenCascade, rhino3dm,
  web-ifc, draco) + a CC-BY env map are served from /vendor/3d/ (postinstall
  patch rewrites the CDN URLs; a Vite plugin serves/emits them from
  node_modules; nginx block in both confs) — no third-party requests. Chip:
  rendered still + triangle count, one WebGL context at a time, ≤15 MB. —
  built, awaiting user check

- **[discovered] shape-archives** — (2026-10-05) proposed (libarchive.js
  tree + open-inside, read-only, optional Extract here / zip write-back);
  user chose to skip. Archives keep the download card.
- **[discovered] shape-data-viewers** — (2026-10-05) READ-ONLY by user call.
  SQLite (.sqlite/.sqlite3/.db/.db3/.s3db/.sl3): sql.js in a Web Worker
  (Cancel terminates it and reopens the file's bytes); tables/views with
  row counts; AG Grid infinite row model with whole-table ORDER BY sorts;
  schema (columns, keys, defaults, indexes, CREATE); SQL box (CodeMirror,
  SQLite dialect + completion, Ctrl/Cmd+Enter), results ≤10k rows; writes
  touch only the in-memory copy (banner). Signature check (Thumbs.db etc.
  get a notice + Download); WAL-mode warning (flag cleared on the copy so
  it opens). ≤200 MB. Parquet: hyparquet (+compressors) — footer first,
  then row groups on demand via Range (multi-GB OK); Arrow/Feather v2:
  apache-arrow with LZ4/Zstd codecs registered (lz4js, fzstd; buffers
  re-aligned to 8 bytes), ≤500 MB. Schema tab with file facts. Export CSV
  (first 100k rows). Chips: SQLite tables + counts (≤20 MB); Parquet
  rows/columns from the footer; Arrow ≤20 MB. nginx: hashed *.wasm block
  (application/wasm, immutable). — built, awaiting user check

- **[discovered] shape-decoded-images** — (2026-10-05) view-only viewer for
  images browsers can't show: TIFF (utif; pages, LZW/Deflate/PackBits/fax,
  16-bit, Orientation tag), HEIC/HEIF (libheif-js, LGPL-3.0, imported from
  /vendor/heif/ as its own unmodified file; primary image + extra images),
  PSD/PSB (ag-psd; flattened image, layer panel with groups / hidden /
  opacity, click a layer to see it alone; files saved without "Maximize
  compatibility" — versionInfo.hasRealMergedData=false — are composed from
  layers with canvas blend modes and flagged approximate) and camera RAW
  (largest embedded JPEG preview, RAW orientation applied when the preview
  has none; 22 RAW extensions; no preview → clear message). Decoding in a
  worker; zoom/pan surface (fit, 1:1, wheel/pinch, drag); EXIF info line
  (exifr); Download PNG. Chips: thumbnail + caption, queued one at a time.
  Vendor plugin generalised (scripts/vendor-libs.mjs, nginx /vendor/ block).
  Tested with real iPhone HEICs and real TIFFs (exifr fixtures); RAW only
  with a synthetic TIFF-container sample (no real RAW reachable offline).
  — built, awaiting user check

## Rule: view-only when editing can't be done properly (2026-10-05)

If we can't give a proper editing-and-saving experience for a file type
(faithful round-trip, working formulas, no silent loss), we don't offer
editing; we give the best viewing experience we can instead.

## Other work

- Verified the pencil-icon on file links in message bubbles routes
  correctly to the code editor for a JavaScript file and the markdown
  editor for a markdown file — routing is working, no fix needed. — done

## Lingerers (explicitly approved)

Empty until close-time approvals.

## Follow-ups (committed to this session) — done 2026-10-05

One mechanism covers all three: a streamed, Range-capable file URL per
surface, built on a shared backend helper (`src/backend/utils/
sftp-file-response.ts`, extracted unchanged from GET /file/:host/*, plus
`sftp-download.ts` for files that must stay under a root).

- Skills/Runbooks: new `GET /skills-editor/download` and
  `GET /runbooks-editor/download` (symlink-escape checked against the
  resolved skill / runbook dir). `inline=1` serves media / PDF / text in
  place; html / js / svg always download. FileView gets it as `mediaUrl`
  (viewers) and `downloadUrl` (notice). This replaces the planned "read
  route returns base64 bytes": no 2 MB cap, no base64 bloat, streams.
  Media / known-binary files no longer go through the text read at all.
- Workspace `/download`: streamed with Range (was fully buffered), cap
  raised 500 MB → 10 GiB to match /file/, `inline=1` as above. The
  workspace viewer streams media from it instead of the 2 MB read.

## Open questions

- **Workspace-file-browser parity per shape.** For each new viewer, decide
  with the user whether it also lands in the workspace file browser inside
  the identity modal, or stays in the file-URL modal only. Answered
  incrementally as shapes execute; not resolved upfront.
  Resolved for shape 1 (native-viewers-in-modal, 2026-09-28): NOT
  touching the workspace file browser — it stays with its own dispatch.
  Superseded 2026-10-05 by shape-shared-file-view: the workspace browser,
  skills and runbooks editors all render the shared FileView, so every
  new viewer lands on all of them by default.
- **SVG default view — rendered or code?** Resolved for shape 1
  (2026-09-28): rendered by default, with a "view source code" toggle
  inside the modal that switches to the editable code editor branch.
- **Docx: read-only vs edit.** Editing Word documents well is a known
  rabbit hole. Best-fit guess is read-only for now, to be confirmed in
  that shape's open beat.
- **Extraction of shared file-type dispatch.** Resolved 2026-10-05 by
  shape-shared-file-view. Original note: The three surfaces (file-URL
  modal, workspace file browser, message bubbles) each reinvent their own
  extension-to-viewer dispatch today. Not addressed as an upfront refactor
  shape. If mid-campaign we notice we're copy-pasting the same
  extension-detection logic across shapes, extract becomes a discovered
  shape or an other-work item.
