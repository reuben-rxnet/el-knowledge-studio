import "server-only";
import JSZip from "jszip";

/** Max characters of source text sent to the model, to keep prompts bounded. */
export const SOURCE_TEXT_LIMIT = 60_000;

const decodeXml = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
const runs = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "g"))].map((m) => decodeXml(m[1]!));

async function docxText(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
  // Paragraph by paragraph, so steps keep their line breaks.
  return xml.split(/<\/w:p>/).map((p) => runs(p, "w:t").join("")).filter((l) => l.trim()).join("\n");
}

async function pptxText(buf: Buffer) {
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  const out: string[] = [];
  for (const [i, name] of slides.entries()) {
    const xml = await zip.file(name)!.async("string");
    const text = xml.split(/<\/a:p>/).map((p) => runs(p, "a:t").join("")).filter((l) => l.trim()).join("\n");
    if (text) out.push(`Slide ${i + 1}\n${text}`);
  }
  return out.join("\n\n");
}

async function pdfText(buf: Buffer) {
  const { extractText, getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(pdf, { mergePages: false });
  return (Array.isArray(text) ? text : [text]).map((t, i) => `Page ${i + 1}\n${t}`).join("\n\n");
}

/** Text of a document, or null when the type isn't a text document. Throws on a corrupt file. */
export async function extractDocumentText(buf: Buffer, fileName: string): Promise<string | null> {
  const ext = fileName.split(".").pop()?.toLowerCase();
  let text: string | null = null;
  if (ext === "docx") text = await docxText(buf);
  else if (ext === "pptx") text = await pptxText(buf);
  else if (ext === "pdf") text = await pdfText(buf);
  else if (ext === "txt" || ext === "md" || ext === "vtt" || ext === "srt") text = buf.toString("utf8");
  if (text === null) return null;
  return text.replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim().slice(0, SOURCE_TEXT_LIMIT);
}
