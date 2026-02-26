import type { AnswerResponse } from '../types';
import { ProviderRequestError } from './provider-error';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

type AskChunk = { content: string; bookTitle: string; chapterNumber: number; chapterLabel: string };

async function postAsk(payload: Record<string, unknown>, authToken: string): Promise<AnswerResponse> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/ask`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new ProviderRequestError('Question provider is temporarily unavailable.', 'ask_network_failure');
  }

  if (!res.ok) {
    throw new ProviderRequestError(`Ask failed: ${res.status} ${res.statusText}`, `ask_http_${res.status}`);
  }
  return (await res.json()) as AnswerResponse;
}

export async function askSeriesQuestion(
  seriesName: string,
  currentBookTitle: string,
  currentChapter: number,
  currentChapterLabel: string,
  completedBookTitles: string[],
  question: string,
  chunks: AskChunk[],
  authToken: string
): Promise<AnswerResponse> {
  return postAsk(
    {
      seriesName,
      bookTitle: currentBookTitle,
      currentChapter,
      currentChapterLabel,
      completedBooks: completedBookTitles,
      question,
      chunks
    },
    authToken
  );
}

export async function askBookQuestion(
  bookTitle: string,
  currentChapter: number,
  currentChapterLabel: string,
  question: string,
  chunks: AskChunk[],
  authToken: string
): Promise<AnswerResponse> {
  return postAsk({ bookTitle, currentChapter, currentChapterLabel, question, chunks }, authToken);
}
