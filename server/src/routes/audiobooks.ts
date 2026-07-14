import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unlink, writeFile } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { alignTranscriptToChapter, shouldSaveAlignmentOffset } from '../audio/alignment.js';
import { getTranscriptionProvider } from '../audio/transcription.js';
import { getDb } from '../db/client.js';
import { debugLog } from '../env.js';
import { validateAudioFileName } from '../files/file-types.js';
import { authMiddleware, type AppBindings } from '../middleware/auth.js';
import { assertCanUseAudioAlignment, recordAudioAlignmentUsage } from '../quota/plans.js';
import { jsonError } from '../utils/http.js';

export const audiobooksRoute = new Hono<AppBindings>();

audiobooksRoute.post('/audiobooks/attach', authMiddleware, async (c) => {
  const userId = c.get('userId');
  debugLog('Audio', 'attach:start', { userId });
  const body = await c.req.parseBody();
  const bookId = typeof body.bookId === 'string' ? body.bookId : '';
  const fileName = typeof body.fileName === 'string' ? body.fileName : body.file instanceof File ? body.file.name : '';
  if (!bookId || !fileName) return jsonError(c, 400, 'INVALID_REQUEST', 'bookId and fileName are required.');
  const validation = validateAudioFileName(fileName);
  if (!validation.ok) return jsonError(c, 422, 'UNSUPPORTED_FILE', validation.message);
  const book = await getDb().execute(sql`select id, series_id from books where user_id = ${userId} and id = ${bookId} limit 1`);
  if (!book[0]) return jsonError(c, 404, 'BOOK_NOT_FOUND', 'Book not found.');
  const rows = await getDb().execute(sql`
    insert into audio_files (user_id, series_id, book_id, file_name, mime_type, duration_seconds, file_order, storage_status, processing_status)
    values (${userId}, ${book[0].series_id ?? null}, ${bookId}, ${fileName}, ${typeof body.mimeType === 'string' ? body.mimeType : null}, ${typeof body.durationSeconds === 'string' ? Number.parseInt(body.durationSeconds, 10) : null}, ${typeof body.fileOrder === 'string' ? Number.parseInt(body.fileOrder, 10) : null}, 'temporary', 'ready')
    returning *
  `);
  debugLog('Audio', 'attach:done', { audioFileId: rows[0]?.id });
  return c.json(rows[0]);
});

audiobooksRoute.post('/audiobooks/align-progress', authMiddleware, async (c) => {
  const userId = c.get('userId');
  debugLog('Audio', 'alignment:start', { userId });
  let tempPath: string | null = null;
  try {
    const body = await c.req.parseBody();
    const bookId = typeof body.bookId === 'string' ? body.bookId : '';
    const audioFileId = typeof body.audioFileId === 'string' ? body.audioFileId : null;
    const chapterNumber = typeof body.chapterNumber === 'string' ? Number.parseInt(body.chapterNumber, 10) : Number(body.chapterNumber);
    const timestampSeconds = typeof body.timestampSeconds === 'string' ? Number.parseInt(body.timestampSeconds, 10) : Number(body.timestampSeconds);
    const file = body.file;
    if (!bookId || !Number.isInteger(chapterNumber) || !Number.isInteger(timestampSeconds) || !(file instanceof File)) {
      return jsonError(c, 400, 'INVALID_REQUEST', 'bookId, chapterNumber, timestampSeconds, and file are required.');
    }
    const validation = validateAudioFileName(file.name);
    if (!validation.ok) return jsonError(c, 422, 'UNSUPPORTED_FILE', validation.message);

    const windowStart = Math.max(0, timestampSeconds - 300);
    const windowEnd = timestampSeconds + 300;
    const requestedSeconds = windowEnd - windowStart;
    await assertCanUseAudioAlignment(userId, requestedSeconds);
    debugLog('Audio', 'transcription window', { windowStart, windowEnd });

    const book = await getDb().execute(sql`select id, series_id from books where user_id = ${userId} and id = ${bookId} and has_server_content = true limit 1`);
    if (!book[0]) return jsonError(c, 404, 'BOOK_NOT_FOUND', 'Book with canonical EPUB content not found.');
    const chapterRows = await getDb().execute(sql`
      select ch.id, ch.start_offset, string_agg(c.content, E'\n\n' order by c.chunk_index) as chapter_text
      from chapters ch
      join chunks c on c.chapter_id = ch.id and c.user_id = ch.user_id
      where ch.user_id = ${userId} and ch.book_id = ${bookId} and ch.chapter_number = ${chapterNumber} and c.source_type = 'epub'
      group by ch.id, ch.start_offset
      limit 1
    `);
    const chapter = chapterRows[0] as { id: string; start_offset: number | null; chapter_text: string } | undefined;
    if (!chapter?.chapter_text) return jsonError(c, 404, 'CHAPTER_NOT_FOUND', 'Canonical chapter text not found.');

    tempPath = join(tmpdir(), `spoilerfree-audio-${randomUUID()}-${file.name}`);
    await writeFile(tempPath, Buffer.from(await file.arrayBuffer()));
    const transcript = await getTranscriptionProvider().transcribeAudioWindow({ filePath: tempPath, startSeconds: windowStart, endSeconds: windowEnd });
    debugLog('Audio', 'transcription result preview', { preview: transcript.text.slice(0, 160) });
    const alignment = alignTranscriptToChapter({ transcriptText: transcript.text, chapterText: chapter.chapter_text, chapterStartOffset: chapter.start_offset ?? 0 });
    debugLog('Audio', 'alignment confidence', { confidence: alignment.confidence });
    const shouldSave = shouldSaveAlignmentOffset(alignment);
    await getDb().execute(sql`
      insert into audio_progress_mappings (user_id, series_id, book_id, chapter_id, audio_file_id, chapter_number, audio_position_seconds, audio_window_start_seconds, audio_window_end_seconds, transcript_text, matched_text_preview, text_start_offset, text_end_offset, confidence, provider, model)
      values (${userId}, ${book[0].series_id ?? null}, ${bookId}, ${chapter.id}, ${audioFileId}, ${chapterNumber}, ${timestampSeconds}, ${windowStart}, ${windowEnd}, ${transcript.text.slice(0, 4000)}, ${alignment.matchedTextPreview ?? null}, ${alignment.textStartOffset ?? null}, ${alignment.textEndOffset ?? null}, ${alignment.confidence}, ${transcript.provider}, ${transcript.model})
    `);
    if (shouldSave) {
      await getDb().execute(sql`
        insert into reading_progress (user_id, series_id, book_id, current_book_number, current_chapter, current_text_offset, progress_source, updated_at)
        values (${userId}, ${book[0].series_id ?? null}, ${bookId}, null, ${chapterNumber}, ${alignment.textEndOffset ?? null}, 'audio_alignment', now())
      `);
      debugLog('Audio', 'offset saved/skipped', { saved: true, offset: alignment.textEndOffset });
    } else {
      debugLog('Audio', 'offset saved/skipped', { saved: false });
    }
    await recordAudioAlignmentUsage(userId, requestedSeconds);
    return c.json({ savedOffset: shouldSave, chapterNumber, timestampSeconds, ...alignment });
  } finally {
    if (tempPath) {
      await unlink(tempPath).catch(() => undefined);
      debugLog('Audio', 'temp file deleted');
    }
  }
});
