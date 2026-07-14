import type { ContextType, QuestionClassification, QuestionType } from '@reading-partner/shared';
import { getEnv } from '../env.js';

export const CLASSIFIER_FALLBACK: QuestionClassification = {
  questionType: 'ambiguous',
  scope: 'medium',
  needsReranker: true,
  preferRecentContext: false,
  needsStrongAnswerModel: true,
  searchTerms: [],
};

const QUESTION_TYPES = new Set<QuestionType>([
  'entity_lookup',
  'specific_event',
  'recent_recap',
  'chapter_recap',
  'character_recap',
  'relationship_explanation',
  'broad_summary',
  'quote_or_scene_lookup',
  'ambiguous',
]);

type ReadingPosition = {
  seriesName?: string;
  bookTitle?: string;
  currentBookNumber?: number;
  currentChapter: number;
  currentTextOffset?: number;
  progressSource?: 'manual' | 'audio_alignment';
};

function parseClassification(raw: string): QuestionClassification {
  const match = raw.trim().replace(/^```json\s*/i, '').replace(/```$/i, '').match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : raw) as Partial<QuestionClassification>;
  const questionType = parsed.questionType;
  if (!QUESTION_TYPES.has(questionType as QuestionType)) throw new Error('Invalid questionType');
  if (parsed.scope !== 'narrow' && parsed.scope !== 'medium' && parsed.scope !== 'broad') throw new Error('Invalid scope');
  return {
    questionType: questionType as QuestionType,
    scope: parsed.scope,
    needsReranker: Boolean(parsed.needsReranker),
    preferRecentContext: Boolean(parsed.preferRecentContext),
    needsStrongAnswerModel: Boolean(parsed.needsStrongAnswerModel),
    searchTerms: Array.isArray(parsed.searchTerms)
      ? parsed.searchTerms.filter((term): term is string => typeof term === 'string').slice(0, 12)
      : [],
  };
}

export async function classifyQuestion(input: {
  question: string;
  contextType: ContextType;
  readingPosition: ReadingPosition;
}): Promise<QuestionClassification> {
  const env = getEnv();
  if (!env.deepseekApiKey) return CLASSIFIER_FALLBACK;

  try {
    const response = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.deepseekApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.deepseekClassifierModel,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'Classify spoiler-safe reading assistant questions. Return strict JSON only. Do not ask for or use book chunks.',
          },
          {
            role: 'user',
            content: JSON.stringify({
              question: input.question,
              contextType: input.contextType,
              readingPosition: input.readingPosition,
              allowedQuestionTypes: Array.from(QUESTION_TYPES),
              allowedScopes: ['narrow', 'medium', 'broad'],
            }),
          },
        ],
      }),
    });
    if (!response.ok) return CLASSIFIER_FALLBACK;
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return parseClassification(payload.choices?.[0]?.message?.content ?? '');
  } catch {
    return CLASSIFIER_FALLBACK;
  }
}
