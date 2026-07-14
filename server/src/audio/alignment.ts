export type AlignmentResult = {
  confidence: number;
  textStartOffset?: number;
  textEndOffset?: number;
  matchedTextPreview?: string;
};

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  return normalize(text).split(' ').filter((word) => word.length > 2);
}

function scoreWindow(transcriptWords: string[], windowWords: string[]): number {
  if (transcriptWords.length === 0 || windowWords.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const word of windowWords) counts.set(word, (counts.get(word) ?? 0) + 1);
  let hits = 0;
  for (const word of transcriptWords) {
    const count = counts.get(word) ?? 0;
    if (count > 0) {
      hits += 1;
      counts.set(word, count - 1);
    }
  }
  return hits / transcriptWords.length;
}

export function alignTranscriptToChapter(input: { transcriptText: string; chapterText: string; chapterStartOffset?: number }): AlignmentResult {
  const transcriptWords = words(input.transcriptText).slice(0, 160);
  const chapterWords = words(input.chapterText);
  if (transcriptWords.length < 8 || chapterWords.length < 8) return { confidence: 0 };
  const windowSize = Math.max(transcriptWords.length, 40);
  let best = { score: 0, index: 0 };
  for (let index = 0; index < chapterWords.length; index += Math.max(5, Math.floor(windowSize / 4))) {
    const score = scoreWindow(transcriptWords, chapterWords.slice(index, index + windowSize));
    if (score > best.score) best = { score, index };
  }
  const normalizedChapter = normalize(input.chapterText);
  const prefixWords = chapterWords.slice(0, best.index).join(' ');
  const approximateNormalizedOffset = prefixWords.length;
  const ratio = normalizedChapter.length > 0 ? approximateNormalizedOffset / normalizedChapter.length : 0;
  const rawStart = Math.floor(input.chapterText.length * ratio);
  const rawEnd = Math.min(input.chapterText.length, rawStart + Math.max(120, input.transcriptText.length));
  const base = input.chapterStartOffset ?? 0;
  return {
    confidence: Math.min(1, Number(best.score.toFixed(3))),
    textStartOffset: base + rawStart,
    textEndOffset: base + rawEnd,
    matchedTextPreview: input.chapterText.slice(rawStart, rawEnd).replace(/\s+/g, ' ').trim().slice(0, 280),
  };
}

export function shouldSaveAlignmentOffset(result: AlignmentResult): boolean {
  return result.confidence >= 0.85 && result.textEndOffset != null;
}
