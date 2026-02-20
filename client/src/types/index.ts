export interface Series {
  id: string;
  name: string;
  bookOrder: string[];
  createdAt: string;
}

export type ProcessingStatus = 'pending' | 'processing' | 'ready' | 'error';
export type BookStatus = 'locked' | 'reading' | 'done';
export type IngestionStage = 'parse' | 'chunk' | 'embed' | 'index' | 'complete';

export interface IngestionMetadata {
  stage: IngestionStage;
  completed: number;
  total: number;
  percentage: number;
  error: string | null;
  updatedAt: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  totalChapters: number;
  currentChapter: number;
  processingStatus: ProcessingStatus;
  seriesId: string | null;
  bookNumber: number | null;
  status: BookStatus;
  hasLocalContent: boolean;
  ingestion: IngestionMetadata;
  createdAt: string;
}

export interface Chapter {
  bookId: string;
  chapterNumber: number;
  title: string;
}

export interface Chunk {
  id?: number;
  bookId: string;
  chapterNumber: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embedding: number[] | null;
}

export interface Citation {
  bookTitle: string;
  chapterNumber: number;
  excerpt: string;
}

export interface RetrievalTraceItem {
  rank: number;
  chunkId?: number;
  bookTitle: string;
  chapterNumber: number;
  snippet: string;
  fullChunk?: string;
  combinedScore: number;
  bm25Score?: number;
  vectorScore?: number;
}

export interface RetrievalTrace {
  mode: 'book' | 'series';
  query: string;
  totalCandidates: number;
  returned: number;
  generatedAt: string;
  items: RetrievalTraceItem[];
}

export interface ChatMessage {
  id?: number;
  contextId: string;
  contextType: 'series' | 'book';
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  confidence?: 'high' | 'medium' | 'low';
  assistantState?: 'no-context' | 'provider-error' | 'low-confidence';
  retryPrompt?: string;
  retrievalTrace?: RetrievalTrace;
  createdAt: string;
}

export interface AnswerResponse {
  answer: string;
  citations: Citation[];
  confidence: 'high' | 'medium' | 'low';
  reasonCode?: string;
}
