import { readFile, writeFile } from 'node:fs/promises';

const xmlPath = process.argv[2];
if (!xmlPath) {
  throw new Error('Usage: node replace_sources_17_18.mjs <word/document.xml>');
}

const replacements = new Map([
  [
    'https://ru.react.dev/learn',
    'Дронов, В. А. React 19. Разработка веб-приложений на JavaScript / В. А. Дронов. – Санкт-Петербург : БХВ-Петербург, 2025. – 360 с. – (Профессиональное программирование). – ISBN 978-5-9775-2036-2. – URL: https://bhv.ru/product/react-19-razrabotka-veb-prilozhenij-na-javascript/ (дата обращения: 18.06.2026). – Текст : электронный.',
  ],
  [
    'https://learn.microsoft.com/ru-ru/windows/mixed-reality/develop/javascript/webxr-overview',
    'Манахов, П. А. Обзор средств разработки интерфейсов XR-приложений. Часть 1: WebXR : презентация / П. А. Манахов ; Национальный исследовательский университет «Высшая школа экономики». – Москва, 2020. – 62 с. – URL: https://cs.hse.ru/mirror/pubs/share/382859664.pdf (дата обращения: 18.06.2026). – Текст : электронный.',
  ],
]);

const escapeXml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const xml = await readFile(xmlPath, 'utf8');
const replacedUrls = new Set();

const updated = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
  const match = [...replacements.keys()].find((url) => paragraph.includes(url));
  if (!match) {
    return paragraph;
  }

  const openTag = paragraph.match(/^<w:p(?:\s[^>]*)?>/)?.[0];
  const pPr = paragraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0];
  if (!openTag || !pPr || !/<w:numPr>/.test(pPr)) {
    throw new Error(`Source containing ${match} has an unexpected paragraph structure.`);
  }

  replacedUrls.add(match);
  const run = `<w:r><w:rPr><w:rFonts w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:highlight w:val="cyan"/></w:rPr><w:t xml:space="preserve">${escapeXml(replacements.get(match))}</w:t></w:r>`;
  return `${openTag}${pPr}${run}</w:p>`;
});

if (replacedUrls.size !== replacements.size) {
  throw new Error(`Expected ${replacements.size} replacements, completed ${replacedUrls.size}.`);
}

await writeFile(xmlPath, updated, 'utf8');
console.log('Replaced sources no. 17 and 18 with Russian-language sources.');
