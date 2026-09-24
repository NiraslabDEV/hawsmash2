import { describe, expect, it } from 'vitest';

import { TV_MEDIA_MAX_BYTES, formatBytes, mediaKindFromMime, tvMediaPath, tvMediaUploadError } from '../media';

describe('TV — ficheiros da biblioteca', () => {
  it('só aceita vídeo e imagem que as TVs reproduzem', () => {
    expect(mediaKindFromMime('video/mp4')).toBe('video');
    expect(mediaKindFromMime('video/webm')).toBe('video');
    expect(mediaKindFromMime('image/jpeg')).toBe('image');
    expect(mediaKindFromMime('image/webp')).toBe('image');
    // .mov e .avi não tocam em todas as boxes Android: melhor recusar à entrada.
    expect(mediaKindFromMime('video/quicktime')).toBeNull();
    expect(mediaKindFromMime('image/svg+xml')).toBeNull();
    expect(mediaKindFromMime('application/pdf')).toBeNull();
  });

  it('recusa antes de carregar o que o servidor ia recusar', () => {
    expect(tvMediaUploadError({ type: 'video/mp4', size: 10_000_000 })).toBeNull();
    expect(tvMediaUploadError({ type: 'video/quicktime', size: 10 })).toMatch(/MP4/);
    expect(tvMediaUploadError({ type: 'video/mp4', size: TV_MEDIA_MAX_BYTES + 1 })).toMatch(/MB/);
    expect(tvMediaUploadError({ type: 'image/png', size: 0 })).toMatch(/vazio/);
  });

  it('o caminho é único e nunca leva o nome original (acentos, espaços)', () => {
    const caminho = tvMediaPath('0f0e0c0b-0a09-4807-8605-040302010000', 'Promo Verão Açaí.MP4', 'video/mp4');
    expect(caminho).toBe('media/0f0e0c0b-0a09-4807-8605-040302010000.mp4');
    expect(tvMediaPath('0f0e0c0b-0a09-4807-8605-040302010000', 'sem-extensao', 'image/webp')).toBe(
      'media/0f0e0c0b-0a09-4807-8605-040302010000.webp',
    );
  });

  it('mostra o tamanho em linguagem de gente', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2_500_000)).toBe('2,4 MB');
    expect(formatBytes(1_536)).toBe('1,5 KB');
  });
});
