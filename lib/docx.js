// Zet een Markdown-document om naar een Word-bestand (.docx), zonder externe pakketten.
// Ondersteunt: koppen (#, ##, ###), alinea's, opsommingen (- en 1.), citaten (>), **vet**, *cursief*, `code`.
const zlib = require('zlib');

// ---------- zip ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    const comp = zlib.deflateRawSync(data);
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8); local.writeUInt32LE(0, 10); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, comp);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(8, 10); central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28); central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

// ---------- Markdown naar WordprocessingML ----------
const xmlEsc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

function runs(text) {
  // Splitst tekst in stukken met opmaak: **vet**, *cursief* of _cursief_, `code`.
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`)/g;
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: text.slice(last, m.index) });
    const s = m[0];
    if (s.startsWith('**')) out.push({ t: s.slice(2, -2), b: true });
    else if (s.startsWith('`')) out.push({ t: s.slice(1, -1), code: true });
    else out.push({ t: s.slice(1, -1), i: true });
    last = m.index + s.length;
  }
  if (last < text.length) out.push({ t: text.slice(last) });
  return out.map(r => {
    const pr = (r.b ? '<w:b/>' : '') + (r.i ? '<w:i/>' : '') + (r.code ? '<w:rFonts w:ascii="Menlo" w:hAnsi="Menlo"/>' : '');
    return `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEsc(r.t)}</w:t></w:r>`;
  }).join('');
}

function para(text, style, extra = '') {
  const pPr = style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : '';
  return `<w:p>${pPr}${runs(text)}</w:p>`;
}

function bodyXml(markdown) {
  const out = [];
  let paraBuf = [];
  const flush = () => { if (paraBuf.length) { out.push(para(paraBuf.join(' '))); paraBuf = []; } };
  for (const raw of String(markdown).replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flush(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
      flush();
      const level = m[1].length;
      out.push(para(m[2], level === 1 ? 'Title' : `Heading${Math.min(level - 1, 3)}`));
    } else if ((m = line.match(/^(\s*)[-*]\s+(?:\[( |x)\]\s+)?(.*)/))) {
      flush();
      const depth = Math.min(Math.floor(m[1].length / 2), 3);
      const box = m[2] === undefined ? '•' : m[2] === 'x' ? '☑' : '☐';
      out.push(para(`${box}\t${m[3]}`, 'ListParagraph', `<w:ind w:left="${360 + depth * 360}" w:hanging="300"/>`));
    } else if ((m = line.match(/^(\s*)(\d+)[.)]\s+(.*)/))) {
      flush();
      const depth = Math.min(Math.floor(m[1].length / 2), 3);
      out.push(para(`${m[2]}.\t${m[3]}`, 'ListParagraph', `<w:ind w:left="${360 + depth * 360}" w:hanging="360"/>`));
    } else if ((m = line.match(/^>\s?(.*)/))) {
      flush();
      out.push(para(m[1], 'Quote'));
    } else if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      flush();
      out.push('<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="BBBBBB"/></w:pBdr></w:pPr></w:p>');
    } else if (/^\|.*\|$/.test(line.trim())) {
      // Tabellen: als gewone regels, scheidingsregel overslaan.
      if (/^\|[\s:|-]+\|$/.test(line.trim())) continue;
      flush();
      out.push(para(line.trim().slice(1, -1).split('|').map(c => c.trim()).join('  ·  ')));
    } else {
      paraBuf.push(line.trim());
    }
  }
  flush();
  return out.join('');
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="nl-NL"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="280" w:after="100"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="220" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="180" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:tabs><w:tab w:val="left" w:pos="360"/></w:tabs></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567"/></w:pPr><w:rPr><w:i/><w:color w:val="595959"/></w:rPr></w:style>
</w:styles>`;

function markdownToDocx(markdown, title = 'Document') {
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml(markdown)}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
    ['word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ['word/document.xml', document],
    ['word/styles.xml', STYLES],
    ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEsc(title)}</dc:title><dc:creator>Leerjournaal</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</dcterms:created></cp:coreProperties>`]
  ]);
}

// Platte tekst: Markdown-tekens weghalen, structuur behouden.
function markdownToText(markdown) {
  return String(markdown).replace(/\r/g, '').split('\n').map(line => {
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.*)/))) {
      const t = m[2].replace(/\*\*|__|`/g, '');
      return m[1].length <= 2 ? `${t.toUpperCase()}\n${'='.repeat(Math.min(t.length, 70))}` : `${t}\n${'-'.repeat(Math.min(t.length, 70))}`;
    }
    return line
      .replace(/^(\s*)[-*]\s+\[x\]\s+/, '$1[x] ').replace(/^(\s*)[-*]\s+\[ \]\s+/, '$1[ ] ')
      .replace(/^(\s*)[-*]\s+/, '$1- ').replace(/^>\s?/, '  ')
      .replace(/\*\*(.+?)\*\*/g, '$1').replace(/(^|[^*])\*(?!\s)(.+?)\*/g, '$1$2').replace(/_(.+?)_/g, '$1').replace(/`(.+?)`/g, '$1');
  }).join('\n');
}

module.exports = { markdownToDocx, markdownToText };
