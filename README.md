# SpoilerFree Reading Partner

Development monorepo for a spoiler-free AI reading assistant. The active client is now an Expo universal app for Android, iOS, and web. The Hono server owns auth validation, database access, AI provider calls, upload/indexing, retrieval, and spoiler filtering.

## Repo Structure

```txt
apps/expo          Expo Router universal app
server             Hono API, Supabase JWT validation, Drizzle/Postgres, AI pipeline
packages/shared    Shared TypeScript DTOs and validation helpers
client             Legacy Vite client, no longer part of the active workspace
```

## Why Drizzle

Drizzle is used because this project needs Postgres-specific capabilities: `pgvector`, generated `tsvector` search columns, custom SQL retrieval, flexible migrations, and direct control over spoiler-safe SQL filters.

## Database

Migration: `server/src/db/migrations/0000_initial_spoilerfree.sql`.

Tables: `profiles`, `series`, `books`, `chapters`, `chunks`, `reading_progress`, `audio_files`, `audio_progress_mappings`, `monthly_usage`, `ai_request_logs`.

Manual Supabase setup:

1. Create a Supabase project.
2. Copy `SUPABASE_URL`, anon key, and service role key into env files.
3. Set `DATABASE_URL` to the Supabase Postgres connection string.
4. Run the Drizzle migration from `server/` with `npm run db:migrate`, or apply the SQL migration in Supabase SQL editor.
5. Confirm `vector` and `pgcrypto` extensions are enabled.

## Env Files

Server env: `server/.env.example`.

Expo env: `apps/expo/.env.example`.

AI provider keys are server-only. The Expo app only receives Supabase public config and the API URL.

## Run Locally

Install once from repo root:

```bash
npm install
```

Run the server:

```bash
npm run dev:server
```

Run Expo web:

```bash
npm run web
```

Run Android:

```bash
npm run android
```

Run iOS:

```bash
npm run ios
```

## Upload And Indexing Flow

Expo uploads a DRM-free EPUB to `POST /api/books/upload`. The server validates Supabase JWT, quota, extension, and size; parses the EPUB; extracts metadata and chapters; chunks text without crossing chapter boundaries; embeds chunks with Voyage `voyage-4`; stores metadata/chunks/embeddings in Supabase Postgres; then keeps only extracted text/chunks, not the original EPUB.

## Audiobook Flow

Users attach audiobook metadata with `POST /api/audiobooks/attach`. Manual audiobook progress is available to all users through chapter/timestamp entry. Paid audio alignment uses `POST /api/audiobooks/align-progress`, temporarily uploads an audio file/window, transcribes with OpenAI `gpt-4o-mini-transcribe`, fuzzy-aligns the transcript to canonical EPUB chapter text, and saves a text offset only when confidence is at least `0.85`.

## Ask Flow

`POST /api/ask` accepts only `{ contextType, contextId, question }`. The server derives `userId` from the Supabase JWT, checks quota, loads progress, classifies the question with DeepSeek Flash, embeds the query with Voyage, runs spoiler-filtered vector and full-text search in Postgres, filters again in application code, conditionally reranks with Voyage, filters before answer generation, routes to DeepSeek Flash or Pro, records usage/logs, and returns optional debug metadata when `AI_DEBUG=true`.

## Spoiler Safety

Spoiler filtering happens in SQL before retrieval, again before reranking, and again before answer generation. Series context treats unknown book or chapter numbers as unsafe. Offset-level progress excludes chunks whose `endOffset` is unknown or beyond the current offset.

## Quotas

Dev quota scaffolding lives in `server/src/quota/plans.ts`. Free users get 1 series, 3 books, 10 questions/month, high book-token guardrails, and manual audiobook mode only. Paid users get larger limits and audio alignment. Admin users have no practical dev limits.

## Debug Logs

Server logs include `[AI] ask:start`, quota checks, classifier result, retrieval config, query embedding, candidate counts, spoiler filter result, rerank decisions/results, final chunks, answer model, usage recording, and errors. Audio logs include attach, alignment, transcription window/preview, confidence, offset save/skip, and temp file deletion. Client logs are enabled with `EXPO_PUBLIC_AI_DEBUG=true`.

## Verification

```bash
npm --workspace @reading-partner/shared run build
npm --workspace server run build
npm --workspace @reading-partner/expo run typecheck
npm --workspace server run test
```

## TODOs

Server-side EPUB parsing is intentionally minimal and should be hardened against more EPUB variants. Audio window extraction is a dev placeholder; production should extract only the requested window before transcription. Billing/Stripe, PDF support, summaries, timelines, full audiobook transcription, DRM removal, and user-provided provider keys are intentionally not implemented.
