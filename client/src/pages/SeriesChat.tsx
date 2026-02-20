import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Lock, PanelLeft, X } from 'lucide-react';
import { getContextMessages, getDb, updateBookStatus } from '../lib/db';
import { normalizeBookRecord } from '../lib/ingestion-state';
import { askSeriesQuestion } from '../lib/llm';
import { isProviderRequestError } from '../lib/provider-error';
import { searchSeries } from '../lib/search';
import type { Book, ChatMessage as ChatMessageType, Series } from '../types';
import SeriesBookList from '../components/SeriesBookList';
import ChatMessage from '../components/ChatMessage';
import ChatInput from '../components/ChatInput';
import FileUpload from '../components/FileUpload';

interface SeriesChatProps {
  seriesId: string;
  authToken: string;
  onBack: () => void;
}

export default function SeriesChat({ seriesId, authToken, onBack }: SeriesChatProps) {
  const [series, setSeries] = useState<Series | null>(null);
  const [books, setBooks] = useState<Book[]>([]);
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const [openUploadModal, setOpenUploadModal] = useState(false);
  const [mobileBooksOpen, setMobileBooksOpen] = useState(false);
  const [chapterValue, setChapterValue] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  const readingBook = useMemo(
    () => books.find((book) => book.status === 'reading') ?? books.filter((book) => book.status === 'done').at(-1),
    [books]
  );
  const offloadedReadableBooks = useMemo(
    () => books.filter((book) => (book.status === 'done' || book.status === 'reading') && !book.hasLocalContent),
    [books]
  );

  async function reload() {
    const db = await getDb();
    const seriesRecord = await db.get('series', seriesId);
    if (!seriesRecord) return;

    const orderedBooks = (
      await Promise.all(seriesRecord.bookOrder.map((bookId) => db.get('books', bookId)))
    ).filter(Boolean).map((book) => normalizeBookRecord(book as Book));

    const allMessages = await getContextMessages(seriesId);
    const seriesMessages = allMessages.filter((message) => message.contextType === 'series');
    setSeries(seriesRecord);
    setBooks(orderedBooks);
    setMessages(seriesMessages);

  }

  useEffect(() => {
    if (!readingBook) {
      setChapterValue(0);
      return;
    }
    setChapterValue(readingBook.currentChapter);
  }, [readingBook?.id, readingBook?.currentChapter]);

  useEffect(() => {
    if (!readingBook) return;
    if (chapterValue === readingBook.currentChapter) return;

    const timeout = window.setTimeout(() => {
      void (async () => {
        const db = await getDb();
        const target = await db.get('books', readingBook.id);
        if (!target) return;
        target.currentChapter = Math.max(0, Math.min(target.totalChapters, chapterValue));
        await db.put('books', target);
        await reload();
      })();
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [chapterValue, readingBook?.id, readingBook?.currentChapter]);

  useEffect(() => {
    void reload();
  }, [seriesId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  useEffect(() => {
    if (retryCountdown <= 0) return;
    const timer = window.setInterval(() => {
      setRetryCountdown((prev) => Math.max(0, prev - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [retryCountdown]);

  async function persistMessage(message: ChatMessageType) {
    const db = await getDb();
    await db.add('chatMessages', message);
  }

  async function handleSetBookStatus(book: Book, status: Book['status']) {
    const result = await updateBookStatus(book.id, status);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await reload();
  }

  async function clearSeriesChat() {
    const db = await getDb();
    const chatKeys = await db.getAllKeysFromIndex('chatMessages', 'by-context', seriesId);
    const tx = db.transaction(['chatMessages'], 'readwrite');
    for (const key of chatKeys) {
      await tx.objectStore('chatMessages').delete(key);
    }
    await tx.done;
    setMessages([]);
  }

  async function handleSend(question: string) {
    if (!series || !readingBook) return;
    setError(null);
    setLoading(true);
    let retrievalTrace: ChatMessageType['retrievalTrace'] | undefined;

    const userMessage: ChatMessageType = {
      contextId: seriesId,
      contextType: 'series',
      role: 'user',
      content: question,
      createdAt: new Date().toISOString()
    };
    setMessages((prev) => [...prev, userMessage]);
    await persistMessage(userMessage);

    const hasReadableContent = books.some(
      (book) => book.status === 'done' || (book.status === 'reading' && book.currentChapter > 0)
    );

    if (!hasReadableContent) {
      const assistantMessage: ChatMessageType = {
        contextId: seriesId,
        contextType: 'series',
        role: 'assistant',
        content:
          "You haven't started reading yet. Set your progress to at least Chapter 1 to begin asking questions.",
        createdAt: new Date().toISOString(),
        confidence: 'low',
        assistantState: 'no-context'
      };
      setMessages((prev) => [...prev, assistantMessage]);
      await persistMessage(assistantMessage);
      setLoading(false);
      return;
    }

    const hasReadableContentWithLocalText = books.some(
      (book) =>
        (book.status === 'done' || (book.status === 'reading' && book.currentChapter > 0)) &&
        book.hasLocalContent
    );

    if (!hasReadableContentWithLocalText) {
      const assistantMessage: ChatMessageType = {
        contextId: seriesId,
        contextType: 'series',
        role: 'assistant',
        content:
          'Local text for readable books in this series was cleared to save space. Re-upload those books to restore answers.',
        createdAt: new Date().toISOString(),
        confidence: 'low',
        assistantState: 'no-context'
      };
      setMessages((prev) => [...prev, assistantMessage]);
      await persistMessage(assistantMessage);
      setLoading(false);
      return;
    }

    try {
      const results = await searchSeries(seriesId, question, authToken);
      const bookMap = new Map(books.map((book) => [book.id, book.title]));
      retrievalTrace = {
        mode: 'series',
        query: question,
        totalCandidates: results.length,
        returned: Math.min(results.length, 8),
        generatedAt: new Date().toISOString(),
        items: results.slice(0, 8).map((result, index) => ({
          rank: index + 1,
          chunkId: result.id,
          bookTitle: bookMap.get(result.bookId) ?? 'Unknown Book',
          chapterNumber: result.chapterNumber,
          snippet: result.content.slice(0, 180),
          fullChunk: result.content,
          combinedScore: result.score,
          bm25Score: result.bm25Score,
          vectorScore: result.vectorScore
        }))
      };

      if (results.length === 0) {
        const assistantMessage: ChatMessageType = {
          contextId: seriesId,
          contextType: 'series',
          role: 'assistant',
          content: "I couldn't find enough on-page context within your spoiler boundary to answer confidently.",
          retrievalTrace,
          createdAt: new Date().toISOString(),
          confidence: 'low',
          assistantState: 'no-context'
        };
        setMessages((prev) => [...prev, assistantMessage]);
        await persistMessage(assistantMessage);
        return;
      }

      const payloadChunks = results.map((result) => ({
        content: result.content,
        bookTitle: bookMap.get(result.bookId) || 'Unknown Book',
        chapterNumber: result.chapterNumber
      }));

      const completed = books.filter((book) => book.status === 'done').map((book) => book.title);
      const response = await askSeriesQuestion(
        series.name,
        readingBook.title,
        readingBook.currentChapter,
        completed,
        question,
        payloadChunks,
        authToken
      );

      const assistantMessage: ChatMessageType = {
        contextId: seriesId,
        contextType: 'series',
        role: 'assistant',
        content: response.answer,
        citations: response.citations,
        confidence: response.confidence,
        assistantState: response.confidence === 'low' ? 'low-confidence' : undefined,
        retrievalTrace,
        createdAt: new Date().toISOString()
      };

      setMessages((prev) => [...prev, assistantMessage]);
      await persistMessage(assistantMessage);
      setRetryCountdown(0);
    } catch (err) {
      const providerIssue = isProviderRequestError(err);
      const message = providerIssue
        ? 'The AI provider failed while generating this answer. Try again in a moment.'
        : err instanceof Error
          ? err.message
          : 'Failed to answer question.';
      const assistantMessage: ChatMessageType = {
        contextId: seriesId,
        contextType: 'series',
        role: 'assistant',
        content: message,
        retrievalTrace,
        createdAt: new Date().toISOString(),
        confidence: 'low',
        assistantState: providerIssue ? 'provider-error' : 'low-confidence',
        retryPrompt: providerIssue ? question : undefined
      };
      setMessages((prev) => [...prev, assistantMessage]);
      await persistMessage(assistantMessage);
      setError(message);
      if (providerIssue) {
        setRetryCountdown(5);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!series) {
    return <main className="p-8 text-sm text-[var(--ink-secondary)]">Loading series...</main>;
  }

  return (
    <>
      <FileUpload
        open={openUploadModal}
        authToken={authToken}
        series={series ? [series] : []}
        books={books}
        preferredSeriesId={seriesId}
        onClose={() => setOpenUploadModal(false)}
        onComplete={reload}
      />

      <main className="h-screen bg-[var(--paper-canvas)] px-0 md:px-4">
        <div className="mx-auto flex h-full w-full max-w-[1280px] overflow-hidden">
        <aside className="hidden w-full max-w-72 shrink-0 overflow-y-auto border-r border-[var(--line-subtle)] bg-[var(--paper-elevated)] md:block">
          <div className="sticky top-0 z-20 border-b border-[var(--line-subtle)] bg-[var(--paper-elevated)] p-6">
            <button className="mb-5 inline-flex items-center gap-1 text-sm font-medium text-[var(--ink-secondary)] transition hover:text-[var(--accent-binding)]" onClick={onBack} aria-label="Back to library">
              <ArrowLeft size={16} /> Back to Library
            </button>
            <h1 className="text-4xl font-bold tracking-tight text-[var(--ink-primary)]">{series.name}</h1>
            <p className="mt-1 text-xs font-semibold uppercase tracking-[0.1em] text-[var(--ink-secondary)]">Reading Companion</p>
          </div>
          <div className="p-4">
            <SeriesBookList
              books={books}
              onSetStatus={(book, status) => handleSetBookStatus(book, status)}
            />
            <button className="rp-btn rp-btn-secondary mt-3 w-full" onClick={() => setOpenUploadModal(true)}>
              Add Book
            </button>
          </div>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-10 border-b border-[var(--line-subtle)] bg-[rgba(255,255,255,0.85)] px-3 py-4 backdrop-blur md:px-6">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--line-subtle)] bg-[var(--paper-elevated)] text-[var(--ink-secondary)] md:hidden"
                  onClick={() => setMobileBooksOpen(true)}
                  aria-label="Open books panel"
                >
                  <PanelLeft size={18} />
                </button>
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[rgba(99,102,241,0.12)] text-[var(--accent-binding)]">
                  <BookOpen size={20} />
                </span>
                <div>
                  <h2 className="text-lg font-semibold text-[var(--ink-primary)]">Reading: {readingBook?.title ?? series.name}</h2>
                  <p className="text-sm text-[var(--ink-secondary)]">Current Chapter: {readingBook?.currentChapter ?? 0}</p>
                </div>
                {readingBook ? (
                  <div className="ml-2 hidden min-w-[220px] items-center gap-2 md:flex">
                    <input
                      type="range"
                      min={0}
                      max={readingBook.totalChapters}
                      value={chapterValue}
                      onChange={(event) => setChapterValue(Number(event.target.value))}
                      className="w-full accent-[var(--accent-binding)]"
                      aria-label="Reading chapter progress"
                    />
                    <span className="whitespace-nowrap text-xs font-medium text-[var(--ink-secondary)]">
                      {chapterValue}/{readingBook.totalChapters}
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-1 text-[var(--ink-muted)]">
                <button
                  className="rp-btn rp-btn-secondary min-h-9 px-3 text-xs"
                  aria-label="Clear series chat"
                  onClick={() => void clearSeriesChat()}
                >
                  Clear Chat
                </button>
              </div>
            </div>
          </header>

          <div className="border-b border-[rgba(217,119,6,0.18)] bg-[rgba(254,243,199,0.35)] px-3 py-2 text-center text-sm font-medium text-[rgba(146,64,14,0.85)] md:px-6">
            <p className="mx-auto flex max-w-5xl items-center justify-center gap-2">
              <Lock size={14} />
              Spoiler Safe Zone: Up to {readingBook?.title ?? series.name}, Ch. {readingBook?.currentChapter ?? 0}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-3 py-4 pb-32 md:px-6 md:py-6 md:pb-40" aria-live="polite" aria-label="Series chat messages">
            <div className="mx-auto w-full max-w-none space-y-6 md:max-w-4xl">
              {offloadedReadableBooks.length > 0 ? (
                <div className="rp-subtle-note text-sm">
                  Local text cleared for: {offloadedReadableBooks.map((book) => book.title).join(', ')}. Re-upload to include them in answers.
                </div>
              ) : null}

              {messages.map((message, index) => (
                <ChatMessage
                  key={`${message.createdAt}-${index}`}
                  message={message}
                  onRetryProviderError={(prompt) => {
                    if (loading || retryCountdown > 0) return;
                    void handleSend(prompt);
                  }}
                  retryDisabled={loading || retryCountdown > 0}
                  retryLabel={retryCountdown > 0 ? `Retry (${retryCountdown}s)` : 'Retry same message'}
                />
              ))}

              {loading ? <div className="rounded-xl border border-[var(--line-subtle)] bg-[var(--paper-elevated)] p-4 text-sm font-medium text-[var(--accent-binding)]">Retrieving passages and generating answer...</div> : null}
              {error ? <p className="text-xs text-[var(--danger-ink)]">{error}</p> : null}
              <div ref={messagesEndRef} />
            </div>
          </div>

          <div className="sticky bottom-0 z-20 border-t border-[var(--line-subtle)] bg-[rgba(248,250,252,0.98)] px-3 py-3 backdrop-blur md:px-6 md:py-4" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            <div className="mx-auto w-full max-w-none md:max-w-4xl">
              <ChatInput onSend={handleSend} disabled={loading || !readingBook} loadingLabel={loading ? 'Working on your answer...' : null} />
            </div>
          </div>
        </section>
        </div>

        {mobileBooksOpen ? (
          <div className="fixed inset-0 z-50 bg-[rgba(15,23,42,0.45)] md:hidden" onClick={() => setMobileBooksOpen(false)}>
            <aside
              className="h-full w-[86vw] max-w-sm overflow-y-auto border-r border-[var(--line-subtle)] bg-[var(--paper-elevated)]"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="sticky top-0 z-20 border-b border-[var(--line-subtle)] bg-[var(--paper-elevated)] p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-[var(--ink-primary)]">Books</h2>
                  <button
                    type="button"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--line-subtle)] bg-[var(--paper-elevated)] text-[var(--ink-secondary)]"
                    onClick={() => setMobileBooksOpen(false)}
                    aria-label="Close books panel"
                  >
                    <X size={16} />
                  </button>
                </div>
                <button className="rp-btn rp-btn-secondary w-full" onClick={() => setMobileBooksOpen(false)}>
                  Continue chat
                </button>
              </div>
              <div className="p-4">
                <SeriesBookList
                  books={books}
                  onSetStatus={(book, status) => void handleSetBookStatus(book, status)}
                />
                <button
                  className="rp-btn rp-btn-secondary mt-3 w-full"
                  onClick={() => {
                    setMobileBooksOpen(false);
                    setOpenUploadModal(true);
                  }}
                >
                  Add Book
                </button>
              </div>
            </aside>
          </div>
        ) : null}

      </main>
    </>
  );
}
