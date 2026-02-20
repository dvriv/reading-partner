import type { BookStatus } from '../types';

interface NumberedSeriesBook {
  id: string;
  bookNumber: number | null;
}

interface NumberValidationResult {
  valid: boolean;
  error: string | null;
  normalized: Array<{ id: string; bookNumber: number }>;
}

export function validateSeriesBookNumbers(books: NumberedSeriesBook[]): NumberValidationResult {
  if (books.length === 0) {
    return { valid: true, error: null, normalized: [] };
  }

  const normalized = books.map((book) => ({
    id: book.id,
    bookNumber: Number(book.bookNumber)
  }));

  if (normalized.some((book) => !Number.isInteger(book.bookNumber) || book.bookNumber < 1)) {
    return {
      valid: false,
      error: 'Book numbers must be whole numbers starting at 1.',
      normalized
    };
  }

  const seen = new Set<number>();
  for (const book of normalized) {
    if (seen.has(book.bookNumber)) {
      return {
        valid: false,
        error: 'Book numbers must be unique within a series.',
        normalized
      };
    }
    seen.add(book.bookNumber);
  }

  const sortedNumbers = Array.from(seen).sort((a, b) => a - b);
  for (let i = 0; i < sortedNumbers.length; i += 1) {
    if (sortedNumbers[i] !== i + 1) {
      return {
        valid: false,
        error: `Series numbering must be contiguous (1-${books.length}).`,
        normalized
      };
    }
  }

  return {
    valid: true,
    error: null,
    normalized
  };
}

interface SeriesProgressBook {
  id: string;
  bookNumber: number;
  status: BookStatus;
  currentChapter: number;
  totalChapters: number;
}

export function recomputeSeriesStatuses(books: SeriesProgressBook[]): Array<{
  id: string;
  status: BookStatus;
  currentChapter: number;
}> {
  const ordered = [...books].sort((a, b) => a.bookNumber - b.bookNumber);
  let unlockedAssigned = false;

  return ordered.map((book) => {
    if (book.status === 'done') {
      return {
        id: book.id,
        status: 'done',
        currentChapter: Math.max(book.currentChapter, book.totalChapters)
      };
    }

    if (!unlockedAssigned) {
      unlockedAssigned = true;
      return {
        id: book.id,
        status: 'reading',
        currentChapter: book.currentChapter
      };
    }

    return {
      id: book.id,
      status: 'locked',
      currentChapter: 0
    };
  });
}
