import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { summarizeDocx } from "./docx-summary";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text: string, style?: string) =>
  `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}<w:r><w:t>${text}</w:t></w:r></w:p>`;

async function docx(body: string, title?: string): Promise<ArrayBuffer> {
  const zip = new JSZip();
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  if (title) {
    zip.file(
      "docProps/core.xml",
      `<cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title></cp:coreProperties>`,
    );
  }
  return (await zip.generateAsync({ type: "uint8array" })).buffer as ArrayBuffer;
}

describe("summarizeDocx", () => {
  it("uses the title property and skips a first paragraph that repeats it", async () => {
    const s = await summarizeDocx(await docx(para("Plan", "Title") + para("First") + para("Second"), "Plan"));
    expect(s).toEqual({ title: "Plan", paragraphs: ["First", "Second"] });
  });

  it("falls back to a leading heading as the title", async () => {
    const s = await summarizeDocx(await docx(para("Report", "Heading1") + para("Body text")));
    expect(s).toEqual({ title: "Report", paragraphs: ["Body text"] });
  });

  it("skips empty paragraphs, joins runs and caps the paragraph count", async () => {
    const runs = '<w:p><w:r><w:t>Hello </w:t></w:r><w:r><w:t>world</w:t></w:r></w:p>';
    const s = await summarizeDocx(await docx(para("") + runs + para("b") + para("c") + para("d") + para("e") + para("f")));
    expect(s.title).toBeNull();
    expect(s.paragraphs).toEqual(["Hello world", "b", "c", "d"]);
  });

  it("rejects files that aren't Word documents", async () => {
    const zip = new JSZip();
    zip.file("other.txt", "x");
    const bytes = (await zip.generateAsync({ type: "uint8array" })).buffer as ArrayBuffer;
    await expect(summarizeDocx(bytes)).rejects.toThrow();
  });
});
