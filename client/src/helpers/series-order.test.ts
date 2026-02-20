import { describe, expect, it } from 'vitest';
import { recomputeSeriesStatuses, validateSeriesBookNumbers } from '../lib/series-order';

describe('validateSeriesBookNumbers', () => {
  it('accepts unique contiguous numbers', () => {
    const result = validateSeriesBookNumbers([
      { id: 'b1', bookNumber: 1 },
      { id: 'b2', bookNumber: 2 },
      { id: 'b3', bookNumber: 3 }
    ]);

    expect(result.valid).toBe(true);
  });

  it('rejects duplicate numbers', () => {
    const result = validateSeriesBookNumbers([
      { id: 'b1', bookNumber: 1 },
      { id: 'b2', bookNumber: 1 }
    ]);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('unique');
  });

  it('rejects non-contiguous numbers', () => {
    const result = validateSeriesBookNumbers([
      { id: 'b1', bookNumber: 1 },
      { id: 'b2', bookNumber: 3 }
    ]);

    expect(result.valid).toBe(false);
    expect(result.error).toContain('contiguous');
  });
});

describe('recomputeSeriesStatuses', () => {
  it('keeps done books and ensures only one reading book', () => {
    const updates = recomputeSeriesStatuses([
      { id: 'b1', bookNumber: 1, status: 'done', currentChapter: 2, totalChapters: 10 },
      { id: 'b2', bookNumber: 2, status: 'locked', currentChapter: 0, totalChapters: 10 },
      { id: 'b3', bookNumber: 3, status: 'reading', currentChapter: 4, totalChapters: 10 }
    ]);

    expect(updates).toEqual([
      { id: 'b1', status: 'done', currentChapter: 10 },
      { id: 'b2', status: 'reading', currentChapter: 0 },
      { id: 'b3', status: 'locked', currentChapter: 0 }
    ]);
  });
});
