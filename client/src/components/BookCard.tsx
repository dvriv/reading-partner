import type { Book } from '../types';

interface BookCardProps {
  book: Book;
  onOpen: () => void;
  onOpenChat: () => void;
  onDelete: () => void;
  onSetStatus: (status: Book['status']) => void;
}

export default function BookCard({ book, onOpen, onOpenChat, onDelete, onSetStatus }: BookCardProps) {

  return (
    <div className="rp-surface-elevated rounded-xl p-5 text-left">
      <button onClick={onOpen} className="w-full text-left focus-visible:outline-none" aria-label={`Edit metadata for ${book.title}`}>
        <div className="flex items-start gap-3">
          <div className="h-24 w-16 shrink-0 overflow-hidden rounded-md border border-[var(--line-subtle)] bg-[var(--paper-surface)]">
            {book.coverUrl ? (
              <img src={book.coverUrl} alt={`Cover for ${book.title}`} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">
                No Cover
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-2xl font-semibold tracking-tight text-[var(--ink-primary)]">{book.title}</h3>
            <p className="truncate text-sm text-[var(--ink-secondary)]">{book.author}</p>
            <p className="mt-2 text-sm font-medium text-[var(--ink-primary)]">Chapter {book.currentChapter}/{book.totalChapters}</p>
          </div>
        </div>
      </button>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onOpenChat}
          className="rp-btn rp-btn-primary min-h-10 px-3 py-1.5 text-xs"
        >
          Open Chat
        </button>
        <button
          onClick={() => onSetStatus('reading')}
          className="rp-btn rp-btn-secondary min-h-10 px-3 py-1.5 text-xs"
          disabled={book.status === 'reading'}
        >
          Reading
        </button>
        <button
          onClick={() => onSetStatus('done')}
          className="rp-btn rp-btn-secondary min-h-10 px-3 py-1.5 text-xs"
          disabled={book.status === 'done'}
        >
          Finished
        </button>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          className="text-xs font-medium text-[var(--ink-tertiary)] transition hover:text-[var(--accent-binding)]"
          onClick={onOpen}
        >
          Edit Metadata
        </button>
        <span className="h-1 w-1 rounded-full bg-[var(--line-strong)]" aria-hidden />
        <button
          type="button"
          className="text-xs font-medium text-[var(--ink-tertiary)] transition hover:text-[var(--danger-ink)]"
          onClick={onDelete}
        >
          Delete Book
        </button>
      </div>
    </div>
  );
}
