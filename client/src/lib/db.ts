import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Book, Chapter, ChatMessage, Chunk, Series } from '../types';
import { normalizeBookRecord } from './ingestion-state';
import { recomputeSeriesStatuses, validateSeriesBookNumbers } from './series-order';

interface ReadingPartnerDB extends DBSchema {
  series: {
    key: string;
    value: Series;
  };
  books: {
    key: string;
    value: Book;
    indexes: {
      'by-series': string;
    };
  };
  chapters: {
    key: [string, number];
    value: Chapter;
    indexes: {
      'by-book': string;
    };
  };
  chunks: {
    key: number;
    value: Chunk;
    indexes: {
      'by-book': string;
      'by-book-chapter': [string, number];
    };
  };
  chatMessages: {
    key: number;
    value: ChatMessage;
    indexes: {
      'by-context': string;
    };
  };
  searchIndexes: {
    key: string;
    value: {
      id: string;
      serialized: string;
      updatedAt: string;
    };
  };
}

let dbInstance: IDBPDatabase<ReadingPartnerDB> | null = null;

export async function getDb(): Promise<IDBPDatabase<ReadingPartnerDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<ReadingPartnerDB>('reading-partner', 3, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('series', { keyPath: 'id' });

        const bookStore = db.createObjectStore('books', { keyPath: 'id' });
        bookStore.createIndex('by-series', 'seriesId');

        const chapterStore = db.createObjectStore('chapters', {
          keyPath: ['bookId', 'chapterNumber']
        });
        chapterStore.createIndex('by-book', 'bookId');

        const chunkStore = db.createObjectStore('chunks', {
          keyPath: 'id',
          autoIncrement: true
        });
        chunkStore.createIndex('by-book', 'bookId');
        chunkStore.createIndex('by-book-chapter', ['bookId', 'chapterNumber']);

        const chatStore = db.createObjectStore('chatMessages', {
          keyPath: 'id',
          autoIncrement: true
        });
        chatStore.createIndex('by-context', 'contextId');

        db.createObjectStore('searchIndexes', { keyPath: 'id' });
      }

      if (oldVersion < 2) {
        const bookStore = tx.objectStore('books');
        let cursor = await bookStore.openCursor();
        while (cursor) {
          const normalized = normalizeBookRecord(cursor.value as Book);
          await cursor.update(normalized);
          cursor = await cursor.continue();
        }
      }

      if (oldVersion < 3) {
        const bookStore = tx.objectStore('books');
        let cursor = await bookStore.openCursor();
        while (cursor) {
          const normalized = normalizeBookRecord(cursor.value as Book);
          normalized.hasLocalContent = normalized.hasLocalContent ?? true;
          await cursor.update(normalized);
          cursor = await cursor.continue();
        }
      }
    }
  });

  if (navigator.storage?.persist) {
    await navigator.storage.persist();
  }

  return dbInstance;
}

export async function listSeries(): Promise<Series[]> {
  const db = await getDb();
  const series = await db.getAll('series');
  return series.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listBooks(): Promise<Book[]> {
  const db = await getDb();
  const books = (await db.getAll('books')).map((book) => normalizeBookRecord(book));
  return books.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function getSeriesBooks(seriesId: string): Promise<Book[]> {
  const db = await getDb();
  const books = (await db.getAllFromIndex('books', 'by-series', seriesId)).map((book) =>
    normalizeBookRecord(book)
  );
  return books.sort((a, b) => (a.bookNumber ?? 9999) - (b.bookNumber ?? 9999));
}

export async function getBookChapters(bookId: string): Promise<Chapter[]> {
  const db = await getDb();
  const chapters = await db.getAllFromIndex('chapters', 'by-book', bookId);
  return chapters.sort((a, b) => a.chapterNumber - b.chapterNumber);
}

export async function getContextMessages(contextId: string): Promise<ChatMessage[]> {
  const db = await getDb();
  const all = await db.getAllFromIndex('chatMessages', 'by-context', contextId);
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function clearAllLocalData(): Promise<void> {
  const db = await getDb();
  const tx = db.transaction(['series', 'books', 'chapters', 'chunks', 'chatMessages', 'searchIndexes'], 'readwrite');
  await tx.objectStore('series').clear();
  await tx.objectStore('books').clear();
  await tx.objectStore('chapters').clear();
  await tx.objectStore('chunks').clear();
  await tx.objectStore('chatMessages').clear();
  await tx.objectStore('searchIndexes').clear();
  await tx.done;
}

export async function recomputeSeriesProgression(seriesId: string): Promise<void> {
  const db = await getDb();
  const series = await db.get('series', seriesId);
  if (!series) return;

  const books = (
    await Promise.all(series.bookOrder.map((id) => db.get('books', id)))
  ).filter(Boolean) as Book[];
  if (books.length === 0) {
    await db.delete('searchIndexes', seriesId);
    return;
  }

  const orderedBooks = [...books].sort((a, b) => (a.bookNumber ?? 9999) - (b.bookNumber ?? 9999));
  const progressUpdates = recomputeSeriesStatuses(
    orderedBooks.map((book, index) => ({
      id: book.id,
      bookNumber: book.bookNumber ?? index + 1,
      status: book.status,
      currentChapter: book.currentChapter,
      totalChapters: book.totalChapters
    }))
  );
  const updatesById = new Map(progressUpdates.map((item) => [item.id, item]));

  const tx = db.transaction(['books', 'series', 'searchIndexes'], 'readwrite');
  for (const book of orderedBooks) {
    const update = updatesById.get(book.id);
    if (!update) continue;
    await tx.objectStore('books').put({
      ...book,
      status: update.status,
      currentChapter: update.currentChapter
    });
  }

  await tx.objectStore('series').put({
    ...series,
    bookOrder: orderedBooks.map((book) => book.id)
  });
  await tx.objectStore('searchIndexes').delete(seriesId);
  await tx.done;
}

async function deleteBookArtifacts(bookId: string): Promise<void> {
  const db = await getDb();

  const chapterKeys = await db.getAllKeysFromIndex('chapters', 'by-book', bookId);
  const chunkKeys = await db.getAllKeysFromIndex('chunks', 'by-book', bookId);
  const chatKeys = await db.getAllKeysFromIndex('chatMessages', 'by-context', bookId);

  const tx = db.transaction(['books', 'chapters', 'chunks', 'chatMessages', 'searchIndexes'], 'readwrite');

  for (const key of chapterKeys) {
    await tx.objectStore('chapters').delete(key);
  }

  for (const key of chunkKeys) {
    await tx.objectStore('chunks').delete(key);
  }

  for (const key of chatKeys) {
    await tx.objectStore('chatMessages').delete(key);
  }

  await tx.objectStore('searchIndexes').delete(bookId);
  await tx.objectStore('books').delete(bookId);
  await tx.done;
}

export async function deleteBook(bookId: string): Promise<void> {
  const db = await getDb();
  const book = await db.get('books', bookId);
  if (!book) return;

  if (!book.seriesId) {
    await deleteBookArtifacts(bookId);
    return;
  }

  const series = await db.get('series', book.seriesId);
  await deleteBookArtifacts(bookId);

  if (!series) {
    return;
  }

  const nextOrder = series.bookOrder.filter((id) => id !== bookId);

  await db.put('series', {
    ...series,
    bookOrder: nextOrder,
  });
  await recomputeSeriesProgression(series.id);
}

export async function deleteSeries(seriesId: string): Promise<void> {
  const db = await getDb();
  const series = await db.get('series', seriesId);
  if (!series) return;

  for (const bookId of series.bookOrder) {
    await deleteBookArtifacts(bookId);
  }

  const chatKeys = await db.getAllKeysFromIndex('chatMessages', 'by-context', seriesId);
  const tx = db.transaction(['series', 'chatMessages', 'searchIndexes'], 'readwrite');

  for (const key of chatKeys) {
    await tx.objectStore('chatMessages').delete(key);
  }

  await tx.objectStore('searchIndexes').delete(seriesId);
  await tx.objectStore('series').delete(seriesId);
  await tx.done;
}

export async function updateSeriesBookNumbering(
  seriesId: string,
  nextNumbers: Record<string, number>
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getDb();
  const series = await db.get('series', seriesId);
  if (!series) {
    return { ok: false, error: 'Series not found.' };
  }

  const books = (await Promise.all(series.bookOrder.map((bookId) => db.get('books', bookId)))).filter(Boolean) as Book[];
  if (books.length === 0) {
    return { ok: false, error: 'No books found in this series.' };
  }

  const validation = validateSeriesBookNumbers(
    books.map((book) => ({
      id: book.id,
      bookNumber: nextNumbers[book.id] ?? book.bookNumber
    }))
  );

  if (!validation.valid) {
    return { ok: false, error: validation.error ?? 'Invalid series numbering.' };
  }

  const byId = new Map(books.map((book) => [book.id, { ...book }]));
  for (const item of validation.normalized) {
    const current = byId.get(item.id);
    if (!current) continue;
    current.bookNumber = item.bookNumber;
    byId.set(item.id, current);
  }

  const numberedBooks = Array.from(byId.values())
    .filter((book) => typeof book.bookNumber === 'number')
    .map((book) => ({
      id: book.id,
      bookNumber: book.bookNumber as number,
      status: book.status,
      currentChapter: book.currentChapter,
      totalChapters: book.totalChapters
    }));

  const progressUpdates = recomputeSeriesStatuses(numberedBooks);
  const updatesById = new Map(progressUpdates.map((item) => [item.id, item]));
  const orderedIds = [...numberedBooks].sort((a, b) => a.bookNumber - b.bookNumber).map((book) => book.id);

  const tx = db.transaction(['books', 'series', 'searchIndexes'], 'readwrite');
  for (const book of byId.values()) {
    const statusUpdate = updatesById.get(book.id);
    if (statusUpdate) {
      book.status = statusUpdate.status;
      book.currentChapter = statusUpdate.currentChapter;
    }
    await tx.objectStore('books').put(book);
  }

  await tx.objectStore('series').put({ ...series, bookOrder: orderedIds });
  await tx.objectStore('searchIndexes').delete(seriesId);
  await tx.done;

  return { ok: true };
}

function clampReadingChapter(current: number, total: number): number {
  const safeTotal = Math.max(1, total);
  return Math.min(Math.max(1, current), safeTotal);
}

export async function updateBookStatus(
  bookId: string,
  status: Book['status']
): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getDb();
  const book = await db.get('books', bookId);
  if (!book) {
    return { ok: false, error: 'Book not found.' };
  }

  if (!book.seriesId) {
    if (status === 'locked') {
      return { ok: false, error: 'Standalone books cannot be locked.' };
    }
    const next = { ...book };
    next.status = status;
    if (status === 'done') {
      next.currentChapter = next.totalChapters;
    } else {
      next.currentChapter = clampReadingChapter(next.currentChapter, next.totalChapters);
    }
    await db.put('books', next);
    return { ok: true };
  }

  const series = await db.get('series', book.seriesId);
  if (!series) {
    return { ok: false, error: 'Series not found.' };
  }

  const orderedBooks = (
    await Promise.all(series.bookOrder.map((id) => db.get('books', id)))
  ).filter(Boolean) as Book[];
  if (orderedBooks.length === 0) {
    return { ok: false, error: 'No books found in this series.' };
  }

  const targetIndex = orderedBooks.findIndex((item) => item.id === bookId);
  if (targetIndex < 0) {
    return { ok: false, error: 'Book is not in this series.' };
  }

  const tx = db.transaction(['books', 'searchIndexes'], 'readwrite');
  const nextBooks = orderedBooks.map((item) => ({ ...item }));

  if (status === 'reading') {
    for (let index = 0; index < nextBooks.length; index += 1) {
      const item = nextBooks[index];
      if (index < targetIndex) {
        item.status = 'done';
        item.currentChapter = item.totalChapters;
      } else if (index === targetIndex) {
        item.status = 'reading';
        item.currentChapter = clampReadingChapter(item.currentChapter, item.totalChapters);
      } else {
        item.status = 'locked';
        item.currentChapter = 0;
      }
    }
  } else if (status === 'done') {
    for (let index = 0; index < nextBooks.length; index += 1) {
      const item = nextBooks[index];
      if (index <= targetIndex) {
        item.status = 'done';
        item.currentChapter = item.totalChapters;
      } else if (index === targetIndex + 1) {
        item.status = 'reading';
        item.currentChapter = clampReadingChapter(item.currentChapter, item.totalChapters);
      } else {
        item.status = 'locked';
        item.currentChapter = 0;
      }
    }
  } else {
    let readingAssigned = false;
    for (let index = 0; index < nextBooks.length; index += 1) {
      const item = nextBooks[index];
      if (index >= targetIndex) {
        item.status = 'locked';
        item.currentChapter = 0;
        continue;
      }

      if (item.status === 'done') {
        item.currentChapter = item.totalChapters;
        continue;
      }

      if (!readingAssigned) {
        item.status = 'reading';
        item.currentChapter = clampReadingChapter(item.currentChapter, item.totalChapters);
        readingAssigned = true;
      } else {
        item.status = 'locked';
        item.currentChapter = 0;
      }
    }
  }

  for (const item of nextBooks) {
    await tx.objectStore('books').put(item);
  }

  await tx.objectStore('searchIndexes').delete(series.id);
  await tx.done;
  return { ok: true };
}

export async function offloadBookLocalContent(bookId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getDb();
  const book = await db.get('books', bookId);
  if (!book) {
    return { ok: false, error: 'Book not found.' };
  }

  const chunkKeys = await db.getAllKeysFromIndex('chunks', 'by-book', bookId);
  const tx = db.transaction(['books', 'chunks', 'searchIndexes'], 'readwrite');

  for (const key of chunkKeys) {
    await tx.objectStore('chunks').delete(key);
  }

  await tx.objectStore('searchIndexes').delete(bookId);
  if (book.seriesId) {
    await tx.objectStore('searchIndexes').delete(book.seriesId);
  }

  const next = { ...book, hasLocalContent: false };
  await tx.objectStore('books').put(next);
  await tx.done;

  return { ok: true };
}
