import { encode } from 'gpt-tokenizer';

export interface ChapterChunk {
  chapterNumber: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

const TARGET_CHUNK_SIZE = 400;
const CHUNK_OVERLAP = 50;

export function chunkChapter(chapterNumber: number, text: string): ChapterChunk[] {
  const chunks: ChapterChunk[] = [];
  const sentences = splitIntoSentences(text);

  let currentChunk: string[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  for (const sentence of sentences) {
    const sentenceTokens = encode(sentence).length;

    if (currentTokens + sentenceTokens > TARGET_CHUNK_SIZE && currentChunk.length > 0) {
      const content = currentChunk.join(' ');
      chunks.push({
        chapterNumber,
        chunkIndex: chunkIndex++,
        content,
        tokenCount: encode(content).length
      });

      const overlapSentences: string[] = [];
      let overlapTokens = 0;
      for (let i = currentChunk.length - 1; i >= 0; i -= 1) {
        const tokens = encode(currentChunk[i]).length;
        if (overlapTokens + tokens > CHUNK_OVERLAP) break;
        overlapSentences.unshift(currentChunk[i]);
        overlapTokens += tokens;
      }

      currentChunk = [...overlapSentences];
      currentTokens = overlapTokens;
    }

    currentChunk.push(sentence);
    currentTokens += sentenceTokens;
  }

  if (currentChunk.length > 0) {
    const content = currentChunk.join(' ');
    chunks.push({
      chapterNumber,
      chunkIndex: chunkIndex,
      content,
      tokenCount: encode(content).length
    });
  }

  return chunks;
}

function splitIntoSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z"'])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
