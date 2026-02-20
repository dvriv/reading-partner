import { FormEvent, useState } from 'react';
import { clearAllLocalData } from '../lib/db';
import { deleteCurrentSupabaseUser, supabase } from '../lib/supabase';

interface SettingsModalProps {
  open: boolean;
  accessToken: string;
  onClose: () => void;
  onAccountDeleted: () => Promise<void>;
}

export default function SettingsModal({ open, accessToken, onClose, onAccountDeleted }: SettingsModalProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function submitEmail(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!supabase) {
      setError('Supabase config missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }

    setEmailLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ email: email.trim() });
      if (updateError) throw updateError;
      setMessage('Email updated successfully.');
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update email.');
    } finally {
      setEmailLoading(false);
    }
  }

  async function submitPassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    if (!supabase) {
      setError('Supabase config missing. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.');
      return;
    }

    setPasswordLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setMessage('Password updated successfully.');
      setPassword('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update password.');
    } finally {
      setPasswordLoading(false);
    }
  }

  async function handleDeleteAccount() {
    const confirmed = window.confirm(
      'Delete your account and all local reading data permanently? This cannot be undone.'
    );
    if (!confirmed) return;

    setError(null);
    setMessage(null);
    setDeleteLoading(true);
    try {
      await deleteCurrentSupabaseUser(accessToken);
      await clearAllLocalData();
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem('reading-partner:collapsed-series');
      }
      await onAccountDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account and data.');
    } finally {
      setDeleteLoading(false);
    }
  }

  return (
    <div className="rp-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="rp-modal w-full max-w-xl p-5 md:p-6" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold text-[var(--ink-primary)]">Settings</h2>
          <button type="button" onClick={onClose} className="rp-btn rp-btn-secondary min-h-9 px-3 text-sm">
            Close
          </button>
        </div>

        <div className="space-y-5">
          <form onSubmit={submitPassword} className="rp-surface rounded-xl p-4">
            <h3 className="text-sm font-semibold text-[var(--ink-primary)]">Change Password</h3>
            <label className="mt-3 block text-xs font-medium text-[var(--ink-secondary)]">
              New password
              <input
                className="rp-field mt-1"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
                minLength={8}
              />
            </label>
            <button type="submit" disabled={passwordLoading || !password.trim()} className="rp-btn rp-btn-primary mt-3 min-h-10 px-3 text-sm">
              {passwordLoading ? 'Updating...' : 'Change Password'}
            </button>
          </form>

          <form onSubmit={submitEmail} className="rp-surface rounded-xl p-4">
            <h3 className="text-sm font-semibold text-[var(--ink-primary)]">Change Email</h3>
            <label className="mt-3 block text-xs font-medium text-[var(--ink-secondary)]">
              New email
              <input
                className="rp-field mt-1"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </label>
            <button type="submit" disabled={emailLoading || !email.trim()} className="rp-btn rp-btn-primary mt-3 min-h-10 px-3 text-sm">
              {emailLoading ? 'Updating...' : 'Change Email'}
            </button>
          </form>

          <div className="rp-surface rounded-xl border border-[rgba(220,38,38,0.22)] p-4">
            <h3 className="text-sm font-semibold text-[var(--danger-ink)]">Delete Account and Data</h3>
            <p className="mt-2 text-xs text-[var(--ink-secondary)]">This permanently deletes your local reading data and your Supabase account.</p>
            <button
              type="button"
              onClick={() => void handleDeleteAccount()}
              disabled={deleteLoading}
              className="rp-btn rp-btn-danger mt-3 min-h-10 px-3 text-sm"
            >
              {deleteLoading ? 'Deleting...' : 'Delete Account and Data'}
            </button>
          </div>
        </div>

        {message ? <p className="mt-4 text-sm text-[var(--success-ink)]">{message}</p> : null}
        {error ? <p className="mt-2 text-sm text-[var(--danger-ink)]">{error}</p> : null}
      </div>
    </div>
  );
}
