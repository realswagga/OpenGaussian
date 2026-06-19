import { readFile, writeFile } from 'node:fs/promises';

const xmlPath = process.argv[2];
if (!xmlPath) {
  throw new Error('Usage: node replace_source_12.mjs <word/document.xml>');
}

const oldUrl = 'https://webgpufundamentals.org/webgpu/lessons/ru/webgpu-fundamentals.html';
const replacement = 'Симонов, П. WebGPU: от медицинских снимков до Cyberpunk 2077 / П. Симонов. – Текст : электронный // Хабр : [сайт]. – 2025. – 16 апреля. – URL: https://habr.com/ru/companies/digitalleague/articles/901248/ (дата обращения: 18.06.2026).';

const escapeXml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const xml = await readFile(xmlPath, 'utf8');
let replacements = 0;

const updated = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
  if (!paragraph.includes(oldUrl)) {
    return paragraph;
  }

  replacements += 1;
  const openTag = paragraph.match(/^<w:p(?:\s[^>]*)?>/)?.[0];
  const pPr = paragraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0];
  if (!openTag || !pPr || !/<w:numPr>/.test(pPr)) {
    throw new Error('Source no. 12 does not have the expected numbered-paragraph structure.');
  }

  const run = `<w:r><w:rPr><w:rFonts w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:highlight w:val="cyan"/></w:rPr><w:t xml:space="preserve">${escapeXml(replacement)}</w:t></w:r>`;
  return `${openTag}${pPr}${run}</w:p>`;
});

if (replacements !== 1) {
  throw new Error(`Expected to replace one source, replaced ${replacements}.`);
}

await writeFile(xmlPath, updated, 'utf8');
console.log('Replaced source no. 12 with a Russian WebGPU article.');
