# Reading Partner: Weekend MVP Build Spec

> This document is a complete, implementation-ready specification for building the Reading Partner MVP.
> A developer or LLM agent should be able to follow this document step-by-step and produce a working app.

---

## Table of Contents

1. [Overview](#1-overview)
2. [How It Works (End-to-End Explanation)](#2-how-it-works-end-to-end-explanation)
3. [Architecture](#3-architecture)
4. [Tech Stack](#4-tech-stack)
5. [Project Structure](#5-project-structure)
6. [Server: Thin API Proxy](#6-server-thin-api-proxy)
7. [Client: IndexedDB Schema](#7-client-indexeddb-schema)
8. [EPUB Parsing in the Browser](#8-epub-parsing-in-the-browser)
9. [Chunking](#9-chunking)
10. [Embedding Pipeline](#10-embedding-pipeline)
11. [BM25 Search via MiniSearch](#11-bm25-search-via-minisearch)
12. [Vector Search (Cosine Similarity)](#12-vector-search-cosine-similarity)
13. [Hybrid Retrieval](#13-hybrid-retrieval)
14. [Spoiler Policy Engine](#14-spoiler-policy-engine)
15. [LLM Answer Generation](#15-llm-answer-generation)
16. [API Endpoints (Server)](#16-api-endpoints-server)
17. [Frontend: Pages & Components](#17-frontend-pages--components)
18. [Build Order (Weekend Timeline)](#18-build-order-weekend-timeline)
19. [Testing Checklist](#19-testing-checklist)
20. [Environment Variables](#20-environment-variables)
21. [Key Decisions Reference](#21-key-decisions-reference)

---

## 1. Overview

### What we're building

A web app (PWA) where a user uploads DRM-free EPUBs — either standalone books or entire series — sets their reading progress, and asks questions. The app retrieves relevant passages from content the user has already read (across all books in a series) and generates spoiler-free answers with citations.

**Series support is a core feature, not an add-on.** The primary use case is long fantasy/sci-fi series (Stormlight Archive, Wheel of Time, Malazan) where readers need to recall characters, events, and locations across multiple books without being spoiled on later ones.

### What this is NOT

- Not a book reader (no EPUB rendering)
- Not a social reading app
- No entity/alias extraction (rely on retrieval + LLM)
- No NER model (embeddings + BM25 handle entity lookup)

### The core product promise

**"I will never spoil you."** This is the entire reason the app exists. If a user can't trust it absolutely, they'll just use a wiki and accept the spoiler risk.

---

## 2. How It Works (End-to-End Explanation)

This section explains the full pipeline in plain language. Understanding this is essential before building any component.

### Step 1: Upload & Parse

User uploads an EPUB file. The browser (not the server) parses it into chapters and extracts the plain text from each chapter.

### Step 2: Organize (Standalone or Series)

After parsing, the user is prompted: "Is this part of a series?"

- **No** → the book is standalone. It lives on its own in the library.
- **Yes** → the user either creates a new series (gives it a name) or adds the book to an existing series. They also set the book's position in the series (Book 1, Book 2, etc.).

A series is just an ordered list of books. The user uploads all books individually and assigns them to the series. The app tracks which books are **Done** (fully read), which one is **Reading** (currently in progress), and which are **Locked** (not started yet).

### Step 3: Chunk

Each chapter's text gets split into small pieces (~400 tokens each, roughly a paragraph or two). A full fantasy novel might produce 1,000-2,000 chunks. These chunks are stored in the browser's IndexedDB.

### Step 4: Embed (via OpenAI)

Each chunk's text gets sent to OpenAI's embedding model (via our server proxy). What comes back is a **vector** — a list of 1,536 numbers that mathematically represents the *meaning* of that text.

Think of it this way: the sentence "Kaladin fought on the bridge" and the sentence "the bridgeman battled during the assault" would produce vectors that are close together in mathematical space, because they mean similar things, even though they share almost no words.

These vectors are stored in IndexedDB alongside the original text.

### Step 5: User asks a question

The user types something like "Who is Kaladin?" The question also gets embedded into a vector using the same OpenAI model.

### Step 6: Search (finding the right chunks — across the series)

Two search methods run in parallel, across **all allowed content**:

- **Embedding search**: Compare the question's vector against all chunk vectors using cosine similarity. This finds passages with similar *meaning* (good for "what happened at the battle?" type questions).
- **BM25 keyword search**: Traditional text search that matches exact words. This finds passages containing the exact name "Kaladin" (good for "who is Kaladin?" type questions).

The scores from both searches are combined. **For series, results are filtered using cross-book spoiler gating:**

- Chunks from **Done** books → all allowed
- Chunks from the **Reading** book → only up to the current chapter
- Chunks from **Locked** books → completely blocked

For standalone books, the filter is simply `chapterNumber <= currentChapter`.

**This is the spoiler safety mechanism** — it happens at the data level, not in a prompt. Text from future chapters or unread books physically cannot reach the LLM.

Result: the top 8 most relevant text chunks from content the user has already read, potentially spanning multiple books.

### Step 7: Send to DeepSeek

**Important: we do NOT send embeddings to DeepSeek. We send the original text chunks.** The embeddings were just a tool to *find* the right chunks. They are like a library catalog — they help you locate the right books, but you hand the actual books to the librarian.

DeepSeek receives:
- A system prompt saying "only use these excerpts, no spoilers" with the series context
- The 8 text passages (with book title + chapter labels)
- The user's question

DeepSeek reads the passages and writes a human-readable answer with `[Book Title, Chapter X]` citations.

### The library analogy

- **Embeddings** = the catalog system that helps you find the right books on the shelf
- **Text chunks** = the actual books you pull off the shelf and hand over
- **DeepSeek** = a librarian who reads only the books you hand them, then answers your question

The embeddings never go to DeepSeek. DeepSeek never sees full books. It only sees the small set of relevant passages that the search step found, all from content the reader has already finished.

---

## 3. Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   CLIENT (PWA, on-device)                │
│                                                          │
│  ┌───────────┐   ┌────────────┐   ┌──────────────────┐  │
│  │  Upload    │──▶│  epub.js   │──▶│  Chunker         │  │
│  │  EPUB file │   │  Parser    │   │  (~400 tok each) │  │
│  └───────────┘   └────────────┘   └────────┬─────────┘  │
│                                            │             │
│                              ┌─────────────┼──────────┐  │
│                              ▼             ▼          │  │
│                     ┌──────────────┐ ┌────────────┐   │  │
│                     │  IndexedDB   │ │ MiniSearch  │   │  │
│                     │  - series    │ │ BM25 index  │   │  │
│                     │  - books     │ │ (per series │   │  │
│                     │  - chunks    │ │  or book)   │   │  │
│                     │  - vectors   │ └──────┬─────┘   │  │
│                     │  - metadata  │        │         │  │
│                     └──────┬───────┘        │         │  │
│                            │                │         │  │
│                 ┌──────────▼────────────────▼──────┐  │  │
│                 │  Hybrid Search                   │  │  │
│                 │  (cosine sim + BM25, merged)     │  │  │
│                 └──────────┬───────────────────────┘  │  │
│                            │                          │  │
│                 ┌──────────▼──────────────────────┐   │  │
│                 │  Spoiler Filter (cross-book)    │   │  │
│                 │  Done books: all chapters       │   │  │
│                 │  Reading book: <= current ch     │   │  │
│                 │  Locked books: blocked           │   │  │
│                 └──────────┬──────────────────────┘   │  │
│                            │ filtered text chunks     │  │
└────────────────────────────┼──────────────────────────┘  │
                             │                             │
                             ▼                             │
              ┌──────────────────────────┐                 │
              │  SERVER (thin proxy)     │                 │
              │                          │                 │
              │  POST /api/embed         │◀── chunks text  │
              │    → forwards to OpenAI  │                 │
              │    ← returns vectors     │                 │
              │                          │                 │
              │  POST /api/ask           │◀── top chunks + │
              │    → forwards to DeepSeek│    question     │
              │    ← returns answer      │                 │
              │                          │                 │
              │  Supabase Auth           │                 │
              │    (login, signup, JWT)   │                 │
              └──────────────────────────┘                 │
```

### Key architectural principle

**The client does all the heavy data work.** Parsing, chunking, indexing, searching, and filtering all happen in the browser. The server is a dumb pipe that hides API keys and handles auth. The server has NO database, stores NO book data, and costs near-zero to run.

### Why this architecture?

- **Cost**: No server storage means no scaling costs. 15 users with 20 books each = zero server storage.
- **Privacy**: Book text never leaves the user's device (except small snippets sent for embedding/answering via the server proxy).
- **Offline**: Searching and browsing works offline. Only embedding and LLM calls need connectivity.
- **Persistence**: IndexedDB data survives browser restarts, device reboots, and PWA closures. Data is only lost if the user manually clears browser data. The app requests `navigator.storage.persist()` on startup to prevent automatic eviction.

---

## 4. Tech Stack

### Server (`/server`)

| Purpose | Package | Why |
|---------|---------|-----|
| HTTP framework | `hono` | Lightweight, fast, runs on Vercel/Cloudflare/Node |
| Supabase auth | `@supabase/supabase-js` | Validate JWTs, manage users |
| OpenAI SDK | `openai` | Proxy embedding calls |
| CORS | `hono/cors` middleware | Allow cross-origin from client |
| Runtime | Node.js 20+ | Or deploy as edge function |

The server has **no database dependency**. No SQLite, no Postgres, nothing.

### Client (`/client`)

| Purpose | Package | Why |
|---------|---------|-----|
| Build tool | `vite` | Fast dev server, HMR |
| UI framework | `react` + `react-dom` | Standard |
| Language | `typescript` | Type safety |
| Styling | `tailwindcss` + `postcss` + `autoprefixer` | Utility-first, fast to build |
| EPUB parsing | `epubjs` | Built for browser, handles EPUB extraction |
| BM25 search | `minisearch` | Client-side full-text search with ranking |
| Token counting | `gpt-tokenizer` | Accurate token counts for chunking |
| IndexedDB wrapper | `idb` | Promise-based IndexedDB API (cleaner than raw API) |
| Supabase client | `@supabase/supabase-js` | Auth UI, session management |
| Icons | `lucide-react` | Clean icon set |
| HTTP client | `fetch` (built-in) | No extra dependency |
| Testing | `vitest` | Ships with Vite, zero config, fast |

**No React Router.** The app has three view states managed by `useState`:
- `selectedSeriesId === null && selectedBookId === null` → Library
- `selectedSeriesId !== null` → SeriesChat (series-level chat with cross-book search)
- `selectedBookId !== null && selectedSeriesId === null` → BookChat (standalone book chat)
- "Back" sets the relevant state to `null`

---

## 5. Project Structure

```
reading-partner/
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts              # Entry: Hono app, CORS, route registration
│       ├── middleware/
│       │   └── auth.ts           # Validate Supabase JWT from Authorization header
│       └── routes/
│           ├── embed.ts          # Proxy: receive text chunks, call OpenAI, return vectors
│           └── ask.ts            # Proxy: receive chunks + question, call DeepSeek, return answer
│
├── client/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   └── src/
│       ├── main.tsx              # React entry point
│       ├── App.tsx               # Auth gate + view switching (no router)
│       ├── lib/
│       │   ├── supabase.ts       # Supabase client init
│       │   ├── db.ts             # IndexedDB setup (using idb)
│       │   ├── epub-parser.ts    # EPUB → chapters using epubjs
│       │   ├── chunker.ts        # Chapter text → overlapping chunks
│       │   ├── chunker.test.ts   # Chunker unit tests
│       │   ├── embeddings.ts     # Call server proxy for OpenAI embeddings
│       │   ├── search.ts         # Hybrid retrieval (MiniSearch + cosine sim)
│       │   ├── search.test.ts    # Spoiler gating + hybrid merge tests
│       │   └── llm.ts            # Call server proxy for DeepSeek answers
│       ├── helpers/
│       │   ├── book-status.ts    # buildAllowedBooks, computeMarkAsFinished
│       │   └── book-status.test.ts  # Status transition tests
│       ├── pages/
│       │   ├── Library.tsx       # Series list + standalone books + upload
│       │   ├── SeriesChat.tsx    # Series view: book list + progress + chat
│       │   └── BookChat.tsx      # Standalone book: progress slider + chat
│       ├── components/
│       │   ├── AuthForm.tsx      # Login / signup form (Supabase)
│       │   ├── SeriesCard.tsx    # Series in library list (shows books + statuses)
│       │   ├── BookCard.tsx      # Standalone book in library list
│       │   ├── FileUpload.tsx    # EPUB upload dropzone + series assignment
│       │   ├── CreateSeriesModal.tsx  # Modal to name a new series
│       │   ├── ProgressSlider.tsx    # Chapter progress control
│       │   ├── SeriesBookList.tsx    # Ordered book list within series chat view
│       │   ├── ChatMessage.tsx   # Single message (user or assistant)
│       │   └── ChatInput.tsx     # Text input + send button
│       └── types/
│           └── index.ts          # Shared TypeScript types
│
├── .env                          # Server env vars (gitignored)
├── .gitignore
└── README.md
```

---

## 6. Server: Thin API Proxy

The server does three things:
1. Validates Supabase JWTs (auth middleware)
2. Proxies embedding requests to OpenAI
3. Proxies chat requests to DeepSeek

That's it. No database, no file storage, no business logic.

### Entry point (`server/src/index.ts`)

```typescript
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { embedRoute } from './routes/embed';
import { askRoute } from './routes/ask';

const app = new Hono();

app.use('/*', cors());

app.route('/api', embedRoute);
app.route('/api', askRoute);

app.get('/api/health', (c) => c.json({ status: 'ok' }));

serve({ fetch: app.fetch, port: 3001 }, (info) => {
  console.log(`Server running on http://localhost:${info.port}`);
});
```

### Auth middleware (`server/src/middleware/auth.ts`)

```typescript
import { createClient } from '@supabase/supabase-js';
import type { MiddlewareHandler } from 'hono';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export const authMiddleware: MiddlewareHandler = async (c, next) => {
  const token = c.req.header('Authorization')?.replace('Bearer ', '');
  if (!token) return c.json({ error: 'Unauthorized' }, 401);

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return c.json({ error: 'Unauthorized' }, 401);

  c.set('userId', user.id);
  await next();
};
```

### Embed proxy (`server/src/routes/embed.ts`)

```typescript
import { Hono } from 'hono';
import OpenAI from 'openai';
import { authMiddleware } from '../middleware/auth';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const embedRoute = new Hono();

// Receives an array of text strings, returns an array of embedding vectors
embedRoute.post('/embed', authMiddleware, async (c) => {
  const { texts } = await c.req.json<{ texts: string[] }>();

  if (!texts || texts.length === 0) {
    return c.json({ error: 'No texts provided' }, 400);
  }

  // Process in batches of 100 (OpenAI limit is 2048 but 100 is safer)
  const BATCH_SIZE = 100;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: batch,
    });
    const sorted = response.data.sort((a, b) => a.index - b.index);
    allEmbeddings.push(...sorted.map(d => d.embedding));
  }

  return c.json({ embeddings: allEmbeddings });
});

export { embedRoute };
```

### Ask proxy (`server/src/routes/ask.ts`)

```typescript
import { Hono } from 'hono';
import OpenAI from 'openai';
import { authMiddleware } from '../middleware/auth';

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});

const askRoute = new Hono();

askRoute.post('/ask', authMiddleware, async (c) => {
  const body = await c.req.json<{
    seriesName?: string;
    bookTitle: string;
    currentChapter: number;
    completedBooks?: string[];
    question: string;
    chunks: { content: string; bookTitle: string; chapterNumber: number }[];
  }>();

  const { seriesName, bookTitle, currentChapter, completedBooks, question, chunks } = body;

  const excerpts = chunks
    .map((ch, i) => `[Excerpt ${i + 1}, ${ch.bookTitle}, Chapter ${ch.chapterNumber}]:\n${ch.content}`)
    .join('\n\n---\n\n');

  // Build context description for series or standalone
  let progressDescription: string;
  if (seriesName && completedBooks && completedBooks.length > 0) {
    progressDescription = `The reader is reading the series "${seriesName}". They have completed: ${completedBooks.join(', ')}. They are currently reading "${bookTitle}" and have read up to Chapter ${currentChapter}.`;
  } else if (seriesName) {
    progressDescription = `The reader is reading the series "${seriesName}". They are currently on the first book "${bookTitle}" and have read up to Chapter ${currentChapter}.`;
  } else {
    progressDescription = `The reader is reading "${bookTitle}" and has read up to Chapter ${currentChapter}.`;
  }

  const systemPrompt = `You are a spoiler-free reading companion. ${progressDescription}

CRITICAL RULES — violating any of these is unacceptable:
1. ONLY use the provided excerpts to answer. Do NOT use any knowledge from your training data about this book, series, or any other book.
2. Every factual claim you make MUST be supported by at least one of the provided excerpts.
3. Cite your sources using [Book Title, Chapter X] format inline. If all excerpts are from the same book, you may shorten to [Chapter X].
4. If the excerpts don't contain enough information to fully answer the question, clearly state: "Based on what you've read so far, I don't have enough information to fully answer this."
5. NEVER hint at, speculate about, or reference events, character developments, or plot points from chapters or books the reader has not yet reached.
6. NEVER use phrases like "you'll find out later", "keep reading", or "this becomes important". These are spoilers by implication.
7. Do NOT use any external knowledge about the book, its author, its series, or its fandom.
8. Keep your answer concise (2-5 sentences for simple questions, up to a short paragraph for recaps).

Respond in this JSON format:
{
  "answer": "Your answer with [Book Title, Chapter X] citations inline",
  "citations": [
    {"bookTitle": "The Way of Kings", "chapterNumber": 5, "excerpt": "brief relevant quote from the excerpt"}
  ],
  "confidence": "high | medium | low"
}

Set confidence to:
- "high" if multiple excerpts clearly support the answer
- "medium" if 1-2 excerpts partially support it
- "low" if the excerpts barely address the question`;

  const response = await deepseek.chat.completions.create({
    model: 'deepseek-chat',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `EXCERPTS:\n\n${excerpts}\n\nQUESTION: ${question}` },
    ],
    temperature: 0.3,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
  });

  const raw = response.choices[0].message.content || '{}';

  try {
    const parsed = JSON.parse(raw);
    return c.json(parsed);
  } catch {
    return c.json({ answer: raw, citations: [], confidence: 'low' });
  }
});

export { askRoute };
```

### DeepSeek API note

DeepSeek uses the same API format as OpenAI. The `openai` npm package works with it by changing the `baseURL`. Sign up at https://platform.deepseek.com/ for an API key.

Cost: ~$0.27/M input tokens, ~$1.10/M output tokens. A typical query costs ~$0.001 (one tenth of a cent).

---

## 7. Client: IndexedDB Schema

Use the `idb` package for a clean promise-based API over IndexedDB.

### Database setup (`client/src/lib/db.ts`)

```typescript
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

interface ReadingPartnerDB extends DBSchema {
  series: {
    key: string;                          // series ID (crypto.randomUUID())
    value: {
      id: string;
      name: string;                       // e.g. "The Stormlight Archive"
      bookOrder: string[];                // ordered array of book IDs
      createdAt: string;
    };
  };
  books: {
    key: string;                          // book ID (crypto.randomUUID())
    value: {
      id: string;
      title: string;
      author: string;
      totalChapters: number;
      currentChapter: number;             // 0 = not started
      processingStatus: 'pending' | 'processing' | 'ready' | 'error';
      // Series fields (null if standalone)
      seriesId: string | null;
      bookNumber: number | null;          // position in series (1, 2, 3...)
      // Reading status for series books
      status: 'locked' | 'reading' | 'done';
      createdAt: string;
    };
    indexes: {
      'by-series': string;                // index on seriesId
    };
  };
  chapters: {
    key: [string, number];                // [bookId, chapterNumber]
    value: {
      bookId: string;
      chapterNumber: number;              // 1-indexed
      title: string;
    };
    indexes: {
      'by-book': string;                  // index on bookId
    };
  };
  chunks: {
    key: number;                          // auto-incremented
    value: {
      id?: number;                        // auto-set by IndexedDB
      bookId: string;
      chapterNumber: number;
      chunkIndex: number;
      content: string;                    // the actual text
      tokenCount: number;
      embedding: number[] | null;         // 1536-dim vector, null until embedded
    };
    indexes: {
      'by-book': string;                  // index on bookId
      'by-book-chapter': [string, number]; // compound index [bookId, chapterNumber]
    };
  };
  chatMessages: {
    key: number;                          // auto-incremented
    value: {
      id?: number;
      // For series chat, use seriesId. For standalone, use bookId.
      contextId: string;                  // seriesId or bookId
      contextType: 'series' | 'book';
      role: 'user' | 'assistant';
      content: string;
      citations?: { bookTitle: string; chapterNumber: number; excerpt: string }[];
      confidence?: 'high' | 'medium' | 'low';
      createdAt: string;
    };
    indexes: {
      'by-context': string;               // index on contextId
    };
  };
  searchIndexes: {
    key: string;                          // bookId or seriesId
    value: {
      id: string;
      serialized: string;                 // JSON.stringify(miniSearch)
      updatedAt: string;
    };
  };
}

let dbInstance: IDBPDatabase<ReadingPartnerDB> | null = null;

export async function getDb(): Promise<IDBPDatabase<ReadingPartnerDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<ReadingPartnerDB>('reading-partner', 1, {
    upgrade(db) {
      // Series store
      db.createObjectStore('series', { keyPath: 'id' });

      // Books store
      const bookStore = db.createObjectStore('books', { keyPath: 'id' });
      bookStore.createIndex('by-series', 'seriesId');

      // Chapters store
      const chapterStore = db.createObjectStore('chapters', { keyPath: ['bookId', 'chapterNumber'] });
      chapterStore.createIndex('by-book', 'bookId');

      // Chunks store
      const chunkStore = db.createObjectStore('chunks', { keyPath: 'id', autoIncrement: true });
      chunkStore.createIndex('by-book', 'bookId');
      chunkStore.createIndex('by-book-chapter', ['bookId', 'chapterNumber']);

      // Chat messages store
      const chatStore = db.createObjectStore('chatMessages', { keyPath: 'id', autoIncrement: true });
      chatStore.createIndex('by-context', 'contextId');

      // Serialized MiniSearch indexes
      db.createObjectStore('searchIndexes', { keyPath: 'id' });
    },
  });

  // Request persistent storage so browser doesn't auto-evict data
  if (navigator.storage && navigator.storage.persist) {
    await navigator.storage.persist();
  }

  return dbInstance;
}
```

### Storage estimates

| Component | Per book (350K word novel) | 10-book series |
|-----------|---------------------------|----------------|
| Text chunks | ~1,200 chunks x ~1.5 KB | ~18 MB |
| Embeddings | ~1,200 x 1,536 floats x 8 bytes | ~140 MB |
| MiniSearch index | ~2-3 MB | ~25 MB |
| Chat history | Negligible | Negligible |
| **Total** | **~18 MB** | **~185 MB** |

Well within browser limits (Chrome allows up to 80% of disk). `navigator.storage.persist()` prevents automatic eviction.

### Data persistence

IndexedDB data **survives browser restarts, device reboots, and PWA closures**. The user does NOT need to re-upload books. Data is only lost if:
1. The user manually clears browser data ("Clear browsing data" in settings)
2. The browser evicts it under extreme storage pressure (prevented by `navigator.storage.persist()`)

---

## 8. EPUB Parsing in the Browser

Use `epubjs` (npm package: `epubjs`). It's built for browser use and handles EPUB extraction without Node.js.

### `client/src/lib/epub-parser.ts`

```typescript
import ePub from 'epubjs';

interface ParsedChapter {
  chapterNumber: number;
  title: string;
  text: string;
}

interface ParsedBook {
  title: string;
  author: string;
  chapters: ParsedChapter[];
}

export async function parseEpub(file: File): Promise<ParsedBook> {
  const arrayBuffer = await file.arrayBuffer();
  const book = ePub(arrayBuffer);
  await book.ready;

  const metadata = await book.loaded.metadata;
  const title = metadata.title || 'Unknown Title';
  const author = metadata.creator || 'Unknown Author';

  // Get spine items (reading order)
  const spine = book.spine as any;
  const chapters: ParsedChapter[] = [];
  let chapterNumber = 1;

  for (const item of spine.items) {
    try {
      const doc = await book.load(item.href);
      // doc is a Document object in the browser
      const text = extractText(doc as Document);

      // Skip very short sections (title pages, copyright, etc.)
      if (text.length < 200) continue;

      chapters.push({
        chapterNumber: chapterNumber++,
        title: item.label || `Chapter ${chapterNumber - 1}`,
        text,
      });
    } catch {
      continue;
    }
  }

  book.destroy();
  return { title, author, chapters };
}

function extractText(doc: Document): string {
  // Use the browser's built-in DOMParser — no cheerio needed
  const body = doc.body || doc.documentElement;
  return (body.textContent || '').replace(/\s+/g, ' ').trim();
}
```

**Note:** We use `DOMParser` / native DOM (available in the browser) instead of `cheerio` (which is a Node.js library). The browser gives us this for free.

---

## 9. Chunking

Split chapter text into overlapping chunks of ~400 tokens. This runs entirely in the browser.

### `client/src/lib/chunker.ts`

```typescript
import { encode } from 'gpt-tokenizer';

interface Chunk {
  chapterNumber: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
}

const TARGET_CHUNK_SIZE = 400;   // tokens
const CHUNK_OVERLAP = 50;        // tokens of overlap between consecutive chunks

export function chunkChapter(chapterNumber: number, text: string): Chunk[] {
  const chunks: Chunk[] = [];
  const sentences = splitIntoSentences(text);

  let currentChunk: string[] = [];
  let currentTokens = 0;
  let chunkIndex = 0;

  for (const sentence of sentences) {
    const sentenceTokens = encode(sentence).length;

    if (currentTokens + sentenceTokens > TARGET_CHUNK_SIZE && currentChunk.length > 0) {
      // Save current chunk
      const content = currentChunk.join(' ');
      chunks.push({
        chapterNumber,
        chunkIndex: chunkIndex++,
        content,
        tokenCount: encode(content).length,
      });

      // Calculate overlap: keep last sentences that fit within CHUNK_OVERLAP tokens
      const overlapSentences: string[] = [];
      let overlapTokens = 0;
      for (let i = currentChunk.length - 1; i >= 0; i--) {
        const st = encode(currentChunk[i]).length;
        if (overlapTokens + st > CHUNK_OVERLAP) break;
        overlapSentences.unshift(currentChunk[i]);
        overlapTokens += st;
      }

      currentChunk = [...overlapSentences];
      currentTokens = overlapTokens;
    }

    currentChunk.push(sentence);
    currentTokens += sentenceTokens;
  }

  // Don't forget the last chunk
  if (currentChunk.length > 0) {
    const content = currentChunk.join(' ');
    chunks.push({
      chapterNumber,
      chunkIndex: chunkIndex++,
      content,
      tokenCount: encode(content).length,
    });
  }

  return chunks;
}

function splitIntoSentences(text: string): string[] {
  // Simple sentence splitting on .!? followed by space and uppercase letter.
  // Not perfect but good enough for MVP.
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}
```

---

## 10. Embedding Pipeline

Embeddings are computed by calling the server proxy, which forwards to OpenAI. The client never has direct access to API keys.

### `client/src/lib/embeddings.ts`

```typescript
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

export async function embedChunks(
  texts: string[],
  authToken: string
): Promise<number[][]> {
  // Send in batches to avoid huge payloads
  const BATCH_SIZE = 50;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);

    const res = await fetch(`${API_BASE}/embed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify({ texts: batch }),
    });

    if (!res.ok) throw new Error(`Embedding failed: ${res.statusText}`);

    const data = await res.json();
    allEmbeddings.push(...data.embeddings);
  }

  return allEmbeddings;
}
```

### Cost estimate

- OpenAI `text-embedding-3-small`: $0.02 per 1M tokens
- A 350K word novel ≈ 500K tokens
- Cost to embed one book: **~$0.01** (one cent)
- Cost to embed a 10-book series: **~$0.10** (ten cents)

---

## 11. BM25 Search via MiniSearch

MiniSearch is a client-side full-text search library with BM25-like ranking. It runs entirely in the browser.

### Building the index

For series, we build a single MiniSearch index containing chunks from **all books** in the series. The spoiler filtering happens at search time via the `filter` function, not at index-build time.

```typescript
import MiniSearch from 'minisearch';

// Build index from chunks — can span multiple books for series
export function buildSearchIndex(
  chunks: { id: number; content: string; bookId: string; chapterNumber: number }[]
): MiniSearch {
  const miniSearch = new MiniSearch({
    fields: ['content'],
    storeFields: ['content', 'chapterNumber', 'bookId'],
    searchOptions: {
      boost: { content: 1 },
      fuzzy: 0.2,
    },
  });

  miniSearch.addAll(chunks);
  return miniSearch;
}

// Spoiler-safe filter for series
// allowedBooks: map of bookId → max allowed chapter (Infinity for done books)
export function searchBM25(
  index: MiniSearch,
  query: string,
  allowedBooks: Map<string, number>,  // bookId → max chapter (Infinity = all)
  limit: number = 20
): { id: number; content: string; chapterNumber: number; bookId: string; score: number }[] {
  const results = index.search(query, {
    filter: (result) => {
      const maxChapter = allowedBooks.get(result.bookId);
      if (maxChapter === undefined) return false;         // book not in allowed set (locked)
      return result.chapterNumber <= maxChapter;
    },
  });

  return results.slice(0, limit).map(r => ({
    id: r.id as number,
    content: r.content,
    chapterNumber: r.chapterNumber,
    bookId: r.bookId,
    score: r.score,
  }));
}
```

### Building the allowedBooks map

```typescript
// Helper to build the allowed books filter for a series
function buildAllowedBooks(
  books: { id: string; status: 'done' | 'reading' | 'locked'; currentChapter: number }[]
): Map<string, number> {
  const allowed = new Map<string, number>();
  for (const book of books) {
    if (book.status === 'done') {
      allowed.set(book.id, Infinity);                     // all chapters allowed
    } else if (book.status === 'reading') {
      allowed.set(book.id, book.currentChapter);          // up to current chapter
    }
    // 'locked' books are not added → blocked entirely
  }
  return allowed;
}

// For standalone books (no series)
function buildAllowedBooksStandalone(
  bookId: string,
  currentChapter: number
): Map<string, number> {
  const allowed = new Map<string, number>();
  allowed.set(bookId, currentChapter);
  return allowed;
}
```

### Persisting the index

MiniSearch supports `JSON.stringify(miniSearch)` and `MiniSearch.loadJSON()`. Store the serialized index in IndexedDB:

```typescript
// Save (use the searchIndexes store)
const serialized = JSON.stringify(miniSearch);
await db.put('searchIndexes', {
  id: seriesId || bookId,   // use series ID for series, book ID for standalone
  serialized,
  updatedAt: new Date().toISOString(),
});

// Load
const stored = await db.get('searchIndexes', seriesId || bookId);
if (stored) {
  const miniSearch = MiniSearch.loadJSON(stored.serialized, {
    fields: ['content'],
    storeFields: ['content', 'chapterNumber', 'bookId'],
  });
}
```

When a new book is added to a series, rebuild the series-level MiniSearch index to include the new book's chunks.

---

## 12. Vector Search (Cosine Similarity)

Brute-force cosine similarity over all chunks. For a 10-book series with ~12,000 chunks total, this takes under 50ms in the browser.

```typescript
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Spoiler-safe vector search using the same allowedBooks map
export function vectorSearch(
  queryEmbedding: number[],
  chunks: { id: number; content: string; bookId: string; chapterNumber: number; embedding: number[] }[],
  allowedBooks: Map<string, number>,
  limit: number = 20
): { id: number; content: string; bookId: string; chapterNumber: number; score: number }[] {
  const scored = chunks
    .filter(c => {
      if (!c.embedding) return false;
      const maxChapter = allowedBooks.get(c.bookId);
      if (maxChapter === undefined) return false;        // locked
      return c.chapterNumber <= maxChapter;
    })
    .map(c => ({
      id: c.id,
      content: c.content,
      bookId: c.bookId,
      chapterNumber: c.chapterNumber,
      score: cosineSimilarity(queryEmbedding, c.embedding),
    }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}
```

### Getting the query embedding

The user's question also needs to be embedded. Call the same server proxy:

```typescript
export async function embedQuery(query: string, authToken: string): Promise<number[]> {
  const res = await fetch(`${API_BASE}/embed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({ texts: [query] }),
  });
  const data = await res.json();
  return data.embeddings[0];
}
```

---

## 13. Hybrid Retrieval

Combine BM25 and vector search results. This is the core search function. It now works across multiple books in a series.

### `client/src/lib/search.ts`

```typescript
interface SearchResult {
  id: number;
  content: string;
  bookId: string;
  chapterNumber: number;
  score: number;
}

const ALPHA = 0.5; // BM25 weight. 0.5 = equal weight for BM25 and embeddings.

export function hybridMerge(
  bm25Results: SearchResult[],
  vectorResults: SearchResult[],
  topK: number = 8
): SearchResult[] {
  const normBM25 = normalize(bm25Results);
  const normVector = normalize(vectorResults);

  const scoreMap = new Map<number, {
    bm25: number; vector: number;
    content: string; bookId: string; chapterNumber: number;
  }>();

  for (const r of normBM25) {
    scoreMap.set(r.id, {
      bm25: r.score, vector: 0,
      content: r.content, bookId: r.bookId, chapterNumber: r.chapterNumber,
    });
  }
  for (const r of normVector) {
    const existing = scoreMap.get(r.id);
    if (existing) {
      existing.vector = r.score;
    } else {
      scoreMap.set(r.id, {
        bm25: 0, vector: r.score,
        content: r.content, bookId: r.bookId, chapterNumber: r.chapterNumber,
      });
    }
  }

  const merged: SearchResult[] = Array.from(scoreMap.entries()).map(([id, scores]) => ({
    id,
    content: scores.content,
    bookId: scores.bookId,
    chapterNumber: scores.chapterNumber,
    score: ALPHA * scores.bm25 + (1 - ALPHA) * scores.vector,
  }));

  merged.sort((a, b) => b.score - a.score);
  return merged.slice(0, topK);
}

function normalize(results: SearchResult[]): SearchResult[] {
  if (results.length === 0) return [];
  const max = Math.max(...results.map(r => r.score));
  const min = Math.min(...results.map(r => r.score));
  const range = max - min || 1;
  return results.map(r => ({ ...r, score: (r.score - min) / range }));
}
```

### Full search flow for series

```typescript
export async function searchSeries(
  seriesId: string,
  query: string,
  authToken: string
): Promise<SearchResult[]> {
  const db = await getDb();

  // 1. Get series and its books
  const series = await db.get('series', seriesId);
  if (!series) throw new Error('Series not found');

  const books = await Promise.all(
    series.bookOrder.map(bookId => db.get('books', bookId))
  );

  // 2. Build allowed books map
  const allowedBooks = buildAllowedBooks(
    books.filter(Boolean).map(b => ({
      id: b!.id,
      status: b!.status,
      currentChapter: b!.currentChapter,
    }))
  );

  // 3. Load all chunks from all books in the series
  const allChunks: any[] = [];
  for (const bookId of series.bookOrder) {
    const bookChunks = await db.getAllFromIndex('chunks', 'by-book', bookId);
    allChunks.push(...bookChunks);
  }

  // 4. BM25 search with cross-book filter
  const searchIndex = buildSearchIndex(allChunks); // or load persisted
  const bm25Results = searchBM25(searchIndex, query, allowedBooks, 20);

  // 5. Embed the query
  const queryEmbedding = await embedQuery(query, authToken);

  // 6. Vector search with cross-book filter
  const chunksWithEmbeddings = allChunks.filter(c => c.embedding !== null);
  const vectorResults = vectorSearch(queryEmbedding, chunksWithEmbeddings, allowedBooks, 20);

  // 7. Merge
  return hybridMerge(bm25Results, vectorResults, 8);
}

// Simpler version for standalone books
export async function searchBook(
  bookId: string,
  query: string,
  maxChapter: number,
  authToken: string
): Promise<SearchResult[]> {
  const db = await getDb();
  const allChunks = await db.getAllFromIndex('chunks', 'by-book', bookId);
  const allowedBooks = buildAllowedBooksStandalone(bookId, maxChapter);

  const searchIndex = buildSearchIndex(allChunks);
  const bm25Results = searchBM25(searchIndex, query, allowedBooks, 20);

  const queryEmbedding = await embedQuery(query, authToken);
  const chunksWithEmbeddings = allChunks.filter(c => c.embedding !== null);
  const vectorResults = vectorSearch(queryEmbedding, chunksWithEmbeddings, allowedBooks, 20);

  return hybridMerge(bm25Results, vectorResults, 8);
}
```

---

## 14. Spoiler Policy Engine

This is the simplest but most critical component. The spoiler filter is a **data-level filter**, not a prompt trick.

### How it works

The `allowedBooks` map controls exactly which chunks can reach the LLM:

| Book status | Filter rule | Example |
|-------------|-------------|---------|
| **Done** | All chapters allowed (`Infinity`) | User finished Book 1 → all 75 chapters searchable |
| **Reading** | Up to `currentChapter` only | User is on Book 2, Ch 15 → chapters 1-15 searchable |
| **Locked** | Not in the map → completely blocked | User hasn't started Book 3 → zero chunks returned |

For standalone books (no series), only one book exists in the map with `currentChapter` as the limit.

### Rules (non-negotiable)

1. **Cross-book chapter filter**: Applied in both MiniSearch (`filter` option) and vector search (`.filter()` before scoring). Uses the `allowedBooks` map.
2. **"Mark as Finished" is explicit**: A book only transitions from `reading` to `done` when the user clicks a "Mark as Finished" button. This prevents accidental spoiler access. The next book in the series transitions from `locked` to `reading` (with `currentChapter: 0`).
3. **No LLM knowledge**: The system prompt explicitly forbids using training data. (See Section 15.)
4. **Citation required**: Every claim must reference a book title and chapter.
5. **Decline when uncertain**: If retrieval returns too few relevant results, say so.

### "Mark as Finished" behavior

When user clicks "Mark as Finished" on the current book:
1. Set current book's `status` to `done` and `currentChapter` to `totalChapters`
2. Find the next book in `series.bookOrder`
3. Set next book's `status` to `reading` and `currentChapter` to `0`
4. All subsequent books remain `locked`

```typescript
async function markBookAsFinished(bookId: string): Promise<void> {
  const db = await getDb();
  const book = await db.get('books', bookId);
  if (!book || !book.seriesId) return;

  // Mark current as done
  book.status = 'done';
  book.currentChapter = book.totalChapters;
  await db.put('books', book);

  // Find and unlock next book
  const series = await db.get('series', book.seriesId);
  if (!series) return;

  const currentIndex = series.bookOrder.indexOf(bookId);
  const nextBookId = series.bookOrder[currentIndex + 1];

  if (nextBookId) {
    const nextBook = await db.get('books', nextBookId);
    if (nextBook && nextBook.status === 'locked') {
      nextBook.status = 'reading';
      nextBook.currentChapter = 0;
      await db.put('books', nextBook);
    }
  }
}
```

### What if the user sets progress to 0 on all books?

All queries should return "You haven't started reading yet. Set your progress to at least Chapter 1 to begin asking questions." Handle this in the client before making any search/API call.

### What about appendices, glossaries, maps?

For MVP, skip this. These are typically separate from the chapter spine in EPUBs and will likely be filtered out by the "skip sections shorter than 200 chars" rule in the parser, or assigned a high chapter number. Good enough for MVP.

---

## 15. LLM Answer Generation

The client gathers the top chunks from hybrid search, then sends them to the server's `/api/ask` endpoint (which proxies to DeepSeek).

### `client/src/lib/llm.ts`

```typescript
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

interface Citation {
  bookTitle: string;
  chapterNumber: number;
  excerpt: string;
}

interface AnswerResponse {
  answer: string;
  citations: Citation[];
  confidence: 'high' | 'medium' | 'low';
}

// For series chat
export async function askSeriesQuestion(
  seriesName: string,
  currentBookTitle: string,
  currentChapter: number,
  completedBookTitles: string[],
  question: string,
  chunks: { content: string; bookTitle: string; chapterNumber: number }[],
  authToken: string
): Promise<AnswerResponse> {
  const res = await fetch(`${API_BASE}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({
      seriesName,
      bookTitle: currentBookTitle,
      currentChapter,
      completedBooks: completedBookTitles,
      question,
      chunks,
    }),
  });

  if (!res.ok) throw new Error(`Ask failed: ${res.statusText}`);
  return res.json();
}

// For standalone book chat
export async function askBookQuestion(
  bookTitle: string,
  currentChapter: number,
  question: string,
  chunks: { content: string; bookTitle: string; chapterNumber: number }[],
  authToken: string
): Promise<AnswerResponse> {
  const res = await fetch(`${API_BASE}/ask`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
    },
    body: JSON.stringify({ bookTitle, currentChapter, question, chunks }),
  });

  if (!res.ok) throw new Error(`Ask failed: ${res.statusText}`);
  return res.json();
}
```

The system prompt and DeepSeek call are handled server-side (see Section 6, `ask.ts`). The server prompt adapts based on whether `seriesName` and `completedBooks` are provided.

---

## 16. API Endpoints (Server)

The server only has 3 endpoints:

| Method | Path | Purpose | Auth |
|--------|------|---------|------|
| `GET` | `/api/health` | Health check | No |
| `POST` | `/api/embed` | Proxy to OpenAI embeddings | Yes |
| `POST` | `/api/ask` | Proxy to DeepSeek for answers | Yes |

### `POST /api/embed`

**Request:**
```json
{
  "texts": ["chunk text 1", "chunk text 2", "..."]
}
```

**Response:**
```json
{
  "embeddings": [[0.012, -0.034, ...], [0.056, 0.078, ...]]
}
```

### `POST /api/ask`

**Request (series):**
```json
{
  "seriesName": "The Stormlight Archive",
  "bookTitle": "Words of Radiance",
  "currentChapter": 15,
  "completedBooks": ["The Way of Kings"],
  "question": "Who is Shallan?",
  "chunks": [
    { "content": "Shallan Davar was the daughter...", "bookTitle": "The Way of Kings", "chapterNumber": 8 },
    { "content": "She arrived at Kharbranth...", "bookTitle": "The Way of Kings", "chapterNumber": 12 },
    { "content": "Shallan studied the Soulcaster...", "bookTitle": "Words of Radiance", "chapterNumber": 3 }
  ]
}
```

**Request (standalone):**
```json
{
  "bookTitle": "Project Hail Mary",
  "currentChapter": 10,
  "question": "What is the Astrophage?",
  "chunks": [
    { "content": "The organism consumed energy...", "bookTitle": "Project Hail Mary", "chapterNumber": 2 }
  ]
}
```

**Response:**
```json
{
  "answer": "Shallan Davar is a young lighteyed woman from Jah Keved, daughter of the recently deceased Brightlord Davar [The Way of Kings, Chapter 8]. She traveled to Kharbranth to become the ward of Jasnah Kholin [The Way of Kings, Chapter 12], and has been studying Jasnah's Soulcaster [Words of Radiance, Chapter 3].",
  "citations": [
    { "bookTitle": "The Way of Kings", "chapterNumber": 8, "excerpt": "Shallan Davar was the daughter..." },
    { "bookTitle": "The Way of Kings", "chapterNumber": 12, "excerpt": "She arrived at Kharbranth..." },
    { "bookTitle": "Words of Radiance", "chapterNumber": 3, "excerpt": "Shallan studied the Soulcaster..." }
  ],
  "confidence": "high"
}
```

---

## 17. Frontend: Pages & Components

### App structure (`App.tsx`)

No router. State-based view switching:

```typescript
function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [selectedSeriesId, setSelectedSeriesId] = useState<string | null>(null);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);

  // If not logged in → show AuthForm
  if (!session) return <AuthForm onAuth={setSession} />;

  // If a series is selected → show SeriesChat
  if (selectedSeriesId) {
    return (
      <SeriesChat
        seriesId={selectedSeriesId}
        onBack={() => setSelectedSeriesId(null)}
      />
    );
  }

  // If a standalone book is selected → show BookChat
  if (selectedBookId) {
    return (
      <BookChat
        bookId={selectedBookId}
        onBack={() => setSelectedBookId(null)}
      />
    );
  }

  // Default → Library
  return (
    <Library
      onSelectSeries={setSelectedSeriesId}
      onSelectBook={setSelectedBookId}
    />
  );
}
```

### Library Page

```
┌─────────────────────────────────────────────┐
│  Reading Partner                   [Logout] │
├─────────────────────────────────────────────┤
│                                             │
│  ┌────────────────────────────────────────┐ │
│  │  Drop an EPUB here or click to browse  │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  ── The Stormlight Archive ──────────────── │
│  ┌────────────────────────────────────────┐ │
│  │ 1. The Way of Kings        [Done]      │ │
│  │    75/75 chapters                      │ │
│  ├────────────────────────────────────────┤ │
│  │ 2. Words of Radiance      [Reading]    │ │
│  │    Ch 15 / 89                          │ │
│  ├────────────────────────────────────────┤ │
│  │ 3. Oathbringer             [Locked]    │ │
│  │    Not started                         │ │
│  └────────────────────────────────────────┘ │
│  [+ Add book to this series]                │
│  [Open Series Chat]                         │
│                                             │
│  ── Standalone Books ────────────────────── │
│  ┌────────────────────────────────────────┐ │
│  │ Project Hail Mary                      │ │
│  │ Andy Weir                              │ │
│  │ Ch 8 / 32                              │ │
│  └────────────────────────────────────────┘ │
│                                             │
│  [+ Create New Series]                      │
│                                             │
└─────────────────────────────────────────────┘
```

- Series are displayed as grouped card lists with book order visible
- Each book shows status badge: **Done** (green), **Reading** (blue), **Locked** (gray)
- Clicking "Open Series Chat" navigates to SeriesChat view
- Clicking a standalone book navigates to BookChat view
- "Create New Series" opens a modal to name the series
- "Add book to this series" is shown per series group
- Books are loaded from IndexedDB

### Upload Flow (FileUpload component)

When user uploads an EPUB:

1. File is parsed (title/author/chapters extracted)
2. A modal appears with the parsed info and asks:

```
┌────────────────────────────────────────────┐
│  Book detected:                            │
│  "Oathbringer" by Brandon Sanderson        │
│  89 chapters found                         │
│                                            │
│  Is this part of a series?                 │
│                                            │
│  ( ) No, it's standalone                   │
│  ( ) Yes, add to existing series:          │
│      [The Stormlight Archive     ▼]        │
│      Book number in series: [3]            │
│  ( ) Yes, create new series:               │
│      Series name: [________________]       │
│      Book number in series: [1]            │
│                                            │
│  [Cancel]                    [Add Book]    │
└────────────────────────────────────────────┘
```

3. On "Add Book":
   - Save book to IndexedDB with series fields
   - If series, update `series.bookOrder` array
   - If first book in new series, set `status: 'reading'`
   - If added to existing series and all prior books are `done`, set `status: 'reading'`; otherwise set `status: 'locked'`
   - Start chunking + embedding pipeline
   - Show progress: "Parsing... Chunking... Embedding 450/1200..."

### Series Chat Page (`SeriesChat.tsx`)

```
┌─────────────────────────────────────────────┐
│  <- Back    The Stormlight Archive          │
├──────────────┬──────────────────────────────┤
│  Books       │                              │
│              │  Currently reading:          │
│  1. The Way  │  Words of Radiance           │
│  of Kings    │  Chapter: [======|---] 15/89 │
│  [Done]      │  "Shallan's Past"            │
│              │  [Mark as Finished]          │
│  2. Words of │                              │
│  Radiance    ├──────────────────────────────┤
│  [Reading]   │                              │
│  Ch 15/89    │  ┌─ You ──────────────────┐  │
│              │  │ Who is Shallan?         │  │
│  3. Oath-    │  └────────────────────────┘  │
│  bringer     │                              │
│  [Locked]    │  ┌─ Reading Partner ──────┐  │
│              │  │ Shallan Davar is a     │  │
│              │  │ young lighteyed woman  │  │
│              │  │ from Jah Keved [TWoK,  │  │
│              │  │ Ch 8]. She traveled    │  │
│              │  │ to Kharbranth to study │  │
│              │  │ under Jasnah [TWoK,    │  │
│              │  │ Ch 12].               │  │
│              │  │                        │  │
│              │  │ Citations:             │  │
│              │  │  TWoK Ch 8: "Shallan   │  │
│              │  │    Davar was the..."   │  │
│              │  │  TWoK Ch 12: "She      │  │
│              │  │    arrived at..."      │  │
│              │  │                        │  │
│              │  │ Confidence: HIGH       │  │
│              │  └────────────────────────┘  │
│              │                              │
│              │  ┌────────────────────────┐  │
│              │  │ Ask about the series.. │  │
│              │  └────────────────────────┘  │
└──────────────┴──────────────────────────────┘
```

- **Left sidebar**: ordered book list with status badges and progress
- **Right panel**: progress slider for current "Reading" book + chat
- "Mark as Finished" button appears on the current reading book. On click:
  - Current book → `done`
  - Next book → `reading` (with `currentChapter: 0`)
  - Confirmation dialog: "Mark 'Words of Radiance' as finished? This will unlock 'Oathbringer'."
- Chat searches across ALL done books + current book up to progress
- Citations include book title for cross-book references

### Book Chat Page (`BookChat.tsx`)

Same as before but for standalone books only. No sidebar, no series context.

```
┌─────────────────────────────────────────────┐
│  <- Back    Project Hail Mary               │
├─────────────────────────────────────────────┤
│  Reading Progress                           │
│  Chapter: [==========|----------] 8/32      │
│  "The Astrophage"                           │
├─────────────────────────────────────────────┤
│                                             │
│  ┌─ You ─────────────────────────────────┐  │
│  │ What is the Astrophage?               │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌─ Reading Partner ─────────────────────┐  │
│  │ The Astrophage is a micro-organism    │  │
│  │ that consumes stellar energy [Ch 2].  │  │
│  │                                       │  │
│  │ Citations:                            │  │
│  │  Ch 2: "The organism consumed..."     │  │
│  │                                       │  │
│  │ Confidence: HIGH                      │  │
│  └───────────────────────────────────────┘  │
│                                             │
│  ┌───────────────────────────────────────┐  │
│  │ Ask about the book...             [>] │  │
│  └───────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

### Component details

#### `AuthForm.tsx`
- Email + password fields
- Toggle between "Log in" and "Sign up"
- Uses `@supabase/supabase-js` client directly
- On success, calls `onAuth(session)`

#### `SeriesCard.tsx`
- Displays series name as header
- Lists all books in order with status badges (Done/Reading/Locked)
- Shows progress for the current "Reading" book
- "Open Series Chat" button
- "Add book to this series" link

#### `BookCard.tsx`
- Displays standalone book title, author, progress
- Click to open BookChat

#### `FileUpload.tsx`
- Drag-and-drop zone using HTML5 drag events (`onDragOver`, `onDrop`)
- Also supports click-to-browse: `<input type="file" accept=".epub">`
- On file selection: parse, then show series assignment modal (see Upload Flow above)
- Show progress during processing ("Parsing... Chunking... Embedding 450/1200...")

#### `CreateSeriesModal.tsx`
- Text input for series name
- "Create" and "Cancel" buttons
- Creates a new series record in IndexedDB with empty `bookOrder`

#### `SeriesBookList.tsx`
- Ordered list of books in the series (used in SeriesChat sidebar)
- Each book shows: number, title, status badge, chapter progress
- "Mark as Finished" button on the current reading book
- Clicking "Mark as Finished" shows confirmation dialog

#### `ProgressSlider.tsx`
- `<input type="range" min={0} max={totalChapters} value={currentChapter} />`
- Shows chapter title if available
- Debounce 300ms, save to IndexedDB on change

#### `ChatMessage.tsx`
- Different styles for user (right-aligned, blue) vs assistant (left-aligned, gray)
- Assistant messages show answer text, citations (collapsible), and confidence badge
- Render `[Book Title, Chapter X]` citations as styled inline badges
- For standalone books, citations show `[Chapter X]` only

#### `ChatInput.tsx`
- Text input + send button
- Send on Enter key (Shift+Enter for newline)
- Disabled + spinner while request is in-flight
- Clear after send

### Shared types (`client/src/types/index.ts`)

```typescript
export interface Series {
  id: string;
  name: string;
  bookOrder: string[];   // ordered book IDs
  createdAt: string;
}

export interface Book {
  id: string;
  title: string;
  author: string;
  totalChapters: number;
  currentChapter: number;
  processingStatus: 'pending' | 'processing' | 'ready' | 'error';
  seriesId: string | null;
  bookNumber: number | null;
  status: 'locked' | 'reading' | 'done';
  createdAt: string;
}

export interface Chapter {
  bookId: string;
  chapterNumber: number;
  title: string;
}

export interface Chunk {
  id?: number;
  bookId: string;
  chapterNumber: number;
  chunkIndex: number;
  content: string;
  tokenCount: number;
  embedding: number[] | null;
}

export interface Citation {
  bookTitle: string;
  chapterNumber: number;
  excerpt: string;
}

export interface ChatMessage {
  id?: number;
  contextId: string;         // seriesId or bookId
  contextType: 'series' | 'book';
  role: 'user' | 'assistant';
  content: string;
  citations?: Citation[];
  confidence?: 'high' | 'medium' | 'low';
  createdAt: string;
}

export interface AnswerResponse {
  answer: string;
  citations: Citation[];
  confidence: 'high' | 'medium' | 'low';
}
```

---

## 18. Build Order (Weekend Timeline)

### Saturday Morning: Foundation (3-4 hours)

1. **Project scaffolding**
   - Monorepo with `/server` and `/client`
   - Server: `npm init`, install `hono`, `@hono/node-server`, `openai`, `@supabase/supabase-js`, `dotenv`
   - Client: `npm create vite@latest client -- --template react-ts`, install Tailwind, `epubjs`, `minisearch`, `gpt-tokenizer`, `idb`, `@supabase/supabase-js`, `lucide-react`
   - Verify both dev servers start

2. **Supabase setup**
   - Create project at supabase.com
   - Enable email/password auth
   - Get project URL, anon key, and service role key

3. **Server: auth middleware + proxy routes**
   - Implement `auth.ts`, `embed.ts`, `ask.ts`
   - Test with curl: health check, embed a test string

4. **Client: IndexedDB setup**
   - Implement `db.ts` with series, books, chapters, chunks, chatMessages, searchIndexes stores
   - Include `navigator.storage.persist()` call
   - Test: open DB, write a record, read it back

### Saturday Afternoon: Ingestion Pipeline (3-4 hours)

5. **EPUB parser**
   - Implement `epub-parser.ts`
   - Test: parse a sample EPUB in the browser, log chapter titles

6. **Chunker**
   - Implement `chunker.ts`
   - Test: chunk a chapter, verify sizes and overlap

7. **FileUpload component + processing pipeline**
   - Upload EPUB → parse → show series assignment modal → chunk → store in IndexedDB
   - Add embedding calls (store vectors in IndexedDB)
   - Build MiniSearch index and serialize to IndexedDB
   - Show processing progress

8. **Series management**
   - Create series, add books to series, book ordering
   - Book status management (`locked`/`reading`/`done`)
   - "Mark as Finished" flow with next-book unlock

### Saturday Evening: Search & LLM (2-3 hours)

9. **Search implementation**
    - `buildAllowedBooks()` helper for cross-book filtering
    - MiniSearch BM25 search with `allowedBooks` filter
    - Vector cosine similarity search with `allowedBooks` filter
    - Hybrid merge
    - Both `searchSeries()` and `searchBook()` functions
    - **Write search gating unit tests** (search.test.ts, book-status.test.ts)

10. **LLM integration**
    - Client calls `/api/ask` with top chunks + series context
    - Server proxies to DeepSeek with series-aware system prompt
    - Test: full pipeline, ask a question, get an answer

### Sunday Morning: Frontend (3-4 hours)

11. **Auth form** — Login/signup with Supabase

12. **Library page** — Series groups with book lists + standalone books + upload flow + Create Series modal

13. **SeriesChat page** — Book list sidebar with statuses + progress slider + chat + "Mark as Finished"

14. **BookChat page** — Progress slider + chat (standalone books)

### Sunday Afternoon: Polish (3-4 hours)

15. **Wire everything together** — Full flow: login → upload → assign to series → process → set progress → ask → answer with cross-book citations

16. **Error handling** — Upload failures, API errors, empty results

17. **Loading states** — Spinners, progress bars, disabled states

18. **Spoiler testing** — Run `npm test` to verify all unit tests pass. Then do manual red-team testing with a real book (see Section 19)

---

## 19. Testing

### Testing philosophy

Focus testing effort on the thing that must never fail: **spoiler safety**. The search pipeline and book status logic are testable with fast, deterministic unit tests. The UI and end-to-end flow are tested manually — automating them costs more time than it saves for a weekend MVP.

### Test setup

Use **Vitest** (ships with Vite, zero extra config). Add it to the client:

```bash
cd client
npm install -D vitest
```

Add to `client/package.json` scripts:

```json
{
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Vitest reads the existing `vite.config.ts` and `tsconfig.json` — no separate config needed.

### Test file structure

```
client/src/
├── lib/
│   ├── search.ts
│   ├── search.test.ts          # spoiler gating + hybrid merge tests
│   ├── chunker.ts
│   ├── chunker.test.ts         # chunk size and overlap tests
│   └── ...
├── helpers/
│   └── book-status.ts          # buildAllowedBooks, markBookAsFinished logic
│   └── book-status.test.ts     # status transition tests
```

---

### Test file 1: Spoiler gating (`client/src/lib/search.test.ts`)

This is the most critical test file. It verifies that the `allowedBooks` filter works correctly for both standalone books and series.

```typescript
import { describe, it, expect } from 'vitest';
import { searchBM25, buildSearchIndex, vectorSearch, hybridMerge } from './search';

// ----- Test data factory -----

function makeChunk(overrides: Partial<{
  id: number; bookId: string; chapterNumber: number; content: string; embedding: number[];
}>) {
  return {
    id: overrides.id ?? 1,
    bookId: overrides.bookId ?? 'book-1',
    chapterNumber: overrides.chapterNumber ?? 1,
    content: overrides.content ?? 'Some text content',
    embedding: overrides.embedding ?? [0.1, 0.2, 0.3],  // simplified for tests
  };
}

// Generate a set of chunks spanning 3 books, 5 chapters each
function makeSeriesChunks() {
  const chunks = [];
  let id = 1;
  for (const bookId of ['book-1', 'book-2', 'book-3']) {
    for (let ch = 1; ch <= 5; ch++) {
      chunks.push(makeChunk({
        id: id++,
        bookId,
        chapterNumber: ch,
        content: `Content from ${bookId} chapter ${ch}. Character Kaladin appears here.`,
      }));
    }
  }
  return chunks;
}

// ----- BM25 spoiler gating -----

describe('BM25 search: spoiler gating', () => {
  const chunks = makeSeriesChunks();
  const index = buildSearchIndex(chunks);

  it('standalone book: only returns chunks up to current chapter', () => {
    const allowed = new Map([['book-1', 3]]);  // reading book-1, chapter 3
    const results = searchBM25(index, 'Kaladin', allowed);

    expect(results.length).toBeGreaterThan(0);
    for (const r of results) {
      expect(r.bookId).toBe('book-1');
      expect(r.chapterNumber).toBeLessThanOrEqual(3);
    }
  });

  it('series: done books return all chapters', () => {
    const allowed = new Map([
      ['book-1', Infinity],  // done
      ['book-2', 2],         // reading, ch 2
    ]);
    const results = searchBM25(index, 'Kaladin', allowed);

    const book1Results = results.filter(r => r.bookId === 'book-1');
    const book2Results = results.filter(r => r.bookId === 'book-2');
    const book3Results = results.filter(r => r.bookId === 'book-3');

    // Book 1: all 5 chapters should be searchable
    expect(book1Results.length).toBe(5);
    // Book 2: only chapters 1-2
    expect(book2Results.every(r => r.chapterNumber <= 2)).toBe(true);
    // Book 3: locked, zero results
    expect(book3Results.length).toBe(0);
  });

  it('locked books return zero results', () => {
    const allowed = new Map([['book-1', Infinity]]);
    // book-2 and book-3 are not in the map = locked
    const results = searchBM25(index, 'Kaladin', allowed);

    expect(results.every(r => r.bookId === 'book-1')).toBe(true);
  });

  it('progress at 0 returns nothing for that book', () => {
    const allowed = new Map([['book-1', 0]]);
    const results = searchBM25(index, 'Kaladin', allowed);

    expect(results.length).toBe(0);
  });

  it('empty allowed map returns nothing', () => {
    const allowed = new Map<string, number>();
    const results = searchBM25(index, 'Kaladin', allowed);

    expect(results.length).toBe(0);
  });
});

// ----- Vector search spoiler gating -----

describe('Vector search: spoiler gating', () => {
  const chunks = makeSeriesChunks();
  const queryEmbedding = [0.1, 0.2, 0.3];

  it('filters out locked books', () => {
    const allowed = new Map([
      ['book-1', Infinity],
      ['book-2', 3],
    ]);
    const results = vectorSearch(queryEmbedding, chunks, allowed);

    expect(results.every(r => r.bookId !== 'book-3')).toBe(true);
  });

  it('filters reading book by chapter', () => {
    const allowed = new Map([['book-2', 2]]);
    const results = vectorSearch(queryEmbedding, chunks, allowed);

    expect(results.every(r => r.bookId === 'book-2')).toBe(true);
    expect(results.every(r => r.chapterNumber <= 2)).toBe(true);
  });
});

// ----- Hybrid merge -----

describe('Hybrid merge', () => {
  it('combines BM25 and vector results, returns top K', () => {
    const bm25 = [
      { id: 1, content: 'a', bookId: 'b1', chapterNumber: 1, score: 10 },
      { id: 2, content: 'b', bookId: 'b1', chapterNumber: 2, score: 5 },
    ];
    const vector = [
      { id: 2, content: 'b', bookId: 'b1', chapterNumber: 2, score: 0.9 },
      { id: 3, content: 'c', bookId: 'b1', chapterNumber: 3, score: 0.8 },
    ];

    const results = hybridMerge(bm25, vector, 2);

    expect(results.length).toBe(2);
    // id=2 should rank high because it appears in both
    expect(results.some(r => r.id === 2)).toBe(true);
  });

  it('handles empty BM25 results gracefully', () => {
    const vector = [
      { id: 1, content: 'a', bookId: 'b1', chapterNumber: 1, score: 0.9 },
    ];
    const results = hybridMerge([], vector, 5);

    expect(results.length).toBe(1);
    expect(results[0].id).toBe(1);
  });

  it('handles empty vector results gracefully', () => {
    const bm25 = [
      { id: 1, content: 'a', bookId: 'b1', chapterNumber: 1, score: 10 },
    ];
    const results = hybridMerge(bm25, [], 5);

    expect(results.length).toBe(1);
  });

  it('handles both empty gracefully', () => {
    const results = hybridMerge([], [], 5);
    expect(results.length).toBe(0);
  });
});
```

---

### Test file 2: Book status logic (`client/src/helpers/book-status.test.ts`)

Tests the `buildAllowedBooks` map and "Mark as Finished" status transitions.

```typescript
import { describe, it, expect } from 'vitest';
import { buildAllowedBooks, buildAllowedBooksStandalone } from './book-status';

describe('buildAllowedBooks', () => {
  it('done books get Infinity', () => {
    const books = [
      { id: 'b1', status: 'done' as const, currentChapter: 20 },
    ];
    const allowed = buildAllowedBooks(books);
    expect(allowed.get('b1')).toBe(Infinity);
  });

  it('reading books get their currentChapter', () => {
    const books = [
      { id: 'b1', status: 'reading' as const, currentChapter: 10 },
    ];
    const allowed = buildAllowedBooks(books);
    expect(allowed.get('b1')).toBe(10);
  });

  it('locked books are not in the map', () => {
    const books = [
      { id: 'b1', status: 'done' as const, currentChapter: 20 },
      { id: 'b2', status: 'reading' as const, currentChapter: 5 },
      { id: 'b3', status: 'locked' as const, currentChapter: 0 },
    ];
    const allowed = buildAllowedBooks(books);
    expect(allowed.has('b1')).toBe(true);
    expect(allowed.has('b2')).toBe(true);
    expect(allowed.has('b3')).toBe(false);
  });

  it('full series with mixed statuses', () => {
    const books = [
      { id: 'b1', status: 'done' as const, currentChapter: 75 },
      { id: 'b2', status: 'done' as const, currentChapter: 89 },
      { id: 'b3', status: 'reading' as const, currentChapter: 15 },
      { id: 'b4', status: 'locked' as const, currentChapter: 0 },
      { id: 'b5', status: 'locked' as const, currentChapter: 0 },
    ];
    const allowed = buildAllowedBooks(books);

    expect(allowed.get('b1')).toBe(Infinity);
    expect(allowed.get('b2')).toBe(Infinity);
    expect(allowed.get('b3')).toBe(15);
    expect(allowed.has('b4')).toBe(false);
    expect(allowed.has('b5')).toBe(false);
    expect(allowed.size).toBe(3);
  });
});

describe('buildAllowedBooksStandalone', () => {
  it('creates a single-entry map with currentChapter', () => {
    const allowed = buildAllowedBooksStandalone('book-1', 12);
    expect(allowed.size).toBe(1);
    expect(allowed.get('book-1')).toBe(12);
  });

  it('chapter 0 means nothing is allowed', () => {
    const allowed = buildAllowedBooksStandalone('book-1', 0);
    expect(allowed.get('book-1')).toBe(0);
    // Any chunk with chapterNumber >= 1 would fail the <= 0 check
  });
});
```

**Note on `markBookAsFinished`**: This function interacts with IndexedDB, which doesn't exist in a Node/Vitest environment. For MVP, test the status transition logic manually. If you want to unit test it, extract the pure logic (determining which book transitions to what status) into a separate function that takes and returns plain objects, then test that function.

```typescript
// Example: extract pure logic for testing
interface BookStatusInput {
  bookId: string;
  seriesBookOrder: string[];
  books: { id: string; status: 'done' | 'reading' | 'locked' }[];
}

interface BookStatusChange {
  bookId: string;
  newStatus: 'done' | 'reading' | 'locked';
}

export function computeMarkAsFinished(input: BookStatusInput): BookStatusChange[] {
  const changes: BookStatusChange[] = [];

  // Mark current as done
  changes.push({ bookId: input.bookId, newStatus: 'done' });

  // Find and unlock next
  const currentIndex = input.seriesBookOrder.indexOf(input.bookId);
  const nextBookId = input.seriesBookOrder[currentIndex + 1];

  if (nextBookId) {
    const nextBook = input.books.find(b => b.id === nextBookId);
    if (nextBook && nextBook.status === 'locked') {
      changes.push({ bookId: nextBookId, newStatus: 'reading' });
    }
  }

  return changes;
}
```

```typescript
// In book-status.test.ts
describe('computeMarkAsFinished', () => {
  it('marks current book done and unlocks next', () => {
    const changes = computeMarkAsFinished({
      bookId: 'b2',
      seriesBookOrder: ['b1', 'b2', 'b3'],
      books: [
        { id: 'b1', status: 'done' },
        { id: 'b2', status: 'reading' },
        { id: 'b3', status: 'locked' },
      ],
    });

    expect(changes).toEqual([
      { bookId: 'b2', newStatus: 'done' },
      { bookId: 'b3', newStatus: 'reading' },
    ]);
  });

  it('last book in series: marks done, no unlock', () => {
    const changes = computeMarkAsFinished({
      bookId: 'b3',
      seriesBookOrder: ['b1', 'b2', 'b3'],
      books: [
        { id: 'b1', status: 'done' },
        { id: 'b2', status: 'done' },
        { id: 'b3', status: 'reading' },
      ],
    });

    expect(changes).toEqual([
      { bookId: 'b3', newStatus: 'done' },
    ]);
  });

  it('does not unlock an already-reading book', () => {
    // Edge case: two books both "reading" (shouldn't happen, but be safe)
    const changes = computeMarkAsFinished({
      bookId: 'b1',
      seriesBookOrder: ['b1', 'b2'],
      books: [
        { id: 'b1', status: 'reading' },
        { id: 'b2', status: 'reading' },
      ],
    });

    // Only marks b1 as done, does NOT change b2 (it's already reading)
    expect(changes).toEqual([
      { bookId: 'b1', newStatus: 'done' },
    ]);
  });
});
```

---

### Test file 3: Chunker (`client/src/lib/chunker.test.ts`)

```typescript
import { describe, it, expect } from 'vitest';
import { chunkChapter } from './chunker';

describe('chunkChapter', () => {
  it('produces chunks from text', () => {
    // Generate a long-enough text (~800 tokens worth of sentences)
    const sentences = Array.from({ length: 80 }, (_, i) =>
      `This is sentence number ${i + 1} with some additional words to fill space.`
    );
    const text = sentences.join(' ');

    const chunks = chunkChapter(1, text);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].chapterNumber).toBe(1);
    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[1].chunkIndex).toBe(1);
  });

  it('all chunks have token counts within expected range', () => {
    const sentences = Array.from({ length: 80 }, (_, i) =>
      `Sentence ${i + 1} contains words about a fantasy world and its characters.`
    );
    const text = sentences.join(' ');

    const chunks = chunkChapter(1, text);

    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
      // Last chunk may be smaller, but non-last chunks should be roughly ~400
      expect(chunk.tokenCount).toBeLessThanOrEqual(500);
    }
  });

  it('short text produces a single chunk', () => {
    const text = 'This is a very short chapter. Not much happens here.';
    const chunks = chunkChapter(5, text);

    expect(chunks.length).toBe(1);
    expect(chunks[0].chapterNumber).toBe(5);
    expect(chunks[0].content).toContain('short chapter');
  });

  it('preserves chapter number across chunks', () => {
    const sentences = Array.from({ length: 80 }, () =>
      'A moderately long sentence that contains enough words to contribute tokens.'
    );
    const text = sentences.join(' ');

    const chunks = chunkChapter(42, text);

    for (const chunk of chunks) {
      expect(chunk.chapterNumber).toBe(42);
    }
  });

  it('chunks have content (no empty chunks)', () => {
    const sentences = Array.from({ length: 80 }, (_, i) =>
      `Meaningful content in sentence ${i + 1} about the plot.`
    );
    const text = sentences.join(' ');

    const chunks = chunkChapter(1, text);

    for (const chunk of chunks) {
      expect(chunk.content.trim().length).toBeGreaterThan(0);
    }
  });
});
```

---

### Manual testing checklist (non-automated)

These are tested by hand since they involve the full UI, IndexedDB, and external APIs.

#### Functional

- [ ] Sign up / log in works
- [ ] Upload EPUB → book appears with correct title/author/chapter count
- [ ] Processing completes (status changes to "ready")
- [ ] Create a new series and add books to it
- [ ] Books display in correct order within series
- [ ] Progress slider works and persists across page loads
- [ ] "Mark as Finished" transitions book to done, unlocks next book
- [ ] Asking a question returns a grounded answer with citations
- [ ] Chat history persists in IndexedDB
- [ ] Multiple books / series can coexist
- [ ] Deleting a book removes all its data from IndexedDB
- [ ] Close browser, reopen → all data still present

#### Spoiler red-team (do this with a book you know well)

```
Test 1: Standalone book, progress at Chapter 10.
  Ask about a character introduced in Chapter 5.
  Expected: Answer references only Chapters 1-10.
  Verify: No citations from Chapter 11+.

Test 2: Standalone book, progress at Chapter 10.
  Ask about an event from Chapter 15.
  Expected: "I don't have enough information" or similar.
  Verify: No content from Chapter 15+ anywhere in response.

Test 3: Standalone book, progress at 0.
  Ask anything.
  Expected: "Set your progress to at least Chapter 1."
  Verify: No search or API call is made.

Test 4: Series, Book 1 Done, Book 2 Reading at Ch 10, Book 3 Locked.
  Ask about a character from Book 1.
  Expected: Answer draws from Book 1 (any ch) + Book 2 up to Ch 10.
  Verify: No citations from Book 2 Ch 11+ or Book 3.

Test 5: Same setup as Test 4.
  Ask about an event from Book 3.
  Expected: "I don't have enough information."
  Verify: Zero content from Book 3.

Test 6: Same setup as Test 4.
  Ask about something from Book 2, Chapter 15.
  Expected: No information from Ch 15.
  Verify: Citations only from Book 1 + Book 2 Ch 1-10.

Test 7: Mark Book 2 as finished.
  Verify Book 3 status changes to "reading" with ch 0.
  Ask about something from Book 2.
  Expected: Answer can now reference all Book 2 chapters.
```

#### Edge cases (manual)

- [ ] Very short EPUB (1-2 chapters)
- [ ] EPUB with no chapter titles
- [ ] Progress at max → full access
- [ ] Very long question
- [ ] Question about something not in the book at all
- [ ] Series with only 1 book (should work like standalone)
- [ ] Adding a book to a series where all prior books are done → starts as `reading`
- [ ] Adding a book to a series where prior books are NOT done → starts as `locked`

---

### Running tests

```bash
# Run all tests once
cd client && npm test

# Watch mode during development
cd client && npm run test:watch

# Run a specific test file
cd client && npx vitest run src/lib/search.test.ts
```

Total automated test count: ~20-25 tests. Run time: under 2 seconds. All pure functions, no network calls, no IndexedDB, no mocking needed.

---

## 20. Environment Variables

### Server (`.env` in `/server`)

```env
# OpenAI — for embeddings
OPENAI_API_KEY=sk-...

# DeepSeek — for answer generation
DEEPSEEK_API_KEY=sk-...

# Supabase — for auth validation
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### Client (`.env` in `/client`)

```env
# Server API URL
VITE_API_URL=http://localhost:3001/api

# Supabase — for client-side auth
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

---

## 21. Key Decisions Reference

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Data storage | IndexedDB (client) | Zero server cost, scales per-user for free |
| Data persistence | `navigator.storage.persist()` | Prevents browser auto-eviction |
| Server role | Stateless API proxy | No database, no file storage, near-zero cost |
| Auth | Supabase free tier | Clean auth, free for small user counts |
| Series support | First-class data model (series store, book ordering, status) | Core product feature for long fantasy series |
| Cross-book search | Single MiniSearch index per series + allowedBooks filter | Searches all read content, blocks unread content |
| BM25 search | MiniSearch (browser JS) | Client-side, no server dependency |
| Vector search | Brute-force cosine in JS | <12K vectors (10-book series) is still fast (<50ms) |
| Embedding model | OpenAI text-embedding-3-small | Cheap ($0.01/book), good quality |
| LLM | DeepSeek V3 (deepseek-chat) | Very cheap ($0.001/query), OpenAI-compatible API |
| EPUB parsing | epubjs (browser) | Built for browser, no server processing needed |
| HTML stripping | DOMParser (browser native) | No cheerio needed, free in the browser |
| Routing | No router (useState) | 3 views, simple state switching |
| Spoiler prevention | allowedBooks map filter in JS | Hard data-level guarantee, not prompt-dependent |
| Book completion | Explicit "Mark as Finished" button | Prevents accidental spoiler access |
| Token counting | gpt-tokenizer | Accurate BPE tokenization in browser |
| Server framework | Hono | Lightweight, deploys to Vercel/Cloudflare free tiers |
| Server DB | None | Server stores nothing, all data is on-device |
| Testing | Vitest (unit) + manual red-team | Automated tests for search gating logic; manual testing for spoiler safety with real books |

---

## Appendix A: Supabase Setup

1. Go to https://supabase.com and create a new project
2. Under Authentication → Providers, enable Email (enabled by default)
3. From Settings → API, copy:
   - Project URL → `SUPABASE_URL` / `VITE_SUPABASE_URL`
   - `anon` public key → `VITE_SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY`
4. No database tables needed. Supabase is used only for auth.

## Appendix B: DeepSeek API Setup

DeepSeek uses the same API format as OpenAI. The `openai` npm package works by changing `baseURL`:

```typescript
import OpenAI from 'openai';

const deepseek = new OpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY,
  baseURL: 'https://api.deepseek.com',
});
```

Sign up at https://platform.deepseek.com/ for an API key.

Pricing (as of early 2025):
- Input: ~$0.27 per million tokens
- Output: ~$1.10 per million tokens
- Typical query cost: ~$0.001

## Appendix C: Data Persistence & Browser Storage

### IndexedDB durability

IndexedDB data persists across:
- Browser tab closes
- Browser restarts
- Device reboots
- PWA closures

Data is only deleted by:
- User manually clearing browser data
- Browser storage eviction under extreme pressure (prevented by `persist()`)

### Preventing eviction

On startup, the app calls `navigator.storage.persist()`. This tells the browser to treat this origin's data as important and not auto-evict it. Support:
- Chrome: Grants automatically for installed PWAs, prompts otherwise
- Firefox: Prompts the user
- Safari: Grants for home screen apps

### What if data IS lost?

For MVP, the user re-uploads their EPUBs. Future improvement: add an export/import feature (download IndexedDB data as a file, re-import on another device or after data loss). This is not in MVP scope.

## Appendix D: Server Deployment Options (Free Tier)

| Platform | Free tier | Good for |
|----------|----------|----------|
| Vercel | 100GB bandwidth/month, serverless functions | Easiest deployment |
| Cloudflare Workers | 100K requests/day | Fastest cold starts |
| Railway | $5 free credit/month | Traditional Node server |
| Render | 750 hours/month | Traditional Node server |

The server is so thin that any free tier will handle 10-15 users easily.
