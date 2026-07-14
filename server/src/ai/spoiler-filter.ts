import type { ContextType } from '@reading-partner/shared';

export type SpoilerCandidate = {
  id: string;
  bookNumber: number | null;
  chapterNumber: number | null;
  endOffset: number | null;
};

export type ReadingBoundary = {
  contextType: ContextType;
  currentBookNumber?: number | null;
  currentChapter: number;
  currentTextOffset?: number | null;
};

export function isSpoilerSafe(candidate: SpoilerCandidate, boundary: ReadingBoundary): boolean {
  if (!Number.isInteger(candidate.chapterNumber)) return false;

  if (boundary.contextType === 'book') {
    if (candidate.chapterNumber! < boundary.currentChapter) return true;
    if (candidate.chapterNumber! > boundary.currentChapter) return false;
    if (boundary.currentTextOffset == null) return true;
    return candidate.endOffset != null && candidate.endOffset <= boundary.currentTextOffset;
  }

  if (!Number.isInteger(candidate.bookNumber) || !Number.isInteger(boundary.currentBookNumber)) return false;
  if (candidate.bookNumber! < boundary.currentBookNumber!) return true;
  if (candidate.bookNumber! > boundary.currentBookNumber!) return false;
  if (candidate.chapterNumber! < boundary.currentChapter) return true;
  if (candidate.chapterNumber! > boundary.currentChapter) return false;
  if (boundary.currentTextOffset == null) return true;
  return candidate.endOffset != null && candidate.endOffset <= boundary.currentTextOffset;
}

export function filterSpoilerSafe<T extends SpoilerCandidate>(candidates: T[], boundary: ReadingBoundary): { safe: T[]; removed: number } {
  const safe = candidates.filter((candidate) => isSpoilerSafe(candidate, boundary));
  return { safe, removed: candidates.length - safe.length };
}
