export function chunkText(text, { chunkSize = 1200, overlap = 180 } = {}) {
  const normalized = String(text || "").replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!normalized) return [];
  const paragraphs = normalized.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
  const chunks = [];
  let current = "";
  for (const p of paragraphs) {
    if ((current + "\n\n" + p).length <= chunkSize) {
      current = current ? `${current}\n\n${p}` : p;
      continue;
    }
    if (current) chunks.push(current);
    if (p.length <= chunkSize) { current = p; continue; }
    let start = 0;
    while (start < p.length) {
      const end = Math.min(start + chunkSize, p.length);
      chunks.push(p.slice(start, end));
      if (end === p.length) break;
      start = Math.max(end - overlap, start + 1);
    }
    current = "";
  }
  if (current) chunks.push(current);
  return chunks;
}
