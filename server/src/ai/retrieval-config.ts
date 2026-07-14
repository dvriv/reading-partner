import type { QuestionClassification, QuestionType } from '@reading-partner/shared';

export type RetrievalConfig = {
  vectorK: number;
  keywordK: number;
  finalAnswerK: number;
  useReranker: boolean;
  diversifyByChapter: boolean;
  preferRecentContext: boolean;
};

export const RETRIEVAL_CONFIGS: Record<QuestionType, RetrievalConfig> = {
  entity_lookup: { vectorK: 20, keywordK: 20, finalAnswerK: 6, useReranker: false, diversifyByChapter: false, preferRecentContext: false },
  specific_event: { vectorK: 30, keywordK: 30, finalAnswerK: 8, useReranker: true, diversifyByChapter: false, preferRecentContext: false },
  recent_recap: { vectorK: 20, keywordK: 20, finalAnswerK: 8, useReranker: false, diversifyByChapter: false, preferRecentContext: true },
  chapter_recap: { vectorK: 30, keywordK: 30, finalAnswerK: 10, useReranker: true, diversifyByChapter: false, preferRecentContext: true },
  character_recap: { vectorK: 60, keywordK: 60, finalAnswerK: 12, useReranker: true, diversifyByChapter: true, preferRecentContext: false },
  relationship_explanation: { vectorK: 60, keywordK: 60, finalAnswerK: 12, useReranker: true, diversifyByChapter: true, preferRecentContext: false },
  broad_summary: { vectorK: 80, keywordK: 80, finalAnswerK: 15, useReranker: true, diversifyByChapter: true, preferRecentContext: false },
  quote_or_scene_lookup: { vectorK: 30, keywordK: 50, finalAnswerK: 8, useReranker: true, diversifyByChapter: false, preferRecentContext: false },
  ambiguous: { vectorK: 50, keywordK: 50, finalAnswerK: 10, useReranker: true, diversifyByChapter: true, preferRecentContext: false },
};

export function getRetrievalConfig(classification: QuestionClassification): RetrievalConfig {
  const base = RETRIEVAL_CONFIGS[classification.questionType] ?? RETRIEVAL_CONFIGS.ambiguous;
  return {
    ...base,
    useReranker: base.useReranker || classification.needsReranker,
    preferRecentContext: base.preferRecentContext || classification.preferRecentContext,
  };
}
