export type Plan = 'free' | 'paid' | 'admin';

export type ContextType = 'book' | 'series';

export type QuestionType =
  | 'entity_lookup'
  | 'specific_event'
  | 'recent_recap'
  | 'chapter_recap'
  | 'character_recap'
  | 'relationship_explanation'
  | 'broad_summary'
  | 'quote_or_scene_lookup'
  | 'ambiguous';

export type QuestionScope = 'narrow' | 'medium' | 'broad';

export type QuestionClassification = {
  questionType: QuestionType;
  scope: QuestionScope;
  needsReranker: boolean;
  preferRecentContext: boolean;
  needsStrongAnswerModel: boolean;
  searchTerms: string[];
};

export type AskRequest = {
  contextType: ContextType;
  contextId: string;
  question: string;
};

export type AskDebug = {
  classification: QuestionClassification;
  modelUsed: string;
  rerankUsed: boolean;
  vectorCandidates: number;
  keywordCandidates: number;
  mergedCandidates: number;
  finalChunks: number;
  spoilerFilter: {
    contextType: ContextType;
    currentBookNumber?: number;
    currentChapter: number;
    currentTextOffset?: number;
    unsafeChunksRemoved: number;
  };
  selectedChunks: {
    bookTitle: string;
    chapterLabel: string;
    chunkIndex: number;
    score?: number;
    rerankScore?: number;
    preview: string;
  }[];
};

export type AskResponse = {
  answer: string;
  citations: {
    bookTitle: string;
    chapterLabel: string;
    excerpt: string;
  }[];
  confidence: 'high' | 'medium' | 'low';
  reasonCode?: string;
  debug?: AskDebug;
};

export type LibraryBook = {
  id: string;
  seriesId: string | null;
  title: string;
  author: string | null;
  bookNumber: number | null;
  currentChapter: number;
  totalChapters: number;
  sourceType: string;
  status: string;
  processingStatus: string;
  hasServerContent: boolean;
};

export type LibrarySeries = {
  id: string;
  name: string;
  author: string | null;
  books: LibraryBook[];
};

export type LibraryResponse = {
  series: LibrarySeries[];
  standaloneBooks: LibraryBook[];
};

export type ProgressSource = 'manual' | 'audio_alignment';

export type ProgressPatchRequest = {
  seriesId?: string;
  bookId?: string;
  currentBookNumber?: number;
  currentChapter: number;
  currentTextOffset?: number;
  progressSource?: ProgressSource;
};

export const DRM_UNSUPPORTED_MESSAGE =
  'This file appears to be DRM-protected or unsupported. SpoilerFree can only process DRM-free EPUB and common DRM-free audio files.';

export function isAskRequest(value: unknown): value is AskRequest {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<AskRequest>;
  return (
    (draft.contextType === 'book' || draft.contextType === 'series') &&
    typeof draft.contextId === 'string' &&
    draft.contextId.length > 0 &&
    typeof draft.question === 'string' &&
    draft.question.trim().length > 0
  );
}
