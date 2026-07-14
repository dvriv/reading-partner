import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { AI_DEFAULTS } from '../ai/defaults.js';
import { embedTexts } from '../ai/voyage.js';
import { chunkChapters, estimateTokens } from '../books/chunker.js';
import { parseEpub } from '../books/epub.js';
import { getDb } from '../db/client.js';
import { debugLog } from '../env.js';
import { validateEbookFileName } from '../files/file-types.js';
import { authMiddleware, type AppBindings } from '../middleware/auth.js';
import { assertCanUploadBook, recordBookUploadUsage, recordEmbeddingUsage } from '../quota/plans.js';
import { jsonError } from '../utils/http.js';

export const booksRoute = new Hono<AppBindings>();

booksRoute.post('/books/upload', authMiddleware, async (c) => {
  const userId = c.get('userId');
  debugLog('AI', 'upload:start', { userId });
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return jsonError(c, 400, 'INVALID_UPLOAD', 'Upload must include a file field.');
  const validation = validateEbookFileName(file.name);
  if (!validation.ok) return jsonError(c, 422, 'UNSUPPORTED_FILE', validation.message);
  await assertCanUploadBook(userId, file.size);

  const seriesId = typeof body.seriesId === 'string' && body.seriesId ? body.seriesId : null;
  const bookNumber = typeof body.bookNumber === 'string' && body.bookNumber ? Number.parseInt(body.bookNumber, 10) : null;
  const db = getDb();
  const parsed = await parseEpub(Buffer.from(await file.arrayBuffer()), file.name);
  const chunks = chunkChapters(parsed.chapters);
  const tokenCount = chunks.reduce((sum, chunk) => sum + chunk.tokenCount, 0);

  const bookRows = await db.execute(sql`
    insert into books (user_id, series_id, title, author, language, total_chapters, book_number, processing_status, has_server_content, source_file_name, token_count)
    values (${userId}, ${seriesId}, ${parsed.metadata.title}, ${parsed.metadata.author ?? null}, ${parsed.metadata.language ?? null}, ${parsed.chapters.length}, ${bookNumber}, 'processing', false, ${file.name}, ${tokenCount})
    returning id
  `);
  const bookId = String(bookRows[0]?.id);

  const chapterIds = new Map<number, string>();
  for (const chapter of parsed.chapters) {
    const inserted = await db.execute(sql`
      insert into chapters (user_id, series_id, book_id, chapter_number, title, start_offset, end_offset)
      values (${userId}, ${seriesId}, ${bookId}, ${chapter.chapterNumber}, ${chapter.title}, ${chapter.startOffset ?? null}, ${(chapter.startOffset ?? 0) + chapter.text.length})
      returning id
    `);
    chapterIds.set(chapter.chapterNumber, String(inserted[0]?.id));
  }

  for (let index = 0; index < chunks.length; index += 64) {
    const batch = chunks.slice(index, index + 64);
    const embedded = await embedTexts(batch.map((chunk) => chunk.content), 'document');
    await recordEmbeddingUsage(userId, { tokens: embedded.tokens });
    for (let i = 0; i < batch.length; i += 1) {
      const chunk = batch[i];
      await db.execute(sql`
        insert into chunks (user_id, series_id, book_id, chapter_id, source_type, book_number, chapter_number, chunk_index, chapter_label, content, token_count, start_offset, end_offset, embedding_model, embedding_dimension, embedding_version, embedding)
        values (${userId}, ${seriesId}, ${bookId}, ${chapterIds.get(chunk.chapterNumber) ?? null}, 'epub', ${bookNumber}, ${chunk.chapterNumber}, ${chunk.chunkIndex}, ${chunk.chapterLabel}, ${chunk.content}, ${estimateTokens(chunk.content)}, ${chunk.startOffset}, ${chunk.endOffset}, ${AI_DEFAULTS.embeddingModel}, ${AI_DEFAULTS.embeddingDimension}, ${AI_DEFAULTS.embeddingVersion}, ${`[${(embedded.embeddings[i] ?? []).join(',')}]`}::vector)
      `);
    }
  }

  await db.execute(sql`update books set processing_status = 'ready', has_server_content = true, updated_at = now() where user_id = ${userId} and id = ${bookId}`);
  await recordBookUploadUsage(userId);
  debugLog('AI', 'upload:done', { bookId, chunks: chunks.length });
  return c.json({ bookId, title: parsed.metadata.title, chapters: parsed.chapters.length, chunks: chunks.length });
});

booksRoute.get('/books/:bookId', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const bookId = c.req.param('bookId');
  const rows = await getDb().execute(sql`select * from books where user_id = ${userId} and id = ${bookId} limit 1`);
  if (!rows[0]) return jsonError(c, 404, 'BOOK_NOT_FOUND', 'Book not found.');
  return c.json(rows[0]);
});

booksRoute.delete('/books/:bookId', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const bookId = c.req.param('bookId');
  await getDb().execute(sql`delete from books where user_id = ${userId} and id = ${bookId}`);
  return c.json({ ok: true });
});
