import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from 'dotenv';
import { askRoute } from './routes/ask.js';
import { embedRoute } from './routes/embed.js';

config();

const app = new Hono();

function parseCorsOrigin(): string | string[] {
  const raw = process.env.CORS_ORIGIN;
  if (!raw || !raw.trim()) {
    return 'http://localhost:5173';
  }

  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length === 1 ? origins[0] : origins;
}

app.use(
  '/*',
  cors({
    origin: parseCorsOrigin(),
    allowHeaders: ['Authorization', 'Content-Type'],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    credentials: true,
  }),
);

app.get('/api/health', (c) => c.json({ status: 'ok' }));

app.route('/api', embedRoute);
app.route('/api', askRoute);

app.onError((err, c) => {
  console.error('Unhandled server error:', err);
  return c.json(
    {
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
      },
    },
    500,
  );
});

app.notFound((c) => {
  return c.json(
    {
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
      },
    },
    404,
  );
});

const port = Number.parseInt(process.env.PORT ?? '3001', 10);

serve(
  {
    fetch: app.fetch,
    port: Number.isNaN(port) ? 3001 : port,
  },
  (info) => {
    console.log(`Server running on http://localhost:${info.port}`);
  },
);
