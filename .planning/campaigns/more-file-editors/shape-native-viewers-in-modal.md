# Shape: File chips replace file URLs, unified across user and assistant bubbles, viewers for image / SVG / audio / video

**Opened:** 2026-09-28
**Vehicle:** inline (progress tracked via harness tasks)

## What this is

Today, when an agent shares a file URL, the front end renders it as a plain
hyperlink inside the message body, with a small edit-pencil sibling for
text-y types. Clicking the hyperlink opens the file in a new browser tab
(browser-native rendering for images / audio / video / PDF; download for
anything else). The pencil, when present, opens an in-app edit modal that
fetches the file's bytes over an authenticated backend endpoint. Meanwhile,
user attachments — files a person uploads and sends with their message —
display as static filename-and-size chips in the user bubble with no
interactivity at all.

This shape merges those two worlds. Every file the app knows about, whether
uploaded by the human or served by an agent, renders as an interactive
file chip in its bubble. Clicking a chip opens the file in the existing
in-app modal; if the file is a supported media type the modal renders a
real viewer for it, and if the file is text the modal opens the existing
editable text editor. A download action lives on the chip itself so
save-to-disk is one click without opening the modal. Middle-click,
Command-click, and right-click "open in new tab" all still work natively
because the chip is an anchor element under the styling.

## Shape

Every file has one representation everywhere in the conversation: a chip.
The chip has two visual variants:

- **Plain chip** for files whose bytes we don't inline in the bubble —
  text documents, PDFs, spreadsheets, and anything we haven't taught the
  app to render at chip size. Shows a file-type icon, the filename
  (underlined, to signal it's clickable), the file size, and a small
  download icon at the right edge.
- **Media chip** for files whose bytes we CAN inline safely at chip size —
  images, short audio clips, videos, and rendered SVG. Shows the media
  inline inside a rounded frame at the top of the chip, with a caption
  strip below carrying the same type icon + underlined filename + size +
  download icon. The whole thing is one unit; clicking anywhere on it
  (except the download icon) opens the modal.

Both variants always sit on their own line in the message body, whether
they were originally embedded in the middle of a sentence or at the tail
— the chip always breaks out to its own line. A file mentioned
mid-sentence still has its chip visible somewhere in the same bubble; the
prose around the mention is left intact so the sentence still reads (even
if it now reads with a gap where the file link used to be inline). One
canonical rendering is worth a small hit to a rare in-prose case.

The chip appears in three places:

- **User bubbles.** Replaces today's static attachment chip. The chip's
  URL points at the file's known landing path on the host it was uploaded
  to (the app already knows this path from the upload machinery).
- **Assistant bubbles.** Replaces today's inline hyperlink and pencil
  pair. Every file URL in the assistant's message body is extracted from
  the rendered prose and shown as a chip on its own line inside the
  bubble.
- **Media chips are the inline-media story.** There is no separate
  inline-preview concept; the chip subsumes it. What used to be a second
  campaign shape ("auto-render media inline in bubbles") folds into this
  one — the media-variant chip is the auto-render.

The modal that opens when a chip is clicked is the same modal that today
opens on the pencil. It stays always-editable when the file is text-y —
no separate view mode. When the file is a media type (image, audio, video,
or SVG), the modal renders a native browser viewer instead of a text
editor: a plain image element for images, native audio and video controls
for those, and inline rendered SVG. SVG additionally carries a "view
source code" toggle inside the modal so the code editor branch is one
click away when the person opening it wants to edit the SVG's XML.

The download action on the chip fires a save-to-disk directly without
opening the modal. It's the same file bytes the modal would fetch, just
delivered to the user's downloads folder instead of an in-app viewer.

The pencil-edit sibling that today sits next to file links goes away
entirely. The chip is the new discoverable entry point; the modal is
still always-editable when the file is text.

## Philosophy

**One representation for every file.** A user attachment and an agent's
file share are the same thing conceptually — a file on a host that
someone in this conversation might want to see, edit, or download. They
should look and behave the same way. Today's split is an accident of two
features shipping at different times; this shape closes it.

**Click opens; middle-click still opens elsewhere.** In-app viewing is
the primary path, but browser-native middle-click and Command-click are
load-bearing habits. A chip that broke them would feel closed and
un-web-like. Preserving them costs nothing — the chip is an anchor,
onClick prevents the default, and the browser handles alt-clicks itself.

**No separate view vs. edit for text.** The modal opens straight into an
editable state. If the person just wants to look, they close it without
typing. Splitting view and edit would double the surface area for no
user gain — the pencil-and-modal split today already collapsed to
"the modal is always editable."

**Chips carry only their primary action loudly.** One click opens the
modal; download is the only other action, and it's a small icon at the
edge. No kebab menu, no hover-reveal action rows, no separate edit
button. Fewer moving parts to design, to build, and to teach.

**Media types get more visual weight than text types.** A rendered
thumbnail or a video player is worth more real estate than a filename
because it tells the reader what the file IS at a glance. Text-y types
stay quiet — the filename does that job.

**The older style of file URLs goes away.** The legacy pattern (an
agent's ad-hoc lightweight HTTP server on a tailnet IP and port) is
dropped from scope entirely; only the Skynet-served file-URL pattern
becomes a chip. Agents sharing files that way from now on will need to
write files through the host and cite the durable URL for them to
render as chips. Non-file text URLs (regular web links) still render as
inline hyperlinks the way they always have.

## Prior context

The message renderer today walks the assistant's markdown output and,
for every anchor it emits, checks the URL against a whitelist. If the
URL is a durable file URL AND the file type looks editable (by
extension whitelist or by a bytes-sniff over an authenticated backend
probe), it hangs a pencil affordance next to the anchor. Clicking the
pencil opens the file-URL modal, which fetches the file's bytes through
an authenticated endpoint and hands them to a text editor.
Non-editable file types (images, audio, video) never get a pencil and
never open the modal; the plain anchor opens the file in a new browser
tab where the browser renders natively.

User attachments follow a separate path: the compose box stages a
batch, uploads each file over an SSH-tunneled protocol to a stable
landing directory on the target host, then injects a user turn whose
bubble renders a read-only chip strip showing each attachment as a
filename and size. The chip strip has no click behavior. The landing
directory is a known, stable path under the host's home
(`pretty-view-uploads/<date>/<sanitized-filename>`) — persistent, not
temporary; the same shape that a durable file URL can point at.

Two prior shapes in this campaign were designed independently: one for
"native viewers in the modal" (image / audio / video / SVG in-modal),
one for "inline media in bubbles" (image / audio / video auto-rendering
inline in message bubbles). Shaping surfaced that these are one shape,
not two — the chip pattern is both the inline preview and the entry
point to the modal — and the campaign artifact will be updated
alongside this shape file to collapse them.

The Skynet backend already serves file URLs with content-type
dispatched per extension: images / audio / video / PDF stream inline
with real MIME types; scripting-capable types (HTML, JS, SVG) force a
download disposition for security. That backend is fine as-is; the
front-end changes in this shape don't require backend changes.

A 2 MB cap applies to the fetch-for-modal path because the whole file
buffers into memory for the editor. That cap stays. The download path
is streamed and has a much higher ceiling — a chip's download button
can pull a large file the modal wouldn't be able to open.

## What would make it wrong

- **Losing files in prose.** An agent mentions a file mid-sentence and
  the extraction step silently drops the URL without leaving a chip
  visible in the bubble. Every file mentioned anywhere in the message
  MUST show up as a chip somewhere in the same bubble.
- **A chip that doesn't look clickable.** A person reads the chip and
  doesn't realize it's the way to open the file. The filename
  underline exists specifically to prevent this — it must read as a
  link at a glance.
- **Middle-click stops working.** If Command-click, middle-click, or
  right-click "open in new tab" ever stops working on a chip, we've
  broken a load-bearing habit and people will notice immediately.
- **Downloading also opens the modal.** The download icon on the chip
  must not propagate its click to the chip's own click handler. One
  gesture, one action.
- **A media chip renders bytes it can't render.** A file with a
  media-shaped extension whose bytes are corrupt or truncated should
  fall back to the plain chip gracefully — never leave a broken image
  icon inside the rounded frame.
- **The modal opens on a media file and shows a text editor.** The
  modal's viewer dispatch must fire before any text-editor path when
  the file is a supported media type.
- **User-attachment chips break for old messages.** Old user messages
  that predate this change still have their attachment landing paths
  recorded; those chips must still resolve to working URLs — or
  degrade to a still-visible non-interactive chip if the file no
  longer exists on the host.
- **The bubble becomes a wall of chips.** If an agent sends five
  images in one message, the bubble should still look like a message,
  not a file gallery. Visual restraint on stacking (spacing, max chip
  size) matters more than making every chip huge.

## Scope edges

**In:**

- The chip component with plain and media variants (per the tasting
  variant 6).
- Extracting file URLs from assistant-message prose and rendering
  chips on their own line inside the bubble.
- The modal's viewer branch for image, audio, video, and rendered SVG
  with a source-code toggle.
- The download action on the chip.
- Making user-attachment chips point at the landing URL and behave
  the same way as assistant chips.
- Removing the pencil affordance and its eligibility bytes-sniff hook.

**Out (this shape):**

- PDF, docx, CSV / TSV, and diff viewers — those are later shapes in
  the same campaign; they plug into the same modal dispatch when they
  arrive.
- The workspace file-browser tab inside the identity modal — it has
  its own file-type dispatch today (already renders images) and stays
  untouched. Whether it converges on the chip pattern later is a
  separate call.
- The legacy tailnet-IP-and-port file URL pattern is dropped from
  scope entirely; those URLs render as plain text (or as whatever the
  browser makes of them) but do NOT become chips.
- Bumping the 2 MB fetch-for-modal cap. Videos will often hit it;
  that's a known limit, addressed later if it hurts.
- Any change to how file URLs are backed by the server.

**Deferred:**

- Extracting the extension-to-viewer dispatch as a shared module —
  this shape adds the dispatch inside the modal but doesn't refactor
  the workspace tab's parallel dispatch. If we notice we're
  copy-pasting extension logic across later campaign shapes, extract
  becomes a discovered shape.

**Tempting but no:**

- A kebab menu on the chip with more actions (rename, copy path,
  share…). Ships as one focused primary action + one secondary
  download. Follow-on if we want more.
- Autoplay for audio / video. Never a good default in chat.
- Streaming or lazy-fetch of large media. Not needed at the 2 MB cap.
- Any view / edit toggle in the modal for text types. The modal is
  always editable; people learn this by using it.

## Vehicle notes

Inline vehicle chosen by Ashley on 2026-09-28. Progress tracked with
harness tasks — the task list captures the arc from URL extraction
through chip component, user-chip parity, viewer branch, download
wiring, pencil removal, tests, and closing review.

This is a multi-surface change but stays coherent as one arc, which is
why inline is workable. If mid-execution the scope proves larger than
expected — new decisions surface, unexpected coupling appears, tests
balloon — the escalation path is to pause and promote to a GSD phase
(a plan-phase / execute-phase pair), picking back up with the plan the
phase produces.

The shape file lives alongside the campaign artifact under the
campaign's planning folder. The campaign artifact itself needs a
companion edit — the original shape 2 ("inline media in bubbles") is
subsumed by this shape and will be removed from the campaign's shapes
list; this shape's own description in the campaign artifact grows to
match the settled agreement.
