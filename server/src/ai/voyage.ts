import { getEnv } from '../env.js';

type VoyageEmbeddingResponse = { data?: Array<{ embedding: number[] }>; usage?: { total_tokens?: number } };
type VoyageRerankResponse = { data?: Array<{ index: number; relevance_score: number }>; usage?: { total_tokens?: number } };

export async function embedTexts(texts: string[], inputType: 'document' | 'query'): Promise<{ embeddings: number[][]; tokens: number }> {
  const env = getEnv();
  if (!env.voyageApiKey) throw new Error('Missing VOYAGE_API_KEY');
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.voyageApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts, model: env.voyageEmbeddingModel, input_type: inputType }),
  });
  if (!response.ok) throw new Error(`Voyage embeddings failed: ${response.status} ${await response.text()}`);
  const payload = (await response.json()) as VoyageEmbeddingResponse;
  return { embeddings: payload.data?.map((item) => item.embedding) ?? [], tokens: payload.usage?.total_tokens ?? 0 };
}

export async function rerankDocuments(query: string, documents: string[], topK: number): Promise<{ results: Array<{ index: number; score: number }>; tokens: number }> {
  const env = getEnv();
  if (!env.voyageApiKey) throw new Error('Missing VOYAGE_API_KEY');
  const response = await fetch('https://api.voyageai.com/v1/rerank', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.voyageApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, documents, model: env.voyageRerankModel, top_k: topK }),
  });
  if (!response.ok) throw new Error(`Voyage rerank failed: ${response.status} ${await response.text()}`);
  const payload = (await response.json()) as VoyageRerankResponse;
  return {
    results: payload.data?.map((item) => ({ index: item.index, score: item.relevance_score })) ?? [],
    tokens: payload.usage?.total_tokens ?? 0,
  };
}
