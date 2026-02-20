import { describe, expect, it } from 'vitest';
import { computeIngestionPercentage, defaultIngestionMetadata, normalizeIngestionMetadata } from '../lib/ingestion-state';

describe('ingestion metadata defaults', () => {
  it('marks ready books as complete', () => {
    const value = defaultIngestionMetadata('ready', '2026-01-01T00:00:00.000Z');
    expect(value.stage).toBe('complete');
    expect(value.percentage).toBe(100);
  });

  it('normalizes missing values for legacy records', () => {
    const value = normalizeIngestionMetadata('processing', { stage: 'embed', completed: 4, total: 10 }, '2026-01-01T00:00:00.000Z');
    expect(value.stage).toBe('embed');
    expect(value.percentage).toBe(40);
    expect(value.error).toBeNull();
  });
});

describe('computeIngestionPercentage', () => {
  it('handles zero totals safely', () => {
    expect(computeIngestionPercentage(0, 0)).toBe(0);
    expect(computeIngestionPercentage(1, 0)).toBe(100);
  });
});
