import type { Context } from 'hono';

export function jsonError(c: Context, status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 500 | 502, code: string, message: string) {
  return c.json({ error: { code, message } }, status);
}

export function getBearerToken(header: string | undefined): string | null {
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice('Bearer '.length).trim();
  return token || null;
}
