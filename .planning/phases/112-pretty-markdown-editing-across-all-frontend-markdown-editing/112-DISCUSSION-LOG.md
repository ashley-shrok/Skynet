# Phase 112 — Discussion Log

**Gathered:** 2026-09-16
**Mode:** Seeded from shape file (no live gray-area discussion)

## Provenance

Per the `/build` skill's standing rule:

> "If the vehicle is a GSD phase, seed discuss-phase from the shape file.
> `shape-<slug>.md` already captures the 'why + what + constraints + scope
> edges' that `/gsd:discuss-phase` would otherwise re-elicit into CONTEXT.md
> — either drop the shape file in as CONTEXT.md directly, or generate
> CONTEXT.md from it. Don't re-do the discovery work `/open` did."

The shape was opened + agreed at
`/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/shape-pretty-markdown-editing.md`
in the same session. No live discuss step. CONTEXT.md is a structured
extraction of the shape's decisions.

## Session arc (summary)

The `/open` conversation covered, in order:

1. **Cedar's read of the shape put on the table** — one editing surface,
   adopted by every markdown-editing call site, filetype-gated on the two
   mixed-content surfaces.

2. **User confirmed the shape and raised the reformatting concern** —
   Cedar flagged the risk that a WYSIWYG editor's save reformats hand-tuned
   files. User responded that agents consume these files as context and
   don't care about small formatting variations, so byte-for-byte prose
   fidelity is not a requirement. Cedar accepted; this became D-09 and the
   phase philosophy.

3. **Frontmatter risk raised, tasting requested** — Cedar noted that even
   with prose fidelity dropped, the frontmatter settings block has strict
   parsing on the back end and must survive intact. User agreed and
   requested a live tasting of the strongest candidate editors before
   locking a choice.

4. **Tasting built and run** — a 4-way tasting harness was set up at
   `/home/ubuntu/fleet/roles/box-maintainer/bounties/pretty-markdown-editing-in-frontend/tasting/`
   with the real role file, a real identity file, and a synthetic torture
   sample. Playwright-driven round-trip measurement per engine × sample
   showed:
   - MDXEditor: 0 lines rewritten on frontmatter; 24% body-only churn on
     the 474-line role file. Only engine that survives the frontmatter
     preservation contract.
   - Milkdown / Crepe: 3 frontmatter lines rewritten; 17% body-only churn.
   - BlockNote: 5 frontmatter lines rewritten (keys destroyed); 80% churn.
   - Toast UI: 4 frontmatter lines rewritten (keys destroyed); 76% churn.

5. **Serve-URL delivery blocked by an unrelated Skynet bug**, diagnosed to
   Phase 103 D-07 CORS deny running before subdomain-dispatch. Filed as
   bounty `serve-url-cors-deny-breaks-module-based-dev-servers`, handed to
   peer identity `cairo`, fixed in commit `bc94c3be`, and deployed at the
   user's greenlight along with cedar's follow-on personal-strings scrub
   commit `5c7cb71c`. Bounty closed + archived.

6. **User tasted the four engines live and confirmed MDXEditor** — feedback
   was "MDXEditor is the way to go" after seeing the round-trip diffs.
   Frontmatter dialog verified to populate correctly (the user could see
   the frontmatter fields in it, contradicting cedar's earlier probe which
   used `innerText` and missed form-input values).

7. **Vehicle chosen: GSD phase**, greenlit as "thumbs up".

## Decisions locked (see 112-CONTEXT.md for the structured version)

- Engine: MDXEditor
- Preservation contract: frontmatter must round-trip byte-identical on
  body-only edits; prose is allowed to reformat.
- Filetype gate: `.md` → pretty editor; anything else → existing plain
  textarea.
- Four file tabs collapse into one shared component.
- Dark-theme styling is part of the work, specifically including inline
  code and fenced code blocks.
- Test invariants: frontmatter round-trip + filetype gate routing.

## Deferred ideas surfaced

- Pretty editor on plain-text bounty fields (title/todos/keywords/etc.)
- UX polish items from the earlier bounty's scratch-report
  (undo/redo overlay, autosave visual, keyboard hints, etc.)
- WYSIWYG editing inside fenced code blocks
- Chat message rendering changes
- Mirror-hygiene followups from Phase 44

## Scope creep — none

Discussion stayed within the phase domain throughout.

## Cross-agent coordination during the session

- Peer identity `cairo` picked up and fixed the serve-URL CORS bug that
  blocked live delivery of the tasting; that fix shipped to production
  before this phase started planning.
- Cedar committed a personal-strings-scrub follow-on (`5c7cb71c`) to
  clear the deploy gate for Cairo's fix; unrelated to this phase but
  in the same deploy window.

---

*Phase: 111-pretty-markdown-editing-across-all-frontend-markdown-editing*
*Log recorded: 2026-09-16*
