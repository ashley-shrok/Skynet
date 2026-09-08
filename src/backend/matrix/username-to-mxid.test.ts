/**
 * Pure unit tests for username-to-mxid.ts (Phase 88 slice A).
 * No mocks, no fetch, no fs — all functions under test are pure per the
 * module's file-header comment.
 */

import { describe, it, expect } from "vitest";
import {
  sanitizeUsernameToLocalpart,
  buildHumanMxid,
  generateHumanRelayPassword,
  extractServerName,
} from "./username-to-mxid.js";

// duplicated from matrix-admin-routes.ts line 27 — sanitizer output must
// satisfy this on the localpart segment
const MXID_RE = /^@[a-z0-9._=/+-]{1,255}:[a-z0-9.-]{1,255}$/;

// ---------------------------------------------------------------------------
// sanitizeUsernameToLocalpart
// ---------------------------------------------------------------------------

describe("sanitizeUsernameToLocalpart", () => {
  it("lowercases the input", () => {
    expect(sanitizeUsernameToLocalpart("Ashley")).toBe("ashley");
  });

  it("passes through a simple lowercase alnum username unchanged", () => {
    expect(sanitizeUsernameToLocalpart("ashley")).toBe("ashley");
  });

  it("escapes @ and . in an email-form username (T800 case)", () => {
    expect(sanitizeUsernameToLocalpart("ashley@aitherhealth.com")).toBe(
      "ashley_at_aitherhealth_dot_com",
    );
  });

  it("escape-the-escape: literal _ in input doubles BEFORE other escapes run", () => {
    expect(sanitizeUsernameToLocalpart("snake_case")).toBe("snake__case");
  });
});

// ---------------------------------------------------------------------------
// bijectivity guards (D-07)
// ---------------------------------------------------------------------------

describe("bijectivity guards (D-07)", () => {
  it("literal _at_ in input escapes to __at__ (no collision with @ → _at_)", () => {
    expect(sanitizeUsernameToLocalpart("foo_at_bar")).toBe("foo__at__bar");
  });

  it('sanitize("foo@bar") and sanitize("foo_at_bar") produce DISTINCT outputs', () => {
    expect(sanitizeUsernameToLocalpart("foo@bar")).toBe("foo_at_bar");
    expect(sanitizeUsernameToLocalpart("foo_at_bar")).toBe("foo__at__bar");
    expect(sanitizeUsernameToLocalpart("foo@bar")).not.toBe(
      sanitizeUsernameToLocalpart("foo_at_bar"),
    );
  });
});

// ---------------------------------------------------------------------------
// hex fallback for Matrix-illegal characters (closes shape's "analogous escapes
// for any other character Synapse's localpart grammar rejects" clause)
// ---------------------------------------------------------------------------

describe("hex fallback for Matrix-illegal characters", () => {
  it("encodes ASCII space (0x20) as _20_", () => {
    expect(sanitizeUsernameToLocalpart("foo bar")).toBe("foo_20_bar");
  });

  it("encodes ! (0x21) as _21_", () => {
    expect(sanitizeUsernameToLocalpart("foo!bar")).toBe("foo_21_bar");
  });

  it("encodes multiple different illegal chars in sequence", () => {
    expect(sanitizeUsernameToLocalpart("a!b#c")).toBe("a_21_b_23_c");
  });

  it("encodes a BMP code point > 0xFF as _u<hhhh>_ (Latin-1 é 0xE9 as _e9_ is byte-form)", () => {
    // é (U+00E9) is <= 0xFF, so it uses 2-digit hex, not 4-digit
    expect(sanitizeUsernameToLocalpart("josé")).toBe("jos_e9_");
  });

  it("encodes a true BMP code point > 0xFF (Hiragana あ U+3042) as _u3042_", () => {
    expect(sanitizeUsernameToLocalpart("hiあ")).toBe("hi_u3042_");
  });

  it("throws for a non-BMP code point (emoji 😀 U+1F600)", () => {
    expect(() => sanitizeUsernameToLocalpart("hi😀")).toThrow(/non-BMP/);
  });

  it("bijectivity: literal _21_ in input escapes to __21__, distinct from ! → _21_", () => {
    expect(sanitizeUsernameToLocalpart("foo_21_bar")).toBe("foo__21__bar");
    expect(sanitizeUsernameToLocalpart("foo!bar")).toBe("foo_21_bar");
    expect(sanitizeUsernameToLocalpart("foo_21_bar")).not.toBe(
      sanitizeUsernameToLocalpart("foo!bar"),
    );
  });

  it("hex-fallback output satisfies MXID_RE", () => {
    expect(
      MXID_RE.test(buildHumanMxid("foo bar!", "matrix.example.com")),
    ).toBe(true);
    expect(
      MXID_RE.test(buildHumanMxid("josé", "matrix.example.com")),
    ).toBe(true);
    expect(
      MXID_RE.test(buildHumanMxid("hiあ", "matrix.example.com")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildHumanMxid (D-06)
// ---------------------------------------------------------------------------

describe("buildHumanMxid (D-06)", () => {
  it("simple username → @<localpart>_human:<server>", () => {
    expect(buildHumanMxid("ashley", "thenasty.taild9b663.ts.net")).toBe(
      "@ashley_human:thenasty.taild9b663.ts.net",
    );
  });

  it("email username → sanitized localpart with _human suffix", () => {
    expect(
      buildHumanMxid("ashley@aitherhealth.com", "skynet.aithercloud.com"),
    ).toBe("@ashley_at_aitherhealth_dot_com_human:skynet.aithercloud.com");
  });

  it("output satisfies MXID_RE from matrix-admin-routes.ts line 27", () => {
    expect(
      MXID_RE.test(buildHumanMxid("ashley", "thenasty.taild9b663.ts.net")),
    ).toBe(true);
    expect(
      MXID_RE.test(
        buildHumanMxid("ashley@aitherhealth.com", "skynet.aithercloud.com"),
      ),
    ).toBe(true);
    expect(
      MXID_RE.test(buildHumanMxid("snake_case", "matrix.example.com")),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// generateHumanRelayPassword (D-08)
// ---------------------------------------------------------------------------

describe("generateHumanRelayPassword (D-08)", () => {
  it("returns a 48-character string (24 bytes × 2 hex chars)", () => {
    expect(generateHumanRelayPassword().length).toBe(48);
  });

  it("returns only lowercase hex characters", () => {
    expect(generateHumanRelayPassword()).toMatch(/^[0-9a-f]{48}$/);
  });

  it("returns different values across successive calls (proves randomBytes is not stubbed)", () => {
    expect(generateHumanRelayPassword()).not.toBe(generateHumanRelayPassword());
  });
});

// ---------------------------------------------------------------------------
// extractServerName
// ---------------------------------------------------------------------------

describe("extractServerName", () => {
  it("strips https:// scheme and port", () => {
    expect(extractServerName("https://matrix.example.com:8448")).toBe(
      "matrix.example.com",
    );
  });

  it("strips http:// scheme and port for IP-form base", () => {
    expect(extractServerName("http://100.113.23.63:8008")).toBe("100.113.23.63");
  });

  it("returns bare hostname unchanged", () => {
    expect(extractServerName("matrix.example.com")).toBe("matrix.example.com");
  });

  it("strips trailing path", () => {
    expect(extractServerName("https://matrix.example.com/somepath")).toBe(
      "matrix.example.com",
    );
  });
});
