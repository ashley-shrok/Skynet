import { describe, it, expect } from "vitest";
import {
  buildCallTwiml,
  buildOpeningLine,
  buildReceiptLine,
  escapeXml,
} from "./call-script.js";

describe("call script", () => {
  it("builds the opener and receipt around the caller name", () => {
    expect(buildOpeningLine("Clipper", "CI failed.")).toBe(
      "Hi, this is Clipper. CI failed.",
    );
    expect(buildReceiptLine("Clipper")).toBe(
      "Your reply has been sent back to Clipper. You may hang up.",
    );
  });

  it("flattens newlines and runs of whitespace into single spaces", () => {
    expect(buildOpeningLine("  Clip\nper ", "line one\n\n\tline two")).toBe(
      "Hi, this is Clip per. line one line two",
    );
  });

  it("escapes XML so a message cannot inject TwiML verbs", () => {
    const evil = 'x</Say><Dial>+15555550199</Dial><Say>"&\'';
    const twiml = buildCallTwiml(buildOpeningLine("A", evil), buildReceiptLine("A"));
    expect(twiml).not.toContain("<Dial>");
    expect(twiml).toContain(escapeXml(evil));
    expect(twiml.match(/<Say /g)).toHaveLength(2);
  });

  it("leaves quotes alone (text nodes don't need them escaped)", () => {
    expect(escapeXml(`it's "fine" & <ok>`)).toBe(`it's "fine" &amp; &lt;ok&gt;`);
  });

  it("says the opener, records the reply without a webhook, then says the receipt", () => {
    const twiml = buildCallTwiml("Hi, this is A. M", "R");
    expect(twiml).toMatch(
      /^<Response><Say voice="[^"]+">Hi, this is A\. M<\/Say><Record [^>]*\/><Say voice="[^"]+">R<\/Say><Hangup\/><\/Response>$/,
    );
    expect(twiml).not.toContain("action=");
    expect(twiml).toContain('playBeep="false"');
  });
});
