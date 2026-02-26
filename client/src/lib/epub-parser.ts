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
  chapters: ParsedChapter[];
}

interface EpubBook {
  ready: Promise<void>;
  loaded: {
    metadata: Promise<{ title?: string; creator?: string }>;
  };
  navigation?: {
    toc?: TocItem[];
  };
  spine: {
    items: Array<{ href: string; label?: string }>;
  };
  load: (href: string) => Promise<Document>;
  destroy: () => void;
}

interface TocItem {
  href?: string;
  label?: string;
  subitems?: TocItem[];
}

export async function parseEpub(file: File): Promise<ParsedBook> {
  const arrayBuffer = await file.arrayBuffer();
  const book = ePub(arrayBuffer) as EpubBook;
  await book.ready;

  const metadata = await book.loaded.metadata;
  const title = metadata.title || file.name.replace(/\.epub$/i, '') || 'Unknown Title';
  const author = metadata.creator || 'Unknown Author';

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
      spineItems: book.spine.items.length,
      tocEntries: tocLabelByHref.size,
      parsedChapters: chapters.length,
    });
    console.table(debugRows);
  }

  book.destroy();
  return { title, author, chapters };
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
