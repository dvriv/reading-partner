import type { AskRequest } from '@reading-partner/shared';
import { supabase } from './supabase';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001/api';
const DEBUG = process.env.EXPO_PUBLIC_AI_DEBUG === 'true';

async function token(): Promise<string> {
  const session = await supabase?.auth.getSession();
  const accessToken = session?.data.session?.access_token;
  if (!accessToken) throw new Error('Not signed in.');
  return accessToken;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const accessToken = await token();
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);
  if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message ?? `Request failed: ${response.status}`);
  return payload as T;
}

export function logClient(event: string, data?: unknown): void {
  if (!DEBUG) return;
  if (data === undefined) console.log(`[Client] ${event}`);
  else console.log(`[Client] ${event}`, data);
}

export async function ask(body: AskRequest) {
  logClient('ask:start', body);
  const response = await apiFetch('/ask', { method: 'POST', body: JSON.stringify(body) });
  logClient('ask:response debug', (response as { debug?: unknown }).debug);
  return response;
}
