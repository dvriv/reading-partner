import { describe, expect, it } from 'vitest';
import { CLASSIFIER_FALLBACK } from '../ai/classification.js';
import { selectAnswerModel } from '../ai/model-routing.js';
import { shouldUseReranker } from '../ai/rerank.js';
import { getRetrievalConfig } from '../ai/retrieval-config.js';
import { filterSpoilerSafe, isSpoilerSafe } from '../ai/spoiler-filter.js';
import { alignTranscriptToChapter, shouldSaveAlignmentOffset } from '../audio/alignment.js';
import { validateAudioFileName, validateEbookFileName } from '../files/file-types.js';
import { getPlanLimits } from '../quota/plans.js';

const fixture = [
  { id: 'safe', bookNumber: 1, chapterNumber: 1, endOffset: 3000 },
  { id: 'future-chapter', bookNumber: 1, chapterNumber: 2, endOffset: 6000 },
  { id: 'future-book', bookNumber: 2, chapterNumber: 1, endOffset: 1000 },
];

describe('spoiler filtering', () => {
  it('excludes future chapters and future books for series context', () => {
    const result = filterSpoilerSafe(fixture, { contextType: 'series', currentBookNumber: 1, currentChapter: 1 });
    expect(result.safe.map((item) => item.id)).toEqual(['safe']);
    expect(result.removed).toBe(2);
  });

  it('excludes chunks after current offset', () => {
    expect(isSpoilerSafe({ id: 'before', bookNumber: 1, chapterNumber: 1, endOffset: 4500 }, { contextType: 'book', currentChapter: 1, currentTextOffset: 4500 })).toBe(true);
    expect(isSpoilerSafe({ id: 'after', bookNumber: 1, chapterNumber: 1, endOffset: 4501 }, { contextType: 'book', currentChapter: 1, currentTextOffset: 4500 })).toBe(false);
    expect(isSpoilerSafe({ id: 'unknown-offset', bookNumber: 1, chapterNumber: 1, endOffset: null }, { contextType: 'book', currentChapter: 1, currentTextOffset: 4500 })).toBe(false);
  });
});

describe('classifier fallback and retrieval config', () => {
  it('uses ambiguous fallback shape', () => {
    expect(CLASSIFIER_FALLBACK).toMatchObject({ questionType: 'ambiguous', needsReranker: true, needsStrongAnswerModel: true });
  });

  it('selects broad retrieval config', () => {
    const config = getRetrievalConfig({ ...CLASSIFIER_FALLBACK, questionType: 'broad_summary' });
    expect(config.vectorK).toBe(80);
    expect(config.useReranker).toBe(true);
  });
});

describe('rerank and model routing', () => {
  it('skips reranker for simple entity lookup', () => {
    const classification = { ...CLASSIFIER_FALLBACK, questionType: 'entity_lookup' as const, needsReranker: false, needsStrongAnswerModel: false };
    const decision = shouldUseReranker({ classification, config: getRetrievalConfig(classification), candidateCount: 20, vectorTopScore: 0.9 });
    expect(decision.use).toBe(false);
  });

  it('uses strong model for paid ambiguous questions but flash for free', () => {
    expect(selectAnswerModel({ plan: 'free', classification: CLASSIFIER_FALLBACK, lowConfidenceRetrieval: true })).toContain('flash');
    expect(selectAnswerModel({ plan: 'paid', classification: CLASSIFIER_FALLBACK, lowConfidenceRetrieval: true })).toContain('pro');
  });
});

describe('quota logic', () => {
  it('keeps high token guardrails and disables free audio alignment by default', () => {
    const free = getPlanLimits('free');
    expect(free.maxBookTokens).toBeGreaterThanOrEqual(5_000_000);
    expect(free.audioAlignmentEnabled).toBe(false);
    const paid = getPlanLimits('paid');
    expect(paid.audioAlignmentEnabled).toBe(true);
  });
});

describe('audio alignment confidence handling', () => {
  it('saves high-confidence offset and filters later chunks', () => {
    const chapter = 'The old road bent under the hill. A silver lantern waited near the gate. The rider stopped and listened. '.repeat(20);
    const transcript = 'A silver lantern waited near the gate. The rider stopped and listened.';
    const result = alignTranscriptToChapter({ transcriptText: transcript, chapterText: chapter, chapterStartOffset: 4000 });
    expect(result.confidence).toBeGreaterThanOrEqual(0.85);
    expect(shouldSaveAlignmentOffset(result)).toBe(true);
    const afterOffset = (result.textEndOffset ?? 0) + 1;
    expect(isSpoilerSafe({ id: 'future', bookNumber: 1, chapterNumber: 1, endOffset: afterOffset }, { contextType: 'book', currentChapter: 1, currentTextOffset: result.textEndOffset })).toBe(false);
  });

  it('does not save low-confidence offset', () => {
    const result = alignTranscriptToChapter({ transcriptText: 'completely unrelated words from nowhere', chapterText: 'The actual chapter text has no meaningful overlap.' });
    expect(result.confidence).toBeLessThan(0.85);
    expect(shouldSaveAlignmentOffset(result)).toBe(false);
  });
});

describe('unsupported DRM file rejection', () => {
  it('rejects likely DRM-protected files', () => {
    expect(validateEbookFileName('book.azw3').ok).toBe(false);
    expect(validateAudioFileName('book.aax').ok).toBe(false);
    expect(validateEbookFileName('book.epub').ok).toBe(true);
    expect(validateAudioFileName('book.m4b').ok).toBe(true);
  });
});
