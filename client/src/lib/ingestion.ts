import type { IDBPDatabase } from 'idb';
import type { IngestionMetadata } from '../types';
import { embedChunks } from './embeddings';
import { getDb } from './db';
import { normalizeBookRecord } from './ingestion-state';
import { rebuildIndexForBook, rebuildIndexForSeries } from './search';

const EMBED_BATCH_SIZE = 50;

function progressLabel(meta: IngestionMetadata): string {
  if (meta.stage === 'embed') {
    return `Embedding ${meta.completed}/${meta.total} (${meta.percentage}%)`;
  }
  if (meta.stage === 'chunk') {
    return `Chunking ${meta.completed}/${meta.total} (${meta.percentage}%)`;
  }
  if (meta.stage === 'index') {
    return 'Indexing searchable text...';
  }
  if (meta.stage === 'parse') {
    return 'Parsing EPUB...';
  }
  return 'Processing complete';
}

function calculatePercentage(completed: number, total: number): number {
  if (total <= 0) return completed > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
}

async function updateIngestion(
  db: IDBPDatabase<any>,
  bookId: string,
  patch: Partial<IngestionMetadata>,
  onProgress?: (meta: IngestionMetadata) => void
): Promise<IngestionMetadata | null> {
  const existing = await db.get('books', bookId);
  if (!existing) return null;
  const normalized = normalizeBookRecord(existing);
  const completed = patch.completed ?? normalized.ingestion.completed;
  const total = patch.total ?? normalized.ingestion.total;
  const next: IngestionMetadata = {
    ...normalized.ingestion,
    ...patch,
    completed,
    total,
    percentage: patch.percentage ?? calculatePercentage(completed, total),
    updatedAt: new Date().toISOString(),
  };
  normalized.ingestion = next;
  await db.put('books', normalized);
  onProgress?.(next);
  return next;
}

export interface ResumeResult {
  missingBefore: number;
  indexed: boolean;
}

interface ResumeControls {
  signal?: AbortSignal;
  shouldCancel?: () => boolean;
}

export async function resumeBookIngestion(
  bookId: string,
  authToken: string,
  onProgress?: (meta: IngestionMetadata) => void,
  controls?: ResumeControls
): Promise<ResumeResult> {
  const db = await getDb();
  const bookRecord = await db.get('books', bookId);
  if (!bookRecord) {
    throw new Error('Book not found.');
  }

  const book = normalizeBookRecord(bookRecord);
  const allChunks = await db.getAllFromIndex('chunks', 'by-book', bookId);
  const chunksWithIds = allChunks.filter((chunk) => chunk.id !== undefined) as Array<{
    id: number;
    content: string;
    embedding: number[] | null;
  }>;

  if (chunksWithIds.length === 0) {
    throw new Error('No chunks were found for this book. Re-upload this EPUB.');
  }

  const missing = chunksWithIds.filter((chunk) => !chunk.embedding);

  const throwIfCancelled = () => {
    if (controls?.signal?.aborted || controls?.shouldCancel?.()) {
      throw new Error('UPLOAD_CANCELLED');
    }
  };

  try {
    throwIfCancelled();

    const started = await db.get('books', bookId);
    if (started) {
      const next = normalizeBookRecord(started);
      next.processingStatus = 'processing';
      next.ingestion.error = null;
      await db.put('books', next);
    }

    await updateIngestion(
      db,
      bookId,
      {
        stage: 'embed',
        completed: chunksWithIds.length - missing.length,
        total: chunksWithIds.length,
        error: null,
      },
      onProgress
    );

    if (missing.length > 0) {
      let embeddedCount = chunksWithIds.length - missing.length;
      for (let i = 0; i < missing.length; i += EMBED_BATCH_SIZE) {
        throwIfCancelled();

        const batch = missing.slice(i, i + EMBED_BATCH_SIZE);
        const vectors = await embedChunks(
          batch.map((chunk) => chunk.content),
          authToken,
          {
            maxAttempts: 4,
            baseDelayMs: 600,
            signal: controls?.signal,
            shouldCancel: controls?.shouldCancel,
          }
        );

        for (let index = 0; index < batch.length; index += 1) {
          const record = await db.get('chunks', batch[index].id);
          if (!record) continue;
          record.embedding = vectors[index] ?? null;
          await db.put('chunks', record);
        }

        embeddedCount += batch.length;
        await updateIngestion(
          db,
          bookId,
          {
            stage: 'embed',
            completed: Math.min(embeddedCount, chunksWithIds.length),
            total: chunksWithIds.length,
            error: null,
          },
          onProgress
        );
      }
    }

    await updateIngestion(
      db,
      bookId,
      { stage: 'index', completed: 0, total: 1, percentage: 0, error: null },
      onProgress
    );

    throwIfCancelled();

    await rebuildIndexForBook(bookId);
    if (book.seriesId) {
      await rebuildIndexForSeries(book.seriesId);
    }

    const completedBook = await db.get('books', bookId);
    if (completedBook) {
      const normalized = normalizeBookRecord(completedBook);
      normalized.processingStatus = 'ready';
      normalized.hasLocalContent = true;
      normalized.ingestion = {
        stage: 'complete',
        completed: 1,
        total: 1,
        percentage: 100,
        error: null,
        updatedAt: new Date().toISOString(),
      };
      if (normalized.status === 'reading' && normalized.currentChapter === 0) {
        normalized.currentChapter = 1;
      }
      await db.put('books', normalized);
      onProgress?.(normalized.ingestion);
    }

    return {
      missingBefore: missing.length,
      indexed: true,
    };
  } catch (error) {
    const failedBook = await db.get('books', bookId);
    if (failedBook) {
      const normalized = normalizeBookRecord(failedBook);
      normalized.processingStatus = 'error';
      normalized.ingestion = {
        ...normalized.ingestion,
        error: error instanceof Error ? error.message : 'Ingestion failed.',
        updatedAt: new Date().toISOString(),
      };
      await db.put('books', normalized);
      onProgress?.(normalized.ingestion);
    }
    throw error;
  }
}

export function formatIngestionLabel(meta: IngestionMetadata): string {
  return progressLabel(meta);
}
