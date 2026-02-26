import { useEffect, useMemo, useState } from 'react';
import { BookText, Search, Settings } from 'lucide-react';
import {
  deleteBook,
  deleteSeries,
  getDb,
  listBooks,
  listSeries,
  offloadBookLocalContent,
  removeNonReadyBooks,
  updateBookStatus,
  updateSeriesBookNumbering
} from '../lib/db';
import type { Book, Series } from '../types';
import FileUpload from '../components/FileUpload';
import SeriesCard from '../components/SeriesCard';
import BookCard from '../components/BookCard';
import CreateSeriesModal from '../components/CreateSeriesModal';
import SettingsModal from '../components/SettingsModal';
import { createId } from '../lib/id';

interface LibraryProps {
  onSelectSeries: (seriesId: string) => void;
  onSelectBook: (bookId: string) => void;
  onLogout: () => Promise<void>;
  authToken: string;
}

export default function Library({ onSelectSeries, onSelectBook, onLogout, authToken }: LibraryProps) {
  const collapsedStorageKey = 'reading-partner:collapsed-series';
  const [series, setSeries] = useState<Series[]>([]);
  const [books, setBooks] = useState<Book[]>([]);
  const [openCreateSeries, setOpenCreateSeries] = useState(false);
  const [openUploadModal, setOpenUploadModal] = useState(false);
  const [openSettingsModal, setOpenSettingsModal] = useState(false);
  const [uploadTargetSeriesId, setUploadTargetSeriesId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [collapsedSeriesIds, setCollapsedSeriesIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set<string>();
    const raw = window.localStorage.getItem('reading-partner:collapsed-series');
    if (!raw) return new Set<string>();
    try {
      return new Set<string>(JSON.parse(raw) as string[]);
    } catch {
      return new Set<string>();
    }
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | Book['status']>('all');
  const [scopeFilter, setScopeFilter] = useState<'all' | 'series' | 'standalone'>('all');

  async function loadAll() {
    await removeNonReadyBooks();
    const [nextSeries, nextBooks] = await Promise.all([listSeries(), listBooks()]);
    setSeries(nextSeries);
    setBooks(nextBooks);
  }

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(collapsedStorageKey, JSON.stringify(Array.from(collapsedSeriesIds)));
  }, [collapsedSeriesIds]);

  useEffect(() => {
    if (series.length === 0) return;
    const expandedIds = series.map((item) => item.id).filter((id) => !collapsedSeriesIds.has(id));
    if (expandedIds.length <= 1) return;

    const keepExpandedId = expandedIds[0];
    setCollapsedSeriesIds(new Set(series.map((item) => item.id).filter((id) => id !== keepExpandedId)));
  }, [series, collapsedSeriesIds]);

  const readyBooks = useMemo(
    () => books.filter((book) => book.processingStatus === 'ready'),
    [books]
  );

  const standaloneBooks = useMemo(
    () => readyBooks.filter((book) => !book.seriesId).sort((a, b) => a.title.localeCompare(b.title)),
    [readyBooks]
  );

  const filteredBooks = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return readyBooks.filter((book) => {
      if (scopeFilter === 'series' && !book.seriesId) return false;
      if (scopeFilter === 'standalone' && book.seriesId) return false;
      if (statusFilter !== 'all' && book.status !== statusFilter) return false;
      if (!query) return true;
      return `${book.title} ${book.author}`.toLowerCase().includes(query);
    });
  }, [readyBooks, searchQuery, statusFilter, scopeFilter]);

  const filteredBookIds = useMemo(() => new Set(filteredBooks.map((book) => book.id)), [filteredBooks]);
  const filteredStandaloneBooks = useMemo(
    () => standaloneBooks.filter((book) => filteredBookIds.has(book.id)),
    [standaloneBooks, filteredBookIds]
  );
  const isEmptyLibrary = series.length === 0 && readyBooks.length === 0;

  return (
    <>
    <main className="rp-page max-w-7xl p-4 md:p-8">
      <header className="mb-7 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--ink-primary)]">Reading Partner</h1>
          <p className="mt-1 text-sm text-[var(--ink-secondary)]">Library and progression ledger</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[var(--ink-muted)] transition hover:bg-[var(--paper-surface)]"
            aria-label="Open settings"
            onClick={() => setOpenSettingsModal(true)}
          >
            <Settings size={18} />
          </button>
          <button className="rp-btn rp-btn-secondary min-h-11 px-4 text-sm" onClick={() => void onLogout()}>
            Logout
          </button>
        </div>
      </header>

      <SettingsModal
        open={openSettingsModal}
        accessToken={authToken}
        onClose={() => setOpenSettingsModal(false)}
        onAccountDeleted={onLogout}
      />

      <FileUpload
        open={openUploadModal}
        authToken={authToken}
        series={series}
        books={books}
        preferredSeriesId={uploadTargetSeriesId}
        onClose={() => setOpenUploadModal(false)}
        onComplete={async () => {
          setUploadTargetSeriesId(null);
          await loadAll();
        }}
      />

      <section className="mt-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between" aria-label="Quick actions and filters">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rp-btn rp-btn-primary min-h-12 px-6 text-base"
            onClick={() => {
              setUploadTargetSeriesId(null);
              setOpenUploadModal(true);
            }}
          >
            Add Book
          </button>
        </div>

        <div className="rp-surface-elevated w-full max-w-2xl p-2">
          <div className="grid gap-2 md:grid-cols-[1fr_140px_180px]">
            <label className="relative block">
              <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[var(--ink-muted)]" />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search title or author"
                className="rp-field min-h-11 text-sm"
                style={{ paddingLeft: '3rem' }}
                aria-label="Search books"
              />
            </label>
            <select
              value={scopeFilter}
              onChange={(event) => setScopeFilter(event.target.value as 'all' | 'series' | 'standalone')}
              className="rp-select min-h-11 text-sm"
              aria-label="Filter by scope"
            >
              <option value="all">All scope</option>
              <option value="series">Series only</option>
              <option value="standalone">Standalone only</option>
            </select>
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as 'all' | Book['status'])}
              className="rp-select min-h-11 text-sm"
              aria-label="Filter by reading status"
            >
              <option value="all">All reading states</option>
              <option value="reading">Reading</option>
              <option value="done">Finished</option>
              <option value="locked">Unread</option>
            </select>
          </div>
        </div>
      </section>

      {isEmptyLibrary ? (
        <section className="mt-8">
          <div className="flex min-h-[520px] items-center justify-center rounded-2xl border-2 border-dashed border-[var(--line-subtle)] bg-[var(--paper-surface)] p-6 text-center">
            <div className="max-w-xl">
              <div className="mx-auto inline-flex h-24 w-24 items-center justify-center rounded-full bg-[rgba(99,102,241,0.12)] text-[var(--accent-binding)]">
                <BookText size={36} />
              </div>
              <h2 className="mt-6 text-4xl font-bold tracking-tight text-[var(--ink-primary)]">Add your first book so we can talk.</h2>
              <p className="mt-4 text-xl leading-relaxed text-[var(--ink-secondary)]">
                Add a book or a series and select the book you are currently reading. I will answer your questions based strictly on your progress, ensuring no spoilers.
              </p>
              <button
                className="rp-btn rp-btn-primary mt-7 min-h-12 px-6 text-base"
                onClick={() => {
                  setUploadTargetSeriesId(null);
                  setOpenUploadModal(true);
                }}
              >
                Add Your First Book
              </button>
              <p className="mt-4 text-sm text-[var(--ink-tertiary)]">Currently only possible to upload DRM free epub files.</p>
            </div>
          </div>
        </section>
      ) : null}

      {!isEmptyLibrary ? (
      <section className="mt-6 space-y-4">
        {actionError ? <p className="text-sm text-[var(--danger-ink)]">{actionError}</p> : null}
        {series.map((item) => {
          const seriesBooks = readyBooks
            .filter((book) => book.seriesId === item.id)
            .sort((a, b) => (a.bookNumber ?? 9999) - (b.bookNumber ?? 9999));
          const filteredSeriesBooks = seriesBooks.filter((book) => filteredBookIds.has(book.id));
          if (filteredSeriesBooks.length === 0 && seriesBooks.length > 0) {
            return null;
          }

          const hasReadingBook = seriesBooks.some((book) => book.status === 'reading');

          return (
            <SeriesCard
              key={item.id}
              series={item}
              books={filteredSeriesBooks}
              allSeriesBooks={seriesBooks}
              onOpen={() => onSelectSeries(item.id)}
              onAddBook={() => {
                setUploadTargetSeriesId(item.id);
                setOpenUploadModal(true);
              }}
              onDeleteSeries={() => {
                const confirmation = window.confirm(
                  `Delete series "${item.name}" and all books in it? This cannot be undone.`
                );
                if (!confirmation) return;
                void (async () => {
                  await deleteSeries(item.id);
                  await loadAll();
                })();
              }}
              onDeleteBook={(book) => {
                const confirmation = window.confirm(
                  `Delete "${book.title}" from this series? This cannot be undone.`
                );
                if (!confirmation) return;
                void (async () => {
                  await deleteBook(book.id);
                  await loadAll();
                })();
              }}
              onOffloadBook={(book) => {
                const confirmation = window.confirm(
                  `Clear local text for "${book.title}" to free space? Chat history and reading status are preserved.`
                );
                if (!confirmation) return;
                void (async () => {
                  const result = await offloadBookLocalContent(book.id);
                  if (!result.ok) {
                    setActionError(result.error);
                    return;
                  }
                  await loadAll();
                })();
              }}
              onSetBookStatus={(book, status) => {
                void (async () => {
                  const result = await updateBookStatus(book.id, status);
                  if (!result.ok) {
                    setActionError(result.error);
                    return;
                  }
                  await loadAll();
                })();
              }}
              onSaveOrdering={async (nextNumbers) => {
                const result = await updateSeriesBookNumbering(item.id, nextNumbers);
                if (!result.ok) return result.error;
                await loadAll();
                return null;
              }}
              collapsed={collapsedSeriesIds.has(item.id)}
              hasReadingBook={hasReadingBook}
              onToggleCollapsed={() => {
                setCollapsedSeriesIds((prev) => {
                  const isCollapsed = prev.has(item.id);
                  if (isCollapsed) {
                    return new Set(series.map((entry) => entry.id).filter((id) => id !== item.id));
                  }

                  const next = new Set(prev);
                  next.add(item.id);
                  return next;
                });
              }}
            />
          );
        })}
      </section>
      ) : null}

      {!isEmptyLibrary ? (
      <section className="mt-8">
        <h2 className="mb-3 text-xl font-bold">Standalone Books</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {filteredStandaloneBooks.map((book) => (
            <BookCard
              key={book.id}
              book={book}
              onOpen={() => onSelectBook(book.id)}
              onDelete={() => {
                const confirmation = window.confirm(`Delete "${book.title}"? This cannot be undone.`);
                if (!confirmation) return;
                void (async () => {
                  await deleteBook(book.id);
                  await loadAll();
                })();
              }}
              onSetStatus={(status) => {
                void (async () => {
                  const result = await updateBookStatus(book.id, status);
                  if (!result.ok) {
                    setActionError(result.error);
                    return;
                  }
                  await loadAll();
                })();
              }}
              onOffload={() => {
                const confirmation = window.confirm(
                  `Clear local text for "${book.title}" to free space? Chat history and reading status are preserved.`
                );
                if (!confirmation) return;
                void (async () => {
                  const result = await offloadBookLocalContent(book.id);
                  if (!result.ok) {
                    setActionError(result.error);
                    return;
                  }
                  await loadAll();
                })();
              }}
            />
          ))}
          {filteredStandaloneBooks.length === 0 ? (
            <div className="rp-surface-elevated col-span-full flex flex-col items-center justify-center rounded-xl p-8 text-center">
              <p className="text-sm text-[var(--ink-secondary)]">No standalone books match current filters.</p>
            </div>
          ) : null}
        </div>
      </section>
      ) : null}

      {!isEmptyLibrary ? (
      <div className="mt-6">
        <button
          className="rp-btn rp-btn-secondary min-h-11 px-4 py-2 text-sm"
          onClick={() => setOpenCreateSeries(true)}
        >
          Create New Series
        </button>
      </div>
      ) : null}

      <CreateSeriesModal
        open={openCreateSeries}
        onClose={() => setOpenCreateSeries(false)}
        onCreate={async (name) => {
          if (!name) return;
          const nextSeriesId = createId();
          const db = await getDb();
          await db.put('series', {
            id: nextSeriesId,
            name,
            bookOrder: [],
            createdAt: new Date().toISOString()
          });
          setCollapsedSeriesIds(new Set(series.map((item) => item.id)));
          setOpenCreateSeries(false);
          await loadAll();
        }}
      />
    </main>
    </>
  );
}
