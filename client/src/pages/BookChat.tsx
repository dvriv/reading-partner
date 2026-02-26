import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, Info, Lock, MoreVertical } from 'lucide-react';
import { getBookChapters, getContextMessages, getDb } from '../lib/db';
import { normalizeBookRecord } from '../lib/ingestion-state';
import { askBookQuestion } from '../lib/llm';
import { isProviderRequestError } from '../lib/provider-error';
import { searchBook } from '../lib/search';
import type { Book, Chapter, ChatMessage as ChatMessageType } from '../types';
import ChatMessage from '../components/ChatMessage';
import ChatInput from '../components/ChatInput';

interface BookChatProps {
  bookId: string;
  authToken: string;
  onBack: () => void;
}

export default function BookChat({ bookId, authToken, onBack }: BookChatProps) {
  const [book, setBook] = useState<Book | null>(null);
  const [messages, setMessages] = useState<ChatMessageType[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCountdown, setRetryCountdown] = useState(0);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  function scrollToBottom() {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  async function reload() {
    const db = await getDb();
    const bookRecord = await db.get('books', bookId);
    if (!bookRecord) return;
    const chat = (await getContextMessages(bookId)).filter((message) => message.contextType === 'book');
    const chapterRecords = await getBookChapters(bookId);
    setBook(normalizeBookRecord(bookRecord));
    setMessages(chat);
    setChapters(chapterRecords);
  }

  const currentChapterLabel = book && book.currentChapter > 0
    ? chapters.find((chapter) => chapter.chapterNumber === book.currentChapter)?.title || `Chapter ${book.currentChapter}`
    : 'Unread';

  useEffect(() => {
    void reload();
  }, [bookId]);

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

  async function handleSend(question: string) {
    if (!book) return;
    setError(null);
    setLoading(true);
    let retrievalTrace: ChatMessageType['retrievalTrace'] | undefined;

    const userMessage: ChatMessageType = {
      contextId: bookId,
      contextType: 'book',
      role: 'user',
      content: question,
      createdAt: new Date().toISOString()
    };
    setMessages((prev) => [...prev, userMessage]);
    await persistMessage(userMessage);

    if (book.currentChapter < 1) {
      const assistantMessage: ChatMessageType = {
        contextId: bookId,
        contextType: 'book',
        role: 'assistant',
        content:
          "You haven't started reading yet. Set your progress to at least the first chapter to begin asking questions.",
        createdAt: new Date().toISOString(),
        confidence: 'low',
        assistantState: 'no-context'
      };
      setMessages((prev) => [...prev, assistantMessage]);
      await persistMessage(assistantMessage);
      setLoading(false);
      return;
    }

    if (!book.hasLocalContent) {
      const assistantMessage: ChatMessageType = {
        contextId: bookId,
        contextType: 'book',
        role: 'assistant',
        content:
          'This book\'s local text was cleared to save space. Re-upload the book to restore question answering for it.',
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
      const results = await searchBook(bookId, question, book.currentChapter, authToken);
      retrievalTrace = {
        mode: 'book',
        query: question,
        totalCandidates: results.length,
        returned: Math.min(results.length, 8),
        generatedAt: new Date().toISOString(),
        items: results.slice(0, 8).map((result, index) => ({
          rank: index + 1,
          chunkId: result.id,
          bookTitle: book.title,
          chapterNumber: result.chapterNumber,
          chapterLabel: result.chapterLabel,
          snippet: result.content.slice(0, 180),
          fullChunk: result.content,
          combinedScore: result.score,
          bm25Score: result.bm25Score,
          vectorScore: result.vectorScore
        }))
      };

      if (results.length === 0) {
        const assistantMessage: ChatMessageType = {
          contextId: bookId,
          contextType: 'book',
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

      const chunks = results.map((result) => ({
        content: result.content,
        bookTitle: book.title,
        chapterNumber: result.chapterNumber,
        chapterLabel: result.chapterLabel
      }));
      const response = await askBookQuestion(book.title, book.currentChapter, currentChapterLabel, question, chunks, authToken);

      const assistantMessage: ChatMessageType = {
        contextId: bookId,
        contextType: 'book',
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
      const isProviderError = isProviderRequestError(err);
      const messageText = isProviderError
        ? 'The AI provider failed while generating this answer. Try again in a moment.'
        : err instanceof Error
          ? err.message
          : 'Failed to answer question.';
      const assistantMessage: ChatMessageType = {
        contextId: bookId,
        contextType: 'book',
        role: 'assistant',
        content: messageText,
        retrievalTrace,
        createdAt: new Date().toISOString(),
        confidence: 'low',
        assistantState: isProviderError ? 'provider-error' : 'low-confidence',
        retryPrompt: isProviderError ? question : undefined
      };
      setMessages((prev) => [...prev, assistantMessage]);
      await persistMessage(assistantMessage);
      setError(messageText);
      if (isProviderError) {
        setRetryCountdown(5);
      }
    } finally {
      setLoading(false);
    }
  }

  if (!book) {
    return <main className="p-8 text-sm text-[var(--ink-secondary)]">Loading book...</main>;
  }

  return (
    <main className="h-screen bg-[var(--paper-canvas)] px-0 md:px-4">
      <div className="relative mx-auto flex h-full w-full max-w-[1280px] min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-10 border-b border-[var(--line-subtle)] bg-[rgba(255,255,255,0.85)] px-3 py-4 backdrop-blur md:px-6">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button className="inline-flex items-center gap-1 text-sm font-medium text-[var(--ink-secondary)] transition hover:text-[var(--accent-binding)]" onClick={onBack} aria-label="Back to library">
              <ArrowLeft size={16} /> Back
            </button>
            <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-[rgba(99,102,241,0.12)] text-[var(--accent-binding)]">
              <BookOpen size={20} />
            </span>
            <div>
              <h2 className="text-lg font-semibold text-[var(--ink-primary)]">Discussion: {book.title}</h2>
              <p className="text-sm text-[var(--ink-secondary)]">Current Chapter: {currentChapterLabel}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 text-[var(--ink-muted)]">
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[var(--paper-surface)]" aria-label="Info"><Info size={18} /></button>
            <button className="inline-flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-[var(--paper-surface)]" aria-label="More options"><MoreVertical size={18} /></button>
          </div>
        </div>
      </header>

      <div className="border-b border-[rgba(217,119,6,0.18)] bg-[rgba(254,243,199,0.35)] px-3 py-2 text-center text-sm font-medium text-[rgba(146,64,14,0.85)] md:px-6">
        <p className="mx-auto flex max-w-5xl items-center justify-center gap-2">
          <Lock size={14} />
            Spoiler Safe Zone: Up to {book.title}, {currentChapterLabel}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-4 pb-32 md:px-6 md:py-6 md:pb-40" aria-live="polite" aria-label="Book chat messages">
        <div className="mx-auto w-full max-w-none space-y-6 md:max-w-4xl">
          {!book.hasLocalContent ? (
            <div className="rp-subtle-note text-sm">
              Local text for this book was cleared to free space. Re-upload this book to enable new answers.
            </div>
          ) : null}

          {messages.map((message, index) => (
            <ChatMessage
              key={`${message.createdAt}-${index}`}
              message={message}
              standalone
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
          <ChatInput
            onSend={handleSend}
            disabled={loading || book.processingStatus !== 'ready' || !book.hasLocalContent}
            loadingLabel={loading ? 'Working on your answer...' : null}
          />
        </div>
      </div>
      </div>
    </main>
  );
}
