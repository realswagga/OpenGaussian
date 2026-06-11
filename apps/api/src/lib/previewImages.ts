const PREVIEW_MIME_TYPES = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

export const PREVIEW_MAX_BYTES = (Number(process.env.MAX_PREVIEW_UPLOAD_MB) || 8) * 1024 * 1024;

export type ImageDimensions = {
  width: number;
  height: number;
};

function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split('.');
  if (parts.length < 2) return '';
  return `.${parts[parts.length - 1]}`;
}

export function getPreviewExtension(filename: string, mimetype: string): string {
  const mimeExtension = PREVIEW_MIME_TYPES.get(mimetype);
  if (mimeExtension) return mimeExtension;

  const extension = getExtension(filename);
  return ['.jpg', '.jpeg', '.png', '.webp'].includes(extension)
    ? (extension === '.jpeg' ? '.jpg' : extension)
    : '';
}

export function isPreviewMimeType(mimetype: string): boolean {
  return PREVIEW_MIME_TYPES.has(mimetype);
}

function readPngDimensions(buffer: Buffer): ImageDimensions | null {
  const isPng = buffer.length >= 24
    && buffer[0] === 0x89
    && buffer[1] === 0x50
    && buffer[2] === 0x4e
    && buffer[3] === 0x47;
  if (!isPng) return null;
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function readJpegDimensions(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }

    let marker = buffer[offset + 1];
    offset += 2;
    while (marker === 0xff && offset < buffer.length) {
      marker = buffer[offset];
      offset += 1;
    }

    if (marker === 0xda || marker === 0xd9) break;
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) continue;
    if (offset + 2 > buffer.length) break;

    const length = buffer.readUInt16BE(offset);
    const segmentStart = offset + 2;
    if (length < 2 || segmentStart + length - 2 > buffer.length) break;

    const isStartOfFrame = (
      (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf)
    );

    if (isStartOfFrame && segmentStart + 5 <= buffer.length) {
      return {
        height: buffer.readUInt16BE(segmentStart + 1),
        width: buffer.readUInt16BE(segmentStart + 3),
      };
    }

    offset += length;
  }

  return null;
}

function readWebpDimensions(buffer: Buffer): ImageDimensions | null {
  if (
    buffer.length < 30
    || buffer.toString('ascii', 0, 4) !== 'RIFF'
    || buffer.toString('ascii', 8, 12) !== 'WEBP'
  ) {
    return null;
  }

  const chunkType = buffer.toString('ascii', 12, 16);
  if (chunkType === 'VP8X') {
    return {
      width: buffer.readUIntLE(24, 3) + 1,
      height: buffer.readUIntLE(27, 3) + 1,
    };
  }

  if (chunkType === 'VP8L') {
    if (buffer[20] !== 0x2f) return null;
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
    };
  }

  if (chunkType === 'VP8 ') {
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
    };
  }

  return null;
}

export function readImageDimensions(buffer: Buffer, mimetype: string): ImageDimensions | null {
  if (mimetype === 'image/png') return readPngDimensions(buffer);
  if (mimetype === 'image/jpeg') return readJpegDimensions(buffer);
  if (mimetype === 'image/webp') return readWebpDimensions(buffer);

  return readPngDimensions(buffer) || readJpegDimensions(buffer) || readWebpDimensions(buffer);
}

export function isSixteenByNine({ width, height }: ImageDimensions): boolean {
  return width > 0 && height > 0 && width * 9 === height * 16;
}
