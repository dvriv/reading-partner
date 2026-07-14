import type { QuestionClassification } from '@reading-partner/shared';
import type { RetrievalConfig } from './retrieval-config.js';

export type RerankSignalInput = {
  classification: QuestionClassification;
  config: RetrievalConfig;
  candidateCount: number;
  vectorTopScore?: number;
  keywordTopScore?: number;
  vectorKeywordDisagree?: boolean;
};

export function shouldUseReranker(input: RerankSignalInput): { use: boolean; reason: string } {
  if (!input.config.useReranker && !input.classification.needsReranker) {
    return { use: false, reason: 'simple_high_confidence_config' };
  }
  if (input.candidateCount <= input.config.finalAnswerK) {
    return { use: false, reason: 'not_enough_candidates' };
  }
  if (input.vectorKeywordDisagree) return { use: true, reason: 'vector_keyword_disagree' };
  if (['broad_summary', 'ambiguous', 'relationship_explanation', 'character_recap'].includes(input.classification.questionType)) {
    return { use: true, reason: 'broad_or_ambiguous' };
  }
  const topScore = Math.max(input.vectorTopScore ?? 0, input.keywordTopScore ?? 0);
  if (topScore < 0.55) return { use: true, reason: 'weak_top_score' };
  return { use: input.classification.needsReranker, reason: input.classification.needsReranker ? 'classifier_requested' : 'skipped' };
}
