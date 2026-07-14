export type Env = {
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  databaseUrl: string;
  voyageApiKey: string;
  voyageEmbeddingModel: string;
  voyageEmbeddingDimension: number;
  voyageRerankModel: string;
  deepseekApiKey: string;
  deepseekBaseUrl: string;
  deepseekClassifierModel: string;
  deepseekCheapModel: string;
  deepseekStrongModel: string;
  transcriptionProvider: 'openai';
  openAiApiKey: string;
  openAiTranscriptionModel: string;
  freePlanMaxSeries: number;
  freePlanMaxBooks: number;
  freePlanMaxQuestionsPerMonth: number;
  freePlanMaxUploadMb: number;
  freePlanMaxBookTokens: number;
  freePlanMaxTotalBookTokens: number;
  freePlanAudioAlignmentMinutes: number;
  paidPlanAudioAlignmentEnabled: boolean;
  aiDebug: boolean;
  port: number;
  corsOrigin: string;
};

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

export function getEnv(): Env {
  return {
    supabaseUrl: process.env.SUPABASE_URL ?? '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
    databaseUrl: process.env.DATABASE_URL ?? '',
    voyageApiKey: process.env.VOYAGE_API_KEY ?? '',
    voyageEmbeddingModel: process.env.VOYAGE_EMBEDDING_MODEL ?? 'voyage-4',
    voyageEmbeddingDimension: intEnv('VOYAGE_EMBEDDING_DIMENSION', 1024),
    voyageRerankModel: process.env.VOYAGE_RERANK_MODEL ?? 'rerank-2.5-lite',
    deepseekApiKey: process.env.DEEPSEEK_API_KEY ?? '',
    deepseekBaseUrl: process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com',
    deepseekClassifierModel: process.env.DEEPSEEK_CLASSIFIER_MODEL ?? 'deepseek-v4-flash',
    deepseekCheapModel: process.env.DEEPSEEK_CHEAP_MODEL ?? 'deepseek-v4-flash',
    deepseekStrongModel: process.env.DEEPSEEK_STRONG_MODEL ?? 'deepseek-v4-pro',
    transcriptionProvider: 'openai',
    openAiApiKey: process.env.OPENAI_API_KEY ?? '',
    openAiTranscriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL ?? 'gpt-4o-mini-transcribe',
    freePlanMaxSeries: intEnv('FREE_PLAN_MAX_SERIES', 1),
    freePlanMaxBooks: intEnv('FREE_PLAN_MAX_BOOKS', 3),
    freePlanMaxQuestionsPerMonth: intEnv('FREE_PLAN_MAX_QUESTIONS_PER_MONTH', 10),
    freePlanMaxUploadMb: intEnv('FREE_PLAN_MAX_UPLOAD_MB', 100),
    freePlanMaxBookTokens: intEnv('FREE_PLAN_MAX_BOOK_TOKENS', 5_000_000),
    freePlanMaxTotalBookTokens: intEnv('FREE_PLAN_MAX_TOTAL_BOOK_TOKENS', 12_000_000),
    freePlanAudioAlignmentMinutes: intEnv('FREE_PLAN_AUDIO_ALIGNMENT_MINUTES', 0),
    paidPlanAudioAlignmentEnabled: boolEnv('PAID_PLAN_AUDIO_ALIGNMENT_ENABLED', true),
    aiDebug: boolEnv('AI_DEBUG', true),
    port: intEnv('PORT', 3001),
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:8081',
  };
}

export function requireEnv(name: keyof Env, value: string): string {
  if (!value) throw new Error(`Missing required environment variable: ${String(name)}`);
  return value;
}

export function debugLog(scope: 'AI' | 'Audio', message: string, data?: unknown): void {
  if (!getEnv().aiDebug) return;
  if (data === undefined) console.log(`[${scope}] ${message}`);
  else console.log(`[${scope}] ${message}`, data);
}
