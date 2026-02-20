# Implementation Progress (reading-partner2)

## Completed server work
- Hono server scaffolded with CORS, `/api/health`, centralized error/not-found handlers (`server/src/index.ts`).
- Supabase JWT auth middleware implemented for protected routes (`server/src/middleware/auth.ts`).
- `POST /api/embed` implemented with request validation, batching, and Hugging Face embeddings proxying (`server/src/routes/embed.ts`).
- `POST /api/ask` implemented with request validation, spoiler-safe system prompt, OpenRouter chat proxying, and JSON response normalization (`server/src/routes/ask.ts`).

## Completed client work
- App shell/auth + view switching completed (`AuthForm`, `App`, `Library`, `SeriesChat`, `BookChat`).
- Upload/ingestion flow completed: EPUB parse -> chunk -> embed -> persist -> search index rebuild (`FileUpload`, `epub-parser`, `chunker`, `embeddings`).
- IndexedDB schema and helpers completed for series/books/chapters/chunks/chat/indexes (`client/src/lib/db.ts`).
- Hybrid retrieval completed (MiniSearch BM25 + cosine vector search + merge + spoiler gating) (`client/src/lib/search.ts`, `client/src/lib/book-status.ts`).
- LLM ask client completed for standalone + series contexts (`client/src/lib/llm.ts`).

## Test/build verification status
- Server build: `npm run build` in `server/` ✅
- Client tests: `npm run test` in `client/` ✅ (3 files, 15 tests passed)
- Client build: `npm run build` in `client/` ✅ (Vite build succeeded)

## Required environment variables

### Server
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `HF_API_KEY`
- `OPENROUTER_API_KEY`
- Optional: `PORT` (default `3001`)
- Optional: `CORS_ORIGIN` (default `http://localhost:5173`, supports comma-separated list)
- Optional: `HF_EMBED_MODEL` (default `Qwen/Qwen3-Embedding-0.6B`)
- Optional: `HF_PROVIDER` (default `hf-inference`)
- Optional: `OPENROUTER_BASE_URL` (default `https://openrouter.ai/api/v1`)
- Optional: `OPENROUTER_CHAT_MODEL` (default `openai/gpt-oss-120b:free`)
- Optional: `EMBED_BATCH_SIZE` (default `100`)
- Optional: `EMBED_REQUEST_DELAY_MS` (default `0`)
- Optional: `EMBED_MAX_TOKENS_PER_MINUTE` (default `0`, disabled)
- Optional: `EMBED_MAX_CONCURRENCY` (default `1`)
- Optional: `EMBED_RETRY_MAX_ATTEMPTS` (default `4`)
- Optional: `EMBED_RETRY_BASE_DELAY_MS` (default `1000`)

### Client
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- Optional: `VITE_API_URL` (default `http://localhost:3001/api`)
- Optional: `VITE_SEARCH_DEBUG` (default `false`, logs series retrieval details in browser console)

## Local dev run instructions
- Server:
  - `cd server && npm install`
  - `npm run dev`
- Client:
  - `cd client && npm install`
  - `npm run dev`

## Known limitations / TODOs
- Client production bundle is large (`dist/assets/index-*.js` ~2.6 MB); Vite warns about chunks > 500 kB. Next step: introduce route/module code-splitting and/or manual chunking.
- No server test suite is currently configured (only build verification for server).
- Embedding/upload pipeline runs sequentially per batch and can be slow for very large books/series; progress UI exists but no background processing/offline queue yet.
