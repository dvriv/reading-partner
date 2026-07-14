import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(1024)';
  },
  toDriver(value) {
    return `[${value.join(',')}]`;
  },
});

const tsvector = customType<{ data: string }>({
  dataType() {
    return 'tsvector';
  },
});

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
};

export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  plan: text('plan').default('free').notNull(),
  ...timestamps,
});

export const series = pgTable(
  'series',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    name: text('name').notNull(),
    author: text('author'),
    ...timestamps,
  },
  (table) => [index('series_user_id_idx').on(table.userId)],
);

export const books = pgTable(
  'books',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    seriesId: uuid('series_id').references(() => series.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    author: text('author'),
    isbn: text('isbn'),
    language: text('language'),
    publicationYear: integer('publication_year'),
    coverUrl: text('cover_url'),
    totalChapters: integer('total_chapters').default(0).notNull(),
    currentChapter: integer('current_chapter').default(1).notNull(),
    bookNumber: integer('book_number'),
    sourceType: text('source_type').default('epub').notNull(),
    status: text('status').default('reading').notNull(),
    processingStatus: text('processing_status').default('pending').notNull(),
    hasServerContent: boolean('has_server_content').default(false).notNull(),
    sourceFileName: text('source_file_name'),
    tokenCount: integer('token_count'),
    ...timestamps,
  },
  (table) => [index('books_user_id_idx').on(table.userId), index('books_user_series_idx').on(table.userId, table.seriesId)],
);

export const chapters = pgTable(
  'chapters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    seriesId: uuid('series_id').references(() => series.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    chapterNumber: integer('chapter_number').notNull(),
    title: text('title').notNull(),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('chapters_book_chapter_unique').on(table.bookId, table.chapterNumber)],
);

export const chunks = pgTable(
  'chunks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    seriesId: uuid('series_id').references(() => series.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    sourceType: text('source_type').notNull(),
    bookNumber: integer('book_number'),
    chapterNumber: integer('chapter_number').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    chapterLabel: text('chapter_label').notNull(),
    content: text('content').notNull(),
    tokenCount: integer('token_count'),
    startOffset: integer('start_offset'),
    endOffset: integer('end_offset'),
    audioFileId: uuid('audio_file_id'),
    audioStartSeconds: integer('audio_start_seconds'),
    audioEndSeconds: integer('audio_end_seconds'),
    embeddingModel: text('embedding_model'),
    embeddingDimension: integer('embedding_dimension'),
    embeddingVersion: text('embedding_version'),
    embedding: vector('embedding'),
    searchVector: tsvector('search_vector').notNull().default(sql`''::tsvector`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('chunks_user_series_idx').on(table.userId, table.seriesId),
    index('chunks_user_book_idx').on(table.userId, table.bookId),
    index('chunks_user_series_position_idx').on(table.userId, table.seriesId, table.bookNumber, table.chapterNumber),
    index('chunks_user_book_chapter_idx').on(table.userId, table.bookId, table.chapterNumber),
    index('chunks_search_vector_idx').using('gin', table.searchVector),
    index('chunks_embedding_cosine_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
);

export const readingProgress = pgTable(
  'reading_progress',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    seriesId: uuid('series_id').references(() => series.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id').references(() => books.id, { onDelete: 'cascade' }),
    currentBookNumber: integer('current_book_number'),
    currentChapter: integer('current_chapter').default(1).notNull(),
    currentTextOffset: integer('current_text_offset'),
    progressSource: text('progress_source').default('manual').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('reading_progress_user_series_idx').on(table.userId, table.seriesId), index('reading_progress_user_book_idx').on(table.userId, table.bookId)],
);

export const audioFiles = pgTable('audio_files', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  seriesId: uuid('series_id').references(() => series.id, { onDelete: 'cascade' }),
  bookId: uuid('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
  fileName: text('file_name').notNull(),
  mimeType: text('mime_type'),
  durationSeconds: integer('duration_seconds'),
  fileOrder: integer('file_order'),
  storageStatus: text('storage_status').default('temporary').notNull(),
  processingStatus: text('processing_status').default('pending').notNull(),
  ...timestamps,
});

export const audioProgressMappings = pgTable(
  'audio_progress_mappings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    seriesId: uuid('series_id').references(() => series.id, { onDelete: 'cascade' }),
    bookId: uuid('book_id').notNull().references(() => books.id, { onDelete: 'cascade' }),
    chapterId: uuid('chapter_id').references(() => chapters.id, { onDelete: 'set null' }),
    audioFileId: uuid('audio_file_id').references(() => audioFiles.id, { onDelete: 'set null' }),
    chapterNumber: integer('chapter_number').notNull(),
    audioPositionSeconds: integer('audio_position_seconds').notNull(),
    audioWindowStartSeconds: integer('audio_window_start_seconds').notNull(),
    audioWindowEndSeconds: integer('audio_window_end_seconds').notNull(),
    transcriptText: text('transcript_text').notNull(),
    matchedTextPreview: text('matched_text_preview'),
    textStartOffset: integer('text_start_offset'),
    textEndOffset: integer('text_end_offset'),
    confidence: numeric('confidence'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('audio_mappings_user_book_chapter_idx').on(table.userId, table.bookId, table.chapterNumber)],
);

export const monthlyUsage = pgTable(
  'monthly_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull(),
    periodStart: date('period_start').notNull(),
    periodEnd: date('period_end').notNull(),
    questionsUsed: integer('questions_used').default(0).notNull(),
    booksUploaded: integer('books_uploaded').default(0).notNull(),
    embeddingTokensUsed: integer('embedding_tokens_used').default(0).notNull(),
    rerankTokensUsed: integer('rerank_tokens_used').default(0).notNull(),
    answerInputTokensUsed: integer('answer_input_tokens_used').default(0).notNull(),
    answerOutputTokensUsed: integer('answer_output_tokens_used').default(0).notNull(),
    audioAlignmentSecondsUsed: integer('audio_alignment_seconds_used').default(0).notNull(),
    ...timestamps,
  },
  (table) => [index('monthly_usage_user_period_idx').on(table.userId, table.periodStart)],
);

export const aiRequestLogs = pgTable('ai_request_logs', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  requestType: text('request_type').notNull(),
  model: text('model'),
  questionType: text('question_type'),
  rerankUsed: boolean('rerank_used'),
  vectorCandidates: integer('vector_candidates'),
  keywordCandidates: integer('keyword_candidates'),
  finalChunks: integer('final_chunks'),
  success: boolean('success').default(true).notNull(),
  errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const seriesRelations = relations(series, ({ many }) => ({ books: many(books) }));
export const booksRelations = relations(books, ({ one, many }) => ({
  series: one(series, { fields: [books.seriesId], references: [series.id] }),
  chapters: many(chapters),
  chunks: many(chunks),
}));

export const primaryKeyForSupabaseAuthUsers = primaryKey;
