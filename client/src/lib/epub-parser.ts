import ePub from 'epubjs';

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
  spine: {
    items: Array<{ href: string; label?: string }>;
  };
  load: (href: string) => Promise<Document>;
  destroy: () => void;
}

export async function parseEpub(file: File): Promise<ParsedBook> {
  const arrayBuffer = await file.arrayBuffer();
  const book = ePub(arrayBuffer) as EpubBook;
  await book.ready;

  const metadata = await book.loaded.metadata;
  const title = metadata.title || file.name.replace(/\.epub$/i, '') || 'Unknown Title';
  const author = metadata.creator || 'Unknown Author';

  const chapters: ParsedChapter[] = [];
  let chapterNumber = 1;

  for (const item of book.spine.items) {
    try {
      const doc = await book.load(item.href);
      const text = extractText(doc);
      if (text.length < 200) continue;

      chapters.push({
        chapterNumber,
        title: item.label || `Chapter ${chapterNumber}`,
        text
      });
      chapterNumber += 1;
    } catch {
      continue;
    }
  }

  book.destroy();
  return { title, author, chapters };
}

function extractText(doc: Document): string {
  const body = doc.body || doc.documentElement;
  return (body.textContent || '').replace(/\s+/g, ' ').trim();
}
