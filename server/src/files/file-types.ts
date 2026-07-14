import { DRM_UNSUPPORTED_MESSAGE } from '@reading-partner/shared';

export const SUPPORTED_EBOOK_EXTENSIONS = new Set(['.epub']);
export const SUPPORTED_AUDIO_EXTENSIONS = new Set(['.mp3', '.m4a', '.m4b', '.aac', '.wav', '.flac', '.ogg', '.opus']);
export const UNSUPPORTED_DRM_EXTENSIONS = new Set(['.aax', '.aa', '.azw', '.azw3', '.kfx', '.kcr']);

export function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf('.');
  return index === -1 ? '' : fileName.slice(index).toLowerCase();
}

export function validateEbookFileName(fileName: string): { ok: true } | { ok: false; message: string } {
  const extension = getFileExtension(fileName);
  if (UNSUPPORTED_DRM_EXTENSIONS.has(extension) || !SUPPORTED_EBOOK_EXTENSIONS.has(extension)) {
    return { ok: false, message: DRM_UNSUPPORTED_MESSAGE };
  }
  return { ok: true };
}

export function validateAudioFileName(fileName: string): { ok: true } | { ok: false; message: string } {
  const extension = getFileExtension(fileName);
  if (UNSUPPORTED_DRM_EXTENSIONS.has(extension) || !SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    return { ok: false, message: DRM_UNSUPPORTED_MESSAGE };
  }
  return { ok: true };
}
