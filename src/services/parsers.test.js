import { test, expect } from "bun:test";
import JSZip from "jszip";
import { parseUpload } from "./parsers.js";

async function makeDocx(documentXml) {
  const zip = new JSZip();
  zip.file("word/document.xml", documentXml);
  return zip.generateAsync({ type: "uint8array" });
}

const documentXml = (body) => `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr/></w:body></w:document>`;

test("extracts text from ordinary DOCX paragraphs", async () => {
  const bytes = await makeDocx(documentXml("<w:p><w:r><w:t>Hello DOCX</w:t></w:r></w:p>"));
  expect(await parseUpload(new File([bytes], "ordinary.docx"))).toEqual({ text: "Hello DOCX\n\n", sourceType: "docx" });
});

test("falls back to OOXML text runs when Mammoth returns no text", async () => {
  const bytes = await makeDocx(documentXml("<w:custom><w:txbxContent><w:p><w:r><w:t>Text in a box</w:t></w:r></w:p></w:txbxContent></w:custom>"));
  expect(await parseUpload(new File([bytes], "text-box.docx"))).toEqual({ text: "Text in a box", sourceType: "docx" });
});
