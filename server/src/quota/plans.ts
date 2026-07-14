import type { Plan } from '@reading-partner/shared';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { getEnv } from '../env.js';

export type PlanLimits = {
  maxSeries: number;
  maxBooks: number;
  maxQuestionsPerMonth: number;
  maxUploadMb: number;
  maxBookTokens: number;
  maxTotalBookTokens: number;
  audioAlignmentEnabled: boolean;
  audioAlignmentTrialMinutes?: number;
  audioAlignmentMinutesPerMonth?: number;
};

export function getPlanLimits(plan: Plan): PlanLimits {
  const env = getEnv();
  if (plan === 'admin') {
    return {
      maxSeries: Number.MAX_SAFE_INTEGER,
      maxBooks: Number.MAX_SAFE_INTEGER,
      maxQuestionsPerMonth: Number.MAX_SAFE_INTEGER,
      maxUploadMb: Number.MAX_SAFE_INTEGER,
      maxBookTokens: Number.MAX_SAFE_INTEGER,
      maxTotalBookTokens: Number.MAX_SAFE_INTEGER,
      audioAlignmentEnabled: true,
      audioAlignmentMinutesPerMonth: Number.MAX_SAFE_INTEGER,
    };
  }
  if (plan === 'paid') {
    return {
      maxSeries: 50,
      maxBooks: 500,
      maxQuestionsPerMonth: 500,
      maxUploadMb: 250,
      maxBookTokens: 5_000_000,
      maxTotalBookTokens: 100_000_000,
      audioAlignmentEnabled: env.paidPlanAudioAlignmentEnabled,
      audioAlignmentMinutesPerMonth: 120,
    };
  }
  return {
    maxSeries: env.freePlanMaxSeries,
    maxBooks: env.freePlanMaxBooks,
    maxQuestionsPerMonth: env.freePlanMaxQuestionsPerMonth,
    maxUploadMb: env.freePlanMaxUploadMb,
    maxBookTokens: env.freePlanMaxBookTokens,
    maxTotalBookTokens: env.freePlanMaxTotalBookTokens,
    audioAlignmentEnabled: false,
    audioAlignmentTrialMinutes: env.freePlanAudioAlignmentMinutes,
  };
}

function monthWindow(now = new Date()): { start: string; end: string } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

async function ensureUsageRow(userId: string) {
  const db = getDb();
  const { start, end } = monthWindow();
  await db.execute(sql`
    insert into monthly_usage (user_id, period_start, period_end)
    values (${userId}, ${start}, ${end})
    on conflict do nothing
  `);
  const rows = await db.execute(sql`select * from monthly_usage where user_id = ${userId} and period_start = ${start} limit 1`);
  return rows[0] as Record<string, unknown> | undefined;
}

export async function getUserPlan(userId: string): Promise<Plan> {
  const db = getDb();
  await db.execute(sql`insert into profiles (id, plan) values (${userId}, 'free') on conflict (id) do nothing`);
  const rows = await db.execute(sql`select plan from profiles where id = ${userId} limit 1`);
  const plan = rows[0]?.plan;
  return plan === 'paid' || plan === 'admin' ? plan : 'free';
}

export async function assertCanUploadBook(userId: string, fileSizeBytes: number): Promise<void> {
  const plan = await getUserPlan(userId);
  const limits = getPlanLimits(plan);
  if (fileSizeBytes > limits.maxUploadMb * 1024 * 1024) throw new Error(`Upload exceeds ${limits.maxUploadMb} MB plan limit.`);
  const db = getDb();
  const counts = await db.execute(sql`select count(*)::int as count from books where user_id = ${userId}`);
  if (Number(counts[0]?.count ?? 0) >= limits.maxBooks) throw new Error('Book upload quota exceeded for this plan.');
}

export async function assertCanAskQuestion(userId: string): Promise<void> {
  const plan = await getUserPlan(userId);
  const limits = getPlanLimits(plan);
  const usage = await ensureUsageRow(userId);
  if (Number(usage?.questions_used ?? 0) >= limits.maxQuestionsPerMonth) throw new Error('Monthly question quota exceeded.');
}

export async function assertCanUseAudioAlignment(userId: string, requestedSeconds: number): Promise<void> {
  const plan = await getUserPlan(userId);
  const limits = getPlanLimits(plan);
  if (!limits.audioAlignmentEnabled && !limits.audioAlignmentTrialMinutes) throw new Error('Audio alignment is paid-only for now.');
  const usage = await ensureUsageRow(userId);
  const limitSeconds = (limits.audioAlignmentMinutesPerMonth ?? limits.audioAlignmentTrialMinutes ?? 0) * 60;
  if (Number(usage?.audio_alignment_seconds_used ?? 0) + requestedSeconds > limitSeconds) {
    throw new Error('Monthly audio alignment quota exceeded.');
  }
}

export async function recordQuestionUsage(userId: string, usage: { inputTokens?: number; outputTokens?: number } = {}): Promise<void> {
  await ensureUsageRow(userId);
  const { start } = monthWindow();
  await getDb().execute(sql`
    update monthly_usage
    set questions_used = questions_used + 1,
        answer_input_tokens_used = answer_input_tokens_used + ${usage.inputTokens ?? 0},
        answer_output_tokens_used = answer_output_tokens_used + ${usage.outputTokens ?? 0},
        updated_at = now()
    where user_id = ${userId} and period_start = ${start}
  `);
}

export async function recordEmbeddingUsage(userId: string, usage: { tokens?: number }): Promise<void> {
  await ensureUsageRow(userId);
  const { start } = monthWindow();
  await getDb().execute(sql`update monthly_usage set embedding_tokens_used = embedding_tokens_used + ${usage.tokens ?? 0}, updated_at = now() where user_id = ${userId} and period_start = ${start}`);
}

export async function recordRerankUsage(userId: string, usage: { tokens?: number }): Promise<void> {
  await ensureUsageRow(userId);
  const { start } = monthWindow();
  await getDb().execute(sql`update monthly_usage set rerank_tokens_used = rerank_tokens_used + ${usage.tokens ?? 0}, updated_at = now() where user_id = ${userId} and period_start = ${start}`);
}

export async function recordBookUploadUsage(userId: string): Promise<void> {
  await ensureUsageRow(userId);
  const { start } = monthWindow();
  await getDb().execute(sql`update monthly_usage set books_uploaded = books_uploaded + 1, updated_at = now() where user_id = ${userId} and period_start = ${start}`);
}

export async function recordAudioAlignmentUsage(userId: string, seconds: number): Promise<void> {
  await ensureUsageRow(userId);
  const { start } = monthWindow();
  await getDb().execute(sql`update monthly_usage set audio_alignment_seconds_used = audio_alignment_seconds_used + ${seconds}, updated_at = now() where user_id = ${userId} and period_start = ${start}`);
}

export async function getUsage(userId: string) {
  const plan = await getUserPlan(userId);
  const usage = await ensureUsageRow(userId);
  return { plan, limits: getPlanLimits(plan), usage };
}
