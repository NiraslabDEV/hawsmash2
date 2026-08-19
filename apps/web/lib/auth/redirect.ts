const DEFAULT_AUTH_DESTINATION = '/pedidos';

export function safeInternalRedirect(candidate: string | null): string {
  const hasControlCharacter = candidate
    ? Array.from(candidate).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || code === 127;
      })
    : false;

  if (
    !candidate ||
    !candidate.startsWith('/') ||
    candidate.startsWith('//') ||
    candidate.includes('\\') ||
    hasControlCharacter
  ) {
    return DEFAULT_AUTH_DESTINATION;
  }

  return candidate;
}
