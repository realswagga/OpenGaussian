import { readFile, writeFile } from 'node:fs/promises';

const xmlPath = process.argv[2];
if (!xmlPath) {
  throw new Error('Usage: node replace_sources.mjs <word/document.xml>');
}

const sources = [
  'Вандеркам, Д. Эффективный TypeScript: 83 способа улучшить код / Д. Вандеркам. – 2-е изд. – Санкт-Петербург : Питер, 2025. – 400 с. – ISBN 978-601-08-4572-5. – URL: https://www.piter.com/collection/bestsellery-oreilly/product/effektivnyy-typescript-83-sposoba-uluchshit-kod-2-e-izd (дата обращения: 18.06.2026). – Текст : электронный.',
  'Fastify documentation. Version 4.29.x : [сайт]. – URL: https://fastify.dev/docs/v4.29.x/ (дата обращения: 18.06.2026). – Текст : электронный.',
  'Документация к PostgreSQL 16.14 : [сайт] / Компания Postgres Professional. – URL: https://postgrespro.ru/docs/postgresql/16 (дата обращения: 18.06.2026). – Текст : электронный.',
  'Kerbl, B. 3D Gaussian Splatting for Real-Time Radiance Field Rendering / B. Kerbl, G. Kopanas, T. Leimkühler, G. Drettakis. – Текст : электронный // ACM Transactions on Graphics. – 2023. – Vol. 42, no. 4. – URL: https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/ (дата обращения: 18.06.2026).',
  'Основы WebGPU : [сайт]. – URL: https://webgpufundamentals.org/webgpu/lessons/ru/webgpu-fundamentals.html (дата обращения: 18.06.2026). – Текст : электронный.',
  'Паршаков, Г. Docker Compose и основы работы с контейнерами / Г. Паршаков. – Текст : электронный // Академия Selectel : [сайт]. – 2025. – 13 марта. – URL: https://selectel.ru/blog/docker-compose/ (дата обращения: 18.06.2026).',
  'React. Быстрый старт : [сайт] / Meta Platforms, Inc. – URL: https://ru.react.dev/learn (дата обращения: 18.06.2026). – Текст : электронный.',
  'Разработка WebXR с помощью JavaScript : [сайт] / Microsoft. – URL: https://learn.microsoft.com/ru-ru/windows/mixed-reality/develop/javascript/webxr-overview (дата обращения: 18.06.2026). – Текст : электронный.',
  'Gaussian Splatting : [сайт] / PlayCanvas. – URL: https://developer.playcanvas.com/user-manual/gaussian-splatting/ (дата обращения: 18.06.2026). – Текст : электронный.',
];

const escapeXml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const xml = await readFile(xmlPath, 'utf8');
let sourceIndex = 0;

const updated = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
  if (!/<w:highlight\s+w:val="yellow"\s*\/>/.test(paragraph)) {
    return paragraph;
  }

  const source = sources[sourceIndex++];
  if (!source) {
    throw new Error('The document contains more yellow paragraphs than replacement sources.');
  }

  const openTag = paragraph.match(/^<w:p(?:\s[^>]*)?>/)?.[0];
  const pPr = paragraph.match(/<w:pPr>[\s\S]*?<\/w:pPr>/)?.[0];
  if (!openTag || !pPr) {
    throw new Error(`Cannot preserve paragraph structure for replacement ${sourceIndex}.`);
  }

  const cyanPPr = pPr.replaceAll('w:val="yellow"', 'w:val="cyan"');
  const run = `<w:r><w:rPr><w:rFonts w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:highlight w:val="cyan"/></w:rPr><w:t xml:space="preserve">${escapeXml(source)}</w:t></w:r>`;
  return `${openTag}${cyanPPr}${run}</w:p>`;
});

if (sourceIndex !== sources.length) {
  throw new Error(`Expected ${sources.length} yellow paragraphs, replaced ${sourceIndex}.`);
}

if ((updated.match(/<w:highlight\s+w:val="cyan"\s*\/>/g) ?? []).length < sources.length) {
  throw new Error('Cyan highlighting was not applied to every replacement source.');
}

await writeFile(xmlPath, updated, 'utf8');
console.log(`Replaced ${sourceIndex} yellow source paragraphs with cyan-highlighted sources.`);
