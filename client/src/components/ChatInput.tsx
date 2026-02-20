import { KeyboardEvent, useState } from 'react';
import { ArrowUp } from 'lucide-react';

interface ChatInputProps {
  onSend: (message: string) => Promise<void>;
  disabled?: boolean;
  loadingLabel?: string | null;
}

export default function ChatInput({ onSend, disabled, loadingLabel }: ChatInputProps) {
  const [value, setValue] = useState('');

  async function handleSend() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    setValue('');
    await onSend(trimmed);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  }

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-[var(--line-subtle)] bg-[var(--paper-elevated)] shadow-[0_14px_26px_rgba(17,24,39,0.08)] transition focus-within:border-[var(--accent-binding)] focus-within:ring-2 focus-within:ring-[rgba(99,102,241,0.18)]">
        <div className="relative flex items-end bg-[rgba(248,250,252,0.7)]">
          <textarea
            id="chat-input"
            className="w-full min-h-[62px] resize-none border-0 bg-transparent p-4 pr-14 text-[15px] text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)] focus:outline-none"
            placeholder="Ask a question about the plot, characters, or lore..."
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            disabled={disabled}
            aria-label="Chat question input"
          />
          <button
            type="button"
            disabled={disabled || !value.trim()}
            className="absolute bottom-2 right-2 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--line-subtle)] bg-[var(--paper-elevated)] text-[var(--accent-binding)] transition hover:bg-[var(--paper-surface)] disabled:opacity-60"
            onClick={() => void handleSend()}
            aria-label="Send message"
          >
            <ArrowUp size={18} />
          </button>
        </div>
      </div>
      {loadingLabel ? (
        <div className="mt-2 text-center">
          <span className="text-[11px] text-[var(--ink-muted)]" aria-live="polite">
            {loadingLabel}
          </span>
        </div>
      ) : null}
    </div>
  );
}
