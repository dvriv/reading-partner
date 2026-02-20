import type { Book } from '../types';

interface BookCardProps {
  book: Book;
  onOpen: () => void;
  onDelete: () => void;
  onSetStatus: (status: Book['status']) => void;
  onOffload: () => void;
}

export default function BookCard({ book, onOpen, onDelete, onSetStatus, onOffload }: BookCardProps) {

  return (
    <div className="rp-surface-elevated rounded-xl p-5 text-left">
      <button onClick={onOpen} className="w-full text-left focus-visible:outline-none" aria-label={`Open book chat for ${book.title}`}>
        <h3 className="text-2xl font-semibold tracking-tight text-[var(--ink-primary)]">{book.title}</h3>
        <p className="text-sm text-[var(--ink-secondary)]">{book.author}</p>
        <p className="mt-2 text-sm font-medium text-[var(--ink-primary)]">Chapter {book.currentChapter}/{book.totalChapters}</p>
        {!book.hasLocalContent ? <p className="mt-1 text-xs text-[var(--warning-ink)]">Local text cleared to save space</p> : null}
      </button>

      <div className="mt-3 flex flex-wrap gap-2">
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
        <button
          onClick={onDelete}
          className="rp-btn rp-btn-danger min-h-10 px-3 py-1.5 text-xs"
        >
          Delete Book
        </button>
        <button
          onClick={onOffload}
          disabled={!book.hasLocalContent}
          className="rp-btn rp-btn-warning min-h-10 px-3 py-1.5 text-xs disabled:opacity-60"
        >
          Clear Local Text
        </button>
      </div>
    </div>
  );
}
