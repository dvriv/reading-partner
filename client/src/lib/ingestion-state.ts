import type { Book, IngestionMetadata, IngestionStage, ProcessingStatus } from '../types';

function clampPercentage(value: number): number {
  if (Number.isNaN(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return Math.round(value);
}

export function computeIngestionPercentage(completed: number, total: number): number {
  if (total <= 0) return completed > 0 ? 100 : 0;
  return clampPercentage((completed / total) * 100);
}

export function defaultIngestionMetadata(status: ProcessingStatus, createdAt?: string): IngestionMetadata {
  const timestamp = createdAt ?? new Date().toISOString();
  if (status === 'ready') {
    return {
      stage: 'complete',
      completed: 1,
      total: 1,
      percentage: 100,
      error: null,
      updatedAt: timestamp,
    };
  }

  return {
    stage: status === 'error' ? 'embed' : 'parse',
    completed: 0,
    total: 1,
    percentage: 0,
    error: null,
    updatedAt: timestamp,
  };
}

export function normalizeIngestionMetadata(
  status: ProcessingStatus,
  ingestion: Partial<IngestionMetadata> | undefined,
  createdAt?: string
): IngestionMetadata {
  const base = defaultIngestionMetadata(status, createdAt);
  if (!ingestion) return base;

  const stage = (ingestion.stage ?? base.stage) as IngestionStage;
  const completed = ingestion.completed ?? base.completed;
  const total = ingestion.total ?? base.total;

  return {
    stage,
    completed,
    total,
    percentage: ingestion.percentage ?? computeIngestionPercentage(completed, total),
    error: ingestion.error ?? base.error,
    updatedAt: ingestion.updatedAt ?? base.updatedAt,
  };
}

export function normalizeBookRecord(book: Book): Book {
  return {
    ...book,
    isbn: book.isbn ?? null,
    publicationYear: typeof book.publicationYear === 'number' ? book.publicationYear : null,
    coverUrl: book.coverUrl ?? null,
    externalSeriesName: book.externalSeriesName ?? null,
    externalSeriesOrder: typeof book.externalSeriesOrder === 'number' ? book.externalSeriesOrder : null,
    hasLocalContent: book.hasLocalContent ?? true,
    ingestion: normalizeIngestionMetadata(book.processingStatus, book.ingestion, book.createdAt),
  };
}
