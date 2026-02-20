import { InferenceClient } from '@huggingface/inference';
import { Hono } from 'hono';
import { authMiddleware, type AppBindings } from '../middleware/auth.js';

type EmbedRequest = {
  texts: string[];
};

const BATCH_SIZE = 100;
const MAX_TEXTS = 500;
const MAX_TEXT_LENGTH = 20_000;

const DEFAULT_HF_EMBED_MODEL = 'Qwen/Qwen3-Embedding-0.6B';
const DEFAULT_HF_PROVIDER = 'hf-inference';

class ProviderHttpError extends Error {
  status: number | null;
  body: string;

  constructor(status: number | null, body: string) {
    super(`Hugging Face embeddings error${status ? ` (${status})` : ''}: ${body || 'No response body'}`);
    this.name = 'ProviderHttpError';
    this.status = status;
    this.body = body;
  }
}

function parseEnvInt(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < min) return fallback;
  return parsed;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

type TokenWindowEvent = {
  timestamp: number;
  tokens: number;
};

const tokenWindowEvents: TokenWindowEvent[] = [];
const TOKEN_WINDOW_MS = 60_000;

function pruneTokenEvents(now: number): void {
  while (tokenWindowEvents.length > 0 && now - tokenWindowEvents[0].timestamp >= TOKEN_WINDOW_MS) {
    tokenWindowEvents.shift();
  }
}

function usedTokensInWindow(now: number): number {
  pruneTokenEvents(now);
  return tokenWindowEvents.reduce((total, event) => total + event.tokens, 0);
}

async function waitForTokenBudget(batchTokenEstimate: number, maxTokensPerMinute: number): Promise<void> {
  if (maxTokensPerMinute <= 0) return;

  while (true) {
    const now = Date.now();
    const used = usedTokensInWindow(now);
    if (used + batchTokenEstimate <= maxTokensPerMinute) {
      return;
    }

    const oldest = tokenWindowEvents[0];
    const waitMs = oldest ? Math.max(50, TOKEN_WINDOW_MS - (now - oldest.timestamp) + 25) : 1000;
    console.warn('[provider][embed] Waiting for token budget window', {
      used,
      incoming: batchTokenEstimate,
      maxTokensPerMinute,
      waitMs,
    });
    await sleep(waitMs);
  }
}

function recordTokenUsage(batchTokenEstimate: number): void {
  tokenWindowEvents.push({
    timestamp: Date.now(),
    tokens: batchTokenEstimate,
  });
}

let activeEmbedRequests = 0;
const embedWaitQueue: Array<() => void> = [];

async function acquireEmbedSlot(maxConcurrency: number): Promise<void> {
  while (activeEmbedRequests >= maxConcurrency) {
    await new Promise<void>((resolve) => embedWaitQueue.push(resolve));
  }
  activeEmbedRequests += 1;
}

function releaseEmbedSlot(): void {
  activeEmbedRequests = Math.max(0, activeEmbedRequests - 1);
  const next = embedWaitQueue.shift();
  if (next) next();
}

function getErrorStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status = (error as { status?: unknown }).status;
  if (typeof status === 'number') return status;

  const statusCode = (error as { statusCode?: unknown }).statusCode;
  if (typeof statusCode === 'number') return statusCode;

  return null;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown provider error';
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'number' && Number.isFinite(item));
}

function isNumberMatrix(value: unknown): value is number[][] {
  return Array.isArray(value) && value.length > 0 && value.every((row) => isNumberArray(row));
}

function meanPool(matrix: number[][]): number[] {
  const dim = matrix[0]?.length ?? 0;
  if (dim === 0) {
    throw new Error('Invalid embedding matrix: empty row.');
  }

  const sums = new Array<number>(dim).fill(0);
  for (const row of matrix) {
    if (row.length !== dim) {
      throw new Error('Invalid embedding matrix: inconsistent dimensions.');
    }
    for (let i = 0; i < dim; i += 1) {
      sums[i] += row[i];
    }
  }

  return sums.map((sum) => sum / matrix.length);
}

function normalizeSingleEmbedding(value: unknown): number[] {
  if (isNumberArray(value)) {
    return value;
  }

  if (isNumberMatrix(value)) {
    return meanPool(value);
  }

  throw new Error('Embedding response has unsupported shape.');
}

function normalizeBatchEmbeddings(raw: unknown, batchSize: number): number[][] {
  if (batchSize === 1) {
    if (Array.isArray(raw) && raw.length === 1) {
      return [normalizeSingleEmbedding(raw[0])];
    }
    return [normalizeSingleEmbedding(raw)];
  }

  if (!Array.isArray(raw) || raw.length !== batchSize) {
    throw new Error(`Embedding response size mismatch: expected ${batchSize} vectors.`);
  }

  return raw.map((item) => normalizeSingleEmbedding(item));
}

type HfConfig = {
  client: InferenceClient;
  model: string;
  provider: NonNullable<Parameters<InferenceClient['featureExtraction']>[0]['provider']>;
};

function getHfConfig(): HfConfig {
  const apiKey = process.env.HF_API_KEY;
  if (!apiKey) {
    throw new Error('Missing required environment variable: HF_API_KEY');
  }

  return {
    client: new InferenceClient(apiKey),
    model: process.env.HF_EMBED_MODEL || DEFAULT_HF_EMBED_MODEL,
    provider: (process.env.HF_PROVIDER || DEFAULT_HF_PROVIDER) as NonNullable<
      Parameters<InferenceClient['featureExtraction']>[0]['provider']
    >,
  };
}

const embedRoute = new Hono<AppBindings>();

embedRoute.post('/embed', authMiddleware, async (c) => {
  let body: EmbedRequest;

  try {
    body = await c.req.json<EmbedRequest>();
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

  if (!body || !Array.isArray(body.texts)) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: 'Body must include a "texts" array of strings.',
        },
      },
      400,
    );
  }

  if (body.texts.length === 0) {
    return c.json(
      {
        error: {
          code: 'INVALID_REQUEST',
          message: '"texts" cannot be empty.',
        },
      },
      400,
    );
  }

  if (body.texts.length > MAX_TEXTS) {
    return c.json(
      {
        error: {
          code: 'REQUEST_TOO_LARGE',
          message: `"texts" cannot contain more than ${MAX_TEXTS} items per request.`,
        },
      },
      413,
    );
  }

  let normalizedTexts: string[];

  try {
    normalizedTexts = body.texts.map((value, index) => {
      if (typeof value !== 'string') {
        throw new TypeError(`Item at texts[${index}] must be a string.`);
      }

      const trimmed = value.trim();

      if (!trimmed) {
        throw new TypeError(`Item at texts[${index}] cannot be empty.`);
      }

      if (trimmed.length > MAX_TEXT_LENGTH) {
        throw new TypeError(
          `Item at texts[${index}] exceeds max length of ${MAX_TEXT_LENGTH} characters.`,
        );
      }

      return trimmed;
    });
  } catch (error) {
    if (error instanceof TypeError) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: error.message,
          },
        },
        400,
      );
    }

    throw error;
  }

  try {
    const hf = getHfConfig();
    const allEmbeddings: number[][] = [];
    const embedBatchSize = parseEnvInt('EMBED_BATCH_SIZE', BATCH_SIZE, 1);
    const requestDelayMs = parseEnvInt('EMBED_REQUEST_DELAY_MS', 0, 0);
    const maxRetries = parseEnvInt('EMBED_RETRY_MAX_ATTEMPTS', 4, 0);
    const retryBaseDelayMs = parseEnvInt('EMBED_RETRY_BASE_DELAY_MS', 1000, 100);
    const maxTokensPerMinute = parseEnvInt('EMBED_MAX_TOKENS_PER_MINUTE', 0, 0);
    const maxConcurrency = parseEnvInt('EMBED_MAX_CONCURRENCY', 1, 1);

    await acquireEmbedSlot(maxConcurrency);

    try {
      for (let i = 0; i < normalizedTexts.length; i += embedBatchSize) {
        const batch = normalizedTexts.slice(i, i + embedBatchSize);
        const batchTokenEstimate = batch.reduce((sum, text) => sum + estimateTokens(text), 0);

        await waitForTokenBudget(batchTokenEstimate, maxTokensPerMinute);

        let output: unknown = null;
        let lastStatus: number | null = null;
        let lastErrorMessage = '';

        for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
          try {
            output = await hf.client.featureExtraction({
              model: hf.model,
              provider: hf.provider,
              inputs: batch.length === 1 ? batch[0] : batch,
            });
            break;
          } catch (error) {
            lastStatus = getErrorStatus(error);
            lastErrorMessage = getErrorMessage(error);

            if (lastStatus !== 429 || attempt === maxRetries) {
              break;
            }

            const waitMs = Math.max(retryBaseDelayMs, retryBaseDelayMs * 2 ** attempt);
            console.warn('[provider][embed] Rate limited by Hugging Face; retrying', {
              attempt: attempt + 1,
              maxRetries,
              waitMs,
              status: lastStatus,
            });
            await sleep(waitMs);
          }
        }

        if (output === null) {
          throw new ProviderHttpError(lastStatus, lastErrorMessage || 'No response payload');
        }

        const vectors = normalizeBatchEmbeddings(output, batch.length);
        allEmbeddings.push(...vectors);
        recordTokenUsage(batchTokenEstimate);

        if (requestDelayMs > 0 && i + embedBatchSize < normalizedTexts.length) {
          await sleep(requestDelayMs);
        }
      }
    } finally {
      releaseEmbedSlot();
    }

    return c.json({ embeddings: allEmbeddings });
  } catch (error) {
    if (error instanceof TypeError) {
      return c.json(
        {
          error: {
            code: 'INVALID_REQUEST',
            message: error.message,
          },
        },
        400,
      );
    }

    if (error instanceof ProviderHttpError) {
      console.error('[provider][embed] Hugging Face request failed', {
        status: error.status,
        body: error.body.slice(0, 2000),
      });
    } else {
      console.error('[provider][embed] Unexpected error', error);
    }

    const message = error instanceof Error ? error.message : 'Unknown embedding provider error';
    return c.json(
      {
        error: {
          code: 'EMBEDDING_PROVIDER_ERROR',
          message,
        },
      },
      502,
    );
  }
});

export { embedRoute };
