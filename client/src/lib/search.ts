import MiniSearch from 'minisearch';
import { getDb } from './db';
import { buildAllowedBooks, buildAllowedBooksStandalone } from './book-status';
import { embedQuery } from './embeddings';
import type { Book, Chunk } from '../types';

export interface SearchResult {
  id: number;
  content: string;
  bookId: string;
  chapterNumber: number;
  chapterLabel: string;
  score: number;
  bm25Score?: number;
  vectorScore?: number;
}

type IndexedChunk = Pick<Chunk, 'id' | 'content' | 'bookId' | 'chapterNumber' | 'chapterLabel' | 'embedding'>;

const ALPHA = 0.5;
const SEARCH_TOP_K = 8;
const SEARCH_CANDIDATE_K = 24;
const SEARCH_RETRIEVAL_LIMIT = 40;
const MIN_DONE_BOOK_RESULTS = 2;
const SEARCH_DEBUG = import.meta.env.VITE_SEARCH_DEBUG === 'true';
const MINI_SEARCH_OPTIONS = {
  fields: ['content'],
  storeFields: ['content', 'chapterNumber', 'chapterLabel', 'bookId']
};

export function buildSearchIndex(chunks: Array<{ id: number; content: string; bookId: string; chapterNumber: number; chapterLabel: string }>) {
  const miniSearch = new MiniSearch({
    ...MINI_SEARCH_OPTIONS,
    searchOptions: {
      boost: { content: 1 },
      fuzzy: 0.2
    }
  });
  miniSearch.addAll(chunks);
  return miniSearch;
}

export function searchBM25(
  index: MiniSearch,
  query: string,
  allowedBooks: Map<string, number>,
  limit = 20
): SearchResult[] {
  const results = index.search(query, {
    filter: (result) => {
      const maxChapter = allowedBooks.get(String(result.bookId));
      if (maxChapter === undefined) return false;
      return Number(result.chapterNumber) <= maxChapter;
    }
  });

  return results.slice(0, limit).map((r) => ({
    id: Number(r.id),
    content: String(r.content),
    chapterNumber: Number(r.chapterNumber),
    chapterLabel: String(r.chapterLabel || `Chapter ${Number(r.chapterNumber)}`),
    bookId: String(r.bookId),
    score: r.score,
    bm25Score: r.score,
    vectorScore: 0
  }));
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function vectorSearch(
  queryEmbedding: number[],
  chunks: IndexedChunk[],
  allowedBooks: Map<string, number>,
  limit = 20
): SearchResult[] {
  const scored: SearchResult[] = chunks
    .filter((chunk) => {
      const maxChapter = allowedBooks.get(chunk.bookId);
      if (maxChapter === undefined || !chunk.embedding || chunk.id === undefined) return false;
      return chunk.chapterNumber <= maxChapter;
    })
    .map((chunk) => {
      const similarity = cosineSimilarity(queryEmbedding, chunk.embedding as number[]);
      return {
        id: chunk.id as number,
        content: chunk.content,
        bookId: chunk.bookId,
        chapterNumber: chunk.chapterNumber,
        chapterLabel: chunk.chapterLabel,
        score: similarity,
        bm25Score: 0,
        vectorScore: similarity
      };
    });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

export function hybridMerge(bm25Results: SearchResult[], vectorResults: SearchResult[], topK = 8): SearchResult[] {
  const normBM25 = normalize(bm25Results);
  const normVector = normalize(vectorResults);
  const scoreMap = new Map<number, { bm25: number; vector: number; content: string; bookId: string; chapterNumber: number; chapterLabel: string }>();

  for (const result of normBM25) {
    scoreMap.set(result.id, {
      bm25: result.score,
      vector: 0,
      content: result.content,
      bookId: result.bookId,
      chapterNumber: result.chapterNumber,
      chapterLabel: result.chapterLabel,
    });
  }

  for (const result of normVector) {
    const existing = scoreMap.get(result.id);
    if (existing) {
      existing.vector = result.score;
      continue;
    }
    scoreMap.set(result.id, {
      bm25: 0,
      vector: result.score,
      content: result.content,
      bookId: result.bookId,
      chapterNumber: result.chapterNumber,
      chapterLabel: result.chapterLabel,
    });
  }

  const merged = Array.from(scoreMap.entries()).map(([id, values]) => ({
    id,
    content: values.content,
    bookId: values.bookId,
    chapterNumber: values.chapterNumber,
    chapterLabel: values.chapterLabel,
    score: ALPHA * values.bm25 + (1 - ALPHA) * values.vector,
    bm25Score: values.bm25,
    vectorScore: values.vector
  }));

  merged.sort((a, b) => b.score - a.score);
  return dedupeNearby(merged).slice(0, topK);
}

function diversifySeriesResults(
  results: SearchResult[],
  books: Book[],
  topK = SEARCH_TOP_K,
  minDoneBookResults = MIN_DONE_BOOK_RESULTS
): SearchResult[] {
  const doneBookIds = new Set(books.filter((book) => book.status === 'done').map((book) => book.id));
  if (doneBookIds.size === 0) {
    return results.slice(0, topK);
  }

  const doneResults = results.filter((result) => doneBookIds.has(result.bookId));
  const selected = new Map<number, SearchResult>();
  const requiredDone = Math.min(minDoneBookResults, doneResults.length, topK);

  for (let i = 0; i < requiredDone; i += 1) {
    const result = doneResults[i];
    selected.set(result.id, result);
  }

  for (const result of results) {
    if (selected.size >= topK) break;
    if (selected.has(result.id)) continue;
    selected.set(result.id, result);
  }

  return Array.from(selected.values()).slice(0, topK);
}

function dedupeNearby(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const output: SearchResult[] = [];
  for (const result of results) {
    const key = `${result.bookId}:${result.chapterNumber}:${result.content.slice(0, 160)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(result);
  }
  return output;
}

function normalize(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return [];
  const max = Math.max(...results.map((result) => result.score));
  const min = Math.min(...results.map((result) => result.score));
  const range = max - min || 1;
  return results.map((result) => ({ ...result, score: (result.score - min) / range }));
}

export async function saveSearchIndex(id: string, index: MiniSearch): Promise<void> {
  const db = await getDb();
  await db.put('searchIndexes', {
    id,
    serialized: JSON.stringify(index),
    updatedAt: new Date().toISOString()
  });
}

export async function loadSearchIndex(id: string): Promise<MiniSearch | null> {
  const db = await getDb();
  const stored = await db.get('searchIndexes', id);
  if (!stored) return null;

  return MiniSearch.loadJSON(stored.serialized, MINI_SEARCH_OPTIONS);
}

export async function rebuildIndexForBook(bookId: string): Promise<void> {
  const db = await getDb();
  const chunks = await db.getAllFromIndex('chunks', 'by-book', bookId);
  const withIds = chunks.filter((c) => c.id !== undefined) as Array<Chunk & { id: number }>;
  const index = buildSearchIndex(withIds.map((chunk) => ({
    id: chunk.id,
    content: chunk.content,
    bookId: chunk.bookId,
    chapterNumber: chunk.chapterNumber,
    chapterLabel: chunk.chapterLabel,
  })));
  await saveSearchIndex(bookId, index);
}

export async function rebuildIndexForSeries(seriesId: string): Promise<void> {
  const db = await getDb();
  const series = await db.get('series', seriesId);
  if (!series) return;

  const allChunks: Array<Chunk & { id: number }> = [];
  for (const bookId of series.bookOrder) {
    const chunks = await db.getAllFromIndex('chunks', 'by-book', bookId);
    allChunks.push(...(chunks.filter((c) => c.id !== undefined) as Array<Chunk & { id: number }>));
  }

  const index = buildSearchIndex(allChunks.map((chunk) => ({
    id: chunk.id,
    content: chunk.content,
    bookId: chunk.bookId,
    chapterNumber: chunk.chapterNumber,
    chapterLabel: chunk.chapterLabel,
  })));

  await saveSearchIndex(seriesId, index);
}

export async function searchSeries(seriesId: string, query: string, authToken: string): Promise<SearchResult[]> {
  const db = await getDb();
  const series = await db.get('series', seriesId);
  if (!series) throw new Error('Series not found');

  const books = await Promise.all(series.bookOrder.map((bookId) => db.get('books', bookId)));
  const normalizedBooks = books.filter(Boolean) as Book[];
  const allowedBooks = buildAllowedBooks(normalizedBooks.map((book) => ({
    id: book.id,
    status: book.status,
    currentChapter: book.currentChapter
  })));

  const allChunks: Chunk[] = [];
  for (const bookId of series.bookOrder) {
    const chunks = await db.getAllFromIndex('chunks', 'by-book', bookId);
    allChunks.push(...chunks);
  }

  const withIds = allChunks.filter((chunk) => chunk.id !== undefined) as Array<Chunk & { id: number }>;
  const index = (await loadSearchIndex(seriesId)) ?? buildSearchIndex(withIds.map((chunk) => ({
    id: chunk.id,
    content: chunk.content,
    bookId: chunk.bookId,
    chapterNumber: chunk.chapterNumber,
    chapterLabel: chunk.chapterLabel,
  })));

  const bm25 = searchBM25(index, query, allowedBooks, SEARCH_RETRIEVAL_LIMIT);
  const queryEmbedding = await embedQuery(query, authToken);
  const vector = vectorSearch(queryEmbedding, withIds, allowedBooks, SEARCH_RETRIEVAL_LIMIT);
  const merged = hybridMerge(bm25, vector, SEARCH_CANDIDATE_K);
  const finalResults = diversifySeriesResults(merged, normalizedBooks, SEARCH_TOP_K);

  if (SEARCH_DEBUG) {
    const titles = new Map(normalizedBooks.map((book) => [book.id, book.title]));
    console.debug('[searchSeries] retrieval snapshot', {
      seriesId,
      query,
      allowedBooks: Object.fromEntries(allowedBooks),
      results: finalResults.map((result) => ({
        bookId: result.bookId,
        bookTitle: titles.get(result.bookId) ?? 'Unknown Book',
        chapterNumber: result.chapterNumber,
        chapterLabel: result.chapterLabel,
        score: Number(result.score.toFixed(4)),
        chunk: result.content,
      })),
    });
  }

  return finalResults;
}

export async function searchBook(bookId: string, query: string, maxChapter: number, authToken: string): Promise<SearchResult[]> {
  const db = await getDb();
  const chunks = await db.getAllFromIndex('chunks', 'by-book', bookId);
  const withIds = chunks.filter((chunk) => chunk.id !== undefined) as Array<Chunk & { id: number }>;
  const allowedBooks = buildAllowedBooksStandalone(bookId, maxChapter);
  const index = (await loadSearchIndex(bookId)) ?? buildSearchIndex(withIds.map((chunk) => ({
    id: chunk.id,
    content: chunk.content,
    bookId: chunk.bookId,
    chapterNumber: chunk.chapterNumber,
    chapterLabel: chunk.chapterLabel,
  })));

  const bm25 = searchBM25(index, query, allowedBooks, 20);
  const queryEmbedding = await embedQuery(query, authToken);
  const vector = vectorSearch(queryEmbedding, withIds, allowedBooks, 20);

  return hybridMerge(bm25, vector, 8);
}
