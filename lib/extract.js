// Extracts readable text from an uploaded file so it can be read and searched in the app.
// The original file is always stored separately (encrypted); this is only the text version.
const zlib = require('zlib');

// Minimal zip reader (a docx is a zip file). Returns the contents of one entry in the zip.
function readZipEntry(buf, wanted) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    if (name === wanted) {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      return method === 0 ? data : method === 8 ? zlib.inflateRawSync(data) : null;
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const decode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

// Word: paragraphs become lines, headings become Markdown headings, list items get a dash.
function docxToText(buf) {
  const xml = readZipEntry(buf, 'word/document.xml');
  if (!xml) return null;
  const body = xml.toString('utf8');
  const paras = body.match(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g) || [];
  return paras.map(p => {
    const text = decode((p.match(/<w:t[^>]*>[^<]*<\/w:t>|<w:tab\/>|<w:br\/>/g) || [])
      .map(t => t === '<w:tab/>' ? '\t' : t === '<w:br/>' ? '\n' : t.replace(/<[^>]+>/g, '')).join(''));
    const h = p.match(/<w:pStyle w:val="(?:Heading|Kop)(\d)"/i);
    if (h && text.trim()) return '#'.repeat(Math.min(6, Number(h[1]))) + ' ' + text;
    if (/<w:numPr>/.test(p) && text.trim()) return '- ' + text;
    return text;
  }).join('\n\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Returns { text, note }: note explains why there is no text (the file itself is still stored).
function extractText(name, buf) {
  const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  if (['md', 'markdown', 'txt', 'csv', 'json', 'html', 'htm', 'xml', 'puml', 'c', 'h', 'js', 'py'].includes(ext)) {
    return { text: buf.toString('utf8').replace(/^\uFEFF/, ''), note: null };
  }
  if (ext === 'docx') {
    try { const t = docxToText(buf); if (t != null) return { text: t, note: null }; } catch {}
    return { text: '', note: 'De tekst uit dit Word-bestand kon niet worden gelezen. Het bestand zelf is wel bewaard.' };
  }
  return { text: '', note: `Van een .${ext || 'onbekend'}-bestand kan de app (nog) geen tekst tonen. Het bestand zelf is bewaard en te downloaden.` };
}

module.exports = { extractText, readZipEntry };
