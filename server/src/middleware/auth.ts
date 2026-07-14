import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { MiddlewareHandler } from 'hono';
import { getEnv } from '../env.js';

export type AppBindings = {
  Variables: {
    userId: string;
  };
};

let supabaseClient: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (supabaseClient) {
    return supabaseClient;
  }

  const env = getEnv();
  const supabaseUrl = env.supabaseUrl;
  const supabaseServiceRoleKey = env.supabaseServiceRoleKey;

  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error(
      'Missing required environment variables: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY',
    );
  }

  supabaseClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return supabaseClient;
}

export const authMiddleware: MiddlewareHandler<AppBindings> = async (c, next) => {
  const authHeader = c.req.header('Authorization');

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid Authorization header. Expected Bearer token.',
        },
      },
      401,
    );
  }

  const token = authHeader.slice('Bearer '.length).trim();

  if (!token) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Bearer token is empty.',
        },
      },
      401,
    );
  }

  let user: { id: string } | null = null;
  let error: Error | null = null;

  try {
    const client = getSupabaseClient();
    const result = await client.auth.getUser(token);
    user = result.data.user;
    error = result.error;
  } catch {
    return c.json(
      {
        error: {
          code: 'SERVER_MISCONFIGURED',
          message: 'Auth provider is not configured correctly.',
        },
      },
      500,
    );
  }

  if (error || !user) {
    return c.json(
      {
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token.',
        },
      },
      401,
    );
  }

  c.set('userId', user.id);
  await next();
};
