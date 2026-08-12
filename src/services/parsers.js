import path from "node:path";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";
import mammoth from "mammoth";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const DOCX_TEXT_PARTS = [
  /^word\/document\.xml$/,
  /^word\/header\d+\.xml$/,
  /^word\/footer\d+\.xml$/,
  /^word\/footnotes\.xml$/,
  /^word\/endnotes\.xml$/
];

async function parsePdf(bytes) {
  const pdf = await getDocument({ data: new Uint8Array(bytes), useWorkerFetch: false, isEvalSupported: false }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pages.push(content.items.map((x) => x.str || "").join(" "));
  }
  return pages.map((text, i) => `[Page ${i + 1}]\n${text}`).join("\n\n");
}

function xmlLocalName(node) {
  return node.localName || node.nodeName?.split(":").pop() || "";
}

function extractXmlText(xml) {
  const document = new DOMParser({ errorHandler: () => {} }).parseFromString(xml, "application/xml");
  const output = [];

  function visit(node) {
    if (node.nodeType === 1) {
      const name = xmlLocalName(node);
      if (name === "t" || name === "delText") {
        output.push(node.textContent || "");
        return;
      }
      if (name === "tab") {
        output.push("\t");
        return;
      }
      if (name === "br" || name === "cr") {
        output.push("\n");
        return;
      }
      for (const child of Array.from(node.childNodes || [])) visit(child);
      if (name === "p") output.push("\n\n");
    }
  }

  visit(document.documentElement);
  return output.join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function parseDocxFallback(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((name) => DOCX_TEXT_PARTS.some((pattern) => pattern.test(name)));
  const parts = [];
  for (const name of names) {
    const entry = zip.file(name);
    if (!entry) continue;
    const text = extractXmlText(await entry.async("string"));
    if (text) parts.push(text);
  }
  return parts.join("\n\n");
}

export async function parseUpload(file) {
  const name = file.name || "upload";
  const ext = path.extname(name).toLowerCase();
  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  if (ext === ".pdf") return { text: await parsePdf(bytes), sourceType: "pdf" };
  if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer: bytes });
    const text = result.value?.trim() ? result.value : await parseDocxFallback(bytes);
    return { text, sourceType: "docx" };
  }
  if ([".md", ".markdown"].includes(ext)) return { text: bytes.toString("utf8"), sourceType: "md" };
  if ([".txt", ".text"].includes(ext)) return { text: bytes.toString("utf8"), sourceType: "txt" };
  throw new Error("Unsupported file type. Use PDF, DOCX, MD, or TXT.");
}
