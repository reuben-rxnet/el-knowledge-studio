import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Page images for documents, so a video made from a presentation shows the real slides.
 *   PPTX/DOCX -> PDF: LibreOffice, headless (open source, MPL-2.0), installed on the server.
 *   PDF -> PNG: pdf.js through unpdf, drawn with @napi-rs/canvas (MIT), in this process.
 * LibreOffice runs with its own throwaway profile, so it never clashes with a copy someone has open,
 * and gets the file through an argument list, never a shell string.
 * Local development on Windows: Microsoft 365 desktop apps (PowerPoint for slides, Word for documents)
 * export to PDF through Office automation, preferred over LibreOffice because they render company
 * templates and fonts exactly. Never in production (Office isn't supported unattended on a server;
 * production uses LibreOffice, or Microsoft Graph conversion once IT grants it). The automation never
 * closes an Office window the user has open.
 */
const SOFFICE_CANDIDATES = [
  "C:/Program Files/LibreOffice/program/soffice.exe",
  "C:/Program Files (x86)/LibreOffice/program/soffice.exe",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
  "/usr/lib/libreoffice/program/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
];
export const sofficePath = () => process.env.SOFFICE_PATH?.trim() || SOFFICE_CANDIDATES.find((p) => existsSync(p)) || null;

const OFFICE_DIRS = ["C:/Program Files/Microsoft Office/root/Office16", "C:/Program Files (x86)/Microsoft Office/root/Office16", "C:/Program Files/Microsoft Office/Office16"];
const SLIDE_TYPES = ["pptx", "ppt"];
const IMAGE_TYPES = ["png", "jpg", "jpeg"];
const WORD_TYPES = ["docx", "doc"];
const extOf = (fileName: string) => fileName.split(".").pop()?.toLowerCase() ?? "";

/** The Office desktop app that can convert this file here, if any: Windows development only. */
function officeAppFor(ext: string): "PowerPoint" | "Word" | null {
  if (process.platform !== "win32" || process.env.NODE_ENV === "production" || process.env.OFFICE_CONVERSION === "off") return null;
  const app = SLIDE_TYPES.includes(ext) ? { name: "PowerPoint" as const, exe: "POWERPNT.EXE" } : WORD_TYPES.includes(ext) ? { name: "Word" as const, exe: "WINWORD.EXE" } : null;
  return app && OFFICE_DIRS.some((d) => existsSync(`${d}/${app.exe}`)) ? app.name : null;
}

export const MAX_PAGES = 60;
const WIDTH = 1280;

/** Which files can get page images on this server, and why not when they can't. */
export function pageImageSupport(fileName: string): { ok: true } | { ok: false; reason: string } {
  const ext = extOf(fileName);
  if (ext === "pdf" || IMAGE_TYPES.includes(ext)) return { ok: true };
  if (![...SLIDE_TYPES, ...WORD_TYPES, "odp", "odt"].includes(ext)) return { ok: false, reason: "This file type has no pages to show." };
  if (officeAppFor(ext) || sofficePath()) return { ok: true };
  return { ok: false, reason: "Slide images need LibreOffice on the server (set SOFFICE_PATH, or install LibreOffice)." };
}

function run(exe: string, args: string[], label: string, timeoutMs = 180_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true });
    let err = "";
    child.stderr.on("data", (d: Buffer) => { err = (err + d.toString()).slice(-2000); });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(); else reject(new Error(`${label} failed (${code}): ${err.trim().slice(-200)}`)); });
  });
}

/**
 * Office automation scripts. Each opens the file read-only with no window, exports a PDF and closes it
 * without saving. Then it quits the app only when the app is invisible and has nothing open: that is an
 * automation copy nobody is using, never a window someone has open. (Checking "was it running before?"
 * instead leaked hidden copies: one left behind by a failed run made every later run keep its own.)
 * File paths reach the script as parameters, never inside the script text.
 */
const OFFICE_TO_PDF = {
  PowerPoint: `param([string]$In, [string]$Out)
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject PowerPoint.Application
try {
  # Open(FileName, ReadOnly = msoTrue, Untitled = msoFalse, WithWindow = msoFalse); 32 = ppSaveAsPDF
  $pres = $app.Presentations.Open($In, -1, 0, 0)
  try { $pres.SaveAs($Out, 32) } finally { $pres.Close() }
} finally {
  try { if ($app.Visible -eq 0 -and $app.Presentations.Count -eq 0) { $app.Quit() } } catch {}
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
`,
  Word: `param([string]$In, [string]$Out)
$ErrorActionPreference = 'Stop'
$app = New-Object -ComObject Word.Application
$m = [Type]::Missing
try {
  # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles, ..., Visible = false); 17 = wdExportFormatPDF
  $doc = $app.Documents.Open($In, $false, $true, $false, $m, $m, $m, $m, $m, $m, $m, $false)
  try { $doc.ExportAsFixedFormat($Out, 17) } finally { $doc.Close(0) }
} finally {
  # Quit() with no arguments: Word's Quit wants [ref] arguments from PowerShell, and the document is already closed.
  try { if (-not $app.Visible -and $app.Documents.Count -eq 0) { $app.Quit() } } catch {}
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($app)
}
`,
};

/** Converts an office file to PDF: Office on a Windows dev PC, else LibreOffice. */
async function toPdf(filePath: string, fileName: string): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "elks-topdf-"));
  try {
    const office = officeAppFor(extOf(fileName));
    if (office) {
      // Office picks the format from the extension, so it gets a copy with the original one.
      const input = path.join(dir, `input.${extOf(fileName)}`);
      await copyFile(filePath, input);
      const script = path.join(dir, "to-pdf.ps1");
      await writeFile(script, OFFICE_TO_PDF[office], "utf8");
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-In", input, "-Out", path.join(dir, "out.pdf")], office);
    } else {
      const profile = pathToFileURL(path.join(dir, "profile")).href;
      await run(sofficePath()!, ["--headless", "--norestore", "--nolockcheck", `-env:UserInstallation=${profile}`, "--convert-to", "pdf", "--outdir", dir, filePath], "LibreOffice");
    }
    const pdf = (await readdir(dir)).find((f) => f.toLowerCase().endsWith(".pdf"));
    if (!pdf) throw new Error("The conversion produced no PDF.");
    return await readFile(path.join(dir, pdf));
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** One PNG per page (slide), 1280 px wide, at most MAX_PAGES. */
export async function renderPageImages(filePath: string, fileName: string): Promise<Buffer[]> {
  const support = pageImageSupport(fileName);
  if (!support.ok) throw new Error(support.reason);
  // A picture is its own single page: redrawn as a PNG no wider than the video (EXIF-free, one format).
  if (IMAGE_TYPES.includes(extOf(fileName))) {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const img = await loadImage(await readFile(filePath));
    const scale = Math.min(1, WIDTH / img.width);
    const canvas = createCanvas(Math.max(1, Math.round(img.width * scale)), Math.max(1, Math.round(img.height * scale)));
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    return [canvas.toBuffer("image/png")];
  }
  const pdf = fileName.toLowerCase().endsWith(".pdf") ? await readFile(filePath) : await toPdf(filePath, fileName);
  const { getDocumentProxy, renderPageAsImage } = await import("unpdf");
  const doc = await getDocumentProxy(new Uint8Array(pdf));
  const out: Buffer[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, MAX_PAGES); n++) {
    const png = await renderPageAsImage(doc, n, { canvasImport: () => import("@napi-rs/canvas"), width: WIDTH });
    out.push(Buffer.from(png));
  }
  return out;
}

/** "Slide 4", "Page 2" -> 3, 1 (zero-based); anything else -> null. */
export function pageIndexOf(sourceRef: string | null | undefined): number | null {
  const m = sourceRef?.match(/\b(?:slide|page)\s+(\d+)/i);
  return m ? Number(m[1]) - 1 : null;
}

/**
 * The page to show for each chapter: the page its guide step cites, else the last cited page before it
 * (a chapter about the same slide keeps showing it), else in order.
 */
export function pagesForScenes(sceneCount: number, stepRefs: (string | null)[], pageCount: number): (number | null)[] {
  if (!pageCount) return Array.from({ length: sceneCount }, () => null);
  let last: number | null = null;
  return Array.from({ length: sceneCount }, (_, i) => {
    const cited = pageIndexOf(stepRefs[i]);
    if (cited !== null && cited < pageCount) last = cited;
    return last ?? Math.min(i, pageCount - 1);
  });
}
