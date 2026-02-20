import type { Book } from '../types';

interface SeriesBookListProps {
  books: Book[];
  onSetStatus: (book: Book, status: Book['status']) => Promise<void>;
}

function statusLabel(status: Book['status']): string {
  if (status === 'done') return 'finished';
  if (status === 'locked') return 'unread';
  return status;
}

export default function SeriesBookList({ books, onSetStatus }: SeriesBookListProps) {
  return (
    <div className="space-y-2">
      {books.map((book) => {
        const isReading = book.status === 'reading';
        const progress = book.totalChapters > 0 ? Math.round((book.currentChapter / book.totalChapters) * 100) : 0;

        return (
          <div
            key={book.id}
            className={`rounded-xl border p-4 transition ${
              isReading
                ? 'border-[rgba(99,102,241,0.35)] bg-[rgba(99,102,241,0.04)] shadow-[0_1px_2px_rgba(99,102,241,0.08)]'
                : 'border-[var(--line-subtle)] bg-[var(--paper-elevated)]'
            }`}
          >
            <div className="mb-1.5 flex items-start justify-between gap-2">
              <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--ink-muted)]">Book {book.bookNumber}</span>
              <span className={`status-pill ${book.status === 'done' ? 'status-finished' : book.status === 'reading' ? 'status-reading' : 'status-unread'}`}>
                {statusLabel(book.status)}
              </span>
            </div>
            <h3 className="truncate text-base font-semibold tracking-tight text-[var(--ink-primary)]">{book.title}</h3>
            <p className="mt-0.5 text-xs text-[var(--ink-secondary)]">
              {book.status === 'locked' ? 'Unread' : `Chapter ${book.currentChapter}/${book.totalChapters}`}
            </p>
            {isReading ? (
              <div className="mt-2.5 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[rgba(148,163,184,0.25)]">
                  <div className="h-full rounded-full bg-[var(--accent-binding)]" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
                </div>
                <span className="text-[10px] font-medium text-[var(--ink-secondary)]">{progress}%</span>
              </div>
            ) : null}

            <div className="mt-2.5 grid grid-cols-3 gap-1">
              <button
                className="rp-btn rp-btn-secondary min-h-6 px-1 text-[9px] leading-none"
                disabled={book.status === 'reading'}
                onClick={() => void onSetStatus(book, 'reading')}
              >
                Reading
              </button>
              <button
                className="rp-btn rp-btn-secondary min-h-6 px-1 text-[9px] leading-none"
                disabled={book.status === 'done'}
                onClick={() => void onSetStatus(book, 'done')}
              >
                Finished
              </button>
              <button
                className="rp-btn rp-btn-secondary min-h-6 px-1 text-[9px] leading-none"
                disabled={book.status === 'locked'}
                onClick={() => void onSetStatus(book, 'locked')}
              >
                Unread
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
