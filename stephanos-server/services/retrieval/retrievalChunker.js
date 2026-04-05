function cleanText(input = '') {
  return String(input || '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
}

function readTitleFromText(text = '') {
  const firstLine = String(text || '').split('\n').find((line) => String(line || '').trim().length > 0) || '';
  if (!firstLine) return '';
  return firstLine.replace(/^#+\s*/, '').slice(0, 140);
}

export function chunkDocument({
  sourceId,
  sourceType,
  documentId,
  relativePath,
  title,
  timestamp,
  text,
  maxChunkChars = 900,
  chunkOverlapChars = 140,
}) {
  const normalized = cleanText(text);
  if (!normalized) return [];

  const finalTitle = title || readTitleFromText(normalized);
  const size = Math.max(300, Number(maxChunkChars) || 900);
  const overlap = Math.min(Math.max(0, Number(chunkOverlapChars) || 0), Math.floor(size / 3));
  const stride = Math.max(80, size - overlap);

  const chunks = [];
  let cursor = 0;
  let chunkIndex = 0;

  while (cursor < normalized.length) {
    const end = Math.min(normalized.length, cursor + size);
    const textContent = normalized.slice(cursor, end).trim();
    if (textContent) {
      chunks.push({
        chunkId: `${sourceId}:${documentId}:${chunkIndex}`,
        sourceId,
        sourceType,
        documentId,
        path: relativePath,
        chunkIndex,
        title: finalTitle,
        timestamp: timestamp || '',
        text: textContent,
        charCount: textContent.length,
      });
      chunkIndex += 1;
    }
    if (end >= normalized.length) break;
    cursor += stride;
  }

  return chunks;
}
