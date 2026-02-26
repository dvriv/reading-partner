import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { chunkChapter } from '../lib/chunker';
import { deleteBook, deleteSeries, getDb, recomputeSeriesProgression } from '../lib/db';
import { parseEpub } from '../lib/epub-parser';
import { defaultIngestionMetadata } from '../lib/ingestion-state';
import { formatIngestionLabel, resumeBookIngestion } from '../lib/ingestion';
import { createId } from '../lib/id';
import { isProviderRequestError } from '../lib/provider-error';
import type { Book, IngestionMetadata, Series } from '../types';

type UploadMode = 'standalone' | 'existing-series' | 'new-series';

interface FileUploadProps {
  open: boolean;
  authToken: string;
  series: Series[];
  books: Book[];
  preferredSeriesId?: string | null;
  onClose: () => void;
  onComplete: () => Promise<void>;
}

interface UploadQueueItem {
  id: string;
  file: File;
  bookNumber: number;
}

export default function FileUpload({
  open,
  authToken,
  series,
  books,
  preferredSeriesId,
  onClose,
  onComplete
}: FileUploadProps) {
  const CANCELLED_UPLOAD = 'UPLOAD_CANCELLED';
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<UploadMode>('standalone');
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>('');
  const [newSeriesName, setNewSeriesName] = useState('');
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [modalProgress, setModalProgress] = useState<number>(0);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);
  const cancelRequestedRef = useRef(false);
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const canAssign = useMemo(() => {
    if (mode === 'standalone') return true;
    if (mode === 'new-series') return !!newSeriesName.trim();
    return !!selectedSeriesId;
  }, [mode, newSeriesName, selectedSeriesId]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setLoadingLabel(null);
    setModalProgress(0);
    setUploadQueue([]);
    setNewSeriesName('');

    if (!preferredSeriesId) {
      setMode('standalone');
      setSelectedSeriesId('');
    }

    if (preferredSeriesId) {
      setMode('existing-series');
      setSelectedSeriesId(preferredSeriesId);
    }

    cancelRequestedRef.current = false;
    activeAbortControllerRef.current = null;
    dragDepthRef.current = 0;
    setIsDragActive(false);
  }, [open, preferredSeriesId, books]);

  function mapStageProgress(meta: IngestionMetadata): number {
    if (meta.stage === 'parse') return 8;
    if (meta.stage === 'chunk') return Math.round(15 + meta.percentage * 0.28);
    if (meta.stage === 'embed') return Math.round(43 + meta.percentage * 0.48);
    if (meta.stage === 'index') return 94;
    return 100;
  }

  function chooseFiles() {
    fileInputRef.current?.click();
  }

  function enqueueFiles(files: File[]) {
    if (files.length === 0) return;
    setError(null);

    const filtered = files.filter((file) => file.name.toLowerCase().endsWith('.epub'));
    if (filtered.length !== files.length) {
      setError('Only EPUB files are supported.');
    }

    if (filtered.length > 0) {
      setUploadQueue((prev) => {
        const suggestedStart = mode === 'existing-series' && selectedSeriesId
          ? getSuggestedBookNumber(selectedSeriesId, books)
          : 1;
        let nextBookNumber = mode === 'standalone'
          ? 1
          : prev.length > 0
            ? Math.max(...prev.map((item) => item.bookNumber)) + 1
            : suggestedStart;
        const nextItems = filtered.map((file) => {
          const next: UploadQueueItem = {
            id: createId(),
            file,
            bookNumber: nextBookNumber,
          };
          nextBookNumber += 1;
          return next;
        });
        return [...prev, ...nextItems];
      });
    }

  }

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    enqueueFiles(files);
    event.target.value = '';
  }

  function hasDraggedFiles(event: DragEvent<HTMLElement>): boolean {
    return Array.from(event.dataTransfer.types ?? []).includes('Files');
  }

  function onDragEnter(event: DragEvent<HTMLElement>) {
    if (isProcessing || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current += 1;
    setIsDragActive(true);
  }

  function onDragOver(event: DragEvent<HTMLElement>) {
    if (isProcessing || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onDragLeave(event: DragEvent<HTMLElement>) {
    if (isProcessing || !hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragActive(false);
    }
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = 0;
    setIsDragActive(false);
    if (isProcessing) return;
    const files = Array.from(event.dataTransfer.files ?? []);
    enqueueFiles(files);
  }

  function removeFromQueue(queueItemId: string) {
    setUploadQueue((prev) => prev.filter((item) => item.id !== queueItemId));
  }

  function updateQueueBookNumber(queueItemId: string, nextValue: number) {
    setUploadQueue((prev) => prev.map((item) => (
      item.id === queueItemId
        ? { ...item, bookNumber: Math.max(1, Math.floor(nextValue) || 1) }
        : item
    )));
  }

  function toOverallProgress(currentFile: number, totalFiles: number, perFileProgress: number): number {
    const safePerFile = Math.max(0, Math.min(100, Math.round(perFileProgress)));
    return Math.round((((currentFile - 1) + safePerFile / 100) / Math.max(1, totalFiles)) * 100);
  }

  function validateSeriesQueue(
    queue: UploadQueueItem[],
    existingSeriesBooks: Book[]
  ): string | null {
    if (queue.length === 0) {
      return 'Select at least one EPUB file.';
    }

    const numbers = queue.map((item) => item.bookNumber);
    if (numbers.some((value) => !Number.isInteger(value) || value < 1)) {
      return 'Series order must use whole numbers starting at 1.';
    }

    const unique = new Set(numbers);
    if (unique.size !== numbers.length) {
      return 'Each queued file must have a unique series order number.';
    }

    const existingNumbers = new Set(existingSeriesBooks.map((book) => book.bookNumber).filter((value): value is number => typeof value === 'number'));
    const conflict = numbers.find((value) => existingNumbers.has(value));
    if (typeof conflict === 'number') {
      return `Book number ${conflict} already exists in this series.`;
    }

    return null;
  }

  function throwIfCancelled() {
    if (cancelRequestedRef.current || activeAbortControllerRef.current?.signal.aborted) {
      throw new Error(CANCELLED_UPLOAD);
    }
  }

  function requestCancel() {
    if (!isProcessing) {
      onClose();
      return;
    }

    cancelRequestedRef.current = true;
    activeAbortControllerRef.current?.abort();
    setLoadingLabel('Cancelling upload...');
  }

  async function ingestParsedBook(
    parsedBook: { title: string; author: string; chapters: Array<{ chapterNumber: number; title: string; text: string }> },
    assignment: { seriesId: string | null; finalBookNumber: number | null; status: Book['status'] },
    progressContext: { currentFile: number; totalFiles: number }
  ): Promise<string> {
    const db = await getDb();
    const bookId = createId();

    try {
      throwIfCancelled();

      setLoadingLabel(
        `Chunking ${progressContext.currentFile}/${progressContext.totalFiles}: ${parsedBook.title}`
      );

      const chunkDrafts: Array<{
        chapterNumber: number;
        chapterLabel: string;
        chunkIndex: number;
        content: string;
        tokenCount: number;
      }> = [];

      for (const chapter of parsedBook.chapters) {
        throwIfCancelled();

        const chunks = chunkChapter(chapter.chapterNumber, chapter.text);
        for (const chunk of chunks) {
          chunkDrafts.push({
            chapterNumber: chunk.chapterNumber,
            chapterLabel: chapter.title,
            chunkIndex: chunk.chunkIndex,
            content: chunk.content,
            tokenCount: chunk.tokenCount,
          });
        }
      }

      if (chunkDrafts.length === 0) {
        throw new Error(`No readable text chunks found in ${parsedBook.title}. Upload a DRM-free EPUB with extractable text.`);
      }

      const baseBook: Book = {
        id: bookId,
        title: parsedBook.title,
        author: parsedBook.author,
        totalChapters: parsedBook.chapters.length,
        currentChapter: 0,
        processingStatus: 'processing',
        seriesId: assignment.seriesId,
        bookNumber: assignment.finalBookNumber,
        status: assignment.status,
        hasLocalContent: true,
        ingestion: {
          ...defaultIngestionMetadata('processing'),
          stage: 'parse',
          completed: 1,
          total: 1,
          percentage: 100,
        },
        createdAt: new Date().toISOString()
      };

      await db.put('books', baseBook);

      if (assignment.seriesId) {
        const seriesRecord = await db.get('series', assignment.seriesId);
        if (seriesRecord) {
          const updatedOrder = [...seriesRecord.bookOrder, bookId];
          const orderedBooks = await Promise.all(updatedOrder.map((id) => db.get('books', id)));
          seriesRecord.bookOrder = orderedBooks
            .filter(Boolean)
            .sort((a, b) => (a!.bookNumber ?? 9999) - (b!.bookNumber ?? 9999))
            .map((book) => book!.id);
          await db.put('series', seriesRecord);
          await recomputeSeriesProgression(assignment.seriesId);
        }
      }

      for (const chapter of parsedBook.chapters) {
        throwIfCancelled();

        await db.put('chapters', {
          bookId,
          chapterNumber: chapter.chapterNumber,
          title: chapter.title
        });
      }

      const totalChunks = chunkDrafts.length;
      let chunkedCount = 0;
      for (const chunk of chunkDrafts) {
        throwIfCancelled();

        await db.add('chunks', {
          bookId,
          chapterNumber: chunk.chapterNumber,
          chapterLabel: chunk.chapterLabel,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          embedding: null
        });
        chunkedCount += 1;

        if (chunkedCount % 10 === 0 || chunkedCount === totalChunks) {
          const percent = Math.round((chunkedCount / Math.max(1, totalChunks)) * 100);
          setModalProgress(toOverallProgress(
            progressContext.currentFile,
            progressContext.totalFiles,
            8 + percent * 0.28
          ));
          const current = await db.get('books', bookId);
          if (current) {
            current.ingestion = {
              ...current.ingestion,
              stage: 'chunk',
              completed: chunkedCount,
              total: Math.max(1, totalChunks),
              percentage: percent,
              error: null,
              updatedAt: new Date().toISOString(),
            };
            await db.put('books', current);
          }
        }
      }

      await resumeBookIngestion(bookId, authToken, (meta) => {
        setLoadingLabel(
          `${formatIngestionLabel(meta)} (${progressContext.currentFile}/${progressContext.totalFiles})`
        );
        setModalProgress(toOverallProgress(
          progressContext.currentFile,
          progressContext.totalFiles,
          mapStageProgress(meta)
        ));
      }, {
        signal: activeAbortControllerRef.current?.signal,
        shouldCancel: () => cancelRequestedRef.current,
      });
      return bookId;
    } catch (err) {
      await deleteBook(bookId);
      throw err;
    }
  }

  async function processFiles() {
    if (uploadQueue.length === 0) {
      setError('Select at least one EPUB file.');
      return;
    }

    if (!canAssign) {
      setError('Complete assignment settings first.');
      return;
    }

    setError(null);
    setIsProcessing(true);
    cancelRequestedRef.current = false;
    activeAbortControllerRef.current = new AbortController();
    let createdSeriesId: string | null = null;
    const createdBookIds: string[] = [];
    let queue = [...uploadQueue];
    let failedIndex = -1;
    let failedQueueItem: UploadQueueItem | null = null;

    try {
      const db = await getDb();
      let resolvedSeriesId: string | null = null;

      if (mode === 'existing-series') {
        resolvedSeriesId = selectedSeriesId;

        const existingSeriesBooks = books.filter((book) => book.seriesId === resolvedSeriesId);
        const queueError = validateSeriesQueue(queue, existingSeriesBooks);
        if (queueError) {
          throw new Error(queueError);
        }
      }

      if (mode === 'new-series') {
        const queueError = validateSeriesQueue(queue, []);
        if (queueError) {
          throw new Error(queueError);
        }
      }

      if (mode !== 'standalone') {
        queue = [...queue].sort((a, b) => a.bookNumber - b.bookNumber);
      }

      for (let index = 0; index < queue.length; index += 1) {
        throwIfCancelled();
        failedIndex = index;

        const queueItem = queue[index];
        failedQueueItem = queueItem;

        if (mode === 'new-series' && !resolvedSeriesId) {
          resolvedSeriesId = createId();
          createdSeriesId = resolvedSeriesId;
          await db.put('series', {
            id: resolvedSeriesId,
            name: newSeriesName.trim(),
            bookOrder: [],
            createdAt: new Date().toISOString()
          });
        }

        setLoadingLabel(`Parsing ${index + 1}/${queue.length}: ${queueItem.file.name}`);
        setModalProgress(toOverallProgress(index + 1, queue.length, 3));
        const parsedBook = await parseEpub(queueItem.file);
        throwIfCancelled();

        let status: Book['status'] = 'reading';
        let finalBookNumber: number | null = null;

        if (resolvedSeriesId) {
          finalBookNumber = queueItem.bookNumber;
          const seriesBooks = (await db.getAllFromIndex('books', 'by-series', resolvedSeriesId)).sort(
            (a, b) => (a.bookNumber ?? 9999) - (b.bookNumber ?? 9999)
          );

          if (seriesBooks.some((book) => (book.bookNumber ?? 0) === finalBookNumber)) {
            throw new Error(`Book number ${finalBookNumber} already exists in this series.`);
          }

          const priorBooks = seriesBooks.filter((book) => (book.bookNumber ?? 0) < (finalBookNumber ?? 1));
          status = priorBooks.length === 0
            ? 'reading'
            : priorBooks.every((book) => book.status === 'done')
              ? 'reading'
              : 'locked';
        }

        const createdBookId = await ingestParsedBook(
          parsedBook,
          {
            seriesId: resolvedSeriesId,
            finalBookNumber,
            status,
          },
          {
            currentFile: index + 1,
            totalFiles: queue.length,
          }
        );
        createdBookIds.push(createdBookId);
        failedQueueItem = null;
      }

      setModalProgress(100);
      if (createdBookIds.length > 0) {
        await onComplete();
      }
      setUploadQueue([]);
      onClose();
    } catch (err) {
      console.error('File upload batch failed', {
        error: err,
        mode,
        selectedSeriesId,
        queueSize: uploadQueue.length,
        queuedFiles: uploadQueue.map((item) => ({
          name: item.file.name,
          size: item.file.size,
          order: item.bookNumber,
        })),
        createdSeriesId,
        createdBookIds,
      });

      if (createdSeriesId && createdBookIds.length === 0) {
        try {
          await deleteSeries(createdSeriesId);
        } catch (seriesDeleteError) {
          console.error('Failed to remove empty series after upload failure', seriesDeleteError);
        }
      }

      if (createdBookIds.length > 0) {
        await onComplete();
      }

      if (failedIndex >= 0) {
        setUploadQueue(queue.slice(failedIndex));
      }

      const failedName = failedQueueItem?.file.name;
      if (
        (err instanceof Error && err.message === CANCELLED_UPLOAD) ||
        (isProviderRequestError(err) && err.code === 'embed_cancelled')
      ) {
        setError(
          failedName
            ? `Upload cancelled while processing ${failedName}. Completed books were kept.`
            : 'Upload cancelled. Completed books were kept.'
        );
      } else if (
        err instanceof Error &&
        (
          err.message.startsWith('Book number') ||
          err.message.startsWith('Series order') ||
          err.message.startsWith('Each queued file') ||
          err.message.startsWith('Select at least one EPUB file.') ||
          err.message.startsWith('Complete assignment settings')
        )
      ) {
        setError(err.message);
      } else if (err instanceof Error && err.message) {
        setError(
          failedName
            ? `${err.message} (${failedName})`
            : err.message
        );
      } else {
        setError(
          failedName
            ? `Upload failed while processing ${failedName}. Completed books were kept.`
            : 'Upload failed. Completed books were kept.'
        );
      }
    } finally {
      setIsProcessing(false);
      setLoadingLabel(null);
      activeAbortControllerRef.current = null;
      cancelRequestedRef.current = false;
    }
  }

  if (!open) return null;

  return (
    <div className="rp-modal-backdrop fixed inset-0 z-40 flex items-center justify-center p-4">
      <div
        className={`rp-modal w-full max-w-5xl p-6 ${isDragActive ? 'border-2 border-dashed border-[var(--accent-binding)] bg-[rgba(99,102,241,0.06)]' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Add books"
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Add Books</h2>
            <p className="mt-1 text-sm text-[var(--ink-secondary)]">
              Queue multiple EPUB files and assign their series order before uploading.
            </p>
          </div>
          <button className="rp-btn rp-btn-secondary" onClick={requestCancel}>
            {isProcessing ? 'Cancel Upload' : 'Close'}
          </button>
        </div>

        <div className="mt-5 grid gap-4">
          <section className="rp-surface p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">Assignment</p>

            <div className="mt-3 space-y-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  checked={mode === 'standalone'}
                  disabled={isProcessing}
                  onChange={() => setMode('standalone')}
                />
                Standalone book(s)
              </label>

              <label className="block">
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={mode === 'existing-series'}
                    disabled={isProcessing}
                    onChange={() => setMode('existing-series')}
                  />
                  Add to existing series
                </div>
                {mode === 'existing-series' ? (
                  <div className="mt-2 ml-6 grid gap-2">
                    <select
                      className="rp-select"
                      value={selectedSeriesId}
                      disabled={isProcessing}
                      onChange={(event) => {
                        const nextSeriesId = event.target.value;
                        setSelectedSeriesId(nextSeriesId);
                      }}
                    >
                      <option value="">Select series</option>
                      {series.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
              </label>

              <label className="block">
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    checked={mode === 'new-series'}
                    disabled={isProcessing}
                    onChange={() => setMode('new-series')}
                  />
                  Create new series
                </div>
                {mode === 'new-series' ? (
                  <div className="mt-2 ml-6 grid gap-2">
                    <input
                      value={newSeriesName}
                      disabled={isProcessing}
                      onChange={(event) => setNewSeriesName(event.target.value)}
                      placeholder="Series name"
                      className="rp-field"
                    />
                  </div>
                ) : null}
              </label>
            </div>
          </section>

          <section className="rp-surface p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-tertiary)]">Files</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".epub"
              className="hidden"
              multiple
              onChange={onInput}
            />

            <button
              className="rp-btn rp-btn-secondary mt-3 w-full"
              disabled={isProcessing}
              onClick={chooseFiles}
            >
              Choose EPUB file(s)
            </button>
            {isDragActive ? (
              <p className="mt-2 text-sm font-medium text-[var(--accent-binding)]">Drop EPUB files to add them to the queue</p>
            ) : null}

            <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--line-subtle)] bg-[var(--bg-elevated)] p-3">
              {uploadQueue.length === 0 ? (
                <p className="text-sm text-[var(--ink-tertiary)]">No files selected.</p>
              ) : (
                <div className="space-y-2">
                  {uploadQueue.map((item) => (
                    <div key={item.id} className="rounded-[var(--radius-sm)] border border-[var(--line-subtle)] bg-[var(--paper-elevated)] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm text-[var(--ink-secondary)]" title={item.file.name}>{item.file.name}</p>
                        <button
                          type="button"
                          className="text-xs font-medium text-[var(--ink-tertiary)] hover:text-[var(--danger-ink)]"
                          disabled={isProcessing}
                          onClick={() => removeFromQueue(item.id)}
                        >
                          Remove
                        </button>
                      </div>
                      {mode !== 'standalone' ? (
                        <div className="mt-2 flex items-center gap-2">
                          <label className="text-xs font-medium text-[var(--ink-tertiary)]">Series order</label>
                          <input
                            type="number"
                            min={1}
                            value={item.bookNumber}
                            disabled={isProcessing}
                            onChange={(event) => updateQueueBookNumber(item.id, Number(event.target.value) || 1)}
                            className="rp-field h-9 w-24"
                          />
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {isProcessing ? (
              <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--line-subtle)] bg-[var(--bg-elevated)] p-3" aria-live="polite">
                <p className="text-sm font-medium text-[var(--text-primary)]">{loadingLabel ?? 'Processing...'}</p>
                <div className="mt-2 flex items-center gap-3">
                  <progress className="h-2 w-full" value={modalProgress} max={100} />
                  <span className="w-12 text-right text-xs font-semibold text-[var(--accent)]">{modalProgress}%</span>
                </div>
              </div>
            ) : null}

          </section>
        </div>

        <div className="mt-5 flex items-center justify-between gap-2">
          {error ? <p className="text-sm text-[var(--danger)]" role="alert">{error}</p> : <span />}
          <div className="flex justify-end gap-2">
          <button type="button" className="rp-btn rp-btn-secondary" disabled={isProcessing} onClick={onClose}>
            Close
          </button>
          {isProcessing ? (
            <button type="button" className="rp-btn rp-btn-secondary" onClick={requestCancel}>
              Cancel Upload
            </button>
          ) : null}
          <button
            type="button"
            disabled={isProcessing || !canAssign || uploadQueue.length === 0}
            className="rp-btn rp-btn-primary"
            onClick={() => void processFiles()}
          >
            {isProcessing ? 'Uploading...' : error ? 'Retry Upload' : uploadQueue.length > 1 ? 'Add Books' : 'Add Book'}
          </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function getSuggestedBookNumber(seriesId: string, books: Book[]): number {
  const existing = books
    .filter((book) => book.seriesId === seriesId)
    .map((book) => book.bookNumber ?? 0);
  const maxNumber = existing.length > 0 ? Math.max(...existing) : 0;
  return Math.max(1, maxNumber + 1);
}
