import { ProviderRequestError } from './provider-error';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

function getMessage(res: Response): string {
  return `Request failed (${res.status} ${res.statusText})`;
}

interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  signal?: AbortSignal;
  shouldCancel?: () => boolean;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function embedChunksWithRetry(
  texts: string[],
  authToken: string,
  options: RetryOptions
): Promise<number[][]> {
  const BATCH_SIZE = 50;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < options.maxAttempts) {
      if (options.signal?.aborted || options.shouldCancel?.()) {
        throw new ProviderRequestError('Upload cancelled.', 'embed_cancelled');
      }

      attempt += 1;
      try {
        const res = await fetch(`${API_BASE}/embed`, {
          method: 'POST',
          signal: options.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`
          },
          body: JSON.stringify({ texts: batch })
        });

        if (!res.ok) {
          throw new ProviderRequestError(`Embedding failed: ${getMessage(res)}`, `embed_http_${res.status}`);
        }

        const data = (await res.json()) as { embeddings?: number[][] };
        if (!data.embeddings || data.embeddings.length !== batch.length) {
          throw new ProviderRequestError('Embedding response missing vectors', 'embed_invalid_response');
        }

        allEmbeddings.push(...data.embeddings);
        lastError = null;
        break;
      } catch (error) {
        if (options.signal?.aborted || options.shouldCancel?.()) {
          throw new ProviderRequestError('Upload cancelled.', 'embed_cancelled');
        }
        lastError =
          error instanceof ProviderRequestError
            ? error
            : new ProviderRequestError('Embedding provider request failed.', 'embed_network_failure');
        if (attempt >= options.maxAttempts) break;
        const delay = options.baseDelayMs * 2 ** (attempt - 1);
        await sleep(delay);
      }
    }

    if (lastError) {
      throw lastError;
    }
  }

  return allEmbeddings;
}

export async function embedChunks(
  texts: string[],
  authToken: string,
  retry?: Partial<RetryOptions>
): Promise<number[][]> {
  return embedChunksWithRetry(texts, authToken, {
    maxAttempts: retry?.maxAttempts ?? 3,
    baseDelayMs: retry?.baseDelayMs ?? 500,
  });
}

export async function embedQuery(query: string, authToken: string): Promise<number[]> {
  const vectors = await embedChunks([query], authToken);
  if (!vectors[0]) throw new ProviderRequestError('Query embedding not returned', 'embed_missing_query_vector');
  return vectors[0];
}
