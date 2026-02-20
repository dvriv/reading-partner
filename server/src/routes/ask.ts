import { Hono, type Context } from 'hono';
import { authMiddleware, type AppBindings } from '../middleware/auth.js';

type AskChunk = {
  content: string;
  bookTitle: string;
  chapterNumber: number;
};

type AskRequest = {
  seriesName?: string;
  bookTitle: string;
  currentChapter: number;
  completedBooks?: string[];
  question: string;
  chunks: AskChunk[];
};

type AskResponse = {
  answer: string;
  citations: { bookTitle: string; chapterNumber: number; excerpt: string }[];
  confidence: 'high' | 'medium' | 'low';
};

type OpenRouterChatResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

class ProviderHttpError extends Error {
  status: number;
  body: string;
  retryAfter: string | null;
  requestId: string | null;

  constructor(status: number, body: string, retryAfter: string | null, requestId: string | null) {
    super(`OpenRouter chat error (${status}): ${body || 'No response body'}`);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.body = body;
    this.retryAfter = retryAfter;
    this.requestId = requestId;
  }
}

const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const DEFAULT_OPENROUTER_CHAT_MODEL = 'openai/gpt-oss-120b:free';

function getOpenRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('Missing required environment variable: OPENROUTER_API_KEY');
  }

  return {
    apiKey,
    baseUrl: process.env.OPENROUTER_BASE_URL || DEFAULT_OPENROUTER_BASE_URL,
    model: process.env.OPENROUTER_CHAT_MODEL || DEFAULT_OPENROUTER_CHAT_MODEL,
  };
}

const MAX_CHUNKS = 20;
const MAX_TEXT_LENGTH = 10_000;
const MAX_QUESTION_LENGTH = 2_000;

const askRoute = new Hono<AppBindings>();

function invalidRequest(c: Context, message: string) {
  return c.json(
    {
      error: {
        code: 'INVALID_REQUEST',
        message,
      },
    },
    400,
  );
}

function normalizeAskResponse(raw: string): AskResponse {
  const fallbackText =
    "Based on what you've read so far, I don't have enough information to fully answer this.";
  const trimmed = raw.trim();

  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const unfenced = fencedMatch ? fencedMatch[1].trim() : trimmed;

  const jsonObjectMatch = unfenced.match(/\{[\s\S]*\}/);
  const jsonCandidate = jsonObjectMatch ? jsonObjectMatch[0].trim() : unfenced;

  try {
    const parsed = JSON.parse(jsonCandidate || '{}') as Partial<AskResponse>;
    const answer = typeof parsed.answer === 'string' && parsed.answer.trim() ? parsed.answer.trim() : trimmed;
    const confidence =
      parsed.confidence === 'high' || parsed.confidence === 'medium' || parsed.confidence === 'low'
        ? parsed.confidence
        : 'low';

    const citations = Array.isArray(parsed.citations)
      ? parsed.citations
          .filter((citation): citation is { bookTitle: string; chapterNumber: number; excerpt: string } => {
            return (
              !!citation &&
              typeof citation === 'object' &&
              typeof (citation as { bookTitle?: unknown }).bookTitle === 'string' &&
              Number.isInteger((citation as { chapterNumber?: unknown }).chapterNumber) &&
              typeof (citation as { excerpt?: unknown }).excerpt === 'string'
            );
          })
          .map((citation) => ({
            bookTitle: citation.bookTitle.trim(),
            chapterNumber: citation.chapterNumber,
            excerpt: citation.excerpt.trim(),
          }))
      : [];

    return {
      answer: answer || fallbackText,
      citations,
      confidence,
    };
  } catch {
    console.warn('[provider][ask] Non-JSON model output; using text fallback', {
      preview: trimmed.slice(0, 240),
    });
    return {
      answer: trimmed || fallbackText,
      citations: [],
      confidence: 'low',
    };
  }
}

function normalizeAskRequest(input: AskRequest): AskRequest {
  if (!input || typeof input !== 'object') {
    throw new TypeError('Body must be a JSON object.');
  }

  if (typeof input.bookTitle !== 'string' || !input.bookTitle.trim()) {
    throw new TypeError('"bookTitle" is required and must be a non-empty string.');
  }

  if (!Number.isInteger(input.currentChapter) || input.currentChapter < 0) {
    throw new TypeError('"currentChapter" must be an integer >= 0.');
  }

  if (typeof input.question !== 'string' || !input.question.trim()) {
    throw new TypeError('"question" is required and must be a non-empty string.');
  }

  if (input.question.trim().length > MAX_QUESTION_LENGTH) {
    throw new TypeError(`"question" exceeds max length of ${MAX_QUESTION_LENGTH} characters.`);
  }

  if (!Array.isArray(input.chunks) || input.chunks.length === 0) {
    throw new TypeError('"chunks" must be a non-empty array.');
  }

  if (input.chunks.length > MAX_CHUNKS) {
    throw new TypeError(`"chunks" cannot contain more than ${MAX_CHUNKS} items.`);
  }

  if (input.seriesName !== undefined && (typeof input.seriesName !== 'string' || !input.seriesName.trim())) {
    throw new TypeError('"seriesName" must be a non-empty string when provided.');
  }

  if (input.completedBooks !== undefined) {
    if (!Array.isArray(input.completedBooks)) {
      throw new TypeError('"completedBooks" must be an array of non-empty strings when provided.');
    }

    for (let i = 0; i < input.completedBooks.length; i += 1) {
      const title = input.completedBooks[i];
      if (typeof title !== 'string' || !title.trim()) {
        throw new TypeError(`Item at completedBooks[${i}] must be a non-empty string.`);
      }
    }
  }

  for (let i = 0; i < input.chunks.length; i += 1) {
    const chunk = input.chunks[i];

    if (!chunk || typeof chunk !== 'object') {
      throw new TypeError(`Item at chunks[${i}] must be an object.`);
    }

    if (typeof chunk.content !== 'string' || !chunk.content.trim()) {
      throw new TypeError(`"content" at chunks[${i}] must be a non-empty string.`);
    }

    if (chunk.content.length > MAX_TEXT_LENGTH) {
      throw new TypeError(
        `"content" at chunks[${i}] exceeds max length of ${MAX_TEXT_LENGTH} characters.`,
      );
    }

    if (typeof chunk.bookTitle !== 'string' || !chunk.bookTitle.trim()) {
      throw new TypeError(`"bookTitle" at chunks[${i}] must be a non-empty string.`);
    }

    if (!Number.isInteger(chunk.chapterNumber) || chunk.chapterNumber < 1) {
      throw new TypeError(`"chapterNumber" at chunks[${i}] must be an integer >= 1.`);
    }
  }

  return {
    seriesName: input.seriesName?.trim(),
    bookTitle: input.bookTitle.trim(),
    currentChapter: input.currentChapter,
    completedBooks: input.completedBooks?.map((title) => title.trim()),
    question: input.question.trim(),
    chunks: input.chunks.map((chunk) => ({
      content: chunk.content.trim(),
      bookTitle: chunk.bookTitle.trim(),
      chapterNumber: chunk.chapterNumber,
    })),
  };
}

askRoute.post('/ask', authMiddleware, async (c) => {
  let rawBody: AskRequest;

  try {
    rawBody = await c.req.json<AskRequest>();
  } catch {
    return c.json(
      {
        error: {
          code: 'INVALID_JSON',
          message: 'Request body must be valid JSON.',
        },
      },
      400,
    );
  }

  let body: AskRequest;
  try {
    body = normalizeAskRequest(rawBody);
  } catch (error) {
    if (error instanceof TypeError) {
      return invalidRequest(c, error.message);
    }
    throw error;
  }

  const { seriesName, bookTitle, currentChapter, completedBooks, question, chunks } = body;

  const excerpts = chunks
    .map(
      (chunk, index) =>
        `[Excerpt ${index + 1}, ${chunk.bookTitle}, Chapter ${chunk.chapterNumber}]:\n${chunk.content}`,
    )
    .join('\n\n---\n\n');

  const progressDescription =
    seriesName && completedBooks && completedBooks.length > 0
      ? `The reader is reading the series "${seriesName}". They have completed: ${completedBooks.join(', ')}. They are currently reading "${bookTitle}" and have read up to Chapter ${currentChapter}.`
      : seriesName
        ? `The reader is reading the series "${seriesName}". They are currently on the first available book "${bookTitle}" and have read up to Chapter ${currentChapter}.`
        : `The reader is reading "${bookTitle}" and has read up to Chapter ${currentChapter}.`;

  const systemPrompt = `You are a spoiler-free reading companion. ${progressDescription}

CRITICAL RULES - violating any of these is unacceptable:
1. ONLY use the provided excerpts to answer. Do NOT use any knowledge from your training data about this book, series, or any other book.
2. Every factual claim you make MUST be supported by at least one of the provided excerpts.
3. Cite your sources using [Book Title, Chapter X] format inline. If all excerpts are from the same book, you may shorten to [Chapter X].
4. If the excerpts do not contain enough information to fully answer the question, clearly state: "Based on what you've read so far, I don't have enough information to fully answer this."
5. NEVER hint at, speculate about, or reference events, character developments, or plot points from chapters or books the reader has not yet reached.
6. NEVER use phrases like "you'll find out later", "keep reading", or "this becomes important".
7. Do NOT use any external knowledge about the book, its author, its series, or its fandom.
8. Keep your answer concise (2-5 sentences for simple questions, up to a short paragraph for recaps).
9. Return ONLY a valid JSON object. Do not use markdown code fences. Do not add any text before or after the JSON object.

Respond in this JSON format:
{
  "answer": "Your answer with [Book Title, Chapter X] citations inline",
  "citations": [
    {"bookTitle": "The Way of Kings", "chapterNumber": 5, "excerpt": "brief relevant quote from the excerpt"}
  ],
  "confidence": "high | medium | low"
}

Set confidence to:
- "high" if multiple excerpts clearly support the answer
- "medium" if 1-2 excerpts partially support it
- "low" if the excerpts barely address the question`;

  try {
    const openRouter = getOpenRouterConfig();
    const response = await fetch(`${openRouter.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openRouter.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: openRouter.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: `EXCERPTS:\n\n${excerpts}\n\nQUESTION: ${question}`,
          },
        ],
        temperature: 0.3,
        response_format: {
          type: 'json_object',
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ProviderHttpError(
        response.status,
        body || response.statusText,
        response.headers.get('retry-after'),
        response.headers.get('x-request-id') || response.headers.get('x-client-trace-id'),
      );
    }

    const payload = (await response.json()) as OpenRouterChatResponse;
    const responseText = payload.choices?.[0]?.message?.content ?? '';

    const raw = responseText.trim();
    const normalized = normalizeAskResponse(raw);
    return c.json(normalized satisfies AskResponse);
  } catch (error) {
    if (error instanceof ProviderHttpError) {
      console.error('[provider][ask] OpenRouter request failed', {
        status: error.status,
        retryAfter: error.retryAfter,
        requestId: error.requestId,
        body: error.body.slice(0, 2000),
      });
    } else {
      console.error('[provider][ask] Unexpected error', error);
    }

    const message = error instanceof Error ? error.message : 'Unknown chat provider error';

    return c.json(
      {
        error: {
          code: 'CHAT_PROVIDER_ERROR',
          message,
        },
      },
      502,
    );
  }
});

export { askRoute };
