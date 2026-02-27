import ePub from 'epubjs';

const MIN_SECTION_TEXT_LENGTH = 80;

const STRUCTURAL_SECTION_MATCHERS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\btable\s+of\s+contents\b/, reason: 'matched-table-of-contents' },
  { pattern: /\btoc\b/, reason: 'matched-toc' },
  { pattern: /\bcontents\b/, reason: 'matched-contents' },
  { pattern: /\bcopyright\b/, reason: 'matched-copyright' },
  { pattern: /\btitle\s*page\b/, reason: 'matched-title-page' },
  { pattern: /\bcover\b/, reason: 'matched-cover' },
  { pattern: /\bfront\s*matter\b/, reason: 'matched-front-matter' },
  { pattern: /\bback\s*matter\b/, reason: 'matched-back-matter' },
  { pattern: /\bnavigation\b/, reason: 'matched-navigation' },
  { pattern: /\babout\s+the\s+author\b/, reason: 'matched-about-the-author' },
  { pattern: /\backnowledg(?:e)?ments?\b/, reason: 'matched-acknowledgments' },
  { pattern: /\bimprint\b/, reason: 'matched-imprint' },
  { pattern: /\bpublisher\b/, reason: 'matched-publisher' },
  { pattern: /\bcolophon\b/, reason: 'matched-colophon' },
  { pattern: /\bdedication\b/, reason: 'matched-dedication' },
  { pattern: /\bepigraph\b/, reason: 'matched-epigraph' },
  { pattern: /\bendnote(?:s)?\b/, reason: 'matched-endnote' },
  { pattern: /\bars\s+arcanum\b/, reason: 'matched-ars-arcanum' },
];

export interface ParsedChapter {
  chapterNumber: number;
  title: string;
  text: string;
}

export interface ParsedBook {
  title: string;
  author: string;
  publicationYear: number | null;
  coverUrl: string | null;
  isbns: string[];
  chapters: ParsedChapter[];
}

interface EpubBook {
  ready: Promise<void>;
  loaded: {
    metadata: Promise<{
      title?: string;
      creator?: string;
      identifier?: string;
      identifiers?: string | string[] | Record<string, unknown>;
      date?: string;
      published?: string;
      pubdate?: string;
    }>;
  };
  navigation?: {
    toc?: TocItem[];
  };
  spine: {
    items: Array<{ href: string; label?: string }>;
  };
  load: (href: string) => Promise<Document>;
  destroy: () => void;
  coverUrl?: () => Promise<string>;
}

interface TocItem {
  href?: string;
  label?: string;
  subitems?: TocItem[];
}

export interface ParsedBookMetadata {
  title: string;
  author: string;
  publicationYear: number | null;
  isbns: string[];
}

export async function parseEpubMetadata(file: File): Promise<ParsedBookMetadata> {
  const arrayBuffer = await file.arrayBuffer();
  const book = ePub(arrayBuffer) as EpubBook;
  await book.ready;

  const metadata = await book.loaded.metadata;
  const title = metadata.title || file.name.replace(/\.epub$/i, '') || 'Unknown Title';
  const author = metadata.creator || 'Unknown Author';
  const publicationYear = extractPublicationYear(metadata);
  const isbns = extractIsbns(metadata);

  book.destroy();
  return { title, author, publicationYear, isbns };
}

export async function parseEpub(file: File): Promise<ParsedBook> {
  const arrayBuffer = await file.arrayBuffer();
  const book = ePub(arrayBuffer) as EpubBook;
  await book.ready;

  const metadata = await book.loaded.metadata;
  const title = metadata.title || file.name.replace(/\.epub$/i, '') || 'Unknown Title';
  const author = metadata.creator || 'Unknown Author';
  const publicationYear = extractPublicationYear(metadata);
  const isbns = extractIsbns(metadata);

  let coverUrl: string | null = null;
  if (typeof book.coverUrl === 'function') {
    try {
      const candidate = await book.coverUrl();
      if (candidate && candidate.trim().length > 0) {
        coverUrl = await toStableCoverUrl(candidate);
      }
    } catch {
      coverUrl = null;
    }
  }

  const chapters: ParsedChapter[] = [];
  const tocLabelByHref = buildTocLabelMap(book.navigation?.toc ?? []);
  const debugRows: Array<{
    href: string;
    textLength: number;
    chapterLabel: string;
    decision: 'kept' | 'short_text' | 'structural' | 'merged' | 'error';
    reason?: string;
  }> = [];

  for (const item of book.spine.items) {
    try {
      const doc = await book.load(item.href);
      const text = extractText(doc);
      const normalizedHref = normalizeHref(item.href);
      const chapterLabel = resolveChapterLabel(item, doc, tocLabelByHref, chapters.length + 1);

      if (text.length < MIN_SECTION_TEXT_LENGTH) {
        debugRows.push({
          href: normalizedHref,
          textLength: text.length,
          chapterLabel,
          decision: 'short_text',
          reason: `below-${MIN_SECTION_TEXT_LENGTH}`,
        });
        continue;
      }

      const structuralReason = getStructuralSectionReason(chapterLabel, doc);
      if (structuralReason) {
        debugRows.push({
          href: normalizedHref,
          textLength: text.length,
          chapterLabel,
          decision: 'structural',
          reason: structuralReason,
        });
        continue;
      }

      const previous = chapters.at(-1);
      if (previous && normalizeChapterLabel(previous.title) === normalizeChapterLabel(chapterLabel)) {
        previous.text = `${previous.text}\n\n${text}`;
        debugRows.push({
          href: normalizedHref,
          textLength: text.length,
          chapterLabel,
          decision: 'merged',
          reason: 'same-label-as-previous',
        });
      } else {
        chapters.push({
          chapterNumber: chapters.length + 1,
          title: chapterLabel,
          text
        });
        debugRows.push({
          href: normalizedHref,
          textLength: text.length,
          chapterLabel,
          decision: 'kept',
        });
      }
    } catch (error) {
      debugRows.push({
        href: normalizeHref(item.href),
        textLength: 0,
        chapterLabel: item.label || 'Unknown chapter',
        decision: 'error',
        reason: error instanceof Error ? error.message : 'unknown-error',
      });
      continue;
    }
  }

  if (import.meta.env.DEV) {
    console.info('[epub-parser] parse summary', {
      fileName: file.name,
      title,
      author,
      publicationYear,
      coverDetected: Boolean(coverUrl),
      isbnCount: isbns.length,
      spineItems: book.spine.items.length,
      tocEntries: tocLabelByHref.size,
      parsedChapters: chapters.length,
    });
    console.table(debugRows);
  }

  book.destroy();
  return { title, author, publicationYear, coverUrl, isbns, chapters };
}

async function toStableCoverUrl(candidateUrl: string): Promise<string | null> {
  const clean = candidateUrl.trim();
  if (!clean) return null;
  if (clean.startsWith('data:')) return clean;

  try {
    const response = await fetch(clean);
    if (!response.ok) {
      return clean;
    }

    const blob = await response.blob();
    if (!blob || blob.size === 0) {
      return clean;
    }

    return await blobToDataUrl(blob);
  } catch {
    return clean;
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to read cover blob as data URL.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read cover blob.'));
    reader.readAsDataURL(blob);
  });
}

function extractPublicationYear(metadata: { date?: string; published?: string; pubdate?: string }): number | null {
  const candidates = [metadata.date, metadata.published, metadata.pubdate].filter((value): value is string => typeof value === 'string');
  for (const candidate of candidates) {
    const match = candidate.match(/\b(1[4-9]\d{2}|20\d{2}|21\d{2})\b/);
    if (!match) continue;
    const year = Number.parseInt(match[1], 10);
    if (Number.isFinite(year)) return year;
  }
  return null;
}

function extractIsbns(metadata: { identifier?: string; identifiers?: string | string[] | Record<string, unknown> }): string[] {
  const candidates: string[] = [];

  if (typeof metadata.identifier === 'string') {
    candidates.push(metadata.identifier);
  }

  if (Array.isArray(metadata.identifiers)) {
    for (const entry of metadata.identifiers) {
      if (typeof entry === 'string') {
        candidates.push(entry);
      }
    }
  } else if (typeof metadata.identifiers === 'string') {
    candidates.push(metadata.identifiers);
  } else if (metadata.identifiers && typeof metadata.identifiers === 'object') {
    for (const value of Object.values(metadata.identifiers)) {
      if (typeof value === 'string') {
        candidates.push(value);
      } else if (Array.isArray(value)) {
        for (const nested of value) {
          if (typeof nested === 'string') {
            candidates.push(nested);
          }
        }
      }
    }
  }

  const isbnPattern = /\b(?:97[89][\s-]?)?[0-9][0-9\s-]{8,}[0-9Xx]\b/g;
  const normalized = new Set<string>();

  for (const candidate of candidates) {
    const matches = candidate.match(isbnPattern) ?? [];
    for (const match of matches) {
      const compact = match.replace(/[^0-9Xx]/g, '').toUpperCase();
      if (compact.length === 10 || compact.length === 13) {
        normalized.add(compact);
      }
    }
  }

  return [...normalized];
}

function extractText(doc: Document): string {
  const body = doc.body || doc.documentElement;
  return (body.textContent || '').replace(/\s+/g, ' ').trim();
}

function resolveChapterLabel(
  item: { href: string; label?: string },
  doc: Document,
  tocLabelByHref: Map<string, string>,
  fallbackNumber: number
): string {
  const normalizedHref = normalizeHref(item.href);
  const tocLabel = tocLabelByHref.get(normalizedHref);
  const heading = extractHeading(doc);
  const preferred = tocLabel || item.label || heading;
  const cleaned = (preferred || '').replace(/\s+/g, ' ').trim();
  return cleaned || `Chapter ${fallbackNumber}`;
}

function buildTocLabelMap(tocItems: TocItem[]): Map<string, string> {
  const map = new Map<string, string>();

  function walk(items: TocItem[]) {
    for (const item of items) {
      const href = normalizeHref(item.href || '');
      const label = (item.label || '').replace(/\s+/g, ' ').trim();
      if (href && label && !map.has(href)) {
        map.set(href, label);
      }
      if (item.subitems && item.subitems.length > 0) {
        walk(item.subitems);
      }
    }
  }

  walk(tocItems);
  return map;
}

function normalizeHref(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }

  return decoded
    .trim()
    .replace(/^\.?\//, '')
    .replace(/#.*$/, '')
    .replace(/\?.*$/, '')
    .toLowerCase();
}

function extractHeading(doc: Document): string {
  const candidate = doc.querySelector('h1, h2, h3, title')?.textContent;
  return (candidate || '').replace(/\s+/g, ' ').trim();
}

function normalizeChapterLabel(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function getStructuralSectionReason(chapterLabel: string, doc: Document): string | null {
  const docTitle = extractHeading(doc);
  const detectionText = `${chapterLabel} ${docTitle}`.replace(/\s+/g, ' ').trim().toLowerCase();

  for (const matcher of STRUCTURAL_SECTION_MATCHERS) {
    if (matcher.pattern.test(detectionText)) {
      return matcher.reason;
    }
  }

  return null;
}
