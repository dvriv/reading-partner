import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { ProgressPatchRequest } from '@reading-partner/shared';
import { getDb } from '../db/client.js';
import { authMiddleware, type AppBindings } from '../middleware/auth.js';
import { jsonError } from '../utils/http.js';

export const progressRoute = new Hono<AppBindings>();

progressRoute.patch('/progress', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const body = (await c.req.json()) as ProgressPatchRequest;
  if (!body.bookId && !body.seriesId) return jsonError(c, 400, 'INVALID_REQUEST', 'bookId or seriesId is required.');
  if (!Number.isInteger(body.currentChapter) || body.currentChapter < 1) return jsonError(c, 400, 'INVALID_REQUEST', 'currentChapter must be >= 1.');
  const rows = await getDb().execute(sql`
    insert into reading_progress (user_id, series_id, book_id, current_book_number, current_chapter, current_text_offset, progress_source, updated_at)
    values (${userId}, ${body.seriesId ?? null}, ${body.bookId ?? null}, ${body.currentBookNumber ?? null}, ${body.currentChapter}, ${body.currentTextOffset ?? null}, ${body.progressSource ?? 'manual'}, now())
    returning *
  `);
  return c.json(rows[0]);
});
