import { Hono } from 'hono';
import { authMiddleware, type AppBindings } from '../middleware/auth.js';
import { getUsage } from '../quota/plans.js';

export const usageRoute = new Hono<AppBindings>();

usageRoute.get('/usage', authMiddleware, async (c) => {
  return c.json(await getUsage(c.get('userId')));
});
