# Vendored pdf.js viewer

`v<version>/` is Mozilla's prebuilt pdf.js viewer (the same viewer Firefox
uses: toolbar, thumbnails, search, forms, highlight / text / drawing /
image / signature annotations), unmodified, from the GitHub release
`pdfjs-<version>-legacy-dist.zip`. The legacy build is used because the
standard one needs bleeding-edge browser features (current Safari lacks
them). Source maps, the debugger and the sample PDF
are left out. Licence: Apache-2.0 (`v<version>/LICENSE`).

`skynet-embed.v1.css` hides viewer chrome that doesn't fit an embedded
file (opening other files). It's injected as a stylesheet link because
the viewer's CSP forbids inline styles; bump the file name when changing
it (nginx caches `/pdfjs/` immutably).

The app embeds `v<version>/web/viewer.html` in an iframe (see
`src/ui/features/pretty-view/file-viewers/pdf/`). The directory is
versioned so nginx can serve it with an immutable cache header.

Upgrade:

    node scripts/vendor-pdfjs-viewer.mjs <version> <sha256-of-legacy-zip>

then bump `PDFJS_VERSION` in `file-viewers/pdf/pdfjs-paths.ts`, delete the
old `v<old>/` directory, and re-check the viewer option names used in
`PdfView.tsx` against the new release.
