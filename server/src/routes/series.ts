import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { getDb } from '../db/client.js';
import { authMiddleware, type AppBindings } from '../middleware/auth.js';
import { getPlanLimits, getUserPlan } from '../quota/plans.js';
import { jsonError } from '../utils/http.js';

export const seriesRoute = new Hono<AppBindings>();

seriesRoute.post('/series', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const body = (await c.req.json()) as { name?: string; author?: string };
  if (!body.name?.trim()) return jsonError(c, 400, 'INVALID_REQUEST', 'Series name is required.');
  const plan = await getUserPlan(userId);
  const limits = getPlanLimits(plan);
  const count = await getDb().execute(sql`select count(*)::int as count from series where user_id = ${userId}`);
  if (Number(count[0]?.count ?? 0) >= limits.maxSeries) return jsonError(c, 403, 'QUOTA_EXCEEDED', 'Series quota exceeded for this plan.');
  const rows = await getDb().execute(sql`insert into series (user_id, name, author) values (${userId}, ${body.name.trim()}, ${body.author?.trim() || null}) returning *`);
  return c.json(rows[0], 201);
});

seriesRoute.get('/series/:seriesId', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const seriesId = c.req.param('seriesId');
  const rows = await getDb().execute(sql`select * from series where user_id = ${userId} and id = ${seriesId} limit 1`);
  if (!rows[0]) return jsonError(c, 404, 'SERIES_NOT_FOUND', 'Series not found.');
  const books = await getDb().execute(sql`select * from books where user_id = ${userId} and series_id = ${seriesId} order by book_number nulls last, created_at`);
  return c.json({ ...rows[0], books });
});

seriesRoute.delete('/series/:seriesId', authMiddleware, async (c) => {
  const userId = c.get('userId');
  const seriesId = c.req.param('seriesId');
  await getDb().execute(sql`delete from series where user_id = ${userId} and id = ${seriesId}`);
  return c.json({ ok: true });
});
