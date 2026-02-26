import { describe, expect, it } from 'vitest';
import { buildSearchIndex, hybridMerge, searchBM25, vectorSearch } from '../lib/search';

function makeChunk(overrides: Partial<{
  id: number;
  bookId: string;
  chapterNumber: number;
  chapterLabel: string;
  content: string;
  embedding: number[];
}> = {}) {
  return {
    id: overrides.id ?? 1,
    bookId: overrides.bookId ?? 'book-1',
    chapterNumber: overrides.chapterNumber ?? 1,
    chapterLabel: overrides.chapterLabel ?? `Chapter ${overrides.chapterNumber ?? 1}`,
    content: overrides.content ?? 'Some text content with Kaladin present.',
    embedding: overrides.embedding ?? [0.1, 0.2, 0.3]
  };
}

function makeSeriesChunks() {
  const chunks = [];
  let id = 1;
  for (const bookId of ['book-1', 'book-2', 'book-3']) {
    for (let chapter = 1; chapter <= 5; chapter += 1) {
      chunks.push(
        makeChunk({
          id: id++,
          bookId,
          chapterNumber: chapter,
          chapterLabel: `Chapter ${chapter}`,
          content: `Content from ${bookId} chapter ${chapter}. Character Kaladin appears here.`
        })
      );
    }
  }
  return chunks;
}

describe('BM25 spoiler gating', () => {
  const chunks = makeSeriesChunks();
  const index = buildSearchIndex(chunks.map(({ id, bookId, chapterNumber, chapterLabel, content }) => ({ id, bookId, chapterNumber, chapterLabel, content })));

  it('standalone returns only up to current chapter', () => {
    const allowed = new Map([['book-1', 3]]);
    const results = searchBM25(index, 'Kaladin', allowed, 20);

    expect(results.every((result) => result.bookId === 'book-1')).toBe(true);
    expect(results.every((result) => result.chapterNumber <= 3)).toBe(true);
  });

  it('done book all chapters, reading book capped, locked excluded', () => {
    const allowed = new Map([
      ['book-1', Infinity],
      ['book-2', 2]
    ]);
    const results = searchBM25(index, 'Kaladin', allowed, 50);

    expect(results.some((result) => result.bookId === 'book-1')).toBe(true);
    expect(results.filter((result) => result.bookId === 'book-2').every((result) => result.chapterNumber <= 2)).toBe(true);
    expect(results.some((result) => result.bookId === 'book-3')).toBe(false);
  });

  it('chapter 0 allows nothing from reading book', () => {
    const allowed = new Map([['book-1', 0]]);
    const results = searchBM25(index, 'Kaladin', allowed);
    expect(results.length).toBe(0);
  });
});

describe('vector spoiler gating', () => {
  const chunks = makeSeriesChunks();
  const query = [0.1, 0.2, 0.3];

  it('locked books are excluded', () => {
    const allowed = new Map([
      ['book-1', Infinity],
      ['book-2', 3]
    ]);
    const results = vectorSearch(query, chunks, allowed);
    expect(results.every((result) => result.bookId !== 'book-3')).toBe(true);
  });
});

describe('hybrid merge', () => {
  it('combines and caps to top-k', () => {
    const bm25 = [
      { id: 1, content: 'a', bookId: 'b1', chapterNumber: 1, chapterLabel: 'Chapter 1', score: 10 },
      { id: 2, content: 'b', bookId: 'b1', chapterNumber: 2, chapterLabel: 'Chapter 2', score: 5 }
    ];
    const vector = [
      { id: 2, content: 'b', bookId: 'b1', chapterNumber: 2, chapterLabel: 'Chapter 2', score: 0.9 },
      { id: 3, content: 'c', bookId: 'b1', chapterNumber: 3, chapterLabel: 'Chapter 3', score: 0.8 }
    ];

    const results = hybridMerge(bm25, vector, 2);
    expect(results.length).toBe(2);
    expect(results.some((result) => result.id === 2)).toBe(true);
  });

  it('handles empty lists', () => {
    expect(hybridMerge([], [], 5)).toEqual([]);
  });
});
