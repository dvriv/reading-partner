import { FormEvent, useEffect, useState } from 'react';
import { lookupOpenLibraryCoverCandidates, type OpenLibraryCoverCandidate } from '../lib/openlibrary';
import type { Book } from '../types';

interface EditBookMetadataModalProps {
  open: boolean;
  book: Book | null;
  defaultSeriesName: string;
  onClose: () => void;
  onSave: (payload: {
    title: string;
    author: string;
    isbn: string;
    publicationYear: string;
    seriesName: string;
    seriesOrder: string;
    coverUrl: string | null;
  }) => Promise<void>;
}

export default function EditBookMetadataModal({
  open,
  book,
  defaultSeriesName,
  onClose,
  onSave,
}: EditBookMetadataModalProps) {
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [isbn, setIsbn] = useState('');
  const [publicationYear, setPublicationYear] = useState('');
  const [seriesName, setSeriesName] = useState('');
  const [seriesOrder, setSeriesOrder] = useState('');
  const [selectedCoverUrl, setSelectedCoverUrl] = useState<string>('');
  const [view, setView] = useState<'form' | 'covers'>('form');
  const [coverCandidates, setCoverCandidates] = useState<OpenLibraryCoverCandidate[]>([]);
  const [coverLoading, setCoverLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !book) return;
    setTitle(book.title);
    setAuthor(book.author);
    setIsbn(book.isbn ?? '');
    setPublicationYear(book.publicationYear ? String(book.publicationYear) : '');
    setSeriesName(defaultSeriesName);
    setSeriesOrder(book.bookNumber ? String(book.bookNumber) : '');
    setSelectedCoverUrl(book.coverUrl ?? '');
    setView('form');
    setCoverCandidates([]);
    setCoverLoading(false);
    setError(null);
  }, [open, book, defaultSeriesName]);

  if (!open || !book) return null;

  async function openCoverPicker() {
    setView('covers');
    setCoverLoading(true);
    setError(null);
    try {
      const isbnValues = isbn.trim() ? [isbn.trim()] : [];
      const candidates = await lookupOpenLibraryCoverCandidates(title, author, isbnValues);
      setCoverCandidates(candidates);
    } catch {
      setCoverCandidates([]);
    } finally {
      setCoverLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await onSave({
        title,
        author,
        isbn,
        publicationYear,
        seriesName,
        seriesOrder,
        coverUrl: selectedCoverUrl.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update metadata.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rp-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="rp-modal w-full max-w-2xl p-6" role="dialog" aria-modal="true" aria-label="Edit book metadata">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold">Edit Metadata</h2>
          <button type="button" className="rp-btn rp-btn-secondary" onClick={onClose} disabled={loading}>Close</button>
        </div>

        {view === 'form' ? (
        <form className="mt-4 space-y-3" onSubmit={(event) => void submit(event)}>
          <div className="flex items-start gap-4 rounded-[var(--radius-sm)] border border-[var(--line-subtle)] bg-[var(--bg-elevated)] p-3">
            <div className="h-28 w-20 shrink-0 overflow-hidden rounded border border-[var(--line-subtle)] bg-[var(--paper-surface)]">
              {selectedCoverUrl ? (
                <img src={selectedCoverUrl} alt={`Cover for ${title || book.title}`} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">
                  No Cover
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[var(--ink-secondary)]">Current cover</p>
              <button
                type="button"
                className="rp-btn rp-btn-secondary mt-2 min-h-10 px-3 text-xs"
                onClick={() => void openCoverPicker()}
                disabled={loading}
              >
                Change Cover
              </button>
            </div>
          </div>

          <label className="block text-xs font-medium text-[var(--ink-secondary)]">
            Name
            <input className="rp-field mt-1" value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>

          <label className="block text-xs font-medium text-[var(--ink-secondary)]">
            Author
            <input className="rp-field mt-1" value={author} onChange={(event) => setAuthor(event.target.value)} />
          </label>

          <label className="block text-xs font-medium text-[var(--ink-secondary)]">
            ISBN
            <input className="rp-field mt-1" value={isbn} onChange={(event) => setIsbn(event.target.value)} />
          </label>

          <label className="block text-xs font-medium text-[var(--ink-secondary)]">
            Publication Year
            <input
              type="number"
              min={1400}
              max={2500}
              className="rp-field mt-1"
              value={publicationYear}
              onChange={(event) => setPublicationYear(event.target.value)}
            />
          </label>

          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-xs font-medium text-[var(--ink-secondary)]">
              Series
              <input className="rp-field mt-1" value={seriesName} onChange={(event) => setSeriesName(event.target.value)} />
            </label>

            <label className="block text-xs font-medium text-[var(--ink-secondary)]">
              Series order
              <input
                type="number"
                min={1}
                className="rp-field mt-1"
                value={seriesOrder}
                onChange={(event) => setSeriesOrder(event.target.value)}
              />
            </label>
          </div>

          {error ? <p className="text-sm text-[var(--danger-ink)]">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button type="button" className="rp-btn rp-btn-secondary" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="rp-btn rp-btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </form>
        ) : (
        <div className="mt-4">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-[var(--ink-primary)]">Choose Cover</h3>
            <button
              type="button"
              className="rp-btn rp-btn-secondary min-h-10 px-3 text-xs"
              onClick={() => setView('form')}
            >
              Save
            </button>
          </div>

          {coverLoading ? <p className="mt-3 text-sm text-[var(--ink-secondary)]">Loading covers...</p> : null}

          {!coverLoading ? (
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
              <button
                type="button"
                className={`rounded border p-2 text-left text-xs ${selectedCoverUrl ? 'border-[var(--line-subtle)]' : 'border-[var(--accent-binding)] ring-1 ring-[var(--accent-binding)]'}`}
                onClick={() => setSelectedCoverUrl('')}
              >
                <div className="flex h-28 items-center justify-center rounded bg-[var(--paper-surface)] text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">
                  No Cover
                </div>
                <p className="mt-2 truncate text-[var(--ink-secondary)]">Remove cover</p>
              </button>

              {coverCandidates.map((candidate) => {
                const selected = selectedCoverUrl === candidate.url;
                return (
                  <button
                    key={candidate.id}
                    type="button"
                    className={`rounded border p-2 text-left text-xs ${selected ? 'border-[var(--accent-binding)] ring-1 ring-[var(--accent-binding)]' : 'border-[var(--line-subtle)]'}`}
                    onClick={() => setSelectedCoverUrl(candidate.url)}
                    title={candidate.label}
                  >
                    <div className="h-28 overflow-hidden rounded bg-[var(--paper-surface)]">
                      <img src={candidate.url} alt={candidate.label} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                    <p className="mt-2 truncate text-[var(--ink-secondary)]">{candidate.label}</p>
                  </button>
                );
              })}
            </div>
          ) : null}

          {!coverLoading && coverCandidates.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ink-secondary)]">No alternative covers found for this title.</p>
          ) : null}
        </div>
        )}
      </div>
    </div>
  );
}
