import { describe, it, expect, afterEach } from "vitest";
import { cleanSelectionPayload, handleCleanCopy } from "./clean-copy";

function selectContents(el: HTMLElement): Selection {
  const sel = window.getSelection()!;
  sel.removeAllRanges();
  const range = document.createRange();
  range.selectNodeContents(el);
  sel.addRange(range);
  return sel;
}

function mountBubble(html: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "pv-bubble prose";
  el.setAttribute("style", "background-color: rgb(20,20,30); color: white");
  el.innerHTML = html;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("cleanSelectionPayload", () => {
  it("returns null with nothing selected", () => {
    window.getSelection()?.removeAllRanges();
    expect(cleanSelectionPayload(window.getSelection())).toBeNull();
  });

  it("keeps structure but drops style, class and data attributes", () => {
    const el = mountBubble(
      '<p class="x" style="background:#000;color:#fff">Hi <strong style="color:red">Laura</strong></p>' +
        '<ul data-k="1"><li>one</li></ul><a href="https://e.x" class="l">link</a>',
    );
    const payload = cleanSelectionPayload(selectContents(el))!;
    expect(payload.html).toBe(
      '<p>Hi <strong>Laura</strong></p><ul><li>one</li></ul><a href="https://e.x">link</a>',
    );
    expect(payload.html).not.toMatch(/style|class|background|color/);
  });

  it("leaves out bubble chrome (buttons, icons)", () => {
    const el = mountBubble(
      '<p>Body</p><button aria-label="Copy"><svg></svg>Copy</button><span aria-hidden="true">x</span>',
    );
    const payload = cleanSelectionPayload(selectContents(el))!;
    expect(payload.html).toBe("<p>Body</p>");
  });
});

describe("handleCleanCopy", () => {
  it("writes clean html + plain text and suppresses the default copy", () => {
    const el = mountBubble('<p style="background:#000">Hello</p>');
    selectContents(el);
    const data: Record<string, string> = {};
    let prevented = false;
    const event = {
      clipboardData: { setData: (t: string, v: string) => (data[t] = v) },
      preventDefault: () => (prevented = true),
    } as unknown as ClipboardEvent;
    handleCleanCopy(event);
    expect(prevented).toBe(true);
    expect(data["text/html"]).toBe("<p>Hello</p>");
    expect(data["text/plain"]).toContain("Hello");
  });

  it("does nothing when the selection is empty", () => {
    let prevented = false;
    const event = {
      clipboardData: { setData: () => {} },
      preventDefault: () => (prevented = true),
    } as unknown as ClipboardEvent;
    handleCleanCopy(event);
    expect(prevented).toBe(false);
  });
});
