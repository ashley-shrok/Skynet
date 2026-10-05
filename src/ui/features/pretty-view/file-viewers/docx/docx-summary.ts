import JSZip from "jszip";

const PREVIEW_PARAGRAPHS = 4;

export interface DocxSummary {
  title: string | null;
  paragraphs: string[];
}

const W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

/** Title + first non-empty paragraphs of a .docx, read straight from its XML. */
export async function summarizeDocx(bytes: ArrayBuffer): Promise<DocxSummary> {
  const zip = await JSZip.loadAsync(bytes);
  const body = await zip.file("word/document.xml")?.async("string");
  if (!body) throw new Error("not a docx");
  const doc = new DOMParser().parseFromString(body, "application/xml");
  const paragraphs: Array<{ text: string; heading: boolean }> = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W_NS, "p"))) {
    const text = Array.from(p.getElementsByTagNameNS(W_NS, "t"))
      .map((t) => t.textContent ?? "")
      .join("")
      .trim();
    if (!text) continue;
    const style = p.getElementsByTagNameNS(W_NS, "pStyle")[0]?.getAttributeNS(W_NS, "val") ?? "";
    paragraphs.push({ text, heading: /^(Title|Heading)/i.test(style) });
    if (paragraphs.length >= PREVIEW_PARAGRAPHS + 1) break;
  }
  const core = await zip.file("docProps/core.xml")?.async("string");
  const propTitle = core ? /<dc:title>([^<]+)<\/dc:title>/.exec(core)?.[1]?.trim() : undefined;
  let title: string | null = propTitle || null;
  if (!title && paragraphs[0]?.heading) title = paragraphs.shift()!.text;
  // The title property often repeats the document's first (Title) paragraph.
  else if (title && paragraphs[0]?.text === title) paragraphs.shift();
  return { title, paragraphs: paragraphs.slice(0, PREVIEW_PARAGRAPHS).map((p) => p.text) };
}

