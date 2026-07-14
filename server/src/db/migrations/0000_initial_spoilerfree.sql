create extension if not exists vector;
create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  series_id uuid references series(id) on delete cascade,
  title text not null,
  author text,
  isbn text,
  language text,
  publication_year int,
  cover_url text,
  total_chapters int not null default 0,
  current_chapter int not null default 1,
  book_number int,
  source_type text not null default 'epub',
  status text not null default 'reading',
  processing_status text not null default 'pending',
  has_server_content boolean not null default false,
  source_file_name text,
  token_count int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  series_id uuid references series(id) on delete cascade,
  book_id uuid not null references books(id) on delete cascade,
  chapter_number int not null,
  title text not null,
  start_offset int,
  end_offset int,
  created_at timestamptz not null default now(),
  unique(book_id, chapter_number)
);

create table if not exists chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  series_id uuid references series(id) on delete cascade,
  book_id uuid not null references books(id) on delete cascade,
  chapter_id uuid references chapters(id) on delete set null,
  source_type text not null,
  book_number int,
  chapter_number int not null,
  chunk_index int not null,
  chapter_label text not null,
  content text not null,
  token_count int,
  start_offset int,
  end_offset int,
  audio_file_id uuid,
  audio_start_seconds int,
  audio_end_seconds int,
  embedding_model text,
  embedding_dimension int,
  embedding_version text,
  embedding vector(1024),
  search_vector tsvector generated always as (to_tsvector('simple', coalesce(content, ''))) stored,
  created_at timestamptz not null default now()
);

create table if not exists reading_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  series_id uuid references series(id) on delete cascade,
  book_id uuid references books(id) on delete cascade,
  current_book_number int,
  current_chapter int not null default 1,
  current_text_offset int,
  progress_source text not null default 'manual',
  updated_at timestamptz not null default now()
);

create table if not exists audio_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  series_id uuid references series(id) on delete cascade,
  book_id uuid not null references books(id) on delete cascade,
  file_name text not null,
  mime_type text,
  duration_seconds int,
  file_order int,
  storage_status text not null default 'temporary',
  processing_status text not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists audio_progress_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  series_id uuid references series(id) on delete cascade,
  book_id uuid not null references books(id) on delete cascade,
  chapter_id uuid references chapters(id) on delete set null,
  audio_file_id uuid references audio_files(id) on delete set null,
  chapter_number int not null,
  audio_position_seconds int not null,
  audio_window_start_seconds int not null,
  audio_window_end_seconds int not null,
  transcript_text text not null,
  matched_text_preview text,
  text_start_offset int,
  text_end_offset int,
  confidence numeric,
  provider text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create table if not exists monthly_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  questions_used int not null default 0,
  books_uploaded int not null default 0,
  embedding_tokens_used int not null default 0,
  rerank_tokens_used int not null default 0,
  answer_input_tokens_used int not null default 0,
  answer_output_tokens_used int not null default 0,
  audio_alignment_seconds_used int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists ai_request_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  request_type text not null,
  model text,
  question_type text,
  rerank_used boolean,
  vector_candidates int,
  keyword_candidates int,
  final_chunks int,
  success boolean not null default true,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists series_user_id_idx on series(user_id);
create index if not exists books_user_id_idx on books(user_id);
create index if not exists books_user_series_idx on books(user_id, series_id);
create unique index if not exists chapters_book_chapter_unique on chapters(book_id, chapter_number);
create index if not exists chunks_user_series_idx on chunks(user_id, series_id);
create index if not exists chunks_user_book_idx on chunks(user_id, book_id);
create index if not exists chunks_user_series_position_idx on chunks(user_id, series_id, book_number, chapter_number);
create index if not exists chunks_user_book_chapter_idx on chunks(user_id, book_id, chapter_number);
create index if not exists chunks_search_vector_idx on chunks using gin(search_vector);
create index if not exists chunks_embedding_cosine_idx on chunks using hnsw (embedding vector_cosine_ops);
create index if not exists monthly_usage_user_period_idx on monthly_usage(user_id, period_start);
create index if not exists reading_progress_user_series_idx on reading_progress(user_id, series_id);
create index if not exists reading_progress_user_book_idx on reading_progress(user_id, book_id);
create index if not exists audio_mappings_user_book_chapter_idx on audio_progress_mappings(user_id, book_id, chapter_number);
