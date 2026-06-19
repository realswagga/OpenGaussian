import { readFile, writeFile } from 'node:fs/promises';

const xmlPath = process.argv[2];
if (!xmlPath) {
  throw new Error('Usage: node replace_selected_sources.mjs <word/document.xml>');
}

const replacements = [
  {
    marker: 'https://fastify.dev/docs/v4.29.x/',
    text: 'Баланов, А. Н. Прототипирование и разработка пользовательского интерфейса: оптимизация UX : учебное пособие для вузов / А. Н. Баланов. – 2-е изд., стер. – Санкт-Петербург : Лань, 2026. – 220 с. – ISBN 978-5-507-55007-4. – URL: https://e.lanbook.com/book/515090 (дата обращения: 18.06.2026). – Режим доступа: для авторизованных пользователей. – Текст : электронный.',
  },
  {
    marker: 'https://repo-sam.inria.fr/fungraph/3d-gaussian-splatting/',
    text: 'Развертывание MinIO для работы с данными через S3 API : [сайт] / CedrusData. – URL: https://docs.cedrusdata.ru/405-2/guide/data-lakes-minio-setup.html (дата обращения: 18.06.2026). – Текст : электронный.',
  },
];

const escapeXml = (value) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

let xml = await readFile(xmlPath, 'utf8');

for (const replacement of replacements) {
  let count = 0;
  xml = xml.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (paragraph) => {
    if (!paragraph.includes(replacement.marker)) {
      return paragraph;
    }

    count += 1;
    return paragraph.replace(
      /<w:t\s+xml:space="preserve">[\s\S]*?<\/w:t>/,
      `<w:t xml:space="preserve">${escapeXml(replacement.text)}</w:t>`,
    );
  });

  if (count !== 1) {
    throw new Error(`Expected one paragraph containing ${replacement.marker}, found ${count}.`);
  }
}

await writeFile(xmlPath, xml, 'utf8');
console.log(`Replaced ${replacements.length} selected source paragraphs.`);
