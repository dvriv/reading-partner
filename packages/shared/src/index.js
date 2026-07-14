export const DRM_UNSUPPORTED_MESSAGE = 'This file appears to be DRM-protected or unsupported. SpoilerFree can only process DRM-free EPUB and common DRM-free audio files.';
export function isAskRequest(value) {
    if (!value || typeof value !== 'object')
        return false;
    const draft = value;
    return ((draft.contextType === 'book' || draft.contextType === 'series') &&
        typeof draft.contextId === 'string' &&
        draft.contextId.length > 0 &&
        typeof draft.question === 'string' &&
        draft.question.trim().length > 0);
}
