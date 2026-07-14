import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import type { AskDebug, AskResponse, ContextType } from '@reading-partner/shared';
import { isAskRequest } from '@reading-partner/shared';
import { classifyQuestion } from '../ai/classification.js';
import { generateAnswer } from '../ai/deepseek.js';
import { selectAnswerModel } from '../ai/model-routing.js';
import { rerankDocuments } from '../ai/voyage.js';
import { embedTexts } from '../ai/voyage.js';
import { getRetrievalConfig } from '../ai/retrieval-config.js';
import { shouldUseReranker } from '../ai/rerank.js';
import { filterSpoilerSafe, type ReadingBoundary } from '../ai/spoiler-filter.js';
import { getDb } from '../db/client.js';
import { debugLog, getEnv } from '../env.js';
import { authMiddleware, type AppBindings } from '../middleware/auth.js';
import {
  assertCanAskQuestion,
  getUserPlan,
  recordEmbeddingUsage,
  recordQuestionUsage,
  recordRerankUsage,
} from '../quota/plans.js';
import { jsonError } from '../utils/http.js';

type Candidate = {
  id: string;
  bookId: string;
  bookTitle: string;
  bookNumber: number | null;
  chapterNumber: number | null;
  chapterLabel: string;
  chunkIndex: number;
  content: string;
  endOffset: number | null;
  score: number;
  rerankScore?: number;
};

type PositionRow = {
  context_id: string;
  context_name: string;
  book_title?: string;
  current_book_number: number | null;
  current_chapter: number;
  current_text_offset: number | null;
  progress_source: 'manual' | 'audio_alignment';
};

export const askRoute = new Hono<AppBindings>();

async function loadPosition(userId: string, contextType: ContextType, contextId: string): Promise<PositionRow | null> {
  const db = getDb();
  if (contextType === 'book') {
    const rows = await db.execute(sql`
      select b.id as context_id,
             b.title as context_name,
             b.title as book_title,
             b.book_number as current_book_number,
             coalesce(rp.current_chapter, b.current_chapter, 1) as current_chapter,
             rp.current_text_offset,
             coalesce(rp.progress_source, 'manual') as progress_source
      from books b
      left join reading_progress rp on rp.user_id = b.user_id and rp.book_id = b.id
      where b.user_id = ${userId} and b.id = ${contextId}
      limit 1
    `);
    return (rows[0] as PositionRow | undefined) ?? null;
  }
  const rows = await db.execute(sql`
    select s.id as context_id,
           s.name as context_name,
           null::text as book_title,
           rp.current_book_number,
           coalesce(rp.current_chapter, 1) as current_chapter,
           rp.current_text_offset,
           coalesce(rp.progress_source, 'manual') as progress_source
    from series s
    left join reading_progress rp on rp.user_id = s.user_id and rp.series_id = s.id
    where s.user_id = ${userId} and s.id = ${contextId}
    limit 1
  `);
  return (rows[0] as PositionRow | undefined) ?? null;
}

function sqlSpoilerClause(boundary: ReadingBoundary): ReturnType<typeof sql> {
  if (boundary.contextType === 'book') {
    if (boundary.currentTextOffset == null) {
      return sql`c.chapter_number <= ${boundary.currentChapter}`;
    }
    return sql`(c.chapter_number < ${boundary.currentChapter} or (c.chapter_number = ${boundary.currentChapter} and c.end_offset is not null and c.end_offset <= ${boundary.currentTextOffset}))`;
  }
  if (boundary.currentTextOffset == null) {
    return sql`c.book_number is not null and (c.book_number < ${boundary.currentBookNumber} or (c.book_number = ${boundary.currentBookNumber} and c.chapter_number <= ${boundary.currentChapter}))`;
  }
  return sql`c.book_number is not null and (c.book_number < ${boundary.currentBookNumber} or (c.book_number = ${boundary.currentBookNumber} and (c.chapter_number < ${boundary.currentChapter} or (c.chapter_number = ${boundary.currentChapter} and c.end_offset is not null and c.end_offset <= ${boundary.currentTextOffset}))))`;
}

async function vectorSearch(input: {
  userId: string;
  contextType: ContextType;
  contextId: string;
  boundary: ReadingBoundary;
  embedding: number[];
  limit: number;
}): Promise<Candidate[]> {
  const db = getDb();
  const vectorLiteral = `[${input.embedding.join(',')}]`;
  const contextClause = input.contextType === 'book' ? sql`c.book_id = ${input.contextId}` : sql`c.series_id = ${input.contextId}`;
  const rows = await db.execute(sql`
    select c.id, c.book_id, b.title as book_title, c.book_number, c.chapter_number, c.chapter_label,
           c.chunk_index, c.content, c.end_offset,
           (1 - (c.embedding <=> ${vectorLiteral}::vector))::float as score
    from chunks c
    join books b on b.id = c.book_id and b.user_id = c.user_id
    where c.user_id = ${input.userId}
      and ${contextClause}
      and c.embedding is not null
      and ${sqlSpoilerClause(input.boundary)}
    order by c.embedding <=> ${vectorLiteral}::vector
    limit ${input.limit}
  `);
  return rows as unknown as Candidate[];
}

async function keywordSearch(input: {
  userId: string;
  contextType: ContextType;
  contextId: string;
  boundary: ReadingBoundary;
  question: string;
  terms: string[];
  limit: number;
}): Promise<Candidate[]> {
  const db = getDb();
  const contextClause = input.contextType === 'book' ? sql`c.book_id = ${input.contextId}` : sql`c.series_id = ${input.contextId}`;
  const query = [input.question, ...input.terms].join(' ');
  const rows = await db.execute(sql`
    select c.id, c.book_id, b.title as book_title, c.book_number, c.chapter_number, c.chapter_label,
           c.chunk_index, c.content, c.end_offset,
           (ts_rank_cd(c.search_vector, plainto_tsquery('simple', ${query})) +
            case when c.content ilike ${`%${input.terms[0] ?? input.question.slice(0, 40)}%`} then 0.15 else 0 end)::float as score
    from chunks c
    join books b on b.id = c.book_id and b.user_id = c.user_id
    where c.user_id = ${input.userId}
      and ${contextClause}
      and c.search_vector @@ plainto_tsquery('simple', ${query})
      and ${sqlSpoilerClause(input.boundary)}
    order by score desc
    limit ${input.limit}
  `);
  return rows as unknown as Candidate[];
}

function mergeCandidates(vector: Candidate[], keyword: Candidate[], preferRecent: boolean): Candidate[] {
  const maxVector = Math.max(0.0001, ...vector.map((item) => item.score));
  const maxKeyword = Math.max(0.0001, ...keyword.map((item) => item.score));
  const byId = new Map<string, Candidate>();
  for (const item of vector) byId.set(item.id, { ...item, score: (item.score / maxVector) * 0.65 });
  for (const item of keyword) {
    const current = byId.get(item.id);
    const keywordScore = (item.score / maxKeyword) * 0.35;
    byId.set(item.id, { ...(current ?? item), score: (current?.score ?? 0) + keywordScore });
  }
  const merged = Array.from(byId.values());
  for (const item of merged) {
    if (preferRecent && item.chapterNumber != null) item.score += item.chapterNumber * 0.001;
  }
  return merged.sort((a, b) => b.score - a.score);
}

function diversify(candidates: Candidate[], finalK: number, diversifyByChapter: boolean): Candidate[] {
  if (!diversifyByChapter) return candidates.slice(0, finalK);
  const selected: Candidate[] = [];
  const perChapter = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${candidate.bookNumber ?? 'book'}:${candidate.chapterNumber}`;
    const count = perChapter.get(key) ?? 0;
    if (count >= 2 && selected.length < Math.floor(finalK * 0.8)) continue;
    selected.push(candidate);
    perChapter.set(key, count + 1);
    if (selected.length >= finalK) break;
  }
  return selected;
}

function readingPositionText(position: PositionRow, contextType: ContextType): string {
  const parts = [contextType === 'series' ? `Series: ${position.context_name}` : `Book: ${position.context_name}`];
  if (position.book_title) parts.push(`Current book: ${position.book_title}`);
  if (position.current_book_number) parts.push(`Book number: ${position.current_book_number}`);
  parts.push(`Chapter: ${position.current_chapter}`);
  if (position.current_text_offset != null) parts.push(`Text offset: ${position.current_text_offset}`);
  parts.push(`Progress source: ${position.progress_source}`);
  return parts.join('\n');
}

askRoute.post('/ask', authMiddleware, async (c) => {
  const userId = c.get('userId');
  debugLog('AI', 'ask:start', { userId });
  try {
    const body = await c.req.json();
    if (!isAskRequest(body)) return jsonError(c, 400, 'INVALID_REQUEST', 'Body must include contextType, contextId, and question.');

    debugLog('AI', 'quota check');
    await assertCanAskQuestion(userId);

    const position = await loadPosition(userId, body.contextType, body.contextId);
    if (!position) return jsonError(c, 404, 'CONTEXT_NOT_FOUND', 'Book or series not found.');

    const boundary: ReadingBoundary = {
      contextType: body.contextType,
      currentBookNumber: position.current_book_number,
      currentChapter: position.current_chapter,
      currentTextOffset: position.current_text_offset,
    };

    const classification = await classifyQuestion({
      question: body.question,
      contextType: body.contextType,
      readingPosition: {
        seriesName: body.contextType === 'series' ? position.context_name : undefined,
        bookTitle: body.contextType === 'book' ? position.context_name : position.book_title,
        currentBookNumber: position.current_book_number ?? undefined,
        currentChapter: position.current_chapter,
        currentTextOffset: position.current_text_offset ?? undefined,
        progressSource: position.progress_source,
      },
    });
    debugLog('AI', 'classifier result', classification);

    const config = getRetrievalConfig(classification);
    debugLog('AI', 'retrieval config', config);

    const queryEmbedding = await embedTexts([body.question], 'query');
    await recordEmbeddingUsage(userId, { tokens: queryEmbedding.tokens });
    debugLog('AI', 'query embedding generated');

    const [vectorCandidates, keywordCandidates] = await Promise.all([
      vectorSearch({ userId, contextType: body.contextType, contextId: body.contextId, boundary, embedding: queryEmbedding.embeddings[0] ?? [], limit: config.vectorK }),
      keywordSearch({ userId, contextType: body.contextType, contextId: body.contextId, boundary, question: body.question, terms: classification.searchTerms, limit: config.keywordK }),
    ]);
    debugLog('AI', 'vector candidates', { count: vectorCandidates.length });
    debugLog('AI', 'keyword candidates', { count: keywordCandidates.length });

    const merged = mergeCandidates(vectorCandidates, keywordCandidates, config.preferRecentContext);
    debugLog('AI', 'merged candidates', { count: merged.length });

    const filtered = filterSpoilerSafe(merged, boundary);
    debugLog('AI', 'spoiler filter result', { kept: filtered.safe.length, removed: filtered.removed });

    const rerankDecision = shouldUseReranker({
      classification,
      config,
      candidateCount: filtered.safe.length,
      vectorTopScore: vectorCandidates[0]?.score,
      keywordTopScore: keywordCandidates[0]?.score,
      vectorKeywordDisagree: vectorCandidates[0] && keywordCandidates[0] ? vectorCandidates[0].id !== keywordCandidates[0].id : false,
    });

    let candidates = filtered.safe;
    let rerankUsed = false;
    if (rerankDecision.use) {
      const reranked = await rerankDocuments(body.question, candidates.map((item) => item.content), Math.min(config.finalAnswerK, candidates.length));
      await recordRerankUsage(userId, { tokens: reranked.tokens });
      candidates = reranked.results.map((result) => ({ ...candidates[result.index], rerankScore: result.score, score: result.score })).filter(Boolean);
      rerankUsed = true;
      debugLog('AI', 'rerank result', { count: candidates.length });
    } else {
      debugLog('AI', 'rerank skipped/reason', rerankDecision.reason);
    }

    const finalChunks = filterSpoilerSafe(diversify(candidates, config.finalAnswerK, config.diversifyByChapter), boundary).safe;
    debugLog('AI', 'final chunks selected', { count: finalChunks.length });
    if (finalChunks.length === 0) {
      await recordQuestionUsage(userId);
      return c.json({
        answer: 'There is not enough spoiler-safe context to answer confidently.',
        citations: [],
        confidence: 'low',
        reasonCode: 'NO_SAFE_CONTEXT',
      } satisfies AskResponse);
    }

    const plan = await getUserPlan(userId);
    const model = selectAnswerModel({ plan, classification, lowConfidenceRetrieval: finalChunks.length < 3 });
    debugLog('AI', 'answer model selected', { model });
    const answer = await generateAnswer({
      model,
      question: body.question,
      readingPosition: readingPositionText(position, body.contextType),
      chunks: finalChunks.map((chunk) => ({ bookTitle: chunk.bookTitle, chapterLabel: chunk.chapterLabel, content: chunk.content })),
    });
    debugLog('AI', 'answer generated');
    await recordQuestionUsage(userId, { inputTokens: answer.inputTokens, outputTokens: answer.outputTokens });
    await getDb().execute(sql`
      insert into ai_request_logs (user_id, request_type, model, question_type, rerank_used, vector_candidates, keyword_candidates, final_chunks, success)
      values (${userId}, 'ask', ${model}, ${classification.questionType}, ${rerankUsed}, ${vectorCandidates.length}, ${keywordCandidates.length}, ${finalChunks.length}, true)
    `);
    debugLog('AI', 'usage recorded');

    const debug: AskDebug | undefined = getEnv().aiDebug
      ? {
          classification,
          modelUsed: model,
          rerankUsed,
          vectorCandidates: vectorCandidates.length,
          keywordCandidates: keywordCandidates.length,
          mergedCandidates: merged.length,
          finalChunks: finalChunks.length,
          spoilerFilter: {
            contextType: body.contextType,
            currentBookNumber: boundary.currentBookNumber ?? undefined,
            currentChapter: boundary.currentChapter,
            currentTextOffset: boundary.currentTextOffset ?? undefined,
            unsafeChunksRemoved: filtered.removed,
          },
          selectedChunks: finalChunks.map((chunk) => ({
            bookTitle: chunk.bookTitle,
            chapterLabel: chunk.chapterLabel,
            chunkIndex: chunk.chunkIndex,
            score: chunk.score,
            rerankScore: chunk.rerankScore,
            preview: chunk.content.slice(0, 220),
          })),
        }
      : undefined;

    debugLog('AI', 'ask:done');
    return c.json({ ...answer.response, debug } satisfies AskResponse);
  } catch (error) {
    debugLog('AI', 'ask:error', error instanceof Error ? error.message : error);
    await getDb().execute(sql`insert into ai_request_logs (user_id, request_type, success, error_code) values (${userId}, 'ask', false, 'ASK_ERROR')`).catch(() => undefined);
    return jsonError(c, 502, 'ASK_ERROR', error instanceof Error ? error.message : 'Ask pipeline failed.');
  }
});
