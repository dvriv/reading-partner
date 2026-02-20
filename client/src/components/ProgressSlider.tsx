import { useEffect, useMemo, useState } from 'react';
import type { Chapter } from '../types';

interface ProgressSliderProps {
  currentChapter: number;
  totalChapters: number;
  chapters: Chapter[];
  onChange: (value: number) => Promise<void>;
}

export default function ProgressSlider({
  currentChapter,
  totalChapters,
  chapters,
  onChange
}: ProgressSliderProps) {
  const [value, setValue] = useState(currentChapter);

  useEffect(() => setValue(currentChapter), [currentChapter]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      if (value !== currentChapter) {
        void onChange(value);
      }
    }, 300);

    return () => clearTimeout(timeout);
  }, [value, currentChapter, onChange]);

  const chapterTitle = useMemo(() => {
    if (value < 1) return 'Unread';
    return chapters.find((chapter) => chapter.chapterNumber === value)?.title || `Chapter ${value}`;
  }, [chapters, value]);

  return (
    <div className="rp-surface-elevated rounded-xl p-4">
      <p className="text-sm font-semibold text-[var(--ink-secondary)]">Reading Progress</p>
      <input
        type="range"
        min={0}
        max={totalChapters}
        value={value}
        onChange={(event) => setValue(Number(event.target.value))}
        className="mt-2 w-full accent-[var(--accent-binding)]"
      />
      <p className="text-sm font-medium text-[var(--ink-primary)]">
        Chapter {value}/{totalChapters}
      </p>
      <p className="text-xs text-[var(--ink-tertiary)]">{chapterTitle}</p>
    </div>
  );
}
