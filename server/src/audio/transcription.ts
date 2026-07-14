import OpenAI from 'openai';
import { createReadStream } from 'node:fs';
import { getEnv } from '../env.js';

export type TranscriptionProvider = {
  transcribeAudioWindow(input: {
    filePath: string;
    startSeconds: number;
    endSeconds: number;
    language?: string;
    promptTerms?: string[];
  }): Promise<{
    text: string;
    startSeconds: number;
    endSeconds: number;
    provider: string;
    model: string;
    confidence?: number;
  }>;
};

export function createOpenAiTranscriptionProvider(): TranscriptionProvider {
  const env = getEnv();
  const client = new OpenAI({ apiKey: env.openAiApiKey });
  return {
    async transcribeAudioWindow(input) {
      if (!env.openAiApiKey) throw new Error('Missing OPENAI_API_KEY');
      // Dev implementation: the caller stores only a temporary upload/window path. Full audiobook transcription is intentionally not supported.
      const result = await client.audio.transcriptions.create({
        file: createReadStream(input.filePath),
        model: env.openAiTranscriptionModel,
        language: input.language,
        prompt: input.promptTerms?.slice(0, 30).join(', '),
      });
      return {
        text: result.text,
        startSeconds: input.startSeconds,
        endSeconds: input.endSeconds,
        provider: 'openai',
        model: env.openAiTranscriptionModel,
      };
    },
  };
}

export function getTranscriptionProvider(): TranscriptionProvider {
  return createOpenAiTranscriptionProvider();
}
