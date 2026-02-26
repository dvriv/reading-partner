import { useMemo, useState } from 'react';
import { CircleHelp, Quote } from 'lucide-react';
import { getDb } from '../lib/db';
import type { ChatMessage as ChatMessageType } from '../types';

interface ChatMessageProps {
  message: ChatMessageType;
  standalone?: boolean;
  onRetryProviderError?: (prompt: string) => void;
  retryDisabled?: boolean;
  retryLabel?: string;
}

export default function ChatMessage({
  message,
  standalone,
  onRetryProviderError,
  retryDisabled,
  retryLabel
}: ChatMessageProps) {
  const [showCitations, setShowCitations] = useState(false);
  const [showTrace, setShowTrace] = useState(false);
  const [expandedCitationKeys, setExpandedCitationKeys] = useState<Set<string>>(new Set());
  const [fullChunk, setFullChunk] = useState<{ title: string; chapterNumber: number; chapterLabel: string; content: string } | null>(null);
  const [openingChunk, setOpeningChunk] = useState(false);
  const isUser = message.role === 'user';
  const citationCount = message.citations?.length ?? 0;
  const citations = useMemo(() => {
    if (!message.citations) return [];
    return [...message.citations].sort((a, b) => {
      if (a.bookTitle !== b.bookTitle) {
        return a.bookTitle.localeCompare(b.bookTitle);
      }
      return a.chapterLabel.localeCompare(b.chapterLabel, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [message.citations]);
  const stateClass =
    message.assistantState === 'no-context'
      ? 'border border-[rgba(217,119,6,0.22)] bg-[rgba(254,243,199,0.45)] text-[rgba(146,64,14,0.92)]'
      : message.assistantState === 'provider-error'
        ? 'border border-[rgba(239,68,68,0.25)] bg-[rgba(254,242,242,0.9)] text-[rgba(153,27,27,0.92)]'
      : message.assistantState === 'low-confidence'
          ? 'border border-[rgba(217,119,6,0.18)] bg-[rgba(254,243,199,0.38)] text-[rgba(146,64,14,0.9)]'
          : 'border border-[#d7dee9] bg-[#f8fafc] text-[var(--ink-primary)]';
  const stateLabel =
    message.assistantState === 'no-context'
      ? 'Limited context'
      : message.assistantState === 'provider-error'
        ? 'Provider issue'
        : message.assistantState === 'low-confidence'
          ? 'Low confidence'
          : null;

  async function openTraceItemChunk(item: NonNullable<ChatMessageType['retrievalTrace']>['items'][number]) {
    if (openingChunk) return;
    setOpeningChunk(true);
    try {
      if (item.fullChunk && item.fullChunk.trim().length > 0) {
        setFullChunk({
          title: item.bookTitle,
          chapterNumber: item.chapterNumber,
          chapterLabel: item.chapterLabel,
          content: item.fullChunk
        });
        return;
      }

      if (typeof item.chunkId === 'number') {
        const db = await getDb();
        const chunk = await db.get('chunks', item.chunkId);
        if (chunk?.content) {
          setFullChunk({
            title: item.bookTitle,
            chapterNumber: item.chapterNumber,
            chapterLabel: item.chapterLabel,
            content: chunk.content
          });
          return;
        }
      }

      setFullChunk({
        title: item.bookTitle,
        chapterNumber: item.chapterNumber,
        chapterLabel: item.chapterLabel,
        content: item.snippet
      });
    } finally {
      setOpeningChunk(false);
    }
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} w-full`}>
      <div
        className={`max-w-[90%] rounded-2xl p-5 text-sm shadow-[0_2px_6px_rgba(15,23,42,0.06)] ${
          isUser ? 'rp-message-user rounded-tr-sm border border-[rgba(79,70,229,0.5)]' : `rounded-tl-sm ${stateClass}`
        }`}
        aria-label={isUser ? 'Your message' : 'Assistant message'}
      >
        {!isUser && stateLabel ? <p className="mb-1 text-xs font-semibold uppercase tracking-wide">{stateLabel}</p> : null}
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.content}</p>

        {!isUser && (citationCount > 0 || (message.retrievalTrace && message.retrievalTrace.items.length > 0) || message.confidence) ? (
          <div className="mt-4 border-t border-[var(--line-subtle)] pt-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {citationCount > 0 ? (
            <button
              type="button"
                    className="inline-flex min-h-8 items-center gap-1 rounded-md bg-[rgba(99,102,241,0.12)] px-3 text-xs font-semibold text-[var(--accent-binding)]"
              onClick={() => setShowCitations((prev) => !prev)}
              aria-expanded={showCitations}
            >
                    <Quote size={13} />
              {showCitations ? 'Hide citations' : `Show citations (${citationCount})`}
            </button>
                ) : null}
                {message.retrievalTrace && message.retrievalTrace.items.length > 0 ? (
                  <button
                    type="button"
                    className="inline-flex min-h-8 items-center gap-1 px-1 text-xs font-medium text-[var(--ink-secondary)]"
                    onClick={() => setShowTrace((prev) => !prev)}
                    aria-expanded={showTrace}
                  >
                    <CircleHelp size={13} />
                    {showTrace ? 'Hide why this answer' : 'Why this answer?'}
                  </button>
                ) : null}
              </div>
              {message.confidence ? (
                <span className="inline-block rounded-full border border-[rgba(22,163,74,0.22)] bg-[rgba(236,253,245,0.9)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-[rgba(5,150,105,0.95)]" aria-label={`Confidence ${message.confidence}`}>
                  {message.confidence} confidence
                </span>
              ) : null}
            </div>

            {showCitations ? (
               <ul className="mt-2 space-y-2 text-xs text-[var(--ink-secondary)]" aria-label="Citations">
                {citations.map((citation, index) => {
                  const citationKey = `${citation.bookTitle}-${citation.chapterLabel}-${index}`;
                  const excerpt = citation.excerpt.trim();
                  const expanded = expandedCitationKeys.has(citationKey);
                  const preview = excerpt.length > 180 ? `${excerpt.slice(0, 180)}...` : excerpt;

                  return (
                     <li key={citationKey} className="rounded-lg border border-[var(--line-subtle)] bg-[var(--paper-elevated)] p-3">
                    <span className="rounded bg-[rgba(15,118,110,0.12)] px-1 py-0.5 font-semibold text-[var(--accent-binding)]">
                      {standalone ? `[${citation.chapterLabel}]` : `[${citation.bookTitle}, ${citation.chapterLabel}]`}
                    </span>{' '}
                    <span className="italic">"{expanded ? excerpt : preview}"</span>
                    {excerpt.length > 180 ? (
                      <button
                        type="button"
                        className="ml-2 rounded px-1 text-xs font-semibold text-[var(--accent-binding)] hover:bg-[var(--accent-binding-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--line-focus)]"
                        onClick={() => {
                          setExpandedCitationKeys((prev) => {
                            const next = new Set(prev);
                            if (next.has(citationKey)) {
                              next.delete(citationKey);
                            } else {
                              next.add(citationKey);
                            }
                            return next;
                          });
                        }}
                      >
                        {expanded ? 'Less' : 'More'}
                      </button>
                    ) : null}
                  </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        ) : null}

        {!isUser && message.retrievalTrace && message.retrievalTrace.items.length > 0 && showTrace ? (
          <div className="mt-4 border-t border-[var(--line-subtle)] pt-3">
              <div className="mt-2 rounded-lg border border-[var(--line-subtle)] bg-[var(--paper-elevated)] p-3 text-xs text-[var(--ink-secondary)]">
                <p className="font-medium text-[var(--ink-primary)]">
                  Query: <span className="font-normal">{message.retrievalTrace.query}</span>
                </p>
                <p className="mt-1 text-[var(--ink-tertiary)]">
                  {message.retrievalTrace.mode} retrieval - {message.retrievalTrace.returned}/{message.retrievalTrace.totalCandidates} chunks used
                </p>
                <ul className="mt-2 space-y-1">
                  {message.retrievalTrace.items.map((item) => (
                    <li key={`${item.rank}-${item.bookTitle}-${item.chapterNumber}`}>
                      <button
                        type="button"
                        className="w-full rounded-lg border border-[var(--line-subtle)] p-3 text-left transition hover:bg-[var(--paper-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--line-focus)]"
                        onClick={() => void openTraceItemChunk(item)}
                        aria-label={`Open full chunk for ${item.bookTitle} ${item.chapterLabel}`}
                      >
                        <p className="font-medium text-[var(--ink-primary)]">
                          #{item.rank} {item.bookTitle} {item.chapterLabel}
                        </p>
                        <p className="text-[var(--ink-secondary)]">{item.snippet}</p>
                        <p className="mt-1 text-[11px] uppercase tracking-wide text-[var(--ink-muted)]">
                          score {item.combinedScore.toFixed(3)} / bm25 {(item.bm25Score ?? 0).toFixed(3)} / vector {(item.vectorScore ?? 0).toFixed(3)}
                        </p>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
          </div>
        ) : null}

        {!isUser && message.assistantState === 'no-context' ? (
          <p className="mt-2 text-xs">Move your reading progress forward or ask a narrower question.</p>
        ) : null}
        {!isUser && message.assistantState === 'provider-error' ? (
          <div className="mt-2 space-y-2">
            <p className="text-xs">Retry shortly. If this keeps failing, check provider/API availability.</p>
            {message.retryPrompt && onRetryProviderError ? (
              <button
                type="button"
                disabled={retryDisabled}
                className="rp-btn rp-btn-danger min-h-9 px-2 text-xs disabled:opacity-60"
                onClick={() => onRetryProviderError(message.retryPrompt as string)}
              >
                {retryLabel ?? 'Retry same message'}
              </button>
            ) : null}
          </div>
        ) : null}
        {!isUser && message.assistantState === 'low-confidence' ? (
          <p className="mt-2 text-xs">Verify details against the cited passages before relying on this answer.</p>
        ) : null}
      </div>

      {fullChunk ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(15,23,42,0.34)] p-4 backdrop-blur-[1px]">
          <div
            className="w-full max-w-3xl overflow-hidden rounded-2xl border border-[var(--line-subtle)] bg-[var(--paper-elevated)] shadow-[0_18px_40px_rgba(15,23,42,0.2)]"
            role="dialog"
            aria-modal="true"
            aria-label="Full retrieved chunk"
          >
            <div className="border-b border-[var(--line-subtle)] bg-[var(--paper-elevated)] px-5 py-4 sm:px-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ink-muted)]">Retrieved Passage</p>
                  <h3 className="mt-1 text-base font-semibold text-[var(--ink-primary)]">
                    {fullChunk.title} - {fullChunk.chapterLabel}
                  </h3>
                </div>
                <button className="rp-btn rp-btn-secondary min-h-9 px-3 text-sm" onClick={() => setFullChunk(null)}>
                  Close
                </button>
              </div>
            </div>

            <div className="max-h-[72vh] overflow-auto p-5 sm:p-6">
              <div className="rounded-xl border border-[var(--line-subtle)] bg-[var(--paper-surface)] p-4 sm:p-5">
                <div
                  className="whitespace-pre-wrap text-[15px] leading-7 text-[var(--ink-primary)]"
                  style={{ fontFamily: 'inherit' }}
                >
                  {fullChunk.content}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
