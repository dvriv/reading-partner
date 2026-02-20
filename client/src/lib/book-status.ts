import { getDb } from './db';
import type { BookStatus } from '../types';

export function buildAllowedBooks(
  books: Array<{ id: string; status: BookStatus; currentChapter: number }>
): Map<string, number> {
  const allowed = new Map<string, number>();
  for (const book of books) {
    if (book.status === 'done') {
      allowed.set(book.id, Infinity);
    } else if (book.status === 'reading') {
      allowed.set(book.id, book.currentChapter);
    }
  }
  return allowed;
}

export function buildAllowedBooksStandalone(bookId: string, currentChapter: number): Map<string, number> {
  return new Map([[bookId, currentChapter]]);
}

interface BookStatusInput {
  bookId: string;
  seriesBookOrder: string[];
  books: { id: string; status: BookStatus }[];
}

interface BookStatusChange {
  bookId: string;
  newStatus: BookStatus;
}

export function computeMarkAsFinished(input: BookStatusInput): BookStatusChange[] {
  const changes: BookStatusChange[] = [{ bookId: input.bookId, newStatus: 'done' }];
  const currentIndex = input.seriesBookOrder.indexOf(input.bookId);
  const nextBookId = input.seriesBookOrder[currentIndex + 1];

  if (!nextBookId) return changes;

  const nextBook = input.books.find((book) => book.id === nextBookId);
  if (nextBook?.status === 'locked') {
    changes.push({ bookId: nextBookId, newStatus: 'reading' });
  }

  return changes;
}

export async function markBookAsFinished(bookId: string): Promise<void> {
  const db = await getDb();
  const book = await db.get('books', bookId);
  if (!book || !book.seriesId) return;

  book.status = 'done';
  book.currentChapter = book.totalChapters;
  await db.put('books', book);

  const series = await db.get('series', book.seriesId);
  if (!series) return;

  const currentIndex = series.bookOrder.indexOf(bookId);
  const nextBookId = series.bookOrder[currentIndex + 1];
  if (!nextBookId) return;

  const nextBook = await db.get('books', nextBookId);
  if (nextBook && nextBook.status === 'locked') {
    nextBook.status = 'reading';
    nextBook.currentChapter = 0;
    await db.put('books', nextBook);
  }
}
