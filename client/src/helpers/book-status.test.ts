import { describe, expect, it } from 'vitest';
import { buildAllowedBooks, buildAllowedBooksStandalone, computeMarkAsFinished } from '../lib/book-status';

describe('buildAllowedBooks', () => {
  it('done books get Infinity', () => {
    const allowed = buildAllowedBooks([{ id: 'b1', status: 'done', currentChapter: 20 }]);
    expect(allowed.get('b1')).toBe(Infinity);
  });

  it('reading books get current chapter', () => {
    const allowed = buildAllowedBooks([{ id: 'b1', status: 'reading', currentChapter: 7 }]);
    expect(allowed.get('b1')).toBe(7);
  });

  it('locked books are excluded', () => {
    const allowed = buildAllowedBooks([
      { id: 'b1', status: 'done', currentChapter: 10 },
      { id: 'b2', status: 'reading', currentChapter: 3 },
      { id: 'b3', status: 'locked', currentChapter: 0 }
    ]);
    expect(allowed.has('b3')).toBe(false);
  });
});

describe('buildAllowedBooksStandalone', () => {
  it('creates single entry map', () => {
    const allowed = buildAllowedBooksStandalone('book-1', 12);
    expect(allowed.size).toBe(1);
    expect(allowed.get('book-1')).toBe(12);
  });
});

describe('computeMarkAsFinished', () => {
  it('marks current done and unlocks next', () => {
    const changes = computeMarkAsFinished({
      bookId: 'b2',
      seriesBookOrder: ['b1', 'b2', 'b3'],
      books: [
        { id: 'b1', status: 'done' },
        { id: 'b2', status: 'reading' },
        { id: 'b3', status: 'locked' }
      ]
    });

    expect(changes).toEqual([
      { bookId: 'b2', newStatus: 'done' },
      { bookId: 'b3', newStatus: 'reading' }
    ]);
  });

  it('last book only marks itself done', () => {
    const changes = computeMarkAsFinished({
      bookId: 'b3',
      seriesBookOrder: ['b1', 'b2', 'b3'],
      books: [
        { id: 'b1', status: 'done' },
        { id: 'b2', status: 'done' },
        { id: 'b3', status: 'reading' }
      ]
    });

    expect(changes).toEqual([{ bookId: 'b3', newStatus: 'done' }]);
  });
});
