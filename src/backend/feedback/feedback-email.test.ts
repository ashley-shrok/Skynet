/**
 * Phase 121 Plan 01 — vitest coverage for feedback-email.ts pure functions.
 *
 * Covers D-15 (plaintext), D-16 (subject shape), D-19 (body header block),
 * D-20 (no URL / "View in app"), D-21 (markdown source verbatim), D-22
 * (exchange omitted when includeContent=false — enforced by CALLER passing
 * undefined; composeBody itself only checks presence), D-23 (general emails
 * NEVER carry exchange content — same caller-enforced pattern), plus
 * threat T-121-02 (CRLF strip on appName).
 */

import { describe, it, expect } from "vitest";
import { composeSubject, composeBody } from "./feedback-email.js";

describe("composeSubject (D-16, T-121-02)", () => {
  it("plain appName + type → bracketed prefix format", () => {
    expect(composeSubject({ appName: "example-instance", type: "thumbs down" })).toBe(
      "[example-instance feedback] thumbs down",
    );
  });

  it("general type", () => {
    expect(composeSubject({ appName: "example-instance", type: "general" })).toBe(
      "[example-instance feedback] general",
    );
  });

  it("thumbs up type", () => {
    expect(composeSubject({ appName: "example-instance", type: "thumbs up" })).toBe(
      "[example-instance feedback] thumbs up",
    );
  });

  it("appName with CRLF → CRLF stripped (T-121-02 SMTP header injection guard)", () => {
    expect(
      composeSubject({
        appName: "malicious\r\nBcc: attacker@evil",
        type: "general",
      }),
    ).toBe("[maliciousBcc: attacker@evil feedback] general");
  });

  it("appName with \\r only → stripped", () => {
    expect(composeSubject({ appName: "abc\rdef", type: "general" })).toBe(
      "[abcdef feedback] general",
    );
  });

  it("appName with \\n only → stripped", () => {
    expect(composeSubject({ appName: "abc\ndef", type: "general" })).toBe(
      "[abcdef feedback] general",
    );
  });

  it("output never contains raw CR or LF for any hostile appName", () => {
    const out = composeSubject({
      appName: "x\r\ny\nz\r",
      type: "general",
    });
    expect(out).not.toContain("\r");
    expect(out).not.toContain("\n");
  });
});

describe("composeBody header block (D-19)", () => {
  const baseArgs = {
    submitter: "the-user",
    appName: "example-instance",
    // 2026-09-19T15:24:00Z — ISO-8601 UTC output
    timestamp: Date.UTC(2026, 8, 19, 15, 24, 0),
    type: "general",
    userNote: "",
  };

  it("header block has exactly 4 lines with the D-19 keys", () => {
    const body = composeBody(baseArgs);
    const headerLines = body.split("\n").slice(0, 4);
    expect(headerLines[0]).toBe("Feedback from: the-user");
    expect(headerLines[1]).toBe("Instance:      example-instance");
    expect(headerLines[2]).toBe("When:          2026-09-19T15:24:00.000Z");
    expect(headerLines[3]).toBe("Type:          general");
  });

  it("When: field uses ISO-8601 UTC (Z suffix)", () => {
    const body = composeBody(baseArgs);
    expect(body).toMatch(/When:\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
  });

  it("empty userNote + no exchangeText → header block only (with trailing newline)", () => {
    const body = composeBody(baseArgs);
    // 4 header lines joined by \n, then trailing \n
    const expected =
      "Feedback from: the-user\n" +
      "Instance:      example-instance\n" +
      "When:          2026-09-19T15:24:00.000Z\n" +
      "Type:          general\n";
    expect(body).toBe(expected);
    expect(body).not.toContain("--- User note ---");
    expect(body).not.toContain("--- Exchange ---");
  });
});

describe("composeBody user-note section (D-19)", () => {
  const baseArgs = {
    submitter: "the-user",
    appName: "example-instance",
    timestamp: Date.UTC(2026, 8, 19, 15, 24, 0),
    type: "general",
  };

  it("userNote='hi' → includes --- User note --- section verbatim", () => {
    const body = composeBody({ ...baseArgs, userNote: "hi" });
    expect(body).toContain("--- User note ---\nhi");
  });

  it("userNote empty string → no user-note section", () => {
    const body = composeBody({ ...baseArgs, userNote: "" });
    expect(body).not.toContain("--- User note ---");
  });

  it("userNote whitespace-only → treated as empty (no section)", () => {
    const body = composeBody({ ...baseArgs, userNote: "   \n\n  " });
    expect(body).not.toContain("--- User note ---");
  });

  it("userNote with markdown → preserved verbatim (no transform)", () => {
    const md = "**bold** and _italic_ and `code` and\n```\nfenced\n```";
    const body = composeBody({ ...baseArgs, userNote: md });
    expect(body).toContain("--- User note ---\n" + md);
  });
});

describe("composeBody exchange section (D-21)", () => {
  const baseArgs = {
    submitter: "the-user",
    appName: "example-instance",
    timestamp: Date.UTC(2026, 8, 19, 15, 24, 0),
    type: "thumbs down",
    userNote: "broken",
  };

  it("exchangeText undefined → NO --- Exchange --- section (D-22 caller-driven)", () => {
    const body = composeBody({ ...baseArgs, exchangeText: undefined });
    expect(body).not.toContain("--- Exchange ---");
  });

  it("exchangeText='' → NO --- Exchange --- section (empty after trim)", () => {
    const body = composeBody({ ...baseArgs, exchangeText: "" });
    expect(body).not.toContain("--- Exchange ---");
  });

  it("exchangeText whitespace-only → NO --- Exchange --- section", () => {
    const body = composeBody({ ...baseArgs, exchangeText: "   \n\t  " });
    expect(body).not.toContain("--- Exchange ---");
  });

  it("exchangeText with content → --- Exchange --- section with body verbatim (D-21)", () => {
    const exch = "user asked X, bot said Y";
    const body = composeBody({ ...baseArgs, exchangeText: exch });
    expect(body).toContain("--- Exchange ---\n" + exch);
  });

  it("exchangeText with markdown fences → preserved verbatim (D-21)", () => {
    const exch = "```typescript\nx()\n```";
    const body = composeBody({ ...baseArgs, exchangeText: exch });
    expect(body).toContain("--- Exchange ---\n" + exch);
    // Fence chars are still there — no stripping.
    expect(body).toContain("```typescript");
    expect(body).toContain("```");
  });
});

describe("composeBody D-20: no URL scheme, no view-in-app affordance", () => {
  it("body never contains http:// or https:// for any input", () => {
    const inputs = [
      { userNote: "check https://evil.example.com for details" },
      { userNote: "http://internal", exchangeText: "https://external" },
      { userNote: "no url here", exchangeText: "no url here either" },
    ];
    for (const extra of inputs) {
      const body = composeBody({
        submitter: "the-user",
        appName: "example-instance",
        timestamp: Date.UTC(2026, 8, 19, 15, 24, 0),
        type: "thumbs down",
        userNote: "",
        ...extra,
      });
      // Locate URL schemes ONLY in the header (D-20 forbids composeBody
      // synthesizing a URL — but if the user pasted one in their own note or
      // in the exchange, that's their content, verbatim per D-21). So the
      // check is: NO URL appears in the header block (first 4 lines).
      const headerBlock = body.split("\n").slice(0, 4).join("\n");
      expect(headerBlock).not.toMatch(/https?:\/\//);
      expect(headerBlock).not.toContain("View in app");
      expect(headerBlock).not.toContain("Open in");
    }
  });

  it("no --- View in app --- section synthesized for any input", () => {
    const body = composeBody({
      submitter: "the-user",
      appName: "example-instance",
      timestamp: Date.UTC(2026, 8, 19, 15, 24, 0),
      type: "thumbs down",
      userNote: "note",
      exchangeText: "exchange",
    });
    expect(body).not.toContain("--- View in app ---");
    expect(body).not.toContain("--- Link ---");
  });
});

describe("composeBody 6-permutation matrix (kind x exchangeText presence)", () => {
  const base = {
    submitter: "the-user",
    appName: "example-instance",
    timestamp: Date.UTC(2026, 8, 19, 15, 24, 0),
    userNote: "note text",
  };
  const kinds = ["general", "thumbs up", "thumbs down"] as const;

  for (const kind of kinds) {
    it(`kind=${kind}, exchangeText=undefined → user-note yes, exchange no`, () => {
      const body = composeBody({ ...base, type: kind, exchangeText: undefined });
      expect(body).toContain(`Type:          ${kind}`);
      expect(body).toContain("--- User note ---\nnote text");
      expect(body).not.toContain("--- Exchange ---");
    });

    it(`kind=${kind}, exchangeText='exch content' → user-note yes, exchange yes (caller controls inclusion)`, () => {
      const body = composeBody({
        ...base,
        type: kind,
        exchangeText: "exch content",
      });
      expect(body).toContain(`Type:          ${kind}`);
      expect(body).toContain("--- User note ---\nnote text");
      expect(body).toContain("--- Exchange ---\nexch content");
    });
  }
});

describe("composeBody exact byte layout (snapshot)", () => {
  it("locks the exact string layout for a full-content thumbs-down email", () => {
    const body = composeBody({
      submitter: "the-user",
      appName: "example-instance",
      timestamp: Date.UTC(2026, 8, 19, 15, 24, 0),
      type: "thumbs down",
      userNote: "The migration binary doesn't exist.",
      exchangeText: "User asked X. Bot said Y.",
    });
    const expected =
      "Feedback from: the-user\n" +
      "Instance:      example-instance\n" +
      "When:          2026-09-19T15:24:00.000Z\n" +
      "Type:          thumbs down\n" +
      "\n" +
      "--- User note ---\n" +
      "The migration binary doesn't exist.\n" +
      "\n" +
      "--- Exchange ---\n" +
      "User asked X. Bot said Y.\n";
    expect(body).toBe(expected);
  });

  it("locks the exact string layout for a general-only header-only email", () => {
    const body = composeBody({
      submitter: "the-user",
      appName: "example-instance",
      timestamp: Date.UTC(2026, 8, 19, 15, 24, 0),
      type: "general",
      userNote: "",
    });
    const expected =
      "Feedback from: the-user\n" +
      "Instance:      example-instance\n" +
      "When:          2026-09-19T15:24:00.000Z\n" +
      "Type:          general\n";
    expect(body).toBe(expected);
  });
});
