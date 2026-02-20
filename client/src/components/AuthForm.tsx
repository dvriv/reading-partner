import { FormEvent, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthFormProps {
  onAuth: (session: Session | null) => void;
}

export default function AuthForm({ onAuth }: AuthFormProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!supabase) {
      setError('Supabase config missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'signup') {
        const { error: signUpError, data } = await supabase.auth.signUp({ email, password });
        if (signUpError) throw signUpError;
        if (data.session) {
          onAuth(data.session);
        } else {
          const { error: signInError, data: signInData } = await supabase.auth.signInWithPassword({ email, password });
          if (signInError) throw signInError;
          onAuth(signInData.session);
        }
      } else {
        const { error: signInError, data } = await supabase.auth.signInWithPassword({ email, password });
        if (signInError) throw signInError;
        onAuth(data.session);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rp-page flex min-h-screen items-center justify-center p-4 md:p-8">
      <form
        onSubmit={submit}
        className="rp-modal spine-card w-full max-w-md space-y-4 p-6 md:p-7"
      >
        <div className="spine-content">
          <h1 className="text-3xl font-semibold">Reading Partner</h1>
          <p className="text-sm text-[var(--ink-secondary)]">Grounded answers, bounded by your place in the story.</p>
        </div>

        <label className="block text-sm font-medium text-[var(--ink-secondary)]">
          Email
          <input
            className="rp-field mt-1"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </label>

        <label className="block text-sm font-medium text-[var(--ink-secondary)]">
          Password
          <input
            className="rp-field mt-1"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </label>

        {error ? <p className="text-sm text-[var(--danger-ink)]">{error}</p> : null}

        <button
          type="submit"
          disabled={loading}
          className="rp-btn rp-btn-primary w-full"
        >
          {loading ? 'Please wait...' : mode === 'login' ? 'Log in' : 'Sign up'}
        </button>

        <button
          type="button"
          className="w-full text-sm font-semibold text-[var(--accent-binding)]"
          onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
        >
          {mode === 'login' ? 'Need an account? Sign up' : 'Already have an account? Log in'}
        </button>
      </form>
    </div>
  );
}
