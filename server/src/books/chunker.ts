export type ChapterInput = {
  chapterNumber: number;
  title: string;
  text: string;
  startOffset?: number;
};

export type TextChunk = {
  chapterNumber: number;
  chapterLabel: string;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  startOffset: number;
  endOffset: number;
};

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.trim().length / 4));
}

export function chunkChapters(chapters: ChapterInput[], targetTokens = 600, overlapTokens = 80): TextChunk[] {
  const chunks: TextChunk[] = [];
  for (const chapter of chapters) {
    const paragraphs = chapter.text
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    let buffer: string[] = [];
    let bufferStart = chapter.startOffset ?? 0;
    let cursor = chapter.startOffset ?? 0;
    let chunkIndex = 0;

    const flush = () => {
      const content = buffer.join('\n\n').trim();
      if (!content) return;
      const endOffset = bufferStart + content.length;
      chunks.push({
        chapterNumber: chapter.chapterNumber,
        chapterLabel: chapter.title || `Chapter ${chapter.chapterNumber}`,
        chunkIndex,
        content,
        tokenCount: estimateTokens(content),
        startOffset: bufferStart,
        endOffset,
      });
      chunkIndex += 1;
      const overlapChars = overlapTokens * 4;
      const overlap = content.slice(Math.max(0, content.length - overlapChars));
      buffer = overlap ? [overlap] : [];
      bufferStart = Math.max(bufferStart, endOffset - overlap.length);
    };

    for (const paragraph of paragraphs) {
      if (buffer.length === 0) bufferStart = cursor;
      buffer.push(paragraph);
      cursor += paragraph.length + 2;
      if (estimateTokens(buffer.join('\n\n')) >= targetTokens) flush();
    }
    flush();
  }
  return chunks;
}
