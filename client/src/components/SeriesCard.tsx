import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { Book, Series } from '../types';

interface SeriesCardProps {
  series: Series;
  books: Book[];
  allSeriesBooks?: Book[];
  onOpen: () => void;
  onAddBook: () => void;
  onDeleteSeries: () => void;
  onDeleteBook: (book: Book) => void;
  onSetBookStatus: (book: Book, status: Book['status']) => void;
  onEditBook: (book: Book) => void;
  onSaveOrdering: (nextNumbers: Record<string, number>) => Promise<string | null>;
  collapsed: boolean;
  hasReadingBook: boolean;
  onToggleCollapsed: () => void;
}

function statusClass(status: Book['status']): string {
  if (status === 'done') return 'status-finished';
  if (status === 'reading') return 'status-reading';
  return 'status-unread';
}

function statusLabel(status: Book['status']): string {
  if (status === 'done') return 'finished';
  if (status === 'locked') return 'unread';
  return status;
}

export default function SeriesCard({
  series,
  books,
  allSeriesBooks,
  onOpen,
  onAddBook,
  onDeleteSeries,
  onDeleteBook,
  onSetBookStatus,
  onEditBook,
  onSaveOrdering,
  collapsed,
  hasReadingBook,
  onToggleCollapsed
}: SeriesCardProps) {
  const [editingOrder, setEditingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderLoading, setOrderLoading] = useState(false);
  const [draftNumbers, setDraftNumbers] = useState<Record<string, number>>({});

  const orderingBooks = allSeriesBooks ?? books;

  const effectiveNumbers = useMemo(() => {
    const map: Record<string, number> = {};
    for (const [index, book] of orderingBooks.entries()) {
      map[book.id] = draftNumbers[book.id] ?? book.bookNumber ?? index + 1;
    }
    return map;
  }, [orderingBooks, draftNumbers]);

  function startEditingOrder() {
    const initial: Record<string, number> = {};
    for (const [index, book] of orderingBooks.entries()) {
      initial[book.id] = book.bookNumber ?? index + 1;
    }
    setDraftNumbers(initial);
    setOrderError(null);
    setEditingOrder(true);
  }

  function cancelEditingOrder() {
    setEditingOrder(false);
    setDraftNumbers({});
    setOrderError(null);
  }

  async function saveOrder() {
    setOrderError(null);
    setOrderLoading(true);
    try {
      const error = await onSaveOrdering(effectiveNumbers);
      if (error) {
        setOrderError(error);
        return;
      }
      setEditingOrder(false);
      setDraftNumbers({});
    } finally {
      setOrderLoading(false);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--line-subtle)] bg-[var(--paper-elevated)] shadow-[var(--shadow-soft)]">
      <div
        className="flex cursor-pointer items-center justify-between gap-3 border-b border-[var(--line-subtle)] bg-[var(--paper-surface)] p-5"
        role="button"
        tabIndex={0}
        aria-expanded={!collapsed}
        aria-label={collapsed ? 'Expand series books' : 'Collapse series books'}
        onClick={onToggleCollapsed}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onToggleCollapsed();
          }
        }}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex h-6 w-6 items-center justify-center text-[var(--ink-secondary)]">
            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          </span>
          <h3 className="text-2xl font-bold tracking-tight text-[var(--ink-primary)]">{series.name}</h3>
          {hasReadingBook ? (
            <span className="status-pill status-reading">Reading</span>
          ) : null}
        </div>
        <button
          className="rp-btn rp-btn-danger min-h-10 px-3 py-1 text-xs"
          onClick={(event) => {
            event.stopPropagation();
            onDeleteSeries();
          }}
        >
          Delete Series
        </button>
      </div>
      {!collapsed ? (
      <div className="pt-3 pb-4">
      <div className="flex flex-wrap gap-2 px-5">
        {!editingOrder ? (
          <button
            className="rp-btn rp-btn-secondary min-h-10 px-3 py-2 text-xs"
            onClick={startEditingOrder}
          >
            Edit order
          </button>
        ) : (
          <>
            <button
              className="rp-btn rp-btn-primary min-h-10 px-3 py-2 text-xs disabled:opacity-60"
              disabled={orderLoading}
              onClick={() => void saveOrder()}
            >
              {orderLoading ? 'Saving...' : 'Save order'}
            </button>
            <button
              className="rp-btn rp-btn-secondary min-h-10 px-3 py-2 text-xs"
              onClick={cancelEditingOrder}
              disabled={orderLoading}
            >
              Cancel
            </button>
          </>
        )}
      </div>
      {orderError ? <p className="mt-2 px-5 text-xs text-[var(--danger-ink)]">{orderError}</p> : null}
      <div className="mt-3 overflow-hidden border-y border-[var(--line-subtle)]">
        {books.map((book) => (
          <div key={book.id} className={`group border-b border-[var(--line-subtle)] px-5 py-3 transition last:border-b-0 ${book.status === 'reading' ? 'bg-[var(--paper-surface)] border-l-4 border-l-[#94a3b8] pl-4' : 'bg-[var(--paper-elevated)] hover:bg-[var(--paper-surface)]'}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 gap-3">
                <button
                  type="button"
                  className="h-16 w-11 shrink-0 overflow-hidden rounded border border-[var(--line-subtle)] bg-[var(--paper-surface)]"
                  onClick={() => onEditBook(book)}
                  aria-label={`Edit metadata for ${book.title}`}
                >
                  {book.coverUrl ? (
                    <img src={book.coverUrl} alt={`Cover for ${book.title}`} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-[9px] font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">
                      No Cover
                    </div>
                  )}
                </button>
                <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {editingOrder ? (
                    <label className="flex items-center gap-1 text-xs text-[var(--ink-tertiary)]">
                      <span className="sr-only">Book number for {book.title}</span>
                      <input
                        type="number"
                        min={1}
                        value={effectiveNumbers[book.id]}
                        onChange={(event) => {
                          const value = Math.max(1, Number(event.target.value) || 1);
                          setDraftNumbers((prev) => ({ ...prev, [book.id]: value }));
                        }}
                        className="rp-field h-9 w-16 p-1.5 text-sm"
                      />
                    </label>
                  ) : (
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--paper-surface)] text-xs font-semibold text-[var(--ink-tertiary)]">
                      #{book.bookNumber ?? '-'}
                    </span>
                  )}
                  <button
                    type="button"
                    className="truncate text-left text-base font-semibold text-[var(--ink-primary)] hover:underline"
                    onClick={() => onEditBook(book)}
                  >
                    {book.title}
                  </button>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-secondary)]">
                  <span className="truncate max-w-[220px]">{book.author}</span>
                  <span aria-hidden>•</span>
                  <span>{book.status === 'locked' ? 'Unread' : `Chapter ${book.currentChapter}/${book.totalChapters}`}</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100">
                  <button
                    className="rp-btn rp-btn-secondary min-h-9 px-2 text-xs disabled:opacity-60"
                    disabled={book.status === 'reading'}
                    onClick={() => onSetBookStatus(book, 'reading')}
                  >
                    Reading
                  </button>
                  <button
                    className="rp-btn rp-btn-secondary min-h-9 px-2 text-xs disabled:opacity-60"
                    disabled={book.status === 'done'}
                    onClick={() => onSetBookStatus(book, 'done')}
                  >
                    Finished
                  </button>
                  <button
                    className="rp-btn rp-btn-secondary min-h-9 px-2 text-xs disabled:opacity-60"
                    disabled={book.status === 'locked'}
                    onClick={() => onSetBookStatus(book, 'locked')}
                  >
                    Unread
                  </button>
                </div>
              </div>
              </div>
              <span className={`status-pill ${statusClass(book.status)} ${book.status === 'reading' ? '!bg-[rgba(148,163,184,0.22)] !text-slate-600 !border-[rgba(148,163,184,0.35)]' : ''}`}>{statusLabel(book.status)}</span>
            </div>
            <div className="mt-2 flex justify-end">
              <div className="flex items-center gap-3">
                <button
                  className="text-xs font-medium text-[var(--ink-tertiary)] transition hover:text-[var(--accent-binding)]"
                  onClick={() => onEditBook(book)}
                >
                  Edit Metadata
                </button>
                <span className="h-1 w-1 rounded-full bg-[var(--line-strong)]" aria-hidden />
                <button
                  className="text-xs font-medium text-[var(--ink-tertiary)] transition hover:text-[var(--danger-ink)]"
                  onClick={() => onDeleteBook(book)}
                >
                  Delete Book
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2 px-5">
        <button className="rp-btn rp-btn-primary min-h-11 px-3 py-2 text-sm" onClick={onOpen}>
          Open Series Chat
        </button>
        <button className="rp-btn rp-btn-secondary min-h-11 px-3 py-2 text-sm" onClick={onAddBook}>
          Add book to this series
        </button>
      </div>
      </div>
      ) : null}
    </div>
  );
}
