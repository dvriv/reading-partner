import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

let client: SupabaseClient | null = null;

if (url && key) {
  client = createClient(url, key);
}

export const supabase = client;

export async function deleteCurrentSupabaseUser(accessToken: string): Promise<void> {
  if (!url || !key) {
    throw new Error('Supabase config missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
  }

  const response = await fetch(`${url}/auth/v1/user`, {
    method: 'DELETE',
    headers: {
      apikey: key,
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Failed to delete account.');
  }
}
