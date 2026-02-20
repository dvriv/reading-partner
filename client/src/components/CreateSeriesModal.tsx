import { FormEvent, useState } from 'react';

interface CreateSeriesModalProps {
  open: boolean;
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
}

export default function CreateSeriesModal({ open, onClose, onCreate }: CreateSeriesModalProps) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  if (!open) return null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    await onCreate(name.trim());
    setName('');
    setLoading(false);
  }

  return (
    <div className="rp-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-4">
      <form onSubmit={handleSubmit} className="rp-modal spine-card w-full max-w-md p-5">
        <h2 className="spine-content text-xl font-semibold">Create New Series</h2>
        <input
          className="rp-field mt-3"
          placeholder="Series name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          required
        />
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rp-btn rp-btn-secondary">
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="rp-btn rp-btn-primary"
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
