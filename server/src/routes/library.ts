import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { LibraryBook, LibraryResponse } from '@reading-partner/shared';
import { getDb } from '../db/client.js';
import { authMiddleware, type AppBindings } from '../middleware/auth.js';

export const libraryRoute = new Hono<AppBindings>();

libraryRoute.get('/library', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const db = getDb();
  const seriesRows = (await db.execute(sql`select id, name, author from series where user_id = ${userId} order by created_at desc`)) as unknown as Array<{ id: string; name: string; author: string | null }>;
  const bookRows = (await db.execute(sql`
    select id, series_id, title, author, book_number, current_chapter, total_chapters, source_type, status, processing_status, has_server_content
    from books where user_id = ${userId} order by coalesce(book_number, 999999), created_at desc
  `)) as unknown as Array<Record<string, unknown>>;
  const books: LibraryBook[] = bookRows.map((book) => ({
    id: String(book.id),
    seriesId: (book.series_id as string | null) ?? null,
    title: String(book.title),
    author: (book.author as string | null) ?? null,
    bookNumber: (book.book_number as number | null) ?? null,
    currentChapter: Number(book.current_chapter ?? 1),
    totalChapters: Number(book.total_chapters ?? 0),
    sourceType: String(book.source_type ?? 'epub'),
    status: String(book.status ?? 'reading'),
    processingStatus: String(book.processing_status ?? 'pending'),
    hasServerContent: Boolean(book.has_server_content),
  }));
  const response: LibraryResponse = {
    series: seriesRows.map((item) => ({ ...item, books: books.filter((book) => book.seriesId === item.id) })),
    standaloneBooks: books.filter((book) => !book.seriesId),
  };
  return c.json(response);
});
