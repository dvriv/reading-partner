import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from 'dotenv';
import { askRoute } from './routes/ask.js';
import { audiobooksRoute } from './routes/audiobooks.js';
import { booksRoute } from './routes/books.js';
import { libraryRoute } from './routes/library.js';
import { progressRoute } from './routes/progress.js';
import { seriesRoute } from './routes/series.js';
import { usageRoute } from './routes/usage.js';
import { getEnv } from './env.js';

config();

const app = new Hono();

function parseCorsOrigin(): string | string[] {
  const raw = process.env.CORS_ORIGIN;
  if (!raw || !raw.trim()) {
    return getEnv().corsOrigin;
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
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  }),
);

app.get('/api/health', (c) => c.json({ status: 'ok' }));

app.route('/api', libraryRoute);
app.route('/api', booksRoute);
app.route('/api', seriesRoute);
app.route('/api', progressRoute);
app.route('/api', audiobooksRoute);
app.route('/api', askRoute);
app.route('/api', usageRoute);

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

const port = getEnv().port;

serve(
  {
    fetch: app.fetch,
    port: Number.isNaN(port) ? 3001 : port,
  },
  (info) => {
    console.log(`Server running on http://localhost:${info.port}`);
  },
);
