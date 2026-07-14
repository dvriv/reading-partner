import type { Plan, QuestionClassification } from '@reading-partner/shared';
import { getEnv } from '../env.js';

export function selectAnswerModel(input: {
  plan: Plan;
  classification: QuestionClassification;
  lowConfidenceRetrieval: boolean;
}): string {
  const env = getEnv();
  if (input.plan === 'free') return env.deepseekCheapModel;
  if (input.plan === 'admin') {
    return input.classification.needsStrongAnswerModel || input.lowConfidenceRetrieval ? env.deepseekStrongModel : env.deepseekCheapModel;
  }
  if (
    input.lowConfidenceRetrieval ||
    input.classification.needsStrongAnswerModel ||
    ['broad_summary', 'relationship_explanation', 'ambiguous'].includes(input.classification.questionType)
  ) {
    return env.deepseekStrongModel;
  }
  return env.deepseekCheapModel;
}
