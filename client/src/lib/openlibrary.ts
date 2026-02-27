const OPEN_LIBRARY_BASE = 'https://openlibrary.org';
const OPEN_LIBRARY_COVERS_BASE = 'https://covers.openlibrary.org/b/id';
const REQUEST_TIMEOUT_MS = 8_000;

function devLog(message: string, payload?: unknown): void {
  if (!import.meta.env.DEV) return;
  if (payload === undefined) {
    console.info(`[openlibrary] ${message}`);
    return;
  }
  console.info(`[openlibrary] ${message}`, payload);
}

export interface OpenLibraryMetadata {
  title: string;
  author: string;
  publicationYear: number | null;
  coverUrl: string | null;
  seriesName: string | null;
  seriesOrder: number | null;
  confidence: 'exact_isbn' | 'high' | 'medium' | 'low';
  matchedBy: 'isbn' | 'title_author';
}

export interface OpenLibraryCoverCandidate {
  id: string;
  url: string;
  source: 'work_cover_i' | 'edition_cover_i' | 'edition_olid' | 'isbn';
  label: string;
}

type OpenLibraryDoc = {
  key?: string;
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  publish_year?: number[];
  cover_i?: number;
  cover_edition_key?: string;
  series?: string[];
  editions?: {
    docs?: Array<{
      key?: string;
      title?: string;
      cover_i?: number;
      isbn?: string[];
    }>;
  };
};

type OpenLibrarySearchResponse = {
  docs?: OpenLibraryDoc[];
};

interface SearchAttempt {
  label: string;
  title: string;
  author: string;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

function scoreCandidate(doc: OpenLibraryDoc, title: string, author: string): number {
  const targetTitle = normalizeText(title);
  const targetAuthor = normalizeText(author);
  const candidateTitle = normalizeText(doc.title ?? '');
  const candidateAuthor = normalizeText(doc.author_name?.[0] ?? '');

  let score = 0;
  if (candidateTitle === targetTitle) score += 6;
  else if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) score += 3;

  if (targetAuthor && candidateAuthor === targetAuthor) score += 4;
  else if (targetAuthor && (candidateAuthor.includes(targetAuthor) || targetAuthor.includes(candidateAuthor))) score += 2;

  if (typeof doc.cover_i === 'number') score += 1;
  return score;
}

function scoreTitleOnly(doc: OpenLibraryDoc, title: string): number {
  const targetTitle = normalizeText(title);
  const candidateTitle = normalizeText(doc.title ?? '');
  if (!candidateTitle || !targetTitle) return 0;
  if (candidateTitle === targetTitle) return 5;
  if (candidateTitle.includes(targetTitle) || targetTitle.includes(candidateTitle)) return 3;
  return 0;
}

function parseSeriesOrder(seriesText: string): number | null {
  const hashMatch = seriesText.match(/#\s*(\d+(?:\.\d+)?)/i);
  if (hashMatch) {
    const value = Number.parseFloat(hashMatch[1]);
    return Number.isFinite(value) ? value : null;
  }

  const bookMatch = seriesText.match(/\bbook\s+(\d+(?:\.\d+)?)/i);
  if (bookMatch) {
    const value = Number.parseFloat(bookMatch[1]);
    return Number.isFinite(value) ? value : null;
  }

  return null;
}

function parseSeriesName(seriesText: string): string {
  return seriesText
    .replace(/\s*[#:]\s*\d+(?:\.\d+)?\s*$/i, '')
    .replace(/\s+book\s+\d+(?:\.\d+)?\s*$/i, '')
    .trim();
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeIsbn(value: string): string {
  return value.replace(/[^0-9xX]/g, '').toUpperCase();
}

function isValidIsbn(value: string): boolean {
  return value.length === 10 || value.length === 13;
}

function titleVariants(title: string): string[] {
  const input = title.trim();
  if (!input) return [];
  const variants = new Set<string>([input]);
  variants.add(input.replace(/\s*\([^)]*\)\s*$/g, '').trim());
  variants.add(input.replace(/\s*[-:]\s*.*$/g, '').trim());
  variants.add(input.replace(/\s*\((?:book|volume|vol\.)\s*\d+[^)]*\)\s*$/gi, '').trim());
  variants.add(input.replace(/\s*(?:book|volume|vol\.)\s*\d+\s*$/gi, '').trim());
  return [...variants].filter((value) => value.length > 0);
}

function parseConfidence(score: number, byIsbn: boolean): OpenLibraryMetadata['confidence'] {
  if (byIsbn) return 'exact_isbn';
  if (score >= 9) return 'high';
  if (score >= 6) return 'medium';
  return 'low';
}

function toMetadata(doc: OpenLibraryDoc, confidence: OpenLibraryMetadata['confidence'], matchedBy: OpenLibraryMetadata['matchedBy'], fallbackTitle: string, fallbackAuthor: string): OpenLibraryMetadata {
  const rawSeries = doc.series?.[0]?.trim() || '';
  const seriesName = rawSeries ? parseSeriesName(rawSeries) : null;
  const seriesOrder = rawSeries ? parseSeriesOrder(rawSeries) : null;
  let publicationYear: number | null = typeof doc.first_publish_year === 'number' ? doc.first_publish_year : null;
  if (!publicationYear && Array.isArray(doc.publish_year) && doc.publish_year.length > 0) {
    const candidate = [...doc.publish_year]
      .filter((year) => Number.isFinite(year) && year > 1400 && year < 2500)
      .sort((a, b) => a - b)[0];
    publicationYear = typeof candidate === 'number' ? candidate : null;
  }

  return {
    title: (doc.title || fallbackTitle).trim(),
    author: (doc.author_name?.[0] || fallbackAuthor || 'Unknown Author').trim(),
    publicationYear,
    coverUrl: typeof doc.cover_i === 'number' ? `${OPEN_LIBRARY_COVERS_BASE}/${doc.cover_i}-L.jpg` : null,
    seriesName: seriesName && seriesName.length > 0 ? seriesName : null,
    seriesOrder,
    confidence,
    matchedBy,
  };
}

async function runSearch(query: URLSearchParams): Promise<OpenLibraryDoc[]> {
  const response = await fetchWithTimeout(`${OPEN_LIBRARY_BASE}/search.json?${query.toString()}`, REQUEST_TIMEOUT_MS);
  if (!response.ok) {
    devLog('lookup response not ok', { status: response.status, statusText: response.statusText });
    return [];
  }
  const body = (await response.json()) as OpenLibrarySearchResponse;
  const docs = Array.isArray(body.docs) ? body.docs : [];
  return docs;
}

export async function lookupOpenLibraryMetadata(title: string, author: string, isbns: string[] = []): Promise<OpenLibraryMetadata | null> {
  const cleanTitle = title.trim();
  const cleanAuthor = author.trim();
  if (!cleanTitle) return null;

  try {
    const normalizedIsbns = [...new Set(isbns.map(sanitizeIsbn).filter(isValidIsbn))];
    devLog('lookup start', { title: cleanTitle, author: cleanAuthor, isbnCount: normalizedIsbns.length });

    for (const isbn of normalizedIsbns) {
      const isbnQuery = new URLSearchParams({
        isbn,
        limit: '5',
      });
      const docs = await runSearch(isbnQuery);
      if (docs.length === 0) continue;
      const bestByIsbn = [...docs].sort((a, b) => scoreTitleOnly(b, cleanTitle) - scoreTitleOnly(a, cleanTitle))[0];
      if (!bestByIsbn) continue;
      const result = toMetadata(bestByIsbn, 'exact_isbn', 'isbn', cleanTitle, cleanAuthor);
      devLog('lookup matched', {
        matchedBy: result.matchedBy,
        confidence: result.confidence,
        title: result.title,
        author: result.author,
        publicationYear: result.publicationYear,
        cover: Boolean(result.coverUrl),
        seriesName: result.seriesName,
        seriesOrder: result.seriesOrder,
      });
      return result;
    }

    const attempts: SearchAttempt[] = titleVariants(cleanTitle).map((variant, index) => ({
      label: index === 0 ? 'raw' : `variant-${index}`,
      title: variant,
      author: cleanAuthor,
    }));

    let bestDoc: OpenLibraryDoc | null = null;
    let bestScore = -1;

    for (const attempt of attempts) {
      const query = new URLSearchParams({
        title: attempt.title,
        limit: '10',
      });
      if (attempt.author) {
        query.set('author', attempt.author);
      }
      const docs = await runSearch(query);
      if (docs.length === 0) {
        devLog('lookup attempt no docs', { attempt: attempt.label, title: attempt.title, author: attempt.author });
        continue;
      }
      const candidate = [...docs].sort((a, b) => scoreCandidate(b, attempt.title, attempt.author) - scoreCandidate(a, attempt.title, attempt.author))[0];
      if (!candidate) continue;
      const score = scoreCandidate(candidate, attempt.title, attempt.author);
      if (score > bestScore) {
        bestScore = score;
        bestDoc = candidate;
      }
    }

    if (!bestDoc) {
      devLog('lookup no best candidate');
      return null;
    }

    const confidence = parseConfidence(bestScore, false);
    const result = toMetadata(bestDoc, confidence, 'title_author', cleanTitle, cleanAuthor);
    devLog('lookup matched', {
      matchedBy: result.matchedBy,
      confidence: result.confidence,
      title: result.title,
      author: result.author,
      publicationYear: result.publicationYear,
      cover: Boolean(result.coverUrl),
      seriesName: result.seriesName,
      seriesOrder: result.seriesOrder,
    });
    return result;
  } catch (error) {
    devLog('lookup request failed', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

function buildCoverUrlById(coverId: number): string {
  return `${OPEN_LIBRARY_COVERS_BASE}/${coverId}-L.jpg?default=false`;
}

function buildCoverUrlByOlid(olid: string): string {
  return `https://covers.openlibrary.org/b/olid/${olid}-L.jpg?default=false`;
}

function buildCoverUrlByIsbn(isbn: string): string {
  return `https://covers.openlibrary.org/b/isbn/${isbn}-L.jpg?default=false`;
}

function extractOlidFromKey(key: string | undefined): string | null {
  if (!key) return null;
  const match = key.match(/\/books\/(OL[0-9A-Z]+M)/i);
  return match?.[1]?.toUpperCase() ?? null;
}

export async function lookupOpenLibraryCoverCandidates(
  title: string,
  author: string,
  isbns: string[] = []
): Promise<OpenLibraryCoverCandidate[]> {
  const cleanTitle = title.trim();
  const cleanAuthor = author.trim();
  if (!cleanTitle) return [];

  const query = new URLSearchParams({
    title: cleanTitle,
    limit: '8',
    fields: 'key,title,author_name,cover_i,cover_edition_key,editions,editions.key,editions.title,editions.cover_i,editions.isbn',
  });
  if (cleanAuthor) {
    query.set('author', cleanAuthor);
  }

  try {
    const docs = await runSearch(query);
    if (docs.length === 0) return [];

    const best = [...docs]
      .sort((a, b) => scoreCandidate(b, cleanTitle, cleanAuthor) - scoreCandidate(a, cleanTitle, cleanAuthor))[0];
    if (!best) return [];

    const candidates: OpenLibraryCoverCandidate[] = [];
    const seenUrls = new Set<string>();

    const addCandidate = (candidate: OpenLibraryCoverCandidate | null) => {
      if (!candidate) return;
      if (seenUrls.has(candidate.url)) return;
      seenUrls.add(candidate.url);
      candidates.push(candidate);
    };

    if (typeof best.cover_i === 'number') {
      addCandidate({
        id: `work-cover-${best.cover_i}`,
        url: buildCoverUrlById(best.cover_i),
        source: 'work_cover_i',
        label: 'Work cover',
      });
    }

    const editionDocs = Array.isArray(best.editions?.docs) ? best.editions.docs : [];
    for (const edition of editionDocs) {
      if (typeof edition.cover_i === 'number') {
        addCandidate({
          id: `edition-cover-${edition.cover_i}`,
          url: buildCoverUrlById(edition.cover_i),
          source: 'edition_cover_i',
          label: edition.title?.trim() || 'Edition cover',
        });
      }

      const editionOlid = extractOlidFromKey(edition.key);
      if (editionOlid) {
        addCandidate({
          id: `edition-olid-${editionOlid}`,
          url: buildCoverUrlByOlid(editionOlid),
          source: 'edition_olid',
          label: `${edition.title?.trim() || 'Edition'} (OLID)`,
        });
      }
    }

    const normalizedIsbns = [...new Set(isbns.map(sanitizeIsbn).filter(isValidIsbn))];
    for (const isbn of normalizedIsbns) {
      addCandidate({
        id: `isbn-${isbn}`,
        url: buildCoverUrlByIsbn(isbn),
        source: 'isbn',
        label: `ISBN ${isbn}`,
      });
    }

    return candidates.slice(0, 12);
  } catch {
    return [];
  }
}
