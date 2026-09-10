/**
 * Phase 75 Plan 75-02 Task 1 — editable-file-whitelist tests.
 *
 * Contract under test:
 *   - SKYNET_FILE_URL_RE_CLIENT: new sibling regex matching
 *     https://<domain>[:port]/file/<hostname>/<abs-path> per D-01.
 *     Grammar: scheme https:// only, DNS-legal domain + optional port,
 *     literal /file/, hostname [a-zA-Z0-9._-]+, literal slash,
 *     absolute-path terminator [^\s)?#]+.
 *   - TAILNET_URL_RE_CLIENT: unchanged behavior byte-for-byte.
 *   - stripTrailingPunct: composes with SKYNET_FILE_URL_RE_CLIENT the same
 *     way it composes with TAILNET_URL_RE_CLIENT (markdown-link `)` and
 *     prose punctuation trimming).
 *
 * Regex-state hygiene: SKYNET_FILE_URL_RE_CLIENT has the /g flag, which
 * makes .test()/.exec() mutate .lastIndex across calls. Every test that
 * calls .match() resets .lastIndex to 0 before the call (belt-and-braces:
 * .match() itself is stateless per MDN, but the reset makes the invariant
 * explicit for future maintainers).
 */

import { describe, it, expect } from "vitest";
import {
  SKYNET_FILE_URL_RE_CLIENT,
  SKYNET_SERVE_URL_RE_CLIENT,
  TAILNET_URL_RE_CLIENT,
  stripTrailingPunct,
} from "./editable-file-whitelist";

describe("SKYNET_FILE_URL_RE_CLIENT — file-URL client regex (Phase 75 D-01)", () => {
  it("Test 1: matches a bare https file URL with .md extension", () => {
    SKYNET_FILE_URL_RE_CLIENT.lastIndex = 0;
    const url =
      "https://term.gigaashley.click/file/thenasty/home/ubuntu/note.md";
    const matches = url.match(SKYNET_FILE_URL_RE_CLIENT);
    expect(matches).not.toBeNull();
    expect(matches).toContain(url);
  });

  it("Test 2: extracts exactly the URL out of surrounding prose (no trailing text)", () => {
    SKYNET_FILE_URL_RE_CLIENT.lastIndex = 0;
    const body =
      "body text https://term.gigaashley.click/file/thenasty/home/ubuntu/note.md more text";
    const matches = body.match(SKYNET_FILE_URL_RE_CLIENT);
    expect(matches).toEqual([
      "https://term.gigaashley.click/file/thenasty/home/ubuntu/note.md",
    ]);
  });

  it("Test 3: matches a URL with an explicit port on the Skynet domain", () => {
    SKYNET_FILE_URL_RE_CLIENT.lastIndex = 0;
    const url =
      "https://term.gigaashley.click:8080/file/thenasty/etc/hostname";
    const matches = url.match(SKYNET_FILE_URL_RE_CLIENT);
    expect(matches).toContain(url);
  });

  it("Test 4: markdown-link surrounding paren is stripped by stripTrailingPunct (composes cleanly)", () => {
    SKYNET_FILE_URL_RE_CLIENT.lastIndex = 0;
    const raw = "(https://term.gigaashley.click/file/thenasty/foo.md)";
    const matches = raw.match(SKYNET_FILE_URL_RE_CLIENT);
    // The regex terminator [^\s)?#]+ stops at the closing paren, so the
    // match is the URL without the trailing `)`.
    expect(matches).not.toBeNull();
    expect(matches![0]).toBe(
      "https://term.gigaashley.click/file/thenasty/foo.md",
    );
    // stripTrailingPunct then handles prose-end punctuation the same way it
    // does for TAILNET_URL_RE_CLIENT — passing a clean URL through leaves it
    // unchanged, and passing a URL with a trailing period trims it.
    expect(stripTrailingPunct(matches![0])).toBe(matches![0]);
    expect(
      stripTrailingPunct(
        "https://term.gigaashley.click/file/thenasty/foo.md.",
      ),
    ).toBe("https://term.gigaashley.click/file/thenasty/foo.md");
  });

  it("Test 5: does NOT match http:// scheme (Skynet is HTTPS-only)", () => {
    SKYNET_FILE_URL_RE_CLIENT.lastIndex = 0;
    const url = "http://term.gigaashley.click/file/thenasty/foo.md";
    const matches = url.match(SKYNET_FILE_URL_RE_CLIENT);
    expect(matches).toBeNull();
  });

  it("Test 6: does NOT match a tailnet URL (that shape belongs to TAILNET_URL_RE_CLIENT)", () => {
    SKYNET_FILE_URL_RE_CLIENT.lastIndex = 0;
    const url = "http://100.80.122.111:8001/foo";
    const matches = url.match(SKYNET_FILE_URL_RE_CLIENT);
    expect(matches).toBeNull();
  });

  it("Test 7: regex uses the /g flag (required for .match() extraction pattern)", () => {
    expect(SKYNET_FILE_URL_RE_CLIENT.flags.includes("g")).toBe(true);
  });

  it("Test 8: TAILNET_URL_RE_CLIENT behavior is unchanged — extracts a tailnet URL as before", () => {
    TAILNET_URL_RE_CLIENT.lastIndex = 0;
    const body = "grab http://100.64.0.1:8000/notes.md from the agent";
    const matches = body.match(TAILNET_URL_RE_CLIENT);
    expect(matches).toEqual(["http://100.64.0.1:8000/notes.md"]);
    // And still does NOT match the new file-URL shape (regexes are disjoint).
    TAILNET_URL_RE_CLIENT.lastIndex = 0;
    const fileUrl =
      "https://term.gigaashley.click/file/thenasty/home/ubuntu/note.md";
    expect(fileUrl.match(TAILNET_URL_RE_CLIENT)).toBeNull();
  });
});

describe("SKYNET_SERVE_URL_RE_CLIENT — serve-URL client regex (Phase 103 D-29)", () => {
  it("matches basic serve URL (host + port + no path)", () => {
    SKYNET_SERVE_URL_RE_CLIENT.lastIndex = 0;
    const url = "https://t1000-3020.serve.term.gigaashley.click";
    const matches = url.match(SKYNET_SERVE_URL_RE_CLIENT);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(1);
    expect(matches).toContain(url);
  });

  it("matches serve URL with path", () => {
    SKYNET_SERVE_URL_RE_CLIENT.lastIndex = 0;
    const url =
      "https://t1000-3020.serve.term.gigaashley.click/foo/bar";
    const matches = url.match(SKYNET_SERVE_URL_RE_CLIENT);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(1);
    expect(matches).toContain(url);
  });

  it("matches serve URL with different hostname + port (thenasty-8080)", () => {
    SKYNET_SERVE_URL_RE_CLIENT.lastIndex = 0;
    const url = "https://thenasty-8080.serve.term.gigaashley.click";
    const matches = url.match(SKYNET_SERVE_URL_RE_CLIENT);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(1);
  });

  it("matches serve URL with mixed-case hostname (D-13 case preservation)", () => {
    SKYNET_SERVE_URL_RE_CLIENT.lastIndex = 0;
    const url = "https://GIGAASHLEYPC-3000.serve.term.gigaashley.click";
    const matches = url.match(SKYNET_SERVE_URL_RE_CLIENT);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects URL without a digit port (foo-bar has no numeric suffix)", () => {
    SKYNET_SERVE_URL_RE_CLIENT.lastIndex = 0;
    const url = "https://foo-bar.serve.term.gigaashley.click";
    const matches = url.match(SKYNET_SERVE_URL_RE_CLIENT);
    expect(matches).toBeNull();
  });

  it("rejects a file URL (belongs to SKYNET_FILE_URL_RE_CLIENT)", () => {
    SKYNET_SERVE_URL_RE_CLIENT.lastIndex = 0;
    const url = "https://term.gigaashley.click/file/host/path";
    const matches = url.match(SKYNET_SERVE_URL_RE_CLIENT);
    expect(matches).toBeNull();
  });

  it("rejects a tailnet URL (belongs to TAILNET_URL_RE_CLIENT)", () => {
    SKYNET_SERVE_URL_RE_CLIENT.lastIndex = 0;
    const url = "http://100.64.1.2:3000/";
    const matches = url.match(SKYNET_SERVE_URL_RE_CLIENT);
    expect(matches).toBeNull();
  });

  it("rejects an arbitrary web URL", () => {
    SKYNET_SERVE_URL_RE_CLIENT.lastIndex = 0;
    const url = "https://example.com/path";
    const matches = url.match(SKYNET_SERVE_URL_RE_CLIENT);
    expect(matches).toBeNull();
  });

  it("rejects http:// scheme (serve URLs are HTTPS-only)", () => {
    SKYNET_SERVE_URL_RE_CLIENT.lastIndex = 0;
    const url = "http://t1000-3020.serve.term.gigaashley.click";
    const matches = url.match(SKYNET_SERVE_URL_RE_CLIENT);
    expect(matches).toBeNull();
  });

  it("uses the /g flag (mirror-rule with siblings, required for .match() extraction)", () => {
    expect(SKYNET_SERVE_URL_RE_CLIENT.flags.includes("g")).toBe(true);
  });
});

describe("non-overlap invariants — three sibling URL regexes are disjoint", () => {
  // Fresh non-global regexes for dispatch-style .test() checks — mirrors the
  // dispatch pattern in use-editable-file-eligibility.ts (FILE_URL_DISPATCH_RE)
  // so that /g state cannot contaminate the invariant assertion.
  const SERVE_RE_NO_G =
    /^https:\/\/[a-zA-Z0-9._-]+-\d{1,5}\.serve\.term\.[a-zA-Z0-9.-]+(?::\d{1,5})?(?:\/[^\s)?#]*)?$/;
  const FILE_RE_NO_G =
    /^https:\/\/[a-zA-Z0-9.-]+(?::\d{1,5})?\/file\/[a-zA-Z0-9._-]+\/[^\s)?#]+$/;
  const TAILNET_RE_NO_G =
    /^http:\/\/100\.(?:6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3}:\d{1,5}\/[^\s)]+$/;

  it("serve URL does NOT match SKYNET_FILE_URL_RE_CLIENT (fresh regex)", () => {
    const serveUrl = "https://t1000-3020.serve.term.gigaashley.click/app";
    expect(FILE_RE_NO_G.test(serveUrl)).toBe(false);
    // Also verify with the /g regex via .match() (stateless per MDN).
    SKYNET_FILE_URL_RE_CLIENT.lastIndex = 0;
    expect(serveUrl.match(SKYNET_FILE_URL_RE_CLIENT)).toBeNull();
  });

  it("serve URL does NOT match TAILNET_URL_RE_CLIENT (fresh regex)", () => {
    const serveUrl = "https://t1000-3020.serve.term.gigaashley.click/app";
    expect(TAILNET_RE_NO_G.test(serveUrl)).toBe(false);
    TAILNET_URL_RE_CLIENT.lastIndex = 0;
    expect(serveUrl.match(TAILNET_URL_RE_CLIENT)).toBeNull();
  });

  it("file URL does NOT match SKYNET_SERVE_URL_RE_CLIENT (reciprocal)", () => {
    const fileUrl =
      "https://term.gigaashley.click/file/thenasty/home/ubuntu/note.md";
    expect(SERVE_RE_NO_G.test(fileUrl)).toBe(false);
    SKYNET_SERVE_URL_RE_CLIENT.lastIndex = 0;
    expect(fileUrl.match(SKYNET_SERVE_URL_RE_CLIENT)).toBeNull();
  });
});
