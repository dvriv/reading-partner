import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedChunks } from '../lib/embeddings';
import { ProviderRequestError } from '../lib/provider-error';

describe('embedChunks retry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('retries failed batch and succeeds', async () => {
    let callCount = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      callCount += 1;
      if (callCount < 3) {
        return new Response('{}', { status: 503, statusText: 'Service Unavailable' });
      }
      return new Response(JSON.stringify({ embeddings: [[0.1, 0.2], [0.2, 0.1]] }), { status: 200 });
    }));

    const vectors = await embedChunks(['a', 'b'], 'token', { maxAttempts: 3, baseDelayMs: 0 });
    expect(vectors).toHaveLength(2);
    expect(callCount).toBe(3);
  });

  it('fails after max attempts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500, statusText: 'Internal Error' })));

    await expect(embedChunks(['a'], 'token', { maxAttempts: 2, baseDelayMs: 0 })).rejects.toBeInstanceOf(
      ProviderRequestError
    );
  });
});
