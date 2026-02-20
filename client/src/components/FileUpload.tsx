import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { chunkChapter } from '../lib/chunker';
import { deleteBook, deleteSeries, getDb, recomputeSeriesProgression } from '../lib/db';
import { parseEpub } from '../lib/epub-parser';
import { defaultIngestionMetadata } from '../lib/ingestion-state';
import { formatIngestionLabel, resumeBookIngestion } from '../lib/ingestion';
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

export default function FileUpload({
  open,
  authToken,
  series,
  books,
  preferredSeriesId,
  onClose,
  onComplete
}: FileUploadProps) {
  const [loadingLabel, setLoadingLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<UploadMode>('standalone');
  const [selectedSeriesId, setSelectedSeriesId] = useState<string>('');
  const [newSeriesName, setNewSeriesName] = useState('');
  const [bookNumber, setBookNumber] = useState(1);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [modalProgress, setModalProgress] = useState<number>(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
    setSelectedFiles([]);
    setNewSeriesName('');

    if (!preferredSeriesId) {
      setMode('standalone');
      setSelectedSeriesId('');
      setBookNumber(1);
    }

    if (preferredSeriesId) {
      setMode('existing-series');
      setSelectedSeriesId(preferredSeriesId);
      setBookNumber(getSuggestedBookNumber(preferredSeriesId, books));
    }
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

  function onInput(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;
    setError(null);

    const filtered = files.filter((file) => file.name.toLowerCase().endsWith('.epub'));
    if (filtered.length !== files.length) {
      setError('Only EPUB files are supported.');
    }

    if (mode !== 'standalone' && filtered.length > 1) {
      setError('Series assignment supports one book at a time. Switch to standalone for bulk upload.');
      setSelectedFiles(filtered.slice(0, 1));
    } else {
      setSelectedFiles(filtered);
    }

    event.target.value = '';
  }

  async function ingestParsedBook(
    parsedBook: { title: string; author: string; chapters: Array<{ chapterNumber: number; title: string; text: string }> },
    assignment: { seriesId: string | null; finalBookNumber: number | null; status: Book['status'] },
    progressContext: { currentFile: number; totalFiles: number }
  ): Promise<void> {
    const db = await getDb();
    const bookId = crypto.randomUUID();

    try {
      setLoadingLabel(
        `Chunking ${progressContext.currentFile}/${progressContext.totalFiles}: ${parsedBook.title}`
      );

      const chunkDrafts: Array<{
        chapterNumber: number;
        chunkIndex: number;
        content: string;
        tokenCount: number;
      }> = [];

      for (const chapter of parsedBook.chapters) {
        const chunks = chunkChapter(chapter.chapterNumber, chapter.text);
        for (const chunk of chunks) {
          chunkDrafts.push({
            chapterNumber: chunk.chapterNumber,
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
        await db.put('chapters', {
          bookId,
          chapterNumber: chapter.chapterNumber,
          title: chapter.title
        });
      }

      const totalChunks = chunkDrafts.length;
      let chunkedCount = 0;
      for (const chunk of chunkDrafts) {
        await db.add('chunks', {
          bookId,
          chapterNumber: chunk.chapterNumber,
          chunkIndex: chunk.chunkIndex,
          content: chunk.content,
          tokenCount: chunk.tokenCount,
          embedding: null
        });
        chunkedCount += 1;

        if (chunkedCount % 10 === 0 || chunkedCount === totalChunks) {
          const percent = Math.round((chunkedCount / Math.max(1, totalChunks)) * 100);
          setModalProgress(Math.round(8 + percent * 0.28));
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
        setModalProgress(mapStageProgress(meta));
      });
    } catch (err) {
      await deleteBook(bookId);
      throw err;
    }
  }

  async function processFiles() {
    if (selectedFiles.length === 0) {
      setError('Select at least one EPUB file.');
      return;
    }

    if (!canAssign) {
      setError('Complete assignment settings first.');
      return;
    }

    if (mode !== 'standalone' && selectedFiles.length > 1) {
      setError('Series assignment supports one file per upload.');
      return;
    }

    setError(null);
    setIsProcessing(true);
    let createdSeriesId: string | null = null;

    try {
      const db = await getDb();
      let resolvedSeriesId: string | null = null;
      let baseBookNumber: number | null = null;

      if (mode === 'new-series') {
        resolvedSeriesId = crypto.randomUUID();
        createdSeriesId = resolvedSeriesId;
        await db.put('series', {
          id: resolvedSeriesId,
          name: newSeriesName.trim(),
          bookOrder: [],
          createdAt: new Date().toISOString()
        });
        baseBookNumber = bookNumber;
      } else if (mode === 'existing-series') {
        resolvedSeriesId = selectedSeriesId;
        baseBookNumber = bookNumber;
      }

      for (let index = 0; index < selectedFiles.length; index += 1) {
        const file = selectedFiles[index];
        setLoadingLabel(`Parsing ${index + 1}/${selectedFiles.length}: ${file.name}`);
        setModalProgress(3);
        const parsedBook = await parseEpub(file);

        let status: Book['status'] = 'reading';
        let finalBookNumber: number | null = null;

        if (resolvedSeriesId) {
          finalBookNumber = (baseBookNumber ?? 1) + index;
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

        await ingestParsedBook(
          parsedBook,
          {
            seriesId: resolvedSeriesId,
            finalBookNumber,
            status,
          },
          {
            currentFile: index + 1,
            totalFiles: selectedFiles.length,
          }
        );
      }

      setModalProgress(100);
      await onComplete();
      setSelectedFiles([]);
      onClose();
    } catch (err) {
      if (createdSeriesId) {
        const db = await getDb();
        const dangling = await db.get('series', createdSeriesId);
        if (dangling && dangling.bookOrder.length === 0) {
          await deleteSeries(createdSeriesId);
        }
      }
      setError(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setIsProcessing(false);
      setLoadingLabel(null);
    }
  }

  if (!open) return null;

  return (
    <div className="rp-modal-backdrop fixed inset-0 z-40 flex items-center justify-center p-4">
      <div className="rp-modal w-full max-w-4xl p-6" role="dialog" aria-modal="true" aria-label="Add books">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Add Book</h2>
            <p className="mt-1 text-sm text-[var(--ink-secondary)]">
              Choose where new books should go before selecting EPUB files.
            </p>
          </div>
          <button className="rp-btn rp-btn-secondary" onClick={onClose} disabled={isProcessing}>Close</button>
        </div>

        <div className="mt-5 grid gap-4 md:grid-cols-[1.1fr_1fr]">
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
                        if (nextSeriesId) {
                          setBookNumber(getSuggestedBookNumber(nextSeriesId, books));
                        }
                      }}
                    >
                      <option value="">Select series</option>
                      {series.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      min={1}
                      value={bookNumber}
                      disabled={isProcessing}
                      onChange={(event) => setBookNumber(Math.max(1, Number(event.target.value) || 1))}
                      className="rp-field"
                      placeholder="Book number"
                    />
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
                    <input
                      type="number"
                      min={1}
                      value={bookNumber}
                      disabled={isProcessing}
                      onChange={(event) => setBookNumber(Math.max(1, Number(event.target.value) || 1))}
                      className="rp-field"
                      placeholder="Book number"
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
              multiple={mode === 'standalone'}
              onChange={onInput}
            />

            <button
              className="rp-btn rp-btn-secondary mt-3 w-full"
              disabled={isProcessing}
              onClick={chooseFiles}
            >
              {mode === 'standalone' ? 'Choose EPUB file(s)' : 'Choose EPUB file'}
            </button>

            <div className="mt-3 rounded-[var(--radius-sm)] border border-[var(--line-subtle)] bg-[var(--bg-elevated)] p-3">
              {selectedFiles.length === 0 ? (
                <p className="text-sm text-[var(--ink-tertiary)]">No files selected.</p>
              ) : (
                <ul className="space-y-1 text-sm text-[var(--ink-secondary)]">
                  {selectedFiles.map((file) => (
                    <li key={`${file.name}-${file.size}`}>{file.name}</li>
                  ))}
                </ul>
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

            {error ? <p className="mt-3 text-sm text-[var(--danger)]" role="alert">{error}</p> : null}
          </section>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="rp-btn rp-btn-secondary" disabled={isProcessing} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            disabled={isProcessing || !canAssign || selectedFiles.length === 0}
            className="rp-btn rp-btn-primary"
            onClick={() => void processFiles()}
          >
            {isProcessing ? 'Uploading...' : selectedFiles.length > 1 ? 'Add Books' : 'Add Book'}
          </button>
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
