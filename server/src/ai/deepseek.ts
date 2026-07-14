import type { AskResponse } from '@reading-partner/shared';
import { getEnv } from '../env.js';

export type AnswerChunk = {
  bookTitle: string;
  chapterLabel: string;
  content: string;
};

function normalizeAnswer(raw: string): AskResponse {
  const fallback: AskResponse = {
    answer: raw.trim() || 'There is not enough spoiler-safe context to answer confidently.',
    citations: [],
    confidence: 'low',
  };
  try {
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw) as Partial<AskResponse>;
    return {
      answer: typeof parsed.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : fallback.answer,
      citations: Array.isArray(parsed.citations)
        ? parsed.citations
            .filter((item): item is { bookTitle: string; chapterLabel: string; excerpt: string } => {
              const draft = item as Partial<{ bookTitle: string; chapterLabel: string; excerpt: string }>;
              return typeof draft.bookTitle === 'string' && typeof draft.chapterLabel === 'string' && typeof draft.excerpt === 'string';
            })
            .slice(0, 5)
        : [],
      confidence: parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low' ? parsed.confidence : 'low',
      reasonCode: typeof parsed.reasonCode === 'string' ? parsed.reasonCode : undefined,
    };
  } catch {
    return fallback;
  }
}

export async function generateAnswer(input: {
  model: string;
  question: string;
  readingPosition: string;
  chunks: AnswerChunk[];
}): Promise<{ response: AskResponse; inputTokens: number; outputTokens: number }> {
  const env = getEnv();
  if (!env.deepseekApiKey) throw new Error('Missing DEEPSEEK_API_KEY');
  const context = input.chunks
    .map((chunk, index) => `[${index + 1}] ${chunk.bookTitle}, ${chunk.chapterLabel}\n${chunk.content}`)
    .join('\n\n---\n\n');
  const system = `You are SpoilerFree, a spoiler-safe reading assistant.

The user has read only up to:
${input.readingPosition}

You must answer using only the provided spoiler-safe context.

Do not use outside knowledge of the book, series, author, adaptations, internet, or future events.
Do not infer future twists.
Do not mention that something becomes important later.
Do not hint at future reveals.

If the provided context is insufficient, say that there is not enough spoiler-safe context to answer confidently.
If the question asks for information beyond the user's progress, refuse briefly and explain that answering would risk spoilers.

Some chunks may be irrelevant. Use only chunks that directly support the answer.

When possible, cite friendly source labels like book/chapter, but do not expose internal ids.

Return strict JSON: {"answer": string, "citations": [{"bookTitle": string, "chapterLabel": string, "excerpt": string}], "confidence": "high" | "medium" | "low", "reasonCode"?: string}`;

  const response = await fetch(`${env.deepseekBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.deepseekApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: input.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: `QUESTION: ${input.question}\n\nSPOILER-SAFE CONTEXT:\n${context}` },
      ],
    }),
  });
  if (!response.ok) throw new Error(`DeepSeek answer failed: ${response.status} ${await response.text()}`);
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  return {
    response: normalizeAnswer(payload.choices?.[0]?.message?.content ?? ''),
    inputTokens: payload.usage?.prompt_tokens ?? 0,
    outputTokens: payload.usage?.completion_tokens ?? 0,
  };
}
