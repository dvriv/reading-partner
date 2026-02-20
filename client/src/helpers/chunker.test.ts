import { describe, expect, it } from 'vitest';
import { chunkChapter } from '../lib/chunker';

describe('chunkChapter', () => {
  it('produces multiple chunks for long text', () => {
    const sentences = Array.from(
      { length: 80 },
      (_, i) => `This is sentence number ${i + 1} with enough words to occupy chunk token space.`
    );
    const chunks = chunkChapter(1, sentences.join(' '));

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].chapterNumber).toBe(1);
    expect(chunks[1].chunkIndex).toBe(1);
  });

  it('short text produces one chunk', () => {
    const chunks = chunkChapter(5, 'Short chapter. A little text.');
    expect(chunks.length).toBe(1);
    expect(chunks[0].chapterNumber).toBe(5);
  });

  it('chunks have non-empty content', () => {
    const sentences = Array.from({ length: 60 }, (_, i) => `Meaningful sentence ${i + 1} about plot progress.`);
    const chunks = chunkChapter(2, sentences.join(' '));

    expect(chunks.every((chunk) => chunk.content.trim().length > 0)).toBe(true);
    expect(chunks.every((chunk) => chunk.tokenCount > 0)).toBe(true);
  });
});
