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
  toggle for CSV and TSV files. Moderate lift, needs a table library. —
  in_progress
- **[declared] shape-docx-viewer** — Read-only rendering for Word
  documents. Moderate lift, needs a document rendering library. —
  in_progress
- **[declared] shape-pdf-viewer** — Rendering for PDF files. Heaviest
  bundle weight of the set, so ordered last. — in_progress

## Other work

- Verified the pencil-icon on file links in message bubbles routes
  correctly to the code editor for a JavaScript file and the markdown
  editor for a markdown file — routing is working, no fix needed. — done

## Lingerers (explicitly approved)

Empty until close-time approvals.

## Follow-ups (committed to this session)

- Skills/Runbooks read routes return raw bytes for non-text files, so
  images / PDF / docx render there. Do with the first bytes-needing viewer.
- Skills/Runbooks download endpoint, so their binary notice gets a
  Download button.
- Workspace `/download` serves a real content type + Range so large
  media (and PDF) can stream instead of hitting the 2 MB read cap.

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
